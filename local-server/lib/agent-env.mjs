// agents/_shared → middleware enjeksiyon sözleşmesi.
// runLocalAgent({env}) parametresine geçirilecek dict'i üretir.
// Kaynak: PostgreSQL agents tablosu (meta.systemPrompt + inference + model)
//   + vault_secrets (scope='agent:<id>')  →  ELARA_SECRET_<NAME> env'leri.
//
// Vault okuması başarısızsa diğer alanlar yine döner; secret eksikliği
// runtime'da ajan tarafında handle edilir (örn. "credential missing" hatası).

import { getSecretsForScope, vaultAuditRuntime, getSecretField } from "./vault.mjs";
import { getAgentManifest } from "./agent-manifest.mjs";
import { collectInjectedTools } from "./mcp/client.mjs";
import { nowEnvFor } from "./now.mjs";

// 2026-06-03 — UI = tek mercii (agent prompt katmanları). RAG_SETTINGS'ten
// 3 string knob (agentRagWithHitsDirective / agentRagNoHitsDirective /
// agentToolsManifestFrame) okunup env üzerinden Python config_center'a
// geçer. Boş ise Python tarafında kod-içi default devreye girer.
let _getRagSettings = () => ({});
export function initAgentEnv({ getRagSettings }) {
  if (typeof getRagSettings === "function") _getRagSettings = getRagSettings;
}
function _promptOverrideEnv() {
  let s = {};
  try { s = _getRagSettings() || {}; } catch { s = {}; }
  const out = {};
  const wh = typeof s.agentRagWithHitsDirective === "string" ? s.agentRagWithHitsDirective.trim() : "";
  const nh = typeof s.agentRagNoHitsDirective === "string" ? s.agentRagNoHitsDirective.trim() : "";
  const tf = typeof s.agentToolsManifestFrame === "string" ? s.agentToolsManifestFrame.trim() : "";
  if (wh) out.ELARA_AGENT_RAG_WITH_HITS_DIRECTIVE = wh;
  if (nh) out.ELARA_AGENT_RAG_NO_HITS_DIRECTIVE   = nh;
  if (tf) out.ELARA_AGENT_TOOLS_MANIFEST_FRAME    = tf;
  return out;
}

/**
 * Build the ELARA_AGENT_TOOLS env var: a JSON array of `{slug, description}`
 * pulled from action_library for whatever tools the agent's `# @tools:`
 * manifest declares. Python-side `config_center._build_tools_block()` renders
 * this into a system-prompt fragment.
 *
 * Returns `{}` when:
 *   - the agent has no manifest header,
 *   - the manifest is the LLM-only sentinel (`# @tools: -`),
 *   - or no rows match in action_library.
 *
 * Stays single-SQL; description lookup uses a single `ANY($1)` round-trip.
 * Slugs the DB does not know are still listed (slug only, no description) so
 * the LLM still sees them — DB is the description source of truth, never the
 * gate (the gate is `agent-manifest.mjs` + `/api/agents/tool-call`).
 *
 * @param {object} pool - pg Pool
 * @param {object} a    - agents row (id, meta, agent_path)
 * @returns {Promise<Record<string,string>>}
 */
