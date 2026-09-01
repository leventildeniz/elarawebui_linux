// local-server/lib/meta-forge/selection.mjs
// Identity gate for explicit Meta-Forge agent selection. This does not inspect
// user text; it only trusts selected agent metadata / DB rows.

const META_FORGE_ID = "meta-forge-master";
const META_FORGE_SCRIPT = "meta/forge_master.py";

function normalizePathLike(value) {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^agents\//i, "")
    .toLowerCase();
}

export function isMetaForgeScriptPath(value) {
  const p = normalizePathLike(value);
  return p === META_FORGE_SCRIPT || p.endsWith(`/${META_FORGE_SCRIPT}`);
}

function rowIsMetaForge(row) {
  if (!row || typeof row !== "object") return false;
  if (String(row.id || "").trim() === META_FORGE_ID) return true;
  if (isMetaForgeScriptPath(row.agent_path)) return true;
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  if (isMetaForgeScriptPath(meta.script)) return true;
  return false;
}

export async function resolveSelectedMetaForgeAgent({ pool, agentId = null, agents = [] } = {}) {
  if (Array.isArray(agents)) {
    for (const agent of agents) {
      if (typeof agent === "string") {
        const hit = await resolveSelectedMetaForgeAgent({ pool, agentId: agent, agents: [] });
        if (hit) return { ...hit, source: "request-agents" };
        continue;
      }
      if (!agent || typeof agent !== "object") continue;
      if (rowIsMetaForge(agent)) return { source: "request-agents", agent };
      const meta = agent.meta && typeof agent.meta === "object" ? agent.meta : {};
      if (isMetaForgeScriptPath(agent.script || agent.path || agent.agentPath || meta.script)) {
        return { source: "request-agents", agent };
      }
    }
  }

  const id = String(agentId || "").trim();
  if (!id) return null;
  if (id === META_FORGE_ID) return { source: "request-agent-id", agent: { id } };

  if (!pool || typeof pool.query !== "function") return null;
  const { rows } = await pool.query(
    `SELECT id, name, agent_path, meta
       FROM agents
      WHERE id = $1 OR name = $1
      LIMIT 1`,
    [id],
  );
  const row = rows?.[0] || null;
  return rowIsMetaForge(row) ? { source: "db", agent: row } : null;
}