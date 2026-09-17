// local-server/lib/capability-vector.mjs
// Sovereign Semantic Capability Vector Mapping & Search Engine for ELARA Studio
// Supports all 8 capability kinds: tool, skill, workflow, chain, agent, mcp, webhook, pack.
// Powered by Native In-Process ONNX Runtime (384-dim BAAI/bge-small-en-v1.5) & PostgreSQL pgvector.
// 100% Pure mathematical cosine similarity without hardcoded dictionaries or ad-hoc regexes.

import { embed } from "./embed-provider.mjs";

/**
 * Normalizes and builds an agnostic semantic representation for each capability kind.
 * @param {string} kind - One of the 8 kinds
 * @param {object} row - Database row object
 * @returns {string} Text to be embedded
 */
export function buildCapabilityText(kind, row) {
  if (!row || typeof row !== "object") return "";

  const slug = String(row.slug || row.id || "").trim();

  switch (kind) {
    case "tool": {
      let paramNames = "";
      try {
        const p = typeof row.params === "string" ? JSON.parse(row.params) : row.params;
        const list = Array.isArray(p)
          ? p.map((x) => x.name || x.key || x.id)
          : p && typeof p === "object"
            ? Object.keys(p.properties || p)
            : [];
        paramNames = list.filter(Boolean).join(", ");
      } catch {}
      return `Tool: ${row.name || slug} (${slug}). Category: ${row.category || "General"}. Description: ${row.description || ""}. Parameters: ${paramNames}`.trim();
    }

    case "skill": {
      const instructionsSnippet = (row.instructions || "").slice(0, 300);
      return `Skill: ${row.name || slug} (${slug}). Description: ${row.description || ""}. Instructions: ${instructionsSnippet}`.trim();
    }

    case "workflow": {
      let nodeLabels = "";
      try {
        const nodes = typeof row.nodes === "string" ? JSON.parse(row.nodes) : row.nodes;
        if (Array.isArray(nodes)) {
          nodeLabels = nodes.map((n) => n.label || n.name || n.meta).filter(Boolean).join(" -> ");
        }
      } catch {}
      return `Workflow DAG: ${row.name || slug} (${slug}). Trigger: ${row.trigger || "Manual"}. Pipeline Nodes: ${nodeLabels}`.trim();
    }

    case "chain": {
      let stageLabels = "";
      try {
        const nodes = typeof row.nodes === "string" ? JSON.parse(row.nodes) : row.nodes;
        if (Array.isArray(nodes)) {
          stageLabels = nodes.map((n) => n.label || n.name || n.meta).filter(Boolean).join(" -> ");
        }
      } catch {}
      return `Orchestration Chain: ${row.name || slug} (${slug}). Trigger: ${row.trigger || "Manual"}. Macro Stages: ${stageLabels}`.trim();
    }

    case "agent": {
      return `Agent: ${row.name || slug} (${slug}). Role: ${row.role || "Operator"}. Squad: ${row.squad || "General"}. Description: ${row.description || ""}`.trim();
    }

    case "mcp": {
      let toolSummaries = "";
      try {
        const tools = Array.isArray(row.tools_cache) ? row.tools_cache : typeof row.tools_cache === "string" ? JSON.parse(row.tools_cache) : [];
        toolSummaries = tools.map((t) => `${t.name}: ${t.description || ""}`).slice(0, 8).join("; ");
      } catch {}
      return `MCP Integration Server: ${row.name || slug} (${slug}). Transport: ${row.transport || "http"}. Exposed Tools: ${toolSummaries}`.trim();
    }

    case "webhook": {
      return `Inbound Webhook: ${row.name || slug} (${slug}). Category: ${row.category || "webhook"}. Description: ${row.description || ""}`.trim();
    }

    case "pack": {
      let brandKw = "";
      try {
        const bk = Array.isArray(row.brand_keywords) ? row.brand_keywords : typeof row.brand_keywords === "string" ? JSON.parse(row.brand_keywords) : [];
        brandKw = bk.join(", ");
      } catch {}
      return `Capability Pack: ${row.name || slug} (${slug}). Sector: ${row.sector || "general"}. Description: ${row.description || ""}. Keywords: ${brandKw}`.trim();
    }

    default:
      return `${row.name || slug}: ${row.description || ""}`.trim();
  }
}

/**
 * Formats a raw number array into Postgres vector syntax: '[0.123,0.456,...]'
 */
function vectorToSql(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return null;
  return `[${vec.join(",")}]`;
}

/**
 * Backfills vectors for all 8 capability tables in PostgreSQL.
 * @param {object} pool - PostgreSQL pool
 * @param {object} [opts] - Options: { force: boolean }
 * @returns {Promise<{ backfilled: Record<string, number>, total: number, ms: number }>}
 */
