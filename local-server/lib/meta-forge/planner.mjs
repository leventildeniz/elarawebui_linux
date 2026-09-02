// local-server/lib/meta-forge/planner.mjs
// Read-only inventory + plan validation. Does NOT call the LLM here — the
// planning agent (Meta/forge_master) produces the ForgePlan and POSTs it to
// /api/meta-forge/plan. This module only validates shape and persists.

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

    if (!VALID_KINDS.has(item.kind)) throw new Error(`invalid kind: ${item.kind}`);
    if (!item.slug || typeof item.slug !== "string") throw new Error("item.slug required");
  }
  if (!create.length && !reuse.length) throw new Error("plan is empty");
  return { reuse, create };
}

export function extractForgeJson(text) {
  if (!text) return null;
  const raw = String(text);

  // Try direct parse first (if LLM was a good boy and returned pure JSON)
  try {
      const direct = JSON.parse(raw);
      if (direct && typeof direct === "object" && direct.plan) return direct;
  } catch {}

  // Try to find markdown block but DON'T blindly replace backticks everywhere
  let targetArea = raw;
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match && match[1]) {
      targetArea = match[1];
      try {
        const mdParsed = JSON.parse(targetArea);
        if (mdParsed && typeof mdParsed === "object" && mdParsed.plan) return mdParsed;
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
      if (obj && typeof obj === "object" && obj.plan) return obj;
    } catch { /* keep scanning */ }
  }
  for (const c of candidates) {
    try { return JSON.parse(c); } catch {}
  }
  
  return null;
}

/**
 * Loopback inventory: agents + tools + skills + packs + MCP exposures.
 * Uses direct pool queries (no HTTP hop) since we're already in-process.
 */
export async function buildInventory(pool) {
  const [agents, tools, skills, packs, mcpExposed, mcpClients, workflows, chains] = await Promise.all([
    pool.query(`SELECT id AS slug, name, COALESCE(description,'') AS description
                FROM agents WHERE id != 'agt.forge_master' ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name, COALESCE(description,'') AS description, category
                FROM action_library WHERE COALESCE((runtime->>'orphan')::boolean, false) = false ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name, COALESCE(description,'') AS description
                FROM skills WHERE enabled=true ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name, COALESCE(description,'') AS description
                FROM capability_packs ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT kind, slug FROM mcp_exposures WHERE enabled=true`)
      .catch(() => ({ rows: [] })),
    pool.query(`SELECT slug, name, tools_cache FROM mcp_client_servers WHERE enabled=true`)
      .catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name FROM workflows ORDER BY id`).catch(() => ({ rows: [] })),
    pool.query(`SELECT id AS slug, name FROM orchestrations ORDER BY id`).catch(() => ({ rows: [] })),
  ]);

  const mcpTools = [];
  for (const server of mcpClients.rows) {
    const list = Array.isArray(server.tools_cache) ? server.tools_cache : [];
    for (const t of list) {
      mcpTools.push({
        slug: `mcp.${server.slug}.${t.name}`,
        name: `[MCP: ${server.name}] ${t.name}`,
        desc: (t.description || "").slice(0, 100)
      });
    }
  }

  return {
    agents: agents.rows.map(a => ({ slug: a.slug, name: a.name, desc: (a.description || "").slice(0, 100) })),
    tools: tools.rows.map(t => ({ slug: t.slug, name: t.name, desc: (t.description || "").slice(0, 100), cat: t.category })),
    skills: skills.rows.map(s => ({ slug: s.slug, name: s.name, desc: (s.description || "").slice(0, 100) })),
    packs: packs.rows.map(p => ({ slug: p.slug, name: p.name })),
    mcp_tools: mcpTools,
    mcp_exposed: mcpExposed.rows,
    workflows: workflows.rows.map(w => ({ slug: w.slug, name: w.name })),
    chains: chains.rows.map(c => ({ slug: c.slug, name: c.name })),
    counts: {
      agents: agents.rows.length,
      tools: tools.rows.length,
      skills: skills.rows.length,
      packs: packs.rows.length,
      mcp_tools: mcpTools.length,
      workflows: workflows.rows.length,
      chains: chains.rows.length,
    },
  };
}
