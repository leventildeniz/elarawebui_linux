#!/usr/bin/env node
// brand-aliases-smoke.mjs — Brand Aliases panel & API smoke test.
//
// Verifies:
//   1) GET /api/rag/brand-aliases responds OK
//   2) Brand list is DB-driven (JSON-only brands are NOT shown)
//   3) Ghost / system brands (prefix "_") are hidden
//   4) Expected default aliases are wired for known brands
//   5) Response shape includes reenrichedAt + stale + reenrichJob
//   6) netscaler_api still wired to Citrix aliases (regression guard)
//
// NOTE: Step 2 mutates brand-aliases.json briefly (adds a sentinel key,
// confirms it never reaches the API, then removes it). Atomic + reversible.
//
// Usage:
//   bun local-server/scripts/brand-aliases-smoke.mjs
//   bun local-server/scripts/brand-aliases-smoke.mjs --base https://elara.local:10443

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBrandAliasesPath } from "../lib/state-paths.mjs";

let BASE = process.env.SMOKE_BASE || "https://elara.local:10443";
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base") BASE = args[++i];
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALIASES_PATH = getBrandAliasesPath();
const SENTINEL = "__SMOKE_FAKE_BRAND__";

const EXPECTED_ALIASES = {
  netscaler_api: ["citrix", "citrix adc", "netscaler"],
  Fortigate_DOC: ["fortigate", "fortinet", "fortios"],
  a10_harvest:   ["a10", "thunder adc"],
  cloudflare:    ["cloudflare", "cf"],
  Checkpoint:    ["checkpoint", "check point", "gaia"],
  python:        ["python", "python3", "pip"],
};

let pass = 0, fail = 0;
const log = (ok, msg, extra) => {
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${tag}  ${msg}${extra ? "  — " + extra : ""}`);
  ok ? pass++ : fail++;
};

const readJson = () => JSON.parse(fs.readFileSync(ALIASES_PATH, "utf8"));
const writeJson = (obj) => {
  const tmp = ALIASES_PATH + ".smoketmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, ALIASES_PATH);
};
const fetchList = async () => {
  const r = await fetch(`${BASE}/api/rag/brand-aliases`, { signal: AbortSignal.timeout(10000) });
  const body = await r.json();
  if (!r.ok || !body.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
};

(async () => {
  console.log(`\n# Brand Aliases Smoke   base=${BASE}\n`);

  // ---- 1) reachability
  let body;
  try {
    body = await fetchList();
    log(true, "GET /api/rag/brand-aliases responds OK", `${body.brands.length} brands`);
  } catch (e) {
    console.log(`\n  \x1b[31mFAIL\x1b[0m  cannot reach ${BASE} — ${e.message}\n`);
    console.log(`  Hint: middleware on https://elara.local:10443 (LAN) or http://localhost:3005.\n`);
    process.exit(2);
  }

  const byName = new Map(body.brands.map(b => [b.name, b]));

  // ---- 2) DB-only guarantee: inject sentinel into JSON, confirm absent
  console.log("\n  -- DB-only guarantee (JSON-only brand must NOT appear) --");
  const original = readJson();
  let mutationOk = false;
  try {
    const mutated = { ...original, [SENTINEL]: { aliases: ["smoke"], updated_at: new Date().toISOString() } };
    writeJson(mutated);
    mutationOk = true;
    const after = await fetchList();
    const found = after.brands.some(b => b.name === SENTINEL);
    log(!found, `JSON-only brand "${SENTINEL}" rejected by API (not in DB)`);
  } catch (e) {
    log(false, `DB-only check threw: ${e.message}`);
  } finally {
    if (mutationOk) {
      try { writeJson(original); log(true, "alias JSON restored to original state"); }
      catch (e) { log(false, `CRITICAL: failed to restore ${ALIASES_PATH} — ${e.message}`); }
    }
  }

  // ---- 3) Ghost / system brand filter
  console.log("\n  -- ghost brand filter (prefix '_' must be hidden) --");
  const ghost = body.brands.filter(b => b.name.startsWith("_"));
  log(ghost.length === 0, "no underscore-prefixed brands in panel",
    ghost.length ? `leaked: ${ghost.map(g => g.name).join(", ")}` : "clean");

  // ---- 4) Alias defaults for known brands
  console.log("\n  -- alias defaults (JSON override, brand must exist in DB) --");
  for (const [brand, expected] of Object.entries(EXPECTED_ALIASES)) {
    const row = byName.get(brand);
    if (!row) { log(false, `${brand}: brand not in DB (skip — add data or remove from expected list)`); continue; }
    const got = new Set((row.aliases || []).map(s => s.toLowerCase()));
    const missing = expected.filter(a => !got.has(a.toLowerCase()));
    log(missing.length === 0, `${brand}: aliases [${expected.join(", ")}]`,
      missing.length ? `missing: ${missing.join(", ")}` : `${row.aliases.length} total`);
  }

  // ---- 5) Response shape
  console.log("\n  -- row shape (chunkCount + lastEnrichedAt + reenrichedAt + stale + aliases + reenrichJob) --");
  for (const b of body.brands) {
    const shapeOk = typeof b.chunkCount === "number"
      && (b.lastEnrichedAt === null || typeof b.lastEnrichedAt === "string")
      && ("reenrichedAt" in b)
      && typeof b.stale === "boolean"
      && Array.isArray(b.aliases)
      && ("reenrichJob" in b);
    log(shapeOk, `${b.name}: shape ok (chunks=${b.chunkCount}, enriched=${b.lastEnrichedAt ? "yes" : "never"}, reenriched=${b.reenrichedAt ? "yes" : "never"}, stale=${b.stale}, aliases=${b.aliases.length})`);
  }

  // ---- 6) Citrix regression guard
  console.log("\n  -- regression: netscaler_api still wired to Citrix --");
  const ns = byName.get("netscaler_api");
  if (!ns) {
    log(false, "netscaler_api missing from DB — Citrix retrieval will fail");
  } else {
    log(ns.aliases.some(a => a.toLowerCase() === "citrix"), "citrix alias present");
    log(ns.aliases.some(a => a.toLowerCase() === "citrix adc"), "citrix adc alias present");
  }

  // ---- 7) fortinet_kb must NOT exist (legacy remnant cleaned up)
  console.log("\n  -- regression: fortinet_kb removed (legacy) --");
  log(!byName.has("fortinet_kb"), "fortinet_kb absent from panel (DB + JSON cleaned)");

  // ---- 8) Stale badge sanity: brands with reenrichedAt MUST be stale=false
  //         unless aliasesUpdatedAt > reenrichedAt (user edited after re-enrich).
  console.log("\n  -- stale badge sanity (reenriched + no later edit ⇒ stale=false) --");
  for (const b of body.brands) {
    if (!b.reenrichedAt) continue;
    const editedAfter = b.aliasesUpdatedAt && new Date(b.aliasesUpdatedAt) > new Date(b.reenrichedAt);
    const expected = !!editedAfter;
    log(b.stale === expected,
      `${b.name}: stale=${b.stale} (expected ${expected}; reenriched=${b.reenrichedAt}, updated=${b.aliasesUpdatedAt || "—"})`);
  }

  console.log(`\n# Result: ${pass} pass, ${fail} fail\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL:", e); process.exit(2); });
