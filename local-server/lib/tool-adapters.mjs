// =============================================================================
// tool-adapters.mjs — Faz 5
// Standardize tool execution behind a single contract:
//   invokeTool({ toolId, agentId, username, sessionId, runId, params, signal })
//     -> { invocationId, status, output, error, approvalRequired? }
//
// Adapters:
//   - http   : signed/proxied HTTP call (config.url, method, headers, body template)
//   - python : worker.py / forge runner üzerinden script (config.script)
//   - mcp    : MCP tool çağrısı (config.server, config.name)
//   - forge  : in-house forge skill runtime (config.skill_id)
//   - builtin: legacy workflow node handler (geriye dönük)
//
// Policy:
//   1) Tool DB'den okunur; enabled + adapter + risk_level + requires_approval alınır.
//   2) Agent verilmişse `agent_capabilities` üstünden whitelist doğrulanır.
//   3) requires_approval=true VEYA risk_level ∈ {high,critical} ise:
//      - tool_invocations.status='pending', tool_approvals satırı açılır.
//      - { approvalRequired:true, invocationId } döner; runner bekler.
//   4) Approval yoksa veya approver onayladıysa adapter koşulur.
//   5) Tüm karar/sonuç tool_invocations'a yazılır; localQueue dışındaki kaynaklar
//      buraya da düşer böylece tek audit yolu olur.
// =============================================================================

import { randomUUID } from "node:crypto";

let _pool = null;
export function initToolAdapters(pool) { _pool = pool; }

export class ApprovalRequired extends Error {
  constructor(invocationId, message = "approval required") {
    super(message);
    this.name = "ApprovalRequired";
    this.invocationId = invocationId;
  }
}
export class ToolPolicyError extends Error {
  constructor(code, message) {
    super(message); this.name = "ToolPolicyError"; this.code = code;
  }
}

async function loadTool(toolId) {
  if (toolId.startsWith("mcp.")) {
    // Expected format: mcp.<server_slug>.<tool_name>
    const parts = toolId.slice(4).split(".");
    const serverSlug = parts[0];
    const toolName = parts.slice(1).join(".");
    
    // Validate server exists
    const { rows } = await _pool.query(
      `SELECT id FROM mcp_client_servers WHERE slug=$1 AND enabled=true`,
      [serverSlug]
    );
    if (!rows.length) return null;

    // Return synthetic tool for MCP
    return {
      id: toolId,
      name: toolName,
      adapter: "mcp",
      risk_level: "low",
      requires_approval: false,
      runtime: { server: serverSlug, name: toolName },
      system_prompt: ""
    };
  }

  if (toolId.startsWith("sk.") || toolId.startsWith("skill.")) {
    // Expected format: sk.<skill_id>
    const { rows } = await _pool.query(
      `SELECT id, name, type, script_path, instructions, workflow_id, mcp_client_id FROM skills WHERE id=$1`,
      [toolId]
    );
    if (rows[0]) {
      const row = rows[0];
      let adapter = "python"; // Default fallback
      let runtime = {};

      if (row.type === "python") {
        adapter = "python";
        runtime = { script: row.script_path, timeout_ms: 60000 };
      } else if (row.type === "native") {
        adapter = "native";
        runtime = { instructions: row.instructions, timeout_ms: 120000 };
      } else if (row.type === "workflow") {
        adapter = "workflow";
        runtime = { workflow_id: row.workflow_id };
      } else if (row.type === "mcp") {
        adapter = "mcp";
        runtime = { server: row.mcp_client_id, name: row.name };
      }

      // Return synthetic tool for Skill
      return {
        id: row.id,
        name: row.name,
        adapter: adapter,
        risk_level: "low",
        requires_approval: false,
        runtime: runtime,
        system_prompt: row.instructions || ""
      };
    }
    return null;
  }

  const { rows } = await _pool.query(
    `SELECT id, name, adapter, risk_level, requires_approval, runtime, params, system_prompt
       FROM action_library WHERE id=$1`,
    [toolId]
  );
  return rows[0] || null;
}

async function isAgentAllowed(agentId, toolId) {
  if (!agentId) return true; // ad-hoc operator çağrısı — agent kısıtı yok
  const { rowCount } = await _pool.query(
    `SELECT 1 FROM agent_capabilities
      WHERE agent_id=$1 AND kind='tool' AND ref_id=$2`,
    [agentId, toolId]
  );
  return rowCount > 0;
}

