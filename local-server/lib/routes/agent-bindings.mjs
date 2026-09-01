// Tur 2B — Agent + Skill + Target bindings, target endpoints, resolved capabilities, forge dry-run.
// Extracted from server.mjs (was lines 16165-16827). Only dependency: `pool`.

export function mountAgentBindingsRoutes(app, deps) {
  const { pool } = deps;

  app.get("/api/agents/:id/rag-bindings", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT collection_id, top_k, threshold, enabled
           FROM agent_rag_bindings WHERE agent_id=$1 ORDER BY collection_id`,
        [req.params.id],
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  
  app.put("/api/agents/:id/rag-bindings", async (req, res) => {
    const id = String(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM agent_rag_bindings WHERE agent_id=$1", [id]);
      for (const b of items) {
        const collection_id = String(b.collection_id || "").trim();
        if (!collection_id) continue;
        const top_k = Math.max(1, Math.min(50, Number(b.top_k) || 8));
        const threshold = Math.max(0, Math.min(1, Number(b.threshold) || 0.62));
        const enabled = b.enabled === false ? false : true;
        await client.query(
          `INSERT INTO agent_rag_bindings(agent_id,collection_id,top_k,threshold,enabled)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (agent_id,collection_id) DO UPDATE
             SET top_k=EXCLUDED.top_k, threshold=EXCLUDED.threshold, enabled=EXCLUDED.enabled`,
          [id, collection_id, top_k, threshold, enabled],
        );
      }
      await client.query("COMMIT");
      res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => void 0);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally { client.release(); }
  });
  
  app.get("/api/agents/:id/vault-bindings", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, env_alias, vault_scope, vault_name, field_name
           FROM agent_vault_bindings WHERE agent_id=$1 ORDER BY env_alias`,
        [req.params.id],
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  
  app.put("/api/agents/:id/vault-bindings", async (req, res) => {
    const id = String(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM agent_vault_bindings WHERE agent_id=$1", [id]);
      for (const b of items) {
        const env_alias = String(b.env_alias || "").trim();
        const vault_scope = String(b.vault_scope || "").trim();
        const vault_name = String(b.vault_name || "").trim();
        const field_name = String(b.field_name || "").trim();
        if (!env_alias || !vault_scope || !vault_name || !field_name) continue;
        // env_alias defensiv format kontrolü
        if (!/^[A-Z_][A-Z0-9_]*$/i.test(env_alias)) continue;
        await client.query(
          `INSERT INTO agent_vault_bindings(agent_id,env_alias,vault_scope,vault_name,field_name)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (agent_id,env_alias) DO UPDATE
             SET vault_scope=EXCLUDED.vault_scope,
                 vault_name=EXCLUDED.vault_name,
                 field_name=EXCLUDED.field_name`,
          [id, env_alias, vault_scope, vault_name, field_name],
        );
      }
      await client.query("COMMIT");
      res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => void 0);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally { client.release(); }
  });
  
  // ============================================================
  // Tur-3 — Targets registry + agent adapter/target bindings
  // ============================================================
  const TARGET_KINDS = new Set(["firewall","router","server","cdn","social","custom"]);
  
  function sanitizeTargetGroup(b = {}) {
    const name = String(b.name || "").trim().slice(0, 120);
    if (!name) throw new Error("name required");
    return {
      name,
      kind: TARGET_KINDS.has(b.kind) ? b.kind : "custom",
      description: String(b.description || "").slice(0, 500),
      tags: Array.isArray(b.tags) ? b.tags.map(String).slice(0, 20) : [],
    };
  }
  function sanitizeTarget(b = {}) {
    const name = String(b.name || "").trim().slice(0, 200);
    if (!name) throw new Error("name required");
    const risk = ["low","medium","high","critical"].includes(b.risk_level) ? b.risk_level : "low";
    return {
      name,
      group_id: b.group_id ? String(b.group_id) : null,
      host: String(b.host || "").trim().slice(0, 255),
      ip: String(b.ip || "").trim().slice(0, 64),
      port: Number.isFinite(Number(b.port)) ? Number(b.port) : null,
      tags: Array.isArray(b.tags) ? b.tags.map(String).slice(0, 20) : [],
      risk_level: risk,
      requires_approval: !!b.requires_approval || risk === "high" || risk === "critical",
      vault_scope: String(b.vault_scope || "").slice(0, 200),
      vault_name:  String(b.vault_name  || "").slice(0, 200),
      default_adapter_id: b.default_adapter_id ? String(b.default_adapter_id) : null,
      owner: String(b.owner || "").slice(0, 200),
      notes: String(b.notes || "").slice(0, 1000),
    };
  }
  
  // (Targets routes have been moved to targets-crud.mjs to resolve shadowing)
  
  // --- Agent ↔ Adapter bindings
  app.get("/api/agents/:id/adapter-bindings", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT b.adapter_id, b.enabled, t.name, t.category, t.connection_type, t.risk_level
           FROM agent_adapter_bindings b
           JOIN tools t ON t.id=b.adapter_id
          WHERE b.agent_id=$1 ORDER BY t.name`,
        [req.params.id]);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.put("/api/agents/:id/adapter-bindings", async (req, res) => {
    const id = String(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM agent_adapter_bindings WHERE agent_id=$1", [id]);
      for (const b of items) {
        const adapter_id = String(b.adapter_id || "").trim();
        if (!adapter_id) continue;
        const enabled = b.enabled === false ? false : true;
        await client.query(
          `INSERT INTO agent_adapter_bindings(agent_id,adapter_id,enabled)
           VALUES ($1,$2,$3)
           ON CONFLICT (agent_id,adapter_id) DO UPDATE SET enabled=EXCLUDED.enabled`,
          [id, adapter_id, enabled]);
      }
      await client.query("COMMIT");
      res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => void 0);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally { client.release(); }
  });
  
  // --- Agent ↔ Target / Group bindings
  app.get("/api/agents/:id/target-bindings", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT scope, ref_id, enabled FROM agent_target_bindings
          WHERE agent_id=$1 ORDER BY scope, ref_id`, [req.params.id]);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.put("/api/agents/:id/target-bindings", async (req, res) => {
    const id = String(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM agent_target_bindings WHERE agent_id=$1", [id]);
      for (const b of items) {
        const scope = b.scope === "group" ? "group" : "target";
        const ref_id = String(b.ref_id || "").trim();
        if (!ref_id) continue;
        const enabled = b.enabled === false ? false : true;
        await client.query(
          `INSERT INTO agent_target_bindings(agent_id,scope,ref_id,enabled)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (agent_id,scope,ref_id) DO UPDATE SET enabled=EXCLUDED.enabled`,
          [id, scope, ref_id, enabled]);
      }
      await client.query("COMMIT");
      res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => void 0);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally { client.release(); }
  });
  
  // --- Tool bindings (adapter / target / reverse-agent) extracted to lib/routes/tools.mjs
  
  // --- Dry-run: validate params + ping bound adapters; NO real call. -----------
  // Body: { params?: Record<string, unknown> }
  // Returns: { ok, validation: { missing, extras }, adapters: [{id,name,ok,error?}] }
  app.post("/api/forge/actions/:id/dry-run", async (req, res) => {
    try {
      const id = String(req.params.id);
      const cur = await pool.query("SELECT id, params FROM action_library WHERE id=$1", [id]);
      if (!cur.rows[0]) return res.status(404).json({ ok: false, error: "tool not found" });
      const schema = Array.isArray(cur.rows[0].params) ? cur.rows[0].params : [];
      const input = (req.body && typeof req.body.params === "object" && req.body.params) || {};
      const requiredKeys = schema.filter(p => p && p.required === true).map(p => p.key);
      const schemaKeys = new Set(schema.map(p => p && p.key).filter(Boolean));
      const missing = requiredKeys.filter(k => input[k] === undefined || input[k] === null || input[k] === "");
      const extras = Object.keys(input).filter(k => !schemaKeys.has(k));
  
      // Probe bound adapters (best-effort, never throws).
      const bindings = await pool.query(
        `SELECT b.adapter_id, t.name FROM tool_adapter_bindings b
           JOIN tools t ON t.id=b.adapter_id WHERE b.tool_id=$1 AND b.enabled=true`,
        [id]).catch(() => ({ rows: [] }));
      const adapters = [];
      for (const b of bindings.rows) {
        try {
          const row = (await pool.query("SELECT enabled FROM adapters WHERE id=$1", [b.adapter_id])).rows[0];
          if (!row) { adapters.push({ id: b.adapter_id, name: b.name, ok: false, error: "adapter row missing" }); continue; }
          if (row.enabled === false) { adapters.push({ id: b.adapter_id, name: b.name, ok: false, error: "adapter disabled" }); continue; }
          adapters.push({ id: b.adapter_id, name: b.name, ok: true });
        } catch (e) {
          adapters.push({ id: b.adapter_id, name: b.name, ok: false, error: String(e.message || e) });
        }
      }
  
      const ok = missing.length === 0 && adapters.every(a => a.ok);
      res.json({ ok, validation: { missing, extras, required: requiredKeys.length, provided: Object.keys(input).length }, adapters });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  
  
  // =====================================================================
  // Tur-3.3 — Target endpoints (multi-port + multi-adapter per target)
  // =====================================================================
  app.get("/api/targets/:id/endpoints", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT e.id, e.target_id, e.adapter_id, e.port, e.label,
                e.vault_scope, e.vault_name, e.is_primary, e.last_health,
                e.created_at, e.updated_at,
                a.name AS adapter_name, a.category AS adapter_category,
                a.connection_type AS adapter_connection_type
           FROM target_endpoints e
           LEFT JOIN adapters a ON a.id = e.adapter_id
          WHERE e.target_id = $1
          ORDER BY e.is_primary DESC, e.port ASC`,
        [req.params.id]);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  
  app.put("/api/targets/:id/endpoints", async (req, res) => {
    const id = String(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Full replace; preserve last_health when adapter+port match existing row.
      const prev = await client.query(
        `SELECT adapter_id, port, last_health FROM target_endpoints WHERE target_id=$1`, [id]);
      const healthMap = new Map();
      for (const r of prev.rows) {
        healthMap.set(`${r.adapter_id || ""}::${r.port}`, r.last_health);
      }
      // Validate up-front so we can return a clean 400 instead of silently
      // dropping rows (UNIQUE conflict on (target_id, adapter_id, port=0)
      // used to swallow them).
      const invalid = items.filter((ep) => {
        const p = Number(ep.port);
        return !Number.isFinite(p) || p <= 0 || p > 65535;
      });
      if (invalid.length) {
        await client.query("ROLLBACK").catch(() => void 0);
        return res.status(400).json({
          ok: false,
          error: `endpoint_port_invalid: ${invalid.length} row(s) have port <= 0 or > 65535`,
          invalid_indexes: invalid.map((_, i) => i),
        });
      }
      await client.query("DELETE FROM target_endpoints WHERE target_id=$1", [id]);
      let primarySet = false;
      for (const ep of items) {
        const port = Number(ep.port);
        const adapter_id = ep.adapter_id ? String(ep.adapter_id).trim() : null;
        const label = String(ep.label || "").trim() || null;
        const vault_scope = String(ep.vault_scope || "").trim() || null;
        const vault_name = String(ep.vault_name || "").trim() || null;
        let is_primary = !!ep.is_primary;
        if (is_primary && primarySet) is_primary = false;
        if (is_primary) primarySet = true;
        const lastHealth = healthMap.get(`${adapter_id || ""}::${port}`) ?? null;
        await client.query(
          `INSERT INTO target_endpoints
             (target_id, adapter_id, port, label, vault_scope, vault_name, is_primary, last_health, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
          [id, adapter_id, port, label, vault_scope, vault_name, is_primary, lastHealth]);
      }
      // If nothing marked primary, mark first as primary
      if (!primarySet) {
        await client.query(
          `UPDATE target_endpoints SET is_primary=true
            WHERE id = (SELECT id FROM target_endpoints WHERE target_id=$1 ORDER BY port ASC LIMIT 1)`,
          [id]);
      }
      await client.query("COMMIT");
      res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => void 0);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally { client.release(); }
  });
  
  // Test-connect: TCP probe to host:port. Adapter-specific deep probes can extend later.
  app.post("/api/targets/:id/endpoints/:epId/test", async (req, res) => {
    const targetId = String(req.params.id);
    const epId = String(req.params.epId);
    try {
      const q = await pool.query(
        `SELECT e.port,
                COALESCE(e.adapter_id, t.default_adapter_id) AS adapter_id,
                COALESCE(e.vault_scope, t.vault_scope)       AS vault_scope,
                COALESCE(e.vault_name,  t.vault_name)        AS vault_name,
                t.host, t.ip
           FROM target_endpoints e
           JOIN targets t ON t.id = e.target_id
          WHERE e.id = $1 AND e.target_id = $2 LIMIT 1`,
        [epId, targetId]);
      if (!q.rows.length) return res.status(404).json({ ok: false, error: "endpoint_not_found" });
      const row = q.rows[0];
      const host = String(row.host || row.ip || "").trim();
      const port = Number(row.port);
      if (!host || !port) return res.status(400).json({ ok: false, error: "missing host/port" });
  
      const { default: net } = await import("net");
      const started = Date.now();
      const result = await new Promise((resolve) => {
        const socket = new net.Socket();
        let done = false;
        const finish = (payload) => {
          if (done) return;
          done = true;
          try { socket.destroy(); } catch {}
          resolve(payload);
        };
        socket.setTimeout(3000);
        socket.once("connect", () => finish({ ok: true, latency_ms: Date.now() - started }));
        socket.once("timeout", () => finish({ ok: false, error: "ETIMEDOUT", latency_ms: Date.now() - started }));
        socket.once("error", (err) => finish({ ok: false, error: err?.code || err?.message || "ERR", latency_ms: Date.now() - started }));
        socket.connect(port, host);
      });
      const health = { ok: !!result.ok, latency_ms: result.latency_ms, error: result.error || null, at: new Date().toISOString() };
      await pool.query(
        `UPDATE target_endpoints SET last_health=$1, updated_at=now() WHERE id=$2`,
        [health, epId]);
      res.json({ ok: true, health });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
  
  // =====================================================================
  // Tur-3.4 — Skill ↔ Adapter / Target bindings
  // =====================================================================
  app.get("/api/skills/:id/adapter-bindings", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT b.adapter_id, b.enabled, t.name, t.category, t.connection_type, t.risk_level
           FROM skill_adapter_bindings b
           JOIN tools t ON t.id = b.adapter_id
          WHERE b.skill_id = $1 ORDER BY t.name`,
        [req.params.id]);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.put("/api/skills/:id/adapter-bindings", async (req, res) => {
    const id = String(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM skill_adapter_bindings WHERE skill_id=$1", [id]);
      for (const b of items) {
        const adapter_id = String(b.adapter_id || "").trim();
        if (!adapter_id) continue;
        const enabled = b.enabled === false ? false : true;
        await client.query(
          `INSERT INTO skill_adapter_bindings(skill_id, adapter_id, enabled)
           VALUES ($1,$2,$3)
           ON CONFLICT (skill_id, adapter_id) DO UPDATE SET enabled=EXCLUDED.enabled`,
          [id, adapter_id, enabled]);
      }
      await client.query("COMMIT");
      res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => void 0);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally { client.release(); }
  });
  app.get("/api/skills/:id/target-bindings", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT scope, ref_id, enabled FROM skill_target_bindings
          WHERE skill_id=$1 ORDER BY scope, ref_id`, [req.params.id]);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.put("/api/skills/:id/target-bindings", async (req, res) => {
    const id = String(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM skill_target_bindings WHERE skill_id=$1", [id]);
      for (const b of items) {
        const scope = b.scope === "group" ? "group" : "target";
        const ref_id = String(b.ref_id || "").trim();
        if (!ref_id) continue;
        const enabled = b.enabled === false ? false : true;
        await client.query(
          `INSERT INTO skill_target_bindings(skill_id, scope, ref_id, enabled)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (skill_id, scope, ref_id) DO UPDATE SET enabled=EXCLUDED.enabled`,
          [id, scope, ref_id, enabled]);
      }
      await client.query("COMMIT");
      res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => void 0);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally { client.release(); }
  });
  
  // =====================================================================
  // Tur-3.5 — Agent Resolved Capabilities (effective adapters/targets union)
  // =====================================================================
  app.get("/api/agents/:id/resolved-capabilities", async (req, res) => {
    const agentId = String(req.params.id);
    try {
      // 1) Direct agent bindings + capability matrix
      const [aAdapters, aTargets, agentRow, capsRow] = await Promise.all([
        pool.query(
          `SELECT b.adapter_id AS id, t.name, t.category
             FROM agent_adapter_bindings b
             LEFT JOIN tools t ON t.id=b.adapter_id
            WHERE b.agent_id=$1 AND b.enabled=true`, [agentId]),
        pool.query(
          `SELECT scope, ref_id FROM agent_target_bindings
            WHERE agent_id=$1 AND enabled=true`, [agentId]),
        pool.query(`SELECT id, name, allowed_tools, allowed_skills, execution_policy
                      FROM agents WHERE id=$1 LIMIT 1`, [agentId]).catch(() => ({ rows: [] })),
        pool.query(`SELECT kind, ref_id FROM agent_capabilities WHERE agent_id=$1`, [agentId])
          .catch(() => ({ rows: [] })),
      ]);
  
      const agent = agentRow.rows[0] || {};
      const legacyTools = Array.isArray(agent.allowed_tools) ? agent.allowed_tools
        : (typeof agent.allowed_tools === "string" ? (JSON.parse(agent.allowed_tools || "[]")) : []);
      const legacySkills = Array.isArray(agent.allowed_skills) ? agent.allowed_skills
        : (typeof agent.allowed_skills === "string" ? (JSON.parse(agent.allowed_skills || "[]")) : []);
      // Primary source: agent_capabilities matrix (sealed by UI). Merge with
      // legacy agents.allowed_* for backward compatibility, then dedupe.
      const capTools  = capsRow.rows.filter((r) => r.kind === "tool").map((r) => String(r.ref_id));
      const capSkills = capsRow.rows.filter((r) => r.kind === "skill").map((r) => String(r.ref_id));
      const allowedTools  = [...new Set([...capTools,  ...legacyTools.map(String)].filter(Boolean))];
      const allowedSkills = [...new Set([...capSkills, ...legacySkills.map(String)].filter(Boolean))];
  
      // 2) Tool-derived bindings
      const toolsDetail = [];
      if (allowedTools.length) {
        const tAdapters = await pool.query(
          `SELECT b.tool_id, b.adapter_id AS id, t.name
             FROM tool_adapter_bindings b
             LEFT JOIN tools t ON t.id=b.adapter_id
            WHERE b.tool_id = ANY($1::text[]) AND b.enabled=true`, [allowedTools]);
        const tTargets = await pool.query(
          `SELECT tool_id, scope, ref_id FROM tool_target_bindings
            WHERE tool_id = ANY($1::text[]) AND enabled=true`, [allowedTools]);
        for (const toolId of allowedTools) {
          toolsDetail.push({
            id: toolId,
            adapters: tAdapters.rows.filter((r) => r.tool_id === toolId).map((r) => ({ id: r.id, name: r.name })),
            targets:  tTargets.rows.filter((r) => r.tool_id === toolId).map((r) => ({ scope: r.scope, ref_id: r.ref_id })),
          });
        }
      }
  
      // 3) Skill-derived bindings
      const skillsDetail = [];
      if (allowedSkills.length) {
        const sAdapters = await pool.query(
          `SELECT b.skill_id, b.adapter_id AS id, t.name
             FROM skill_adapter_bindings b
             LEFT JOIN tools t ON t.id=b.adapter_id
            WHERE b.skill_id = ANY($1::text[]) AND b.enabled=true`, [allowedSkills]).catch(() => ({ rows: [] }));
        const sTargets = await pool.query(
          `SELECT skill_id, scope, ref_id FROM skill_target_bindings
            WHERE skill_id = ANY($1::text[]) AND enabled=true`, [allowedSkills]).catch(() => ({ rows: [] }));
        for (const skillId of allowedSkills) {
          skillsDetail.push({
            id: skillId,
            adapters: sAdapters.rows.filter((r) => r.skill_id === skillId).map((r) => ({ id: r.id, name: r.name })),
            targets:  sTargets.rows.filter((r) => r.skill_id === skillId).map((r) => ({ scope: r.scope, ref_id: r.ref_id })),
          });
        }
      }
  
      // 4) Effective union
      const adapterMap = new Map();
      const targetMap = new Map();
      const addAdapter = (a, src) => {
        if (!a?.id) return;
        if (!adapterMap.has(a.id)) adapterMap.set(a.id, { id: a.id, name: a.name || a.id, sources: [] });
        adapterMap.get(a.id).sources.push(src);
      };
      const addTarget = (t, src) => {
        const key = `${t.scope}::${t.ref_id}`;
        if (!targetMap.has(key)) targetMap.set(key, { scope: t.scope, ref_id: t.ref_id, sources: [] });
        targetMap.get(key).sources.push(src);
      };
      aAdapters.rows.forEach((r) => addAdapter(r, "agent"));
      aTargets.rows.forEach((r) => addTarget(r, "agent"));
      toolsDetail.forEach((t) => {
        t.adapters.forEach((a) => addAdapter(a, `tool:${t.id}`));
        t.targets.forEach((tg) => addTarget(tg, `tool:${t.id}`));
      });
      skillsDetail.forEach((s) => {
        s.adapters.forEach((a) => addAdapter(a, `skill:${s.id}`));
        s.targets.forEach((tg) => addTarget(tg, `skill:${s.id}`));
      });
  
      // 5) Policy gate: collect ids blocked by execution_policy.deny_adapter_ids etc.
      const policy = (() => {
        try { return typeof agent.execution_policy === "string" ? JSON.parse(agent.execution_policy) : (agent.execution_policy || {}); }
        catch { return {}; }
      })();
      const denyAdapters = new Set(Array.isArray(policy.deny_adapter_ids) ? policy.deny_adapter_ids : []);
      const denyTargets = new Set(Array.isArray(policy.deny_target_ids) ? policy.deny_target_ids : []);
      const blocked = {
        adapters: [...adapterMap.values()].filter((a) => denyAdapters.has(a.id)).map((a) => a.id),
        targets:  [...targetMap.values()].filter((t) => denyTargets.has(t.ref_id)).map((t) => `${t.scope}::${t.ref_id}`),
      };
  
      res.json({
        ok: true,
        agent: { id: agentId, name: agent.name || agentId },
        tools: toolsDetail,
        skills: skillsDetail,
        effective_adapters: [...adapterMap.values()],
        effective_targets:  [...targetMap.values()],
        blocked_by_policy:  blocked,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
