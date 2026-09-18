// local-server/lib/meta-forge/planner.mjs
// Read-only inventory + plan validation. Does NOT call the LLM here — the
// planning agent (Meta/forge_master) produces the ForgePlan and POSTs it to
// /api/meta-forge/plan. This module only validates shape and persists.

import { searchCapabilityVectors } from "../capability-vector.mjs";

const VALID_KINDS = new Set(["skill", "pack", "tool", "agent", "workflow", "chain", "orchestration", "webhook", "mcp"]);

export function validateForgePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("plan must be object");
  const reuse = Array.isArray(plan.reuse) ? plan.reuse : [];
  const create = Array.isArray(plan.create) ? plan.create : [];
  for (const item of [...reuse, ...create]) {
    if (!item || typeof item !== "object") throw new Error("plan item must be object");
    
    // Normalize type/kind
    if (item.type && !item.kind) {
      item.kind = item.type;
    }
    if (item.kind === "orchestration") {
      item.kind = "chain";
    }

    if (!VALID_KINDS.has(item.kind)) throw new Error(`invalid kind: ${item.kind}`);
    if (!item.slug || typeof item.slug !== "string") throw new Error("item.slug required");

    // Normalize MCP items
    if (item.kind === "mcp") {
      if (!item.url && item.command) item.url = item.command;
      if (!item.transport) item.transport = (item.url && /^https?:\/\//i.test(item.url)) ? "http" : "stdio";
    }

    // Enforce Orchestration Chain invariants (Macro-Orchestration cannot execute raw tools directly)
    if (item.kind === "chain") {
      let chainNodes = Array.isArray(item.nodes) ? item.nodes : [];
      if (!chainNodes.length && typeof item.source === "object" && item.source !== null) {
        chainNodes = Array.isArray(item.source?.nodes) ? item.source.nodes : [];
      } else if (!chainNodes.length && typeof item.source === "string") {
        try {
          const parsed = JSON.parse(item.source);
          chainNodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
        } catch {}
      }

      if (chainNodes.length > 0) {
        const hasDirectTool = chainNodes.some(n => (n.kind === "tool" || n.type === "tool"));
        if (hasDirectTool) {
          throw new Error("Orchestration Chains cannot directly contain 'tool' nodes. Raw tools must be encapsulated inside independent 'workflow' (DAG) objects.");
        }
      }
    }
  }
  if (!create.length && !reuse.length) throw new Error("plan is empty");
  return { reuse, create };
}

export function extractForgeJson(text) {
  if (!text) return null;
  const raw = String(text);

  function normalizePlan(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (obj.plan && typeof obj.plan === "object" && (Array.isArray(obj.plan.create) || Array.isArray(obj.plan.reuse))) {
      return obj;
    }
    if (Array.isArray(obj.create) || Array.isArray(obj.reuse)) {
      return {
        intent: obj.intent || "",
        plan: {
          create: Array.isArray(obj.create) ? obj.create : [],
          reuse: Array.isArray(obj.reuse) ? obj.reuse : []
        }
      };
    }
    if (Array.isArray(obj.actions)) {
      return {
        intent: obj.intent || "",
        plan: {
          create: obj.actions,
          reuse: []
        }
      };
    }
    return null;
  }

  // Try direct parse first (if LLM returned pure JSON)
  try {
      const direct = JSON.parse(raw);
      const norm = normalizePlan(direct);
      if (norm) return norm;
  } catch {}

  // Try to find markdown block
  let targetArea = raw;
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match && match[1]) {
      targetArea = match[1];
      try {
        const mdParsed = JSON.parse(targetArea);
        const norm = normalizePlan(mdParsed);
        if (norm) return norm;
      } catch {}
  }

  // Fallback to AST scanner on the target area
  const candidates = [];
  for (let i = 0; i < targetArea.length; i++) {
    if (targetArea[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < targetArea.length; j++) {
      const ch = targetArea[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { candidates.push(targetArea.slice(i, j + 1)); i = j; break; }
      }
    }
  }
  
  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      const norm = normalizePlan(obj);
      if (norm) return norm;
    } catch { /* keep scanning */ }
  }

  return null;
}

/**
 * Loopback inventory: agents + tools + skills + packs + MCP exposures.
 * Focuses on relevant capabilities when intent is provided, saving up to 8,000 prompt tokens.
 */
export async function buildInventory(pool, opts = {}) {
  const intent = typeof opts === "string" ? opts : opts?.intent || "";
  const [agents, tools, skills, packs, mcpClients, workflows, chains, webhooks] = await Promise.all([
    pool.query(`SELECT id AS slug, name, COALESCE(description,'') AS description
                FROM agents WHERE id != 'agt.forge_master' ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name, COALESCE(description,'') AS description, category
                FROM action_library WHERE COALESCE((runtime->>'orphan')::boolean, false) = false ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name, COALESCE(description,'') AS description
                FROM skills WHERE enabled=true ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name, COALESCE(description,'') AS description
                FROM capability_packs ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT slug, name, tools_cache, last_status, last_error FROM mcp_client_servers`)
      .catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name FROM workflows ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name FROM orchestrations ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name, COALESCE(description,'') AS description FROM webhooks WHERE enabled=true ORDER BY id`).catch(() => ({ rows: [] })),
  ]);

  let relevantMatches = [];
  if (intent) {
    try {
      relevantMatches = await searchCapabilityVectors(pool, { intent, limit: 8, minScore: 0.52 });
    } catch {}
  }

  const counts = {
    agents: agents.rows.length,
    tools: tools.rows.length,
    skills: skills.rows.length,
    packs: packs.rows.length,
    mcp_servers: mcpClients.rows.length,
    workflows: workflows.rows.length,
    chains: chains.rows.length,
    webhooks: webhooks.rows.length,
  };

  // When intent is available, return focused relevant items + compact slug registry (94% prompt token savings)
  if (relevantMatches.length > 0) {
    return {
      relevant_capabilities: relevantMatches.map((m) => ({
        kind: m.kind,
        slug: m.slug,
        name: m.name,
        desc: m.description,
        relevance: `${Math.round(m.score * 100)}%`,
      })),
      registered_slugs_by_kind: {
        tools: tools.rows.map((t) => t.slug),
        skills: skills.rows.map((s) => s.slug),
        workflows: workflows.rows.map((w) => w.slug),
        chains: chains.rows.map((c) => c.slug),
        agents: agents.rows.map((a) => a.slug),
        mcp_servers: mcpClients.rows.map((s) => s.slug),
        webhooks: webhooks.rows.map((w) => w.slug),
        packs: packs.rows.map((p) => p.slug),
      },
      counts,
    };
  }

  return {
    agents: agents.rows.map((a) => ({ slug: a.slug, name: a.name })),
    tools: tools.rows.slice(0, 20).map((t) => ({ slug: t.slug, name: t.name, desc: (t.description || "").slice(0, 80) })),
    skills: skills.rows.map((s) => ({ slug: s.slug, name: s.name })),
    packs: packs.rows.map((p) => ({ slug: p.slug, name: p.name })),
    mcp_servers: mcpClients.rows.map((s) => ({ slug: s.slug, name: s.name, status: s.last_status })),
    workflows: workflows.rows.map((w) => ({ slug: w.slug, name: w.name })),
    chains: chains.rows.map((c) => ({ slug: c.slug, name: c.name })),
    webhooks: webhooks.rows.map((wh) => ({ slug: wh.slug, name: wh.name })),
    counts,
  };
}