async function recordInvocation(row) {
  await _pool.query(
    `INSERT INTO tool_invocations
       (id,tool_id,adapter,agent_id,username,session_id,run_id,status,params,risk_level)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [row.id, row.toolId, row.adapter, row.agentId || null, row.username || null,
     row.sessionId || null, row.runId || null, row.status, row.params || {}, row.riskLevel]
  );
}
async function updateInvocation(id, patch) {
  const sets = [], args = [];
  for (const [k, v] of Object.entries(patch)) {
    args.push(v); sets.push(`${k}=$${args.length}`);
  }
  if (!sets.length) return;
  args.push(id);
  await _pool.query(
    `UPDATE tool_invocations SET ${sets.join(",")} WHERE id=$${args.length}`,
    args
  );
}

function withTimeout(signal, ms) {
  if (!ms) return signal;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error(`adapter timeout ${ms}ms`)), ms);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
  }
  ctrl.signal.addEventListener("abort", () => clearTimeout(t), { once: true });
  return ctrl.signal;
}

// ---- Adapter runners --------------------------------------------------------
const RUNNERS = {
  async http({ tool, params, signal }) {
    const cfg = tool.runtime || {};
    const url = cfg.url; if (!url) throw new ToolPolicyError("config", "http adapter requires runtime.url");
    const method = (cfg.method || "POST").toUpperCase();
    const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
    const body = method === "GET" ? undefined : JSON.stringify(params || {});
    const r = await fetch(url, { method, headers, body, signal: withTimeout(signal, Number(cfg.timeout_ms || 30_000)) });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    if (!r.ok) throw new Error(`http ${r.status}: ${String(parsed).slice(0, 400)}`);
    return parsed;
  },
  async native({ tool, params, signal }) {
    const instructions = tool.runtime?.instructions || tool.system_prompt || "Execute the requested task.";
    const timeoutMs = Number(tool.runtime?.timeout_ms || 120000);
    
    // Dynamic import to avoid circular dependencies
    const { getActiveProviders, pickProviderForRequest, streamFromProvider, streamFromAnthropic, streamFromOpenAICompat, getProviderById, getRoutingPolicy } = await import("./agent-utils.mjs");
    
    // Create a mock deps object for pickProviderForRequest
    const mockDeps = { pool: _pool, getActiveProviders, getProviderById, getRoutingPolicy };
    const prov = await pickProviderForRequest(mockDeps, { lastUserText: JSON.stringify(params) });
    if (!prov) throw new Error("No active LLM provider found for native skill execution.");

    const messages = [
      { role: "system", content: instructions },
      { role: "user", content: `Execute task with parameters: ${JSON.stringify(params)}` }
    ];

    const controller = new AbortController();
    if (signal) signal.addEventListener("abort", () => controller.abort());
    const abortTimeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const it = await streamFromProvider({
        provider: prov,
        messages,
        signal: controller.signal,
        streamFromGemini: streamFromOpenAICompat, // Use OpenAI compat for Gemini
        streamFromAnthropic,
        streamFromOpenAICompat
      });

      let answer = "";
      for await (const chunk of it) {
        // provider streams from streamFromProvider return raw text chunks, 
        // unlike the SSE proxy we use in chat-orchestrate.
        answer += chunk;
      }

      clearTimeout(abortTimeout);
      if (!answer || answer.trim() === "") throw new Error("Native skill returned empty response.");
      return { ok: true, output: answer.trim() };
    } catch (e) {
      clearTimeout(abortTimeout);
      throw new Error(`Native skill execution failed: ${e.message}`);
    }
  },
  async python({ tool, params, signal }) {
    const script = tool.runtime?.script || tool.runtime?.handler;
    if (!script) throw new ToolPolicyError("config", "python adapter requires runtime.script");
    const timeoutMs = Number(tool.runtime?.timeout_ms || 60_000);
    const toolSysPrompt = String(tool.system_prompt || "").trim();
    const env = toolSysPrompt ? { ELARA_TOOL_SYSTEM_PROMPT: toolSysPrompt } : {};

    // Legacy HTTP runner kept as opt-in fallback: only when PY_RUNNER_BASE is
    // explicitly set, route via that service. Default = local disk-runner so
    // dispatch from /api/agents/tool-call actually executes the script with
    // env injection (UI as single source of truth, including system_prompt).
    if (process.env.PY_RUNNER_BASE) {
      const r = await fetch(`${process.env.PY_RUNNER_BASE}/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, params, env }),
        signal: withTimeout(signal, timeoutMs),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`python ${r.status}: ${j?.error || ""}`);
      return j;
    }

    const { runDiskScript } = await import("./disk-runner.mjs");
    const { stdout, stderr } = await runDiskScript({
      script,
      query: typeof params === "object" ? JSON.stringify(params || {}) : String(params ?? ""),
      env,
      timeoutMs,
    });
    let parsed = null;
    try { parsed = JSON.parse(String(stdout || "").trim()); } catch { parsed = null; }
    return parsed && typeof parsed === "object"
      ? parsed
      : { ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") };
  },
  async mcp({ tool, params, signal }) {
    const cfg = tool.runtime || {};
    if (!cfg.server || !cfg.name) throw new ToolPolicyError("config", "mcp adapter requires runtime.server + runtime.name");
    
    // Instead of routing to MCP_BRIDGE_BASE (which might be deprecated/missing),
    // we route via the proper mcp client abstraction we just upgraded!
    const { getServerBySlug, callRemoteTool } = await import("./mcp/client.mjs");
    const srv = await getServerBySlug(_pool, cfg.server);
    
    if (!srv) throw new Error(`mcp server ${cfg.server} not found or disabled`);
    if (!srv.enabled) throw new Error(`mcp server ${cfg.server} is disabled`);

    // callRemoteTool handles timeout inside via AbortController/REQ_TIMEOUT_MS
    // and correctly negotiates transport (stdio vs http)
    const resp = await callRemoteTool(srv, cfg.name, params);
    
    if (!resp.ok) {
      throw new Error(`mcp call failed: ${resp.reason} ${resp.body || resp.error?.message || JSON.stringify(resp.error) || ""}`);
    }
    return resp.result;
  },
  async forge({ tool, params, signal }) {
    const cfg = tool.runtime || {};
    const skillId = cfg.skill_id;
    if (!skillId) throw new ToolPolicyError("config", "forge adapter requires runtime.skill_id");
    // Hot-path: kendi /api/skills/:id/run endpoint'imize loopback.
    const port = Number(process.env.PORT || 3005);
    const r = await fetch(`http://127.0.0.1:${port}/api/skills/${encodeURIComponent(skillId)}/run`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-internal": "tool-adapter" },
      body: JSON.stringify({ params }),
      signal: withTimeout(signal, Number(cfg.timeout_ms || 120_000)),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`forge ${r.status}: ${j?.error || ""}`);
    return j;
  },
  async builtin({ tool, params }) {
    // Legacy workflow handlers — yalnızca echo. Gerçek node tipleri Faz 6'da.
    return { ok: true, builtin: tool.runtime?.handler || "noop", params };
  },
};

