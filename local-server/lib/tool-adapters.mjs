// =============================================================================
// tool-adapters.mjs — Faz 5
// Standardize tool execution behind a single contract:
//   invokeTool({ toolId, agentId, username, sessionId, runId, params, signal })
//     -> { invocationId, status, output, error, approvalRequired? }
//
// Adapters:
//   - http   : signed/proxied HTTP call (config.url, method, headers, body template)
//   - python : worker.py / forge disk runner script (config.script)
//   - mcp    : MCP remote tool invocation (config.server, config.name)
//   - forge  : in-house forge skill runtime (config.skill_id)
//   - builtin: legacy workflow node handler (backward compatible)
//
// Policy:
//   1) Tool is loaded from PostgreSQL; enabled + adapter + risk_level + requires_approval resolved.
//   2) If bound to an agent, capabilities whitelist is validated against agent_capabilities.
//   3) If requires_approval=true OR risk_level in {high, critical}:
//      - tool_invocations status marked 'pending', approval request created.
//      - Returns { approvalRequired: true, invocationId }; runner suspends.
//   4) If no approval required or approver approved, executor executes the adapter.
//   5) All decisions/results are logged to tool_invocations and audit stream.
// =============================================================================

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

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

export async function resolveProfileTargetHosts(pool, profile, tenantId = "default") {
  if (!pool || !profile) return [];
  const rawTargets = Array.isArray(profile.targets) ? profile.targets : [];
  if (!rawTargets.length) return [];

  const targetIds = [];
  const groupIds = [];
  for (const t of rawTargets) {
    const s = String(t || "").trim();
    if (s.startsWith("grp:") || s.startsWith("group:")) {
      groupIds.push(s.replace(/^(grp:|group:)/, ""));
    } else {
      targetIds.push(s);
    }
  }

  const hosts = new Set();
  if (targetIds.length > 0) {
    const tRes = await pool.query(
      `SELECT ip, host FROM targets 
       WHERE (id = ANY($1) OR name = ANY($1)) 
         AND (tenant_id = $2 OR is_global = true OR tenant_id = 'default')`,
      [targetIds, tenantId]
    ).catch(() => ({ rows: [] }));
    for (const r of tRes.rows) {
      if (r.ip && r.ip !== "-") hosts.add(r.ip.trim().toLowerCase());
      if (r.host && r.host !== "-") hosts.add(r.host.trim().toLowerCase());
    }
  }

  if (groupIds.length > 0) {
    const gRes = await pool.query(
      `SELECT t.ip, t.host FROM targets t
       JOIN target_groups g ON g.id = t.group_id OR g.name = t.group_id
       WHERE (g.id = ANY($1) OR g.name = ANY($1)) 
         AND (t.tenant_id = $2 OR t.is_global = true OR t.tenant_id = 'default')`,
      [groupIds, tenantId]
    ).catch(() => ({ rows: [] }));
    for (const r of gRes.rows) {
      if (r.ip && r.ip !== "-") hosts.add(r.ip.trim().toLowerCase());
      if (r.host && r.host !== "-") hosts.add(r.host.trim().toLowerCase());
    }
  }

  return Array.from(hosts);
}

/**
 * Resolves the effective Isolation Sandbox Profile from the Policy & Security plane,
 * strictly honoring Multi-Tenant & Zero-Desk ownership boundaries.
 */
export async function resolveIsolationProfile(pool, { kind = "tool", toolId = null, tenantId = "default", userId = null } = {}) {
  if (!pool) return null;
  const userMatches = [userId].filter(Boolean);

  try {
    // 1. Specifically bound profile in this tenant or global desk
    if (toolId) {
      const { rows } = await pool.query(
        `SELECT * FROM isolation_profiles 
          WHERE enabled = true 
            AND kind = $1 
            AND tools ? $2
            AND (tenant_id = $3 OR is_global = true)
          ORDER BY (tenant_id = $3) DESC, (owner_id = ANY($4::text[])) DESC 
          LIMIT 1`,
        [kind, toolId, tenantId, userMatches.length ? userMatches : ['__none__']]
      );
      if (rows[0]) return rows[0];
    }

    // 2. Fallback profile for this kind in this tenant (or global fallback)
    const { rows: fbRows } = await pool.query(
      `SELECT * FROM isolation_profiles 
        WHERE enabled = true 
          AND kind = $1 
          AND fallback = true 
          AND (tenant_id = $2 OR is_global = true)
        ORDER BY (tenant_id = $2) DESC 
        LIMIT 1`,
      [kind, tenantId]
    );
    return fbRows[0] || null;
  } catch (e) {
    console.error("[tool-adapters] resolveIsolationProfile error:", e.message);
    return null;
  }
}

