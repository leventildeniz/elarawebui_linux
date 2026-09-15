// local-server/lib/routes/adapters.mjs

// /api/adapters/* — CRUD + dry-run connection test for the `adapters` table.
// Rewritten for actual Elara Sovereign db schema.

function sanitizeAdapterBody(body) {
  if (!body) return {};
  return {
    name: body.name || 'Unnamed Adapter',
    adapter: body.adapter || 'generic',
    category: body.category || 'general',
    connection_type: body.connection_type || 'rest',
    risk_level: body.risk_level || 'low',
    requires_approval: !!body.requires_approval,
    config: body.config || {},
    vault_binding_spec: body.vault_binding_spec || {},
    tags: Array.isArray(body.tags) ? body.tags : [],
    description: body.description || '',
    enabled: body.enabled !== undefined ? !!body.enabled : true,
  };
}

export function mountAdaptersRoutes(app, deps) {
  const { pool, resolveActorContext, assertCanEdit, buildVisibility } = deps;

  app.get("/api/adapters", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const vis = typeof buildVisibility === "function" ? buildVisibility(ctx, 1, 'owner_id') : { clause: "1=1", params: [] };
      let query = `SELECT id, name, description, tags, category, connection as connection_type, 
                runner as adapter, vault_scope, vault_name, vault_field, 
                config, risk as risk_level, requires_approval, enabled, 
                created_at as updated_at, tenant_id, is_global,
                owner_id, visibility, shared_with
           FROM adapters WHERE ${vis.clause} ORDER BY enabled DESC, name ASC`;

      const r = await pool.query(query, vis.params);
      
      const items = r.rows.map(row => ({
        ...row,
        ownerId: row.owner_id || "",
        visibility: row.visibility || "private",
        sharedWith: row.shared_with || [],
        vault_binding_spec: {
          scope: row.vault_scope,
          name: row.vault_name,
          field: row.vault_field
        }
      }));
      
      res.json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.get("/api/adapters/:id", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const r = await pool.query(`SELECT * FROM adapters WHERE id=$1`, [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      
      const row = r.rows[0];
      if (!ctx.isSuperAdmin && !row.is_global) {
        if (row.tenant_id !== ctx.tenantId && row.tenant_id !== "default") {
          return res.status(403).json({ ok: false, error: "Access denied" });
        }
        if (row.visibility === "private" && !ctx.isTenantAdmin) {
          const matches = [ctx.userId, ctx.username, ctx.actor].filter(Boolean).map(s => String(s).toLowerCase());
          if (!matches.includes(String(row.owner_id || "").toLowerCase())) {
            return res.status(403).json({ ok: false, error: "Access denied" });
          }
        }
      }

      row.adapter = row.runner;
      row.connection_type = row.connection;
      row.risk_level = row.risk;
      row.vault_binding_spec = {
        scope: row.vault_scope,
        name: row.vault_name,
        field: row.vault_field
      };
      
      res.json({ ok: true, item: row });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/adapters", async (req, res) => {
    try {
      const b = sanitizeAdapterBody(req.body);
      const id = String(req.body?.id || `adp-${Date.now()}`);
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const tenantId = req.body?.tenant_id || req.body?.tenantId || (ctx.isSuperAdmin ? (req.body?.tenant_id || "default") : ctx.tenantId);
      const isGlobal = ctx.isSuperAdmin ? (req.body?.is_global || false) : false;
      const ownerId = req.body?.owner_id || req.body?.ownerId || ctx.userId || ctx.actor || null;
      const visibility = req.body?.visibility || "private";
      const sharedWith = Array.isArray(req.body?.sharedWith || req.body?.shared_with) ? JSON.stringify(req.body?.sharedWith || req.body?.shared_with) : "[]";
      
      let configStr = "{}";
      if (typeof b.config === "string") configStr = b.config;
      else if (typeof b.config === "object") configStr = JSON.stringify(b.config);

      const r = await pool.query(
        `INSERT INTO adapters (id, name, description, tags, category, connection, runner,
                            vault_scope, vault_name, vault_field, config, risk,
                            requires_approval, enabled, tenant_id, is_global, owner_id, visibility, shared_with)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
         RETURNING *`,
        [
          id, b.name, b.description, JSON.stringify(b.tags), b.category, b.connection_type, b.adapter,
          b.vault_binding_spec?.scope || "none",
          b.vault_binding_spec?.name || "",
          b.vault_binding_spec?.field || "",
          configStr,
          b.risk_level,
          b.requires_approval,
          b.enabled,
          tenantId,
          isGlobal,
          ownerId,
          visibility,
          sharedWith
        ]
      );
      
      res.json({ ok: true, item: r.rows[0] });
    } catch (e) { res.status(400).json({ ok: false, error: String(e.message || e) }); }
  });

  app.patch("/api/adapters/:id", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const cur = await pool.query(`SELECT * FROM adapters WHERE id=$1`, [req.params.id]);
      if (!cur.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      if (assertCanEdit) {
        assertCanEdit(ctx, cur.rows[0], "adapter");
      }

      const b = sanitizeAdapterBody(req.body);
      const visibility = req.body?.visibility !== undefined ? req.body.visibility : cur.rows[0].visibility;
      const sharedWith = req.body?.sharedWith !== undefined || req.body?.shared_with !== undefined 
        ? JSON.stringify(req.body?.sharedWith || req.body?.shared_with || []) 
        : JSON.stringify(cur.rows[0].shared_with || []);
      
      let configStr = "{}";
      if (typeof b.config === "string") configStr = b.config;
      else if (typeof b.config === "object") configStr = JSON.stringify(b.config);

      const r = await pool.query(
        `UPDATE adapters
            SET name=$2, description=$3, tags=$4::jsonb, category=$5, connection=$6, runner=$7,
                vault_scope=$8, vault_name=$9, vault_field=$10, config=$11, risk=$12,
                requires_approval=$13, enabled=$14, visibility=$15, shared_with=$16::jsonb
          WHERE id=$1
          RETURNING *`,
         [
          req.params.id, b.name, b.description, JSON.stringify(b.tags), b.category, b.connection_type, b.adapter,
          b.vault_binding_spec?.scope || "none",
          b.vault_binding_spec?.name || "",
          b.vault_binding_spec?.field || "",
          configStr,
          b.risk_level,
          b.requires_approval,
          b.enabled,
          visibility,
          sharedWith
        ]
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      res.json({ ok: true, item: r.rows[0] });
    } catch (e) { res.status(e.status || 400).json({ ok: false, error: String(e.message || e) }); }
  });

  app.delete("/api/adapters/:id", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const cur = await pool.query(`SELECT * FROM adapters WHERE id=$1`, [req.params.id]);
      if (!cur.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      if (assertCanEdit) {
        assertCanEdit(ctx, cur.rows[0], "adapter");
      }

      await pool.query(`DELETE FROM adapters WHERE id=$1`, [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/adapters/:id/test", async (req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM adapters WHERE id=$1`, [req.params.id]);
      const t = r.rows[0];
      if (!t) return res.status(404).json({ ok: false, error: "not_found" });
      
      let cfg = {};
      try { cfg = JSON.parse(t.config || "{}"); } catch { /* ignore */ }
      
      const checks = { config_present: !!Object.keys(cfg).length };
      if (t.connection === "rest_token" || t.connection === "rest_apikey" ||
          t.connection === "graphql" || t.connection === "webhook" ||
          t.connection === "http_basic") {
        const url = cfg.base_url || cfg.url;
        checks.has_base_url = !!url;
        if (url) {
          try {
            const ping = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) });
            checks.http_status = ping.status;
            checks.reachable = ping.status < 500;
          } catch (e) { checks.reachable = false; checks.error = String(e.message || e); }
        }
      } else if (t.connection === "ssh") {
        checks.has_host = !!cfg.host;
        checks.has_port = Number.isFinite(Number(cfg.port || 22));
      } else if (t.connection === "checkpoint_smc") {
        checks.has_mgmt_host = !!cfg.mgmt_host;
      }
      res.json({ ok: true, connection_type: t.connection, checks });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}