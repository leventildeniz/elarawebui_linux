#!/usr/bin/env node
// rag-content-audit.mjs — read-only diagnostic for the hybrid retriever.
// Usage:
//   node local-server/scripts/rag-content-audit.mjs "Citrix Nitro API authentication"
//
// Calls the running server's RAG probe endpoint (if exposed) AND independently
// runs vector + FTS legs against the DB so the operator can see WHY a query
// hits or misses. Touches nothing.

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.DOTENV_CONFIG_PATH = path.resolve(HERE, "..", ".env");

const QUERY = process.argv.slice(2).join(" ").trim();
if (!QUERY) {
  console.error('usage: rag-content-audit.mjs "your query"');
  process.exit(2);
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.PG_URL;
if (!DATABASE_URL) { console.error("FATAL: DATABASE_URL missing"); process.exit(2); }
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

const EMBED_BASE  = (process.env.MLX_EMBED_BASE_URL || process.env.MLX_BASE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
const EMBED_MODEL = process.env.MLX_EMBED_MODEL;

async function embedQuery(q) {
  if (!EMBED_MODEL) return null;
  try {
    const r = await fetch(`${EMBED_BASE}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: [q] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { console.warn(`[embed] HTTP ${r.status}`); return null; }
    const j = await r.json();
    return j.data?.[0]?.embedding || null;
  } catch (e) { console.warn(`[embed] ${e.message || e}`); return null; }
}

function fmtPreview(s, n = 200) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
}

(async () => {
  console.log("=".repeat(78));
  console.log(`Query: "${QUERY}"`);
  console.log("=".repeat(78));

  // ---- Server probe leg (uses worker queue → no manual MLX start) --------
  const SERVER = (process.env.ELARA_API_BASE || "http://127.0.0.1:3005").replace(/\/$/, "");
  try {
    const r = await fetch(`${SERVER}/api/rag/debug?q=${encodeURIComponent(QUERY)}`, {
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => null);
    const p = j?.probe || {};
    console.log(`\n[server-probe] ${SERVER}/api/rag/debug`);
    console.log(`  decision=${p.decision || "?"}  reason=${p.reason || "-"}  top1=${p.top1 ?? "-"}  top4=${p.top4 ?? "-"}  rows=${(p.rows||[]).length}`);
    (p.rows || []).slice(0, 5).forEach((row, i) => {
      console.log(`  #${i+1} score=${Number(row.score||0).toFixed(3)}  ${row.file || row.path}#${row.ord ?? "?"}  ${row.brand || ""}`);
      if (row.preview) console.log(`      ${fmtPreview(row.preview)}`);
    });
  } catch (e) { console.warn(`[server-probe] ${e.message || e} — server not reachable at ${SERVER}`); }

  // ---- Vector leg (direct MLX; skipped if worker not started) -----------
  const qVec = await embedQuery(QUERY);
  if (!qVec) {
    console.log("\n[vector:direct] SKIPPED — MLX embed unavailable (server-probe above used the worker queue instead)");
  } else {
    const qStr = `[${qVec.join(",")}]`;
    const c = await pool.connect();
    try {
      await c.query(`SET LOCAL hnsw.ef_search = 200`).catch(() => {});
      await c.query(`SET LOCAL statement_timeout = '4s'`).catch(() => {});
      const r = await c.query(
        `SELECT c.id, c.file_id, c.path, c.ord,
                1 - (c.embedding <=> $1::vector) AS score,
                s.name AS source_name, s.url AS source_url,
                s.parser_used, s.parse_quality, c.content
           FROM knowledge_chunks c
           LEFT JOIN knowledge_sources s ON s.id::text = c.file_id
          WHERE c.embedding IS NOT NULL
          ORDER BY c.embedding <=> $1::vector
          LIMIT 5`, [qStr]);
      console.log(`\n[vector] top ${r.rows.length}`);
      r.rows.forEach((row, i) => {
        console.log(`  #${i+1} score=${Number(row.score).toFixed(3)}  parser=${row.parser_used||"?"} quality=${row.parse_quality||"?"}`);
        console.log(`      src: ${row.source_name || row.path} ${row.source_url ? "("+row.source_url+")" : ""}`);
        console.log(`      ${fmtPreview(row.content)}`);
      });
    } finally { c.release(); }
  }

  // ---- FTS chunks leg ---------------------------------------------------
  {
    const r = await pool.query(
      `SELECT c.id, c.file_id, c.path, c.ord,
              ts_rank_cd(c.tsv, plainto_tsquery('simple', $1)) AS score,
              s.name AS source_name, s.url AS source_url,
              s.parser_used, s.parse_quality, c.content
         FROM knowledge_chunks c
         LEFT JOIN knowledge_sources s ON s.id::text = c.file_id
        WHERE c.tsv @@ plainto_tsquery('simple', $1)
        ORDER BY score DESC
        LIMIT 5`, [QUERY]).catch((e) => { console.warn(`[fts:chunks] ${e.message}`); return { rows: [] }; });
    console.log(`\n[fts:chunks] top ${r.rows.length}`);
    r.rows.forEach((row, i) => {
      console.log(`  #${i+1} ts_rank=${Number(row.score).toFixed(4)}  parser=${row.parser_used||"?"} quality=${row.parse_quality||"?"}`);
      console.log(`      src: ${row.source_name || row.path}`);
      console.log(`      ${fmtPreview(row.content)}`);
    });
  }

  // ---- FTS sources leg --------------------------------------------------
  {
    const r = await pool.query(
      `SELECT id, name, title, url, parser_used, parse_quality, char_count, chunk_count,
              ts_rank_cd(fts, plainto_tsquery('simple', $1)) AS score
         FROM knowledge_sources
        WHERE fts @@ plainto_tsquery('simple', $1)
          AND COALESCE(superseded_by,'') = ''
        ORDER BY score DESC
        LIMIT 5`, [QUERY]).catch((e) => { console.warn(`[fts:sources] ${e.message}`); return { rows: [] }; });
    console.log(`\n[fts:sources] top ${r.rows.length}`);
    r.rows.forEach((row, i) => {
      console.log(`  #${i+1} ts_rank=${Number(row.score).toFixed(4)}  ${row.parser_used||"?"}/${row.parse_quality||"?"}  chars=${row.char_count||0} chunks=${row.chunk_count||0}`);
      console.log(`      ${row.title || row.name}${row.url ? " — " + row.url : ""}`);
    });
  }

  // ---- Catalog health summary -------------------------------------------
  const cat = await pool.query(
    `SELECT parse_quality, COUNT(*)::int AS n
       FROM knowledge_sources
      WHERE COALESCE(superseded_by,'') = ''
      GROUP BY parse_quality ORDER BY n DESC`).catch(() => ({ rows: [] }));
  console.log("\n[catalog] parse_quality histogram");
  cat.rows.forEach(r => console.log(`  ${String(r.parse_quality||"(null)").padEnd(20)} ${r.n}`));

  await pool.end();
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
