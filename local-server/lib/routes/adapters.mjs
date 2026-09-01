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
  const { pool } = deps;

  app.get("/api/adapters", async (_req, res) => {
    try {
      // Return columns mapping to the `Adapter` typescript type and `mapAdapterRow`
      const r = await pool.query(
        `SELECT id, name, description, tags, category, connection as connection_type, 
                runner as adapter, vault_scope, vault_name, vault_field, 
                config, risk as risk_level, requires_approval, enabled, 
                created_at as updated_at
           FROM adapters
          ORDER BY enabled DESC, name ASC`,
      );
      
      // We manually construct vault_binding_spec for backwards compatibility
      // with `mapAdapterRow` in `adapter-store.ts`.
      const items = r.rows.map(row => ({
        ...row,
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
      const r = await pool.query(`SELECT * FROM adapters WHERE id=$1`, [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      
      const row = r.rows[0];
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
      
      let configStr = "{}";
      if (typeof b.config === "string") configStr = b.config;
      else if (typeof b.config === "object") configStr = JSON.stringify(b.config);

      const r = await pool.query(
        `INSERT INTO adapters (id, name, description, tags, category, connection, runner,
                            vault_scope, vault_name, vault_field, config, risk,
                            requires_approval, enabled)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          id, b.name, b.description, JSON.stringify(b.tags), b.category, b.connection_type, b.adapter,
          b.vault_binding_spec?.scope || "none",
          b.vault_binding_spec?.name || "",
          b.vault_binding_spec?.field || "",
          configStr,
          b.risk_level,
          b.requires_approval,
          b.enabled
        ]
      );
      
      res.json({ ok: true, item: r.rows[0] });
    } catch (e) { res.status(400).json({ ok: false, error: String(e.message || e) }); }
  });

  app.patch("/api/adapters/:id", async (req, res) => {
    try {
      const b = sanitizeAdapterBody(req.body);
      
      let configStr = "{}";
      if (typeof b.config === "string") configStr = b.config;
      else if (typeof b.config === "object") configStr = JSON.stringify(b.config);

      const r = await pool.query(
        `UPDATE adapters
            SET name=$2, description=$3, tags=$4::jsonb, category=$5, connection=$6, runner=$7,
                vault_scope=$8, vault_name=$9, vault_field=$10, config=$11, risk=$12,
                requires_approval=$13, enabled=$14
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
          b.enabled
        ]
      );
      if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      res.json({ ok: true, item: r.rows[0] });
    } catch (e) { res.status(400).json({ ok: false, error: String(e.message || e) }); }
  });

  app.delete("/api/adapters/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM adapters WHERE id=$1`, [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
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