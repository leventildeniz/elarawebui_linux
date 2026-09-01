// local-server/lib/embed-provider.mjs
// Agnostic Embedding Provider
// Handles communication with the Embedding Worker (Python) with robust lazy-spawn and error tracking.

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
  const base = (process.env.EMBED_BASE_URL || `http://${_EMBED_WORKER_HOST}:${_EMBED_WORKER_PORT}`).replace(/\/$/, "");
  const model = process.env.EMBED_MODEL || process.env.DEFAULT_EMBED_MODEL || 'BAAI/bge-m3';
  
  if (!model) { 
    _setEmbedError("no_model", "EMBED_MODEL unset"); 
    return null; 
  }

  const callerTimeout = Math.max(1, Number(opts.timeoutMs) || 0);
  const workerStatus = _getWorkerStatus();

  // Lazy-spawn: If worker is not online, try to start it
  if (base.includes(`:${_EMBED_WORKER_PORT}`) && workerStatus !== "online-auto" && workerStatus !== "online-external") {
    _kickWorkerStart("lazy-spawn");
    const longBootWait = Number(process.env.EMBED_FOREGROUND_BOOT_WAIT_MS || 5000);
    
    if (callerTimeout >= longBootWait) {
      try {
        await Promise.race([
          _ensureWorker(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`worker_boot_timeout_${callerTimeout}ms`)), callerTimeout)),
        ]);
      } catch (e) {
        _pushLog("worker", `[lazy-spawn-error] ${e?.message || e}`);
        _setEmbedError("worker_not_ready", `status=${_getWorkerStatus()} (${e?.message || e})`);
        return null;
      }
    } else {
      const pollBudget = Math.max(0, Math.min(callerTimeout - 200, 1200));
      const deadline = Date.now() + pollBudget;
      while (Date.now() < deadline) {
        const st = _getWorkerStatus();
        if (st === "online-auto" || st === "online-external") break;
        await new Promise(r => setTimeout(r, 50));
      }
      const st = _getWorkerStatus();
      if (st !== "online-auto" && st !== "online-external") {
        _setEmbedError("worker_not_ready", `status=${st} (waited ${pollBudget}ms, budget ${callerTimeout}ms)`);
        return null;
      }
    }
  }

  const timeoutMs = opts.timeoutMs ? Math.max(1000, Number(opts.timeoutMs) || 1000) : 120000;
  const maxAttempts = Math.max(1, Number(opts.attempts) || 2);
  const externalSignal = opts.signal && typeof opts.signal === "object" ? opts.signal : null;
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
      
      if (externalSignal?.aborted) { _setEmbedError("aborted", "caller aborted mid-fetch"); return null; }
      if (attempt === maxAttempts) { _setEmbedError("fetch_failed", lastErr); return null; }
      
      await new Promise(rr => setTimeout(rr, 600));
      try { await _ensureWorker(); } catch { /* ignore */ }
    }
  }
  _setEmbedError("exhausted", lastErr || "unknown");
  return null;
}
