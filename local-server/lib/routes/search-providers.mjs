export async function mountSearchProviderRoutes(app, deps) {
  const { pool, isAdminCaller } = deps;

  app.get("/api/search-providers", async (req, res) => {
    try {
      if (!(await isAdminCaller(req))) return res.status(403).json({ error: "forbidden" });
      const { rows } = await pool.query("SELECT * FROM search_providers ORDER BY priority ASC, name");
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/search-providers", async (req, res) => {
    try {
      if (!(await isAdminCaller(req))) return res.status(403).json({ error: "forbidden" });
      const p = req.body;
      const id = p.id || `sp.${Math.random().toString(36).slice(2,8)}`;
      await pool.query(
        `INSERT INTO search_providers (id, name, provider_type, base_url, api_key_ref, priority, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, provider_type=EXCLUDED.provider_type, base_url=EXCLUDED.base_url,
           api_key_ref=EXCLUDED.api_key_ref, priority=EXCLUDED.priority, active=EXCLUDED.active, updated_at=now()`,
        [id, p.name, p.provider_type || 'duckduckgo', p.base_url || '', p.api_key_ref || '', p.priority || 5, p.active ?? true]
      );
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/search-providers/:id", async (req, res) => {
    try {
      if (!(await isAdminCaller(req))) return res.status(403).json({ error: "forbidden" });
      await pool.query("DELETE FROM search_providers WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });
}