export async function buildAgentToolsEnv(pool, a, opts = {}) {
  if (!a || typeof a !== "object") return {};
  if (opts?.suppressToolManifest) return {};

  // Collect MCP-client injected remote tools (available across ALL agents when
  // per-server auto_inject=true). These appear alongside local tools with a
  // "mcp:" prefix and route through /api/agents/tool-call → dispatchInjectedCall.
  let mcpTools = [];
  if (pool) {
    try { mcpTools = await collectInjectedTools(pool); } catch { mcpTools = []; }
  }
  const mcpEntries = mcpTools.map((t) => ({
    slug: t.name,
    description: t.description || "",
    system_prompt: "",
  }));

  const meta = (a.meta && typeof a.meta === "object") ? a.meta : {};
  const scriptRaw = String(meta.script || a.agent_path || "").trim();
  const baseName = scriptRaw
    ? (scriptRaw.includes("/") ? scriptRaw.slice(scriptRaw.lastIndexOf("/") + 1) : scriptRaw)
        .replace(/\.py$/i, "")
        .trim()
        .toLowerCase()
    : "";

  let manifest = null;
  if (baseName) {
    try { manifest = await getAgentManifest(baseName); } catch { manifest = null; }
  }
  const localSlugs = (manifest && Array.isArray(manifest.tools))
    ? manifest.tools.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    : [];

  // If neither local nor remote tools exist, emit nothing.
  if (!localSlugs.length && !mcpEntries.length) return {};

  /** @type {Map<string,{description:string, system_prompt:string}>} */
  const metaBySlug = new Map();
  if (pool && localSlugs.length) {
    try {
      const r = await pool.query(
        `SELECT id, slug, name, description, system_prompt
           FROM action_library
          WHERE lower(slug) = ANY($1::text[])
             OR lower(id)   = ANY($1::text[])
             OR lower(name) = ANY($1::text[])`,
        [localSlugs],
      );
      for (const row of r.rows) {
        const keys = [row.slug, row.id, row.name]
          .filter(Boolean)
          .map((s) => String(s).trim().toLowerCase());
        const desc = String(row.description ?? "").trim();
        const sysp = String(row.system_prompt ?? "").trim();
        for (const k of keys) {
          if (!metaBySlug.has(k)) metaBySlug.set(k, { description: desc, system_prompt: sysp });
        }
      }
    } catch {
      // Schema drift — slug-only list still useful.
    }
  }

  const localEntries = localSlugs.map((slug) => {
    const m = metaBySlug.get(slug) || {};
    return { slug, description: m.description || "", system_prompt: m.system_prompt || "" };
  });
  const tools = [...localEntries, ...mcpEntries];
  const env = { ELARA_AGENT_TOOLS: JSON.stringify(tools) };
  if (opts.includeToolPrompts) env.ELARA_AGENT_TOOL_PROMPT_GUIDE = "1";
  return env;
}


// UI = single source of truth. Backend MUST NOT silently narrow what the user
// saved in agents.meta.inference. We only:
//  - coerce to number / round where the env var protocol requires
//  - fall back to the same defaults the UI would show when a value is missing
//  - dedupe stop_sequences and cap the array length (env serialization budget)
// Hard ranges (min/max) used to live here. They are deliberately removed —
// see mem://decisions/ui-params-single-source-all-entities-2026-05-28.md
const AGENT_DEFAULTS = Object.freeze({
  temperature: 0.2,
  top_p: 0.85,
  repetition_penalty: 1.1,
  no_repeat_ngram_size: 0,
  max_output_tokens: 1200,
});

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeStopSequences(value) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(value)) {
    for (const raw of value) {
      const s = String(raw || "");
      if (!s || seen.has(s)) continue;
      seen.add(s); out.push(s);
      if (out.length >= 8) break;
    }
  }
  return out;
}

/**
 * @param {object|null} a - agents tablo satırı (id, model, meta jsonb)
 * @returns {Record<string,string>}
 */
