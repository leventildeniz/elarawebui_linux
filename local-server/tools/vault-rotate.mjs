#!/usr/bin/env node
// =============================================================================
// vault-rotate.mjs — Faz 11.2
// VAULT_PASSPHRASE rotasyonu. Eski passphrase ile tüm vault_secrets satırlarını
// in-memory deşifre eder, yeni passphrase ile yeniden şifreler ve TEK
// transaction içinde geri yazar. Plaintext asla diske düşmez, asla loglanmaz.
//
// Kullanım:
//   OLD_VAULT_PASSPHRASE=<eski> NEW_VAULT_PASSPHRASE=<yeni> \
//   DATABASE_URL=postgres://... \
//   node local-server/tools/vault-rotate.mjs [--dry-run]
//
// --dry-run: sadece kaç satır ve hangi scope/name'leri etkileyeceğini yazar.
// =============================================================================

import pg from "pg";
import { scryptSync, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const DRY = process.argv.includes("--dry-run");
const OLD = process.env.OLD_VAULT_PASSPHRASE;
const NEW = process.env.NEW_VAULT_PASSPHRASE;
const URL = process.env.DATABASE_URL;

if (!OLD || !NEW || !URL) {
  console.error("missing env: OLD_VAULT_PASSPHRASE, NEW_VAULT_PASSPHRASE, DATABASE_URL");
  process.exit(2);
}
if (OLD === NEW) {
  console.error("OLD == NEW; nothing to do");
  process.exit(2);
}

const SALT = "sovereign-salt"; // server.mjs ile birebir aynı olmak zorunda
const oldKey = scryptSync(OLD, SALT, 32);
const newKey = scryptSync(NEW, SALT, 32);

function dec(key, ct, iv, tag) {
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]);
}
function enc(key, plainBuf) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const out = Buffer.concat([c.update(plainBuf), c.final()]);
  return {
    ciphertext: out.toString("base64"),
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
  };
}

const pool = new pg.Pool({ connectionString: URL });
const client = await pool.connect();
let rotated = 0, skipped = 0, failed = 0;

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = 0");

  const { rows } = await client.query(
    "SELECT id, scope, name, ciphertext, iv, tag FROM vault_secrets ORDER BY scope, name FOR UPDATE"
  );
  console.log(`vault_secrets rows: ${rows.length}`);

  for (const r of rows) {
    let plain;
    try {
      plain = dec(oldKey, r.ciphertext, r.iv, r.tag);
    } catch (e) {
      // Eski key ile çözülemiyor — büyük olasılıkla zaten yeni key ile şifreli
      // (idempotent rerun) veya farklı bir key ile şifrelendi. Sessizce atla,
      // sonda say.
      try {
        dec(newKey, r.ciphertext, r.iv, r.tag);
        skipped++;
        continue;
      } catch {
        failed++;
        console.error(`  FAIL ${r.scope}/${r.name} — neither OLD nor NEW key decrypts`);
        continue;
      }
    }
    const next = enc(newKey, plain);
    // Bellekteki plaintext'i hemen sıfırla.
    plain.fill(0);
    if (!DRY) {
      await client.query(
        "UPDATE vault_secrets SET ciphertext=$1, iv=$2, tag=$3 WHERE id=$4",
        [next.ciphertext, next.iv, next.tag, r.id]
      );
    }
    rotated++;
  }

  if (DRY) {
    await client.query("ROLLBACK");
    console.log(`[dry-run] would rotate ${rotated}, skipped ${skipped}, failed ${failed}`);
  } else {
    if (failed > 0) {
      await client.query("ROLLBACK");
      console.error(`ROLLBACK — ${failed} row(s) failed; no changes written`);
      process.exit(1);
    }
    await client.query("COMMIT");
    console.log(`rotated ${rotated}, skipped ${skipped}, failed ${failed}`);
  }
} catch (e) {
  try { await client.query("ROLLBACK"); } catch {}
  console.error("rotation aborted:", e.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
