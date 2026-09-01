// local-server/lib/routes/rbac.mjs
// Block R-1 — /api/rbac/* endpoint grubu (tabs GET/PUT + me GET).
// 2026-05-30 monolit-avı: server.mjs'ten ayrıldı. DI: { pool, allTabIds }.
//
// Kullanım:
//   import { mountRbacRoutes } from "./lib/routes/rbac.mjs";
//   mountRbacRoutes(app, { pool, allTabIds: ALL_TAB_IDS });

export function mountRbacRoutes(app, { pool, allTabIds }) {
  if (!app) throw new Error("[rbac-routes] app gerekli");
  if (!pool) throw new Error("[rbac-routes] pool gerekli");
  if (!Array.isArray(allTabIds)) throw new Error("[rbac-routes] allTabIds[] gerekli");

  app.get("/api/rbac/tabs", async (_req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT scope_type,scope_id,allowed_tabs,updated_at FROM tab_permissions ORDER BY scope_type,scope_id"
      );
      res.json({ ok: true, allTabs: allTabIds, entries: rows });
    } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  app.put("/api/rbac/tabs", async (req, res) => {
    const { scopeType, scopeId, allowedTabs } = req.body || {};
    if (!["role","template","user"].includes(scopeType) || !scopeId || !Array.isArray(allowedTabs)) {
      return res.status(400).json({ error: "scopeType, scopeId, allowedTabs[] required" });
    }
    const tabs = allowedTabs.filter((t) => allTabIds.includes(String(t)));
    try {
      await pool.query(
        `INSERT INTO tab_permissions(scope_type,scope_id,allowed_tabs,updated_at)
         VALUES ($1,$2,$3,now())
         ON CONFLICT (scope_type,scope_id) DO UPDATE SET allowed_tabs=EXCLUDED.allowed_tabs, updated_at=now()`,
        [scopeType, scopeId, tabs]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  app.get("/api/rbac/me", async (req, res) => {
    const role = String(req.query.role || "Viewer");
    const templateId = req.query.templateId ? String(req.query.templateId) : null;
    const userId = req.query.userId ? String(req.query.userId) : null;
    if (role === "Admin") return res.json({ ok: true, allowedTabs: allTabIds, role, admin: true });
    try {
      const conds = [["role", role]];
      if (templateId) conds.push(["template", templateId]);
      if (userId) conds.push(["user", userId]);
      const tabs = new Set();
      for (const [t, id] of conds) {
        const { rows } = await pool.query(
          "SELECT allowed_tabs FROM tab_permissions WHERE scope_type=$1 AND scope_id=$2",
          [t, id]
        );
        if (rows[0]?.allowed_tabs) for (const x of rows[0].allowed_tabs) tabs.add(x);
      }
      if (tabs.size === 0) tabs.add("chat");
      res.json({ ok: true, allowedTabs: [...tabs], role, admin: false });
    } catch (e) {
      res.json({ ok: true, allowedTabs: ["chat"], role, admin: false, error: String(e?.message || e) });
    }
  });
}
