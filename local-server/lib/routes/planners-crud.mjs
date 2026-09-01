export function mountPlannersRoutes(app, deps) {
  const { pool, requireSession } = deps;

  app.get("/api/planners", requireSession({ roles: ["admin", "operator"] }), async (req, res) => {
    try {
      const ctx = await deps.resolveActorContext(req);
      const vis = deps.buildVisibility(ctx, 1, 'owner_id');
      const { rows } = await pool.query(
        `SELECT id, name, description, mode, enabled, kind, tools, skills, mcp_servers, keywords, aliases, grounded, owner_id, owner_name, visibility, shared_with, created_at, meta FROM planners WHERE ${vis.clause} ORDER BY created_at DESC`,
        vis.params
      );
      res.json({ items: rows });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/planners", requireSession({ roles: ["admin", "operator"] }), async (req, res) => {
    try {
      const { id, name, description, mode, enabled, kind, tools, skills, mcp_servers, keywords, aliases, grounded, owner_id, owner_name, visibility, shared_with, meta } = req.body;
      const ctx = await deps.resolveActorContext(req);
      const owner = owner_id || ctx.userId || req.actor || null;

      const out = await pool.query(
        `INSERT INTO planners (id, name, description, mode, enabled, kind, tools, skills, mcp_servers, keywords, aliases, grounded, owner_id, owner_name, visibility, shared_with, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          id, name, description || '', mode || 'shadow', !!enabled, kind || 'tool',
          JSON.stringify(tools || []), JSON.stringify(skills || []), JSON.stringify(mcp_servers || []),
          JSON.stringify(keywords || []), JSON.stringify(aliases || []),
          grounded !== false, owner, owner_name || null,
          visibility || 'private', JSON.stringify(shared_with || []),
          JSON.stringify(meta || {})
        ]
      );
      res.json({ ok: true, planner: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/planners/:id", requireSession({ roles: ["admin", "operator"] }), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, mode, enabled, kind, tools, skills, mcp_servers, keywords, aliases, grounded, owner_id, owner_name, visibility, shared_with, meta } = req.body;
      
      const out = await pool.query(
        `UPDATE planners 
         SET name=$2, description=$3, mode=$4, enabled=$5, kind=$6, tools=$7, skills=$8, mcp_servers=$9, keywords=$10, aliases=$11, grounded=$12, owner_id=COALESCE(planners.owner_id, $13), owner_name=COALESCE(planners.owner_name, $14), visibility=$15, shared_with=$16, meta=$17
         WHERE id=$1 
         RETURNING *`,
        [
          id, name, description || '', mode || 'shadow', !!enabled, kind || 'tool', 
          JSON.stringify(tools || []), JSON.stringify(skills || []), JSON.stringify(mcp_servers || []), 
          JSON.stringify(keywords || []), JSON.stringify(aliases || []), 
          grounded !== false, owner_id || null, owner_name || null, 
          visibility || 'private', JSON.stringify(shared_with || []),
          JSON.stringify(meta || {})
        ]
      );
      if (!out.rows.length) return res.status(404).json({ error: "not found" });
      res.json({ ok: true, planner: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/planners/:id", requireSession({ roles: ["admin", "operator"] }), async (req, res) => {
    try {
      const { rowCount } = await pool.query(`DELETE FROM planners WHERE id=$1`, [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });
}
