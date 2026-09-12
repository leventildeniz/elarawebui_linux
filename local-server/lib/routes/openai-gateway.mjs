// local-server/lib/routes/openai-gateway.mjs
// Universal OpenAI-Compatible Sovereign AI Gateway (/v1/chat/completions, /v1/models)
// Supports High-Throughput Streaming (SSE), Redis Semantic Cache, RAG Augmentation, and FinOps Ledger

import crypto from "node:crypto";
import { checkRateLimit, recordRequestEnd } from "../rate-limiter.mjs";
import { getSemanticCache, setSemanticCache } from "../infra/redis-cache.mjs";

export function mountOpenAiGatewayRoutes(app, deps) {
  const { pool, llmProvider, semanticSearch } = deps;

  /**
   * Fast O(1) API Key Authenticator & Tenant Context Resolver
   */
  async function authenticateApiKey(req) {
    const authHeader = req.headers["authorization"] || req.headers["x-api-key"] || "";
    let rawKey = "";

    if (authHeader.startsWith("Bearer ")) {
      rawKey = authHeader.slice(7).trim();
    } else if (authHeader.startsWith("sk-")) {
      rawKey = authHeader.trim();
    } else if (req.query?.key && String(req.query.key).startsWith("sk-")) {
      rawKey = String(req.query.key).trim();
    }

    if (!rawKey) {
      return { ok: false, status: 401, error: "Missing API Key. Provide 'Authorization: Bearer sk-elara-...' header." };
    }

    // SHA-256 hash lookup (<1ms in PostgreSQL)
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

    const query = `
      SELECT k.*, 
             r.name as tier_name, r.rpm_limit, r.tpm_limit, r.monthly_token_quota, r.max_concurrency
      FROM tenant_api_keys k
      LEFT JOIN tenant_rate_limits r ON k.tier = r.tier
      WHERE k.key_hash = $1
      LIMIT 1
    `;

    const { rows } = await pool.query(query, [keyHash]);
    if (!rows.length) {
      return { ok: false, status: 401, error: "Invalid or unknown API Key." };
    }

    const keyRecord = rows[0];

    if (keyRecord.status !== "active") {
      return { ok: false, status: 403, error: `API Key is ${keyRecord.status}. Contact your administrator.` };
    }

    if (keyRecord.expires_at && new Date(keyRecord.expires_at).getTime() < Date.now()) {
      return { ok: false, status: 403, error: "API Key has expired." };
    }

    return { ok: true, keyRecord, rawKey };
  }

  // =========================================================================
  // 1. GET /v1/models — List Available Models & RAG Spaces in OpenAI Standard
  // =========================================================================
  async function handleListModels(req, res) {
    try {
      const auth = await authenticateApiKey(req);
      if (!auth.ok) {
        return res.status(auth.status).json({
          error: { message: auth.error, type: "invalid_request_error", code: auth.status },
        });
      }

      const { keyRecord } = auth;
      const allowedModels = keyRecord.allowed_models || [];

      // Query registered active providers/models from DB
      const { rows: dbProviders } = await pool.query(
        "SELECT id, name, model, active FROM ai_providers WHERE active = true"
      ).catch(() => ({ rows: [] }));

      // Query accessible RAG Spaces
      const { rows: spaces } = await pool.query(
        "SELECT slug, name, description FROM knowledge_spaces ORDER BY name ASC"
      );

      const modelList = [];
      const seen = new Set();

      // Default local sovereign models
      const defaultModels = [
        { id: "gemma-31b-local", owned_by: "elara-sovereign", description: "Local Sovereign Gemma LLM" },
        { id: "elara-smart", owned_by: "elara-sovereign", description: "Smart Multi-Tier Adaptive Router" },
      ];

      for (const dm of defaultModels) {
        if (!allowedModels.length || allowedModels.includes(dm.id)) {
          modelList.push({
            id: dm.id,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: dm.owned_by,
            permission: [],
            root: dm.id,
            parent: null,
          });
          seen.add(dm.id);
        }
      }

      // Add DB configured models
      for (const prov of dbProviders) {
        const mName = prov.model || prov.name;
        if (mName && !seen.has(mName)) {
          if (!allowedModels.length || allowedModels.includes(mName)) {
            modelList.push({
              id: mName,
              object: "model",
              created: Math.floor(Date.now() / 1000),
              owned_by: prov.name || "elara",
              permission: [],
              root: mName,
              parent: null,
            });
            seen.add(mName);
          }
        }
      }

      // Add RAG Spaces as augmented models (e.g., 'technical', 'space:technical')
      for (const sp of spaces) {
        const spaceModelId = `space:${sp.slug}`;
        if (!allowedModels.length || allowedModels.includes(spaceModelId) || allowedModels.includes(sp.slug)) {
          modelList.push({
            id: sp.slug,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "elara-rag-space",
            permission: [],
            root: sp.slug,
            parent: null,
          });
        }
      }

      return res.json({ object: "list", data: modelList });
    } catch (err) {
      console.error("[OpenAI Gateway] Models error:", err);
      return res.status(500).json({
        error: { message: err.message, type: "api_error", code: 500 },
      });
    }
  }

  app.get("/v1/models", handleListModels);
  app.get("/api/v1/models", handleListModels);

  // =========================================================================
  // 2. POST /v1/chat/completions — Universal OpenAI-Compatible Completions API
  // =========================================================================
  async function handleChatCompletions(req, res) {
    const startTime = Date.now();
    let authenticatedKeyRecord = null;
    let computedTokens = 0;

    try {
      // 1. Authenticate API Key
      const auth = await authenticateApiKey(req);
      if (!auth.ok) {
        return res.status(auth.status).json({
          error: { message: auth.error, type: "invalid_request_error", code: auth.status },
        });
      }

      authenticatedKeyRecord = auth.keyRecord;
      const keyRecord = authenticatedKeyRecord;

      const {
        model = "gemma-31b-local",
        messages = [],
        stream = false,
        temperature = 0.7,
        max_tokens = 2048,
      } = req.body || {};

      if (!Array.isArray(messages) || !messages.length) {
        return res.status(400).json({
          error: { message: "The 'messages' array must not be empty.", type: "invalid_request_error", code: 400 },
        });
      }

      // Model Access Control check
      if (keyRecord.allowed_models && keyRecord.allowed_models.length > 0) {
        if (!keyRecord.allowed_models.includes(model) && !keyRecord.allowed_models.includes(`space:${model}`)) {
          return res.status(403).json({
            error: {
              message: `Your API key does not have permission to access model '${model}'. Allowed models: ${keyRecord.allowed_models.join(", ")}`,
              type: "permission_error",
              code: 403,
            },
          });
        }
      }

      // 2. Pre-Flight Rate Limit & Quota Validation (Redis <1ms)
      const rateCheck = await checkRateLimit(keyRecord, 150);
      if (!rateCheck.allowed) {
        // Set standard rate limit headers
        for (const [hKey, hVal] of Object.entries(rateCheck.headers || {})) {
          res.setHeader(hKey, hVal);
        }
        return res.status(rateCheck.status || 429).json({
          error: {
            message: rateCheck.reason,
            type: rateCheck.status === 402 ? "insufficient_quota" : "rate_limit_error",
            code: rateCheck.status || 429,
          },
        });
      }

      // Apply remaining rate limit headers to response
      for (const [hKey, hVal] of Object.entries(rateCheck.headers || {})) {
        res.setHeader(hKey, hVal);
      }

      // 3. Extract Latest User Prompt
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
      const promptTokensEstimate = Math.max(1, Math.ceil(JSON.stringify(messages).length / 4));

      // 4. Redis Semantic Cache Check (Instant 0ms / $0.00 Hit)
      const cached = await getSemanticCache(null, lastUserMsg, model);
      if (cached.hit && cached.response) {
        const completionId = `chatcmpl-${crypto.randomBytes(12).toString("hex")}`;
        const respTokens = Math.max(1, Math.ceil(cached.response.length / 4));
        computedTokens = promptTokensEstimate + respTokens;

        // Async FinOps Telemetry Log
        pool.query(
          `INSERT INTO provider_usage (
             provider_name, kind, model, prompt_tokens, response_tokens, total_tokens,
             latency_ms, status, cache_hits, cost_usd, api_key_id, tenant_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            "elara-redis-cache",
            "llm",
            model,
            promptTokensEstimate,
            respTokens,
            computedTokens,
            Date.now() - startTime,
            "ok",
            1,
            0.0, // Free cache hit
            keyRecord.id,
            keyRecord.tenant_id,
          ]
        ).catch(() => {});

        // Asynchronously update last used
        pool.query("UPDATE tenant_api_keys SET last_used_at = now() WHERE id = $1", [keyRecord.id]).catch(() => {});
        recordRequestEnd(keyRecord, computedTokens).catch(() => {});

        if (stream) {
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("x-cache", "HIT");

          const chunkPayload = {
            id: completionId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { content: cached.response }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
          res.write(`data: [DONE]\n\n`);
          return res.end();
        }

        return res.json({
          id: completionId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: cached.response },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: promptTokensEstimate,
            completion_tokens: respTokens,
            total_tokens: computedTokens,
          },
        });
      }

      // 5. Check if Model corresponds to a RAG Knowledge Space
      let augmentedMessages = [...messages];
      const { rows: spaceMatch } = await pool.query(
        "SELECT slug, name FROM knowledge_spaces WHERE slug = $1 OR slug = $2 LIMIT 1",
        [model.replace(/^space:/, ""), model]
      );

      if (spaceMatch.length > 0) {
        const space = spaceMatch[0];
        try {
          // Perform vector & keyword semantic search across space chunks
          const ragResults = await semanticSearch(lastUserMsg, {
            spaceId: space.slug,
            topK: 4,
            threshold: 0.35,
          });

          if (ragResults && ragResults.length > 0) {
            const contextText = ragResults
              .map((r, i) => `[Source ${i + 1}: ${r.title || r.filename || space.name}]\n${r.content}`)
              .join("\n\n---\n\n");

            const ragSystemInstruction = {
              role: "system",
              content: `You are an enterprise AI assistant for space '${space.name}'. Use the following verified corporate knowledge context to answer accurately with citation brackets:\n\n${contextText}`,
            };
            augmentedMessages.unshift(ragSystemInstruction);
          }
        } catch (ragErr) {
          console.warn("[OpenAI Gateway] RAG lookup notice:", ragErr.message);
        }
      }

      // 6. Execute Stream via LLM Provider
      const abortController = new AbortController();
      req.on("close", () => abortController.abort());

      const streamIterator = await llmProvider.stream({
        messages: augmentedMessages,
        signal: abortController.signal,
      });

      const completionId = `chatcmpl-${crypto.randomBytes(12).toString("hex")}`;
      let fullResponseText = "";

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("x-cache", "MISS");

        for await (const chunk of streamIterator) {
          fullResponseText += chunk;
          const chunkPayload = {
            id: completionId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
        }

        // Final finish chunk
        const finishPayload = {
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(finishPayload)}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
      } else {
        // Collect non-streaming response
        for await (const chunk of streamIterator) {
          fullResponseText += chunk;
        }

        const respTokens = Math.max(1, Math.ceil(fullResponseText.length / 4));
        computedTokens = promptTokensEstimate + respTokens;

        res.json({
          id: completionId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: fullResponseText },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: promptTokensEstimate,
            completion_tokens: respTokens,
            total_tokens: computedTokens,
          },
        });
      }

      // 7. Post-Flight: Cache, Ledger & Rate Limit Accounting
      const respTokens = Math.max(1, Math.ceil(fullResponseText.length / 4));
      computedTokens = promptTokensEstimate + respTokens;
      const durationMs = Date.now() - startTime;

      // Calculate dynamic cost based on model card input_cost / output_cost tariffs
      let inputRate = 0.60;
      let outputRate = 0.60;
      try {
        const { rows: mCostRows } = await pool.query(
          "SELECT input_cost, output_cost FROM models WHERE model_id = $1 OR name = $1 OR id = $1 LIMIT 1",
          [model]
        );
        if (mCostRows[0]) {
          inputRate = Number(mCostRows[0].input_cost ?? 0.60);
          outputRate = Number(mCostRows[0].output_cost ?? 0.60);
        }
      } catch {}

      const costUsd = Number(
        (
          (promptTokensEstimate / 1000000) * inputRate +
          (respTokens / 1000000) * outputRate
        ).toFixed(6)
      );

      // Save to Redis Semantic Cache for future instant hits
      setSemanticCache(null, lastUserMsg, fullResponseText, { model }, 86400).catch(() => {});

      // Record in provider_usage ledger
      pool.query(
        `INSERT INTO provider_usage (
           provider_name, kind, model, prompt_tokens, response_tokens, total_tokens,
           latency_ms, status, cache_hits, cost_usd, api_key_id, tenant_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          "elara-gateway",
          "llm",
          model,
          promptTokensEstimate,
          respTokens,
          computedTokens,
          durationMs,
          "ok",
          0,
          costUsd,
          keyRecord.id,
          keyRecord.tenant_id,
        ]
      ).catch(() => {});

      pool.query("UPDATE tenant_api_keys SET last_used_at = now() WHERE id = $1", [keyRecord.id]).catch(() => {});
      recordRequestEnd(keyRecord, computedTokens).catch(() => {});

    } catch (err) {
      console.error("[OpenAI Gateway] Execution error:", err);
      if (authenticatedKeyRecord) {
        recordRequestEnd(authenticatedKeyRecord, 0).catch(() => {});
      }
      if (!res.headersSent) {
        return res.status(500).json({
          error: { message: err.message, type: "api_error", code: 500 },
        });
      }
      res.end();
    }
  }

  app.post("/v1/chat/completions", handleChatCompletions);
  app.post("/api/v1/chat/completions", handleChatCompletions);
}
