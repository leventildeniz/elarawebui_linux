// =============================================================================
// tool-call-parser.mjs — TUR-6 Phase C
// =============================================================================
// Scans agent stdout for `!<slug>({json...})` invocations, dispatches them
// through the loopback `/api/agents/tool-call` endpoint (so manifest gate +
// policy + audit ledger all kick in), and emits SSE `tool_call` events so
// the chat UI can render an inline Tool block.
//
// Why post-stream and not mid-stream: agent runs are stdout-batched
// (runLocalAgent awaits subprocess exit). True mid-stream parsing belongs
// to a future incremental-stdout transport; for now we parse `clean` once
// and execute serially. Each call is gated by the same loopback +
// manifest checks an agent's own `dispatch.py` would hit.
//
// Activated only when RAG_SETTINGS.streamToolParse !== false (default on).
// Smalltalk lane callers must NOT invoke this helper.
// =============================================================================

import path from "node:path";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const TOOL_CALL_OPEN = /!([a-zA-Z0-9_-]{2,64})\s*\(/g;

/**
 * Brace-balanced extraction of `!slug({...})` invocations.
 * Skips strings & escapes so JSON braces inside string values don't trip us.
 * Returns [{ slug, raw, input, start, end }] in order of appearance.
 */
export function extractToolCalls(text) {
  const out = [];
  if (!text || typeof text !== "string") return out;
  TOOL_CALL_OPEN.lastIndex = 0;
  let m;
  while ((m = TOOL_CALL_OPEN.exec(text)) !== null) {
    const slug = m[1].toLowerCase();
    if (!SLUG_RE.test(slug)) continue;
    const start = m.index;
    let i = TOOL_CALL_OPEN.lastIndex;
    // Skip whitespace before '{'
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== "{") continue;
    // Brace balance with string awareness
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === "\\") { esc = true; continue; }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { j++; break; } }
    }
    if (depth !== 0) continue;
    const jsonStr = text.slice(i, j);
    // Skip optional trailing ')'
    let end = j;
    while (end < text.length && /\s/.test(text[end])) end++;
    if (text[end] === ")") end++;
    let input;
    try { input = JSON.parse(jsonStr); }
    catch { continue; }
    if (input === null || typeof input !== "object" || Array.isArray(input)) continue;
    out.push({ slug, input, raw: text.slice(start, end), start, end });
    TOOL_CALL_OPEN.lastIndex = end;
  }
  return out;
}

function deriveAgentId(scriptPath) {
  if (!scriptPath) return "";
  const base = path.basename(String(scriptPath));
  return base.replace(/\.py$/i, "").toLowerCase();
}

/**
 * Execute parsed tool calls against the loopback dispatch endpoint, emitting
 * SSE `tool_call` events (`phase: "start"` then `phase: "result"`).
 *
 * @param {object} args
 * @param {string} args.scriptPath  - agent script (full or relative); stem used as X-Agent-Id
 * @param {Array}  args.calls       - extractToolCalls() output
 * @param {number} args.port        - middleware port
 * @param {function} args.send      - SSE writer (json -> void)
 * @param {function} [args.trace]   - optional trace(kind, fields, level?) -> void
 * @param {number} [args.timeoutMs] - per-call timeout (default 30000)
 */
export async function runToolCallsForAgent({
  scriptPath, calls, port, send, trace = null, timeoutMs = 30000,
}) {
  if (!Array.isArray(calls) || calls.length === 0) return { executed: 0 };
  const agentId = deriveAgentId(scriptPath);
  if (!agentId) {
    trace?.("tool_call.skipped", { reason: "no_agent_id" }, "warn");
    return { executed: 0 };
  }
  const base = `http://127.0.0.1:${port}`;
  let executed = 0;
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const id = `tc_${Date.now().toString(36)}_${i}`;
    send({ type: "tool_call", tcPhase: "start", id, slug: call.slug, input: call.input, agentId });
    trace?.("tool_call.start", { id, slug: call.slug, agentId });
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let body, status, ok;
    try {
      const r = await fetch(`${base}/api/agents/tool-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Agent-Id": agentId },
        body: JSON.stringify({ tool: call.slug, input: call.input }),
        signal: ctrl.signal,
      });
      status = r.status;
      try { body = await r.json(); } catch { body = { ok: false, error: `non-json (${status})` }; }
      ok = r.ok && body?.ok !== false;
    } catch (e) {
      status = 0;
      body = { ok: false, error: e?.name === "AbortError" ? "timeout" : String(e?.message || e) };
      ok = false;
    } finally {
      clearTimeout(timer);
    }
    const ms = Date.now() - t0;
    send({
      type: "tool_call", tcPhase: "result", id, slug: call.slug, agentId,
      status: ok ? "success" : (body?.code || "error"),
      httpStatus: status,
      output: ok ? (body?.output ?? body) : null,
      error: ok ? null : (body?.error || `http ${status}`),
      ms,
    });
    trace?.("tool_call.result", { id, slug: call.slug, ok, httpStatus: status, ms }, ok ? "info" : "warn");
    executed++;
  }
  return { executed };
}

export default { extractToolCalls, runToolCallsForAgent };
