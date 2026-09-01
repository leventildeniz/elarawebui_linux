// local-server/lib/brand.mjs
// Block E.1 — brand layer (defaults + env + DB override + cache) + safeSlug.
// 2026-05-30 monolit-avı: server.mjs'ten ayrıldı.
//
// Reading order: app_settings.brand (DB) > process.env.BRAND_* > defaults.
// 5sn cache; brand changes are rare and never on the hot path.

let _pool = null;

export function initBrandRegistry({ pool }) {
  if (!pool) throw new Error("[brand] initBrandRegistry: pool gerekli");
  _pool = pool;
}

export const BRAND_DEFAULTS = Object.freeze({
  app_name:       "AI OS",
  short_name:     "OS",
  persona_name:   "Assistant",
  owner_title:    "Operator",
  default_locale: "en",
  tagline:        "Local-first AI operating system",
  support_email:  "",
  library_root:   "",
});

export function brandFromEnv() {
  return {
    app_name:       process.env.BRAND_NAME          || BRAND_DEFAULTS.app_name,
    short_name:     process.env.BRAND_SHORT_NAME    || BRAND_DEFAULTS.short_name,
    persona_name:   process.env.BRAND_PERSONA_NAME  || BRAND_DEFAULTS.persona_name,
    owner_title:    process.env.BRAND_OWNER_TITLE   || BRAND_DEFAULTS.owner_title,
    default_locale: process.env.BRAND_DEFAULT_LOCALE|| BRAND_DEFAULTS.default_locale,
    tagline:        process.env.BRAND_TAGLINE       || BRAND_DEFAULTS.tagline,
    support_email:  process.env.BRAND_SUPPORT_EMAIL || BRAND_DEFAULTS.support_email,
    library_root:   process.env.BRAND_LIBRARY_ROOT  || BRAND_DEFAULTS.library_root,
  };
}

let _brandCache = brandFromEnv();
let _brandCacheAt = 0;

export async function getBrand({ fresh = false } = {}) {
  if (!fresh && Date.now() - _brandCacheAt < 5_000) return _brandCache;
  const env = brandFromEnv();
  try {
    if (!_pool) throw new Error("brand registry not initialised");
    const r = await _pool.query("SELECT value FROM app_settings WHERE key='brand'");
    const dbVal = r.rows[0]?.value && typeof r.rows[0].value === "object" ? r.rows[0].value : {};
    _brandCache = { ...env, ...dbVal };
  } catch {
    _brandCache = env;
  }
  _brandCacheAt = Date.now();
  return _brandCache;
}

export function brandSync() { return _brandCache; }

// Force the next getBrand() call to skip the 5sn TTL. Used by the brand
// PATCH handler so an operator save reflects immediately.
export function invalidateBrandCache() { _brandCacheAt = 0; }

export function safeSlug(s) {
  return String(s || "backup").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "backup";
}
