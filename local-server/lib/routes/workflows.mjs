// Workflows + Workflow-Runs + Chains route module
// Extracted from server.mjs (T-2b).
// All external deps passed via DI — no module-level side effects.

import { syncTriggerSchedules } from '../trigger-sync.mjs';

const CHAIN_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

// --- In-memory async run registries (Play/Stop model) -----------------------
// Maps runId → { runId, wfId|chainId, status: "running"|"done"|"failed"|"stopped",
//                startedAt, endedAt?, trace, output?, error?, aborted: boolean,
//                stepsDone, stepsTotal }
const WORKFLOW_RUNS_LIVE = new Map();
const CHAIN_RUNS_LIVE = new Map();
const RUN_TTL_MS = 5 * 60 * 1000; // keep finished runs for 5 minutes

function newRunId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
function scheduleRunCleanup(map, runId) {
  setTimeout(() => map.delete(runId), RUN_TTL_MS).unref?.();
}

// Tiny safe expression evaluator: identifiers `ctx`, member access, string/number
// literals, and operators === !== == != > >= < <= && || ! ( ).
function evalChainCondition(expr, ctx) {
  if (typeof expr !== "string" || !expr.trim()) return false;
  if (!/^[\sa-zA-Z0-9_$.'"!=<>&|()\-+,]+$/.test(expr)) return false;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("ctx", `"use strict"; return (${expr});`);
    return Boolean(fn(ctx));
  } catch {
    return false;
  }
}


export function mountWorkflowRoutes(app, deps) {
  const {
    pool,
    requireSession,
    enqueueWrite,
    broadcastAudit,
    execNodeWithAction,
    startWorkflowRun,
    resumeWorkflowRun,
    cancelWorkflowRun,
    getRunSteps,
    createPrefixedId,
    liveRuns,
    executeSkillScript,
    coerceParams,
    validateAgainstSchema,
  } = deps;

  // --- Workflows CRUD ------------------------------------------------------
  app.get("/api/workflows", async (req, res) => {
    try {
      const ctx = await deps.resolveActorContext(req);
      const vis = deps.buildVisibility(ctx, 1, 'owner_id');
      const { rows } = await pool.query(`SELECT id, name, status, trigger, runs, nodes, edges, color, visibility, shared_with, updated_at FROM workflows WHERE ${vis.clause} ORDER BY updated_at DESC`, vis.params);
      res.json(rows.map(r => ({
        id: r.id, name: r.name, updated_at: r.updated_at, visibility: r.visibility, shared_with: r.shared_with,
        graph: { status: r.status, trigger: r.trigger, runs: r.runs, nodes: r.nodes, edges: r.edges, color: r.color || 'sapphire' }
      })));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.get("/api/workflows/:id", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT id, name, status, trigger, runs, nodes, edges, color, visibility, shared_with, updated_at FROM workflows WHERE id=$1", [req.params.id]);
      if (!rows[0]) return res.status(404).end();
      const r = rows[0];
      res.json({
        id: r.id, name: r.name, updated_at: r.updated_at, visibility: r.visibility, shared_with: r.shared_with,
        graph: { status: r.status, trigger: r.trigger, runs: r.runs, nodes: r.nodes, edges: r.edges, color: r.color || 'sapphire' }
      });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.post("/api/workflows", async (req, res) => {
    const { id, name, nodes = [], edges = [], color, status, trigger, runs, visibility, shared_with, ownerId, ownerName } = req.body ?? {};
    if (!id || !name) return res.status(400).json({ error: "id and name required" });
    try {
      const ctx = await deps.resolveActorContext(req);
      const owner = ownerId || ctx.userId || req.actor || null;
      
      await pool.query(
        `INSERT INTO workflows(id, name, status, trigger, runs, nodes, edges, color, visibility, shared_with, owner_id, owner_name, updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12,now())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, trigger = EXCLUDED.trigger, runs = EXCLUDED.runs, nodes = EXCLUDED.nodes, edges = EXCLUDED.edges, color = EXCLUDED.color, visibility = EXCLUDED.visibility, shared_with = EXCLUDED.shared_with, owner_id = COALESCE(workflows.owner_id, EXCLUDED.owner_id), owner_name = COALESCE(workflows.owner_name, EXCLUDED.owner_name), updated_at = now()`,
        [id, name, status || 'draft', trigger || null, runs || 0, JSON.stringify(nodes), JSON.stringify(edges), color || 'sapphire', visibility || 'private', JSON.stringify(shared_with || []), owner, ownerName || null]
      );

      const ctxActor = req.session?.userId || null;
      await syncTriggerSchedules(pool, 'workflow', id, nodes, ctxActor);

      res.json({ ok: true, id, nodes: nodes.length, edges: edges.length });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.delete("/api/workflows/:id", async (req, res) => {
    try { await pool.query("DELETE FROM workflows WHERE id=$1", [req.params.id]); res.status(204).end(); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // --- Workflow DAG run engine (chains v2) --------------------------------
  // Faz 14.2 — chain id validator: alfanumerik + - _ . sınırlı, max 128 char.
  app.post("/api/workflow-chains/:id/run", requireSession(), async (req, res) => {
    const chainId = req.params.id;
    if (!CHAIN_ID_RE.test(chainId)) {
      return res.status(400).json({ ok: false, error: "invalid chain id", code: "bad_request" });
    }
    try {
      const exists = await pool.query("SELECT 1 FROM workflow_chains WHERE id=$1", [chainId]);
      if (!exists.rows.length) {
        return res.status(404).json({ ok: false, error: "chain not found", code: "not_found" });
      }
      const out = await startWorkflowRun({
        chainId,
        input: req.body?.input || {},
        username: req.session?.username || null,
      });
      res.json({ ok: true, ...out });
    } catch (e) {
      const msg = String(e.message || e);
      if (/not found/i.test(msg)) return res.status(404).json({ ok: false, error: msg, code: "not_found" });
      res.status(500).json({ error: msg });
    }
  });
  app.post("/api/workflow-runs/:runId/resume", requireSession(), async (req, res) => {
    try {
      const out = await resumeWorkflowRun({
        runId: req.params.runId,
        token: req.body?.token || null,
        payload: req.body?.payload || {},
      });
      res.json({ ok: true, ...out });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post("/api/workflow-runs/:runId/cancel", requireSession(), async (req, res) => {
    try {
      const out = await cancelWorkflowRun(req.params.runId, req.body?.reason || "operator cancel");
      res.json({ ok: true, ...out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/workflow-runs/:runId", requireSession(), async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT * FROM chain_runs WHERE id=$1`, [req.params.runId]);
      if (!rows[0]) return res.status(404).json({ error: "run not found" });
      const steps = await getRunSteps(req.params.runId, { limit: 500 });
      res.json({ ok: true, run: rows[0], steps });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Legacy workflow trigger (in-process DAG walk) ----------------------
  // Supports two node families on the same canvas:
  //   1) Forge action nodes:    node.actionId → action_library row
  //   2) Skill nodes:           node.config.params.kind === "skill"
  //                             with node.config.params.skillSlug
  // If req.body omits nodes/edges (e.g. system trigger from smoke or chain
  // step), we hydrate them from the workflows table.
  // --- Legacy workflow trigger (async background run) ----------------------
  // Now returns { ok, runId } immediately; work runs in background.
  // Status polled via GET /api/workflows/runs/:runId, cancelled via POST .../stop.
  app.post("/api/workflows/:id/trigger", requireSession(), async (req, res) => {
    let { nodes = [], edges = [], context = {} } = req.body ?? {};
    try {
      if ((!nodes || nodes.length === 0) && (!edges || edges.length === 0)) {
        const { rows } = await pool.query("SELECT nodes, edges FROM workflows WHERE id=$1", [req.params.id]);
        if (rows[0]) {
          nodes = Array.isArray(rows[0].nodes) ? rows[0].nodes : [];
          edges = Array.isArray(rows[0].edges) ? rows[0].edges : [];
        }
      }
    } catch (e) {
      return res.status(500).json({ error: `hydrate failed: ${e.message}` });
    }
    const wfId = req.params.id;
    // Normalize edge properties (UI uses 'from'/'to', Execution Engine uses 'source'/'target')
    edges = edges.map(e => ({ ...e, source: e.source || e.from, target: e.target || e.to }));

    let wfName = wfId;
    try {
      const { rows } = await pool.query("SELECT name FROM workflows WHERE id=$1", [wfId]);
      if (rows[0]) wfName = rows[0].name;
    } catch { /* ignore */ }

    const runId = newRunId("wfr");
    const entry = {
      runId,
      wfId,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      trace: [],
      output: null,
      error: null,
      aborted: false,
      stepsTotal: nodes.length,
      stepsDone: 0,
      currentNode: null,
    };
    WORKFLOW_RUNS_LIVE.set(runId, entry);
    console.log(`[workflow:trigger] ${wfName} runId=${runId} nodes=${nodes.length} edges=${edges.length}`);
    enqueueWrite(
      `INSERT INTO agent_logs(agent, level, message, meta) VALUES ('workflow','info',$1,$2)`,
      [`trigger:${wfName}`, { runId, nodes: nodes.length, edges: edges.length }]
    );
    if (broadcastAudit) {
      broadcastAudit({
        agent: 'workflow',
        level: 'info',
        message: `trigger:${wfName}`,
        meta: { runId, nodes: nodes.length, edges: edges.length, stream: 'workflows', tag: 'flow.run', actor: req.session?.username || 'system' }
      });
    }
    // Respond immediately so UI can flip Play→Stop.
    res.json({ ok: true, runId });

    // Fire-and-forget background execution.
    (async () => {
      let ctx = { ...context };
      const trace = entry.trace;

      const logStep = (stepObj) => {
        trace.push(stepObj);
        
        // Find the node to get its human-readable label
        const n = nodes.find(x => x.id === stepObj.node);
        const nodeLabel = n?.label || n?.meta || stepObj.node;

        const level = stepObj.error ? 'error' : 'info';
        let msg = stepObj.error ? `Workflow step failed: ${nodeLabel} (${stepObj.kind})` : `Workflow step ok: ${nodeLabel} (${stepObj.kind})`;
        if (stepObj.actionId) msg += ` (action: ${stepObj.actionId})`;
        if (stepObj.skillSlug) msg += ` (skill: ${stepObj.skillSlug})`;
        if (stepObj.agentId) msg += ` (agent: ${stepObj.agentId})`;
        
        const meta = { runId, step: stepObj, stream: 'workflows', tag: 'flow.step', actor: req.session?.username || 'system', nodeLabel };
        enqueueWrite(
          `INSERT INTO agent_logs(agent, level, message, meta) VALUES ('workflow',$1,$2,$3)`,
          [level, msg, meta]
        );
        if (broadcastAudit) {
          broadcastAudit({ agent: 'workflow', level, message: msg, meta });
        }
      };

      try {
        const ids = [...new Set(nodes.map((n) => n.actionId).filter(Boolean))];
        let actionMap = new Map();
        if (ids.length) {
          const { rows } = await pool.query(
            `SELECT * FROM action_library WHERE id = ANY($1::text[])`, [ids]
          );
          actionMap = new Map(rows.map((r) => [r.id, r]));
        }
        const incoming = new Map();
        for (const n of nodes) incoming.set(n.id, 0);
        for (const e of edges) incoming.set(e.target, (incoming.get(e.target) || 0) + 1);
        const queue = [];
        // First, add all triggers to the queue since they are the actual start points
        // of a workflow, regardless of edges.
        const triggers = nodes.filter(n => n.kind === "trigger" || n.type === "trigger" || n.label?.toLowerCase().includes("trigger"));
        if (triggers.length > 0) {
          queue.push(...triggers);
        } else {
          // Fallback: If no explicit trigger is found, use nodes with no incoming edges
          queue.push(...nodes.filter((n) => (incoming.get(n.id) || 0) === 0));
        }
        const visited = new Set();
        let safety = 0;
        while (queue.length && safety++ < 256) {
          if (entry.aborted) break;
          const node = queue.shift();
          if (!node || visited.has(node.id)) continue;
          visited.add(node.id);
          entry.currentNode = node.id;
          const action = node.actionId ? actionMap.get(node.actionId) : null;
          const cfgParams = node?.config?.params || {};
          const isSkillNode = cfgParams.kind === "skill" && typeof cfgParams.skillSlug === "string";
          const isAgentNode = cfgParams.kind === "agent" && typeof cfgParams.agentId === "string";
          let out = {};
          if (action) {
            out = await execNodeWithAction(node, action, ctx);
            ctx = { ...ctx, ...out };
            logStep({ node: node.id, kind: "action", actionId: node.actionId, output: out });
          } else if (isAgentNode) {
            const agentId = cfgParams.agentId;
            const agentText = String(
              ctx?.query ?? ctx?.input ?? ctx?.text ?? ctx?.summary ?? cfgParams.text ?? cfgParams.prompt ?? ""
            ).trim() || `Workflow step for agent ${cfgParams.agentName || agentId}`;
            const port = Number(process.env.PORT ?? 3005);
            try {
              const r = await fetch(`http://127.0.0.1:${port}/api/agents/${encodeURIComponent(agentId)}/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: agentText, stream: false, context: ctx }),
              });
              const body = await r.json().catch(() => ({}));
              if (!r.ok || body?.ok === false) {
                logStep({ node: node.id, kind: "agent", agentId, error: body?.error || `HTTP ${r.status}` });
              } else {
                out = (body?.output && typeof body.output === "object") ? body.output : { agent_output: body };
                ctx = { ...ctx, ...out, last_agent: agentId };
                logStep({ node: node.id, kind: "agent", agentId, agentName: cfgParams.agentName, output: out });
              }
            } catch (err) {
              logStep({ node: node.id, kind: "agent", agentId, error: String(err?.message || err) });
            }
          } else if (isSkillNode) {
            const sk = (await pool.query("SELECT * FROM skills WHERE slug=$1 OR id=$1 LIMIT 1", [cfgParams.skillSlug])).rows[0];
            if (!sk) {
              logStep({ node: node.id, kind: "skill", skillSlug: cfgParams.skillSlug, error: "skill not found" });
            } else {
              const params = { ...(cfgParams.bindings || {}) };
              for (const [k, v] of Object.entries(node.data?.params || {})) {
                if (params[k] == null) params[k] = v;
              }
              const _freeText = ctx?.query ?? ctx?.input ?? ctx?.text ?? null;
              const _coerced = coerceParams(sk.param_schema, params, _freeText);
              const v = validateAgainstSchema(sk.param_schema, _coerced);
              if (!v.ok) {
                logStep({ node: node.id, kind: "skill", skillSlug: sk.slug, error: `validation failed: ${JSON.stringify(v.errors)}` });
              } else {
                const skillRunId = createPrefixedId("run.");
                await pool.query(
                  `INSERT INTO skill_runs(id,skill_id,skill_slug,user_id,status,params) VALUES ($1,$2,$3,$4,'running',$5)`,
                  [skillRunId, sk.id, sk.slug, null, JSON.stringify(v.value)]
                );
                liveRuns.set(skillRunId, {
                  skill: sk, params: v.value, steps: [], rollback_steps: [], metrics: [],
                  clients: new Set(), status: "running", output: null, cancel: false, requestedBy: null,
                });
                try {
                  const res2 = await executeSkillScript(sk, v.value, skillRunId, "run");
                  await pool.query("UPDATE skill_runs SET status='ok', output=$2, ended_at=now() WHERE id=$1",
                    [skillRunId, JSON.stringify(res2.value)]);
                  out = (res2.value && typeof res2.value === "object") ? res2.value : { value: res2.value };
                  ctx = { ...ctx, ...out };
                  logStep({ node: node.id, kind: "skill", skillSlug: sk.slug, skillRunId, output: out });
                } catch (err) {
                  const msg = String(err.message || err);
                  await pool.query("UPDATE skill_runs SET status='error', output=$2, ended_at=now() WHERE id=$1",
                    [skillRunId, JSON.stringify({ error: msg })]);
                  logStep({ node: node.id, kind: "skill", skillSlug: sk.slug, skillRunId, error: msg });
                }
              }
            }
          } else {
            logStep({ node: node.id, kind: node?.type || "passthrough" });
          }
          entry.stepsDone += 1;

          const branches = edges.filter((e) => e.source === node.id);
          for (const e of branches) {
            if (action?.kind === "logic" && e.branch && e.branch !== "default") {
              const want = e.branch === "true";
              if (Boolean(out.result) !== want) continue;
            }
            const next = nodes.find((n) => n.id === e.target);
            if (next && !visited.has(next.id)) queue.push(next);
          }
        }
        const output = {
          severity: ctx.severity ?? "info",
          summary: ctx.summary ?? `workflow ${wfId} executed`,
          ok: true,
          ts: Date.now(),
          ...ctx,
        };
        entry.output = output;
        entry.endedAt = Date.now();
        entry.currentNode = null;
        if (entry.aborted && entry.status === "running") {
          entry.status = "stopped";
          entry.error = "operator stop";
        } else if (entry.status === "running") {
          entry.status = "done";
        }
      } catch (e) {
        entry.error = String(e.message || e);
        entry.endedAt = Date.now();
        entry.currentNode = null;
        entry.status = entry.aborted ? "stopped" : "failed";
      } finally {
        scheduleRunCleanup(WORKFLOW_RUNS_LIVE, runId);
      }
    })();
  });

  // --- Live workflow run polling + stop ----------------------------------
  app.get("/api/workflows/runs/:runId", async (req, res) => {
    const entry = WORKFLOW_RUNS_LIVE.get(req.params.runId);
    if (!entry) return res.status(404).json({ ok: false, error: "run not found" });
    res.json({
      ok: true,
      runId: entry.runId,
      wfId: entry.wfId,
      status: entry.status,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      durationMs: (entry.endedAt ?? Date.now()) - entry.startedAt,
      stepsDone: entry.stepsDone,
      stepsTotal: entry.stepsTotal,
      currentNode: entry.currentNode,
      output: entry.output,
      trace: entry.trace,
      error: entry.error,
    });
  });
  app.post("/api/workflows/runs/:runId/stop", async (req, res) => {
    const entry = WORKFLOW_RUNS_LIVE.get(req.params.runId);
    if (!entry) return res.status(404).json({ ok: false, error: "run not found" });
    if (entry.status === "running") {
      entry.aborted = true;
      entry.status = "stopped";
      entry.endedAt = Date.now();
      entry.error = "operator stop";
    }
    res.json({ ok: true, runId: entry.runId, status: entry.status });
  });

  // --- Workflow Chains (Orchestration Layer) ------------------------------
  app.get("/api/chains", async (req, res) => {
    try {
      const ctx = await deps.resolveActorContext(req);
      const vis = deps.buildVisibility(ctx, 1, 'owner_id');
      const { rows } = await pool.query(`SELECT id, name, status, trigger, runs, nodes, edges, color, visibility, shared_with, created_at as updated_at FROM orchestrations WHERE ${vis.clause} ORDER BY created_at DESC`, vis.params);
      res.json(rows.map(r => ({
        id: r.id, name: r.name, updated_at: r.updated_at, visibility: r.visibility, shared_with: r.shared_with,
        graph: { status: r.status, trigger: r.trigger, runs: r.runs, nodes: r.nodes, edges: r.edges, color: r.color || 'ruby' }
      })));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.post("/api/chains", async (req, res) => {
    const { id, name, nodes = [], edges = [], color, status, trigger, runs, visibility, shared_with, ownerId, ownerName } = req.body ?? {};
    if (!id || !name) return res.status(400).json({ error: "id and name required" });
    try {
      const ctx = await deps.resolveActorContext(req);
      const owner = ownerId || ctx.userId || req.actor || null;

      await pool.query(
        `INSERT INTO orchestrations(id, name, status, trigger, runs, nodes, edges, color, visibility, shared_with, owner_id, owner_name, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12,now())
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, status=EXCLUDED.status, trigger=EXCLUDED.trigger, runs=EXCLUDED.runs, nodes=EXCLUDED.nodes, edges=EXCLUDED.edges, color=EXCLUDED.color, visibility=EXCLUDED.visibility, shared_with=EXCLUDED.shared_with, owner_id = COALESCE(orchestrations.owner_id, EXCLUDED.owner_id), owner_name = COALESCE(orchestrations.owner_name, EXCLUDED.owner_name)`,
        [id, name, status || 'draft', trigger || null, runs || 0, JSON.stringify(nodes), JSON.stringify(edges), color || 'ruby', visibility || 'private', JSON.stringify(shared_with || []), owner, ownerName || null]
      );

      const ctxActor = req.session?.userId || null;
      await syncTriggerSchedules(pool, 'orchestration', id, nodes, ctxActor);

      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.delete("/api/chains/:id", async (req, res) => {
    try { await pool.query("DELETE FROM orchestrations WHERE id=$1", [req.params.id]); res.status(204).end(); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.get("/api/chains/:id/runs", async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT id, chain_id, status, current_node, context, trace, started_at, finished_at FROM chain_runs WHERE chain_id=$1 ORDER BY started_at DESC LIMIT 25",
        [req.params.id]
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.post("/api/chains/:id/run", requireSession(), async (req, res) => {
    const chainId = req.params.id;
    const seedCtx = req.body?.context ?? {};
    let runId;
    let nodes, edges, startNode;
    try {
      const { rows } = await pool.query("SELECT nodes, edges FROM orchestrations WHERE id=$1", [chainId]);
      if (!rows[0]) return res.status(404).json({ error: "chain not found" });
      nodes = Array.isArray(rows[0].nodes) ? rows[0].nodes : [];
      edges = Array.isArray(rows[0].edges) ? rows[0].edges : [];
      // Normalize edge properties (UI uses 'from'/'to', Execution Engine uses 'source'/'target')
      edges = edges.map(e => ({ ...e, source: e.source || e.from, target: e.target || e.to }));

      startNode = nodes.find((n) => n.kind === "start" || n.kind === "trigger" || n.type === "trigger" || n.label?.toLowerCase().includes("trigger")) || nodes[0];
      if (!startNode) return res.status(400).json({ error: "chain has no start node" });

      runId = newRunId("run");
      await pool.query(
        "INSERT INTO chain_runs(id, chain_id, status, current_node, context, trace) VALUES ($1,$2,'running',$3,$4,$5)",
        [runId, chainId, startNode.id, seedCtx, []]
      );
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }

    let chainName = chainId;
    try {
      const { rows } = await pool.query("SELECT name FROM orchestrations WHERE id=$1", [chainId]);
      if (rows[0]) chainName = rows[0].name;
    } catch { /* ignore */ }

    const liveEntry = {
      runId,
      chainId,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      currentNode: startNode.id,
      stepsTotal: nodes.length,
      stepsDone: 0,
      trace: [],
      context: { ...seedCtx },
      aborted: false,
      error: null,
    };
    CHAIN_RUNS_LIVE.set(runId, liveEntry);
    
    enqueueWrite(
      `INSERT INTO agent_logs(agent, level, message, meta) VALUES ('chain','info',$1,$2)`,
      [`run:${chainName}`, { runId, nodes: nodes.length }]
    );
    if (broadcastAudit) {
      broadcastAudit({
        agent: 'chain',
        level: 'info',
        message: `run:${chainName}`,
        meta: { runId, nodes: nodes.length, stream: 'workflows', tag: 'flow.run', actor: req.session?.username || 'system' }
      });
    }

    // Respond immediately so UI flips Play→Stop without waiting for full run.
    res.json({ ok: true, runId });

    (async () => {
      const trace = liveEntry.trace;
      const completedSkillSteps = [];
      let ctx = liveEntry.context;
      let current = startNode;
      let safety = 0;
      let chainError = null;

      const logStep = (stepObj) => {
        trace.push(stepObj);
        
        // Find the node to get its human-readable label
        const n = nodes.find(x => x.id === stepObj.node);
        const nodeLabel = n?.label || n?.meta || stepObj.node;

        const level = stepObj.error ? 'error' : 'info';
        let msg = stepObj.error ? `Chain step failed: ${nodeLabel} (${stepObj.kind})` : `Chain step ok: ${nodeLabel} (${stepObj.kind})`;
        if (stepObj.skillSlug) msg += ` (skill: ${stepObj.skillSlug})`;
        if (stepObj.workflowId) msg += ` (workflow: ${stepObj.workflowId})`;
        
        const meta = { runId, step: stepObj, stream: 'workflows', tag: 'flow.step', actor: req.session?.username || 'system', nodeLabel };
        enqueueWrite(
          `INSERT INTO agent_logs(agent, level, message, meta) VALUES ('chain',$1,$2,$3)`,
          [level, msg, meta]
        );
        if (broadcastAudit) {
          broadcastAudit({ agent: 'chain', level, message: msg, meta });
        }
      };

      try {
        while (current && safety++ < 64) {
          if (liveEntry.aborted) break;
          const step = { node: current.id, kind: current.kind, ts: Date.now() };
          liveEntry.currentNode = current.id;
          try {
            if (current.kind === "workflow" && current.workflowId) {
              const wfRow = await pool.query("SELECT graph, name FROM workflows WHERE id=$1", [current.workflowId]);
              if (wfRow.rows[0]) {
                const g = wfRow.rows[0].graph || {};
                const out = {
                  severity: ctx.severity ?? "info",
                  summary: `workflow ${wfRow.rows[0].name} executed`,
                  ok: true,
                  ts: Date.now(),
                };
                ctx = { ...ctx, ...out };
                step.output = out;
                step.workflowId = current.workflowId;
                logStep(step);
              } else {
                step.workflowId = current.workflowId;
                step.error = "workflow not found";
                logStep(step);
              }
              const next = edges.find((e) => e.source === current.id);
              current = next ? nodes.find((n) => n.id === next.target) : null;
            } else if (current.kind === "skill" && current.skillSlug) {
              const sk = (await pool.query("SELECT * FROM skills WHERE slug=$1 OR id=$1 LIMIT 1", [current.skillSlug])).rows[0];
              if (!sk) {
                step.skillSlug = current.skillSlug;
                step.error = `skill not found: ${current.skillSlug}`;
                chainError = step.error;
                logStep(step);
              } else {
                const params = {};
                const bindings = current.bindings || {};
                for (const [k, src] of Object.entries(bindings)) {
                  if (typeof src === "string" && src.startsWith("$ctx.")) {
                    params[k] = ctx[src.slice(5)];
                  } else {
                    params[k] = src;
                  }
                }
                for (const [k, v] of Object.entries(current.params || {})) {
                  if (params[k] == null) params[k] = v;
                }
                const _freeText = ctx?.query ?? ctx?.input ?? ctx?.text ?? null;
                const _coerced = coerceParams(sk.param_schema, params, _freeText);
                const v = validateAgainstSchema(sk.param_schema, _coerced);
                if (!v.ok) {
                  step.skillSlug = sk.slug;
                  step.error = `validation failed: ${JSON.stringify(v.errors)}`;
                  chainError = step.error;
                  logStep(step);
                } else {
                  const skillRunId = createPrefixedId("run.");
                  await pool.query(
                    `INSERT INTO skill_runs(id,skill_id,skill_slug,user_id,status,params,parent_run_id) VALUES ($1,$2,$3,$4,'running',$5,$6)`,
                    [skillRunId, sk.id, sk.slug, null, JSON.stringify(v.value), runId]
                  );
                  liveRuns.set(skillRunId, {
                    skill: sk, params: v.value, steps: [], rollback_steps: [], metrics: [],
                    clients: new Set(), status: "running", output: null, cancel: false, requestedBy: null,
                  });
                  try {
                    const res2 = await executeSkillScript(sk, v.value, skillRunId, "run");
                    await pool.query("UPDATE skill_runs SET status='ok', output=$2, ended_at=now() WHERE id=$1",
                      [skillRunId, JSON.stringify(res2.value)]);
                    step.skillSlug = sk.slug;
                    step.skillRunId = skillRunId;
                    step.output = res2.value;
                    if (res2.value && typeof res2.value === "object") ctx = { ...ctx, ...res2.value };
                    completedSkillSteps.push({ skill: sk, params: v.value, skillRunId });
                    logStep(step);
                  } catch (err) {
                    step.skillSlug = sk.slug;
                    step.error = String(err.message || err);
                    await pool.query("UPDATE skill_runs SET status='error', output=$2, ended_at=now() WHERE id=$1",
                      [skillRunId, JSON.stringify({ error: step.error })]);
                    chainError = step.error;
                    logStep(step);
                  }
                }
              }
              const next = edges.find((e) => e.source === current.id);
              current = next ? nodes.find((n) => n.id === next.target) : null;
            } else if (current.kind === "condition") {
              const result = evalChainCondition(current.expression || "false", ctx);
              step.expression = current.expression;
              step.result = result;
              logStep(step);
              const next = edges.find((e) => e.source === current.id && e.branch === (result ? "true" : "false"))
                        || edges.find((e) => e.source === current.id);
              current = next ? nodes.find((n) => n.id === next.target) : null;
            } else if (current.kind === "end") {
              logStep(step);
              liveEntry.stepsDone += 1;
              break;
            } else {
              logStep(step);
              const next = edges.find((e) => e.source === current.id);
              current = next ? nodes.find((n) => n.id === next.target) : null;
            }
          } catch (stepErr) {
            step.error = String(stepErr.message || stepErr);
            chainError = step.error;
          }
          trace.push(step);
          liveEntry.stepsDone += 1;
          liveEntry.context = ctx;
          await pool.query(
            "UPDATE chain_runs SET current_node=$1, context=$2, trace=$3 WHERE id=$4",
            [current?.id ?? null, ctx, JSON.stringify(trace), runId]
          ).catch(() => {});
          if (chainError) break;
        }

        if (liveEntry.aborted) {
          liveEntry.status = "stopped";
          liveEntry.error = "operator stop";
          liveEntry.endedAt = Date.now();
          liveEntry.currentNode = null;
          await pool.query(
            "UPDATE chain_runs SET status='cancelled', current_node=NULL, context=$1, trace=$2, finished_at=now() WHERE id=$3",
            [ctx, JSON.stringify(trace.concat([{ stopped: true }])), runId]
          ).catch(() => {});
          return;
        }

        if (chainError) {
          const rollbackTrace = [];
          for (let i = completedSkillSteps.length - 1; i >= 0; i--) {
            const c = completedSkillSteps[i];
            if (!c.skill.rollback_body) { rollbackTrace.push({ skill: c.skill.slug, skipped: true }); continue; }
            try {
              await executeSkillScript(c.skill, c.params, c.skillRunId, "rollback");
              await pool.query("UPDATE skill_runs SET status='rolled_back' WHERE id=$1", [c.skillRunId]);
              rollbackTrace.push({ skill: c.skill.slug, ok: true });
            } catch (re) {
              rollbackTrace.push({ skill: c.skill.slug, error: String(re.message || re) });
            }
          }
          await pool.query(
            "UPDATE chain_runs SET status='rolled_back', current_node=NULL, context=$1, trace=$2, finished_at=now() WHERE id=$3",
            [ctx, JSON.stringify(trace.concat([{ rollback: rollbackTrace, error: chainError }])), runId]
          ).catch(() => {});
          liveEntry.status = "failed";
          liveEntry.error = chainError;
          liveEntry.endedAt = Date.now();
          liveEntry.currentNode = null;
          return;
        }

        await pool.query(
          "UPDATE chain_runs SET status='completed', current_node=NULL, context=$1, trace=$2, finished_at=now() WHERE id=$3",
          [ctx, JSON.stringify(trace), runId]
        ).catch(() => {});
        liveEntry.status = "done";
        liveEntry.endedAt = Date.now();
        liveEntry.currentNode = null;
        liveEntry.context = ctx;
      } catch (e) {
        liveEntry.status = liveEntry.aborted ? "stopped" : "failed";
        liveEntry.error = String(e.message || e);
        liveEntry.endedAt = Date.now();
        liveEntry.currentNode = null;
      } finally {
        scheduleRunCleanup(CHAIN_RUNS_LIVE, runId);
      }
    })();
  });

  // --- Live chain run polling + stop ----------------------------------
  app.get("/api/chains/runs/:runId", async (req, res) => {
    const entry = CHAIN_RUNS_LIVE.get(req.params.runId);
    if (!entry) return res.status(404).json({ ok: false, error: "run not found" });
    res.json({
      ok: true,
      runId: entry.runId,
      chainId: entry.chainId,
      status: entry.status,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      durationMs: (entry.endedAt ?? Date.now()) - entry.startedAt,
      stepsDone: entry.stepsDone,
      stepsTotal: entry.stepsTotal,
      currentNode: entry.currentNode,
      trace: entry.trace,
      context: entry.context,
      error: entry.error,
    });
  });
  app.post("/api/chains/runs/:runId/stop", async (req, res) => {
    const entry = CHAIN_RUNS_LIVE.get(req.params.runId);
    if (!entry) return res.status(404).json({ ok: false, error: "run not found" });
    if (entry.status === "running") {
      entry.aborted = true;
      // Status flip happens in the background loop after the current await resolves.
    }
    res.json({ ok: true, runId: entry.runId, status: entry.status });
  });
}

