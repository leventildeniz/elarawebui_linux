import { decryptSecret } from './vault.mjs';

/**
 * ELARA Sovereign AI OS - Agent & Provider Utilities
 * 
 * Ported from original_server_part_ae.
 * These utilities handle agent health, actor resolution, 
 * and AI provider orchestration.
 */

// --- General Helpers ---

export function isUuid(id) {
  if (!id) return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regex.test(String(id));
}

// --- Agent Health & State ---

export async function probeAgentHealth(baseUrl, healthPath) {
  const clean = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!clean) return { ok: true, skipped: true, message: "no bridge configured · local registry only" };
  const hp = `/${String(healthPath || "/health").replace(/^\/+/, "")}`;
  const url = `${clean}${hp}`;
  try {
    const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10000) }); // Default 10s timeout
    if (!r.ok) return { ok: false, message: `health ${r.status} ${r.statusText} @ ${url}` };
    return { ok: true, message: `health ${r.status} @ ${hp}` };
  } catch (e) {
    return { ok: false, message: `unreachable @ ${url} · ${String(e.message || e)}` };
  }
}

export async function setAgentArmedState(deps, id, targetActive) {
  const { pool } = deps;
  const { rows } = await pool.query("SELECT status, bridge_url, meta FROM agents WHERE id=$1", [id]);
  if (!rows.length) return { httpStatus: 404, body: { ok: false, error: `agent ${id} not found` } };
  
  if (targetActive) {
    const meta = rows[0]?.meta && typeof rows[0].meta === "object" ? rows[0].meta : {};
    const bridge = await probeAgentHealth(rows[0]?.bridge_url, meta.healthPath);
    
    if (!bridge.ok && !bridge.skipped) {
      await pool.query("UPDATE agents SET status='error', updated_at=now() WHERE id=$1", [id]);
      return { httpStatus: 200, body: { ok: false, id, status: "error", bridge, signal: false } };
    }
    
    const hasLiveSignal = bridge.ok && !bridge.skipped;
    await pool.query(
      "UPDATE agents SET status='active', last_active=CASE WHEN $2::boolean THEN now() ELSE last_active END, updated_at=now() WHERE id=$1",
      [id, hasLiveSignal]
    );
    
    try { await deps.hydrateAllowedAgentsFromDb(); } catch { /* ignore */ }
    return { httpStatus: 200, body: { ok: true, id, status: "active", bridge, signal: hasLiveSignal, allowedListSize: deps.getAllowedAgents().length } };
  }
  
  await pool.query("UPDATE agents SET status='idle', updated_at=now() WHERE id=$1", [id]);
  try { deps.cancelAllRunsForAgent(id); } catch { /* ignore */ }
  try { await deps.hydrateAllowedAgentsFromDb(); } catch { /* ignore */ }
  return { httpStatus: 200, body: { ok: true, id, status: "idle", bridge: { ok: true, skipped: true, message: "local registry deactivated" }, signal: false, allowedListSize: deps.getAllowedAgents().length } };
}

export async function readAgentCapabilityPacks(pool, agentId) {
  try {
    const { rows } = await pool.query(
      `SELECT pack_id FROM agent_capability_packs WHERE agent_id=$1 ORDER BY pack_id`,
      [agentId],
    );
    return rows.map((r) => String(r.pack_id));
  } catch { return []; }
}

// --- Identity Helpers ---

export async function resolveActorId(pool, req) {
  if (!req.actor) return null;
  try {
    const r = await pool.query("SELECT id FROM app_users WHERE lower(username)=lower($1) LIMIT 1", [req.actor]);
    return r.rows[0]?.id ?? null;
  } catch { return null; }
}

export function rowToAppAgent(r) {
  return {
    id: r.id, agentName: r.agent_name, scriptPath: r.script_path,
    bridgeUrl: r.bridge_url, role: r.role, status: r.status,
    description: r.description,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
  };
}

