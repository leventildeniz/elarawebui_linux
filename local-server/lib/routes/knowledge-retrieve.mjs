// local-server/lib/routes/knowledge-retrieve.mjs
// Block K-3 — Knowledge sources + brands + library-path + embeddings + retrieve.
// 10 endpoints, extracted from server.mjs lines 12241-12679.
// Cache + invalidateSourcesCache live here; server.mjs imports the export
// and passes the same reference to knowledge-sync mount.

import path from "node:path";

// Module-level sources cache (single-flight + 2s TTL).
let __sourcesCache = { at: 0, payload: null, inflight: null };

export function invalidateSourcesCache() {
  __sourcesCache = { at: 0, payload: null, inflight: null };
}

export function mountKnowledgeRetrieveRoutes(app, deps) {
  const {
    pool,
    sseBegin,
    ROLE_RANK,
    normalizeAccessLevel,
    semanticSearch,
    semanticFallback,
    ensureKnowledgeFilesTable,
    ensureKnowledgeChunksTable,
    getLibraryBrands,
    getEmbeddingHealth,
        inspectDirectoryAccess,
    getLibraryRoot,
    setLibraryRoot,
    persistLibraryRoot,
    syncCanonicalLibraryPaths,
    ensureWorker,
    pushLog,
    reindexRoot,
    sjClaim, sjRelease, sjHeartbeat, sjCheckStop, sjHost, sjPid,
    EMBED_WORKER_PORT,
    EMBED_DIM_TARGET,
    ragSettings,
    embedAndStoreChunks,
    expandQueryTerms,
    aliasMatchedBrand,
    buildOrTsQuery,
    semanticAssistThreshold,
    isTechnicalQuery,
  } = deps;

  // ---- /api/knowledge/search ------------------------------------------------
  app.get("/api/knowledge/search", async (req, res) => {
    const q = String(req.query?.q ?? "").trim();
    const role = String(req.query?.role ?? "Viewer").trim();
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 25));
    if (!q) return res.json({ ok: true, results: [], denied: 0 });
    const userRank = ROLE_RANK[normalizeAccessLevel(role)] ?? 0;
    const allowedLevels = Object.entries(ROLE_RANK)
      .filter(([, rank]) => rank <= userRank)
      .map(([name]) => name);
    try {
      if (allowedLevels.length === 0) {
        return res.json({ ok: true, results: [], denied: 0 });
      }
      const chunks = await semanticSearch({ q, allowedLevels, limit: Math.min(limit, 20), minScore: 0.01, candidateDepth: Math.max(25, limit) });
      const ids = Array.from(new Set(chunks.map(r => String(r.source_id || "")).filter(Boolean))).slice(0, limit);
      if (!ids.length) return res.json({ ok: true, results: [], denied: 0, retriever: "semantic" });
      const fileRows = await pool.query(
        `SELECT id, name, path, ext, size_bytes, access_level FROM knowledge_files WHERE id = ANY($1::text[])`,
        [ids]
      );
      const scoreById = new Map(chunks.map(r => [String(r.source_id), Number(r.score) || 0]));
      const order = new Map(ids.map((id, i) => [id, i]));
      const rows = fileRows.rows
        .map(r => ({ ...r, rank: scoreById.get(String(r.id)) ?? 0 }))
        .sort((a, b) => (order.get(String(a.id)) ?? 9999) - (order.get(String(b.id)) ?? 9999));
      res.json({ ok: true, results: rows, denied: 0, retriever: chunks[0]?.retriever || "semantic" });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  // ---- /api/knowledge/sources ----------------------------------------------
  async function loadKnowledgeSourcesPayload() {
    await ensureKnowledgeFilesTable();
    const dirs = await pool.query(
      `SELECT root,
              COUNT(*)::int          AS files,
              COALESCE(SUM(chunks),0)::int AS chunks,
              MAX(indexed_at)        AS indexed_at
         FROM knowledge_files
        GROUP BY root
        ORDER BY MAX(indexed_at) DESC`
    );
    const urls = await pool.query(
      `SELECT s.id, s.name, s.type, s.tag, s.url, s.chunks, s.created_at, s.crawl_config,
              COALESCE(c.child_count, 0)::int  AS child_count,
              COALESCE(c.child_chunks, 0)::int AS child_chunks,
              (
                SELECT brand FROM knowledge_chunks
                 WHERE source_id = s.id::text AND brand IS NOT NULL AND brand <> ''
                 GROUP BY brand ORDER BY COUNT(*) DESC LIMIT 1
              ) AS brand
         FROM knowledge_sources s
         LEFT JOIN (
           SELECT parent_id::text                  AS parent_id,
                  COUNT(*)::int                    AS child_count,
                  COALESCE(SUM(chunks), 0)::int    AS child_chunks
             FROM knowledge_sources
            WHERE parent_id IS NOT NULL
            GROUP BY parent_id
         ) c ON c.parent_id = s.id::text
        WHERE s.parent_id IS NULL
        ORDER BY s.created_at DESC`
    );
    const dirSources = dirs.rows.map((r) => ({
      id: `dir:${r.root}`,
      name: r.root,
      type: "drive",
      chunks: r.chunks,
      progress: 100,
      tag: "Local Directory",
      notes: `files=${r.files} · last index ${new Date(r.indexed_at).toLocaleString()}`,
    }));
    const urlSources = urls.rows.map((r) => {
      const totalChunks = (r.chunks ?? 0) + (r.child_chunks ?? 0);
      const cc = r.crawl_config || null;
      const notes = r.child_count > 0
        ? `crawl · ${r.child_count} pages · ${totalChunks} chunks${cc?.recursive ? ` · depth ${cc.maxDepth ?? "?"}` : ""}`
        : undefined;
      return {
        id: r.id,
        name: r.name,
        type: r.type === "url" ? "url" : "file",
        chunks: totalChunks,
        progress: 100,
        url: r.url ?? undefined,
        tag: r.tag ?? undefined,
        brand: r.brand ?? null,
        crawlConfig: cc,
        childCount: r.child_count ?? 0,
        notes,
      };
    });
    return { ok: true, sources: [...dirSources, ...urlSources] };
  }

  app.get("/api/knowledge/sources", async (_req, res) => {
    try {
      const now = Date.now();
      if (__sourcesCache.payload && now - __sourcesCache.at < 2000) {
        return res.json(__sourcesCache.payload);
      }
      if (!__sourcesCache.inflight) {
        __sourcesCache.inflight = loadKnowledgeSourcesPayload()
          .then((p) => { __sourcesCache = { at: Date.now(), payload: p, inflight: null }; return p; })
          .catch((e) => { __sourcesCache.inflight = null; throw e; });
      }
      res.json(await __sourcesCache.inflight);
    } catch (e) {
      console.error("[knowledge/sources] query failed:", e?.stack || e?.message || e);
      __sourcesCache = { at: 0, payload: null, inflight: null };
      res.status(500).json({ ok: false, error: String(e.message || e), sources: [] });
    }
  });

  // ---- PATCH /api/knowledge/source/:id ---------------------------------------
  app.patch("/api/knowledge/source/:id", async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "source id required" });

      const updates = [];
      const values = [];
      let i = 1;

      if (req.body.tags !== undefined) {
        updates.push(`tags=$${i++}::jsonb`);
        values.push(JSON.stringify(req.body.tags));
      }

      if (req.body.brand !== undefined) {
        const raw = req.body.brand;
        const brand = raw == null || String(raw).trim() === "" ? null : String(raw).trim().slice(0, 64);
        updates.push(`brand=$${i++}`);
        values.push(brand);
      }

      if (req.body.status !== undefined) {
        updates.push(`status=$${i++}`);
        values.push(req.body.status);
      }
      
      if (req.body.stage !== undefined) {
        updates.push(`stage=$${i++}`);
        values.push(req.body.stage);
      }

      if (updates.length > 0) {
        values.push(id);
        await pool.query(
          `UPDATE knowledge_sources SET ${updates.join(", ")} WHERE id=$${i}`,
          values
        );
      }
      
      invalidateSourcesCache();
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---- PATCH /api/knowledge/source/:id/brand -------------------------------
  app.patch("/api/knowledge/source/:id/brand", async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "source id required" });
      const raw = req.body?.brand;
      const brand = raw == null || String(raw).trim() === "" ? null : String(raw).trim().slice(0, 64);
      const r = await pool.query(
        `UPDATE knowledge_chunks SET brand=$1 WHERE source_id=$2`,
        [brand, id],
      );
      invalidateSourcesCache();
      res.json({ ok: true, id, brand, updated: r.rowCount });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---- /api/knowledge/library-brands ---------------------------------------
  // GET: filtered list (gate-eligible, respects libraryBrandMinChunks).
  // GET ?counts=1: raw brand → chunk count map (no threshold) for diagnosis.
  app.get("/api/knowledge/library-brands", async (req, res) => {
    try {
      if (req.query?.counts) {
        const r = await pool.query(
          `SELECT brand,
                  COUNT(*)::int AS total_chunks,
                  COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded_chunks
             FROM knowledge_chunks
             WHERE brand IS NOT NULL AND brand <> ''
             GROUP BY brand
             ORDER BY total_chunks DESC, brand ASC
             LIMIT 200`,
        );
        return res.json({ ok: true, count: r.rows.length, brands: r.rows });
      }
      const brands = await getLibraryBrands();
      res.json({ ok: true, count: brands.length, brands });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e), brands: [] });
    }
  });

  // ---- /api/knowledge/embeddings/health ------------------------------------
  app.get("/api/knowledge/embeddings/health", async (_req, res) => {
    try {
      const health = await getEmbeddingHealth();
      res.json(health);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // ---- /api/knowledge/embeddings/library-path/validate ---------------------
  app.post("/api/knowledge/embeddings/library-path/validate", async (req, res) => {
    try {
      const candidate = path.resolve(process.cwd(), String(req.body?.path || "").trim().replace(/^~\/?/, ""));
      if (!candidate || candidate === "/") return res.status(400).json({ ok: false, error: "path required" });
      const access = await inspectDirectoryAccess(candidate, { recursive: false, sampleLimit: 8 });
      const verified = !!access.exists && !!access.isDirectory && !!access.readable;
      res.json({ ok: verified, path: candidate, access, verified });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // ---- /api/knowledge/embeddings/library-path (save+optional scan) ---------
  app.post("/api/knowledge/embeddings/library-path", async (req, res) => {
    try {
      const candidate = path.resolve(process.cwd(), String(req.body?.path || "").trim().replace(/^~\/?/, ""));
      if (!candidate || candidate === "/") return res.status(400).json({ ok: false, error: "path required" });
      const access = await inspectDirectoryAccess(candidate, { recursive: false, sampleLimit: 8 });
      if (!access.exists || !access.isDirectory || !access.readable) {
        return res.status(400).json({ ok: false, error: "path is not a readable directory", access });
      }
      setLibraryRoot(candidate);
      persistLibraryRoot(candidate);
      const pathSync = await syncCanonicalLibraryPaths().catch((e) => ({ error: e.message }));
      let scan = null;
      if (req.body?.scan) {
        ensureWorker().catch((e) => pushLog("worker", `[ensure-error] ${e?.message || e}`));
        scan = { started: true, async: true, root: candidate };
        reindexRoot(candidate, { recursive: true, forcePdfChunks: true, forceChunks: true, allFileTypes: true })
          .then((r) => console.log("[library:apply-scan] done", r?.scanned ?? 0, "scanned"))
          .catch((e) => console.warn("[library:apply-scan] failed", e?.message || e));
      }
      const health = await getEmbeddingHealth();
      res.json({ ok: true, path: candidate, pathSync, scan, ...health });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // ---- /api/knowledge/embeddings/mark-pending ------------------------------
  app.post("/api/knowledge/embeddings/mark-pending", async (req, res) => {
    try {
      await ensureKnowledgeChunksTable();
      const retryErrors = !!req.body?.retryErrors;
      const r = await pool.query(
        `UPDATE knowledge_chunks
            SET embedding_status='pending', embedded_at=NULL, embedding_attempts=0
          WHERE embedding IS NULL
             OR embedding_status IS NULL
             OR embedding_status='pending'
             OR ($1::boolean AND embedding_status='error')`,
        [retryErrors]
      );
      if (typeof deps.ragAutoEmbedDrain === "function") {
        setTimeout(() => { deps.ragAutoEmbedDrain().catch(() => {}); }, 100).unref?.();
      }
      const health = await getEmbeddingHealth();
      res.json({ ok: true, marked: r.rowCount || 0, ...health });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // ---- /api/knowledge/embeddings/backfill (SSE) ----------------------------
  app.post("/api/knowledge/embeddings/backfill", async (req, res) => {
        const claim = await sjClaim(pool, "backfill", { batch: Number(req.body?.batch) || 32, retryErrors: !!req.body?.retryErrors })
      .catch((e) => ({ conflict: true, owner: { error: String(e?.message || e) } }));
    if (claim.conflict) {
      return res.status(409).json({
        ok: false,
        error: "backfill already running on another host",
        owner: claim.owner,
        currentHost: sjHost(),
      });
    }
    const jobId = claim.id;
    const batch = Math.min(128, Math.max(8, Number(req.body?.batch) || 32));
    const max   = Math.max(0, Number(req.body?.max) || 0);
    const retryErrors = !!req.body?.retryErrors;
    let scanned = 0, written = 0, errors = 0;
    const sse = sseBegin(req, res);
    const send = sse.send;

    send({ phase: "claim", jobId, ownerHost: sjHost(), ownerPid: sjPid() });

    send({ phase: "worker-starting", port: EMBED_WORKER_PORT, model: "default" });
    const workerReady = await ensureWorker().catch((e) => ({ status: "down", error: String(e?.message || e) }));
    send({ phase: "worker-ready", port: EMBED_WORKER_PORT, ...workerReady });
    if (workerReady.status === "down") {
      send({ error: workerReady.error || "embedding worker failed to start" });
      await sjRelease(pool, jobId, "error", workerReady.error || "worker down");
      return res.end();
    }

    try {
      const pathSync = await syncCanonicalLibraryPaths();
      send({ phase: "path-sync", ...pathSync });
      const seeded = await pool.query(`SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE root=$1`, [getLibraryRoot()]).catch(() => ({ rows: [{ n: 0 }] }));
      if (Number(seeded.rows[0]?.n || 0) === 0) {
        send({ phase: "no-chunks-to-embed", root: getLibraryRoot(), hint: "Add Source or hit Sync to ingest from disk." });
      }
    } catch (e) {
      send({ phase: "path-sync", warn: String(e.message || e) });
    }

    try {
      const stat = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE embedding IS NULL)                                AS missing,
          COUNT(*) FILTER (WHERE embedding IS NULL OR COALESCE(embedding_status,'pending')='pending') AS pending,
          COUNT(*) FILTER (WHERE embedding_status='ok' AND embedding IS NOT NULL)  AS done,
          COUNT(*) FILTER (WHERE embedding_status='error')                         AS errored,
          COUNT(*)                                                                 AS total
        FROM knowledge_chunks
      `);
      send({ phase: "ready", dim: EMBED_DIM_TARGET, ...stat.rows[0] });
    } catch (e) {
      send({ phase: "ready", dim: EMBED_DIM_TARGET, warn: String(e.message || e) });
    }

    const whereClause = retryErrors
      ? `(embedding IS NULL OR COALESCE(embedding_status,'pending') IN ('pending','error'))`
      : `(embedding IS NULL OR COALESCE(embedding_status,'pending') = 'pending')`;

    let stopped = false;
    let finalStatus = "done";
    try {
      let lastId = 0;
      while (true) {
        if (await sjCheckStop(pool, jobId)) { stopped = true; break; }
        const r = await pool.query(
          `SELECT id,
                  CASE WHEN $3::int = 1 THEN COALESCE(content_enriched, content) ELSE content END AS content
             FROM knowledge_chunks
            WHERE ${whereClause} AND id > $1
            ORDER BY id LIMIT $2`,
          [lastId, batch, (ragSettings().useEnrichedContent ? 1 : 0)]
        ).catch((e) => { send({ warn: "select_failed", detail: String(e.message||e) }); return { rows: [] }; });

        if (!r.rows.length) break;
        lastId = Number(r.rows[r.rows.length - 1].id);
        scanned += r.rows.length;
        await pool.query(
          `SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE id = ANY($1::bigint[]) AND embedding_status='ok'`,
          [r.rows.map(x => x.id)]
        ).catch(() => ({ rows: [{ n: 0 }] }));
        const w = await embedAndStoreChunks(
          r.rows.map(x => x.id),
          r.rows.map(x => String(x.content).slice(0, 1500))
        );
        written += w;
        const afterErr = await pool.query(
          `SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE id = ANY($1::bigint[]) AND embedding_status='error'`,
          [r.rows.map(x => x.id)]
        ).catch(() => ({ rows: [{ n: 0 }] }));
        errors += (afterErr.rows[0]?.n || 0) - 0;
        await sjHeartbeat(pool, jobId, { scanned, written, errors });
        send({ scanned, written, errors, lastId });
        if (max && scanned >= max) break;
        if (w === 0 && (afterErr.rows[0]?.n || 0) === 0) {
          send({ warn: "no_progress — embedding endpoint timeout/error" }); break;
        }
      }
      if (stopped) {
        finalStatus = "cancelled";
        send({ done: true, stopped: true, scanned, written, errors, dim: EMBED_DIM_TARGET });
      } else {
        send({ done: true, scanned, written, errors, dim: EMBED_DIM_TARGET });
      }
    } catch (e) {
      finalStatus = "error";
      send({ error: String(e.message || e) });
    } finally {
      await sjRelease(pool, jobId, finalStatus, finalStatus === "error" ? "see stream" : null).catch(() => {});
      res.end();
    }
  });

  // ---- /api/knowledge/retrieve ---------------------------------------------
  app.post("/api/knowledge/retrieve", async (req, res) => {
    const q = String(req.body?.query ?? "").trim();
    const role = String(req.body?.role ?? "Viewer").trim();
    const limit = Math.min(8, Math.max(1, Number(req.body?.limit) || 5));
    const expanded = expandQueryTerms(q);
    const searchedKeywords = expanded.slice(0, 12);
    if (!q) return res.json({ ok: true, context: "", sources: [], denied: 0, searchedKeywords: [] });
    const userRank = ROLE_RANK[normalizeAccessLevel(role)] ?? 0;
    const allowedLevels = Object.entries(ROLE_RANK)
      .filter(([, rank]) => rank <= userRank).map(([name]) => name);
    try {
      if (!allowedLevels.length) {
        return res.json({ ok: true, context: "", sources: [], denied: 0, searchedKeywords,
          notice: "Yetkiniz dahilinde bu dökümana ulaşılamadı" });
      }
      const brandRows = await pool.query("SELECT DISTINCT brand FROM knowledge_chunks WHERE brand IS NOT NULL").catch(() => ({ rows: [] }));
      const matchedBrand = aliasMatchedBrand(q, brandRows.rows.map(r => r.brand).filter(Boolean));
      const orQuery = buildOrTsQuery(expanded.length ? expanded : [q]);
      let rows = [];
      let retriever = null;
      if (orQuery) {
        const brandBoostExpr = matchedBrand ? `(CASE WHEN brand = $3 THEN 0.25 ELSE 0 END)` : `0::float`;
        const params = [orQuery, allowedLevels];
        if (matchedBrand) params.push(matchedBrand);
        params.push(limit);
        const limitSlot = matchedBrand ? "$4" : "$3";
        const r1 = await pool.query(
          `SELECT source_id, path, ord, brand, access_level, content, page_start, page_end,
                  (ts_rank(tsv, to_tsquery('simple', $1)) + ${brandBoostExpr}) AS score
             FROM knowledge_chunks
            WHERE tsv @@ to_tsquery('simple', $1)
              AND access_level = ANY($2::text[])
            ORDER BY score DESC LIMIT ${limitSlot}`, params
        ).catch((e) => { console.error("[rag:retrieve:fts]", String(e.message||e)); return { rows: [] }; });
        rows = r1.rows;
        if (rows.length) retriever = "fts-or";
      }
      if (!rows.length) {
        const patterns = searchedKeywords.map(t => `%${t}%`);
        const r2 = await pool.query(
          `SELECT source_id, path, ord, brand, access_level, content, page_start, page_end,
                  0.05 AS score
             FROM knowledge_chunks
            WHERE access_level = ANY($1::text[])
              AND (($2::text[] <> '{}'::text[] AND (content ILIKE ANY($2::text[]) OR path ILIKE ANY($2::text[]))) OR content ILIKE $3 OR path ILIKE $3)
            ORDER BY score DESC, length(content) ASC LIMIT $4`,
          [allowedLevels, patterns, `%${q}%`, limit]
        ).catch(() => ({ rows: [] }));
        rows = r2.rows;
        if (rows.length) retriever = "ilike-expanded";
      }
      const topScore = rows.length ? Math.max(...rows.map(r => Number(r.score) || 0)) : 0;
      if (isTechnicalQuery(q, expanded) || !rows.length || rows.length < limit || topScore < semanticAssistThreshold()) {
        const sem = await semanticFallback({ q, allowedLevels, matchedBrand: null, limit });
        if (sem.length) {
          const merged = new Map(rows.map(r => [`${r.source_id}:${r.ord}`, r]));
          for (const r of sem) {
            const key = `${r.source_id}:${r.ord}`;
            const cur = merged.get(key);
            if (!cur || Number(r.score || 0) > Number(cur.score || 0)) merged.set(key, r);
          }
          rows = [...merged.values()].sort((a,b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, limit);
          retriever = retriever ? `${retriever}+${sem[0].retriever || "semantic"}` : (sem[0].retriever || "semantic");
        }
      }
      const context = rows.map((r, i) => {
        const fn = path.basename(r.path || "");
        const page = r.page_start ? ` · sayfa ${r.page_start}${r.page_end && r.page_end !== r.page_start ? `-${r.page_end}` : ""}` : "";
        return `[Source ${i + 1}: ${fn}${page} · chunk #${r.ord ?? 0} · skor ${Math.round(Math.min(1, Number(r.score)||0)*100)}% · ${r.access_level}]\n${String(r.content || "").slice(0, 1500)}`;
      }).join("\n\n---\n\n");
      res.json({
        ok: true, context, denied: 0, retriever, searchedKeywords,
        sources: rows.map((r, i) => ({ index: i + 1, id: r.source_id, name: path.basename(r.path || ""), path: r.path, ord: r.ord, page: r.page_start ?? null, pageEnd: r.page_end ?? r.page_start ?? null, score: Math.round(Math.min(1, Number(r.score)||0)*100), brand: r.brand || null, access_level: r.access_level })),
        notice: rows.length ? null : `Queried knowledge index with keywords: ${searchedKeywords.join(", ") || q}`,
      });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e), searchedKeywords }); }
  });
}
