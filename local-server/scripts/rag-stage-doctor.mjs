#!/usr/bin/env node
// rag-stage-doctor.mjs — read-only stage-by-stage RAG retrieval diagnostic.
//
// Goal: prove where a wanted document/version disappears:
//   corpus → vector pool → diversity caps → FTS → RRF fused top → rerank → live /api/rag/debug final
//
// Usage:
//   node local-server/scripts/rag-stage-doctor.mjs "FortiManager 7.4 ile 7.6 arasındaki farklar" --watch 7.6 --watch 7.4
//   node local-server/scripts/rag-stage-doctor.mjs --base https://elara.local:10443 --role Admin "..."

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { rrfFuse } from "../lib/rag/scoring.mjs";
import { _buildFtsOrQuery } from "../lib/rag/retrieval.mjs";
import { applyRagSettingsOverlay, buildRagDefaults } from "../lib/rag/defaults.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_SERVER = path.resolve(HERE, "..");
const require = createRequire(path.join(LOCAL_SERVER, "package.json"));
const { config: loadDotenv } = require("dotenv");
const pg = require("pg");
loadDotenv({ path: path.join(LOCAL_SERVER, ".env"), override: false });

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const args = process.argv.slice(2);
let base = process.env.RAG_DEBUG_BASE || "https://elara.local:10443";
let dbUrl = process.env.DATABASE_URL || process.env.PG_URL || "";
let role = "Admin";
let worker = `http://${process.env.EMBED_WORKER_HOST || "127.0.0.1"}:${process.env.EMBED_WORKER_PORT || "process.env.EMBED_WORKER_PORT || 8082"}`;
let poolLimit = null;
const watches = [];
const queryParts = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--base") base = args[++i];
  else if (a === "--db") dbUrl = args[++i];
  else if (a === "--role") role = args[++i];
  else if (a === "--worker") worker = args[++i];
  else if (a === "--watch") watches.push(args[++i]);
  else if (a === "--pool") poolLimit = Number(args[++i]);
  else queryParts.push(a);
}

const q = queryParts.join(" ").trim() || "FortiManager 7.4 ile 7.6 arasındaki farklar";
if (!dbUrl) {
  console.error("FATAL: DATABASE_URL missing. Use --db <url> or local-server/.env.");
  process.exit(2);
}

function envNumber(k, d) {
  const n = Number(process.env[k]);
  return Number.isFinite(n) ? n : d;
}

function inferWatchTerms(text) {
  const found = String(text || "").match(/\b\d+(?:\.\d+){1,3}\b/g) || [];
  return Array.from(new Set(found));
}

const watchTerms = Array.from(new Set([...watches, ...inferWatchTerms(q)]))
  .map((x) => String(x || "").trim())
  .filter(Boolean);

const ROLE_RANK = { Viewer: 1, Security: 2, Operator: 3, Admin: 4 };
const userRank = ROLE_RANK[role] || ROLE_RANK.Admin;
const safeLevels = Object.entries(ROLE_RANK).filter(([, r]) => r <= userRank).map(([name]) => name);

const pool = new pg.Pool({ connectionString: dbUrl, max: 3 });

