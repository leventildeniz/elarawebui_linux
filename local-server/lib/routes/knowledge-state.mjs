export async function mountKnowledgeConfigRoutes(app, deps) {
  const { pool, isAdminCaller } = deps;

  app.get("/api/knowledge/state", async (req, res) => {
    try {
      // Fetch singleton config
      let cfgRes = await pool.query("SELECT * FROM knowledge_config WHERE id='singleton'");
      if (!cfgRes.rows.length) {
        await pool.query("INSERT INTO knowledge_config (id) VALUES ('singleton') ON CONFLICT DO NOTHING");
        cfgRes = await pool.query("SELECT * FROM knowledge_config WHERE id='singleton'");
      }
      const c = cfgRes.rows[0];

      // Fetch sources
      const srcRes = await pool.query("SELECT * FROM knowledge_sources ORDER BY added_at DESC");

      // Dynamic brand aggregation from active sources and collections
      const [brandDbRes, brandStatsRes] = await Promise.all([
        pool.query("SELECT * FROM knowledge_brands ORDER BY id ASC").catch(() => ({ rows: [] })),
        pool.query(`
          SELECT
            LOWER(COALESCE(NULLIF(ks.brand,''), NULLIF(rf.name,''), 'unbranded')) AS brand,
            COUNT(kc.id)::int AS chunk_count,
            MAX(COALESCE(kc.metadata->>'enriched_at', ks.indexed_at::text, ks.added_at::text)) AS last_enriched
          FROM knowledge_sources ks
          LEFT JOIN knowledge_chunks kc ON kc.source_id = ks.id::text
          LEFT JOIN rag_folders rf ON rf.id = ks.folder_id
          WHERE ks.folder_id IS DISTINCT FROM 'uploads'
          GROUP BY 1
        `).catch(() => ({ rows: [] }))
      ]);

      const savedBrandMap = new Map();
      for (const b of brandDbRes.rows) {
        savedBrandMap.set(b.label.toLowerCase(), b);
      }

      const brandMap = new Map();
      for (const s of brandStatsRes.rows) {
        if (!s.brand || s.brand === 'unbranded' || s.brand === 'auto-detect' || s.brand.startsWith('_')) continue;
        const saved = savedBrandMap.get(s.brand);
        const aliases = saved?.aliases || "";
        const daysAgo = s.last_enriched ? Math.max(0, Math.floor((Date.now() - new Date(s.last_enriched).getTime()) / (1000 * 86400))) : 0;
        brandMap.set(s.brand, {
          id: saved?.id || `brand_${s.brand}`,
          brand: s.brand,
          aliases,
          chunks: Number(s.chunk_count || 0),
          enrichedDaysAgo: daysAgo
        });
      }

      for (const b of brandDbRes.rows) {
        const lower = b.label.toLowerCase();
        if (!brandMap.has(lower)) {
          brandMap.set(lower, {
            id: b.id,
            brand: lower,
            aliases: b.aliases || '',
            chunks: Number(b.chunks || 0),
            enrichedDaysAgo: 0
          });
        }
      }

      const brandAliases = Array.from(brandMap.values()).sort((a, b) => (b.chunks ?? 0) - (a.chunks ?? 0));

      const sources = srcRes.rows.map(s => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        brand: s.brand || "auto-detect",
        space: s.space_id || "",
        owner: s.owner_id || "",
        ownerName: s.owner_name || "",
        sizeMb: parseFloat(s.size_mb || "0"),
        folder: s.folder_id || "",
        tags: Array.isArray(s.tags) ? s.tags : [],
        chunks: s.chunks || 0,
        status: s.status,
        addedAt: new Date(s.added_at).getTime(),
        queuedAt: s.queued_at ? new Date(s.queued_at).getTime() : Date.now(),
        stage: s.stage || "",
      }));

      const embedModel = process.env.EMBED_MODEL || process.env.MLX_EMBED_MODEL || c.embed_model || "BAAI/bge-m3";
      const rerankerModel = process.env.RAG_RERANK_MODEL || process.env.RERANK_MODEL || "bge-reranker-v2-m3";

      // Calculate live health directly from database chunks
      const [totalChunksRes, embedHealthRes] = await Promise.all([
        pool.query("SELECT count(*)::int AS total FROM knowledge_chunks").catch(() => ({ rows: [{ total: 0 }] })),
        pool.query(`
          SELECT
            count(*) FILTER (WHERE embedding IS NOT NULL)::int AS embed_ok,
            count(*) FILTER (WHERE embedding IS NULL AND COALESCE(metadata->>'embedding_status','pending') NOT IN ('in_progress','error','stale'))::int AS embed_pending,
            count(*) FILTER (WHERE metadata->>'embedding_status' = 'in_progress')::int AS in_progress,
            count(*) FILTER (WHERE metadata->>'embedding_status' = 'stale')::int AS stale,
            count(*) FILTER (WHERE metadata->>'embedding_status' = 'error')::int AS embed_error,
            count(*) FILTER (WHERE fts IS NULL)::int AS fts_null
          FROM knowledge_chunks
        `).catch(() => ({ rows: [{ embed_ok: 0, embed_pending: 0, in_progress: 0, stale: 0, embed_error: 0, fts_null: 0 }] }))
      ]);

      const liveChunks = Number(totalChunksRes.rows[0]?.total || 0);
      const h = embedHealthRes.rows[0] || {};
      const embedOk = Number(h.embed_ok || 0);
      const embedPending = Number(h.embed_pending || 0);
      const inProgress = Number(h.in_progress || 0);
      const stale = Number(h.stale || 0);
      const embedError = Number(h.embed_error || 0);
      const ftsNull = Number(h.fts_null || 0);

      const state = {
        autoIngestion: c.auto_ingestion,
        autoReEnrich: c.auto_re_enrich,
        batchSize: c.batch_size,
        embedModel,
        rerankerModel,
        health: {
          chunks: liveChunks,
          ftsNull,
          embedOk,
          embedPending,
          inProgress,
          stale,
          embedError,
          parseOk: liveChunks > 0 ? liveChunks : (c.health?.parseOk || 0),
          parseLow: c.health?.parseLow || 0
        },
        sources,
        webhooks: [],
        brandAliases
      };

      res.json(state);
    } catch (e) {
      console.error("[knowledge-state] GET failed:", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.patch("/api/knowledge/config", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { autoIngestion, autoReEnrich, batchSize, embedModel } = req.body;
    try {
      const updates = [];
      const values = [];
      let i = 1;

      if (autoIngestion !== undefined) { updates.push(`auto_ingestion=$${i++}`); values.push(autoIngestion); }
      if (autoReEnrich !== undefined) { updates.push(`auto_re_enrich=$${i++}`); values.push(autoReEnrich); }
      if (batchSize !== undefined) { updates.push(`batch_size=$${i++}`); values.push(batchSize); }
      if (embedModel !== undefined) { updates.push(`embed_model=$${i++}`); values.push(embedModel); }

      if (updates.length > 0) {
        await pool.query(
          `UPDATE knowledge_config SET ${updates.join(", ")}, updated_at=now() WHERE id='singleton'`,
          values
        );
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("[knowledge-config] PATCH failed:", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
