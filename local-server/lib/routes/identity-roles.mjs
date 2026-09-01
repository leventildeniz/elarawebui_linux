export async function mountIdentityRolesRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId } = deps;

  app.get("/api/identity/roles", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM app_roles ORDER BY created_at ASC");
      res.json(rows.map(r => ({
        id: r.id,
        name: r.name,
        provider: r.provider,
        tone: r.tone,
        description: r.description,
        system: r.is_system,
        scopes: Array.isArray(r.scopes) ? r.scopes : [],
        actions: Array.isArray(r.actions) ? r.actions : []
      })));
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/identity/roles", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.body.id || createPrefixedId("role.");
    const r = req.body;
    try {
      await pool.query(
        `INSERT INTO app_roles (id, name, provider, tone, description, is_system, scopes, actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
        [
          id, r.name, r.provider || "Local", r.tone || "sapphire", 
          r.description || "", !!r.system, JSON.stringify(r.scopes || []), JSON.stringify(r.actions || [])
        ]
      );
      res.status(201).json({ ok: true, id });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/identity/roles/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.params.id;
    const r = req.body;
    
    const { rows } = await pool.query("SELECT is_system FROM app_roles WHERE id=$1", [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "Role not found" });
    const isSystem = rows[0].is_system;

    const updates = [];
    const values = [];
    let i = 1;
    
    if (r.name !== undefined && !isSystem) { updates.push(`name=$${i++}`); values.push(r.name); }
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
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      const { rows } = await pool.query("SELECT is_system FROM app_roles WHERE id=$1", [req.params.id]);
      if (rows.length > 0 && rows[0].is_system) {
         return res.status(400).json({ ok: false, error: "Cannot delete a system role" });
      }
      await pool.query("DELETE FROM app_roles WHERE id=$1", [req.params.id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}