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
  if (workerLocked) {
    D.setStatus("down-locked");
    const err = `circuit-breaker: excessive respawns (${respawnTimestamps.length} in ${Math.round(RESPAWN_WINDOW_MS / 60000)}m). Manual reset required.`;
    D.setLastError(err);
    return { spawned: false, status: D.getStatus(), error: err };
  }
  if (D.getProc() && D.getStatus() !== "down") return { spawned: false, status: D.getStatus() };
  
  const proc0 = D.getProc();
  if (proc0 && proc0.exitCode === null) {
    const ghostPid = proc0.pid;
    try { proc0.kill("SIGTERM"); } catch {}
    if (ghostPid) await D.waitForPidExit(ghostPid, 3000);
    D.setProc(null);
  }
  const existingHealth = await D.probeWorkerHealth();
  if (existingHealth?.ok) {
    const alive = await D.verifyEmbedAlive(3000);
    if (alive) {
      D.setStatus("online-external");
      void D.warmEmbedWorker("external");
      return { spawned: false, status: D.getStatus() };
    }
    D.pushLog("worker", `[self-heal] /health responded ok but /v1/embeddings empty -> clearing zombie worker port`);
  }
  if (await D.isPortOpen(D.EMBED_WORKER_PORT)) {
    const cooldownMs = D.getSelfHealCooldownMs();
    if (Date.now() - lastHealMs > cooldownMs) {
      const killed = await D.killPortOwnerAndWait(D.EMBED_WORKER_PORT, 5000);
      D.pushLog("worker", `[self-heal] zombie worker detected on port ${D.EMBED_WORKER_PORT} -> killed ${killed} pids, respawning (cooldown=${cooldownMs / 1000}s)`);
      lastHealMs = Date.now();
      D.setProc(null);
      D.setStatus("down");
      _trackRespawn();
      if (workerLocked) {
        const err = `circuit-breaker triggered · respawns=${respawnTimestamps.length}`;
        D.setLastError(err);
        return { spawned: false, status: "down-locked", error: err };
      }
    } else {
      D.setStatus("down");
      const err = `port ${D.EMBED_WORKER_PORT} occupied (self-heal cooldown · last heal ${Math.round((Date.now() - lastHealMs) / 1000)}s ago / cooldown=${cooldownMs / 1000}s)`;
      D.setLastError(err);
      return { spawned: false, status: D.getStatus(), error: err };
    }
  }
  D.setStatus("starting");
  D.setLastError(null);
  const candidates = D.resolvePythonCandidates();
  if (!candidates.length) {
    D.setStatus("down");
    const err = "no python runner available (PYTHON_BIN, .venv/bin/python, uv, python3, python hepsi çözülemedi)";
    D.setLastError(err);
    D.pushLog("worker", `[spawn-fail] ${err}`);
    return { spawned: false, status: D.getStatus(), error: err };
  }
  const bootErrors = [];
  let proc = null;
  for (const candidate of candidates) {
    const args = [
      ...candidate.args, "-m", "uvicorn", "worker:app",
      "--host", D.EMBED_WORKER_HOST, "--port", String(D.EMBED_WORKER_PORT),
      "--workers", "1", "--lifespan", "on",
    ];
    D.pushLog("worker", `[spawn] ${candidate.file} ${args.join(" ")}`);
    let candidateProc = null;
    try {
      candidateProc = D.spawn(candidate.file, args, {
        cwd: D.serverDir,
        env: {
          ...process.env,
          MLX_EMBED_MODEL: process.env.MLX_EMBED_MODEL || D.DEFAULT_EMBED_MODEL,
          EMBED_WORKER_PORT: String(D.EMBED_WORKER_PORT),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const msg = `${candidate.file}: ${String(e?.message || e)}`;
      bootErrors.push(msg);
      D.pushLog("worker", `[spawn-error] ${msg}`);
      candidateProc = null;
      continue;
    }
    const spawnResult = await new Promise((resolve) => {
      let done = false;
      let timer = null;
      const finish = (ok, error = "") => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        try { candidateProc.off?.("error", onError); } catch {}
        try { candidateProc.off?.("spawn", onSpawn); } catch {}
        resolve({ ok, error });
      };
      const onError = (e) => finish(false, String(e?.message || e));
      const onSpawn = () => finish(true, "");
      candidateProc.once?.("error", onError);
      candidateProc.once?.("spawn", onSpawn);
      // Bun/Node uyumluluğu: "spawn" event'i gelmezse kısa grace sonrası
      // child'ı başlamış kabul et; gerçek erken exit aşağıdaki health loop'ta yakalanır.
      timer = setTimeout(() => finish(true, ""), 500);
      timer.unref?.();
    });
    if (!spawnResult.ok) {
      const msg = `${candidate.file}: ${spawnResult.error}`;
      bootErrors.push(msg);
      D.pushLog("worker", `[spawn-error] ${msg}`);
      try { candidateProc.kill?.("SIGTERM"); } catch {}
      continue;
    }
    proc = candidateProc;
    proc.on("error", (e) => {
      const msg = `[spawn:runtime-error] ${candidate.file}: ${String(e?.message || e)}`;
      D.pushLog("worker", msg);
      D.setLastError(msg);
    });
    break;
  }
  D.setProc(proc);
  if (!proc) {
    D.setStatus("down");
    const err = bootErrors.join(" | ") || "spawn failed (no candidate succeeded)";
    D.setLastError(err);
    return { spawned: false, status: D.getStatus(), error: err };
  }

  D.setStartedAt(Date.now());
  let earlyExit = null;
  let lastStderr = "";
  let lastBootOutput = "";
  const rememberBootOutput = (s) => {
    lastBootOutput = (lastBootOutput + String(s || "")).slice(-4000);
  };
  const compactBootOutput = () => lastBootOutput.split("\n").filter(Boolean).slice(-6).join(" | ");
  proc.stdout.on("data", (b) => {
    const s = b.toString();
    rememberBootOutput(s);
    D.pushLog("worker", s);
  });
  proc.stderr.on("data", (b) => {
    const s = b.toString();
    rememberBootOutput(s);
    lastStderr = (lastStderr + s).slice(-2000);
    D.pushLog("worker", s);
  });
  proc.on("exit", (code) => {
    earlyExit = code;
    D.pushLog("worker", `[exit] code=${code}`);
    D.setProc(null);
    D.setStatus("down");
  });
  // bge-m3 cold start: poll /health up to ~6dk.
  const DEADLINE_MS = Number(process.env.WORKER_BOOT_TIMEOUT_MS || 360_000);
  const t0 = Date.now();
  while (Date.now() - t0 < DEADLINE_MS) {
    if (earlyExit !== null) {
      D.setStatus("down");
      const err = `worker exited (code=${earlyExit}) before ready. ${compactBootOutput() || "Check Live Console."}`;
      D.setLastError(err);
      return { spawned: false, status: D.getStatus(), error: err };
    }
    const h = await D.probeWorkerHealth();
    if (h?.ok) {
      D.setStatus("online-auto");
      // 60sn boyunca sağlıklı kalırsa respawn sayacını sıfırla.
      setTimeout(() => { if (D.getStatus() === "online-auto") _resetRespawnTracking(); }, 60_000).unref?.();
      D.pushLog("worker", `[ready] backend=${h.backend} dim=${h.dim} model=${h.model}`);
      void D.warmEmbedWorker("ready");
      return { spawned: true, status: D.getStatus() };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  D.setStatus("down");
  const err = `worker did not become healthy within ${Math.round(DEADLINE_MS / 1000)}s. Last output: ${compactBootOutput() || "(empty — python/uvicorn may not have started, or model load produced no output)"}`;
  D.setLastError(err);
  try { D.getProc()?.kill("SIGTERM"); } catch {}
  D.setProc(null);
  return { spawned: false, status: D.getStatus(), error: err };
}

export function killWorker() {
  if (!D) return;
  const proc = D.getProc();
  if (proc) {
    try { proc.kill("SIGTERM"); } catch {}
    D.setProc(null);
  }
  D.setStatus("down");
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
         AND COALESCE(embedding_attempts, 0) < 5
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
         AND embedding_locked_at < now() - interval '10 minutes'
         AND COALESCE(embedding_attempts,0) < 5
      RETURNING id`);
    const dead = await D.pool.query(`
      UPDATE knowledge_chunks
         SET embedding_status='error',
             embedding_last_error = COALESCE(embedding_last_error,'lease timeout after max attempts'),
             embedding_locked_at=NULL,
             embedding_job_id=NULL
       WHERE embedding_status='in_progress'
         AND embedding_locked_at < now() - interval '10 minutes'
         AND COALESCE(embedding_attempts,0) >= 5
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
  const BATCH = Math.max(50, Math.min(2000, Number(process.env.RAG_AUTO_EMBED_BATCH) || 500));
  const SLEEP_MS = Math.max(10, Number(process.env.RAG_AUTO_EMBED_SLEEP_MS) || 50);
  const jobId = `auto-${process.pid}-${Date.now().toString(36)}`;
  let totalDone = 0;
  try {
    console.log(`[rag:auto-embed] started (job=${jobId}, batch=${BATCH}, sleep=${SLEEP_MS}ms)`);
    while (true) {
      let alive = false;
      try {
        await ensureWorker().catch((e) => console.warn(`[rag:auto-embed] ensureWorker: ${e?.message || e}`));
        const s = D.getStatus();
        if (s === "online-auto" || s === "online-external") {
          alive = await D.verifyEmbedAlive(3000);
        }
      } catch {}
      if (!alive) {
        console.warn(`[rag:auto-embed] worker not ready (status=${D.getStatus()}, alive=false), waiting 15s`);
        await new Promise((r) => setTimeout(r, 15000));
        continue;
      }
      try {
        const h = await fetch(`http://127.0.0.1:${D.EMBED_WORKER_PORT}/health`, { signal: AbortSignal.timeout(1500) })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (h && Number(h.footprint_gb) > 0 && Number(h.max_rss_gb) > 0) {
          const ratio = Number(h.footprint_gb) / Number(h.max_rss_gb);
          if (ratio >= 0.95) {
            console.warn(`[rag:auto-embed] footprint ${h.footprint_gb}GB/${h.max_rss_gb}GB (${(ratio * 100).toFixed(0)}%) — 15s backpressure`);
            await new Promise((r) => setTimeout(r, 15000));
            continue;
          }
        }
      } catch {}
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
        console.warn(`[rag:auto-embed] batch wrote 0 — embed worker unresponsive, waiting 15s`);
        await new Promise((r) => setTimeout(r, 15000));
      } else {
        if (totalDone % (BATCH * 2) < BATCH) console.log(`[rag:auto-embed] progress: +${totalDone}`);
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
  setTimeout(() => { ragAutoEmbedDrain().catch(() => {}); }, 30_000).unref?.();
  setInterval(() => { ragAutoEmbedDrain().catch(() => {}); }, 30_000).unref?.();
}

// ─── Routes (4 worker endpoint) ────────────────────────────────────────────
export function mountEmbedWorkerRoutes(app) {
  // POST /api/rag/retry-embeddings
  app.post("/api/rag/retry-embeddings", async (req, res) => {
    const limit = Math.max(1, Math.min(5000, Number(req.query?.limit) || Number(req.body?.limit) || 500));
    const jobId = `manual-${Date.now().toString(36)}`;
    try {
      await ensureWorker().catch(() => {});
      const alive = await D.verifyEmbedAlive(4000);
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