// ---- Public surface ---------------------------------------------------------
export async function invokeTool({
  toolId, agentId = null, username = null, sessionId = null, runId = null,
  params = {}, signal = null, targetId = null,
} = {}) {
  if (!_pool) throw new Error("tool-adapters not initialized");
  const tool = await loadTool(toolId);
  if (!tool) throw new ToolPolicyError("not_found", `tool ${toolId} not found`);
  const adapter = (tool.adapter || tool.runtime?.handler || "builtin").toLowerCase();
  if (!RUNNERS[adapter]) throw new ToolPolicyError("adapter", `unknown adapter "${adapter}"`);

  // Agent whitelist (Faz 5 — agent kafasına göre tool çağıramaz)
  if (agentId && !(await isAgentAllowed(agentId, toolId))) {
    throw new ToolPolicyError("acl", `agent ${agentId} not allowed for tool ${toolId}`);
  }

  // Tur-3.8 — Target-level approval gate. A target marked requires_approval=true
  // (or whose risk_level is high/critical) forces the same approval flow as tools.
  let targetRequiresApproval = false;
  let targetRiskLevel = null;
  if (targetId) {
    try {
      const tr = await _pool.query(
        `SELECT requires_approval, risk_level FROM targets WHERE id=$1`, [targetId]);
      if (tr.rows[0]) {
        targetRiskLevel = tr.rows[0].risk_level || null;
        targetRequiresApproval = !!tr.rows[0].requires_approval
          || targetRiskLevel === "high" || targetRiskLevel === "critical";
      }
    } catch { /* table may not exist in old envs */ }
  }

  const invocationId = randomUUID();
  const riskLevel = tool.risk_level || "low";
  const needsApproval = tool.requires_approval
    || riskLevel === "high" || riskLevel === "critical"
    || targetRequiresApproval;

  await recordInvocation({
    id: invocationId, toolId, adapter, agentId, username, sessionId, runId,
    status: needsApproval ? "pending" : "running",
    params: targetId ? { ...params, __target_id: targetId } : params,
    riskLevel,
  });

  if (needsApproval) {
    const approvalId = randomUUID();
    await _pool.query(
      `INSERT INTO tool_approvals(id,invocation_id,requested_by) VALUES ($1,$2,$3)`,
      [approvalId, invocationId, username || agentId || "system"]
    );
    await updateInvocation(invocationId, { approval_id: approvalId });
    const reason = targetRequiresApproval
      ? `target ${targetId} requires approval (risk=${targetRiskLevel || "n/a"})`
      : `tool ${toolId} requires approval (risk=${riskLevel})`;
    throw new ApprovalRequired(invocationId, reason);
  }


  const started = Date.now();
  try {
    const output = await RUNNERS[adapter]({ tool, params, signal });
    const duration = Date.now() - started;
    await updateInvocation(invocationId, {
      status: "done", output: output ?? null,
      finished_at: new Date(), duration_ms: duration,
    });
    return { invocationId, status: "done", output };
  } catch (err) {
    const duration = Date.now() - started;
    const status = signal?.aborted ? "cancelled" : "error";
    await updateInvocation(invocationId, {
      status, error: String(err?.message || err).slice(0, 1000),
      finished_at: new Date(), duration_ms: duration,
    });
    throw err;
  }
}

