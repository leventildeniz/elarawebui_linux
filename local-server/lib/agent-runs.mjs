export const AGENT_RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS || 60_000);

export async function recordAgentRunFinish(pool, info) {
  try {
    const status = info.cancelled ? "cancelled" : (info.ok ? "ok" : "error");
    await pool.query(
      `INSERT INTO agent_run_history
         (run_id, agent_id, script, source, status, exit_code, signal,
          started_at, duration_ms, stdout_tail, stderr_tail, rag_meta, inference, username)
       VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8/1000.0), $9, $10, $11, $12::jsonb, $13::jsonb, $14)
       ON CONFLICT (run_id) DO NOTHING`,
      [
        info.runId, info.agentId || null, info.script || null, info.source || "spawn",
        status, info.code ?? null, info.signal ?? null,
        info.startedAt, info.durationMs ?? null,
        String(info.stdout || "").slice(-1200),
        String(info.stderr || "").slice(-1200),
        info.ragMeta ? JSON.stringify(info.ragMeta) : null,
        info.inference ? JSON.stringify(info.inference) : null,
        info.username || null,
      ],
    );
  } catch (e) {
    console.warn("[agent_run_history insert]", e?.message || e);
  }
}

import { spawn } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import {
  sanitizeQueryArg,
  getAllowedAgents,
  getAgentsBaseDir,
} from "./agent-bridge.mjs";
import { localQueue as runtimeQueue } from "./runtime-queue.mjs";
import { QUEUE_PRIORITY, QUEUE_TIMEOUTS, getAgentPriority } from "./queue-config.mjs";

const MAX_STDOUT = 8 * 1024 * 1024;
const MAX_STDERR = 2 * 1024 * 1024;

/** @type {Map<string, RunEntry>} */
const runs = new Map();
  
/**
 * @typedef {Object} RunEntry
 * @property {string} runId
 * @property {string} agentId
 * @property {string} script
 * @property {number} pid
 * @property {number} startedAt
 * @property {import('node:child_process').ChildProcess|null} child
 * @property {number} stopGraceMs
 * @property {boolean} cancelRequested
 * @property {string|null} _slotId  runtimeQueue slot id (for pre-spawn cancel)
 * @property {Promise<{ ok:boolean, code:number|null, signal:NodeJS.Signals|null, stdout:string, stderr:string, cancelled:boolean, durationMs:number }>} done
 * /
 */

function _capAppend(buf, chunk, max) {
  const combined = buf + chunk;
  if (combined.length <= max) return combined;
  return combined.slice(combined.length - max);
}

/**
 * Spawn a Python agent and register the live run.
 * Returns { runId, child, done } — caller awaits `done` for HTTP response;
 * mid-flight cancel goes through cancelAgentRun(runId).
 *
 * @param {object} opts
 * @param {string} opts.agentId    Logical agent id (DB row id)
 * @param {string} opts.script     Whitelisted script filename (e.g. "researcher.py")
 * @param {string} opts.query      User query passed as argv[1]
 * @param {object} [opts.env]      Extra env vars merged into child
 * @param {number} [opts.stopGraceMs] SIGTERM → SIGKILL grace (default 5000)
 * @param {string} [opts.python]   Interpreter binary (default env or python3)
 * @returns {RunEntry}
 */
