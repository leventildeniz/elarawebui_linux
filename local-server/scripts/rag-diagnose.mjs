#!/usr/bin/env node
// rag-diagnose.mjs — RAG sağlık teşhisi. Tek soruyu 8 farklı probdan geçirir
// ve nerede kırıldığını söyler. MLX'i sadece /api/rag/debug + /v1/embeddings
// üzerinden dokunur, DB'ye doğrudan SELECT atar (read-only).
//
// Kullanım:
//   node local-server/scripts/rag-diagnose.mjs "Citrix ADC ilk kurulum adımları"
//   node local-server/scripts/rag-diagnose.mjs --base https://elara.local:10443 "..."
//   node local-server/scripts/rag-diagnose.mjs --db postgres://... "..."
//
// Çıktı 8 bölüm + sondaki YORUM bloğu — yorum bloğunu bana yapıştır, kesin fix çıkarayım.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

// ---------- args ----------
const args = process.argv.slice(2);
let base = "https://elara.local:10443";
let dbUrl = process.env.DATABASE_URL || "";
const queries = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--base") base = args[++i];
  else if (a === "--db") dbUrl = args[++i];
  else queries.push(a);
}
const q = queries.join(" ").trim() || "Citrix ADC ilk kurulum adımları";

// ---------- .env yükle (dotenv yoksa minik parser) ----------
if (!dbUrl) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].replace(/^['"]|['"]$/g, "");
      if (m[1] === "DATABASE_URL" && !dbUrl) dbUrl = v;
    }
  }
}
if (!dbUrl) {
  console.error("DATABASE_URL bulunamadı. --db <url> ver veya local-server/.env içine koy.");
  process.exit(2);
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const pool = new pg.Pool({ connectionString: dbUrl, max: 3 });
const findings = [];
function note(msg) { findings.push(msg); }
function hdr(n, t) { console.log(`\n━━━ ${n}. ${t} ${"━".repeat(Math.max(0, 70 - t.length))}`); }
function row(...c) { console.log(c.map((x, i) => String(x).padEnd([42, 9, 8, 8, 8, 10][i] || 12)).join(" ")); }

async function safeQ(label, sql, params = []) {
  try { return (await pool.query(sql, params)).rows; }
  catch (e) { console.log(`  [DB HATA · ${label}] ${e.message}`); return null; }
}

// ====================================================================
async function main() {
  console.log(`\n# RAG DIAGNOSE`);
  console.log(`Q     : "${q}"`);
  console.log(`Base  : ${base}`);
  console.log(`DB    : ${dbUrl.replace(/:[^:@]+@/, ":***@")}`);

  // 1. Worker health
  hdr(1, "Worker health");
  try {
    const r = await fetch(`${base}/api/system/worker/status`);
    const j = await r.json();
    console.log(JSON.stringify(j, null, 2));
    if (!j.healthy) note("Worker healthy=false");
    if (j.dim && j.dim !== 1024) note(`Worker dim=${j.dim} (bge-m3 beklenen 1024)`);
  } catch (e) { console.log(`  HATA: ${e.message}`); note("worker/status erişilemedi"); }

  // 2. DB sağlık özeti
  hdr(2, "DB chunk özeti");
  const stat = await safeQ("stat", `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE embedding IS NULL)::int AS no_embed,
           COUNT(DISTINCT brand)::int AS brands,
           COUNT(DISTINCT path)::int AS files,
           COUNT(DISTINCT access_level)::int AS levels
      FROM knowledge_chunks`);
  if (stat) {
    console.log(stat[0]);
    if (stat[0].no_embed > 0) note(`${stat[0].no_embed} chunk embedding'siz`);
  }
  const dims = await safeQ("dims", `
    SELECT vector_dims(embedding) AS dim, COUNT(*)::int AS n
      FROM knowledge_chunks WHERE embedding IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC LIMIT 5`);
  if (dims) {
    console.log("dim dağılımı:", dims);
    if (dims.length > 1) note(`Karışık vektör boyutu: ${dims.map(d => `${d.dim}x${d.n}`).join(", ")}`);
  }

  // 3. Brand dağılımı
  hdr(3, "Brand dağılımı (ilk 30)");
  const brands = await safeQ("brands", `
    SELECT COALESCE(brand,'(null)') AS brand,
           COUNT(*)::int AS chunks,
           COUNT(DISTINCT path)::int AS files
      FROM knowledge_chunks
     GROUP BY 1 ORDER BY chunks DESC LIMIT 30`);
  if (brands) {
    row("brand", "chunks", "files");
    brands.forEach(b => row(b.brand, b.chunks, b.files));
    // Citrix var mı?
    const qBrand = (q.match(/\b(citrix|fortinet|fortigate|checkpoint|palo|cisco|sophos|juniper)\b/i) || [])[1];
    if (qBrand) {
      const hit = brands.find(b => b.brand.toLowerCase().includes(qBrand.toLowerCase()));
      if (!hit) note(`Sorgu brand'i "${qBrand}" DB'de yok → RAG bu sorguya katkı sağlayamaz, model serbest cevaba düşmeli`);
      else console.log(`  → "${qBrand}" brand bulundu: ${hit.chunks} chunk / ${hit.files} dosya`);
    }
  }

  // 4. Mükerrer satır taraması
  hdr(4, "Mükerrer chunk taraması (file_id, ord)");
  const dup = await safeQ("dup", `
    SELECT file_id, ord, COUNT(*)::int AS copies,
           array_agg(DISTINCT COALESCE(brand,'(null)')) AS brands
      FROM knowledge_chunks
     GROUP BY file_id, ord
    HAVING COUNT(*) > 1
     ORDER BY copies DESC LIMIT 20`);
  const dupTot = await safeQ("duptot", `
    SELECT COUNT(*)::int AS dup_groups,
           COALESCE(SUM(c-1),0)::int AS excess_rows
      FROM (SELECT COUNT(*) AS c FROM knowledge_chunks GROUP BY file_id, ord HAVING COUNT(*) > 1) s`);
  if (dupTot) console.log(`Özet: ${dupTot[0].dup_groups} grup, fazla satır = ${dupTot[0].excess_rows}`);
  if (dup && dup.length) {
    console.log("İlk 20:");
    dup.forEach(d => console.log(`  file_id=${d.file_id} ord=${d.ord} copies=${d.copies} brands=${JSON.stringify(d.brands)}`));
    note(`${dupTot[0].excess_rows} mükerrer satır → dedupe gerekiyor (DELETE keeping max(id) per file_id+ord)`);
  } else {
    console.log("  Temiz, duplicate yok.");
  }

  // 5. Embed sanity
  hdr(5, "Embedding sanity (worker round-trip)");
  let qVec = null;
  try {
    // worker.py process.env.EMBED_WORKER_PORT || 8082'de; gateway üzerinden geçmek için server.mjs içinde proxy yok,
    // direkt worker'a vur. Worker localhost-only ama bu script de aynı makinada koşuyor.
    const r = await fetch(`http://127.0.0.1:process.env.EMBED_WORKER_PORT || 8082/v1/embeddings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "BAAI/bge-m3", input: q }),
    });
    const j = await r.json();
    qVec = j.data?.[0]?.embedding || null;
    if (!qVec) { console.log("  vektör dönmedi:", JSON.stringify(j).slice(0, 200)); note("Embedding boş"); }
    else {
      const norm = Math.sqrt(qVec.reduce((s, x) => s + x * x, 0));
      const nan = qVec.some(x => !Number.isFinite(x));
      console.log(`  dim=${qVec.length}  norm=${norm.toFixed(4)}  nan=${nan}`);
      console.log(`  ilk 8: [${qVec.slice(0, 8).map(x => x.toFixed(4)).join(", ")}]`);
      if (nan) note("Embedding'de NaN var");
      if (norm < 0.5 || norm > 2.0) note(`Tuhaf vector norm: ${norm.toFixed(3)} (bge-m3 normalize edilmiş ~1.0 olmalı)`);
    }
  } catch (e) { console.log(`  worker fetch HATA: ${e.message}`); note("Worker /v1/embeddings cevap vermedi"); }

  // 6 & 7. HNSW probe — brand filtresiz + filtreli
  if (qVec) {
    const qStr = `[${qVec.join(",")}]`;

    hdr(6, "HNSW probe — brand filtresiz, top 10");
    const r6 = await safeQ("hnsw_all", `
      SELECT path, ord, COALESCE(brand,'(null)') AS brand, access_level,
             ROUND((1 - (embedding <=> $1::vector))::numeric, 4) AS score
        FROM knowledge_chunks
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector LIMIT 10`, [qStr]);
    if (r6) {
      row("file", "ord", "brand", "score");
      r6.forEach(x => row(path.basename(x.path).slice(0, 40), x.ord, String(x.brand).slice(0, 8), x.score));
      // Mükerrer skor tespiti
      const uniq = new Set(r6.map(x => `${x.path}#${x.ord}`));
      if (uniq.size < r6.length) note(`Top-10'da ${r6.length - uniq.size} mükerrer sonuç (aynı file+ord)`);
    }

    hdr(7, "HNSW probe — brand filtreli");
    const qBrand = (q.match(/\b(citrix|fortinet|fortigate|checkpoint|palo|cisco|sophos|juniper)\b/i) || [])[1];
    if (!qBrand) {
      console.log("  Sorguda tanınmış bir brand keyword yok — atlandı.");
    } else {
      const brandFilters = [qBrand, qBrand.toLowerCase(), qBrand[0].toUpperCase() + qBrand.slice(1).toLowerCase(), `${qBrand.toLowerCase()}_api`];
      const r7 = await safeQ("hnsw_brand", `
        SELECT path, ord, COALESCE(brand,'(null)') AS brand,
               ROUND((1 - (embedding <=> $1::vector))::numeric, 4) AS score
          FROM knowledge_chunks
         WHERE embedding IS NOT NULL AND brand = ANY($2::text[])
         ORDER BY embedding <=> $1::vector LIMIT 10`, [qStr, brandFilters]);
      if (r7) {
        console.log(`brand filtresi: ${JSON.stringify(brandFilters)}`);
        if (!r7.length) {
          console.log("  HİÇ satır yok — bu brand için DB'de chunk yok.");
          note(`brand="${qBrand}" filtresi 0 sonuç → ya ingest edilmemiş ya farklı brand etiketi altında`);
        } else {
          row("file", "ord", "brand", "score");
          r7.forEach(x => row(path.basename(x.path).slice(0, 40), x.ord, String(x.brand).slice(0, 8), x.score));
        }
      }
    }

    // 8. Tau süpürmesi
    hdr(8, "Tau süpürmesi (top1 ve karar)");
    const top1 = (await safeQ("top1", `
      SELECT (1 - (embedding <=> $1::vector)) AS s
        FROM knowledge_chunks WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector LIMIT 1`, [qStr]))?.[0]?.s ?? 0;
    console.log(`  top1 = ${Number(top1).toFixed(4)}`);
    for (const tau of [0.45, 0.55, 0.65, 0.75, 0.85]) {
      const decision = Number(top1) >= tau ? "INJECT" : "skip";
      console.log(`  tau=${tau.toFixed(2)} → ${decision}`);
    }
    if (Number(top1) < 0.70) note(`top1=${Number(top1).toFixed(3)} zayıf — tau'yu 0.65-0.70'e çekmek bu tür yanlış inject'leri keser`);
  } else {
    console.log("\n(6-8 atlandı: embedding alınamadı)");
  }

  // ---------- ÖZET ----------
  console.log(`\n\n━━━ YORUM (bunu yapıştır) ${"━".repeat(50)}`);
  if (!findings.length) console.log("  Belirgin sorun bulunamadı.");
  else findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  console.log("");

  await pool.end();
}

main().catch(async e => {
  console.error("FATAL:", e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
