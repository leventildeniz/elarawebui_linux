// =============================================================================
// workflow-engine.mjs — Faz 6
// Durable DAG orchestrator. Graph şeması:
//   {
//     start: "n1",
//     nodes: [
//       { id, type, next?, branches?, ...config }
//     ]
//   }
//
// Node tipleri:
//   - skill_call    : { skill_id, params }
//   - tool_call     : { tool_id, agent_id?, params }
//   - agent_call    : { agent_id, prompt }
//   - conditional   : { expression, true_next, false_next }   (JSONLogic-lite)
//   - parallel      : { branches: [nodeId, ...], join_next }
//   - loop          : { items_from, item_var, body_start, max_iter }
//   - human_input   : { prompt, resume_with: ["field1", ...] }
//   - transform     : { set: { key: "ctx.path" | literal } }
//   - rbi_isolated  : { target, params }
//
// Her step `workflow_steps`'e yazılır. `human_input` veya hata → run pause.
// Resume: token + payload ile aynı runId, kaldığı yerden devam eder.
// =============================================================================

import { randomUUID } from "node:crypto";
import { invokeTool, ApprovalRequired } from "./tool-adapters.mjs";

let _pool = null;
export function initWorkflowEngine(pool) { _pool = pool; }

// ---- Helpers ----------------------------------------------------------------
function get(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((a, k) => (a == null ? a : a[k]), obj);
}
function resolveValue(v, ctx) {
  if (typeof v !== "string") return v;
  // "{{ctx.foo.bar}}" interpolation
  if (/^\{\{[\s\S]+\}\}$/.test(v.trim())) {
    return get({ ctx }, v.trim().slice(2, -2).trim());
  }
  return v.replace(/\{\{([^}]+)\}\}/g, (_m, p) => {
    const val = get({ ctx }, p.trim());
    return val == null ? "" : String(val);
  });
}
function resolveParams(params, ctx) {
  if (params == null) return {};
  if (Array.isArray(params)) return params.map(p => resolveParams(p, ctx));
  if (typeof params === "object") {
    const out = {};
    for (const [k, v] of Object.entries(params)) out[k] = resolveParams(v, ctx);
    return out;
  }
  return resolveValue(params, ctx);
}
// Çok küçük safe-eval: { op:"eq"|"neq"|"gt"|"lt"|"truthy", left, right }
function evalExpr(expr, ctx) {
  if (typeof expr === "boolean") return expr;
  if (typeof expr === "string") return !!resolveValue(expr, ctx);
  if (!expr || typeof expr !== "object") return false;
  const L = resolveParams(expr.left, ctx);
  const R = resolveParams(expr.right, ctx);
  switch (expr.op) {
    case "eq":     return L === R;
    case "neq":    return L !== R;
    case "gt":     return Number(L) >  Number(R);
    case "lt":     return Number(L) <  Number(R);
    case "gte":    return Number(L) >= Number(R);
    case "lte":    return Number(L) <= Number(R);
    case "truthy": return !!L;
    case "in":     return Array.isArray(R) && R.includes(L);
    default:       return false;
  }
}

