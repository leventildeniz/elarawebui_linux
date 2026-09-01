// knowledge-audit.mjs — read-only audit/diagnostic knowledge endpoints
// (K-4a). Extracted from server.mjs to keep the monolith shrinking.
//
// Endpoints (all GET):
//   /api/knowledge/chunk-preview  — preview chunk breakdown for a file
//   /api/knowledge/brand-audit    — which brands hold chunks for term q
//   /api/knowledge/chunk-report   — global + per-root chunk stats
//   /api/knowledge/collections    — source list (with chunk fallback)
//   /api/knowledge/brands         — brand summary with file/chunk counts

export function mountKnowledgeAuditRoutes(app, deps) {
  const {
    pool,
    chunkTextDetailed,
    isTableLine,
    isListLine,
    CHUNK_SIZE,
    CHUNK_OVERLAP,
    aliasMatchedBrand,
    ensureKnowledgeChunksTable,
    ensureKnowledgeFilesTable,
    resolveLibraryRoot,
    inspectDirectoryAccess,
    getDefaultLibraryRoot,
    resolveJoinExpr,
  } = deps;

  app.get("/api/knowledge/chunk-preview", async (req, res) => {
    try {
      const id = String(req.query.id || "").trim();
      const p  = String(req.query.path || "").trim();
      if (!id && !p) return res.status(400).json({ ok: false, error: "id or path required" });
      const r = id
        ? await pool.query("SELECT id, name, path, content FROM knowledge_files WHERE id=$1", [id])
        : await pool.query("SELECT id, name, path, content FROM knowledge_files WHERE path=$1 LIMIT 1", [p]);
      const row = r.rows[0];
      if (!row) return res.status(404).json({ ok: false, error: "file not found" });
      const chunks = chunkTextDetailed(row.content || "");
      const stats = chunks.map((c, i) => {
        const lines = c.content.split("\n");
        return {
          ord: i,
          page: c.page,
          chars: c.content.length,
          lines: lines.length,
          tableLines: lines.filter(isTableLine).length,
          listLines:  lines.filter(isListLine).length,
          startsTable: isTableLine(lines[0] || ""),
          endsTable:   isTableLine(lines[lines.length - 1] || ""),
          preview: c.content.slice(0, 240).replace(/\s+/g, " "),
        };
      });
      res.json({
        ok: true,
        file: { id: row.id, name: row.name, path: row.path, chars: (row.content || "").length },
        chunkSize: CHUNK_SIZE, overlap: CHUNK_OVERLAP,
        total: chunks.length,
        oversized: stats.filter(s => s.chars > CHUNK_SIZE * 1.4).length,
        stats,
      });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  // /api/knowledge/brand-audit — operator diagnostic for brand isolation.
  // Usage: GET /api/knowledge/brand-audit?q=R82 → shows which brand chunks
  // containing the term are filed under (catches mis-tagged Checkpoint docs).
  app.get("/api/knowledge/brand-audit", async (req, res) => {
    try {
      const q = String(req.query.q || "").slice(0, 200).trim();
      if (!q) return res.status(400).json({ ok: false, error: "q required" });
      const distinctBrands = await pool.query(
        "SELECT DISTINCT brand FROM knowledge_chunks WHERE brand IS NOT NULL ORDER BY 1"
      ).catch(() => ({ rows: [] }));
      const knownBrands = distinctBrands.rows.map(r => r.brand);
      const matchedBrand = aliasMatchedBrand(q, knownBrands);
      const byBrand = await pool.query(
        `SELECT brand, COUNT(*) AS chunks, COUNT(DISTINCT path) AS files
         FROM knowledge_chunks
         WHERE content ILIKE $1 OR path ILIKE $1
         GROUP BY brand ORDER BY chunks DESC LIMIT 30`,
        [`%${q}%`]
      ).catch(() => ({ rows: [] }));
      const samplePaths = await pool.query(
        `SELECT DISTINCT path, brand FROM knowledge_chunks
         WHERE content ILIKE $1 OR path ILIKE $1 LIMIT 15`, [`%${q}%`]
      ).catch(() => ({ rows: [] }));
      res.json({
        ok: true, q, knownBrands, matchedBrand,
        hitsByBrand: byBrand.rows, samplePaths: samplePaths.rows,
      });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.get("/api/knowledge/chunk-report", async (req, res) => {
    try {
      await ensureKnowledgeChunksTable();
      await ensureKnowledgeFilesTable();
      const q = String(req.query.q || "").slice(0, 200).trim();
      const reportRoot = resolveLibraryRoot(req.query.root);
      const like = `%${q}%`;
      const globalTotals = await pool.query(
        `SELECT COUNT(*)::int AS chunks, COUNT(DISTINCT file_id)::int AS files, COUNT(DISTINCT path)::int AS paths, COUNT(DISTINCT root)::int AS roots,
                MIN(ord)::int AS min_ord, MAX(ord)::int AS max_ord,
                MIN(page_start)::int AS first_page, MAX(page_end)::int AS last_page
           FROM knowledge_chunks`
      );
      const rootTotals = await pool.query(
        `SELECT COUNT(*)::int AS chunks, COUNT(DISTINCT file_id)::int AS files, COUNT(DISTINCT path)::int AS paths,
                MIN(page_start)::int AS first_page, MAX(page_end)::int AS last_page
           FROM knowledge_chunks WHERE root=$1`, [reportRoot]
      );
      const totals = await pool.query(
        `SELECT COUNT(*)::int AS chunks, COUNT(DISTINCT file_id)::int AS files, COUNT(DISTINCT path)::int AS paths,
                MIN(ord)::int AS min_ord, MAX(ord)::int AS max_ord,
                MIN(page_start)::int AS first_page, MAX(page_end)::int AS last_page
         FROM knowledge_chunks
         ${q ? "WHERE path ILIKE $1 OR content ILIKE $1" : ""}`,
        q ? [like] : []
      );
      const byFile = await pool.query(
        `SELECT path, root, brand, COUNT(*)::int AS chunks, MIN(page_start)::int AS first_page, MAX(page_end)::int AS last_page
         FROM knowledge_chunks
         ${q ? "WHERE path ILIKE $1 OR content ILIKE $1" : ""}
         GROUP BY path, root, brand
         ORDER BY chunks DESC, path ASC
         LIMIT 25`,
        q ? [like] : []
      );
      const roots = await pool.query(
        `SELECT root, COUNT(*)::int AS chunks, COUNT(DISTINCT path)::int AS files, MAX(created_at) AS last_chunk_at
           FROM knowledge_chunks
          GROUP BY root ORDER BY chunks DESC LIMIT 25`
      );
      const filesystem = await inspectDirectoryAccess(reportRoot, { recursive: true, sampleLimit: 20 });
      res.json({
        ok: true,
        q: q || null,
        defaultRoot: getDefaultLibraryRoot(),
        root: reportRoot,
        filesystem,
        database: { total: globalTotals.rows[0], root: rootTotals.rows[0], roots: roots.rows },
        query: totals.rows[0],
        filesDetail: byFile.rows,
      });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.get("/api/knowledge/collections", async (_req, res) => {
    try {
      const probe = await pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_name IN ('knowledge_sources','knowledge_chunks')`,
      );
      const has = (t, c) => probe.rows.some((r) => r.table_name === t && r.column_name === c);
      const items = [];
      let mode = "sources";
      let joinName = null;

      if (has("knowledge_sources", "id")) {
        const nameCol = has("knowledge_sources", "name") ? "name"
          : has("knowledge_sources", "title") ? "title"
          : has("knowledge_sources", "path") ? "path" : null;
        const brandCol = has("knowledge_sources", "brand") ? "brand" : null;
        let joinExpr = "k.file_id = s.id::text";
        try {
          const j = await resolveJoinExpr({ force: false });
          joinExpr = j.expr || joinExpr;
          joinName = j.fallback ? `${j.name} (fallback)` : j.name;
        } catch { /* keep placeholder */ }
        const select = [
          "s.id::text AS id",
          nameCol ? `s.${nameCol} AS name` : "s.id::text AS name",
          brandCol ? `s.${brandCol} AS brand` : "NULL::text AS brand",
          `COALESCE((SELECT COUNT(*)::int FROM knowledge_chunks k WHERE ${joinExpr}), 0) AS chunks`,
        ].join(", ");
        const { rows } = await pool.query(
          `SELECT ${select} FROM knowledge_sources s
            ORDER BY ${nameCol ? `s.${nameCol}` : "s.id"} LIMIT 500`,
        );
        for (const r of rows) items.push(r);
      }

      const totalChunks = items.reduce((n, r) => n + (Number(r.chunks) || 0), 0);
      if ((!items.length || totalChunks === 0) && has("knowledge_chunks", "file_id")) {
        mode = "chunks-fallback";
        const fallbackSelect = [
          "k.file_id::text AS id",
          has("knowledge_chunks", "path")
            ? "COALESCE(MAX(k.path), k.file_id::text) AS name"
            : "k.file_id::text AS name",
          has("knowledge_chunks", "brand") ? "MAX(k.brand) AS brand" : "NULL::text AS brand",
          "COUNT(*)::int AS chunks",
        ].join(", ");
        const { rows } = await pool.query(
          `SELECT ${fallbackSelect} FROM knowledge_chunks k
            WHERE k.file_id IS NOT NULL
            GROUP BY k.file_id
            ORDER BY chunks DESC
            LIMIT 500`,
        );
        if (!items.length) items.push(...rows);
        else if (totalChunks === 0) { items.length = 0; items.push(...rows); }
      }

      res.json({ ok: true, items, mode, join: joinName });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Brand-level knowledge summary. DB-driven (no static list).
  app.get("/api/knowledge/brands", async (_req, res) => {
    try {
      const probe = await pool.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name='knowledge_chunks' AND column_name IN ('brand','file_id')`,
      );
      const has = (c) => probe.rows.some((r) => r.column_name === c);
      if (!has("brand")) return res.json({ ok: true, items: [] });
      const fileExpr = has("file_id") ? "COUNT(DISTINCT file_id)::int" : "0";
      const { rows } = await pool.query(
        `SELECT brand,
                ${fileExpr} AS files,
                COUNT(*)::int AS chunks
           FROM knowledge_chunks
          WHERE brand IS NOT NULL AND brand <> ''
          GROUP BY brand
          ORDER BY chunks DESC`,
      );
      res.json({ ok: true, items: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
