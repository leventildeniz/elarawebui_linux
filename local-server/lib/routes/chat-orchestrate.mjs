import { randomUUID } from "crypto";
import { resolveCredential } from "../vault.mjs";
import http from "http";
import https from "https";
import { URL } from "url";
import { ragProbeAndFetch } from "../rag/retrieval.mjs";

function mapJsonSchemaType(t) {
  const x = String(t || "string").toLowerCase();
  if (x === "number" || x === "int" || x === "integer" || x === "float") return "number";
  if (x === "bool" || x === "boolean") return "boolean";
  if (x === "object" || x === "json") return "object";
  if (x === "array") return "array";
  return "string";
}

// --- NATIVE STREAM REQUEST (TCP KILLER) ---
// Standard Node.js fetch does not immediately tear down sockets on abort due to draining.
// Local engines (Llama.cpp / Gemma) continue token generation unless the TCP socket is forcefully killed.
// This wrapper sends an immediate TCP RST destruction when an abort signal is received.
async function nativeStreamRequest(urlStr, options, payloadStr, signal) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const lib = parsedUrl.protocol === 'https:' ? https : http;
      
      if (payloadStr) {
        // Enforce Content-Length header on POST payloads to prevent socket hang up on strict servers
        options.headers['Content-Length'] = Buffer.byteLength(payloadStr);
      }

      console.log(`\n[TCP-KILLER] ➔ Request Dispatching: ${options.method || 'POST'} ${urlStr}`);
      console.log(`[TCP-KILLER] ➔ Headers:`, JSON.stringify(options.headers));
      if (payloadStr) {
         console.log(`[TCP-KILLER] ➔ Payload (first 300 chars):`, payloadStr.substring(0, 300) + (payloadStr.length > 300 ? '...' : ''));
      }

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'POST',
        headers: {
            "Accept": "*/*",
            "User-Agent": "Elara-Orchestrator/1.0",
            ...options.headers
        },
        agent: false // Spawn fresh request connections without pooling
      };

      let responseObj = null;
      const llmReq = lib.request(reqOptions, (llmRes) => {
        responseObj = llmRes;
        resolve({
          ok: llmRes.statusCode >= 200 && llmRes.statusCode < 300,
          status: llmRes.statusCode,
          text: async () => {
             let body = '';
             for await (const chunk of llmRes) body += chunk;
             return body;
          },
          body: llmRes
        });
      });

      llmReq.on('error', (err) => {
        console.error(`[TCP-KILLER] Request Error to ${parsedUrl.hostname}:${reqOptions.port}: ${err.message}`);
        reject(err);
      });

      if (signal) {
        if (signal.aborted) {
          llmReq.destroy(new Error('Aborted before request started'));
          return reject(new Error('Aborted before request started'));
        }
        signal.addEventListener('abort', () => {
          console.log(`\n🚨 [TCP-KILLER] 🚨 ABORT SIGNAL RECEIVED -> Destroying TCP socket for ${parsedUrl.hostname}!`);
          
          if (responseObj) {
            responseObj.destroy(new Error("Client Aborted"));
          }
          if (llmReq.socket) {
             llmReq.socket.destroy(); 
          }
          llmReq.destroy(new Error("Client Aborted"));
        });
      }

      if (payloadStr) {
        llmReq.write(payloadStr);
      }
      llmReq.end();
    } catch (err) {
      reject(err);
    }
  });
}

