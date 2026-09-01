import { requireSession } from '../session-gate.mjs';

/**
 * Agent Management Routes
 * Handles agents and agent squads.
 */
export async function mountAgentsRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId, enqueueWrite, requireSession } = deps;

  app.get('/api/agents', requireSession(), async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM agents ORDER BY created_at ASC');
      
      const mappedAgents = rows.map(r => ({
        id: r.id,
        name: r.name,
        squad: r.squad,
        role: r.role,
        description: r.description,
        systemPrompt: r.system_prompt,
        modelId: r.model_id || "system_default",
        provider: r.provider || "System Default",
        runtimePath: r.runtime_path || "",
        scriptPath: r.script_path || "",
        bridgeHost: r.bridge_host || "http://localhost",
        port: r.port || "3005",
        healthEndpoint: r.health_endpoint || "/api/health",
        thinking: !!r.thinking,
        enabled: !!r.enabled,
        live: !!r.live,
        priority: r.priority,
        stopGraceMs: r.stop_grace_ms,
        temperature: parseFloat(r.temperature) || 0,
        topP: r.top_p == null ? 0.85 : parseFloat(r.top_p),
        repetitionPenalty: parseFloat(r.repetition_penalty) || 1,
        maxTokens: r.max_tokens,
        contextWindow: r.context_window,
        stopSequences: r.stop_sequences || [],
        skills: r.skills || [],
        tools: r.tools || [],
        adapters: r.adapters || [],
        targets: r.targets || [],
        mcpServers: r.mcp_servers || [],
        packs: r.packs || [],
        rag: !!r.rag,
        ragBrands: r.rag_brands || [],
        ragKeywords: r.rag_keywords || "",
        icon: r.icon || "Bot",
        avatar: r.avatar || { seed: r.id, style: "prism", jewel: "sapphire" },
        stats: r.stats || { calls: 0, success: 100, latencyMs: 0 },
        createdAt: new Date(r.created_at).getTime(),
        ownerId: r.owner_id,
        ownerName: r.owner_name,
        visibility: r.visibility,
        sharedWith: r.shared_with || [],
      }));

      res.json(mappedAgents);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'internal_error', message: e.message });
    }
  });

  app.post('/api/agents', requireSession({ roles: ['admin', 'engineer'] }), async (req, res) => {
    const id = req.body.id || createPrefixedId("agt.");
    const a = req.body;
    try {
      await pool.query(
        `INSERT INTO agents (
          id, name, squad, role, description, system_prompt, model_id, provider, runtime_path, script_path,
          bridge_host, port, health_endpoint, thinking, enabled, live, priority, stop_grace_ms, temperature,
          top_p, repetition_penalty, max_tokens, context_window, stop_sequences, skills, tools, adapters, targets,
          rag, rag_brands, rag_keywords, icon, avatar, stats, owner_id, owner_name, visibility, shared_with
         ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
          $23, $24::jsonb, $25::jsonb, $26::jsonb, $27::jsonb, $28::jsonb, $29, $30::jsonb, $31, $32, $33::jsonb,
          $34::jsonb, $35, $36, $37, $38::jsonb
         )`,
        [
          id, a.name, a.squad || "Unassigned", a.role || "Operator", a.description || "", a.systemPrompt || "",
          a.modelId || null, a.provider || "", a.runtimePath || "", a.scriptPath || "", a.bridgeHost || "",
          a.port || "", a.healthEndpoint || "", !!a.thinking, a.enabled !== false, !!a.live, a.priority || 5,
          a.stopGraceMs || 5000, a.temperature || 0.2, a.topP || 0.85, a.repetitionPenalty || 1.25,
          a.maxTokens || 4096, a.contextWindow || 8192, JSON.stringify(a.stopSequences || []),
          JSON.stringify(a.skills || []), JSON.stringify(a.tools || []), JSON.stringify(a.adapters || []),
          JSON.stringify(a.targets || []), !!a.rag, JSON.stringify(a.ragBrands || []), a.ragKeywords || "",
          a.icon || "Bot", JSON.stringify(a.avatar || {}), JSON.stringify(a.stats || { calls: 0, success: 100, latencyMs: 0 }),
          a.ownerId || null, a.ownerName || null, a.visibility || "workspace", JSON.stringify(a.sharedWith || [])
        ]
      );
      res.status(201).json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'internal_error', message: e.message });
    }
  });

  app.put('/api/agents/:id', requireSession({ roles: ['admin', 'engineer'] }), async (req, res) => {
    const id = req.params.id;
    const a = req.body;
    
    const updates = [];
    const values = [];
    let i = 1;

    const scalarFields = {
      name: 'name', squad: 'squad', role: 'role', description: 'description', systemPrompt: 'system_prompt',
      modelId: 'model_id', provider: 'provider', runtimePath: 'runtime_path', scriptPath: 'script_path',
      bridgeHost: 'bridge_host', port: 'port', healthEndpoint: 'health_endpoint', thinking: 'thinking',
      enabled: 'enabled', live: 'live', priority: 'priority', stopGraceMs: 'stop_grace_ms',
      temperature: 'temperature', topP: 'top_p', repetitionPenalty: 'repetition_penalty', maxTokens: 'max_tokens',
      contextWindow: 'context_window', rag: 'rag', ragKeywords: 'rag_keywords', icon: 'icon',
      ownerId: 'owner_id', ownerName: 'owner_name', visibility: 'visibility'
    };

    const jsonFields = {
      stopSequences: 'stop_sequences', skills: 'skills', tools: 'tools', adapters: 'adapters',
      targets: 'targets', ragBrands: 'rag_brands', avatar: 'avatar', stats: 'stats', sharedWith: 'shared_with',
      mcpServers: 'mcp_servers', packs: 'packs'
    };

    for (const [uiKey, dbKey] of Object.entries(scalarFields)) {
      if (a[uiKey] !== undefined) {
        updates.push(`${dbKey}=$${i++}`);
        values.push(a[uiKey]);
      }
    }

    for (const [uiKey, dbKey] of Object.entries(jsonFields)) {
      if (a[uiKey] !== undefined) {
        updates.push(`${dbKey}=$${i++}::jsonb`);
        values.push(JSON.stringify(a[uiKey]));
      }
    }

    if (updates.length > 0) {
      updates.push(`updated_at=now()`);
      values.push(id);
      try {
        await pool.query(`UPDATE agents SET ${updates.join(", ")} WHERE id=$${i}`, values);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ ok: false, error: 'internal_error', message: e.message });
      }
    } else {
      res.json({ ok: true });
    }
  });

  app.delete('/api/agents/:id', requireSession({ roles: ['admin', 'engineer'] }), async (req, res) => {
    try {
      await pool.query('DELETE FROM agents WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'internal_error', message: e.message });
    }
  });
}
