// local-server/lib/system-utils.mjs

/**
 * ELARA Sovereign AI OS - System Utilities
 * 
 * Agnostic helpers for tracing, math, and general system constants.
 * Ported and simplified from original_server.mjs.
 */

// --- System Constants ---

export const TIMEOUT_BUDGETS = {
  HTTP_SOCKET_MS: 30000,
  HTTP_REQUEST_MS: 60000,
  HTTP_HEADERS_MS: 10000,
  HTTP_KEEPALIVE_MS: 5000,
};

// --- Tracing & Logging ---

const CHAT_TRACE_RING = [];
const CHAT_TRACE_MAX = 500;

/**
 * Generic tracing for chat flows.
 * Logs to a ring buffer and the console.
 */
export function chatTrace(traceId, stage, detail = {}, level = "info") {
  const id = String(traceId || "trace-missing");
  const evt = { traceId: id, stage: String(stage || "unknown"), detail, level, ts: Date.now() };
  
  CHAT_TRACE_RING.push(evt);
  if (CHAT_TRACE_RING.length > CHAT_TRACE_MAX) {
    CHAT_TRACE_RING.shift();
  }
  
  console.log(`[chat-trace][${id}] ${evt.stage} ${JSON.stringify(detail || {})}`);
  return evt;
}

export function chatTraceList(traceId = null) {
  const id = traceId ? String(traceId) : null;
  return id ? CHAT_TRACE_RING.filter((e) => e.traceId === id) : CHAT_TRACE_RING.slice(-100);
}

// --- Math Helpers ---

/**
 * Vector cosine similarity.
 */
export function cosine(a, b) {
  if (!a || !b) return 0;
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { 
    dot += a[i] * b[i]; 
    na += a[i] * a[i]; 
    nb += b[i] * b[i]; 
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// --- Agnostic Stubs ---
// These are provided to prevent TypeErrors in routes that might still reference them,
// but their complex original implementations (vendor-specific) are skipped.

export function _brandDisplay(brand) {
  return brand ? String(brand) : "Unknown Brand";
}

export function detectLibraryMatch(query, libraries = []) {
  // Default agnostic behavior: no specific match
  return null;
}

export function buildFreeAnswerMessages(messages) {
  // Return original messages as-is
  return messages || [];
}

export function _makeThinkStripper() {
  // Simple stripper that does nothing
  return (text) => text.replace(/<think>.*?<\/think>/gs, "").trim();
}

export function classifyIntent(text) {
  // Default agnostic intent: general query
  return { intent: "general", confidence: 0.5, reason: "default-agnostic-classifier" };
}
