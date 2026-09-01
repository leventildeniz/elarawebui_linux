#!/usr/bin/env node
// checkpoint-overlap-audit.mjs — "Checkpoint" vs "checkpoint_api" brand'leri
// aynı içeriği iki kez mi tutuyor, yoksa farklı kaynak mı? Karar verir.
//
// Yöntem:
//  1) Her iki brand'in tüm path'lerini ve chunk sayılarını listele
//  2) Basename overlap (PDF vs HTML fark eder, sadece file adı kıyaslanır)
//  3) İçerik MD5 overlap — her brand'den 200 chunk örneği al, ilk 500 char'ın MD5'ini
//     karşılaştır. %50+ örtüşme = duplicate ingest. <%5 = ayrı içerik.
//  4) Karar + uygulanacak SQL

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

let dbUrl = process.env.DATABASE_URL || "";
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) if (args[i] === "--db") dbUrl = args[++i];

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

const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
const hdr = (t) => console.log(`\n━━━ ${t} ${"━".repeat(Math.max(0, 70 - t.length))}`);

function md5(s) { return crypto.createHash("md5").update(String(s).slice(0, 500)).digest("hex"); }

(async () => {
  console.log(`# CHECKPOINT OVERLAP AUDIT   db=${dbUrl.replace(/:[^:@]+@/, ":***@")}`);

  hdr("A. Checkpoint brand path'leri");
  const a = (await pool.query(`
    SELECT path, COUNT(*)::int AS chunks
      FROM knowledge_chunks WHERE brand='Checkpoint'
     GROUP BY path ORDER BY chunks DESC`)).rows;
  a.forEach(r => console.log(`  ${String(r.chunks).padStart(6)} · ${r.path}`));

  hdr("B. checkpoint_api brand path'leri");
  const b = (await pool.query(`
    SELECT path, COUNT(*)::int AS chunks
      FROM knowledge_chunks WHERE brand='checkpoint_api'
     GROUP BY path ORDER BY chunks DESC`)).rows;
  b.forEach(r => console.log(`  ${String(r.chunks).padStart(6)} · ${r.path}`));

  hdr("C. Basename overlap");
  const setA = new Set(a.map(r => path.basename(r.path).toLowerCase()));
  const setB = new Set(b.map(r => path.basename(r.path).toLowerCase()));
  const inter = [...setA].filter(x => setB.has(x));
  console.log(`  A unique basenames: ${setA.size}`);
  console.log(`  B unique basenames: ${setB.size}`);
  console.log(`  Overlap          : ${inter.length}`);
  if (inter.length) console.log("  Örnek 10: " + inter.slice(0, 10).join(", "));

  hdr("D. İçerik MD5 overlap (her brand'den 200 örnek chunk, ilk 500 char)");
  const sa = await pool.query(`SELECT content FROM knowledge_chunks WHERE brand='Checkpoint'     ORDER BY random() LIMIT 200`);
  const sb = await pool.query(`SELECT content FROM knowledge_chunks WHERE brand='checkpoint_api' ORDER BY random() LIMIT 200`);
  const hashA = new Set(sa.rows.map(r => md5(r.content || "")));
  const hashB = new Set(sb.rows.map(r => md5(r.content || "")));
  const hashInter = [...hashA].filter(h => hashB.has(h));
  const overlapPct = hashA.size ? (hashInter.length / hashA.size) * 100 : 0;
  console.log(`  A örnek MD5: ${hashA.size}`);
  console.log(`  B örnek MD5: ${hashB.size}`);
  console.log(`  Overlap    : ${hashInter.length}  (${overlapPct.toFixed(1)}% of A)`);

  hdr("E. Karar + SQL");
  if (overlapPct >= 40 || inter.length >= Math.min(setA.size, setB.size) * 0.6) {
    console.log("  → DUPLICATE INGEST tespit edildi.");
    console.log("  → Önerilen: 'checkpoint_api' satırlarını sil (Checkpoint = canonical).");
    console.log("\n  -- ÖNCE EMİN OL, SONRA ÇALIŞTIR (psql):");
    console.log(`  BEGIN;`);
    console.log(`  -- Doğrulama:`);
    console.log(`  SELECT COUNT(*) FROM knowledge_chunks WHERE brand='checkpoint_api';`);
    console.log(`  -- Silme:`);
    console.log(`  DELETE FROM knowledge_chunks WHERE brand='checkpoint_api';`);
    console.log(`  DELETE FROM knowledge_files  WHERE id IN (SELECT id FROM knowledge_files WHERE id NOT IN (SELECT DISTINCT file_id FROM knowledge_chunks));`);
    console.log(`  COMMIT;`);
  } else if (overlapPct < 10 && inter.length < 2) {
    console.log("  → AYRI İÇERİK. Sadece etiket karışıklığı var.");
    console.log("  → Önerilen: Brand isimlerini normalize et — ikisini de 'Checkpoint' yap, alt-tür için tag kullan.");
    console.log("\n  -- SQL:");
    console.log(`  UPDATE knowledge_chunks SET brand='Checkpoint' WHERE brand='checkpoint_api';`);
  } else {
    console.log(`  → KISMİ ÖRTÜŞME (%${overlapPct.toFixed(0)}). Elle bakman lazım.`);
    console.log(`  → Yukarıdaki (A) ve (B) path listelerini bana yapıştır, hangi dosyalar tekrar etmiş söyleyeyim.`);
  }

  await pool.end();
})().catch(async e => { console.error("FATAL:", e); try { await pool.end(); } catch {} process.exit(1); });
