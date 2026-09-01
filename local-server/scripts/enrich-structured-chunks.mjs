#!/usr/bin/env node
// enrich-structured-chunks.mjs — Yapılandırılmış kaynak chunk'larına
// (JSON/YAML/CLI/KB/_api/_api_raw) natural-language preamble prepend eder
// ve `knowledge_chunks.content_enriched` sütununa yazar. Deterministik:
// LLM çağrısı YOK, sadece path + content parse'i.
//
// Amaç: küçük yapılandırılmış kaynaklar (12 chunk fortinet_api_raw vb.)
// cosine similarity + FTS'te doğal dil sorgusuyla yakalanabilsin.
// Vendor-agnostik — yarın Adobe Premiere `.json` atılsa da otomatik enriched.
//
// Kullanım:
//   bun run scripts/enrich-structured-chunks.mjs --dry-run
//   bun run scripts/enrich-structured-chunks.mjs --brand fortinet_api_raw
//   bun run scripts/enrich-structured-chunks.mjs --limit 50
//   bun run scripts/enrich-structured-chunks.mjs           # gerçek, tümü
//
// Sonra: re-embed pass (sadece content_enriched IS NOT NULL):
//   curl -ksf -X POST "https://127.0.0.1:10443/api/rag/reembed-enriched?batch=200"
//   (veya manuel: UPDATE knowledge_chunks SET embedding=NULL,
//      embedding_status='pending' WHERE content_enriched IS NOT NULL;
//    + auto-embed worker drain eder.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { enrichChunkContent, isStructured } from "../lib/chunk-enrichment.mjs";

const args = process.argv.slice(2);
let dbUrl = process.env.DATABASE_URL || process.env.PG_URL || "";
let dryRun = false;
let onlyBrand = null;
let limit = 0;
let onlyMissing = true;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--db")        dbUrl = args[++i] || dbUrl;
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--brand") onlyBrand = args[++i] || null;
  else if (a === "--limit") limit = Math.max(0, Number(args[++i]) || 0);
  else if (a === "--all-rows") onlyMissing = false;
  else if (a === "--help") {
    console.log("flags: --dry-run --brand <name> --limit N --all-rows --db <url>");
    process.exit(0);
  }
}

if (!dbUrl) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const k = m[1], v = m[2].replace(/^["']|["']$/g, "");
      if (k === "DATABASE_URL" && !dbUrl) dbUrl = v;
    }
  }
}
if (!dbUrl) { console.error("DATABASE_URL bulunamadı."); process.exit(1); }

const pool = new pg.Pool({ connectionString: dbUrl });

(async () => {
  console.log(`# enrich-structured-chunks ${dryRun ? "(DRY-RUN)" : "(WRITE)"}`);

  const colCheck = await pool.query(`
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'knowledge_chunks' AND column_name = 'content_enriched'`);
  if (!colCheck.rowCount) {
    console.error("HATA: knowledge_chunks.content_enriched sütunu yok. Önce migration çalıştır:");
    console.error(`  ALTER TABLE knowledge_chunks
    ADD COLUMN IF NOT EXISTS content_enriched TEXT,
    ADD COLUMN IF NOT EXISTS enriched_at      TIMESTAMPTZ;`);
    process.exit(2);
  }

  const whereBits = [];
  const params = [];
  if (onlyMissing) whereBits.push(`content_enriched IS NULL`);
  if (onlyBrand) {
    params.push(onlyBrand);
    whereBits.push(`brand = $${params.length}`);
  }
  const sql = `
    SELECT id, brand, path, content
      FROM knowledge_chunks
     ${whereBits.length ? "WHERE " + whereBits.join(" AND ") : ""}
     ORDER BY id
     ${limit > 0 ? `LIMIT ${limit}` : ""}`;
  const { rows } = await pool.query(sql, params);
  console.log(`Aday satır: ${rows.length}`);

  const byBrand = {};
  for (const r of rows) byBrand[r.brand || "(null)"] = (byBrand[r.brand || "(null)"] || 0) + 1;
  console.log("Brand dağılımı:", byBrand);

  let processed = 0, structuredCount = 0, genericCount = 0, written = 0;
  for (const r of rows) {
    processed++;
    const structured = isStructured(r);
    const enriched = enrichChunkContent(r);
    if (structured) structuredCount++; else genericCount++;

    if (dryRun) {
      if (processed <= 4) {
        console.log(`\n--- id=${r.id} brand=${r.brand} kind=${structured ? "structured" : "generic"} path=${r.path}`);
        console.log(enriched.split("\n").slice(0, 6).join("\n"));
        console.log("...");
      }
      continue;
    }

    await pool.query(
      `UPDATE knowledge_chunks
          SET content_enriched = $2,
              enriched_at = now()
        WHERE id = $1`,
      [r.id, enriched]
    );
    written++;
    if (written % 100 === 0) console.log(`  yazıldı: ${written}`);
  }

  console.log(`\nÖzet: aday=${rows.length} işlenen=${processed} (structured=${structuredCount}, generic=${genericCount}) yazıldı=${written}`);
  if (!dryRun && written > 0) {
    console.log(`\nSonraki adım — enrich edilmiş chunk'ları yeniden embed kuyruğuna sok:`);
    console.log(`  psql -c "UPDATE knowledge_chunks SET embedding_status='stale' WHERE content_enriched IS NOT NULL AND embedding_status='ok';"`);
    console.log(`  curl -ksf -X POST "https://127.0.0.1:10443/api/rag/retry-embeddings?limit=5000"`);
    console.log(`  (RAG_SETTINGS.useEnrichedContent=true UI'dan açık olmalı.)`);
  }

  await pool.end();
})().catch((e) => {
  console.error("HATA:", e.message || e);
  process.exit(1);
});