async function loadTool(toolId) {
  if (!toolId) return null;

  // 1. MCP Tools
  if (toolId.startsWith("mcp.")) {
    const parts = toolId.slice(4).split(".");
    const serverSlug = parts[0];
    const toolName = parts.slice(1).join(".");
    
    const { rows } = await _pool.query(
      `SELECT id, risk, requires_approval FROM mcp_client_servers WHERE slug=$1 AND enabled=true`,
      [serverSlug]
    );
    if (!rows.length) return null;

    return {
      id: toolId,
      name: toolName,
      adapter: "mcp",
      risk_level: rows[0].risk || "low",
      requires_approval: Boolean(rows[0].requires_approval),
      runtime: { server: serverSlug, name: toolName },
      system_prompt: ""
    };
  }

  // 2. Skills (with or without 'sk.' / 'skill.' prefix)
  const bareSkillId = toolId.replace(/^(sk\.|skill\.)/i, '');
  const { rows: skillRows } = await _pool.query(
    `SELECT id, name, type, script_path, instructions, workflow_id, mcp_client_id, risk, requires_approval 
       FROM skills 
      WHERE enabled=true AND (id=$1 OR id=$2 OR id=$3 OR id=$4)`,
    [toolId, `sk.${bareSkillId}`, `skill.${bareSkillId}`, bareSkillId]
  );
  if (skillRows[0]) {
    const row = skillRows[0];
    let adapter = "native";
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

    return {
      id: row.id,
      name: row.name,
      adapter,
      risk_level: row.risk || "low",
      requires_approval: Boolean(row.requires_approval),
      runtime,
      system_prompt: row.instructions || ""
    };
  }

  // 3. Workflows (with 'wf_', 'wf.', 'workflow.' prefix or bare slug)
  const cleanWfId = toolId.replace(/^(workflow\.|wf\.|wf_)/i, "");
  try {
    const { rows: wfRows } = await _pool.query(
      `SELECT id, name, nodes, edges, trigger FROM workflows WHERE id=$1 OR id=$2 OR id=$3 OR name=$1 OR name=$2`,
      [toolId, `wf_${cleanWfId}`, cleanWfId]
    );
    if (wfRows[0]) {
      return {
        id: wfRows[0].id,
        name: wfRows[0].name,
        adapter: "workflow",
        risk_level: "low",
        requires_approval: false,
        runtime: { workflow_id: wfRows[0].id, nodes: wfRows[0].nodes, edges: wfRows[0].edges },
        system_prompt: ""
      };
    }
  } catch {}

  // 4. Orchestrations / Chains (with 'orc_', 'orc.', 'chain.' prefix or bare slug)
  const cleanOrcId = toolId.replace(/^(orchestration\.|chain\.|orc\.|orc_)/i, "");
  try {
    const { rows: orcRows } = await _pool.query(
      `SELECT id, name, nodes, edges, trigger FROM orchestrations WHERE id=$1 OR id=$2 OR id=$3 OR name=$1 OR name=$2`,
      [toolId, `orc_${cleanOrcId}`, cleanOrcId]
    );
    if (orcRows[0]) {
      return {
        id: orcRows[0].id,
        name: orcRows[0].name,
        adapter: "chain",
        risk_level: "low",
        requires_approval: false,
        runtime: { chain_id: orcRows[0].id, nodes: orcRows[0].nodes, edges: orcRows[0].edges },
        system_prompt: ""
      };
    }
  } catch {}

  // 5. Agents (with 'agt.', 'agent.', 'agt_' prefix or bare slug)
  const cleanAgtId = toolId.replace(/^(agent\.|agt\.|agt_)/i, "");
  try {
    const { rows: agtRows } = await _pool.query(
      `SELECT id, name, system_prompt, description, squad FROM agents WHERE id=$1 OR id=$2 OR id=$3 OR name=$1 OR name=$2`,
      [toolId, `agt.${cleanAgtId}`, cleanAgtId]
    );
    if (agtRows[0]) {
      return {
        id: agtRows[0].id,
        name: agtRows[0].name,
        adapter: "agent",
        risk_level: "low",
        requires_approval: false,
        runtime: { agent_id: agtRows[0].id },
        system_prompt: agtRows[0].system_prompt || agtRows[0].description || ""
      };
    }
  } catch {}

  // 6. Action Library (with or without 'tool.' / 'act.' / 'tl.' prefix)
  const bareToolId = toolId.replace(/^(tool|act|tl)[\._]/i, "");
  const { rows } = await _pool.query(
    `SELECT id, name, adapter, risk_level, requires_approval, runtime, params, system_prompt
       FROM action_library 
      WHERE (id = ANY($1) OR name = $2) AND COALESCE((runtime->>'orphan')::boolean, false) = false`,
    [[toolId, `tool.${bareToolId}`, `act.${bareToolId}`, `tl.${bareToolId}`, bareToolId], toolId]
  );
  let row = rows[0];
  if (!row) {
    // Fallback: query tools table
    try {
      const { rows: tRows } = await _pool.query(
        `SELECT id, label as name, source as adapter, risk as risk_level, requires_approval, params, system_prompt
           FROM tools WHERE id = ANY($1) OR label = $2`,
        [[toolId, `tool.${bareToolId}`, `act.${bareToolId}`, `tl.${bareToolId}`, bareToolId], toolId]
      );
      row = tRows[0];
    } catch { /* tools table optional */ }
  }
  if (!row) {
    // Fallback 2: check disk tools directly
    const slug = bareToolId;
    const filePath = path.resolve(PROJECT_ROOT, "tools", `${slug}.py`);
    if (fs.existsSync(filePath)) {
      return {
        id: `tool.${slug}`,
        name: slug,
        adapter: "python",
        risk_level: "low",
        requires_approval: false,
        runtime: { handler: "python", script: filePath },
        system_prompt: ""
      };
    }
    return null;
  }

  let runtime = row.runtime;
  if (typeof runtime === "string") {
    try { runtime = JSON.parse(runtime); } catch { runtime = {}; }
  }
  return { ...row, runtime };
}

