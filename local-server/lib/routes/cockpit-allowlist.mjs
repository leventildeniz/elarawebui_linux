// lib/routes/cockpit-allowlist.mjs — Tur 2 modülerleştirme
// Cockpit allowlist + intent-guard + bridge telemetry endpoints.
// server.mjs'ten taşındı (2093-2232). Davranış aynı.
//
// initCockpitAllowlist(deps) → { INTENT_GUARD, broadcastBridge,
//   hydrateIntentGuardFromDb, hydrateAllowedAgentsFromDb,
//   applyExecutionGuard, getAllowedToolsList, getDeniedToolsList,
//   isToolAllowed, mountCockpitRoutes(app) }
//
// deps: { pool, getAllowedAgents, setAllowedAgents, setAgentsBaseDir,
//         detectExecutionIntent }

// 2026-06-02 — agent-mention catalog hydration kaldırıldı (passive_mention_guard sökümüyle birlikte).

export async function hydrateIntentGuardFromDb(deps) {
  const { pool } = deps;
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='intent.guard'");
    const v = rows[0]?.value;
    if (v && typeof v === "object" && typeof v.mode === "string") {
      return v.mode;
    }
  } catch { /* silent — first boot */ }
  return "auto";
}

export async function hydrateAllowedAgentsFromDb(deps) {
  const { pool, setAllowedAgents, setAgentsBaseDir } = deps;
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='agents.allowed'");
    const v = rows[0]?.value;
    const r = await pool.query(
      `SELECT agent_path FROM agents
        WHERE agent_path IS NOT NULL AND agent_path <> ''
          AND lower(coalesce(status,'')) IN ('active','armed')`,
    );
    const allDirs = await pool.query(
      `SELECT agent_path FROM agents
        WHERE agent_path IS NOT NULL AND agent_path <> ''`,
    );
    const names = new Set();
    const dirs  = new Set();
    for (const row of r.rows) {
      const p = String(row.agent_path);
      const base = p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p;
      if (base) names.add(base);
    }
    for (const row of allDirs.rows) {
      const p = String(row.agent_path);
      if (p.startsWith("/")) {
        const dir = p.slice(0, p.lastIndexOf("/"));
        if (dir) dirs.add(dir);
      }
    }
    const union = new Set(names);
    if (v && Array.isArray(v.list)) for (const s of v.list) if (s) union.add(String(s));
    setAllowedAgents([...union]);

    let baseDir = null;
    try {
      const { rows: br } = await pool.query("SELECT value FROM app_settings WHERE key='agents.base_dir'");
      const bv = br[0]?.value;
      const cand = typeof bv === "string" ? bv : (bv && typeof bv === "object" ? bv.path : "");
      if (cand && typeof cand === "string" && cand.trim()) baseDir = cand.trim();
    } catch { /* ignore */ }
    if (!baseDir) {
      const list = [...dirs];
      if (list.length === 1) baseDir = list[0];
      else if (list.length > 1) {
        let common = list[0];
        for (const d of list.slice(1)) {
          let i = 0; while (i < common.length && i < d.length && common[i] === d[i]) i++;
          common = common.slice(0, i);
        }
        if (common) baseDir = common.replace(/\/+$/, "");
      }
    }
    if (!baseDir) {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const candidates = [
          path.resolve(process.cwd(), "agents"),
          path.resolve(process.cwd(), "..", "agents"),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c) && fs.statSync(c).isDirectory()) { baseDir = c; break; }
        }
      } catch { /* ignore */ }
    }
    if (baseDir) setAgentsBaseDir(baseDir);
  } catch (e) {
    console.warn("[hydrateAllowedAgentsFromDb] error:", e?.message || e);
  }
}

