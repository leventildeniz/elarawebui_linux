// Template assignments — username→template_id mapping with mirrored app_users.template_id.
// Extracted from server.mjs.
	
	
	
	export async function initTemplateAssignments({ pool, migrateReady, providerPolicyCacheClear }) {
	  console.log("[boot] initTemplateAssignments... ✅");
	}
	
	export function mountTemplateAssignmentsRoutes(app, deps) {
  const { pool, migrateReady, providerPolicyCacheClear } = deps;

  app.get("/api/template-assignments", async (_req, res) => {
    try {
      await migrateReady;
      const r = await pool.query("SELECT id, username, template_id FROM app_template_assignments ORDER BY username");
      res.json(r.rows.map(x => ({ id: x.id, username: x.username, templateId: x.template_id })));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.put("/api/template-assignments", async (req, res) => {
    try {
      await migrateReady;
      const list = Array.isArray(req.body) ? req.body : [];
      await pool.query("BEGIN");
      await pool.query("DELETE FROM app_template_assignments");
      for (const a of list) {
        const id = String(a.id || `assign-${Date.now()}`);
        const u = String(a.username || "").trim();
        const tid = String(a.templateId || "").trim();
        if (!u || !tid) continue;
        await pool.query(
          `INSERT INTO app_template_assignments (id, username, template_id)
           VALUES ($1,$2,$3) ON CONFLICT (username, template_id) DO NOTHING`,
          [id, u, tid]
        );
      }
      const userTemplateByName = new Map();
      for (const a of list) {
        const u = String(a.username || "").trim();
        const tid = String(a.templateId || "").trim();
        if (u && tid && !userTemplateByName.has(u.toLowerCase())) userTemplateByName.set(u.toLowerCase(), { username: u, templateId: tid });
      }
      await pool.query("UPDATE app_users SET template_id=NULL");
      for (const { username, templateId } of userTemplateByName.values()) {
        await pool.query("UPDATE app_users SET template_id=$2 WHERE lower(username)=lower($1)", [username, templateId]);
      }
      await pool.query("COMMIT");
      providerPolicyCacheClear(); // bulk reassignment touches every user
      res.json({ ok: true, count: list.length });
    } catch (e) {
      await pool.query("ROLLBACK").catch(()=>{});
      res.status(500).json({ error: String(e.message || e) });
    }
  });
}
