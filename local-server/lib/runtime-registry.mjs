// local-server/lib/runtime-registry.mjs
// Runtime provider registry — presets + utils + state + readers.
// Tur 1 (2026-05-30): stateless helpers extracted.
// Tur 2 (2026-05-30): state (RUNTIME_PROVIDER_CFG) + readers (runtimeBase/Model/
//   IsMlx/UpstreamBase, _safeRuntimeModel, _mlxServingId) + hydrate moved here.
//   hydrate takes `pool` via initRuntimeRegistry({pool}) DI.

let _pool = null;
export function initRuntimeRegistry({ pool } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("[runtime-registry] initRuntimeRegistry: pool required");
  }
  _pool = pool;
}

// --- Provider presets -------------------------------------------------------
// MLX = local mlx_lm.server (port ${process.env.LOCAL_RUNTIME_PORT || 8001}, OpenAI-compatible /v1).
// Legacy = Ollama-style (port ${process.env.LEGACY_PORT || 11434}).
// Custom = operator-defined baseUrl/model in /system-engine.
export const RUNTIME_PROVIDER_PRESETS = {
  // 2026-06-04 — model presets emptied. Phantom "Qwen…" defaults were leaking
  // into the UI and warmup paths when operators had a different runtime loaded
  // (e.g. Gemma). The base URL is the only safe preset; the model ID must be
  // picked explicitly from the runtime's /v1/models response.
  mlx:    { baseUrl: `http://127.0.0.1:${process.env.LOCAL_RUNTIME_PORT || 8001}/v1`, model: "" },
  legacy: { baseUrl: `http://127.0.0.1:${process.env.LEGACY_PORT || 11434}`,   model: "" },
  custom: { baseUrl: "",                          model: "" },
};

export function defaultRuntimeProviderConfig() {
  return {
    provider: "mlx",
    baseUrl: "",
    model: "",
    models: { mlx: [], legacy: [], custom: [] },
  };
}

// --- Error formatter --------------------------------------------------------
export function runtimeFetchError(err, ctx = {}) {
  const msg = String(err?.message || err?.code || err || "fetch failed");
  const parts = [];
  if (ctx.provider) parts.push(`provider=${ctx.provider}`);
  if (ctx.phase) parts.push(`phase=${ctx.phase}`);
  if (ctx.model) parts.push(`model=${ctx.model}`);
  if (ctx.target) parts.push(`target=${ctx.target}`);
  else {
    if (ctx.upstreamBase) parts.push(`upstream=${ctx.upstreamBase}`);
    if (ctx.publicBase && ctx.publicBase !== ctx.upstreamBase) parts.push(`public=${ctx.publicBase}`);
  }
  return `[runtime-fetch] ${msg}${parts.length ? " · " + parts.join(" · ") : ""}`;
}

// --- URL helpers ------------------------------------------------------------
export function normalizeRuntimeBaseUrl(baseUrl) {
  let base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return base;
  try {
    const u = new URL(base);
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "::1" || h === "0.0.0.0" || h === "[::1]") {
      u.hostname = "127.0.0.1";
      base = u.toString().replace(/\/+$/, "");
    }
  } catch { /* relative or bare host — leave as-is */ }
  return base;
}

export function joinRuntimePath(base, pathName) {
  const cleanPath = `/${String(pathName).replace(/^\/+/, "")}`;
  if (base.endsWith("/v1") && cleanPath.startsWith("/v1/")) return `${base}${cleanPath.slice(3)}`;
  return `${base}${cleanPath}`;
}

