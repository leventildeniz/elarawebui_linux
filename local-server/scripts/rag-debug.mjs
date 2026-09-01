#!/usr/bin/env node
// rag-debug.mjs — tek soruyu (veya hazır suite'i) /api/rag/debug üzerinden
// kütüphaneye sorar. MLX'i hiç tetiklemez; sadece embed + DB probe + fetch.
//
// Kullanım:
//   node local-server/scripts/rag-debug.mjs "Forti 7.4 vs 7.6 farkları"
//   node local-server/scripts/rag-debug.mjs --suite
//   node local-server/scripts/rag-debug.mjs --suite --base https://elara.local:10443
//
// Çıktı: her soru için intent / refine / top1 / tau / karar / ms tablosu
// + injection olursa kaynak başlıkları.

import process from "node:process";

const args = process.argv.slice(2);
let base = process.env.RAG_DEBUG_BASE || "https://elara.local:10443";
let role = "Admin";
let suite = false;
const queries = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--base") base = args[++i];
  else if (a === "--role") role = args[++i];
  else if (a === "--suite") suite = true;
  else queries.push(a);
}

const SUITE = [
  "Selam Elara",
  "FortiGate 7.4 ile 7.6 arasındaki teknik farklar",
  "Checkpoint R81 NAT rule troubleshooting adımları",
  "FortiOS REST API token üretimi ve örnek curl",
];

if (suite) queries.push(...SUITE);
if (!queries.length) {
  console.error("Kullanım: rag-debug.mjs \"<soru>\"  veya  --suite");
  process.exit(2);
}

// TLS self-signed izin (local cert)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }

function header() {
  console.log("");
  console.log(pad("Q", 44), pad("intent", 14), pad("top1", 7), pad("top4", 7), pad("marg", 7), pad("tau", 6), pad("decision", 14), pad("probMs", 7), "totalMs");
  console.log("-".repeat(135));
}

async function runOne(q) {
  const t0 = Date.now();
  let body;
  try {
    const url = `${base}/api/rag/debug?q=${encodeURIComponent(q)}&role=${encodeURIComponent(role)}`;
    const res = await fetch(url, { method: "GET" });
    body = await res.json();
    if (!res.ok || !body.ok) {
      console.log(pad(`"${q}"`, 44), `HATA: ${body.error || res.status}`);
      return;
    }
  } catch (e) {
    console.log(pad(`"${q}"`, 44), `BAĞLANTI HATA: ${e.message}`);
    return;
  }
  const elapsed = Date.now() - t0;
  const intentKind = body.intent?.kind || "?";
  const refinedKind = body.refined?.kind || "?";
  const refinedMode = body.refined?.mode || "";
  const intentCol = refinedKind === intentKind ? intentKind : `${intentKind}→${refinedKind}`;
  console.log(
    pad(`"${q.slice(0, 42)}"`, 44),
    pad(intentCol, 14),
    pad(body.probe.top1.toFixed(3), 7),
    pad((body.probe.top4 ?? 0).toFixed(3), 7),
    pad((body.probe.margin ?? 0).toFixed(3), 7),
    pad(body.probe.tau.toFixed(2), 6),
    pad(body.probe.decision === "inject" ? `inject(${body.probe.rows.length})` : `skip:${body.probe.reason || "?"}`.slice(0, 14), 14),
    pad(String(body.probe.ms), 7),
    `${body.totalMs} (wire ${elapsed})`,
  );
  // Observability: refined intent + denoise + retrieval query (Bug 1/2 teşhisi için kritik)
  if (refinedMode) {
    console.log(`    [intent]     refined.mode=${refinedMode}`);
  }
  const qRew = body.probe?.queryRewritten;
  const qRet = body.probe?.qForRetrieval;
  const qMode = body.probe?.queryRewriteMode;
  if (qRew || qRet) {
    console.log(`    [denoise]    mode=${qMode || "-"}  rewritten="${qRew || "-"}"`);
    console.log(`    [retrieval]  qForRetrieval="${qRet || "-"}"`);
  }
  // Reranker kararı — used / ms / model / reason / gate
  const rr = body.probe?.reranker;
  if (rr) {
    const gate = rr.gate ? ` gate=${JSON.stringify(rr.gate)}` : "";
    console.log(`    [reranker]   used=${!!rr.used} ms=${rr.ms ?? "-"} model=${rr.model || "-"} reason=${rr.reason || "-"}${rr.lastError ? ` err=${rr.lastError}` : ""}${gate}`);
  } else {
    console.log(`    [reranker]   <absent in /api/rag/debug payload>`);
  }
  if (body.probe.rows.length) {
    body.probe.rows.forEach((r, i) => {
      const rrScore = (typeof r.rerank_score === "number") ? ` rr=${r.rerank_score.toFixed(3)}` : "";
      const rrMix = (typeof r.rerank_mix === "number") ? ` mix=${r.rerank_mix.toFixed(3)}` : "";
      console.log(`    [Kaynak ${i + 1}] ${pad(r.file, 36)} #${r.ord} skor=${r.score.toFixed(3)}${rrScore}${rrMix} ${r.brand || ""}`);
    });
  }
}

(async () => {
  header();
  for (const q of queries) await runOne(q);
  console.log("");
})();
