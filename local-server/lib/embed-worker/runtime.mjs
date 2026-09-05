// lib/embed-worker/runtime.mjs — Embed worker lifecycle & batch claim engine
// Agnostic Python Worker supervisor and PostgreSQL claim/drain queue.

let D = null;

// Module-private state
let respawnTimestamps = [];
let workerLocked = false;
let lastHealMs = 0;
let _ensureInflight = null;
let _claimColumnsReady = null;
let RAG_AUTO_EMBED_RUNNING = false;
const RESPAWN_WINDOW_MS = 10 * 60_000;

export function initEmbedWorkerRuntime(deps) {
  const required = [
    "pool",
    "spawn", "isPortOpen", "killPortOwnerAndWait", "waitForPidExit",
    "probeWorkerHealth", "verifyEmbedAlive", "warmEmbedWorker",
    "resolvePythonCandidates",
    "pushLog",
    "ensureKnowledgeChunksTable",
    "embedAndStoreChunks",
    "getRagSettings", "getLastEmbedError",
    "EMBED_WORKER_HOST", "EMBED_WORKER_PORT", "DEFAULT_EMBED_MODEL",
    "serverDir",
    "getProc", "setProc",
    "getStatus", "setStatus",
    "getLastError", "setLastError",
    "setStartedAt",
    "getSelfHealCooldownMs", "getRespawnMax",
  ];
  for (const k of required) {
    if (deps[k] === undefined || deps[k] === null) {
      throw new Error(`[embed-worker/runtime] missing dep: ${k}`);
    }
  }
  D = deps;
}

// ─── Respawn breaker ────────────────────────────────────────────────────────
function _trackRespawn() {
  const now = Date.now();
  respawnTimestamps = respawnTimestamps.filter((t) => now - t < RESPAWN_WINDOW_MS);
  respawnTimestamps.push(now);
  if (respawnTimestamps.length > D.getRespawnMax()) {
    workerLocked = true;
    D.pushLog("worker", `[circuit-breaker] ${respawnTimestamps.length} respawns in ${Math.round(RESPAWN_WINDOW_MS / 60000)}m -> worker locked. Manual reset: POST /api/system/restart-worker`);
  }
}

export function _resetRespawnTracking() {
  respawnTimestamps = [];
  workerLocked = false;
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────
export async function ensureWorker() {
  if (_ensureInflight) return _ensureInflight;
  _ensureInflight = (async () => {
    try { return await _ensureWorkerImpl(); }
    finally { _ensureInflight = null; }
  })();
  return _ensureInflight;
}

export function kickWorkerStart(reason = "lazy") {
  ensureWorker().catch((e) => D.pushLog("worker", `[${reason}-ensure-error] ${e?.message || e}`));
}

async function _ensureWorkerImpl() {
  const existingHealth = await D.probeWorkerHealth().catch(() => null);
  if (existingHealth?.ok) {
    D.setStatus("online-external");
    return { spawned: false, status: "online-external" };
  }
  if (await D.isPortOpen(D.EMBED_WORKER_PORT).catch(() => false)) {
    D.setStatus("online-external");
    return { spawned: false, status: "online-external" };
  }
  D.setStatus("down");
  return { spawned: false, status: "down", error: "worker offline on port " + D.EMBED_WORKER_PORT };
}

export function killWorker() {
  if (D) D.setStatus("down");
}

// Restart endpoint helper: lastHealMs sıfırla + breaker reset.
export function resetSelfHealCooldown() {
  lastHealMs = 0;
  _resetRespawnTracking();
}

// Diag snapshot for /api/embeddings/state — server.mjs `let` taşınınca
// dead-state göstermesin diye modülden okur.
export function getRuntimeDiag() {
  return {
    respawnsInWindow: respawnTimestamps.length,
    respawnWindowMs: RESPAWN_WINDOW_MS,
    locked: workerLocked,
    lastHealMs,
    lastHealAgoSec: lastHealMs ? Math.round((Date.now() - lastHealMs) / 1000) : null,
  };
}

// ─── Pending counter ───────────────────────────────────────────────────────
export async function countPendingEmbeddings() {
  await D.ensureKnowledgeChunksTable();
  const r = await D.pool.query(
    `SELECT COUNT(*)::bigint AS n
       FROM knowledge_chunks
      WHERE embedding IS NULL OR COALESCE(metadata->>'embedding_status','pending') IN ('pending','error')`
  );
  return Number(r.rows[0]?.n || 0);
}

// ─── Claim batch + janitor + auto-drain ────────────────────────────────────
async function _ensureClaimColumns() {
  if (_claimColumnsReady !== null) return _claimColumnsReady;
  try {
    const r = await D.pool.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_name='knowledge_chunks'
         AND column_name='embedding_locked_at' LIMIT 1`);
    _claimColumnsReady = !!r.rowCount;
  } catch { _claimColumnsReady = false; }
  if (!_claimColumnsReady) {
    console.warn("[rag:queue] embedding_locked_at column not present; using legacy fallback queue.");
  }
  return _claimColumnsReady;
}

export async function claimEmbeddingBatch(jobId, limit, opts = {}) {
  const useEnriched = opts.useEnriched ? 1 : 0;
  const lim = Math.max(1, Math.min(5000, Number(limit) || 100));
  const ready = await _ensureClaimColumns();
  if (!ready) {
    const r = await D.pool.query(
      `SELECT id,
              CASE WHEN $2::int = 1 THEN COALESCE(metadata->>'content_enriched', content) ELSE content END AS content
         FROM knowledge_chunks
        WHERE embedding IS NULL OR COALESCE(metadata->>'embedding_status','pending') IN ('pending','error')
        ORDER BY id LIMIT $1`, [lim, useEnriched]);
    if (r.rows.length) {
      const ids = r.rows.map((x) => x.id);
      await D.pool.query(
        `UPDATE knowledge_chunks SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{embedding_status}', '"in_progress"') WHERE id = ANY($1::bigint[])`,
        [ids]
      ).catch(() => {});
    }
    return r.rows;
  }
  const sql = `
    WITH claimed AS (
      SELECT id FROM knowledge_chunks
       WHERE (embedding IS NULL OR embedding_status IS NULL OR embedding_status IN ('pending','stale','error'))
         AND COALESCE(embedding_attempts, 0) < 20
       ORDER BY id
       LIMIT $1
       FOR UPDATE SKIP LOCKED
    )
    UPDATE knowledge_chunks kc
       SET embedding_status   = 'in_progress',
           embedding_locked_at = now(),
           embedding_job_id    = $2,
           embedding_attempts  = COALESCE(embedding_attempts, 0) + 1
      FROM claimed
     WHERE kc.id = claimed.id
    RETURNING kc.id,
              CASE WHEN $3::int = 1 THEN COALESCE(kc.metadata->>'content_enriched', kc.content) ELSE kc.content END AS content`;
  const r = await D.pool.query(sql, [lim, jobId, useEnriched]).catch((e) => {
    console.warn(`[rag:claim] sql error: ${e?.message || e}`);
    return { rows: [] };
  });
  return r.rows;
}

