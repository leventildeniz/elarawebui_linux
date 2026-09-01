// lib/routes/capabilities-runs.mjs — Tur 3 extraction (2026-05-30)
// Endpoints:
//   GET    /api/database/stats
//   POST   /api/dispatch/dry-run        (session)
//   GET    /api/runs                    (session)
//   GET    /api/mlx-queue/stats         (session)
//   POST   /api/mlx-queue/:id/cancel    (session)
//   GET    /api/capability-packs
//   GET    /api/user-capabilities
//   POST   /api/user-capabilities/activate-pack
//   DELETE /api/user-capabilities/pack/:packId
//
// Behavior unchanged — pure relocation with DI.

export function mountCapabilitiesRunsRoutes(app, deps) {
  const {
    pool,
    requireSession,
    dispatchUserTurn,
    finishRun,
    localQueue,
    LOCAL_TRANSPORT,
    getMlxWarmState,         // () => _MLX_WARM_STATE
    getRagSettings,          // () => RAG_SETTINGS
    enqueueWrite,
  } = deps;

  // --- Database Ops · live PG inventory + load metrics ---------------------
  app.get("/api/database/stats", async (_req, res) => {
    try {
      const dbName = (await pool.query("SELECT current_database() AS db")).rows[0].db;

      const tablesQ = await pool.query(`
        SELECT
          c.relname AS table_name,
          COALESCE(s.n_live_tup, 0)::bigint AS rows,
          pg_total_relation_size(c.oid)::bigint AS bytes,
          COALESCE(s.n_tup_ins, 0)::bigint AS inserts,
          COALESCE(s.n_tup_upd, 0)::bigint AS updates,
          COALESCE(s.n_tup_del, 0)::bigint AS deletes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 50
      `);

      const actQ = await pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE state = 'active')::int AS active,
          COUNT(*) FILTER (WHERE state = 'idle')::int AS idle,
          COUNT(*) FILTER (WHERE wait_event IS NOT NULL)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
      `);

      const dbQ = await pool.query(`
        SELECT
          xact_commit::bigint   AS commits,
          xact_rollback::bigint AS rollbacks,
          blks_read::bigint     AS blks_read,
          blks_hit::bigint      AS blks_hit,
          tup_returned::bigint  AS tup_returned,
          tup_fetched::bigint   AS tup_fetched,
          tup_inserted::bigint  AS tup_inserted,
          tup_updated::bigint   AS tup_updated,
          tup_deleted::bigint   AS tup_deleted,
          pg_database_size(current_database())::bigint AS size_bytes,
          EXTRACT(EPOCH FROM (now() - stats_reset))::bigint AS uptime_s
        FROM pg_stat_database WHERE datname = current_database()
      `);
      const d = dbQ.rows[0];

      const prev = global.__pgPrevSample;
      const now = Date.now();
      let tps = { commits: 0, rollbacks: 0, reads: 0, writes: 0 };
      if (prev) {
        const dt = Math.max(0.5, (now - prev.ts) / 1000);
        tps = {
          commits:   Math.max(0, Number(d.commits)   - prev.commits)   / dt,
          rollbacks: Math.max(0, Number(d.rollbacks) - prev.rollbacks) / dt,
          reads:     Math.max(0, Number(d.tup_returned) - prev.tup_returned) / dt,
          writes:    Math.max(0, Number(d.tup_inserted) + Number(d.tup_updated) + Number(d.tup_deleted)
                                - prev.tup_inserted - prev.tup_updated - prev.tup_deleted) / dt,
        };
      }
      global.__pgPrevSample = {
        ts: now,
        commits: Number(d.commits), rollbacks: Number(d.rollbacks),
        tup_returned: Number(d.tup_returned),
        tup_inserted: Number(d.tup_inserted), tup_updated: Number(d.tup_updated), tup_deleted: Number(d.tup_deleted),
      };

      const blksRead = Number(d.blks_read);
      const blksHit  = Number(d.blks_hit);
      const cacheHitRate = (blksRead + blksHit) > 0 ? (blksHit / (blksRead + blksHit)) * 100 : 100;

      res.json({
        database: dbName,
        sizeBytes: Number(d.size_bytes),
        uptimeSeconds: Number(d.uptime_s),
        tables: tablesQ.rows.map(r => ({
          name: r.table_name,
          rows: Number(r.rows),
          bytes: Number(r.bytes),
          inserts: Number(r.inserts),
          updates: Number(r.updates),
          deletes: Number(r.deletes),
        })),
        connections: actQ.rows[0],
        throughput: {
          commitsPerSec:   Math.round(tps.commits   * 100) / 100,
          rollbacksPerSec: Math.round(tps.rollbacks * 100) / 100,
          readsPerSec:     Math.round(tps.reads     * 100) / 100,
          writesPerSec:    Math.round(tps.writes    * 100) / 100,
        },
        cache: { hitRate: Math.round(cacheHitRate * 100) / 100, blksHit, blksRead },
        totals: { commits: Number(d.commits), rollbacks: Number(d.rollbacks) },
      });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/dispatch/dry-run", requireSession(), async (req, res) => {
    try {
      const { text = "", thread_id = null } = req.body || {};
      const decision = await dispatchUserTurn({
        text, threadId: thread_id,
        username: req.session?.username || null,
        sessionId: req.session?.id || null,
      });
      if (decision.runId) {
        await finishRun(decision.runId, { status: "done", output: { dryRun: true } });
      }
      res.json({ ok: true, decision });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/runs", requireSession(), async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
      const args = [];
      const where = [];
      if (req.query.thread_id) { args.push(req.query.thread_id); where.push(`thread_id=$${args.length}`); }
      if (req.query.kind)      { args.push(req.query.kind);      where.push(`kind=$${args.length}`); }
      if (req.query.status)    { args.push(req.query.status);    where.push(`status=$${args.length}`); }
      const sql = `SELECT id,kind,capability_id,thread_id,username,status,source,started_at,finished_at,duration_ms,error
                     FROM runs${where.length ? " WHERE " + where.join(" AND ") : ""}
                    ORDER BY started_at DESC LIMIT ${limit}`;
      const { rows } = await pool.query(sql, args);
      res.json({ ok: true, runs: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/mlx-queue/stats", requireSession(), (_req, res) => {
    const RAG_SETTINGS = getRagSettings();
    const warmState = getMlxWarmState();
    res.json({
      ok: true,
      stats: localQueue.stats(),
      transport: {
        inflight: LOCAL_TRANSPORT.inflight,
        dirty: LOCAL_TRANSPORT.dirty,
        lastFirstTokenTimeoutAt: LOCAL_TRANSPORT.lastFirstTokenTimeoutAt,
        lastAbortReason: LOCAL_TRANSPORT.lastAbortReason,
        lastActivityAt: LOCAL_TRANSPORT.lastActivityAt,
        resetEnabled: LOCAL_TRANSPORT.resetEnabled,
        lastResetStatus: LOCAL_TRANSPORT.lastResetStatus,
        recentFirstTokenMs: [...(warmState?.recentFirstTokenMs || [])],
        coldWarmupOnDemand: !!RAG_SETTINGS?.mlxColdWarmupOnDemand,
      },
    });
  });

  app.post("/api/mlx-queue/:id/cancel", requireSession(), (req, res) => {
    const ok = localQueue.cancel(req.params.id, req.body?.reason || "operator cancel");
    res.json({ ok, id: req.params.id });
  });

  app.get("/api/capability-packs", async (_req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT id,name,sector,description,icon,color,action_ids,skill_ids,system_prompt,is_system,default_model,default_interpreter_path,updated_at FROM capability_packs ORDER BY is_system DESC, sector, name"
      );
      for (const r of rows) if (!Array.isArray(r.skill_ids)) r.skill_ids = [];
      res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.get("/api/user-capabilities", async (req, res) => {
    const user = String(req.query.username || req.actor || "").toLowerCase();
    if (!user) return res.json([]);
    try {
      const { rows } = await pool.query(
        "SELECT id,username,pack_id,action_id,mode,enabled,created_at FROM user_capabilities WHERE lower(username)=$1 ORDER BY created_at DESC",
        [user]
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/user-capabilities/activate-pack", async (req, res) => {
    const user = String(req.body?.username || req.actor || "").toLowerCase();
    const packId = String(req.body?.packId || "");
    const mode = req.body?.mode === "clone" ? "clone" : "reference";
    if (!user || !packId) return res.status(400).json({ error: "username and packId required" });
    try {
      const { rows: prows } = await pool.query("SELECT * FROM capability_packs WHERE id=$1", [packId]);
      const pack = prows[0];
      if (!pack) return res.status(404).json({ error: "pack not found" });
      const actionIds = Array.isArray(pack.action_ids) ? pack.action_ids : [];

      await pool.query(
        `INSERT INTO user_capabilities(id,username,pack_id,action_id,mode,enabled)
         VALUES ($1,$2,$3,NULL,$4,true)
         ON CONFLICT (lower(username), coalesce(pack_id,''), coalesce(action_id,''))
         DO UPDATE SET enabled=true, mode=EXCLUDED.mode`,
        [`uc-${Date.now()}-${packId}`, user, packId, mode]
      );

      if (mode === "clone") {
        for (const aid of actionIds) {
          const { rows: arows } = await pool.query("SELECT * FROM action_library WHERE id=$1", [aid]);
          const a = arows[0]; if (!a) continue;
          const newId = `${aid}.user.${user}`;
          await pool.query(
            `INSERT INTO action_library(id, kind, name, category, provider, icon, color, description, params, outputs, runtime, is_system, owner_user_id, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12, now())
             ON CONFLICT (id) DO NOTHING`,
            [newId, a.kind, a.name, a.category, a.provider, a.icon, a.color, a.description,
             JSON.stringify(a.params), JSON.stringify(a.outputs), JSON.stringify(a.runtime), user]
          );
        }
      }

      enqueueWrite(
        `INSERT INTO agent_logs(agent,level,message,meta) VALUES ('capability','info',$1,$2)`,
        [`pack_activated:${packId}`, { user, mode, count: actionIds.length }]
      );
      res.json({ ok: true, activated: actionIds.length, mode });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.delete("/api/user-capabilities/pack/:packId", async (req, res) => {
    const user = String(req.query.username || req.actor || "").toLowerCase();
    if (!user) return res.status(400).json({ error: "username required" });
    try {
      await pool.query(
        "DELETE FROM user_capabilities WHERE lower(username)=$1 AND pack_id=$2",
        [user, req.params.packId]
      );
      res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
}
