export async function mountIdentityTemplatesRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId, resolveActorContext } = deps;

  app.get("/api/identity/templates", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      let query = "SELECT * FROM app_templates";
      const params = [];
      if (!ctx.isSuperAdmin) {
        query += " WHERE (tenant_id = $1 OR is_global = true OR tenant_id = 'default')";
        params.push(ctx.tenantId || "default");
      }
      query += " ORDER BY created_at ASC";

      const { rows } = await pool.query(query, params);
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
        tenant_id: t.tenant_id || "default",
        assignments: [], // Assignments can be inferred via app_users or groups
        params: t.params || {},
        createdAt: new Date(t.created_at).getTime()
      })));
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/identity/templates", async (req, res) => {
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
    const isAllowed = ctx?.isAdmin || ctx?.isSuperAdmin || ctx?.isTenantAdmin || (typeof isAdminCaller === "function" && await isAdminCaller(req));
    if (!isAllowed) return res.status(403).json({ ok: false, error: "admin required" });

    const id = req.body.id || (typeof createPrefixedId === "function" ? createPrefixedId("tpl.") : `tpl.${Math.random().toString(36).slice(2, 8)}`);
    const t = req.body;
    const tenantId = t.tenant_id || (ctx?.isSuperAdmin ? (t.tenant_id || "default") : (ctx?.tenantId || "default"));
    const isGlobal = ctx?.isSuperAdmin ? (t.is_global !== undefined ? !!t.is_global : true) : false;
    const p = t.params || {};
    const g = t.grants || {};

    try {
      await pool.query(
        `INSERT INTO app_templates (
           id, name, description, jewel, user_can_modify, session_ceiling, user_editable, overrides, custom, grants, params,
           system_prompt, temperature, top_p, max_tokens, allowed_providers, allowed_skills, allowed_tools,
           tenant_id, is_global
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           jewel = EXCLUDED.jewel,
           user_can_modify = EXCLUDED.user_can_modify,
           session_ceiling = EXCLUDED.session_ceiling,
           user_editable = EXCLUDED.user_editable,
           overrides = EXCLUDED.overrides,
           custom = EXCLUDED.custom,
           grants = EXCLUDED.grants,
           params = EXCLUDED.params,
           system_prompt = EXCLUDED.system_prompt,
           temperature = EXCLUDED.temperature,
           top_p = EXCLUDED.top_p,
           max_tokens = EXCLUDED.max_tokens,
           allowed_providers = EXCLUDED.allowed_providers,
           allowed_skills = EXCLUDED.allowed_skills,
           allowed_tools = EXCLUDED.allowed_tools,
           tenant_id = EXCLUDED.tenant_id,
           is_global = EXCLUDED.is_global,
           updated_at = now()`,
        [
          id, t.name || "New Template", t.description || "", t.jewel || "sapphire",
          t.userCanModify !== false, t.sessionCeiling || "12 h",
          JSON.stringify(t.userEditable || {}), JSON.stringify(t.overrides || {}),
          JSON.stringify(t.custom || []), JSON.stringify(g),
          JSON.stringify(p),
          String(p.systemPrompt || ""),
          Number(p.temperature ?? 0.4),
          Number(p.topP ?? 0.9),
          Number(p.maxTokens ?? 4096),
          JSON.stringify(Array.isArray(g.providers) ? g.providers : []),
          JSON.stringify(Array.isArray(g.skills) ? g.skills : []),
          JSON.stringify(Array.isArray(g.tools) ? g.tools : []),
          tenantId, isGlobal
        ]
      );
      res.status(201).json({ ok: true, id });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/identity/templates/:id", async (req, res) => {
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
    const isAllowed = ctx?.isAdmin || ctx?.isSuperAdmin || ctx?.isTenantAdmin || (typeof isAdminCaller === "function" && await isAdminCaller(req));
    if (!isAllowed) return res.status(403).json({ ok: false, error: "admin required" });

    const id = req.params.id;
    const t = req.body;

    if (!ctx?.isSuperAdmin) {
      const chk = await pool.query("SELECT tenant_id, is_global FROM app_templates WHERE id = $1", [id]);
      if (!chk.rows.length || (chk.rows[0].is_global && !ctx.isSuperAdmin) || chk.rows[0].tenant_id !== ctx.tenantId) {
        return res.status(403).json({ ok: false, error: "Access denied to template outside your organization" });
      }
    }

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
    if (t.grants !== undefined) {
      updates.push(`grants=$${i++}::jsonb`); values.push(JSON.stringify(t.grants));
      if (t.grants.providers !== undefined) {
        updates.push(`allowed_providers=$${i++}::jsonb`); values.push(JSON.stringify(Array.isArray(t.grants.providers) ? t.grants.providers : []));
      }
      if (t.grants.skills !== undefined) {
        updates.push(`allowed_skills=$${i++}::jsonb`); values.push(JSON.stringify(Array.isArray(t.grants.skills) ? t.grants.skills : []));
      }
      if (t.grants.tools !== undefined) {
        updates.push(`allowed_tools=$${i++}::jsonb`); values.push(JSON.stringify(Array.isArray(t.grants.tools) ? t.grants.tools : []));
      }
    }
    if (t.params !== undefined) {
      updates.push(`params=$${i++}::jsonb`); values.push(JSON.stringify(t.params));
      if (t.params.systemPrompt !== undefined) {
        updates.push(`system_prompt=$${i++}`); values.push(String(t.params.systemPrompt || ""));
      }
      if (t.params.temperature !== undefined) {
        updates.push(`temperature=$${i++}`); values.push(Number(t.params.temperature ?? 0.4));
      }
      if (t.params.topP !== undefined) {
        updates.push(`top_p=$${i++}`); values.push(Number(t.params.topP ?? 0.9));
      }
      if (t.params.maxTokens !== undefined) {
        updates.push(`max_tokens=$${i++}`); values.push(Number(t.params.maxTokens ?? 4096));
      }
    }

    try {
      if (updates.length > 0) {
        updates.push(`updated_at=now()`);
        values.push(id);
        const upRes = await pool.query(`UPDATE app_templates SET ${updates.join(", ")} WHERE id=$${i}`, values);
        if (upRes.rowCount === 0) {
          const p = t.params || {};
          const g = t.grants || {};
          await pool.query(
            `INSERT INTO app_templates (
               id, name, description, jewel, user_can_modify, session_ceiling, user_editable, overrides, custom, grants, params,
               system_prompt, temperature, top_p, max_tokens, allowed_providers, allowed_skills, allowed_tools,
               tenant_id, is_global
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20)
             ON CONFLICT (id) DO NOTHING`,
            [
              id, t.name || "New Template", t.description || "", t.jewel || "sapphire",
              t.userCanModify !== false, t.sessionCeiling || "12 h",
              JSON.stringify(t.userEditable || {}), JSON.stringify(t.overrides || {}),
              JSON.stringify(t.custom || []), JSON.stringify(g),
              JSON.stringify(p),
              String(p.systemPrompt || ""),
              Number(p.temperature ?? 0.4),
              Number(p.topP ?? 0.9),
              Number(p.maxTokens ?? 4096),
              JSON.stringify(Array.isArray(g.providers) ? g.providers : []),
              JSON.stringify(Array.isArray(g.skills) ? g.skills : []),
              JSON.stringify(Array.isArray(g.tools) ? g.tools : []),
              ctx?.tenantId || "default", true
            ]
          );
        }
        res.json({ ok: true });
      } else {
        res.json({ ok: true });
      }
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.delete("/api/identity/templates/:id", async (req, res) => {
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
    const isAllowed = ctx?.isAdmin || ctx?.isSuperAdmin || ctx?.isTenantAdmin || (typeof isAdminCaller === "function" && await isAdminCaller(req));
    if (!isAllowed) return res.status(403).json({ ok: false, error: "admin required" });

    const id = req.params.id;
    try {
      if (!ctx?.isSuperAdmin) {
        const chk = await pool.query("SELECT tenant_id, is_global FROM app_templates WHERE id = $1", [id]);
        if (!chk.rows.length || chk.rows[0].is_global || chk.rows[0].tenant_id !== ctx.tenantId) {
          return res.status(403).json({ ok: false, error: "Access denied to delete this template" });
        }
      }

      await pool.query("UPDATE app_users SET template_id = NULL WHERE template_id = $1", [id]);
      await pool.query("UPDATE app_groups SET template_id = NULL WHERE template_id = $1", [id]);
      await pool.query("DELETE FROM app_templates WHERE id=$1", [id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
