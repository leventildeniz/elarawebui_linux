// Data Retention Runner — Prunes expired records based on configured SLA policies.
// Intended to run post-backup (operational sequence: backup → retention prune).
//
// Conservative defaults: 90 days for audit tables (agent_logs/runs/vault_audit),
// shorter windows for high-frequency ephemeral telemetry.
// Configurable via environment variables: RETENTION_<TABLE>_DAYS

import { purgeThreadAttachments } from "./storage-engine.mjs";

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

/**
 * Runs per-tenant chat & attachment retention purge.
 * Deletes conversations and physical files older than retention_days for tenants with retention_enabled = true.
 */
export async function runTenantChatRetention(pool, { dryRun = false } = {}) {
  const results = [];
  try {
    const { rows: tenants } = await pool.query(
      `SELECT slug, name, retention_enabled, retention_days, retain_pinned 
       FROM app_tenants 
       WHERE retention_enabled = true AND retention_days > 0`
    ).catch(() => ({ rows: [] }));

    for (const t of tenants) {
      const days = Number(t.retention_days) || 90;
      const retainPinned = t.retain_pinned !== false;
      const pinnedClause = retainPinned ? "AND (pinned = false OR pinned IS NULL)" : "";

      const query = `
        SELECT id FROM chat_threads 
        WHERE (tenant_id = $1 OR (tenant_id IS NULL AND $1 = 'default'))
          AND updated_at < now() - interval '${days} days'
          ${pinnedClause}
      `;

      const { rows: expiredThreads } = await pool.query(query, [t.slug]).catch(() => ({ rows: [] }));
      
      if (dryRun) {
        results.push({ tenant: t.slug, days, would_delete_threads: expiredThreads.length });
        continue;
      }

      let deletedCount = 0;
      for (const th of expiredThreads) {
        try {
          await purgeThreadAttachments(th.id, { pool });
          await pool.query("DELETE FROM chat_messages WHERE thread_id = $1", [th.id]);
          await pool.query("DELETE FROM chat_threads WHERE id = $1", [th.id]);
          deletedCount++;
        } catch (err) {
          console.warn(`[Retention] Error purging thread ${th.id}:`, err.message);
        }
      }

      results.push({ tenant: t.slug, days, deleted_threads: deletedCount });
    }
  } catch (err) {
    console.warn("[Retention] runTenantChatRetention notice:", err.message);
  }
  return results;
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

  // Run tenant chat retention SLA purge
  const tenantResults = await runTenantChatRetention(pool, { dryRun });
  for (const tr of tenantResults) {
    results.push({
      table: `chat_threads (tenant: ${tr.tenant})`,
      days: tr.days,
      deleted: tr.deleted_threads,
      would_delete: tr.would_delete_threads,
    });
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
