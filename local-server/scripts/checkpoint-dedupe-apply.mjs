#!/usr/bin/env node
// checkpoint-dedupe-apply.mjs — Checkpoint duplicate ingest'i tek komutla temizler.
//
// Aşamalar:
//   1) Dry-run (default)     — ne silineceğini yazar, dokunmaz
//   2) --apply               — DB'de DELETE çalıştırır
//   3) --apply --confirm     — DB + filesystem (/library/checkpoint_api) siler
//
// Kullanım:
//   node local-server/scripts/checkpoint-dedupe-apply.mjs
//   node local-server/scripts/checkpoint-dedupe-apply.mjs --apply
//   node local-server/scripts/checkpoint-dedupe-apply.mjs --apply --confirm

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { resolvePath } from "../lib/os_utils.mjs";

const args = process.argv.slice(2);
const APPLY   = args.includes("--apply");
const CONFIRM = args.includes("--confirm");
let dbUrl = process.env.DATABASE_URL || "";
for (let i = 0; i < args.length; i++) if (args[i] === "--db") dbUrl = args[++i];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
if (!dbUrl) {
  const envPath = path.join(REPO, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)$/);
      if (m) { dbUrl = m[1].replace(/^['"]|['"]$/g, ""); break; }
    }
  }
}
if (!dbUrl) { console.error("DATABASE_URL gerekli."); process.exit(2); }

const TARGET_BRAND = "checkpoint_api";
const FS_PATH      = resolvePath("library/checkpoint_api");

const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
const hdr = (t) => console.log(`\n━━━ ${t} ${"━".repeat(Math.max(0, 70 - t.length))}`);

(async () => {
  console.log(`# CHECKPOINT DEDUPE   apply=${APPLY}  confirm=${CONFIRM}`);
  console.log(`# db=${dbUrl.replace(/:[^:@]+@/, ":***@")}`);

  // BEFORE
  hdr("BEFORE — DB sayım");
  const beforeChunks = (await pool.query(`SELECT COUNT(*)::int AS n FROM knowledge_chunks`)).rows[0].n;
  const beforeTarget = (await pool.query(`SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE brand=$1`, [TARGET_BRAND])).rows[0].n;
  const beforeBrands = (await pool.query(`
    SELECT COALESCE(brand,'(null)') AS brand, COUNT(*)::int AS chunks, COUNT(DISTINCT path)::int AS files
      FROM knowledge_chunks GROUP BY 1 ORDER BY chunks DESC`)).rows;
  console.log(`  toplam chunk: ${beforeChunks}`);
  console.log(`  silinecek (brand='${TARGET_BRAND}'): ${beforeTarget}`);
  console.log(`  mevcut brand dağılımı:`);
  beforeBrands.forEach(b => console.log(`    ${String(b.chunks).padStart(6)}  ${String(b.files).padStart(4)} dosya  ${b.brand}`));

  // Orphan files preview
  const orphanFiles = (await pool.query(`
    SELECT COUNT(*)::int AS n FROM knowledge_files kf
     WHERE NOT EXISTS (SELECT 1 FROM knowledge_chunks kc WHERE kc.file_id = kf.id AND kc.brand <> $1)
       AND EXISTS (SELECT 1 FROM knowledge_chunks kc WHERE kc.file_id = kf.id AND kc.brand = $1)`, [TARGET_BRAND])).rows[0].n;
  console.log(`  silme sonrası orphan kalacak knowledge_files: ${orphanFiles}`);

  // FS preview
  hdr("FS — /library/checkpoint_api/");
  if (fs.existsSync(FS_PATH)) {
    const files = fs.readdirSync(FS_PATH);
    console.log(`  ${FS_PATH}: ${files.length} dosya`);
    files.slice(0, 20).forEach(f => {
      const st = fs.statSync(path.join(FS_PATH, f));
      console.log(`    ${(st.size / 1024 / 1024).toFixed(1).padStart(7)} MB  ${f}`);
    });
    try {
      const du = execSync(`du -sh "${FS_PATH}" 2>/dev/null`, { encoding: "utf8" }).trim();
      console.log(`  Toplam: ${du}`);
    } catch {}
  } else {
    console.log(`  ${FS_PATH}: yok (zaten silinmiş?)`);
  }

  if (!APPLY) {
    hdr("DRY-RUN bitti");
    console.log("  Sadece DB temizliği için:    node local-server/scripts/checkpoint-dedupe-apply.mjs --apply");
    console.log("  DB + filesystem temizliği:   node local-server/scripts/checkpoint-dedupe-apply.mjs --apply --confirm");
    await pool.end();
    return;
  }

  // APPLY — DB
  hdr("APPLY — DB transaction");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const delChunks = await client.query(`DELETE FROM knowledge_chunks WHERE brand=$1`, [TARGET_BRAND]);
    const delFiles  = await client.query(`
      DELETE FROM knowledge_files
       WHERE id NOT IN (SELECT DISTINCT file_id FROM knowledge_chunks WHERE file_id IS NOT NULL)`);
    await client.query("COMMIT");
    console.log(`  ✓ DELETE knowledge_chunks: ${delChunks.rowCount}`);
    console.log(`  ✓ DELETE knowledge_files (orphans): ${delFiles.rowCount}`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`  ✗ DB hatası, rollback: ${e.message}`);
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }

  // APPLY — FS
  hdr("APPLY — Filesystem");
  if (!CONFIRM) {
    console.log(`  --confirm verilmedi, filesystem'e DOKUNULMADI.`);
    console.log(`  Aksi halde scanner sonraki taramada DB'ye geri ekler.`);
    console.log(`  Tam temizlik için: --apply --confirm`);
  } else if (!fs.existsSync(FS_PATH)) {
    console.log(`  ${FS_PATH} zaten yok.`);
  } else {
    fs.rmSync(FS_PATH, { recursive: true, force: true });
    console.log(`  ✓ rm -rf ${FS_PATH}`);
  }

  // AFTER
  hdr("AFTER — DB sayım");
  const afterChunks = (await pool.query(`SELECT COUNT(*)::int AS n FROM knowledge_chunks`)).rows[0].n;
  const afterBrands = (await pool.query(`
    SELECT COALESCE(brand,'(null)') AS brand, COUNT(*)::int AS chunks, COUNT(DISTINCT path)::int AS files
      FROM knowledge_chunks GROUP BY 1 ORDER BY chunks DESC`)).rows;
  console.log(`  toplam chunk: ${beforeChunks} → ${afterChunks}  (Δ ${afterChunks - beforeChunks})`);
  afterBrands.forEach(b => console.log(`    ${String(b.chunks).padStart(6)}  ${String(b.files).padStart(4)} dosya  ${b.brand}`));

  hdr("Notlar");
  console.log("  • Tarayıcı duplicate-koruma için: ingest pipeline'ı zaten content-hash veya (path) unique key kullanmalı.");
  console.log("    Eğer scanner aynı PDF'i farklı folder altında bulup tekrar eklerse, bunu sonraki turda ele alırız.");
  console.log("  • RAG cache'i temizlemek için worker'ı bir kez yeniden başlatmak iyi olur (query embedding LRU bu kütüphaneye bağlı değil ama prob cache zarar verebilir).");

  await pool.end();
})().catch(async e => { console.error("FATAL:", e); try { await pool.end(); } catch {} process.exit(1); });
