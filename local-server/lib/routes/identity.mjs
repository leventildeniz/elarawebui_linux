// Identity routes — users / groups / RBAC / auth-providers / login / sessions
// Moved from server.mjs (B-1 / Tur 1.1, 2026-05-30). Behaviour identical.
import { initAuthSchema } from "../schema-auth.mjs";

const SECRET_FIELDS = {
  entra:  ["clientSecret"],
  ldap:   ["bindPassword"],
  radius: ["secret"],
  oidc:   ["clientSecret"],
  oauth2: ["clientSecret"],
  saml:   [],
  local:  [],
};

export async function mountIdentityRoutes(app, deps) {
  const {
    pool,
    hashPassword, verifyPassword, randomBytes,
    createPrefixedId, createLocalId,
    rowToUser,
    isAdminCaller, rlLogin, enqueueWrite, broadcastAudit,
    encryptSecret, decryptSecret,
    authenticateLdap, authenticateRadius,
  } = deps;

  const { ensureFederatedUser } = initAuthSchema({ pool, hashPassword, createPrefixedId, randomBytes });

  // ---------- Users ----------
  app.get("/api/identity/users", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM app_users ORDER BY created_at ASC");
      res.json(rows.map(rowToUser));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/identity/users", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const u = req.body ?? {};
    if (!u.username) return res.status(400).json({ error: "username required" });
    const id = u.id || createPrefixedId("u_");
    const { hash, salt } = hashPassword(u.password || randomBytes(8).toString("hex"));
    try {
      await pool.query(
        `INSERT INTO app_users(id,username,display_name,email,phone,password_hash,password_salt,provider,role,groups,template_id,status,valid_until,must_change_password,avatar_style,avatar_jewel,avatar_seed,allowed_providers,can_override_provider,allowed_agents,allowed_tools,allowed_skills)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20::jsonb,$21::jsonb,$22::jsonb)`,
        [id, u.username, u.name ?? u.username, u.email ?? "", u.phone ?? "", hash, salt,
         u.provider ?? "local", u.role ?? "Viewer", JSON.stringify(u.groups ?? []),
         u.templateId ?? null, u.status ?? "invited",
         u.validUntil ?? null, !!u.mustChangePassword, 
         u.avatarStyle ?? "sigil", u.avatarJewel ?? "sapphire", u.avatarSeed ?? "",
         JSON.stringify(Array.isArray(u.allowedProviders) ? u.allowedProviders : []),
         u.canOverrideProvider !== false,
         JSON.stringify(Array.isArray(u.allowedAgents) ? u.allowedAgents : []),
         JSON.stringify(Array.isArray(u.allowedTools) ? u.allowedTools : []),
         JSON.stringify(Array.isArray(u.allowedSkills) ? u.allowedSkills : [])]
      );
      if (u.templateId) {
        await pool.query(
          `INSERT INTO app_template_assignments (id, username, template_id)
           VALUES ($1,$2,$3) ON CONFLICT (username, template_id) DO NOTHING`,
          [`assign-${id}`, u.username, u.templateId]
        );
      }
      const { rows } = await pool.query("SELECT * FROM app_users WHERE id=$1", [id]);
      res.status(201).json(rowToUser(rows[0]));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.put("/api/identity/users/:id/password", async (req, res) => {
    const isSelf = req.session && String(req.session.userId) === String(req.params.id);
    if (!isSelf && !await isAdminCaller(req)) {
      return res.status(403).json({ ok: false, error: "admin required or must be self" });
    }
    
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok: false, error: "password required" });

    try {
      const { hash, salt } = hashPassword(password);
      await pool.query(
        "UPDATE app_users SET password_hash=$1, password_salt=$2, status='active', password_changed_at=now() WHERE id=$3",
        [hash, salt, req.params.id]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/identity/users/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const id = req.params.id;
    const u = req.body ?? {};
    try {
      const before = (await pool.query("SELECT * FROM app_users WHERE id=$1", [id])).rows[0];
      if (!before) return res.status(404).json({ error: "User not found" });

      const fields = {
        username: u.username !== undefined ? u.username : before.username,
        display_name: u.name !== undefined ? u.name : before.display_name,
        email: u.email !== undefined ? u.email : before.email,
        phone: u.phone !== undefined ? u.phone : before.phone,
        provider: u.provider !== undefined ? u.provider : before.provider,
        role: u.role !== undefined ? u.role : before.role,
        groups: u.groups !== undefined ? JSON.stringify(u.groups) : JSON.stringify(before.groups || []),
        template_id: u.templateId !== undefined ? u.templateId : before.template_id,
        status: u.status !== undefined ? u.status : before.status,
        valid_until: u.validUntil !== undefined ? (u.validUntil === "" ? null : u.validUntil) : before.valid_until,
        must_change_password: u.mustChangePassword !== undefined ? !!u.mustChangePassword : before.must_change_password,
        locked: u.locked !== undefined ? !!u.locked : before.locked,
        avatar_style: u.avatarStyle !== undefined ? u.avatarStyle : before.avatar_style,
        avatar_jewel: u.avatarJewel !== undefined ? u.avatarJewel : before.avatar_jewel,
        avatar_seed: u.avatarSeed !== undefined ? u.avatarSeed : before.avatar_seed,
        allowed_providers: u.allowedProviders !== undefined ? JSON.stringify(u.allowedProviders) : JSON.stringify(before.allowed_providers || []),
        can_override_provider: u.canOverrideProvider !== undefined ? !!u.canOverrideProvider : before.can_override_provider,
        allowed_agents: u.allowedAgents !== undefined ? JSON.stringify(u.allowedAgents) : JSON.stringify(before.allowed_agents || []),
        allowed_tools: u.allowedTools !== undefined ? JSON.stringify(u.allowedTools) : JSON.stringify(before.allowed_tools || []),
        allowed_skills: u.allowedSkills !== undefined ? JSON.stringify(u.allowedSkills) : JSON.stringify(before.allowed_skills || []),
      };

      await pool.query(
        `UPDATE app_users SET username=$2,display_name=$3,email=$4,phone=$5,provider=$6,role=$7,
         groups=$8::jsonb,template_id=$9,status=$10,valid_until=$11,must_change_password=$12,
         avatar_style=$13,avatar_jewel=$14,avatar_seed=$15,
         allowed_providers=$16::jsonb,can_override_provider=$17,
         allowed_agents=$18::jsonb,allowed_tools=$19::jsonb,allowed_skills=$20::jsonb,
         locked=$21
         WHERE id=$1`,
        [id, fields.username, fields.display_name, fields.email, fields.phone, fields.provider, fields.role,
         fields.groups, fields.template_id, fields.status, fields.valid_until,
         fields.must_change_password, fields.avatar_style, fields.avatar_jewel, fields.avatar_seed, fields.allowed_providers, fields.can_override_provider,
         fields.allowed_agents, fields.allowed_tools, fields.allowed_skills, fields.locked]
      );
      if (fields.template_id) {
        await pool.query(
          `INSERT INTO app_template_assignments(id,username,template_id)
           VALUES ($1,$2,$3) ON CONFLICT (username, template_id) DO NOTHING`,
          [`assign-${id}`, fields.username, fields.template_id]
        );
      }
      const { rows } = await pool.query("SELECT * FROM app_users WHERE id=$1", [id]);
      res.json(rowToUser(rows[0]));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.delete("/api/identity/users/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    try { await pool.query("DELETE FROM app_users WHERE id=$1", [req.params.id]); res.status(204).end(); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });


  // ---------- RBAC rules ----------
  app.get("/api/identity/rbac", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT id,match,provider,role FROM app_rbac_rules ORDER BY created_at");
      res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
  app.put("/api/identity/rbac", async (req, res) => {
    const rules = Array.isArray(req.body) ? req.body : [];
    try {
      await pool.query("BEGIN");
      await pool.query("DELETE FROM app_rbac_rules");
      for (const r of rules) {
        await pool.query(
          `INSERT INTO app_rbac_rules(id,match,provider,role) VALUES ($1,$2,$3,$4)`,
          [r.id ?? createLocalId(), r.match ?? "*", r.provider ?? "local", r.role ?? "Viewer"]
        );
      }
      await pool.query("COMMIT");
      res.json({ ok: true, count: rules.length });
    } catch (e) { await pool.query("ROLLBACK").catch(()=>{}); res.status(500).json({ error: String(e.message || e) }); }
  });

  // ---------- Federated auth provider config (DB-sealed) ----------
  async function readProviderConfigs() {
    const r = await pool.query("SELECT key, provider_id as id, label, enabled, priority, fields as config FROM auth_provider_sources ORDER BY priority ASC, created_at ASC");
    const out = [];
    for (const row of r.rows) {
      const cfg = row.config || {};
      const secretKeys = SECRET_FIELDS[row.id] || [];
      for (const f of secretKeys) {
        try {
          const s = await pool.query("SELECT * FROM vault_secrets WHERE scope='auth_provider' AND name=$1", [`${row.key}:${f}`]);
          if (s.rows[0]) cfg[f] = decryptSecret(s.rows[0].ciphertext, s.rows[0].iv, s.rows[0].tag);
        } catch { /* missing secret */ }
      }
      out.push({ key: row.key, id: row.id, label: row.label, enabled: row.enabled, priority: row.priority, config: cfg });
    }
    return out;
  }
  
  async function readProviderConfig(key) {
    const r = await pool.query("SELECT key, provider_id as id, label, enabled, priority, fields as config FROM auth_provider_sources WHERE key=$1", [key]);
    if (!r.rows[0]) return { id: key, enabled: false, priority: 100, config: {} };
    const row = r.rows[0];
    const cfg = row.config || {};
    const secretKeys = SECRET_FIELDS[row.id] || [];
    for (const f of secretKeys) {
      try {
        const s = await pool.query("SELECT * FROM vault_secrets WHERE scope='auth_provider' AND name=$1", [`${row.key}:${f}`]);
        if (s.rows[0]) cfg[f] = decryptSecret(s.rows[0].ciphertext, s.rows[0].iv, s.rows[0].tag);
      } catch { /* missing secret */ }
    }
    return { key: row.key, id: row.id, label: row.label, enabled: row.enabled, priority: row.priority, config: cfg };
  }

  async function writeProviderConfig(key, providerId, label, enabled, priority, cfgIn) {
    const cfg = { ...(cfgIn || {}) };
    for (const f of SECRET_FIELDS[providerId] || []) {
      if (typeof cfg[f] === "string" && cfg[f].length > 0) {
        const { ciphertext, iv, tag } = encryptSecret(cfg[f]);
        const sid = `auth_provider:${key}:${f}`;
        await pool.query(
          `INSERT INTO vault_secrets(id, scope, name, ciphertext, iv, tag) VALUES ($1,'auth_provider',$2,$3,$4,$5)
           ON CONFLICT (scope,name) DO UPDATE SET ciphertext=EXCLUDED.ciphertext, iv=EXCLUDED.iv, tag=EXCLUDED.tag`,
          [sid, `${key}:${f}`, ciphertext, iv, tag]
        );
      }
      delete cfg[f];
    }
    await pool.query(
      `INSERT INTO auth_provider_sources (key, provider_id, label, enabled, priority, fields)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, enabled=EXCLUDED.enabled, priority=EXCLUDED.priority, fields=EXCLUDED.fields`,
      [key, providerId, label, enabled, priority || 100, cfg]
    );
  }

  app.get("/api/identity/auth-providers", async (_req, res) => {
    try {
      const providers = await readProviderConfigs();
      res.json({ ok: true, providers });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
  app.put("/api/identity/auth-providers", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin role required" });
    const items = Array.isArray(req.body?.providers) ? req.body.providers : [];
    try {
      // Get all current keys to detect deletions
      const currentKeysReq = await pool.query("SELECT key FROM auth_provider_sources");
      const currentKeys = currentKeysReq.rows.map(r => r.key);
      const incomingKeys = items.map(p => p.key).filter(Boolean);
      
      const keysToDelete = currentKeys.filter(k => !incomingKeys.includes(k) && k !== 'local');
      if (keysToDelete.length > 0) {
        await pool.query("DELETE FROM auth_provider_sources WHERE key = ANY($1)", [keysToDelete]);
      }

      for (const p of items) {
        if (!p?.id || !p?.key || !SECRET_FIELDS[p.id]) {
          console.warn(`[Identity] Ignoring provider save:`, p);
          continue;
        }
        await writeProviderConfig(p.key, p.id, p.label, !!p.enabled, p.priority || 100, p.config || {});
      }
      res.json({ ok: true, count: items.length });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/identity/auth-providers/test", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin role required" });
    const { id, config } = req.body;
    try {
      if (id === "ldap") {
        const result = await deps.testLdapConnection(config);
        return res.json(result);
      }
      if (id === "radius") {
        const result = await deps.testRadiusConnection(config);
        return res.json(result);
      }
      // For OIDC / SAML, checking reachable endpoints
      return res.json({ ok: true, message: "URL is reachable (simulated via mock for now)." });
    } catch (e) {
      res.json({ ok: false, error: String(e.message || e) });
    }
  });

  // ---------- Login (sovereign, multi-provider) ----------
  app.post("/api/auth/login", rlLogin, async (req, res) => {
    const { username, password, provider = "local", device = "", ip: ipBody = "" } = req.body ?? {};
    if (!username || !password) return res.status(400).json({ ok: false, error: "username and password required" });
    const stripV6 = (s) => String(s || "").replace(/^::ffff:/, "").trim();
    const cf = stripV6(req.headers["cf-connecting-ip"]);
    const xreal = stripV6(req.headers["x-real-ip"]);
    const xfwdAll = String(req.headers["x-forwarded-for"] || "")
      .split(",").map(stripV6).filter(Boolean);
    const xfwdReal = xfwdAll.find(ip => ip && ip !== "::1" && !/^127\./.test(ip)) || xfwdAll[0] || "";
    const sock = stripV6(req.ip || req.socket?.remoteAddress);
    let realIp = cf || xreal || xfwdReal || sock || stripV6(ipBody) || "";
    if (!realIp || realIp === "::1") realIp = "127.0.0.1";

    try {
      let u = null;
      let lastError = "invalid credentials";

      // If "auto" or standard form login, walk the priority chain:
      const providersToTry = [];
      if (provider === "auto" || provider === "local") {
         const allProviders = await readProviderConfigs();
         const enabled = allProviders.filter(p => p.enabled).sort((a,b) => a.priority - b.priority);
         providersToTry.push(...enabled);
      } else {
         providersToTry.push(await readProviderConfig(provider));
      }

      for (const cfgRow of providersToTry) {
        if (!cfgRow || !cfgRow.enabled) continue;

        if (cfgRow.id === "local") {
          const { rows } = await pool.query(
            "SELECT * FROM app_users WHERE lower(username)=lower($1) AND lower(provider)='local' LIMIT 1",
            [username]
          );
          if (rows[0]) {
            u = rows[0];
            if (u.status !== "active") { lastError = `account ${u.status}`; u = null; continue; }
            if (u.valid_until && new Date(u.valid_until) < new Date()) { lastError = "account expired"; u = null; continue; }
            if (!verifyPassword(password, u.password_hash, u.password_salt)) {
              // Standard enterprise firewall approach: If user EXISTS locally but wrong pass, FAIL IMMEDIATELY.
              // Don't fall through to LDAP using a local user's wrong password.
              return res.status(401).json({ ok: false, error: "invalid credentials" });
            }
            // Valid local user!
            break;
          }
        } 
        else if (cfgRow.id === "ldap" || cfgRow.id === "radius") {
          const result = cfgRow.id === "ldap"
            ? await authenticateLdap(cfgRow.config, username, password)
            : await authenticateRadius(cfgRow.config, username, password);
          
          if (result.ok) {
            u = await ensureFederatedUser({
              provider: cfgRow.key,
              username: result.username || username,
              email: result.email || "",
              role: result.role || cfgRow.config.defaultRole || "Viewer",
              groups: result.groups || [],
            });
            break;
          } else {
            lastError = result.error || "authentication failed";
            // Not found or bind failed -> fall through to the next provider
          }
        }
      }

      if (!u) {
        return res.status(401).json({ ok: false, error: lastError });
      }

      // Login success
      if (u.provider === 'local') {
        await pool.query("UPDATE app_users SET last_login_at=now() WHERE id=$1", [u.id]);
      }
      await pool.query(
        `DELETE FROM app_sessions
           WHERE lower(username) = lower($1) AND ip = $2 AND device = $3`,
        [u.username, String(realIp).slice(0,64), String(device).slice(0,128)]
      ).catch(()=>{});
      const sid = createPrefixedId("s_");
      await pool.query(
        `INSERT INTO app_sessions(id,user_id,username,role,provider,ip,device) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sid, u.id, u.username, u.role, u.provider, String(realIp).slice(0,64), String(device).slice(0,128)]
      );
      enqueueWrite(
        `INSERT INTO agent_logs(agent,level,message,meta) VALUES ('auth','info',$1,$2)`,
        [`login:${u.username}`, { provider: u.provider, actor: u.username, ip: realIp, stream: 'auth' }]
      );
      if (broadcastAudit) {
        broadcastAudit({
          agent: 'auth',
          level: 'info',
          message: `login:${u.username}`,
          meta: { provider: u.provider, actor: u.username, ip: realIp, stream: 'auth', tag: 'session.open' }
        });
      }
      res.json({ ok: true, user: rowToUser(u), sessionId: sid });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  // ---------- Sessions ----------
  app.get("/api/sessions", async (req, res) => {
    try {
      await pool.query("DELETE FROM app_sessions WHERE last_seen < now() - interval '5 minutes'").catch(()=>{});
      const callerSid = String(req.headers["x-session-id"] || "").trim();
      if (callerSid) {
        await pool.query("UPDATE app_sessions SET last_seen=now() WHERE id=$1", [callerSid]).catch(()=>{});
      }
      const { rows } = await pool.query("SELECT * FROM app_sessions ORDER BY connected_at DESC");
      res.json(rows.map(r => ({
        id: r.id, username: r.username, role: r.role, provider: r.provider,
        ip: r.ip || "127.0.0.1", device: r.device,
        connectedAt: new Date(r.connected_at).toISOString(),
        lastSeen: new Date(r.last_seen).toISOString(),
      })));
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/sessions/:id/heartbeat", async (req, res) => {
    try { await pool.query("UPDATE app_sessions SET last_seen=now() WHERE id=$1", [req.params.id]); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.delete("/api/sessions/:id", async (req, res) => {
    try {
      const sessionRole = String(req.session?.role || "").toLowerCase();
      const callerSid   = String(req.session?.id || "").trim();
      let allowed = sessionRole === "admin";
      if (!allowed && callerSid && callerSid === req.params.id) allowed = true;
      if (!allowed) return res.status(403).json({ error: "admin role required" });
      await pool.query("DELETE FROM app_sessions WHERE id=$1", [req.params.id]);
      enqueueWrite(
        `INSERT INTO agent_logs(agent,level,message,meta) VALUES ('auth','warn',$1,$2)`,
        [`disconnect:${req.params.id}`, { by: req.session?.username || req.actor || "unknown", actor: req.session?.username || "system", stream: 'auth' }]
      );
      if (broadcastAudit) {
        broadcastAudit({
          agent: 'auth',
          level: 'warn',
          message: `disconnect:${req.params.id}`,
          meta: { by: req.session?.username || req.actor || "unknown", actor: req.session?.username || "system", stream: 'auth', tag: 'session.close' }
        });
      }
      res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  return { readProviderConfig, writeProviderConfig, ensureFederatedUser };
}
