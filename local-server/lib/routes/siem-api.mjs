export async function mountSiemRoutes(app, deps) {
  const { isAdminCaller } = deps;

  app.post("/api/system/siem/test", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const cfg = req.body;
    
    // Simulate real backend test logic for UI testing
    setTimeout(() => {
      if (!cfg.host || !cfg.port) {
        return res.json({ ok: false, error: "Host and port are required" });
      }
      if (cfg.host === "error.local") {
        return res.json({ ok: false, error: "Connection timeout" });
      }
      res.json({ ok: true });
    }, 900);
  });
}
