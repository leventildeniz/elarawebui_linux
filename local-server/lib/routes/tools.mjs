// local-server/lib/routes/tools.mjs
// Block J Tur 1C — Tools invoke + approvals + invocations + agent dispatch + bindings.
// Pure routing layer; behavior must match server.mjs 1:1.

import { dispatchInjectedCall } from "../mcp/client.mjs";

export function mountToolRoutes(app, deps) {
  const {
    pool,
    requireSession,
    rlInvoke,
    invokeTool,
    listPendingApprovals,
    decideApproval,
    ApprovalRequired,
    ToolPolicyError,
    isLoopback,
    getAgentManifest,
    reloadManifests,
  } = deps;

  // Geliştirici Yaması: rlInvoke veya requireSession undefined ise diye önlem alıyoruz
  const safeRlInvoke = rlInvoke || ((req, res, next) => next());
  const safeSession = typeof requireSession === "function" ? requireSession() : ((req, res, next) => next());

  app.post("/api/tools/:id/invoke", safeRlInvoke, safeSession, async (req, res) => {
    try {
      const { agent_id = null, params = {} } = req.body || {};
      const result = await invokeTool({
        toolId: req.params.id,
        agentId: agent_id,
        username: req.session?.username || null,
        sessionId: req.session?.id || null,
        params,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      if (e instanceof ApprovalRequired) {
        return res.status(202).json({ ok: false, approvalRequired: true, invocationId: e.invocationId, message: e.message });
      }
      if (e instanceof ToolPolicyError) {
        return res.status(e.code === "acl" ? 403 : e.code === "not_found" ? 404 : 400)
          .json({ error: e.message, code: e.code });
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/tool-approvals/pending", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const rows = await listPendingApprovals({ limit: Number(req.query.limit) || 50 });
      res.json({ ok: true, pending: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/tool-approvals/:invocationId/decide", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const { decision, reason = "" } = req.body || {};
      const out = await decideApproval(req.params.invocationId, {
        approver: req.session?.username || "admin", decision, reason,
      });
      res.json({ ok: true, ...out });
    } catch (e) {
      if (e instanceof ToolPolicyError) return res.status(400).json({ error: e.message, code: e.code });
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/tool-invocations", requireSession(), async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
      const args = [];
      const where = [];
      if (req.query.tool_id)  { args.push(req.query.tool_id);  where.push(`tool_id=$${args.length}`); }
      if (req.query.agent_id) { args.push(req.query.agent_id); where.push(`agent_id=$${args.length}`); }
      if (req.query.status)   { args.push(req.query.status);   where.push(`status=$${args.length}`); }
      const sql = `SELECT id,tool_id,adapter,agent_id,username,status,risk_level,started_at,finished_at,duration_ms,error
                     FROM tool_invocations${where.length ? " WHERE " + where.join(" AND ") : ""}
                    ORDER BY started_at DESC LIMIT ${limit}`;
      const { rows } = await pool.query(sql, args);
      res.json({ ok: true, invocations: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // -----------------------------------------------------------------------------
  // TUR-6 — Agent → Tool dispatch endpoint
  // Loopback-only; auth = X-Agent-Id header + manifest gate (`# @tools: …`)
  // -----------------------------------------------------------------------------
  app.post("/api/agents/tool-call", safeRlInvoke, async (req, res) => {
    try {
      if (!isLoopback(req)) {
        return res.status(403).json({ ok: false, error: "loopback only", code: "not_loopback" });
      }
      const agentId = String(req.get("X-Agent-Id") || "").trim();
      if (!agentId) return res.status(400).json({ ok: false, error: "X-Agent-Id header required", code: "no_agent" });

      const { tool, input = {}, dryRun = false } = req.body || {};
      const slug = String(tool || "").trim().toLowerCase();
      if (!slug) return res.status(400).json({ ok: false, error: "tool slug required", code: "no_tool" });

      // MCP-client injected remote tool: "mcp:<serverSlug>.<toolName>"
      if (slug.startsWith("mcp:")) {
        if (dryRun) return res.json({ ok: true, dryRun: true, agentId, slug, remote: true });
        const remoteResult = await dispatchInjectedCall(pool, slug, input);
        if (!remoteResult.ok) {
          return res.status(remoteResult.reason === "server_not_found" ? 404 : 400)
            .json({ ok: false, error: remoteResult.reason || "mcp_dispatch_failed", code: "mcp_error", detail: remoteResult });
        }
        return res.json({ ok: true, remote: true, result: remoteResult.result });
      }

      const manifest = await getAgentManifest(agentId);
      if (!manifest) {
        return res.status(404).json({ ok: false, error: `unknown agent: ${agentId}`, code: "no_agent" });
      }
      if (manifest.tools === null) {
        return res.status(403).json({ ok: false, error: "agent has no @tools manifest", code: "no_manifest" });
      }
      if (!manifest.tools.includes(slug)) {
        return res.status(403).json({
          ok: false, code: "not_in_agent_manifest",
          error: `tool '${slug}' not in agent '${agentId}' manifest`,
          allowed: manifest.tools,
        });
      }

      const lookup = await pool.query(
        `SELECT id FROM action_library
         WHERE lower(id)=$1 OR lower(name)=$1 OR lower(slug)=$1
         LIMIT 1`,
        [slug]
      ).catch(async () => pool.query(
        `SELECT id FROM action_library WHERE lower(id)=$1 OR lower(name)=$1 LIMIT 1`, [slug]
      ));
      if (!lookup.rows.length) {
        return res.status(404).json({ ok: false, error: `tool '${slug}' not found in action_library`, code: "tool_not_found" });
      }
      const toolId = lookup.rows[0].id;

      if (dryRun) {
        return res.json({ ok: true, dryRun: true, agentId, toolId, slug });
      }

      const result = await invokeTool({
        toolId,
        agentId,
        username: `agent:${agentId}`,
        sessionId: null,
        params: input,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      if (e instanceof ApprovalRequired) {
        return res.status(202).json({ ok: false, approvalRequired: true, invocationId: e.invocationId, message: e.message });
      }
      if (e instanceof ToolPolicyError) {
        return res.status(e.code === "acl" ? 403 : e.code === "not_found" ? 404 : 400)
          .json({ ok: false, error: e.message, code: e.code });
      }
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/api/agents/reload-manifests", requireSession({ roles: ["admin"] }), async (_req, res) => {
    try {
      const out = await reloadManifests();
      res.json({ ok: true, ...out });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // --- Tool ↔ Adapter bindings ------------------------------------------------
  app.get("/api/tools/:id/adapter-bindings", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT b.adapter_id, b.enabled, t.name, t.category, t.connection_type, t.risk_level
           FROM tool_adapter_bindings b
           JOIN tools t ON t.id=b.adapter_id
          WHERE b.tool_id=$1 ORDER BY t.name`,
        [req.params.id]);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.put("/api/tools/:id/adapter-bindings", async (req, res) => {
    const id = String(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM tool_adapter_bindings WHERE tool_id=$1", [id]);
      for (const b of items) {
        const adapter_id = String(b.adapter_id || "").trim();
        if (!adapter_id) continue;
        const enabled = b.enabled === false ? false : true;
        await client.query(
          `INSERT INTO tool_adapter_bindings(tool_id,adapter_id,enabled)
           VALUES ($1,$2,$3)
           ON CONFLICT (tool_id,adapter_id) DO UPDATE SET enabled=EXCLUDED.enabled`,
          [id, adapter_id, enabled]);
      }
      await client.query("COMMIT");
      res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => void 0);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally { client.release(); }
  });

  // --- Tool ↔ Target / Group bindings (Tur-3.1) ---------------------------
  app.get("/api/tools/:id/target-bindings", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT scope, ref_id, enabled FROM tool_target_bindings
          WHERE tool_id=$1 ORDER BY scope, ref_id`, [req.params.id]);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.put("/api/tools/:id/target-bindings", async (req, res) => {
    const id = String(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM tool_target_bindings WHERE tool_id=$1", [id]);
      for (const b of items) {
        const scope = b.scope === "group" ? "group" : "target";
        const ref_id = String(b.ref_id || "").trim();
        if (!ref_id) continue;
        const enabled = b.enabled === false ? false : true;
        await client.query(
          `INSERT INTO tool_target_bindings(tool_id,scope,ref_id,enabled)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (tool_id,scope,ref_id) DO UPDATE SET enabled=EXCLUDED.enabled`,
          [id, scope, ref_id, enabled]);
      }
      await client.query("COMMIT");
      res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => void 0);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally { client.release(); }
  });

  // --- Reverse binding: which agents have this tool whitelisted ----------------
  app.get("/api/tools/:id/agents", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT a.id, a.name, a.status, a.priority
           FROM agent_capabilities ac
           JOIN agents a ON a.id = ac.agent_id
          WHERE ac.kind = 'tool' AND ac.ref_id = $1
          ORDER BY a.priority DESC NULLS LAST, a.name ASC`,
        [req.params.id]);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}
