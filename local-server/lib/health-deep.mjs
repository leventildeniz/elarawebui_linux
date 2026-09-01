// Faz 9 — deep health aggregator. /health is a fast LB probe; /health/deep
// returns subsystem-by-subsystem status so the operator (and contract tests)
// can answer "what is broken right now?" with one call.
//
// Every probe is bounded: a slow subsystem cannot block the whole report.
// Probes return { ok, info?, error?, ms } and never throw.

const TIMEOUT_MS = Number(process.env.HEALTH_PROBE_TIMEOUT_MS || 1500);

function withTimeout(promise, ms = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

async function probe(name, fn) {
  const t0 = Date.now();
  try {
    const info = await withTimeout(Promise.resolve(fn()));
    return { name, ok: true, info: info ?? null, ms: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, error: String(e?.message || e), ms: Date.now() - t0 };
  }
}

export async function buildDeepHealth({ pool, localQueue, rbiTarget, mlxBase }) {
  const probes = await Promise.all([
    probe("db", async () => {
      const r = await pool.query("SELECT 1 AS up");
      return { up: r.rows[0]?.up === 1 };
    }),
    probe("db_schema", async () => {
      // Confirm core tables exist — if migrate failed silently we catch it here.
      const expected = [
        "app_sessions","app_users","vault_secrets","vault_audit",
        "capabilities","tools","runs","tool_invocations","tool_approvals",
        "chain_runs","workflow_steps","cve_advisories",
      ];
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_name = ANY($1)`,
        [expected]
      );
      const present = new Set(rows.map((r) => r.table_name));
      const missing = expected.filter((t) => !present.has(t));
      if (missing.length) throw new Error(`missing tables: ${missing.join(",")}`);
      return { tables: expected.length };
    }),
    probe("mlx", async () => {
      if (!mlxBase) return { configured: false };
      const r = await fetch(`${mlxBase.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      return { configured: true, status: r.status, ok: r.ok };
    }),
    probe("mlx_queue", async () => {
      if (!localQueue?.stats) return { configured: false };
      return localQueue.stats();
    }),
    probe("rbi", async () => {
      if (!rbiTarget) return { configured: false };
      const r = await fetch(`${rbiTarget}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
      if (!r) return { configured: true, reachable: false };
      return { configured: true, reachable: true, status: r.status };
    }),
    probe("auth", async () => {
      // app_sessions şemasında expires_at YOK; geçerlilik last_seen + SESSION_TTL_MS ile.
      const ttlMs = Number(process.env.SESSION_TTL_MS || 30 * 60 * 1000);
      const r = await pool.query(
        `SELECT COUNT(*)::int AS sessions,
                COUNT(*) FILTER (
                  WHERE last_seen > now() - ($1 || ' milliseconds')::interval
                )::int AS active
           FROM app_sessions`,
        [String(ttlMs)]
      );
      return r.rows[0];
    }),
    probe("cve", async () => {
      const r = await pool.query(
        "SELECT COUNT(*)::int AS total, MAX(first_seen) AS last_seen FROM cve_advisories"
      ).catch(() => ({ rows: [{ total: 0, last_seen: null }] }));
      return r.rows[0];
    }),
    probe("redaction", async () => {
      const { redactString } = await import("./redaction.mjs");
      const sample = "Authorization: Bearer abcdef1234567890ABCDEF";
      const out = redactString(sample);
      if (out === sample) throw new Error("redactor failed to mask bearer");
      return { ok: true };
    }),
    probe("tls_proxy", async () => {
      // Faz 16.3 — dev-tls-proxy stats endpoint loopback'te. Yoksa "configured:false".
      const port = Number(process.env.TLS_PROXY_STATS_PORT || 10444);
      const r = await fetch(`http://127.0.0.1:${port}/stats`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => null);
      if (!r) return { configured: false, reachable: false };
      const j = await r.json().catch(() => null);
      if (!j?.ok) throw new Error("stats payload malformed");
      const upSummary = Object.fromEntries(
        Object.entries(j.upstreams || {}).map(([k, v]) => [k, { req: v.req, err: v.err, last: v.lastStatus, lastMs: v.lastLatencyMs }])
      );
      return { configured: true, reachable: true, uptimeMs: j.uptimeMs, ws: j.ws, upstreams: upSummary };
    }),
  ]);

  const subsystems = Object.fromEntries(probes.map((p) => [p.name, p]));
  const failed = probes.filter((p) => !p.ok).map((p) => p.name);
  return {
    ok: failed.length === 0,
    ts: new Date().toISOString(),
    failed,
    subsystems,
    version: process.env.APP_VERSION || "dev",
  };
}
