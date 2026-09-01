// Faz 10 — Retention runner. Eski satırları belirlenmiş pencereye göre siler.
// Yedek alındıktan SONRA çalıştırılır (operator akışı: backup → retention).
//
// Policy default'ları konservatif: agent_logs/runs/vault_audit gibi
// audit'lerde 90 gün, geçici/sistem trafiği için kısa pencere.
// Hepsi env override edilebilir: RETENTION_<TABLE>_DAYS

const DEFAULTS = {
  agent_logs:        90,
  runs:              90,
  tool_invocations:  90,
  vault_audit:      180,
  workflow_steps:    60,
  chain_runs:        60,
  skill_runs:        60,
  provider_usage:    30,
  siem_outbox:       14,
  app_sessions:      30, // expired-only deletion
  cve_advisories:   365,
};

const TIME_COLUMN = {
  agent_logs: "ts",
  runs: "started_at",
  tool_invocations: "started_at",
  vault_audit: "ts",
  workflow_steps: "started_at",
  chain_runs: "started_at",
  skill_runs: "started_at",
  provider_usage: "ts",
  siem_outbox: "created_at",
  app_sessions: "expires_at", // delete WHERE expires_at < now()
  cve_advisories: "first_seen",
};

function daysFor(table) {
  const env = process.env[`RETENTION_${table.toUpperCase()}_DAYS`];
  if (env && Number.isFinite(Number(env))) return Number(env);
  return DEFAULTS[table];
}

export async function runRetention(pool, { dryRun = false } = {}) {
  const results = [];
  for (const table of Object.keys(DEFAULTS)) {
    const days = daysFor(table);
    const col  = TIME_COLUMN[table];
    if (!days || !col) continue;
    try {
      // Sessions: hard-delete already-expired only (don't yank live sessions).
      const where = table === "app_sessions"
        ? `${col} < now()`
        : `${col} < now() - interval '${Number(days)} days'`;
      if (dryRun) {
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`);
        results.push({ table, days, would_delete: rows[0].n });
      } else {
        const r = await pool.query(`DELETE FROM ${table} WHERE ${where}`);
        results.push({ table, days, deleted: r.rowCount });
      }
    } catch (e) {
      results.push({ table, days, error: String(e?.message || e) });
    }
  }
  return { ok: results.every((r) => !r.error), ts: new Date().toISOString(), dryRun, results };
}

let _timer = null;
export function startRetentionScheduler(pool, { intervalMs = 24 * 60 * 60 * 1000 } = {}) {
  if (process.env.RETENTION_DISABLED === "1") return { started: false, reason: "disabled" };
  if (_timer) return { started: false, reason: "already running" };
  const tick = async () => {
    try {
      const r = await runRetention(pool);
      console.log(`[retention] ${JSON.stringify({ ok: r.ok, deleted: r.results.reduce((a, x) => a + (x.deleted || 0), 0) })}`);
    } catch (e) { console.warn("[retention]", e?.message || e); }
  };
  setTimeout(tick, 60_000);
  _timer = setInterval(tick, intervalMs).unref?.() ?? setInterval(tick, intervalMs);
  return { started: true, intervalMs };
}
export function stopRetentionScheduler() { if (_timer) { clearInterval(_timer); _timer = null; } }
