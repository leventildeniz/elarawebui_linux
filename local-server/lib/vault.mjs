// Vault helpers — AES-256-GCM crypto + audit + scope-wide secret fetch.
//
// Provides cryptographically identical encryption/decryption (VAULT_PASSPHRASE -> key derivation)
// and audited access for external modules (e.g. agent-env.mjs runtime injection).
//
// NOTE: Returns a {NAME: plaintext} map for a given scope.
// Plaintext is passed strictly to child process environments; never written to disk
// or emitted in console logs.

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
 * Runtime (headless/non-request) audit writer.
 * Records operational secret access to vault_audit table with explicit actor metadata.
 * Plaintext values are never logged.
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
    // Audit failures log warnings without disrupting operational execution flow.
    console.warn("[vaultAuditRuntime]", e.message);
  }
}

/**
 * Fetches and decrypts all secrets under a given scope.
 * Returns: { NAME: plaintext, ... } (corrupted/unparseable entries are safely skipped)
 *
 * @param {object} pool  pg Pool
 * @param {string} scope  e.g. "agent:firewall_oracle" or "global"
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
      // Do not block remaining records if a single entry fails decryption.
      console.warn(`[vault.getSecretsForScope] decrypt failed for ${scope}:${row.name}: ${e.message}`);
    }
  }
  return out;
}

/**
 * Fetches a single secret. Returns null if not found.
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
 * Programmatic (idempotent) secret write — for migration scripts.
 * Standard HTTP/UI operations route via /api/vault (session authentication + audit).
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

// Supported credential kinds and required field definitions. Validated with UI Zod schemas.
// 'custom' permits arbitrary dynamic fields.
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
 * Multi-field secret write. Idempotent: if secret_id exists, updates kind/meta
 * and upserts provided fields while preserving unmentioned fields for partial patching.
 *
 * @param {object} pool
 * @param {{scope:string, name:string, kind?:string, fields?:Record<string,string>, meta?:object}} input
 * @returns {Promise<{id:string, kind:string, field_names:string[]}>}
 */
export async function putSecretV2(pool, { scope, name, kind = "api_key", fields = {}, meta = {}, tenant_id = "default", is_global = false } = {}) {
  if (!pool || !scope || !name) throw new Error("scope/name required");
  const k = String(kind || "api_key");
  const id = `${scope}:${name}`;
  const fieldNames = Object.keys(fields || {});
  for (const fn of fieldNames) {
    if (!FIELD_NAME_RE.test(fn)) throw new Error(`invalid field name: ${fn}`);
  }
  // Schema validation (custom skips required checks).
  const spec = VAULT_KIND_FIELDS[k];
  if (spec && k !== "custom") {
    for (const req of spec.required) {
      if (!(req in fields) || String(fields[req] ?? "").length === 0) {
        // Allow partial updates if secret already exists
        const existing = await pool.query("SELECT id FROM vault_secrets WHERE id=$1", [id]);
        if (!existing.rows.length) throw new Error(`${k} requires field: ${req}`);
      }
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // vault_secrets upsert: encrypt placeholder if no primary field is provided
    // to satisfy schema NOT NULL constraints.
    const placeholder = fields.api_key ?? fields.token ?? fields.password ?? fields.api_key ?? "";
    const { ciphertext, iv, tag } = encryptSecret(placeholder);
    await client.query(
      `INSERT INTO vault_secrets(id, scope, name, ciphertext, iv, tag, kind, meta, tenant_id, is_global, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10, now())
       ON CONFLICT (scope,name) DO UPDATE
         SET kind = EXCLUDED.kind,
             meta = EXCLUDED.meta,
             tenant_id = COALESCE(vault_secrets.tenant_id, EXCLUDED.tenant_id),
             updated_at = now()`,
      [id, scope, name, ciphertext, iv, tag, k, JSON.stringify(meta || {}), tenant_id, is_global],
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
 * Returns field names only (without plaintext). Used for UI dropdown selection.
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
  // Backward compatibility: default to 'api_key' if no multi-field records exist
  if (names.length === 0) names = ["api_key"];
  return { kind: head.rows[0].kind || "api_key", meta: head.rows[0].meta || {}, field_names: names };
}

/**
 * Decrypts and returns all fields. Used for UI 'Reveal' and runtime agent credential binding.
 * Backward compatibility: presents legacy single-value records under the 'api_key' field.
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
    // Legacy single-value row fallback.
    try { out.api_key = decryptSecret(head.rows[0].ciphertext, head.rows[0].iv, head.rows[0].tag); }
    catch (e) { console.warn(`[vault.getSecretAllFields] legacy decrypt fail ${id}: ${e.message}`); }
  }
  return { kind: head.rows[0].kind || "api_key", meta: head.rows[0].meta || {}, fields: out };
}

/** Single field extraction (for runtime binding). */
export async function getSecretField(pool, scope, name, fieldName) {
  const all = await getSecretAllFields(pool, scope, name);
  if (!all) return null;
  return all.fields[fieldName] ?? null;
}

/**
 * Centralized Credential Resolver
 * - Strips 'raw://...' prefix and returns raw plaintext.
 * - Resolves 'vault://...' references against vault_secrets and returns decrypted field.
 * - Used across Mail, MCP, Chat, and Provider services for secure credential resolution.
 */
export async function resolveCredential(pool, credentialRef, fieldName = "api_key") {
  if (!credentialRef || typeof credentialRef !== "string") return credentialRef;

  // 1. Raw entry: strip prefix and return plaintext
  if (credentialRef.startsWith("raw://")) {
      return credentialRef.slice(6);
  }

  // 2. Vault reference: lookup and decrypt
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
          console.warn(`[Vault] resolveCredential lookup failed (${scope}.${name}):`, e.message);
      }
  }

  // 3. Fallback: pass through value as-is
  return credentialRef;
}
