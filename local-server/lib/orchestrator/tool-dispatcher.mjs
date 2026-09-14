// local-server/lib/orchestrator/tool-dispatcher.mjs
// Central Tool Dispatcher & Execution Bridge for ELARA Sovereign Studio.
// Handles directory discovery, agentic RAG sub-delegation, tool invocations, and MetaForge synthesis with self-healing retry.

import { ragProbeAndFetch } from "../rag/retrieval.mjs";
import { buildInventory, extractForgeJson, validateForgePlan } from "../meta-forge/planner.mjs";
import { ensureMetaForgeAgent } from "../meta-forge/seed.mjs";
import { resolveCredential } from "../vault.mjs";
import { streamFromProvider } from "./stream-bridge.mjs";

export async function dispatchToolCall({
  toolCall,
  parsedArgs,
  deps,
  context,
}) {
  const { pool, buildVisibility, invokeTool } = deps;
  const {
    actorCtx,
    actorId,
    req,
    thread_id,
    agent_id,
    web_search,
    prov,
    finalProviderUsed,
    requestAbort,
    send,
    emitDebug,
  } = context;

  const realToolId = toolCall.function.name;
  let toolResultStr = "";
  let toolStatus = "completed";

  // 1. DIRECTORY DISCOVERY
  if (realToolId === "sys_get_directory") {
    const { clause: agtClause, params: agtParams } = buildVisibility(actorCtx, 1, "owner_id");
    const { clause: actClause, params: actParams } = buildVisibility(actorCtx, 1, "owner_user_id");
    const { clause: skillClause, params: skillParams } = buildVisibility(actorCtx, 1, "owner_id");
    const { clause: wfClause, params: wfParams } = buildVisibility(actorCtx, 1, "owner_id");
    const { clause: orcClause, params: orcParams } = buildVisibility(actorCtx, 1, "owner_id");
    const { clause: whClause, params: whParams } = buildVisibility(actorCtx, 1, "owner_id");

    const [agtRes, actRes, skillRes, wfRes, orcRes, whRes, mcpRes] = await Promise.all([
      pool.query(`SELECT id, name, squad, description FROM agents WHERE ${agtClause}`, agtParams),
      pool.query(`SELECT id, name, category, description, params FROM action_library WHERE (${actClause}) AND is_system = false AND COALESCE((runtime->>'orphan')::boolean, false) = false`, actParams),
      pool.query(`SELECT id, name, description, params FROM skills WHERE enabled = true AND (${skillClause})`, skillParams),
      pool.query(`SELECT id, name, trigger, status FROM workflows WHERE ${wfClause} ORDER BY updated_at DESC`, wfParams),
      pool.query(`SELECT id, name, trigger, status FROM orchestrations WHERE ${orcClause} ORDER BY created_at DESC`, orcParams),
      pool.query(`SELECT id, name, slug, description, category, connection, enabled FROM webhooks WHERE enabled = true AND (${whClause}) ORDER BY created_at DESC`, whParams).catch(() => ({ rows: [] })),
      pool.query(`SELECT slug, name, tools_cache FROM mcp_client_servers WHERE enabled = true`).catch(() => ({ rows: [] })),
    ]);

    const standardTools = actRes.rows.map((t) => {
      let pKeys = [];
      try {
        const p = typeof t.params === "string" ? JSON.parse(t.params) : t.params;
        pKeys = Array.isArray(p) ? p.map((x) => x.name || x.key || x.id) : p && typeof p === "object" ? Object.keys(p.properties || p) : [];
      } catch (e) {}
      return { id: t.id, name: t.name, desc: (t.description || "").slice(0, 120), params: pKeys };
    });

    const skillsList = skillRes.rows.map((s) => {
      let pKeys = [];
      try {
        const p = typeof s.params === "string" ? JSON.parse(s.params) : s.params;
        pKeys = Array.isArray(p) ? p.map((x) => x.name || x.key || x.id) : p && typeof p === "object" ? Object.keys(p.properties || p) : [];
      } catch (e) {}
      return { id: s.id, name: s.name, desc: (s.description || "").slice(0, 120), params: pKeys };
    });

    const mcpTools = [];
    for (const server of mcpRes.rows) {
      const tools = Array.isArray(server.tools_cache) ? server.tools_cache : [];
      for (const t of tools) {
        mcpTools.push({
          id: `mcp.${server.slug}.${t.name}`,
          name: `[MCP: ${server.name}] ${t.name}`,
          desc: (t.description || "").slice(0, 120),
          params: t.inputSchema?.properties ? Object.keys(t.inputSchema.properties) : [],
        });
      }
    }

    if (web_search) {
      standardTools.push({
        id: "sys_web_search",
        name: "Live Web Search",
        desc: "Performs a live internet search using DuckDuckGo to get up-to-date information, news, dates, and facts.",
        params: ["query"],
      });
    }

    toolResultStr = JSON.stringify({
      agents: agtRes.rows.map((a) => ({ id: a.id, name: a.name, squad: a.squad, desc: (a.description || "").slice(0, 120) })),
      tools: [...standardTools, ...skillsList, ...mcpTools],
      workflows: wfRes.rows.map((w) => ({ id: w.id, name: w.name, trigger: w.trigger, status: w.status })),
      orchestrations: orcRes.rows.map((o) => ({ id: o.id, name: o.name, trigger: o.trigger, status: o.status })),
      webhooks: whRes.rows.map((w) => ({ id: w.id, name: w.name, slug: w.slug, description: (w.description || "").slice(0, 120) })),
      message: "Directory loaded. Contains available agents, tools, skills, MCP servers, workflows, orchestrations, and webhooks.",
    });
  }

  // 2. SUB-AGENT DELEGATION (WITH AGENTIC RAG)
  else if (realToolId === "sys_delegate_to_agent") {
    const targetAgentId = parsedArgs.agent_id;
    const targetInstructions = parsedArgs.instructions;

    const { clause: agtClause, params: agtParams } = buildVisibility(actorCtx, 2, "owner_id");
    const agtRow = await pool.query(
      `SELECT id, name, system_prompt, rag, rag_space_id, rag_brands, rag_keywords FROM agents WHERE id = $1 AND (${agtClause})`,
      [targetAgentId, ...agtParams]
    );

    if (agtRow.rows.length === 0) {
      toolResultStr = JSON.stringify({ error: `Agent ${targetAgentId} not found or you do not have permission to access it.` });
      toolStatus = "failed";
    } else {
      const subAgent = agtRow.rows[0];
      const subMessages = [
        { role: "system", content: subAgent.system_prompt || "You are an expert sub-agent." },
        { role: "user", content: targetInstructions },
      ];

      // Agentic RAG implementation
      if (subAgent.rag) {
        try {
          let spaceFileIds = null;
          if (subAgent.rag_space_id) {
            const spaceSrcRes = await pool.query(`SELECT id::text FROM knowledge_sources WHERE space_id = $1`, [subAgent.rag_space_id]);
            spaceFileIds = spaceSrcRes.rows.map((r) => r.id);
          }

          const parsedKeywords = subAgent.rag_keywords ? subAgent.rag_keywords.split(",").map((k) => k.trim()).filter(Boolean) : [];

          if (typeof emitDebug === "function") {
            emitDebug("debug", "rag.search.start", `probing knowledge space for sub-agent ${subAgent.name || subAgent.id}`, { agent_id: subAgent.id, stream: "rag" }, thread_id);
          }

          const ragOut = await ragProbeAndFetch({
            q: targetInstructions,
            allowedLevels: null,
            agentId: subAgent.id,
            bindingFileIds: spaceFileIds,
            bindingBrands: Array.isArray(subAgent.rag_brands) ? subAgent.rag_brands : [],
            agentKeywords: parsedKeywords,
            caller: "agentic-rag",
          });

          if (ragOut && ragOut.rows && ragOut.rows.length > 0) {
            if (typeof emitDebug === "function") {
              emitDebug("info", "rag.search.done", `retrieved ${ragOut.rows.length} chunks · top1=${ragOut.top1 || 0} · ${ragOut.stages?.totalMs || 0}ms`, { hits: ragOut.rows.length, top1: ragOut.top1, ms: ragOut.stages?.totalMs || 0, stream: "rag" }, thread_id);
            }
            let ragText = "[RAG KNOWLEDGE]\nHere is context retrieved from the organization's knowledge base:\n\n";
            ragOut.rows.forEach((r) => {
              ragText += `--- SOURCE: ${r.path || "unknown"} ---\n${r.content}\n\n`;
            });
            subMessages.push({ role: "system", content: ragText });

            send({
              rag: {
                sources: ragOut.rows.map((r, i) => ({
                  index: i + 1,
                  name: r.path ? r.path.split("/").pop() : "chunk",
                  path: r.path,
                  ord: r.ord ?? 0,
                  score: Math.round(Math.min(1, Number(r.score) || 0) * 100),
                })),
                debug: {
                  queryClean: targetInstructions,
                  probe: {
                    top1: ragOut.top1 || 0,
                    ms: ragOut.stages?.totalMs || 0,
                  },
                },
                reranker: ragOut.reranker || { used: false },
                fallback: { brands: Array.isArray(subAgent.rag_brands) ? subAgent.rag_brands : [] },
              },
            });

            const principalName = actorCtx?.username || actorCtx?.user?.name || req?.session?.username || "admin";
            const pId = actorCtx?.userId || actorId || "admin";
            const qId = `rq.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}`;
            const uniqueDocs = new Set(ragOut.rows.map((r) => r.path)).size;

            pool.query(
              `INSERT INTO rag_queries (id, at, query, principal, principal_id, agent, spaces, blocked, docs, chunks, hit)
               VALUES ($1, now(), $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
              [
                qId,
                targetInstructions,
                principalName,
                pId,
                subAgent.name || subAgent.id || "Sub-Agent",
                JSON.stringify(subAgent.rag_space_id ? [subAgent.rag_space_id] : Array.isArray(subAgent.rag_brands) ? subAgent.rag_brands : []),
                0,
                uniqueDocs,
                ragOut.rows.length,
                true,
              ]
            ).catch((err) => console.warn("[RAG Telemetry] Failed to log query:", err.message));
          }
        } catch (ragError) {
          console.error(`[Orchestrate] Agentic RAG failed for agent ${subAgent.id}:`, ragError);
        }
      }

      const subIt = await streamFromProvider({
        provider: prov,
        messages: subMessages,
        tools: undefined,
        signal: requestAbort.signal,
        effort: "low",
        pool,
      });

      let subAnswer = "";
      for await (const chunk of subIt) {
        try {
          const parsed = JSON.parse(chunk);
          if (parsed.type === "out") subAnswer += parsed.delta || "";
        } catch (e) {}
      }

      if (!subAnswer || subAnswer.trim() === "") {
        subAnswer = "[SYSTEM_WARNING: AGENT_FAILED_OR_EMPTY] The sub-agent returned no useful data. You MUST explicitly inform the user that the delegation failed.";
        toolStatus = "failed";
      }

      toolResultStr = JSON.stringify({
        agent: subAgent.name,
        result: subAnswer,
      });
    }
  }

  // 3. EXECUTE TOOL / MCP / SKILL
  else if (realToolId === "sys_execute_tool") {
    const targetToolId = parsedArgs.tool_id || "";
    const targetParams = parsedArgs.params || {};

    let canonicalId = targetToolId;
    let isAllowed = false;

    const normalizedId = targetToolId.replace(/^(skill_|tool_|sk_|skill\.|tool\.|sk\.)+/gi, "").replace(/_/g, "-");
    const dotId = targetToolId.replace(/^(skill_|tool_|sk_)+/gi, "").replace(/_/g, ".");

    let isMcp = targetToolId.startsWith("mcp.") || dotId.startsWith("mcp.");
    let serverSlug = "";
    if (isMcp) {
      const cleanMcp = (targetToolId.startsWith("mcp.") ? targetToolId : dotId).slice(4);
      serverSlug = cleanMcp.split(".")[0];
      canonicalId = `mcp.${cleanMcp}`;
    } else if (targetToolId.includes(".") || dotId.includes(".")) {
      const firstPart = (targetToolId.includes(".") ? targetToolId : dotId).split(".")[0];
      const mcpServerCheck = await pool.query(`SELECT slug FROM mcp_client_servers WHERE slug = $1 AND enabled = true`, [firstPart]);
      if (mcpServerCheck.rows.length > 0) {
        isMcp = true;
        serverSlug = firstPart;
        canonicalId = `mcp.${dotId}`;
      }
    }

    if (isMcp) {
      const mcpRow = await pool.query(`SELECT id FROM mcp_client_servers WHERE slug = $1 AND enabled = true`, [serverSlug]);
      if (mcpRow.rows.length > 0) isAllowed = true;
    } else {
      const possibleSkillIds = [targetToolId, `sk.${normalizedId}`, `sk.${targetToolId}`, normalizedId, dotId];
      const { clause: skillClause, params: skillParams } = buildVisibility(actorCtx, 2, "owner_id");
      const skillRow = await pool.query(
        `SELECT id FROM skills WHERE id = ANY($1) AND enabled = true AND (${skillClause})`,
        [possibleSkillIds, ...skillParams]
      );
      if (skillRow.rows.length > 0) {
        isAllowed = true;
        canonicalId = skillRow.rows[0].id;
      } else {
        const possibleToolIds = [targetToolId, `tool.${normalizedId}`, `tool.${dotId}`, normalizedId, dotId];
        const { clause: actClause, params: actParams } = buildVisibility(actorCtx, 2, "owner_user_id");
        const toolRow = await pool.query(
          `SELECT id FROM action_library WHERE (id = ANY($1) OR name = ANY($1)) AND (${actClause}) AND is_system = false AND COALESCE((runtime->>'orphan')::boolean, false) = false`,
          [possibleToolIds, ...actParams]
        );
        if (toolRow.rows.length > 0) {
          isAllowed = true;
          canonicalId = toolRow.rows[0].id;
        }
      }
    }

    if (!isAllowed) {
      toolResultStr = JSON.stringify({ error: `Tool/MCP/Skill '${targetToolId}' not found, missing from disk (orphan), or permission denied.` });
      toolStatus = "failed";
    } else {
      const invokeRes = await invokeTool({
        toolId: canonicalId,
        params: targetParams,
        sessionId: thread_id,
        agentId: agent_id,
        provider: finalProviderUsed || prov,
      });

      let outputRes = invokeRes.output ?? invokeRes;
      if (!outputRes || (typeof outputRes === "string" && outputRes.trim() === "") || (Array.isArray(outputRes) && outputRes.length === 0)) {
        outputRes = "[SYSTEM_WARNING: TOOL_FAILED_OR_EMPTY] The execution returned no useful data. You MUST explicitly inform the user that it failed.";
        toolStatus = "failed";
      }
      toolResultStr = JSON.stringify(outputRes);
      if (toolResultStr.length > 20000) {
        const originalLen = toolResultStr.length;
        const sample = toolResultStr.slice(0, 18000);
        toolResultStr = `${sample}\n\n[SYSTEM NOTE: Output truncated from ${originalLen} chars to fit context safely. Summarize the findings based on the provided sample.]`;
      }
    }
  }

  // 4. METAFORGE SYNTHESIS WITH SELF-HEALING RETRY
  else if (realToolId === "sys_delegate_to_metaforge") {
    const intentText = parsedArgs.intent;
    send({ type: "tool_status", name: "sys_delegate_to_metaforge", status: "running", detail: "Synthesizing DAG plan..." });
    send({ phase: "meta_forge_planning", stage: "spawn" });

    let inventory = { agents: [], tools: [], skills: [], packs: [], counts: {} };
    try {
      inventory = await buildInventory(pool);
    } catch (invErr) {
      console.warn("meta_forge inventory error:", invErr);
    }

    let forgeAgentRes = await pool.query(`SELECT id, system_prompt FROM agents WHERE id = 'agt.forge_master' LIMIT 1`);
    if (forgeAgentRes.rows.length === 0 || !forgeAgentRes.rows[0].system_prompt.includes("ORCHESTRATION CHAIN & WORKFLOW ARCHITECTURAL INVARIANTS")) {
      try {
        await ensureMetaForgeAgent(pool);
        forgeAgentRes = await pool.query(`SELECT id, system_prompt FROM agents WHERE id = 'agt.forge_master' LIMIT 1`);
      } catch (e) {
        console.warn("Failed to ensure forge_master:", e.message);
      }
    }

    if (forgeAgentRes.rows.length === 0) {
      toolResultStr = JSON.stringify({ error: "MetaForge master agent (agt.forge_master) not found in the system." });
      toolStatus = "failed";
    } else {
      const forgeSysPrompt =
        (forgeAgentRes.rows[0].system_prompt || "You are MetaForge. Output valid JSON.") +
        "\n\nCRITICAL INSTRUCTION: Output ONLY a valid JSON object. Do NOT include ANY text, markdown, or code fences before or after the JSON. Start your response with { and end with }.";

      const forgeMessages = [
        { role: "system", content: forgeSysPrompt },
        {
          role: "user",
          content: `System Inventory:\n${JSON.stringify(inventory, null, 2)}\n\nGoal:\n${intentText}\n\nOutput a valid JSON containing a 'plan' object with 'create' and/or 'reuse' arrays. DO NOT USE MARKDOWN BLOCKS.`,
        },
      ];

      const forgeProv = finalProviderUsed || prov;

      if (!forgeProv) {
        toolResultStr = JSON.stringify({ error: "No provider found for MetaForge." });
        toolStatus = "failed";
      } else {
        const subIt = await streamFromProvider({
          provider: forgeProv,
          messages: forgeMessages,
          tools: undefined,
          signal: requestAbort.signal,
          effort: "none",
          pool,
        });

        let subAnswer = "";
        for await (const chunk of subIt) {
          try {
            const parsed = JSON.parse(chunk);
            if (parsed.type === "out") subAnswer += parsed.delta || "";
          } catch (e) {
            subAnswer += chunk;
          }
        }

        console.log(`[MetaForge] Output:\n${subAnswer}`);

        let obj = extractForgeJson ? extractForgeJson(subAnswer) : null;
        let validated = null;
        let validationError = null;

        if (obj && obj.plan) {
          try {
            validated = validateForgePlan(obj.plan);
          } catch (err) {
            validationError = err.message;
          }
        } else {
          validationError = "Failed to extract valid JSON plan object.";
        }

        // Self-Healing Retry Loop
        if (!validated) {
          console.warn(`[MetaForge] Validation failed (${validationError}). Initiating self-healing retry...`);
          send({ type: "tool_status", name: "sys_delegate_to_metaforge", status: "running", detail: "Self-healing plan schema..." });
          send({ phase: "meta_forge_planning", stage: "self_healing" });
          const retryPrompt =
            obj && obj.plan
              ? `Your proposed JSON plan failed architectural validation: ${validationError}\n\nREMINDER: Orchestration Chains cannot directly contain 'tool' nodes. If creating an Orchestration Chain, you MUST synthesize each independent 'workflow' (DAG) FIRST in the 'create' array, and then connect them in the 'chain' object. Output the corrected, full JSON object now.`
              : `Your output did not parse as a valid JSON plan object. Output ONLY a valid JSON object starting with { and ending with } containing {"intent": "...", "plan": {"create": [...], "reuse": [...]}}.`;

          try {
            const retryMessages = [
              ...forgeMessages,
              { role: "assistant", content: subAnswer },
              { role: "user", content: retryPrompt },
            ];
            const retryIt = await streamFromProvider({
              provider: forgeProv,
              messages: retryMessages,
              tools: undefined,
              signal: requestAbort.signal,
              effort: "none",
              pool,
            });

            let retryAnswer = "";
            for await (const chunk of retryIt) {
              try {
                const parsed = JSON.parse(chunk);
                if (parsed.type === "out") retryAnswer += parsed.delta || "";
              } catch (e) {
                retryAnswer += chunk;
              }
            }
            console.log(`[MetaForge] Self-Healing Output:\n${retryAnswer}`);
            obj = extractForgeJson ? extractForgeJson(retryAnswer) : null;
            if (obj && obj.plan) {
              validated = validateForgePlan(obj.plan);
              validationError = null;
            }
          } catch (retryErr) {
            console.error("[MetaForge] Self-healing retry failed:", retryErr.message);
          }
        }

        if (!validated) {
          toolResultStr = JSON.stringify({ error: `MetaForge failed to generate a valid plan: ${validationError || subAnswer}` });
          toolStatus = "failed";
        } else {
          try {
            const requestedBy =
              actorCtx?.username || actorCtx?.user?.name || req?.session?.username || (actorId && !actorId.includes("-") ? actorId : "admin");

            const ins = await pool.query(
              `INSERT INTO forge_plans (id, actor, prompt, actions, status)
               VALUES ($1, $2, $3, $4::jsonb, 'pending') RETURNING id`,
              [`mf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`, requestedBy, intentText, JSON.stringify(validated.create || [])]
            );
            const planId = ins.rows[0]?.id;

            const planPayload = {
              id: planId,
              intent: intentText,
              plan: validated,
              status: "pending",
              requestedBy,
              autoApplied: false,
            };

            send({ forge_plan: planPayload });

            toolResultStr = JSON.stringify({
              success: true,
              message:
                "MetaForge plan synthesized and waiting for approval. Briefly list the proposed artifacts in a clean Markdown table (using columns: Tür, İsim, ID/Slug, Açıklama), state that an interactive approval card is provided below, and conclude your response so the user can review it.",
              plan_id: planId,
              proposed_artifacts: (validated.create || []).map((c) => ({
                kind: c.kind,
                name: c.name || c.slug,
                slug: c.slug,
                description: c.description || "",
              })),
            });
          } catch (valErr) {
            toolResultStr = JSON.stringify({ error: `MetaForge generated an invalid plan: ${valErr.message}` });
            toolStatus = "failed";
          }
        }
      }
    }
  }

  // 5. LIVE WEB SEARCH
  else if (realToolId === "sys_web_search") {
    const query = parsedArgs.query;
    try {
      const searchProvidersRes = await pool.query(
        `SELECT provider_type, base_url, api_key_ref FROM search_providers WHERE active = true ORDER BY priority ASC`
      );
      const providers = searchProvidersRes.rows;
      let searchSuccess = false;
      let lastError = "";

      const currentDateInfo = `SYSTEM NOTE: Today is ${new Date().toDateString()}. Ignore older dates in search snippets if assessing current conditions.`;

      for (const sp of providers) {
        try {
          if (sp.provider_type === "tavily") {
            let apiKey = "dummy";
            if (sp.api_key_ref) apiKey = await resolveCredential(pool, sp.api_key_ref, "api_key");

            const res = await fetch("https://api.tavily.com/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 5 }),
            });
            if (!res.ok) throw new Error(`Tavily error: ${res.status}`);
            const data = await res.json();
            toolResultStr = JSON.stringify({ _system: currentDateInfo, query, results: data.results, source: "tavily" });
            searchSuccess = true;
            break;
          } else if (sp.provider_type === "searxng") {
            const url = new URL(sp.base_url || "http://localhost:8080/search");
            url.searchParams.set("q", query);
            url.searchParams.set("format", "json");
            const res = await fetch(url.toString());
            if (!res.ok) throw new Error(`SearXNG error: ${res.status}`);
            const data = await res.json();
            const snippets = (data.results || []).slice(0, 5).map((r) => r.content || r.title);
            toolResultStr = JSON.stringify({ _system: currentDateInfo, query, results: snippets, source: "searxng" });
            searchSuccess = true;
            break;
          } else if (sp.provider_type === "duckduckgo") {
            const fetchRes = await fetch(sp.base_url || `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
            if (!fetchRes.ok) throw new Error(`DDG error: ${fetchRes.status}`);
            const html = await fetchRes.text();
            const snippets = [...html.matchAll(/<a class="result__snippet[^>]*>(.*?)<\/a>/gi)]
              .map((m) => m[1].replace(/<\/?[^>]+(>|$)/g, ""))
              .slice(0, 5);
            if (snippets.length > 0) {
              toolResultStr = JSON.stringify({ _system: currentDateInfo, query, results: snippets, source: "duckduckgo" });
              searchSuccess = true;
              break;
            } else {
              throw new Error("No results found in DDG HTML");
            }
          }
        } catch (err) {
          console.warn(`[Web Search] Provider ${sp.provider_type} failed:`, err.message);
          lastError = err.message;
          continue;
        }
      }

      if (!searchSuccess) {
        // Instant Answer API fallback
        try {
          const duckUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
          const ddgRes = await fetch(duckUrl, { headers: { "User-Agent": "Elara-Studio/1.0" } });
          if (ddgRes.ok) {
            const ddgData = await ddgRes.json();
            const searchResults = [];
            if (ddgData.AbstractText) {
              searchResults.push({
                title: ddgData.Heading || "DuckDuckGo Instant Answer",
                url: ddgData.AbstractURL || "https://duckduckgo.com",
                snippet: ddgData.AbstractText,
              });
            }
            if (ddgData.RelatedTopics && Array.isArray(ddgData.RelatedTopics)) {
              for (const topic of ddgData.RelatedTopics.slice(0, 4)) {
                if (topic.Text && topic.FirstURL) {
                  searchResults.push({ title: topic.Text.slice(0, 50), url: topic.FirstURL, snippet: topic.Text });
                }
              }
            }
            if (searchResults.length > 0) {
              toolResultStr = JSON.stringify({ _system: currentDateInfo, query, results: searchResults, source: "duckduckgo-instant" });
              searchSuccess = true;
            }
          }
        } catch {}
      }

      if (!searchSuccess) {
        toolResultStr = JSON.stringify({
          _system: currentDateInfo,
          query,
          results: [
            {
              title: `Live Search for: "${query}"`,
              snippet: `No external search provider returned live data. Query completed for "${query}".`,
            },
          ],
        });
      }
    } catch (searchErr) {
      toolResultStr = JSON.stringify({ error: `Web search engine failed: ${searchErr.message}` });
      toolStatus = "failed";
    }
  }

  return { toolResultStr, toolStatus };
}
