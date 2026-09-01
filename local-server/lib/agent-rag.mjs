// agent-rag.mjs — Agent başına RAG context injection.
//
// 2026-05-28: Unified with chat retrieval. Previously this module ran its
// own FTS-only pipeline (websearch_to_tsquery) — no reranker, no brand-lock,
// no diversity, no enrichment. Chat's `ragProbeAndFetch` is the canonical
// retrieval pipeline (vector probe + HyDE + FTS + reranker + per-source/
// per-brand cap + dominant-brand gate + min-chunk filter + pack filter).
// Agent now calls it directly → tek motor, tek bakım yüzeyi.
//
// Modes (preserved from previous contract):
//   1) meta.rag.enabled === false   → fully off.
//   2) per-collection bindings      → file_id filter passed to ragProbeAndFetch.
//   3) default / explicit enable    → unrestricted query, library decides.
//
// Output: { env, args, meta } — injected into the child process.
//
// ragProbeAndFetch lives in ./rag/retrieval.mjs (Tur 1b 2026-05-30 extraction).
// We use dynamic `await import("./rag/retrieval.mjs")` INSIDE the function
// (request-time) — by then the module is fully evaluated, ESM cache hits.

const DEFAULT_MAX_CONTEXT_CHARS = 12000;
const ROLE_LEVELS = ["Viewer", "Security", "Operator", "Admin"];

function _agentFastEnv(settings = {}, lane = "query") {
  const out = {};
  const shouldDisable = lane === "rag"
    ? settings.disableThinkOnRag !== false
    : lane === "smalltalk"
      ? settings.disableThinkOnSmalltalk !== false
      : settings.disableThinkOnQuery !== false;
  if (shouldDisable) out.ELARA_LLM_FORCE_DISABLE_THINKING = "1";
  // Agent runs must keep the per-agent UI max_output_tokens as the source of
  // truth. The chat smalltalk cap (`mlxSmalltalkMaxTokens`) is intentionally NOT
  // applied here: persona self-intros can be longer than chat greetings, and the
  // cap made RAG-disabled agents look as if they were cut mid-sentence.
  return out;
}

// DI: RAG_SETTINGS reader (server.mjs initAgentRag({getRagSettings})).
// When unset, multi-brand defaults to ON (true) so out-of-the-box agents
// hit the full library — matches user decision 2026-05-30.
let _getRagSettings = () => ({});
export function initAgentRag({ getRagSettings }) {
  if (typeof getRagSettings === "function") _getRagSettings = getRagSettings;
}

// ── Brand-aliases reader (UI-managed file, 30s TTL cache) ─────────────────
// Lets the brand-mention gate accept user-added alternate names (e.g.
// "fortimanager" / "fortianalyzer" → Fortigate) without forcing
// requireBrandMentionForRag=OFF. Pure read, no writes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBrandAliasesPath } from "./state-paths.mjs";
const _ALIASES_PATH = getBrandAliasesPath();

let _aliasCache = { ts: 0, map: new Map() }; // brand -> [lowercased aliases]
function _loadAliasMap() {
  const now = Date.now();
  if (now - _aliasCache.ts < 30_000) return _aliasCache.map;
  const map = new Map();
  try {
    if (fs.existsSync(_ALIASES_PATH)) {
      const obj = JSON.parse(fs.readFileSync(_ALIASES_PATH, "utf8"));
      if (obj && typeof obj === "object") {
        for (const [brand, entry] of Object.entries(obj)) {
          const arr = Array.isArray(entry?.aliases) ? entry.aliases : [];
          const lows = arr.map((a) => String(a || "").trim().toLowerCase()).filter(Boolean);
          if (lows.length) map.set(brand, lows);
        }
      }
    }
  } catch { /* ignore — gate falls back to brand-only match */ }
  _aliasCache = { ts: now, map };
  return map;
}
// Returns { matched, matchedDisplay, viaAlias } when an alias appears in query.
function _detectAliasMatch(query, libBrands) {
  const q = String(query || "").toLowerCase();
  if (!q) return null;
  const map = _loadAliasMap();
  if (!map.size) return null;
  const libSet = new Set((libBrands || []).map((b) => String(b)));
  for (const [brand, aliases] of map.entries()) {
    const matchedBrand = libSet.has(brand)
      ? brand
      : (libBrands || []).filter((b) => _brandBaseToken(b) === _brandBaseToken(brand))[0];
    if (!matchedBrand) continue; // alias must belong to a real library brand
    for (const a of aliases) {
      if (a.length >= 3 && q.includes(a)) {
        return { matched: matchedBrand, matchedDisplay: matchedBrand, viaAlias: a };
      }
    }
  }
  return null;
}

