// K-2: Knowledge library maintenance endpoints (URL purge / cleanup / probe)
// Extracted from server.mjs (2026-05-30). Pure HTTP handlers; deps injected.

export function mountKnowledgeMaintenanceRoutes(app, deps) {
  const { pool, purgeGraphOrphans, cleanupKnowledgeGhosts } = deps;

  app.post("/api/knowledge/url-purge-all", async (req, res) => {
    const dryRun = req.body?.dryRun === true;
    try {
      const cnt = await pool.query(`SELECT COUNT(*)::int AS n FROM knowledge_sources WHERE kind='url'`);
      const sourceCount = Number(cnt.rows[0]?.n || 0);
      if (dryRun) {
        const ck = await pool.query(
          `SELECT COUNT(*)::int AS n FROM knowledge_chunks
            WHERE source_id IN (SELECT id::text FROM knowledge_sources WHERE kind='url')`
        );
        return res.json({ ok: true, dryRun: true, sources: sourceCount, chunks: Number(ck.rows[0]?.n || 0) });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const cdel = await client.query(
          `DELETE FROM knowledge_chunks
            WHERE source_id IN (SELECT id::text FROM knowledge_sources WHERE kind='url')`
        );
        const sdel = await client.query(`DELETE FROM knowledge_sources WHERE kind='url'`);
        const graph = await purgeGraphOrphans(client).catch(() => ({ removedEdges: 0, removedEntities: 0 }));
        await client.query("COMMIT");
        console.log(`[url-purge-all] removed sources=${sdel.rowCount} chunks=${cdel.rowCount} graphEdges=${graph.removedEdges} graphEntities=${graph.removedEntities}`);
        res.json({ ok: true, removedSources: sdel.rowCount || 0, removedChunks: cdel.rowCount || 0, removedGraphEdges: graph.removedEdges, removedGraphEntities: graph.removedEntities });
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // DEPRECATED 2026-05-26: url-rechunk-all removed; refetch from UI.
  app.post("/api/knowledge/url-rechunk-all", (_req, res) => {
    res.status(410).json({ ok: false, error: "url-rechunk-all removed; refetch from UI" });
  });

  // POST /api/knowledge/checkpoint-url-purge — 2026-05-26 cleanup.
  // type='url' + host filter only. PDF chunks (type='file') unaffected.
  app.post("/api/knowledge/checkpoint-url-purge", async (req, res) => {
    const dryRun = req.body?.dryRun === true;
    try {
      const sel = `FROM knowledge_sources
                    WHERE kind='url'
                      AND (url ILIKE '%checkpoint%' OR url ILIKE '%sc1.%')`;
      const cnt = await pool.query(`SELECT COUNT(*)::int AS n ${sel}`);
      const sourceCount = Number(cnt.rows[0]?.n || 0);
      if (dryRun) {
        const ck = await pool.query(`SELECT COUNT(*)::int AS n FROM knowledge_chunks
          WHERE source_id IN (SELECT id::text ${sel})`);
        return res.json({ ok: true, dryRun: true, sources: sourceCount, chunks: Number(ck.rows[0]?.n || 0) });
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const cdel = await client.query(`DELETE FROM knowledge_chunks
           WHERE source_id IN (SELECT id::text ${sel})`);
        const sdel = await client.query(`DELETE ${sel}`);
        await client.query("COMMIT");
        res.json({ ok: true, removedSources: sdel.rowCount || 0, removedChunks: cdel.rowCount || 0 });
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/knowledge/cleanup", async (req, res) => {
    try {
      const deepFileCheck = req.body?.deepFileCheck === true;
      const report = await cleanupKnowledgeGhosts({ staleOnly: req.body?.staleOnly !== false, deepFileCheck });
      res.json({ ok: true, ...report });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/knowledge/nuke", async (req, res) => {
    try {
      await pool.query("BEGIN");
      await pool.query("TRUNCATE TABLE knowledge_chunks CASCADE");
      await pool.query("TRUNCATE TABLE knowledge_sources CASCADE");
      await pool.query("TRUNCATE TABLE memory_working CASCADE");
      await pool.query("TRUNCATE TABLE memory_episodic CASCADE");
      await pool.query("TRUNCATE TABLE memory_facts CASCADE");
      const graph = await purgeGraphOrphans(pool).catch(() => ({ removedEdges: 0, removedEntities: 0 }));
      await pool.query("COMMIT");
      res.json({ ok: true, nuked: true, graph });
    } catch (e) {
      await pool.query("ROLLBACK").catch(() => {});
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // URL source manuel HEAD probu. Otomatik silme YOK; { delete:true } ile confirmed 404/410 silinir.
  app.post("/api/knowledge/url-probe", async (req, res) => {
    const doDelete = req.body?.delete === true;
    const timeoutMs = Math.max(1000, Math.min(15000, Number(req.body?.timeoutMs) || 5000));
    const retries = Math.max(1, Math.min(5, Number(req.body?.retries) || 3));
    const limit = Math.max(1, Math.min(5000, Number(req.body?.limit) || 1000));
    try {
      const rows = (await pool.query(
        `SELECT id, url, name FROM knowledge_sources
          WHERE kind='url' AND url IS NOT NULL AND url <> ''
          ORDER BY created_at DESC NULLS LAST
          LIMIT $1`, [limit]
      )).rows;
      const report = { checked: 0, alive: 0, dead: 0, transient: 0, deleted: 0, deadList: [], transientList: [] };
      for (const row of rows) {
        report.checked++;
        let status = 0; let lastErr = null;
        for (let attempt = 0; attempt < retries; attempt++) {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), timeoutMs);
          try {
            const r = await fetch(row.url, { method: "HEAD", redirect: "follow", signal: ctrl.signal,
              headers: { "User-Agent": "Elara-RAG-Probe/1.0" } });
            status = r.status;
            if (status >= 200 && status < 400) break;
            if (status === 404 || status === 410) break;
          } catch (e) { lastErr = String(e.message || e); }
          finally { clearTimeout(t); }
          await new Promise((rs) => setTimeout(rs, 500 * Math.pow(2, attempt)));
        }
        if (status >= 200 && status < 400) { report.alive++; continue; }
        if (status === 404 || status === 410) {
          report.dead++; report.deadList.push({ id: row.id, url: row.url, status });
          if (doDelete) {
            await pool.query(`DELETE FROM knowledge_sources WHERE id=$1`, [row.id]).catch(() => {});
            report.deleted++;
          }
        } else {
          report.transient++; report.transientList.push({ id: row.id, url: row.url, status, error: lastErr });
        }
      }
      res.json({ ok: true, ...report });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
