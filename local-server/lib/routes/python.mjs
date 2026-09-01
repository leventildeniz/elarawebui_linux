// /api/python/* — operator-managed Python interpreters & runtimes.
// Extracted from server.mjs (2026-05-30, ~76 lines).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function mountPythonRoutes({ app, pool, execAsync }) {
  app.post("/api/python/detect", async (req, res) => {
    let p = String(req.body?.path || "").trim();
    if (!p) return res.status(400).json({ ok: false, error: "path required" });
    if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) return res.status(400).json({ ok: false, error: "not a file", path: p });
    } catch (e) { return res.status(404).json({ ok: false, error: String(e.message || e), path: p }); }
    try {
      const ver = (await execAsync(p, ["--version"], 2500)).trim();
      if (!ver) return res.status(502).json({ ok: false, error: "no version banner", path: p });
      res.json({ ok: true, path: p, version: ver });
    } catch (e) { res.status(502).json({ ok: false, error: String(e.message || e), path: p }); }
  });

  // Read / set the operator-sealed Primary Python interpreter.
  // Forge actions, Library scripts and agent runs without an explicit
  // interpreter_path will fall back to this path.
  app.get("/api/python/primary", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='python.primary'");
      res.json({ ok: true, primary: rows[0]?.value ?? null });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.post("/api/python/primary", async (req, res) => {
    let p = String(req.body?.path || "").trim();
    if (!p) {
      await pool.query("DELETE FROM app_settings WHERE key='python.primary'").catch(()=>{});
      return res.json({ ok: true, primary: null });
    }
    if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) return res.status(400).json({ ok: false, error: "not a file", path: p });
      const ver = (await execAsync(p, ["--version"], 2500)).trim();
      if (!ver) return res.status(502).json({ ok: false, error: "no version banner" });
      const value = { path: p, version: ver, sealed_at: new Date().toISOString() };
      await pool.query(
        `INSERT INTO app_settings(key,value,updated_at) VALUES ('python.primary',$1,now())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [JSON.stringify(value)]
      );
      res.json({ ok: true, primary: value });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  // Operator-defined Python runtimes (Python page).
  // Stored as JSON array under app_settings key 'python.runtimes'.
  app.get("/api/python/runtimes", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='python.runtimes'");
      const list = Array.isArray(rows[0]?.value) ? rows[0].value : [];
      res.json({ ok: true, runtimes: list });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e), runtimes: [] }); }
  });
  app.put("/api/python/runtimes", async (req, res) => {
    const incoming = Array.isArray(req.body?.runtimes) ? req.body.runtimes : null;
    if (!incoming) return res.status(400).json({ ok: false, error: "runtimes[] required" });
    // Normalize — strip transient fields; keep persistence shape stable.
    const normalized = incoming.map((r) => ({
      id: String(r?.id || `rt-${Date.now()}`),
      name: String(r?.name || ""),
      python: String(r?.python || ""),
      venv: String(r?.venv || ""),
      packages: Array.isArray(r?.packages) ? r.packages.map(String) : [],
      status: "idle",
    }));
    try {
      await pool.query(
        `INSERT INTO app_settings(key,value,updated_at) VALUES ('python.runtimes',$1,now())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [JSON.stringify(normalized)]
      );
      res.json({ ok: true, count: normalized.length });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
