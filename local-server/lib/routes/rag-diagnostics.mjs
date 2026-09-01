// local-server/lib/routes/rag-diagnostics.mjs
// ----------------------------------------------------------------------------
// RAG diagnostics endpoints extracted from server.mjs (Tur A5, 2026-05-30).
//   POST/GET /api/rag/verify-source
//   GET       /api/rag/diagnose-html
//   GET       /api/rag/diagnose-corpus
//   GET/POST  /api/rag/diagnose-query
//
// Init pattern matches rag-readops: deps wired once via initRagDiagnostics({...}).
// resolveJoinExpr + verifySourceReachability are imported from rag-readops to
// avoid duplication.
// ----------------------------------------------------------------------------

import { resolveJoinExpr, verifySourceReachability } from "./rag-readops.mjs";

let _deps = null;
function deps() {
  if (!_deps) throw new Error("rag-diagnostics not initialized — call initRagDiagnostics({...}) before use");
  return _deps;
}
export function initRagDiagnostics(d) { _deps = d; }

// ─── diagnose-html ──────────────────────────────────────────────────────────
export async function diagnoseHtml({ brand = null } = {}) {
  const { pool } = deps();
  const brandFilter = brand ? `AND path ILIKE '%' || $1 || '%'` : "";
  const params = brand ? [brand] : [];

  const stats = (await pool.query(`
    SELECT COUNT(*)::int                                                              AS chunks,
           COUNT(DISTINCT path)::int                                                  AS files,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int                         AS with_embedding,
           ROUND(AVG(length(content)))::int                                           AS avg_len,
           MIN(length(content))::int                                                  AS min_len,
           MAX(length(content))::int                                                  AS max_len,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY length(content))::int          AS p50_len,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY length(content))::int          AS p90_len,
           COUNT(*) FILTER (WHERE content ILIKE '%<script%' OR content ILIKE '%<style%'
                              OR content ILIKE '%<nav%'    OR content ILIKE '%<!--%')::int AS boilerplate
      FROM knowledge_chunks
     WHERE path ILIKE '%.html' ${brandFilter}
  `, params)).rows[0] || {};

  const total = Number(stats.chunks || 0);
  const boilerplate_pct = total ? Math.round((Number(stats.boilerplate || 0) / total) * 1000) / 10 : 0;

  const citrixHtml = (await pool.query(`
    SELECT COUNT(*)::int AS chunks,
           COUNT(DISTINCT path)::int AS files,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_embedding
      FROM knowledge_chunks
     WHERE path ILIKE '%.html' AND (path ILIKE '%citrix%' OR path ILIKE '%netscaler%' OR path ILIKE '%nitro%')
  `)).rows[0] || {};

  const largest = (await pool.query(`
    SELECT path, ord, length(content) AS len, left(content, 200) AS preview
      FROM knowledge_chunks
     WHERE path ILIKE '%.html' ${brandFilter}
     ORDER BY length(content) DESC LIMIT 5
  `, params)).rows;

  const smallest = (await pool.query(`
    SELECT path, ord, length(content) AS len, left(content, 200) AS preview
      FROM knowledge_chunks
     WHERE path ILIKE '%.html' ${brandFilter} AND length(content) > 0
     ORDER BY length(content) ASC LIMIT 5
  `, params)).rows;

  const dirty = (await pool.query(`
    SELECT path, ord, length(content) AS len, left(content, 240) AS preview
      FROM knowledge_chunks
     WHERE path ILIKE '%.html' ${brandFilter}
       AND (content ILIKE '%<script%' OR content ILIKE '%<style%'
         OR content ILIKE '%<nav%'    OR content ILIKE '%<!--%')
     LIMIT 5
  `, params)).rows;

  let verdict = "ok";
  const notes = [];
  if (total === 0) verdict = "no_html";
  else {
    if (boilerplate_pct > 10) { verdict = "parser_dirty"; notes.push(`%${boilerplate_pct} chunk içinde HTML boilerplate kalmış — parser script/style strip etmiyor`); }
    if (Number(stats.min_len || 0) < 50) notes.push(`min_len=${stats.min_len} → bazı chunk'lar çok küçük, fragmentation var`);
    if (Number(stats.max_len || 0) > 12000) notes.push(`max_len=${stats.max_len} → bazı chunk'lar çok büyük, retrieval'da kötü match`);
    const embedPct = total ? Math.round((Number(stats.with_embedding || 0) / total) * 1000) / 10 : 0;
    if (embedPct < 95) { verdict = verdict === "ok" ? "embed_gap" : verdict; notes.push(`embed coverage %${embedPct} — eksik chunk'lar var`); }
  }

  return {
    ok: verdict === "ok",
    verdict, notes,
    brand_filter: brand,
    html_stats: {
      chunks: Number(stats.chunks || 0),
      files: Number(stats.files || 0),
      with_embedding: Number(stats.with_embedding || 0),
      embed_pct: total ? Math.round((Number(stats.with_embedding || 0) / total) * 1000) / 10 : 0,
      avg_len: Number(stats.avg_len || 0),
      min_len: Number(stats.min_len || 0),
      max_len: Number(stats.max_len || 0),
      p50_len: Number(stats.p50_len || 0),
      p90_len: Number(stats.p90_len || 0),
      boilerplate_rows: Number(stats.boilerplate || 0),
    },
    boilerplate_pct,
    citrix_html: {
      chunks: Number(citrixHtml.chunks || 0),
      files: Number(citrixHtml.files || 0),
      with_embedding: Number(citrixHtml.with_embedding || 0),
    },
    samples: { largest, smallest, with_boilerplate: dirty },
  };
}

