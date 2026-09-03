// local-server/lib/routes/mcp.mjs
// MCP HTTP endpoints:
//   POST /mcp                    → Streamable HTTP JSON-RPC (external clients)
//   GET  /mcp/manifest.json      → discovery manifest
//   /api/mcp/*                   → admin panel CRUD (session-guarded)

import {
  getMcpSettings, updateMcpSettings,
  listExposures, upsertExposure, setExposureEnabled, deleteExposure,
  createToken, listTokens, revokeToken, verifyToken,
  recordCall, recentCalls, callStats,
} from "../mcp/registry.mjs";
import { listAllCandidates, buildMcpToolCatalog } from "../mcp/catalog.mjs";
import { handleMcpRpc, MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from "../mcp/protocol.mjs";
import {
  listServers as listClientServers, getServer as getClientServer,
  createServer as createClientServer, updateServer as updateClientServer,
  deleteServer as deleteClientServer, probeServer, recordProbe, callRemoteTool,
} from "../mcp/client.mjs";

// Simple per-token/IP rate limiter (in-memory sliding window per minute).
const _rateBuckets = new Map();
function rateLimitOk(key, limit) {
  if (!limit || limit <= 0) return true;
  const now = Date.now();
  const windowStart = now - 60_000;
  const arr = _rateBuckets.get(key) || [];
  const fresh = arr.filter((t) => t > windowStart);
  if (fresh.length >= limit) {
    _rateBuckets.set(key, fresh);
    return false;
  }
  fresh.push(now);
  _rateBuckets.set(key, fresh);
  return true;
}

function isLoopbackIp(ip) {
  if (!ip) return false;
  const s = String(ip).replace(/^::ffff:/, "");
  return s === "127.0.0.1" || s === "::1" || s === "localhost";
}

function remoteIp(req) {
  return (req.headers["x-forwarded-for"]?.split(",")[0]?.trim())
      || req.socket?.remoteAddress
      || req.ip
      || null;
}

function extractBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function mountMcpRoutes(app, deps) {
  const { pool, requireSession, port, broadcastAudit, enqueueWrite } = deps;

  const emitMcpLog = (level, action, message, meta = {}) => {
    const fullMeta = { tag: "mcp", stream: "mcp", ...meta };
    if (broadcastAudit) {
      try {
        broadcastAudit({
          agent: "mcp",
          level,
          message: `mcp.${action}: ${message}`,
          meta: fullMeta,
        });
      } catch (err) {
        console.warn("[mcp] broadcastAudit error:", err.message);
      }
    }
    if (enqueueWrite) {
      try {
        enqueueWrite(
          `INSERT INTO agent_logs(agent, level, message, meta) VALUES ($1,$2,$3,$4)`,
          ["mcp", level, `mcp.${action}:${message}`, fullMeta]
        );
      } catch (err) {
        console.warn("[mcp] enqueueWrite error:", err.message);
      }
    }
  };

  // --- Public MCP endpoint (external clients) --------------------------------

  async function mcpAuthGate(req, res) {
    const settings = await getMcpSettings(pool);
    if (!settings.enabled) {
      res.status(503).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "MCP server disabled" } });
      return null;
    }
    const ip = remoteIp(req);
    let clientId = "unknown";

    if (settings.auth_mode === "loopback") {
      if (!isLoopbackIp(ip)) {
        res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "loopback-only" } });
        return null;
      }
      clientId = "loopback";
    } else if (settings.auth_mode === "bearer") {
      const raw = extractBearer(req);
      if (!raw) {
        res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "bearer token required" } });
        return null;
      }
      const tok = await verifyToken(pool, raw);
      if (!tok) {
        res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "invalid token" } });
        return null;
      }
      clientId = `token:${tok.label}`;
    } else if (settings.auth_mode === "oauth") {
      // OAuth not yet wired — for now accept loopback OR a valid bearer as bootstrap.
      const raw = extractBearer(req);
      if (raw) {
        const tok = await verifyToken(pool, raw);
        if (tok) { clientId = `oauth-bootstrap:${tok.label}`; }
        else {
          res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "OAuth not configured; token invalid" } });
          return null;
        }
      } else if (isLoopbackIp(ip)) {
        clientId = "loopback";
      } else {
        res.status(501).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "OAuth mode: authorization required (not yet implemented)" } });
        return null;
      }
    }

    if (!rateLimitOk(clientId, settings.rate_limit_per_min)) {
      res.status(429).json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "rate limit exceeded" } });
      return null;
    }

    return { settings, clientId, ip };
  }

  // MCP Streamable HTTP requires POST with Accept: application/json, text/event-stream.
  app.post("/mcp", async (req, res) => {
    const gate = await mcpAuthGate(req, res);
    if (!gate) return;
    const { settings, clientId, ip } = gate;

    const body = req.body;
    const requests = Array.isArray(body) ? body : [body];
    const responses = [];

    for (const rpcReq of requests) {
      const t0 = Date.now();
      let out = null;
      try {
        out = await handleMcpRpc({
          pool, port,
          namespace: settings.namespace,
          req: rpcReq,
          clientTag: clientId,
        });
      } catch (e) {
        out = { method: "?", response: { jsonrpc: "2.0", id: rpcReq?.id ?? null, error: { code: -32000, message: e?.message || "handler crash" } } };
      }
      const dur = Date.now() - t0;
      recordCall(pool, {
        clientId,
        method: out.method || "?",
        toolName: out.toolName || null,
        ok: !out.response?.error,
        durationMs: dur,
        error: out.response?.error?.message || null,
        remoteIp: ip,
      });
      if (out.response) responses.push(out.response);
    }

    if (!responses.length) {
      // All notifications.
      return res.status(202).end();
    }
    res.setHeader("content-type", "application/json");
    res.json(Array.isArray(body) ? responses : responses[0]);
  });

  // GET /mcp — some clients probe with GET first; return capabilities blurb.
  app.get("/mcp", async (_req, res) => {
    const settings = await getMcpSettings(pool);
    res.json({
      transport: "streamable-http",
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: MCP_SERVER_INFO,
      enabled: settings.enabled,
      authMode: settings.auth_mode,
      namespace: settings.namespace,
      hint: "POST JSON-RPC 2.0 requests to this endpoint.",
    });
  });

  app.get("/mcp/manifest.json", async (_req, res) => {
    const settings = await getMcpSettings(pool);
    const catalog = settings.enabled ? await buildMcpToolCatalog(pool, settings.namespace) : [];
    res.json({
      name: MCP_SERVER_INFO.name,
      version: MCP_SERVER_INFO.version,
      protocolVersion: MCP_PROTOCOL_VERSION,
      enabled: settings.enabled,
      authMode: settings.auth_mode,
      namespace: settings.namespace,
      tools: catalog.map((t) => ({ name: t.name, description: t.description })),
    });
  });

  // --- Admin API (session-guarded) -------------------------------------------

  const admin = requireSession({ roles: ["admin"] });

  app.get("/api/mcp/settings", admin, async (_req, res) => {
    try {
      const [settings, stats] = await Promise.all([getMcpSettings(pool), callStats(pool)]);
      res.json({ ok: true, settings, stats });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/mcp/settings", admin, async (req, res) => {
    try {
      const s = await updateMcpSettings(pool, req.body || {});
      res.json({ ok: true, settings: s });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/mcp/exposures", admin, async (_req, res) => {
    try {
      const [exposures, candidates] = await Promise.all([listExposures(pool), listAllCandidates(pool)]);
      res.json({ ok: true, exposures, candidates });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/mcp/exposures", admin, async (req, res) => {
    try {
      const row = await upsertExposure(pool, req.body || {});
      res.json({ ok: true, exposure: row });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/mcp/exposures/toggle", admin, async (req, res) => {
    try {
      const { kind, slug, enabled } = req.body || {};
      const row = await setExposureEnabled(pool, { kind, slug, enabled });
      res.json({ ok: true, exposure: row });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/mcp/exposures/:id", admin, async (req, res) => {
    try { await deleteExposure(pool, req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/mcp/tokens", admin, async (_req, res) => {
    try { res.json({ ok: true, tokens: await listTokens(pool) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/mcp/tokens", admin, async (req, res) => {
    try {
      const { label } = req.body || {};
      const created = await createToken(pool, { label, createdBy: req.session?.username || null });
      res.json({ ok: true, ...created, warning: "This token is shown only once. Copy it now." });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/mcp/tokens/:id", admin, async (req, res) => {
    try { await revokeToken(pool, req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/mcp/history", admin, async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
      const [rows, stats] = await Promise.all([recentCalls(pool, { limit }), callStats(pool)]);
      res.json({ ok: true, history: rows, stats });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/mcp/preview-catalog", admin, async (_req, res) => {
    try {
      const settings = await getMcpSettings(pool);
      const catalog = await buildMcpToolCatalog(pool, settings.namespace);
      res.json({ ok: true, namespace: settings.namespace, count: catalog.length, tools: catalog });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- MCP Client (outbound) — connect to remote MCP servers -----------------

  app.get("/api/mcp/client/servers", admin, async (req, res) => {
    try {
      const ctx = await deps.resolveActorContext(req);
      const vis = deps.buildVisibility(ctx, 1, 'owner_id');
      const { rows } = await pool.query(
        `SELECT id, name, slug, url, transport, auth_type, auth_config, enabled, auto_inject,
            tools_cache, last_probe_at, last_status, last_error, created_at, updated_at,
            owner_id, owner_name, visibility, shared_with
         FROM mcp_client_servers WHERE ${vis.clause} ORDER BY created_at ASC`,
         vis.params
      );
      res.json({ ok: true, servers: rows });
    }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/mcp/client/servers", admin, async (req, res) => {
    try {
      const payload = { ...req.body };
      
      let actorCtx = null;
      if (deps.resolveActorContext) {
        actorCtx = await deps.resolveActorContext(req);
      }
      
      payload.owner_id = payload.owner_id || payload.ownerId || actorCtx?.userId || req.actor || null;
      payload.owner_name = payload.owner_name || payload.ownerName || null;

      const srv = await createClientServer(pool, payload);
      emitMcpLog("info", "server.created", `${srv.name || srv.slug} (${srv.url})`, { id: srv.id, slug: srv.slug });
      // Kick off initial probe (non-blocking; result stored on server row).
      probeServer(srv).then((r) => recordProbe(pool, srv.id, r)).catch(() => {});
      res.json({ ok: true, server: srv });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.patch("/api/mcp/client/servers/:id", admin, async (req, res) => {
    try {
      const srv = await updateClientServer(pool, req.params.id, req.body || {});
      emitMcpLog("info", "server.updated", `${srv.name || srv.slug}`, { id: srv.id, slug: srv.slug });
      res.json({ ok: true, server: srv });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete("/api/mcp/client/servers/:id", admin, async (req, res) => {
    try {
      await deleteClientServer(pool, req.params.id);
      emitMcpLog("warn", "server.deleted", `id=${req.params.id}`, { id: req.params.id });
      res.json({ ok: true });
    }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post("/api/mcp/client/servers/:id/probe", admin, async (req, res) => {
    try {
      const srv = await getClientServer(pool, req.params.id);
      if (!srv) return res.status(404).json({ error: "server not found" });
      const result = await probeServer(srv);
      await recordProbe(pool, srv.id, result);
      emitMcpLog(result.ok ? "info" : "warn", "probe", `${srv.slug} · status=${result.status}`, { id: srv.id, slug: srv.slug, status: result.status });
      const fresh = await getClientServer(pool, srv.id);
      res.json({ ok: true, server: fresh, probe: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/mcp/client/servers/:id/call", admin, async (req, res) => {
    try {
      const srv = await getClientServer(pool, req.params.id);
      if (!srv) return res.status(404).json({ error: "server not found" });
      const { tool, args } = req.body || {};
      if (!tool) return res.status(400).json({ error: "tool required" });
      emitMcpLog("info", "call.start", `${srv.slug}/${tool}`, { server: srv.slug, tool });
      const result = await callRemoteTool(srv, tool, args || {});
      emitMcpLog("info", "call.done", `${srv.slug}/${tool} completed`, { server: srv.slug, tool });
      res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

