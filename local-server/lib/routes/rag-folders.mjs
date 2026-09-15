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

      const userMatches = [req.session?.userId, ctx.userId, req.session?.username, ctx.username, ctx.actor].filter(Boolean);

      let query = "SELECT * FROM rag_folders WHERE ";
      const params = [];
      if (ctx.isSuperAdmin && (req.query?.all === "true" || req.query?.scope === "all")) {
        // SuperAdmin explicitly inspecting all desks across the cluster
        query += "1=1";
      } else {
        // Strict Desk & Tenant Isolation
        params.push(tenantId, userMatches);
        query += "(tenant_id = $1 OR is_global = true OR tenant_id = 'default') AND (builtin = true OR is_global = true OR owner_id = ANY($2) OR lower(owner_id) = ANY($2))";
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
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
    const tenantId = req.session?.tenant_id || ctx.tenantId || "default";
    const ownerId = req.session?.userId || ctx.userId || ctx.actor || null;

    try {
      await pool.query(
        `INSERT INTO rag_folders (id, name, auto_tags, builtin, color, owner_id, tenant_id)
         VALUES ($1, $2, $3::jsonb, false, $4, $5, $6)`,
        [id, name, JSON.stringify(autoTags || []), color || "sapphire", ownerId, tenantId]
      );
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.patch("/api/rag-folders/:id", requireSession(), async (req, res) => {
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
    const tenantId = req.session?.tenant_id || ctx.tenantId || "default";
    const userMatches = [req.session?.userId, ctx.userId, req.session?.username, ctx.username, ctx.actor].filter(Boolean);

    if (!ctx.isSuperAdmin) {
      const chk = await pool.query(
        "SELECT id FROM rag_folders WHERE id = $1 AND builtin = false AND (owner_id = ANY($2) OR lower(owner_id) = ANY($2)) AND tenant_id = $3",
        [req.params.id, userMatches, tenantId]
      );
      if (!chk.rows.length) return res.status(403).json({ ok: false, error: "Access denied to collection" });
    }

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
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const tenantId = req.session?.tenant_id || ctx.tenantId || "default";
      const userMatches = [req.session?.userId, ctx.userId, req.session?.username, ctx.username, ctx.actor].filter(Boolean);

      if (!ctx.isSuperAdmin) {
        const delRes = await pool.query(
          "DELETE FROM rag_folders WHERE id=$1 AND builtin=false AND (owner_id = ANY($2) OR lower(owner_id) = ANY($2)) AND tenant_id=$3",
          [req.params.id, userMatches, tenantId]
        );
        if (delRes.rowCount === 0) return res.status(403).json({ ok: false, error: "Access denied or built-in collection" });
      } else {
        await pool.query("DELETE FROM rag_folders WHERE id=$1 AND builtin=false", [req.params.id]);
      }
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
