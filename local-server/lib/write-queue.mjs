// Async write queue: never blocks the SSE socket.
// Two lanes so chat persistence never starves behind logs.
// CRITICAL lane: chat_messages, chat_threads, message_feedback — drained first.
// SIDE lane: agent_logs, provider_usage, tool_invocations, observability, …
// Each lane drains independently; side-drain yields to critical between jobs.
//
// Extracted from server.mjs (Block F Tur 1, 2026-05-30). pool + redactString +
// redactDeep injected via initWriteQueue({...}).
import { redactString, redactDeep } from "./redaction.mjs";

const CRITICAL_TABLE_RE = /\binto\s+(chat_messages|chat_threads|message_feedback)\b/i;
// Tables whose writes we redact before they hit disk. Vault stays out of this
// list — its plaintext is already AES-GCM encrypted by encryptSecret() and we
// must not double-mutate the ciphertext.
const REDACT_TABLES_RE = /\binto\s+(agent_logs|chat_messages|tool_invocations|workflow_steps|chain_runs|skill_runs|runs|provider_usage|siem_outbox)\b/i;

export function initWriteQueue({ pool }) {
  if (!pool) throw new Error("initWriteQueue: pool is required");
  const criticalWriteQueue = [];
  const sideWriteQueue = [];
  let drainingCritical = false;
  let drainingSide = false;

  function getWriteQueueDepths() {
    return { critical: criticalWriteQueue.length, side: sideWriteQueue.length };
  }

  function enqueueWrite(sql, params) {
    let safeParams = params;
    try {
      if (Array.isArray(params) && REDACT_TABLES_RE.test(String(sql))) {
        safeParams = params.map((v) => {
          if (v == null) return v;
          if (typeof v === "string") return redactString(v);
          if (typeof v === "object") return redactDeep(v);
          return v;
        });
      }
    } catch { /* never let redaction break a write */ }
    const isCritical = CRITICAL_TABLE_RE.test(String(sql));
    if (isCritical) {
      criticalWriteQueue.push({ sql, params: safeParams });
      if (!drainingCritical) drainCritical();
    } else {
      sideWriteQueue.push({ sql, params: safeParams });
      if (!drainingSide) drainSide();
    }
  }

  async function drainCritical() {
    drainingCritical = true;
    while (criticalWriteQueue.length) {
      const job = criticalWriteQueue.shift();
      try { await pool.query(job.sql, job.params); }
      catch (e) { console.error("[pg async write:critical]", e.message); }
    }
    drainingCritical = false;
  }

  async function drainSide() {
    drainingSide = true;
    while (sideWriteQueue.length) {
      // Always yield to critical lane first — a queued chat insert must win
      // even if side queue is mid-drain.
      if (criticalWriteQueue.length && !drainingCritical) {
        drainCritical();
      }
      const job = sideWriteQueue.shift();
      try { await pool.query(job.sql, job.params); }
      catch (e) { console.error("[pg async write:side]", e.message); }
    }
    drainingSide = false;
  }

  return { enqueueWrite, getWriteQueueDepths };
}
