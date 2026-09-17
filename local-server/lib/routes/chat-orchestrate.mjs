// local-server/lib/routes/chat-orchestrate.mjs
// Central Chat Orchestration Gateway for ELARA Sovereign Studio.
// Modularized Architecture: Directives, Stream Bridge, Tool Dispatcher & FinOps Meter.

import { resolveAttachmentForLlm } from "../storage-engine.mjs";
import { scanExternalGuardrail } from "../genguard-scanner.mjs";
import { evaluatePolicyRules } from "../policy-engine-eval.mjs";
import { getSemanticCache, setSemanticCache } from "../infra/redis-cache.mjs";
import { embed } from "../embed-provider.mjs";
import { ragProbeAndFetch } from "../rag/retrieval.mjs";

import { buildMasterDirectives } from "../orchestrator/directives.mjs";
import { streamFromProvider, mapJsonSchemaType } from "../orchestrator/stream-bridge.mjs";
import { dispatchToolCall } from "../orchestrator/tool-dispatcher.mjs";
import { calculateTurnTokens, calculateTurnCost, persistTurnTelemetry } from "../orchestrator/finops-meter.mjs";
import { buildVisibility } from "../actor.mjs";

export async function mountChatOrchestrateRoutes(app, deps) {
  const { pool, approxTokens, trace, invokeTool, broadcastAudit, enqueueWrite, logCheckpoint } = deps;
  console.log("[Chat Orchestrate] approxTokens available:", !!approxTokens);

  // Active in-flight stream tracking for explicit cancel/stop signals
  const activeStreams = new Map();

  app.post("/api/chat/cancel", (req, res) => {
    const thread_id = req.body?.thread_id || req.body?.threadId;
    if (thread_id && activeStreams.has(thread_id)) {
      console.log(`\n========================================================`);
      console.log(`🛑 [EXPLICIT CANCEL] UI requested abort! Thread: ${thread_id}`);
      console.log(`========================================================\n`);
      const abortCtrl = activeStreams.get(thread_id);
      abortCtrl.abort();
      activeStreams.delete(thread_id);
      res.json({ success: true, message: "Stream explicitly aborted" });
    } else {
      res.json({ success: false, message: "Stream not found or already closed" });
    }
  });

  app.post("/api/chat/orchestrate", async (req, res) => {
    const thread_id = req.body?.thread_id || req.body?.threadId;
    const agent_id = req.body?.agent_id || req.body?.agentId;
    const { model, message, messages = [], capabilities, web_search, useRag, routing_mode, effort = "high", context: threadContext } = req.body ?? {};

    // RBAC Security Context resolution
    let actorId = null;
    let actorCtx = null;
    if (deps.resolveActorContext) {
      try {
        actorCtx = await deps.resolveActorContext(req);
        actorId = actorCtx?.username || actorCtx?.user?.name || req.session?.username || actorCtx?.userId || req.actor || null;
      } catch (e) {
        console.warn("[Orchestrate] Security context could not be resolved:", e.message);
      }
    }
    if (!actorCtx) actorCtx = { actor: null, isAdmin: false, userId: null, groupIds: [] };

    // 1. Setup SSE stream
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      res.write(":\n\n");
    }, 15000);

    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const emitDebug = (level, tag, msg, meta = {}, threadId = thread_id) => {
      const fullMeta = { tag, thread_id: threadId, stream: tag.split(".")[0] || "chat", ...meta };
      if (broadcastAudit) {
        try {
          broadcastAudit({
            thread_id: threadId,
            agent: tag.split(".")[0] || "chat",
            level,
            message: `${tag}: ${msg}`,
            meta: fullMeta,
          });
        } catch (err) {
          console.warn("[Orchestrate] broadcastAudit notice:", err.message);
        }
      }
      if (["chat.request", "model.responded", "tool.exec", "agent.step.start", "rag.search.done"].includes(tag) || level === "error" || level === "warn") {
        try {
          if (typeof logCheckpoint === "function") {
            logCheckpoint(level, tag, msg, fullMeta, threadId);
          } else if (typeof enqueueWrite === "function") {
            enqueueWrite(
              `INSERT INTO agent_logs(thread_id, agent, level, message, meta) VALUES ($1,$2,$3,$4,$5)`,
              [threadId, tag.split(".")[0] || "chat", level, `${tag}: ${msg}`, fullMeta]
            );
          }
        } catch (err) {
          console.warn("[Orchestrate] logCheckpoint notice:", err.message);
        }
      }
    };

    emitDebug("info", "chat.request", `turn started · model=${model || "default"} · ${messages.length} messages`, { model: model || "default", stream: "chat", actor: actorId || "operator" }, thread_id);

    const close = () => {
      clearInterval(heartbeat);
      res.write(`data: [DONE]\n\n`);
      res.end();
      if (thread_id) activeStreams.delete(thread_id);
      if (!requestAbort.signal.aborted) {
        requestAbort.abort();
      }
    };

    const requestAbort = new AbortController();
    if (thread_id) {
      activeStreams.set(thread_id, requestAbort);
    }

    const abortHandler = () => {
      clearInterval(heartbeat);
      if (!requestAbort.signal.aborted) {
        console.log("🛑 [Orchestrate] UI Stop signal received!");
        requestAbort.abort();
      }
      if (thread_id) activeStreams.delete(thread_id);
    };
    req.on("aborted", abortHandler);

    res.on("close", () => {
      clearInterval(heartbeat);
      if (!res.writableEnded && !requestAbort.signal.aborted) {
        console.log("🛑 [Orchestrate] Client disconnected abnormally!");
        requestAbort.abort();
      }
      if (thread_id) activeStreams.delete(thread_id);
    });

    try {
      send({ phase: "accepted" });
      const t0 = Date.now();
      let tFirstToken = 0;

      // 2. Resolve Provider & Model from DB (Parallelized Batch Query)
      let prov = null;
      let availableModels = [];

      const [
        dbRes,
        fallbackProvidersRes,
        rRow,
        guardRowsRes,
        factRes,
        pinnedRes,
        systemToolsRes,
        mcpServerRes,
      ] = await Promise.all([
        pool.query(`
          SELECT
            m.id as model_pk, m.name as model_name, m.model_id, m.base_url as model_base_url, m.api_key_ref as model_api_key, m.system_prompt,
            m.input_cost, m.output_cost, m.provider_id, m.advanced, m.think_enabled, m.think_statement,
            m.temperature, m.top_p, m.top_k, m.repetition_penalty, m.max_tokens, m.context_window,
            m.stop_sequences, m.chat_template,
            p.id as provider_pk, p.name as provider_name, p.base_url, p.secret_id, p.priority
          FROM models m
          LEFT JOIN ai_providers p ON m.provider_id = p.id
          WHERE m.enabled = true AND (p.active IS NULL OR p.active = true)
        `),
        pool.query(`
          SELECT 
            id as provider_pk, name as provider_name, base_url, secret_id, priority, model as model_id
          FROM ai_providers 
          WHERE active = true AND kind = 'llm'
        `),
        pool.query("SELECT value FROM system_config WHERE key = 'routing_policy'").catch(() => ({ rows: [] })),
        pool.query("SELECT * FROM guard_rules WHERE enabled = true ORDER BY seq ASC, created_at ASC").catch(() => ({ rows: [] })),
        pool.query("SELECT key, value, scope, confidence FROM memory_facts WHERE confidence >= 0.5 ORDER BY updated_at DESC LIMIT 30").catch(() => ({ rows: [] })),
        thread_id
          ? pool.query("SELECT label, origin FROM memory_working WHERE thread_id = $1 AND pinned = true ORDER BY updated_at ASC", [thread_id]).catch(() => ({ rows: [] }))
          : Promise.resolve({ rows: [] }),
        pool.query("SELECT id FROM action_library WHERE is_system = true AND COALESCE((runtime->>'orphan')::boolean, false) = false").catch(() => ({ rows: [] })),
        (() => {
          const { clause: mcpVisClause, params: mcpVisParams } = buildVisibility(actorCtx, 1, "owner_id");
          return pool.query(`SELECT slug, name, tools_cache, auto_inject FROM mcp_client_servers WHERE enabled = true AND last_status = 'ready' AND (${mcpVisClause})`, mcpVisParams).catch(() => ({ rows: [] }));
        })(),
      ]);

      availableModels = [...dbRes.rows];

      for (const fp of fallbackProvidersRes.rows) {
        if (!fp.model_id) continue;
        availableModels.push({
          model_pk: fp.provider_pk,
          model_name: fp.provider_name + " (Provider Fallback)",
          model_id: fp.model_id,
          model_base_url: fp.base_url,
          model_api_key: fp.secret_id,
          system_prompt: "",
          input_cost: 0,
          output_cost: 0,
          provider_id: fp.provider_pk,
          provider_name: fp.provider_name,
          priority: fp.priority || 50,
          temperature: 0.7,
          top_p: 0.85,
          top_k: 40,
          repetition_penalty: 1.1,
          max_tokens: 4096,
          context_window: 8192,
          stop_sequences: [],
          chat_template: "",
          advanced: [],
        });
      }

      if (availableModels.length === 0) {
        console.error("[Orchestrate] FATAL: No active AI provider/model found in DB!");
        throw new Error("No active AI provider/model found in DB.");
      }

      // Fetch global routing policy
      let sysRoutingMode = "failover";
      let allowOverride = true;
      let overrideAudience = "everyone";
      let overrideGroups = [];
      let overrideUsers = [];
      let overrideRoles = ["Admin", "Operator"];
      try {
        if (rRow.rows.length > 0 && rRow.rows[0].value) {
          const parsedConfig = typeof rRow.rows[0].value === "string" ? JSON.parse(rRow.rows[0].value) : rRow.rows[0].value;
          sysRoutingMode = parsedConfig.mode || "failover";
          if (parsedConfig.allowUserOverride === false) allowOverride = false;
          overrideAudience = parsedConfig.overrideAudience || "everyone";
          overrideGroups = Array.isArray(parsedConfig.overrideGroups) ? parsedConfig.overrideGroups : [];
          overrideUsers = Array.isArray(parsedConfig.overrideUsers) ? parsedConfig.overrideUsers : [];
          overrideRoles = Array.isArray(parsedConfig.overrideRoles) ? parsedConfig.overrideRoles : ["Admin", "Operator"];
        }
      } catch (e) {}

      if (allowOverride && !actorCtx?.isAdmin) {
        if (overrideAudience === "admins") {
          allowOverride = false;
        } else if (overrideAudience === "users") {
          const uName = String(actorCtx?.username || "").toLowerCase();
          const allowedUsers = overrideUsers.map((u) => String(u).toLowerCase());
          if (!allowedUsers.includes(uName)) allowOverride = false;
        } else if (overrideAudience === "groups") {
          const uGroups = (actorCtx?.groupIds || actorCtx?.groups || []).map((g) => String(g).toLowerCase());
          const allowedGroups = overrideGroups.map((g) => String(g).toLowerCase());
          const hasGroup = uGroups.some((g) => allowedGroups.includes(g));
          if (!hasGroup) allowOverride = false;
        } else if (overrideAudience === "roles") {
          const userRole = (actorCtx?.role || "Viewer").toLowerCase();
          const allowedLower = overrideRoles.map((r) => String(r).toLowerCase());
          if (!allowedLower.includes(userRole)) allowOverride = false;
        }
      }

      const finalRoutingMode = routing_mode && allowOverride ? routing_mode : sysRoutingMode;

      // Policy Engine ROUTING / OUTPUT Evaluation
      let effectiveModel = model;
      const userPromptOverview = String(message || (Array.isArray(messages) ? messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n") : "")).trim();
      try {
        const policyVerdict = await evaluatePolicyRules({
          pool,
          promptText: userPromptOverview,
          requestedModel: model,
          tenantId: actorCtx?.tenantId || "default",
        });

        if (policyVerdict.matched) {
          emitDebug(
            "info",
            "policy.engine.matched",
            `Policy Rule #${policyVerdict.seq} "${policyVerdict.name}" matched → ${policyVerdict.action.toUpperCase()} (${policyVerdict.reason})`,
            {
              ruleId: policyVerdict.rule?.id,
              ruleName: policyVerdict.name,
              action: policyVerdict.action,
              target: policyVerdict.target,
              stream: "policy",
            },
            thread_id
          );

          if (policyVerdict.action === "deny") {
            send({
              type: "out",
              delta: `🛡️ **[POLICY ENGINE ENFORCEMENT]**\nYour request was blocked by Policy Rule **#${policyVerdict.seq} (${policyVerdict.name})**.\n*Reason:* ${policyVerdict.reason}.\n*Action:* **DENY**.\n\n*Logged to the Sovereign Audit Journal.*`,
            });
            close();
            return;
          }

          if (policyVerdict.action === "route" && policyVerdict.target) {
            const targetMatched = availableModels.find(
              (m) => m.model_pk === policyVerdict.target || m.model_id === policyVerdict.target || m.name?.toLowerCase() === policyVerdict.target.toLowerCase()
            );
            if (targetMatched) {
              effectiveModel = targetMatched.model_id || targetMatched.model_pk;
            }
          }
        }
      } catch (policyErr) {
        console.warn("[Orchestrate] Policy Engine evaluation notice:", policyErr.message);
      }

      // Provider Chain Resolution
      let providerChain = [];
      if (finalRoutingMode === "manual_only" || finalRoutingMode === "single") {
        const m = availableModels.find((m) => m.model_pk === effectiveModel || m.model_id === effectiveModel);
        if (m) providerChain.push(m);
      } else if (finalRoutingMode === "cheapest_first" || finalRoutingMode === "cheapest") {
        availableModels.sort((a, b) => Number(a.input_cost) + Number(a.output_cost) - (Number(b.input_cost) + Number(b.output_cost)));
        providerChain = availableModels;
      } else if (finalRoutingMode === "round_robin") {
        global._elaraRrIndex = (global._elaraRrIndex || 0) + 1;
        const startIndex = global._elaraRrIndex % availableModels.length;
        providerChain = [...availableModels.slice(startIndex), ...availableModels.slice(0, startIndex)];
      } else {
        availableModels.sort((a, b) => Number(a.priority) - Number(b.priority));
        const reqModel = availableModels.find((m) => m.model_pk === effectiveModel || m.model_id === effectiveModel);
        if (reqModel) providerChain.push(reqModel);
        for (const m of availableModels) {
          if (reqModel && m.model_pk === reqModel.model_pk) continue;
          providerChain.push(m);
        }
      }

      if (providerChain.length === 0) {
        throw new Error(`Model ${model} requested but not found or inactive, and routing mode is strict (${finalRoutingMode}).`);
      }

      prov = providerChain[0];
      const usedModel = prov.model_id || prov.model || model || "gpt-3.5-turbo";
      const sourceName = prov.provider_name || "Custom/Local";

      send({ phase: "policy", meta: { source: `provider:${sourceName}`, model: usedModel } });

      // 2.1. GenGuard Security Firewall
      try {
        const guardRows = guardRowsRes?.rows || [];
        if (guardRows.length > 0) {
          const userPromptText = messages
            .map((m) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((c) => c.text || "").join(" ") : ""))
            .join("\n");

          for (const rule of guardRows) {
            let matched = false;
            let matchReason = "";

            if (rule.engine_type === "external" && rule.endpoint_url) {
              const scanResult = await scanExternalGuardrail({
                rule,
                promptText: userPromptText,
                messages,
                pool,
              });

              emitDebug(
                scanResult.flagged ? "warn" : "debug",
                "policy.genguard.external",
                `External guardrail #${rule.seq || 10} "${rule.name}" (${rule.provider_format || "REST"}) probe ${scanResult.latencyMs}ms → ${scanResult.flagged ? "VIOLATION" : "PASSED"} (score: ${scanResult.score ?? 0})`,
                {
                  ruleId: rule.id,
                  ruleName: rule.name,
                  format: rule.provider_format,
                  score: scanResult.score,
                  flagged: scanResult.flagged,
                  latencyMs: scanResult.latencyMs,
                  stream: "policy",
                },
                thread_id
              );

              if (scanResult.flagged) {
                matched = true;
                matchReason = scanResult.reason;
              }
            } else {
              if (rule.input_blacklist) {
                const blacklists = rule.input_blacklist.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
                for (const phrase of blacklists) {
                  if (phrase && userPromptText.toLowerCase().includes(phrase.toLowerCase())) {
                    matched = true;
                    matchReason = `blacklisted term "${phrase}"`;
                    break;
                  }
                }
              }

              if (!matched && rule.output_patterns) {
                try {
                  const patterns = rule.output_patterns.split("\n").map((s) => s.trim()).filter(Boolean);
                  for (const pat of patterns) {
                    const reg = new RegExp(pat, "i");
                    if (reg.test(userPromptText)) {
                      matched = true;
                      matchReason = `matched pattern /${pat}/i`;
                      break;
                    }
                  }
                } catch (regErr) {}
              }
            }

            if (matched) {
              const ruleAction = String(rule.action || "deny").toLowerCase();
              emitDebug(
                ruleAction === "deny" ? "warn" : "info",
                "policy.genguard",
                `GenGuard rule #${rule.seq || 10} "${rule.name}" triggered (${matchReason}) → ${ruleAction.toUpperCase()}`,
                {
                  ruleId: rule.id,
                  ruleName: rule.name,
                  seq: rule.seq,
                  action: ruleAction,
                  reason: matchReason,
                  stream: "policy",
                },
                thread_id
              );

              if (ruleAction === "deny") {
                send({
                  type: "out",
                  delta: `🛡️ **[SECURITY VIOLATION — GenGuard Firewall]**\nYour request was blocked by security policy rule **#${rule.seq || 10} (${rule.name})**.\n*Reason:* ${matchReason}.\n*Action:* **DENY**.\n\n*This event has been logged to the Sovereign Audit Journal.*`,
                });
                close();
                return;
              }

              if (ruleAction === "challenge") {
                const reqId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                await pool.query(
                  `INSERT INTO approval_requests (id, title, origin, tool, target, policy, risk, args, status, tenant_id)
                   VALUES ($1, $2, 'genguard', 'firewall.challenge', $3, $4, 'high', $5, 'pending', $6)`,
                  [
                    reqId,
                    `Security Quarantine: ${rule.name}`,
                    userPromptText.slice(0, 100),
                    `GenGuard Rule #${rule.seq || 10}: ${matchReason}`,
                    JSON.stringify({ prompt: userPromptText, reason: matchReason, rule: rule.name }),
                    actorCtx?.tenantId || "default",
                  ]
                ).catch(() => {});

                send({
                  type: "out",
                  delta: `🛡️ **[SECURITY QUARANTINE — GenGuard Challenge]**\nYour request has triggered security inspection rule **#${rule.seq || 10} (${rule.name})**.\n*Reason:* ${matchReason}.\n*Status:* **Pending Operator Approval in Approvals Queue.**`,
                });
                close();
                return;
              }

              if (ruleAction === "allow") {
                break;
              }
            }
          }
        }
      } catch (guardErr) {
        console.warn("[Orchestrate] GenGuard evaluation notice:", guardErr.message);
      }

      // 3. Format messages and Multimodal / Document Attachment Resolution
      const formattedMessages = [];
      for (const m of messages) {
        let safeRole = m.role || "user";
        if (safeRole === "agent") safeRole = "assistant";
        let safeContent = m.content || m.text || "";

        if (Array.isArray(m.content)) {
          const resolvedBlocks = [];
          for (const block of m.content) {
            if (
              block.type === "image_url" &&
              block.image_url?.url &&
              (block.image_url.url.startsWith("/api/uploads/") || !block.image_url.url.startsWith("data:"))
            ) {
              const r = await resolveAttachmentForLlm(
                { url: block.image_url.url, kind: "image" },
                { pool, extractFileContent: deps.extractFileContent }
              );
              if (r) resolvedBlocks.push(r);
              else resolvedBlocks.push(block);
            } else if (block.type === "file" || block.file) {
              const fileData = block.file?.file_data || block.file?.url || block.url;
              const fileName = block.file?.filename || block.filename || "document";
              const r = await resolveAttachmentForLlm(
                { url: fileData, name: fileName, kind: "file" },
                { pool, extractFileContent: deps.extractFileContent }
              );
              if (r) resolvedBlocks.push(r);
              else resolvedBlocks.push({ type: "text", text: `[Attached Document: ${fileName}]` });
            } else {
              resolvedBlocks.push(block);
            }
          }
          safeContent = resolvedBlocks;
        } else if (Array.isArray(m.files) && m.files.length > 0) {
          const resolvedBlocks = [];
          for (const f of m.files) {
            const r = await resolveAttachmentForLlm(f, { pool, extractFileContent: deps.extractFileContent });
            if (r) resolvedBlocks.push(r);
          }
          if (typeof safeContent === "string" && safeContent.trim()) {
            resolvedBlocks.push({ type: "text", text: safeContent });
          }
          safeContent = resolvedBlocks.length > 0 ? resolvedBlocks : safeContent;
        }

        formattedMessages.push({
          role: safeRole,
          content: safeContent,
        });
      }

      // 4. Construct Master Directives & Memory Layer
      const masterDirectives = buildMasterDirectives({
        threadContext,
        useRag,
        web_search,
        agent_id,
        factRes,
        pinnedRes,
        prov,
        effort,
        emitDebug,
        thread_id,
      });

      // @Agent Persona Activation & Directives
      if (agent_id) {
        try {
          const agtRow = await pool.query(
            `SELECT id, name, system_prompt, rag, rag_space_id, rag_brands, rag_keywords FROM agents WHERE id = $1 LIMIT 1`,
            [agent_id]
          );
          if (agtRow.rows.length > 0) {
            const agt = agtRow.rows[0];
            masterDirectives.push(`[ACTIVE AGENT PERSONA ACTIVATED]: You are currently operating as the specialized agent "${agt.name}" (${agt.id}). Adhere strictly to the following instructions:\n${agt.system_prompt || ""}`);

            if (agt.rag) {
              try {
                let spaceFileIds = null;
                if (agt.rag_space_id) {
                  const spaceSrcRes = await pool.query(`SELECT id::text FROM knowledge_sources WHERE space_id = $1`, [agt.rag_space_id]);
                  spaceFileIds = spaceSrcRes.rows.map((r) => r.id);
                }

                const parsedKeywords = agt.rag_keywords ? agt.rag_keywords.split(",").map((k) => k.trim()).filter(Boolean) : [];
                const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";

                if (lastUserMsg) {
                  emitDebug("debug", "rag.search.start", `probing knowledge space for agent ${agt.name || agt.id}`, { agent_id: agt.id, stream: "rag" }, thread_id);
                  const ragOut = await ragProbeAndFetch({
                    q: lastUserMsg,
                    allowedLevels: null,
                    agentId: agt.id,
                    bindingFileIds: spaceFileIds,
                    bindingBrands: Array.isArray(agt.rag_brands) ? agt.rag_brands : [],
                    agentKeywords: parsedKeywords,
                    caller: "agent-rag",
                  });

                  if (ragOut && ragOut.rows && ragOut.rows.length > 0) {
                    emitDebug("info", "rag.search.done", `retrieved ${ragOut.rows.length} chunks · top1=${ragOut.top1 || 0} · ${ragOut.stages?.totalMs || 0}ms`, { hits: ragOut.rows.length, top1: ragOut.top1, ms: ragOut.stages?.totalMs || 0, stream: "rag" }, thread_id);
                    let ragText = "[RAG KNOWLEDGE]\nHere is verified technical documentation retrieved from the knowledge base:\n\n";
                    ragOut.rows.forEach((r) => {
                      ragText += `--- SOURCE: ${r.path || "unknown"} ---\n${r.content}\n\n`;
                    });
                    masterDirectives.push(ragText);
                    masterDirectives.push("[RAG INSTRUCTION]: Use the verified knowledge in [RAG KNOWLEDGE] above as your primary technical authority. Synthesize this context with your domain expertise to provide complete, accurate, and ready-to-run CLI configuration blocks. Always provide full and valid configuration syntax.");

                    send({
                      rag: {
                        sources: ragOut.rows.map((r, i) => ({
                          index: i + 1,
                          id: String(r.id || `chunk-${r.ord || i}`),
                          name: r.path ? r.path.split("/").pop() : r.name || "Document",
                          path: r.path || "",
                          brand: r.brand || agt.rag_brands?.[0] || "",
                          ord: r.ord ?? i + 1,
                          page: r.page_start || 1,
                          score: Math.round(Math.min(1, Number(r.score) || 0) * 100),
                          snippet: String(r.content || "").slice(0, 300),
                        })),
                        debug: {
                          queryClean: lastUserMsg,
                          probe: {
                            top1: ragOut.top1 || 0,
                            ms: ragOut.stages?.totalMs || 0,
                          },
                        },
                        reranker: ragOut.reranker || { used: true, model: "BAAI/bge-reranker-base" },
                        fallback: { brands: Array.isArray(agt.rag_brands) ? agt.rag_brands : [] },
                      },
                    });

                    const principalName = actorCtx?.username || actorCtx?.user?.name || req.session?.username || "admin";
                    const pId = actorCtx?.userId || actorId || "admin";
                    const qId = `rq.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}`;
                    const uniqueDocs = new Set(ragOut.rows.map((r) => r.path)).size;
                    pool.query(
                      `INSERT INTO rag_queries (id, at, query, principal, principal_id, agent, spaces, blocked, docs, chunks, hit)
                       VALUES ($1, now(), $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
                      [
                        qId,
                        lastUserMsg,
                        principalName,
                        pId,
                        agt.name || agt.id || "Agent",
                        JSON.stringify(agt.rag_space_id ? [agt.rag_space_id] : Array.isArray(agt.rag_brands) ? agt.rag_brands : []),
                        0,
                        uniqueDocs,
                        ragOut.rows.length,
                        true,
                      ]
                    ).catch((err) => console.warn("[RAG Telemetry] Failed to log query:", err.message));
                  }
                }
              } catch (ragError) {
                console.error(`[Orchestrate] Primary agent RAG failed for agent ${agt.id}:`, ragError);
              }
            }
          }
        } catch (e) {
          console.warn("[Orchestrate] Agent persona load failed:", e.message);
        }
      } else if (useRag === true || req.body?.useRag === true || req.body?.use_rag === true) {
        // Universal General RAG Fallback
        try {
          const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
          if (lastUserMsg) {
            emitDebug("debug", "rag.search.start", `probing knowledge space for general query`, { stream: "rag" }, thread_id);
            const ragOut = await ragProbeAndFetch({
              q: lastUserMsg,
              allowedLevels: null,
              caller: "chat-rag",
            });
            if (ragOut && ragOut.rows && ragOut.rows.length > 0) {
              emitDebug("info", "rag.search.done", `retrieved ${ragOut.rows.length} chunks · top1=${ragOut.top1 || 0} · ${ragOut.stages?.totalMs || 0}ms`, { hits: ragOut.rows.length, top1: ragOut.top1, ms: ragOut.stages?.totalMs || 0, stream: "rag" }, thread_id);
              let ragText = "[RAG KNOWLEDGE]\nHere is verified technical documentation retrieved from the knowledge base:\n\n";
              ragOut.rows.forEach((r) => {
                ragText += `--- SOURCE: ${r.path || "unknown"} ---\n${r.content}\n\n`;
              });
              masterDirectives.push(ragText);
              masterDirectives.push("[RAG INSTRUCTION]: Use the verified knowledge in [RAG KNOWLEDGE] above as your primary technical authority. Synthesize this context with your domain expertise to provide complete, accurate, and ready-to-run CLI configuration blocks. Always provide full and valid configuration syntax.");

              send({
                rag: {
                  sources: ragOut.rows.map((r, i) => ({
                    index: i + 1,
                    id: String(r.id || `chunk-${r.ord || i}`),
                    name: r.path ? r.path.split("/").pop() : r.name || "Document",
                    path: r.path || "",
                    brand: r.brand || "",
                    ord: r.ord ?? i + 1,
                    page: r.page_start || 1,
                    score: Math.round(Math.min(1, Number(r.score) || 0) * 100),
                    snippet: String(r.content || "").slice(0, 300),
                  })),
                  debug: {
                    queryClean: lastUserMsg,
                    probe: {
                      top1: ragOut.top1 || 0,
                      ms: ragOut.stages?.totalMs || 0,
                    },
                  },
                  reranker: ragOut.reranker || { used: true, model: "BAAI/bge-reranker-base" },
                  fallback: { brands: [] },
                },
              });

              const principalName = actorCtx?.username || actorCtx?.user?.name || req.session?.username || "admin";
              const pId = actorCtx?.userId || actorId || "admin";
              const qId = `rq.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}`;
              const uniqueDocs = new Set(ragOut.rows.map((r) => r.path)).size;
              pool.query(
                `INSERT INTO rag_queries (id, at, query, principal, principal_id, agent, spaces, blocked, docs, chunks, hit)
                 VALUES ($1, now(), $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
                [
                  qId,
                  lastUserMsg,
                  principalName,
                  pId,
                  "Sovereign Brain",
                  JSON.stringify([]),
                  0,
                  uniqueDocs,
                  ragOut.rows.length,
                  true,
                ]
              ).catch((err) => console.warn("[RAG Telemetry] Failed to log query:", err.message));
            }
          }
        } catch (genRagErr) {
          console.error("[Orchestrate] General RAG probe failed:", genRagErr);
        }
      }

      // Explicit Capability Mentions
      const requestedTools = capabilities?.tools || [];
      const requestedSkills = capabilities?.skills || [];
      const requestedMcp = capabilities?.mcp || [];
      const hasExplicitCapabilities = requestedTools.length > 0 || requestedSkills.length > 0 || requestedMcp.length > 0 || Boolean(agent_id);

      if (requestedTools.length > 0 || requestedSkills.length > 0 || requestedMcp.length > 0) {
        const attachedList = [];
        if (requestedTools.length > 0) attachedList.push(`Tools: [${requestedTools.join(", ")}]`);
        if (requestedSkills.length > 0) attachedList.push(`Skills: [${requestedSkills.join(", ")}]`);
        if (requestedMcp.length > 0) attachedList.push(`MCP Server/Tools: [${requestedMcp.join(", ")}]`);
        masterDirectives.push(`[EXPLICIT USER ATTACHMENTS & CAPABILITY MANDATE]: The user has explicitly selected and attached the following capabilities to this turn: ${attachedList.join(" · ")}. You MUST execute the corresponding attached tool(s)/MCP functions to fulfill the request. NEVER substitute or bypass an attached MCP/Tool with a generic web fetch or approximation.`);
      }

      formattedMessages.unshift({
        role: "system",
        content: masterDirectives.join("\n\n"),
      });

      emitDebug("debug", "prompt.assembly", `assembled ${formattedMessages.length} message layers · directives merged`, { model: usedModel, stream: "prompt" }, thread_id);

      // 5. Capability Function Schemas & Tool Registry
      const openAiTools = [];
      const toolMap = {};

      const systemToolIds = (systemToolsRes?.rows || []).map((r) => r.id);
      let finalToolIds = [...new Set([...requestedTools, ...systemToolIds])];

      if (capabilities || finalToolIds.length > 0) {
        try {
          const dbToolIds = finalToolIds.filter((id) => !id.startsWith("mcp."));
          if (dbToolIds.length > 0) {
            const cleanToolIds = dbToolIds.map((id) => (id.startsWith("tool.") ? id : `tool.${id}`));
            const bareToolIds = dbToolIds.map((id) => id.replace(/^tool\./, ""));
            const allPossibleIds = [...new Set([...dbToolIds, ...cleanToolIds, ...bareToolIds])];

            const { clause: actVisClause, params: actVisParams } = buildVisibility(actorCtx, 2, "owner_user_id");
            const toolRes = await pool.query(
              `SELECT a.id, a.name, COALESCE(NULLIF(a.description, ''), t.description, a.name, 'No description') AS description, a.params 
                 FROM action_library a
                 LEFT JOIN tools t ON t.id = a.id
                WHERE (a.id = ANY($1) OR a.name = ANY($1)) 
                  AND (${actVisClause.replace(/\bowner_user_id\b/g, "a.owner_user_id").replace(/\btenant_id\b/g, "a.tenant_id").replace(/\bis_global\b/g, "a.is_global")})
                  AND COALESCE((a.runtime->>'orphan')::boolean, false) = false`,
              [allPossibleIds, ...actVisParams]
            );
            for (const t of toolRes.rows) {
              const properties = {};
              const required = [];

              let tParams = [];
              try {
                tParams = typeof t.params === "string" ? JSON.parse(t.params) : t.params || [];
              } catch (e) {}

              if (Array.isArray(tParams)) {
                for (const p of tParams) {
                  const pKey = p.key || p.name || p.id;
                  if (!pKey) continue;
                  properties[pKey] = { type: mapJsonSchemaType(p.type), description: p.description || p.label || "" };
                  if (p.required) required.push(pKey);
                }
              } else if (typeof tParams === "object" && tParams !== null) {
                for (const [k, v] of Object.entries(tParams)) {
                  properties[k] = { type: mapJsonSchemaType(v), description: "" };
                }
              }

              const rawClean = t.id.replace(/[^a-zA-Z0-9_]/g, "_");
              const safeName = rawClean.startsWith("tool_") ? rawClean : `tool_${rawClean}`;
              const bareName = t.id.replace(/^(tool|act|tl)[\._]/i, "").replace(/[^a-zA-Z0-9_]/g, "_");

              toolMap[safeName] = t.id;
              toolMap[t.id] = t.id;
              toolMap[rawClean] = t.id;
              if (bareName) {
                toolMap[bareName] = t.id;
                toolMap[`tool_${bareName}`] = t.id;
                toolMap[`tool_tool_${bareName}`] = t.id;
              }

              openAiTools.push({
                type: "function",
                function: {
                  name: safeName,
                  description: t.description || t.name || "No description",
                  parameters: {
                    type: "object",
                    properties,
                    required,
                  },
                },
              });
            }
          }

          if (capabilities?.skills && capabilities.skills.length > 0) {
            const cleanSkillIds = capabilities.skills.map((id) => (id.startsWith("sk.") ? id : `sk.${id.replace(/^skill\./, "")}`));
            const bareSkillIds = capabilities.skills.map((id) => id.replace(/^(sk\.|skill\.)/, ""));
            const allSkillIds = [...new Set([...capabilities.skills, ...cleanSkillIds, ...bareSkillIds])];

            const { clause: skillVisClause, params: skillVisParams } = buildVisibility(actorCtx, 2, "owner_id");
            const skillRes = await pool.query(
              `SELECT id, name, description, params FROM skills WHERE id = ANY($1) AND enabled = true AND (${skillVisClause})`,
              [allSkillIds, ...skillVisParams]
            );
            for (const s of skillRes.rows) {
              const properties = {};
              const required = [];

              let sParams = [];
              try {
                sParams = typeof s.params === "string" ? JSON.parse(s.params) : s.params || [];
              } catch (e) {}

              if (Array.isArray(sParams)) {
                for (const p of sParams) {
                  const pKey = p.key || p.name || p.id;
                  if (!pKey) continue;
                  properties[pKey] = { type: mapJsonSchemaType(p.type), description: p.description || p.label || "" };
                  if (p.required) required.push(pKey);
                }
              } else if (typeof sParams === "object" && sParams !== null) {
                for (const [k, v] of Object.entries(sParams)) {
                  properties[k] = { type: mapJsonSchemaType(v), description: "" };
                }
              }

              const rawSkillClean = s.id.replace(/[^a-zA-Z0-9_]/g, "_");
              const safeName = rawSkillClean.startsWith("skill_") ? rawSkillClean : `skill_${rawSkillClean}`;
              const bareSkill = s.id.replace(/^(skill|sk)[\._]/i, "").replace(/[^a-zA-Z0-9_]/g, "_");

              toolMap[safeName] = s.id;
              toolMap[s.id] = s.id;
              toolMap[rawSkillClean] = s.id;
              if (bareSkill) {
                toolMap[bareSkill] = s.id;
                toolMap[`skill_${bareSkill}`] = s.id;
                toolMap[`sk_${bareSkill}`] = s.id;
                toolMap[`skill_skill_${bareSkill}`] = s.id;
              }

              openAiTools.push({
                type: "function",
                function: {
                  name: safeName,
                  description: s.description || s.name || "No description",
                  parameters: {
                    type: "object",
                    properties,
                    required,
                  },
                },
              });
            }
          }

          for (const server of mcpServerRes?.rows || []) {
            const serverMcpId = `mcp.${server.slug}`;
            const isExplicitlyRequested = requestedMcp && requestedMcp.length > 0 && (requestedMcp.includes(serverMcpId) || requestedMcp.some((x) => x.startsWith(`mcp.${server.slug}.`)));
            const shouldInject = Boolean(server.auto_inject) || isExplicitlyRequested;

            const tools = Array.isArray(server.tools_cache) ? server.tools_cache : [];
            for (const t of tools) {
              const mcpId = `mcp.${server.slug}.${t.name}`;
              if (shouldInject || (requestedMcp && requestedMcp.includes(mcpId))) {
                const rawMcpClean = mcpId.replace(/[^a-zA-Z0-9_]/g, "_");
                const safeName = rawMcpClean.startsWith("tool_") ? rawMcpClean : `tool_${rawMcpClean}`;
                toolMap[safeName] = mcpId;
                toolMap[mcpId] = mcpId;
                toolMap[rawMcpClean] = mcpId;
                openAiTools.push({
                  type: "function",
                  function: {
                    name: safeName,
                    description: `[MCP: ${server.name}] ${t.description || t.name}`,
                    parameters: t.inputSchema || { type: "object", properties: {} },
                  },
                });
              }
            }
          }
        } catch (err) {
          console.warn("[Orchestrate] Failed to extract capability schemas:", err.message);
        }
      }

      // Zero-Shot System Tools Registration
      if (!agent_id || agent_id === "meta-forge" || (capabilities && (capabilities.tools?.length > 0 || capabilities.skills?.length > 0))) {
        if (!toolMap["sys_get_directory"]) {
          openAiTools.push({
            type: "function",
            function: {
              name: "sys_get_directory",
              description: "Lists all available specialized agents, tools, skills, MCP servers, workflows, orchestrations, and webhooks in the system. Use this when you need to inspect existing capabilities, registered pipelines, or external endpoints.",
              parameters: {
                type: "object",
                properties: {
                  intent: { type: "string", description: "What kind of agent/tool/workflow/webhook are you looking for?" },
                },
                required: [],
              },
            },
          });
          toolMap["sys_get_directory"] = "sys_get_directory";
        }

        if (!toolMap["sys_delegate_to_agent"]) {
          openAiTools.push({
            type: "function",
            function: {
              name: "sys_delegate_to_agent",
              description: "Delegates a specific sub-task to an expert agent by their ID (found via sys_get_directory). The sub-agent will work in the background and return the final report.",
              parameters: {
                type: "object",
                properties: {
                  agent_id: { type: "string", description: "The ID of the target expert agent (e.g., 'agt.netsec')" },
                  instructions: { type: "string", description: "Detailed prompt/instructions for the sub-agent to execute." },
                },
                required: ["agent_id", "instructions"],
              },
            },
          });
          toolMap["sys_delegate_to_agent"] = "sys_delegate_to_agent";
        }

        if (!toolMap["sys_delegate_to_metaforge"]) {
          openAiTools.push({
            type: "function",
            function: {
              name: "sys_delegate_to_metaforge",
              description: "Triggers MetaForge (the autonomous engineer) to synthesize, generate, and propose new tools, skills, agents, automated Workflows (DAG), or Orchestration Chains. Call this whenever the user asks to create/register a new capability or multi-step workflow/chain into the system.",
              parameters: {
                type: "object",
                properties: {
                  intent: { type: "string", description: "Detailed description of the tool, agent, workflow DAG, or orchestration chain you need created." },
                },
                required: ["intent"],
              },
            },
          });
          toolMap["sys_delegate_to_metaforge"] = "sys_delegate_to_metaforge";
        }

        if (!toolMap["sys_execute_tool"]) {
          openAiTools.push({
            type: "function",
            function: {
              name: "sys_execute_tool",
              description: "Executes a specific tool or MCP capability by its ID (found via sys_get_directory) autonomously. Pass the required parameters exactly as specified in the directory.",
              parameters: {
                type: "object",
                properties: {
                  tool_id: { type: "string", description: "The ID of the target tool (e.g., 'tool.weather')" },
                  params: { type: "object", description: "A JSON object containing the required arguments for the tool." },
                },
                required: ["tool_id", "params"],
              },
            },
          });
          toolMap["sys_execute_tool"] = "sys_execute_tool";
        }
      }

      if (web_search && !toolMap["sys_web_search"]) {
        openAiTools.push({
          type: "function",
          function: {
            name: "sys_web_search",
            description: "Performs a live internet search using DuckDuckGo to get up-to-date information, news, dates, and facts.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "The search query to look up on the internet." },
              },
              required: ["query"],
            },
          },
        });
        toolMap["sys_web_search"] = "sys_web_search";
      }

      let maxIterations = 15;
      let iteration = 0;
      let isDone = false;
      let finalProviderUsed = prov;
      let cumulativeResponseTokens = 0;
      let cumulativeGenMs = 0;

      // === RE-ACT AGENTIC LOOP START ===
      while (iteration < maxIterations && !isDone) {
        iteration++;

        emitDebug("info", "agent.step.start", `turn ${iteration} · routing=${finalRoutingMode} · provider=${prov.model_name}`, { iteration, model: usedModel, stream: "agent" }, thread_id);

        if (iteration === 1) {
          send({ phase: "streaming" });
        } else {
          send({ phase: "agent_loop", iteration });
          console.log(`\n[Orchestrate] --- Agent Loop Start: Turn ${iteration} ---`);
        }

        let it = null;
        let hopIndex = 0;
        let hopError = null;
        const userQueryStr = String(message || [...messages].reverse().find((m) => m.role === "user")?.content || "").trim();

        // Failover & Semantic Cache Resolution Loop
        while (hopIndex < providerChain.length) {
          const currentProv = providerChain[hopIndex];
          const targetModelKey = currentProv.model_id || currentProv.model || "default";

          if (iteration === 1 && !hasExplicitCapabilities && userQueryStr.length > 2) {
            try {
              const qVec = await embed(userQueryStr).catch(() => null);
              const cacheHit = await getSemanticCache(qVec, userQueryStr, targetModelKey, 0.98);
              if (cacheHit && cacheHit.hit && cacheHit.response) {
                console.log(`[SemanticCache] ⚡ Cache HIT for model ${targetModelKey} (${cacheHit.source}, score=${cacheHit.score})`);
                const totalMs = Date.now() - t0;
                const tokenCount = Math.max(1, Math.round(cacheHit.response.length / 4));
                send({
                  type: "out",
                  delta: cacheHit.response,
                  text: cacheHit.response,
                  meta: {
                    source: `cache:${cacheHit.source}`,
                    providerName: currentProv.model_name || targetModelKey,
                    cached: true,
                    score: cacheHit.score,
                  },
                });
                send({
                  latency: {
                    ttftMs: totalMs,
                    totalMs,
                    tokensOut: tokenCount,
                    modelOut: targetModelKey,
                  },
                });
                send({ type: "done" });
                close();
                return;
              }
            } catch (cErr) {}
          }

          try {
            if (hopIndex > 0) {
              console.log(`[Orchestrate] ⚠️ Fallback Hop triggered! Switching to Provider: ${currentProv.model_name}`);
              const fallbackModelStr = currentProv.model_id || currentProv.model || "gpt-3.5-turbo";
              const fallbackSourceName = currentProv.provider_name || "Custom/Local";
              send({ phase: "policy", meta: { source: `provider:${fallbackSourceName}`, model: fallbackModelStr } });
            }

            const turnEffort = iteration === 1 ? effort : "none";
            it = await streamFromProvider({
              provider: currentProv,
              messages: formattedMessages,
              tools: openAiTools.length > 0 ? openAiTools : undefined,
              signal: requestAbort.signal,
              effort: turnEffort,
              pool,
            });

            finalProviderUsed = currentProv;
            break;
          } catch (err) {
            hopError = err;
            console.error(`[Orchestrate] ❌ Provider ${currentProv.model_name} failed:`, err.stack || err.message);
            hopIndex++;
          }
        }

        if (!it) {
          throw new Error(`All providers in the routing chain failed. Last error: ${hopError?.message}`);
        }

        let assembled = "";
        let assembledThinking = "";
        let chunkCount = 0;
        let toolCallsBuffer = {};
        const tStreamStart = Date.now();

        console.log(`[Orchestrate] Stream reading started (Turn ${iteration})...`);

        try {
          for await (const piece of it) {
            if (!tFirstToken && iteration === 1) {
              tFirstToken = Date.now();
              const ttftMs = tFirstToken - t0;
              console.log(`[Orchestrate] First token received! (${ttftMs}ms)`);
              emitDebug("debug", "model.first_token", `TTFT ${ttftMs}ms · model=${usedModel}`, { ms: ttftMs, model: usedModel, stream: "model" }, thread_id);
            }

            chunkCount++;

            try {
              const parsedPiece = JSON.parse(piece);

              if (parsedPiece.type === "tool_call_delta") {
                const delta = parsedPiece.delta;
                let idx = delta.index;

                if (idx === undefined) {
                  if (delta.id) {
                    const existingIdx = Object.keys(toolCallsBuffer).find((k) => toolCallsBuffer[k].id === delta.id);
                    idx = existingIdx !== undefined ? Number(existingIdx) : Object.keys(toolCallsBuffer).length;
                  } else {
                    const lastIdx = Math.max(0, Object.keys(toolCallsBuffer).length - 1);
                    const lastTool = toolCallsBuffer[lastIdx];
                    if (delta.function?.name && lastTool && lastTool.function.arguments.length > 0) {
                      idx = lastIdx + 1;
                    } else {
                      idx = lastIdx;
                    }
                  }
                }

                if (!toolCallsBuffer[idx]) {
                  toolCallsBuffer[idx] = { id: delta.id, type: "function", function: { name: "", arguments: "" } };
                }
                if (delta.id) toolCallsBuffer[idx].id = delta.id;
                if (delta.function?.name) toolCallsBuffer[idx].function.name += delta.function.name;
                if (delta.function?.arguments) toolCallsBuffer[idx].function.arguments += delta.function.arguments;
                if (delta.extra_content) toolCallsBuffer[idx].extra_content = delta.extra_content;
              } else if (parsedPiece.type === "think") {
                assembledThinking += parsedPiece.delta || "";
                send({ type: "think", delta: parsedPiece.delta });
              } else if (parsedPiece.type === "out") {
                assembled += parsedPiece.delta;
                send({ type: "out", delta: parsedPiece.delta, text: parsedPiece.delta });
              }
            } catch (e) {
              assembled += piece;
              send({ type: "out", delta: piece, text: piece });
            }
          }
        } catch (streamError) {
          if (requestAbort.signal.aborted || streamError.message?.includes("Aborted") || streamError.message?.includes("socket hang up")) {
            console.log(`[Orchestrate] Stream intentionally stopped (STOP).`);
            isDone = true;
            break;
          } else {
            throw streamError;
          }
        }

        const turnStreamMs = Math.max(1, Date.now() - tStreamStart);
        cumulativeGenMs += turnStreamMs;

        const turnOutText = (assembled || "") + (assembledThinking || "");
        const turnTokens = approxTokens ? approxTokens(turnOutText) : Math.max(1, Math.round(turnOutText.length / 4));
        const toolArgsText = Object.values(toolCallsBuffer).map(t => (t.function?.name || "") + (t.function?.arguments || "")).join("");
        const toolArgsTokens = approxTokens && toolArgsText ? approxTokens(toolArgsText) : Math.round(toolArgsText.length / 4);
        cumulativeResponseTokens += (turnTokens + toolArgsTokens);

        const rawToolCalls = Object.values(toolCallsBuffer);
        const finalToolCalls = [];

        for (const tc of rawToolCalls) {
          if (tc.function?.name) {
            let funcArgs = tc.function.arguments || "{}";
            try {
              JSON.parse(funcArgs);
            } catch (parseErr) {
              const match = funcArgs.match(/\{[\s\S]*\}/);
              if (match) funcArgs = match[0];
            }
            finalToolCalls.push({
              id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              type: "function",
              function: {
                name: tc.function.name,
                arguments: funcArgs,
              },
              ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
            });
          }
        }

        // Handle Tool Invocations
        if (finalToolCalls.length > 0) {
          formattedMessages.push({
            role: "assistant",
            content: assembled || null,
            tool_calls: finalToolCalls,
          });

          for (const tc of finalToolCalls) {
            const funcName = tc.function.name;
            const funcArgs = tc.function.arguments;
            const normalizedFuncName = funcName.replace(/^tool_tool_/, "tool_").replace(/^skill_skill_/, "skill_");
            const realToolId = toolMap[funcName] || toolMap[normalizedFuncName] || toolMap[funcName.replace(/^(tool_|skill_)/, "")] || funcName;

            send({ type: "tool_status", name: realToolId, status: "running" });
            send({ phase: "tool_running", tool: realToolId });
            const tStart = Date.now();
            emitDebug("info", "tool.exec", `invoking ${realToolId} · turn ${iteration}`, { tool: realToolId, stream: "skills" }, thread_id);

            let toolResultStr = "";
            let toolStatus = "completed";
            let toolDetail = null;

            try {
              const parsedArgs = JSON.parse(funcArgs || "{}");
              const toolContext = {
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
              };

              const resOut = await dispatchToolCall({
                toolCall: tc,
                parsedArgs,
                deps,
                context: toolContext,
              });

              toolResultStr = resOut.toolResultStr;
              toolStatus = resOut.toolStatus;

              if (!toolResultStr && (toolMap[funcName] || toolMap[normalizedFuncName] || realToolId)) {
                const invokeRes = await invokeTool({
                  toolId: realToolId,
                  params: parsedArgs,
                  sessionId: thread_id,
                  agentId: agent_id,
                  provider: finalProviderUsed || prov,
                });
                let outputRes = invokeRes.output ?? invokeRes;
                if (!outputRes || (typeof outputRes === "string" && outputRes.trim() === "") || (Array.isArray(outputRes) && outputRes.length === 0)) {
                  outputRes = "[SYSTEM_WARNING: TOOL_FAILED_OR_EMPTY] The tool executed but returned no useful data.";
                }
                toolResultStr = JSON.stringify(outputRes);
              }
            } catch (err) {
              if (err.name === "ApprovalRequired" || err.invocationId) {
                send({
                  type: "approval_required",
                  phase: "approval_required",
                  invocation_id: err.invocationId,
                  invocationId: err.invocationId,
                  tool: realToolId,
                  toolName: realToolId,
                  reason: err.message || "Approval required",
                });
                toolStatus = "pending";
                toolDetail = err.message;
                toolResultStr = JSON.stringify({ status: "approval_pending", invocationId: err.invocationId, reason: err.message });
              } else {
                console.error(`[Orchestrate] Tool execution error (${funcName}) - Real ID (${realToolId}):`, err.stack || err.message);
                toolResultStr = JSON.stringify({ error: err.message });
                toolStatus = "failed";
                toolDetail = err.message;
              }
            }

            const durationMs = Date.now() - tStart;
            emitDebug("info", "tool.executed", `${realToolId} completed · ${durationMs}ms · status=${toolStatus}`, { tool: realToolId, ms: durationMs, status: toolStatus, stream: "skills" }, thread_id);
            const statusPayload = { type: "tool_status", name: realToolId, status: toolStatus, ms: durationMs || 10 };
            if (toolDetail) statusPayload.detail = toolDetail;
            send(statusPayload);

            formattedMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              name: funcName,
              content: toolResultStr,
            });
          }
        } else {
          // Final conversational turn
          isDone = true;
          const totalMs = Date.now() - t0;
          const usedModelStr = finalProviderUsed?.model_id || finalProviderUsed?.model || model || "gpt-3.5-turbo";
          const sourceNameStr = finalProviderUsed?.provider_name || finalProviderUsed?.name || (finalProviderUsed?.kind === "local" ? "Local sovereign runtime" : "Cloud Provider");
          const provId = finalProviderUsed?.id && finalProviderUsed.id !== "local" ? finalProviderUsed.id : null;

          // Asynchronously save to Semantic Cache
          const finalQuery = String(message || [...messages].reverse().find((m) => m.role === "user")?.content || "").trim();
          if (iteration === 1 && assembled && assembled.trim().length > 0 && finalQuery.length > 2 && !hasExplicitCapabilities) {
            (async () => {
              try {
                const qVec = await embed(finalQuery).catch(() => null);
                await setSemanticCache(qVec, finalQuery, assembled, { model: usedModelStr });
              } catch {}
            })();
          }

          // FinOps Accounting & Telemetry
          const { promptTokens, responseTokens, totalTokens } = calculateTurnTokens({
            formattedMessages,
            assembled,
            assembledThinking,
            approxTokens,
          });

          const costUsd = calculateTurnCost({
            promptTokens,
            responseTokens,
            finalProviderUsed,
          });

          emitDebug("info", "model.responded", `generation complete · ${chunkCount} chunks · ${totalMs}ms`, { ms: totalMs, model: usedModel, tokens: responseTokens, stream: "model" }, thread_id);
          emitDebug("debug", "cost.spend", `estimated usage tokens prompt=${promptTokens} response=${responseTokens}`, { promptTokens, responseTokens, stream: "cost" }, thread_id);

          await persistTurnTelemetry({
            pool,
            thread_id,
            agent_id,
            finalProviderUsed,
            promptTokens,
            responseTokens,
            totalTokens,
            totalMs,
            costUsd,
            usedModelStr,
            sourceNameStr,
            provId,
            assembled,
          });

          send({
            latency: {
              ttftMs: tFirstToken ? tFirstToken - t0 : 0,
              totalMs,
              activeGenMs: Math.max(50, cumulativeGenMs),
              tokensOut: Math.max(1, cumulativeResponseTokens),
              modelOut: usedModelStr,
            },
          });

          send({ type: "done" });
          close();
        }
      } // === END OF RE-ACT AGENTIC LOOP ===

      if (!isDone) {
        send({ type: "error", message: "max agent iterations reached" });
        close();
      }
    } catch (e) {
      if (thread_id) activeStreams.delete(thread_id);
      if (requestAbort.signal.aborted || e.name === "AbortError" || e.message?.includes("aborted")) {
        if (trace) trace("orchestrate.aborted", { reason: "client_disconnected_or_aborted" });
        close();
        return;
      }

      if (trace) trace("orchestrate.error", { error: e.message }, "error");
      send({ type: "error", message: `Core Execution Error: ${e.message}` });
      close();
    }
  });
}
