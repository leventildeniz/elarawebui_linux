export async function mountRagDbStatsRoute(app, deps) {
  const { pool, isAdminCaller } = deps;

  app.get("/api/rag/db-stats", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });

    try {
      // 1. Get database size
      const dbSizeRes = await pool.query(`SELECT pg_database_size(current_database()) as bytes`);
      const dbSizeBytes = Number(dbSizeRes.rows[0]?.bytes || 0);

      // 2. Get table inventory (pg_stat_user_tables & pg_total_relation_size)
      const tablesRes = await pool.query(`
        SELECT 
            relname as name, 
            n_live_tup as rows, 
            pg_total_relation_size(relid) as bytes 
        FROM pg_stat_user_tables 
        ORDER BY pg_total_relation_size(relid) DESC 
        LIMIT 50;
      `);

      const maxBytes = Math.max(...tablesRes.rows.map(r => Number(r.bytes)), 1);

      const tableInventory = tablesRes.rows.map(r => {
        const bytes = Number(r.bytes);
        const weight = bytes / maxBytes;
        
        let sizeStr = "";
        if (bytes > 1024 * 1024 * 1024) sizeStr = (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
        else if (bytes > 1024 * 1024) sizeStr = (bytes / (1024 * 1024)).toFixed(2) + " MB";
        else sizeStr = (bytes / 1024).toFixed(2) + " KB";

        return {
          name: r.name,
          rows: Number(r.rows),
          size: sizeStr,
          weight
        };
      });

      // 3. Get live telemetry (cache hit rate, connections, transactions)
      const teleRes = await pool.query(`
        SELECT 
          sum(blks_hit) as hits, 
          sum(blks_read) as reads,
          sum(xact_commit) as commits,
          sum(xact_rollback) as rollbacks
        FROM pg_stat_database 
        WHERE datname = current_database();
      `);

      const connRes = await pool.query(`
        SELECT 
          count(*) filter (where state = 'active') as active,
          count(*) filter (where state = 'idle') as idle,
          count(*) as total
        FROM pg_stat_activity;
      `);

      const t = teleRes.rows[0] || { hits: 0, reads: 0, commits: 0, rollbacks: 0 };
      const hits = Number(t.hits);
      const reads = Number(t.reads);
      const totalBlocks = hits + reads;
      const hitRate = totalBlocks > 0 ? ((hits / totalBlocks) * 100).toFixed(1) + "%" : "0%";

      const c = connRes.rows[0] || { active: 0, idle: 0, total: 0 };

      // 4. Calculate approximate Reads/Sec and Writes/Sec based on postmaster uptime
      const timeRes = await pool.query(`SELECT extract(epoch from now() - pg_postmaster_start_time()) as uptime_sec`);
      const uptimeSec = Number(timeRes.rows[0]?.uptime_sec || 1);
      
      const readsPerSec = (reads / uptimeSec).toFixed(1);
      const writesPerSec = ((Number(t.commits) + Number(t.rollbacks)) / uptimeSec).toFixed(1);

      res.json({
        ok: true,
        dbSizeBytes,
        dbSizeGb: (dbSizeBytes / (1024 * 1024 * 1024)).toFixed(2) + " GB",
        telemetry: {
          hitRate,
          hits,
          reads,
          activeConnections: Number(c.active),
          idleConnections: Number(c.idle),
          totalConnections: Number(c.total),
          commits: Number(t.commits),
          rollbacks: Number(t.rollbacks),
          readsPerSec,
          writesPerSec
        },
        tableInventory
      });
    } catch (e) {
      console.error("[db-stats] GET failed:", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
