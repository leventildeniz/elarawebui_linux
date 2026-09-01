#!/usr/bin/env node
// ===========================================================================
// scripts/backfill-product.mjs
// ---------------------------------------------------------------------------
// One-shot backfill: populate knowledge_chunks.product / product_category /
// doc_version using lib/product-extract.mjs.
//
// Reads (brand, root, path) from rows where product IS NULL and UPDATEs in
// batches. No embeddings touched, no enrichment recomputed.
//
// Usage:
//   bun run local-server/scripts/backfill-product.mjs           # backfill NULLs
//   bun run local-server/scripts/backfill-product.mjs --all     # force re-extract
//   bun run local-server/scripts/backfill-product.mjs --limit 1000
//   bun run local-server/scripts/backfill-product.mjs --dry-run
// ===========================================================================

import pg from "pg";
import { extractProduct } from "../lib/product-extract.mjs";

const argv = new Set(process.argv.slice(2));
const flag = (name) => argv.has(name);
const argVal = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};

const DRY = flag("--dry-run");
const ALL = flag("--all");
const LIMIT = Number(argVal("--limit")) || 0; // 0 = unlimited
const BATCH = Number(argVal("--batch")) || 1000;

const DATABASE_URL = process.env.DATABASE_URL || process.env.PG_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

async function countTarget() {
  const where = ALL ? "" : "WHERE product IS NULL";
  const r = await pool.query(`SELECT COUNT(*)::bigint AS n FROM knowledge_chunks ${where}`);
  return Number(r.rows[0].n);
}

async function fetchBatch(lastId) {
  const where = ALL
    ? "WHERE id > $1"
    : "WHERE product IS NULL AND id > $1";
  const sql = `
    SELECT id, brand, root, path
      FROM knowledge_chunks
      ${where}
     ORDER BY id ASC
     LIMIT $2`;
  const r = await pool.query(sql, [lastId, BATCH]);
  return r.rows;
}

async function applyBatch(updates) {
  if (!updates.length) return 0;
  // Use unnest for one round-trip per batch.
  const ids = updates.map((u) => u.id);
  const products = updates.map((u) => u.product);
  const cats = updates.map((u) => u.category);
  const versions = updates.map((u) => u.version);
  const sql = `
    UPDATE knowledge_chunks AS kc SET
      product          = COALESCE(u.product, kc.product),
      product_category = COALESCE(u.category, kc.product_category),
      doc_version      = COALESCE(u.version, kc.doc_version)
    FROM (
      SELECT unnest($1::bigint[]) AS id,
             unnest($2::text[])   AS product,
             unnest($3::text[])   AS category,
             unnest($4::text[])   AS version
    ) AS u
    WHERE kc.id = u.id`;
  if (DRY) return updates.length;
  const r = await pool.query(sql, [ids, products, cats, versions]);
  return r.rowCount;
}

async function main() {
  const total = await countTarget();
  console.log(`[backfill-product] target rows: ${total} (all=${ALL}, dry=${DRY}, batch=${BATCH}, limit=${LIMIT || "∞"})`);
  let lastId = 0;
  let processed = 0;
  let updated = 0;
  const t0 = Date.now();
  while (true) {
    if (LIMIT && processed >= LIMIT) break;
    const rows = await fetchBatch(lastId);
    if (!rows.length) break;
    const updates = rows.map((row) => {
      const { product, category, version } = extractProduct({
        brand: row.brand,
        path: row.path,
        filename: null,
      });
      return { id: row.id, product, category, version };
    });
    const n = await applyBatch(updates);
    updated += n;
    processed += rows.length;
    lastId = rows[rows.length - 1].id;
    if (processed % (BATCH * 10) === 0 || rows.length < BATCH) {
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  …processed=${processed} updated=${updated} lastId=${lastId} elapsed=${dt}s`);
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[backfill-product] done. processed=${processed} updated=${updated} elapsed=${dt}s`);

  // Smoke summary
  const summary = await pool.query(`
    SELECT brand, product, COUNT(*)::int AS n
      FROM knowledge_chunks
     WHERE product IS NOT NULL
     GROUP BY brand, product
     ORDER BY brand, n DESC
     LIMIT 40`);
  console.log("\n[summary] brand × product (top 40):");
  for (const r of summary.rows) {
    console.log(`  ${String(r.brand || "-").padEnd(14)} ${String(r.product).padEnd(28)} ${r.n}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("[backfill-product] FAILED:", e);
  process.exit(1);
});
