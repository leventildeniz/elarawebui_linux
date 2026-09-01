// lib/routes/agents-templates.mjs — Tur 4 extraction (2026-05-30)
// Endpoints:
//   GET    /api/bridge/health
//   GET    /api/siem/config
//   PUT    /api/siem/config
//   POST   /api/siem/test
//   GET    /api/me/prefs
//   PUT    /api/me/prefs
//   GET    /api/app-settings/:key
//   POST   /api/app-settings/:key
//   POST   /api/chat/cross-reference
//   GET    /api/app-agents
//   POST   /api/app-agents
//   DELETE /api/app-agents/:id
//   POST   /api/app-agents/:id/ping
//   POST   /api/tts
//   GET    /api/templates
//   POST   /api/templates
//   DELETE /api/templates/:id
//   GET    /api/system/diag/admin-token
//   GET    /api/system/logs/stream
//
// Behavior unchanged — pure relocation with DI.

import path from "node:path";

export function mountAgentsTemplatesRoutes(app, deps) {
  const {
    pool, migrateReady,
    // bridge/health
    hydrateRuntimeProviderFromDb, runtimeUpstreamBase, runtimeBase, runtimeIsLocal, joinRuntimePath,
    // siem
    isAdminCaller, siem, enqueueWrite,
    // me/prefs
    resolveActorId,
    // cross-reference
    _buildFtsOrQuery,
    // app-agents
    resolveActorContext, buildVisibility, createPrefixedId, resolveActor, rowToAppAgent,
    // templates
    rowToTemplate, providerPolicyCacheClear,
    // logs stream
    sseBegin, SYS_LOG_RING, SYS_LOG_SUBS,
  } = deps;

  // ---- bridge/health ------------------------------------------------------
  app.get("/api/bridge/health", async (_req, res) => {
    const probes = { mw: true, agents3001: false, llm: false };
    try { const r = await fetch("http://127.0.0.1:3001/health", { signal: AbortSignal.timeout(1500) }); probes.agents3001 = r.ok; } catch {}
    await hydrateRuntimeProviderFromDb({ quiet: true });
    const base = runtimeUpstreamBase(runtimeBase());
    if (base) {
      const p = runtimeIsLocal(base) ? "/v1/models" : "/api/tags";
      try { const r = await fetch(joinRuntimePath(base, p), { signal: AbortSignal.timeout(1500) }); probes.llm = r.ok; } catch {}
    }
    res.json(probes);
  });

  // ---- SIEM ---------------------------------------------------------------
  app.get("/api/siem/config", async (_req, res) => {
    try {
      const r = await pool.query("SELECT enabled, host, port, protocol, format, facility, updated_at FROM app_siem_config WHERE id=1");
      res.json({ ok: true, config: r.rows[0] || null, status: siem.status() });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.put("/api/siem/config", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin role required" });
    const { enabled, host, port, protocol, format, facility } = req.body ?? {};
    const proto = ["udp","tcp","tls"].includes(protocol) ? protocol : "udp";
    const fmt = ["CEF","LEEF","JSON","RFC5424"].includes(format) ? format : "CEF";
    try {
      await pool.query(
        `UPDATE app_siem_config SET enabled=$1, host=$2, port=$3, protocol=$4, format=$5, facility=$6, updated_at=now() WHERE id=1`,
        [!!enabled, String(host || "").slice(0,255), Math.max(1, Math.min(65535, Number(port) || 514)), proto, fmt, String(facility || "local0").slice(0,32)]
      );
      siem.applyConfig({ enabled: !!enabled, host, port: Number(port) || 514, protocol: proto, format: fmt, facility: facility || "local0" });
      enqueueWrite(`INSERT INTO agent_logs(agent,level,message,meta) VALUES ('siem','info',$1,$2)`,
        [`config-updated:${proto}://${host}:${port}`, { by: req.actor || "unknown", format: fmt }]);
      res.json({ ok: true, status: siem.status() });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.post("/api/siem/test", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin role required" });
    const { host, port, protocol, format, facility } = req.body ?? {};
    if (host) {
      const prev = { ...siem.cfg };
      siem.applyConfig({ enabled: true,
        host, port: Number(port) || 514,
        protocol: ["udp","tcp","tls"].includes(protocol) ? protocol : "udp",
        format: ["CEF","LEEF","JSON","RFC5424"].includes(format) ? format : "CEF",
        facility: facility || "local0",
      });
      const result = await siem.test();
      siem.applyConfig(prev);
      return res.json(result);
    }
    res.json(await siem.test());
  });

  // ---- me/prefs -----------------------------------------------------------
  app.get("/api/me/prefs", async (req, res) => {
    try {
      const uid = await resolveActorId(req);
      if (!uid) return res.json({ ok: true, prefs: {}, updatedAt: null });
      const r = await pool.query("SELECT prefs, updated_at FROM app_user_prefs WHERE user_id=$1", [uid]);
      if (!r.rows[0]) return res.json({ ok: true, prefs: {}, updatedAt: null });
      res.json({ ok: true, prefs: r.rows[0].prefs ?? {}, updatedAt: new Date(r.rows[0].updated_at).toISOString() });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.put("/api/me/prefs", async (req, res) => {
    try {
      const uid = await resolveActorId(req);
      if (!uid) return res.status(401).json({ ok: false, error: "no actor" });
      const incoming = req.body && typeof req.body === "object" ? req.body : {};
      const allow = ["theme","mode","font","fontSize","customPalette","locale","chatOrder","sidebar"];
      const patch = {};
      for (const k of allow) if (k in incoming) patch[k] = incoming[k];
      const cur = (await pool.query("SELECT prefs FROM app_user_prefs WHERE user_id=$1", [uid])).rows[0]?.prefs ?? {};
      const merged = { ...cur, ...patch };
      await pool.query(
        `INSERT INTO app_user_prefs(user_id, prefs, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (user_id) DO UPDATE SET prefs=EXCLUDED.prefs, updated_at=now()`,
        [uid, JSON.stringify(merged)]
      );
      res.json({ ok: true, prefs: merged, updatedAt: new Date().toISOString() });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  // ---- app-settings KV ----------------------------------------------------
  app.get("/api/app-settings/:key", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key=$1", [req.params.key]);
      res.json({ key: req.params.key, value: rows[0]?.value ?? null });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.post("/api/app-settings/:key", async (req, res) => {
    try {
      await pool.query(
        `INSERT INTO app_settings(key,value,updated_at) VALUES ($1,$2,now())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [req.params.key, req.body?.value ?? {}]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // ---- cross-reference ----------------------------------------------------
  app.post("/api/chat/cross-reference", async (req, res) => {
    const { query } = req.body || {};
    const q = String(query || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "query required" });
    const groups = ["file", "url", "video", "audio", "image", "messaging", "text"];
    const out = {};
    const orQ = _buildFtsOrQuery(q);
    for (const g of groups) {
      if (!orQ) { out[g] = []; continue; }
      const r = await pool.query(
        `SELECT file_id, path, brand, source_type, version, source_timestamp, content,
                ts_rank(tsv, to_tsquery('simple', $1)) AS rank
         FROM knowledge_chunks
         WHERE tsv @@ to_tsquery('simple', $1)
           AND COALESCE(source_type, root) ILIKE $2
         ORDER BY rank DESC, source_timestamp DESC NULLS LAST
         LIMIT 3`,
        [orQ, `%${g}%`]
      ).catch(() => ({ rows: [] }));
      out[g] = r.rows.map(row => ({
        title: path.basename(row.path || ""),
        brand: row.brand,
        version: row.version,
        timestamp: row.source_timestamp,
        snippet: String(row.content).slice(0, 600),
      }));
    }
    const newest = (arr) => arr.slice().sort((a,b) => (new Date(b.timestamp||0)) - (new Date(a.timestamp||0)))[0];
    const synthesisLines = [];
    for (const g of groups) {
      const top = newest(out[g] || []);
      if (top) synthesisLines.push(`**${g.toUpperCase()}** (${top.brand || "—"}, v${top.version || 1}, ${top.timestamp || "no-date"}): ${top.snippet.slice(0, 200).replace(/\s+/g," ")}…`);
    }
    res.json({ ok: true, query: q, groups: out, synthesis: synthesisLines.join("\n\n") });
  });

  // ---- app-agents ---------------------------------------------------------
  app.get("/api/app-agents", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      const vis = buildVisibility(ctx, 1, "owner_user_id");
      const whereSql = vis.clause ? `WHERE ${vis.clause}` : "";
      const { rows } = await pool.query(`SELECT * FROM app_agents ${whereSql} ORDER BY agent_name`, vis.params);
      res.json(rows.map(rowToAppAgent));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.post("/api/app-agents", async (req, res) => {
    const a = req.body ?? {};
    const id = a.id || createPrefixedId("aa_");
    const owner = await resolveActor(req);
    try {
      await pool.query(
        `INSERT INTO app_agents(id,agent_name,script_path,bridge_url,role,status,description,owner_user_id,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (id) DO UPDATE SET
           agent_name=EXCLUDED.agent_name, script_path=EXCLUDED.script_path,
           bridge_url=EXCLUDED.bridge_url, role=EXCLUDED.role,
            status=EXCLUDED.status, description=EXCLUDED.description,
            owner_user_id=COALESCE(app_agents.owner_user_id, EXCLUDED.owner_user_id), updated_at=now()`,
        [id, a.agentName ?? "agent", a.scriptPath ?? "", a.bridgeUrl ?? "",
         a.role ?? "general", a.status ?? "idle", a.description ?? "", owner]
      );
      const { rows } = await pool.query("SELECT * FROM app_agents WHERE id=$1", [id]);
      res.json({ ok: true, agent: rowToAppAgent(rows[0]) });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.delete("/api/app-agents/:id", async (req, res) => {
    try { await pool.query("DELETE FROM app_agents WHERE id=$1", [req.params.id]); res.status(204).end(); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.post("/api/app-agents/:id/ping", async (req, res) => {
    const t0 = Date.now();
    try {
      const { rows } = await pool.query("SELECT bridge_url FROM app_agents WHERE id=$1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: "agent not found" });
      const url = String(rows[0].bridge_url || "").trim();
      if (!url) return res.json({ ok: false, latencyMs: 0, error: "no bridge_url configured" });
      try {
        const candidates = [url, url.replace(/\/+$/, "") + "/health", url.replace(/\/+$/, "") + "/ping"];
        let lastErr = "";
        for (const u of candidates) {
          try {
            const r = await fetch(u, { signal: AbortSignal.timeout(2500) });
            if (r.ok) return res.json({ ok: true, status: r.status, latencyMs: Date.now() - t0, url: u });
            lastErr = `HTTP ${r.status}`;
          } catch (e) { lastErr = String(e.message || e); }
        }
        return res.json({ ok: false, latencyMs: Date.now() - t0, error: lastErr || "unreachable" });
      } catch (e) { return res.json({ ok: false, latencyMs: Date.now() - t0, error: String(e.message || e) }); }
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // ---- TTS ----------------------------------------------------------------
  app.post("/api/tts", async (req, res) => {
    const t0 = Date.now();
    const { text = "", lang = "en", provider = "openai", voice, format = "mp3" } = req.body ?? {};
    if (!text || typeof text !== "string") return res.status(400).json({ ok: false, error: "text required" });
    const trimmed = text.slice(0, 4000);
    try {
      if (provider === "openai") {
        const key = process.env.OPENAI_API_KEY;
        if (!key) return res.status(503).json({ ok: false, error: "OPENAI_API_KEY not configured" });
        const r = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "tts-1-hd", input: trimmed,
            voice: voice || (lang === "tr" ? "nova" : lang === "de" ? "onyx" : "alloy"),
            format,
          }),
        });
        if (!r.ok) {
          const err = await r.text().catch(() => "");
          return res.status(502).json({ ok: false, error: `openai tts: ${r.status} ${err.slice(0,200)}` });
        }
        const buf = Buffer.from(await r.arrayBuffer());
        enqueueWrite(
          `INSERT INTO provider_usage(provider_id,provider_name,kind,model,total_tokens,latency_ms,status)
           VALUES (NULL,'remote-tts','tts',$1,$2,$3,'ok')`,
          ["tts-1-hd", (trimmed.length/4)|0, Date.now()-t0]
        );
        res.setHeader("Content-Type", format === "mp3" ? "audio/mpeg" : `audio/${format}`);
        return res.end(buf);
      }
      if (provider === "gcloud") {
        const key = process.env.GCLOUD_TTS_API_KEY;
        if (!key) return res.status(503).json({ ok: false, error: "GCLOUD_TTS_API_KEY not configured" });
        const langCode = lang === "tr" ? "tr-TR" : lang === "de" ? "de-DE" : "en-US";
        const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text: trimmed },
            voice: { languageCode: langCode, name: voice || undefined, ssmlGender: "NEUTRAL" },
            audioConfig: { audioEncoding: "MP3" },
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.audioContent) return res.status(502).json({ ok: false, error: j.error?.message || "gcloud tts failed" });
        const buf = Buffer.from(j.audioContent, "base64");
        enqueueWrite(
          `INSERT INTO provider_usage(provider_id,provider_name,kind,model,total_tokens,latency_ms,status)
           VALUES (NULL,'gcloud-tts','tts','wavenet',$1,$2,'ok')`,
          [(trimmed.length/4)|0, Date.now()-t0]
        );
        res.setHeader("Content-Type", "audio/mpeg");
        return res.end(buf);
      }
      res.status(400).json({ ok: false, error: `unknown provider '${provider}'` });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // ---- Templates ----------------------------------------------------------
  app.get("/api/templates", async (_req, res) => {
    try {
      await migrateReady;
      const r = await pool.query("SELECT * FROM app_templates ORDER BY created_at DESC");
      res.json(r.rows.map(rowToTemplate));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.post("/api/templates", async (req, res) => {
    try {
      await migrateReady;
      const t = req.body || {};
      const id = String(t.id || `tpl-${Date.now()}`);
      const name = String(t.name || "New Template").slice(0, 200);
      const sp = String(t.systemPrompt ?? "");
      const temp = Math.max(0, Math.min(2, Number(t.temperature ?? 0.4)));
      const topP = Math.max(0, Math.min(1, Number(t.topP ?? 0.9)));
      const maxTok = Math.max(1, Math.min(131072, Number(t.maxTokens ?? 4096) | 0));
      const params = JSON.stringify(Array.isArray(t.params) ? t.params : []);
      const agents = JSON.stringify(Array.isArray(t.agents) ? t.agents : []);
      const oe = t.ownerEditable !== false;
      const allowedProv = JSON.stringify(Array.isArray(t.allowedProviders) ? t.allowedProviders : []);
      const canOv = t.canOverrideProvider !== false;
      const allowedTools = JSON.stringify(Array.isArray(t.allowedTools) ? t.allowedTools : []);
      const allowedSkills = JSON.stringify(Array.isArray(t.allowedSkills) ? t.allowedSkills : []);
      const r = await pool.query(
        `INSERT INTO app_templates (id,name,system_prompt,temperature,top_p,max_tokens,params,agents,owner_editable,allowed_providers,can_override_provider,allowed_tools,allowed_skills)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, system_prompt=EXCLUDED.system_prompt,
           temperature=EXCLUDED.temperature, top_p=EXCLUDED.top_p, max_tokens=EXCLUDED.max_tokens,
           params=EXCLUDED.params, agents=EXCLUDED.agents, owner_editable=EXCLUDED.owner_editable,
           allowed_providers=EXCLUDED.allowed_providers, can_override_provider=EXCLUDED.can_override_provider,
           allowed_tools=EXCLUDED.allowed_tools,
           allowed_skills=EXCLUDED.allowed_skills,
           updated_at=now()
         RETURNING *`,
        [id, name, sp, temp, topP, maxTok, params, agents, oe, allowedProv, canOv, allowedTools, allowedSkills]
      );
      providerPolicyCacheClear();
      res.json(rowToTemplate(r.rows[0]));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.delete("/api/templates/:id", async (req, res) => {
    try {
      await migrateReady;
      await pool.query("DELETE FROM app_templates WHERE id=$1", [req.params.id]);
      providerPolicyCacheClear();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // ---- system/diag/admin-token -------------------------------------------
  app.get("/api/system/diag/admin-token", (_req, res) => {
    const t = String(process.env.ADMIN_API_TOKEN || "").trim();
    if (!t) return res.json({ configured: false, len: 0, prefix: "", suffix: "" });
    res.json({
      configured: true,
      len: t.length,
      prefix: t.slice(0, 4),
      suffix: t.slice(-4),
    });
  });

  // ---- system/logs/stream -------------------------------------------------
  app.get("/api/system/logs/stream", (req, res) => {
    const sse = sseBegin(req, res);
    for (const evt of SYS_LOG_RING) sse.send(evt);
    const sub = (evt) => sse.send(evt);
    SYS_LOG_SUBS.add(sub);
    const ka = setInterval(() => sse.keepAlive(), 15000);
    req.on("close", () => { clearInterval(ka); SYS_LOG_SUBS.delete(sub); });
  });
}
