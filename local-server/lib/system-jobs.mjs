// system-jobs.mjs — Multi-host job coordination via DB row lock.
//
// Backed by the `system_jobs` table + a unique partial index on
// (job_type) WHERE status IN ('running','stopping'). That index makes
// `INSERT ... ON CONFLICT DO NOTHING` atomically race-safe: only ONE host
// holds an active row per job_type at any moment. Every other host sees
// a 409 and the current owner row.
//
// Pattern in a long-running endpoint:
//
//   const claim = await claimJob(pool, 'backfill', { ... });
//   if (claim.conflict) return res.status(409).json({ ok: false, owner: claim.owner });
//   try {
//     while (...) {
//       if (await checkStop(pool, claim.id)) break;
//       // ... batch ...
//       await heartbeat(pool, claim.id, { scanned, written, errors });
//     }
//     await releaseJob(pool, claim.id, 'done');
//   } catch (e) {
//     await releaseJob(pool, claim.id, 'error', String(e?.message || e));
//     throw e;
//   }
//
// Stale rows (heartbeat older than STALE_TIMEOUT_MS) are reclaimed by
// `reclaimStale()` — called at boot + every status poll. So a `kill -9`
// on the owner host frees the lock within ~60 seconds.

import os from "node:os";

export const JOB_TYPES = Object.freeze([
  "backfill",
  "nuke",
  "reprocess",
  "sync",
  "cve_refresh",
  "retention",
]);

export const STALE_TIMEOUT_MS = 60_000;

const HOST = (() => {
  try { return os.hostname() || "unknown"; } catch { return "unknown"; }
})();

export function getCurrentHost() { return HOST; }
export function getCurrentPid() { return process.pid; }

/**
 * Try to acquire the active slot for a job type.
 * Returns { conflict: false, id, ownerHost, ownerPid, startedAt } on success,
 *     or  { conflict: true,  owner: <row> }              if another host owns it.
 */
export async function claimJob(pool, jobType, meta = {}) {
  if (!JOB_TYPES.includes(jobType)) {
    throw new Error(`unknown job_type: ${jobType}`);
  }
  await ensureSchema(pool);
  // Reap stale rows before claiming so kill -9'd jobs don't permanently block.
  await reclaimStale(pool).catch(() => {});

  const ins = await pool.query(
    `INSERT INTO system_jobs (job_type, status, owner_host, owner_pid, meta)
     VALUES ($1, 'running', $2, $3, $4::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id, owner_host, owner_pid, started_at`,
    [jobType, HOST, process.pid, JSON.stringify(meta || {})],
  );
  if (ins.rows.length) {
    return {
      conflict: false,
      id: ins.rows[0].id,
      ownerHost: ins.rows[0].owner_host,
      ownerPid: ins.rows[0].owner_pid,
      startedAt: ins.rows[0].started_at,
    };
  }
  const existing = await pool.query(
    `SELECT id, job_type, status, owner_host, owner_pid, started_at, heartbeat_at,
            scanned, written, errors, meta
       FROM system_jobs
      WHERE job_type=$1 AND status IN ('running','stopping')
      ORDER BY started_at DESC
      LIMIT 1`,
    [jobType],
  );
  return { conflict: true, owner: existing.rows[0] || null };
}

/** Update heartbeat + progress counters. Best-effort; swallows errors. */
export async function heartbeat(pool, id, patch = {}) {
  if (!id) return;
  const { scanned, written, errors, meta } = patch;
  try {
    await pool.query(
      `UPDATE system_jobs
          SET heartbeat_at = now(),
              scanned = COALESCE($2, scanned),
              written = COALESCE($3, written),
              errors  = COALESCE($4, errors),
              meta    = COALESCE($5::jsonb, meta)
        WHERE id = $1
          AND status IN ('running','stopping')`,
      [id, scanned ?? null, written ?? null, errors ?? null, meta ? JSON.stringify(meta) : null],
    );
  } catch { /* heartbeat is best-effort */ }
}

/** Returns true if a stop has been requested for this job id. */
export async function checkStop(pool, id) {
  if (!id) return false;
  try {
    const r = await pool.query(
      `SELECT stop_requested FROM system_jobs WHERE id=$1`,
      [id],
    );
    return !!r.rows[0]?.stop_requested;
  } catch { return false; }
}

