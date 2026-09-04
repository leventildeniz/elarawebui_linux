// lib/routes/rag-ops.mjs — RAG maintenance and hygiene endpoints.
// Routes: /api/rag/repair-fts, brand-backfill, dedupe-chunks,
//   reprocess-oversized-html, nuke-reindex, reprocess-extensions.

export function mountRagOpsRoutes(app, deps) {
  const {
    pool,
    ragSelfAudit,
    resolveJoinExpr,
    deriveBrandFromUrl,
    startSyncJob,
    hardResetRagDatabase,
    countGhostNeedles,
    getEmbeddingHealth,
    getDefaultLibraryRoot,
  } = deps;

  app.post("/api/rag/repair-fts", async (_req, res) => {
    try {
      if (typeof ragSelfAudit === "function") {
        const audit = await ragSelfAudit();
        return res.json({ ok: audit.ok, updated: 0, generated: true, audit });
      }
      res.json({ ok: true, updated: 0, generated: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e), updated: 0, generated: true });
    }
  });

  app.post("/api/rag/brand-backfill", async (req, res) => {
    const dryRun = req.query?.dryRun === "1" || req.body?.dryRun === true;
    try {
      const { rows: sources } = await pool.query(`
        SELECT s.id::text AS source_id,
               s.name,
               s.brand,
               s.folder_id,
               rf.name AS folder_name,
               COALESCE(s.metadata->>'url', s.name, '') AS url,
               COUNT(k.id)::int AS chunks
          FROM knowledge_sources s
          LEFT JOIN knowledge_chunks k ON k.source_id = s.id::text
          LEFT JOIN rag_folders rf ON rf.id = s.folder_id
         GROUP BY s.id, s.name, s.brand, s.folder_id, rf.name, s.metadata
      `);

      const transitions = new Map();
      const perSource = [];
      let scanned = 0;
      for (const r of sources) {
        scanned += (r.chunks || 0);
        let neu = r.brand && r.brand !== 'auto-detect' ? r.brand.toLowerCase() : null;
        if (!neu && r.folder_id && r.folder_id !== 'uploads' && r.folder_name) {
          neu = r.folder_name.toLowerCase();
        }
        if (!neu && typeof deriveBrandFromUrl === "function") {
          neu = deriveBrandFromUrl(r.url);
        }
        perSource.push({ source_id: r.source_id, url: r.url, neu: neu || "general", chunks: r.chunks || 0 });
      }

      if (dryRun) {
        return res.json({
          ok: true, dryRun: true,
          sources: sources.length, scanned_chunks: scanned,
          sample: perSource.slice(0, 10),
        });
      }

      const client = await pool.connect();
      let updated = 0;
      try {
        await client.query("BEGIN");
        for (const p of perSource) {
          const rSrc = await client.query(
            `UPDATE knowledge_sources SET brand = $1 WHERE id = $2`,
            [p.neu, p.source_id]
          );
          const r = await client.query(
            `UPDATE knowledge_chunks
                SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{brand}', to_jsonb($1::text))
              WHERE source_id = $2`,
            [p.neu, p.source_id]
          );
          if (r.rowCount > 0) {
            updated += r.rowCount;
            const key = `→ ${p.neu ?? "(null)"}`;
            transitions.set(key, (transitions.get(key) || 0) + r.rowCount);
          }

          // Also upsert into knowledge_brands
          await client.query(
            `INSERT INTO knowledge_brands (id, label, chunks, files)
             VALUES ($1, $2, $3, 1)
             ON CONFLICT (id) DO UPDATE SET
               chunks = knowledge_brands.chunks + EXCLUDED.chunks,
               files = knowledge_brands.files + 1`,
            [`brand_${p.neu}`, p.neu, p.chunks]
          ).catch(() => {});
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      res.json({
        ok: true,
        sources: sources.length, scanned_chunks: scanned, updated,
        transitions: Object.fromEntries(transitions),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/rag/dedupe-chunks", async (req, res) => {
    const dryRun = req.query?.dryRun === "1" || req.body?.dryRun === true;
    try {
      const { rows: stat } = await pool.query(`
        SELECT COUNT(*)::int AS dup_groups,
               COALESCE(SUM(c-1),0)::int AS excess_rows
          FROM (SELECT COUNT(*) AS c FROM knowledge_chunks GROUP BY source_id, seq HAVING COUNT(*) > 1) s
      `);
      const summary = stat[0] || { dup_groups: 0, excess_rows: 0 };
      if (dryRun || summary.excess_rows === 0) {
        return res.json({ ok: true, dryRun: !!dryRun, ...summary, removed_rows: 0 });
      }
      const del = await pool.query(`
        DELETE FROM knowledge_chunks a
         USING knowledge_chunks b
         WHERE a.source_id = b.source_id AND a.seq = b.seq AND a.id < b.id
      `);
      res.json({ ok: true, ...summary, removed_rows: del.rowCount || 0 });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/rag/reprocess-oversized-html", async (req, res) => {
    const dryRun = req.query?.dryRun === "1" || req.body?.dryRun === true;
    try {
      const { rows: targets } = await pool.query(`
        SELECT DISTINCT path
          FROM knowledge_chunks
         WHERE path ILIKE '%.html'
           AND (length(content) > 8000 OR length(content) < 32)
      `);
      const paths = targets.map((r) => r.path).filter(Boolean);
      if (dryRun || !paths.length) {
        return res.json({ ok: true, dryRun: !!dryRun, candidates: paths.length, sample: paths.slice(0, 10) });
      }
      const reset = await pool.query(
        `UPDATE knowledge_files
            SET checksum = 'force-reparse',
                last_modified = '1970-01-01'::timestamptz
          WHERE path = ANY($1::text[])`,
        [paths]
      );
      const root = getDefaultLibraryRoot();
      const job = startSyncJob({ root, opts: { recursive: true, forceChunks: false, forcePdfChunks: false, allFileTypes: true } }) || {};
      res.json({
        ok: true,
        candidates: paths.length,
        cleared: reset.rowCount || 0,
        jobId: job?.jobId || null,
        note: "Scan started in background; targeted files will re-extract and re-embed with the hardened chunker.",
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/rag/nuke-reindex", async (req, res) => {
    try {
      const report = await hardResetRagDatabase({ reindex: req.body?.reindex === true });
      const ghosts = await countGhostNeedles();
      const health = await getEmbeddingHealth();
      res.json({ ok: ghosts.total === 0, ...report, ghostsRemaining: ghosts, status: health });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/rag/reprocess-extensions", async (req, res) => {
    try {
      const raw = Array.isArray(req.body?.extensions) && req.body.extensions.length
        ? req.body.extensions : [".html", ".htm", ".json"];
      const exts = raw
        .map((e) => String(e || "").trim().toLowerCase())
        .filter((e) => /^\.[a-z0-9]+$/.test(e));
      if (!exts.length) return res.status(400).json({ ok: false, error: "no valid extensions" });

      const patterns = exts.map((e) => `%${e}`);
      const reset = await pool.query(
        `UPDATE knowledge_files
            SET checksum = 'force-reparse',
                last_modified = '1970-01-01'::timestamptz
          WHERE lower(path) LIKE ANY($1::text[])`,
        [patterns]
      ).catch((e) => { throw new Error(`reset failed: ${e.message || e}`); });

      const cleared = reset.rowCount || 0;
      const root = getDefaultLibraryRoot();
      const job = startSyncJob({ root, opts: { recursive: true, forceChunks: false, forcePdfChunks: false, allFileTypes: true } }) || {};

      res.json({
        ok: true,
        cleared,
        extensions: exts,
        root,
        jobId: job?.jobId || null,
        note: "Scan started in background; matching files will re-extract and re-embed.",
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
