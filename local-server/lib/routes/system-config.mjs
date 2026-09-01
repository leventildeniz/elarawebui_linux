export async function mountSystemConfigRoutes(app, deps) {
  const { pool, isAdminCaller } = deps;

  app.get("/api/system/config", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      const { rows } = await pool.query("SELECT * FROM app_system_config");
      const config = {};
      rows.forEach(r => { config[r.key] = r.value; });
      res.json(config);
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.get("/api/system/config/:key", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      const { rows } = await pool.query("SELECT value FROM app_system_config WHERE key=$1", [req.params.key]);
      if (!rows.length) return res.json(null);
      res.json(rows[0].value);
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/system/config/:key", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try {
      await pool.query(
        `INSERT INTO app_system_config (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [req.params.key, JSON.stringify(req.body)]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  // --- ENGINE CONFIG (v2 master schema 'engine_config' table) ---

  app.get("/api/engine-config", async (req, res) => {
    try {
      let r = await pool.query("SELECT * FROM engine_config WHERE id='singleton'");
      if (!r.rows.length) {
        await pool.query("INSERT INTO engine_config (id) VALUES ('singleton') ON CONFLICT DO NOTHING");
        r = await pool.query("SELECT * FROM engine_config WHERE id='singleton'");
      }
      res.json(r.rows[0] || {});
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/engine-config", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const b = req.body;
    try {
      await pool.query(
        `UPDATE engine_config SET
           runtime_provider=$1, base_url_override=$2, active_model_id=$3,
           bypass_enabled=$4, similarity=$5, classifier=$6, classifier_prompt=$7,
           rag_mode=$8, guard=$9,
           allowed_agents=$10, allowed_tools=$11, disarmed_tools=$12,
           denied_agents=$13, denied_tools=$14, denied_skills=$15, denied_mcp=$16,
           updated_at=now()
         WHERE id='singleton'`,
        [
          b.runtime_provider, b.base_url_override, b.active_model_id,
          !!b.bypass_enabled, b.similarity !== undefined ? Number(b.similarity) : 0.75,
          b.classifier, b.classifier_prompt, b.rag_mode, b.guard,
          b.allowed_agents, b.allowed_tools, b.disarmed_tools,
          b.denied_agents, b.denied_tools, b.denied_skills, b.denied_mcp
        ]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