export async function ragJanitor() {
  const ready = await _ensureClaimColumns();
  if (!ready) return;
  try {
    const reset = await D.pool.query(`
      UPDATE knowledge_chunks
         SET embedding_status='pending',
             embedding_locked_at=NULL,
             embedding_job_id=NULL
       WHERE embedding_status='in_progress'
         AND embedding_locked_at < now() - interval '3 minutes'
         AND COALESCE(embedding_attempts,0) < 20
      RETURNING id`);
    const dead = await D.pool.query(`
      UPDATE knowledge_chunks
         SET embedding_status='error',
             embedding_last_error = COALESCE(embedding_last_error,'lease timeout after max attempts'),
             embedding_locked_at=NULL,
             embedding_job_id=NULL
       WHERE embedding_status='in_progress'
         AND embedding_locked_at < now() - interval '3 minutes'
         AND COALESCE(embedding_attempts,0) >= 20
      RETURNING id`);
    if (reset.rowCount || dead.rowCount) {
      console.log(`[rag:janitor] revived=${reset.rowCount} dead=${dead.rowCount}`);
    }
  } catch (e) {
    if (process.env.DEBUG_RAG) console.warn(`[rag:janitor] ${e?.message || e}`);
  }
}

export async function ragAutoEmbedDrain() {
  if (RAG_AUTO_EMBED_RUNNING) return;
  if (String(process.env.RAG_AUTO_EMBED || "1") === "0") return;
  RAG_AUTO_EMBED_RUNNING = true;
  const BATCH = Math.max(16, Math.min(100, Number(process.env.RAG_AUTO_EMBED_BATCH) || 64));
  const jobId = `auto-${process.pid}-${Date.now().toString(36)}`;
  let totalDone = 0;
  try {
    console.log(`[rag:auto-embed] started (job=${jobId}, batch=${BATCH})`);
    while (true) {
      const claimed = await claimEmbeddingBatch(jobId, BATCH, { useEnriched: !!D.getRagSettings().useEnrichedContent });
      if (!claimed.length) { 
        if (totalDone > 0) console.log(`[rag:auto-embed] complete — total written: ${totalDone}`); 
        break; 
      }
      const ids = claimed.map((x) => x.id);
      const texts = claimed.map((x) => String(x.content || "").slice(0, 1500));
      const written = await D.embedAndStoreChunks(ids, texts).catch((e) => {
        console.warn(`[rag:auto-embed] batch error: ${e.message || e}`);
        return 0;
      });
      totalDone += written;
      if (written === 0) {
        console.warn(`[rag:auto-embed] batch wrote 0 — waiting 3s`);
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        console.log(`[rag:auto-embed] progress: +${written} (total: ${totalDone})`);
        await new Promise((r) => setImmediate(r));
      }
    }
  } catch (e) {
    console.warn(`[rag:auto-embed] stopped: ${e.message || e}`);
  } finally {
    RAG_AUTO_EMBED_RUNNING = false;
  }
}

