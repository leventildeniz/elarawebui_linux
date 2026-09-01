#!/usr/bin/env node
// backfill-parse-quality.mjs — content-derived quality classification for the
// 6745+ legacy rows whose parse_quality is NULL after the migration. No refetch,
// no embedding, no MLX. Pure UPDATE based on existing content length.
//
// Usage:
//   node local-server/scripts/backfill-parse-quality.mjs           # DRY-RUN
//   node local-server/scripts/backfill-parse-quality.mjs --apply
//
// Rules (vendor-agnostic, regex-free):
//   chars >= 200 → 'ok'
//   chars >=  80 → 'thin'
//   else         → 'low'
// parser_used    → 'legacy' if NULL (so reprocess targeter can distinguish
//                  pre-migration rows from new-pipeline rows).
// title          → name if NULL/empty.
// char_count     → LENGTH(content).
// chunk_count    → chunks.
// fts            → generated column (touched implicitly via UPDATE if non-generated).

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.DOTENV_CONFIG_PATH = path.resolve(HERE, "..", ".env");

const APPLY = process.argv.includes("--apply");
const DATABASE_URL = process.env.DATABASE_URL || process.env.PG_URL;
if (!DATABASE_URL) { console.error("FATAL: DATABASE_URL missing"); process.exit(2); }
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

(async () => {
  console.log(`# backfill-parse-quality   mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  // Preview impact
  const preview = await pool.query(`
    SELECT
      CASE
        WHEN COALESCE(LENGTH(content),0) >= 200 THEN 'ok'
        WHEN COALESCE(LENGTH(content),0) >=  80 THEN 'thin'
        ELSE 'low'
      END AS new_quality,
      COUNT(*)::int AS n
    FROM knowledge_sources
    WHERE parse_quality IS NULL
    GROUP BY 1
    ORDER BY n DESC
  `);

  if (!preview.rows.length) {
    console.log("Tüm satırların parse_quality değeri zaten dolu. Yapacak iş yok.");
    await pool.end();
    return;
  }

  console.log("\nÖngörülen sınıflama:");
  console.log("─".repeat(40));
  preview.rows.forEach(r => console.log(`  ${String(r.new_quality).padEnd(8)} ${r.n}`));
  const total = preview.rows.reduce((s, r) => s + r.n, 0);
  console.log(`  ${"toplam".padEnd(8)} ${total}`);

  if (!APPLY) {
    console.log("\nDRY-RUN. Uygulamak için: --apply");
    await pool.end();
    return;
  }

  console.log("\nUygulanıyor…");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(`
      UPDATE knowledge_sources SET
        char_count    = COALESCE(LENGTH(content), 0),
        parse_quality = CASE
          WHEN COALESCE(LENGTH(content),0) >= 200 THEN 'ok'
          WHEN COALESCE(LENGTH(content),0) >=  80 THEN 'thin'
          ELSE 'low'
        END,
        parser_used   = COALESCE(parser_used, 'legacy'),
        title         = COALESCE(NULLIF(title,''), name),
        chunk_count   = COALESCE(chunks, 0)
      WHERE parse_quality IS NULL
    `);
    await c.query("COMMIT");
    console.log(`✓ Güncellenen satır: ${r.rowCount}`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("HATA, rollback:", e.message || e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
