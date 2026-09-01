export function mountProvidersRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId } = deps;

  app.get("/api/system/providers", async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM ai_providers ORDER BY priority ASC, name ASC"
      );
      res.json(rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        priority: r.priority,
        baseUrl: r.base_url,
        model: r.model,
        secretId: r.secret_id,
        active: r.active,
        isCheapest: r.is_cheapest,
        createdAt: new Date(r.created_at).getTime(),
      })));
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/system/providers", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const p = req.body ?? {};
    const id = p.id || createPrefixedId("prov_");
    try {
      await pool.query(
        `INSERT INTO ai_providers(id, name, kind, priority, base_url, model, secret_id, active, is_cheapest, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, kind=EXCLUDED.kind,
           base_url=EXCLUDED.base_url, model=EXCLUDED.model,
           active=EXCLUDED.active, priority=EXCLUDED.priority,
           secret_id=EXCLUDED.secret_id, is_cheapest=EXCLUDED.is_cheapest`,
        [
          id,
          p.name ?? "Provider",
          p.kind ?? "llm",
          Number.isFinite(+p.priority) ? +p.priority : 100,
          p.baseUrl ?? "",
          p.model ?? "",
          p.secretId ?? null,
          !!p.active,
          !!p.isCheapest
        ]
      );

      const { rows } = await pool.query("SELECT * FROM ai_providers WHERE id=$1", [id]);
      const r = rows[0];
      res.json({ ok: true, provider: {
        id: r.id, name: r.name, kind: r.kind, priority: r.priority,
        baseUrl: r.base_url, model: r.model, secretId: r.secret_id,
        active: r.active, isCheapest: r.is_cheapest,
        createdAt: new Date(r.created_at).getTime(),
      }});
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/system/providers/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.params.id;
    const p = req.body ?? {};
    
    try {
      const updates = [];
      const values = [];
      let i = 1;

      if (p.name !== undefined) { updates.push(`name=$${i++}`); values.push(p.name); }
      if (p.kind !== undefined) { updates.push(`kind=$${i++}`); values.push(p.kind); }
      if (p.priority !== undefined) { updates.push(`priority=$${i++}`); values.push(+p.priority); }
      if (p.baseUrl !== undefined) { updates.push(`base_url=$${i++}`); values.push(p.baseUrl); }
      if (p.model !== undefined) { updates.push(`model=$${i++}`); values.push(p.model); }
      if (p.secretId !== undefined) { updates.push(`secret_id=$${i++}`); values.push(p.secretId); }
      if (p.active !== undefined) { updates.push(`active=$${i++}`); values.push(!!p.active); }
      if (p.isCheapest !== undefined) { updates.push(`is_cheapest=$${i++}`); values.push(!!p.isCheapest); }

      if (updates.length > 0) {
        values.push(id);
        await pool.query(`UPDATE ai_providers SET ${updates.join(", ")} WHERE id=$${i}`, values);
      }

      const { rows } = await pool.query("SELECT * FROM ai_providers WHERE id=$1", [id]);
      if (!rows.length) return res.status(404).json({ error: "not found" });

      const r = rows[0];
      res.json({ ok: true, provider: {
        id: r.id,
        name: r.name,
        kind: r.kind,
        priority: r.priority,
        baseUrl: r.base_url,
        model: r.model,
        secretId: r.secret_id,
        active: r.active,
        isCheapest: r.is_cheapest,
        createdAt: new Date(r.created_at).getTime(),
      }});
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/system/providers/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      await pool.query("DELETE FROM ai_providers WHERE id=$1", [req.params.id]);
      res.status(204).end();
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });
}