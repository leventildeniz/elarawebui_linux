#!/usr/bin/env node
// fortios-api-audit.mjs — FortiOS API JSON chunk'ları RAG DB'de var mı,
// embedding'leri tamam mı, retrieval neden PDF'e kayıyor hızlıca ölçer.
// Read-only: sadece SELECT ve /api/rag/debug GET çağrısı yapar.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const args = process.argv.slice(2);
let dbUrl = process.env.DATABASE_URL || process.env.PG_URL || "";
let base = process.env.RAG_DEBUG_BASE || "https://elara.local:10443";
let role = "Admin";

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--db") dbUrl = args[++i] || dbUrl;
  else if (a === "--base") base = args[++i] || base;
  else if (a === "--role") role = args[++i] || role;
}

if (!dbUrl) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].replace(/^['"]|['"]$/g, "");
      if ((m[1] === "DATABASE_URL" || m[1] === "PG_URL") && !dbUrl) dbUrl = v;
    }
  }
}

if (!dbUrl) {
  console.error("DATABASE_URL bulunamadı. local-server/.env içine koy veya --db <url> ver.");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });

function maskDb(s) { return String(s || "").replace(/:[^:@/]+@/, ":***@"); }
function oneLine(s, n = 180) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }
function pad(s, n) { s = String(s ?? ""); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
function hdr(t) { console.log(`\n── ${t} ${"─".repeat(Math.max(0, 74 - t.length))}`); }

async function q(label, sql, params = []) {
  try { return (await pool.query(sql, params)).rows; }
  catch (e) { console.log(`[DB HATA · ${label}] ${e.message}`); return []; }
}

function printTable(rows, cols) {
  if (!rows.length) { console.log("  (boş)"); return; }
  console.log("  " + cols.map(([k, w]) => pad(k, w)).join(" "));
  for (const r of rows) console.log("  " + cols.map(([k, w]) => pad(r[k], w)).join(" "));
}

async function fetchDebug(query) {
  const url = `${base}/api/rag/debug?q=${encodeURIComponent(query)}&role=${encodeURIComponent(role)}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(`HTTP ${res.status}: ${body?.error || "?"}`);
  return body;
}

async function main() {
  console.log("# FortiOS API RAG Audit");
  console.log(`DB   : ${maskDb(dbUrl)}`);
  console.log(`Base : ${base}`);

  hdr("1) Forti* brand/source dağılımı");
  const brands = await q("brands", `
    SELECT
      COALESCE(brand, 'NULL') AS brand,
      COALESCE(source_type, 'NULL') AS source_type,
      COUNT(*)::int AS chunks,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
      COUNT(*) FILTER (WHERE embedding IS NULL)::int AS missing,
      MIN(path) AS sample_path
    FROM knowledge_chunks
    WHERE lower(path) LIKE '%forti%'
       OR lower(COALESCE(brand,'')) LIKE '%forti%'
    GROUP BY 1,2
    ORDER BY chunks DESC
  `);
  printTable(brands.map(r => ({ ...r, sample_path: oneLine(r.sample_path, 52) })), [
    ["brand", 22], ["source_type", 14], ["chunks", 8], ["embedded", 9], ["missing", 8], ["sample_path", 52],
  ]);

  hdr("2) Fortinet API JSON path'leri");
  const apiPaths = await q("api-paths", `
    SELECT
      COALESCE(brand, 'NULL') AS brand,
      COALESCE(source_type, 'NULL') AS source_type,
      COUNT(*)::int AS chunks,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
      COUNT(*) FILTER (WHERE embedding IS NULL)::int AS missing,
      MIN(path) AS sample_path
    FROM knowledge_chunks
    WHERE (
          lower(path) LIKE '%fortinet_api_raw%'
       OR lower(path) LIKE '%fortios_api_schema%'
       OR lower(path) LIKE '%fortimanager_api_schema%'
       OR lower(path) LIKE '%fortianalyzer_api_schema%'
       OR lower(path) LIKE '%openapi%'
       OR lower(path) LIKE '%swagger%'
       OR lower(COALESCE(source_type,'')) LIKE '%api%'
    )
      AND (lower(path) LIKE '%forti%' OR lower(COALESCE(brand,'')) LIKE '%forti%')
    GROUP BY 1,2
    ORDER BY chunks DESC
  `);
  printTable(apiPaths.map(r => ({ ...r, sample_path: oneLine(r.sample_path, 56) })), [
    ["brand", 22], ["source_type", 14], ["chunks", 8], ["embedded", 9], ["missing", 8], ["sample_path", 56],
  ]);

  hdr("3) token/curl/authentication geçen Forti* örnekleri");
  const samples = await q("samples", `
    SELECT
      id, COALESCE(brand,'NULL') AS brand, COALESCE(source_type,'NULL') AS source_type,
      path, ord, (embedding IS NOT NULL) AS has_embedding,
      left(regexp_replace(content, '\\s+', ' ', 'g'), 220) AS preview
    FROM knowledge_chunks
    WHERE (lower(content) LIKE '%curl%' OR lower(content) LIKE '%token%' OR lower(content) LIKE '%authentication%')
      AND (lower(path) LIKE '%forti%' OR lower(COALESCE(brand,'')) LIKE '%forti%')
    ORDER BY
      CASE WHEN lower(path) LIKE '%fortinet_api_raw%' OR lower(path) LIKE '%api%' OR lower(COALESCE(source_type,'')) LIKE '%api%' THEN 0 ELSE 1 END,
      id
    LIMIT 25
  `);
  printTable(samples.map(r => ({ ...r, path: oneLine(r.path, 44), preview: oneLine(r.preview, 80) })), [
    ["id", 8], ["brand", 18], ["source_type", 12], ["ord", 5], ["has_embedding", 13], ["path", 44], ["preview", 80],
  ]);

  hdr("4) /api/rag/debug karşılaştırması");
  for (const query of ["fortios rest api token curl example", "fortios api authentication curl"]) {
    try {
      const b = await fetchDebug(query);
      const p = b.probe || {};
      console.log(`  Q: ${query}`);
      console.log(`    decision=${p.decision}${p.reason ? `(${p.reason})` : ""} top1=${p.top1} tau=${p.tau} coverage=${p.topCoverage}`);
      console.log(`    vectorRowsByBrand=${JSON.stringify(p.vectorRowsByBrand || {})}`);
      console.log(`    ftsRowsByBrand=${JSON.stringify(p.ftsRowsByBrand || {})}`);
      console.log(`    reranker=${p.reranker ? JSON.stringify(p.reranker) : "null"}`);
      if (p.rejectedTop?.length) {
        console.log(`    rejectedTop=${p.rejectedTop.map(r => `${path.basename(r.path || "?")}#${r.ord}:rr=${r.rerank_score}`).join(" | ")}`);
      }
    } catch (e) {
      console.log(`  [DEBUG HATA] ${query}: ${e.message}`);
    }
  }

  hdr("5) Yorum anahtarı");
  const apiChunks = apiPaths.reduce((a, r) => a + Number(r.chunks || 0), 0);
  const apiMissing = apiPaths.reduce((a, r) => a + Number(r.missing || 0), 0);
  if (!apiChunks) console.log("  API JSON chunk görünmüyor → disk'teki fortinet_api_raw DB'ye ingest edilmemiş olabilir.");
  else if (apiMissing > 0) console.log("  API JSON chunk var ama embedding eksikleri var → retry-embeddings gerekli.");
  else console.log("  API JSON chunk + embedding var → sorun ranking/boost tarafında; API source prior incelenmeli.");
}

main().catch((e) => {
  console.error("HATA:", e.message);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end().catch(() => {});
});
