// local-server/lib/mcp/catalog.mjs
// Build MCP tool list from DB (agents + tools + skills) filtered by exposures.
// Each entity becomes one MCP tool under the configured namespace.

export function makeMcpToolName(namespace, kind, slug) {
  const ns = String(namespace || "elara").replace(/[^a-zA-Z0-9_]/g, "");
  const safeSlug = String(slug).replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `${ns}.${kind}.${safeSlug}`;
}

export function parseMcpToolName(name) {
  // "elara.agent.social_media" → { namespace, kind, slug }
  const m = String(name || "").match(/^([a-zA-Z0-9_]+)\.(agent|tool|skill)\.(.+)$/);
  if (!m) return null;
  return { namespace: m[1], kind: m[2], slug: m[3] };
}

/**
 * Returns MCP-shaped tool descriptors: [{name, description, inputSchema}]
 * Only entities that are enabled AND exposed are returned.
 */
export async function buildMcpToolCatalog(pool, namespace) {
  const enabled = await pool.query(
    `SELECT kind, slug, display_name, description
       FROM mcp_exposures WHERE enabled=true`,
  );
  const buckets = { agent: new Map(), tool: new Map(), skill: new Map() };
  for (const r of enabled.rows) {
    if (buckets[r.kind]) buckets[r.kind].set(r.slug, r);
  }

  const out = [];

  // Agents
  if (buckets.agent.size) {
    const slugs = [...buckets.agent.keys()];
    const { rows } = await pool.query(
      `SELECT id, name,
              COALESCE(to_jsonb(a)->>'description', meta->>'description', '') AS description,
              param_schema, meta
         FROM agents a WHERE id = ANY($1)`,
      [slugs],
    ).catch((err) => {
      console.error("[mcp:catalog:agent_lookup_failed]", err?.message || err);
      return { rows: [] };
    });
    for (const a of rows) {
      const exp = buckets.agent.get(a.id) || {};
      const desc = exp.description
        || (a.meta && typeof a.meta === "object" ? a.meta.description : null)
        || a.description
        || `Elara agent: ${a.name || a.id}`;
      out.push({
        name: makeMcpToolName(namespace, "agent", a.id),
        description: String(desc).slice(0, 500),
        inputSchema: agentInputSchema(a.param_schema),
        _kind: "agent",
        _slug: a.id,
      });
    }
  }

  // Tools
  if (buckets.tool.size) {
    const slugs = [...buckets.tool.keys()];
    const { rows } = await pool.query(
      `SELECT id, name, COALESCE(to_jsonb(t)->>'description', '') AS description, params_schema
         FROM tools t WHERE id = ANY($1) AND enabled=true`,
      [slugs],
    ).catch((err) => {
      console.error("[mcp:catalog:tool_lookup_failed]", err?.message || err);
      return { rows: [] };
    });
    for (const t of rows) {
      const exp = buckets.tool.get(t.id) || {};
      out.push({
        name: makeMcpToolName(namespace, "tool", t.id),
        description: String(exp.description || t.description || t.name || `Elara tool: ${t.id}`).slice(0, 500),
        inputSchema: (t.params_schema && typeof t.params_schema === "object")
          ? t.params_schema
          : { type: "object", properties: {}, additionalProperties: true },
        _kind: "tool",
        _slug: t.id,
      });
    }
  }

  // Skills
  if (buckets.skill.size) {
    const slugs = [...buckets.skill.keys()];
    const { rows } = await pool.query(
      `SELECT id, name, COALESCE(to_jsonb(s)->>'description', '') AS description FROM skills s WHERE id = ANY($1)`,
      [slugs],
    ).catch((err) => {
      console.error("[mcp:catalog:skill_lookup_failed]", err?.message || err);
      return { rows: [] };
    });
    for (const s of rows) {
      const exp = buckets.skill.get(s.id) || {};
      out.push({
        name: makeMcpToolName(namespace, "skill", s.id),
        description: String(exp.description || s.description || s.name || `Elara skill: ${s.id}`).slice(0, 500),
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Free-text input for the skill" },
          },
        },
        _kind: "skill",
        _slug: s.id,
      });
    }
  }

  return out;
}

function agentInputSchema(paramSchema) {
  if (paramSchema && typeof paramSchema === "object" && paramSchema.properties) {
    return paramSchema;
  }
  return {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text query or task for the agent" },
    },
  };
}

/**
 * Discovery helper — list all candidate entities (agent/tool/skill) so UI can
 * show a table with an enable-switch per row.
 */
export async function listAllCandidates(pool) {
  async function safeQuery(sql, fallbackSql) {
    try { return (await pool.query(sql)).rows; }
    catch { try { return (await pool.query(fallbackSql)).rows; } catch { return []; } }
  }
  const [agents, tools, skills] = await Promise.all([
    safeQuery(
      `SELECT id AS slug, name, COALESCE(description, meta->>'description', '') AS description FROM agents ORDER BY id`,
      `SELECT id AS slug, name, COALESCE(meta->>'description', '') AS description FROM agents ORDER BY id`,
    ),
    safeQuery(
      `SELECT id AS slug, name, COALESCE(description, '') AS description FROM tools WHERE enabled=true ORDER BY id`,
      `SELECT id AS slug, name, '' AS description FROM tools WHERE enabled=true ORDER BY id`,
    ),
    safeQuery(
      `SELECT id AS slug, name, COALESCE(description, '') AS description FROM skills ORDER BY id`,
      `SELECT id AS slug, name, '' AS description FROM skills ORDER BY id`,
    ),
  ]);
  return { agents, tools, skills };
}

