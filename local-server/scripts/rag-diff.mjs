#!/usr/bin/env node
// rag-diff.mjs — iki sorguyu /api/rag/debug üzerinden çek ve yan yana karşılaştır.
// Amaç: retrieval havuzu mu farklı, yoksa reranker mı kararsız — onu görmek.
//
// Kullanım:
//   bun run local-server/scripts/rag-diff.mjs "Q1" "Q2"
//   bun run local-server/scripts/rag-diff.mjs --base https://elara.local:10443 "Q1" "Q2"

import process from "node:process";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let base = process.env.RAG_DEBUG_BASE || "https://elara.local:10443";
let role = "Admin";
const qs = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--base") base = args[++i];
  else if (a === "--role") role = args[++i];
  else qs.push(a);
}
if (qs.length !== 2) {
  console.error('Kullanım: rag-diff.mjs "Q1" "Q2"');
  process.exit(2);
}

function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
function key(r) { return `${r.file}#${r.ord}`; }

async function fetchDebug(q) {
  const url = `${base}/api/rag/debug?q=${encodeURIComponent(q)}&role=${encodeURIComponent(role)}`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(`HTTP ${res.status}: ${body?.error || "?"}`);
  return body;
}

function summarizeBrands(obj) {
  if (!obj || typeof obj !== "object") return "—";
  return Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(" ") || "—";
}

function printSide(label, b) {
  const p = b.probe;
  console.log(`── ${label}: "${b.q.slice(0, 70)}" ──`);
  console.log(`  intent=${b.intent.kind}  decision=${p.decision}${p.reason ? `(${p.reason})` : ""}`);
  if (p.qForRetrieval && p.qForRetrieval !== b.q) {
    console.log(`  qForRetrieval[${p.queryRewriteMode || "?"}]→ "${p.qForRetrieval.slice(0, 120)}"`);
  } else {
    console.log(`  qForRetrieval = (denoise yok / aynı) mode=${p.queryRewriteMode || "none"}`);
  }
  if (p.queryRewritten && p.queryRewritten !== p.qForRetrieval) {
    console.log(`  rewrite[${p.queryRewriteMode}]→ "${p.queryRewritten.slice(0, 120)}"`);
  }
  console.log(`  top1=${p.top1}  top4=${p.top4}  margin=${p.margin}  tau=${p.tau}  coverage=${p.topCoverage}`);
  console.log(`  queryTerms=${JSON.stringify(p.queryTerms)}`);
  console.log(`  ftsRowsByBrand   = ${summarizeBrands(p.ftsRowsByBrand)}`);
  console.log(`  vectorRowsByBrand= ${summarizeBrands(p.vectorRowsByBrand)}`);
  if (p.reranker) {
    const rr = p.reranker;
    const extra = rr.top1Score != null ? `  rrTop1=${rr.top1Score} min=${rr.minScore}` : "";
    console.log(`  reranker: used=${rr.used} reason=${rr.reason || "-"} ms=${rr.ms || 0} model=${rr.model || "-"}${extra}`);
  }
  if (Array.isArray(p.rejectedTop) && p.rejectedTop.length) {
    console.log(`  rejectedTop (rerank skorları, skip kararı altında kalanlar):`);
    p.rejectedTop.forEach((r, i) => {
      const file = (r.path || "").split("/").pop();
      console.log(`    ${pad(String(i+1), 3)}${pad(`${file}#${r.ord}`, 50)}rerank=${pad(r.rerank_score ?? "-", 8)}mix=${pad(r.rerank_mix ?? "-", 9)}score=${r.score}`);
    });
  }
  console.log(`  ${p.rows.length} satır (final, post-rerank):`);
  console.log(`    ${pad("#", 3)}${pad("file:ord", 50)}${pad("retriever", 14)}${pad("rrf", 10)}${pad("cov", 6)}${pad("vBoost", 7)}${pad("fused", 9)}${pad("rerank", 9)}score`);
  p.rows.forEach((r, i) => {
    console.log(`    ${pad(String(i+1), 3)}${pad(`${r.file}#${r.ord}`, 50)}${pad(r.retriever || "-", 14)}${pad(r.rrf ?? "-", 10)}${pad(r.coverage ?? "-", 6)}${pad(r.vendor_boost ?? "-", 7)}${pad(r.fused ?? "-", 9)}${pad(r.rerank_score ?? "-", 9)}${r.score}`);
  });
  console.log("");
}

function diff(a, b) {
  const sa = new Set(a.probe.rows.map(key));
  const sb = new Set(b.probe.rows.map(key));
  const common = [...sa].filter((k) => sb.has(k));
  const onlyA = [...sa].filter((k) => !sb.has(k));
  const onlyB = [...sb].filter((k) => !sa.has(k));
  console.log("── DIFF (final sources) ──");
  console.log(`  ortak (${common.length}/6): ${common.join(", ") || "—"}`);
  console.log(`  sadece Q1 (${onlyA.length}): ${onlyA.join(", ") || "—"}`);
  console.log(`  sadece Q2 (${onlyB.length}): ${onlyB.join(", ") || "—"}`);
  console.log("");

  console.log("── YORUM ──");
  if (common.length >= 5) {
    console.log("  Aday havuzu ÇOK BENZER → fark reranker sıralamasından.");
    console.log("  Aksiyon adayı: reranker top-N artır veya rerank_weight ayarla.");
  } else if (common.length >= 3) {
    console.log("  Havuz KISMEN farklı → hem retrieval hem rerank katkı sağlıyor.");
    console.log("  Aksiyon adayı: query preprocessing (selamlama temizle) + rerank top-N artır.");
  } else {
    console.log("  Havuz BAŞTAN FARKLI → retrieval (embedding/FTS) selamlama'dan etkileniyor.");
    console.log("  Aksiyon adayı: _RAG_STOP'a 'selam/merhaba/hey/hi' ekle.");
  }
  // brand farkı
  const ftsA = a.probe.ftsRowsByBrand || {};
  const ftsB = b.probe.ftsRowsByBrand || {};
  const allBrands = new Set([...Object.keys(ftsA), ...Object.keys(ftsB)]);
  const brandDiff = [...allBrands].filter((br) => (ftsA[br] || 0) !== (ftsB[br] || 0));
  if (brandDiff.length) {
    console.log(`  FTS brand dağılımı farklı: ${brandDiff.map((br) => `${br}=${ftsA[br]||0}/${ftsB[br]||0}`).join("  ")}`);
    console.log("  → FTS tokenizasyonu sorgu metnine duyarlı; selamlama'nın gerçek etkisi burada.");
  }
  // queryTerms farkı
  const qtA = JSON.stringify(a.probe.queryTerms || []);
  const qtB = JSON.stringify(b.probe.queryTerms || []);
  if (qtA !== qtB) {
    console.log(`  queryTerms farklı: Q1=${qtA}  Q2=${qtB}`);
    console.log("  → _RAG_STOP listesi sorguya göre değişik token'lar bırakıyor.");
  }
}

(async () => {
  const [b1, b2] = await Promise.all([fetchDebug(qs[0]), fetchDebug(qs[1])]);
  console.log("");
  printSide("Q1", b1);
  printSide("Q2", b2);
  diff(b1, b2);
  console.log("");
})().catch((e) => {
  console.error("HATA:", e.message);
  process.exit(1);
});
