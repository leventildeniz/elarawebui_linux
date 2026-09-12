// local-server/lib/routes/api-keys.mjs
// Developer Hub & Enterprise API Keys Management Routes (Google AI Studio Model)

import crypto from "node:crypto";
import { encryptSecret, decryptSecret } from "../vault.mjs";

export function mountApiKeysRoutes(app, deps) {
  const { pool, requireSession } = deps;

  /**
   * Helper: Resolve tenant_id and actor context from session or request
   */
  function resolveTenantAndUser(req) {
    const user = req.session?.username || req.actor || "admin";
    const tenantId = req.session?.tenant_id || req.headers["x-tenant-id"] || "default";
    const role = req.session?.role || "Developer";
    return { user, tenantId, role };
  }

  // =========================================================================
  // 1. GET /api/developer/keys — List all API Keys for tenant with decrypted keys
  // =========================================================================
  app.get("/api/developer/keys", async (req, res) => {
    try {
      const { tenantId, user, role } = resolveTenantAndUser(req);
      
      // Super-admins see all or tenant-specific; tenant users see their tenant's keys
      let query = `
        SELECT k.*, 
               r.name as tier_name, r.rpm_limit, r.tpm_limit, r.monthly_token_quota, r.max_concurrency
        FROM tenant_api_keys k
        LEFT JOIN tenant_rate_limits r ON k.tier = r.tier
      `;
      const params = [];

      if (role !== "Admin" && role !== "Sovereign") {
        query += " WHERE k.tenant_id = $1";
        params.push(tenantId);
      }
      query += " ORDER BY k.created_at DESC";

      const { rows } = await pool.query(query, params);

      // Decrypt secrets for authorized UI view (Google AI Studio model)
      const sanitizedKeys = rows.map((row) => {
        let rawKey = null;
        try {
          rawKey = decryptSecret(row.ciphertext, row.iv, row.tag);
        } catch (e) {
          rawKey = `${row.key_prefix}••••••••`;
        }

        return {
          id: row.id,
          name: row.name,
          key_prefix: row.key_prefix,
          raw_key: rawKey,
          tenant_id: row.tenant_id,
          user_id: row.user_id,
          role: row.role,
          tier: row.tier,
          tier_name: row.tier_name || row.tier,
          rpm_limit: row.rpm_limit,
          tpm_limit: row.tpm_limit,
          monthly_token_quota: row.monthly_token_quota,
          max_concurrency: row.max_concurrency,
          allowed_models: row.allowed_models || [],
          allowed_spaces: row.allowed_spaces || [],
          status: row.status,
          expires_at: row.expires_at,
          last_used_at: row.last_used_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      });

      return res.json({ ok: true, keys: sanitizedKeys });
    } catch (err) {
      console.error("[API Keys] List error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // =========================================================================
  // 2. POST /api/developer/keys — Generate a new cryptographically secure API Key
  // =========================================================================
  app.post("/api/developer/keys", async (req, res) => {
    try {
      const { tenantId, user, role } = resolveTenantAndUser(req);
      const {
        name,
        tier = "tier1",
        allowed_models = [],
        allowed_spaces = [],
        expires_at = null,
      } = req.body || {};

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ ok: false, error: "Key name is required." });
      }

      // Generate 24-byte cryptographically random raw token: sk-elara-live-...
      const randomToken = crypto.randomBytes(24).toString("hex");
      const rawKey = `sk-elara-live-${randomToken}`;
      const keyPrefix = rawKey.slice(0, 16);

      // Fast SHA-256 hash for O(1) index lookup on high-throughput gateway
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

      // AES-256-GCM encryption for Google AI Studio style reveal
      const enc = encryptSecret(rawKey);

      const insertRes = await pool.query(
        `INSERT INTO tenant_api_keys (
           key_prefix, key_hash, ciphertext, iv, tag, name,
           tenant_id, user_id, role, tier, allowed_models, allowed_spaces, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          keyPrefix,
          keyHash,
          enc.ciphertext,
          enc.iv,
          enc.tag,
          name.trim(),
          tenantId,
          user,
          role,
          tier,
          allowed_models,
          allowed_spaces,
          expires_at || null,
        ]
      );

      const created = insertRes.rows[0];

      return res.status(201).json({
        ok: true,
        key: {
          id: created.id,
          name: created.name,
          key_prefix: created.key_prefix,
          raw_key: rawKey,
          tenant_id: created.tenant_id,
          tier: created.tier,
          allowed_models: created.allowed_models,
          allowed_spaces: created.allowed_spaces,
          status: created.status,
          expires_at: created.expires_at,
          created_at: created.created_at,
        },
      });
    } catch (err) {
      console.error("[API Keys] Create error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // =========================================================================
  // 3. PATCH /api/developer/keys/:id — Update Key metadata or status
  // =========================================================================
  app.patch("/api/developer/keys/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { tenantId, role } = resolveTenantAndUser(req);
      const { name, tier, allowed_models, allowed_spaces, status, expires_at } = req.body || {};

      let checkQuery = "SELECT * FROM tenant_api_keys WHERE id = $1";
      const checkParams = [id];
      if (role !== "Admin" && role !== "Sovereign") {
        checkQuery += " AND tenant_id = $2";
        checkParams.push(tenantId);
      }

      const { rows: existing } = await pool.query(checkQuery, checkParams);
      if (!existing.length) {
        return res.status(404).json({ ok: false, error: "API Key not found or access denied." });
      }

      const current = existing[0];
      const newName = name !== undefined ? String(name).trim() : current.name;
      const newTier = tier !== undefined ? tier : current.tier;
      const newModels = Array.isArray(allowed_models) ? allowed_models : current.allowed_models;
      const newSpaces = Array.isArray(allowed_spaces) ? allowed_spaces : current.allowed_spaces;
      const newStatus = status !== undefined ? status : current.status;
      const newExpires = expires_at !== undefined ? expires_at : current.expires_at;

      const updateRes = await pool.query(
        `UPDATE tenant_api_keys
         SET name = $1, tier = $2, allowed_models = $3, allowed_spaces = $4, status = $5, expires_at = $6, updated_at = now()
         WHERE id = $7
         RETURNING *`,
        [newName, newTier, newModels, newSpaces, newStatus, newExpires, id]
      );

      return res.json({ ok: true, key: updateRes.rows[0] });
    } catch (err) {
      console.error("[API Keys] Update error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // =========================================================================
  // 4. DELETE /api/developer/keys/:id — Revoke / Delete API Key
  // =========================================================================
  app.delete("/api/developer/keys/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { tenantId, role } = resolveTenantAndUser(req);

      let delQuery = "DELETE FROM tenant_api_keys WHERE id = $1";
      const delParams = [id];
      if (role !== "Admin" && role !== "Sovereign") {
        delQuery += " AND tenant_id = $2";
        delParams.push(tenantId);
      }

      const result = await pool.query(delQuery, delParams);
      if (result.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "API Key not found or access denied." });
      }

      return res.json({ ok: true, message: "API Key revoked successfully." });
    } catch (err) {
      console.error("[API Keys] Delete error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // =========================================================================
  // 5. GET /api/developer/tiers — List available rate limiting tiers
  // =========================================================================
  app.get("/api/developer/tiers", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM tenant_rate_limits ORDER BY rpm_limit ASC");
      return res.json({ ok: true, tiers: rows });
    } catch (err) {
      console.error("[API Keys] Tiers error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/developer/tiers — Create or update a Rate Limit Tier
  app.post("/api/developer/tiers", async (req, res) => {
    try {
      const {
        tier,
        name,
        rpm_limit = 30,
        tpm_limit = 100000,
        monthly_token_quota = 25000000,
        max_concurrency = 5,
      } = req.body || {};

      if (!tier || !name) {
        return res.status(400).json({ ok: false, error: "Tier slug and name are required." });
      }

      const cleanSlug = String(tier).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");

      const insertRes = await pool.query(
        `INSERT INTO tenant_rate_limits (tier, name, rpm_limit, tpm_limit, monthly_token_quota, max_concurrency)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tier) DO UPDATE SET
           name = EXCLUDED.name,
           rpm_limit = EXCLUDED.rpm_limit,
           tpm_limit = EXCLUDED.tpm_limit,
           monthly_token_quota = EXCLUDED.monthly_token_quota,
           max_concurrency = EXCLUDED.max_concurrency,
           updated_at = now()
         RETURNING *`,
        [cleanSlug, name.trim(), Number(rpm_limit), Number(tpm_limit), Number(monthly_token_quota), Number(max_concurrency)]
      );

      return res.status(201).json({ ok: true, tier: insertRes.rows[0] });
    } catch (err) {
      console.error("[API Keys] Tier create error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PATCH /api/developer/tiers/:tier — Update existing Tier limits
  app.patch("/api/developer/tiers/:tier", async (req, res) => {
    try {
      const { tier } = req.params;
      const { name, rpm_limit, tpm_limit, monthly_token_quota, max_concurrency } = req.body || {};

      const { rows: existing } = await pool.query("SELECT * FROM tenant_rate_limits WHERE tier = $1", [tier]);
      if (!existing.length) {
        return res.status(404).json({ ok: false, error: "Tier not found." });
      }

      const cur = existing[0];
      const newName = name !== undefined ? String(name).trim() : cur.name;
      const newRpm = rpm_limit !== undefined ? Number(rpm_limit) : cur.rpm_limit;
      const newTpm = tpm_limit !== undefined ? Number(tpm_limit) : cur.tpm_limit;
      const newQuota = monthly_token_quota !== undefined ? Number(monthly_token_quota) : cur.monthly_token_quota;
      const newConc = max_concurrency !== undefined ? Number(max_concurrency) : cur.max_concurrency;

      const updateRes = await pool.query(
        `UPDATE tenant_rate_limits
         SET name = $1, rpm_limit = $2, tpm_limit = $3, monthly_token_quota = $4, max_concurrency = $5, updated_at = now()
         WHERE tier = $6
         RETURNING *`,
        [newName, newRpm, newTpm, newQuota, newConc, tier]
      );

      return res.json({ ok: true, tier: updateRes.rows[0] });
    } catch (err) {
      console.error("[API Keys] Tier update error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // DELETE /api/developer/tiers/:tier — Delete a Tier (reassigning active keys to tier1)
  app.delete("/api/developer/tiers/:tier", async (req, res) => {
    try {
      const { tier } = req.params;
      if (tier === "tier1") {
        return res.status(400).json({ ok: false, error: "Tier 1 is the default baseline tier and cannot be deleted." });
      }

      // Reassign any existing keys using this tier to tier1
      await pool.query("UPDATE tenant_api_keys SET tier = 'tier1' WHERE tier = $1", [tier]);

      const delRes = await pool.query("DELETE FROM tenant_rate_limits WHERE tier = $1", [tier]);
      if (delRes.rowCount === 0) {
        return res.status(404).json({ ok: false, error: "Tier not found." });
      }

      return res.json({ ok: true, message: `Tier '${tier}' deleted. Associated keys migrated to Tier 1.` });
    } catch (err) {
      console.error("[API Keys] Tier delete error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // =========================================================================
  // 6. GET /api/developer/usage — Developer Hub Token & Quota Metrics
  // =========================================================================
  app.get("/api/developer/usage", async (req, res) => {
    try {
      const { tenantId, role } = resolveTenantAndUser(req);
      
      // Calculate current month's start
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

      let usageQuery = `
        SELECT 
          COALESCE(SUM(prompt_tokens + response_tokens), 0)::bigint as monthly_tokens,
          COALESCE(SUM(cost_usd), 0)::numeric as monthly_cost,
          COALESCE(COUNT(*), 0)::bigint as total_requests,
          COALESCE(COUNT(CASE WHEN status != 'ok' THEN 1 END), 0)::bigint as total_errors
        FROM provider_usage
        WHERE created_at >= $1
      `;
      const params = [monthStart];

      if (role !== "Admin" && role !== "Sovereign") {
        usageQuery += " AND tenant_id = $2";
        params.push(tenantId);
      }

      const { rows: usageRows } = await pool.query(usageQuery, params);
      const usage = usageRows[0] || {};

      // Key-by-key breakdown
      let keyQuery = `
        SELECT 
          u.api_key_id,
          k.name as key_name,
          k.key_prefix,
          k.tier,
          COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0)::bigint as tokens,
          COALESCE(SUM(u.cost_usd), 0)::numeric as cost,
          COUNT(u.id)::bigint as requests
        FROM provider_usage u
        LEFT JOIN tenant_api_keys k ON u.api_key_id = k.id::text
        WHERE u.created_at >= $1 AND u.api_key_id IS NOT NULL
      `;
      const keyParams = [monthStart];
      if (role !== "Admin" && role !== "Sovereign") {
        keyQuery += " AND u.tenant_id = $2";
        keyParams.push(tenantId);
      }
      keyQuery += " GROUP BY u.api_key_id, k.name, k.key_prefix, k.tier ORDER BY tokens DESC";

      const { rows: keyBreakdown } = await pool.query(keyQuery, keyParams);

      return res.json({
        ok: true,
        month_start: monthStart,
        summary: {
          monthly_tokens: Number(usage.monthly_tokens || 0),
          monthly_cost: Number(Number(usage.monthly_cost || 0).toFixed(2)),
          total_requests: Number(usage.total_requests || 0),
          total_errors: Number(usage.total_errors || 0),
        },
        key_breakdown: keyBreakdown.map((k) => ({
          api_key_id: k.api_key_id,
          key_name: k.key_name || "Direct API / Unknown",
          key_prefix: k.key_prefix || "sk-elara-...",
          tier: k.tier || "tier1",
          tokens: Number(k.tokens),
          cost: Number(Number(k.cost).toFixed(2)),
          requests: Number(k.requests),
        })),
      });
    } catch (err) {
      console.error("[API Keys] Usage error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
}