function bn(p) { return path.basename(String(p || "")); }
function n4(x) { const n = Number(x); return Number.isFinite(n) ? n.toFixed(4) : "-"; }
function short(s, n = 72) { s = String(s || ""); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
function hasWatch(row, term) {
  const hay = `${row.path || ""}\n${row.content || ""}\n${row.brand || ""}`.toLowerCase();
  return hay.includes(String(term || "").toLowerCase());
}
function watchHit(row) {
  return watchTerms.filter((t) => hasWatch(row, t));
}
function hist(rows, key = "brand") {
  return rows.reduce((m, r) => {
    const k = String(r?.[key] || "?");
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
}
function fileHist(rows) {
  return rows.reduce((m, r) => {
    const k = bn(r.path || r.file || "?");
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
}
function printRows(title, rows, limit = 12) {
  console.log(`\n━━━ ${title} (${rows.length}) ${"━".repeat(Math.max(0, 72 - title.length))}`);
  if (!rows.length) { console.log("(none)"); return; }
  rows.slice(0, limit).forEach((r, i) => {
    const wh = watchHit(r);
    const extra = [
      r.rank != null ? `rank=${r.rank}` : null,
      r.rn_file != null ? `rn_file=${r.rn_file}` : null,
      r.rn_brand != null ? `rn_brand=${r.rn_brand}` : null,
      r.coverage != null ? `cov=${r.coverage}` : null,
      r.rerank_score != null ? `rr=${n4(r.rerank_score)}` : null,
      wh.length ? `WATCH=${wh.join(",")}` : null,
    ].filter(Boolean).join(" · ");
    console.log(`#${String(i + 1).padStart(2, "0")} ${n4(r.score)} · ${short(bn(r.path || r.file), 58)} · ord=${r.ord ?? "-"} · ${r.brand || "-"}${extra ? ` · ${extra}` : ""}`);
  });
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`${res.status} ${txt.slice(0, 180)}`);
  return json;
}

async function loadSettings() {
  try {
    const j = await fetchJson(`${base}/api/rag/settings`);
    if (j?.settings) return { source: `${base}/api/rag/settings`, settings: j.settings };
  } catch (e) {
    console.warn(`[settings] live API unavailable: ${e.message}`);
  }
  const settings = buildRagDefaults({ envNumber, TIMEOUT_BUDGETS: { HTTP_SOCKET_MS: 120000, MLX_STREAM_TOTAL_MS: 120000, MLX_QUEUE_WAIT_MS: 120000 } });
  for (const file of [path.join(LOCAL_SERVER, "data", "rag-settings.json"), path.join(LOCAL_SERVER, ".rag-settings.json")]) {
    if (fs.existsSync(file)) {
      applyRagSettingsOverlay(settings, JSON.parse(fs.readFileSync(file, "utf8")));
      return { source: file, settings };
    }
  }
  return { source: "defaults", settings };
}

async function embed(text) {
  const j = await fetchJson(`${worker}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "BAAI/bge-m3", input: text }),
  });
  const vec = j?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || !vec.length) throw new Error(`embedding empty: ${JSON.stringify(j).slice(0, 180)}`);
  return vec;
}

async function rerank(query, rows, settings) {
  if (!settings.rerankEnabled || rows.length <= 1) return { used: false, rows, raw: [] };
  const topN = Math.min(Number(settings.rerankTopN) || 12, rows.length);
  const cand = rows.slice(0, topN);
  const j = await fetchJson(`${worker}/v1/rerank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, documents: cand.map((r) => String(r.content || "").slice(0, 2000)), top_n: topN }),
  }).catch((e) => ({ error: e.message, results: [] }));
  const ranked = Array.isArray(j?.results) ? j.results : (Array.isArray(j) ? j : []);
  if (!ranked.length) return { used: false, rows, raw: [], error: j?.error || "empty_rerank" };
  const w = Math.min(1, Math.max(0, Number(settings.rerankWeight) || 0.7));
  const scores = new Map(ranked.map((x) => [Number(x.index), Number(x.score) || 0]));
  const fusedMax = Math.max(...cand.map((r) => Number(r.fused || 0))) || 1;
  const rerankMax = Math.max(...ranked.map((x) => Math.abs(Number(x.score) || 0))) || 1;
  const blended = cand.map((r, i) => {
    const rs = scores.has(i) ? scores.get(i) : 0;
    const rsNorm = rs / rerankMax;
    const fsNorm = Number(r.fused || 0) / fusedMax;
    return { ...r, rerank_score: rs, rerank_mix: w * rsNorm + (1 - w) * fsNorm };
  }).sort((a, b) => b.rerank_mix - a.rerank_mix);
  return { used: true, rows: blended, raw: ranked };
}

async function main() {
  const { source: settingsSource, settings } = await loadSettings();
  const diversityPool = Math.max(24, Number(poolLimit || settings.diversityPool || 240));
  const perSourceCap = Math.max(1, Number(settings.perSourceCap || 4));
  const perBrandCap = Math.max(1, Number(settings.perBrandCap || 8));
  const minChunkChars = Math.max(0, Number(settings.minChunkChars || 0));
  const tau = Math.min(0.95, Math.max(0.10, Number(settings.injectThreshold) || 0.55));

  console.log("\n# RAG STAGE DOCTOR");
  console.log(`q       : ${q}`);
  console.log(`base    : ${base}`);
  console.log(`db      : ${dbUrl.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`worker  : ${worker}`);
  console.log(`role    : ${role} → ${safeLevels.join(",")}`);
  console.log(`watch   : ${watchTerms.length ? watchTerms.join(", ") : "(none)"}`);
  console.log(`settings: ${settingsSource}`);
  console.log(`knobs   : topK=${settings.topK} chunkDepth=${settings.chunkDepth} diversityPool=${diversityPool} perSourceCap=${perSourceCap} perBrandCap=${perBrandCap} rerankTopN=${settings.rerankTopN} minSupportSources=${settings.minSupportSources} rerankMinScore=${settings.rerankMinScore}`);
  console.log("code    : ragProbeAndFetch currently fuses top 6 and reranks/finalizes top 6; UI topK is used by semanticSearch, not this live chat path.");

  const liveDebug = await fetchJson(`${base}/api/rag/debug?q=${encodeURIComponent(q)}&role=${encodeURIComponent(role)}`).catch((e) => ({ ok: false, error: e.message }));
  if (liveDebug?.ok) {
    console.log(`\n[live-debug] decision=${liveDebug.probe?.decision} reason=${liveDebug.probe?.reason} rows=${liveDebug.probe?.rows?.length || 0} qForRetrieval=${JSON.stringify(liveDebug.probe?.qForRetrieval || q)}`);
  } else {
    console.log(`\n[live-debug] unavailable: ${liveDebug?.error || "unknown"}`);
  }
  const qForRetrieval = liveDebug?.probe?.qForRetrieval || q;

  if (watchTerms.length) {
    console.log("\n━━━ Corpus availability by watch term ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    for (const term of watchTerms) {
      const r = await pool.query(
        `SELECT split_part(path,'/',-1) AS file, COUNT(*)::int AS chunks
           FROM knowledge_chunks
          WHERE path ILIKE $1 OR content ILIKE $1
          GROUP BY 1 ORDER BY chunks DESC, file LIMIT 20`,
        [`%${term}%`],
      );
      const total = r.rows.reduce((a, x) => a + Number(x.chunks || 0), 0);
      console.log(`\n[${term}] total=${total} files=${r.rows.length}`);
      for (const x of r.rows.slice(0, 12)) console.log(`  ${String(x.chunks).padStart(5)} · ${x.file}`);
    }
  }

  const qVec = await embed(qForRetrieval);
  const qStr = `[${qVec.join(",")}]`;
  const client = await pool.connect();
  try {
    await client.query(`SET LOCAL hnsw.ef_search = 200`).catch(() => {});
    await client.query(`SET LOCAL statement_timeout = '8000ms'`).catch(() => {});

    const vectorPool = (await client.query(
      `WITH pool AS (
         SELECT id, file_id, path, ord, brand, access_level, content, page_start, page_end,
                1 - (embedding <=> $1::vector) AS score,
                embedding <=> $1::vector AS distance
           FROM knowledge_chunks
          WHERE embedding IS NOT NULL
            AND access_level = ANY($2::text[])
            AND ($3::int = 0 OR length(content) >= $3::int)
          ORDER BY embedding <=> $1::vector
          LIMIT $4
       ), ranked AS (
         SELECT *,
                ROW_NUMBER() OVER (ORDER BY distance ASC) AS rank,
                ROW_NUMBER() OVER (PARTITION BY file_id ORDER BY distance ASC) AS rn_file,
                ROW_NUMBER() OVER (PARTITION BY brand ORDER BY distance ASC) AS rn_brand
           FROM pool
       )
       SELECT * FROM ranked ORDER BY rank ASC`,
      [qStr, safeLevels, minChunkChars, diversityPool],
    )).rows;

    const afterCaps = vectorPool.filter((r) => Number(r.rn_file) <= perSourceCap && Number(r.rn_brand) <= perBrandCap && Number(r.score) >= Math.max(0.30, tau - 0.05)).slice(0, 24);
    printRows("Vector pool before caps", vectorPool, 18);
    printRows("Vector rows after per-file/per-brand caps + floor", afterCaps, 18);
    console.log(`\n[vector hist before] brand=${JSON.stringify(hist(vectorPool))}`);
    console.log(`[vector hist after ] brand=${JSON.stringify(hist(afterCaps))}`);
    console.log(`[file hist after   ] ${JSON.stringify(fileHist(afterCaps))}`);

    if (watchTerms.length) {
      console.log("\n━━━ Watch survival in vector stages ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      for (const term of watchTerms) {
        const inPool = vectorPool.filter((r) => hasWatch(r, term));
        const inCaps = afterCaps.filter((r) => hasWatch(r, term));
        const firstPool = inPool[0];
        const firstCap = inCaps[0];
        console.log(`[${term}] pool=${inPool.length}${firstPool ? ` firstRank=${firstPool.rank} file=${bn(firstPool.path)} score=${n4(firstPool.score)} rn_file=${firstPool.rn_file} rn_brand=${firstPool.rn_brand}` : ""}`);
        console.log(`       afterCaps=${inCaps.length}${firstCap ? ` first=${bn(firstCap.path)} score=${n4(firstCap.score)}` : ""}`);
      }
    }

    const orQ = _buildFtsOrQuery(qForRetrieval);
    let ftsRows = [];
    if (orQ) {
      ftsRows = (await client.query(
        `SELECT c.id, c.file_id, c.path, c.ord, c.brand, c.access_level, c.content,
                c.page_start, c.page_end,
                ts_rank_cd(c.tsv, to_tsquery('simple', $2)) AS score
           FROM knowledge_chunks c
          WHERE c.tsv @@ to_tsquery('simple', $2)
            AND c.access_level = ANY($1::text[])
            AND ($3::int = 0 OR length(c.content) >= $3::int)
          ORDER BY score DESC
          LIMIT 20`,
        [safeLevels, orQ, minChunkChars],
      )).rows.map((r) => ({ ...r, retriever: "fts-chunk" }));
    }
    printRows("FTS chunk rows", ftsRows, 14);

    const fusedAll = rrfFuse([
      { name: "vector", rows: afterCaps },
      { name: "fts", rows: ftsRows },
    ], { k: 60, query: q });
    const fusedTop6 = fusedAll.slice(0, 6);
    printRows("RRF fused top 6 (live hard limit before rerank)", fusedTop6, 6);

    const rr = await rerank(qForRetrieval, fusedTop6, settings);
    printRows(`Rerank blended${rr.used ? "" : ` (not used: ${rr.error || "disabled/single"})`}`, rr.rows, 8);

    const rrMin = Number(settings.rerankMinScore || 0.10);
    const finalLikely = rr.used && rrMin > 0
      ? rr.rows.filter((r) => Number(r.rerank_score || 0) >= rrMin).slice(0, Math.max(1, Number(settings.minSupportSources || 0) || 6))
      : rr.rows.slice(0, 6);
    printRows("Likely final rows after rerankMinScore", finalLikely, 8);

    if (liveDebug?.probe?.rows?.length) {
      printRows("Live /api/rag/debug final rows", liveDebug.probe.rows.map((r) => ({ ...r, path: r.path || r.file, content: r.preview || "" })), 10);
    }

    console.log("\n━━━ Diagnosis hints ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    for (const term of watchTerms) {
      const corpus = await pool.query(`SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE path ILIKE $1 OR content ILIKE $1`, [`%${term}%`]);
      const nCorpus = Number(corpus.rows[0]?.n || 0);
      const nPool = vectorPool.filter((r) => hasWatch(r, term)).length;
      const nCaps = afterCaps.filter((r) => hasWatch(r, term)).length;
      const nFused = fusedTop6.filter((r) => hasWatch(r, term)).length;
      const nFinal = finalLikely.filter((r) => hasWatch(r, term)).length;
      let verdict = "survives";
      if (nCorpus && !nPool) verdict = "lost before vector pool (embedding/ranking issue)";
      else if (nPool && !nCaps) verdict = "lost at diversity caps or score floor";
      else if (nCaps && !nFused) verdict = "lost at RRF top-6 hard limit";
      else if (nFused && !nFinal) verdict = "lost at rerank/min-score gate";
      else if (!nCorpus) verdict = "not in corpus";
      console.log(`[${term}] corpus=${nCorpus} pool=${nPool} caps=${nCaps} fused6=${nFused} final=${nFinal} → ${verdict}`);
    }
    console.log("\nPaste this whole report back; it is read-only and does not change settings, DB, or middleware state.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (e) => {
  console.error("FATAL:", e?.stack || e?.message || e);
  try { await pool.end(); } catch {}
  process.exit(1);
});