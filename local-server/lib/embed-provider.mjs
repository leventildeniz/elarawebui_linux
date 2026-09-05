// local-server/lib/embed-provider.mjs
// Agnostic Embedding Provider with Native In-Process ONNX Runtime & Python HTTP Fallback

import { onnxEmbed, getOnnxStatus } from "./onnx-pipeline.mjs";

let _pushLog = (..._a) => {};
let _getWorkerStatus = () => "down";
let _kickWorkerStart = () => {};
let _ensureWorker = async () => {};
let _getRagSettings = () => ({});
let _EMBED_WORKER_PORT = Number(process.env.EMBED_WORKER_PORT || 8082);
let _EMBED_WORKER_HOST = "127.0.0.1";

export function initEmbedProvider(deps = {}) {
  if (typeof deps.pushLog === "function") _pushLog = deps.pushLog;
  if (typeof deps.getStatus === "function") _getWorkerStatus = deps.getStatus;
  if (typeof deps.kickWorkerStart === "function") _kickWorkerStart = deps.kickWorkerStart;
  if (typeof deps.ensureWorker === "function") _ensureWorker = deps.ensureWorker;
  if (typeof deps.getRagSettings === "function") _getRagSettings = deps.getRagSettings;
  if (Number.isFinite(Number(deps.embedWorkerPort))) _EMBED_WORKER_PORT = Number(deps.embedWorkerPort);
  if (typeof deps.embedWorkerHost === "string" && deps.embedWorkerHost) _EMBED_WORKER_HOST = deps.embedWorkerHost;
}

// ── Embed error ring ─────────────────────────────────────────────────────
let _lastEmbedError = null;
let _lastEmbedErrorAt = 0;

function _setEmbedError(kind, detail) {
  _lastEmbedError = { kind, detail: String(detail || "").slice(0, 200), at: Date.now() };
  _lastEmbedErrorAt = _lastEmbedError.at;
}

export function getLastEmbedError() {
  if (!_lastEmbedError) return null;
  if (Date.now() - _lastEmbedErrorAt > 60_000) return null;
  return _lastEmbedError;
}

// ── Embed RPC ────────────────────────────────────────────────────────────
export async function embed(texts, opts = {}) {
  const preferEngine = process.env.EMBED_ENGINE || "onnx";
  const externalSignal = opts.signal && typeof opts.signal === "object" ? opts.signal : null;
  if (externalSignal?.aborted) {
    _setEmbedError("aborted", "caller aborted");
    return null;
  }

  // 1. Primary: Native In-Process ONNX Runtime (0ms IPC, SIMD accelerated)
  if (preferEngine !== "python") {
    try {
      const embs = await onnxEmbed(texts, opts);
      if (Array.isArray(embs) && embs.length > 0) {
        _lastEmbedError = null;
        return embs;
      }
    } catch (onnxErr) {
      const reason = onnxErr?.message || String(onnxErr);
      console.warn(`⚠️ [EMBED:FALLBACK] In-process ONNX engine failed -> Falling back to external Python Worker (:${_EMBED_WORKER_PORT}). Reason: ${reason}`);
      try {
        _pushLog("engine", `[EMBED:FALLBACK] In-process ONNX failed -> Falling back to external Python Worker (:${_EMBED_WORKER_PORT}). Reason: ${reason}`);
      } catch { /* ignore */ }
      _setEmbedError("onnx_fallback", reason);
    }
  }

  // 2. Fallback: External Python Worker (Port 8082)
  const base = (process.env.EMBED_BASE_URL || `http://${_EMBED_WORKER_HOST}:${_EMBED_WORKER_PORT}`).replace(/\/$/, "");
  const model = process.env.EMBED_MODEL || process.env.DEFAULT_EMBED_MODEL || 'BAAI/bge-small-en-v1.5';
  
  if (!model) { 
    _setEmbedError("no_model", "EMBED_MODEL unset"); 
    return null; 
  }

  const timeoutMs = opts.timeoutMs ? Math.max(1000, Number(opts.timeoutMs) || 1000) : 120000;
  const maxAttempts = Math.max(1, Number(opts.attempts) || 2);
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (externalSignal?.aborted) { _setEmbedError("aborted", "caller aborted"); return null; }
    try {
      const signals = [AbortSignal.timeout(timeoutMs)];
      if (externalSignal) signals.push(externalSignal);
      
      const r = await fetch(`${base}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: Array.isArray(texts) ? texts : [texts] }),
        signal: AbortSignal.any(signals),
      });

      if (!r.ok) {
        lastErr = `http_${r.status}`;
        if (attempt === maxAttempts) { 
          _setEmbedError("http_error", `HTTP ${r.status} from ${base}/v1/embeddings`); 
          return null; 
        }
        continue;
      }

      const j = await r.json();
      _lastEmbedError = null;
      return (j.data || []).map(d => d.embedding);
    } catch (e) {
      lastErr = e?.name === "TimeoutError" || /timeout/i.test(String(e?.message))
        ? `timeout_${timeoutMs}ms`
        : `fetch_error:${e?.message || e}`;
      console.warn(`[embed-provider] fallback fetch attempt ${attempt}/${maxAttempts} failed (${base}/v1/embeddings):`, e?.message || e);
      
      if (externalSignal?.aborted) { _setEmbedError("aborted", "caller aborted mid-fetch"); return null; }
      if (attempt === maxAttempts) { _setEmbedError("fetch_failed", lastErr); return null; }
      
      await new Promise(rr => setTimeout(rr, 400));
      try { await _ensureWorker(); } catch { /* ignore */ }
    }
  }
  _setEmbedError("exhausted", lastErr || "unknown");
  return null;
}
