// Stateful RAG retrieval core (Tur 1b, 2026-05-30).
// Extracted from server.mjs: ragProbeAndFetch + semanticSearch + FTS helpers.
// Pure scoring/token utils stay in ./scoring.mjs.
//
// All external dependencies are injected via initRagRetrieval({deps}).
// Module-level state (LRU/FTS error cache) lives here as in the original.

import {
  extractQueryTerms as _extractQueryTerms,
  rrfFuse as _rrfFuse,
  computeConfidence as _computeConfidence,
} from "./scoring.mjs";

// ── module-private state (was: server.mjs top-level lets) ───────────────────
let _srcNonEmptyCache = { ts: 0, value: null };
let _lastFtsError = null;
let _lastFtsChunkError = null;
let _lastFtsSourceError = null;

function _freshErr(e) {
  if (!e) return null;
  if (Date.now() - e.at > 120_000) return null;
  return e;
}

export function getLastFtsError()       { return _freshErr(_lastFtsError); }
export function getLastFtsChunkError()  { return _freshErr(_lastFtsChunkError); }
export function getLastFtsSourceError() { return _freshErr(_lastFtsSourceError); }

export function setLastFtsError(kind, detail) {
  const entry = { kind, detail: String(detail || "").slice(0, 300), at: Date.now() };
  _lastFtsError = entry;
  if (kind === "chunk_query") _lastFtsChunkError = entry;
  else if (kind === "source_query") _lastFtsSourceError = entry;
}