export function buildAgentEnv(a) {
  if (!a || typeof a !== "object") return {};
  const meta = (a.meta && typeof a.meta === "object") ? a.meta : {};
  const inf = (meta.inference && typeof meta.inference === "object") ? meta.inference : {};
  const env = {
    ELARA_AGENT_ID: String(a.id ?? ""),
    ELARA_AGENT_SQUAD: String(meta.squad ?? "NetSec"),
    ELARA_AGENT_SYSTEM_PROMPT: String(meta.systemPrompt ?? ""),
  };
  // UI değeri varsa aynen geçer; yoksa default. Sessiz daraltma YOK.
  env.ELARA_AGENT_TEMPERATURE = String(finiteNumber(inf.temperature, AGENT_DEFAULTS.temperature));
  env.ELARA_AGENT_TOP_P = String(finiteNumber(inf.top_p, AGENT_DEFAULTS.top_p));
  env.ELARA_AGENT_REPETITION_PENALTY = String(finiteNumber(inf.repetition_penalty, AGENT_DEFAULTS.repetition_penalty));
  env.ELARA_AGENT_NO_REPEAT_NGRAM_SIZE = String(Math.round(finiteNumber(inf.no_repeat_ngram_size, AGENT_DEFAULTS.no_repeat_ngram_size)));
  env.ELARA_AGENT_MAX_TOKENS = String(Math.round(finiteNumber(inf.max_output_tokens, AGENT_DEFAULTS.max_output_tokens)));
  env.ELARA_AGENT_STOP_SEQUENCES = JSON.stringify(safeStopSequences(inf.stop_sequences));
  // ELARA_AGENT_MODEL + ELARA_MLX_BASE_URL: buildBrainEnv(pool, a) tarafından
  // models.id → live base_url + model_name olarak resolve edilir.
  return env;
}


/**
 * Bir agent satırı için vault scope'unu üret. ID'yi normalize eder.
 */
function vaultScopeForAgent(agentId) {
  const id = String(agentId || "").trim();
  return id ? `agent:${id}` : null;
}

/**
 * Vault'tan agent'ın secret'larını çek, env dict'e ELARA_SECRET_<NAME>
 * (ve istenirse <NAME>) olarak yerleştir. Her okuma audit'lenir
 * (tek bir 'read-bulk' kaydı, isimler meta'da).
 *
 * @param {object} pool
 * @param {string} agentId
 * @returns {Promise<Record<string,string>>}
 */
async function buildVaultEnvForAgent(pool, agentId) {
  const scope = vaultScopeForAgent(agentId);
  if (!scope) return {};
  const secrets = await getSecretsForScope(pool, scope);
  const names = Object.keys(secrets);
  if (!names.length) return {};

  await vaultAuditRuntime(pool, {
    action: "read-bulk",
    scope,
    name: "*",
    actor: "agent-runtime",
    meta: { count: names.length, names },
  });

  const env = {};
  for (const [name, value] of Object.entries(secrets)) {
    // Namespace'li (güvenli default) + raw isim (ajan script'i kolay okusun).
    // Raw isim olmasaydı her ajan ELARA_SECRET_ prefix'ini bilmek zorundaydı.
    env[`ELARA_SECRET_${name}`] = String(value);
    env[name] = String(value);
  }
  return env;
}

/**
 * Script adından DB'deki agents satırını bul, env dict üret.
 * `script` ya basename ("firewall_oracle.py") ya da squad-prefixli
 * göreli yol ("NetSec/firewall_oracle.py") olabilir; ikisini de matchler.
 * Bulunamazsa boş döner — runLocalAgent default'lara düşer.
 *
 * Lookup öncelik sırası:
 *   1) meta->>'script' = relPath              (tam göreli yol, en spesifik)
 *   2) agent_path LIKE '%/' || relPath        (path son segmenti = göreli yol)
 *   3) agent_path LIKE '%/' || basename       (dosya adı fallback)
 *   4) (meta->>'script') LIKE '%/' || basename
 *
 * @param {object} pool - pg Pool
 * @param {string} script - "*.py" dosya adı veya göreli yol
 * @returns {Promise<Record<string,string>>}
 */
