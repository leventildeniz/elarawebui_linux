// Audit SSE broadcast hub + checkpoint logger.
// Extracted from server.mjs (Block F Tur 2, 2026-05-30).
// Deps injected: sseWrite, siem, enqueueWrite. redactDeep imported directly.
import { redactDeep } from "./redaction.mjs";

export function initAuditFeed({ sseWrite, siem, enqueueWrite }) {
  if (!sseWrite || !siem || !enqueueWrite) {
    throw new Error("initAuditFeed: sseWrite, siem, enqueueWrite required");
  }
  const auditClients = new Set();

  function broadcastAudit(evt) {
    // Faz 7 — never push raw secrets into the live audit SSE feed or SIEM forward.
    const safeEvt = redactDeep(evt || {});
    const payload = { ts: Date.now(), agent: "system", level: "info", message: "", ...safeEvt };
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const c of auditClients) {
      sseWrite(c, line);
    }
    // Forward every audit/checkpoint event to the configured SIEM (no-op when disabled).
    try {
      siem.enqueue({
        ts: new Date(payload.ts).toISOString(),
        severity: payload.level || "info",
        name: `${payload.agent}.${payload.message?.split(":")[0] || "event"}`.slice(0, 64),
        message: payload.message || "",
        meta: payload.meta || {},
      });
    } catch { /* never let SIEM errors break audit broadcast */ }
  }

  // Writes a single concise checkpoint to agent_logs (kind=checkpoint) and mirrors
  // it to the audit SSE feed. Use ONLY for high-signal phase transitions
  // (rag.search.start, model.first_token, model.responded, errors). Never call
  // per-token — keep the SSE hot-path silent.
  function logCheckpoint(level, tag, message, meta = null, thread_id = null) {
    const lvl = ["info", "warn", "error", "success", "debug"].includes(level) ? level : "info";
    const fullMeta = meta ? { tag, ...meta } : { tag };
    enqueueWrite(
      `INSERT INTO agent_logs(thread_id, agent, level, message, meta) VALUES ($1,'checkpoint',$2,$3,$4)`,
      [thread_id, lvl, message, fullMeta]
    );
    broadcastAudit({ thread_id, agent: "checkpoint", level: lvl, message, meta: fullMeta });
  }

  return { auditClients, broadcastAudit, logCheckpoint };
}
