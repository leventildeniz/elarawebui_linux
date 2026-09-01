import path from "path";

export function normalizeAgentRow(r, PORT = 3005) {
  return {
    ...r,
    modelId: r.model_id || "system_default",
    modelRef: r.model_ref,
    runtimePath: r.runtime_path,
    systemPrompt: r.system_prompt,
    bridgeHost: r.bridge_host || "http://localhost",
    port: r.port || "3005",
    healthEndpoint: r.health_endpoint || "/api/health",
    stopGraceMs: r.stop_grace_ms,
    temperature: parseFloat(r.temperature) || 0,
    topP: r.top_p == null ? 0.85 : parseFloat(r.top_p),
    repetitionPenalty: parseFloat(r.repetition_penalty) || 1,
    maxTokens: r.max_tokens,
    contextWindow: r.context_window,
    stopSequences: typeof r.stop_sequences === 'string' ? JSON.parse(r.stop_sequences) : r.stop_sequences,
    customParams: typeof r.custom_params === 'string' ? JSON.parse(r.custom_params) : r.custom_params,
    skills: typeof r.skills === 'string' ? JSON.parse(r.skills) : r.skills,
    tools: typeof r.tools === 'string' ? JSON.parse(r.tools) : r.tools,
    adapters: typeof r.adapters === 'string' ? JSON.parse(r.adapters) : r.adapters,
    targets: typeof r.targets === 'string' ? JSON.parse(r.targets) : r.targets,
    mcpServers: typeof r.mcp_servers === 'string' ? JSON.parse(r.mcp_servers) : (r.mcp_servers || []),
    packs: typeof r.packs === 'string' ? JSON.parse(r.packs) : (r.packs || []),
    ragBrands: typeof r.rag_brands === 'string' ? JSON.parse(r.rag_brands) : r.rag_brands,
    ragKeywords: r.rag_keywords,
    ragSpaceId: r.rag_space_id,
    avatar: typeof r.avatar === 'string' ? JSON.parse(r.avatar) : r.avatar,
    stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats,
    ownerId: r.owner_id,
    visibility: r.visibility,
    sharedWith: typeof r.shared_with === 'string' ? JSON.parse(r.shared_with) : (r.shared_with || []),
  };
}

export async function syncAgentCapabilityPacks(pool, agentId, packIds, invalidatePackFilterCache = () => {}) {
  const clean = [...new Set((packIds || []).map((x) => String(x).trim()).filter(Boolean))];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM agent_capability_packs WHERE agent_id=$1", [agentId]);
    for (const pid of clean) {
      await client.query(
        `INSERT INTO agent_capability_packs(agent_id, pack_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [agentId, pid],
      );
    }
    await client.query(
      `UPDATE agents SET capability_pack_id=$2, updated_at=now() WHERE id=$1`,
      [agentId, clean[0] || null],
    );
    if (clean.length) {
      const { rows: dRows } = await client.query(
        `SELECT default_model, default_interpreter_path FROM capability_packs WHERE id = ANY($1::text[]) ORDER BY array_position($1::text[], id)`,
        [clean],
      );
      const defModel = dRows.map((r) => r.default_model).find((v) => v && String(v).trim()) || null;
      const defInterp = dRows.map((r) => r.default_interpreter_path).find((v) => v && String(v).trim()) || null;
      if (defModel) {
        await client.query(`UPDATE agents SET model=$2, updated_at=now() WHERE id=$1 AND COALESCE(NULLIF(trim(model), ''), '') = ''`, [agentId, defModel]);
      }
      if (defInterp) {
        await client.query(`UPDATE agents SET interpreter_path=$2, updated_at=now() WHERE id=$1 AND COALESCE(NULLIF(trim(interpreter_path), ''), '') = ''`, [agentId, defInterp]);
      }
    }
    await client.query("COMMIT");
    invalidatePackFilterCache(agentId);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

export function createAgentRuntime(deps) {
  const { pool, PORT, invalidatePackFilterCache } = deps;
  return {
    normalizeAgentRow: (r) => normalizeAgentRow(r, PORT),
    syncAgentCapabilityPacks: (id, packs) => syncAgentCapabilityPacks(pool, id, packs, invalidatePackFilterCache),
    // ... other functions can be added here as they are restored
  };
}