export async function mountChatOrchestrateRoutes(app, deps) {
  const { pool, getRagSettings, approxTokens, calculateAIQuality, recordUsage, trace, invokeTool } = deps;
  console.log("[Chat Orchestrate] approxTokens available:", !!approxTokens);

  // GLOBAL STREAM MAP: Track in-flight streams for explicit cancel/stop signals
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

  // --- LLM DIALECT ADAPTERS ---

  // Anthropic (Claude) API dialect adapter
  async function fetchAnthropicStream(provider, baseUrl, apiKey, targetModel, messages, tools, signal) {
    let systemPrompt = "";
    const anthropicMessages = [];
  
    for (const m of messages) {
      if (m.role === "system") {
        let textContent = Array.isArray(m.content) ? m.content.find(c => c.type === 'text')?.text || "" : m.content;
        systemPrompt += (systemPrompt ? "\n" : "") + textContent;
      } else {
        let content = m.content;
        
        // Anthropic tool mapping from OpenAI format
        if (m.tool_calls && m.tool_calls.length > 0) {
           const blocks = [];
           if (typeof content === "string" && content) {
               blocks.push({ type: "text", text: content });
           }
           for (const tc of m.tool_calls) {
               blocks.push({
                   type: "tool_use",
                   id: tc.id,
                   name: tc.function.name,
                   input: JSON.parse(tc.function.arguments || "{}")
               });
           }
           content = blocks;
        } else if (m.role === "tool") {
           m.role = "user";
           content = [{
               type: "tool_result",
               tool_use_id: m.tool_call_id,
               content: m.content
           }];
        }

        if (Array.isArray(content)) {
          content = content.map(c => {
             if (c.type === "image_url") {
                const url = c.image_url.url;
                const match = url.match(/^data:(image\/[^;]+);(?:[^,]*;)?base64,(.+)$/);
                if (match) {
                   return {
                      type: "image",
                      source: {
                         type: "base64",
                         media_type: match[1],
                         data: match[2]
                      }
                   };
                }
                // URL ise (base64 değilse) Anthropic düz URL'yi block olarak desteklemez, bunu text olarak verelim.
                return { type: "text", text: `[Image URL: ${url}]` };
             }
             return c;
          });
        }
        anthropicMessages.push({ role: m.role, content: content });
      }
    }

    // Anthropic API requires alternating user/assistant roles.
    // Combine consecutive messages of the same role.
    const consolidatedMessages = [];
    for (const m of anthropicMessages) {
        if (consolidatedMessages.length > 0) {
            const last = consolidatedMessages[consolidatedMessages.length - 1];
            if (last.role === m.role) {
                // Ensure both are arrays before combining
                let lastContent = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
                let currentContent = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
                last.content = lastContent.concat(currentContent);
                continue;
            }
        }
        consolidatedMessages.push(m);
    }

    // Anthropic Tool Formatı OpenAI'dan farklıdır
    let anthropicTools = undefined;
    if (tools && tools.length > 0) {
        anthropicTools = tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters
        }));
    }

    const temp = provider?.temperature !== undefined && provider?.temperature !== null ? Number(provider.temperature) : 0.7;
    const topP = provider?.top_p !== undefined && provider?.top_p !== null ? Number(provider.top_p) : undefined;
    const maxTokens = provider?.max_tokens !== undefined && provider?.max_tokens !== null ? Number(provider.max_tokens) : 4096;

    const payload = {
        model: targetModel,
        system: systemPrompt || undefined,
        messages: consolidatedMessages,
        max_tokens: maxTokens,
        stream: true,
        temperature: temp,
        ...(topP !== undefined ? { top_p: topP } : {})
    };

    if (Array.isArray(anthropicTools) && anthropicTools.length > 0) {
        payload.tools = anthropicTools;
    }

    // Stop Sequences
    if (provider?.stop_sequences) {
        let stops = [];
        if (Array.isArray(provider.stop_sequences)) {
            stops = provider.stop_sequences;
        } else if (typeof provider.stop_sequences === "string") {
            try { stops = JSON.parse(provider.stop_sequences); } catch { stops = provider.stop_sequences.split(/[\n,]/).map(s => s.trim()).filter(Boolean); }
        }
        if (stops.length > 0) {
            payload.stop_sequences = stops;
        }
    }

    const res = await nativeStreamRequest(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "messages-2023-12-15" // Gerekirse
      }
    }, JSON.stringify(payload), signal);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic API returned ${res.status}: ${errText}`);
    }

    return (async function* () {
      const decoder = new TextDecoder();
      const reader = res.body?.getReader?.();
      
      try {
        if (reader) {
           let buffer = "";
           while (true) {
             const { done, value } = await reader.read();
             if (done) break;
             buffer += decoder.decode(value, { stream: true });
             const lines = buffer.split('\n');
             buffer = lines.pop() || "";

             for (const line of lines) {
               const trimmed = line.trim();
               if (trimmed.startsWith('data: ')) {
                 const dataStr = trimmed.slice(6).trim();
                 if (dataStr) {
                   try {
                     const parsed = JSON.parse(dataStr);
                     if (parsed.type === 'message_stop') return;
                     if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                       yield JSON.stringify({ type: "out", delta: parsed.delta.text });
                     }
                     if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                        yield JSON.stringify({ 
                           type: "tool_call_delta", 
                           delta: { index: parsed.index, id: parsed.content_block.id, function: { name: parsed.content_block.name, arguments: "" } }
                        });
                     }
                     if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
                        yield JSON.stringify({ 
                           type: "tool_call_delta", 
                           delta: { index: parsed.index, function: { arguments: parsed.delta.partial_json } }
                        });
                     }
                   } catch (e) {}
                 }
               }
             }
           }
        } else {
           let buffer = "";
           for await (const chunk of res.body) {
             buffer += decoder.decode(chunk, { stream: true });
             const lines = buffer.split('\n');
             buffer = lines.pop() || "";

             for (const line of lines) {
               const trimmed = line.trim();
               if (trimmed.startsWith('data: ')) {
                 const dataStr = trimmed.slice(6).trim();
                 if (dataStr) {
                   try {
                     const parsed = JSON.parse(dataStr);
                     if (parsed.type === 'message_stop') return;
                     if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                       yield JSON.stringify({ type: "out", delta: parsed.delta.text });
                     }
                     if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                        yield JSON.stringify({ 
                           type: "tool_call_delta", 
                           delta: { index: parsed.index, id: parsed.content_block.id, function: { name: parsed.content_block.name, arguments: "" } }
                        });
                     }
                     if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'input_json_delta') {
                        yield JSON.stringify({ 
                           type: "tool_call_delta", 
                           delta: { index: parsed.index, function: { arguments: parsed.delta.partial_json } }
                        });
                     }
                   } catch (e) {}
                 }
               }
             }
           }
        }
      } finally {
        if (reader) {
            try { await reader.cancel(); } catch(e) {}
            try { reader.releaseLock(); } catch(e) {}
        }
      }
    })();
  }

    // Standart OpenAI Uyumlu Streamer (Ollama, vLLM, LMStudio, Google vb.)
  async function fetchOpenAIStream(provider, baseUrl, apiKey, targetModel, messages, tools, signal, effort) {
    let requestUrl = `${baseUrl}/chat/completions`;
    if (baseUrl.includes("generativelanguage.googleapis.com") && !requestUrl.includes("/openai/")) {
        requestUrl = baseUrl.replace(/\/$/, "") + "/openai/chat/completions";
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (apiKey && apiKey !== "dummy-key") {
        headers["Authorization"] = `Bearer ${apiKey}`;
        if (baseUrl.includes("generativelanguage.googleapis.com")) {
            headers["x-goog-api-key"] = apiKey;
        }
    }

    const temp = provider?.temperature !== undefined && provider?.temperature !== null ? Number(provider.temperature) : 0.7;
    const topP = provider?.top_p !== undefined && provider?.top_p !== null ? Number(provider.top_p) : undefined;
    const topK = provider?.top_k !== undefined && provider?.top_k !== null ? Number(provider.top_k) : undefined;
    const repPenalty = provider?.repetition_penalty !== undefined && provider?.repetition_penalty !== null ? Number(provider.repetition_penalty) : undefined;
    const maxTokens = provider?.max_tokens !== undefined && provider?.max_tokens !== null ? Number(provider.max_tokens) : 4096;

    // Detect if target endpoint is a local engine (Llama.cpp / vLLM / Ollama)
    const isLocalEngine = baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost") || baseUrl.includes("192.168.") || baseUrl.includes(":8000") || baseUrl.includes(":8001") || baseUrl.includes(":11434");

    const payload = {
      model: targetModel,
      messages,
      stream: true,
      temperature: temp,
      max_tokens: maxTokens,
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(isLocalEngine && topK !== undefined ? { top_k: topK } : {}),
      ...(isLocalEngine && repPenalty !== undefined ? { repetition_penalty: repPenalty, repeat_penalty: repPenalty } : {})
    };

    // OpenAI o1 ve Gemini 3.1+ gibi reasoning modellerine özel effort parametresi desteği
    if (effort && effort !== "none" && (targetModel.includes("o1") || targetModel.includes("o3") || targetModel.toLowerCase().includes("gemini"))) {
       if (targetModel.toLowerCase().includes("gemini")) {
           // Gemini 3.x modellerinde OpenAI compatibility API'sinde thinking_config'i
           // doğrudan root'a koymak 400 hatası veriyor.
           // Doğru format: "extra_body": { "google": { "thinking_config": { "thinking_level": effort, "include_thoughts": true } } }
           payload.extra_body = {
               google: {
                   thinking_config: {
                       thinking_level: effort,
                       include_thoughts: true
                   }
               }
           };
       } else {
           payload.reasoning_effort = effort;
       }
    }

    if (provider.advanced && Array.isArray(provider.advanced)) {
        for (const p of provider.advanced) {
            if (!p.key) continue;
            let val = p.value;
            if (val === "true") val = true;
            else if (val === "false") val = false;
            else if (!isNaN(Number(val))) val = Number(val);
            payload[p.key] = val;
        }
    }

    // Stop Sequences (Durdurma Dizilimleri)
    if (provider.stop_sequences) {
        let stops = [];
        if (Array.isArray(provider.stop_sequences)) {
            stops = provider.stop_sequences;
        } else if (typeof provider.stop_sequences === "string") {
            try { stops = JSON.parse(provider.stop_sequences); } catch { stops = provider.stop_sequences.split(/[\n,]/).map(s => s.trim()).filter(Boolean); }
        }
        if (stops.length > 0) {
            payload.stop = stops;
        }
    }

    if (Array.isArray(tools) && tools.length > 0) {
       payload.tools = tools;
    }

    const res = await nativeStreamRequest(requestUrl, {
      method: "POST",
      headers
    }, JSON.stringify(payload), signal);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[fetchOpenAIStream] ❌ LLM API returned ${res.status} for ${targetModel} at ${requestUrl}:`, errText);
      throw new Error(`LLM API returned ${res.status}: ${errText}`);
    }

    return (async function* () {
      const decoder = new TextDecoder();
      const reader = res.body?.getReader?.();
      let inThought = false;

      function* handleContent(content) {
        if (!content || content === "null") return;

        if (content.includes("<think>")) {
          inThought = true;
          content = content.replace("<think>", "");
        }
        if (content.includes("</think>")) {
          inThought = false;
          const parts = content.split("</think>");
          if (parts[0]) yield JSON.stringify({ type: "think", delta: parts[0] });
          if (parts[1]) yield JSON.stringify({ type: "out", delta: parts[1] });
          return;
        }
        if (content.includes("<thought>")) {
          inThought = true;
          content = content.replace("<thought>", "");
        }
        if (content.includes("</thought>")) {
          inThought = false;
          const parts = content.split("</thought>");
          if (parts[0]) yield JSON.stringify({ type: "think", delta: parts[0] });
          if (parts[1]) yield JSON.stringify({ type: "out", delta: parts[1] });
          return;
        }

        if (inThought) {
          yield JSON.stringify({ type: "think", delta: content });
        } else {
          yield JSON.stringify({ type: "out", delta: content });
        }
      }

      try {
        if (reader) {
           let buffer = "";
           while (true) {
             const { done, value } = await reader.read();
             if (done) break;
             buffer += decoder.decode(value, { stream: true });
             const lines = buffer.split('\n');
             buffer = lines.pop() || "";
             for (const line of lines) {
               const trimmed = line.trim();
               if (trimmed.startsWith('data: ')) {
                 const dataStr = trimmed.slice(6).trim();
                 if (dataStr === '[DONE]') return;
                 if (dataStr) {
                   try {
                     const parsed = JSON.parse(dataStr);
                     const deltaObj = parsed.choices?.[0]?.delta || {};

                     if (deltaObj.tool_calls) {
                         for (const tc of deltaObj.tool_calls) {
                             yield JSON.stringify({ type: "tool_call_delta", delta: tc });
                         }
                         continue;
                     }

                     if (deltaObj.reasoning_content) {
                       yield JSON.stringify({ type: "think", delta: deltaObj.reasoning_content });
                     }
                   
                     const content = deltaObj.content || parsed.message?.content || parsed.content || "";
                     if (content && content !== "null") {
                       yield* handleContent(content);
                     }
                   } catch (e) {}
                 }
               }
             }
           }
        } else {
           let buffer = "";
           for await (const chunk of res.body) {
             buffer += decoder.decode(chunk, { stream: true });
             const lines = buffer.split('\n');
             buffer = lines.pop() || "";
           
             for (const line of lines) {
               const trimmed = line.trim();
               if (trimmed.startsWith('data: ')) {
                 const dataStr = trimmed.slice(6).trim();
                 if (dataStr === '[DONE]') return;
                 if (dataStr) {
                   try {
                     const parsed = JSON.parse(dataStr);
                     const deltaObj = parsed.choices?.[0]?.delta || {};

                     if (deltaObj.tool_calls) {
                         for (const tc of deltaObj.tool_calls) {
                             yield JSON.stringify({ type: "tool_call_delta", delta: tc });
                         }
                         continue;
                     }

                     if (deltaObj.reasoning_content) {
                       yield JSON.stringify({ type: "think", delta: deltaObj.reasoning_content });
                     }
                   
                     const content = deltaObj.content || parsed.message?.content || parsed.content || "";
                     if (content && content !== "null") {
                       yield* handleContent(content);
                     }
                   } catch (e) {}
                 }
               }
             }
           }
        }
      } finally {
        if (reader) {
            try { await reader.cancel(); } catch(e) {}
            try { reader.releaseLock(); } catch(e) {}
        }
      }
    })();
  }

  async function streamFromProvider({ provider, messages, tools, signal, effort }) {
    const baseUrl = (provider.model_base_url || provider.base_url || "http://127.0.0.1:8000/v1").replace(/\/$/, "");
    let apiKeyRef = provider.model_api_key || provider.secret_id || "dummy-key"; 
    
    // Resolve credentials via Vault URI or raw prefix
    let apiKey = await resolveCredential(pool, apiKeyRef, "api_key");

    if (!apiKey || apiKey.trim() === "") {
        apiKey = "dummy-key";
    }

    const targetModel = provider.model_id || provider.model || "default";
    console.log(`[Streamer] API Key Status for ${targetModel}:`, apiKey === "dummy-key" ? "Dummy" : "Valid Key");

    let finalMessages = messages.filter(m => {
        if (!m) return false;
        if (m.tool_calls && m.tool_calls.length > 0) return true;
        if (m.role === "tool") return true;
        
        if (!m.content) return false;
        if (typeof m.content === "string") return m.content.trim() !== "";
        return Array.isArray(m.content) && m.content.length > 0;
    });
    if (provider.system_prompt) {
        finalMessages = [ { role: "system", content: provider.system_prompt }, ...finalMessages ];
    }

    // Extended timeout (120s) for cold local LLM prompt ingestion
    const timeoutMs = 120000;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    if (signal) {
        if (signal.aborted) {
            clearTimeout(id);
            controller.abort();
        } else {
            signal.addEventListener("abort", () => {
                clearTimeout(id);
                controller.abort();
            });
        }
    }

    try {
        console.log(`[Streamer] Dispatching request to: ${baseUrl} (Model: ${targetModel})`);
      
        let iterator;
        if (baseUrl.includes("api.anthropic.com")) {
           iterator = await fetchAnthropicStream(provider, baseUrl, apiKey, targetModel, finalMessages, tools, controller.signal);
        } else {
           iterator = await fetchOpenAIStream(provider, baseUrl, apiKey, targetModel, finalMessages, tools, controller.signal, effort);
        }

        clearTimeout(id);
        console.log(`[Streamer] Connection established, stream starting...`);
        return iterator;
      
    } catch (err) {
        clearTimeout(id);
        throw new Error(`Connection to LLM failed: ${err.message}`);
    }
  }

  app.post("/api/chat/orchestrate", async (req, res) => {
    const thread_id = req.body?.thread_id || req.body?.threadId;
    const agent_id = req.body?.agent_id || req.body?.agentId;
    const { model, messages = [], capabilities, web_search, useRag, routing_mode, effort = "high", context: threadContext } = req.body ?? {};

    // RBAC Security Context resolution
    let actorId = null;
    let actorCtx = null;
    if (deps.resolveActorContext) {
       try {
          actorCtx = await deps.resolveActorContext(req);
          actorId = actorCtx?.username || actorCtx?.user?.name || req.session?.username || actorCtx?.userId || req.actor || null;
       } catch(e) {
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
      let t0 = Date.now();
      let tFirstToken = 0;

      // 2. Resolve Provider & Model from DB using Routing Mode Logic
      let prov = null;
      let availableModels = [];

      // Query all active studio models
      const dbRes = await pool.query(`
        SELECT
          m.id as model_pk, m.name as model_name, m.model_id, m.base_url as model_base_url, m.api_key_ref as model_api_key, m.system_prompt,
          m.input_cost, m.output_cost, m.provider_id, m.advanced, m.think_enabled, m.think_statement,
          m.temperature, m.top_p, m.top_k, m.repetition_penalty, m.max_tokens, m.context_window,
          m.stop_sequences, m.chat_template,
          p.id as provider_pk, p.name as provider_name, p.base_url, p.secret_id, p.priority
        FROM models m
        LEFT JOIN ai_providers p ON m.provider_id = p.id
        WHERE m.enabled = true AND (p.active IS NULL OR p.active = true)
      `);
      
      // Query fallback AI Providers from settings
      const fallbackProvidersRes = await pool.query(`
        SELECT 
          id as provider_pk, name as provider_name, base_url, secret_id, priority, model as model_id
        FROM ai_providers 
        WHERE active = true AND kind = 'llm'
      `);

      availableModels = [...dbRes.rows];
      
      // Map standalone AI providers into model candidates
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
             advanced: []
          });
      }

      if (availableModels.length === 0) {
         console.error("[Orchestrate] FATAL: No active AI provider/model found in DB!");
         throw new Error("No active AI provider/model found in DB.");
      }

      console.log(`\n===========================================`);
      console.log(`[Orchestrate] Request Model ID: ${model}, UI Routing Mode: ${routing_mode}, Effort: ${effort}`);

      // Fetch global system routing policy
      let sysRoutingMode = "failover";
      let allowOverride = true;
      try {
          const rRow = await pool.query("SELECT value FROM system_config WHERE key = 'routing_policy'");
          if (rRow.rows.length > 0 && rRow.rows[0].value) {
              const parsedConfig = typeof rRow.rows[0].value === 'string' ? JSON.parse(rRow.rows[0].value) : rRow.rows[0].value;
              sysRoutingMode = parsedConfig.mode || "failover";
              if (parsedConfig.allowUserOverride === false) allowOverride = false;
          }
      } catch(e) { }

      const finalRoutingMode = (routing_mode && allowOverride) ? routing_mode : sysRoutingMode;
      console.log(`[Orchestrate] Final Routing Mode Applied: ${finalRoutingMode} (SysMode: ${sysRoutingMode}, OverrideAllowed: ${allowOverride})`);

      // Provider chain resolution
      let providerChain = [];
      if (finalRoutingMode === "manual_only" || finalRoutingMode === "single") {
          const m = availableModels.find(m => m.model_pk === model || m.model_id === model);
          if (m) providerChain.push(m);
      } else if (finalRoutingMode === "cheapest_first" || finalRoutingMode === "cheapest") {
          availableModels.sort((a, b) => (Number(a.input_cost) + Number(a.output_cost)) - (Number(b.input_cost) + Number(b.output_cost)));
          providerChain = availableModels;
      } else if (finalRoutingMode === "round_robin") {
          global._elaraRrIndex = (global._elaraRrIndex || 0) + 1;
          const startIndex = global._elaraRrIndex % availableModels.length;
          providerChain = [
              ...availableModels.slice(startIndex),
              ...availableModels.slice(0, startIndex)
          ];
      } else {
          // Default: failover. Requested model first, then sorted by priority.
          availableModels.sort((a, b) => Number(a.priority) - Number(b.priority));
          const reqModel = availableModels.find(m => m.model_pk === model || m.model_id === model);
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

      console.log(`[Orchestrate] Primary Provider Selected: ${prov.model_name} (Backup count: ${providerChain.length - 1})`);
      console.log(`[Orchestrate] Final URL: ${prov.model_base_url || prov.base_url}`);
      console.log(`===========================================\n`);
      
      send({ phase: "policy", meta: { source: `provider:${sourceName}`, model: usedModel } });
      
      // 3. Format messages and multimodal support
      const formattedMessages = messages.map(m => {
        let safeRole = m.role || "user";
        if (safeRole === "agent") safeRole = "assistant";

        let safeContent = m.content || m.text || "";

        if (Array.isArray(m.content)) {
            safeContent = m.content;
        }

        return {
          role: safeRole,
          content: safeContent
        };
      });

      // 3.1. Master System Directives (Sovereignty, Tri-Tier Autonomy, MetaForge, Search & Honesty)
      const masterDirectives = [
        `[SOVEREIGN CORE DIRECTIVE]: You are ELARA, an enterprise-grade autonomous AI engine. You operate with absolute technical accuracy, intelligence, zero guessing, and adaptive execution.`,
        `[LANGUAGE & RESPONSE DIRECTIVE]: Always respond in the same language as the user's prompt (e.g. Turkish if the user writes in Turkish). Maintain a clear, professional, and structured tone.`,
        `[DECISION HIERARCHY & TASK ROUTING]:
When the user asks you a question or assigns a task, intelligently apply the following 3-tier decision framework:

1. TIER 1 — NATIVE REASONING & COMPUTATION (Solve Instantly in <think>):
   - For algorithmic logic, subnetting / IP CIDR calculations, mathematical equations, data structure transformations, text/code refactoring, regex synthesis, and RFC standard derivations:
   - YOU DO NOT NEED AN EXTERNAL TOOL OR METAFORGE.
   - Use your internal deep reasoning (<think>) to solve the problem with 100% mathematical precision and answer immediately.

2. TIER 2 — LIVE INFORMATION & WEB SEARCH (Use 'sys_web_search'):
   - For current events, public news, documentation lookup, general web queries, or factual real-time search:
   - Use 'sys_web_search' to query the live internet via search engines (Tavily / SearXNG / DuckDuckGo).

3. TIER 3 — SPECIALIZED CAPABILITIES, WORKFLOWS, CHAINS & METAFORGE:
   - For live network socket checks (SSL, DNS probe), private/public API interactions (Docker Hub, CoinGecko, GitHub, Jira), device integrations, custom Python scripts, or ANY request to CREATE/SYNTHESIZE a new tool, skill, agent, automated WORKFLOW (DAG), or ORCHESTRATION CHAIN:
   - First, inspect your catalog via 'sys_get_directory' to see if existing tools or workflows can satisfy the request.
   - If the user asks to CREATE, SYNTHESIZE, or REGISTER a new tool, skill, agent, workflow (DAG), or orchestration chain (or if required capabilities are missing), you MUST CALL 'sys_delegate_to_metaforge' with a detailed 'intent' explaining the pipeline, workflows, and branch logic.
   - NEVER fabricate or invent a fake plan ID (e.g. 'mf_...') in text without calling 'sys_delegate_to_metaforge'. An approval card is ONLY generated when you invoke the 'sys_delegate_to_metaforge' function.

[HONESTY & ANTI-HALLUCINATION MANDATE]:
- NEVER invent, simulate, or hallucinate dynamic external state (such as live trading prices, live API responses, live socket certificates, or remote hardware states) without executing a tool.
- If a tool or web search execution fails or returns an error, report the failure honestly. NEVER pretend a failed tool succeeded.
- When asked about existing workflows, pipelines, orchestrations, tools, or agents in the system, use 'sys_get_directory' to inspect the actual registered records.
- Report exact artifact names and IDs from the directory or MetaForge plan. NEVER invent or hallucinate alternative names for registered workflows, chains, or tools.

[METAFORGE PRESENTATION & ARTIFACT NAMING DIRECTIVE]:
- When presenting proposed capabilities or created workflows/tools to the user in chat (and answering what was created):
  * Use the human 'name' (e.g. "SSL Expiry Monitor Workflow") as the primary title in text and tables.
  * In tables, include the human name in the 'İsim' (Name) column and the technical identifier in the 'ID / Slug' column (e.g. 'ssl-monitor-workflow' or 'wf_ssl-monitor-workflow').
  * When referring to a workflow in conversation, use its human display name so it matches 1:1 with what the user sees on the '/flows' Canvas tab and in the Studio catalog.`,
      ];

      if (useRag) {
        masterDirectives.push(`[ENTERPRISE RAG DIRECTIVE]: The Knowledge Hub (RAG) is active. You MUST use 'sys_get_directory' to discover expert 'Librarian' agents with access to internal documents, and use 'sys_delegate_to_agent' before answering questions requiring internal organizational knowledge. Do not hallucinate internal company data.`);
      }

      if (threadContext) {
        masterDirectives.push(`[THREAD CONTEXT (STANDING INSTRUCTIONS)]: ${threadContext}`);
      }

      if (prov && prov.think_enabled && prov.think_statement) {
        masterDirectives.push(prov.think_statement);
      }

      if (effort === "high") {
        masterDirectives.push(`[THINKING EFFORT: HIGH] You MUST engage in deep, multi-step deliberation before answering. Break down the problem, explore edge cases, verify your assumptions, and provide a highly detailed, comprehensive response. ALL your internal thoughts, brainstorming, and step-by-step logic MUST be strictly enclosed within <think> and </think> XML tags. Only output the final response to the user outside of these tags.`);
      } else if (effort === "medium") {
        masterDirectives.push(`[THINKING EFFORT: MEDIUM] Provide a balanced response. Think carefully but avoid unnecessary over-analysis. Deliver a well-reasoned and structured answer. Enclose any internal reasoning or scratchpad notes within <think> and </think> XML tags.`);
      } else if (effort === "low") {
        masterDirectives.push(`[THINKING EFFORT: LOW] Perform only a light reasoning pass. Keep your internal deliberation brief and provide a fast, concise answer. If you need to think, use <think> and </think> tags briefly.`);
      } else if (effort === "none") {
        masterDirectives.push(`[THINKING EFFORT: NONE] DO NOT perform any step-by-step reasoning or deliberation. DO NOT output any <think> tags. Provide your final answer instantly, using your immediate intuition. Be extremely direct and concise.`);
      }

      // @Agent Mention: Eğer sohbette spesifik bir uzman ajan seçilmişse, o ajanın kimliğini ve sistem direktiflerini enjekte et
      if (agent_id) {
        try {
          const agtRow = await pool.query(
            `SELECT id, name, system_prompt, rag, rag_space_id, rag_brands, rag_keywords FROM agents WHERE id = $1 LIMIT 1`,
            [agent_id]
          );
          if (agtRow.rows.length > 0) {
            const agt = agtRow.rows[0];
            masterDirectives.push(`[ACTIVE AGENT PERSONA ACTIVATED]: You are currently operating as the specialized agent "${agt.name}" (${agt.id}). Adhere strictly to the following instructions:\n${agt.system_prompt || ""}`);
          }
        } catch (e) {
          console.warn("[Orchestrate] Agent persona load failed:", e.message);
        }
      }

      // Explicit Capability Mentions (/Tool, !Skill, #MCP): Kullanıcı bir aracı/yeteneği doğrudan seçtiğinde modele bunu zorunlu kıl
      const requestedTools = capabilities?.tools || [];
      const requestedSkills = capabilities?.skills || [];
      const requestedMcp = capabilities?.mcp || [];

      if (requestedTools.length > 0 || requestedSkills.length > 0 || requestedMcp.length > 0) {
        const attachedList = [];
        if (requestedTools.length > 0) attachedList.push(`Tools: [${requestedTools.join(', ')}]`);
        if (requestedSkills.length > 0) attachedList.push(`Skills: [${requestedSkills.join(', ')}]`);
        if (requestedMcp.length > 0) attachedList.push(`MCP Server/Tools: [${requestedMcp.join(', ')}]`);
        masterDirectives.push(`[EXPLICIT USER ATTACHMENTS & CAPABILITY MANDATE]: The user has explicitly selected and attached the following capabilities to this turn: ${attachedList.join(' · ')}. You MUST execute the corresponding attached tool(s)/MCP functions to fulfill the request. NEVER substitute or bypass an attached MCP/Tool with a generic web fetch or approximation.`);
      }

      formattedMessages.unshift({
        role: "system",
        content: masterDirectives.join("\n\n")
      });

      // 3.5. Prepare Capabilities (Tools, Skills, MCP)
      const openAiTools = [];
      const toolMap = {}; // Map LLM-safe function names (e.g. tool_xyz) to canonical database IDs

      let finalToolIds = [];
      try {
          // Collect global native tools from action_library
          const systemToolsRes = await pool.query(
             `SELECT id FROM action_library WHERE (visibility = 'workspace' OR is_system = true) AND COALESCE((runtime->>'orphan')::boolean, false) = false`
          );
          const systemToolIds = systemToolsRes.rows.map(r => r.id);
          
          // Merge user-requested capabilities with global workspace tools
          finalToolIds = [...new Set([...requestedTools, ...requestedMcp, ...systemToolIds])];
      } catch (err) {
          console.warn("[Orchestrate] Failed to query global system tools:", err.message);
          finalToolIds = [...requestedTools, ...requestedMcp];
      }

      if (capabilities || finalToolIds.length > 0) {
         try {
             // 1. /Tool (Action Library): Both explicitly selected and Zero-Shot tools
             const dbToolIds = finalToolIds.filter(id => !id.startsWith("mcp."));
             if (dbToolIds.length > 0) {
                 const cleanToolIds = dbToolIds.map(id => id.startsWith("tool.") ? id : `tool.${id}`);
                 const bareToolIds = dbToolIds.map(id => id.replace(/^tool\./, ''));
                 const allPossibleIds = [...new Set([...dbToolIds, ...cleanToolIds, ...bareToolIds])];

                 const toolRes = await pool.query(
                   `SELECT id, name, description, params FROM action_library 
                     WHERE (id = ANY($1) OR name = ANY($1)) 
                       AND COALESCE((runtime->>'orphan')::boolean, false) = false`,
                   [allPossibleIds]
                 );
                 for (const t of toolRes.rows) {
                     const properties = {};
                     const required = [];
                     
                     let tParams = [];
                     try {
                         tParams = typeof t.params === 'string' ? JSON.parse(t.params) : (t.params || []);
                     } catch(e) {}
                     
                     if (Array.isArray(tParams)) {
                         for (const p of tParams) {
                             const pKey = p.key || p.name || p.id;
                             if (!pKey) continue;
                             properties[pKey] = { type: mapJsonSchemaType(p.type), description: p.description || p.label || "" };
                             if (p.required) required.push(pKey);
                         }
                     } else if (typeof tParams === 'object' && tParams !== null) {
                         for (const [k, v] of Object.entries(tParams)) {
                             properties[k] = { type: mapJsonSchemaType(v), description: "" };
                         }
                     }

                     const safeName = `tool_${t.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
                     toolMap[safeName] = t.id;

                     openAiTools.push({
                         type: "function",
                         function: {
                             name: safeName,
                             description: t.description || t.name || "No description",
                             parameters: {
                                 type: "object",
                                 properties,
                                 required
                             }
                         }
                     });
                 }
             }

             // 2. !Skill (Skills table)
             if (capabilities?.skills && capabilities.skills.length > 0) {
                 const cleanSkillIds = capabilities.skills.map(id => id.startsWith("sk.") ? id : `sk.${id.replace(/^skill\./, '')}`);
                 const bareSkillIds = capabilities.skills.map(id => id.replace(/^(sk\.|skill\.)/, ''));
                 const allSkillIds = [...new Set([...capabilities.skills, ...cleanSkillIds, ...bareSkillIds])];

                 const skillRes = await pool.query(
                   `SELECT id, name, description, params FROM skills WHERE id = ANY($1) AND enabled = true`,
                   [allSkillIds]
                 );
                 for (const s of skillRes.rows) {
                     const properties = {};
                     const required = [];
                     
                     let sParams = [];
                     try {
                         sParams = typeof s.params === 'string' ? JSON.parse(s.params) : (s.params || []);
                     } catch(e) {}
                     
                     if (Array.isArray(sParams)) {
                         for (const p of sParams) {
                             const pKey = p.key || p.name || p.id;
                             if (!pKey) continue;
                             properties[pKey] = { type: mapJsonSchemaType(p.type), description: p.description || p.label || "" };
                             if (p.required) required.push(pKey);
                         }
                     } else if (typeof sParams === 'object' && sParams !== null) {
                         for (const [k, v] of Object.entries(sParams)) {
                             properties[k] = { type: mapJsonSchemaType(v), description: "" };
                         }
                     }

                     const safeName = `skill_${s.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
                     toolMap[safeName] = s.id;

                     openAiTools.push({
                         type: "function",
                         function: {
                             name: safeName,
                             description: s.description || s.name || "No description",
                             parameters: {
                                 type: "object",
                                 properties,
                                 required
                             }
                         }
                     });
                 }
             }
             // 3. #MCP (MCP client servers tools)
             if (requestedMcp && requestedMcp.length > 0) {
                 const mcpServerRes = await pool.query(`SELECT slug, name, tools_cache FROM mcp_client_servers WHERE enabled = true`);
                 
                 for (const server of mcpServerRes.rows) {
                     const serverMcpId = `mcp.${server.slug}`;
                     const isServerRequested = requestedMcp.includes(serverMcpId) || requestedMcp.some(x => x.startsWith(`mcp.${server.slug}.`));

                     const tools = Array.isArray(server.tools_cache) ? server.tools_cache : [];
                     for (const t of tools) {
                         const mcpId = `mcp.${server.slug}.${t.name}`;
                         if (isServerRequested || requestedMcp.includes(mcpId)) {
                             const safeName = `tool_${mcpId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
                             toolMap[safeName] = mcpId;
                             openAiTools.push({
                                 type: "function",
                                 function: {
                                     name: safeName,
                                     description: `[MCP: ${server.name}] ${t.description || t.name}`,
                                     parameters: t.inputSchema || { type: "object", properties: {} }
                                 }
                             });
                         }
                     }
                 }
             }
         } catch(err) {
             console.warn("[Orchestrate] Failed to extract capability schemas:", err.message);
         }
      }

      // 3.6. META-FORGE Autonomy & System Tools
      // Inject zero-shot system tools so the core engine can inspect directory, delegate, or execute tools
      if (!toolMap["sys_get_directory"]) {
          openAiTools.push({
              type: "function",
              function: {
                  name: "sys_get_directory",
                  description: "Lists all available specialized agents, tools, skills, MCP servers, workflows, orchestrations, and webhooks in the system. Use this when you need to inspect existing capabilities, registered pipelines, or external endpoints.",
                  parameters: {
                      type: "object",
                      properties: {
                          intent: { type: "string", description: "What kind of agent/tool/workflow/webhook are you looking for?" }
                      },
                      required: []
                  }
              }
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
                          instructions: { type: "string", description: "Detailed prompt/instructions for the sub-agent to execute." }
                      },
                      required: ["agent_id", "instructions"]
                  }
              }
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
                          intent: { type: "string", description: "Detailed description of the tool, agent, workflow DAG, or orchestration chain you need created." }
                      },
                      required: ["intent"]
                  }
              }
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
                          params: { type: "object", description: "A JSON object containing the required arguments for the tool." }
                      },
                      required: ["tool_id", "params"]
                  }
              }
          });
          toolMap["sys_execute_tool"] = "sys_execute_tool";
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
                          query: { type: "string", description: "The search query to look up on the internet." }
                      },
                      required: ["query"]
                  }
              }
          });
          toolMap["sys_web_search"] = "sys_web_search";
      }



      let maxIterations = 15;
      let iteration = 0;
      let isDone = false;
      let finalProviderUsed = prov;

      // === RE-ACT AGENTIC LOOP START ===
      while (iteration < maxIterations && !isDone) {
          iteration++;

          if (iteration === 1) {
              send({ phase: "streaming" });
          } else {
              send({ phase: "agent_loop", iteration });
              console.log(`\n[Orchestrate] --- Agent Loop Start: Turn ${iteration} ---`);
          }

          let it = null;
          let hopIndex = 0;
          let hopError = null;

          // Failover Retry Loop (Automatic Model Hopping)
          while (hopIndex < providerChain.length) {
              const currentProv = providerChain[hopIndex];
              try {
                  if (hopIndex > 0) {
                      console.log(`[Orchestrate] ⚠️ Fallback Hop triggered! Switching to Provider: ${currentProv.model_name}`);
                      const fallbackModelStr = currentProv.model_id || currentProv.model || "gpt-3.5-turbo";
                      const fallbackSourceName = currentProv.provider_name || "Custom/Local";
                      send({ phase: "policy", meta: { source: `provider:${fallbackSourceName}`, model: fallbackModelStr } });
                  }
                  
                  // Adaptive Effort: Turn 1 uses user effort; Turn 2+ adapts to 'none' to avoid redundant deliberation
                  const turnEffort = iteration === 1 ? effort : "none";
                  it = await streamFromProvider({
                      provider: currentProv,
                      messages: formattedMessages,
                      tools: openAiTools.length > 0 ? openAiTools : undefined,
                      signal: requestAbort.signal,
                      effort: turnEffort
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

          console.log(`[Orchestrate] Stream reading started (Turn ${iteration})...`);

          try {
            for await (const piece of it) {
              if (!tFirstToken && iteration === 1) {
                tFirstToken = Date.now();
                console.log(`[Orchestrate] First token received! (${tFirstToken - t0}ms)`);
              }

              chunkCount++;

              try {
                 const parsedPiece = JSON.parse(piece);

                 if (parsedPiece.type === "tool_call_delta") {
                     const delta = parsedPiece.delta;
                     let idx = delta.index;
                     
                     // Google Compatibility Fix: Google omits "index" but sends a unique "id".
                     if (idx === undefined) {
                         if (delta.id) {
                             const existingIdx = Object.keys(toolCallsBuffer).find(k => toolCallsBuffer[k].id === delta.id);
                             if (existingIdx !== undefined) {
                                 idx = Number(existingIdx);
                             } else {
                                 idx = Object.keys(toolCallsBuffer).length;
                             }
                         } else {
                             const lastIdx = Math.max(0, Object.keys(toolCallsBuffer).length - 1);
                             const lastTool = toolCallsBuffer[lastIdx];
                             
                             if (delta.function?.name) {
                                 if (lastTool && lastTool.function.arguments.length > 0) {
                                     idx = lastIdx + 1;
                                 } else {
                                     idx = lastIdx;
                                 }
                             } else {
                                 idx = lastIdx;
                             }
                         }
                     }

                     console.log(`[DEBUG] Received Tool Call Delta - Assigned Index: ${idx}, Payload:`, JSON.stringify(delta));

                     if (!toolCallsBuffer[idx]) {
                         toolCallsBuffer[idx] = { id: delta.id, type: "function", function: { name: "", arguments: "" } };
                     }
                     if (delta.id) toolCallsBuffer[idx].id = delta.id;
                     if (delta.function?.name) toolCallsBuffer[idx].function.name += delta.function.name;
                     if (delta.function?.arguments) toolCallsBuffer[idx].function.arguments += delta.function.arguments;
                     // Google Compatibility: Keep extra_content for thought_signatures (Gemini Flash Lite etc)
                     if (delta.extra_content) toolCallsBuffer[idx].extra_content = delta.extra_content;
                 } else if (parsedPiece.type === "think") {
                     assembledThinking += (parsedPiece.delta || "");
                     send({ type: "think", delta: parsedPiece.delta });
                 } else if (parsedPiece.type === "out") {
                     assembled += parsedPiece.delta;
                     // Dual output format for both delta and text listeners
                     send({ type: "out", delta: parsedPiece.delta, text: parsedPiece.delta });
                 }
              } catch(e) {
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

          let toolCalls = Object.values(toolCallsBuffer);

          // FALLBACK FOR LOCAL MODELS (Gemma 4, Mistral, LLaMA) emitting text-based tool calls:
          if (toolCalls.length === 0 && assembled) {
              // Pattern 1: <call:funcName key="val" key2="val2" /> or <call:funcName key="val">...</call:funcName>
              const callMatches = [...assembled.matchAll(/<call:([a-zA-Z0-9_.-]+)([\s\S]*?)(?:\/>|>([\s\S]*?)<\/call:\1>|>)/gi)];
              if (callMatches.length > 0) {
                  for (const match of callMatches) {
                      const rawTag = match[0];
                      const funcName = match[1];
                      const rawAttrs = match[2] || "";
                      const innerText = match[3] || "";
                      
                      const argsObj = {};
                      // Parse key="value" or key='value'
                      const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
                      let attrMatch;
                      while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
                          const key = attrMatch[1];
                          const val = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
                          argsObj[key] = val;
                      }
                      if (innerText.trim() && !argsObj.query && !argsObj.intent && !argsObj.prompt && !argsObj.instructions) {
                          if (funcName === "sys_delegate_to_metaforge") argsObj.intent = innerText.trim();
                          else if (funcName === "sys_web_search") argsObj.query = innerText.trim();
                          else if (funcName === "sys_delegate_to_agent") argsObj.instructions = innerText.trim();
                      }

                      toolCalls.push({
                          id: `call_${Math.random().toString(36).substring(2, 9)}`,
                          type: "function",
                          function: {
                              name: funcName,
                              arguments: JSON.stringify(argsObj)
                          }
                      });
                      
                      // Strip the raw tag from the user-facing text
                      assembled = assembled.replace(rawTag, "").trim();
                  }
              }

              // Pattern 2: <tool_call>\n{"name": "...", "arguments": {...}}\n</tool_call>
              const toolCallBlockMatches = [...assembled.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/gi)];
              if (toolCallBlockMatches.length > 0) {
                  for (const match of toolCallBlockMatches) {
                      const rawBlock = match[0];
                      const rawJson = match[1].trim();
                      try {
                          const parsed = JSON.parse(rawJson);
                          if (parsed.name) {
                              toolCalls.push({
                                  id: `call_${Math.random().toString(36).substring(2, 9)}`,
                                  type: "function",
                                  function: {
                                      name: parsed.name,
                                      arguments: typeof parsed.arguments === "object" ? JSON.stringify(parsed.arguments) : String(parsed.arguments || "{}")
                                  }
                              });
                              assembled = assembled.replace(rawBlock, "").trim();
                          }
                      } catch {}
                  }
              }
          }
          
          // CRITICAL FIX 1: Ensure every tool call has an ID (Local models like Gemma 4 might omit it, causing socket hang up)
          // CRITICAL FIX 2: Share Google's thought_signature across parallel tool calls to prevent 400 INVALID_ARGUMENT
          let sharedThoughtSignature = null;
          for (const tc of toolCalls) {
              if (!tc.id) {
                  tc.id = `call_${Math.random().toString(36).substring(2, 9)}`;
              }
              if (tc.extra_content && tc.extra_content.thought_signature) {
                  sharedThoughtSignature = tc.extra_content.thought_signature;
              }
          }
          if (sharedThoughtSignature) {
              for (const tc of toolCalls) {
                  if (!tc.extra_content) tc.extra_content = {};
                  tc.extra_content.thought_signature = sharedThoughtSignature;
              }
          }

          console.log(`[Orchestrate] Stream tamamlandı (Tur ${iteration}). Toplam Chunk: ${chunkCount}, Assembled Length: ${assembled.length}, Çağrılan Tool Sayısı: ${toolCalls.length}`);

          if (toolCalls.length > 0) {
              // LLM bir veya birden fazla araca başvurmak istedi.

              // 1. UI'A BİLGİLENDİRME (Arayüz Entegrasyonu)
              // Arayüz bunu yakalayıp ekranda "Araçlar çalıştırılıyor..." spinner'ı çıkarabilir.
              send({ 
                  phase: "tool_execution", 
                  tools: toolCalls.map(t => {
                      const fName = (t.function?.name || "").trim();
                      let rId = toolMap[fName] || fName;
                      if (!toolMap[fName] && toolMap[`tool_${fName}`]) {
                          rId = toolMap[`tool_${fName}`];
                      } else if (!toolMap[fName]) {
                          const matched = Object.keys(toolMap).find(k => 
                              toolMap[k].replace(/\./g, '_') === fName || 
                              toolMap[k] === fName.replace(/_/g, '.') ||
                              k === `tool_${fName.replace(/\./g, '_')}`
                          );
                          if (matched) rId = toolMap[matched];
                      }
                      return { id: t.id, name: rId };
                  }) 
              });

              // 2. Asistanın bu niyetini geçmişe ekle (OpenAI standardı)
              formattedMessages.push({
                  role: "assistant",
                  content: assembled || null,
                  tool_calls: toolCalls
              });

              // 3. Araçları (Tool) tek tek çalıştır ve sonucu UI'a bildir
              for (const tc of toolCalls) {
                  const funcName = (tc.function?.name || "").trim();
                  const funcArgs = tc.function?.arguments || "";
                  
                  let realToolId = toolMap[funcName] || funcName; // tool_xyz -> mcp.github
                  let isMapped = !!toolMap[funcName];

                  if (!toolMap[funcName] && toolMap[`tool_${funcName}`]) {
                      realToolId = toolMap[`tool_${funcName}`];
                      isMapped = true;
                  } else if (!toolMap[funcName]) {
                      const matched = Object.keys(toolMap).find(k => 
                          toolMap[k].replace(/\./g, '_') === funcName || 
                          toolMap[k] === funcName.replace(/_/g, '.') ||
                          k === `tool_${funcName.replace(/\./g, '_')}`
                      );
                      if (matched) {
                          realToolId = toolMap[matched];
                          isMapped = true;
                      }
                  }

                  // UI'a anlık statü: "github aranıyor..."
                  send({ type: "tool_status", name: realToolId, status: "running" });

                  let toolResultStr = "";
                  const tStart = Date.now();
                  let toolStatus = "completed";
                  let toolDetail = undefined;

                  try {
                      const parsedArgs = JSON.parse(funcArgs || "{}");
                      
                      // META-FORGE: Otonom Keşif ve Alt-Ajan Yetkilendirme
                      if (realToolId === "sys_get_directory") {
                          const { clause: agtClause, params: agtParams } = deps.buildVisibility(actorCtx, 1, 'owner_id');
                          const agtRes = await pool.query(
                             `SELECT id, name, squad, description FROM agents WHERE ${agtClause}`,
                             agtParams
                          );
                          const { clause: actClause, params: actParams } = deps.buildVisibility(actorCtx, 1, 'owner_user_id');
                          const actRes = await pool.query(
                             `SELECT id, name, category, description, params FROM action_library WHERE (${actClause}) AND is_system = false AND COALESCE((runtime->>'orphan')::boolean, false) = false`,
                             actParams
                          );
                          const { clause: skillClause, params: skillParams } = deps.buildVisibility(actorCtx, 1, 'owner_id');
                          const skillRes = await pool.query(
                             `SELECT id, name, description, params FROM skills WHERE enabled = true AND (${skillClause})`,
                             skillParams
                          );
                          const { clause: wfClause, params: wfParams } = deps.buildVisibility(actorCtx, 1, 'owner_id');
                          const wfRes = await pool.query(
                             `SELECT id, name, trigger, status FROM workflows WHERE ${wfClause} ORDER BY updated_at DESC`,
                             wfParams
                          );
                          const { clause: orcClause, params: orcParams } = deps.buildVisibility(actorCtx, 1, 'owner_id');
                          const orcRes = await pool.query(
                             `SELECT id, name, trigger, status FROM orchestrations WHERE ${orcClause} ORDER BY created_at DESC`,
                             orcParams
                          );
                          const { clause: whClause, params: whParams } = deps.buildVisibility(actorCtx, 1, 'owner_id');
                          const whRes = await pool.query(
                             `SELECT id, name, slug, description, category, connection, enabled FROM webhooks WHERE enabled = true AND (${whClause}) ORDER BY created_at DESC`,
                             whParams
                          ).catch(() => ({ rows: [] }));
                          const mcpRes = await pool.query(
                             `SELECT slug, name, tools_cache FROM mcp_client_servers WHERE enabled = true`
                          );

                          const standardTools = actRes.rows.map(t => {
                             let pKeys = [];
                             try {
                               const p = typeof t.params === 'string' ? JSON.parse(t.params) : t.params;
                               pKeys = Array.isArray(p) ? p.map(x => x.name || x.key || x.id) : (p && typeof p === 'object' ? Object.keys(p.properties || p) : []);
                             } catch(e) {}
                             return { id: t.id, name: t.name, desc: (t.description || "").slice(0, 120), params: pKeys };
                          });
                          const skillsList = skillRes.rows.map(s => {
                             let pKeys = [];
                             try {
                               const p = typeof s.params === 'string' ? JSON.parse(s.params) : s.params;
                               pKeys = Array.isArray(p) ? p.map(x => x.name || x.key || x.id) : (p && typeof p === 'object' ? Object.keys(p.properties || p) : []);
                             } catch(e) {}
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
                                   params: t.inputSchema?.properties ? Object.keys(t.inputSchema.properties) : []
                                });
                             }
                          }
                          
                          // Eğer UI'dan Web Search açılmışsa, Directory'e ekle ki model orada da görebilsin
                          if (web_search) {
                              standardTools.push({
                                  id: "sys_web_search",
                                  name: "Live Web Search",
                                  desc: "Performs a live internet search using DuckDuckGo to get up-to-date information, news, dates, and facts.",
                                  params: ["query"]
                              });
                          }

                          toolResultStr = JSON.stringify({
                              agents: agtRes.rows.map(a => ({ id: a.id, name: a.name, squad: a.squad, desc: (a.description || "").slice(0, 120) })),
                              tools: [...standardTools, ...skillsList, ...mcpTools],
                              workflows: wfRes.rows.map(w => ({ id: w.id, name: w.name, trigger: w.trigger, status: w.status })),
                              orchestrations: orcRes.rows.map(o => ({ id: o.id, name: o.name, trigger: o.trigger, status: o.status })),
                              webhooks: whRes.rows.map(w => ({ id: w.id, name: w.name, slug: w.slug, description: (w.description || "").slice(0, 120) })),
                              message: "Directory loaded. Contains available agents, tools, skills, MCP servers, workflows, orchestrations, and webhooks."
                          });
                      } else if (realToolId === "sys_delegate_to_agent") {
                          const targetAgentId = parsedArgs.agent_id;
                          const targetInstructions = parsedArgs.instructions;

                          const { clause: agtClause, params: agtParams } = deps.buildVisibility(actorCtx, 2, 'owner_id');
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
                                  { role: "user", content: targetInstructions }
                              ];

                              // Agentic RAG implementation
                              if (subAgent.rag) {
                                  try {
                                      // 1. Resolve Space restriction into file IDs to strictly bound the retrieval
                                      let spaceFileIds = null;
                                      if (subAgent.rag_space_id) {
                                          const spaceSrcRes = await pool.query(`SELECT id::text FROM knowledge_sources WHERE space_id = $1`, [subAgent.rag_space_id]);
                                          spaceFileIds = spaceSrcRes.rows.map(r => r.id);
                                          // If space has no files, spaceFileIds is [], which safely causes the ANY() clause in DB to match nothing.
                                      }

                                      // 2. Parse Comma-separated keywords
                                      const parsedKeywords = subAgent.rag_keywords 
                                          ? subAgent.rag_keywords.split(',').map(k => k.trim()).filter(Boolean) 
                                          : [];

                                      // Call ragProbeAndFetch scoped to the sub-agent's allowed spaces/brands
                                      const ragOut = await ragProbeAndFetch({
                                          q: targetInstructions,
                                          allowedLevels: ["workspace", "private", "public"],
                                          agentId: subAgent.id,
                                          bindingFileIds: spaceFileIds, // STRICT SPACE BOUNDARY
                                          bindingBrands: Array.isArray(subAgent.rag_brands) ? subAgent.rag_brands : [],
                                          agentKeywords: parsedKeywords,
                                          caller: "agentic-rag"
                                      });

                                      if (ragOut && ragOut.rows && ragOut.rows.length > 0) {
                                          let ragText = "[RAG KNOWLEDGE]\nHere is context retrieved from the organization's knowledge base:\n\n";
                                          ragOut.rows.forEach(r => {
                                              ragText += `--- SOURCE: ${r.path || 'unknown'} ---\n${r.content}\n\n`;
                                          });
                                          subMessages.push({ role: "system", content: ragText });

                                          // Paint the RetrievalCard in the UI by sending the exact payload format UI expects
                                          send({
                                            rag: {
                                              sources: ragOut.rows.map((r, i) => ({
                                                  index: i + 1,
                                                  name: r.path ? r.path.split('/').pop() : "chunk",
                                                  path: r.path,
                                                  ord: r.ord ?? 0,
                                                  score: Math.round(Math.min(1, Number(r.score) || 0) * 100)
                                              })),
                                              debug: {
                                                  queryClean: targetInstructions,
                                                  probe: {
                                                      top1: ragOut.top1 || 0,
                                                      ms: ragOut.stages?.totalMs || 0
                                                  }
                                              },
                                              reranker: ragOut.reranker || { used: false },
                                              fallback: { brands: Array.isArray(subAgent.rag_brands) ? subAgent.rag_brands : [] }
                                            }
                                          });
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
                                  effort: "low"
                              });
                              
                              let subAnswer = "";
                              for await (const chunk of subIt) {
                                  try {
                                      const parsed = JSON.parse(chunk);
                                      if (parsed.type === "out") subAnswer += (parsed.delta || "");
                                  } catch(e) {}
                              }
                              
                              if (!subAnswer || subAnswer.trim() === "") {
                                  subAnswer = "[SYSTEM_WARNING: AGENT_FAILED_OR_EMPTY] The sub-agent returned no useful data. You MUST explicitly inform the user that the delegation failed.";
                                  toolStatus = "failed";
                              }

                              toolResultStr = JSON.stringify({
                                  agent: subAgent.name,
                                  result: subAnswer
                              });
                          }
                      } else if (realToolId === "sys_execute_tool") {
                          const targetToolId = parsedArgs.tool_id || "";
                          const targetParams = parsedArgs.params || {};

                          // Resilient / Tolerant ID resolution (auto-resolve prefixes, safeNames, underscores)
                          let canonicalId = targetToolId;
                          let isAllowed = false;

                          // Clean variations:
                          // e.g. "skill_sk_system_health_synthesizer" -> "system-health-synthesizer"
                          // e.g. "tool_tool_ssl_cert_probe" -> "ssl-cert-probe"
                          const normalizedId = targetToolId
                            .replace(/^(skill_|tool_|sk_|skill\.|tool\.|sk\.)+/gi, "")
                            .replace(/_/g, '-');
                          const dotId = targetToolId
                            .replace(/^(skill_|tool_|sk_)+/gi, "")
                            .replace(/_/g, '.');

                          let isMcp = targetToolId.startsWith("mcp.") || dotId.startsWith("mcp.");
                          let serverSlug = "";
                          if (isMcp) {
                              const cleanMcp = (targetToolId.startsWith("mcp.") ? targetToolId : dotId).slice(4);
                              serverSlug = cleanMcp.split(".")[0];
                              canonicalId = `mcp.${cleanMcp}`;
                          } else if (targetToolId.includes(".") || dotId.includes(".")) {
                              const firstPart = (targetToolId.includes(".") ? targetToolId : dotId).split(".")[0];
                              const mcpServerCheck = await pool.query(
                                  `SELECT slug FROM mcp_client_servers WHERE slug = $1 AND enabled = true`,
                                  [firstPart]
                              );
                              if (mcpServerCheck.rows.length > 0) {
                                  isMcp = true;
                                  serverSlug = firstPart;
                                  canonicalId = `mcp.${dotId}`;
                              }
                          }

                          if (isMcp) {
                              // It's an MCP tool
                              const mcpRow = await pool.query(
                                  `SELECT id FROM mcp_client_servers WHERE slug = $1 AND enabled = true`,
                                  [serverSlug]
                              );
                              if (mcpRow.rows.length > 0) isAllowed = true;
                          } else {
                              // Check skills table (all variations: targetToolId, sk.<normalizedId>, normalizedId, etc.)
                              const possibleSkillIds = [
                                targetToolId,
                                `sk.${normalizedId}`,
                                `sk.${targetToolId}`,
                                normalizedId,
                                dotId
                              ];
                              const { clause: skillClause, params: skillParams } = deps.buildVisibility(actorCtx, 2, 'owner_id');
                              const skillRow = await pool.query(
                                  `SELECT id FROM skills WHERE id = ANY($1) AND enabled = true AND (${skillClause})`,
                                  [possibleSkillIds, ...skillParams]
                              );
                              if (skillRow.rows.length > 0) {
                                  isAllowed = true;
                                  canonicalId = skillRow.rows[0].id;
                              } else {
                                  // Standard Tool: check all variations: targetToolId, tool.<normalizedId>, normalizedId, dotId
                                  const possibleToolIds = [
                                    targetToolId,
                                    `tool.${normalizedId}`,
                                    `tool.${dotId}`,
                                    normalizedId,
                                    dotId
                                  ];
                                  const { clause: actClause, params: actParams } = deps.buildVisibility(actorCtx, 2, 'owner_user_id');
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
                                  provider: finalProviderUsed || prov
                              });

                              let outputRes = invokeRes.output ?? invokeRes;
                              if (!outputRes || (typeof outputRes === 'string' && outputRes.trim() === "") || (Array.isArray(outputRes) && outputRes.length === 0)) {
                                  outputRes = "[SYSTEM_WARNING: TOOL_FAILED_OR_EMPTY] The execution returned no useful data. You MUST explicitly inform the user that it failed.";
                                  toolStatus = "failed";
                              }
                              toolResultStr = JSON.stringify(outputRes);
                              // Payload Truncation Guard (Büyük çıktılarda KV cache şişmesini ve 1 tok/s yavaşlamasını engeller)
                              if (toolResultStr.length > 20000) {
                                  const originalLen = toolResultStr.length;
                                  const sample = toolResultStr.slice(0, 18000);
                                  toolResultStr = `${sample}\n\n[SYSTEM NOTE: Output truncated from ${originalLen} chars to fit context safely. Summarize the findings based on the provided sample.]`;
                              }
                          }
                      } else if (realToolId === "sys_delegate_to_metaforge") {
                          const intentText = parsedArgs.intent;
                          
                          // Send a status update to the UI
                          send({ phase: "meta_forge_planning", stage: "spawn" });

                          // 1. Build Inventory
                          let inventory = { agents: [], tools: [], skills: [], packs: [], counts: {} };
                          try {
                              const mod = await import("../meta-forge/planner.mjs");
                              inventory = await mod.buildInventory(pool);
                          } catch (invErr) {
                              console.warn("meta_forge inventory error:", invErr);
                          }
                          
                          // 2. Call the metaforge master agent
                          let forgeAgentRes = await pool.query(`SELECT id, system_prompt FROM agents WHERE id = 'agt.forge_master' LIMIT 1`);
                          
                          // Eğer ajan yoksa veya system_prompt'u eksikse/bozulmuşsa seed.mjs'i çalıştır.
                          if (forgeAgentRes.rows.length === 0 || !forgeAgentRes.rows[0].system_prompt.includes("COMPOSITION GUIDANCE")) {
                              try {
                                  const { ensureMetaForgeAgent } = await import("../meta-forge/seed.mjs");
                                  await ensureMetaForgeAgent(pool);
                                  forgeAgentRes = await pool.query(`SELECT id, system_prompt FROM agents WHERE id = 'agt.forge_master' LIMIT 1`);
                              } catch(e) {
                                  console.warn("Failed to ensure forge_master:", e.message);
                              }
                          }
                          
                          if (forgeAgentRes.rows.length === 0) {
                              toolResultStr = JSON.stringify({ error: "MetaForge master agent (agt.forge_master) not found in the system." });
                              toolStatus = "failed";
                          } else {
                              // We explicitly inject the strictest possible constraint into the prompt
                              // to prevent the LLM from outputting conversational filler.
                              const forgeSysPrompt = (forgeAgentRes.rows[0].system_prompt || "You are MetaForge. Output valid JSON.") + "\n\nCRITICAL INSTRUCTION: Output ONLY a valid JSON object. Do NOT include ANY text, markdown, or code fences before or after the JSON. Start your response with { and end with }.";

                              const forgeMessages = [
                                  { role: "system", content: forgeSysPrompt },
                                  { role: "user", content: `System Inventory:\n${JSON.stringify(inventory, null, 2)}\n\nGoal:\n${intentText}\n\nOutput a valid JSON containing a 'plan' object with 'create' and/or 'reuse' arrays. DO NOT USE MARKDOWN BLOCKS.` }
                              ];

                              const forgeProv = finalProviderUsed || prov;

                              if (!forgeProv) {
                                  toolResultStr = JSON.stringify({ error: "No provider found for MetaForge." });
                                  toolStatus = "failed";
                              } else {
                                  // Use chat-orchestrate's native streamFromProvider to handle API keys and vault resolution properly
                                  const subIt = await streamFromProvider({
                                      provider: forgeProv,
                                      messages: forgeMessages,
                                      tools: undefined,
                                      signal: requestAbort.signal,
                                      effort: "none"
                                  });

                                  let subAnswer = "";
                                  for await (const chunk of subIt) {
                                      try {
                                          const parsed = JSON.parse(chunk);
                                          if (parsed.type === "out") subAnswer += (parsed.delta || "");
                                      } catch(e) {
                                          subAnswer += chunk;
                                      }
                                  }

                                  // Debug: log what metaforge returned
                                  console.log(`[MetaForge] Output:\n${subAnswer}`);

                                  // 3. Parse and Save the Plan
                                  const plannerMod = await import("../meta-forge/planner.mjs");
                                  
                                  const obj = plannerMod.extractForgeJson ? plannerMod.extractForgeJson(subAnswer) : null;

                                  if (!obj || !obj.plan) {
                                      toolResultStr = JSON.stringify({ error: `MetaForge failed to generate a valid JSON plan. Raw output was: ${subAnswer}` });
                                      toolStatus = "failed";
                                  } else {
                                      try {
                                          const validated = plannerMod.validateForgePlan(obj.plan);
                                          const requestedBy = actorCtx?.username || actorCtx?.user?.name || req.session?.username || (actorId && !actorId.includes("-") ? actorId : "admin");
                                          
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
                                              autoApplied: false
                                          };
                                          
                                          // Emit the approval card to UI
                                          send({ forge_plan: planPayload });
                                          
                                          toolResultStr = JSON.stringify({
                                              success: true,
                                              message: "MetaForge plan synthesized and waiting for approval. Briefly list the proposed artifacts in a clean Markdown table (using columns: Tür, İsim, ID/Slug, Açıklama), state that an interactive approval card is provided below, and conclude your response so the user can review it.",
                                              plan_id: planId,
                                              proposed_artifacts: (validated.create || []).map(c => ({
                                                  kind: c.kind,
                                                  name: c.name || c.slug,
                                                  slug: c.slug,
                                                  description: c.description || ""
                                              }))
                                          });
                                      } catch (valErr) {
                                          toolResultStr = JSON.stringify({ error: `MetaForge generated an invalid plan: ${valErr.message}` });
                                          toolStatus = "failed";
                                      }
                                  }
                              }
                          }
                      } else if (realToolId === "sys_web_search") {
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
                                      if (sp.provider_type === 'tavily') {
                                          let apiKey = "dummy";
                                          if (sp.api_key_ref) apiKey = await resolveCredential(pool, sp.api_key_ref, "api_key");
                                          
                                          const res = await fetch("https://api.tavily.com/search", {
                                              method: "POST",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 5 })
                                          });
                                          if (!res.ok) throw new Error(`Tavily error: ${res.status}`);
                                          const data = await res.json();
                                          toolResultStr = JSON.stringify({ _system: currentDateInfo, query, results: data.results, source: "tavily" });
                                          searchSuccess = true;
                                          break;
                                      }
                                      else if (sp.provider_type === 'searxng') {
                                          const url = new URL(sp.base_url || "http://localhost:8080/search");
                                          url.searchParams.set("q", query);
                                          url.searchParams.set("format", "json");
                                          const res = await fetch(url.toString());
                                          if (!res.ok) throw new Error(`SearXNG error: ${res.status}`);
                                          const data = await res.json();
                                          const snippets = (data.results || []).slice(0, 5).map(r => r.content || r.title);
                                          toolResultStr = JSON.stringify({ _system: currentDateInfo, query, results: snippets, source: "searxng" });
                                          searchSuccess = true;
                                          break;
                                      }
                                      else if (sp.provider_type === 'duckduckgo') {
                                          const fetchRes = await fetch(sp.base_url || `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
                                          if (!fetchRes.ok) throw new Error(`DDG error: ${fetchRes.status}`);
                                          const html = await fetchRes.text();
                                          const snippets = [...html.matchAll(/<a class="result__snippet[^>]*>(.*?)<\/a>/gi)]
                                                            .map(m => m[1].replace(/<\/?[^>]+(>|$)/g, ""))
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
                                      continue; // Fallback: try next provider in priority list
                                  }
                              }

                              if (!searchSuccess) {
                                  toolResultStr = JSON.stringify({ error: "Web search failed across all active providers. Last error: " + lastError });
                                  toolStatus = "failed";
                              }
                          } catch(err) {
                              toolResultStr = JSON.stringify({ error: "Web search engine failed: " + err.message });
                              toolStatus = "failed";
                          }
                      } else if (isMapped) {
                          // Invoke execution engine
                          const invokeRes = await invokeTool({
                              toolId: realToolId,
                              params: parsedArgs,
                              sessionId: thread_id,
                              agentId: agent_id,
                              provider: finalProviderUsed || prov
                          });
                          
                          let outputRes = invokeRes.output ?? invokeRes;
                          if (!outputRes || (typeof outputRes === 'string' && outputRes.trim() === "") || (Array.isArray(outputRes) && outputRes.length === 0)) {
                               outputRes = "[SYSTEM_WARNING: TOOL_FAILED_OR_EMPTY] The tool executed but returned no useful data. You MUST explicitly inform the user that the tool failed.";
                          }
                          toolResultStr = JSON.stringify(outputRes);
                      } else {
                          toolResultStr = JSON.stringify({ error: "Tool execution failed: Unmapped capability name." });
                          toolStatus = "failed";
                          toolDetail = "Unmapped capability name.";
                      }
                  } catch (err) {
                      console.error(`[Orchestrate] Tool execution error (${funcName}) - Real ID (${realToolId}):`, err.stack || err.message);
                      toolResultStr = JSON.stringify({ error: err.message });
                      toolStatus = "failed";
                      toolDetail = err.message;
                  }

                  const durationMs = Date.now() - tStart;
                  const statusPayload = { type: "tool_status", name: realToolId, status: toolStatus, ms: durationMs || 10 };
                  if (toolDetail) {
                      statusPayload.detail = toolDetail;
                  }
                  
                  send(statusPayload);

                  // 4. Append tool result to conversation history
                  formattedMessages.push({
                      role: "tool",
                      tool_call_id: tc.id,
                      name: funcName,
                      content: toolResultStr
                  });
              }

              // Multi-turn continuation: loop back so LLM reviews tool results and synthesizes final answer

          } else {
              // Final turn: LLM produced final conversational answer
              isDone = true;

              const totalMs = Date.now() - t0;
              const promptTokens = approxTokens ? approxTokens(formattedMessages.map(m => m.content).join("\n")) : 10;
              const responseTokens = approxTokens ? approxTokens(assembled + assembledThinking) : 10;

              // Telemetry, Costs & Quality Engine
              let _q = { hallucinationScore: 0, groundednessScore: 0, refusalRate: 0, cacheHits: 0, costUsd: 0 };
              if (calculateAIQuality) {
                 try {
                    _q = calculateAIQuality("", assembled, finalProviderUsed.input_cost || 0, finalProviderUsed.output_cost || 0, promptTokens, responseTokens);
                 } catch(e) { }
              }

              const usedModelStr = finalProviderUsed.model_id || finalProviderUsed.model || model || "gpt-3.5-turbo";
              const sourceNameStr = finalProviderUsed.provider_name || "Custom/Local";

              // Persist working memory block
              if (thread_id) {
                  try {
                      // O anki cevabı (Veya düşünce sürecini) bir "Hafıza Bloğu" olarak kaydediyoruz
                      const snippet = assembled.substring(0, 45).replace(/\n/g, " ") + "...";
                      const memTokens = promptTokens + responseTokens;
                      const memId = `wrk.${Math.random().toString(36).slice(2, 8)}`;
                      const memLabel = agent_id ? `Agent response: ${snippet}` : `Model response: ${snippet}`;
                      const memTone = agent_id ? "emerald" : "sapphire"; // Ajan ise yeşil, Model ise mavi (Elara stili)
                      
                      // YENİ: Thread veritabanında yoksa foreign key hatası (500) vermemesi için önce thread oluşturuluyor.
                      await pool.query(
                          `INSERT INTO chat_threads (id, title) VALUES ($1, 'New chat') ON CONFLICT (id) DO NOTHING`,
                          [thread_id]
                      );

                      await pool.query(
                          `INSERT INTO memory_working (id, thread_id, label, origin, tokens, tone, pinned)
                           VALUES ($1, $2, $3, $4, $5, $6, false)`,
                          [memId, thread_id, memLabel, usedModelStr, memTokens, memTone]
                      );
                  } catch(memErr) {
                      console.error("[Orchestrate] Failed to record working memory:", memErr.message);
                  }
              }

              if (recordUsage) {
                 try {
                   recordUsage(pool, {
                     providerId: finalProviderUsed?.id || "local",
                     providerName: sourceNameStr,
                     kind: "llm",
                     model: usedModelStr,
                     threadId: thread_id,
                     promptTokens,
                     responseTokens,
                     latencyMs: totalMs,
                     status: "ok",
                     ..._q
                   }).catch(() => {});
                 } catch(err) {
                   console.warn("[Orchestrate] Telemetry recordUsage failed:", err.message);
                 }
              }

              // Final UI Log - Gerçekte cevap veren modeli UI'a Telemetri olarak bildiriyoruz
              send({
                latency: {
                  ttftMs: tFirstToken ? (tFirstToken - t0) : 0,
                  totalMs,
                  tokensOut: responseTokens,
                  modelOut: usedModelStr
                }
              });

              send({ type: "done" });
              close();
          }
      } // === RE-ACT AGENTIC LOOP BİTİŞİ ===
      
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