async function isAgentAllowed(agentId, toolId) {
  if (!agentId) return true; // ad-hoc operator call — unconstrained by agent ACL
  const bareId = toolId.replace(/^(tool|act|tl|sk|skill)[\._]/i, "");
  const { rowCount } = await _pool.query(
    `SELECT 1 FROM agent_capabilities
      WHERE agent_id=$1 AND (
        ref_id = ANY($2)
      )`,
    [agentId, [toolId, `tool.${bareId}`, `act.${bareId}`, `tl.${bareId}`, `sk.${bareId}`, `skill.${bareId}`, bareId]]
  );
  return rowCount > 0;
}

async function recordInvocation(row) {
  let validRunId = null;
  if (row.runId) {
    try {
      const chk = await _pool.query("SELECT 1 FROM runs WHERE id=$1", [row.runId]);
      if (chk.rowCount > 0) validRunId = row.runId;
    } catch {
      validRunId = null;
    }
  }

  await _pool.query(
    `INSERT INTO tool_invocations
       (id,tool_id,adapter,agent_id,username,session_id,run_id,status,params,risk_level)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [row.id, row.toolId, row.adapter, row.agentId || null, row.username || null,
     row.sessionId || null, validRunId, row.status, row.params || {}, row.riskLevel]
  );
}
const ALLOWED_INVOCATION_COLS = new Set([
  'status', 'approval_id', 'approver', 'approved_at', 'finished_at', 'duration_ms',
  'error', 'output', 'params', 'risk_level'
]);

async function updateInvocation(id, patch) {
  const sets = [], args = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!ALLOWED_INVOCATION_COLS.has(k)) continue;
    let val = v;
    if ((k === "output" || k === "params") && typeof v === "object" && v !== null && !(v instanceof Date)) {
      val = JSON.stringify(v);
    }
    args.push(val); sets.push(`${k}=$${args.length}`);
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
  async http({ tool, params, signal, profile }) {
    const cfg = tool.runtime || {};
    const url = cfg.url; if (!url) throw new ToolPolicyError("config", "http adapter requires runtime.url");

    // Enforce Isolation Profile Network policy from Policy & Security UI
    if (profile) {
      if (profile.network === "denied") {
        throw new ToolPolicyError("network_denied", `HTTP tool execution blocked: Isolation profile "${profile.name}" denies all network egress.`);
      }
      if (profile.network === "allowlist") {
        const allowedEntries = String(profile.net_allowlist || "").split(/\r?\n|,/).map(s => s.trim().toLowerCase()).filter(Boolean);
        const targetHosts = await resolveProfileTargetHosts(_pool, profile, tool.tenant_id || "default");
        const allAllowed = new Set([...allowedEntries, ...targetHosts]);

        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname.toLowerCase();
        const isAllowed = allAllowed.has(host) || Array.from(allAllowed).some(entry => host.endsWith("." + entry) || entry === url);
        if (!isAllowed) {
          throw new ToolPolicyError("network_denied", `HTTP destination ${host} is not in isolation profile "${profile.name}" network allowlist or bound targets.`);
        }
      }
    }

    const method = (cfg.method || "POST").toUpperCase();
    const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
    const body = method === "GET" ? undefined : JSON.stringify(params || {});
    const r = await fetch(url, { method, headers, body, signal: withTimeout(signal, Number(cfg.timeout_ms || 30_000)) });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    if (!r.ok) throw new Error(`http ${r.status}: ${String(parsed).slice(0, 400)}`);
    return parsed;
  },
  async native({ tool, params, signal, provider }) {
    const instructions = tool.runtime?.instructions || tool.system_prompt || "Execute the requested task.";
    const timeoutMs = Number(tool.runtime?.timeout_ms || 120000);
    
    // Dynamic import to avoid circular dependencies
    const { getActiveProviders, pickProviderForRequest, streamFromProvider, streamFromAnthropic, streamFromOpenAICompat, getProviderById, getRoutingPolicy } = await import("./agent-utils.mjs");
    const { resolveCredential } = await import("./vault.mjs");
    
    let prov = provider;
    if (!prov) {
      const mockDeps = { pool: _pool, getActiveProviders, getProviderById, getRoutingPolicy };
      prov = await pickProviderForRequest(mockDeps, { lastUserText: JSON.stringify(params) });
    }
    if (!prov) throw new Error("No active LLM provider found for native skill execution.");

    let apiKey = prov.apiKey;
    if (!apiKey || apiKey.startsWith("vault://") || apiKey.startsWith("raw://")) {
      apiKey = await resolveCredential(_pool, prov.apiKey || prov.model_api_key || prov.secret_id, "api_key");
    }
    const resolvedProv = {
      ...prov,
      apiKey,
      base_url: prov.base_url || prov.model_base_url,
      model: prov.model || prov.model_id
    };

    const messages = [
      { role: "system", content: instructions },
      { role: "user", content: `Execute task with parameters: ${JSON.stringify(params)}` }
    ];

    const controller = new AbortController();
    if (signal) signal.addEventListener("abort", () => controller.abort());
    const abortTimeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const it = await streamFromProvider({
        provider: resolvedProv,
        messages,
        signal: controller.signal,
        streamFromGemini: streamFromOpenAICompat, // Use OpenAI compat for Gemini
        streamFromAnthropic,
        streamFromOpenAICompat
      });

      let answer = "";
      for await (const chunk of it) {
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
  async python({ tool, params, signal, profile }) {
    let script = tool.runtime?.script || tool.script_path || tool.script;
    if (!script && tool.id && tool.id.startsWith("tool.")) {
      const slug = tool.id.slice(5);
      const candidate = path.resolve(PROJECT_ROOT, "tools", `${slug}.py`);
      if (fs.existsSync(candidate)) {
        script = candidate;
      }
    }
    if (!script) throw new ToolPolicyError("config", `python adapter requires runtime.script for tool ${tool.id || "unknown"}`);
    if (!path.isAbsolute(script)) {
      script = path.resolve(PROJECT_ROOT, script);
    }
    const targetHosts = profile ? await resolveProfileTargetHosts(_pool, profile, tool.tenant_id || "default") : [];
    const combinedAllowlist = profile
      ? [...String(profile.net_allowlist || "").split(/\r?\n|,/).map(s => s.trim()).filter(Boolean), ...targetHosts].join("\n")
      : "";
    const timeoutMs = Number(tool.runtime?.timeout_ms || 60_000);
    const toolSysPrompt = String(tool.system_prompt || "").trim();
    const env = {
      ...(toolSysPrompt ? { ELARA_TOOL_SYSTEM_PROMPT: toolSysPrompt } : {}),
      ...(profile ? {
        ELARA_SANDBOX_NETWORK: profile.network || "denied",
        ELARA_SANDBOX_NET_ALLOWLIST: combinedAllowlist,
        ELARA_SANDBOX_PROFILE_ID: profile.id || "",
        ELARA_SANDBOX_PROFILE_NAME: profile.name || "",
      } : {})
    };

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
  async workflow({ tool, params, signal, sessionId, username }) {
    const wfId = tool.runtime?.workflow_id || tool.id;
    const port = Number(process.env.PORT || 3005);
    const r = await fetch(`http://127.0.0.1:${port}/api/workflows/${encodeURIComponent(wfId)}/trigger`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal": "tool-adapter",
        ...(sessionId ? { "x-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ context: params }),
      signal: withTimeout(signal, Number(tool.runtime?.timeout_ms || 120_000)),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`workflow trigger failed ${r.status}: ${j?.error || ""}`);
    
    const runId = j.runId;
    if (!runId) return { ok: true, workflowId: wfId, details: j };

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 200));
      const runRes = await fetch(`http://127.0.0.1:${port}/api/workflows/runs/${encodeURIComponent(runId)}`, {
        headers: {
          "x-internal": "tool-adapter",
          ...(sessionId ? { "x-session-id": sessionId } : {}),
        },
      });
      const runData = await runRes.json().catch(() => ({}));
      if (runData?.status === "done" || runData?.status === "failed" || runData?.status === "stopped") {
        return runData.output || runData;
      }
    }
    return { ok: true, runId, workflowId: wfId, message: "Workflow triggered successfully", details: j };
  },
  async chain({ tool, params, signal, sessionId, username }) {
    const chainId = tool.runtime?.chain_id || tool.id;
    const port = Number(process.env.PORT || 3005);
    const r = await fetch(`http://127.0.0.1:${port}/api/chains/${encodeURIComponent(chainId)}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal": "tool-adapter",
        ...(sessionId ? { "x-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ context: params }),
      signal: withTimeout(signal, Number(tool.runtime?.timeout_ms || 180_000)),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`chain trigger failed ${r.status}: ${j?.error || ""}`);
    
    const runId = j.runId;
    if (!runId) return { ok: true, chainId, details: j };

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 250));
      const runRes = await fetch(`http://127.0.0.1:${port}/api/chains/runs/${encodeURIComponent(runId)}`, {
        headers: {
          "x-internal": "tool-adapter",
          ...(sessionId ? { "x-session-id": sessionId } : {}),
        },
      });
      const runData = await runRes.json().catch(() => ({}));
      if (runData?.status === "done" || runData?.status === "failed" || runData?.status === "stopped") {
        return runData.output || runData;
      }
    }
    return { ok: true, runId, chainId, message: "Chain orchestration triggered successfully", details: j };
  },
  async agent({ tool, params, signal, sessionId, username }) {
    const agentId = tool.runtime?.agent_id || tool.id;
    const promptText = params.instructions || params.prompt || params.query || params.input || JSON.stringify(params);
    const { runAgent } = await import("./agent-run.mjs");
    const result = await runAgent({
      agentId,
      prompt: promptText,
      pool: _pool,
      username: username || "operator",
    });
    return result;
  },
  async builtin({ tool, params }) {
    return { ok: false, error: `Builtin handler '${tool.runtime?.handler || "noop"}' is not executable as a tool.` };
  },
};

