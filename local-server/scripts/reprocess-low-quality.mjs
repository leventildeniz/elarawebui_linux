#!/usr/bin/env node
// reprocess-low-quality.mjs — targeted re-extract for sources whose first-pass
// parse failed under the old regex pipeline. Uses the running server's HTTP
// API (no in-process re-import of the parser) so the new jsdom+Readability +
// schema-aware JSON walker handle the content end-to-end.
//
// Strategy:
//   - List knowledge_sources where parse_quality IN ('low','extract-failed')
//     OR parser_used IS NULL (legacy).
//   - For type='url' rows: POST /api/knowledge/fetch with the stored URL.
//   - For type='file' rows: skip with a note — original upload bytes are not
//     retained; the operator must re-upload.
//
// Usage:
//   node local-server/scripts/reprocess-low-quality.mjs              # DRY-RUN
//   node local-server/scripts/reprocess-low-quality.mjs --apply
//   node local-server/scripts/reprocess-low-quality.mjs --apply --limit 50

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.DOTENV_CONFIG_PATH = path.resolve(HERE, "..", ".env");

const APPLY = process.argv.includes("--apply");
const limitArgIdx = process.argv.indexOf("--limit");
const LIMIT = limitArgIdx > 0 ? Math.max(1, Number(process.argv[limitArgIdx + 1]) || 100) : 100;
const SERVER = (process.env.ELARA_API_BASE || process.env.LOCAL_SERVER_URL || "http://127.0.0.1:3005").replace(/\/$/, "");
const SKIP_DIR_INDEX = !process.argv.includes("--no-skip-dir-index");

const DATABASE_URL = process.env.DATABASE_URL || process.env.PG_URL;
if (!DATABASE_URL) { console.error("FATAL: DATABASE_URL missing"); process.exit(2); }
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

(async () => {
  console.log(`# reprocess-low-quality   mode=${APPLY ? "APPLY" : "DRY-RUN"}   limit=${LIMIT}   server=${SERVER}   skip-dir-index=${SKIP_DIR_INDEX}`);

  // Health probe — refuse to spray fetches if server is down.
  if (APPLY) {
    try {
      const hr = await fetch(`${SERVER}/api/system/worker/status`, { signal: AbortSignal.timeout(5000) });
      if (!hr.ok && hr.status !== 401 && hr.status !== 403) throw new Error(`HTTP ${hr.status}`);
    } catch (e) {
      console.error(`FATAL: server unreachable at ${SERVER} (${e.message || e}). Aborting before fetch spray.`);
      console.error("Set ELARA_API_BASE to the correct origin (e.g. http://127.0.0.1:3005).");
      await pool.end(); process.exit(2);
    }
  }

  const skipClause = SKIP_DIR_INDEX ? `AND name NOT ILIKE 'Index of %'` : "";
  const { rows } = await pool.query(`
    SELECT id, name, type, url, tag, parser_used, parse_quality, char_count, chunk_count
      FROM knowledge_sources
     WHERE COALESCE(superseded_by,'') = ''
       AND ( parse_quality IN ('low','extract-failed')
          OR parser_used IS NULL
          OR COALESCE(char_count, 0) < 80 )
       ${skipClause}
     ORDER BY created_at DESC NULLS LAST
     LIMIT $1
  `, [LIMIT]);

  if (!rows.length) { console.log("Tüm kaynaklar zaten kaliteli. Yapacak iş yok."); await pool.end(); return; }

  console.log(`\nİşlenecek aday: ${rows.length}`);
  const byType = rows.reduce((a, r) => (a[r.type||"?"] = (a[r.type||"?"]||0) + 1, a), {});
  console.log("Tipler:", byType);

  async function fetchOnce(url) {
    return fetch(`${SERVER}/api/knowledge/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(90000),
    });
  }

  let ok = 0, fail = 0, skipped = 0;
  for (const r of rows) {
    const tag = `[${r.type}] ${r.name}`.slice(0, 80);
    if (r.type === "url" && r.url) {
      if (!APPLY) { console.log(`  · ${tag}  →  WOULD refetch ${r.url}`); continue; }
      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const resp = await fetchOnce(r.url);
          const j = await resp.json().catch(() => ({}));
          if (j?.ok) { ok++; console.log(`  ✓ ${tag}  parser=${j.parser||"?"} chunks=${j.chunks||0}`); lastErr = null; break; }
          lastErr = j?.error || ("HTTP " + resp.status);
        } catch (e) { lastErr = e.message || String(e); }
        if (attempt === 1) await new Promise(rr => setTimeout(rr, 1500));
      }
      if (lastErr) { fail++; console.log(`  ✗ ${tag}  ${lastErr}`); }
    } else {
      skipped++;
      if (!APPLY) console.log(`  · ${tag}  →  SKIP (type=${r.type} needs manual re-upload)`);
    }
  }

  console.log(`\nÖzet: ok=${ok} fail=${fail} skipped=${skipped}  (mode=${APPLY ? "APPLY" : "DRY-RUN"})`);
  await pool.end();
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