export async function backfillCapabilityVectors(pool, { force = false } = {}) {
  const t0 = Date.now();
  const stats = { tool: 0, skill: 0, workflow: 0, chain: 0, agent: 0, mcp: 0, webhook: 0, pack: 0 };

  const configs = [
    {
      kind: "tool",
      table: "action_library",
      idCol: "id",
      query: `SELECT id, name, category, description, params FROM action_library ${force ? "" : "WHERE embedding IS NULL"}`,
    },
    {
      kind: "skill",
      table: "skills",
      idCol: "id",
      query: `SELECT id, name, description, instructions FROM skills ${force ? "" : "WHERE embedding IS NULL"}`,
    },
    {
      kind: "workflow",
      table: "workflows",
      idCol: "id",
      query: `SELECT id, name, trigger, nodes FROM workflows ${force ? "" : "WHERE embedding IS NULL"}`,
    },
    {
      kind: "chain",
      table: "orchestrations",
      idCol: "id",
      query: `SELECT id, name, trigger, nodes FROM orchestrations ${force ? "" : "WHERE embedding IS NULL"}`,
    },
    {
      kind: "agent",
      table: "agents",
      idCol: "id",
      query: `SELECT id, name, squad, role, description FROM agents ${force ? "" : "WHERE embedding IS NULL"}`,
    },
    {
      kind: "mcp",
      table: "mcp_client_servers",
      idCol: "id",
      query: `SELECT id, name, slug, transport, tools_cache FROM mcp_client_servers ${force ? "" : "WHERE embedding IS NULL"}`,
    },
    {
      kind: "webhook",
      table: "webhooks",
      idCol: "id",
      query: `SELECT id, name, slug, category, description FROM webhooks ${force ? "" : "WHERE embedding IS NULL"}`,
    },
    {
      kind: "pack",
      table: "capability_packs",
      idCol: "id",
      query: `SELECT id, name, sector, description, brand_keywords FROM capability_packs ${force ? "" : "WHERE embedding IS NULL"}`,
    },
  ];

  for (const cfg of configs) {
    try {
      const res = await pool.query(cfg.query);
      const rows = res.rows || [];
      if (rows.length === 0) continue;

      const texts = rows.map((r) => buildCapabilityText(cfg.kind, r));
      const vectors = await embed(texts, { batchSize: 32 });

      if (Array.isArray(vectors) && vectors.length === rows.length) {
        for (let i = 0; i < rows.length; i++) {
          const rowId = rows[i][cfg.idCol];
          const vecSql = vectorToSql(vectors[i]);
          if (vecSql) {
            await pool.query(
              `UPDATE ${cfg.table} SET embedding = $1::vector WHERE ${cfg.idCol} = $2`,
              [vecSql, rowId]
            );
            stats[cfg.kind]++;
          }
        }
      }
    } catch (e) {
      console.warn(`[capability-vector] Backfill failed for kind '${cfg.kind}':`, e.message);
    }
  }

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  return { backfilled: stats, total, ms: Date.now() - t0 };
}

/**
 * Updates the vector for a single capability row.
 * @param {object} pool
 * @param {string} kind
 * @param {string} id
 */
export async function updateSingleCapabilityVector(pool, kind, id) {
  if (!id) return false;
  const tableMap = {
    tool: { table: "action_library", idCol: "id", cols: "id, name, category, description, params" },
    skill: { table: "skills", idCol: "id", cols: "id, name, description, instructions" },
    workflow: { table: "workflows", idCol: "id", cols: "id, name, trigger, nodes" },
    chain: { table: "orchestrations", idCol: "id", cols: "id, name, trigger, nodes" },
    agent: { table: "agents", idCol: "id", cols: "id, name, squad, role, description" },
    mcp: { table: "mcp_client_servers", idCol: "slug", cols: "id, name, slug, transport, tools_cache" },
    webhook: { table: "webhooks", idCol: "slug", cols: "id, name, slug, category, description" },
    pack: { table: "capability_packs", idCol: "id", cols: "id, name, sector, description, brand_keywords" },
  };

  const cfg = tableMap[kind];
  if (!cfg) return false;

  try {
    const res = await pool.query(
      `SELECT ${cfg.cols} FROM ${cfg.table} WHERE ${cfg.idCol} = $1 OR id::text = $1 LIMIT 1`,
      [String(id)]
    );
    if (!res.rows[0]) return false;

    const row = res.rows[0];
    const text = buildCapabilityText(kind, row);
    const embs = await embed([text]);
    if (embs?.[0]) {
      const vecSql = vectorToSql(embs[0]);
      await pool.query(
        `UPDATE ${cfg.table} SET embedding = $1::vector WHERE ${cfg.idCol} = $2`,
        [vecSql, row[cfg.idCol]]
      );
      return true;
    }
  } catch (err) {
    console.warn(`[capability-vector] Failed to update vector for ${kind}:${id}:`, err.message);
  }
  return false;
}

/**
 * Searches across all 8 capability tables using pure cosine similarity.
 * @param {object} pool
 * @param {object} params
 * @param {string} params.intent - Operator or agent query string
 * @param {string[]} [params.kinds] - Optional subset of kinds to search
 * @param {number} [params.limit=6] - Max results
 * @param {number} [params.minScore=0.55] - Minimum cosine similarity threshold (0-1)
 * @returns {Promise<Array<{ kind: string, id: string, slug: string, name: string, description: string, score: number }>>}
 */