// ─── diagnose-corpus ────────────────────────────────────────────────────────
export async function diagnoseCorpus() {
  const { pool, ROLE_RANK } = deps();
  const joinRes = await resolveJoinExpr();
  const expr = joinRes.expr;
  const correlated = (alias) => expr.replace(/\bk\./g, `${alias}.`);
  const client = await pool.connect();
  try {
    await client.query(`SET LOCAL statement_timeout = '15000ms'`).catch(() => {});
    const r = await client.query(`
      SELECT
        s.id::text                                                  AS source_id,
        s.name, s.url, s.title, s.parse_quality, s.created_at,
        COUNT(k.id)::int                                            AS chunks_total,
        COUNT(k.id) FILTER (WHERE k.embedding IS NOT NULL)::int     AS chunks_embedded,
        COUNT(k.id) FILTER (WHERE k.tsv IS NOT NULL)::int           AS chunks_tsv,
        COALESCE(ROUND(AVG(LENGTH(k.content))), 0)::int             AS avg_chars,
        COALESCE(MIN(LENGTH(k.content)), 0)::int                    AS min_chars,
        COALESCE(MAX(LENGTH(k.content)), 0)::int                    AS max_chars,
        (
          SELECT jsonb_object_agg(lvl, n) FROM (
            SELECT COALESCE(k2.access_level,'<null>') AS lvl, COUNT(*)::int AS n
              FROM knowledge_chunks k2
             WHERE ${correlated("k2")}
             GROUP BY 1
          ) t
        )                                                           AS access_levels,
        (
          SELECT jsonb_object_agg(brand, n) FROM (
            SELECT COALESCE(k3.brand,'<null>') AS brand, COUNT(*)::int AS n
              FROM knowledge_chunks k3
             WHERE ${correlated("k3")}
             GROUP BY 1
             ORDER BY 2 DESC LIMIT 10
          ) t
        )                                                           AS brand_histogram
        FROM knowledge_sources s
        LEFT JOIN knowledge_chunks k ON ${expr}
       GROUP BY s.id
       ORDER BY chunks_total DESC NULLS LAST
       LIMIT 200`).catch((e) => ({ rows: [], _err: String(e?.message || e) }));

    const totals = (await client.query(`
      SELECT
        (SELECT COUNT(*) FROM knowledge_sources)::int                                              AS sources,
        (SELECT COUNT(*) FROM knowledge_sources WHERE parent_id IS NULL)::int                       AS parent,
        (SELECT COUNT(*) FROM knowledge_sources WHERE parent_id IS NOT NULL)::int                   AS child,
        (SELECT COUNT(*) FROM knowledge_chunks)::int                                                AS chunks,
        (SELECT COUNT(*) FROM knowledge_chunks WHERE embedding IS NOT NULL)::int                    AS embedded,
        (SELECT COUNT(*) FROM knowledge_chunks WHERE tsv IS NOT NULL)::int                          AS tsv
    `)).rows[0] || {};

    const accessGlobal = (await client.query(`
      SELECT COALESCE(access_level,'<null>') AS lvl, COUNT(*)::int AS n
        FROM knowledge_chunks
        GROUP BY 1 ORDER BY 2 DESC
    `).catch(() => ({ rows: [] }))).rows;

    const brandCov = (await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE brand IS NOT NULL AND brand <> '')::int AS with_brand,
        COUNT(*)::int                                                    AS total
        FROM knowledge_chunks
    `)).rows[0] || { with_brand: 0, total: 0 };
    const brandCovPct = brandCov.total ? Math.round(1000 * brandCov.with_brand / brandCov.total) / 10 : 0;

    const parseQ = (await client.query(`
      SELECT COALESCE(parse_quality,'<null>') AS q, COUNT(*)::int AS n
        FROM knowledge_sources
        GROUP BY 1 ORDER BY 2 DESC
    `).catch(() => ({ rows: [] }))).rows;

    const orphans = (await client.query(`
      SELECT COUNT(*)::int AS n FROM knowledge_chunks k
       WHERE NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE ${expr})
    `).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n || 0;

    const vendorsRows = await client.query(`
      SELECT lower(brand) AS brand
        FROM knowledge_chunks
       WHERE brand IS NOT NULL AND brand <> '' AND brand NOT LIKE '\\_%' ESCAPE '\\'
       GROUP BY 1
       ORDER BY COUNT(*) DESC
       LIMIT 20`).catch(() => ({ rows: [] }));
    const vendors = vendorsRows.rows.map(r => r.brand).filter(Boolean);
    const vendorSummary = {};
    for (const v of vendors) {
      const like = `%${v.replace(/\s+/g, "%")}%`;
      const vr = await client.query(
        `SELECT COUNT(*)::int AS n,
                MIN(path)     AS sample_path,
                COUNT(DISTINCT brand)::int AS distinct_brands
           FROM knowledge_chunks
          WHERE path ILIKE $1 OR brand ILIKE $1`, [like]
      ).catch(() => ({ rows: [{ n: 0, sample_path: null, distinct_brands: 0 }] }));
      vendorSummary[v] = {
        chunks: Number(vr.rows[0]?.n || 0),
        sample_path: vr.rows[0]?.sample_path || null,
        distinct_brands: Number(vr.rows[0]?.distinct_brands || 0),
      };
    }

    return {
      ok: true,
      totals: {
        sources: Number(totals.sources || 0),
        parent: Number(totals.parent || 0),
        child: Number(totals.child || 0),
        chunks: Number(totals.chunks || 0),
        embedded: Number(totals.embedded || 0),
        tsv: Number(totals.tsv || 0),
      },
      join: {
        expression: expr, hypothesis: joinRes.name,
        is_fallback: !!joinRes.fallback,
        matched_chunks_global: joinRes.matched_chunks,
        matched_sources_global: joinRes.matched_sources,
      },
      access_levels_global: accessGlobal,
      brand_coverage_pct: brandCovPct,
      parse_quality_distribution: parseQ,
      source_chunk_link_orphans: Number(orphans),
      role_rank_keys: Object.keys(ROLE_RANK),
      vendor_summary: vendorSummary,
      sources: r.rows,
      err: r._err || null,
    };
  } finally {
    client.release();
  }
}

// ─── diagnose-query ─────────────────────────────────────────────────────────
export async function diagnoseQuery(q) {
  const {
    pool, ROLE_RANK, getRagSettings,
    _extractQueryTerms, _buildFtsOrQuery, _ftsHybridFallback, _rrfFuse,
    mlxEmbed, mlxRerank, getLastRerankError,
  } = deps();
  const term = String(q || "").trim();
  if (!term) return { ok: false, error: "missing q" };
  const RAG_SETTINGS = getRagSettings();
  const safeLevels = Object.keys(ROLE_RANK);
  const qTerms = _extractQueryTerms(term);
  const tsquery = _buildFtsOrQuery(term);

  const joinRes = await resolveJoinExpr();

  const lookupByChunkId = async (chunkIds) => {
    const ids = [...new Set(chunkIds.filter(v => v !== undefined && v !== null))].map(String);
    if (!ids.length) return new Map();
    const r = await pool.query(
      `SELECT k.id::text AS chunk_id,
              s.id::text AS source_id, s.name, s.url, s.title
         FROM knowledge_chunks k
         LEFT JOIN knowledge_sources s ON ${joinRes.expr}
        WHERE k.id::text = ANY($1::text[])`, [ids]
    ).catch(() => ({ rows: [] }));
    const m = new Map();
    for (const row of r.rows) m.set(row.chunk_id, row);
    return m;
  };

  const labelFromPath = (p) => {
    if (!p) return null;
    const tail = String(p).split("/").filter(Boolean).slice(-2).join("/");
    return tail || null;
  };

  const decorate = async (rows) => {
    const map = await lookupByChunkId(rows.map(r => r.id));
    return rows.map(r => {
      const s = map.get(String(r.id));
      const name = s?.name || s?.title || s?.url || labelFromPath(r.path) || "<unknown>";
      return {
        chunk_id: r.id != null ? String(r.id) : null,
        source_id: s?.source_id || null,
        source_name: name,
        path: r.path, brand: r.brand, access_level: r.access_level,
        ord: r.ord, score: Number(r.score || 0),
        content_preview: String(r.content || "").slice(0, 180).replace(/\s+/g, " "),
      };
    });
  };

  const attributionOf = (rows) => {
    const m = {};
    for (const r of rows) {
      const k = r.source_name || "<unknown>";
      m[k] = (m[k] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
  };

  let ftsRows = [];
  let ftsErr = null;
  try {
    const fts = await _ftsHybridFallback({ q: term, safeLevels, tau: 0 });
    ftsRows = fts.rows || [];
  } catch (e) { ftsErr = String(e?.message || e); }
  const ftsChunkRows = ftsRows.filter(r => r.retriever === "fts-chunk");
  const ftsSourceRows = ftsRows.filter(r => r.retriever === "fts-source");

  let vectorRows = [];
  let vectorErr = null;
  let top1Vec = 0;
  try {
    const arr = await mlxEmbed([term], { timeoutMs: 8000 }).catch(() => null);
    if (arr && arr[0] && arr[0].length) {
      const qStr = `[${arr[0].join(",")}]`;
      const client = await pool.connect();
      try {
        await client.query(`SET LOCAL hnsw.ef_search = 200`).catch(() => {});
        await client.query(`SET LOCAL statement_timeout = '3500ms'`).catch(() => {});
        const _minChunkChars = Math.max(0, Number(RAG_SETTINGS.minChunkChars ?? 0));
        const r = await client.query(
          `SELECT id, file_id, path, ord, brand, access_level, content,
                  1 - (embedding <=> $1::vector) AS score
             FROM knowledge_chunks
            WHERE embedding IS NOT NULL AND access_level = ANY($2::text[])
              AND ($3::int = 0 OR length(content) >= $3::int)
            ORDER BY embedding <=> $1::vector
            LIMIT 20`, [qStr, safeLevels, _minChunkChars]);
        vectorRows = r.rows;
        top1Vec = Number(r.rows[0]?.score || 0);
      } finally { client.release(); }
    } else {
      vectorErr = "embed_miss";
    }
  } catch (e) { vectorErr = String(e?.message || e); }

  const fusedAll = _rrfFuse([
    { name: "vector", rows: vectorRows },
    { name: "fts",    rows: ftsRows },
  ], { k: 60, query: term });
  const fused = fusedAll.slice(0, 20);

  let reranked = null;
  let rerankErr = null;
  let rerankMs = null;
  if (RAG_SETTINGS.rerankEnabled && fused.length > 1) {
    try {
      const topN = Math.min(RAG_SETTINGS.rerankTopN || 12, fused.length);
      const cand = fused.slice(0, topN);
      const docs = cand.map(r => String(r.content || "").slice(0, 2000));
      const t0 = Date.now();
      const rr = await mlxRerank(term, docs, { topN, timeoutMs: RAG_SETTINGS.rerankTimeoutMs || 2500 });
      rerankMs = Date.now() - t0;
      if (Array.isArray(rr) && rr.length) {
        const scored = rr.map(x => ({
          ...cand[x.index],
          rerank_score: Number(x.score || 0),
        })).sort((a, b) => b.rerank_score - a.rerank_score);
        reranked = scored.slice(0, 10);
      } else {
        rerankErr = getLastRerankError?.() || "no_results";
      }
    } catch (e) { rerankErr = String(e?.message || e); }
  }

  const [ftsChunkTop, ftsSourceTop, vectorTop, fusedTop, rerankedTop] = await Promise.all([
    decorate(ftsChunkRows.slice(0, 20)),
    decorate(ftsSourceRows.slice(0, 20)),
    decorate(vectorRows.slice(0, 20)),
    decorate(fused),
    reranked ? decorate(reranked) : Promise.resolve([]),
  ]);

  const fusedTopWithScores = fusedTop.map((r, i) => ({
    ...r,
    rrf: Number(fused[i]?.rrf || 0),
    coverage: Number(fused[i]?.coverage || 0),
    vendor_boost: Number(fused[i]?.vendor_boost || 1),
    final: Number(fused[i]?.fused || 0),
  }));
  const rerankedTopWithScores = rerankedTop.map((r, i) => ({
    ...r,
    rerank_score: Number(reranked?.[i]?.rerank_score || 0),
  }));

  let diagnosis = "ok", hint = "Tüm leg'ler bekleneni veriyor.";
  const ftsTopSrc = ftsChunkTop[0]?.source_name;
  const vecTopSrc = vectorTop[0]?.source_name;
  const fusedTopSrc = fusedTop[0]?.source_name;
  const targetBrand = qTerms.find(t => t.length >= 4);
  const vecBrandHits = vectorTop.slice(0, 10).filter(r =>
    targetBrand && (
      (r.brand || "").toLowerCase().includes(targetBrand) ||
      (r.path || "").toLowerCase().includes(targetBrand) ||
      (r.source_name || "").toLowerCase().includes(targetBrand)
    )).length;

  if (!ftsChunkTop.length && !vectorTop.length) {
    diagnosis = "no_results";
    hint = "Hiçbir leg sonuç vermedi. tsquery / embed / level filtrelerini kontrol et.";
  } else if (ftsTopSrc && vecTopSrc && ftsTopSrc !== vecTopSrc && vecBrandHits < 2) {
    diagnosis = "vector_leg_dominated_by_long_corpus";
    hint = `FTS top → "${ftsTopSrc}", Vector top → "${vecTopSrc}" ve vektör ilk 10'da hedef brand'ten ${vecBrandHits} satır. Per-source quota veya zorunlu rerank gerek.`;
  } else if (reranked && rerankedTopWithScores[0]?.source_name && fusedTopSrc && rerankedTopWithScores[0].source_name !== fusedTopSrc) {
    diagnosis = "rerank_overrides_fusion";
    hint = "Reranker fusion'ı düzeltiyor — sağlıklı, ama fusion'da brand bias eklemek istenebilir.";
  }

  return {
    ok: true,
    query: term, qTerms, tsquery,
    runtime: {
      safeLevels, roleRankKeys: Object.keys(ROLE_RANK),
      rerankEnabled: !!RAG_SETTINGS.rerankEnabled,
      joinExpression: joinRes.expr, joinHypothesis: joinRes.name,
      joinIsFallback: !!joinRes.fallback,
    },
    legs: {
      fts_chunk:  { rows: ftsChunkRows.length, top: ftsChunkTop, err: ftsErr },
      fts_source: { rows: ftsSourceRows.length, top: ftsSourceTop },
      vector:     { rows: vectorRows.length, top1: top1Vec, top: vectorTop, err: vectorErr },
      fused:      { rows: fused.length, top: fusedTopWithScores },
      reranked:   { rows: reranked?.length || 0, ms: rerankMs, top: rerankedTopWithScores, err: rerankErr },
    },
    attribution: {
      fts_chunk:  attributionOf(ftsChunkTop),
      fts_source: attributionOf(ftsSourceTop),
      vector:     attributionOf(vectorTop),
      fused:      attributionOf(fusedTop),
      reranked:   attributionOf(rerankedTopWithScores),
    },
    diagnosis, hint,
  };
}

// ─── route mount ────────────────────────────────────────────────────────────
export function mountRagDiagnosticsRoutes({ app }) {
  app.post("/api/rag/verify-source", async (req, res) => {
    try {
      const needle = String(req.body?.needle || req.body?.name || req.body?.brand || req.query?.needle || "").trim();
      if (!needle) return res.status(400).json({ ok: false, error: "missing needle" });
      res.json(await verifySourceReachability(needle));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  app.get("/api/rag/verify-source", async (req, res) => {
    try {
      const needle = String(req.query?.needle || "").trim();
      if (!needle) return res.status(400).json({ ok: false, error: "missing needle" });
      res.json(await verifySourceReachability(needle));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/rag/diagnose-html", async (req, res) => {
    try {
      const brand = req.query?.brand ? String(req.query.brand).trim() : null;
      res.json(await diagnoseHtml({ brand }));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/api/rag/diagnose-corpus", async (_req, res) => {
    try { res.json(await diagnoseCorpus()); }
    catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  app.get("/api/rag/diagnose-query", async (req, res) => {
    try {
      const q = String(req.query?.q || "").trim();
      if (!q) return res.status(400).json({ ok: false, error: "missing q" });
      res.json(await diagnoseQuery(q));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  app.post("/api/rag/diagnose-query", async (req, res) => {
    try {
      const q = String(req.body?.q || req.body?.query || req.query?.q || "").trim();
      if (!q) return res.status(400).json({ ok: false, error: "missing q" });
      res.json(await diagnoseQuery(q));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
