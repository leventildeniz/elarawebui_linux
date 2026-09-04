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
      const joinExpr = "k.source_id = s.id::text";
      const { rows: sources } = await pool.query(`
        SELECT s.id::text AS source_id,
               COALESCE(s.metadata->>'url', s.name, '') AS url,
               COUNT(k.id)::int AS chunks,
               COUNT(*) FILTER (WHERE k.brand IS DISTINCT FROM $1)::int AS placeholder
          FROM knowledge_sources s
          JOIN knowledge_chunks k ON ${joinExpr}
         WHERE COALESCE(s.metadata->>'url', s.name, '') <> ''
         GROUP BY s.id, s.name, s.metadata
      `, [null]);

      const transitions = new Map();
      const perSource = [];
      let scanned = 0;
      for (const r of sources) {
        scanned += r.chunks;
        const neu = typeof deriveBrandFromUrl === "function" ? deriveBrandFromUrl(r.url) : null;
        perSource.push({ source_id: r.source_id, url: r.url, neu, chunks: r.chunks });
      }

      const probeBefore = await pool.query(`
        SELECT k.brand AS old_brand, COUNT(*)::int AS n
          FROM knowledge_sources s
          JOIN knowledge_chunks k ON ${joinExpr}
         WHERE COALESCE(s.metadata->>'url', s.name, '') <> ''
         GROUP BY k.brand
      `);
      const before = Object.fromEntries(probeBefore.rows.map(r => [r.old_brand ?? "(null)", r.n]));

      if (dryRun) {
        return res.json({
          ok: true, dryRun: true, join: { name: "canonical", expr: joinExpr },
          sources: sources.length, scanned_chunks: scanned, before,
          sample: perSource.slice(0, 10),
        });
      }

      const client = await pool.connect();
      let updated = 0;
      try {
        await client.query("BEGIN");
        for (const p of perSource) {
          const r = await client.query(
            `UPDATE knowledge_chunks k
                SET metadata = jsonb_set(k.metadata, '{brand}', to_jsonb($1::text))
               FROM knowledge_sources s
              WHERE s.id::text = $2
                AND ${joinExpr}
                AND (k.brand IS DISTINCT FROM $1)`,
            [p.neu, p.source_id]
          );
          if (r.rowCount > 0) {
            updated += r.rowCount;
            const key = `→ ${p.neu ?? "(null)"}`;
            transitions.set(key, (transitions.get(key) || 0) + r.rowCount);
          }
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      res.json({
        ok: true, join: { name: "canonical", expr: joinExpr },
        sources: sources.length, scanned_chunks: scanned, updated,
        before, transitions: Object.fromEntries(transitions),
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
