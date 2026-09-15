export async function mountSearchProviderRoutes(app, deps) {
  const { pool, isAdminCaller, resolveActorContext } = deps;

  app.get("/api/search-providers", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      const isAllowed = ctx?.isAdmin || ctx?.isSuperAdmin || ctx?.isTenantAdmin || (typeof isAdminCaller === "function" && await isAdminCaller(req));
      if (!isAllowed) return res.status(403).json({ error: "forbidden" });

      let query = "SELECT * FROM search_providers";
      const params = [];
      if (!ctx?.isSuperAdmin) {
        query += " WHERE (tenant_id = $1 OR is_global = true)";
        params.push(ctx?.tenantId || "default");
      }
      query += " ORDER BY priority ASC, name ASC";

      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/search-providers", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      const isAllowed = ctx?.isAdmin || ctx?.isSuperAdmin || ctx?.isTenantAdmin || (typeof isAdminCaller === "function" && await isAdminCaller(req));
      if (!isAllowed) return res.status(403).json({ error: "forbidden" });

      const p = req.body;
      const id = p.id || `sp.${Math.random().toString(36).slice(2, 8)}`;
      const tenantId = ctx?.isSuperAdmin ? (p.tenant_id || "default") : (ctx?.tenantId || "default");
      const isGlobal = ctx?.isSuperAdmin ? (p.is_global !== undefined ? !!p.is_global : (p.tenant_id === "default")) : false;
      const ownerId = ctx?.userId || null;
      const visibility = p.visibility || "private";

      await pool.query(
        `INSERT INTO search_providers (id, name, provider_type, base_url, api_key_ref, priority, active, tenant_id, is_global, owner_id, visibility)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           provider_type = EXCLUDED.provider_type,
           base_url = EXCLUDED.base_url,
           api_key_ref = EXCLUDED.api_key_ref,
           priority = EXCLUDED.priority,
           active = EXCLUDED.active,
           tenant_id = EXCLUDED.tenant_id,
           is_global = EXCLUDED.is_global,
           visibility = EXCLUDED.visibility,
           updated_at = now()`,
        [
          id,
          p.name,
          p.provider_type || "duckduckgo",
          p.base_url || "",
          p.api_key_ref || "",
          Number(p.priority) || 5,
          p.active ?? true,
          tenantId,
          isGlobal,
          ownerId,
          visibility,
        ]
      );
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/search-providers/:id", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      const isAllowed = ctx?.isAdmin || ctx?.isSuperAdmin || ctx?.isTenantAdmin || (typeof isAdminCaller === "function" && await isAdminCaller(req));
      if (!isAllowed) return res.status(403).json({ error: "forbidden" });

      const id = req.params.id;
      if (!ctx?.isSuperAdmin) {
        const chk = await pool.query("SELECT tenant_id, is_global FROM search_providers WHERE id = $1", [id]);
        if (!chk.rows.length || chk.rows[0].is_global || chk.rows[0].tenant_id !== ctx?.tenantId) {
          return res.status(403).json({ ok: false, error: "Access denied to delete this search provider" });
        }
      }

      await pool.query("DELETE FROM search_providers WHERE id = $1", [id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });
}
