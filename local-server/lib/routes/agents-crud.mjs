// Tur 2A — Agents CRUD + lifecycle + capabilities
// Extracted from server.mjs (was lines 15951-16206).
// Wires 10 handlers via mountAgentsCrudRoutes(app, deps).

export function mountAgentsCrudRoutes(app, deps) {
  const {
    pool,
    resolveActorContext,
    resolveActor,
    buildVisibility,
    normalizeAgentRow,
    createPrefixedId,
    encryptSecret,
    setAgentArmedState,
    syncAgentCapabilityPacks,
    readAgentCapabilityPacks,
    invalidateAgentBrandCache,
  } = deps;

  app.get("/api/agents", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      const vis = buildVisibility(ctx);
      const whereParts = [vis.clause ? `(${vis.clause})` : null, `a.id != 'agt.forge_master'`].filter(Boolean);
      const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT a.*,
                COALESCE(
                  (SELECT array_agg(acp.pack_id ORDER BY acp.pack_id)
                     FROM agent_capability_packs acp
                    WHERE acp.agent_id = a.id),
                  ARRAY[]::text[]
                ) AS capability_pack_ids
           FROM agents a
           ${whereSql}
          ORDER BY a.name`,
        vis.params,
      );
      res.json(rows.map(normalizeAgentRow));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/agents/:id/activate", async (req, res) => {
    const id = req.params.id;
    try {
      const result = await setAgentArmedState(id, true);
      res.status(result.httpStatus).json(result.body);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/agents", async (req, res) => {
    const a = req.body ?? {};
    const id = String(a.id || createPrefixedId("ag_")).trim();
    const name = String(a.name ?? "agent").trim();
    if (!id || !name) return res.status(400).json({ ok: false, error: "id/name required" });

    const owner = await resolveActor(req);

    try {
      await pool.query(
        `INSERT INTO agents(
           id, name, squad, role, description, system_prompt, model_id, model_ref, provider,
           runtime_path,
           thinking, enabled, live, priority, stop_grace_ms,
           temperature, top_p, repetition_penalty, max_tokens, context_window, stop_sequences, custom_params,
           skills, tools, adapters, targets,
           mcp_servers, packs,
           rag, rag_brands, rag_keywords, rag_space_id,
           icon, avatar, stats, owner_id, owner_name, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10,
           $11, $12, $13, $14, $15,
           $16, $17, $18, $19, $20, $21, $22,
           $23, $24, $25, $26,
           $35, $36,
           $27, $28, $29, $30,
           $31, $32, $33, $34, $37, now()
         ) ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, squad=EXCLUDED.squad, role=EXCLUDED.role, description=EXCLUDED.description,
           system_prompt=EXCLUDED.system_prompt, model_id=EXCLUDED.model_id, model_ref=EXCLUDED.model_ref, provider=EXCLUDED.provider,
           runtime_path=EXCLUDED.runtime_path,
           thinking=EXCLUDED.thinking, enabled=EXCLUDED.enabled, live=EXCLUDED.live, priority=EXCLUDED.priority, stop_grace_ms=EXCLUDED.stop_grace_ms,
           temperature=EXCLUDED.temperature, top_p=EXCLUDED.top_p, repetition_penalty=EXCLUDED.repetition_penalty,
           max_tokens=EXCLUDED.max_tokens, context_window=EXCLUDED.context_window, stop_sequences=EXCLUDED.stop_sequences, custom_params=EXCLUDED.custom_params,
           skills=EXCLUDED.skills, tools=EXCLUDED.tools, adapters=EXCLUDED.adapters, targets=EXCLUDED.targets,
           mcp_servers=EXCLUDED.mcp_servers, packs=EXCLUDED.packs,
           rag=EXCLUDED.rag, rag_brands=EXCLUDED.rag_brands, rag_keywords=EXCLUDED.rag_keywords, rag_space_id=EXCLUDED.rag_space_id,
           icon=EXCLUDED.icon, avatar=EXCLUDED.avatar,
           owner_id=COALESCE(agents.owner_id, EXCLUDED.owner_id),
           owner_name=COALESCE(agents.owner_name, EXCLUDED.owner_name),
           updated_at=now()`,
        [
          id, name,
          String(a.squad || "Unassigned"),
          String(a.role || "Operator"),
          String(a.description || ""),
          String(a.systemPrompt || ""),
          a.modelId === "system_default" ? null : (a.modelId || null),
          a.modelRef || null,
          a.provider || null,
          a.runtimePath || null,
          !!a.thinking,
          a.enabled !== false,
          a.live !== false,
          Number(a.priority || 5),
          Number(a.stopGraceMs || 5000),
          Number(a.temperature || 0.2),
          Number(a.topP || 0.85),
          Number(a.repetitionPenalty || 1.25),
          Number(a.maxTokens || 4096),
          Number(a.contextWindow || 8192),
          JSON.stringify(a.stopSequences || []),
          JSON.stringify(a.customParams || []),
          JSON.stringify(a.skills || []),
          JSON.stringify(a.tools || []),
          JSON.stringify(a.adapters || []),
          JSON.stringify(a.targets || []),
          !!a.rag,
          JSON.stringify(a.ragBrands || []),
          String(a.ragKeywords || ""),
          a.ragSpaceId || null,
          String(a.icon || "Bot"),
          JSON.stringify(a.avatar || {}),
          JSON.stringify(a.stats || { calls: 0, success: 100, latencyMs: 0 }),
          a.ownerId || a.owner_id || owner,
          JSON.stringify(a.mcpServers ?? a.mcpClients ?? []),
          JSON.stringify(a.packs || []),
          a.ownerName || a.owner_name || null
        ]
      );
      
      const sq = String(a.squad || "").trim();
      if (sq && sq !== "Unassigned") {
        await pool.query("INSERT INTO agent_squads (name) VALUES ($1) ON CONFLICT DO NOTHING", [sq]);
      }

      // Sync agent_capabilities table for tools and skills
      if (a.tools && Array.isArray(a.tools)) {
        for (const t of a.tools) {
           await pool.query("INSERT INTO agent_capabilities(agent_id, kind, ref_id) VALUES ($1,'tool',$2) ON CONFLICT DO NOTHING", [id, t]);
        }
      }
      if (a.skills && Array.isArray(a.skills)) {
        for (const s of a.skills) {
           await pool.query("INSERT INTO agent_capabilities(agent_id, kind, ref_id) VALUES ($1,'skill',$2) ON CONFLICT DO NOTHING", [id, s]);
        }
      }

      res.json({ ok: true, id });
    } catch (e) {
      console.error("[POST /api/agents] error:", e.message);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/agents/:id", async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (id === "agt.forge_master" || id.startsWith("sys.")) {
      return res.status(403).json({ error: "System infrastructure agents cannot be deleted." });
    }
    try { await pool.query("DELETE FROM agents WHERE id=$1", [id]); res.status(204).end(); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.put("/api/agents/:id", async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "id required" });
    if (id === "agt.forge_master" || id.startsWith("sys.")) {
      return res.status(403).json({ error: "System infrastructure agents cannot be modified directly via user CRUD." });
    }
    const a = req.body ?? {};
    try {
      const cur = await pool.query("SELECT * FROM agents WHERE id=$1", [id]);
      if (!cur.rows.length) return res.status(404).json({ ok: false, error: `agent ${id} not found` });

      await pool.query(
        `UPDATE agents SET
           name=COALESCE($2, name),
           squad=COALESCE($3, squad),
           role=COALESCE($4, role),
           description=COALESCE($5, description),
           system_prompt=COALESCE($6, system_prompt),
           model_id=$7,
           model_ref=COALESCE($8, model_ref),
           provider=COALESCE($9, provider),
           runtime_path=COALESCE($10, runtime_path),
           thinking=COALESCE($11, thinking),
           enabled=COALESCE($12, enabled),
           live=COALESCE($13, live),
           priority=COALESCE($14, priority),
           stop_grace_ms=COALESCE($15, stop_grace_ms),
           temperature=COALESCE($16, temperature),
           top_p=COALESCE($17, top_p),
           repetition_penalty=COALESCE($18, repetition_penalty),
           max_tokens=COALESCE($19, max_tokens),
           context_window=COALESCE($20, context_window),
           stop_sequences=COALESCE($21::jsonb, stop_sequences),
           custom_params=COALESCE($22::jsonb, custom_params),
           skills=COALESCE($23::jsonb, skills),
           tools=COALESCE($24::jsonb, tools),
           adapters=COALESCE($25::jsonb, adapters),
           targets=COALESCE($26::jsonb, targets),
           mcp_servers=COALESCE($33::jsonb, mcp_servers),
           packs=COALESCE($34::jsonb, packs),
           rag=COALESCE($27, rag),
           rag_brands=COALESCE($28::jsonb, rag_brands),
           rag_keywords=COALESCE($29, rag_keywords),
           rag_space_id=COALESCE($30, rag_space_id),
           icon=COALESCE($31, icon),
           avatar=COALESCE($32::jsonb, avatar),
           visibility=COALESCE($35::visibility_level, visibility),
           shared_with=COALESCE($36::jsonb, shared_with),
           updated_at=now()
         WHERE id=$1`,
        [
          id,
          a.name,
          a.squad !== undefined ? a.squad : null,
          a.role,
          a.description,
          a.systemPrompt,
          a.modelId === "system_default" ? null : (a.modelId !== undefined ? a.modelId : cur.rows[0].model_id),
          a.modelRef,
          a.provider,
          a.runtimePath,
          a.thinking,
          a.enabled,
          a.live,
          a.priority,
          a.stopGraceMs,
          a.temperature,
          a.topP,
          a.repetitionPenalty,
          a.maxTokens,
          a.contextWindow,
          a.stopSequences !== undefined ? JSON.stringify(a.stopSequences) : null,
          a.customParams !== undefined ? JSON.stringify(a.customParams) : null,
          a.skills !== undefined ? JSON.stringify(a.skills) : null,
          a.tools !== undefined ? JSON.stringify(a.tools) : null,
          a.adapters !== undefined ? JSON.stringify(a.adapters) : null,
          a.targets !== undefined ? JSON.stringify(a.targets) : null,
          a.rag,
          a.ragBrands !== undefined ? JSON.stringify(a.ragBrands) : null,
          a.ragKeywords,
          a.ragSpaceId,
          a.icon,
          a.avatar !== undefined ? JSON.stringify(a.avatar) : null,
          (a.mcpServers !== undefined || a.mcpClients !== undefined) ? JSON.stringify(a.mcpServers || a.mcpClients) : null,
          a.packs !== undefined ? JSON.stringify(a.packs) : null,
          a.visibility !== undefined ? a.visibility : null,
          a.sharedWith !== undefined ? JSON.stringify(a.sharedWith) : null
        ]
      );

      if (a.squad && a.squad !== "Unassigned") {
        await pool.query("INSERT INTO agent_squads (name) VALUES ($1) ON CONFLICT DO NOTHING", [String(a.squad).trim()]);
      }

      // Sync agent_capabilities table for tools and skills
      if (a.tools !== undefined || a.skills !== undefined) {
        await pool.query("DELETE FROM agent_capabilities WHERE agent_id=$1", [id]);
        const toolsToInsert = a.tools !== undefined ? a.tools : (cur.rows[0].tools || []);
        const skillsToInsert = a.skills !== undefined ? a.skills : (cur.rows[0].skills || []);
        for (const t of toolsToInsert) {
           await pool.query("INSERT INTO agent_capabilities(agent_id, kind, ref_id) VALUES ($1,'tool',$2) ON CONFLICT DO NOTHING", [id, t]);
        }
        for (const s of skillsToInsert) {
           await pool.query("INSERT INTO agent_capabilities(agent_id, kind, ref_id) VALUES ($1,'skill',$2) ON CONFLICT DO NOTHING", [id, s]);
        }
      }

      const { rows } = await pool.query("SELECT * FROM agents WHERE id=$1", [id]);
      const normalized = normalizeAgentRow(rows[0]);
      res.json({ ok: true, agent: normalized });
    } catch (e) {
      console.error("[PUT /api/agents] error:", e.message);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/agents/:id/deactivate", async (req, res) => {
    try {
      const result = await setAgentArmedState(req.params.id, false);
      res.status(result.httpStatus).json(result.body);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/agents/:id/toggle", async (req, res) => {
    const id = req.params.id;
    try {
      const { rows } = await pool.query("SELECT status, bridge_url FROM agents WHERE id=$1", [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: `agent ${id} not found` });
      const targetActive = typeof req.body?.enabled === "boolean" ? req.body.enabled : rows[0].status !== "active";
      const result = await setAgentArmedState(id, targetActive);
      res.status(result.httpStatus).json(result.body);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.get("/api/agents/:id/capabilities", async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT kind, ref_id FROM agent_capabilities WHERE agent_id=$1 ORDER BY kind, ref_id",
        [req.params.id],
      );
      const skill_ids = rows.filter((r) => r.kind === "skill").map((r) => r.ref_id);
      const tool_ids  = rows.filter((r) => r.kind === "tool").map((r) => r.ref_id);
      res.json({ ok: true, skill_ids, tool_ids });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/agents/:id/capabilities", async (req, res) => {
    const id = String(req.params.id);
    const skill_ids = Array.isArray(req.body?.skill_ids) ? req.body.skill_ids.map(String) : [];
    const tool_ids  = Array.isArray(req.body?.tool_ids)  ? req.body.tool_ids.map(String)  : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM agent_capabilities WHERE agent_id=$1", [id]);
      for (const ref of skill_ids) {
        await client.query(
          "INSERT INTO agent_capabilities(agent_id, kind, ref_id) VALUES ($1,'skill',$2) ON CONFLICT DO NOTHING",
          [id, ref],
        );
      }
      for (const ref of tool_ids) {
        await client.query(
          "INSERT INTO agent_capabilities(agent_id, kind, ref_id) VALUES ($1,'tool',$2) ON CONFLICT DO NOTHING",
          [id, ref],
        );
      }
      await client.query("COMMIT");
      res.json({ ok: true, skill_ids, tool_ids });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => void 0);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally { client.release(); }
  });
}
