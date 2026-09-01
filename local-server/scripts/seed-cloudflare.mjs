#!/usr/bin/env node
// Seed Cloudflare docs into the knowledge base.
// Usage: node local-server/scripts/seed-cloudflare.mjs
// Optional: BASE=http://127.0.0.1:3005 RECURSIVE=1 MAX_PAGES=800 MAX_DEPTH=4

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, "..", ".env"), override: false });

const BASE = process.env.BASE || process.env.MIDDLEWARE_BASE || "http://127.0.0.1:3005";
const RECURSIVE = process.env.RECURSIVE !== "0";
const MAX_PAGES = Number(process.env.MAX_PAGES || 800);
const MAX_DEPTH = Number(process.env.MAX_DEPTH || 4);

// Loopback admin-token bypass (see local-server/lib/session-gate.mjs:42-72).
// ADMIN_API_TOKEN must match the server's env value. Auto-load from
// local-server/.env if not exported in the shell.
let ADMIN_TOKEN = String(process.env.ADMIN_API_TOKEN || "").trim();
if (!ADMIN_TOKEN) {
  console.error("ADMIN_API_TOKEN bulunamadı. Çözüm:");
  console.error("  ADMIN_API_TOKEN=$(grep ADMIN_API_TOKEN local-server/.env | cut -d= -f2-) \\");
  console.error("    node local-server/scripts/seed-cloudflare.mjs");
  process.exit(1);
}

const URLS = [
  "https://developers.cloudflare.com/waf/",
  "https://developers.cloudflare.com/fundamentals/",
  "https://developers.cloudflare.com/api/",
  "https://developers.cloudflare.com/ddos-protection/",
  "https://developers.cloudflare.com/ssl/",
];

async function postJson(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": ADMIN_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: r.status, json };
}

async function getJson(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "x-admin-token": ADMIN_TOKEN },
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: r.status, json };
}

async function checkAdminTokenDiag() {
  try {
    const diag = await getJson("/api/system/diag/admin-token");
    if (diag.status !== 200 || !diag.json?.configured) {
      console.warn(`[diag] server ADMIN_API_TOKEN görünmüyor (status=${diag.status}). Server restart/env kontrol et.`);
      return;
    }
    if (Number(diag.json.len) !== ADMIN_TOKEN.length) {
      console.warn(`[diag] token uzunluğu uyuşmuyor: script=${ADMIN_TOKEN.length} server=${diag.json.len}. Server eski env ile çalışıyor olabilir; local-server'ı restart et.`);
      return;
    }
    console.log(`[diag] server admin-token configured len=${diag.json.len} (script ile uyumlu)`);
  } catch (e) {
    console.warn(`[diag] admin-token tanısı alınamadı: ${e?.message || e}`);
  }
}

async function seedOne(url) {
  console.log(`\n[seed] → ${url}`);
  const fetched = await postJson("/api/knowledge/fetch", { url });
  if (!fetched.json?.ok) {
    console.error(`  ✗ fetch failed: ${fetched.status} ${JSON.stringify(fetched.json).slice(0,300)}`);
    return null;
  }
  const id = fetched.json.id;
  console.log(`  ✓ ingested id=${id} chunks=${fetched.json.chunks} brand=${fetched.json.brand}`);

  if (!RECURSIVE) return id;

  const cfgRes = await postJson(`/api/knowledge/source/${id}/crawl-config`, {
    crawl_config: {
      recursive: true,
      max_pages: MAX_PAGES,
      max_depth: MAX_DEPTH,
      same_host: true,
    },
  });
  if (!cfgRes.json?.ok) {
    console.error(`  ✗ crawl-config failed: ${cfgRes.status} ${JSON.stringify(cfgRes.json).slice(0,300)}`);
    return id;
  }
  console.log(`  ✓ crawl_config recursive max_pages=${MAX_PAGES} max_depth=${MAX_DEPTH}`);

  const syncRes = await postJson("/api/knowledge/sync-source", { id });
  if (!syncRes.json?.ok) {
    console.error(`  ✗ sync-source failed: ${syncRes.status} ${JSON.stringify(syncRes.json).slice(0,300)}`);
    return id;
  }
  console.log(`  ✓ sync queued jobId=${syncRes.json.jobId} → poll ${BASE}${syncRes.json.poll}`);
  return id;
}

(async () => {
  console.log(`[seed-cloudflare] base=${BASE} auth=admin-token(len=${ADMIN_TOKEN.length}) recursive=${RECURSIVE} max_pages=${MAX_PAGES} max_depth=${MAX_DEPTH}`);
  await checkAdminTokenDiag();
  const ids = [];
  for (const u of URLS) {
    try { const id = await seedOne(u); if (id) ids.push(id); }
    catch (e) { console.error(`  ✗ exception: ${e?.message || e}`); }
  }
  console.log(`\n[seed-cloudflare] done. seeded=${ids.length}/${URLS.length}`);
  console.log(`Tip: brand auto-tags via deriveBrandFromUrl (hostname → 'cloudflare').`);
  console.log(`     Run brand-backfill if any URLs ended up untagged:`);
  console.log(`     node local-server/scripts/brand-backfill.mjs --apply`);
})();