// ---- DB helpers -------------------------------------------------------------
async function loadChain(chainId) {
  const { rows } = await _pool.query(`SELECT * FROM workflow_chains WHERE id=$1`, [chainId]);
  return rows[0] || null;
}
async function loadRun(runId) {
  const { rows } = await _pool.query(`SELECT * FROM chain_runs WHERE id=$1`, [runId]);
  return rows[0] || null;
}
async function saveRun(runId, patch) {
  const sets = [], args = [];
  for (const [k, v] of Object.entries(patch)) { args.push(v); sets.push(`${k}=$${args.length}`); }
  if (!sets.length) return;
  args.push(runId);
  await _pool.query(`UPDATE chain_runs SET ${sets.join(",")} WHERE id=$${args.length}`, args);
}
async function recordStep(runId, node, status, input = {}) {
  const id = randomUUID();
  await _pool.query(
    `INSERT INTO workflow_steps(id,run_id,node_id,node_type,status,input)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, runId, node.id, node.type, status, input]
  );
  return id;
}
async function finishStep(stepId, status, output = null, error = null, started = null) {
  const dur = started ? Date.now() - started : null;
  await _pool.query(
    `UPDATE workflow_steps SET status=$2, output=$3, error=$4,
       finished_at=now(), duration_ms=$5 WHERE id=$1`,
    [stepId, status, output, error, dur]
  );
}

// ---- Node runners -----------------------------------------------------------
async function runNode(node, ctx, runInfo, signal) {
  const stepId = await recordStep(runInfo.runId, node, "running", resolveParams(node, ctx));
  const t0 = Date.now();
  try {
    let output = null;
    switch (node.type) {
      case "skill_call": {
        // forge adapter ile loopback; tool_adapters üstünden geçer (audit + ACL).
        const params = resolveParams(node.params || {}, ctx);
        const r = await invokeTool({
          toolId: node.skill_id, agentId: node.agent_id || null,
          username: runInfo.username, runId: runInfo.runId,
          params, signal,
        }).catch((e) => { if (e instanceof ApprovalRequired) throw e; throw e; });
        output = r.output;
        break;
      }
      case "tool_call": {
        const params = resolveParams(node.params || {}, ctx);
        const r = await invokeTool({
          toolId: node.tool_id, agentId: node.agent_id || null,
          username: runInfo.username, runId: runInfo.runId,
          params, signal,
        });
        output = r.output;
        break;
      }
      case "agent_call": {
        // Agent prompt'ı şu an placeholder; gerçek agent runner Faz 5+ ile zaten
        // mevcut. Buradan agent execution sonucunu bekleyecek bir köprü açılır.
        output = { agent_id: node.agent_id, prompt: resolveValue(node.prompt || "", ctx), todo: "agent-runner-bridge" };
        break;
      }
      case "transform": {
        const set = node.set || {};
        for (const [k, v] of Object.entries(set)) ctx[k] = resolveParams(v, ctx);
        output = { set: Object.keys(set) };
        break;
      }
      case "conditional": {
        const ok = evalExpr(node.expression, ctx);
        output = { branch: ok ? "true" : "false" };
        break;
      }
      case "parallel": {
        const branches = node.branches || [];
        const results = await Promise.all(branches.map(async (entry) => {
          // Her branch ayrı bir alt-bağlam çalıştırır (mini-DAG)
          const sub = await walkFrom(entry, ctx, runInfo, signal);
          return sub;
        }));
        output = { branches: results };
        break;
      }
      case "loop": {
        const items = resolveParams(node.items_from, ctx) || [];
        const arr = Array.isArray(items) ? items : [];
        const max = Math.min(arr.length, Number(node.max_iter || 100));
        const collected = [];
        for (let i = 0; i < max; i++) {
          if (signal?.aborted) throw new Error("aborted");
          ctx[node.item_var || "item"] = arr[i];
          collected.push(await walkFrom(node.body_start, ctx, runInfo, signal));
        }
        output = { iterations: collected.length };
        break;
      }
      case "human_input": {
        // Pause + token üret. Step "waiting" kalır; run paused olur.
        const token = randomUUID();
        await saveRun(runInfo.runId, {
          status: "paused", paused_reason: "human_input",
          pending_node: node.id, pending_token: token,
          context: ctx, current_node: node.id,
        });
        await finishStep(stepId, "waiting", { token, prompt: resolveValue(node.prompt || "", ctx) }, null, t0);
        const err = new Error("paused:human_input");
        err.paused = { runId: runInfo.runId, nodeId: node.id, token };
        throw err;
      }
      case "rbi_isolated": {
        const params = resolveParams(node.params || {}, ctx);
        const r = await invokeTool({
          toolId: node.tool_id || "__rbi__",
          agentId: node.agent_id || null,
          username: runInfo.username, runId: runInfo.runId,
          params: { target: node.target, ...params },
          signal,
        }).catch(() => ({ output: { rbi: "unavailable", target: node.target } }));
        output = r.output;
        break;
      }
      default:
        throw new Error(`unknown node type "${node.type}"`);
    }
    ctx[`__node_${node.id}`] = output;
    await finishStep(stepId, "done", output, null, t0);
    return { ok: true, output, node };
  } catch (err) {
    if (err?.paused) throw err; // bubble up
    await finishStep(stepId, signal?.aborted ? "cancelled" : "error",
      null, String(err?.message || err).slice(0, 1000), t0);
    throw err;
  }
}

function nextOf(node, lastOutput) {
  if (node.type === "conditional") {
    const branch = lastOutput?.branch;
    return branch === "true" ? node.true_next : node.false_next;
  }
  if (node.type === "parallel") return node.join_next || node.next;
  return node.next;
}

async function walkFrom(startId, ctx, runInfo, signal) {
  if (!startId) return null;
  const nodes = runInfo.graph.nodes || [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  let curId = startId;
  let lastOutput = null;
  while (curId) {
    if (signal?.aborted) throw new Error("aborted");
    const node = byId.get(curId);
    if (!node) throw new Error(`node ${curId} not found`);
    await saveRun(runInfo.runId, { current_node: curId, context: ctx });
    const { output } = await runNode(node, ctx, runInfo, signal);
    lastOutput = output;
    curId = nextOf(node, output);
  }
  return lastOutput;
}

// ---- Public API -------------------------------------------------------------
export async function startWorkflowRun({ chainId, input = {}, username = null, signal = null }) {
  if (!_pool) throw new Error("workflow-engine not initialized");
  const chain = await loadChain(chainId);
  if (!chain) throw new Error(`chain ${chainId} not found`);
  const graph = typeof chain.graph === "string" ? JSON.parse(chain.graph) : chain.graph;
  if (!graph?.start || !Array.isArray(graph.nodes)) throw new Error("invalid graph");
  const runId = randomUUID();
  const ctx = { input };
  await _pool.query(
    `INSERT INTO chain_runs(id,chain_id,status,current_node,context,username)
     VALUES ($1,$2,'running',$3,$4,$5)`,
    [runId, chainId, graph.start, ctx, username]
  );
  return _executeFrom({ runId, graph, startId: graph.start, ctx, username, signal });
}

export async function resumeWorkflowRun({ runId, token, payload = {}, signal = null }) {
  const run = await loadRun(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status !== "paused") throw new Error(`run status=${run.status}, cannot resume`);
  if (run.pending_token && token && run.pending_token !== token) throw new Error("invalid resume token");
  const chain = await loadChain(run.chain_id);
  const graph = typeof chain.graph === "string" ? JSON.parse(chain.graph) : chain.graph;
  const ctx = typeof run.context === "string" ? JSON.parse(run.context) : (run.context || {});
  // human_input payload'ı bağlama yaz
  ctx[`__input_${run.pending_node}`] = payload;
  Object.assign(ctx, payload || {});
  await saveRun(runId, { status: "running", paused_reason: null, pending_token: null });
  // Pause olan node'dan SONRAKİ adımdan devam et
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const pausedNode = byId.get(run.pending_node);
  const nextId = pausedNode ? nextOf(pausedNode, { branch: "true" }) : null;
  if (!nextId) {
    await saveRun(runId, { status: "done", finished_at: new Date(), context: ctx });
    return { runId, status: "done", context: ctx };
  }
  return _executeFrom({ runId, graph, startId: nextId, ctx, username: run.username, signal });
}

async function _executeFrom({ runId, graph, startId, ctx, username, signal }) {
  const runInfo = { runId, graph, username };
  try {
    const lastOutput = await walkFrom(startId, ctx, runInfo, signal);
    await saveRun(runId, { status: "done", finished_at: new Date(), context: ctx });
    return { runId, status: "done", output: lastOutput, context: ctx };
  } catch (err) {
    if (err?.paused) return { runId, status: "paused", paused: err.paused, context: ctx };
    await saveRun(runId, {
      status: signal?.aborted ? "cancelled" : "error",
      error: String(err?.message || err).slice(0, 1000),
      finished_at: new Date(), context: ctx,
    });
    throw err;
  }
}

export async function cancelWorkflowRun(runId, reason = "operator cancel") {
  await saveRun(runId, { status: "cancelled", paused_reason: reason, finished_at: new Date() });
  return { runId, status: "cancelled" };
}

export async function getRunSteps(runId, { limit = 200 } = {}) {
  const { rows } = await _pool.query(
    `SELECT id,node_id,node_type,status,input,output,error,started_at,finished_at,duration_ms
       FROM workflow_steps WHERE run_id=$1 ORDER BY started_at ASC LIMIT $2`,
    [runId, Math.max(1, Math.min(500, limit))]
  );
  return rows;
}
