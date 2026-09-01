// Skills Engine runtime helpers — extracted from server.mjs (Tur S-2, 2026-05-30)
// Deps injected via initSkillsRuntime({ pool, sseWrite, runDiskScript, secretsPath })
import fs from "node:fs";

// In-memory live run registry: id -> { steps[], metrics[], clients:Set, status, output, cancel:bool }
export const liveRuns = new Map();

export const ROLE_LEVEL = { Viewer: 0, Security: 0, Operator: 1, Editor: 1, Admin: 2 };
export const RISK_LEVEL = { read: 0, write: 1, critical: 2 };

let _pool = null;
let _sseWrite = null;
let _runDiskScript = null;
let _secretsPath = null;

export function initSkillsRuntime({ pool, sseWrite, runDiskScript, secretsPath }) {
  if (!pool || !sseWrite || !runDiskScript || !secretsPath) {
    throw new Error("[skills/runtime] initSkillsRuntime requires { pool, sseWrite, runDiskScript, secretsPath }");
  }
  _pool = pool;
  _sseWrite = sseWrite;
  _runDiskScript = runDiskScript;
  _secretsPath = secretsPath;
}

export function runEvent(runId, evt) {
  const r = liveRuns.get(runId);
  if (!r) return;
  const line = `data: ${JSON.stringify(evt)}\n\n`;
  for (const c of r.clients) _sseWrite(c, line);
}

export function validateAgainstSchema(schema, params) {
  // Lightweight JSON-Schema subset: type/required/properties/pattern/min/max/default
  const out = {}; const errors = [];
  if (!schema || typeof schema !== "object") return { ok: true, value: params || {}, errors };
  const props = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const k of Object.keys(props)) {
    const def = props[k];
    let v = params?.[k];
    if (v === undefined && def.default !== undefined) v = def.default;
    if (v === undefined) {
      if (required.includes(k)) errors.push(`missing required param: ${k}`);
      continue;
    }
    if (def.type === "number") {
      const n = Number(v);
      if (Number.isNaN(n)) { errors.push(`${k}: not a number`); continue; }
      if (def.minimum !== undefined && n < def.minimum) errors.push(`${k}: < ${def.minimum}`);
      if (def.maximum !== undefined && n > def.maximum) errors.push(`${k}: > ${def.maximum}`);
      v = n;
    } else if (def.type === "string") {
      v = String(v);
      if (def.pattern) {
        try { if (!new RegExp(def.pattern).test(v)) errors.push(`${k}: pattern mismatch`); }
        catch { errors.push(`${k}: invalid pattern in schema`); }
      }
    }
    out[k] = v;
  }
  return { ok: errors.length === 0, value: out, errors };
}

export async function getActorRole(actorUsername) {
  if (!actorUsername) return "Viewer";
  try {
    const { rows } = await _pool.query("SELECT role FROM app_users WHERE lower(username)=lower($1) LIMIT 1", [actorUsername]);
    return rows[0]?.role || "Viewer";
  } catch { return "Viewer"; }
}

// ---------------------------------------------------------------------------
// Per-skill optional API keys: stored at local-server/.env.secrets as KEY=value
// lines (chmod 600 on first write). Only the envVars declared on the skill are
// exposed to that skill's sandbox — whitelist enforced at injection time.
// ---------------------------------------------------------------------------
export function readSkillSecrets() {
  try {
    const raw = fs.readFileSync(_secretsPath, "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
    return out;
  } catch { return {}; }
}

export function writeSkillSecrets(map) {
  const lines = Object.entries(map)
    .filter(([k, v]) => /^[A-Z_][A-Z0-9_]*$/.test(k) && typeof v === "string" && v.length)
    .map(([k, v]) => `${k}=${v.replace(/\n/g, "")}`);
  const body = lines.join("\n") + (lines.length ? "\n" : "");
  fs.writeFileSync(_secretsPath, body, { mode: 0o600 });
}

export function getSkillEnv(skill) {
  const decl = Array.isArray(skill?.optional_api_keys) ? skill.optional_api_keys
             : (typeof skill?.optional_api_keys === "string" ? JSON.parse(skill.optional_api_keys || "[]") : []);
  if (!decl.length) return { env: {}, decl: [] };
  const store = readSkillSecrets();
  const env = {};
  for (const d of decl) {
    const k = d?.envVar;
    if (!k || !/^[A-Z_][A-Z0-9_]*$/.test(k)) continue;
    if (store[k]) env[k] = store[k];
  }
  return { env, decl };
}

export async function executeSkillScript(skill, params, runId, mode = "run") {
  // Tur-7 — disk-bound python skill: script_path on disk, no inline body.
  // Rollback for python is out of scope this round; rollback_body still applies
  // only to script_kind='js'.
  if (skill.script_kind === "python" && mode === "run") {
    const script = String(skill.script_path || "").trim();
    if (!script) return { ok: true, value: { noop: true, reason: "no script_path" } };
    const { env } = getSkillEnv(skill);
    try {
      const { stdout, stderr } = await _runDiskScript({
        script,
        query: typeof params === "object" ? JSON.stringify(params) : String(params ?? ""),
        env,
      });
      runEvent(runId, { type: "log", message: String(stdout || "").slice(0, 16384) });
      if (stderr) runEvent(runId, { type: "log", message: `stderr: ${String(stderr).slice(0, 4096)}` });
      return { ok: true, value: { stdout: String(stdout || ""), stderr: String(stderr || "") } };
    } catch (e) {
      throw e;
    }
  }
  const body = mode === "rollback" ? (skill.rollback_body || "") : skill.script_body;
  if (!body.trim()) return { ok: true, value: { noop: true } };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const step = (label, i, total) => {
    const s = { i, total, label, ts: Date.now(), status: "ok" };
    const r = liveRuns.get(runId);
    if (r) {
      if (mode === "run") r.steps.push(s); else r.rollback_steps.push(s);
    }
    runEvent(runId, { type: mode === "rollback" ? "rollback_step" : "step", step: s });
  };
  const log = (...a) => runEvent(runId, { type: "log", message: a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ") });
  const { env } = getSkillEnv(skill);
  // eslint-disable-next-line no-new-func
  const fn = new Function("params", "pool", "step", "sleep", "fetch", "log", "env",
    `return (async () => { ${body} })();`);
  const value = await fn(params, _pool, step, sleep, globalThis.fetch.bind(globalThis), log, Object.freeze({ ...env }));
  return { ok: true, value };
}

export function startMetricsLoop(runId) {
  const r = liveRuns.get(runId); if (!r) return;
  let prev = process.cpuUsage();
  r.metricsTimer = setInterval(() => {
    const cur = process.cpuUsage(prev); prev = process.cpuUsage();
    const elapsedUs = (cur.user + cur.system);
    const cpuPct = Math.min(100, Math.round((elapsedUs / 1000 / 1000) * 100)); // rough
    const mem = process.memoryUsage();
    const ramMb = Math.round(mem.rss / 1024 / 1024);
    const pt = { ts: Date.now(), cpu: cpuPct, ram_mb: ramMb };
    r.metrics.push(pt);
    if (r.metrics.length > 240) r.metrics.shift();
    runEvent(runId, { type: "metric", metric: pt });
  }, 1000);
}

export function stopMetricsLoop(runId) {
  const r = liveRuns.get(runId); if (!r) return;
  if (r.metricsTimer) { clearInterval(r.metricsTimer); r.metricsTimer = null; }
}
