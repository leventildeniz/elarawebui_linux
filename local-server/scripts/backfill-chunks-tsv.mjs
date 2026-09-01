#!/usr/bin/env node
// backfill-chunks-tsv.mjs — legacy compatibility checker.
//
// knowledge_chunks.tsv is now a PostgreSQL GENERATED column. There is no
// backfill UPDATE to run; this script verifies the invariant instead.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

// Load local-server/.env BEFORE constructing the pg pool so this script sees
// the same DATABASE_URL as the middleware (server.mjs uses the same file).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(HERE, "..", ".env");
dotenv.config({ path: ENV_PATH });
process.env.DOTENV_CONFIG_PATH = ENV_PATH;

const DATABASE_URL = process.env.DATABASE_URL || process.env.PG_URL;
if (!DATABASE_URL) { console.error(`FATAL: DATABASE_URL missing (looked in ${ENV_PATH})`); process.exit(2); }
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

(async () => {
  console.log("# backfill-chunks-tsv   mode=CHECK   generated-column invariant");
  const gen = await pool.query(`
    SELECT COALESCE(MAX((a.attgenerated = 's')::int), 0)::int AS generated
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relname='knowledge_chunks' AND a.attname='tsv' AND NOT a.attisdropped`);
  const cov = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE tsv IS NOT NULL)::int AS has_tsv,
           ROUND(100.0 * COUNT(*) FILTER (WHERE tsv IS NOT NULL) / NULLIF(COUNT(*),0), 2) AS pct
      FROM knowledge_chunks`);
  const idx = await pool.query(`
    SELECT indexname FROM pg_indexes
     WHERE schemaname='public' AND tablename='knowledge_chunks'
       AND indexdef ILIKE '%USING gin%' AND indexdef ILIKE '%tsv%'`);
  const sample = await pool.query(`
    SELECT COUNT(*)::int AS n FROM knowledge_chunks
     WHERE tsv @@ to_tsquery('simple', 'api:* | vpn:* | server:* | rules:*')`);

  const c = cov.rows[0] || {};
  console.log(`tsv generated : ${Number(gen.rows[0]?.generated || 0) === 1 ? "yes" : "NO"}`);
  console.log(`tsv coverage  : ${c.pct || 0}% (${c.has_tsv || 0}/${c.total || 0})`);
  console.log(`GIN indexes   : ${idx.rows.map(r => r.indexname).join(", ") || "NONE"}`);
  console.log(`FTS sample    : ${sample.rows[0]?.n || 0} rows`);

  const ok = Number(gen.rows[0]?.generated || 0) === 1 && Number(c.pct || 0) >= 99 && idx.rows.length > 0 && Number(sample.rows[0]?.n || 0) > 0;
  await pool.end();
  if (!ok) {
    console.error("\n✗ RAG FTS invariant failed. Restart middleware so ensureKnowledgeChunksTable() can migrate tsv to GENERATED, then rerun.");
    process.exit(1);
  }
  console.log("\n✓ RAG FTS invariant OK. No backfill needed.");
})().catch(e => { console.error("FATAL:", e); process.exit(1); });