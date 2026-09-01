// local-server/lib/mcp/registry.mjs
// MCP settings + exposures + tokens + history helpers.
// Pure DB layer; no HTTP / no dispatch logic here.

import { createHash, randomBytes } from "node:crypto";

export function sha256(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}

export async function getMcpSettings(pool) {
  const { rows } = await pool.query("SELECT * FROM mcp_settings WHERE id=1");
  if (!rows.length) {
    await pool.query("INSERT INTO mcp_settings (id) VALUES (1) ON CONFLICT DO NOTHING");
    const r2 = await pool.query("SELECT * FROM mcp_settings WHERE id=1");
    return r2.rows[0];
  }
  return rows[0];
}

export async function updateMcpSettings(pool, patch = {}) {
  const cur = await getMcpSettings(pool);
  const merged = {
    enabled: patch.enabled ?? cur.enabled,
    auth_mode: patch.auth_mode ?? cur.auth_mode,
    rate_limit_per_min: Number.isFinite(patch.rate_limit_per_min) ? patch.rate_limit_per_min : cur.rate_limit_per_min,
    namespace: patch.namespace ?? cur.namespace,
    auth_source_key: patch.auth_source_key ?? cur.auth_source_key,
    auth_fallback_key: patch.auth_fallback_key ?? cur.auth_fallback_key,
  };
  if (!["loopback", "bearer", "oauth", "oauth2", "oidc", "entra"].includes(merged.auth_mode)) {
    throw new Error(`invalid auth_mode: ${merged.auth_mode}`);
  }
  await pool.query(
    `UPDATE mcp_settings SET
       enabled=$1, auth_mode=$2, rate_limit_per_min=$3, namespace=$4, auth_source_key=$5, auth_fallback_key=$6, updated_at=now()
     WHERE id=1`,
    [merged.enabled, merged.auth_mode, merged.rate_limit_per_min, merged.namespace, merged.auth_source_key, merged.auth_fallback_key],
  );
  return getMcpSettings(pool);
}

export async function listExposures(pool) {
  const { rows } = await pool.query(
    `SELECT id, kind, slug, enabled, display_name, description, created_at, updated_at
       FROM mcp_exposures ORDER BY kind, slug`,
  );
  return rows;
}

export async function upsertExposure(pool, { kind, slug, enabled = true, display_name = null, description = null }) {
  if (!["agent", "tool", "skill"].includes(kind)) throw new Error(`invalid kind: ${kind}`);
  if (!slug) throw new Error("slug required");
  const { rows } = await pool.query(
    `INSERT INTO mcp_exposures (kind, slug, enabled, display_name, description)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (kind, slug) DO UPDATE SET
       enabled=EXCLUDED.enabled,
       display_name=EXCLUDED.display_name,
       description=EXCLUDED.description,
       updated_at=now()
     RETURNING *`,
    [kind, slug, enabled, display_name, description],
  );
  return rows[0];
}

export async function setExposureEnabled(pool, { kind, slug, enabled }) {
  const { rows } = await pool.query(
    `UPDATE mcp_exposures SET enabled=$3, updated_at=now()
      WHERE kind=$1 AND slug=$2 RETURNING *`,
    [kind, slug, !!enabled],
  );
  if (!rows.length) {
    return upsertExposure(pool, { kind, slug, enabled: !!enabled });
  }
  return rows[0];
}

export async function deleteExposure(pool, id) {
  await pool.query("DELETE FROM mcp_exposures WHERE id=$1", [id]);
}

export async function listEnabledExposures(pool) {
  const { rows } = await pool.query(
    `SELECT kind, slug, display_name, description FROM mcp_exposures WHERE enabled=true`,
  );
  return rows;
}

// -------- Tokens --------

export function generateRawToken() {
  // 32 bytes → 43 char base64url; prefix with "mcp_" for clarity
  return "mcp_" + randomBytes(32).toString("base64url");
}

export async function createToken(pool, { label, createdBy = null }) {
  if (!label) throw new Error("label required");
  const raw = generateRawToken();
  const hash = sha256(raw);
  const prefix = raw.slice(0, 12);
  const { rows } = await pool.query(
    `INSERT INTO mcp_tokens (label, token_hash, token_prefix, created_by)
     VALUES ($1,$2,$3,$4) RETURNING id, label, token_prefix, created_at`,
    [label, hash, prefix, createdBy],
  );
  return { ...rows[0], token: raw }; // raw returned ONCE
}

export async function listTokens(pool) {
  const { rows } = await pool.query(
    `SELECT id, label, token_prefix, created_by, created_at, last_used_at, revoked_at
       FROM mcp_tokens ORDER BY created_at DESC`,
  );
  return rows;
}

export async function revokeToken(pool, id) {
  await pool.query(`UPDATE mcp_tokens SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, [id]);
}

export async function verifyToken(pool, raw) {
  if (!raw) return null;
  const hash = sha256(raw);
  const { rows } = await pool.query(
    `SELECT id, label FROM mcp_tokens WHERE token_hash=$1 AND revoked_at IS NULL LIMIT 1`,
    [hash],
  );
  if (!rows.length) return null;
  pool.query(`UPDATE mcp_tokens SET last_used_at=now() WHERE id=$1`, [rows[0].id]).catch(() => {});
  return rows[0];
}

// -------- History --------

export function recordCall(pool, { clientId, method, toolName = null, ok = true, durationMs = 0, error = null, remoteIp = null }) {
  return pool.query(
    `INSERT INTO mcp_call_history (client_id, method, tool_name, ok, duration_ms, error, remote_ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [clientId || null, method, toolName, !!ok, Math.max(0, Math.round(durationMs || 0)), error, remoteIp],
  ).catch(() => {});
}

export async function recentCalls(pool, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, ts, client_id, method, tool_name, ok, duration_ms, error, remote_ip
       FROM mcp_call_history ORDER BY ts DESC LIMIT $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  return rows;
}

export async function callStats(pool) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE ok=false)::int AS errors,
       COUNT(*) FILTER (WHERE ts > now() - interval '1 hour')::int AS last_hour,
       MAX(ts) AS last_call
     FROM mcp_call_history`,
  );
  return rows[0] || { total: 0, errors: 0, last_hour: 0, last_call: null };
}
