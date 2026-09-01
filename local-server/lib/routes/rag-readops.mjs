// =============================================================================
// RAG READ-OPS — health · status · debug · probe · self-audit · diagnose-join
// · verify-source (helper used by A5)
// Extracted from server.mjs 2026-05-30 (pre-SHA 88162b40f4cb, Tur A2+A3+A4).
//
// Init pattern: deps are wired ONCE at boot via initRagReadOps({...}).
// Endpoint handlers + exported helpers (verifySourceReachability,
// resolveJoinExpr) read deps via the module-level _deps ref, so order of
// import/definition in server.mjs doesn't matter at module-eval time.
// =============================================================================

let _deps = null;
function D() {
  if (!_deps) throw new Error("rag-readops not initialized — call initRagReadOps({...}) before use");
  return _deps;
}

export function initRagReadOps(deps) { _deps = deps; }

// ---------------------------------------------------------------------------
// JOIN RESOLVER — discovers chunk↔source link at runtime, 5min cache.
// ---------------------------------------------------------------------------
let _joinExprCache = null;

async function _listColumns(table) {
  const { pool } = D();
  const r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`, [table]
  ).catch(() => ({ rows: [] }));
  return r.rows;
}

async function probeJoinHypotheses() {
  const { pool } = D();
  const [chunkCols, srcCols] = await Promise.all([
    _listColumns("knowledge_chunks"),
    _listColumns("knowledge_sources"),
  ]);
  const C = new Set(chunkCols.map(c => c.column_name));
  const S = new Set(srcCols.map(c => c.column_name));

  const hyps = [];
  const add = (name, expr, needC = [], needS = []) => {
    if (needC.every(c => C.has(c)) && needS.every(c => S.has(c))) hyps.push({ name, expr });
  };
  add("A: k.source_id = s.id::text", "k.source_id = s.id::text", ["source_id"], ["id"]);
  add("B: k.file_id = s.id::text",   "k.file_id = s.id::text",   ["file_id"], ["id"]);
  add("C: k.file_id = s.file_id",    "k.file_id = s.file_id",    ["file_id"], ["file_id"]);
  add("D: k.path = s.path",          "k.path = s.path",          ["path"],    ["path"]);
  add("E: k.path = s.source_path",   "k.path = s.source_path",   ["path"],    ["source_path"]);
  add("F: basename(k.path) = s.name","regexp_replace(k.path,'^.*/','') = s.name", ["path"], ["name"]);
  add("G: k.path ILIKE '%' || s.url tail || '%'",
      "k.path ILIKE '%' || regexp_replace(COALESCE(s.url,''),'^https?://','') || '%' AND COALESCE(s.url,'') <> ''",
      ["path"], ["url"]);
  add("H: k.path = s.file_path",     "k.path = s.file_path",     ["path"], ["file_path"]);
  add("I: k.path ILIKE '%/' || s.name",
      "s.name <> '' AND k.path ILIKE '%/' || s.name",            ["path"], ["name"]);
  add("J: k.path ILIKE '%' || s.name || '%'",
      "s.name <> '' AND length(s.name) >= 4 AND k.path ILIKE '%' || s.name || '%'",
      ["path"], ["name"]);
  add("K: k.file_id = s.checksum",   "k.file_id = s.checksum",   ["file_id"], ["checksum"]);
  add("L: k.file_id = s.sha256",     "k.file_id = s.sha256",     ["file_id"], ["sha256"]);

  const client = await pool.connect();
  const results = [];
  try {
    await client.query(`SET LOCAL statement_timeout = '8000ms'`).catch(() => {});
    for (const h of hyps) {
      try {
        const r = await client.query(`
          SELECT COUNT(DISTINCT k.id)::int AS matched_chunks,
                 COUNT(DISTINCT s.id)::int AS matched_sources
            FROM knowledge_chunks k JOIN knowledge_sources s ON ${h.expr}
        `);
        const sample = await client.query(`
          SELECT s.id::text AS source_id, s.name, k.file_id, k.path
            FROM knowledge_chunks k JOIN knowledge_sources s ON ${h.expr}
            LIMIT 3
        `).catch(() => ({ rows: [] }));
        results.push({
          ...h,
          matched_chunks: Number(r.rows[0]?.matched_chunks || 0),
          matched_sources: Number(r.rows[0]?.matched_sources || 0),
          sample: sample.rows,
        });
      } catch (e) {
        results.push({ ...h, error: String(e?.message || e).slice(0, 240), matched_chunks: 0, matched_sources: 0 });
      }
    }
  } finally { client.release(); }

  results.sort((a, b) => (b.matched_chunks || 0) - (a.matched_chunks || 0));
  const winner = results.find(r => (r.matched_chunks || 0) > 0) || null;
  return { chunk_columns: chunkCols, source_columns: srcCols, hypotheses: results, winner };
}

export async function resolveJoinExpr({ force = false } = {}) {
  if (!force && _joinExprCache && (Date.now() - _joinExprCache.at) < 5 * 60_000) return _joinExprCache;
  const probe = await probeJoinHypotheses();
  if (probe.winner) {
    _joinExprCache = { expr: probe.winner.expr, name: probe.winner.name,
      matched_chunks: probe.winner.matched_chunks, matched_sources: probe.winner.matched_sources,
      at: Date.now(), fallback: false };
  } else {
    _joinExprCache = { expr: "k.file_id = s.id::text", name: "fallback (no winner)",
      matched_chunks: 0, matched_sources: 0, at: Date.now(), fallback: true };
  }
  return _joinExprCache;
}

// ---------------------------------------------------------------------------
// verifySourceReachability — exported (used by A5 verify-source endpoints)
// ---------------------------------------------------------------------------
export async function verifySourceReachability(needle) {
  const {
    pool, ROLE_RANK, _ftsHybridFallback, _buildFtsOrQuery,
    getLastFtsChunkError, getLastFtsSourceError,
  } = D();
  const term = String(needle || "").trim().toLowerCase();
  if (!term) return { ok: false, needle: term, diagnosis: "no_needle", hint: "needle is empty" };
  const like = `%${term}%`;
  const tsTerm = term.replace(/[^a-z0-9_]/g, "");
  const tsQ = tsTerm ? `${tsTerm}:*` : null;

  const srcRow = (await pool.query(
    `SELECT COUNT(*)::int                                          AS total,
            COUNT(*) FILTER (WHERE parent_id IS NULL)::int         AS parents,
            COUNT(*) FILTER (WHERE parent_id IS NOT NULL)::int     AS children,
            MAX(created_at)                                        AS last_at
       FROM knowledge_sources
      WHERE name ILIKE $1 OR url ILIKE $1 OR title ILIKE $1 OR id::text ILIKE $1`, [like])).rows[0] || {};

  const chunkRow = (await pool.query(
    `SELECT COUNT(*)::int                                                   AS total,
            COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int              AS with_embedding,
            ROUND(AVG(LENGTH(content)))::int                                AS avg_chars
       FROM knowledge_chunks
      WHERE path ILIKE $1 OR brand ILIKE $1 OR file_id ILIKE $1`, [like])).rows[0] || {};

  const safeLevels = Object.keys(ROLE_RANK);

  let tsvHit = 0;
  let accessLevelHistogram = [];
  let brandHistogram = [];
  if (tsQ) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM knowledge_chunks
        WHERE (path ILIKE $1 OR brand ILIKE $1 OR file_id ILIKE $1)
          AND tsv @@ to_tsquery('simple', $2)`, [like, tsQ]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    tsvHit = Number(r.rows[0]?.n || 0);

    const lvl = await pool.query(
      `SELECT COALESCE(access_level, '<null>') AS lvl, COUNT(*)::int AS n
         FROM knowledge_chunks
        WHERE (path ILIKE $1 OR brand ILIKE $1 OR file_id ILIKE $1)
          AND tsv @@ to_tsquery('simple', $2)
        GROUP BY 1 ORDER BY 2 DESC`, [like, tsQ]
    ).catch(() => ({ rows: [] }));
    accessLevelHistogram = lvl.rows;

    const br = await pool.query(
      `SELECT COALESCE(brand, '<null>') AS brand, COUNT(*)::int AS n
         FROM knowledge_chunks
        WHERE (path ILIKE $1 OR brand ILIKE $1 OR file_id ILIKE $1)
          AND tsv @@ to_tsquery('simple', $2)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, [like, tsQ]
    ).catch(() => ({ rows: [] }));
    brandHistogram = br.rows;
  }

  let ftsChunkRows = 0, ftsSourceRows = 0, sample = [], ftsException = null;
  try {
    const fts = await _ftsHybridFallback({ q: term, safeLevels, tau: 0 });
    const rows = fts.rows || [];
    ftsChunkRows = rows.filter(r => r.retriever === "fts-chunk").length;
    ftsSourceRows = rows.filter(r => r.retriever === "fts-source").length;
    sample = rows.slice(0, 3).map(r => ({ path: r.path, ord: r.ord, score: Number(r.score || 0), retriever: r.retriever }));
  } catch (e) {
    ftsException = String(e?.message || e).slice(0, 300);
  }

  let bypassChunkRows = 0, bypassChunkSample = [];
  if (tsQ) {
    const bp = await pool.query(
      `SELECT c.id, c.file_id, c.path, c.brand, c.access_level, c.ord,
              ts_rank_cd(c.tsv, to_tsquery('simple', $1)) AS score
         FROM knowledge_chunks c
        WHERE c.tsv @@ to_tsquery('simple', $1)
        ORDER BY score DESC LIMIT 5`, [tsQ]
    ).catch(() => ({ rows: [] }));
    bypassChunkRows = bp.rows.length;
    bypassChunkSample = bp.rows.map(r => ({
      id: r.id, file_id: r.file_id, path: r.path, brand: r.brand,
      access_level: r.access_level, ord: r.ord, score: Number(r.score || 0),
    }));
  }

  const joinRes = await resolveJoinExpr();
  const join = await pool.query(
    `SELECT s.id::text AS source_id, s.name,
            COUNT(k.id)::int AS chunks_joined,
            COUNT(k.id) FILTER (WHERE k.access_level = ANY($2::text[]))::int AS chunks_in_levels
       FROM knowledge_sources s
       LEFT JOIN knowledge_chunks k ON ${joinRes.expr}
      WHERE s.name ILIKE $1 OR COALESCE(s.url,'') ILIKE $1 OR COALESCE(s.title,'') ILIKE $1
      GROUP BY s.id, s.name
      ORDER BY chunks_joined DESC NULLS LAST
      LIMIT 5`, [like, safeLevels]
  ).catch((e) => ({ rows: [], _err: String(e?.message || e) }));

  const linkedHits = await pool.query(
    `SELECT COUNT(*)::int AS joined,
            COUNT(*) FILTER (WHERE s.id IS NULL)::int AS orphan
       FROM knowledge_chunks k
       LEFT JOIN knowledge_sources s ON ${joinRes.expr}
      WHERE k.path ILIKE $1 OR k.brand ILIKE $1 OR k.file_id ILIKE $1`, [like]
  ).catch(() => ({ rows: [{ joined: 0, orphan: 0 }] }));

  const pathMatch = await pool.query(
    `SELECT COUNT(*)::int AS n,
            COUNT(DISTINCT path)::int AS files
       FROM knowledge_chunks
      WHERE path ILIKE $1 OR brand ILIKE $1 OR file_id ILIKE $1`, [like]
  ).catch(() => ({ rows: [{ n: 0, files: 0 }] }));
  const pathSample = await pool.query(
    `SELECT DISTINCT path FROM knowledge_chunks
      WHERE path ILIKE $1 OR brand ILIKE $1 OR file_id ILIKE $1
      LIMIT 5`, [like]
  ).catch(() => ({ rows: [] }));

  const sources = {
    total: Number(srcRow.total || 0),
    parents: Number(srcRow.parents || 0),
    children: Number(srcRow.children || 0),
    lastIngestedAt: srcRow.last_at || null,
  };
  const chunks = {
    total: Number(chunkRow.total || 0),
    withEmbedding: Number(chunkRow.with_embedding || 0),
    withTsvHit: tsvHit,
    avgChars: Number(chunkRow.avg_chars || 0),
    accessLevels: accessLevelHistogram,
    brandHistogram,
    joinedRows: Number(linkedHits.rows[0]?.joined || 0),
    orphanRows: Number(linkedHits.rows[0]?.orphan || 0),
  };
  const chunk_matches = {
    count: Number(pathMatch.rows[0]?.n || 0),
    distinct_files: Number(pathMatch.rows[0]?.files || 0),
    sample_paths: pathSample.rows.map(r => r.path),
  };
  const fts = {
    chunkRows: ftsChunkRows,
    sourceRows: ftsSourceRows,
    sample,
    chunkErr: getLastFtsChunkError(),
    sourceErr: getLastFtsSourceError(),
    exception: ftsException,
  };
  const debug = {
    bypassChunkRows,
    bypassChunkSample,
    joinSample: join.rows,
    joinSampleErr: join._err || null,
    runtime: {
      safeLevels,
      tsQuery: _buildFtsOrQuery(term),
      roleRankKeys: Object.keys(ROLE_RANK),
      joinExpression: joinRes.expr,
      joinHypothesis: joinRes.name,
      joinIsFallback: !!joinRes.fallback,
      joinMatchedChunksGlobal: joinRes.matched_chunks,
    },
  };

  let diagnosis, hint;
  const safeLvlSet = new Set(safeLevels);
  const accessMismatch = accessLevelHistogram.length > 0 &&
    !accessLevelHistogram.some(r => safeLvlSet.has(r.lvl));
  if (sources.total === 0 && chunks.total === 0) {
    diagnosis = "no_source";
    hint = `No source matches '${term}'. Re-run ingest (URL fetch or file upload).`;
  } else if (chunks.total === 0) {
    diagnosis = "metadata_only";
    hint = "Source row exists but produced 0 chunks. Re-ingest with deep/recursive crawl or check parser.";
  } else if (chunks.withEmbedding === 0) {
    diagnosis = "no_embeddings";
    hint = "Chunks exist but none are embedded. Call POST /api/rag/retry-embeddings.";
  } else if (tsvHit === 0) {
    diagnosis = "tokens_stripped";
    hint = `Chunks exist but none contain the token '${term}'. Parser/strip step removed the brand body — re-fetch URL with deep scan or switch parser.`;
  } else if (accessMismatch) {
    diagnosis = "access_level_mismatch";
    hint = `Chunks tsv'de var ama access_level değerleri (${
      accessLevelHistogram.map(r => `${r.lvl}=${r.n}`).join(", ")
    }) safeLevels (${safeLevels.join(",")}) listesinin dışında. ROLE_RANK normalizasyonu ya da ingest yazımı problemli.`;
  } else if (ftsChunkRows === 0 && ftsSourceRows === 0 && bypassChunkRows === 0) {
    diagnosis = "fts_path_broken";
    hint = "Token chunks'ta var (tsvHit > 0) ama filtre-bypass sorgusu da 0 — index ya da tsquery hatası. fts.chunkErr / fts.sourceErr / fts.exception alanlarına bakın.";
  } else if (ftsChunkRows === 0 && ftsSourceRows === 0) {
    diagnosis = "fts_filter_dropped_all";
    hint = `Bypass ${bypassChunkRows} satır verdi ama filtreli sorgu 0 — access_level veya superseded_by filtresi tüm satırları eledi. debug.bypassChunkSample.access_level'i karşılaştır.`;
  } else {
    diagnosis = "ok";
    hint = "Source is reachable end-to-end.";
  }

  return {
    ok: diagnosis === "ok",
    needle: term,
    metadataPresent: sources.total > 0 || chunks.total > 0,
    contentIndexed: diagnosis === "ok",
    sources, chunks, chunk_matches, fts, debug,
    diagnosis, hint,
  };
}