function _brandBaseToken(value) {
  return String(value || "").toLowerCase().replace(/[_\-].*$/, "").trim();
}
function _normAliasToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
function _commonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}
function _queryAliasCandidates(query, libBrands) {
  const raw = String(query || "");
  const rawTokens = raw.match(/[\p{L}\p{N}][\p{L}\p{N}_\-.]{2,}/gu) || [];
  const brandTokens = (libBrands || []).map(_brandBaseToken).map(_normAliasToken).filter(Boolean);
  const out = new Map();
  for (const rawTok of rawTokens) {
    const tok = _normAliasToken(rawTok);
    if (tok.length < 4 || tok.length > 48) continue;
    const hasCamelOrUpper = /[A-ZÇĞİÖŞÜ].*[A-ZÇĞİÖŞÜ]/.test(rawTok) || /[a-zçğıöşü][A-ZÇĞİÖŞÜ]/.test(rawTok);
    const sharesBrandPrefix = brandTokens.some((b) => b && tok !== b && _commonPrefixLen(tok, b) >= Math.min(5, Math.max(4, b.length)));
    if (hasCamelOrUpper || sharesBrandPrefix) out.set(tok, rawTok);
    if (out.size >= 8) break;
  }
  return Array.from(out, ([token, raw]) => ({ token, raw }));
}

// Dynamic alias fallback: when the UI alias JSON is empty, infer product-family
// aliases from the indexed library itself. No static vendor dictionary: a token
// must appear in this user's chunks/paths, and the winning brand must be one of
// the live library brands.
async function _detectDynamicAliasMatch(pool, query, libBrands) {
  if (!pool || !Array.isArray(libBrands) || !libBrands.length) return null;
  const candidates = _queryAliasCandidates(query, libBrands);
  if (!candidates.length) return null;
  for (const cand of candidates) {
    try {
      const r = await pool.query(
        `SELECT c.brand, COUNT(*)::int AS hits
           FROM knowledge_chunks c
          WHERE c.brand = ANY($2::text[])
            AND (
              lower(coalesce(c.path, '')) LIKE ('%' || $1 || '%')
              OR lower(left(coalesce(c.content_enriched, c.content, ''), 6000)) LIKE ('%' || $1 || '%')
            )
          GROUP BY c.brand
          ORDER BY hits DESC
          LIMIT 3`,
        [cand.token, libBrands],
      );
      const rows = r.rows || [];
      const top = rows[0];
      if (!top?.brand) continue;
      const topHits = Number(top.hits || 0);
      const secondHits = Number(rows[1]?.hits || 0);
      const topBrandToken = _normAliasToken(_brandBaseToken(top.brand));
      const prefixSafe = _commonPrefixLen(cand.token, topBrandToken) >= Math.min(5, Math.max(4, topBrandToken.length));
      const dominantSafe = topHits >= 3 && topHits >= Math.max(1, secondHits * 2);
      if (prefixSafe || dominantSafe) {
        return { matched: top.brand, matchedDisplay: top.brand, viaAlias: cand.token, viaDynamicAlias: true, dynamicHits: topHits };
      }
    } catch (e) {
      console.warn(`[agent-rag] dynamic-alias probe failed token=${cand.token}: ${e.message}`);
    }
  }
  return null;
}