/** Mark a job finished. status: 'done' | 'error' | 'cancelled'. */
export async function releaseJob(pool, id, status = "done", lastError = null) {
  if (!id) return;
  try {
    await pool.query(
      `UPDATE system_jobs
          SET status      = $2,
              finished_at = now(),
              last_error  = $3
        WHERE id = $1
          AND status IN ('running','stopping')`,
      [id, status, lastError],
    );
  } catch { /* swallow */ }
}

/** Request a stop on the active job of this type (any host can call). */
export async function requestStop(pool, jobType) {
  if (!JOB_TYPES.includes(jobType)) {
    throw new Error(`unknown job_type: ${jobType}`);
  }
  const r = await pool.query(
    `UPDATE system_jobs
        SET stop_requested = true, status = 'stopping'
      WHERE job_type=$1 AND status='running'
      RETURNING id, owner_host, owner_pid, started_at`,
    [jobType],
  );
  return { ok: r.rows.length > 0, row: r.rows[0] || null };
}

/** Mark jobs with stale heartbeat as 'error' so a new host can claim the slot. */
export async function reclaimStale(pool) {
  try {
    const r = await pool.query(
      `UPDATE system_jobs
          SET status = 'error',
              finished_at = now(),
              last_error  = COALESCE(last_error, 'stale (heartbeat timeout)')
        WHERE status IN ('running','stopping')
          AND heartbeat_at < now() - ($1::int || ' milliseconds')::interval
        RETURNING id, job_type, owner_host`,
      [STALE_TIMEOUT_MS],
    );
    return r.rows;
  } catch { return []; }
}

/** Return the active row for one job type (or null). */
export async function getActiveJob(pool, jobType) {
  await reclaimStale(pool).catch(() => {});
  const r = await pool.query(
    `SELECT id, job_type, status, owner_host, owner_pid, started_at, heartbeat_at,
            stop_requested, scanned, written, errors, meta, last_error
       FROM system_jobs
      WHERE job_type=$1 AND status IN ('running','stopping')
      ORDER BY started_at DESC LIMIT 1`,
    [jobType],
  );
  return r.rows[0] || null;
}

/** All active jobs (any type) + last N completed for the dashboard. */
export async function listJobs(pool, { recent = 20 } = {}) {
  await reclaimStale(pool).catch(() => {});
  const active = await pool.query(
    `SELECT id, job_type, status, owner_host, owner_pid, started_at, heartbeat_at,
            stop_requested, scanned, written, errors, meta, last_error
       FROM system_jobs
      WHERE status IN ('running','stopping')
      ORDER BY started_at DESC`,
  );
  const done = await pool.query(
    `SELECT id, job_type, status, owner_host, owner_pid, started_at, finished_at,
            scanned, written, errors, last_error
       FROM system_jobs
      WHERE status IN ('done','error','cancelled')
      ORDER BY COALESCE(finished_at, started_at) DESC
      LIMIT $1`,
    [recent],
  );
  return { active: active.rows, recent: done.rows };
}

let _schemaReady = false;
/** Lazy create — schema.sql also has the canonical definition. */
export async function ensureSchema(pool) {
  if (_schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_jobs (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_type        text NOT NULL,
      status          text NOT NULL CHECK (status IN ('running','stopping','done','error','cancelled')),
      owner_host      text NOT NULL,
      owner_pid       integer,
      started_at      timestamptz NOT NULL DEFAULT now(),
      finished_at     timestamptz,
      heartbeat_at    timestamptz NOT NULL DEFAULT now(),
      stop_requested  boolean NOT NULL DEFAULT false,
      scanned         integer NOT NULL DEFAULT 0,
      written         integer NOT NULL DEFAULT 0,
      errors          integer NOT NULL DEFAULT 0,
      meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_error      text
    );
    CREATE UNIQUE INDEX IF NOT EXISTS system_jobs_one_active
      ON system_jobs(job_type) WHERE status IN ('running','stopping');
    CREATE INDEX IF NOT EXISTS system_jobs_recent
      ON system_jobs(job_type, started_at DESC);
  `);
  _schemaReady = true;
}