// ---- Public surface ---------------------------------------------------------
export async function invokeTool({
  toolId, agentId = null, username = null, sessionId = null, runId = null,
  params = {}, signal = null, targetId = null, provider = null,
} = {}) {
  if (!_pool) throw new Error("tool-adapters not initialized");
  const tool = await loadTool(toolId);
  if (!tool) throw new ToolPolicyError("not_found", `tool ${toolId} not found`);
  const canonicalId = tool.id || toolId;
  let adapter = (tool.adapter || "").toLowerCase();
  if (tool.runtime?.script || tool.runtime?.handler === "python" || (canonicalId && canonicalId.startsWith("tool."))) {
    adapter = "python";
  } else if (!adapter && tool.runtime?.handler) {
    adapter = tool.runtime.handler.toLowerCase();
  }
  if (!adapter) {
    adapter = "builtin";
  }
  if (!RUNNERS[adapter]) throw new ToolPolicyError("adapter", `unknown adapter "${adapter}"`);

  // Agent whitelist enforcement — agent must possess registered capability binding
  if (agentId && !(await isAgentAllowed(agentId, canonicalId))) {
    throw new ToolPolicyError("acl", `agent ${agentId} not allowed for tool ${canonicalId}`);
  }

  // Target-level approval gate & Risk Priority Hierarchy:
  // Effective Risk = MAX(Action Risk, Target Risk)
  const RISK_RANKS = { low: 1, medium: 2, high: 3, critical: 4 };
  const toolRisk = (tool.risk_level || "low").toLowerCase();
  const toolRank = RISK_RANKS[toolRisk] || 1;

  let targetRequiresApproval = false;
  let targetRiskLevel = null;
  let targetRank = 0;

  if (targetId) {
    try {
      const tr = await _pool.query(
        `SELECT requires_approval, risk_level FROM targets WHERE id=$1`, [targetId]);
      if (tr.rows[0]) {
        targetRiskLevel = (tr.rows[0].risk_level || "low").toLowerCase();
        targetRank = RISK_RANKS[targetRiskLevel] || 1;
        targetRequiresApproval = !!tr.rows[0].requires_approval
          || targetRiskLevel === "high" || targetRiskLevel === "critical";
      }
    } catch { /* table may not exist in old envs */ }
  }

  const effectiveRank = Math.max(toolRank, targetRank);
  const effectiveRisk = Object.keys(RISK_RANKS).find(k => RISK_RANKS[k] === effectiveRank) || "low";

  const invocationId = randomUUID();
  const needsApproval = tool.requires_approval
    || effectiveRank >= 3 // High or Critical
    || targetRequiresApproval;

  await recordInvocation({
    id: invocationId, toolId: canonicalId, adapter, agentId, username, sessionId, runId,
    status: needsApproval ? "pending" : "running",
    params: targetId ? { ...params, __target_id: targetId } : params,
    riskLevel: effectiveRisk,
  });

  if (needsApproval) {
    const approvalId = randomUUID();
    await _pool.query(
      `INSERT INTO tool_approvals(id,invocation_id,requested_by) VALUES ($1,$2,$3)`,
      [approvalId, invocationId, username || agentId || "system"]
    );
    await updateInvocation(invocationId, { approval_id: approvalId });
    const reason = targetRequiresApproval
      ? `target ${targetId} requires approval (effective risk=${effectiveRisk})`
      : `action ${toolId} requires approval (effective risk=${effectiveRisk})`;
    throw new ApprovalRequired(invocationId, reason);
  }


  const started = Date.now();
  try {
    // Resolve Isolation Profile respecting Multi-Tenant & Zero-Desk boundaries
    const kind = (tool.adapter === "mcp" || toolId.startsWith("mcp.")) ? "mcp" : (tool.adapter === "native" || toolId.startsWith("sk.") || toolId.startsWith("skill.")) ? "skill" : "tool";
    const profile = await resolveIsolationProfile(_pool, {
      kind,
      toolId,
      tenantId: tool.tenant_id || "default",
      userId: username
    });

    const output = await RUNNERS[adapter]({ tool, params, signal, provider, profile, sessionId, username });
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

  // Approved → execute tool.
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