function _basename(p) {
  if (!p) return "chunk";
  const s = String(p);
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

async function _buildLibraryFallback(qForRetrieval, rawQuery) {
  try {
    const srv = await import("../server.mjs");
    if (typeof srv.getLibraryBrands !== "function" || typeof srv.detectLibraryMatch !== "function") return null;
    const libBrands = await srv.getLibraryBrands();
    // Probe BOTH denoised + raw — if the extractor strips a brand token
    // (e.g. "fortigate" treated as filler) the raw query still anchors it.
    let det = srv.detectLibraryMatch(String(qForRetrieval || ""), libBrands);
    if (!det.matched && rawQuery && rawQuery !== qForRetrieval) {
      det = srv.detectLibraryMatch(String(rawQuery || ""), libBrands);
    }
    const display = typeof srv._brandDisplay === "function" ? srv._brandDisplay : ((b) => b);
    return {
      kind: det.matched ? "in_library_miss" : "out_of_library",
      brand: det.matchedDisplay || (det.matched ? display(det.matched) : null),
      brands: (libBrands || []).slice(0, 5).map(display),
    };
  } catch (e) {
    console.warn("[agent-rag] library-fallback skipped:", e.message);
    return null;
  }
}


async function readAgentRagSettings(pool, agentId) {
  try {
    const r = await pool.query(`SELECT meta FROM agents WHERE id=$1`, [agentId]);
    const meta = r.rows[0]?.meta;
    const rag = (meta && typeof meta === "object" && meta.rag && typeof meta.rag === "object") ? meta.rag : {};
    return {
      enabled: rag.enabled !== false,
      explicitEnabled: rag.enabled === true,
      keywords: Array.isArray(rag.keywords) ? rag.keywords.map(String).filter(Boolean) : [],
    };
  } catch { return { enabled: false, explicitEnabled: false, keywords: [] }; }
}

async function listAgentRagBindings(pool, agentId) {
  if (!pool || !agentId) return [];
  try {
    const r = await pool.query(
      `SELECT collection_id, top_k, threshold
         FROM agent_rag_bindings
        WHERE agent_id=$1 AND enabled=true`,
      [agentId],
    );
    return r.rows;
  } catch { return []; }
}

// Binding collection_id may be a knowledge_sources UUID or a file_id directly.
// Resolve to the concrete file_id set used by knowledge_chunks.
async function resolveBindingFileIds(pool, bindings) {
  if (!bindings.length) return null;
  const out = new Set();
  for (const b of bindings) {
    const cid = String(b.collection_id || "");
    if (!cid) continue;
    const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cid);
    if (!looksUuid) { out.add(cid); continue; }
    try {
      const r = await pool.query(
        `SELECT DISTINCT file_id FROM knowledge_chunks WHERE file_id=$1 LIMIT 256`,
        [cid],
      );
      if (r.rows.length) for (const row of r.rows) out.add(String(row.file_id));
      else out.add(cid); // fallback: pass-through
    } catch (e) {
      console.error(`[agent-rag] resolveBinding error cid=${cid} ${e.message}`);
    }
  }
  return out.size ? Array.from(out) : null;
}

// Diag: independently fetch the same brand inputs ragProbeAndFetch sees
// internally so the UI can show *why* the agent path filters differently
// than /api/rag/debug (which never passes agentId).
async function _gatherBrandDiag(agentId, qForRetrieval, rawQuery) {
  const out = { agentBrands: [], packKeywords: [], libraryMatch: null, effectiveBrandsArg: null, explicitBrandLock: null };
  if (!agentId) return out;
  try {
    const bc = await import("./rag/brand-cache.mjs");
    const [agentBrands, packKeywords] = await Promise.all([
      bc.getAgentRagBrands(agentId).catch(() => []),
      bc.getActivePackBrandFilter(agentId).catch(() => []),
    ]);
    out.agentBrands = Array.isArray(agentBrands) ? agentBrands : [];
    out.packKeywords = Array.isArray(packKeywords) ? packKeywords : [];

    const libBrands = await bc.getLibraryBrands().catch(() => []);
    const det1 = bc.detectLibraryMatch(String(qForRetrieval || ""), libBrands);
    const det = det1.matched ? det1 : bc.detectLibraryMatch(String(rawQuery || ""), libBrands);
    if (det.matched) {
      out.libraryMatch = det.matched;
      out.explicitBrandLock = String(det.matched).toLowerCase().replace(/[_\-].*$/, "").trim() || null;
    }
    // Replicate retrieval.mjs effectiveBrandsArg computation (read-only mirror).
    const bindingBrands = out.agentBrands.map((b) => String(b || "").toLowerCase().replace(/[_\-].*$/, "").trim()).filter(Boolean);
    let eff = bindingBrands.length ? bindingBrands : null;
    const tok = out.explicitBrandLock;
    if (tok) {
      if (eff && eff.length) {
        if (eff.includes(tok)) eff = [tok];
      } else {
        eff = [tok];
      }
    }
    out.effectiveBrandsArg = eff;
  } catch (e) {
    console.warn("[agent-rag] brand-diag failed:", e.message);
  }
  return out;
}