// ─── Boot intervals ────────────────────────────────────────────────────────
export function startEmbedWorkerIntervals() {
  setInterval(() => { ragJanitor().catch(() => {}); }, 60_000).unref?.();
  setTimeout(() => { ragAutoEmbedDrain().catch(() => {}); }, 1500).unref?.();
  setInterval(() => { ragAutoEmbedDrain().catch(() => {}); }, 15_000).unref?.();
}

// ─── Routes (4 worker endpoint) ────────────────────────────────────────────
export function mountEmbedWorkerRoutes(app) {
  // POST /api/rag/retry-embeddings
  app.post("/api/rag/retry-embeddings", async (req, res) => {
    const limit = Math.max(1, Math.min(5000, Number(req.query?.limit) || Number(req.body?.limit) || 500));
    const jobId = `manual-${Date.now().toString(36)}`;
    try {
      await ensureWorker().catch(() => {});
      const health = await D.probeWorkerHealth().catch(() => null);
      const alive = !!health?.ok || await D.verifyEmbedAlive(8000);
      if (!alive) {
        return res.status(503).json({
          ok: false, retried: 0, written: 0, scanned: 0, jobId,
          reason: "worker_not_ready",
          workerStatus: D.getStatus(),
          workerLastError: D.getLastError(),
          lastEmbedError: D.getLastEmbedError(),
          hint: "Worker may be offline or starting. Check logs or trigger POST /api/system/restart-worker.",
        });
      }
      const claimed = await claimEmbeddingBatch(jobId, limit, { useEnriched: !!D.getRagSettings().useEnrichedContent });
      if (!claimed.length) return res.json({ ok: true, retried: 0, written: 0, scanned: 0, jobId });
      const ids = claimed.map((x) => x.id);
      const texts = claimed.map((x) => String(x.content || "").slice(0, 1500));
      const written = await D.embedAndStoreChunks(ids, texts).catch(() => 0);
      const ok = written > 0 || ids.length === 0;

      // Also kick background auto-drain to continue draining remaining items
      setTimeout(() => { ragAutoEmbedDrain().catch(() => {}); }, 100).unref?.();

      res.json({
        ok, jobId,
        scanned: ids.length,
        written,
        remaining: Math.max(0, ids.length - written),
        workerStatus: D.getStatus(),
        lastEmbedError: written === 0 ? D.getLastEmbedError() : null,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e), workerStatus: D.getStatus(), workerLastError: D.getLastError() });
    }
  });

  // POST /api/system/worker/start
  app.post("/api/system/worker/start", async (_req, res) => {
    const r = await ensureWorker();
    res.json({ ok: r.status !== "down" && r.status !== "down-locked", ...r, port: D.EMBED_WORKER_PORT, lastError: D.getLastError(), recentWorkerLogs: typeof D.getRecentWorkerLogs === "function" ? D.getRecentWorkerLogs(40) : undefined });
  });

  // POST /api/system/worker/stop
  app.post("/api/system/worker/stop", (_req, res) => {
    killWorker();
    res.json({ ok: true, status: D.getStatus() });
  });

  // POST /api/system/restart-worker (loopback-only mutation path).
  app.post("/api/system/restart-worker", async (_req, res) => {
    const steps = [];
    try {
      const proc = D.getProc();
      if (proc) {
        const pid = proc.pid;
        try { proc.kill("SIGTERM"); } catch {}
        if (pid) await D.waitForPidExit(pid, 3000);
        steps.push(`managed child terminated (pid=${pid || "?"})`);
      }
      D.setProc(null);
      D.setStatus("down");
      const killed = await D.killPortOwnerAndWait(D.EMBED_WORKER_PORT, 6000);
      steps.push(`port ${D.EMBED_WORKER_PORT} cleaned (${killed} pid)`);
      resetSelfHealCooldown();
      D.setLastError(null);
      steps.push("cooldown + circuit-breaker reset");
      const r = await ensureWorker();
      steps.push(`ensureWorker → status=${r.status}`);
      let aliveOk = false;
      if (r.status === "online-auto" || r.status === "online-external") {
        aliveOk = await D.verifyEmbedAlive(5000);
        steps.push(`verifyEmbedAlive=${aliveOk}`);
      }
      res.json({
        ok: aliveOk,
        status: D.getStatus(),
        port: D.EMBED_WORKER_PORT,
        pid: D.getProc()?.pid ?? null,
        lastError: D.getLastError(),
        lastEmbedError: D.getLastEmbedError(),
        recentWorkerLogs: typeof D.getRecentWorkerLogs === "function" ? D.getRecentWorkerLogs(60) : undefined,
        steps,
      });
    } catch (e) {
      res.status(500).json({
        ok: false, error: String(e?.message || e),
        status: D.getStatus(), steps,
      });
    }
  });
}
