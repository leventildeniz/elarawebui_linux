// Block J Tur 1B — Skills CRUD + runs + key mgmt
// Pure transfer from server.mjs (lines 22027-22328). No behavior changes.
import path from "node:path";

export function mountSkillRoutes(app, deps) {
  const {
    pool,
    resolveActorContext,
    buildVisibility,
    getActorRole,
    ROLE_LEVEL,
    RISK_LEVEL,
    readSkillSecrets,
    writeSkillSecrets,
    broadcastAudit,
    coerceParams,
    validateAgainstSchema,
    createPrefixedId,
    liveRuns,
    runSkill,
    runEvent,
    sseBegin,
  } = deps;

  async function loadSkillByKey(key) {
    const { rows } = await pool.query("SELECT id, slug, optional_api_keys FROM skills WHERE id=$1 OR slug=$1 LIMIT 1", [key]);
    return rows[0] || null;
  }
  function declaredEnvVars(skill) {
    const raw = skill?.optional_api_keys;
    const list = Array.isArray(raw) ? raw : (typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
    return new Set(list.map(k => k?.envVar).filter(Boolean));
  }

  app.get("/api/skills/squads", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM skill_squads ORDER BY sort_order ASC, name ASC");
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/skills/squads", async (req, res) => {
    try {
      const { name, color } = req.body || {};
      const sq = String(name || "").trim();
      if (!sq) return res.status(400).json({ error: "name required" });
      const { rows } = await pool.query(
        "INSERT INTO skill_squads (name, color) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET color=EXCLUDED.color RETURNING *",
        [sq, color || 'sapphire']
      );
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/skills/squads/:name", async (req, res) => {
    try {
      const oldName = String(req.params.name).trim();
      const newName = String(req.body.name || "").trim();
      if (!newName) return res.status(400).json({ error: "name required" });
      
      const exists = await pool.query("SELECT 1 FROM skill_squads WHERE name=$1", [oldName]);
      if (!exists.rowCount) return res.status(404).json({ error: "not found" });
      
      await pool.query("UPDATE skill_squads SET name=$2 WHERE name=$1", [oldName, newName]);
      await pool.query("UPDATE skills SET squad=$2 WHERE squad=$1", [oldName, newName]);
      
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/skills/squads/:name", async (req, res) => {
    try {
      const sq = String(req.params.name).trim();
      await pool.query("DELETE FROM skill_squads WHERE name=$1", [sq]);
      await pool.query("UPDATE skills SET squad='Unassigned' WHERE squad=$1", [sq]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/skills", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      const vis = buildVisibility(ctx, 1, 'owner_id');
      const { rows } = await pool.query(
        `SELECT id, name, description, instructions, squad, icon, type, params,
                script_path, runtime_id, workflow_id, mcp_client_id, enabled, system, jewel,
                owner_id, owner_name, visibility, shared_with, created_at
         FROM skills
         WHERE ${vis.clause}
         ORDER BY system DESC, name`,
        vis.params
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.get("/api/skills/runs", async (req, res) => {
    try {
      const limit = Math.min(200, Number(req.query.limit) || 50);
      const params = []; const where = [];
      if (req.query.skill) { params.push(req.query.skill); where.push(`slug=$${params.length}`); }
      if (req.query.user)  { params.push(String(req.query.user).toLowerCase()); where.push(`lower(user_id)=$${params.length}`); }
      params.push(limit);
      const { rows } = await pool.query(
        `SELECT id, skill_id, slug, user_id, status, source, started_at, duration_ms, detail
         FROM skill_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY started_at DESC LIMIT $${params.length}`, params
      );
      res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.get("/api/skills/:id", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM skills WHERE id=$1 LIMIT 1", [req.params.id]);
      if (!rows[0]) return res.status(404).end();
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/skills", async (req, res) => {
    try {
      const b = req.body || {};
      const id = String(b.id || createPrefixedId("sk_")).trim();
      const name = String(b.name || "Untitled Skill").trim();
      const owner = b.ownerId || b.owner_id || ctx.userId || req.actor || null;
      const ownerName = b.ownerName || b.owner_name || null;

      const type = String(b.type || "native");
      if (!["native", "python", "workflow", "mcp"].includes(type)) {
        return res.status(400).json({ error: "invalid type" });
      }

      let scriptPath = null;
      let runtimeId = null;
      let workflowId = null;
      let mcpClientId = null;

      if (type === "python") {
        scriptPath = String(b.scriptPath || b.script_path || "").trim() || null;
        runtimeId = String(b.runtimeId || b.runtime_id || "").trim() || null;
        if (!scriptPath) return res.status(400).json({ error: "script_path required for python skill" });
        if (!scriptPath.toLowerCase().endsWith(".py")) return res.status(400).json({ error: "script_path must end with .py" });
      } else if (type === "workflow") {
        workflowId = String(b.workflowId || b.workflow_id || "").trim() || null;
      } else if (type === "mcp") {
        mcpClientId = String(b.mcpClientId || b.mcp_client_id || "").trim() || null;
      }

      const existing = (await pool.query("SELECT system FROM skills WHERE id=$1", [id])).rows[0];
      if (existing?.system && !ctx.isAdmin) {
        return res.status(403).json({ error: "system skills require admin" });
      }
      const keepSystem = !!existing?.system;

      await pool.query(
        `INSERT INTO skills(
           id, name, description, instructions, squad, icon, type, params,
           script_path, runtime_id, workflow_id, mcp_client_id, enabled, system, jewel, owner_id, owner_name,
           visibility, shared_with
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, description=EXCLUDED.description, instructions=EXCLUDED.instructions,
           squad=EXCLUDED.squad, icon=EXCLUDED.icon, type=EXCLUDED.type, params=EXCLUDED.params,
           script_path=EXCLUDED.script_path, runtime_id=EXCLUDED.runtime_id,
           workflow_id=EXCLUDED.workflow_id, mcp_client_id=EXCLUDED.mcp_client_id,
           enabled=EXCLUDED.enabled, jewel=EXCLUDED.jewel,
           owner_id=COALESCE(skills.owner_id, EXCLUDED.owner_id),
           owner_name=COALESCE(skills.owner_name, EXCLUDED.owner_name),
           visibility=EXCLUDED.visibility, shared_with=EXCLUDED.shared_with`,
        [
          id,
          name,
          String(b.description || ""),
          String(b.instructions || ""),
          String(b.squad || "Unassigned"),
          String(b.icon || "Sparkles"),
          type,
          JSON.stringify(b.params || []),
          scriptPath,
          runtimeId,
          workflowId,
          mcpClientId,
          b.enabled !== false,
          keepSystem,
          String(b.jewel || "sapphire"),
          owner,
          ownerName,
          b.visibility || "workspace",
          JSON.stringify(b.sharedWith || [])
        ]
      );
      
      const sq = String(b.squad || "").trim();
      if (sq && sq !== "Unassigned") {
        await pool.query("INSERT INTO skill_squads (name) VALUES ($1) ON CONFLICT DO NOTHING", [sq]);
      }

      res.json({ ok: true, id });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  app.put("/api/skills/:slugOrId/keys/:envVar", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      const role = await getActorRole(ctx.actor);
      if ((ROLE_LEVEL[role] ?? 0) < 1) return res.status(403).json({ error: "Operator role required" });
      const envVar = String(req.params.envVar || "").trim();
      if (!/^[A-Z_][A-Z0-9_]{1,63}$/.test(envVar)) return res.status(400).json({ error: "invalid envVar" });
      const value = String((req.body || {}).value || "");
      if (!value) return res.status(400).json({ error: "value required" });
      const skill = await loadSkillByKey(req.params.slugOrId);
      if (!skill) return res.status(404).json({ error: "skill not found" });
      if (!declaredEnvVars(skill).has(envVar)) return res.status(400).json({ error: `envVar ${envVar} not declared on skill ${skill.slug}` });
      const store = readSkillSecrets();
      store[envVar] = value;
      writeSkillSecrets(store);
      broadcastAudit({ agent: "skills", level: "info", message: `skill.key.set ${skill.slug}/${envVar}`, meta: { actor: ctx.actor } });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.delete("/api/skills/:slugOrId/keys/:envVar", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      const role = await getActorRole(ctx.actor);
      if ((ROLE_LEVEL[role] ?? 0) < 1) return res.status(403).json({ error: "Operator role required" });
      const envVar = String(req.params.envVar || "").trim();
      if (!/^[A-Z_][A-Z0-9_]{1,63}$/.test(envVar)) return res.status(400).json({ error: "invalid envVar" });
      const skill = await loadSkillByKey(req.params.slugOrId);
      if (!skill) return res.status(404).json({ error: "skill not found" });
      const store = readSkillSecrets();
      delete store[envVar];
      writeSkillSecrets(store);
      broadcastAudit({ agent: "skills", level: "info", message: `skill.key.unset ${skill.slug}/${envVar}`, meta: { actor: ctx.actor } });
      res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.delete("/api/skills/:id", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      const existing = (await pool.query("SELECT system, name FROM skills WHERE id=$1", [req.params.id])).rows[0];
      if (!existing) return res.status(404).json({ error: "not found" });
      if (existing.system && !ctx.isAdmin) {
        return res.status(403).json({ error: "system skills can only be deleted by admin" });
      }
      await pool.query("DELETE FROM skills WHERE id=$1", [req.params.id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/skills/:slugOrId/run", async (req, res) => {
    try {
      const key = req.params.slugOrId;
      const { rows } = await pool.query("SELECT * FROM skills WHERE id=$1 OR slug=$1 LIMIT 1", [key]);
      const skill = rows[0]; if (!skill) return res.status(404).json({ error: "skill not found" });
      const actor = req.actor || null;
      const role = await getActorRole(actor);
      const userLvl = ROLE_LEVEL[role] ?? 0;
      const need = RISK_LEVEL[skill.risk_level] ?? 0;
      if (userLvl < need) return res.status(403).json({ error: `role ${role} cannot run ${skill.risk_level} skill` });
      if (actor) {
        try {
          const { rows: ur } = await pool.query("SELECT allowed_skills, template_id FROM app_users WHERE lower(username)=lower($1) LIMIT 1", [actor]);
          const u = ur[0];
          if (u) {
            const userList = Array.isArray(u.allowed_skills) ? u.allowed_skills : (u.allowed_skills ? JSON.parse(u.allowed_skills) : []);
            let allowed = null;
            if (userList.length) allowed = userList;
            else if (u.template_id) {
              const { rows: tr } = await pool.query("SELECT allowed_skills FROM app_templates WHERE id=$1", [u.template_id]);
              const tList = tr[0] ? (Array.isArray(tr[0].allowed_skills) ? tr[0].allowed_skills : (tr[0].allowed_skills ? JSON.parse(tr[0].allowed_skills) : [])) : [];
              if (tList.length) allowed = tList;
            }
            if (allowed && !allowed.includes(skill.slug) && !allowed.includes(skill.id)) {
              return res.status(403).json({ error: `skill ${skill.slug} not in allowed list for ${actor}` });
            }
          }
        } catch (e) { console.error("[skills allowed_skills check]", e.message); }
      }
      const freeText = req.body?.input ?? req.body?.query ?? req.body?.text ?? null;
      const coercedParams = coerceParams(skill.param_schema, req.body?.params || {}, freeText);
      if (freeText && JSON.stringify(coercedParams) !== JSON.stringify(req.body?.params || {})) {
        broadcastAudit({ agent: "skills", level: "info", message: `param.autowrapped ${skill.slug}`, meta: { runId: null, freeTextLen: String(freeText).length } });
      }
      const v = validateAgainstSchema(skill.param_schema, coercedParams);
      if (!v.ok) return res.status(400).json({ error: "validation failed", details: v.errors });
      const runId = createPrefixedId("run.");
      const needsApproval = skill.requires_approval && userLvl < 2;
      const status = needsApproval ? "awaiting_approval" : "queued";
      await pool.query(
        `INSERT INTO skill_runs(id,skill_id,skill_slug,user_id,status,params,thread_id,parent_run_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [runId, skill.id, skill.slug, actor, status, JSON.stringify(v.value),
         req.body?.thread_id || null, req.body?.parent_run_id || null]
      );
      liveRuns.set(runId, {
        skill, params: v.value, steps: [], rollback_steps: [], metrics: [],
        clients: new Set(), status, output: null, cancel: false, requestedBy: actor,
      });
      broadcastAudit({ agent: "skills", level: "info", message: `skill.${status} ${skill.slug}`, meta: { runId, actor } });
      if (status === "queued") setImmediate(() => runSkill(runId));
      res.json({ ok: true, runId, status, validatedParams: v.value });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/skills/runs/:runId/approve", async (req, res) => {
    try {
      const runId = req.params.runId;
      const actor = req.actor; const role = await getActorRole(actor);
      if ((ROLE_LEVEL[role] ?? 0) < 2) return res.status(403).json({ error: "Admin role required" });
      const r = liveRuns.get(runId);
      if (!r) return res.status(404).json({ error: "run not in memory" });
      if (r.status !== "awaiting_approval") return res.status(400).json({ error: `cannot approve from ${r.status}` });
      await pool.query(
        `INSERT INTO skill_approvals(id,run_id,requested_by,approver,decision,decided_at) VALUES ($1,$2,$3,$4,'approved',now())`,
        [createPrefixedId("apr."), runId, r.requestedBy, actor]
      );
      r.status = "queued";
      runEvent(runId, { type: "approved", by: actor });
      setImmediate(() => runSkill(runId));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/skills/runs/:runId/reject", async (req, res) => {
    try {
      const runId = req.params.runId;
      const actor = req.actor; const role = await getActorRole(actor);
      if ((ROLE_LEVEL[role] ?? 0) < 2) return res.status(403).json({ error: "Admin role required" });
      const r = liveRuns.get(runId);
      if (r) { r.status = "cancelled"; runEvent(runId, { type: "rejected", by: actor }); }
      await pool.query(
        `INSERT INTO skill_approvals(id,run_id,approver,decision,decided_at) VALUES ($1,$2,$3,'rejected',now())`,
        [createPrefixedId("apr."), runId, actor]
      );
      await pool.query("UPDATE skill_runs SET status='cancelled', ended_at=now() WHERE id=$1", [runId]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/skills/runs/:runId/cancel", async (req, res) => {
    const r = liveRuns.get(req.params.runId);
    if (r) { r.cancel = true; runEvent(req.params.runId, { type: "cancel_requested" }); }
    res.json({ ok: true });
  });

  app.get("/api/skills/runs/:runId", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM skill_runs WHERE id=$1", [req.params.runId]);
      if (!rows[0]) return res.status(404).end();
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.get("/api/skills/runs/:runId/stream", (req, res) => {
    const sse = sseBegin(req, res);
    const runId = req.params.runId;
    const r = liveRuns.get(runId);
    if (!r) { sse.send({ type: "not_found" }); return sse.close(); }
    sse.send({ type: "snapshot", status: r.status, steps: r.steps, metrics: r.metrics, output: r.output });
    r.clients.add(res);
    const ka = setInterval(() => sse.keepAlive(), 15000);
    req.on("close", () => { clearInterval(ka); r.clients.delete(res); });
  });
}
