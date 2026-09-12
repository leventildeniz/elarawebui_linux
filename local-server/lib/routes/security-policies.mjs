import { testExternalGuardrailProbe } from "../genguard-scanner.mjs";

export function mountSecurityPoliciesRoutes(app, deps) {
  const { pool, requireSession, broadcastAudit, enqueueWrite } = deps;

  const adminOnly = requireSession({ roles: ["admin", "operator"] });

  const emitPolicyLog = (level, action, message, meta = {}) => {
    const fullMeta = { tag: "rbac", stream: "policy", ...meta };
    if (broadcastAudit) {
      try {
        broadcastAudit({
          agent: "rbac",
          level,
          message: `policy.${action}: ${message}`,
          meta: fullMeta,
        });
      } catch (err) {
        console.warn("[policy] broadcastAudit notice:", err.message);
      }
    }
    if (enqueueWrite) {
      try {
        enqueueWrite(
          `INSERT INTO agent_logs(agent, level, message, meta) VALUES ($1,$2,$3,$4)`,
          ["rbac", level, `policy.${action}:${message}`, fullMeta]
        );
      } catch (err) {
        console.warn("[policy] enqueueWrite notice:", err.message);
      }
    }
  };

  // --- GenGuard Rules ---
  app.get("/api/security/genguard", adminOnly, async (req, res) => {
    try {
      const tenantId = req.session?.tenant_id || req.headers["x-tenant-id"] || "default";
      const isSuperAdmin = req.session?.role === "admin" && tenantId === "default";
      let query = "SELECT * FROM guard_rules";
      const params = [];
      if (!isSuperAdmin) {
        query += " WHERE (tenant_id = $1 OR is_global = true OR tenant_id = 'default')";
        params.push(tenantId);
      }
      query += " ORDER BY seq ASC, created_at ASC";

      const { rows } = await pool.query(query, params);
      res.json({ items: rows });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // POST /api/security/genguard/test-probe — Test connectivity to 3rd-party guardrail endpoint
  app.post("/api/security/genguard/test-probe", adminOnly, async (req, res) => {
    try {
      const { endpointUrl, authMode, vaultRef, apiKey, providerFormat, riskThreshold, timeoutMs } = req.body || {};
      if (!endpointUrl) return res.status(400).json({ ok: false, error: "endpointUrl is required" });

      const probeResult = await testExternalGuardrailProbe({
        endpointUrl,
        authMode,
        vaultRef,
        apiKey,
        providerFormat,
        riskThreshold,
        timeoutMs,
        pool,
      });

      res.json(probeResult);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err.message || err) });
    }
  });

  app.post("/api/security/genguard", adminOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const id = b.id || `gg.${Math.random().toString(36).slice(2, 7)}`;
      const name = String(b.name || "Untitled Rule").trim();
      const enabled = b.enabled !== false;
      const sensitivity = b.sensitivity || "medium";
      const inputBlacklist = b.input_blacklist || b.inputBlacklist || "";
      const outputPatterns = b.output_patterns || b.outputPatterns || "";
      const rulesPath = b.rules_path || b.rulesPath || "";
      const seq = Number(b.seq) || 10;
      const action = b.action || "deny";
      const engineType = b.engine_type || b.engineType || "native";
      const endpointUrl = b.endpoint_url || b.endpointUrl || null;
      const authMode = b.auth_mode || b.authMode || "vault";
      const vaultRef = b.vault_ref || b.vaultRef || null;
      const apiKey = b.api_key || b.apiKey || null;
      const providerFormat = b.provider_format || b.providerFormat || "generic";
      const riskThreshold = Number(b.risk_threshold ?? b.riskThreshold ?? 0.70);
      const stage = b.stage || "input";
      const timeoutMs = Number(b.timeout_ms ?? b.timeoutMs ?? 1500);
      const failMode = b.fail_mode || b.failMode || "fail_open";
      const tenantId = req.session?.tenant_id || "default";

      const out = await pool.query(
        `INSERT INTO guard_rules (
           id, name, enabled, sensitivity, input_blacklist, output_patterns, rules_path, seq, action,
           engine_type, endpoint_url, auth_mode, vault_ref, api_key, provider_format,
           risk_threshold, stage, timeout_ms, fail_mode, tenant_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         RETURNING *`,
        [
          id, name, enabled, sensitivity, inputBlacklist, outputPatterns, rulesPath, seq, action,
          engineType, endpointUrl, authMode, vaultRef, apiKey, providerFormat,
          riskThreshold, stage, timeoutMs, failMode, tenantId
        ]
      );
      emitPolicyLog("warn", "genguard.created", `${name} (${id})`, { id, name, action, engineType });
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/security/genguard/:id", adminOnly, async (req, res) => {
    try {
      const b = req.body || {};
      const id = req.params.id;
      const name = String(b.name || "Untitled Rule").trim();
      const enabled = b.enabled !== false;
      const sensitivity = b.sensitivity || "medium";
      const inputBlacklist = b.input_blacklist || b.inputBlacklist || "";
      const outputPatterns = b.output_patterns || b.outputPatterns || "";
      const rulesPath = b.rules_path || b.rulesPath || "";
      const seq = Number(b.seq) || 10;
      const action = b.action || "deny";
      const engineType = b.engine_type || b.engineType || "native";
      const endpointUrl = b.endpoint_url || b.endpointUrl || null;
      const authMode = b.auth_mode || b.authMode || "vault";
      const vaultRef = b.vault_ref || b.vaultRef || null;
      const apiKey = b.api_key || b.apiKey || null;
      const providerFormat = b.provider_format || b.providerFormat || "generic";
      const riskThreshold = Number(b.risk_threshold ?? b.riskThreshold ?? 0.70);
      const stage = b.stage || "input";
      const timeoutMs = Number(b.timeout_ms ?? b.timeoutMs ?? 1500);
      const failMode = b.fail_mode || b.failMode || "fail_open";

      const check = await pool.query("SELECT id FROM guard_rules WHERE id=$1", [id]);
      if (check.rowCount === 0) {
        const ins = await pool.query(
          `INSERT INTO guard_rules (
             id, name, enabled, sensitivity, input_blacklist, output_patterns, rules_path, seq, action,
             engine_type, endpoint_url, auth_mode, vault_ref, api_key, provider_format,
             risk_threshold, stage, timeout_ms, fail_mode
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           RETURNING *`,
          [
            id, name, enabled, sensitivity, inputBlacklist, outputPatterns, rulesPath, seq, action,
            engineType, endpointUrl, authMode, vaultRef, apiKey, providerFormat,
            riskThreshold, stage, timeoutMs, failMode
          ]
        );
        return res.json({ ok: true, item: ins.rows[0] });
      }

      const out = await pool.query(
        `UPDATE guard_rules
         SET name=$2, enabled=$3, sensitivity=$4, input_blacklist=$5, output_patterns=$6, rules_path=$7, seq=$8, action=$9,
             engine_type=$10, endpoint_url=$11, auth_mode=$12, vault_ref=$13, api_key=$14, provider_format=$15,
             risk_threshold=$16, stage=$17, timeout_ms=$18, fail_mode=$19
         WHERE id=$1
         RETURNING *`,
        [
          id, name, enabled, sensitivity, inputBlacklist, outputPatterns, rulesPath, seq, action,
          engineType, endpointUrl, authMode, vaultRef, apiKey, providerFormat,
          riskThreshold, stage, timeoutMs, failMode
        ]
      );
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/security/genguard/:id", adminOnly, async (req, res) => {
    try {
      const { rowCount } = await pool.query("DELETE FROM guard_rules WHERE id=$1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "not found" });
      emitPolicyLog("warn", "genguard.deleted", `id=${req.params.id}`, { id: req.params.id });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // --- Isolation Profiles ---
  app.get("/api/security/isolation", adminOnly, async (req, res) => {
    try {
      const kind = req.query.kind;
      const tenantId = req.session?.tenant_id || req.headers["x-tenant-id"] || "default";
      const isSuperAdmin = req.session?.role === "admin" && tenantId === "default";

      let query = "SELECT * FROM isolation_profiles";
      const params = [];
      const whereParts = [];

      if (kind) {
        params.push(kind);
        whereParts.push(`kind = $${params.length}`);
      }
      if (!isSuperAdmin) {
        params.push(tenantId);
        whereParts.push(`(tenant_id = $${params.length} OR is_global = true OR fallback = true OR tenant_id = 'default')`);
      }
      if (whereParts.length) {
        query += " WHERE " + whereParts.join(" AND ");
      }
      query += " ORDER BY created_at ASC";

      const { rows } = await pool.query(query, params);
      res.json({ items: rows });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/security/isolation", adminOnly, async (req, res) => {
    try {
      const { id, name, enabled, allowedPaths, deniedSyscalls, network, netAllowlist, tools, fallback, kind } = req.body;
      const out = await pool.query(
        `INSERT INTO isolation_profiles (id, name, enabled, allowed_paths, denied_syscalls, network, net_allowlist, tools, fallback, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          id, name, !!enabled, allowedPaths || '', deniedSyscalls || '', network || 'denied', 
          netAllowlist || '', JSON.stringify(tools || []), !!fallback, kind || 'tool'
        ]
      );
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/security/isolation/:id", adminOnly, async (req, res) => {
    try {
      const { name, enabled, allowedPaths, deniedSyscalls, network, netAllowlist, tools, fallback, kind } = req.body;
      const check = await pool.query("SELECT id FROM isolation_profiles WHERE id=$1", [req.params.id]);
      if (check.rowCount === 0) {
        const ins = await pool.query(
          `INSERT INTO isolation_profiles (id, name, enabled, allowed_paths, denied_syscalls, network, net_allowlist, tools, fallback, kind)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [
            req.params.id, name, enabled !== undefined ? Boolean(enabled) : true, allowedPaths || '', deniedSyscalls || '', network || 'denied',
            netAllowlist || '', JSON.stringify(tools || []), fallback !== undefined ? Boolean(fallback) : false, kind || 'tool'
          ]
        );
        return res.json({ ok: true, item: ins.rows[0] });
      }
      const out = await pool.query(
        `UPDATE isolation_profiles SET 
           name = COALESCE($2, name), 
           enabled = COALESCE($3::boolean, enabled), 
           allowed_paths = COALESCE($4, allowed_paths), 
           denied_syscalls = COALESCE($5, denied_syscalls), 
           network = COALESCE($6, network), 
           net_allowlist = COALESCE($7, net_allowlist), 
           tools = COALESCE($8::jsonb, tools), 
           fallback = COALESCE($9::boolean, fallback), 
           kind = COALESCE($10, kind)
         WHERE id=$1 RETURNING *`,
        [
          req.params.id, 
          name, 
          enabled !== undefined ? Boolean(enabled) : null, 
          allowedPaths, 
          deniedSyscalls, 
          network, 
          netAllowlist, 
          tools ? JSON.stringify(tools) : null, 
          fallback !== undefined ? Boolean(fallback) : null, 
          kind
        ]
      );
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/security/isolation/:id", adminOnly, async (req, res) => {
    try {
      const { rowCount } = await pool.query("DELETE FROM isolation_profiles WHERE id=$1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // --- Signed Artifacts (Workflows) ---
  app.get("/api/security/signed", adminOnly, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM signed_artifacts ORDER BY created_at ASC");
      res.json({ items: rows });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/security/signed", adminOnly, async (req, res) => {
    try {
      const { id, name, fingerprint, algorithm, enforcement } = req.body;
      const out = await pool.query(
        `INSERT INTO signed_artifacts (id, name, fingerprint, algorithm, enforcement, hash)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [id, name, fingerprint || '', algorithm || '', enforcement || '', '']
      );
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/security/signed/:id", adminOnly, async (req, res) => {
    try {
      const { name, fingerprint, algorithm, enforcement } = req.body;
      const check = await pool.query("SELECT id FROM signed_artifacts WHERE id=$1", [req.params.id]);
      if (check.rowCount === 0) {
        const ins = await pool.query(
          `INSERT INTO signed_artifacts (id, name, fingerprint, algorithm, enforcement, hash)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [req.params.id, name, fingerprint || '', algorithm || '', enforcement || '', '']
        );
        return res.json({ ok: true, item: ins.rows[0] });
      }
      const out = await pool.query(
        `UPDATE signed_artifacts SET name=$2, fingerprint=$3, algorithm=$4, enforcement=$5
         WHERE id=$1 RETURNING *`,
        [req.params.id, name, fingerprint || '', algorithm || '', enforcement || '']
      );
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/security/signed/:id", adminOnly, async (req, res) => {
    try {
      const { rowCount } = await pool.query("DELETE FROM signed_artifacts WHERE id=$1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  // --- Policy Engine ---
  app.get("/api/security/policy", adminOnly, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM policy_rules ORDER BY seq ASC, created_at ASC");
      res.json({ items: rows });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/security/policy", adminOnly, async (req, res) => {
    try {
      const { id, name, ifCondition, thenAction, priority, seq, enabled, action } = req.body;
      const out = await pool.query(
        `INSERT INTO policy_rules (id, name, if_condition, then_action, priority, seq, enabled, action)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [id, name, ifCondition || '', thenAction || '', priority || '', seq || 0, !!enabled, action || 'allow']
      );
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/security/policy/:id", adminOnly, async (req, res) => {
    try {
      const { name, ifCondition, thenAction, priority, seq, enabled, action } = req.body;
      const check = await pool.query("SELECT id FROM policy_rules WHERE id=$1", [req.params.id]);
      if (check.rowCount === 0) {
        const ins = await pool.query(
          `INSERT INTO policy_rules (id, name, if_condition, then_action, priority, seq, enabled, action)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [req.params.id, name, ifCondition || '', thenAction || '', priority || '', seq || 0, !!enabled, action || 'allow']
        );
        return res.json({ ok: true, item: ins.rows[0] });
      }
      const out = await pool.query(
        `UPDATE policy_rules SET name=$2, if_condition=$3, then_action=$4, priority=$5, seq=$6, enabled=$7, action=$8
         WHERE id=$1 RETURNING *`,
        [req.params.id, name, ifCondition || '', thenAction || '', priority || '', seq || 0, !!enabled, action || 'allow']
      );
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/security/policy/:id", adminOnly, async (req, res) => {
    try {
      const { rowCount } = await pool.query("DELETE FROM policy_rules WHERE id=$1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });
}