export function spawnAgentRun(opts) {
  const baseDir = getAgentsBaseDir();
  if (!baseDir) throw Object.assign(new Error("agent.empty_dir: no agents base dir"), { code: "ENOENT" });

  const allowed = getAllowedAgents();
  const scriptBase = path.basename(opts.script);
  if (allowed.length && !allowed.includes(opts.script) && !allowed.includes(scriptBase)) {
    throw new Error(`agent.denied: ${opts.script} not in allow-list`);
  }

  const baseAbs = path.resolve(baseDir);
  const baseLeaf = path.basename(baseAbs);
  let scriptRel = String(opts.script || "");
  const firstSeg = scriptRel.split(/[/\\]/)[0];
  if (firstSeg && firstSeg === baseLeaf && /[\/\\]/.test(scriptRel)) {
    scriptRel = scriptRel.slice(firstSeg.length + 1);
  }
  const abs = path.resolve(baseAbs, scriptRel);
  if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) {
    throw new Error(`agent.path_escape: ${opts.script}`);
  }

  const safeQuery = sanitizeQueryArg(opts.query);
  const childEnv = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
    LANG: process.env.LANG || "tr_TR.UTF-8",
    LC_ALL: process.env.LC_ALL || "tr_TR.UTF-8",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    HOME: process.env.HOME || "",
    ...(opts.env || {}),
  };

  const python = opts.python || process.env.ELARA_AGENTS_PYTHON || "python3";
  const stopGraceMs = Math.max(0, Math.min(600_000, Number(opts.stopGraceMs ?? 5000)));
  const timeoutMs = Math.max(30_000, Math.min(300_000, Number(opts.timeoutMs || process.env.ELARA_AGENTS_TIMEOUT_MS || QUEUE_TIMEOUTS.AGENT_EXEC_TIMEOUT_MS)));

  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";

  /** @type {RunEntry} */
  const entry = {
    runId,
    agentId: String(opts.agentId || ""),
    script: opts.script,
    pid: -1,
    startedAt,
    child: null,
    stopGraceMs,
    cancelRequested: false,
    _slotId: null,
    done: /** @type {any} */ (null),
  };

  // ---- Sovereign fix: hold runtime queue slot from spawn() until child exit ---------
  console.error(`[agent-spawn] enqueue agentId=${entry.agentId} script=${scriptBase} stopGrace=${stopGraceMs} timeoutMs=${timeoutMs} runId=${runId.slice(0, 8)}`);
  const t0 = Date.now();
  const slotHandle = runtimeQueue.enqueue(
    ({ signal }) => new Promise((resolve, reject) => {
      if (signal.aborted) {
        resolve({ code: null, sig: /** @type {any} */ ("SIGKILL"), spawnFailed: true });
        return;
      }
      let child;
      try {
        child = spawn(python, [abs, safeQuery], { cwd: baseAbs, env: childEnv, windowsHide: true });
      } catch (err) {
        reject(err);
        return;
      }
      entry.child = child;
      entry.pid = child.pid ?? -1;
      console.error(`[agent-spawn] running pid=${entry.pid} runId=${runId.slice(0, 8)} script=${scriptBase}`);
      try { opts.onStart?.({ runId, pid: entry.pid, script: scriptBase }); } catch { /* listener must not break run */ }

      child.stdout?.setEncoding("utf-8");
      child.stderr?.setEncoding("utf-8");
      child.stdout?.on("data", (c) => {
        const s = String(c);
        stdout = _capAppend(stdout, s, MAX_STDOUT);
        try { opts.onStdout?.(s); } catch { /* listener must not break run */ }
      });
      child.stderr?.on("data", (c) => {
        const s = String(c);
        stderr = _capAppend(stderr, s, MAX_STDERR);
        // Debug tap — Python stderr'i ham olarak terminale yansıt; KNOWN_PREFIX
        // filter'ı atlanır. Multi-line traceback bütün gelir.
        try { process.stderr.write(`[agent-stderr-raw runId=${runId.slice(0, 8)} script=${scriptBase}] ${s.endsWith("\n") ? s : s + "\n"}`); } catch { /* */ }
        try { opts.onStderr?.(s); } catch { /* listener must not break run */ }
      });

      let killedByTimeout = false;
      const tHard = setTimeout(() => {
        killedByTimeout = true;
        try { child.kill("SIGKILL"); } catch { /* noop */ }
      }, timeoutMs);
      const onAbort = () => { try { child.kill("SIGKILL"); } catch { /* noop */ } };
      signal.addEventListener("abort", onAbort, { once: true });


      child.on("exit", (code, sig) => {
        clearTimeout(tHard);
        try { signal.removeEventListener("abort", onAbort); } catch { /* noop */ }
        resolve({ code, sig: killedByTimeout ? "SIGKILL" : sig });
      });
      child.on("error", (err) => {
        clearTimeout(tHard);
        try { signal.removeEventListener("abort", onAbort); } catch { /* noop */ }
        reject(err);
      });
    }),
    {
      label: `agent:${scriptBase}`,
      priority: getAgentPriority(),
      maxWaitMs: QUEUE_TIMEOUTS.AGENT_MAX_WAIT_MS,
    },
  );
  entry._slotId = slotHandle.id;

  entry.done = slotHandle.promise.then(
    ({ code, sig }) => {
      const cancelled = !!entry.cancelRequested;
      runs.delete(runId);
      console.error(`[agent-spawn] done runId=${runId.slice(0, 8)} code=${code} signal=${sig || "-"} stdoutBytes=${stdout.length} stderrBytes=${stderr.length} elapsedMs=${Date.now() - t0}`);
      const result = {
        ok: code === 0 && !cancelled,
        code,
        signal: sig,
        stdout,
        stderr,
        cancelled,
        durationMs: Date.now() - startedAt,
      };
      try { opts.onFinish?.({ runId, agentId: entry.agentId, script: scriptBase, startedAt, source: "spawn", ...result }); } catch { /* never break done */ }
      return result;
    },
    (err) => {
      const cancelled = !!entry.cancelRequested;
      runs.delete(runId);
      console.error(`[agent-spawn] error runId=${runId.slice(0, 8)} reason=${err?.message || err} elapsedMs=${Date.now() - t0}`);
      const result = {
        ok: false,
        code: -1,
        signal: null,
        stdout,
        stderr: stderr + `\n[queue] ${err?.message || err}\n`,
        cancelled,
        durationMs: Date.now() - startedAt,
      };
      try { opts.onFinish?.({ runId, agentId: entry.agentId, script: scriptBase, startedAt, source: "spawn", ...result }); } catch { /* never break done */ }
      return result;
    },
  );


  runs.set(runId, entry);
  return entry;
}