export async function buildAgentEnvForScript(pool, script, opts = {}) {
  if (!pool || !script) return {};
  const rel = String(script);
  const base = rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel;
  let agentRow = null;
  try {
    const r = await pool.query(
      `SELECT id, model, meta
         FROM agents
        WHERE (meta->>'script') = $1
           OR agent_path LIKE '%/' || $1
           OR agent_path LIKE '%/' || $2
           OR (meta->>'script') LIKE '%/' || $2
        ORDER BY
          CASE WHEN (meta->>'script') = $1 THEN 0
               WHEN agent_path LIKE '%/' || $1 THEN 1
               ELSE 2 END,
          updated_at DESC NULLS LAST
        LIMIT 1`,
      [rel, base],
    );
    agentRow = r.rows[0] || null;
  } catch {
    return {};
  }
  if (!agentRow) return {};

  const baseEnv = buildAgentEnv(agentRow);
  const brainEnv = await buildBrainEnv(pool, agentRow);
  const vaultEnv = await buildVaultEnvForAgent(pool, agentRow.id);
  const fieldBindingsEnv = await buildFieldBindingEnvForAgent(pool, agentRow.id);
  const packEnv = await buildPackOverlayEnv(pool, agentRow.id);
  const toolsEnv = opts?.suppressToolManifest ? {} : await buildAgentToolsEnv(pool, agentRow, opts);
  // RAG context injection (2026-06-01): chat-stream / chat-orchestrate now pass
  // opts.ragQuery so the agent process sees ELARA_AGENT_RAG_CONTEXT. Previously
  // only /api/agents/:id/run wired this in, so @[script.py] chat invocations
  // ran without RAG hits even when the library had relevant snippets.
  let ragEnv = {};
  if (opts && typeof opts.ragQuery === "string" && opts.ragQuery.trim()) {
    try {
      const mod = await import("./agent-rag.mjs");
      if (typeof mod.buildAgentRagContext === "function") {
        const rag = await mod.buildAgentRagContext(pool, agentRow.id, opts.ragQuery);
        if (rag && rag.env && typeof rag.env === "object") {
          ragEnv = rag.env;
          try {
            console.error(`[agent-env] rag.injected agent=${agentRow.id} q="${opts.ragQuery.slice(0, 60)}" hits=${rag.meta?.hits ?? 0} mode=${rag.meta?.mode || "-"} decision=${rag.meta?.decision || "-"}`);
          } catch { /* */ }
        }
        // 2026-06-02 — Caller (chat-stream/orchestrate) agent rag meta'sını
        // SSE'ye yansıtsın diye opsiyonel onRagMeta callback'i.
        if (typeof opts.onRagMeta === "function" && rag && rag.meta) {
          try { opts.onRagMeta(rag.meta); } catch (cbErr) { console.warn(`[agent-env] onRagMeta callback threw: ${cbErr?.message || cbErr}`); }
        }
      }
    } catch (e) {
      console.warn(`[agent-env] rag.context.failed agent=${agentRow.id} err=${e?.message || e}`);
    }
  }
  // REALTIME CONTEXT (2026-06-02) — agent her zaman gerçek "şu an"ı görsün.
  // Server clock zorunlu; userNow/userTz UI hint'i (opsiyonel). Python tarafında
  // config_center._build_now_block() bu env'leri sealed prompt block'a basar.
  const nowEnv = nowEnvFor({ userNow: opts?.userNow ?? null, userTz: opts?.userTz ?? null });
  const promptEnv = _promptOverrideEnv();
  return { ...baseEnv, ...brainEnv, ...vaultEnv, ...fieldBindingsEnv, ...packEnv, ...toolsEnv, ...ragEnv, ...nowEnv, ...promptEnv };
}


/**
 * Faz D (2026-05-28) — gather system_prompt from every capability_pack bound
 * to this agent (via agent_capability_packs) and emit ELARA_AGENT_PACK_PROMPT.
 * config_center.effective_system_prompt() prepends this to the agent's own
 * meta.systemPrompt with a `\n\n---\n` separator.
 *
 * Empty/no rows → returns {} (no env var, no overlay). Multi-pack joined with
 * `\n\n---\n` in pack name order so the operator can predict the stacking.
 */
