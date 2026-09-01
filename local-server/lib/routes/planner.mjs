// Planner v0 (Faz 6) read/write endpoints.
// Extracted 2026-05-30 from server.mjs.

export function mountPlannerRoutes({ app, Planner }) {
  app.get("/api/planner/settings", (_req, res) => {
    res.json({ ok: true, ...Planner.getSettings() });
  });

  app.put("/api/planner/settings", (req, res) => {
    try {
      const updated = Planner.updateSettings(req.body || {});
      res.json({ ok: true, ...updated });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/planner/stats", async (req, res) => {
    try {
      const days = Math.min(90, Math.max(1, Number(req.query?.days) || 7));
      const stats = await Planner.getStats({ days });
      res.json({ ok: true, stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/planner/recent", async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 25));
      const mode =
        req.query?.mode === "shadow" || req.query?.mode === "active"
          ? req.query.mode
          : null;
      const rows = await Planner.getRecent({ limit, mode });
      res.json({ ok: true, rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