export async function searchCapabilityVectors(pool, {
  intent,
  kinds = null,
  limit = 6,
  minScore = 0.55,
}) {
  const q = String(intent || "").trim();
  if (!q) return [];

  const embs = await embed([q]);
  if (!embs?.[0]) return [];

  const queryVec = vectorToSql(embs[0]);
  if (!queryVec) return [];

  const allowedKinds = Array.isArray(kinds) && kinds.length > 0
    ? new Set(kinds)
    : new Set(["tool", "skill", "workflow", "chain", "agent", "mcp", "webhook", "pack"]);

  const searches = [];

  if (allowedKinds.has("tool")) {
    searches.push(
      pool.query(
        `SELECT 'tool' AS kind, id, id AS slug, name, description,
                (1 - (embedding <=> $1::vector)) AS score
         FROM action_library
         WHERE embedding IS NOT NULL AND is_system = false
           AND (1 - (embedding <=> $1::vector)) >= $2
         ORDER BY score DESC LIMIT $3`,
        [queryVec, minScore, limit]
      ).catch(() => ({ rows: [] }))
    );
  }

  if (allowedKinds.has("skill")) {
    searches.push(
      pool.query(
        `SELECT 'skill' AS kind, id, id AS slug, name, description,
                (1 - (embedding <=> $1::vector)) AS score
         FROM skills
         WHERE embedding IS NOT NULL AND enabled = true
           AND (1 - (embedding <=> $1::vector)) >= $2
         ORDER BY score DESC LIMIT $3`,
        [queryVec, minScore, limit]
      ).catch(() => ({ rows: [] }))
    );
  }

  if (allowedKinds.has("workflow")) {
    searches.push(
      pool.query(
        `SELECT 'workflow' AS kind, id, id AS slug, name, '' AS description,
                (1 - (embedding <=> $1::vector)) AS score
         FROM workflows
         WHERE embedding IS NOT NULL
           AND (1 - (embedding <=> $1::vector)) >= $2
         ORDER BY score DESC LIMIT $3`,
        [queryVec, minScore, limit]
      ).catch(() => ({ rows: [] }))
    );
  }

  if (allowedKinds.has("chain")) {
    searches.push(
      pool.query(
        `SELECT 'chain' AS kind, id, id AS slug, name, '' AS description,
                (1 - (embedding <=> $1::vector)) AS score
         FROM orchestrations
         WHERE embedding IS NOT NULL
           AND (1 - (embedding <=> $1::vector)) >= $2
         ORDER BY score DESC LIMIT $3`,
        [queryVec, minScore, limit]
      ).catch(() => ({ rows: [] }))
    );
  }

  if (allowedKinds.has("agent")) {
    searches.push(
      pool.query(
        `SELECT 'agent' AS kind, id, id AS slug, name, description,
                (1 - (embedding <=> $1::vector)) AS score
         FROM agents
         WHERE embedding IS NOT NULL AND enabled = true AND id != 'agt.forge_master'
           AND (1 - (embedding <=> $1::vector)) >= $2
         ORDER BY score DESC LIMIT $3`,
        [queryVec, minScore, limit]
      ).catch(() => ({ rows: [] }))
    );
  }

  if (allowedKinds.has("mcp")) {
    searches.push(
      pool.query(
        `SELECT 'mcp' AS kind, id::text AS id, slug, name, '' AS description,
                (1 - (embedding <=> $1::vector)) AS score
         FROM mcp_client_servers
         WHERE embedding IS NOT NULL AND enabled = true
           AND (1 - (embedding <=> $1::vector)) >= $2
         ORDER BY score DESC LIMIT $3`,
        [queryVec, minScore, limit]
      ).catch(() => ({ rows: [] }))
    );
  }

  if (allowedKinds.has("webhook")) {
    searches.push(
      pool.query(
        `SELECT 'webhook' AS kind, id, slug, name, description,
                (1 - (embedding <=> $1::vector)) AS score
         FROM webhooks
         WHERE embedding IS NOT NULL AND enabled = true
           AND (1 - (embedding <=> $1::vector)) >= $2
         ORDER BY score DESC LIMIT $3`,
        [queryVec, minScore, limit]
      ).catch(() => ({ rows: [] }))
    );
  }

  if (allowedKinds.has("pack")) {
    searches.push(
      pool.query(
        `SELECT 'pack' AS kind, id, id AS slug, name, description,
                (1 - (embedding <=> $1::vector)) AS score
         FROM capability_packs
         WHERE embedding IS NOT NULL
           AND (1 - (embedding <=> $1::vector)) >= $2
         ORDER BY score DESC LIMIT $3`,
        [queryVec, minScore, limit]
      ).catch(() => ({ rows: [] }))
    );
  }

  const results = await Promise.all(searches);
  const flat = results.flatMap((r) => r.rows || []);

  // Sort purely by cosine similarity descending
  flat.sort((a, b) => Number(b.score) - Number(a.score));

  return flat.slice(0, limit).map((r) => ({
    kind: r.kind,
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: (r.description || "").slice(0, 120),
    score: Math.round(Number(r.score) * 100) / 100,
  }));
}
