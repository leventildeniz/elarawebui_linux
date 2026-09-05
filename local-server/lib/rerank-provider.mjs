// local-server/lib/rerank-provider.mjs
// Agnostic Rerank Provider with Native In-Process ONNX Runtime & Python HTTP Fallback

import { onnxRerank, getOnnxStatus } from "./onnx-pipeline.mjs";

let _pushLog = (..._a) => {};
let _getWorkerStatus = () => "down";
let _kickWorkerStart = () => {};
let _ensureWorker = async () => {};
let _getRagSettings = () => ({});
let _EMBED_WORKER_PORT = Number(process.env.EMBED_WORKER_PORT || 8082);
let _EMBED_WORKER_HOST = "127.0.0.1";

export function initRerankProvider(deps = {}) {
  if (typeof deps.pushLog === "function") _pushLog = deps.pushLog;
  if (typeof deps.getStatus === "function") _getWorkerStatus = deps.getStatus;
  if (typeof deps.kickWorkerStart === "function") _kickWorkerStart = deps.kickWorkerStart;
  if (typeof deps.ensureWorker === "function") _ensureWorker = deps.ensureWorker;
  if (typeof deps.getRagSettings === "function") _getRagSettings = deps.getRagSettings;
  if (Number.isFinite(Number(deps.embedWorkerPort))) _EMBED_WORKER_PORT = Number(deps.embedWorkerPort);
  if (typeof deps.embedWorkerHost === "string" && deps.embedWorkerHost) _EMBED_WORKER_HOST = deps.embedWorkerHost;
}

// ── Rerank error ring ────────────────────────────────────────────────────
let _lastRerankError = null;
let _lastRerankAt = 0;
let _lastRerankMs = 0;

function _setRerankError(kind, detail) {
  _lastRerankError = { kind, detail: String(detail || "").slice(0, 200), at: Date.now() };
  _lastRerankAt = _lastRerankError.at;
}

export function getLastRerankError() {
  if (!_lastRerankError) return null;
  if (Date.now() - _lastRerankAt > 60_000) return null;
  return _lastRerankError;
}

export function getLastRerankMs() { return _lastRerankMs; }
export function getLastRerankAt() { return _lastRerankAt; }

// ── Rerank RPC ───────────────────────────────────────────────────────────
export async function rerank(query, documents, opts = {}) {
  const RAG_SETTINGS = _getRagSettings();
  if (RAG_SETTINGS && RAG_SETTINGS.rerankEnabled === false) { 
    _setRerankError("disabled", "rerankEnabled=false"); 
    return null; 
  }
  
  if (!query || !Array.isArray(documents) || documents.length === 0) return null;

  const preferEngine = process.env.RERANK_ENGINE || process.env.EMBED_ENGINE || "onnx";
  const t0 = Date.now();

  // 1. Primary: Native In-Process ONNX Runtime
  if (preferEngine !== "python") {
    try {
      const scored = await onnxRerank(query, documents, opts);
      if (Array.isArray(scored) && scored.length > 0) {
        _lastRerankError = null;
        _lastRerankMs = Date.now() - t0;
        _lastRerankAt = Date.now();
        return scored;
      }
    } catch (onnxErr) {
      console.warn("[rerank-provider] ONNX in-process rerank failed, falling back to HTTP worker:", onnxErr?.message || onnxErr);
      _setRerankError("onnx_fallback", onnxErr?.message || onnxErr);
    }
  }

  // 2. Fallback: External Python Worker (Port 8082)
  const base = (process.env.EMBED_BASE_URL || `http://${_EMBED_WORKER_HOST}:${_EMBED_WORKER_PORT}`).replace(/\/$/, "");
  
  if (base.includes(`:${_EMBED_WORKER_PORT}`)) {
    let workerStatus = _getWorkerStatus();
    if (workerStatus !== "online-auto" && workerStatus !== "online-external") {
      _kickWorkerStart("rerank-lazy-spawn");
      const waitMs = Math.max(500, Math.min(1500, Number(opts.timeoutMs) || RAG_SETTINGS?.rerankTimeoutMs || 2500));
      try {
        await Promise.race([
          _ensureWorker(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`worker_boot_timeout_${waitMs}ms`)), waitMs)),
        ]);
      } catch { /* fall through to status check */ }
      
      workerStatus = _getWorkerStatus();
      if (workerStatus !== "online-auto" && workerStatus !== "online-external") {
        _setRerankError("worker_not_ready", `status=${workerStatus}`);
        return null;
      }
    }
  }

  const timeoutMs = Math.max(500, Math.min(15000, Number(opts.timeoutMs) || RAG_SETTINGS?.rerankTimeoutMs || 8000));
  const model = process.env.RAG_RERANK_MODEL || "BAAI/bge-reranker-base";

  try {
    const r = await fetch(`${base}/v1/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, query, documents, top_n: opts.topN || null }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      _setRerankError("http_error", `HTTP ${r.status} ${txt.slice(0, 120)}`);
      return null;
    }

    const j = await r.json();
    _lastRerankError = null;
    _lastRerankMs = Date.now() - t0;
    _lastRerankAt = Date.now();
    return Array.isArray(j.data) ? j.data : null;
  } catch (e) {
    const kind = e?.name === "TimeoutError" ? "timeout" : "fetch_error";
    _setRerankError(kind, `${kind === "timeout" ? `${timeoutMs}ms` : (e?.message || e)}`);
    return null;
  }
}
