#!/usr/bin/env node
// env-to-vault-migrate.mjs
//
// .env (veya launchd plist) içindeki secret'ları vault'a taşır.
// Default: dry-run — sadece taşınacak key'leri listeler.
// --apply ile çalıştırırsan vault'a yazar.
// --purge-env ile .env'den taşınan satırları siler (orijinali .env.bak'a kopyalanır).
//
// Kullanım:
//   node local-server/scripts/env-to-vault-migrate.mjs --file .env
//   node local-server/scripts/env-to-vault-migrate.mjs --file .env --apply
//   node local-server/scripts/env-to-vault-migrate.mjs --file .env --apply --purge-env
//   node local-server/scripts/env-to-vault-migrate.mjs --file .env --scope agent:firewall_oracle --apply
//
// Korunan key'ler (vault'a TAŞINMAZ — bunlar altyapı):
//   DATABASE_URL, PG*, VAULT_PASSPHRASE, ELARA_AGENTS_*,
//   ELARA_WORKER_*, ELARA_LOG_*, NODE_ENV, PORT, HOST, PATH, HOME, LANG, LC_*

import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { putSecret } from "../lib/vault.mjs";

const PRESERVE_PATTERNS = [
  /^DATABASE_URL$/,
  /^PG[A-Z_]*$/,
  /^VAULT_PASSPHRASE$/,
  /^ELARA_AGENTS_/,
  /^ELARA_WORKER_/,
  /^ELARA_LOG_/,
  /^ELARA_EMBED_/,
  /^NODE_ENV$/,
  /^PORT$/,
  /^HOST$/,
  /^PATH$/,
  /^HOME$/,
  /^LANG$/,
  /^LC_/,
  /^TZ$/,
];

function shouldPreserve(key) {
  return PRESERVE_PATTERNS.some((re) => re.test(key));
}

function parseArgs(argv) {
  const out = { file: ".env", scope: "global", apply: false, purgeEnv: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") out.file = argv[++i];
    else if (a === "--scope") out.scope = argv[++i];
    else if (a === "--apply") out.apply = true;
    else if (a === "--purge-env") out.purgeEnv = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Kullanım: node env-to-vault-migrate.mjs --file .env [--scope global] [--apply] [--purge-env]`);
      process.exit(0);
    }
  }
  return out;
}

function parseEnvFile(text) {
  const lines = text.split(/\r?\n/);
  const entries = []; // { lineIdx, key, value, raw }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(t);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.push({ lineIdx: i, key: m[1], value, raw });
  }
  return { lines, entries };
}

function maskValue(v) {
  if (!v) return "(empty)";
  if (v.length <= 6) return "•".repeat(v.length);
  return v.slice(0, 2) + "•".repeat(Math.max(4, v.length - 4)) + v.slice(-2);
}

async function main() {
  const args = parseArgs(process.argv);
  const absFile = path.resolve(args.file);
  if (!fs.existsSync(absFile)) {
    console.error(`[migrate] file not found: ${absFile}`);
    process.exit(1);
  }

  const text = fs.readFileSync(absFile, "utf8");
  const { lines, entries } = parseEnvFile(text);

  const toMigrate = entries.filter((e) => !shouldPreserve(e.key));
  const preserved = entries.filter((e) => shouldPreserve(e.key));

  console.log(`\n=== env-to-vault-migrate ===`);
  console.log(`Dosya:    ${absFile}`);
  console.log(`Scope:    ${args.scope}`);
  console.log(`Mode:     ${args.apply ? "APPLY" : "DRY-RUN"}${args.purgeEnv ? " + PURGE-ENV" : ""}`);
  console.log(`Toplam:   ${entries.length} key  |  Vault'a: ${toMigrate.length}  |  Korunan: ${preserved.length}\n`);

  if (preserved.length) {
    console.log(`[preserved — altyapı, dokunulmayacak]`);
    for (const e of preserved) console.log(`  ✓ ${e.key}`);
    console.log();
  }

  if (!toMigrate.length) {
    console.log(`[migrate] taşınacak secret yok.`);
    return;
  }

  console.log(`[vault'a yazılacak]`);
  for (const e of toMigrate) {
    console.log(`  → ${args.scope} :: ${e.key}  =  ${maskValue(e.value)}`);
  }

  if (!args.apply) {
    console.log(`\n[migrate] dry-run bitti. Yazmak için --apply ekle.`);
    return;
  }

  const conn = process.env.DATABASE_URL || `postgres://${process.env.PGUSER || "postgres"}@${process.env.PGHOST || "localhost"}/${process.env.PGDATABASE || "postgres"}`;
  const pool = new Pool({ connectionString: conn });

  let ok = 0, fail = 0;
  for (const e of toMigrate) {
    try {
      await putSecret(pool, args.scope, e.key, e.value);
      console.log(`  ✓ ${e.key}`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${e.key}: ${err.message}`);
      fail++;
    }
  }

  await pool.end();
  console.log(`\n[migrate] tamam — ok=${ok} fail=${fail}`);

  if (args.purgeEnv && ok > 0) {
    const backup = absFile + ".bak." + Date.now();
    fs.copyFileSync(absFile, backup);
    const migratedKeys = new Set(toMigrate.map((e) => e.key));
    const newLines = lines.map((raw) => {
      const t = raw.trim();
      if (!t || t.startsWith("#")) return raw;
      const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(t);
      if (m && migratedKeys.has(m[1])) {
        return `# [migrated-to-vault scope=${args.scope}] ${m[1]}`;
      }
      return raw;
    });
    fs.writeFileSync(absFile, newLines.join("\n"));
    console.log(`[migrate] .env güncellendi (backup: ${backup})`);
  }
}

main().catch((e) => { console.error("[migrate] fatal:", e); process.exit(2); });
