import { randomUUID } from "crypto";
import { resolveCredential } from "../vault.mjs";

export async function mountChatOrchestrateRoutes(app, deps) {
  const { pool, getRagSettings, approxTokens, calculateAIQuality, recordUsage, trace, invokeTool } = deps;

  // --- LLM ŞİVE (DIALECT) ADAPTÖRLERİ ---

  // Anthropic (Claude) API'si standart dışı olduğu için kendi formatına çeviririz.
  async function fetchAnthropicStream(baseUrl, apiKey, targetModel, messages, tools, signal) {
    // Anthropic "system" rolünü messages dizisinde değil, üst düzeyde bekler.
    let systemPrompt = "";
    const anthropicMessages = [];
  
    for (const m of messages) {
      if (m.role === "system") {
        // Sistem mesajı düz metin (string) olmak zorunda
        let textContent = Array.isArray(m.content) ? m.content.find(c => c.type === 'text')?.text || "" : m.content;
        systemPrompt += (systemPrompt ? "\n" : "") + textContent;
      } else {
        let content = m.content;
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

    // Anthropic Tool Formatı OpenAI'dan farklıdır
    let anthropicTools = undefined;
    if (tools && tools.length > 0) {
        anthropicTools = tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters
        }));
    }

    const payload = {
      model: targetModel,
      system: systemPrompt || undefined,
      messages: anthropicMessages,
      max_tokens: 8192,
      stream: true,
      temperature: 0.7
    };

    // TOOL KONTROLÜ İPTAL EDİLDİ - SADECE TEST İÇİN YORUMA ALINDI
    // if (Array.isArray(anthropicTools) && anthropicTools.length > 0) {
    //    payload.tools = anthropicTools;
    // }

    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "messages-2023-12-15" // Gerekirse
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic API returned ${res.status}: ${errText}`);
    }

    return (async function* () {
      const decoder = new TextDecoder();
      const reader = res.body?.getReader?.();
      
      try {
        if (reader) {
           while (true) {
             const { done, value } = await reader.read();
             if (done) break;
             const decoded = decoder.decode(value, { stream: true });
             const lines = decoded.split('\n');
           
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
           for await (const chunk of res.body) {
             const decoded = decoder.decode(chunk, { stream: true });
             const lines = decoded.split('\n');
           
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
            try { reader.releaseLock(); } catch(e) {}
        }
      }
    })();
  }

    // Standart OpenAI Uyumlu Streamer (Ollama, vLLM, LMStudio, Google vb.)
  async function fetchOpenAIStream(baseUrl, apiKey, targetModel, messages, tools, signal) {
    // Google'ın resmi OpenAI uyumlu adresi için `/openai/chat/completions` kullanılmalı
    let requestUrl = `${baseUrl}/chat/completions`;
    if (baseUrl.includes("generativelanguage.googleapis.com") && !requestUrl.includes("/openai/")) {
        requestUrl = baseUrl.replace(/\/$/, "") + "/openai/chat/completions";
    }

    const headers = {
      "Content-Type": "application/json"
    };

    if (apiKey && apiKey !== "dummy-key") {
        headers["Authorization"] = `Bearer ${apiKey}`;
        // Google API Bearer'i bazen reddeder, kesin çözüm olarak kendi native header'ını da yolla
        if (baseUrl.includes("generativelanguage.googleapis.com")) {
            headers["x-goog-api-key"] = apiKey;
        }
    }

    const payload = {
      model: targetModel,
      messages,
      stream: true,
      temperature: 0.7
    };

    if (Array.isArray(tools) && tools.length > 0) {
       payload.tools = tools;
    }

    const res = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`LLM API returned ${res.status}: ${errText}`);
    }

    return (async function* () {
      const decoder = new TextDecoder();
      const reader = res.body?.getReader?.();
      
      try {
        if (reader) {
           while (true) {
             const { done, value } = await reader.read();
             if (done) break;
             const decoded = decoder.decode(value, { stream: true });
             const lines = decoded.split('\n');
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
                       yield JSON.stringify({ type: "out", delta: content });
                     }
                   } catch (e) {}
                 }
               }
             }
           }
        } else {
           for await (const chunk of res.body) {
             const decoded = decoder.decode(chunk, { stream: true });
             const lines = decoded.split('\n');
           
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
                       yield JSON.stringify({ type: "out", delta: content });
                     }
                   } catch (e) {}
                 }
               }
             }
           }
        }
      } finally {
        if (reader) {
            try { reader.releaseLock(); } catch(e) {}
        }
      }
    })();
  }

  async function streamFromProvider({ provider, messages, tools, signal }) {
    const baseUrl = (provider.model_base_url || provider.base_url || "http://127.0.0.1:8000/v1").replace(/\/$/, "");
    let apiKeyRef = provider.model_api_key || provider.secret_id || "dummy-key"; 
    
    // YENİ: Merkezi Resolver (raw:// ve vault:// prefixleri ile tek satırda çözüm)
    let apiKey = await resolveCredential(pool, apiKeyRef, "api_key");

    // Son güvenlik kontrolü
    if (!apiKey || apiKey.trim() === "") {
        apiKey = "dummy-key";
    }

    const targetModel = provider.model_id || provider.model || "default";
    console.log(`[Streamer] API Key Status for ${targetModel}:`, apiKey === "dummy-key" ? "Dummy" : (apiKey.startsWith("AIza") ? "Valid Google Key Detected" : "Valid Key"));

    let finalMessages = messages.filter(m => {
        if (!m || !m.content) return false;
        if (typeof m.content === "string") return m.content.trim() !== "";
        return Array.isArray(m.content) && m.content.length > 0;
    });
    if (provider.system_prompt) {
        finalMessages = [ { role: "system", content: provider.system_prompt }, ...finalMessages ];
    }

    const timeoutMs = 15000;
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
        console.log(`[Streamer] İstek atılıyor: ${baseUrl} (Model: ${targetModel})`);
      
        let iterator;
        // Anthropic orijinal API tespiti
        if (baseUrl.includes("api.anthropic.com")) {
           iterator = await fetchAnthropicStream(baseUrl, apiKey, targetModel, finalMessages, tools, controller.signal);
        } else {
           iterator = await fetchOpenAIStream(baseUrl, apiKey, targetModel, finalMessages, tools, controller.signal);
        }

        clearTimeout(id);
        console.log(`[Streamer] İstek başarılı, Stream başlıyor...`);
        return iterator;
      
    } catch (err) {
        clearTimeout(id);
        throw new Error(`Connection to LLM failed: ${err.message}`);
    }
  }

  app.post("/api/chat/orchestrate", async (req, res) => {
    const { thread_id, model, messages = [], agent_id, capabilities } = req.body ?? {};
    
    // 1. Setup SSE stream
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const close = () => {
      res.write(`data: [DONE]\n\n`);
      res.end();
    };

    const requestAbort = new AbortController();
    const abortHandler = () => {
        if (!requestAbort.signal.aborted) {
            console.log("[Orchestrate] Client disconnect detected! Aborting backend stream...");
            requestAbort.abort();
        }
    };
    req.on("aborted", abortHandler);
    res.on("close", abortHandler);

    try {
      send({ phase: "accepted" });
      let t0 = Date.now();
      let tFirstToken = 0;

      // 2. Resolve Provider & Model from DB
      let prov = null;
      if (model) {
        const dbRes = await pool.query(`
          SELECT 
            m.id as model_pk, m.name as model_name, m.model_id, m.base_url as model_base_url, m.api_key_ref as model_api_key, m.system_prompt,
            m.input_cost, m.output_cost, m.provider_id,
            p.name as provider_name, p.base_url, p.secret_id 
          FROM models m 
          LEFT JOIN ai_providers p ON m.provider_id = p.id 
          WHERE m.id = $1
        `, [model]);
        if (dbRes.rows.length > 0) prov = dbRes.rows[0];
      }
      
      console.log(`\n===========================================`);
      console.log(`[Orchestrate] Request Model ID: ${model}`);
      console.log(`[Orchestrate] Resolved DB Model:`, prov ? prov.model_name : "NULL (Fallback'e düşecek)");
      
      // Fallback to active default
      if (!prov) {
        const defRes = await pool.query(`SELECT id as provider_id, name as provider_name, base_url, secret_id, model FROM ai_providers WHERE active = true ORDER BY priority ASC LIMIT 1`);
        if (defRes.rows.length > 0) prov = defRes.rows[0];
        console.log(`[Orchestrate] Fallback triggered. Using Provider:`, prov ? prov.provider_name : "None");
      }

      if (!prov) {
         console.error("[Orchestrate] FATAL: No provider/model found in DB!");
         throw new Error("No active AI provider/model found in DB.");
      }
      
      const usedModel = prov.model_id || prov.model || model || "gpt-3.5-turbo";
      const sourceName = prov.provider_name || "Custom/Local";
      
      console.log(`[Orchestrate] Final URL: ${prov.model_base_url || prov.base_url}`);
      console.log(`[Orchestrate] Final Model String: ${usedModel}`);
      console.log(`===========================================\n`);
      send({ phase: "policy", meta: { source: `provider:${sourceName}`, model: usedModel } });
      
      // 3. Format Messages & LLM Uyumluluğu (Vision / Array Desteği)
      const formattedMessages = messages.map(m => {
        let safeRole = m.role || "user";
        if (safeRole === "agent") safeRole = "assistant";
        
        let safeContent = m.content || m.text || "";
        
        // Eğer arayüz (UI) resmi veya çoklu içeriği array (dizi) olarak yolluyorsa bozmadan al.
        // Vision (Resim okuma) desteği için bu şarttır.
        if (Array.isArray(m.content)) {
            safeContent = m.content;
        }

        return {
          role: safeRole,
          content: safeContent
        };
      });

      // 3.5. Capabilities (Tools & Skills) Hazırlığı
      const openAiTools = [];
      const toolMap = {}; // Tool'ların LLM güvenli isminden (Örn: tool_xyz) gerçek ID'sine (mcp.xyz) ulaşmak için.
      
      // Eğer arayüz bize kullanmak istediği tool/skill'leri gönderdiyse DB'den şemalarını topla
      if (capabilities) {
         try {
             // 1. Tools tablosundan istenen araçları topla
             if (capabilities.tools && capabilities.tools.length > 0) {
                 // params jsonb kolonundan name, description gibi şeyleri çıkartıp OpenAI property'lerine dizeceğiz
                 const toolRes = await pool.query(`SELECT id, label, description, params FROM tools WHERE id = ANY($1) AND enabled = true`, [capabilities.tools]);
                 for (const t of toolRes.rows) {
                     const properties = {};
                     const required = [];
                     
                     // params genelde UI'dan [{name: "query", type: "string", required: true}] şeklinde gelir
                     const tParams = Array.isArray(t.params) ? t.params : [];
                     for (const p of tParams) {
                         properties[p.name || p.id] = { type: p.type || "string", description: p.description || "" };
                         if (p.required) required.push(p.name || p.id);
                     }

                     const safeName = `tool_${t.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
                     toolMap[safeName] = t.id;

                     openAiTools.push({
                         type: "function",
                         function: {
                             name: safeName,
                             description: t.description || t.label || "No description",
                             parameters: {
                                 type: "object",
                                 properties,
                                 required
                             }
                         }
                     });
                 }
             }

             // 2. Skills tablosundan istenen yetenekleri topla
             if (capabilities.skills && capabilities.skills.length > 0) {
                 const skillRes = await pool.query(`SELECT id, name, description, params FROM skills WHERE id = ANY($1) AND enabled = true`, [capabilities.skills]);
                 for (const s of skillRes.rows) {
                     const properties = {};
                     const required = [];
                     
                     const sParams = Array.isArray(s.params) ? s.params : [];
                     for (const p of sParams) {
                         properties[p.name || p.id] = { type: p.type || "string", description: p.description || "" };
                         if (p.required) required.push(p.name || p.id);
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
         } catch(err) {
             console.warn("[Orchestrate] Capability (Tool/Skill) şemaları çekilemedi:", err.message);
         }
      }

      let maxIterations = 5;
      let iteration = 0;
      let isDone = false;

      // === RE-ACT AGENTIC LOOP BAŞLANGICI ===
      while (iteration < maxIterations && !isDone) {
          iteration++;
          
          if (iteration === 1) {
              send({ phase: "streaming" });
          } else {
              send({ phase: "agent_loop", iteration });
              console.log(`\n[Orchestrate] --- Agent Döngüsü Başlıyor: Tur ${iteration} ---`);
          }

          const it = await streamFromProvider({
            provider: prov,
            messages: formattedMessages,
            tools: openAiTools.length > 0 ? openAiTools : undefined,
            signal: requestAbort.signal
          });

          let assembled = "";
          let chunkCount = 0;
          let toolCallsBuffer = {}; // { index: { id, type, function: { name, arguments } } }

          console.log(`[Orchestrate] Stream okumaya başlanıyor (Tur ${iteration})...`);

          for await (const piece of it) {
            if (!tFirstToken && iteration === 1) {
              tFirstToken = Date.now();
              console.log(`[Orchestrate] İlk token alındı! (${tFirstToken - t0}ms)`);
            }

            chunkCount++;

            try {
               const parsedPiece = JSON.parse(piece);
               
               if (parsedPiece.type === "tool_call_delta") {
                   const delta = parsedPiece.delta;
                   const idx = delta.index || 0;
                   if (!toolCallsBuffer[idx]) {
                       toolCallsBuffer[idx] = { id: delta.id, type: "function", function: { name: "", arguments: "" } };
                   }
                   if (delta.id) toolCallsBuffer[idx].id = delta.id;
                   if (delta.function?.name) toolCallsBuffer[idx].function.name += delta.function.name;
                   if (delta.function?.arguments) toolCallsBuffer[idx].function.arguments += delta.function.arguments;
               } else if (parsedPiece.type === "think") {
                   send({ type: "think", delta: parsedPiece.delta });
               } else if (parsedPiece.type === "out") {
                   assembled += parsedPiece.delta;
                   send({ delta: parsedPiece.delta });
               }
            } catch(e) {
               // Fallback if not json
               assembled += piece;
               send({ delta: piece });
            }
          }

          const toolCalls = Object.values(toolCallsBuffer);
          console.log(`[Orchestrate] Stream tamamlandı (Tur ${iteration}). Toplam Chunk: ${chunkCount}, Assembled Length: ${assembled.length}, Çağrılan Tool Sayısı: ${toolCalls.length}`);

          if (toolCalls.length > 0) {
              // LLM bir veya birden fazla araca başvurmak istedi.

              // 1. UI'A BİLGİLENDİRME (Kullanıcının Lovable için sorduğu kısım!)
              // Arayüz bunu yakalayıp ekranda "Araçlar çalıştırılıyor..." spinner'ı çıkarabilir.
              send({ 
                  phase: "tool_execution", 
                  tools: toolCalls.map(t => ({ id: t.id, name: t.function.name })) 
              });

              // 2. Asistanın bu niyetini geçmişe ekle (OpenAI standardı)
              formattedMessages.push({
                  role: "assistant",
                  content: assembled || null,
                  tool_calls: toolCalls
              });

              // 3. Araçları (Tool) tek tek çalıştır ve sonucu UI'a bildir
              for (const tc of toolCalls) {
                  const funcName = tc.function.name;
                  const funcArgs = tc.function.arguments;
                  const realToolId = toolMap[funcName]; // tool_xyz -> mcp.github

                  // UI'a anlık statü: "github aranıyor..."
                  send({ type: "tool_status", name: realToolId || funcName, status: "running" });

                  let toolResultStr = "";
                  try {
                      const parsedArgs = JSON.parse(funcArgs || "{}");
                      if (realToolId) {
                          // Gerçek çalıştırma motorunu (Execution Engine) çağır!
                          const invokeRes = await invokeTool({ 
                              toolId: realToolId, 
                              params: parsedArgs, 
                              sessionId: thread_id, 
                              agentId 
                          });
                          // Tool sonucu JSON'a çevrilip string olarak verilir.
                          toolResultStr = JSON.stringify(invokeRes.output || invokeRes);
                      } else {
                          toolResultStr = JSON.stringify({ error: "Tool execution failed: Unmapped capability name." });
                      }
                  } catch (err) {
                      console.error(`[Orchestrate] Araç çalıştırma hatası (${funcName}):`, err.message);
                      toolResultStr = JSON.stringify({ error: err.message });
                  }

                  // UI'a statü: "github bitti!"
                  send({ type: "tool_status", name: realToolId || funcName, status: "completed" });

                  // 4. Sonucu mesaj geçmişine (LLM'e) "tool" rolüyle ekle
                  formattedMessages.push({
                      role: "tool",
                      tool_call_id: tc.id,
                      name: funcName,
                      content: toolResultStr
                  });
              }

              // Döngü burada kırılmaz (isDone = false), başa döner.
              // LLM bu kez araçların sonucunu görerek nihai metni üretecektir.

          } else {
              // Tool çağrısı yok, o halde asistan asıl cevabını verdi ve işimiz bitti.
              isDone = true;

              const totalMs = Date.now() - t0;
              const promptTokens = approxTokens ? approxTokens(formattedMessages.map(m => m.content).join("\n")) : 10;
              const responseTokens = approxTokens ? approxTokens(assembled) : 10;

              // Telemetry, Costs & Quality Engine
              let _q = { hallucinationScore: 0, groundednessScore: 0, refusalRate: 0, cacheHits: 0, costUsd: 0 };
              if (calculateAIQuality) {
                 try {
                    _q = calculateAIQuality("", assembled, prov.input_cost || 0, prov.output_cost || 0, promptTokens, responseTokens);
                 } catch(e) { }
              }
              
              if (recordUsage) {
                 try {
                   recordUsage(pool, { 
                     providerId: prov?.id || "local", 
                     providerName: sourceName, 
                     kind: "llm", 
                     model: usedModel, 
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

              // Final UI Log
              send({ 
                latency: { 
                  ttftMs: tFirstToken ? (tFirstToken - t0) : 0, 
                  totalMs, 
                  tokensOut: responseTokens 
                } 
              });
              
              close();
          }
      } // === RE-ACT AGENTIC LOOP BİTİŞİ ===

    } catch (e) {
      if (e.name === "AbortError" || e.message?.includes("aborted")) {
         if (trace) trace("orchestrate.aborted", { reason: "client_disconnected" });
         // İstemci koptuysa hata atma, sadece bitir
         close();
         return;
      }
      
      if (trace) trace("orchestrate.error", { error: e.message }, "error");
      send({ delta: `\n\n⚠️ Core Execution Error: ${e.message}` });
      close();
    }
  });
}