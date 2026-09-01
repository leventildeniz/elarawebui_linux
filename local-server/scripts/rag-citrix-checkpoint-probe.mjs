#!/usr/bin/env node
// One-shot diagnostic for the Citrix/Checkpoint visibility issue.
// Uses x-admin-token (read from ../.env) so no browser cookie required.
//
// Usage:
//   node local-server/scripts/rag-citrix-checkpoint-probe.mjs
//   ELARA_API_BASE=http://127.0.0.1:3005       node ...  # (default) HTTP direct → middleware
//   ELARA_API_BASE=https://elara.local:10443 node ... # via TLS proxy (self-signed)
//
// Outputs: worker status, per-query RAG debug (Citrix + Checkpoint),
// chunk-report for netscaler_api, knowledge_sources filter, and a summary.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Default to HTTP direct on loopback — bypasses TLS proxy / self-signed cert noise.
const BASE = process.env.ELARA_API_BASE || process.env.BASE || "http://127.0.0.1:3005";
const ENV_FILE = path.join(__dirname, "..", ".env");

// Only disable TLS check when actually hitting HTTPS (self-signed local cert).
if (BASE.startsWith("https:")) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

console.log(`[probe] BASE = ${BASE}`);

function loadAdminToken() {
  if (!fs.existsSync(ENV_FILE)) return "";
  const txt = fs.readFileSync(ENV_FILE, "utf8");
  const m = txt.match(/^ADMIN_API_TOKEN=(.*)$/m);
  return m ? m[1].replace(/^['"]|['"]$/g, "").trim() : "";
}

const TOKEN = loadAdminToken();
if (!TOKEN) {
  console.error("[probe] ADMIN_API_TOKEN missing in", ENV_FILE);
  console.error("        generate:  openssl rand -hex 32");
  process.exit(1);
}

async function call(method, p, body) {
  const url = `${BASE}${p}`;
  const headers = { "x-admin-token": TOKEN };
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave raw */ }
  return { status: r.status, json, text };
}

const sep = (s) => console.log(`\n━━━ ${s} ${"━".repeat(Math.max(0, 70 - s.length))}`);

const CITRIX_Q = [
  "citrix adc interface ip",
  "netscaler vpx initial config",
  "citrix gateway certificate install",
];
const CHECKPOINT_Q = [
  "checkpoint interface ip nasıl verilir",
  "checkpoint cluster sync member",
];

async function waitWorkerHealthy(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await call("GET", "/api/system/worker/status");
    last = r.json;
    if (r.json?.healthy) return r.json;
    if (r.json?.locked) return r.json; // circuit breaker; no point polling
    process.stdout.write(".");
    await new Promise(rr => setTimeout(rr, 2000));
  }
  return last;
}

(async () => {
  sep("0. Worker start (kick + poll until healthy)");
  const start = await call("POST", "/api/system/worker/start");
  console.log("  start →", JSON.stringify(start.json ?? start.text));
  const ready = await waitWorkerHealthy(180_000);
  console.log("\n  ready →", JSON.stringify(ready, null, 2));
  if (!ready?.healthy) {
    console.error("\n[probe] worker hazır değil — RAG probe çalıştırılmadan duruyorum.");
    console.error("        lastError:", ready?.lastError);
    console.error("        lastEmbedError:", ready?.lastEmbedError);
    process.exit(2);
  }

  sep("1. Worker status");
  const ws = await call("GET", "/api/system/worker/status");
  console.log(JSON.stringify(ws.json ?? ws.text, null, 2));

  sep("2. RAG settings (from /api/rag/debug)");
  const settingsProbe = await call("GET", `/api/rag/debug?q=${encodeURIComponent("ping")}`);
  console.log(JSON.stringify(settingsProbe.json?.settings ?? settingsProbe.text, null, 2));

  const results = [];
  for (const q of [...CITRIX_Q, ...CHECKPOINT_Q]) {
    sep(`3. RAG debug · "${q}"`);
    const r = await call("GET", `/api/rag/debug?q=${encodeURIComponent(q)}`);
    const p = r.json?.probe || {};
    console.log(`  decision=${p.decision}  reason=${p.reason}  top1=${p.top1}  top4=${p.top4}  margin=${p.margin}  tau=${p.tau}  rows=${(p.rows||[]).length}`);
    if (p.embedError) console.log(`  embedError →`, JSON.stringify(p.embedError));
    if (p.rows && p.rows.length) {
      for (const row of p.rows.slice(0, 3)) {
        console.log(`     · ${row.score}  ${row.brand || "-"}  ${row.file}#${row.ord}  ${row.preview?.slice(0,70)}`);
      }
    }
    results.push({ q, ...p, rowCount: (p.rows||[]).length });
  }

  sep("4. knowledge/chunk-report (netscaler_api search)");
  const cr = await call("GET", "/api/knowledge/chunk-report?search=netscaler");
  console.log(JSON.stringify(cr.json ?? cr.text, null, 2).slice(0, 2000));

  sep("5. knowledge/sources (search: citrix|cloudflare|python)");
  for (const term of ["citrix", "netscaler", "cloudflare", "python"]) {
    const s = await call("GET", `/api/knowledge/sources?search=${encodeURIComponent(term)}&limit=5`);
    const items = s.json?.items || s.json?.sources || s.json || [];
    const n = Array.isArray(items) ? items.length : (items.total ?? "?");
    console.log(`  ${term.padEnd(10)} → status=${s.status}  count=${n}`);
  }

  sep("6. Summary");
  console.log("query".padEnd(45), "decision".padEnd(10), "reason".padEnd(14), "top1   top4   rows");
  for (const r of results) {
    console.log(
      String(r.q).slice(0, 44).padEnd(45),
      String(r.decision || "-").padEnd(10),
      String(r.reason || "-").padEnd(14),
      String(r.top1 ?? "-").padEnd(6),
      String(r.top4 ?? "-").padEnd(6),
      String(r.rowCount ?? "-"),
    );
  }

  // Re-check worker — if uptime fell, worker died mid-run.
  const ws2 = await call("GET", "/api/system/worker/status");
  console.log("\nworker after run:", JSON.stringify(ws2.json ?? ws2.text));

  const embedMiss = results.filter(r => r.reason === "embed_miss").length;
  if (embedMiss) {
    console.log(`\n[!] ${embedMiss}/${results.length} sorgu embed_miss aldı → worker tarafında problem. .env'de EMBED_WORKER_MAX_RSS_GB=4.0 ayarla ve middleware'i restart et.`);
  }
})().catch((e) => { console.error("[probe] FATAL", e); process.exit(1); });
