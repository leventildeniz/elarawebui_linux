// lib/rag/brand-cache.mjs — Dynamic library brand cache + pack/agent brand filters
// Extracted from server.mjs (2026-05-30, Batch A turn-1). DI: pool, getRagSettings.

const PACK_FILTER_TTL_MS = 5 * 60 * 1000;

let _pool = null;
let _getRagSettings = () => ({});

let _libBrandCache = { ts: 0, brands: [], minChunks: -1 };
const _packFilterCache = new Map(); // agentId -> { keywords, ts }
const _agentBrandCache = new Map(); // agentId -> { brands, ts }

export function initBrandCache({ pool, getRagSettings }) {
  _pool = pool;
  if (typeof getRagSettings === "function") _getRagSettings = getRagSettings;
}

// ── Library brands (DB-derived, 5min TTL) ──────────────────────────────────
export async function getLibraryBrands() {
  const RAG_SETTINGS = _getRagSettings();
  const ttl = Math.max(30_000, Number(RAG_SETTINGS?.libraryBrandCacheTtlMs) || 300_000);
  // Minimum chunk threshold — noise brand'leri (cisco/huawei tek-satırlık
  // mention'lar) library'den filtrele. 0 = kapalı (her brand sayılır).
  const minChunks = Math.max(0, Number(RAG_SETTINGS?.libraryBrandMinChunks) || 0);
  const now = Date.now();
  if (_libBrandCache.brands.length
      && _libBrandCache.minChunks === minChunks
      && (now - _libBrandCache.ts) < ttl) {
    return _libBrandCache.brands;
  }
  try {
    const r = await _pool.query(
      `SELECT brand,
              COUNT(*) AS total_chunks,
              COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded_chunks
         FROM knowledge_chunks
         WHERE brand IS NOT NULL AND brand <> ''
         GROUP BY brand
         HAVING COUNT(*) >= $1
         ORDER BY embedded_chunks DESC, total_chunks DESC, brand ASC
         LIMIT 100`,
      [minChunks],
    );
    const brands = r.rows.map(x => String(x.brand).trim()).filter(Boolean);
    _libBrandCache = { ts: now, brands, minChunks };
    return brands;
  } catch (e) {
    console.warn("[lib-brands] query failed:", e.message);
    return _libBrandCache.brands; // stale ok
  }
}
export function invalidateLibraryBrandCache() {
  _libBrandCache = { ts: 0, brands: [], minChunks: -1 };
}

// ── Pack-aware brand filter (Faz 3C) ───────────────────────────────────────
export async function getActivePackBrandFilter(agentId) {
  if (!agentId) return [];
  const RAG_SETTINGS = _getRagSettings();
  if (RAG_SETTINGS?.packBrandFilterEnabled === false) return [];
  const key = String(agentId);
  const hit = _packFilterCache.get(key);
  if (hit && Date.now() - hit.ts < PACK_FILTER_TTL_MS) return hit.keywords;
  let keywords = [];
  try {
    const { rows } = await _pool.query(
      `SELECT cp.brand_keywords
         FROM agent_capability_packs acp
         JOIN capability_packs cp ON cp.id = acp.pack_id
        WHERE acp.agent_id = $1`,
      [key]
    );
    const seen = new Set();
    for (const r of rows) {
      const arr = Array.isArray(r.brand_keywords) ? r.brand_keywords : [];
      for (const raw of arr) {
        const k = String(raw || "").toLowerCase().trim();
        if (k && !seen.has(k)) { seen.add(k); keywords.push(k); }
      }
    }
  } catch (e) {
    if (!/relation .* does not exist|column .* does not exist/i.test(String(e.message || ""))) {
      console.warn("[pack-brand-filter:resolve]", e.message);
    }
    keywords = [];
  }
  _packFilterCache.set(key, { keywords, ts: Date.now() });
  return keywords;
}
export function invalidatePackFilterCache(agentId) {
  if (agentId) _packFilterCache.delete(String(agentId));
  else _packFilterCache.clear();
}

// ── Agent-level RAG brand scope (agents.meta.rag.brands) ───────────────────
export async function getAgentRagBrands(agentId) {
  if (!agentId) return [];
  const key = String(agentId);
  const hit = _agentBrandCache.get(key);
  if (hit && Date.now() - hit.ts < PACK_FILTER_TTL_MS) return hit.brands;
  let brands = [];
  try {
    const { rows } = await _pool.query("SELECT meta FROM agents WHERE id=$1", [key]);
    const meta = (rows[0]?.meta && typeof rows[0].meta === "object") ? rows[0].meta : {};
    const arr = Array.isArray(meta?.rag?.brands) ? meta.rag.brands : [];
    const seen = new Set();
    for (const raw of arr) {
      const b = String(raw || "").trim();
      if (b && !seen.has(b)) { seen.add(b); brands.push(b); }
    }
  } catch (e) {
    if (!/relation .* does not exist|column .* does not exist/i.test(String(e.message || ""))) {
      console.warn("[agent-rag-brands:resolve]", e.message);
    }
    brands = [];
  }
  _agentBrandCache.set(key, { brands, ts: Date.now() });
  return brands;
}
export function invalidateAgentBrandCache(agentId) {
  if (agentId) _agentBrandCache.delete(String(agentId));
  else _agentBrandCache.clear();
}

// ── Brand label normalizers + library-match detector ───────────────────────
// DB labels are either "Brand" (Checkpoint, cloudflare) or "Brand_<suffix>"
// (Fortigate_DOC, a10_harvest, *_api_raw). Always match on first split-token.
export function _brandToken(b) {
  return String(b || "").split(/[_\-]/)[0].trim().toLowerCase();
}
export function _brandDisplay(b) {
  const t = _brandToken(b);
  if (!t) return String(b || "");
  return t[0].toUpperCase() + t.slice(1);
}
export function _normalizeBrandSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
export function detectLibraryMatch(query, libBrands) {
  const q = String(query || "").toLowerCase();
  const qNorm = _normalizeBrandSearchText(query);
  if (!q || !Array.isArray(libBrands) || !libBrands.length) {
    return { matched: null, matchedDisplay: null, libBrands: libBrands || [] };
  }
  // Dynamic brand detection: compare both raw and punctuation/space-normalized
  // text so "checkpoint", "check point", "a10'da" and "fortigate-de" all match.
  for (const b of libBrands) {
    const token = _brandToken(b);
    const tokenNorm = _normalizeBrandSearchText(token);
    if (!tokenNorm) continue;
    if ((tokenNorm.length >= 3 || /\d/.test(tokenNorm)) && (q.includes(token) || qNorm.includes(tokenNorm))) {
      return { matched: b, matchedDisplay: _brandDisplay(b), libBrands };
    }
  }
  return { matched: null, matchedDisplay: null, libBrands };
}
