// Vault helpers — AES-256-GCM crypto + audit + scope-wide secret fetch.
//
// Bu modül server.mjs'teki encryptSecret/decryptSecret/vaultAudit ile
// BİREBİR aynı davranışı sergiler (aynı VAULT_PASSPHRASE → aynı key türetimi).
// Amaç: server.mjs dışındaki modüllerin (özellikle agent-env.mjs runtime
// enjeksiyonu) vault'a güvenli ve audit'li erişebilmesi.
//
// NOT: Tek scope için tüm secret'ları çekip {NAME: plaintext} map'i döner.
// Plaintext sadece child process env'ine geçer; bu modül asla diske yazmaz,
// asla console.log ile plaintext basmaz.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const VAULT_KEY = scryptSync(
  process.env.VAULT_PASSPHRASE ?? "sovereign-default-passphrase",
  "sovereign-salt",
  32,
);

export function encryptSecret(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", VAULT_KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(ct, iv, tag) {
  const d = createDecipheriv("aes-256-gcm", VAULT_KEY, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/**
 * Runtime (req'siz) audit yazıcısı. Server.mjs'teki vaultAudit ile aynı
 * tabloya yazar ama `actor` parametresini explicit alır ('agent-runtime',
 * 'chat-ephemeral' vb.). Plaintext asla yazılmaz.
 *
 * @param {object} pool   pg Pool
 * @param {object} entry  {action, scope, name, actor, ok?, reason?, meta?}
 */
export async function vaultAuditRuntime(pool, entry) {
  if (!pool) return;
  const {
    action, scope, name, actor = "agent-runtime",
    ok = true, reason = null, meta = {},
  } = entry || {};
  try {
    await pool.query(
      `INSERT INTO vault_audit(action,scope,name,actor,session_id,ip,user_agent,ok,reason,meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        String(action ?? ""),
        String(scope ?? ""),
        String(name ?? ""),
        actor,
        null,
        null,
        null,
        !!ok,
        reason ? String(reason).slice(0, 500) : null,
        meta && typeof meta === "object" ? meta : {},
      ],
    );
  } catch (e) {
    // Audit hatası asla istek akışını bozmaz, sadece warn.
    console.warn("[vaultAuditRuntime]", e.message);
  }
}

/**
 * Bir scope altındaki tüm secret'ları çek ve decrypt et.
 * Dönüş: { NAME: plaintext, ... }  (hatalı/çözülemeyen kayıtlar atlanır)
 *
 * @param {object} pool  pg Pool
 * @param {string} scope  örn "agent:firewall_oracle" veya "global"
 * @returns {Promise<Record<string,string>>}
 */
export async function getSecretsForScope(pool, scope) {
  if (!pool || !scope) return {};
  const out = {};
  let rows = [];
  try {
    const r = await pool.query(
      "SELECT name, ciphertext, iv, tag FROM vault_secrets WHERE scope=$1",
      [String(scope)],
    );
    rows = r.rows || [];
  } catch (e) {
    console.warn("[vault.getSecretsForScope] query failed:", e.message);
    return {};
  }
  for (const row of rows) {
    try {
      out[row.name] = decryptSecret(row.ciphertext, row.iv, row.tag);
    } catch (e) {
      // Tek bir kayıt bozuksa diğerlerini bloklama.
      console.warn(`[vault.getSecretsForScope] decrypt failed for ${scope}:${row.name}: ${e.message}`);
    }
  }
  return out;
}

/**
 * Tek bir secret'ı çek. Bulunamazsa null döner.
 *
 * @param {object} pool
 * @param {string} scope
 * @param {string} name
 * @returns {Promise<string|null>}
 */
export async function getSecret(pool, scope, name) {
  if (!pool || !scope || !name) return null;
  try {
    const r = await pool.query(
      "SELECT ciphertext, iv, tag FROM vault_secrets WHERE scope=$1 AND name=$2 LIMIT 1",
      [String(scope), String(name)],
    );
    if (!r.rows.length) return null;
    return decryptSecret(r.rows[0].ciphertext, r.rows[0].iv, r.rows[0].tag);
  } catch (e) {
    console.warn(`[vault.getSecret] ${scope}:${name} failed: ${e.message}`);
    return null;
  }
}

/**
 * Programatik (idempotent) secret yazımı — migration script'leri için.
 * UI/HTTP üzerinden gelen yazımlar /api/vault'tan geçmeli (admin auth + audit).
 *
 * @param {object} pool
 * @param {string} scope
 * @param {string} name
 * @param {string} value
 */
export async function putSecret(pool, scope, name, value) {
  if (!pool || !scope || !name) throw new Error("scope/name required");
  const { ciphertext, iv, tag } = encryptSecret(value ?? "");
  const id = `${scope}:${name}`;
  await pool.query(
    `INSERT INTO vault_secrets(id, scope, name, ciphertext, iv, tag)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (scope,name) DO UPDATE
       SET ciphertext=EXCLUDED.ciphertext, iv=EXCLUDED.iv, tag=EXCLUDED.tag`,
    [id, scope, name, ciphertext, iv, tag],
  );
}

// ============================================================================
// Vault v2 — multi-field credentials (basic_auth, ssh_key, oauth2_client, ...)
// ============================================================================

// Tanınan tipler ve zorunlu alan listesi. UI Zod ile aynı şemayı doğrular.
// 'custom' herhangi bir alanı kabul eder. Bilinmeyen kind → 'custom' davranışı.
export const VAULT_KIND_FIELDS = {
  api_key:       { required: ["api_key"],                   optional: [] },
  bearer_token:  { required: ["token"],                     optional: [] },
  basic_auth:    { required: ["username", "password"],      optional: [] },
  ssh_password:  { required: ["username", "password"],      optional: [] },
  ssh_key:       { required: ["username", "private_key"],   optional: ["passphrase"] },
  oauth2_client: { required: ["client_id", "client_secret"], optional: ["token_url", "scope"] },
  aws_access_key:{ required: ["access_key_id", "secret_access_key"], optional: ["session_token"] },
  database_url:  { required: ["connection_string"],         optional: ["username", "password"] },
  mtls_cert:     { required: ["private_key", "certificate"], optional: ["passphrase"] },
  custom:        { required: [],                            optional: [] },
};

const FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

/**
 * Multi-field secret yazımı. Idempotent: secret_id (scope:name) varsa kind/meta
 * güncellenir, gelen field'lar upsert edilir, gelmeyen field'lar SİLİNMEZ
 * (kısmi update için). Tüm field'ları yenilemek istiyorsan önce delete et.
 *
 * @param {object} pool
 * @param {{scope:string, name:string, kind?:string, fields?:Record<string,string>, meta?:object}} input
 * @returns {Promise<{id:string, kind:string, field_names:string[]}>}
 */
export async function putSecretV2(pool, { scope, name, kind = "api_key", fields = {}, meta = {} } = {}) {
  if (!pool || !scope || !name) throw new Error("scope/name required");
  const k = String(kind || "api_key");
  const id = `${scope}:${name}`;
  const fieldNames = Object.keys(fields || {});
  for (const fn of fieldNames) {
    if (!FIELD_NAME_RE.test(fn)) throw new Error(`invalid field name: ${fn}`);
  }
  // Şema doğrulaması (custom → bypass).
  const spec = VAULT_KIND_FIELDS[k];
  if (spec && k !== "custom") {
    for (const req of spec.required) {
      if (!(req in fields) || String(fields[req] ?? "").length === 0) {
        // Kısmi update'e izin ver: secret zaten varsa ve bu çağrı diğer alanları
        // güncelliyorsa zorunlu alanı atlayabiliriz. İlk yazımda zorla.
        const existing = await pool.query("SELECT id FROM vault_secrets WHERE id=$1", [id]);
        if (!existing.rows.length) throw new Error(`${k} requires field: ${req}`);
      }
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // vault_secrets upsert. Legacy ciphertext/iv/tag NOT NULL → bir field varsa
    // onun değerini koy, yoksa boş bir placeholder şifrele (eski list endpoint'i
    // bu kayıtlara bakmaz; ileride drop edilecek).
    const placeholder = fields.api_key ?? fields.token ?? fields.password ?? fields.api_key ?? "";
    const { ciphertext, iv, tag } = encryptSecret(placeholder);
    await client.query(
      `INSERT INTO vault_secrets(id, scope, name, ciphertext, iv, tag, kind, meta, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())
       ON CONFLICT (scope,name) DO UPDATE
         SET kind = EXCLUDED.kind,
             meta = EXCLUDED.meta,
             updated_at = now()`,
      [id, scope, name, ciphertext, iv, tag, k, JSON.stringify(meta || {})],
    );
    for (const [fname, fval] of Object.entries(fields || {})) {
      const enc = encryptSecret(fval ?? "");
      await client.query(
        `INSERT INTO vault_secret_fields(secret_id, field_name, ciphertext, iv, tag, updated_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (secret_id, field_name) DO UPDATE
           SET ciphertext = EXCLUDED.ciphertext,
               iv = EXCLUDED.iv,
               tag = EXCLUDED.tag,
               updated_at = now()`,
        [id, fname, enc.ciphertext, enc.iv, enc.tag],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
  const fnRows = await pool.query(
    "SELECT field_name FROM vault_secret_fields WHERE secret_id=$1 ORDER BY field_name",
    [id],
  );
  return { id, kind: k, field_names: fnRows.rows.map((r) => r.field_name) };
}

/**
 * Sadece field isimleri (plaintext yok). UI dropdown'u için.
 */
export async function listSecretFieldNames(pool, scope, name) {
  if (!pool || !scope || !name) return null;
  const id = `${scope}:${name}`;
  const head = await pool.query("SELECT kind, meta FROM vault_secrets WHERE id=$1", [id]);
  if (!head.rows.length) return null;
  const fields = await pool.query(
    "SELECT field_name FROM vault_secret_fields WHERE secret_id=$1 ORDER BY field_name",
    [id],
  );
  let names = fields.rows.map((r) => r.field_name);
  // Geriye uyum: çok-alanlı kayıt yoksa ve eski tek-değer satırsa 'api_key' göster.
  if (names.length === 0) names = ["api_key"];
  return { kind: head.rows[0].kind || "api_key", meta: head.rows[0].meta || {}, field_names: names };
}

/**
 * Tüm alanları decrypt edip döndür. UI 'Reveal' ve agent binding için.
 * Geriye uyum: vault_secret_fields boşsa legacy ciphertext'i 'api_key' alanı
 * olarak sunar.
 */
export async function getSecretAllFields(pool, scope, name) {
  if (!pool || !scope || !name) return null;
  const id = `${scope}:${name}`;
  const head = await pool.query(
    "SELECT kind, meta, ciphertext, iv, tag FROM vault_secrets WHERE id=$1",
    [id],
  );
  if (!head.rows.length) return null;
  const fields = await pool.query(
    "SELECT field_name, ciphertext, iv, tag FROM vault_secret_fields WHERE secret_id=$1",
    [id],
  );
  const out = {};
  for (const r of fields.rows) {
    try { out[r.field_name] = decryptSecret(r.ciphertext, r.iv, r.tag); }
    catch (e) { console.warn(`[vault.getSecretAllFields] decrypt fail ${id}.${r.field_name}: ${e.message}`); }
  }
  if (Object.keys(out).length === 0) {
    // Legacy tek-değer satır.
    try { out.api_key = decryptSecret(head.rows[0].ciphertext, head.rows[0].iv, head.rows[0].tag); }
    catch (e) { console.warn(`[vault.getSecretAllFields] legacy decrypt fail ${id}: ${e.message}`); }
  }
  return { kind: head.rows[0].kind || "api_key", meta: head.rows[0].meta || {}, fields: out };
}

/** Tek bir alan (binding için). */
export async function getSecretField(pool, scope, name, fieldName) {
  const all = await getSecretAllFields(pool, scope, name);
  if (!all) return null;
  return all.fields[fieldName] ?? null;
}

/**
 * Merkezi Kimlik Bilgisi Çözümleyici (Credential Resolver)
 * - 'raw://...' formatındaki verilerin prefixini atıp düz (saf) döner.
 * - 'vault://...' formatındaki veriler için vault'a gidip belirtilen field'ı döner.
 * - Sisteme yeni eklenen veya eklenecek tüm servisler (Mail, MCP, Chat vb) API Key veya şifre çözerken bunu kullanmalıdır.
 */
export async function resolveCredential(pool, credentialRef, fieldName = "api_key") {
  if (!credentialRef || typeof credentialRef !== "string") return credentialRef;

  // 1. Manuel (Raw) giriş yapılmışsa, direkt temizleyip dön
  if (credentialRef.startsWith("raw://")) {
      return credentialRef.slice(6);
  }

  // 2. Vault girişi yapılmışsa
  if (credentialRef.startsWith("vault://") || credentialRef.startsWith("vault:")) {
      let vaultId = credentialRef.replace(/^vault:\/\//, "").replace(/^vault:/, "");
      while(vaultId.startsWith("vault://") || vaultId.startsWith("vault:")) {
          vaultId = vaultId.replace(/^vault:\/\//, "").replace(/^vault:/, "");
      }
      let scope = "providers";
      let name = vaultId;

      if (vaultId.includes('.')) {
          const parts = vaultId.split('.');
          scope = parts[0];
          name = parts.slice(1).join('.');
      } else if (vaultId.includes('/')) {
          const parts = vaultId.split('/');
          scope = parts[0];
          name = parts.slice(1).join('/');
      }

      try {
          const secretValue = await getSecretField(pool, scope, name, fieldName);
          if (secretValue) {
              return secretValue;
          }
      } catch(e) {
          console.warn(`[Vault] resolveCredential araması başarısız oldu (${scope}.${name}):`, e.message);
      }
  }

  // 3. Fallback (hiçbir şemaya uymuyorsa olduğu gibi dön)
  return credentialRef;
}
