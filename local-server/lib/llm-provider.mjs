/**
 * llm-provider.mjs — Generic LLM Provider Interface.
 * Part of S.A.R.P. (Sovereign Agnostic Refactor Project).
 * 
 * This module provides a standardized interface for LLM streaming and 
 * auxiliary services like web search, decoupling the core from specific vendors.
 */

import { initLlmRouter, streamRoutedLLM } from './llm-router.mjs';

let _deps = null;

/**
 * Initializes the LLM provider with the central dependency object.
 * @param {Object} deps - Central dependency injection object.
 */
export function initLlmProvider(deps) {
  _deps = deps || {};
  initLlmRouter(deps);
}

/**
 * Generic stream function for LLM responses.
 * Now routes through the Multi-Provider AI Gateway.
 */
export async function stream(params) {
  return await streamRoutedLLM(params);
}

/**
 * Generic web search dispatcher.
 * Attempts to use a local Researcher agent first, then falls back to configured cloud providers.
 * 
 * @param {Object} params
 * @param {string} params.query - Search query.
 * @param {AbortSignal} params.signal - Signal to cancel the request.
 * @returns {Promise<Object>}
 */
export async function webSearch({ query, signal }) {
  if (!_deps) throw new Error("[llm-provider] initLlmProvider() not called");
  
  const { pool, getActiveProvider } = _deps;

  // 1) Try local Researcher agent on :3001 first
  try {
    const { rows } = await pool.query(
      "SELECT * FROM app_agents WHERE status='active' AND lower(role)='researcher' ORDER BY updated_at DESC LIMIT 1"
    );
    const agent = rows[0];
    if (agent && agent.bridge_url) {
      const r = await fetch(`${agent.bridge_url}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const j = await r.json();
        return { source: `local:${agent.agent_name}`, results: j.results ?? j };
      }
    }
  } catch (e) {
    console.warn("[llm-provider:webSearch] local agent failed:", e.message);
  }

  // 2) Fallback: Cloud Search Providers (Tavily / Serper)
  const searchProvider = await getActiveProvider("search");
  if (searchProvider && searchProvider.apiKey) {
    const name = searchProvider.provider_name.toLowerCase();
    
    if (name.includes("tavily")) {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: searchProvider.apiKey, query, max_results: 5 }),
        signal,
      });
      if (r.ok) return { 
        source: `cloud:${searchProvider.provider_name}`, 
        providerId: searchProvider.id, 
        providerName: searchProvider.provider_name, 
        results: await r.json() 
      };
    }

    if (name.includes("serper")) {
      const r = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": searchProvider.apiKey },
        body: JSON.stringify({ q: query }),
        signal,
      });
      if (r.ok) return { 
        source: `cloud:${searchProvider.provider_name}`, 
        providerId: searchProvider.id, 
        providerName: searchProvider.provider_name, 
        results: await r.json() 
      };
    }
  }

  return { source: "none", results: null };
}
