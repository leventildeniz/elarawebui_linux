/**
 * llm-router.mjs — Multi-Provider Routing Engine (Phase: AI Gateway)
 * 
 * Takes an LLM request, evaluates the current routing_policy from app_system_config,
 * matches regex rules (Smart Router), or iterates failover/round_robin queues,
 * then dispatches the request to the appropriate vendor-specific handler.
 */

import { detectProviderFamily, getActiveProviders, getProviderById } from './agent-utils.mjs';
import http from "http";
import https from "https";
import { URL } from "url";

// --- NATIVE STREAM REQUEST (TCP KILLER) ---
async function nativeStreamRequest(urlStr, options, payloadStr, signal) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlStr);
      const lib = parsedUrl.protocol === 'https:' ? https : http;
      
      if (payloadStr) {
        // HTTP spesifikasyonu gereği POST isteklerinde payload varsa Content-Length ZORUNLUDUR.
        // Llama.cpp ve türevi local server'lar bu eksikse anında "socket hang up" (bağlantı koparma) yapar!
        options.headers['Content-Length'] = Buffer.byteLength(payloadStr);
      }

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'POST',
        headers: {
            "Accept": "*/*",
            "User-Agent": "Elara-Router/1.0",
            ...options.headers
        },
        agent: false
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
        console.error(`[llm-router TCP-KILLER] Request Error: ${err.message}`);
        reject(err);
      });

      if (signal) {
        if (signal.aborted) {
          llmReq.destroy(new Error('Aborted before request started'));
          return reject(new Error('Aborted before request started'));
        }
        signal.addEventListener('abort', () => {
          console.log(`\n🚨 [llm-router TCP-KILLER] 🚨 ABORT SIGNAL ALINDI! -> ${parsedUrl.hostname} TCP Soketi PARÇALANIYOR!`);
          if (responseObj) responseObj.destroy(new Error("Client Aborted"));
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

let _deps = null;
let _roundRobinIndex = 0;

export function initLlmRouter(deps) {
  _deps = deps || {};
}

/**
 * Normalizes OpenAI or generic message format into the correct vendor payload.
 * Also executes the actual streaming fetch to the remote provider.
 */
async function streamFromVendor({ provider, messages, signal }) {
  const { apiKey, model, base_url, provider_name } = provider;
  const family = detectProviderFamily(provider_name, base_url);

  if (family === "gemini") {
    const url = `${base_url || "https://generativelanguage.googleapis.com"}/v1beta/models/${model || "gemini-1.5-flash"}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const r = await nativeStreamRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, JSON.stringify({ contents }), signal);

    if (!r.ok || !r.body) throw new Error(`Gemini Error: ${r.status} ${await r.text().catch(() => "")}`);

    return (async function* () {
      const dec = new TextDecoder();
      let buf = "";
      try {
        for await (const chunk of r.body) {
          buf += dec.decode(chunk, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const f of frames) {
            const line = f.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const j = JSON.parse(line.slice(5).trim());
              const candidates = j.candidates || [];
              const parts = candidates[0]?.content?.parts || [];
              const text = parts.map(p => p.text).join("");
              if (text) yield text;
            } catch (e) {}
          }
        }
      } finally {
        if (reader) {
          try { await reader.cancel(); } catch (e) {}
        }
      }
    })();
  } 
  
  if (family === "anthropic") {
    // Anthropic implementation
    const url = `${(base_url || "https://api.anthropic.com").replace(/\/+$/, "")}/v1/messages`;
    const sysMsg = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
    const chatMsgs = messages.filter(m => m.role !== "system");
    
    const r = await nativeStreamRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    }, JSON.stringify({
      model: model || "claude-3-haiku-20240307",
      stream: true,
      max_tokens: 4096,
      system: sysMsg || undefined,
      messages: chatMsgs
    }), signal);

    if (!r.ok || !r.body) throw new Error(`Anthropic Error: ${r.status} ${await r.text().catch(() => "")}`);

    return (async function* () {
      const dec = new TextDecoder();
      let buf = "";
      try {
        for await (const chunk of r.body) {
          buf += dec.decode(chunk, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const f of frames) {
            const line = f.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const j = JSON.parse(line.slice(5).trim());
              if (j.type === "content_block_delta" && j.delta?.text) {
                yield j.delta.text;
              }
            } catch (e) {}
          }
        }
      } finally {
      }
    })();
  }
  
  // Default: OpenAI Compatible (OpenAI, Groq, Ollama, DeepSeek etc)
  const url = `${(base_url || "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;
  const r = await nativeStreamRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {})
    }
  }, JSON.stringify({
    model: model || "gpt-3.5-turbo",
    stream: true,
    messages
  }), signal);

  if (!r.ok || !r.body) throw new Error(`OpenAI-Compat Error: ${r.status} ${await r.text().catch(() => "")}`);

    return (async function* () {
      const dec = new TextDecoder();
      let buf = "";
      try {
        for await (const chunk of r.body) {
          buf += dec.decode(chunk, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const f of frames) {
            const line = f.trim();
            if (line === "data: [DONE]") break;
            if (!line.startsWith("data:")) continue;
            try {
              const j = JSON.parse(line.slice(5).trim());
              const piece = j.choices?.[0]?.delta?.content ?? "";
              if (piece) yield piece;
            } catch (e) {}
          }
        }
      } finally {
      }
    })();
}

/**
 * The main gateway function.
 * Called by chat/agents instead of calling a static provider.
 */
export async function streamRoutedLLM({ messages, signal, overrideProviderId }) {
  if (!_deps) throw new Error("[llm-router] initLlmRouter() not called");
  const { pool } = _deps;

  // 1) Read routing policy from DB
  let policy = { mode: "failover", retries: 2, smartRules: [], allowUserOverride: true };
  try {
    const { rows } = await pool.query("SELECT value FROM app_system_config WHERE key='routing_policy'");
    if (rows[0] && rows[0].value) {
      policy = { ...policy, ...rows[0].value };
    }
  } catch (e) {
    console.error("[llm-router] Failed to read policy, using default failover", e.message);
  }

  if (mode === "manual_only") {
    if (overrideProviderId) {
      const customProvider = await getProviderById(pool, overrideProviderId);
      if (customProvider && customProvider.is_active) {
        console.log(`[llm-router] Manual Only -> routing to ${customProvider.provider_name}`);
        return await streamFromVendor({ provider: customProvider, messages, signal });
      }
    }
    throw new Error("Manual routing mode is active but no valid provider was selected.");
  }

  // 2) User Override (Chat Dropdown) - for all other modes
  if (overrideProviderId && policy.allowUserOverride) {
    const customProvider = await getProviderById(pool, overrideProviderId);
    if (customProvider && customProvider.is_active) {
      console.log(`[llm-router] User override active -> routing to ${customProvider.provider_name}`);
      return await streamFromVendor({ provider: customProvider, messages, signal });
    }
  }

  // 3) Get Active Providers
  const activeProviders = await getActiveProviders(pool, "llm");
  if (!activeProviders || activeProviders.length === 0) {
    throw new Error("No active LLM providers registered in the system.");
  }

  // 4) Execute Routing Strategy
  const mode = policy.mode || "failover";
  
  if (mode === "single") {
    // Single: Always pick the top-priority provider
    return await streamFromVendor({ provider: activeProviders[0], messages, signal });
  }

  if (mode === "cheapest") {
    // Cheapest: Now respects the 'is_cheapest' boolean flag configured from the UI.
    // If multiple providers are marked as cheapest, it falls back to the priority order.
    // If no provider is explicitly marked, it just falls back to priority (the standard failover order).
    const cheapestProviders = activeProviders.filter(p => p.is_cheapest === true);
    const target = cheapestProviders.length > 0 ? cheapestProviders[0] : activeProviders[0];
    
    console.log(`[llm-router] Cheapest First -> routing to ${target.provider_name || target.name}`);
    return await streamFromVendor({ provider: target, messages, signal });
  }

  if (mode === "multi") {
    // Multi (Parallel Fan-out): Fires off queries to all active providers simultaneously.
    // Instead of streaming them all at once, we fetch them and merge results, then yield a combined stream.
    console.log(`[llm-router] Multi Fan-Out -> routing to ${activeProviders.length} providers concurrently.`);
    
    // We create a wrapper generator that yields the multi-threaded results
    return (async function* () {
      yield `[AI Gateway: Multi-Fanout initialized across ${activeProviders.length} providers...]\n\n`;

      const promises = activeProviders.map(async (provider) => {
        try {
          const stream = await streamFromVendor({ provider, messages, signal });
          let fullText = "";
          for await (const chunk of stream) {
             fullText += chunk;
          }
          return { provider: provider.provider_name, text: fullText, ok: true };
        } catch (err) {
          return { provider: provider.provider_name, text: err.message, ok: false };
        }
      });

      const results = await Promise.all(promises);

      for (const res of results) {
         yield `### 🤖 ${res.provider} ${res.ok ? "" : "(Failed)"}\n`;
         yield `${res.text}\n\n`;
         yield `---\n\n`;
      }
    })();
  }

  if (mode === "smart_router" && Array.isArray(policy.smartRules) && policy.smartRules.length > 0) {
    // Smart Router: Evaluate regex rules top-to-bottom based on the last user message
    const userMsg = [...messages].reverse().find(m => m.role === "user")?.content || "";
    for (const rule of policy.smartRules) {
      if (!rule.pattern || !rule.providerId) continue;
      try {
        const regex = new RegExp(rule.pattern, "i");
        if (regex.test(userMsg)) {
          const target = activeProviders.find(p => p.id === rule.providerId);
          if (target) {
            console.log(`[llm-router] Smart Match: /${rule.pattern}/ -> routing to ${target.provider_name}`);
            return await streamFromVendor({ provider: target, messages, signal });
          }
        }
      } catch (e) {
        console.error(`[llm-router] Invalid Regex rule /${rule.pattern}/:`, e.message);
      }
    }
    console.log(`[llm-router] Smart router no match -> falling back to top provider`);
    return await streamFromVendor({ provider: activeProviders[0], messages, signal });
  }

  if (mode === "round_robin") {
    // Round Robin: Rotate sequentially across all active providers
    _roundRobinIndex = (_roundRobinIndex + 1) % activeProviders.length;
    const target = activeProviders[_roundRobinIndex];
    console.log(`[llm-router] Round Robin -> routing to ${target.provider_name}`);
    return await streamFromVendor({ provider: target, messages, signal });
  }

  // Default: FAILOVER (Walks down the priority list until one succeeds)
  const maxRetries = Math.min(5, Math.max(0, policy.retries || 2));
  
  for (const provider of activeProviders) {
    let attempts = 0;
    while (attempts <= maxRetries) {
      try {
        console.log(`[llm-router] Failover attempt ${attempts+1} -> routing to ${provider.provider_name}`);
        const stream = await streamFromVendor({ provider, messages, signal });
        return stream; // If it doesn't throw on await, connection is established
      } catch (e) {
        attempts++;
        console.error(`[llm-router] Provider ${provider.provider_name} failed:`, e.message);
        if (signal?.aborted) throw e;
      }
    }
    console.warn(`[llm-router] Provider ${provider.provider_name} exhausted retries, failing over to next...`);
  }

  throw new Error("All active LLM providers failed (Failover exhausted).");
}
