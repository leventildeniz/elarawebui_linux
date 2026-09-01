export async function mountIdentityTemplatesRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId } = deps;

  app.get("/api/identity/templates", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM app_templates ORDER BY created_at ASC");
      res.json(rows.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description || "",
        jewel: t.jewel || "sapphire",
        userCanModify: t.user_can_modify !== false,
        sessionCeiling: t.session_ceiling || "12 h",
        userEditable: t.user_editable || {},
        overrides: t.overrides || {},
        custom: t.custom || [],
        grants: t.grants || {},
        assignments: [], // Assignments can be inferred via app_users or groups
        params: t.params || {},
        createdAt: new Date(t.created_at).getTime()
      })));
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/identity/templates", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.body.id || createPrefixedId("tpl.");
    const t = req.body;
    try {
      await pool.query(
        `INSERT INTO app_templates (id, name, description, jewel, user_can_modify, session_ceiling, user_editable, overrides, custom, grants, params)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)`,
        [
          id, t.name || "New Template", t.description || "", t.jewel || "sapphire",
          t.userCanModify !== false, t.sessionCeiling || "12 h",
          JSON.stringify(t.userEditable || {}), JSON.stringify(t.overrides || {}),
          JSON.stringify(t.custom || []), JSON.stringify(t.grants || {}),
          JSON.stringify(t.params || {})
        ]
      );
      res.status(201).json({ ok: true, id });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/identity/templates/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.params.id;
    const t = req.body;
    const updates = [];
    const values = [];
    let i = 1;
    
    if (t.name !== undefined) { updates.push(`name=$${i++}`); values.push(t.name); }
    if (t.description !== undefined) { updates.push(`description=$${i++}`); values.push(t.description); }
    if (t.jewel !== undefined) { updates.push(`jewel=$${i++}`); values.push(t.jewel); }
    if (t.userCanModify !== undefined) { updates.push(`user_can_modify=$${i++}`); values.push(t.userCanModify); }
    if (t.sessionCeiling !== undefined) { updates.push(`session_ceiling=$${i++}`); values.push(t.sessionCeiling); }
    if (t.userEditable !== undefined) { updates.push(`user_editable=$${i++}::jsonb`); values.push(JSON.stringify(t.userEditable)); }
    if (t.overrides !== undefined) { updates.push(`overrides=$${i++}::jsonb`); values.push(JSON.stringify(t.overrides)); }
    if (t.custom !== undefined) { updates.push(`custom=$${i++}::jsonb`); values.push(JSON.stringify(t.custom)); }
    if (t.grants !== undefined) { updates.push(`grants=$${i++}::jsonb`); values.push(JSON.stringify(t.grants)); }
    if (t.params !== undefined) { updates.push(`params=$${i++}::jsonb`); values.push(JSON.stringify(t.params)); }

    if (updates.length > 0) {
      updates.push(`updated_at=now()`);
      values.push(id);
      try {
        await pool.query(`UPDATE app_templates SET ${updates.join(", ")} WHERE id=$${i}`, values);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
    } else {
      res.json({ ok: true });
    }
  });

  app.delete("/api/identity/templates/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      await pool.query("DELETE FROM app_templates WHERE id=$1", [req.params.id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