export async function decideApproval(invocationId, { approver, decision, reason = "", signal = null } = {}) {
  if (!["approved", "rejected"].includes(decision)) {
    throw new ToolPolicyError("decision", "decision must be approved|rejected");
  }
  const { rows } = await _pool.query(
    `SELECT i.*, ta.id AS approval_id
       FROM tool_invocations i
       LEFT JOIN tool_approvals ta ON ta.invocation_id=i.id
      WHERE i.id=$1`, [invocationId]);
  const inv = rows[0];
  if (!inv) throw new ToolPolicyError("not_found", `invocation ${invocationId} not found`);
  if (inv.status !== "pending") throw new ToolPolicyError("state", `invocation status=${inv.status}`);

  await _pool.query(
    `UPDATE tool_approvals SET approver=$1, decision=$2, reason=$3, decided_at=now()
       WHERE invocation_id=$4`,
    [approver || "system", decision, reason, invocationId]
  );
  await updateInvocation(invocationId, {
    status: decision === "approved" ? "running" : "rejected",
    approver: approver || "system",
    approved_at: new Date(),
  });

  if (decision === "rejected") return { invocationId, status: "rejected" };

  // Approved → koş.
  const tool = await loadTool(inv.tool_id);
  const adapter = (tool?.adapter || "builtin").toLowerCase();
  const started = Date.now();
  try {
    const output = await RUNNERS[adapter]({ tool, params: inv.params, signal });
    const duration = Date.now() - started;
    await updateInvocation(invocationId, {
      status: "done", output: output ?? null,
      finished_at: new Date(), duration_ms: duration,
    });
    return { invocationId, status: "done", output };
  } catch (err) {
    const duration = Date.now() - started;
    await updateInvocation(invocationId, {
      status: signal?.aborted ? "cancelled" : "error",
      error: String(err?.message || err).slice(0, 1000),
      finished_at: new Date(), duration_ms: duration,
    });
    throw err;
  }
}

export async function listPendingApprovals({ limit = 50 } = {}) {
  const { rows } = await _pool.query(
    `SELECT i.id, i.tool_id, i.adapter, i.agent_id, i.username, i.risk_level,
            i.params, i.started_at, ta.requested_by, ta.id AS approval_id
       FROM tool_invocations i
       JOIN tool_approvals ta ON ta.invocation_id=i.id
      WHERE i.status='pending' AND ta.decision IS NULL
      ORDER BY i.started_at DESC
      LIMIT $1`, [Math.max(1, Math.min(200, limit))]
  );
  return rows;
}
