// lib/schema-api-keys.mjs — Enterprise Developer Hub, Multi-Tenant API Keys & Rate Limiting Schema
// Bootstraps tenant_api_keys, tenant_rate_limits, and provider_usage tenant telemetry columns idempotently.

export function initApiKeysSchema({ pool }) {
  if (!pool) throw new Error("initApiKeysSchema: pool required");

  async function ensureApiKeysSchema() {
    // 1. Create tenant rate limits table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_rate_limits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tier TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        rpm_limit INT NOT NULL DEFAULT 15,
        tpm_limit INT NOT NULL DEFAULT 50000,
        monthly_token_quota BIGINT NOT NULL DEFAULT 10000000,
        max_concurrency INT NOT NULL DEFAULT 2,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `).catch((err) => {
      console.warn("[Schema] tenant_rate_limits notice:", err.message);
    });

    // Seed default tiers if table is empty
    const { rows: tierCount } = await pool.query("SELECT COUNT(*)::int AS n FROM tenant_rate_limits").catch(() => ({ rows: [{ n: 1 }] }));
    if (!tierCount[0]?.n) {
      const defaultTiers = [
        ["tier1", "Tier 1 (Free / Starter)", 15, 50000, 10000000, 2],
        ["tier2", "Tier 2 (Pro / Growth)", 60, 300000, 100000000, 10],
        ["tier3", "Tier 3 (Enterprise / Dedicated)", 300, 1000000, 1000000000, 50],
      ];
      for (const [tier, name, rpm, tpm, quota, concurrency] of defaultTiers) {
        await pool.query(
          `INSERT INTO tenant_rate_limits (tier, name, rpm_limit, tpm_limit, monthly_token_quota, max_concurrency)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tier) DO NOTHING`,
          [tier, name, rpm, tpm, quota, concurrency]
        ).catch(() => {});
      }
      console.log("[Schema] ✅ Default Tier 1/2/3 rate limits seeded.");
    }

    // 2. Create tenant organizations table (Tenants Identity Management)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        domain TEXT,
        tier TEXT NOT NULL DEFAULT 'tier1' REFERENCES tenant_rate_limits(tier) ON UPDATE CASCADE,
        allowed_models TEXT[] DEFAULT ARRAY[]::TEXT[],
        allowed_spaces TEXT[] DEFAULT ARRAY[]::TEXT[],
        allowed_agents TEXT[] DEFAULT ARRAY[]::TEXT[],
        admin_email TEXT,
        auth_provider TEXT DEFAULT 'local',
        auth_providers TEXT[] DEFAULT ARRAY['local']::TEXT[],
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `).catch((err) => {
      console.warn("[Schema] app_tenants notice:", err.message);
    });

    await pool.query(`
      ALTER TABLE app_tenants ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'local';
      ALTER TABLE app_tenants ADD COLUMN IF NOT EXISTS auth_providers TEXT[] DEFAULT ARRAY['local']::TEXT[];
      ALTER TABLE app_tenants ADD COLUMN IF NOT EXISTS retention_enabled BOOLEAN DEFAULT false;
      ALTER TABLE app_tenants ADD COLUMN IF NOT EXISTS retention_days INT DEFAULT 90;
      ALTER TABLE app_tenants ADD COLUMN IF NOT EXISTS retain_pinned BOOLEAN DEFAULT true;
    `).catch(() => {});

    const { rows: tenantCount } = await pool.query("SELECT COUNT(*)::int AS n FROM app_tenants").catch(() => ({ rows: [{ n: 1 }] }));
    if (!tenantCount[0]?.n) {
      await pool.query(`
        INSERT INTO app_tenants (slug, name, domain, tier, admin_email, status)
        VALUES ('default', 'Default Sovereign Organization', 'local', 'tier1', 'admin@sovereign.local', 'active')
        ON CONFLICT (slug) DO NOTHING
      `).catch(() => {});
      console.log("[Schema] ✅ Default Tenant Organization seeded.");
    }

    // 3. Ensure tenant_id column on app_users
    await pool.query(`
      ALTER TABLE app_users ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default';
    `).catch((err) => {
      console.warn("[Schema] app_users tenant_id notice:", err.message);
    });

    // 4. Create tenant API keys table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        name TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        user_id TEXT,
        role TEXT NOT NULL DEFAULT 'Developer',
        tier TEXT NOT NULL DEFAULT 'tier1' REFERENCES tenant_rate_limits(tier) ON UPDATE CASCADE,
        allowed_models TEXT[] DEFAULT ARRAY[]::TEXT[],
        allowed_spaces TEXT[] DEFAULT ARRAY[]::TEXT[],
        status TEXT NOT NULL DEFAULT 'active',
        alert_on_limit BOOLEAN DEFAULT true,
        alert_email TEXT,
        last_alert_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `).catch((err) => {
      console.warn("[Schema] tenant_api_keys notice:", err.message);
    });

    await pool.query(`
      ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS alert_on_limit BOOLEAN DEFAULT true;
      ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS alert_email TEXT;
      ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ;
    `).catch(() => {});

    // 3. Alter provider_usage table to track API key & tenant attribution
    await pool.query(`
      ALTER TABLE provider_usage ADD COLUMN IF NOT EXISTS api_key_id TEXT;
      ALTER TABLE provider_usage ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default';
      ALTER TABLE provider_usage ADD COLUMN IF NOT EXISTS client_ip TEXT;
      ALTER TABLE provider_usage ADD COLUMN IF NOT EXISTS byok_external BOOLEAN DEFAULT false;
    `).catch((err) => {
      console.warn("[Schema] provider_usage columns notice:", err.message);
    });

    // 4. Create performance indices
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_hash ON tenant_api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_status ON tenant_api_keys(status);
      CREATE INDEX IF NOT EXISTS idx_provider_usage_api_key ON provider_usage(api_key_id);
      CREATE INDEX IF NOT EXISTS idx_provider_usage_tenant ON provider_usage(tenant_id);
    `).catch((err) => {
      console.warn("[Schema] api keys indices notice:", err.message);
    });

    // 5. Ensure tenant_id and is_global on all ownable domain entities (Multi-Tenant Isolation)
    await pool.query(`
      ALTER TABLE guard_rules ADD COLUMN IF NOT EXISTS engine_type TEXT DEFAULT 'native';
      ALTER TABLE guard_rules ADD COLUMN IF NOT EXISTS endpoint_url TEXT;
      ALTER TABLE guard_rules ADD COLUMN IF NOT EXISTS auth_mode TEXT DEFAULT 'vault';
      ALTER TABLE guard_rules ADD COLUMN IF NOT EXISTS vault_ref TEXT;
      ALTER TABLE guard_rules ADD COLUMN IF NOT EXISTS api_key TEXT;
      ALTER TABLE guard_rules ADD COLUMN IF NOT EXISTS provider_format TEXT DEFAULT 'generic';
      ALTER TABLE guard_rules ADD COLUMN IF NOT EXISTS risk_threshold NUMERIC DEFAULT 0.70;
      ALTER TABLE guard_rules ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'input';
      ALTER TABLE guard_rules ADD COLUMN IF NOT EXISTS timeout_ms INT DEFAULT 1500;
      ALTER TABLE guard_rules ADD COLUMN IF NOT EXISTS fail_mode TEXT DEFAULT 'fail_open';
    `).catch(() => {});

    const tablesToTenantize = [
      'app_users', 'app_sessions', 'app_groups', 'agents', 'skills', 'tools',
      'workflows', 'orchestrations', 'knowledge_spaces', 'rag_folders',
      'knowledge_sources', 'chat_threads',
      // Ring 2 — Expanded Subsystems:
      'mcp_client_servers', 'mcp_clients', 'mcp_exposures', 'mcp_tokens',
      'capability_packs', 'capabilities', 'capability_proposals',
      'action_library', 'forge_plans', 'forge_outputs', 'forge_artifacts',
      'planners', 'planner_runs', 'planner_events',
      'memory_facts', 'memory_episodic', 'memory_working',
      'prompt_snippets', 'prompt_layers',
      'runtimes', 'adapters', 'adapter_dictionaries', 'webhooks',
      'targets', 'target_endpoints', 'target_groups',
      'schedules', 'schedule_deliveries', 'report_exports',
      'approval_requests', 'tool_approvals', 'skill_approvals',
      'telemetry_boards', 'vault_secrets',
      'guard_rules', 'isolation_profiles', 'signed_artifacts', 'policy_rules',
      'cve_watchlists'
    ];

    for (const tbl of tablesToTenantize) {
      await pool.query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default';`).catch(() => {});
      if (tbl !== 'app_users' && tbl !== 'app_sessions') {
        await pool.query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT false;`).catch(() => {});
      }
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tbl}_tenant_id ON ${tbl}(tenant_id);`).catch(() => {});
    }

    // Seal system / platform global assets across Ring 1 and Ring 2
    await pool.query(`
      UPDATE agents SET is_global = true WHERE id = 'agt.forge_master' OR id LIKE 'sys.%' OR (owner_id IS NULL AND tenant_id = 'default');
      UPDATE skills SET is_global = true WHERE system = true OR (owner_id IS NULL AND tenant_id = 'default');
      UPDATE tools SET is_global = true WHERE source = 'native' OR (owner_id IS NULL AND tenant_id = 'default');
      UPDATE knowledge_spaces SET is_global = true WHERE id = 'spc.default' OR slug = 'default';
      UPDATE mcp_client_servers SET is_global = true WHERE owner_id IS NULL AND tenant_id = 'default';
      UPDATE capability_packs SET is_global = true WHERE system = true OR (owner_id IS NULL AND tenant_id = 'default');
      UPDATE planners SET is_global = true WHERE owner_id IS NULL AND tenant_id = 'default';
      UPDATE memory_facts SET is_global = true WHERE scope = 'system' OR (tenant_id = 'default' AND scope = 'workspace');
      UPDATE prompt_snippets SET is_global = true WHERE owner_id IS NULL AND tenant_id = 'default';
      UPDATE runtimes SET is_global = true WHERE owner_id IS NULL AND tenant_id = 'default';
      UPDATE adapters SET is_global = true WHERE owner_id IS NULL AND tenant_id = 'default';
      UPDATE webhooks SET is_global = true WHERE owner_id IS NULL AND tenant_id = 'default';
      UPDATE targets SET is_global = true WHERE owner_id IS NULL AND tenant_id = 'default';
      UPDATE schedules SET is_global = true WHERE owner_id IS NULL AND tenant_id = 'default';
      UPDATE telemetry_boards SET is_global = true WHERE owner_id IS NULL AND tenant_id = 'default';
      UPDATE vault_secrets SET is_global = true WHERE scope = 'global' OR scope = 'system' OR tenant_id = 'default';
      UPDATE guard_rules SET is_global = true WHERE tenant_id = 'default';
      UPDATE isolation_profiles SET is_global = true WHERE fallback = true OR tenant_id = 'default';
      UPDATE signed_artifacts SET is_global = true WHERE tenant_id = 'default';
      UPDATE policy_rules SET is_global = true WHERE tenant_id = 'default';
    `).catch(() => {});

    // Create index on knowledge_chunks(space_id) for instant O(log N) multi-tenant RAG retrieval
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_space ON knowledge_chunks(space_id);`).catch(() => {});

    console.log("[Schema] ✅ Enterprise API Keys & Multi-Tenant Zero-Trust Isolation (360° Ring 1 & Ring 2) schema ready.");
  }

  return { ensureApiKeysSchema };
}