export function rowToTemplate(r) {
  return {
    id: r.id, name: r.name,
    systemPrompt: r.system_prompt ?? "",
    temperature: Number(r.temperature ?? 0.4),
    topP: Number(r.top_p ?? 0.9),
    maxTokens: Number(r.max_tokens ?? 4096),
    params: Array.isArray(r.params) ? r.params : (r.params ? JSON.parse(r.params) : []),
    agents: Array.isArray(r.agents) ? r.agents : (r.agents ? JSON.parse(r.agents) : []),
    ownerEditable: !!r.owner_editable,
    allowedProviders: Array.isArray(r.allowed_providers) ? r.allowed_providers : (r.allowed_providers ? JSON.parse(r.allowed_providers) : []),
    canOverrideProvider: r.can_override_provider !== false,
    allowedTools: Array.isArray(r.allowed_tools) ? r.allowed_tools : (r.allowed_tools ? JSON.parse(r.allowed_tools) : []),
    allowedSkills: Array.isArray(r.allowed_skills) ? r.allowed_skills : (r.allowed_skills ? JSON.parse(r.allowed_skills) : []),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// --- Provider Utilities ---

export function encField(v, encryptSecret) {
  if (!v) return { ct: "", iv: "", tag: "" };
  const e = encryptSecret(v);
  return { ct: e.ciphertext, iv: e.iv, tag: e.tag };
}

export function decField(ct, iv, tag) {
  if (!ct) return "";
  try { return decryptSecret(ct, iv, tag); } catch { return ""; }
}

export function maskKey(s) {
  if (!s) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return s.slice(0, 4) + "•".repeat(Math.max(4, s.length - 8)) + s.slice(-4);
}

export function rowToProvider(r, { reveal = false } = {}) {
  const key = decField(r.api_key_ct, r.api_key_iv, r.api_key_tag);
  return {
    id: r.id, providerName: r.provider_name, kind: r.kind,
    apiKey: reveal ? key : maskKey(key),
    hasKey: !!key,
    baseUrl: r.base_url, model: r.model,
    isActive: r.is_active, priority: r.priority,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
  };
}

export function approxTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.round(String(text).length / 4));
}

export function calculateAIQuality(promptText, responseText, inputCostRate = 0, outputCostRate = 0, promptTokens = 0, responseTokens = 0) {
  // 1. Refusal Check (Lightweight Regex)
  const refusalRegex = /^(i am sorry|i'm sorry|as an ai|i cannot|i can't|i am unable|i apologize)/i;
  const isRefusal = refusalRegex.test((responseText || "").trim());
  const refusalRate = isRefusal ? 100.0 : 0.0;

  // 2. Cost Calculation based on DB model parameters (Dynamic instead of Hardcoded)
  const costUsd = (promptTokens * (inputCostRate / 1000)) + (responseTokens * (outputCostRate / 1000));

  // 3. Groundedness & Hallucination (Heuristic based on Lexical Overlap & Length)
  let groundednessScore = 100.0;
  let hallucinationScore = 0.0;

  if (!isRefusal && responseText && promptText) {
     // A very crude mock for algorithm-based observability:
     // If response is extremely long compared to prompt, hallucination risk increases slightly.
     const ratio = responseTokens / (promptTokens || 1);
     if (ratio > 5) {
        hallucinationScore = Math.min(10, ratio - 5); // 0% to 10% penalty based on length mismatch
        groundednessScore = Math.max(80, 100 - hallucinationScore * 1.5);
     }
  }

  return { refusalRate, costUsd, groundednessScore, hallucinationScore, cacheHits: 0 };
}

