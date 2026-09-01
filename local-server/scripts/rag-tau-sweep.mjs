#!/usr/bin/env node
// rag-tau-sweep.mjs — Doğru `injectThreshold` (tau) değerini bul.
//
// 6 sorgu: 3'ü kütüphanedeki brand'lere ait (true positive beklenir),
// 3'ü kütüphanede OLMAYAN brand'lere ait (false positive olmamalı).
// Her sorgu için top1 ölçülür, sonra tau ∈ {0.55..0.75} matrisinde
// "inject" sayısı tablolanır. Hedef: in-lib hepsi inject, out-lib hiçbiri.
//
// Kullanım: node local-server/scripts/rag-tau-sweep.mjs
//   --base https://elara.local:10443 (default)
//   --db   postgres://...  (yoksa local-server/.env'den okur)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

let BASE = "https://elara.local:10443";
let dbUrl = process.env.DATABASE_URL || "";
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base") BASE = args[++i];
  else if (args[i] === "--db") dbUrl = args[++i];
}
if (!dbUrl) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)$/);
      if (m) { dbUrl = m[1].replace(/^['"]|['"]$/g, ""); break; }
    }
  }
}
if (!dbUrl) { console.error("DATABASE_URL gerekli."); process.exit(2); }
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const IN_LIB = [
  { q: "FortiGate HA cluster yapılandırması",        expect: "Fortigate_DOC" },
  { q: "Checkpoint R81 NAT rule troubleshooting",    expect: "Checkpoint" },
  { q: "A10 ADC vServer SSL termination",            expect: "a10_harvest" },
];
const OUT_LIB = [
  { q: "Citrix ADC ilk kurulum adımları",            expect: "(yok)" },
  { q: "Juniper SRX policy commit confirmed",        expect: "(yok)" },
  { q: "Sophos XG firewall site-to-site VPN setup",  expect: "(yok)" },
];
const TAUS = [0.55, 0.60, 0.65, 0.70, 0.75];

const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });

async function embedAndProbe(q) {
  // Worker'a direkt vur (script local makinada koşuyor)
  let qVec = null;
  try {
    const r = await fetch("http://127.0.0.1:process.env.EMBED_WORKER_PORT || 8082/v1/embeddings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "BAAI/bge-m3", input: q }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    qVec = j.data?.[0]?.embedding || null;
  } catch (e) { return { error: e.message }; }
  if (!qVec) return { error: "no embedding" };

  const qStr = `[${qVec.join(",")}]`;
  const r = (await pool.query(`
    SELECT path, COALESCE(brand,'(null)') AS brand, ord,
           (1 - (embedding <=> $1::vector))::float AS score
      FROM knowledge_chunks WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector LIMIT 4`, [qStr])).rows;
  return {
    top1: r[0]?.score ?? 0,
    top4: r[3]?.score ?? r[r.length - 1]?.score ?? 0,
    margin: (r[0]?.score ?? 0) - (r[3]?.score ?? 0),
    top1Brand: r[0]?.brand ?? "-",
    top1File: r[0] ? path.basename(r[0].path) : "-",
  };
}

const hdr = (t) => console.log(`\n━━━ ${t} ${"━".repeat(Math.max(0, 70 - t.length))}`);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

(async () => {
  console.log(`# RAG TAU SWEEP   base=${BASE}`);
  console.log(`db=${dbUrl.replace(/:[^:@]+@/, ":***@")}`);

  hdr("1. Sorgu başına top1 ölçümü");
  console.log(pad("query", 42), pad("expect", 14), pad("top1", 7), pad("top4", 7), pad("margin", 7), pad("top1Brand", 16), "top1File");
  console.log("-".repeat(120));

  const results = [];
  for (const set of [IN_LIB, OUT_LIB]) {
    for (const item of set) {
      const r = await embedAndProbe(item.q);
      results.push({ ...item, ...r, inLib: set === IN_LIB });
      if (r.error) {
        console.log(pad(item.q, 42), "HATA:", r.error);
      } else {
        console.log(
          pad(item.q, 42), pad(item.expect, 14),
          pad(r.top1.toFixed(3), 7), pad(r.top4.toFixed(3), 7),
          pad(r.margin.toFixed(3), 7), pad(r.top1Brand, 16), r.top1File,
        );
      }
    }
    console.log("");
  }

  hdr("2. Tau süpürmesi — kaç in-lib inject (TP) / kaç out-lib inject (FP)");
  console.log(pad("tau", 8), pad("TP (in-lib inject)", 22), pad("FP (out-lib inject)", 22), "verdict");
  console.log("-".repeat(80));
  let bestTau = null, bestScore = -1;
  for (const tau of TAUS) {
    const tp = results.filter(r => r.inLib && r.top1 >= tau).length;
    const fp = results.filter(r => !r.inLib && r.top1 >= tau).length;
    const score = tp - fp * 2; // FP cezası daha ağır
    const verdict = fp === 0 && tp === IN_LIB.length ? "★ MÜKEMMEL"
                  : fp === 0 ? "iyi (TP eksik ama FP yok)"
                  : tp === IN_LIB.length ? "TP tam ama FP var"
                  : "kötü";
    console.log(pad(tau.toFixed(2), 8), pad(`${tp}/${IN_LIB.length}`, 22), pad(`${fp}/${OUT_LIB.length}`, 22), verdict);
    if (score > bestScore) { bestScore = score; bestTau = tau; }
  }

  hdr("3. Öneri");
  console.log(`  → Önerilen tau: ${bestTau?.toFixed(2)}`);
  console.log(`  → Uygulamak için:`);
  console.log(`     curl -sk -X POST ${BASE}/api/rag/settings \\`);
  console.log(`       -H 'Content-Type: application/json' \\`);
  console.log(`       -d '{"injectThreshold": ${bestTau?.toFixed(2)}}'`);
  console.log(`  → Veya kalıcı default için server.mjs içinde RAG_SETTINGS.injectThreshold güncellenir.`);

  await pool.end();
})().catch(async e => { console.error("FATAL:", e); try { await pool.end(); } catch {} process.exit(1); });