/**
 * Request a graceful stop on a live run. SIGTERM first; if the child is still
 * alive after `graceMs`, escalate to SIGKILL. Returns a snapshot of what was
 * attempted; the actual exit resolves through the entry's `done` promise.
 *
 * P1 fix (2026-05-28): if the run is still queued (child not spawned yet),
 * cancel via localQueue so the slot is released and `done` rejects cleanly.
 *
 * @param {string} runId
 * @param {number} [graceMs] Override per-call grace; defaults to entry.stopGraceMs
 */
export function cancelAgentRun(runId, graceMs) {
  const entry = runs.get(runId);
  if (!entry) return { ok: false, reason: "not_found" };
  if (entry.cancelRequested) return { ok: true, reason: "already_cancelling", pid: entry.pid };
  entry.cancelRequested = true;

  // Pre-spawn window: child not started yet — cancel the queue slot instead.
  if (!entry.child) {
    if (entry._slotId) runtimeQueue.cancel(entry._slotId, "user_cancel");
    return { ok: true, reason: "queued_cancel", pid: -1 };
  }

  const grace = Math.max(0, Math.min(600_000, Number(graceMs ?? entry.stopGraceMs)));
  try { entry.child.kill("SIGTERM"); } catch { /* ignore */ }
  if (grace > 0) {
    setTimeout(() => {
      try {
        if (entry.child && !entry.child.killed && runs.has(runId)) entry.child.kill("SIGKILL");
      } catch { /* ignore */ }
    }, grace).unref?.();
  } else {
    try { entry.child.kill("SIGKILL"); } catch { /* ignore */ }
  }
  return { ok: true, reason: "signal_sent", pid: entry.pid, graceMs: grace };
}

/**
 * Cancel every live run for an agent (e.g. on delete or disarm).
 */
export function cancelAllRunsForAgent(agentId, graceMs) {
  const hits = [];
  for (const entry of runs.values()) {
    if (entry.agentId === agentId) hits.push(cancelAgentRun(entry.runId, graceMs));
  }
  return hits;
}

/**
 * Snapshot of every live run — used by /api/agents/runs.
 */
export function listAgentRuns() {
  const now = Date.now();
  const out = [];
  for (const e of runs.values()) {
    out.push({
      runId: e.runId,
      agentId: e.agentId,
      script: e.script,
      pid: e.pid,
      startedAt: e.startedAt,
      ageMs: now - e.startedAt,
      cancelRequested: e.cancelRequested,
      stopGraceMs: e.stopGraceMs,
    });
  }
  out.sort((a, b) => a.startedAt - b.startedAt);
  return out;
}

/**
 * Map<agentId, count> — fast lookup for UI to know which agents are live.
 */
export function liveCountsByAgent() {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const e of runs.values()) counts[e.agentId] = (counts[e.agentId] || 0) + 1;
  return counts;
}

export function getRun(runId) { return runs.get(runId) || null; }

/**
 * Register an externally-managed run (e.g. agent-bridge `runLocalAgent`
 * which uses blocking `execFile`). Returns `{ runId, finish() }`. Caller
 * MUST invoke finish() in a try/finally so the entry is cleared.
 *
 * Purpose: chat-triggered agent runs (bridge path) were invisible to
 * `/api/agents/runs` because that registry only knows about `spawnAgentRun`.
 * Adding a lightweight synthetic entry surfaces them in run-history UI
 * without rewriting the bridge's synchronous contract.
 */
export function registerSyntheticRun({ agentId, script, source = "bridge" }) {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  /** @type {RunEntry} */
  const entry = {
    runId,
    agentId: String(agentId || ""),
    script: String(script || ""),
    pid: -1,
    startedAt,
    child: /** @type {any} */ ({ kill() {}, killed: true }),
    stopGraceMs: 0,
    cancelRequested: false,
    _slotId: null,
    done: Promise.resolve({ ok: true, code: 0, signal: null, stdout: "", stderr: "", cancelled: false, durationMs: 0 }),
    synthetic: true,
    source,
  };
  runs.set(runId, entry);
  return {
    runId,
    finish() { runs.delete(runId); },
  };
}
