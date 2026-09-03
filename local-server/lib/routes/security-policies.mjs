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
      const { rows } = await pool.query("SELECT * FROM guard_rules ORDER BY seq ASC, created_at ASC");
      res.json({ items: rows });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/security/genguard", adminOnly, async (req, res) => {
    try {
      const { id, name, enabled, sensitivity, inputBlacklist, outputPatterns, rulesPath, seq, action } = req.body;
      const out = await pool.query(
        `INSERT INTO guard_rules (id, name, enabled, sensitivity, input_blacklist, output_patterns, rules_path, seq, action)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [id, name, !!enabled, sensitivity || '', inputBlacklist || '', outputPatterns || '', rulesPath || '', seq || 0, action || 'deny']
      );
      emitPolicyLog("warn", "genguard.created", `${name} (${id})`, { id, name, action: action || 'deny' });
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/security/genguard/:id", adminOnly, async (req, res) => {
    try {
      const { name, enabled, sensitivity, inputBlacklist, outputPatterns, rulesPath, seq, action } = req.body;
      const check = await pool.query("SELECT id FROM guard_rules WHERE id=$1", [req.params.id]);
      if (check.rowCount === 0) {
        const ins = await pool.query(
          `INSERT INTO guard_rules (id, name, enabled, sensitivity, input_blacklist, output_patterns, rules_path, seq, action)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [req.params.id, name, !!enabled, sensitivity || '', inputBlacklist || '', outputPatterns || '', rulesPath || '', seq || 0, action || 'deny']
        );
        return res.json({ ok: true, item: ins.rows[0] });
      }
      const out = await pool.query(
        `UPDATE guard_rules SET name=$2, enabled=$3, sensitivity=$4, input_blacklist=$5, output_patterns=$6, rules_path=$7, seq=$8, action=$9
         WHERE id=$1 RETURNING *`,
        [req.params.id, name, !!enabled, sensitivity || '', inputBlacklist || '', outputPatterns || '', rulesPath || '', seq || 0, action || 'deny']
      );
      res.json({ ok: true, item: out.rows[0] });
    } catch (e) {
      console.error(e); res.status(500).json({ error: String(e.message || e) });
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
      const q = kind ? pool.query("SELECT * FROM isolation_profiles WHERE kind=$1 ORDER BY created_at ASC", [kind]) 
                     : pool.query("SELECT * FROM isolation_profiles ORDER BY created_at ASC");
      const { rows } = await q;
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
