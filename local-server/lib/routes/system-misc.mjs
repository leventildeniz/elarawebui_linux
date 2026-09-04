// lib/routes/system-misc.mjs — admin/system maintenance + logs + uploads + STT.
// Extracted from server.mjs (Tur 2, 2026-05-30).
// Endpoints:
//   /api/cve, /api/cve/refresh
//   /api/retention/run
//   /api/system/host, /api/system/jobs, /api/system/jobs/:type, /api/system/jobs/:type/stop
//   /api/migrations (GET/apply/rollback)
//   /api/services/probe, /api/services/:key/:action
//   /api/system/hardware
//   /api/auth/test/:provider
//   /api/logs (POST/GET), /api/_debug/write-queues, /api/audit/stream
//   /api/debug/chat/recent, /api/debug/chat/:traceId
//   /api/uploads (POST/GET), /api/stt
// Helpers probeUrl/probePostgres/transcodeToWav16kMono içeride; sadece bu
// route'lar kullanıyordu.

import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { spawn } from "node:child_process";

async function probeUrl(url, timeoutMs = 1500) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return { ok: r.ok || r.status < 500, latency: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latency: Date.now() - t0, error: String(e.message || e) };
  }
}

function transcodeToWav16kMono(inputBuf) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:0",
      "-ar", "16000", "-ac", "1",
      "-f", "wav", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    const errChunks = [];
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.stderr.on("data", (c) => errChunks.push(c));
    ff.on("error", (e) => reject(new Error(`ffmpeg spawn failed: ${e.message} (brew install ffmpeg gerekebilir)`)));
    ff.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errChunks).toString().slice(0, 300)}`));
    });
    ff.stdin.on("error", () => {});
    ff.stdin.end(inputBuf);
  });
}

export function mountSystemMiscRoutes(app, deps) {
  const {
    pool, requireSession,
    sjClaim, sjRelease, sjHost, sjPid, sjList, sjActive, sjRequestStop, SJ_JOB_TYPES,
    cveIngestOnce, runRetention,
    ragJobs, cancelSyncJob,
    listMigrations, applyMigration, rollbackMigration,
    GATEWAY_PORT, EMBED_WORKER_PORT,
    probeWorkerHealth, ensureGateway, ensureWorker, killGateway, killWorker,
    getGatewayStatus, getWorkerStatus, getWorkerLastError,
    serviceRestartLog, RESTART_WINDOW_MS,
    authenticateLdap, probeLdap, authenticateRadius, probeRadius,
    pushLog,
    enqueueWrite, broadcastAudit, getWriteQueueDepths,
    sseBegin, auditClients,
    chatTraceList,
    upload, createLocalId, UPLOAD_DIR,
  } = deps;

  async function probePostgres() {
    const t0 = Date.now();
    try { await pool.query("SELECT 1"); return { ok: true, latency: Date.now() - t0 }; }
    catch (e) { return { ok: false, latency: Date.now() - t0, error: String(e.message || e) }; }
  }

  // ---- Old CVE (Migrated to separate route, leaving fallback for old clients if needed but mapped elsewhere) ----
  // Removed app.get("/api/cve") from here to avoid conflict with /api/cve in cve.mjs
  app.post("/api/cve/refresh", requireSession({ roles: ["admin"] }), async (_req, res) => {
    const claim = await sjClaim(pool, "cve_refresh", { trigger: "manual" }).catch(() => null);
    if (claim && claim.conflict) {
      return res.status(409).json({ ok: false, error: "cve_refresh already running", owner: claim.owner });
    }
    try {
      const out = await cveIngestOnce(pool);
      if (claim?.id) await sjRelease(pool, claim.id, "done");
      res.json(out);
    } catch (e) {
      if (claim?.id) await sjRelease(pool, claim.id, "error", String(e?.message || e));
      res.status(502).json({ error: String(e?.message || e) });
    }
  });

  // ---- Retention ----
  app.post("/api/retention/run", requireSession({ roles: ["admin"] }), async (req, res) => {
    const dryRun = req.query.dryRun === "1" || req.body?.dryRun === true;
    if (dryRun) {
      try { return res.json(await runRetention(pool, { dryRun: true })); }
      catch (e) { return res.status(500).json({ error: String(e?.message || e) }); }
    }
    const claim = await sjClaim(pool, "retention", { trigger: "manual" }).catch(() => null);
    if (claim && claim.conflict) {
      return res.status(409).json({ ok: false, error: "retention already running", owner: claim.owner });
    }
    try {
      const out = await runRetention(pool, { dryRun: false });
      if (claim?.id) await sjRelease(pool, claim.id, "done");
      res.json(out);
    } catch (e) {
      if (claim?.id) await sjRelease(pool, claim.id, "error", String(e?.message || e));
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // ---- Local Scripts (for skills and tools) ----
  app.get("/api/system/local-scripts", async (req, res) => {
    try {
      const elaraRoot = path.resolve(process.cwd(), ".."); // process.cwd() is local-server because middleware runs there
      const results = [];
      const folders = ["skills", "tools", "agents"];

      for (const f of folders) {
        const fullPath = path.join(elaraRoot, f);
        try {
          const files = await fs.readdir(fullPath, { withFileTypes: true, recursive: true });
          for (const file of files) {
            if (file.isFile() && file.name.endsWith(".py")) {
              const relPath = path.relative(elaraRoot, path.join(file.parentPath || file.path, file.name));
              results.push({
                folder: f,
                name: file.name,
                path: path.join(elaraRoot, relPath), // Keep it absolute for backend execs but relative for UI label
                relPath: relPath
              });
            }
          }
        } catch (e) {
          console.warn(`[local-scripts] Could not read folder ${f}: ${e.message}`);
        }
      }
      res.json({ ok: true, scripts: results });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ---- System host + jobs ----
  app.get("/api/system/host", (_req, res) => {
    res.json({ ok: true, host: sjHost(), pid: sjPid() });
  });

  app.get("/api/system/jobs", async (req, res) => {
    try {
      const recent = Math.min(50, Math.max(1, Number(req.query?.recent) || 20));
      const { active, recent: done } = await sjList(pool, { recent });
      res.json({ ok: true, host: sjHost(), active, recent: done });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/system/jobs/:type", async (req, res) => {
    try {
      const type = String(req.params.type || "");
      if (!SJ_JOB_TYPES.includes(type)) {
        return res.status(400).json({ ok: false, error: `unknown job_type: ${type}` });
      }
      const row = await sjActive(pool, type);
      res.json({ ok: true, host: sjHost(), job: row });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/system/jobs/:type/stop", async (req, res) => {
    try {
      const type = String(req.params.type || "");
      if (!SJ_JOB_TYPES.includes(type)) {
        return res.status(400).json({ ok: false, error: `unknown job_type: ${type}` });
      }
      const r = await sjRequestStop(pool, type);
      if (type === "sync") {
        try {
          for (const [id, j] of ragJobs.entries()) {
            if (j.status === "queued" || j.status === "running") cancelSyncJob(id, { force: false });
          }
        } catch {}
      }
      res.json({ ok: r.ok, owner: r.row || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---- Migrations ----
  app.get("/api/migrations", requireSession({ roles: ["admin"] }), async (_req, res) => {
    try { res.json({ items: await listMigrations(pool) }); }
    catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.post("/api/migrations/apply", requireSession({ roles: ["admin"] }), async (req, res) => {
    try { res.json(await applyMigration(pool, req.body || {})); }
    catch (e) { res.status(400).json({ error: String(e?.message || e) }); }
  });
  app.post("/api/migrations/rollback/:id", requireSession({ roles: ["admin"] }), async (req, res) => {
    try { res.json(await rollbackMigration(pool, req.params.id)); }
    catch (e) { res.status(400).json({ error: String(e?.message || e) }); }
  });

  // ---- Services ----
  app.post("/api/services/probe", async (req, res) => {
    const list = Array.isArray(req.body?.services) ? req.body.services : [];
    const now = Date.now();
    const out = await Promise.all(list.map(async (s) => {
      let probe;
      const key = String(s.key || "").toLowerCase();
      if (key.includes("gateway") || String(s.url || "").includes(`:${GATEWAY_PORT}`)) {
        probe = await probeUrl(`http://127.0.0.1:${GATEWAY_PORT}/health`);
        if (!probe.ok) ensureGateway().catch((e) => pushLog("server", `[gateway:probe-ensure] ${e?.message || e}`));
      }
      else if (key.includes("worker") || key.includes("embed") || String(s.url || "").includes(`:${EMBED_WORKER_PORT}`)) {
        const h = await probeWorkerHealth();
        probe = h?.ok ? { ok: true, latency: 0 } : { ok: false, latency: 0, error: getWorkerLastError() || "worker offline" };
        if (!probe.ok && process.env.MLX_EMBED_MODEL) ensureWorker().catch((e) => pushLog("worker", `[probe-ensure] ${e?.message || e}`));
      }
      else if (s.kind === "postgres") probe = await probePostgres();
      else if (s.url) probe = await probeUrl(s.url);
      else probe = { ok: false, latency: 0, error: "no probe url" };
      const restartedAt = serviceRestartLog.get(s.key);
      const state = (restartedAt && now - restartedAt < RESTART_WINDOW_MS)
        ? "restarting"
        : (probe.ok ? "running" : "stopped");
      return { key: s.key, name: s.name, state, latency: probe.latency, detail: probe.ok ? (s.url || s.kind || "ok") : probe.error };
    }));
    res.json({ ts: new Date().toISOString(), services: out });
  });

  app.post("/api/services/:key/:action", async (req, res) => {
    const { key, action } = req.params;
    if (!["start", "stop", "restart"].includes(action)) return res.status(400).json({ error: "invalid action" });
    const k = String(key || "").toLowerCase();
    if (k.includes("gateway")) {
      if (action === "stop" || action === "restart") killGateway();
      if (action === "start" || action === "restart") return res.json({ ok: true, key, action, ...(await ensureGateway()) });
      return res.json({ ok: true, key, action, status: getGatewayStatus() });
    }
    if (k.includes("worker") || k.includes("embed")) {
      if (action === "stop" || action === "restart") killWorker();
      if (action === "start" || action === "restart") return res.json({ ok: true, key, action, ...(await ensureWorker()) });
      return res.json({ ok: true, key, action, status: getWorkerStatus() });
    }
    if (action === "restart" || action === "start") {
      serviceRestartLog.set(key, Date.now());
    } else {
      serviceRestartLog.delete(key);
    }
    res.json({ ok: true, key, action, message: `${action} signal accepted (managed externally)` });
  });

  // ---- Hardware (read-only) ----
  app.post("/api/system/hardware", (req, res) => {
    console.log("[hardware]", req.body);
    res.status(501).json({ ok: false, error: "hardware control is read-only; no fake apply performed" });
  });

  // ---- Auth provider test ----
  app.post("/api/auth/test/:provider", async (req, res) => {
    const t0 = Date.now();
    const { provider } = req.params;
    const cfg = req.body ?? {};
    const liveUser = String(cfg.testUsername || "").trim();
    const livePass = String(cfg.testPassword || "");
    try {
      if (provider === "ldap") {
        if (liveUser && livePass) {
          const r = await authenticateLdap(cfg, liveUser, livePass);
          return res.status(r.ok ? 200 : 401).json({
            ok: !!r.ok,
            message: r.ok ? `LDAP bind OK · role=${r.role}` : `LDAP auth failed: ${r.error}`,
            latencyMs: Date.now() - t0,
            attributes: r.groups || [],
          });
        }
        const r = await probeLdap(cfg);
        return res.status(r.ok ? 200 : 502).json(r);
      }
      if (provider === "radius") {
        if (liveUser && livePass) {
          const r = await authenticateRadius(cfg, liveUser, livePass);
          return res.status(r.ok ? 200 : 401).json({
            ok: !!r.ok,
            message: r.ok
              ? `RADIUS Access-Accept · ${cfg.authMethod || "pap"} · role=${r.role}`
              : `RADIUS auth failed: ${r.error}`,
            latencyMs: Date.now() - t0,
            attributes: r.raw || {},
          });
        }
        const r = await probeRadius(cfg);
        return res.status(r.ok ? 200 : 502).json(r);
      }
      const target = cfg.metadataUrl || cfg.issuer || cfg.authorizeUrl || cfg.userinfoUrl;
      if (!target) {
        return res.status(400).json({ ok: false, message: "configuration incomplete", latencyMs: Date.now() - t0 });
      }
      const r = await fetch(String(target), { method: "GET", signal: AbortSignal.timeout(4000) });
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok, message: `${provider} probe HTTP ${r.status}`, latencyMs: Date.now() - t0 });
    } catch (e) {
      return res.status(502).json({ ok: false, message: `${provider} unreachable: ${String(e.message || e)}`, latencyMs: Date.now() - t0 });
    }
  });

  // ---- Logs ----
  app.post("/api/logs", (req, res) => {
    const { thread_id = null, agent, level = "info", message, meta = null } = req.body ?? {};
    if (!agent || !message) return res.status(400).json({ error: "missing fields" });
    enqueueWrite(
      `INSERT INTO agent_logs(thread_id, agent, level, message, meta)
       VALUES ($1,$2,$3,$4,$5)`,
      [thread_id, agent, level, message, typeof meta === "object" ? JSON.stringify(meta) : meta]
    );
    broadcastAudit({ thread_id, agent, level, message, meta });
    res.status(202).json({ queued: true });
  });

  app.get("/api/_debug/write-queues", (_req, res) => {
    res.json({ ...getWriteQueueDepths(), ts: Date.now() });
  });

  app.get("/api/audit/stream", (req, res) => {
    const sse = sseBegin(req, res, { hello: { ts: Date.now(), agent: "system", level: "info", message: "Audit feed connected" } });
    auditClients.add(res);
    // Keep-alive heartbeat so proxies / browsers do not silently drop the SSE
    // connection during idle periods — without this the UI shows "LIVE" but
    // never receives events after a few minutes of silence.
    const hb = setInterval(() => {
      try {
        sse.keepAlive();
        sse.sendNamed("heartbeat", { ts: Date.now(), agent: "heartbeat", level: "debug", message: "stream.heartbeat" });
      } catch { /* noop */ }
    }, 15000);
    res.on("close", () => { clearInterval(hb); auditClients.delete(res); });
  });

  app.get("/api/logs", async (req, res) => {
    try {
      const { thread_id, stream, level, actor, limit = "400", since } = req.query;
      const lim = Math.min(parseInt(String(limit), 10) || 400, 2000);
      const params = [];
      const whereConditions = [];

      if (thread_id) {
        params.push(thread_id);
        whereConditions.push(`thread_id = $${params.length}`);
      }

      if (stream && stream !== "all") {
        params.push(stream);
        whereConditions.push(`(agent = $${params.length} OR meta->>'stream' = $${params.length})`);
      }

      if (level && level !== "all") {
        params.push(level);
        whereConditions.push(`level = $${params.length}`);
      }

      if (actor && actor !== "any") {
        params.push(actor);
        whereConditions.push(`meta->>'actor' = $${params.length}`);
      }

      if (since) {
        const sinceDate = new Date(isNaN(Number(since)) ? String(since) : Number(since));
        if (!isNaN(sinceDate.getTime())) {
          params.push(sinceDate.toISOString());
          whereConditions.push(`created_at >= $${params.length}`);
        }
      }

      const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(" AND ")}` : "";
      params.push(lim);
      const { rows } = await pool.query(
        `SELECT id, thread_id, agent, level, message, meta, created_at 
         FROM agent_logs 
         ${whereClause} 
         ORDER BY created_at DESC 
         LIMIT $${params.length}`,
        params
      );
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/logs/purge", async (req, res) => {
    try {
      const { before } = req.body || {};
      if (before) {
        const beforeDate = new Date(isNaN(Number(before)) ? String(before) : Number(before));
        if (!isNaN(beforeDate.getTime())) {
          await pool.query(`DELETE FROM agent_logs WHERE created_at < $1`, [beforeDate.toISOString()]);
        }
      } else {
        await pool.query(`DELETE FROM agent_logs`);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get("/api/debug/chat/recent", (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 100));
    res.json({ ok: true, traces: chatTraceList().slice(-limit) });
  });

  app.get("/api/debug/chat/:traceId", (req, res) => {
    const traceId = String(req.params.traceId || "");
    const events = chatTraceList(traceId);
    const fmt = String(req.query?.format || "").toLowerCase();
    if (fmt === "text" || fmt === "txt") {
      const lines = events.map(e => {
        const ts = new Date(e.ts).toISOString();
        let detail = "";
        try { detail = e.detail ? JSON.stringify(e.detail) : ""; } catch { detail = String(e.detail); }
        return `[${ts}] ${String(e.level || "info").toUpperCase().padEnd(5)} ${e.stage} ${detail}`;
      });
      res.type("text/plain; charset=utf-8").send(`# trace ${traceId} (${events.length} events)\n` + lines.join("\n") + "\n");
      return;
    }
    res.json({ ok: true, traceId, events });
  });

  // ---- Uploads ----
  app.post("/api/uploads", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "file required" });
    const meta = {
      id: createLocalId(),
      thread_id: req.body?.thread_id ?? null,
      filename: req.file.originalname,
      stored:   req.file.filename,
      mime:     req.file.mimetype,
      size:     req.file.size,
      ext:      path.extname(req.file.originalname).toLowerCase(),
      path:     path.join(UPLOAD_DIR, req.file.filename),
    };
    enqueueWrite(
      `INSERT INTO chat_attachments(id, thread_id, filename, stored, mime, size_bytes, ext, path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [meta.id, meta.thread_id, meta.filename, meta.stored, meta.mime, meta.size, meta.ext, meta.path]
    );
    res.status(201).json(meta);
  });

  app.get("/api/uploads/:id", async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM chat_attachments WHERE id=$1", [req.params.id]);
    if (!rows[0]) return res.status(404).end();
    res.sendFile(rows[0].path);
  });

  // ---- STT ----
  app.post("/api/stt", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "file required" });
    const t0 = Date.now();
    const base = (process.env.STT_BASE_URL || "http://127.0.0.1:8090").replace(/\/+$/, "");
    const model = req.body?.model || process.env.STT_MODEL || "";
    const lang  = (req.body?.lang || process.env.STT_LANG || "auto").toLowerCase();
    const inMime = req.file.mimetype || "audio/webm";
    try {
      const rawBuf = fsSync.readFileSync(req.file.path);
      let wavBuf;
      try {
        wavBuf = await transcodeToWav16kMono(rawBuf);
      } catch (e) {
        return res.status(500).json({ error: `audio transcode failed (in=${inMime} bytes=${rawBuf.length}): ${String(e.message || e)}`, text: "", source: "stt:transcode-error", latencyMs: Date.now() - t0 });
      }
      const fd = new FormData();
      fd.append("file", new Blob([wavBuf], { type: "audio/wav" }), "audio.wav");
      if (model) fd.append("model", model);
      if (lang && lang !== "auto") fd.append("language", lang);
      const r = await fetch(`${base}/inference`, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        return res.status(502).json({ error: `stt upstream ${r.status}: ${txt.slice(0, 300)} (in=${inMime} wav=${wavBuf.length}B)`, source: "stt:upstream-error", text: "" });
      }
      const j = await r.json().catch(() => ({}));
      const text = String(j.text ?? j.transcription ?? "").trim();
      res.json({ text, lang: j.language ?? lang, latencyMs: Date.now() - t0, source: `stt:${base}`, in_mime: inMime, wav_bytes: wavBuf.length });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e), text: "", source: "stt:error", latencyMs: Date.now() - t0 });
    } finally {
      try { fsSync.unlinkSync(req.file.path); } catch {}
    }
  });
}
