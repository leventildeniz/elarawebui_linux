export async function mountKnowledgeWebhooksRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId } = deps;

  app.post("/api/knowledge/webhooks", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.body.id || createPrefixedId("wh.");
    const { label, slug, enabled, urlOverride, builtin, ingestToRag, spaceId } = req.body;
    try {
      await pool.query(
        `INSERT INTO knowledge_webhooks (id, label, slug, enabled, url_override, builtin, ingest_to_rag, space_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, label || "New Webhook", slug || id, !!enabled, urlOverride || null, !!builtin, ingestToRag !== false, spaceId || null]
      );
      res.status(201).json({ ok: true, id });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.patch("/api/knowledge/webhooks/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.params.id;
    const { label, slug, enabled, urlOverride, ingestToRag, spaceId } = req.body;
    try {
      const updates = [];
      const values = [];
      let i = 1;

      if (label !== undefined) { updates.push(`label=$${i++}`); values.push(label); }
      if (slug !== undefined) { updates.push(`slug=$${i++}`); values.push(slug); }
      if (enabled !== undefined) { updates.push(`enabled=$${i++}`); values.push(enabled); }
      if (urlOverride !== undefined) { updates.push(`url_override=$${i++}`); values.push(urlOverride); }
      if (ingestToRag !== undefined) { updates.push(`ingest_to_rag=$${i++}`); values.push(ingestToRag); }
      if (spaceId !== undefined) { updates.push(`space_id=$${i++}`); values.push(spaceId); }

      if (updates.length > 0) {
        values.push(id);
        await pool.query(`UPDATE knowledge_webhooks SET ${updates.join(", ")} WHERE id=$${i}`, values);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.delete("/api/knowledge/webhooks/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      await pool.query("DELETE FROM knowledge_webhooks WHERE id=$1 AND builtin=false", [req.params.id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
