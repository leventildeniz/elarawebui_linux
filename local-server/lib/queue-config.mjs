// queue-config.mjs — MLX kuyruğunda kullanılan öncelik + süre sabitleri.
// Tek mercii: agent (düşük), chat default, chat execution (yüksek).
// server.mjs ve agent-bridge.mjs aynı sabitleri okur; magic-number yok.

export const QUEUE_PRIORITY = {
  AGENT_LOW: -1,       // Agent: uzun iş, chat'in arkasına düş
  CHAT_DEFAULT: 1,     // Normal sorgu/RAG turu
  CHAT_EXECUTION: 10,  // Tool/skill/agent execution lane → öne geç
};

export const QUEUE_TIMEOUTS = {
  AGENT_MAX_WAIT_MS: 120_000,     // Kuyrukta bekleme tavanı (2 dk)
  AGENT_EXEC_TIMEOUT_MS: 300_000, // İşlem süresi tavanı (5 dk) — env override edilebilir
  CHAT_MAX_WAIT_MS: 60_000,
};

// 2026-05-29 — UNIFIED TIMEOUT BUDGETS (config-driven, no magic literals).
// Hot-path tüm timeout'lar buradan beslenir. UI canlı override için
// RAG_SETTINGS.{httpSocketTimeoutMs,mlxStreamTotalMs,localQueueWaitMs} kullanır;
// boş → bu env+default. assertTimeoutHierarchy() boot'ta sıralama doğrular.
//
// HIYERARŞİ (yukarıdan aşağı, BOZULURSA BrokenPipe garantili):
//   HTTP_REQUEST_MS ≥ HTTP_HEADERS_MS ≥ HTTP_SOCKET_MS  >  MLX_STREAM_TOTAL_MS  >  MLX_QUEUE_WAIT_MS
//
//   - HTTP_SOCKET_MS:    Node socket idle timeout (üst kapak). Bunun altında MLX bitmeli.
//   - HTTP_HEADERS_MS:   Header bekleme. Stream başlığını alır.
//   - HTTP_REQUEST_MS:   Tüm istek için üst sınır.
//   - HTTP_KEEPALIVE_MS: Idle keep-alive.
//   - MLX_STREAM_TOTAL_MS: streamFromLocalLLM total stream bütçesi.
//   - MLX_QUEUE_WAIT_MS:   chat-lane kuyrukta bekleme tavanı (queue → stream'e geçiş).
// 2026-06-26 — Small-model rebaseline. Önceki 180s+ bütçeler 72B model günü
// için pranga taktıydı; Gemma4-31B-q6 (M5 Max/128GB) için varsayılanlar
// kısaltıldı. RAG paneli (System Engine → Runtime Safety) bunları canlı
// override edebilir. Hiyerarşi assertTimeoutHierarchy() ile doğrulanır.
export const TIMEOUT_BUDGETS = {
  HTTP_SOCKET_MS:      Math.max(10_000, Number(process.env.HTTP_SOCKET_TIMEOUT_MS    ||  75_000)),
  HTTP_HEADERS_MS:     Math.max(10_000, Number(process.env.HTTP_HEADERS_TIMEOUT_MS   ||  80_000)),
  HTTP_KEEPALIVE_MS:   Math.max(1_000,  Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS ||  30_000)),
  HTTP_REQUEST_MS:     Math.max(10_000, Number(process.env.HTTP_REQUEST_TIMEOUT_MS   ||  90_000)),
  MLX_STREAM_TOTAL_MS: Math.max(10_000, Number(process.env.MLX_STREAM_TOTAL_MS       ||  60_000)),
  MLX_QUEUE_WAIT_MS:   Math.max(1_000,  Number(process.env.MLX_QUEUE_MAX_WAIT_MS     ||  30_000)),
};

// 2026-06-26 — Agent slot priority override (UI: Runtime Safety).
// null  → agent enqueue uses QUEUE_PRIORITY.AGENT_LOW (chat geçer önce).
// false → agent paylaşıyor chat lane (CHAT_DEFAULT). Default OFF override
// (null) — 72B günü davranışı korunsun, UI ile kapatılabilsin.
let _agentPriorityOverride = null;
export function setAgentPriorityOverride(v) {
  if (v == null) { _agentPriorityOverride = null; return; }
  const n = Number(v);
  _agentPriorityOverride = Number.isFinite(n) ? n : null;
}
export function getAgentPriority() {
  return _agentPriorityOverride == null ? QUEUE_PRIORITY.AGENT_LOW : _agentPriorityOverride;
}

export function assertTimeoutHierarchy(extra = {}) {
  // Effective değerler: RAG_SETTINGS override > TIMEOUT_BUDGETS default.
  const t = {
    HTTP_SOCKET_MS:      Number(extra.httpSocketTimeoutMs)  || TIMEOUT_BUDGETS.HTTP_SOCKET_MS,
    HTTP_HEADERS_MS:     TIMEOUT_BUDGETS.HTTP_HEADERS_MS,
    HTTP_REQUEST_MS:     TIMEOUT_BUDGETS.HTTP_REQUEST_MS,
    MLX_STREAM_TOTAL_MS: Number(extra.mlxStreamTotalMs)     || TIMEOUT_BUDGETS.MLX_STREAM_TOTAL_MS,
    MLX_QUEUE_WAIT_MS:   Number(extra.localQueueWaitMs)       || TIMEOUT_BUDGETS.MLX_QUEUE_WAIT_MS,
  };
  const ok =
    t.HTTP_REQUEST_MS    >= t.HTTP_HEADERS_MS &&
    t.HTTP_HEADERS_MS    >= t.HTTP_SOCKET_MS &&
    t.HTTP_SOCKET_MS     >  t.MLX_STREAM_TOTAL_MS &&
    t.MLX_STREAM_TOTAL_MS > t.MLX_QUEUE_WAIT_MS;
  if (!ok) {
    console.warn("[timeout.hierarchy] BOZUK — beklenen REQ≥HEADERS≥SOCKET>STREAM>QUEUE:", t);
  } else {
    console.log("[timeout.hierarchy] OK:", t);
  }
  return { ok, effective: t };
}
