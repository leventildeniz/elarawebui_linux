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

      // Fetch brand aliases (aggregate chunks per brand)
      const brandRes = await pool.query("SELECT * FROM knowledge_brands ORDER BY id ASC");

      // Map sources
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

      // Map brand aliases
      const brandAliases = brandRes.rows.map(b => ({
        id: b.id,
        brand: b.label,
        aliases: "", // aliases might need a separate mapping or just live on knowledge_brands
        chunks: b.chunks || 0,
        enrichedDaysAgo: 0
      }));

      const embedModel = process.env.EMBED_MODEL || process.env.MLX_EMBED_MODEL || c.embed_model || "BAAI/bge-m3";
      const rerankerModel = process.env.RAG_RERANK_MODEL || process.env.RERANK_MODEL || "bge-reranker-v2-m3";

      const state = {
        autoIngestion: c.auto_ingestion,
        autoReEnrich: c.auto_re_enrich,
        batchSize: c.batch_size,
        embedModel,
        rerankerModel,
        health: {
          chunks: c.health?.chunks || 0,
          ftsNull: c.health?.ftsNull || 0,
          embedOk: c.health?.embedOk || 0,
          embedPending: c.health?.embedPending || 0,
          inProgress: c.health?.inProgress || 0,
          stale: c.health?.stale || 0,
          embedError: c.health?.embedError || 0,
          parseOk: c.health?.parseOk || 0,
          parseLow: c.health?.parseLow || 0
        },
        sources,
        webhooks: [], // Kept as empty array just in case frontend legacy store needs it temporarily
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
