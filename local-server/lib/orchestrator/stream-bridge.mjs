// local-server/lib/orchestrator/stream-bridge.mjs
// Vendor-agnostic LLM Streaming Bridge & TCP Killer Socket Management.
// Ensures strict socket destruction on client abort (agent: false) to prevent GPU hang-up.

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { resolveCredential } from "../vault.mjs";

export function mapJsonSchemaType(t) {
  const x = String(t || "string").toLowerCase();
  if (x === "number" || x === "int" || x === "integer" || x === "float") return "number";
  if (x === "bool" || x === "boolean") return "boolean";
  if (x === "object" || x === "json") return "object";
  if (x === "array") return "array";
  return "string";
}

// --- NATIVE STREAM REQUEST (TCP KILLER) ---
// Standard Node.js fetch does not immediately tear down sockets on abort due to draining.
// Local engines (Llama.cpp / vLLM / Ollama) continue token generation unless the TCP socket is forcefully killed.
// This wrapper sends an immediate TCP RST destruction when an abort signal is received.
export async function nativeStreamRequest(urlStr, options, payloadStr, signal) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const lib = parsedUrl.protocol === "https:" ? https : http;

      if (payloadStr) {
        // Enforce Content-Length header on POST payloads to prevent socket hang up on strict servers
        options.headers["Content-Length"] = Buffer.byteLength(payloadStr);
      }

      console.log(`\n[TCP-KILLER] ➔ Request Dispatching: ${options.method || "POST"} ${urlStr}`);
      console.log(`[TCP-KILLER] ➔ Headers:`, JSON.stringify(options.headers));
      if (payloadStr) {
        console.log(`[TCP-KILLER] ➔ Payload (first 300 chars):`, payloadStr.substring(0, 300) + (payloadStr.length > 300 ? "..." : ""));
      }

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "POST",
        headers: {
          Accept: "*/*",
          "User-Agent": "Elara-Orchestrator/1.0",
          ...options.headers,
        },
        agent: false, // Spawn fresh request connections without pooling
      };

      let responseObj = null;
      const llmReq = lib.request(reqOptions, (llmRes) => {
        responseObj = llmRes;
        resolve({
          ok: llmRes.statusCode >= 200 && llmRes.statusCode < 300,
          status: llmRes.statusCode,
          text: async () => {
            let body = "";
            for await (const chunk of llmRes) body += chunk;
            return body;
          },
          body: llmRes,
        });
      });

      llmReq.on("error", (err) => {
        console.error(`[TCP-KILLER] Request Error to ${parsedUrl.hostname}:${reqOptions.port}: ${err.message}`);
        reject(err);
      });

      if (signal) {
        if (signal.aborted) {
          llmReq.destroy(new Error("Aborted before request started"));
          return reject(new Error("Aborted before request started"));
        }
        signal.addEventListener("abort", () => {
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

// Anthropic (Claude) API dialect adapter
export async function fetchAnthropicStream(provider, baseUrl, apiKey, targetModel, messages, tools, signal) {
  let systemPrompt = "";
  const anthropicMessages = [];

  for (const m of messages) {
    if (m.role === "system") {
      let textContent = Array.isArray(m.content) ? m.content.find((c) => c.type === "text")?.text || "" : m.content;
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
            input: JSON.parse(tc.function.arguments || "{}"),
          });
        }
        content = blocks;
      } else if (m.role === "tool") {
        m.role = "user";
        content = [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id,
            content: m.content,
          },
        ];
      }

      if (Array.isArray(content)) {
        content = content.map((c) => {
          if (c.type === "image_url") {
            const url = c.image_url.url;
            const match = url.match(/^data:(image\/[^;]+);(?:[^,]*;)?base64,(.+)$/);
            if (match) {
              return {
                type: "image",
                source: {
                  type: "base64",
                  media_type: match[1],
                  data: match[2],
                },
              };
            }
            return { type: "text", text: `[Image URL: ${url}]` };
          }
          return c;
        });
      }
      anthropicMessages.push({ role: m.role, content: content });
    }
  }

  // Combine consecutive messages of the same role for Anthropic alternating roles rule
  const consolidatedMessages = [];
  for (const m of anthropicMessages) {
    if (consolidatedMessages.length > 0) {
      const last = consolidatedMessages[consolidatedMessages.length - 1];
      if (last.role === m.role) {
        let lastContent = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
        let currentContent = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
        last.content = lastContent.concat(currentContent);
        continue;
      }
    }
    consolidatedMessages.push(m);
  }

  let anthropicTools = undefined;
  if (tools && tools.length > 0) {
    anthropicTools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
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
    ...(topP !== undefined ? { top_p: topP } : {}),
  };

  if (Array.isArray(anthropicTools) && anthropicTools.length > 0) {
    payload.tools = anthropicTools;
  }

  if (provider?.stop_sequences) {
    let stops = [];
    if (Array.isArray(provider.stop_sequences)) {
      stops = provider.stop_sequences;
    } else if (typeof provider.stop_sequences === "string") {
      try {
        stops = JSON.parse(provider.stop_sequences);
      } catch {
        stops = provider.stop_sequences.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      }
    }
    if (stops.length > 0) {
      payload.stop_sequences = stops;
    }
  }

  const res = await nativeStreamRequest(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "messages-2023-12-15",
      },
    },
    JSON.stringify(payload),
    signal
  );

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
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6).trim();
              if (dataStr) {
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.type === "message_stop") return;
                  if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                    yield JSON.stringify({ type: "out", delta: parsed.delta.text });
                  }
                  if (parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use") {
                    yield JSON.stringify({
                      type: "tool_call_delta",
                      delta: { index: parsed.index, id: parsed.content_block.id, function: { name: parsed.content_block.name, arguments: "" } },
                    });
                  }
                  if (parsed.type === "content_block_delta" && parsed.delta?.type === "input_json_delta") {
                    yield JSON.stringify({
                      type: "tool_call_delta",
                      delta: { index: parsed.index, function: { arguments: parsed.delta.partial_json } },
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
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6).trim();
              if (dataStr) {
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.type === "message_stop") return;
                  if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                    yield JSON.stringify({ type: "out", delta: parsed.delta.text });
                  }
                  if (parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use") {
                    yield JSON.stringify({
                      type: "tool_call_delta",
                      delta: { index: parsed.index, id: parsed.content_block.id, function: { name: parsed.content_block.name, arguments: "" } },
                    });
                  }
                  if (parsed.type === "content_block_delta" && parsed.delta?.type === "input_json_delta") {
                    yield JSON.stringify({
                      type: "tool_call_delta",
                      delta: { index: parsed.index, function: { arguments: parsed.delta.partial_json } },
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
        try {
          await reader.cancel();
        } catch (e) {}
        try {
          reader.releaseLock();
        } catch (e) {}
      }
    }
  })();
}