export async function buildPackOverlayEnv(pool, agentId) {
  if (!pool || !agentId) return {};
  try {
    const { rows } = await pool.query(
      `SELECT cp.name, cp.system_prompt
         FROM agent_capability_packs acp
         JOIN capability_packs cp ON cp.id = acp.pack_id
        WHERE acp.agent_id = $1
          AND coalesce(cp.system_prompt, '') <> ''
        ORDER BY cp.name`,
      [agentId],
    );
    if (!rows.length) return {};
    const joined = rows.map(r => String(r.system_prompt || "").trim()).filter(Boolean).join("\n\n---\n");
    return joined ? { ELARA_AGENT_PACK_PROMPT: joined } : {};
  } catch {
    // capability_packs.system_prompt column missing (pre-migration) → no-op.
    return {};
  }
}

/**
 * Field-aware credential injection (Vault v2 + Tur-2).
 * agent_vault_bindings tablosundaki her satır için:
 *   - vault_secret_fields'tan plaintext alanı çek (sadece runtime için).
 *   - env[env_alias] = plaintext (child process'e teslim).
 * Plaintext sadece child process içinde; audit "bindings_applied" tek satır,
 * isimler dahil ama içerik ASLA loglanmaz.
 *
 * @param {object} pool
 * @param {string} agentId
 * @returns {Promise<Record<string,string>>}
 */
export async function buildFieldBindingEnvForAgent(pool, agentId) {
  if (!pool || !agentId) return {};
  let rows = [];
  try {
    const r = await pool.query(
      `SELECT env_alias, vault_scope, vault_name, field_name
         FROM agent_vault_bindings
        WHERE agent_id=$1`,
      [agentId],
    );
    rows = r.rows;
  } catch {
    // Table missing (migration not yet applied) → silent no-op.
    return {};
  }
  if (!rows.length) return {};

  const env = {};
  const applied = [];
  const missing = [];
  for (const b of rows) {
    try {
      const v = await getSecretField(pool, b.vault_scope, b.vault_name, b.field_name);
      if (v == null) { missing.push(b.env_alias); continue; }
      env[b.env_alias] = String(v);
      applied.push(b.env_alias);
    } catch {
      missing.push(b.env_alias);
    }
  }
  try {
    await vaultAuditRuntime(pool, {
      action: "bindings-apply",
      scope: `agent:${agentId}`,
      name: "*",
      actor: "agent-runtime",
      meta: { applied, missing, count: applied.length },
    });
  } catch { /* audit best-effort */ }
  return env;
}