export function initCockpitAllowlist(deps) {
  const {
    pool,
    getAllowedAgents,
    setAllowedAgents,
    setAgentsBaseDir,
    detectExecutionIntent,
  } = deps;

  const INTENT_GUARD = { mode: "auto" }; // "auto" | "force-on" | "force-off"

  function applyExecutionGuard(intentMeta, rawText, capCtx = {}) {
    if (INTENT_GUARD.mode === "force-off") return intentMeta;
    const ctx = {
      allowedAgents: getAllowedAgents(),
      toolsCount: capCtx.toolsCount || 0,
      skillsCount: capCtx.skillsCount || 0,
      agentsCount: capCtx.agentsCount || 0,
    };
    const sig = detectExecutionIntent(rawText, ctx);
    if (!sig.execution && INTENT_GUARD.mode !== "force-on") return intentMeta;
    if (!sig.execution) return intentMeta;
    return {
      ...intentMeta,
      kind: "query",
      useRag: false,
      mode: "execution-guard",
      executionReason: sig.reason,
      bypass: false,
    };
  }

  // --- Bridge telemetry bus (cockpit "Live Agent/Bridge Activity Terminal") ---
  const bridgeBusClients = new Set();
  function broadcastBridge(evt) {
    const line = `data: ${JSON.stringify({ ts: Date.now(), ...evt })}\n\n`;
    for (const c of bridgeBusClients) { try { c.write(line); } catch { /* */ } }
  }

  // --- Tools allow/deny caches ---
  let _allowedToolsCache = null;
  let _deniedToolsCache = null;

  async function getAllowedToolsList() {
    if (_allowedToolsCache !== null) return _allowedToolsCache;
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='tools.allowed'");
      const list = Array.isArray(rows?.[0]?.value?.list) ? rows[0].value.list : [];
      _allowedToolsCache = list.map(String);
    } catch { _allowedToolsCache = []; }
    return _allowedToolsCache;
  }

  async function getDeniedToolsList() {
    if (_deniedToolsCache !== null) return _deniedToolsCache;
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='tools.denied'");
      const list = Array.isArray(rows?.[0]?.value?.list) ? rows[0].value.list : [];
      _deniedToolsCache = list.map(String);
    } catch { _deniedToolsCache = []; }
    return _deniedToolsCache;
  }

  function isToolAllowed(toolId) {
    const id = String(toolId);
    if (_deniedToolsCache && _deniedToolsCache.includes(id)) return false;
    if (!_allowedToolsCache || !_allowedToolsCache.length) return true;
    return _allowedToolsCache.includes(id);
  }

  function mountCockpitRoutes(app) {
    // --- Intent Guard cockpit endpoints ----------------------------------------
    app.get("/api/system/intent-guard", (_req, res) => {
      res.json({ ok: true, mode: INTENT_GUARD.mode, modes: ["auto","force-on","force-off"] });
    });
    app.post("/api/system/intent-guard", async (req, res) => {
      const mode = String(req.body?.mode || "").trim();
      if (!["auto","force-on","force-off"].includes(mode)) {
        return res.status(400).json({ error: "mode must be auto|force-on|force-off" });
      }
      INTENT_GUARD.mode = mode;
      try {
        await pool.query(
          `INSERT INTO app_settings(key, value, updated_at) VALUES ('intent.guard', $1::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify({ mode })]
        );
      } catch (e) { console.warn("[intent-guard] persist failed:", String(e?.message || e)); }
      broadcastBridge({ kind: "guard", status: "updated", mode });
      res.json({ ok: true, mode });
    });

    // --- Agents allowlist cockpit endpoints ------------------------------------
    app.get("/api/system/agents-allowlist", (_req, res) => {
      res.json({ ok: true, allowed: getAllowedAgents(), source: process.env.ELARA_AGENTS_ALLOWED ? "env+db" : "db" });
    });
    app.post("/api/system/agents-allowlist", async (req, res) => {
      const raw = req.body?.allowed;
      const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
      const clean = list
        .map((s) => String(s || "").trim())
        .filter((s) => /^[\p{L}\p{N}_\-./]+\.py$/u.test(s));
      setAllowedAgents(clean);
      try {
        await pool.query(
          `INSERT INTO app_settings(key, value, updated_at) VALUES ('agents.allowed', $1::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify({ list: clean })]
        );
      } catch (e) { console.warn("[agents-allowlist] persist failed:", String(e?.message || e)); }
      broadcastBridge({ kind: "allowlist", status: "updated", count: clean.length });
      res.json({ ok: true, allowed: clean });
    });

    // --- Tools allowlist cockpit endpoints --------------------------------------
    app.get("/api/system/tools-allowlist", async (_req, res) => {
      const list = await getAllowedToolsList();
      res.json({ ok: true, allowed: list, source: "db" });
    });
    app.post("/api/system/tools-allowlist", async (req, res) => {
      const raw = req.body?.allowed;
      const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
      const clean = list.map((s) => String(s || "").trim()).filter(Boolean);
      _allowedToolsCache = clean;
      try {
        await pool.query(
          `INSERT INTO app_settings(key, value, updated_at) VALUES ('tools.allowed', $1::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify({ list: clean })]
        );
      } catch (e) { console.warn("[tools-allowlist] persist failed:", String(e?.message || e)); }
      broadcastBridge({ kind: "allowlist", status: "updated", target: "tools", count: clean.length });
      res.json({ ok: true, allowed: clean });
    });

    // --- Tools denylist cockpit endpoints --------------------------------------
    app.get("/api/system/tools-denylist", async (_req, res) => {
      const list = await getDeniedToolsList();
      res.json({ ok: true, denied: list, source: "db" });
    });
    app.post("/api/system/tools-denylist", async (req, res) => {
      const raw = req.body?.denied;
      const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
      const clean = [...new Set(list.map((s) => String(s || "").trim()).filter(Boolean))];
      _deniedToolsCache = clean;
      try {
        await pool.query(
          `INSERT INTO app_settings(key, value, updated_at) VALUES ('tools.denied', $1::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify({ list: clean })]
        );
      } catch (e) { console.warn("[tools-denylist] persist failed:", String(e?.message || e)); }
      broadcastBridge({ kind: "allowlist", status: "updated", target: "tools-denied", count: clean.length });
      res.json({ ok: true, denied: clean });
    });

    // --- Bridge telemetry SSE (cockpit terminal window) -------------------------
    app.get("/api/system/bridge-stream", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      res.write(`data: ${JSON.stringify({ ts: Date.now(), kind: "hello", guardMode: INTENT_GUARD.mode, allowed: getAllowedAgents() })}\n\n`);
      bridgeBusClients.add(res);
      const ka = setInterval(() => { try { res.write(`: keep-alive\n\n`); } catch { /* */ } }, 15000);
      req.on("close", () => { clearInterval(ka); bridgeBusClients.delete(res); });
    });
  }

  return {
    INTENT_GUARD,
    broadcastBridge,
    hydrateIntentGuardFromDb,
    hydrateAllowedAgentsFromDb,
    applyExecutionGuard,
    getAllowedToolsList,
    getDeniedToolsList,
    isToolAllowed,
    mountCockpitRoutes,
  };
}