function _minimalDiag(query, extra = {}) {
  return {
    qForRetrieval: query || null,
    queryRewritten: null,
    ftsRows: null,
    ftsTop: null,
    ftsError: null,
    embedError: null,
    topCoverage: null,
    vectorRowsByBrand: null,
    ftsRowsByBrand: null,
    rejectedTop: null,
    libGate: null,
    hyde: null,
    extractor: null,
    bindingFileIds: [],
    agentBrands: [],
    packKeywords: [],
    libraryMatch: null,
    explicitBrandLock: null,
    effectiveBrandsArg: null,
    agentKeywords: [],
    ...extra,
  };
}

export async function buildAgentRagContext(pool, agentId, query) {
  const settings = await readAgentRagSettings(pool, agentId);
  if (settings.enabled === false) {
    return { env: {}, args: [], meta: { enabled: false } };
  }
  const _rs0 = (typeof _getRagSettings === "function") ? (_getRagSettings() || {}) : {};

  // Agent bridge path also lands here. Do the no-RAG self-intro/smalltalk gate
  // centrally so explicit @agent turns like "kendini tanıt" never receive the
  // heavy/no-hit library directive.
  if (_rs0.agentSmalltalkSkipRag !== false && String(query || "").trim()) {
    try {
      const mod = await import("./rag/intent-classifier.mjs");
      if (typeof mod.classifyIntent === "function" && typeof mod.refineIntentSemantically === "function") {
        const base = mod.classifyIntent(query);
        const refined = await mod.refineIntentSemantically(query, base);
        // 2026-06-25: cold-fallback'te smalltalk flip'ine güvenme. Yalnız
        // semantic-bypass VEYA base classifier de smalltalk dediyse skip.
        const _bypassSafe = refined?.mode === "semantic-bypass" || base?.kind === "smalltalk";
        if (refined?.kind === "smalltalk" && refined?.useRag === false && _bypassSafe) {
          console.error(`[AGENT-RAG-DEBUG] agent=${agentId} path=SKIP (central smalltalk/meta gate) mode=${refined.mode || "-"} base=${base?.kind}`);
          return {
            env: { ELARA_AGENT_RAG_ENABLED: "0", ..._agentFastEnv(_rs0, "smalltalk") },
            args: [],
            meta: { enabled: false, hits: 0, decision: "skip", reason: "smalltalk_intent", mode: refined.mode || "smalltalk-gate" },
          };
        } else if (refined?.kind === "smalltalk") {
          console.error(`[AGENT-RAG-DEBUG] agent=${agentId} central gate KEPT mode=${refined.mode} base=${base?.kind} (cold-fallback override ignored)`);
        }
      }
    } catch (e) {
      console.warn(`[agent-rag] central smalltalk gate skipped: ${e?.message || e}`);
    }
  }

  // 2026-06-03 — Brand-mention gate (simetri: chat-stream + chat-orchestrate).
  // Soruda DB library brand'lerinden biri (alias dahil) geçmiyorsa probe'a
  // hiç girme; agent'a "no hits" bilgisi gider (agentRagNoHitsDirective UI'dan
  // kontrol ediliyor → "Kütüphaneme baktım, eşleşen kaynak yok…" tonu).
  // 2026-06-04 — Alias-aware: brand kelimesi geçmese bile /knowledge/aliases
  // UI'sinde tanımlı alternatif isim (fortimanager → Fortigate vb.) varsa
  // gate açılır.
  try {
    const _rs = _rs0;
    if (_rs.requireBrandMentionForRag !== false) {
      const bc = await import("./rag/brand-cache.mjs");
      const _libBrandsG = await bc.getLibraryBrands().catch(() => []);
      let _detG = bc.detectLibraryMatch(String(query || ""), _libBrandsG);
      let _viaAlias = null;
      if (!_detG?.matched) {
        const _aliasHit = _detectAliasMatch(String(query || ""), _libBrandsG);
        if (_aliasHit) { _detG = _aliasHit; _viaAlias = _aliasHit.viaAlias; }
      }
      if (!_detG?.matched) {
        const _dynAliasHit = await _detectDynamicAliasMatch(pool, String(query || ""), _libBrandsG);
        if (_dynAliasHit) { _detG = _dynAliasHit; _viaAlias = _dynAliasHit.viaAlias; }
      }
      if (!_detG?.matched) {
        return {
          env: { ELARA_AGENT_RAG_ENABLED: "0", ..._agentFastEnv(_rs, "query") },
          args: [],
          meta: { enabled: true, hits: 0, mode: "brand-gate-skip", decision: "skip", reason: "no_library_brand_in_query", diag: _minimalDiag(query, { agentKeywords: settings.keywords || [] }) },
        };
      }
      if (_viaAlias) {
        console.log(`[agent-rag] brand-gate alias-hit brand=${_detG.matched} alias="${_viaAlias}" dynamic=${_detG.viaDynamicAlias ? 1 : 0} agent=${agentId}`);
      }
    }
  } catch (e) { console.warn("[agent-rag] brand-gate skipped:", e.message); }

  const bindings = await listAgentRagBindings(pool, agentId);
  const bindingFileIds = bindings.length ? await resolveBindingFileIds(pool, bindings) : null;

  // 2026-06-01 DIAG: raw meta.rag.brands straight from DB (case-preserved),
  // separate from getAgentRagBrands which lowercases. Helps confirm whether
  // UI chip selection actually persisted (H2) vs scope path bug (H1/H3).
  let _metaRagBrandsRaw = [];
  try {
    const r = await pool.query("SELECT meta FROM agents WHERE id=$1", [agentId]);
    const m = (r.rows[0]?.meta && typeof r.rows[0].meta === "object") ? r.rows[0].meta : {};
    if (Array.isArray(m?.rag?.brands)) _metaRagBrandsRaw = m.rag.brands.map(String);
  } catch (e) {
    console.warn(`[agent-rag:DIAG] meta-read failed agent=${agentId}: ${e.message}`);
  }

  // Lazy load to avoid circular import at module init.
  let ragProbeAndFetch;
  try {
    const mod = await import("./rag/retrieval.mjs");
    ragProbeAndFetch = mod.ragProbeAndFetch;
  } catch (e) {
    console.error(`[agent-rag] failed to load ragProbeAndFetch: ${e.message}`);
    return { env: { ELARA_AGENT_RAG_ENABLED: "1" }, args: [], meta: { enabled: true, hits: 0, mode: "error", decision: "skip", reason: "rag_probe_import_failed", rawReason: e.message || "import_failed", error: "import_failed", diag: _minimalDiag(query, { ftsError: e.message || "import_failed", agentKeywords: settings.keywords || [], bindingFileIds: bindingFileIds || [] }) } };
  }
  if (typeof ragProbeAndFetch !== "function") {
    console.error(`[agent-rag] ragProbeAndFetch not exported from server.mjs`);
    return { env: { ELARA_AGENT_RAG_ENABLED: "1" }, args: [], meta: { enabled: true, hits: 0, mode: "error", decision: "skip", reason: "rag_probe_no_export", rawReason: "ragProbeAndFetch not exported", error: "no_export", diag: _minimalDiag(query, { ftsError: "ragProbeAndFetch not exported", agentKeywords: settings.keywords || [], bindingFileIds: bindingFileIds || [] }) } };
  }

  // ── Agent scope = UI tek mercii (2026-06-01) ───────────────────────────
  // Default: agent's Edit Agent → Knowledge/RAG bindings + keywords are
  // BINDING. Empty bindings + empty keywords → full library (natural
  // multi-brand). Opt-in override: RAG_SETTINGS.agentMultiBrand === true
  // forces the old "strip all agent scope" behavior for debug.
  const _ragSettings = _rs0;
  const multiBrand = _ragSettings.agentMultiBrand === true;
  // H1 fix (2026-06-01): if agent has explicit meta.rag.brands selection in UI,
  // brand scope itself is the binding — legacy agent_rag_bindings file_id rows
  // (created before brand selector existed) would narrow back to old brand and
  // mask newly added brands. Bypass legacy file_id filter in that case.
  const _hasMetaBrands = Array.isArray(_metaRagBrandsRaw) && _metaRagBrandsRaw.length > 0;
  const _bypassLegacyBindings = multiBrand || _hasMetaBrands;
  const effBindingFileIds = _bypassLegacyBindings ? null : bindingFileIds;
  const effAgentKeywords  = multiBrand ? []   : (settings.keywords || []);
  const effAgentId        = multiBrand ? null : agentId;
  const mode = multiBrand
    ? "multi-brand-override"
    : (_hasMetaBrands
        ? "brand-scope"
        : (bindings.length
            ? "collections"
            : ((settings.keywords && settings.keywords.length) ? "keywords" : "open")));

  // Agent'ın UI brand scope'u (meta.rag.brands) retrieval'a taşınır;
  // aksi halde product extractor brand context'siz kalıyor ve sorguda
  // brand token yoksa product lock devreye girmiyor.
  const _bindingBrandsForRetrieval = _hasMetaBrands
    ? _metaRagBrandsRaw.map((b) => String(b || "").toLowerCase().replace(/[_\-].*$/, "").trim()).filter(Boolean)
    : null;
  let result;
  // 2026-06-24: This must NOT be a Promise.race hard timeout. The loser keeps
  // running (DB/MLX work is not cancelled), so repeated agent turns create
  // orphan probes that clog the pool and make the next turn timeout even if the
  // same query would otherwise return hits quickly. Keep it as a soft warning;
  // stage-level timeouts inside ragProbeAndFetch remain the real guardrails.
  const _agentRagWarnMs = Math.max(2000, Math.min(60000, Number(_ragSettings.agentRagDeadlineMs ?? 8000)));
  let _slowTimer = null;
  try {
    _slowTimer = setTimeout(() => {
      try { console.warn(`[agent-rag] agent=${agentId} ragProbeAndFetch.slow>${_agentRagWarnMs}ms q="${String(query || "").slice(0, 80)}"`); } catch { /* */ }
    }, _agentRagWarnMs);
    result = await ragProbeAndFetch({
      q: query,
      allowedLevels: ROLE_LEVELS,
      agentId: effAgentId,
      bindingFileIds: effBindingFileIds,
      bindingBrands: _bindingBrandsForRetrieval && _bindingBrandsForRetrieval.length ? _bindingBrandsForRetrieval : null,
      agentKeywords: effAgentKeywords,
      caller: "agent",
    });
  } catch (e) {
    console.error(`[agent-rag] agent=${agentId} ragProbeAndFetch.error=${e.message}`);
    return {
      env: { ELARA_AGENT_RAG_ENABLED: "1" },
      args: [],
      meta: { enabled: true, hits: 0, mode, decision: "skip", reason: "rag_probe_error", rawReason: e.message || null, error: e.message, diag: _minimalDiag(query, { ftsError: e.message || "rag_probe_error", bindingFileIds: bindingFileIds || [], agentKeywords: settings.keywords || [] }) },
    };
  } finally {
    if (_slowTimer) clearTimeout(_slowTimer);
  }

  // Independent brand-diag (mirror of ragProbeAndFetch's internal filter inputs).
  const brandDiag = await _gatherBrandDiag(agentId, result?.qForRetrieval || query, query);
  const appliedEffectiveBrandsArg = Array.isArray(result?.effectiveBrandsArg)
    ? result.effectiveBrandsArg
    : brandDiag.effectiveBrandsArg;
  const appliedExplicitBrandLock = result?.explicitBrandLock || brandDiag.explicitBrandLock;
  const appliedLibraryMatch = result?.libraryMatch || brandDiag.libraryMatch;

  // Common diag block built from passive pass-through of retrieval result.
  const diag = {
    qForRetrieval: result?.qForRetrieval || null,
    queryRewritten: result?.queryRewritten || null,
    ftsRows: typeof result?.ftsRows === "number" ? result.ftsRows : null,
    ftsTop: typeof result?.ftsTop === "number" ? result.ftsTop : null,
    ftsError: result?.ftsError || null,
    embedError: result?.embedError || null,
    topCoverage: typeof result?.topCoverage === "number" ? result.topCoverage : null,
    vectorRowsByBrand: result?.vectorRowsByBrand || null,
    ftsRowsByBrand: result?.ftsRowsByBrand || null,
    rejectedTop: Array.isArray(result?.rejectedTop) ? result.rejectedTop.slice(0, 5) : null,
    libGate: result?.libGate || null,
    hyde: result?.hyde || null,
    extractor: result?.extractor || null,
    bindingFileIds: bindingFileIds || [],
    agentBrands: brandDiag.agentBrands,
    packKeywords: brandDiag.packKeywords,
    libraryMatch: appliedLibraryMatch,
    explicitBrandLock: appliedExplicitBrandLock,
    effectiveBrandsArg: brandDiag.effectiveBrandsArg,
    appliedEffectiveBrandsArg,
    agentKeywords: settings.keywords || [],
    multiBrand,
    appliedBindingFileIds: effBindingFileIds || [],
    appliedAgentKeywords: effAgentKeywords || [],
    legacyBindingsCount: bindings.length,
    legacyBindingFileIdCount: Array.isArray(bindingFileIds) ? bindingFileIds.length : 0,
    metaRagBrandsRaw: _metaRagBrandsRaw,
  };

  // 2026-06-01 DIAG: one-shot summary line so we can tell H1 (legacy bindings
  // narrowing past brand-lock) vs H2 (UI save dropped a brand) vs H3 (brand
  // narrow no-op) without grepping multiple log lines.
  console.error(`[agent-rag:DIAG] agent=${agentId} legacyBindings=${bindings.length} legacyFileIds=${Array.isArray(bindingFileIds) ? bindingFileIds.length : 0} metaBrandsRaw=${JSON.stringify(_metaRagBrandsRaw)} agentBrandsResolved=${JSON.stringify(brandDiag.agentBrands)} libMatch=${appliedLibraryMatch || "-"} explicitLock=${appliedExplicitBrandLock || "-"} effectiveBrandsArg=${JSON.stringify(brandDiag.effectiveBrandsArg)} appliedEffectiveBrandsArg=${JSON.stringify(appliedEffectiveBrandsArg)} mode=${mode} rows=${Array.isArray(result?.rows) ? result.rows.length : 0} top1=${(result?.top1 || 0).toFixed?.(3) ?? result?.top1}`);

  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (result?.decision === "skip" || rows.length === 0) {
    // Server reason may be null (e.g. inject decision yielded 0 rows after
    // defensive filter). Derive a real reason for the UI from diag inputs.
    let derivedReason = result?.reason || null;
    if (!derivedReason) {
      if (brandDiag.agentBrands.length) derivedReason = "agent_brand_scope_excluded";
      else if (bindingFileIds && bindingFileIds.length) derivedReason = "binding_files_filtered_out";
      else if (brandDiag.packKeywords.length) derivedReason = "pack_keywords_active";
      else derivedReason = "no_rows_after_filters";
    }
    console.error(`[agent-rag] agent=${agentId} hits=0 mode=${mode} decision=${result?.decision || "empty"} reason=${derivedReason} top1=${(result?.top1 || 0).toFixed?.(3) ?? result?.top1} effBrands=${JSON.stringify(brandDiag.effectiveBrandsArg)} agentBrands=${JSON.stringify(brandDiag.agentBrands)}`);
    const fallback = await _buildLibraryFallback(result?.qForRetrieval || query, query);
    return {
      env: { ELARA_AGENT_RAG_ENABLED: "1" },
      args: [],
      meta: {
        enabled: true,
        hits: 0,
        mode,
        decision: result?.decision || "empty",
        reason: derivedReason,
        rawReason: result?.reason || null,
        top1: result?.top1 ?? null,
        tau: result?.tau ?? null,
        confidence: null,
        queryRewritten: result?.queryRewritten || null,
        sources: [],
        fallback,
        bindingFileIds: bindingFileIds || [],
        diag,
      },
    };
  }


  // Defensive: when binding file ids were actually applied, drop any rows that slipped
  // through. As of 2026-05-28 the FTS leg also honors bindingFileIds
  // (server.mjs:_ftsHybridFallback), so this should be a no-op — log if not.
  let scoped = rows;
  let defensiveDropped = 0;
  if (effBindingFileIds) {
    const before = rows.length;
    scoped = rows.filter((r) => effBindingFileIds.includes(String(r.file_id)));
    defensiveDropped = before - scoped.length;
    if (defensiveDropped > 0) {
      console.warn(`[agent-rag] defensive filter dropped=${defensiveDropped} of ${before} (binding leak — check FTS symmetry)`);
    }
  }
  if (Array.isArray(appliedEffectiveBrandsArg) && appliedEffectiveBrandsArg.length) {
    const before = scoped.length;
    const allowedBrands = new Set(appliedEffectiveBrandsArg.map((b) => String(b || "").toLowerCase().replace(/[_\-].*$/, "").trim()).filter(Boolean));
    scoped = scoped.filter((r) => allowedBrands.has(String(r.brand || "").toLowerCase().replace(/[_\-].*$/, "").trim()));
    const dropped = before - scoped.length;
    if (dropped > 0) {
      defensiveDropped += dropped;
      console.warn(`[agent-rag] defensive brand filter dropped=${dropped} of ${before} allowed=${JSON.stringify([...allowedBrands])}`);
    }
  }

  // Serialize rows to the legacy hit shape so config_center / child agents
  // see the same structure as before.
  const allHits = scoped.map((r) => ({
    collection_id: r.file_id || null,
    chunk_id: r.id,
    brand: r.brand || null,
    path: r.path || null,
    text: String(r.content || "").slice(0, 1200),
    score: typeof r.score === "number" ? Number(r.score.toFixed(4)) : null,
    ord: r.ord ?? null,
    page_start: r.page_start ?? null,
    page_end: r.page_end ?? null,
    access_level: r.access_level ?? null,
  }));


  // Budget: trim to operator-tuned payload size.
  const maxContextChars = Math.min(24000, Math.max(3000, Number(_ragSettings.agentRagContextChars) || DEFAULT_MAX_CONTEXT_CHARS));
  let total = 0;
  const trimmed = [];
  for (const h of allHits) {
    const piece = JSON.stringify(h);
    if (total + piece.length > maxContextChars) break;
    trimmed.push(h); total += piece.length;
  }

  const payload = JSON.stringify({ query, hits: trimmed, keywords: settings.keywords });
  const rerankInfo = result?.reranker || null;
  console.error(`[agent-rag] agent=${agentId} hits=${trimmed.length}/${allHits.length} chars=${payload.length} mode=${mode} bindings=${bindings.length} reranked=${rerankInfo?.used ? 1 : 0}${rerankInfo?.reason ? ` rerankReason=${rerankInfo.reason}` : ""}`);

  // 2026-06-05 — Inject telemetry: support_rows, inject_chars, top1, query
  // version hint, and versions observed in the chosen support. Lets us see
  // version selection (e.g. 7.6 vs 7.4) in one log line without grepping.
  try {
    const _vRe = /\b[Rr]?\d+\.\d+(?:\.\d+)?\b/g;
    const _qVerSet = new Set();
    let _vm;
    while ((_vm = _vRe.exec(String(query || ""))) !== null) _qVerSet.add(_vm[0].toLowerCase());
    const _queryVersionHint = Array.from(_qVerSet).join(",") || "-";
    const _supVerSet = new Set();
    for (const h of trimmed) {
      const hay = String(h.path || "").toLowerCase();
      let _sm;
      _vRe.lastIndex = 0;
      while ((_sm = _vRe.exec(hay)) !== null) _supVerSet.add(_sm[0].toLowerCase());
    }
    const _supVersions = Array.from(_supVerSet).slice(0, 10).join(",") || "-";
    const _top1Pct = typeof result?.top1 === "number" ? Math.round(result.top1 * 100) : "?";
    const _productHint = result?.libraryMatch || result?.explicitBrandLock || "-";
    console.error(`[AGENT-RAG/INJECT] agent=${agentId} product=${_productHint} support_rows=${trimmed.length} inject_chars=${payload.length} top1=${_top1Pct}% query_version_hint=${_queryVersionHint} versions_in_support=[${_supVersions}] reranked=${rerankInfo?.used ? 1 : 0}`);
  } catch (e) {
    console.warn("[AGENT-RAG/INJECT] telemetry failed (non-fatal):", e.message);
  }

  return {
    env: {
      ELARA_AGENT_RAG_ENABLED: "1",
      ELARA_AGENT_RAG_CONTEXT: payload,
      ELARA_AGENT_RAG_BUDGET_CHARS: String(maxContextChars),
      ..._agentFastEnv(_ragSettings, "rag"),
    },
    args: ["--rag-context", payload],
    meta: {
      enabled: true,
      mode,
      collections: bindings.map((b) => b.collection_id),
      bindingFileIds: bindingFileIds || [],
      keywords: settings.keywords,
      hits: trimmed.length,
      truncated: trimmed.length < allHits.length,
      decision: "inject",
      reason: result?.reason || null,
      top1: result?.top1 ?? null,
      tau: result?.tau ?? null,
      confidence: result?.confidence ?? null,
      queryRewritten: result?.queryRewritten || null,
      reranked: !!rerankInfo?.used,
      rerankInfo,
      fallback: null,
      defensiveDropped,
      diag,
      sources: trimmed.map((h, i) => ({
        index: i + 1,
        name: _basename(h.path),
        path: h.path || null,
        brand: h.brand || null,
        ord: h.ord ?? 0,
        page: h.page_start ?? null,
        pageEnd: h.page_end ?? null,
        accessLevel: h.access_level ?? null,
        score: typeof h.score === "number" ? Math.round(Math.min(1, h.score) * 100) : null,
      })),
    },
  };
}

