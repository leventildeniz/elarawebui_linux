#!/usr/bin/env node
// scripts/migrate-url-recursive.mjs
// One-shot: every type='url' root row that has no crawl_config gets the
// "standard" recursive preset. Does NOT trigger any crawl — users still
// hit Sync manually (or via Deep-Sync) when ready.
//
// Usage:
//   node scripts/migrate-url-recursive.mjs           # dry-run
//   node scripts/migrate-url-recursive.mjs --apply   # write
//   node scripts/migrate-url-recursive.mjs --apply --preset=deep
//
// Presets:
//   single   → { recursive: false }
//   standard → depth 5,  pages 2000,  concurrency 6   (DEFAULT)
//   deep     → depth 8,  pages 10000, concurrency 8

import pg from "pg";

const PRESETS = {
  single:   { recursive: false },
  standard: { recursive: true,  maxDepth: 5, maxPages: 2000,  concurrency: 6, maxTotalBytes: 500 * 1024 * 1024, timeBudgetMs: 30 * 60 * 1000, respectRobots: true, skipNoindex: true, preset: "standard" },
  deep:     { recursive: true,  maxDepth: 8, maxPages: 10000, concurrency: 8, maxTotalBytes: 2  * 1024 * 1024 * 1024, timeBudgetMs: 2 * 60 * 60 * 1000, respectRobots: true, skipNoindex: true, preset: "deep" },
};

const args   = new Set(process.argv.slice(2));
const apply  = args.has("--apply");
const presetArg = [...args].find((a) => a.startsWith("--preset="))?.split("=")[1] || "standard";
const preset = PRESETS[presetArg];
if (!preset) { console.error(`unknown preset: ${presetArg} (use single|standard|deep)`); process.exit(2); }

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgres://elara@127.0.0.1:5432/apex_db",
});

const { rows } = await pool.query(
  `SELECT id, name, url
     FROM knowledge_sources
    WHERE type = 'url'
      AND parent_id IS NULL
      AND crawl_config IS NULL`
);

console.log(`[migrate] candidate URL roots without crawl_config: ${rows.length}`);
console.log(`[migrate] preset = ${presetArg}  →`, preset);

if (!apply) {
  for (const r of rows.slice(0, 20)) console.log(` · ${r.id.slice(0, 8)}  ${r.name}  ${r.url}`);
  if (rows.length > 20) console.log(` … +${rows.length - 20} more`);
  console.log("\n(dry-run — re-run with --apply to persist)");
  await pool.end();
  process.exit(0);
}

let n = 0;
for (const r of rows) {
  await pool.query(`UPDATE knowledge_sources SET crawl_config=$2 WHERE id=$1`, [r.id, JSON.stringify(preset)]);
  n++;
}
console.log(`[migrate] updated ${n} rows`);
await pool.end();
