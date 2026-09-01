#!/usr/bin/env node
// dedupe-chunks.mjs — knowledge_chunks içinden aynı (file_id, ord) için
// duplicate satırları siler; her grupta en yüksek id'yi tutar.
//
// Kullanım:
//   node local-server/scripts/dedupe-chunks.mjs           # DRY-RUN
//   node local-server/scripts/dedupe-chunks.mjs --apply   # gerçek DELETE
//
// Idempotent. Aynı zamanda WebUI'deki "Dedupe chunks" butonu da bunu çağırır
// (POST /api/rag/dedupe-chunks).

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.DOTENV_CONFIG_PATH = path.resolve(HERE, "..", ".env");

const APPLY = process.argv.includes("--apply");
const DATABASE_URL = process.env.DATABASE_URL || process.env.PG_URL;
if (!DATABASE_URL) { console.error("FATAL: DATABASE_URL .env'de yok."); process.exit(2); }

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

(async () => {
  console.log(`# dedupe-chunks   mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const { rows: stat } = await pool.query(`
    SELECT COUNT(*)::int AS dup_groups,
           COALESCE(SUM(c-1),0)::int AS excess_rows
      FROM (SELECT COUNT(*) AS c FROM knowledge_chunks GROUP BY file_id, ord HAVING COUNT(*) > 1) s
  `);
  console.log(`Duplicate gruplar : ${stat[0].dup_groups}`);
  console.log(`Silinecek satır  : ${stat[0].excess_rows}`);

  if (stat[0].excess_rows === 0) { console.log("Temiz. Yapacak iş yok."); await pool.end(); return; }
  if (!APPLY) { console.log("DRY-RUN. Uygulamak için: --apply"); await pool.end(); return; }

  const sample = await pool.query(`
    SELECT file_id, ord, COUNT(*)::int AS copies
      FROM knowledge_chunks
     GROUP BY file_id, ord
    HAVING COUNT(*) > 1
     ORDER BY copies DESC LIMIT 10
  `);
  console.log("İlk 10 grup:");
  sample.rows.forEach((r) => console.log(`  file_id=${r.file_id} ord=${r.ord} copies=${r.copies}`));

  const del = await pool.query(`
    DELETE FROM knowledge_chunks a
     USING knowledge_chunks b
     WHERE a.file_id = b.file_id AND a.ord = b.ord AND a.id < b.id
  `);
  console.log(`✓ DELETE: ${del.rowCount} satır`);
  await pool.end();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