export function _buildFtsOrQuery(q) {
  const terms = String(q || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map(t => t.replace(/[^a-z0-9]/g, ""))
    .filter(t => t.length >= 2 && t.length <= 40);
  const uniq = Array.from(new Set(terms)).slice(0, 12);
  if (!uniq.length) return null;
  return uniq.map(t => `${t}:*`).join(" | ");
}

function _brandToken(b) {
  return String(b || "").split(/[_\-]/)[0].trim().toLowerCase();
}

// Multi-version quota helper: when split detected ≥2 versions, guarantee each
// version a fair share of the final top-K. Preserves input ordering (RRF or
// rerank-blended). Knob: RAG_SETTINGS.multiVersionQuota (default ON).
// Bucket = rows whose path or content mention that major.minor token.
// Rows that don't match any bucket act as shared filler.
export function _quotaSlice(rows, limit, versionTokens, opts = {}) {
  if (!Array.isArray(rows) || rows.length <= limit) return rows.slice(0, limit);
  if (!versionTokens || !versionTokens.length) return rows.slice(0, limit);
  const enabled = opts.enabled !== false;
  if (!enabled) return rows.slice(0, limit);
  const tokens = versionTokens.map(t => String(t || "").trim()).filter(Boolean);
  if (tokens.length < 2) return rows.slice(0, limit);
  const escapes = tokens.map(t => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  const buckets = tokens.map(() => []);
  const shared = [];
  for (const r of rows) {
    const hay = `${r.path || ""} ${String(r.content || "").slice(0, 400)}`;
    let placed = false;
    for (let i = 0; i < escapes.length; i++) {
      if (escapes[i].test(hay)) { buckets[i].push(r); placed = true; break; }
    }
    if (!placed) shared.push(r);
  }
  const perBucket = Math.max(1, Math.ceil(limit / tokens.length));
  const picked = [];
  const usedIds = new Set();
  const _pid = (r) => String(r.id ?? `${r.file_id}#${r.ord}`);
  for (let i = 0; i < buckets.length; i++) {
    let taken = 0;
    for (const r of buckets[i]) {
      if (taken >= perBucket) break;
      const k = _pid(r);
      if (usedIds.has(k)) continue;
      usedIds.add(k);
      picked.push(r);
      taken++;
    }
  }
  // Fill remaining slots in original RRF/rerank order from shared + leftover bucket rows
  if (picked.length < limit) {
    for (const r of rows) {
      if (picked.length >= limit) break;
      const k = _pid(r);
      if (usedIds.has(k)) continue;
      usedIds.add(k);
      picked.push(r);
    }
  }
  try {
    const dist = tokens.map((t, i) => `${t}:${picked.filter(r => escapes[i].test(`${r.path || ""} ${String(r.content || "").slice(0, 400)}`)).length}`).join(",");
    console.log(`[MV-QUOTA] versions=[${tokens.join(",")}] limit=${limit} picked={${dist}}`);
  } catch {}
  return picked.slice(0, limit);
}

function _explicitVersionSlice(rows, limit, query, opts = {}) {
  if (!Array.isArray(rows) || rows.length <= limit) return rows.slice(0, limit);
  if (opts.enabled === false) return rows.slice(0, limit);
  const qStems = new Set();
  const qRe = /(?<![\d.])(\d+\.\d+)(?:\.\d+)?(?!\d)/gi;
  let qm;
  while ((qm = qRe.exec(String(query || ""))) !== null) qStems.add(qm[1]);
  if (!qStems.size) return rows.slice(0, limit);
  const rowStems = (r) => {
    const stems = new Set();
    const pRe = /(?<![\d.])(\d+\.\d+)(?:\.\d+)?(?!\d)/gi;
    const hay = `${String(r?.path || "")} ${String(r?.content || "").slice(0, 240)}`;
    let pm;
    while ((pm = pRe.exec(hay)) !== null) stems.add(pm[1]);
    return stems;
  };
  const wanted = rows.filter((r) => Array.from(rowStems(r)).some((v) => qStems.has(v)));
  if (!wanted.length) return rows.slice(0, limit);
  const picked = [];
  const used = new Set();
  const pid = (r) => String(r.id ?? `${r.file_id}#${r.ord}`);
  const wantedSlots = Math.max(1, Math.ceil(limit / 2));
  for (const r of wanted) {
    if (picked.length >= wantedSlots) break;
    const k = pid(r); if (used.has(k)) continue;
    used.add(k); picked.push(r);
  }
  for (const r of rows) {
    if (picked.length >= limit) break;
    const k = pid(r); if (used.has(k)) continue;
    used.add(k); picked.push(r);
  }
  try { console.log(`[VERSION-SLICE] versions=[${Array.from(qStems).join(",")}] wanted=${wanted.length} picked=${picked.length}/${limit}`); } catch {}
  return picked.slice(0, limit);
}


function _normalizeBrandSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function _findScopedBrandMention(query, brands) {
  const hay = _normalizeBrandSearchText(query);
  if (!hay || !Array.isArray(brands) || !brands.length) return null;
  for (const raw of brands) {
    const token = _brandToken(raw);
    const norm = _normalizeBrandSearchText(token);
    if ((norm.length >= 3 || /\d/.test(norm)) && hay.includes(norm)) return token;
  }
  return null;
}

let DEPS = null;

export function initRagRetrieval(deps) {
  // Required: pool, getRagSettings, ROLE_RANK,
  //           getActivePackBrandFilter, getAgentRagBrands,
  //           extractTechnicalCore, isExtBreakerOpen,
  //           getLibraryBrands, detectLibraryMatch,
  //           generateHydePassage,
  //           qembGet, qembSet,
  //           embed, rerank,
  //           getLastRerankError, getLastEmbedError,
  //           expandQueryTerms, cosine,
  //           DEFAULT_RAG_TRGM_THRESHOLD, DEFAULT_RAG_TRGM_MIN_SCORE
  const required = [
    "pool", "getRagSettings", "ROLE_RANK",
    "getActivePackBrandFilter", "getAgentRagBrands",
    "extractTechnicalCore", "isExtBreakerOpen",
    "getLibraryBrands", "detectLibraryMatch",
    "generateHydePassage",
    "qembGet", "qembSet",
    "embed", "rerank",
    "getLastRerankError", "getLastEmbedError",
    "expandQueryTerms", "cosine",
    "DEFAULT_RAG_TRGM_THRESHOLD", "DEFAULT_RAG_TRGM_MIN_SCORE",
  ];
  for (const k of required) {
    if (deps[k] === undefined) throw new Error(`initRagRetrieval: missing dep '${k}'`);
  }
  // detectProductFromQuery is OPTIONAL — when absent, productFilter knob is a no-op.
  DEPS = deps;
  return { ragProbeAndFetch, semanticSearch, _ftsHybridFallback, _buildFtsOrQuery, getLastFtsError, getLastFtsChunkError, getLastFtsSourceError, setLastFtsError };
}

async function _sourcesNonEmpty(client) {
  const ttl = 5 * 60 * 1000;
  const now = Date.now();
  if (_srcNonEmptyCache.value !== null && (now - _srcNonEmptyCache.ts) < ttl) {
    return _srcNonEmptyCache.value;
  }
  try {
    const r = await client.query(`SELECT 1 FROM knowledge_sources LIMIT 1`);
    const v = r.rows.length > 0;
    _srcNonEmptyCache = { ts: now, value: v };
    return v;
  } catch {
    return true;
  }
}

// FTS leg shared by ragProbeAndFetch + embed-miss fallback.
export async function _ftsHybridFallback({ q, safeLevels, tau, client = null, bindingFileIds = null, bindingBrands = null, productHard = null }) {
  const { pool, getRagSettings } = DEPS;
  const RAG_SETTINGS = getRagSettings();
  void tau;
  const own = !client;
  if (own) client = await pool.connect();
  try {
    await client.query(`SET LOCAL statement_timeout = '1800ms'`).catch(() => {});
    const orQ = _buildFtsOrQuery(q);
    if (!orQ) return { rows: [], top1: 0, decision: "skip", reason: "fts_empty_query" };
    const _minChunkChars = Math.max(0, Number(RAG_SETTINGS.minChunkChars ?? 0));
    const _bindingScope = (Array.isArray(bindingFileIds) && bindingFileIds.length) ? bindingFileIds : null;
    const _bindingBrandScope = (Array.isArray(bindingBrands) && bindingBrands.length) ? bindingBrands : null;
    const _productHardArg = productHard ? String(productHard).toLowerCase() : null;
    const cR = await client.query(
      `SELECT c.id, c.file_id, c.path, c.ord, c.brand, c.product, c.access_level, c.content,
              c.page_start, c.page_end,
              ts_rank_cd(c.tsv, to_tsquery('simple', $2)) AS score
         FROM knowledge_chunks c
        WHERE c.tsv @@ to_tsquery('simple', $2)
          AND c.access_level = ANY($1::text[])
          AND ($3::int = 0 OR length(c.content) >= $3::int)
          AND ($4::text[] IS NULL OR c.file_id = ANY($4::text[]))
          AND ($5::text[] IS NULL OR lower(regexp_replace(coalesce(c.brand,''), '[_\-].*$', '')) = ANY($5::text[]))
          AND ($6::text IS NULL OR lower(c.product) = $6::text)
        ORDER BY score DESC
        LIMIT 20`, [safeLevels, orQ, _minChunkChars, _bindingScope, _bindingBrandScope, _productHardArg]
    ).catch((e) => { setLastFtsError("chunk_query", e?.message || e); return { rows: [] }; });
    let sR = { rows: [] };
    if (!_bindingScope && !_bindingBrandScope && !_productHardArg && await _sourcesNonEmpty(client)) {
      sR = await client.query(
        `WITH src AS (
           SELECT s.id, ts_rank_cd(s.fts, to_tsquery('simple', $2)) AS s_score
             FROM knowledge_sources s
            WHERE s.fts @@ to_tsquery('simple', $2)
              AND COALESCE(s.superseded_by, '') = ''
            ORDER BY s_score DESC
            LIMIT 10
         )
         SELECT c.id, c.file_id, c.path, c.ord, c.brand, c.product, c.access_level, c.content,
                c.page_start, c.page_end, src.s_score AS score
           FROM src
           JOIN LATERAL (
             SELECT k.* FROM knowledge_chunks k
              WHERE k.file_id = src.id::text
                AND k.access_level = ANY($1::text[])
              ORDER BY k.ord ASC LIMIT 1
           ) c ON true`, [safeLevels, orQ]
      ).catch((e) => { setLastFtsError("source_query", e?.message || e); return { rows: [] }; });
    }
    const seen = new Set();
    const all = [];
    for (const r of cR.rows) { if (seen.has(r.id)) continue; seen.add(r.id); all.push({ ...r, retriever: "fts-chunk" }); }
    for (const r of sR.rows) { if (seen.has(r.id)) continue; seen.add(r.id); all.push({ ...r, retriever: "fts-source" }); }
    if (all.length) _lastFtsError = null;
    if (_bindingScope) {
      console.log(`[FTS/binding] scope=${_bindingScope.length} files chunk_rows=${cR.rows.length} kept=${all.length}`);
    }
    return { rows: all, top1: Number(all[0]?.score || 0), decision: "inject", reason: "fts", error: getLastFtsError() };
  } finally {
    if (own) client.release();
  }
}

// ragProbeAndFetch — score-gated always-on RAG.
export async function ragProbeAndFetch({ q, allowedLevels, agentId = null, bindingFileIds = null, bindingBrands = null, agentKeywords = [], caller = null }) {
  const {
    pool, getRagSettings, ROLE_RANK,
    getActivePackBrandFilter, getAgentRagBrands,
    extractTechnicalCore, isExtBreakerOpen,
    getLibraryBrands, detectLibraryMatch,
    generateHydePassage,
    qembGet, qembSet,
    embed, rerank,
    getLastRerankError, getLastEmbedError,
  } = DEPS;
  const RAG_SETTINGS = getRagSettings();
  // PROBE-2026-06-03: per-stage wall-clock telemetry; surfaced via rag.probe.done trace.
  // 2026-06-03 v2: gap-hunt — extractorMs + hydeMs + prepMs (pre-embed glue) + totalMs (entry→return).
  const _tStages0 = Date.now();
  const stages = { embedMs: 0, probeSqlMs: 0, ftsMs: 0, vectorFetchMs: 0, rerankMs: 0, extractorMs: 0, hydeMs: 0, prepMs: 0, totalMs: 0 };

  const tau = Math.min(0.95, Math.max(0.10, Number(RAG_SETTINGS.injectThreshold) || 0.45));
  const safeLevels = Array.isArray(allowedLevels) && allowedLevels.length ? allowedLevels : Object.keys(ROLE_RANK);
  const _caller = String(caller || (agentId ? "agent" : "chat"));
  const _packKeywords = await getActivePackBrandFilter(agentId).catch(() => []);

  if ((!Array.isArray(bindingBrands) || !bindingBrands.length) && agentId) {
    bindingBrands = await getAgentRagBrands(agentId).catch(() => []);
  }

  const _qTerms = _extractQueryTerms(q);
  if (_qTerms.length === 0) {
    return { decision: "skip", reason: "no_meaningful_terms", rows: [], top1: 0, tau, queryTerms: 0 };
  }

  const _rawTrim = String(q || "").toLowerCase().trim();
  const ex = await extractTechnicalCore(q);
  stages.extractorMs = Number(ex.ms) || 0;
  const cleanQuery = ex.text || q;
  const _cleanLow = String(cleanQuery || "").toLowerCase().trim();
  const _wordCount = _cleanLow.split(/\s+/).filter(Boolean).length;
  const _breakerOpen = isExtBreakerOpen();
  console.log(`[QUERY-EXTRACT] raw="${String(q).slice(0,60)}" clean="${cleanQuery.slice(0,60)}" cacheHit=${ex.cacheHit} ms=${ex.ms} breaker=${_breakerOpen ? "open" : "closed"}${ex.reject ? ` reject=${ex.reject}` : ""}`);

  const _extractorRanOk = !ex.reject;
  const _isShortNoise   = _wordCount < 2;
  const _noTechCore     = _extractorRanOk && _cleanLow === _rawTrim && _wordCount < 3;
  if (_isShortNoise || _noTechCore) {
    let _brandKnownSingle = false;
    if (_wordCount >= 1 && _wordCount <= 2) {
      try {
        const _libBrandsST = await getLibraryBrands();
        if (Array.isArray(_libBrandsST) && _libBrandsST.length) {
          const _libSet = new Set(_libBrandsST.map((b) => String(b || "").toLowerCase().trim()).filter(Boolean));
          const _tokens = _cleanLow.split(/\s+/).filter(Boolean);
          _brandKnownSingle = _tokens.some((t) => {
            const tn = t.replace(/[^\p{L}\p{N}]+/gu, "");
            if (!tn) return false;
            if (_libSet.has(tn)) return true;
            const stem = tn.replace(/(nin|nun|nın|de|da|te|ta|ye|ya|in|un|ın)$/i, "");
            return stem.length >= 3 && _libSet.has(stem);
          });
        }
      } catch { /* non-fatal */ }
    }
    if (!_brandKnownSingle) {
      return {
        decision: "skip", reason: "smalltalk_secondary_extractor",
        rows: [], top1: 0, tau, queryTerms: 0,
        qForRetrieval: cleanQuery, queryClean: cleanQuery, queryRaw: q,
        extractor: { cacheHit: ex.cacheHit, ms: ex.ms, reject: ex.reject || null },
      };
    }
    console.log(`[SMALLTALK-BYPASS] single-word brand-known q="${_cleanLow}" → RAG lane`);
  }

  let qForRetrieval = cleanQuery;

  const _minChunkChars = Math.max(0, Number(RAG_SETTINGS.minChunkChars ?? 0));
  const _bindingFileIds = (Array.isArray(bindingFileIds) && bindingFileIds.length) ? bindingFileIds : null;
  const _bindingBrands = (Array.isArray(bindingBrands) && bindingBrands.length)
    ? bindingBrands.map((b) => String(b || "").toLowerCase().replace(/[_\-].*$/, "").trim()).filter(Boolean)
    : null;
  const _bindingBrandsArg = _bindingBrands && _bindingBrands.length ? _bindingBrands : null;

  let _explicitBrandLock = null;
  let _libraryMatchForDiag = null;
  let _effectiveBrandsArg = _bindingBrandsArg;
  try {
    if (RAG_SETTINGS.explicitBrandFilter !== false) {
      const _scopedMatch = _bindingBrandsArg && _bindingBrandsArg.length
        ? _findScopedBrandMention(`${q}\n${cleanQuery}`, _bindingBrandsArg)
        : null;
      if (_scopedMatch) {
        _explicitBrandLock = _scopedMatch;
        _libraryMatchForDiag = _scopedMatch;
        _effectiveBrandsArg = [_scopedMatch];
        if (process.env.RAG_DEBUG_PROBE_DIAG === "1") console.log(`[BRAND-LOCK] scoped explicit="${_scopedMatch}" q="${String(q).slice(0,60)}"`);
      } else if (!_bindingBrandsArg || !_bindingBrandsArg.length) {
        const _libBrandsEB = await getLibraryBrands();
        const _libMatchEB = detectLibraryMatch(qForRetrieval, _libBrandsEB);
        if (_libMatchEB.matched) {
          _libraryMatchForDiag = _libMatchEB.matched;
          const tok = String(_libMatchEB.matched || "").toLowerCase().replace(/[_\-].*$/, "").trim();
          if (tok) {
            _explicitBrandLock = tok;
            _effectiveBrandsArg = [tok];
            if (process.env.RAG_DEBUG_PROBE_DIAG === "1") console.log(`[BRAND-LOCK] explicit="${tok}" q="${qForRetrieval.slice(0,60)}"`);
          }
        }
      }
    }
  } catch (e) { console.warn("[BRAND-LOCK] failed (non-fatal):", e.message); }

  // 2026-06-26 — Product-aware retrieval filter (knob: RAG_SETTINGS.productFilter).
  // "off"   → skip entirely.
  // "boost" → detect product, apply small score boost after rerank.
  // "hard"  → detect product, SQL WHERE adds `(product=$X OR product IS NULL)`.
  // Detection uses DB DISTINCT (brand, product) cache; scoped to brandLock if any.
  let _productLock = null;
  const _productMode = String(RAG_SETTINGS.productFilter || "off").toLowerCase();
  if ((_productMode === "boost" || _productMode === "hard") && RAG_SETTINGS.productAutoExtract !== false && typeof DEPS.detectProductFromQuery === "function") {
    try {
      const _hit = await DEPS.detectProductFromQuery(`${q} ${cleanQuery}`, _explicitBrandLock || (_effectiveBrandsArg && _effectiveBrandsArg[0]) || null);
      if (_hit && _hit.product) {
        _productLock = _hit;
        console.log(`[PRODUCT-LOCK] mode=${_productMode} brand=${_hit.brand} product=${_hit.product} q="${String(q).slice(0,60)}"`);
      }
    } catch (e) { console.warn("[PRODUCT-LOCK] detect failed (non-fatal):", e?.message || e); }
  }
  // 2026-06-05 — product alias fallback for unscoped chat/orchestrate calls.
  // If the query names a live product token (fortimanager, fortianalyzer, ...)
  // but no brand context was passed, infer the dominant product row from DB and
  // turn it into the same product/brand lock the agent path already gets.
  // No static product dictionary: token must exist in knowledge_chunks.product.
  if (!_productLock && (_productMode === "boost" || _productMode === "hard") && RAG_SETTINGS.productAutoExtract !== false) {
    try {
      const _prodTokens = Array.from(new Set(String(`${q} ${cleanQuery}` || "").toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [])).slice(0, 16);
      if (_prodTokens.length) {
        let _pr = null;
        const _pc = await pool.connect();
        try {
          await _pc.query("BEGIN").catch(() => {});
          await _pc.query(`SET LOCAL statement_timeout = '1800ms'`).catch(() => {});
          _pr = await _pc.query(
            `SELECT lower(product) AS product,
                    lower(regexp_replace(coalesce(brand,''), '[_\-].*$', '')) AS brand,
                    count(*)::int AS hits
               FROM knowledge_chunks
              WHERE product IS NOT NULL
                AND lower(product) = ANY($1::text[])
                AND ($2::text[] IS NULL OR lower(regexp_replace(coalesce(brand,''), '[_\-].*$', '')) = ANY($2::text[]))
              GROUP BY lower(product), lower(regexp_replace(coalesce(brand,''), '[_\-].*$', ''))
              ORDER BY hits DESC
              LIMIT 1`,
            [_prodTokens, (Array.isArray(_effectiveBrandsArg) && _effectiveBrandsArg.length) ? _effectiveBrandsArg : null]
          ).catch(() => null);
          await _pc.query("COMMIT").catch(() => {});
        } catch {
          try { await _pc.query("ROLLBACK"); } catch {}
          _pr = null;
        } finally {
          _pc.release();
        }
        const _row = _pr?.rows?.[0];
        if (_row?.product && _row?.brand) {
          _productLock = { product: String(_row.product), brand: String(_row.brand), source: "db_product_token", hits: Number(_row.hits || 0) };
          _explicitBrandLock = String(_row.brand);
          _effectiveBrandsArg = [String(_row.brand)];
          _libraryMatchForDiag = _libraryMatchForDiag || String(_row.brand);
          console.log(`[PRODUCT-LOCK] mode=${_productMode} source=db_product_token caller=${_caller} brand=${_row.brand} product=${_row.product} hits=${_row.hits} q="${String(q).slice(0,60)}"`);
        }
      }
    } catch (e) { console.warn("[PRODUCT-LOCK] db product-token fallback failed (non-fatal):", e?.message || e); }
  }
  const _productHardArg = (_productMode === "hard" && _productLock) ? _productLock.product : null;


  if (!(_explicitBrandLock && _bindingBrandsArg?.length) && Array.isArray(agentKeywords) && agentKeywords.length) {
    const _kw = Array.from(new Set(
      agentKeywords.map((k) => String(k || "").trim().toLowerCase()).filter(Boolean),
    ));
    if (_kw.length) {
      const _qLow = String(qForRetrieval || "").toLowerCase();
      const _missing = _kw.filter((k) => !_qLow.includes(k));
      if (_missing.length) {
        qForRetrieval = `${qForRetrieval} ${_missing.join(" ")}`.trim();
        console.log(`[AGENT-KW] agent=${agentId} injected=[${_missing.join(",")}] q="${qForRetrieval.slice(0,80)}"`);
      }
    }
  }

  let qVec = qembGet(qForRetrieval);
  if (!qVec) {
    const probeEmbedTimeout = Math.max(1000, Number(process.env.RAG_PROBE_EMBED_TIMEOUT_MS) || 8000);
    const _tEmb0 = Date.now();
    stages.prepMs = _tEmb0 - _tStages0 - stages.extractorMs;
    const arr = await embed([qForRetrieval], { timeoutMs: probeEmbedTimeout }).catch(() => null);
    stages.embedMs = Date.now() - _tEmb0;
    if (!arr || !arr[0] || !arr[0].length) {
      const _tFts0 = Date.now();
      const ftsOnly = await _ftsHybridFallback({ q: qForRetrieval, safeLevels, tau, bindingFileIds: _bindingFileIds, bindingBrands: _effectiveBrandsArg, productHard: _productHardArg });
      stages.ftsMs = Date.now() - _tFts0;
      if (ftsOnly.rows.length) return { ...ftsOnly, ftsRows: ftsOnly.rows.length, ftsError: ftsOnly.error || getLastFtsError(), explicitBrandLock: _explicitBrandLock, effectiveBrandsArg: _effectiveBrandsArg, libraryMatch: _libraryMatchForDiag, queryClean: cleanQuery, extractor: { cacheHit: ex.cacheHit, ms: ex.ms, reject: ex.reject || null }, qForRetrieval };
      return { decision: "skip", reason: "embed_miss", rows: [], top1: 0, tau, ftsRows: 0, ftsError: ftsOnly.error || getLastFtsError(), embedError: getLastEmbedError(), explicitBrandLock: _explicitBrandLock, effectiveBrandsArg: _effectiveBrandsArg, libraryMatch: _libraryMatchForDiag, queryClean: cleanQuery, extractor: { cacheHit: ex.cacheHit, ms: ex.ms, reject: ex.reject || null }, qForRetrieval };
    }
    qVec = arr[0]; qembSet(qForRetrieval, qVec);
  }
  const qStr = `[${qVec.join(",")}]`;
  const client = await pool.connect();
  try {
    await client.query(`SET LOCAL hnsw.ef_search = 60`).catch(() => {});
    await client.query(`SET LOCAL statement_timeout = '1500ms'`).catch(() => {});
    const _brandLockedProbe = !!_explicitBrandLock || !!(_effectiveBrandsArg && _effectiveBrandsArg.length);
    if (_brandLockedProbe) {
      await client.query(`SET LOCAL statement_timeout = '5000ms'`).catch(() => {});
    }

    const probeSql = _brandLockedProbe
      ? `WITH filtered AS MATERIALIZED (
           SELECT id, brand, embedding
             FROM knowledge_chunks
            WHERE embedding IS NOT NULL AND access_level = ANY($2::text[])
              AND ($3::int = 0 OR length(content) >= $3::int)
              AND ($4::text[] IS NULL OR file_id = ANY($4::text[]))
              AND lower(regexp_replace(coalesce(brand,''), '[_\\-].*$', '')) = ANY($5::text[])
              AND ($6::text IS NULL OR lower(product) = $6::text)
         )
         SELECT id, brand, 1 - (embedding <=> $1::vector) AS score
           FROM filtered
          ORDER BY embedding <=> $1::vector
          LIMIT 4`
      : `SELECT id, brand, 1 - (embedding <=> $1::vector) AS score
           FROM knowledge_chunks
          WHERE embedding IS NOT NULL AND access_level = ANY($2::text[])
            AND ($3::int = 0 OR length(content) >= $3::int)
            AND ($4::text[] IS NULL OR file_id = ANY($4::text[]))
            AND ($5::text[] IS NULL OR lower(regexp_replace(coalesce(brand,''), '[_\\-].*$', '')) = ANY($5::text[]))
            AND ($6::text IS NULL OR lower(product) = $6::text)
          ORDER BY embedding <=> $1::vector
          LIMIT 4`;

    const _tProbe0 = Date.now();
    const probe = await client.query(probeSql,
      [qStr, safeLevels, _minChunkChars, _bindingFileIds, _effectiveBrandsArg, _productHardArg])
      .catch((e) => { console.warn(`[PROBE-SQL] FAIL: ${e.message} brandLock=${_explicitBrandLock} brandsArg=${JSON.stringify(_effectiveBrandsArg)}`); return { rows: [] }; });
    stages.probeSqlMs = Date.now() - _tProbe0;
    if (_explicitBrandLock) {
      if (process.env.RAG_DEBUG_PROBE_DIAG === "1") console.log(`[PROBE-DIAG] brandLock=${_explicitBrandLock} brandsArg=${JSON.stringify(_effectiveBrandsArg)} rows=${probe.rows.length} top1=${(probe.rows[0]?.score || 0).toFixed(4)} brands=[${probe.rows.map(r => r.brand).join(",")}] path=${_brandLockedProbe ? "CTE-bypass" : "HNSW"}`);
    }
    const top1 = Number(probe.rows[0]?.score || 0);

    let effectiveTau = tau;
    const probeBrands = probe.rows.map(r => String(r.brand || "").toLowerCase()).filter(Boolean);
    const _brandCounts = probeBrands.reduce((m, b) => (m[b] = (m[b] || 0) + 1, m), {});
    const _dominantCount = Math.max(0, ...Object.values(_brandCounts));
    if (_dominantCount >= 2 && tau > 0.60) effectiveTau = 0.60;

    let _libGateInfo = { matched: null, boost: 0, applied: false };
    try {
      const _boost = Math.max(0, Number(RAG_SETTINGS.outOfLibraryTauBoost) || 0);
      // 2026-06-05 — Skip the out-of-library tau boost when brand or product
      // is already explicitly locked (alias match, agent binding, or product
      // detector hit). In those cases we are demonstrably IN-library; the
      // string-match gate was false-negative on queries like
      // "fortimanager 7.6 vlan" where the lib brand is "Fortigate".
      const _alreadyLocked = !!_explicitBrandLock || !!_productHardArg || !!(_effectiveBrandsArg && _effectiveBrandsArg.length);
      if (_boost > 0 && !_alreadyLocked) {
        const _libBrands = await getLibraryBrands();
        const _libMatch = detectLibraryMatch(qForRetrieval, _libBrands);
        _libGateInfo = { matched: _libMatch.matched, boost: _boost, applied: false, libBrandCount: _libBrands.length };
        if (!_libMatch.matched && _libBrands.length) {
          const _before = effectiveTau;
          effectiveTau = Math.min(0.95, effectiveTau + _boost);
          _libGateInfo.applied = true;
          _libGateInfo.tauBefore = _before;
          _libGateInfo.tauAfter = effectiveTau;
          console.log(`[LIB-GATE/B] caller=${_caller} out-of-library query="${qForRetrieval.slice(0,60)}" tau ${_before.toFixed(2)} → ${effectiveTau.toFixed(2)} (+${_boost.toFixed(2)})`);
        }
      } else if (_alreadyLocked && _boost > 0) {
        _libGateInfo = { matched: _explicitBrandLock || (_effectiveBrandsArg && _effectiveBrandsArg[0]) || null, boost: _boost, applied: false, skipReason: _productHardArg ? "product_locked" : "brand_locked" };
        console.log(`[LIB-GATE/B] caller=${_caller} skip=${_libGateInfo.skipReason} brandLock=${_explicitBrandLock || "-"} productHard=${_productHardArg || "-"} brandsArg=${JSON.stringify(_effectiveBrandsArg || [])}`);
      } else if (_boost > 0) {
        console.log(`[LIB-GATE/B] caller=${_caller} no-guard brandLock=${_explicitBrandLock || "-"} productHard=${_productHardArg || "-"} brandsArg=${JSON.stringify(_effectiveBrandsArg || [])}`);
      }
    } catch (e) {
      console.warn("[LIB-GATE/B] failed (non-fatal):", e.message);
    }

    const _tFts1 = Date.now();
    const fts = await _ftsHybridFallback({ q: qForRetrieval, safeLevels, tau: effectiveTau, client, bindingFileIds: _bindingFileIds, bindingBrands: _effectiveBrandsArg, productHard: _productHardArg });
    stages.ftsMs += Date.now() - _tFts1;

    const ftsTop = fts.top1 || 0;
    const vectorOK = top1 >= effectiveTau;
    const ftsOK    = ftsTop >= 0.10;
    if (RAG_SETTINGS.strictProbeGate && !vectorOK) {
      return { decision: "skip", reason: "below_threshold_strict", rows: [], top1, ftsTop, tau: effectiveTau, explicitBrandLock: _explicitBrandLock, effectiveBrandsArg: _effectiveBrandsArg, libraryMatch: _libraryMatchForDiag, ftsRows: (fts.rows || []).length, ftsError: fts.error || getLastFtsError(), stages };
    }
    if (!vectorOK && !ftsOK) {
      return { decision: "skip", reason: "below_threshold", rows: [], top1, ftsTop, tau: effectiveTau, explicitBrandLock: _explicitBrandLock, effectiveBrandsArg: _effectiveBrandsArg, libraryMatch: _libraryMatchForDiag, ftsRows: (fts.rows || []).length, ftsError: fts.error || getLastFtsError(), stages };
    }

    let vectorRows = [];
    let _detectedVersions = null;
    let hydeInfo = null;
    let qVecFetch = qVec;
    let qStrFetch = qStr;
    if (vectorOK && RAG_SETTINGS.queryHydeEnabled) {
      const bLow  = Math.min(0.95, Math.max(0.10, Number(RAG_SETTINGS.hydeProbeBandLow)  || 0.50));
      const bHigh = Math.min(0.95, Math.max(0.10, Number(RAG_SETTINGS.hydeProbeBandHigh) || 0.80));
      if (top1 >= bLow && top1 <= bHigh) {
        const _tHy0 = Date.now();
        const hy = await generateHydePassage(cleanQuery);
        hydeInfo = { ms: hy.ms, reject: hy.reject || null, used: false, len: 0 };
        if (hy.text && hy.text.length > 8) {
          const augmented = `${cleanQuery}\n${hy.text}`;
          const hyEmbedTimeout = Math.max(2000, Number(process.env.RAG_HYDE_EMBED_TIMEOUT_MS) || 8000);
          const arr = await embed([augmented], { timeoutMs: hyEmbedTimeout }).catch(() => null);
          if (arr && arr[0] && arr[0].length) {
            qVecFetch = arr[0];
            qStrFetch = `[${qVecFetch.join(",")}]`;
            hydeInfo.used = true; hydeInfo.len = hy.text.length;
          }
        }
        stages.hydeMs = Date.now() - _tHy0;
        console.log(`[QUERY-HYDE] band=[${bLow},${bHigh}] top1=${top1.toFixed(3)} used=${hydeInfo.used} ms=${hydeInfo.ms}${hydeInfo.reject ? ` reject=${hydeInfo.reject}` : ""}`);
      }
    }
    if (vectorOK) {
      const _brandLocked = !!_explicitBrandLock || !!(_effectiveBrandsArg && _effectiveBrandsArg.length);
      if (_brandLocked) {
        await client.query(`SET LOCAL enable_indexscan = off`).catch(() => {});
        await client.query(`SET LOCAL enable_bitmapscan = off`).catch(() => {});
        await client.query(`SET LOCAL statement_timeout = '8000ms'`).catch(() => {});
      } else {
        await client.query(`SET LOCAL hnsw.ef_search = 200`).catch(() => {});
        await client.query(`SET LOCAL statement_timeout = '3500ms'`).catch(() => {});
      }
      const _perSourceCap = Math.max(1, Number(RAG_SETTINGS.perSourceCap ?? 3));
      const _perBrandCap  = Math.max(1, Number(RAG_SETTINGS.perBrandCap ?? 6));
      const _diversityPool = Math.max(24, Number(RAG_SETTINGS.diversityPool ?? 200));
      const _tVf0 = Date.now();
      const full = await client.query(
        `WITH pool AS (
           SELECT id, file_id, path, ord, brand, product, access_level, content, page_start, page_end,
                  1 - (embedding <=> $1::vector) AS score,
                  embedding <=> $1::vector       AS distance
             FROM knowledge_chunks
            WHERE embedding IS NOT NULL AND access_level = ANY($2::text[])
              AND ($6::int = 0 OR length(content) >= $6::int)
              AND (cardinality($7::text[]) = 0
                   OR lower(regexp_replace(coalesce(brand,''), '[_\-].*$', '')) = ANY($7::text[]))
              AND ($8::text[] IS NULL OR file_id = ANY($8::text[]))
              AND ($9::text[] IS NULL OR lower(regexp_replace(coalesce(brand,''), '[_\-].*$', '')) = ANY($9::text[]))
              AND ($10::text IS NULL OR lower(product) = $10::text)
            ORDER BY embedding <=> $1::vector
            LIMIT $3
         ), ranked AS (
           SELECT *,
                  ROW_NUMBER() OVER (PARTITION BY file_id ORDER BY distance ASC) AS rn_file,
                  ROW_NUMBER() OVER (PARTITION BY brand   ORDER BY distance ASC) AS rn_brand
             FROM pool
         )
         SELECT id, file_id, path, ord, brand, product, access_level, content, page_start, page_end, score
           FROM ranked
          WHERE rn_file  <= $4
            AND rn_brand <= $5
          ORDER BY distance ASC
          LIMIT 24`, [qStrFetch, safeLevels, _diversityPool, _perSourceCap, _perBrandCap, _minChunkChars, _packKeywords, _bindingFileIds, _effectiveBrandsArg, _productHardArg]);
      stages.vectorFetchMs = Date.now() - _tVf0;

      const floor = Math.max(0.30, tau - 0.05);
      vectorRows = full.rows.filter(x => Number(x.score) >= floor);
      if (_packKeywords.length) {
        console.log(`[RAG-PACK-FILTER/vector] agent=${agentId} kw=${_packKeywords.length} kept=${vectorRows.length}`);
      }

      // 2026-06-05 — Version-aware candidate fetch (additive, before rerank).
      // If version tokens (7.6, R81.20) are present and versionPathBoost is active,
      // pull a slice with PATH ILIKE %version% and union into vectorRows.
      try {
        const _vBoost = Math.min(0.50, Math.max(0, Number(RAG_SETTINGS.versionPathBoost) || 0));
        if (_vBoost > 0 && vectorOK) {
          const _vReQ = /\b[Rr]?\d+\.\d+(?:\.\d+)?\b/g;
          const _vSeen = new Set();
          const _vToks = [];
          let _vm;
          while ((_vm = _vReQ.exec(qForRetrieval)) !== null) {
            const t = _vm[0];
            if (!_vSeen.has(t.toLowerCase())) { _vSeen.add(t.toLowerCase()); _vToks.push(t); }
          }
          if (_vToks.length) {
            const _vPerLimit = Math.max(2, Number(RAG_SETTINGS.versionCandidateLimit) || 6);
            const _seenIds = new Set(vectorRows.map(r => String(r.id)));
            let _vAdded = 0;
            const _addedPaths = [];
            for (const tok of _vToks.slice(0, 3)) {
              const like = `%${tok}%`;
              const _sub = await client.query(
                `SELECT id, file_id, path, ord, brand, product, access_level, content, page_start, page_end,
                        1 - (embedding <=> $1::vector) AS score
                   FROM knowledge_chunks
                  WHERE embedding IS NOT NULL AND access_level = ANY($2::text[])
                    AND ($3::int = 0 OR length(content) >= $3::int)
                    AND ($4::text[] IS NULL OR file_id = ANY($4::text[]))
                    AND ($5::text[] IS NULL OR lower(regexp_replace(coalesce(brand,''), '[_\\-].*$', '')) = ANY($5::text[]))
                    AND ($6::text IS NULL OR lower(product) = $6::text)
                    AND (path ILIKE $7 OR coalesce(content,'') ILIKE $7)
                  ORDER BY embedding <=> $1::vector
                  LIMIT $8`,
                [qStrFetch, safeLevels, _minChunkChars, _bindingFileIds, _effectiveBrandsArg, _productHardArg, like, _vPerLimit]
              ).catch((e) => { console.warn(`[VERSION-CANDIDATE] sql fail tok=${tok}: ${e.message}`); return null; });
              if (!_sub) continue;
              for (const r of _sub.rows) {
                const k = String(r.id);
                if (_seenIds.has(k)) continue;
                _seenIds.add(k);
                vectorRows.push(r);
                _vAdded++;
                if (_addedPaths.length < 4) _addedPaths.push(String(r.path || "").split("/").slice(-1)[0]);
              }
            }
            console.log(`[VERSION-CANDIDATE] caller=${_caller} versions=[${_vToks.join(",")}] added=${_vAdded} pool=${vectorRows.length} brandsArg=${JSON.stringify(_effectiveBrandsArg || [])} productHard=${_productHardArg || "-"} sample=${JSON.stringify(_addedPaths)}`);
          }
        }
      } catch (e) {
        console.warn("[VERSION-CANDIDATE] failed (non-fatal):", e.message);
      }



      // 2026-06-04 — Multi-version query split (default OFF, additive).
      // When query mentions ≥2 distinct major.minor version tokens (e.g. "7.4 vs 7.6"),
      // strip opposing version tokens and run separate lightweight embedding fetches,
      // then union into vectorRows before RRF and diversity caps.
      if (RAG_SETTINGS.multiVersionSplit && vectorOK) {
        try {
          const _verRe = /\b(\d+)\.(\d+)(?:\.\d+)?\b/g;
          const _seen = new Map();
          let _mv;
          while ((_mv = _verRe.exec(qForRetrieval)) !== null) {
            const _key = `${_mv[1]}.${_mv[2]}`;
            if (!_seen.has(_key)) _seen.set(_key, _mv[0]);
          }
          const _versions = Array.from(_seen.entries()).map(([k, t]) => ({ key: k, token: t }));
          const _maxSplits = Math.max(2, Number(RAG_SETTINGS.multiVersionMaxSplits) || 3);
          if (_versions.length >= 2 && _versions.length <= _maxSplits) {
            _detectedVersions = _versions.map(v => v.token);
            const _perLimit = Math.max(2, Number(RAG_SETTINGS.multiVersionPerLimit) || 6);
            const _rewriteForVersion = (keepKey) => {
              let out = qForRetrieval;
              for (const v of _versions) {
                if (v.key === keepKey) continue;
                const safe = v.token.replace(/\./g, "\\.");
                const re = new RegExp(`\\s*\\b${safe}\\b\\s*(?:ile|ve|and|vs|versus)?`, "gi");
                out = out.replace(re, " ");
              }
              return out.replace(/\s+/g, " ").trim();
            };
            const _variants = _versions.map(v => ({ key: v.key, q: _rewriteForVersion(v.key) }));
            const _tMv0 = Date.now();
            const _embeds = await Promise.all(_variants.map(v =>
              embed([v.q], { timeoutMs: 3000 }).catch(() => null)
            ));
            const _seenIds = new Set(vectorRows.map(r => String(r.id)));
            let _added = 0;
            for (let i = 0; i < _embeds.length; i++) {
              const arr = _embeds[i];
              if (!arr || !arr[0] || !arr[0].length) continue;
              const vStr = `[${arr[0].join(",")}]`;
              const sub = await client.query(
                `SELECT id, file_id, path, ord, brand, product, access_level, content, page_start, page_end,
                        1 - (embedding <=> $1::vector) AS score
                   FROM knowledge_chunks
                  WHERE embedding IS NOT NULL AND access_level = ANY($2::text[])
                    AND ($3::int = 0 OR length(content) >= $3::int)
                    AND (cardinality($4::text[]) = 0
                         OR lower(regexp_replace(coalesce(brand,''), '[_\-].*$', '')) = ANY($4::text[]))
                    AND ($5::text[] IS NULL OR file_id = ANY($5::text[]))
                    AND ($6::text[] IS NULL OR lower(regexp_replace(coalesce(brand,''), '[_\-].*$', '')) = ANY($6::text[]))
                    AND ($8::text IS NULL OR lower(product) = $8::text)
                  ORDER BY embedding <=> $1::vector
                  LIMIT $7`,
                [vStr, safeLevels, _minChunkChars, _packKeywords, _bindingFileIds, _effectiveBrandsArg, _perLimit, _productHardArg]
              ).catch(() => null);
              if (!sub) continue;
              for (const r of sub.rows) {
                if (Number(r.score) < floor) continue;
                const k = String(r.id);
                if (_seenIds.has(k)) continue;
                _seenIds.add(k);
                vectorRows.push(r);
                _added++;
              }
            }
            stages.multiVersionMs = Date.now() - _tMv0;
            console.log(`[MULTI-VER-SPLIT] versions=[${_versions.map(v => v.key).join(",")}] variants=${_variants.length} added=${_added} ms=${stages.multiVersionMs}`);
          }
        } catch (e) {
          console.warn("[MULTI-VER-SPLIT] failed (non-fatal):", e.message);
        }
      }
    }

    const fusedAll = _rrfFuse([
      { name: "vector", rows: vectorRows },
      { name: "fts",    rows: fts.rows },
    ], { k: 60, query: q });
    const fusedVersioned = _explicitVersionSlice(fusedAll, 6, qForRetrieval, { enabled: RAG_SETTINGS.versionPathBoost !== 0 });
    const fused = _quotaSlice(fusedVersioned, 6, _detectedVersions, { enabled: RAG_SETTINGS.multiVersionQuota !== false });
    const topCoverage = Number(fused[0]?.coverage || 0);

    let _zeroCovDominantBrand = null;
    if (fused.length && topCoverage === 0) {
      const _vc = {};
      for (const r of vectorRows) {
        const b = String(r.brand || "").trim();
        if (b) _vc[b] = (_vc[b] || 0) + 1;
      }
      const _ve = Object.entries(_vc).sort((a, b) => b[1] - a[1]);
      const _vt = _ve.reduce((a, [, c]) => a + c, 0);
      _zeroCovDominantBrand = (_ve[0] && _vt > 0 && _ve[0][1] / _vt >= 0.5) ? _ve[0][0] : null;
      const _top1Brand = String(fused[0]?.brand || "").trim();
      const _vectorTop1OK = Number(top1) >= Number(tau);
      const _brandSafeBypass = _vectorTop1OK && _zeroCovDominantBrand && _top1Brand === _zeroCovDominantBrand;
      if (!_brandSafeBypass) {
        return {
          decision: "skip",
          reason: "zero_coverage",
          rows: [],
          top1, ftsTop, tau,
          explicitBrandLock: _explicitBrandLock,
          effectiveBrandsArg: _effectiveBrandsArg,
          libraryMatch: _libraryMatchForDiag,
          ftsRows: (fts.rows || []).length,
          ftsError: fts.error || getLastFtsError(),
          queryTerms: fused[0]?.queryTerms ?? null,
          topCoverage: 0,
          rejectedTop: fused.slice(0, 3).map(r => ({
            path: r.path, ord: r.ord, brand: r.brand,
            score: r.score, rrf: r.rrf, coverage: r.coverage, retriever: r.retriever,
          })),
          stages,
        };
      }
      console.log(`[ZERO-COV-BYPASS] top1Brand=${_top1Brand} dominantBrand=${_zeroCovDominantBrand} vectorTop1=${top1.toFixed(3)} tau=${tau.toFixed(3)} → rerank-gate'e devret`);
    }

    const _hist = (rows) => rows.reduce((m, r) => {
      const b = String(r.brand || "?");
      m[b] = (m[b] || 0) + 1; return m;
    }, {});

    const _rrModel = process.env.RAG_RERANK_MODEL || "BAAI/bge-reranker-base";
    let rerankInfo = { used: false, ms: 0, model: _rrModel, reason: "not_attempted", lastError: null };
    let finalRows = fused;
    if (!RAG_SETTINGS.rerankEnabled) {
      rerankInfo = { used: false, ms: 0, model: _rrModel, reason: "disabled", lastError: null };
    } else if (fused.length <= 1) {
      rerankInfo = { used: false, ms: 0, model: _rrModel, reason: "single_candidate", lastError: null };
    } else {
      const topN = Math.min(RAG_SETTINGS.rerankTopN || 12, fused.length);
      const cand = fused.slice(0, topN);
      const docs = cand.map(r => String(r.content || "").slice(0, 2000));
      const rrT0 = Date.now();
      const ranked = await rerank(qForRetrieval, docs, { topN, timeoutMs: RAG_SETTINGS.rerankTimeoutMs });
      const rrMs = Date.now() - rrT0;
      stages.rerankMs = rrMs;
      if (ranked && ranked.length) {
        const w = Math.min(1, Math.max(0, Number(RAG_SETTINGS.rerankWeight) ?? 0.7));
        const scores = new Map(ranked.map(x => [x.index, Number(x.score) || 0]));
        const fusedMax = Math.max(...cand.map(r => r.fused || 0)) || 1;
        const rerankMax = Math.max(...ranked.map(x => Math.abs(Number(x.score) || 0))) || 1;
        const _productBoost = (_productMode === "boost" && _productLock)
          ? Math.min(0.50, Math.max(0, Number(RAG_SETTINGS.productFilterBoost) || 0))
          : 0;
        const _pbProd = _productLock?.product || null;
        // 2026-06-05 — Version-aware path boost. Extract numeric major.minor
        // tokens from the query (e.g. "7.6", "7.6.6", "R81.20") and boost
        // rows whose path/content contains any of them. Pure path/token
        // matching, no static brand/product dictionary.
        const _versionBoost = Math.min(0.50, Math.max(0, Number(RAG_SETTINGS.versionPathBoost) || 0));
        let _qVersions = [];
        if (_versionBoost > 0) {
          const _vRe = /\b[Rr]?\d+\.\d+(?:\.\d+)?\b/g;
          const _seen = new Set();
          let _m;
          while ((_m = _vRe.exec(qForRetrieval)) !== null) {
            const t = _m[0].toLowerCase();
            if (!_seen.has(t)) { _seen.add(t); _qVersions.push(t); }
          }
          // Also include the major.minor stem of any X.Y.Z (e.g. 7.6.6 → 7.6).
          for (const v of [..._qVersions]) {
            const stem = v.match(/^([Rr]?\d+\.\d+)/);
            if (stem && !_seen.has(stem[1].toLowerCase())) {
              _seen.add(stem[1].toLowerCase());
              _qVersions.push(stem[1].toLowerCase());
            }
          }
        }
        const _qVersionStems = new Set(_qVersions.map((v) => {
          const m = String(v || "").toLowerCase().match(/r?(\d+\.\d+)/);
          return m ? m[1] : null;
        }).filter(Boolean));
        let _boostedCount = 0;
        let _verBoostedCount = 0;
        let _verPenalizedCount = 0;
        const _verMatchedPaths = [];
        const _verPenalizedPaths = [];
        const blended = cand.map((r, i) => {
          const rs = scores.has(i) ? scores.get(i) : 0;
          const rsNorm = rs / rerankMax;
          const fsNorm = (r.fused || 0) / fusedMax;
          let mix = w * rsNorm + (1 - w) * fsNorm;
          if (_productBoost > 0 && _pbProd && String(r.product || "").toLowerCase() === _pbProd) {
            mix += _productBoost;
            _boostedCount++;
          }
          if (_versionBoost > 0 && _qVersions.length) {
            const hay = `${String(r.path || "")} ${String(r.content || "").slice(0, 200)}`.toLowerCase();
            const pathHay = String(r.path || "").toLowerCase();
            const _pathVersionStems = new Set();
            const _pvRe = /\br?(\d+\.\d+)(?:\.\d+)?\b/g;
            let _pv;
            while ((_pv = _pvRe.exec(pathHay)) !== null) _pathVersionStems.add(_pv[1]);
            if (_qVersions.some((v) => hay.includes(v))) {
              mix += _versionBoost;
              _verBoostedCount++;
              if (_verMatchedPaths.length < 4) _verMatchedPaths.push(String(r.path || "").split("/").slice(-1)[0]);
            } else if (_pathVersionStems.size && Array.from(_pathVersionStems).some((v) => !_qVersionStems.has(v))) {
              mix -= _versionBoost;
              _verPenalizedCount++;
              if (_verPenalizedPaths.length < 4) _verPenalizedPaths.push(String(r.path || "").split("/").slice(-1)[0]);
            }
          }
          return { ...r, rerank_score: Number(rs.toFixed(4)), rerank_mix: Number(mix.toFixed(6)) };
        }).sort((a, b) => b.rerank_mix - a.rerank_mix);
        if (_productBoost > 0) console.log(`[PRODUCT-BOOST] product=${_pbProd} boost=${_productBoost} matched=${_boostedCount}/${cand.length}`);
        if (_versionBoost > 0 && _qVersions.length) console.log(`[VERSION-BOOST] caller=${_caller} versions=[${_qVersions.join(",")}] boost=${_versionBoost} matched=${_verBoostedCount}/${cand.length} penalized=${_verPenalizedCount}/${cand.length} paths=${JSON.stringify(_verMatchedPaths)} penalizedPaths=${JSON.stringify(_verPenalizedPaths)}`);
        const blendedVersioned = _explicitVersionSlice(blended, 6, qForRetrieval, { enabled: RAG_SETTINGS.versionPathBoost !== 0 });
        finalRows = _quotaSlice(blendedVersioned, 6, _detectedVersions, { enabled: RAG_SETTINGS.multiVersionQuota !== false });
        rerankInfo = { used: true, ms: rrMs, model: _rrModel, reason: "ok", lastError: null };

        const _rrMin = Number(RAG_SETTINGS.rerankMinScore ?? 0.10);
        if (_rrMin > 0 && finalRows.length) {
          const _rrTop1 = Number(finalRows[0]?.rerank_score ?? 0);
          const _covTop1 = Number(finalRows[0]?.coverage ?? 0);
          const _brandCounts2 = {};
          for (const r of finalRows) {
            const b = String(r.brand || "").trim();
            if (b) _brandCounts2[b] = (_brandCounts2[b] || 0) + 1;
          }
          const _brandEntries = Object.entries(_brandCounts2).sort((a, b) => b[1] - a[1]);
          const _totalBranded = _brandEntries.reduce((a, [, c]) => a + c, 0);
          const _dominantBrand = (_brandEntries[0] && _totalBranded > 0 && _brandEntries[0][1] / _totalBranded >= 0.5)
            ? _brandEntries[0][0] : null;
          const _top1Brand = String(finalRows[0]?.brand || "").trim();
          const _vectorOK = Number(top1) >= Number(tau);

          const rerankSafe   = _rrTop1 >= _rrMin;
          const coverageSafe = _covTop1 >= 0.25;
          const brandSafe    = _vectorOK && _dominantBrand && _top1Brand === _dominantBrand;
          const anySafe = rerankSafe || coverageSafe || brandSafe;

          if (!anySafe) {
            rerankInfo = {
              ...rerankInfo,
              reason: "below_min_score",
              minScore: _rrMin,
              top1Score: _rrTop1,
              gate: { rerankSafe, coverageSafe, brandSafe, top1Coverage: _covTop1, top1Brand: _top1Brand, dominantBrand: _dominantBrand, vectorOK: _vectorOK },
            };
            return {
              decision: "skip",
              reason: "no_confident_match",
              rows: [],
              top1, ftsTop, tau,
              explicitBrandLock: _explicitBrandLock,
              effectiveBrandsArg: _effectiveBrandsArg,
              libraryMatch: _libraryMatchForDiag,
              ftsRows: (fts.rows || []).length,
              ftsError: fts.error || getLastFtsError(),
              topCoverage,
              queryTerms: fused[0]?.queryTerms ?? null,
              ftsRowsByBrand: _hist(fts.rows || []),
              vectorRowsByBrand: _hist(vectorRows || []),
              reranker: rerankInfo,
              queryClean: cleanQuery,
              extractor: { cacheHit: ex.cacheHit, ms: ex.ms, reject: ex.reject || null },
              qForRetrieval,
              hyde: hydeInfo,
              rejectedTop: finalRows.slice(0, 5).map(r => ({
                path: r.path, ord: r.ord, brand: r.brand,
                score: r.score, rerank_score: r.rerank_score,
                rerank_mix: r.rerank_mix,
              })),
              stages,
            };
          }

          rerankInfo = {
            ...rerankInfo,
            gate: { rerankSafe, coverageSafe, brandSafe, top1Coverage: _covTop1, top1Brand: _top1Brand, dominantBrand: _dominantBrand, vectorOK: _vectorOK, acceptedBy: rerankSafe ? "rerank" : (coverageSafe ? "coverage" : "brand") },
          };

          if (rerankSafe) {
            const _minSupport = Math.max(0, Number(RAG_SETTINGS.minSupportSources ?? 0));
            const _kept = finalRows.filter(r => Number(r.rerank_score ?? 0) >= _rrMin);
            if (_minSupport > 0 && _kept.length < _minSupport) {
              finalRows = finalRows.slice(0, Math.min(_minSupport, finalRows.length));
            } else {
              finalRows = _kept;
            }
          } else if (brandSafe) {
            const _sameBrand = finalRows.filter(r => String(r.brand || "").trim() === _top1Brand);
            finalRows = _sameBrand.length ? _sameBrand : finalRows.slice(0, 1);
          } else {
            finalRows = finalRows.slice(0, 3);
          }
        }
      } else {
        rerankInfo = { used: false, ms: rrMs, model: _rrModel, reason: "worker_unavailable", lastError: getLastRerankError() };
      }
    }

    // If the query explicitly names a version and the final support set already
    // contains same-version rows, do not let older/newer versioned manuals back
    // into the cited context. Rows with no path version remain eligible; rows
    // with a conflicting path version are dropped. Pure token/path logic.
    try {
      const _versionBoost = Math.min(0.50, Math.max(0, Number(RAG_SETTINGS.versionPathBoost) || 0));
      console.log(`[VERSION-SUPPORT-FILTER/DEBUG] caller=${_caller} reached=1 versionBoost=${_versionBoost} finalRows=${finalRows.length} qLen=${String(qForRetrieval || "").length}`);
      if (_versionBoost > 0 && finalRows.length) {
        const _qStems = new Set();
        const _qRe = /(?<![\d.])(\d+\.\d+)(?:\.\d+)?(?!\d)/gi;
        let _qm;
        while ((_qm = _qRe.exec(qForRetrieval)) !== null) _qStems.add(_qm[1]);
        console.log(`[VERSION-SUPPORT-FILTER/DEBUG] caller=${_caller} qStems=[${Array.from(_qStems).join(",")}] qSample=${JSON.stringify(String(qForRetrieval || "").slice(0, 120))}`);
        if (_qStems.size) {
          const _rowPathStems = (r) => {
            const stems = new Set();
            const _pRe = /(?<![\d.])(\d+\.\d+)(?:\.\d+)?(?!\d)/gi;
            let _pm;
            const p = String(r?.path || "");
            while ((_pm = _pRe.exec(p)) !== null) stems.add(_pm[1]);
            return stems;
          };
          const _hasWanted = (r) => Array.from(_rowPathStems(r)).some((v) => _qStems.has(v));
          const _hasConflict = (r) => {
            const stems = _rowPathStems(r);
            return stems.size > 0 && Array.from(stems).every((v) => !_qStems.has(v));
          };
          const _wantedCount = finalRows.filter(_hasWanted).length;
          const _conflictCount = finalRows.filter(_hasConflict).length;
          console.log(`[VERSION-SUPPORT-FILTER/DEBUG] caller=${_caller} wantedCount=${_wantedCount} conflictCount=${_conflictCount} samplePaths=${JSON.stringify(finalRows.slice(0,5).map(r => String(r.path || "").split("/").slice(-1)[0]))}`);
          if (_wantedCount > 0) {
            const _before = finalRows.length;
            const _dropped = [];
            finalRows = finalRows.filter((r) => {
              const drop = _hasConflict(r);
              if (drop && _dropped.length < 4) _dropped.push(String(r.path || "").split("/").slice(-1)[0]);
              return !drop;
            });
            console.log(`[VERSION-SUPPORT-FILTER] caller=${_caller} versions=[${Array.from(_qStems).join(",")}] kept=${finalRows.length}/${_before} dropped=${JSON.stringify(_dropped)}`);
          }
        }
      }
    } catch (e) {
      console.warn("[VERSION-SUPPORT-FILTER] failed (non-fatal):", e.message);
    }

    if (finalRows.length >= 2) {
      const _cbMinTop1 = Number(RAG_SETTINGS.crossBrandMinTop1) || 0;
      const _cbMinDom  = Number(RAG_SETTINGS.crossBrandMinDominance) || 0;
      if (_cbMinTop1 > 0 && _cbMinDom > 0) {
        const _top1F = Number(finalRows[0]?.score ?? 0);
        const _bc = {};
        for (const r of finalRows) {
          const b = String(r.brand || "").trim();
          if (b) _bc[b] = (_bc[b] || 0) + 1;
        }
        const _be = Object.entries(_bc).sort((a, b) => b[1] - a[1]);
        const _bt = _be.reduce((a, [, c]) => a + c, 0);
        const _dominantShare = _be[0] && _bt > 0 ? (_be[0][1] / _bt) : 0;
        if (_top1F < _cbMinTop1 && _dominantShare < _cbMinDom) {
          console.log(`[LIB-GATE/C] cross-brand contamination top1=${_top1F.toFixed(3)} dominantShare=${(_dominantShare*100).toFixed(0)}% brands=${JSON.stringify(_bc)} → skip`);
          return {
            decision: "skip",
            reason: "cross_brand_contamination",
            rows: [],
            top1, ftsTop, tau,
            explicitBrandLock: _explicitBrandLock,
            effectiveBrandsArg: _effectiveBrandsArg,
            libraryMatch: _libraryMatchForDiag,
            ftsRows: (fts.rows || []).length,
            ftsError: fts.error || getLastFtsError(),
            topCoverage,
            queryTerms: fused[0]?.queryTerms ?? null,
            ftsRowsByBrand: _hist(fts.rows || []),
            vectorRowsByBrand: _hist(vectorRows || []),
            reranker: rerankInfo,
            queryClean: cleanQuery,
            extractor: { cacheHit: ex.cacheHit, ms: ex.ms, reject: ex.reject || null },
            qForRetrieval,
            hyde: hydeInfo,
            libGate: { ..._libGateInfo, contamination: { top1Final: _top1F, dominantShare: Number(_dominantShare.toFixed(3)), brands: _bc, minTop1: _cbMinTop1, minDominance: _cbMinDom } },
            rejectedTop: finalRows.slice(0, 5).map(r => ({
              path: r.path, ord: r.ord, brand: r.brand,
              score: r.score, rerank_score: r.rerank_score,
              rerank_mix: r.rerank_mix,
            })),
            stages,
          };
        }
      }
    }

    const _top1Final = Number(finalRows[0]?.score ?? top1) || 0;
    const _top4Final = Number(finalRows[3]?.score ?? 0) || 0;
    const _confidence = _computeConfidence({
      top1: _top1Final,
      top4: _top4Final,
      sourceCount: new Set(finalRows.map(r => r.path)).size,
    });
    return {
      decision: finalRows.length ? "inject" : "skip",
      reason:   finalRows.length ? "fetched" : "no_rows_above_floor",
      rows: finalRows.map(r => ({ ...r, retriever: r.retriever || "hybrid" })),
      top1, ftsTop, tau,
      explicitBrandLock: _explicitBrandLock,
      effectiveBrandsArg: _effectiveBrandsArg,
      libraryMatch: _libraryMatchForDiag,
      ftsRows: (fts.rows || []).length,
      ftsError: fts.error || getLastFtsError(),
      topCoverage,
      queryTerms: fused[0]?.queryTerms ?? null,
      ftsRowsByBrand: _hist(fts.rows || []),
      vectorRowsByBrand: _hist(vectorRows || []),
      reranker: rerankInfo,
      queryClean: cleanQuery,
      extractor: { cacheHit: ex.cacheHit, ms: ex.ms, reject: ex.reject || null },
      qForRetrieval,
      confidence: _confidence,
      hyde: hydeInfo,
      libGate: _libGateInfo,
      productLock: _productLock,
      productMode: _productMode,
      stages,
    };

  } catch (e) {
    if (process.env.DEBUG_RAG) console.error("[rag:probe]", String(e.message || e));
    return { decision: "skip", reason: "probe_error", rows: [], top1: 0, tau, error: String(e.message || e).slice(0, 200) };
  } finally {
    client.release();
  }
}

// semanticSearch — HNSW fast-path with trigram fallback.
export async function semanticSearch({ q, allowedLevels, matchedBrand, matchedBrands, limit, minScore, candidateDepth }) {
  const { pool, getRagSettings, ROLE_RANK, embed, expandQueryTerms, cosine, DEFAULT_RAG_TRGM_THRESHOLD, DEFAULT_RAG_TRGM_MIN_SCORE } = DEPS;
  const RAG_SETTINGS = getRagSettings();
  const brandList = (matchedBrands && matchedBrands.length) ? matchedBrands : (matchedBrand ? [matchedBrand] : []);
  const safeLevels = Array.isArray(allowedLevels) && allowedLevels.length ? allowedLevels : Object.keys(ROLE_RANK);
  const min = Math.min(1, Math.max(0.01, Number(minScore ?? RAG_SETTINGS.similarityThreshold) || 0.30));
  const topK = Math.max(1, Math.min(20, Number(limit ?? RAG_SETTINGS.topK) || RAG_SETTINGS.topK || 5));
  const depth = Math.max(topK, Math.min(80, Math.max(5, Number(candidateDepth ?? RAG_SETTINGS.chunkDepth) || 32)));
  const qVecArr = await embed([q]).catch(() => null);
  if (qVecArr && qVecArr[0]?.length) {
    const qVec = `[${qVecArr[0].join(",")}]`;
    try {
      const params = [qVec, safeLevels];
      let where = `embedding IS NOT NULL AND access_level = ANY($2::text[])`;
      if (brandList.length) { params.push(brandList); where += ` AND brand = ANY($3::text[])`; }
      const _minChunkChars = Math.max(0, Number(RAG_SETTINGS.minChunkChars ?? 0));
      if (_minChunkChars > 0) { params.push(_minChunkChars); where += ` AND length(content) >= $${params.length}::int`; }
      params.push(depth);
      const slot = `$${params.length}`;
      const efSearch = Math.max(80, Math.min(400, depth * 8));
      const client = await pool.connect();
      try {
        await client.query(`SET LOCAL hnsw.ef_search = ${efSearch}`).catch(() => {});
        await client.query(`SET LOCAL statement_timeout = '4s'`).catch(() => {});
        const r = await client.query(
          `SELECT file_id, path, ord, brand, access_level, content, page_start, page_end,
                  1 - (embedding <=> $1::vector) AS score
             FROM knowledge_chunks
            WHERE ${where}
            ORDER BY embedding <=> $1::vector
            LIMIT ${slot}`, params);
        if (r.rows.length) {
          return r.rows.filter(x => Number(x.score) >= min).slice(0, topK)
                       .map(x => ({ ...x, retriever: "hnsw" }));
        }
      } finally {
        client.release();
      }
    } catch (e) {
      if (process.env.DEBUG_RAG) console.error("[rag:hnsw]", String(e.message||e));
    }
  }
  await pool.query("SELECT set_limit($1)", [DEFAULT_RAG_TRGM_THRESHOLD]).catch(() => {});
  const terms = expandQueryTerms(q).filter(t => t.length >= 3).slice(0, 12);
  const patterns = terms.map(t => `%${t}%`);
  const params = [q, safeLevels, patterns];
  let sql = `SELECT file_id, path, ord, brand, access_level, content, page_start, page_end,
                    GREATEST(similarity(content,$1), similarity(path,$1), word_similarity($1, content), word_similarity($1, path)) AS trgm_score
             FROM knowledge_chunks
             WHERE access_level = ANY($2::text[])
               AND (content % $1 OR path % $1 OR ($3::text[] <> '{}'::text[] AND (content ILIKE ANY($3::text[]) OR path ILIKE ANY($3::text[]))))`;
  if (brandList.length) { sql += ` AND brand = ANY($4::text[])`; params.push(brandList); }
  sql += ` ORDER BY trgm_score DESC LIMIT ${Math.max(depth, 40)}`;
  const pool_rows = (await pool.query(sql, params).catch(() => ({ rows: [] }))).rows;
  if (!pool_rows.length) return [];
  const embs = await embed([q, ...pool_rows.map(r => String(r.content).slice(0, 1500))]);
  if (!embs || embs.length < 2) {
    const minTrgm = DEFAULT_RAG_TRGM_MIN_SCORE;
    return pool_rows.filter(r => Number(r.trgm_score) >= minTrgm).slice(0, topK).map(r => ({ ...r, score: Number(r.trgm_score) || 0, retriever: "trgm-low" }));
  }
  const [qv, ...cv] = embs;
  return pool_rows
    .map((r, i) => ({ ...r, score: cosine(qv, cv[i]), retriever: "embed-rerank" }))
    .filter(r => Number(r.score) >= min)
    .sort((a,b) => b.score - a.score)
    .slice(0, topK);
}