// Standard OpenAI-Compatible Streamer (Ollama, vLLM, LMStudio, Google, DeepSeek, etc.)
export async function fetchOpenAIStream(provider, baseUrl, apiKey, targetModel, messages, tools, signal, effort) {
  let requestUrl = `${baseUrl}/chat/completions`;
  if (baseUrl.includes("generativelanguage.googleapis.com") && !requestUrl.includes("/openai/")) {
    requestUrl = baseUrl.replace(/\/$/, "") + "/openai/chat/completions";
  }

  const headers = {
    "Content-Type": "application/json",
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

  // Detect if target endpoint is a local engine
  const isLocalEngine =
    baseUrl.includes("127.0.0.1") ||
    baseUrl.includes("localhost") ||
    baseUrl.includes("192.168.") ||
    baseUrl.includes(":8000") ||
    baseUrl.includes(":8001") ||
    baseUrl.includes(":11434");

  const payload = {
    model: targetModel,
    messages,
    stream: true,
    temperature: temp,
    max_tokens: maxTokens,
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(isLocalEngine && topK !== undefined ? { top_k: topK } : {}),
    ...(isLocalEngine && repPenalty !== undefined ? { repetition_penalty: repPenalty, repeat_penalty: repPenalty } : {}),
  };

  // Reasoning effort parameter support for OpenAI o1/o3 and Gemini 3.x series
  if (effort && effort !== "none" && (targetModel.includes("o1") || targetModel.includes("o3") || targetModel.toLowerCase().includes("gemini"))) {
    if (targetModel.toLowerCase().includes("gemini")) {
      payload.extra_body = {
        google: {
          thinking_config: {
            thinking_level: effort,
            include_thoughts: true,
          },
        },
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

  if (provider.stop_sequences) {
    let stops = [];
    if (Array.isArray(provider.stop_sequences)) {
      stops = provider.stop_sequences;
    } else if (typeof provider.stop_sequences === "string") {
      try {
        stops = JSON.parse(provider.stop_sequences);
      } catch {
        stops = provider.stop_sequences.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      }
    }
    if (stops.length > 0) {
      payload.stop = stops;
    }
  }

  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
  }

  const res = await nativeStreamRequest(requestUrl, { method: "POST", headers }, JSON.stringify(payload), signal);

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
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6).trim();
              if (dataStr === "[DONE]") return;
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
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6).trim();
              if (dataStr === "[DONE]") return;
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
        try {
          await reader.cancel();
        } catch (e) {}
        try {
          reader.releaseLock();
        } catch (e) {}
      }
    }
  })();
}

// Unified multi-provider streamer
export async function streamFromProvider({ provider, messages, tools, signal, effort, pool }) {
  const baseUrl = (provider.model_base_url || provider.base_url || "http://127.0.0.1:8000/v1").replace(/\/$/, "");
  let apiKeyRef = provider.model_api_key || provider.secret_id || "dummy-key";

  // Resolve credentials via Vault URI or raw prefix
  let apiKey = pool ? await resolveCredential(pool, apiKeyRef, "api_key") : apiKeyRef;
  if (!apiKey || apiKey.trim() === "") {
    apiKey = "dummy-key";
  }

  const targetModel = provider.model_id || provider.model || "default";
  console.log(`[Streamer] API Key Status for ${targetModel}:`, apiKey === "dummy-key" ? "Dummy" : "Valid Key");

  let finalMessages = messages.filter((m) => {
    if (!m) return false;
    if (m.tool_calls && m.tool_calls.length > 0) return true;
    if (m.role === "tool") return true;

    if (!m.content) return false;
    if (typeof m.content === "string") return m.content.trim() !== "";
    return Array.isArray(m.content) && m.content.length > 0;
  });

  if (provider.system_prompt) {
    finalMessages = [{ role: "system", content: provider.system_prompt }, ...finalMessages];
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