export function fallbackModelName(id) {
  const leaf = String(id ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
  return leaf || String(id ?? "");
}

// --- Model sanitization + provider resolver ---------------------------------
export function sanitizeModels(input) {
  const out = { mlx: [], legacy: [], custom: [] };
  if (!input || typeof input !== "object") return out;
  for (const k of ["mlx","legacy","custom"]) {
    const arr = Array.isArray(input[k]) ? input[k] : [];
    const seen = new Set();
    for (const m of arr) {
      const s = String(m || "").trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out[k].push(s);
    }
  }
  return out;
}

export function resolveProvider(p) {
  const k = String(p || "").toLowerCase();
  if (!k) return "mlx";
  if (["mlx","legacy","custom"].includes(k)) return k;
  if (k.includes("mlx")) return "mlx";
  if (k.includes("legacy") || k.includes("ollama")) return "legacy";
  return "custom";
}

// --- Model slug guards ------------------------------------------------------
export function isPathLikeModelId(s) {
  const v = String(s ?? "").trim();
  if (!v) return false;
  if (v.startsWith("/") || v.startsWith("~") || v.startsWith("./") || v.startsWith("../")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(v)) return true;
  return false;
}

export function assertModelSlug(mdl, ctx = "") {
  const v = String(mdl ?? "").trim();
  if (!v) {
    const err = new Error(`MODEL_SLUG_INVALID: no registered model selected (${ctx}). Add a model in /models and mark it default.`);
    err.code = "MODEL_SLUG_INVALID"; throw err;
  }
  if (isPathLikeModelId(v)) {
    const err = new Error(`MODEL_SLUG_INVALID: "${v}" looks like a filesystem path (${ctx}). Re-pick the model in /models — IDs must be repo slugs like "mlx-community/Qwen3-32B-4bit".`);
    err.code = "MODEL_SLUG_INVALID"; throw err;
  }
  return v;
}

// --- Runtime Provider Switch (state) ---------------------------------------
// Operator picks provider in System Engine; choice is sealed in app_settings
// so the box remembers across reboots — terminalsiz kokpit.
// CFG is a live-binding object; all property mutations elsewhere
// (Object.assign in save handler) propagate to all readers.
export const RUNTIME_PROVIDER_CFG = defaultRuntimeProviderConfig();
RUNTIME_PROVIDER_CFG.hydrated = false;
RUNTIME_PROVIDER_CFG.updatedAt = null;

// --- Readers ----------------------------------------------------------------
export function runtimeBase() {
  const cfg = RUNTIME_PROVIDER_CFG;
  if (cfg.baseUrl) return normalizeRuntimeBaseUrl(cfg.baseUrl);
  const preset = RUNTIME_PROVIDER_PRESETS[resolveProvider(cfg.provider)];
  return normalizeRuntimeBaseUrl(preset.baseUrl);
}

export function runtimeModel() {
  const cfg = RUNTIME_PROVIDER_CFG;
  if (cfg.model) return cfg.model;
  const preset = RUNTIME_PROVIDER_PRESETS[resolveProvider(cfg.provider)];
  return preset.model;
}

// safe variant: never returns a path. Used wherever runtimeModel() was used
// as a fallback inside chat/MLX call sites.
export function safeRuntimeModel() {
  const v = runtimeModel();
  return isPathLikeModelId(v) ? "" : v;
}

// _mlxServingId — UI'dan bağlanmış runtime_model_id varsa onu, yoksa
// row.id'yi (path-guard ile) döner. MLX'in /v1/models listesinde sunduğu
// path-style ID'ler (örn. "/var/lib/elara/models/Qwen3-32B-4bit") operatör
// tarafından bilerek bağlandığı için path-guard'dan muaftır.
export function mlxServingId(row, opts = {}) {
  const bound = String(row?.runtime_model_id ?? "").trim();
  if (bound) return bound;
  const fallback = String(row?.id || opts.fallback || safeRuntimeModel() || "").trim();
  if (opts.assert === false) return fallback;
  return assertModelSlug(fallback, opts.ctx || "model");
}

// runtimeIsMlx — provider field is authoritative (set by /models card +
// /system-engine Runtime Provider card). URL sniff is fallback only when
// the provider record is missing or unknown (e.g. first-boot before hydrate).
export function runtimeIsLocal(base, providerOverride = null) {
  const p = resolveProvider(providerOverride ?? RUNTIME_PROVIDER_CFG.provider);
  if (p === "mlx") return true;
  if (p === "legacy") return false;
  const b = base || runtimeBase();
  return new RegExp(`:${process.env.LOCAL_RUNTIME_PORT || 8001}\\b`).test(b) || b.endsWith("/v1");
}

// 2026-05-29 — UI is the single source of truth. If the operator entered an
// explicit hostname + port on the model card, honour it. We only fill in
// missing pieces from the provider preset; the previous version force-rewrote
// MLX→:${process.env.LOCAL_RUNTIME_PORT || 8001} / Legacy→:${process.env.LEGACY_PORT || 11434} which silently overrode operator changes.
export function runtimeUpstreamBase(base = runtimeBase(), providerOverride = null) {
  const clean = normalizeRuntimeBaseUrl(base || "");
  const provider = resolveProvider(providerOverride ?? RUNTIME_PROVIDER_CFG.provider);
  if (!clean) {
    if (provider === "mlx") return RUNTIME_PROVIDER_PRESETS.mlx.baseUrl;
    if (provider === "legacy") return RUNTIME_PROVIDER_PRESETS.legacy.baseUrl;
    return clean;
  }
  try {
    const u = new URL(clean);
    if (!u.hostname) u.hostname = "127.0.0.1";
    if (!u.port) {
      if (provider === "mlx") u.port = process.env.LOCAL_RUNTIME_PORT || "8001";
      else if (provider === "legacy") u.port = process.env.LEGACY_PORT || "11434";
    }
    if (provider === "mlx" && (!u.pathname || u.pathname === "/")) u.pathname = "/v1";
    return u.toString().replace(/\/+$/, "");
  } catch {
    if (provider === "mlx") return RUNTIME_PROVIDER_PRESETS.mlx.baseUrl;
    if (provider === "legacy") return RUNTIME_PROVIDER_PRESETS.legacy.baseUrl;
    return clean;
  }
}

// --- DB hydrate -------------------------------------------------------------
export async function hydrateRuntimeProviderFromDb({ quiet = false } = {}) {
  if (!_pool) {
    console.warn("[runtime-registry] hydrate skipped: initRuntimeRegistry({pool}) not called yet");
    RUNTIME_PROVIDER_CFG.hydrated = false;
    return;
  }
  try {
    const { rows } = await _pool.query("SELECT value, updated_at FROM app_settings WHERE key='runtime.provider'");
    const v = rows[0]?.value;
    if (v && typeof v === "object") {
      RUNTIME_PROVIDER_CFG.provider = resolveProvider(v.provider);
      RUNTIME_PROVIDER_CFG.baseUrl  = String(v.baseUrl || "").trim();
      RUNTIME_PROVIDER_CFG.model    = String(v.model   || "").trim();
      RUNTIME_PROVIDER_CFG.models   = sanitizeModels(v.models);
      RUNTIME_PROVIDER_CFG.hydrated = true;
      RUNTIME_PROVIDER_CFG.updatedAt = rows[0]?.updated_at ?? null;
      if (!quiet) console.log(`[runtime-registry] hydrated · provider=${RUNTIME_PROVIDER_CFG.provider} public=${runtimeBase()} upstream=${runtimeUpstreamBase()} model=${runtimeModel()}`);
    } else {
      RUNTIME_PROVIDER_CFG.hydrated = false;
      if (!quiet) console.warn("[runtime-registry] DB row missing: app_settings.runtime.provider");
    }
  } catch (e) {
    RUNTIME_PROVIDER_CFG.hydrated = false;
    console.warn("[runtime-registry] hydrate skipped:", String(e?.message || e));
  }
}
