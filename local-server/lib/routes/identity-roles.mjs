export async function mountIdentityRolesRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId, resolveActorContext } = deps;

  app.get("/api/identity/roles", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      let query = "SELECT * FROM app_roles";
      const params = [];
      if (!ctx?.isSuperAdmin) {
        query += " WHERE (is_system = true OR tenant_id = $1 OR tenant_id = 'default')";
        params.push(ctx?.tenantId || req.session?.tenant_id || "default");
      }
      query += " ORDER BY created_at ASC";

      const { rows } = await pool.query(query, params);
      res.json(rows.map(r => ({
        id: r.id,
        name: r.name,
        provider: r.provider,
        tone: r.tone,
        description: r.description,
        system: !!r.is_system,
        tenant_id: r.tenant_id || "default",
        scopes: Array.isArray(r.scopes) ? r.scopes : [],
        actions: Array.isArray(r.actions) ? r.actions : []
      })));
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/identity/roles", async (req, res) => {
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
    const isAllowed = ctx?.isAdmin || ctx?.isSuperAdmin || ctx?.isTenantAdmin || (typeof isAdminCaller === "function" && await isAdminCaller(req));
    if (!isAllowed) return res.status(403).json({ ok: false, error: "admin required" });

    const id = req.body.id || (typeof createPrefixedId === "function" ? createPrefixedId("role.") : `role.${Math.random().toString(36).slice(2, 8)}`);
    const r = req.body;
    const tenantId = ctx?.isSuperAdmin ? (r.tenant_id || "default") : (ctx?.tenantId || "default");
    const isSystem = ctx?.isSuperAdmin ? !!r.system : false;

    try {
      await pool.query(
        `INSERT INTO app_roles (id, name, provider, tone, description, is_system, scopes, actions, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           provider = EXCLUDED.provider,
           tone = EXCLUDED.tone,
           description = EXCLUDED.description,
           scopes = EXCLUDED.scopes,
           actions = EXCLUDED.actions,
           updated_at = now()`,
        [
          id, r.name, r.provider || "Local", r.tone || "sapphire", 
          r.description || "", isSystem, JSON.stringify(r.scopes || []), JSON.stringify(r.actions || []),
          tenantId
        ]
      );
      res.status(201).json({ ok: true, id });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/identity/roles/:id", async (req, res) => {
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
    const isAllowed = ctx?.isAdmin || ctx?.isSuperAdmin || ctx?.isTenantAdmin || (typeof isAdminCaller === "function" && await isAdminCaller(req));
    if (!isAllowed) return res.status(403).json({ ok: false, error: "admin required" });

    const id = req.params.id;
    const r = req.body;
    
    const { rows } = await pool.query("SELECT * FROM app_roles WHERE id=$1", [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "Role not found" });
    const existing = rows[0];

    if (existing.is_system && !ctx?.isSuperAdmin) {
      return res.status(403).json({ ok: false, error: "Baseline system roles can only be modified by Super-Admin." });
    }
    if (!ctx?.isSuperAdmin && existing.tenant_id !== ctx?.tenantId) {
      return res.status(403).json({ ok: false, error: "Access denied to role outside your organization." });
    }

    const updates = [];
    const values = [];
    let i = 1;
    
    if (r.name !== undefined && (!existing.is_system || ctx?.isSuperAdmin)) { updates.push(`name=$${i++}`); values.push(r.name); }
    if (r.provider !== undefined) { updates.push(`provider=$${i++}`); values.push(r.provider); }
    if (r.tone !== undefined) { updates.push(`tone=$${i++}`); values.push(r.tone); }
    if (r.description !== undefined) { updates.push(`description=$${i++}`); values.push(r.description); }
    if (r.scopes !== undefined) { updates.push(`scopes=$${i++}::jsonb`); values.push(JSON.stringify(r.scopes)); }
    if (r.actions !== undefined) { updates.push(`actions=$${i++}::jsonb`); values.push(JSON.stringify(r.actions)); }

    if (updates.length > 0) {
      updates.push(`updated_at=now()`);
      values.push(id);
      try {
        await pool.query(`UPDATE app_roles SET ${updates.join(", ")} WHERE id=$${i}`, values);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
    } else {
      res.json({ ok: true });
    }
  });

  app.delete("/api/identity/roles/:id", async (req, res) => {
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
    const isAllowed = ctx?.isAdmin || ctx?.isSuperAdmin || ctx?.isTenantAdmin || (typeof isAdminCaller === "function" && await isAdminCaller(req));
    if (!isAllowed) return res.status(403).json({ ok: false, error: "admin required" });

    try {
      const { rows } = await pool.query("SELECT * FROM app_roles WHERE id=$1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: "Role not found" });
      const existing = rows[0];

      if (existing.is_system) {
         return res.status(400).json({ ok: false, error: "Cannot delete a baseline system role." });
      }
      if (!ctx?.isSuperAdmin && existing.tenant_id !== ctx?.tenantId) {
        return res.status(403).json({ ok: false, error: "Access denied to role outside your organization." });
      }

      await pool.query("DELETE FROM app_roles WHERE id=$1", [req.params.id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}