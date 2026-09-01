// K-1: Knowledge sync engine HTTP endpoints (jobs + purge).
// Extracted from server.mjs (2026-05-30). DI: pool, sseBegin, sync engine helpers.

export function mountKnowledgeSyncRoutes(app, deps) {
  const {
    pool, sseBegin,
    ragJobs, getLastSyncJobId,
    createSyncOptions, deriveStartedBy, startSyncJob, cancelSyncJob,
    purgeKnowledgeRoot, purgeGraphOrphans,
    invalidateSourcesCache,
  } = deps;

  // GET support is intentional: operator can open/curl the gate from a browser.
  function handleKnowledgeSyncStart(req, res) {
    const input = req.method === "GET" ? req.query : (req.body || {});
    const opts = createSyncOptions(input);
    const startedBy = deriveStartedBy(req);
    const { jobId } = startSyncJob({ root: input?.root, opts, startedBy });
    res.status(202).json({ ok: true, jobId, status: "queued", opts, startedBy, poll: `/api/knowledge/sync/${jobId}`, stream: `/api/knowledge/sync/${jobId}/events` });
  }
  app.get("/api/knowledge/sync", handleKnowledgeSyncStart);
  app.post("/api/knowledge/sync", handleKnowledgeSyncStart);

  // POST /api/knowledge/sync-source — per-object sync (url/text/file or dir:<root>)
  app.post("/api/knowledge/sync-source", async (req, res) => {
    const body = req.body || {};
    const id = String(body.sourceId || body.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "sourceId or id required" });
    const opts = createSyncOptions(body);
    const startedBy = deriveStartedBy(req);
    let target;
    if (id.startsWith("dir:")) {
      const root = id.slice(4);
      target = { type: "dir", id, label: body.label || root };
    } else {
      let label = body.label || id;
      try {
        const r = await pool.query(`SELECT name, type FROM knowledge_sources WHERE id=$1`, [id]);
        if (r.rows[0]?.name) label = r.rows[0].name;
        target = { type: r.rows[0]?.type || "source", id, label };
      } catch {
        target = { type: "source", id, label };
      }
    }
    const { jobId } = startSyncJob({ opts, target, startedBy, mode: "source", sourcePayload: { id, crawl_config: body.crawl_config || null } });
    res.status(202).json({ ok: true, jobId, status: "queued", target, startedBy, poll: `/api/knowledge/sync/${jobId}`, stream: `/api/knowledge/sync/${jobId}/events` });
  });

  // POST /api/knowledge/source/:id/crawl-config — persist crawl policy without triggering a sync.
  app.post("/api/knowledge/source/:id/crawl-config", async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id || id.startsWith("dir:")) return res.status(400).json({ ok: false, error: "url source id required" });
      const cfg = req.body?.crawl_config ?? null;
      if (cfg !== null && typeof cfg !== "object") return res.status(400).json({ ok: false, error: "crawl_config must be object or null" });
      const r = await pool.query(
        `UPDATE knowledge_sources SET crawl_config=$2 WHERE id=$1 AND parent_id IS NULL RETURNING id, crawl_config`,
        [id, cfg ? JSON.stringify(cfg) : null]
      );
      if (!r.rowCount) return res.status(404).json({ ok: false, error: "source not found" });
      invalidateSourcesCache();
      res.json({ ok: true, id, crawl_config: r.rows[0].crawl_config });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // GET /api/knowledge/sync/:jobId — poll status
  app.get("/api/knowledge/sync/:jobId", (req, res) => {
    const job = ragJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: "job not found" });
    res.json({
      ok: true, jobId: req.params.jobId,
      status: job.status, progress: job.progress, total: job.total,
      lastEvent: job.lastEvent || null,
      results: job.results || null, error: job.error || null,
      durationMs: (job.finished || Date.now()) - job.started,
    });
  });

  // GET /api/knowledge/sync/:jobId/events — live progress stream with keep-alive pings.
  app.get("/api/knowledge/sync/:jobId/events", (req, res) => {
    const jobId = req.params.jobId;
    const job = ragJobs.get(jobId);
    if (!job) return res.status(404).json({ ok: false, error: "job not found" });
    const sse = sseBegin(req, res);
    const send = sse.sendNamed;
    let lastSeq = Math.max(0, Number(job.events?.[Math.max(0, (job.events?.length || 0) - 20)]?.seq || 1) - 1);
    send("hello", { ok: true, jobId, status: job.status, progress: job.progress || 0, total: job.total || 0 });
    const timer = setInterval(() => {
      const current = ragJobs.get(jobId);
      if (!current) { send("error", { ok: false, error: "job not found" }); clearInterval(timer); res.end(); return; }
      const events = current.events || [];
      for (const event of events) {
        if (Number(event.seq || 0) <= lastSeq) continue;
        send("progress", { ok: true, jobId, ...event });
        lastSeq = Number(event.seq || lastSeq);
      }
      sse.keepAlive();
      if (current.status === "completed" || current.status === "failed" || current.status === "cancelled") { 
        send("done", { ok: true, jobId, status: current.status, results: current.results || null, error: current.error || null, durationMs: (current.finished || Date.now()) - current.started }); 
        clearInterval(timer); 
        res.end(); 
      }
    }, 1000);
    req.on("close", () => clearInterval(timer));
  });

  // POST /api/knowledge/sync/:jobId/cancel — operator stop signal
  app.post("/api/knowledge/sync/:jobId/cancel", (req, res) => {
    const force = !!(req.body?.force ?? req.query?.force);
    const r = cancelSyncJob(req.params.jobId, { force });
    if (!r.ok) return res.status(400).json(r);
    res.json({ ok: true, jobId: req.params.jobId, status: force ? "force-cancelling" : "cancelling", force });
  });

  // GET /api/knowledge/sync-jobs — list recent jobs (newest first), summary form
  app.get("/api/knowledge/sync-jobs", (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));
    const currentJobId = getLastSyncJobId();
    const items = [];
    for (const [id, j] of ragJobs.entries()) {
      items.push({
        jobId: id, status: j.status, started: j.started, finished: j.finished || null,
        durationMs: (j.finished || Date.now()) - j.started,
        progress: j.progress || 0, total: j.total || 0,
        root: j.root || null, opts: j.opts || {},
        lastEvent: j.lastEvent || null,
        chunkReport: j.results?.chunkReport || null,
        error: j.error || null,
        eventCount: j.events?.length || 0,
        current: id === currentJobId,
        mode: j.mode || "global",
        target: j.target || null,
        targetType: j.target?.type || null,
        targetId: j.target?.id || null,
        targetLabel: j.target?.label || null,
        startedBy: j.startedBy || null,
        cancelRequested: !!j.cancelRequested,
      });
    }
    items.sort((a, b) => b.started - a.started);
    res.json({ ok: true, jobs: items.slice(0, limit), currentJobId });
  });

  // GET /api/knowledge/sync/:jobId/log — full buffered event log (for Detail panel history)
  app.get("/api/knowledge/sync/:jobId/log", (req, res) => {
    const job = ragJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: "job not found" });
    res.json({
      ok: true, jobId: req.params.jobId,
      status: job.status, started: job.started, finished: job.finished || null,
      durationMs: (job.finished || Date.now()) - job.started,
      progress: job.progress || 0, total: job.total || 0,
      root: job.root || null, opts: job.opts || {},
      results: job.results || null, error: job.error || null,
      events: job.events || [],
      mode: job.mode || "global",
      target: job.target || null,
      startedBy: job.startedBy || null,
      cancelRequested: !!job.cancelRequested,
    });
  });

  // POST /api/knowledge/purge — CASCADE silmek için tek kapı.
  // Body: { id?, root?, path?, sourceId?, dryRun? }
  // 'dir:<root>' id'lerini de çözer. Hayalet (disk'te yok) yolları sessizce uçurur.
  app.post("/api/knowledge/purge", async (req, res) => {
    const { id, root, path: filePath, sourceId, dryRun } = req.body ?? {};
    try {
      const where = []; const params = []; let removedFiles = 0, removedChunks = 0, removedSources = 0;
      let resolvedRoot = root, resolvedPath = filePath;
      if (typeof id === "string" && id.startsWith("dir:")) resolvedRoot = id.slice(4);
      if (resolvedRoot && !resolvedPath) {
        const r = await purgeKnowledgeRoot(resolvedRoot, { dryRun: !!dryRun });
        return res.json({ ok: true, ...r });
      }
      if (resolvedRoot && resolvedPath) { where.push(`(root=$${params.length+1} AND path=$${params.length+2})`); params.push(resolvedRoot, resolvedPath); }
      else if (resolvedRoot)             { where.push(`root=$${params.length+1}`); params.push(resolvedRoot); }
      else if (typeof id === "string" && id) { where.push(`id=$${params.length+1}`); params.push(id); }
      if (where.length) {
        if (dryRun) {
          const r = await pool.query(`SELECT id FROM knowledge_sources WHERE ${where.join(" AND ")}`, params);
          return res.json({ ok: true, dryRun: true, candidates: r.rowCount });
        }
        // BATCH delete — eski N+1 döngüsü 12k dosyada kağnıya çeviriyordu.
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const r = await client.query(`DELETE FROM knowledge_sources WHERE ${where.join(" AND ")} RETURNING id`, params);
          removedFiles = r.rowCount;
          removedSources = r.rowCount;
          if (removedFiles > 0) {
            const ids = r.rows.map(x => String(x.id)).filter(Boolean);
            const paths = r.rows.map(x => `${x.root}::${x.path}`);
            const c = await client.query(
              `DELETE FROM knowledge_chunks
                WHERE source_id = ANY($1::text[])`,
              [ids]
            );
            removedChunks = c.rowCount;
          }
          // await purgeGraphOrphans(client).catch(() => ({ removedEdges: 0, removedEntities: 0 }));
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK").catch(()=>{});
          throw e;
        } finally {
          client.release();
        }
      }
      const sId = typeof sourceId === "string" ? sourceId : (typeof id === "string" && !id.startsWith("dir:") ? id : null);
      if (sId) {
        // FIX 2026-05-26: URL source delete leak — atomik aynı transaction'a alıyoruz.
        const sclient = await pool.connect();
        try {
          await sclient.query("BEGIN");
          const cdel = await sclient.query(`DELETE FROM knowledge_chunks WHERE source_id=$1`, [sId]);
          const sdel = await sclient.query(`DELETE FROM knowledge_sources WHERE id=$1 RETURNING id`, [sId]);
          // await purgeGraphOrphans(sclient).catch(() => ({ removedEdges: 0, removedEntities: 0 }));
          await sclient.query("COMMIT");
          removedChunks += cdel.rowCount || 0;
          removedSources = sdel.rowCount;
        } catch (e) {
          await sclient.query("ROLLBACK").catch(() => {});
          throw e;
        } finally {
          sclient.release();
        }
      }
      // Orphan-chunk reaper now runs ASYNC — UI no longer waits on a full table scan.
      // FIX 2026-05-26: aynı sources guard burada da şart.
      setImmediate(() => {
        pool.query(`
          DELETE FROM knowledge_chunks c
           WHERE NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.id=c.source_id)
        `)
          .then(() => pool.connect())
          .then(async (c) => { try { await purgeGraphOrphans(c); } finally { c.release(); } })
          .catch(e => console.warn("[purge] orphan sweep failed:", String(e?.message||e)));
      });
      res.json({ ok: true, removedFiles, removedChunks, removedSources });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
