export async function mountIdentityGroupsRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId, resolveActorContext } = deps;

  app.get("/api/identity/groups", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      let query = "SELECT * FROM app_groups";
      const params = [];
      if (!ctx.isSuperAdmin) {
        query += " WHERE tenant_id = $1 OR is_global = true OR tenant_id = 'default'";
        params.push(ctx.tenantId || "default");
      }
      query += " ORDER BY created_at ASC";

      const { rows: groups } = await pool.query(query, params);
      const { rows: users } = await pool.query(
        ctx.isSuperAdmin 
          ? "SELECT id, groups FROM app_users"
          : "SELECT id, groups FROM app_users WHERE tenant_id = $1 OR tenant_id = 'default'",
        ctx.isSuperAdmin ? [] : [ctx.tenantId || "default"]
      );

      const mappedGroups = groups.map(g => {
        // Find users that have this group id in their groups array
        const members = users
          .filter(u => Array.isArray(u.groups) && u.groups.includes(g.id))
          .map(u => u.id);

        return {
          id: g.id,
          name: g.name,
          provider: g.provider,
          defaultRole: g.role,
          defaultTemplate: g.template_id || "",
          description: g.description || "",
          tenant_id: g.tenant_id || "default",
          members,
          tone: g.tone || "sapphire",
          approvers: Array.isArray(g.approvers) ? g.approvers : [],
          directoryGroups: Array.isArray(g.directory_groups) ? g.directory_groups : [],
          approverDirectoryGroups: Array.isArray(g.approver_directory_groups) ? g.approver_directory_groups : []
        };
      });

      res.json(mappedGroups);
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/identity/groups", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
    const id = req.body.id || createPrefixedId("grp.");
    const g = req.body;
    const tenantId = g.tenant_id || (ctx.isSuperAdmin ? (g.tenant_id || "default") : ctx.tenantId);

    try {
      await pool.query(
        `INSERT INTO app_groups (id, name, description, role, provider, template_id, tone, tenant_id, approvers, directory_groups, approver_directory_groups)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)`,
        [
          id, g.name || "New Group", g.description || "", g.defaultRole || "Viewer", 
          g.provider || "Local", g.defaultTemplate || null, g.tone || "sapphire", tenantId,
          JSON.stringify(g.approvers || []), JSON.stringify(g.directoryGroups || []), JSON.stringify(g.approverDirectoryGroups || [])
        ]
      );
      res.status(201).json({ ok: true, id });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/identity/groups/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
    const id = req.params.id;
    const g = req.body;
    
    // Check tenant boundary
    if (!ctx.isSuperAdmin) {
      const chk = await pool.query("SELECT tenant_id FROM app_groups WHERE id = $1", [id]);
      if (!chk.rows.length || (chk.rows[0].tenant_id !== ctx.tenantId && chk.rows[0].tenant_id !== "default")) {
        return res.status(403).json({ ok: false, error: "Access denied to group outside your organization" });
      }
    }

    const updates = [];
    const values = [];
    let i = 1;
    
    if (g.name !== undefined) { updates.push(`name=$${i++}`); values.push(g.name); }
    if (g.description !== undefined) { updates.push(`description=$${i++}`); values.push(g.description); }
    if (g.defaultRole !== undefined) { updates.push(`role=$${i++}`); values.push(g.defaultRole); }
    if (g.provider !== undefined) { updates.push(`provider=$${i++}`); values.push(g.provider); }
    if (g.defaultTemplate !== undefined) { updates.push(`template_id=$${i++}`); values.push(g.defaultTemplate || null); }
    if (g.tone !== undefined) { updates.push(`tone=$${i++}`); values.push(g.tone); }
    if (g.approvers !== undefined) { updates.push(`approvers=$${i++}::jsonb`); values.push(JSON.stringify(g.approvers)); }
    if (g.directoryGroups !== undefined) { updates.push(`directory_groups=$${i++}::jsonb`); values.push(JSON.stringify(g.directoryGroups)); }
    if (g.approverDirectoryGroups !== undefined) { updates.push(`approver_directory_groups=$${i++}::jsonb`); values.push(JSON.stringify(g.approverDirectoryGroups)); }

    try {
      if (updates.length > 0) {
        values.push(id);
        await pool.query(`UPDATE app_groups SET ${updates.join(", ")} WHERE id=$${i}`, values);
      }
      
      if (g.members !== undefined) {
         await pool.query(`
           UPDATE app_users 
           SET groups = (
             SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
             FROM jsonb_array_elements(groups) AS elem 
             WHERE elem::text != '"${id}"'
           ) 
           WHERE groups @> '["${id}"]'::jsonb;
         `);
         if (Array.isArray(g.members) && g.members.length > 0) {
           await pool.query(`
             UPDATE app_users 
             SET groups = COALESCE(groups, '[]'::jsonb) || '["${id}"]'::jsonb
             WHERE id = ANY($1)
           `, [g.members]);
         }
      }

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.delete("/api/identity/groups/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
    const id = req.params.id;

    try {
      if (!ctx.isSuperAdmin) {
        const chk = await pool.query("SELECT tenant_id FROM app_groups WHERE id = $1", [id]);
        if (!chk.rows.length || chk.rows[0].tenant_id !== ctx.tenantId) {
          return res.status(403).json({ ok: false, error: "Access denied to group outside your organization" });
        }
      }
      await pool.query("DELETE FROM app_groups WHERE id=$1", [id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