// ---------------------------------------------------------------------------
// getRagHealth — operator panel + boot diagnostics
// ---------------------------------------------------------------------------
export async function getRagHealth() {
  const {
    pool, env, getRagSettings,
    getLastEmbedError, getLastFtsError, getLastRerankError,
    getLastRerankMs, getLastRerankAt, getWorkerStatus,
  } = D();
  const RAG_SETTINGS = getRagSettings();
  const out = { ok: true, ts: Date.now() };
  try {
    const a = await pool.query(`
      SELECT
        COUNT(*)::int AS chunks,
        COUNT(*) FILTER (WHERE tsv IS NULL)::int AS chunks_tsv_null,
        COUNT(*) FILTER (WHERE embedding IS NULL)::int AS embedding_missing,
        COUNT(*) FILTER (WHERE COALESCE(embedding_status,'pending')='pending')::int AS embedding_pending,
        COUNT(*) FILTER (WHERE embedding_status='in_progress')::int AS embedding_in_progress,
        COUNT(*) FILTER (WHERE embedding_status='stale')::int AS embedding_stale,
        COUNT(*) FILTER (WHERE embedding_status='error')::int AS embedding_error,
        COUNT(*) FILTER (WHERE embedding_status='ok' AND embedding IS NOT NULL)::int AS embedding_ok
      FROM knowledge_chunks
    `);
    const errs = await pool.query(`
      SELECT id, embedding_last_error AS last_error
        FROM knowledge_chunks
       WHERE embedding_status='error' AND embedding_last_error IS NOT NULL
       ORDER BY id DESC LIMIT 10
    `).catch(() => ({ rows: [] }));
    const b = await pool.query(`
      SELECT
        COUNT(*)::int AS sources,
        COUNT(*) FILTER (WHERE parse_quality='ok')::int AS sources_ok,
        COUNT(*) FILTER (WHERE parse_quality='thin')::int AS sources_thin,
        COUNT(*) FILTER (WHERE parse_quality='low')::int AS sources_low,
        COUNT(*) FILTER (WHERE parse_quality IS NULL)::int AS sources_unknown
      FROM knowledge_sources
      WHERE COALESCE(superseded_by,'')=''
    `).catch(() => ({ rows: [{}] }));
    out.chunks = a.rows[0];
    out.sources = b.rows[0];
    out.recentEmbedErrors = errs.rows || [];
    out.settings = { ...RAG_SETTINGS };
    out.embedModel = env.MLX_EMBED_MODEL || null;
    out.warnings = [];
    if (out.chunks.chunks_tsv_null > 0)
      out.warnings.push(`${out.chunks.chunks_tsv_null} chunks have NULL FTS index. Run /api/rag/self-audit; tsv should be a generated DB column.`);
    if (out.chunks.embedding_missing > 0)
      out.warnings.push(`${out.chunks.embedding_missing} chunks have no embedding. WebUI -> Retry Embeddings.`);
    if (out.chunks.embedding_error > 0)
      out.warnings.push(`${out.chunks.embedding_error} chunks are in embedding 'error' state. Check the local embedding worker / MLX.`);
    if ((out.sources?.sources_low || 0) > 0)
      out.warnings.push(`${out.sources.sources_low} sources flagged low-quality. Inspect them via the audit script.`);
    try {
      const lastErr = getLastEmbedError();
      if (lastErr) {
        out.warnings.push(`Embedding worker last error: ${lastErr.kind} - ${lastErr.detail}`);
        out.lastEmbedError = lastErr;
      }
    } catch { /* ignore */ }
    out.workerStatus = getWorkerStatus();
    try {
      const lastF = getLastFtsError();
      if (lastF) { out.lastFtsError = lastF; out.warnings.push(`FTS last error: ${lastF.kind} - ${lastF.detail}`); }
      const lastR = getLastRerankError();
      if (lastR) { out.lastRerankError = lastR; out.warnings.push(`Reranker last error: ${lastR.kind} - ${lastR.detail}`); }
      out.reranker = {
        enabled: !!RAG_SETTINGS.rerankEnabled,
        model: env.RAG_RERANK_MODEL || "BAAI/bge-reranker-base",
        topN: RAG_SETTINGS.rerankTopN,
        timeoutMs: RAG_SETTINGS.rerankTimeoutMs,
        weight: RAG_SETTINGS.rerankWeight,
        lastMs: getLastRerankMs(),
        lastAt: getLastRerankAt(),
      };
    } catch { /* ignore */ }
  } catch (e) {
    out.ok = false; out.error = String(e?.message || e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ragSelfAudit — vendor canary + index sentinel
// ---------------------------------------------------------------------------
export async function ragSelfAudit() {
  const { pool, env } = D();
  const checks = [];
  const add = (name, ok, info = "") => checks.push({ name, ok: !!ok, info: String(info || "") });
  const scalar = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || {};
  try {
    const gen = await scalar(`
      SELECT COALESCE(MAX((a.attgenerated = 's')::int), 0)::int AS ok
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relname='knowledge_chunks' AND a.attname='tsv' AND NOT a.attisdropped`);
    add("chunks_tsv_generated", Number(gen.ok) === 1, Number(gen.ok) === 1 ? "tsv is generated" : "tsv is not generated");

    const cov = await scalar(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE tsv IS NOT NULL)::int AS has_tsv,
             ROUND(100.0 * COUNT(*) FILTER (WHERE tsv IS NOT NULL) / NULLIF(COUNT(*),0), 2) AS pct
        FROM knowledge_chunks`);
    const pct = Number(cov.pct || (Number(cov.total || 0) === 0 ? 100 : 0));
    add("chunks_tsv_coverage", pct >= 99, `tsv populated: ${pct}% (${cov.has_tsv || 0}/${cov.total || 0})`);

    const gin = await scalar(`
      SELECT COUNT(*)::int AS n FROM pg_indexes
       WHERE schemaname='public' AND tablename='knowledge_chunks'
         AND indexdef ILIKE '%USING gin%' AND indexdef ILIKE '%tsv%'`);
    add("chunks_tsv_gin_index", Number(gin.n || 0) > 0, `GIN indexes on tsv: ${gin.n || 0}`);

    const fts = await scalar(`
      SELECT EXISTS (
        SELECT 1 FROM knowledge_chunks
         WHERE tsv @@ to_tsquery('simple', 'api:* | vpn:* | server:* | rules:* | cloudflare:* | netscaler:*')
         LIMIT 1
      )::int AS ok`);
    add("fts_returns_rows", Number(fts.ok) === 1, Number(fts.ok) === 1 ? "FTS sample returns rows" : "FTS sample returned 0 rows");

    const hnsw = await scalar(`
      SELECT COUNT(*)::int AS n FROM pg_indexes
       WHERE schemaname='public' AND tablename='knowledge_chunks'
         AND indexdef ILIKE '%hnsw%' AND indexdef ILIKE '%embedding%'`);
    add("embedding_hnsw_index", Number(hnsw.n || 0) > 0, `HNSW indexes on embedding: ${hnsw.n || 0}`);

    const emb = await scalar(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE embedding IS NOT NULL AND embedding_status='ok')::int AS ok_rows,
             ROUND(100.0 * COUNT(*) FILTER (WHERE embedding IS NOT NULL AND embedding_status='ok') / NULLIF(COUNT(*),0), 2) AS pct
        FROM knowledge_chunks`);
    const embPct = Number(emb.pct || (Number(emb.total || 0) === 0 ? 100 : 0));
    add("embedding_coverage", embPct >= 90, `embedding ok: ${embPct}% (${emb.ok_rows || 0}/${emb.total || 0})`);

    try {
      await pool.query(`
        SELECT 1
          FROM knowledge_sources s
          JOIN knowledge_chunks k ON k.file_id = s.id::text
         LIMIT 1`);
      add("fts_source_join_ok", true, "source→chunk join runs without type error");
    } catch (e) {
      add("fts_source_join_ok", false, `source→chunk join failed: ${e?.message || e}`);
    }

    let needles = String(env.RAG_SENTINELS || "")
      .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!needles.length) {
      try {
        const topBrands = await pool.query(`
          SELECT lower(brand) AS brand
            FROM knowledge_chunks
           WHERE brand IS NOT NULL AND brand <> '' AND brand NOT LIKE '\\_%' ESCAPE '\\'
           GROUP BY 1
           ORDER BY COUNT(*) DESC
           LIMIT 5`);
        needles = topBrands.rows.map(r => r.brand).filter(Boolean);
      } catch { needles = []; }
    }
    for (const needle of needles) {
      try {
        const v = await verifySourceReachability(needle);
        add(`${needle}_metadata_present`, v.metadataPresent,
          v.metadataPresent ? `sources=${v.sources.total}, chunks_meta=${v.chunks.total}` : "not present in corpus metadata");
        if (!v.metadataPresent) {
          add(`${needle}_content_indexed`, true, "skipped — no metadata in corpus");
          continue;
        }
        add(`${needle}_content_indexed`, v.contentIndexed,
          v.contentIndexed
            ? `tsv-hit chunks=${v.chunks.withTsvHit}, with-embedding=${v.chunks.withEmbedding}`
            : `diagnosis=${v.diagnosis} (${v.hint})`);
      } catch (e) {
        add(`${needle}_canary_exception`, false, e?.message || e);
      }
    }
  } catch (e) {
    add("self_audit_exception", false, e?.message || e);
  }
  return { ok: checks.every(c => c.ok), ts: Date.now(), checks };
}

// ---------------------------------------------------------------------------
// Route mount
// ---------------------------------------------------------------------------
export function mountRagReadOpsRoutes({ app }) {
  // /api/rag/health
  app.get("/api/rag/health", async (_req, res) => {
    res.json(await getRagHealth());
  });

  // /api/rag/probe (loopback-only)
  app.post("/api/rag/probe", async (req, res) => {
    const { _isLoopbackReq, ROLE_RANK, ragProbeAndFetch } = D();
    try {
      if (!_isLoopbackReq(req)) {
        return res.status(403).json({ ok: false, error: "loopback_only" });
      }
      const q = String(req.body?.q || "").trim();
      if (!q) return res.status(400).json({ ok: false, error: "missing q" });
      const allowedLevels = Object.keys(ROLE_RANK);
      const out = await ragProbeAndFetch({ q, allowedLevels });
      const rerank = out.reranker || { used: false, ms: 0, model: null, reason: "absent" };
      let hint = null;
      if (!rerank.used) {
        if (rerank.reason === "disabled") hint = "RAG_SETTINGS.rerankEnabled=false; /api/rag/settings ile aç.";
        else if (rerank.reason === "worker_unavailable") hint = "worker /v1/rerank yanıt vermiyor; /api/rag/health ve worker log'una bak.";
        else if (rerank.reason === "single_candidate") hint = "Tek aday geldi, rerank atlandı (normal).";
        else if ((out.rows || []).length === 0) hint = "Bu sorgu için retrieval aday döndürmedi (rowsCount=0).";
      }
      res.json({
        ok: true,
        q,
        decision: out.decision,
        reason: out.reason,
        top1: out.top1,
        tau: out.tau,
        rowsCount: (out.rows || []).length,
        reranker: rerank,
        hint,
        rows: (out.rows || []).slice(0, 5).map(r => ({
          path: r.path, ord: r.ord, brand: r.brand,
          score: Number(r.score || 0).toFixed(3),
          retriever: r.retriever,
          rerank_score: r.rerank_score ?? null,
        })),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // /api/rag/self-audit
  app.get("/api/rag/self-audit", async (_req, res) => {
    res.json(await ragSelfAudit());
  });

  // /api/rag/diagnose-join
  app.get("/api/rag/diagnose-join", async (_req, res) => {
    try {
      const probe = await probeJoinHypotheses();
      await resolveJoinExpr({ force: true });
      res.json({ ok: true, ...probe, cached: _joinExprCache });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  // /api/rag/status
  app.get("/api/rag/status", async (_req, res) => {
    const { sendRagStatus } = D();
    try { await sendRagStatus(res); }
    catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  // /api/rag/intent-telemetry — Tur 4 (2026-07-03): cold-classifier +
  // Meta-Forge lane retry counters. Read-only, cheap; consumed by the RAG
  // panel telemetry chip. No DI needed — imports classifier module directly.
  app.get("/api/rag/intent-telemetry", async (_req, res) => {
    try {
      const mod = await import("../rag/intent-classifier.mjs");
      const probe = typeof mod.getIntentClassifierProbe === "function"
        ? mod.getIntentClassifierProbe() : null;
      res.json({ ok: true, at: Date.now(), probe });
    } catch (e) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  // /api/rag/debug — CLI-friendly RAG probe (no MLX, embed+DB only).
  // GET bypasses blanket mutation guard. Read-only, local-only.
  app.get("/api/rag/debug", async (req, res) => {
    const {
      ROLE_RANK, normalizeAccessLevel, classifyIntent, refineIntentSemantically,
      ragProbeAndFetch, getRagSettings, getLastFtsError, getLastFtsChunkError,
      getLastFtsSourceError, path,
    } = D();
    req.body = { q: req.query.q, role: req.query.role };
    try {
      const q = String(req.body?.q || "").trim();
      if (!q) return res.status(400).json({ ok: false, error: "missing q" });
      const role = String(req.body?.role || "Admin");
      const userRank = ROLE_RANK[normalizeAccessLevel(role)] ?? 0;
      const allowedLevels = Object.entries(ROLE_RANK).filter(([, r]) => r <= userRank).map(([n]) => n);
      const tIntent = Date.now();
      const intent = classifyIntent(q);
      const intentMs = Date.now() - tIntent;
      const tRefine = Date.now();
      const refined = await refineIntentSemantically(q, intent).catch(() => intent);
      const refineMs = Date.now() - tRefine;
      const tProbe = Date.now();
      const probe = await ragProbeAndFetch({ q, allowedLevels });
      const probeMs = Date.now() - tProbe;
      const RAG_SETTINGS = getRagSettings();
      res.json({
        ok: true,
        q,
        settings: {
          injectThreshold: Number(RAG_SETTINGS.injectThreshold),
          marginGate:      Number(RAG_SETTINGS.marginGate),
          similarityThreshold: Number(RAG_SETTINGS.similarityThreshold),
          topK:            Number(RAG_SETTINGS.topK),
          chunkDepth:      Number(RAG_SETTINGS.chunkDepth),
        },
        intent: { kind: intent.kind, mode: intent.mode, score: intent.score, ms: intentMs },
        refined: { kind: refined.kind, mode: refined.mode, ms: refineMs },
        probe: {
          decision: probe.decision,
          reason: probe.reason,
          top1: Number((probe.top1 || 0).toFixed(4)),
          ftsTop: probe.ftsTop != null ? Number(Number(probe.ftsTop).toFixed(4)) : null,
          ftsRows: probe.ftsRows != null ? Number(probe.ftsRows) : null,
          ftsError: probe.ftsError || getLastFtsError() || null,
          ftsChunkError: getLastFtsChunkError() || null,
          ftsSourceError: getLastFtsSourceError() || null,
          top4: Number((probe.top4 || 0).toFixed(4)),
          margin: Number((probe.margin || 0).toFixed(4)),
          tau: Number((probe.tau || 0).toFixed(4)),
          topCoverage: probe.topCoverage != null ? Number(probe.topCoverage) : null,
          queryTerms: probe.queryTerms ?? null,
          ftsRowsByBrand: probe.ftsRowsByBrand || null,
          vectorRowsByBrand: probe.vectorRowsByBrand || null,
          rejectedTop: probe.rejectedTop || null,
          rows: (probe.rows || []).map(r => ({
            file: path.basename(r.path || ""),
            path: r.path || null,
            ord: r.ord ?? 0,
            page: r.page_start ?? null,
            score: Number((Number(r.score) || 0).toFixed(4)),
            rrf: r.rrf != null ? Number(Number(r.rrf).toFixed(6)) : null,
            coverage: r.coverage != null ? Number(r.coverage) : null,
            vendor_boost: r.vendor_boost != null ? Number(r.vendor_boost) : null,
            fused: r.fused != null ? Number(r.fused) : null,
            rerank_score: r.rerank_score != null ? Number(r.rerank_score) : null,
            rerank_mix:   r.rerank_mix   != null ? Number(r.rerank_mix)   : null,
            queryTerms: r.queryTerms ?? null,
            retriever: r.retriever || null,
            brand: r.brand || null,
            access: r.access_level,
            preview: String(r.content || "").slice(0, 140),
          })),
          reranker: probe.reranker || null,
          queryRewritten: probe.queryRewritten || null,
          queryRewriteMode: probe.queryRewriteMode || null,
          queryRewriteReject: probe.queryRewriteReject || null,
          qForRetrieval: probe.qForRetrieval || null,
          embedError: probe.embedError || null,
          ms: probeMs,
        },
        totalMs: intentMs + refineMs + probeMs,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
