#!/usr/bin/env node
// brand-backfill.mjs — knowledge_chunks.brand kolonunu, kaynak knowledge_sources.url
// üzerinden SLD (second-level domain) tabanlı, vendor-agnostic mantıkla yeniden
// hesaplar.
//
// v2: Script artık DB'ye doğrudan bağlanmıyor; tüm join çözümlemesi (chunk↔source
// dinamik probe + 12 hipotez) server tarafında resolveJoinExpr() ile yapılıyor.
// Bu sayede tek doğru kaynak: server.mjs.
//
// Kullanım:
//   node local-server/scripts/brand-backfill.mjs            # DRY-RUN (sadece rapor)
//   node local-server/scripts/brand-backfill.mjs --apply    # gerçek UPDATE
//
// Not: localhost/loopback çağrıda token gerekmez. LAN/uzak çağrılar hâlâ
// oturum veya geçerli admin token ister.

import { adminPost } from "./_admin-fetch.mjs";

const APPLY = process.argv.includes("--apply");
console.log(`# brand-backfill   mode=${APPLY ? "APPLY" : "DRY-RUN"}   (SLD-only, server-resolved join)`);

const { status, json } = await adminPost("/api/rag/brand-backfill", { dryRun: !APPLY });

if (status !== 200 || !json.ok) {
  console.error(`HATA (HTTP ${status}):`);
  console.error(JSON.stringify(json, null, 2));
  if (json?.error === "join_unresolved") {
    console.error("\n→ İpucu: önce  curl http://127.0.0.1:3005/api/rag/diagnose-join | jq  çalıştır,");
    console.error("  ve probe sonuçlarına bak. Hiçbir hipotez eşleşmiyorsa ingest pipeline'ı bozuk.");
  }
  process.exit(1);
}

console.log(`Join         : ${json.join?.name}  →  ${json.join?.expr}`);
console.log(`Kaynak (URL) : ${json.sources}`);
console.log(`Taranan chunk: ${json.scanned_chunks}`);

if (json.before) {
  console.log("\nÖNCE (brand histogram)");
  console.log("─".repeat(60));
  for (const [b, n] of Object.entries(json.before).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(b).padEnd(28)} ${String(n).padStart(8)}`);
  }
}

if (json.dryRun) {
  if (json.sample?.length) {
    console.log("\nÖRNEK (ilk 10 kaynak → yeni brand)");
    console.log("─".repeat(60));
    for (const s of json.sample) {
      console.log(`  ${(s.neu ?? "(null)").padEnd(20)} ${String(s.chunks).padStart(6)}  ${s.url}`);
    }
  }
  console.log("\nDRY-RUN. Uygulamak için: --apply");
} else {
  console.log(`\n✓ Toplam UPDATE: ${json.updated}`);
  if (json.transitions && Object.keys(json.transitions).length) {
    console.log("\nGEÇİŞ (yeni brand → satır sayısı)");
    console.log("─".repeat(60));
    for (const [k, n] of Object.entries(json.transitions).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(k).padEnd(40)} ${String(n).padStart(8)}`);
    }
  }
}
