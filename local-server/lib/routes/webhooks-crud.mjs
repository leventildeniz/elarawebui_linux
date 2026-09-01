export async function mountWebhooksCrudRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId, authUtils } = deps;

  app.get("/api/webhooks", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM webhooks ORDER BY created_at DESC");
      res.json(rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description || "",
        tags: r.tags || [],
        category: r.category || "webhook",
        connection: r.connection || "http",
        runner: r.runner || "express",
        vaultScope: r.vault_scope || "none",
        vaultName: r.vault_name || "",
        vaultField: r.vault_field || "",
        config: JSON.stringify(r.config || {}, null, 2),
        risk: r.risk || "low",
        requiresApproval: !!r.requires_approval,
        enabled: !!r.enabled,
        slug: r.slug,
        urlOverride: r.url_override || "",
        ingestToRag: !!r.ingest_to_rag,
        ragSpaceId: r.rag_space_id || "",
        owner: r.owner_id || "",
        ownerName: r.owner_name || "",
        visibility: r.visibility || "workspace",
        sharedWith: r.shared_with || [],
        createdAt: new Date(r.created_at).getTime()
      })));
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/webhooks", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.body.id || createPrefixedId("wh.");
    const m = req.body;
    const ctx = await deps.resolveActorContext(req);
    const owner_id = m.owner_id || m.ownerId || m.owner || ctx.userId || req.actor || null;
    const owner_name = m.owner_name || m.ownerName || null;
    
    try {
      await pool.query(
        `INSERT INTO webhooks (id, name, description, tags, category, connection, runner, vault_scope, vault_name, vault_field, config, risk, requires_approval, enabled, slug, url_override, ingest_to_rag, rag_space_id, owner_id, owner_name, visibility, shared_with)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb)`,
        [
          id, m.name || "New Webhook", m.description || "", JSON.stringify(m.tags || []),
          m.category || "webhook", m.connection || "http", m.runner || "express",
          m.vaultScope || "none", m.vaultName || null, m.vaultField || null,
          m.config || "{}", m.risk || "low", !!m.requiresApproval, m.enabled !== false,
          m.slug || id, m.urlOverride || null, m.ingestToRag !== false, m.ragSpaceId || null,
          owner_id, owner_name, m.visibility || "workspace", JSON.stringify(m.sharedWith || [])
        ]
      );
      res.status(201).json({ ok: true, id });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.patch("/api/webhooks/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.params.id;
    const m = req.body;
    try {
      const updates = [];
      const values = [];
      let i = 1;

      const fields = [
        ['name', 'name'], ['description', 'description'], ['category', 'category'],
        ['connection', 'connection'], ['runner', 'runner'], ['vaultScope', 'vault_scope'],
        ['vaultName', 'vault_name'], ['vaultField', 'vault_field'], ['risk', 'risk'],
        ['slug', 'slug'], ['urlOverride', 'url_override'], ['ragSpaceId', 'rag_space_id']
      ];

      for (const [k, dbk] of fields) {
        if (m[k] !== undefined) { updates.push(`${dbk}=$$${i++}`); values.push(m[k] || null); }
      }
      
      // Ownership updates via COALESCE
      if (m.ownerId !== undefined || m.owner_id !== undefined || m.owner !== undefined) {
        updates.push(`owner_id=COALESCE(webhooks.owner_id, $$${i++})`);
        values.push(m.ownerId || m.owner_id || m.owner || null);
      }
      if (m.ownerName !== undefined || m.owner_name !== undefined) {
        updates.push(`owner_name=COALESCE(webhooks.owner_name, $$${i++})`);
        values.push(m.ownerName || m.owner_name || null);
      }

      if (m.tags !== undefined) { updates.push(`tags=$$${i++}::jsonb`); values.push(JSON.stringify(m.tags)); }
      if (m.config !== undefined) { updates.push(`config=$$${i++}::jsonb`); values.push(m.config || "{}"); }
      if (m.sharedWith !== undefined) { updates.push(`shared_with=$$${i++}::jsonb`); values.push(JSON.stringify(m.sharedWith)); }

      if (m.requiresApproval !== undefined) { updates.push(`requires_approval=$$${i++}`); values.push(m.requiresApproval); }
      if (m.enabled !== undefined) { updates.push(`enabled=$$${i++}`); values.push(m.enabled); }
      if (m.ingestToRag !== undefined) { updates.push(`ingest_to_rag=$$${i++}`); values.push(m.ingestToRag); }
      if (m.visibility !== undefined) { updates.push(`visibility=$$${i++}`); values.push(m.visibility); }

      if (updates.length > 0) {
        values.push(id);
        await pool.query(`UPDATE webhooks SET ${updates.join(", ")}, updated_at=now() WHERE id=$$${i}`, values);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.delete("/api/webhooks/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      await pool.query("DELETE FROM webhooks WHERE id=$1", [req.params.id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
