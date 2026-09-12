import { requireSession } from '../session-gate.mjs';

export async function mountRagFoldersRoutes(app, deps) {
  const { pool, createPrefixedId, resolveActorContext } = deps;

  app.get("/api/rag-folders", requireSession(), async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const tenantId = req.session?.tenant_id || ctx.tenantId || "default";

      // Create uploads folder if missing
      await pool.query(`
        INSERT INTO rag_folders (id, name, auto_tags, builtin, color, tenant_id, is_global)
        VALUES ('uploads', 'Uploads', '[]'::jsonb, true, 'sapphire', 'default', true)
        ON CONFLICT (id) DO NOTHING
      `);

      let query = "SELECT * FROM rag_folders";
      const params = [];
      if (!ctx.isSuperAdmin) {
        query += " WHERE (tenant_id = $1 OR is_global = true OR builtin = true OR tenant_id = 'default')";
        params.push(tenantId);
      }
      query += " ORDER BY created_at ASC";

      const { rows } = await pool.query(query, params);
      res.json(rows.map(r => ({
        id: r.id,
        name: r.name,
        autoTags: r.auto_tags || [],
        builtin: r.builtin,
        color: r.color,
        createdAt: new Date(r.created_at).getTime(),
        ownerId: r.owner_id,
        tenant_id: r.tenant_id || "default"
      })));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/rag-folders", requireSession(), async (req, res) => {
    const { name, autoTags, color } = req.body;
    const id = createPrefixedId("fld.");
    const tenantId = req.session?.tenant_id || "default";

    try {
      await pool.query(
        `INSERT INTO rag_folders (id, name, auto_tags, builtin, color, owner_id, tenant_id)
         VALUES ($1, $2, $3::jsonb, false, $4, $5, $6)`,
        [id, name, JSON.stringify(autoTags || []), color || "sapphire", req.session?.userId || null, tenantId]
      );
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.patch("/api/rag-folders/:id", requireSession(), async (req, res) => {
    const { name, color } = req.body;
    const updates = [];
    const values = [];
    let i = 1;

    if (name !== undefined) { updates.push(`name=$${i++}`); values.push(name); }
    if (color !== undefined) { updates.push(`color=$${i++}`); values.push(color); }

    if (updates.length > 0) {
      values.push(req.params.id);
      try {
        await pool.query(
          `UPDATE rag_folders SET ${updates.join(", ")} WHERE id=$${i}`,
          values
        );
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e.message || e) });
      }
    }
    res.json({ ok: true });
  });

  app.delete("/api/rag-folders/:id", requireSession(), async (req, res) => {
    try {
      await pool.query("DELETE FROM rag_folders WHERE id=$1 AND builtin=false", [req.params.id]);
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