// ---------------------------------------------------------------------------
// Brain resolver — converts a.model (now models.id) to {base_url, model_name}
// and emits the two env vars the Python runtime reads:
//   - ELARA_MLX_BASE_URL   → cfg.MLX_BASE_URL (httpx baseURL)
//   - ELARA_AGENT_MODEL    → cfg.AGENT_MODEL_OVERRIDE (chat.completions model)
//
// Resolution order:
//   1) a.model matches models.id exactly                → use that row
//   2) a.model is a legacy modelName (pre-migration)    → fallback lookup,
//      WARN-log so the operator can re-pick the brain
//   3) provider:<id>                                    → cloud route (left to
//      provider router; we only emit MLX vars when local)
//   4) anything else / empty                            → is_default=true row
//   5) no rows at all                                   → {} (mlx_runner will
//      resolve via /v1/models sentinel)
// ---------------------------------------------------------------------------
export async function buildBrainEnv(pool, a) {
  if (!pool) return {};
  const raw = String((a && a.model) || "").trim();
  if (raw.startsWith("provider:")) return {}; // cloud route handled elsewhere
  /** @type {{id?:string, name?:string, base_url?:string, chat_template_id?:string, chat_template?:string, stop_sequences?:unknown, advanced?:unknown, model_id?:string}|null} */
  let row = null;
  const COLS = "id, name, base_url, chat_template_id, chat_template, stop_sequences, advanced, model_id";
  try {
    if (raw) {
      const r1 = await pool.query(
        `SELECT ${COLS} FROM models WHERE id=$1 LIMIT 1`,
        [raw],
      );
      row = r1.rows[0] || null;
      if (!row) {
        const r2 = await pool.query(
          `SELECT ${COLS} FROM models WHERE name=$1 ORDER BY created_at DESC LIMIT 1`,
          [raw],
        );
        row = r2.rows[0] || null;
        if (row) {
          console.error(`[buildBrainEnv] legacy modelName ref agent=${a?.id} model="${raw}" → resolved to models.id=${row.id} (please re-pick in UI)`);
        }
      }
    }
    if (!row) {
      // Look up system default from engine_config
      const r3 = await pool.query(
        `SELECT active_model_id FROM engine_config WHERE id='singleton'`
      );
      const defaultId = r3.rows[0]?.active_model_id;
      if (defaultId) {
        const r4 = await pool.query(`SELECT ${COLS} FROM models WHERE id=$1`, [defaultId]);
        row = r4.rows[0] || null;
      }
    }
  } catch (err) {
    // Schema drift (pre-migration): fall back to base columns only.
    try {
      const r4 = await pool.query(
        "SELECT id, name, base_url FROM models WHERE id=$1 ORDER BY id=$1 DESC LIMIT 1",
        [raw || ""],
      );
      row = r4.rows[0] || null;
    } catch {
      console.error(`[buildBrainEnv] lookup failed: ${err?.message || err}`);
      return {};
    }
  }
  if (!row) return {};
  const env = {};
  if (row.base_url && String(row.base_url).trim()) {
    env.ELARA_AI_BASE_URL = String(row.base_url).trim();
  }
  // MLX runtime expects the loaded runtime slug. If the operator bound a
  // serving ID in /models UI (model_id), trust it as-is — MLX's own
  // /v1/models list is the source. Otherwise fall back to models.id.
  const boundServingId = String(row.model_id ?? "").trim();
  const runtimeSlug = boundServingId || String(row.id ?? "").trim() || String(row.name ?? "").trim();
  if (runtimeSlug) {
    env.ELARA_AGENT_MODEL = runtimeSlug;
  }

  // Per-model chat template (Yol C). Empty cells → runner falls back to
  // env LLM_CHAT_TEMPLATE → "qwen2.5". UI = single source of truth.
  const family = String(row.chat_template_id ?? "").trim().toLowerCase();
  if (family) env.ELARA_LLM_TEMPLATE_FAMILY = family;
  const prefix = String(row.chat_template ?? "").trim();
  if (prefix) env.ELARA_LLM_PROMPT_PREFIX = prefix;
  try {
    const sRaw = row.stop_sequences;
    const arr = typeof sRaw === "string" ? JSON.parse(sRaw || "[]") : sRaw;
    if (Array.isArray(arr) && arr.length) {
      const clean = arr.map((s) => String(s)).filter(Boolean).slice(0, 8);
      if (clean.length) env.ELARA_LLM_STOP_SEQUENCES = JSON.stringify(clean);
    }
  } catch { /* malformed → ignore */ }
  // Per-model advanced params from models row (UI: /models Advanced settings).
  let mergedKwargs = null;
  try {
    const kRaw = row.advanced;
    const obj = typeof kRaw === "string" ? JSON.parse(kRaw || "{}") : kRaw;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) mergedKwargs = { ...obj };
  } catch { /* malformed → ignore */ }
  // Per-agent override (UI: agent editor Thinking Switch). meta.thinking is the
  // single source of truth — when defined it wins over the model's setting.
  try {
    const meta = (a && typeof a === "object" && a.meta && typeof a.meta === "object") ? a.meta : null;
    if (meta && typeof meta.thinking === "boolean") {
      mergedKwargs = { ...(mergedKwargs || {}), enable_thinking: meta.thinking };
    }
  } catch { /* ignore */ }
  if (mergedKwargs && Object.keys(mergedKwargs).length) {
    env.ELARA_LLM_CHAT_TEMPLATE_KWARGS = JSON.stringify(mergedKwargs);
  }
  return env;
}