export function recordUsage(enqueueWrite, { providerId, providerName, kind, model, threadId, promptTokens, responseTokens, latencyMs, status, hallucinationScore, groundednessScore, refusalRate, cacheHits, costUsd }) {
  enqueueWrite(
    `INSERT INTO provider_usage(provider_id, provider_name, kind, model, thread_id,
       prompt_tokens, response_tokens, total_tokens, latency_ms, status,
       hallucination_score, groundedness_score, refusal_rate, cache_hits, cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [providerId ?? null, providerName, kind, model ?? "", threadId ?? null,
     promptTokens|0, responseTokens|0, (promptTokens|0)+(responseTokens|0),
     latencyMs|0, status ?? "ok",
     hallucinationScore || 0, groundednessScore || 0, refusalRate || 0, cacheHits || 0, costUsd || 0]
  );
}

export async function getActiveProvider(pool, kind) {
  const { rows } = await pool.query(
    "SELECT * FROM ai_providers WHERE kind=$1 AND active=true ORDER BY priority ASC LIMIT 1",
    [kind]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return { ...r, apiKey: decField(r.api_key_ct, r.api_key_iv, r.api_key_tag) };
}

export async function getActiveProviders(pool, kind) {
  const { rows } = await pool.query(
    "SELECT * FROM ai_providers WHERE kind=$1 AND active=true ORDER BY priority ASC, name ASC",
    [kind]
  );
  return rows.map(r => ({ ...r, apiKey: decField(r.api_key_ct, r.api_key_iv, r.api_key_tag) }));
}

export async function getProviderById(pool, id) {
  const { rows } = await pool.query("SELECT * FROM ai_providers WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { ...r, apiKey: decField(r.api_key_ct, r.api_key_iv, r.api_key_tag) };
}

export function detectProviderFamily(name = "", baseUrl = "") {
  const n = `${name} ${baseUrl}`.toLowerCase();
  if (/anthropic|claude/.test(n)) return "anthropic";
  if (/gemini|googleapis|generativelanguage/.test(n)) return "gemini";
  return "openai";
}

export async function* streamFromOpenAICompat({ apiKey, model, baseUrl, messages, signal }) {
  const url = `${(baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model || "gpt-4o-mini", messages, stream: true }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`provider ${r.status} ${await r.text().catch(()=> "")}`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n"); buf = frames.pop() ?? "";
    for (const f of frames) {
      const line = f.trim(); if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim(); if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const piece = j.choices?.[0]?.delta?.content || "";
        if (piece) yield piece;
      } catch {}
    }
  }
}

export async function* streamFromAnthropic({ apiKey, model, baseUrl, messages, signal }) {
  const url = `${(baseUrl || "https://api.anthropic.com").replace(/\/+$/, "")}/v1/messages`;
  const sys = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
  const msgs = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "assistant" : "user", content: m.content,
  }));
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: model || "claude-3-5-sonnet-latest", max_tokens: 4096, system: sys || undefined, messages: msgs, stream: true }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`anthropic ${r.status} ${await r.text().catch(()=> "")}`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n"); buf = frames.pop() ?? "";
    for (const f of frames) {
      const line = f.trim(); if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        const piece = j.delta?.text || j.content_block?.text || "";
        if (piece) yield piece;
      } catch {}
    }
  }
}

export async function* streamFromProvider({ provider, messages, signal, streamFromGemini, streamFromAnthropic, streamFromOpenAICompat }) {
  const fam = detectProviderFamily(provider.provider_name, provider.base_url);
  if (fam === "gemini") {
    yield* streamFromGemini({ apiKey: provider.apiKey, model: provider.model, baseUrl: provider.base_url, messages, signal });
    return;
  }
  if (fam === "anthropic") {
    yield* streamFromAnthropic({ apiKey: provider.apiKey, model: provider.model, baseUrl: provider.base_url, messages, signal });
    return;
  }
  yield* streamFromOpenAICompat({ apiKey: provider.apiKey, model: provider.model, baseUrl: provider.base_url, messages, signal });
}

export async function getRoutingPolicy(pool) {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='ai.routing'").catch(()=>({rows:[]}));
  const v = rows[0]?.value || {};
  return { mode: v.mode || "failover", rules: Array.isArray(v.rules) ? v.rules : [] };
}

export function pickByRouter(providers, lastUserText, rules) {
  const text = String(lastUserText || "").toLowerCase();
  for (const r of rules) {
    if (!r?.match || !r?.providerId) continue;
    try { if (new RegExp(r.match, "i").test(text)) {
      const hit = providers.find(p => p.id === r.providerId); if (hit) return hit;
    } } catch {}
  }
  return providers[0] || null;
}

export async function pickProviderForRequest(deps, { providerId, lastUserText, allowedIds = null }) {
  if (providerId) return await deps.getProviderById(deps.pool, providerId);
  let list = await deps.getActiveProviders(deps.pool, "llm");
  if (allowedIds && allowedIds.length) list = list.filter(p => allowedIds.includes(p.id));
  if (!list.length) return null;
  const pol = await deps.getRoutingPolicy(deps.pool);
  if (pol.mode === "router") return pickByRouter(list, lastUserText, pol.rules);
  return list[0];
}
