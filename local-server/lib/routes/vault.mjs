// Vault routes — encrypted secrets CRUD + audit chain endpoints.
// All handlers authenticated via requireSession.
// DI: pool, enqueueWrite, requireSession, redactDeep, vault helpers, audit chain.

export function mountVaultRoutes(app, deps) {
  const {
    pool,
    enqueueWrite,
    requireSession,
    redactDeep,
    putSecretV2,
    getSecretAllFields,
    listSecretFieldNames,
    VAULT_KIND_FIELDS,
    verifyAuditChain,
    rebuildAuditChain,
    broadcastAudit,
    resolveActorContext,
  } = deps;

  // Faz 7 — vault audit helper. Every vault access (read/write/delete/list and
  // denied attempts) is appended to vault_audit and mirrored to live audit feed.
  function vaultAudit({ action, scope, name, req, ok = true, reason = null, meta = {} }) {
    try {
      const safeMeta = redactDeep(meta || {});
      const actor = req?.session?.username ?? req?.actor ?? "admin";
      enqueueWrite(
        `INSERT INTO vault_audit(action,scope,name,actor,session_id,ip,user_agent,ok,reason,meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          action,
          String(scope ?? ""),
          String(name ?? ""),
          actor,
          req?.session?.id ?? null,
          req?.ip ?? req?.headers?.["x-forwarded-for"] ?? null,
          req?.headers?.["user-agent"] ?? null,
          !!ok,
          reason ? String(reason).slice(0, 500) : null,
          safeMeta,
        ]
      );

      const lvl = ok ? (action === "delete" ? "warn" : "info") : "error";
      const fullMeta = { tag: "vault", stream: "secrets", scope, name, ok, reason, actor, ...safeMeta };
      
      enqueueWrite(
        `INSERT INTO agent_logs(agent, level, message, meta) VALUES ($1,$2,$3,$4)`,
        ["vault", lvl, `vault.${action}:${scope}/${name}`, fullMeta]
      );

      if (broadcastAudit) {
        broadcastAudit({
          agent: "vault",
          level: lvl,
          message: `vault.${action}: scope=${scope} name=${name}${ok ? "" : ` (failed: ${reason})`}`,
          meta: fullMeta,
        });
      }
    } catch (e) { console.warn("[vault_audit]", e.message); }
  }

  // Vault write/update endpoint — requires authenticated session.
  // Access events are recorded in vault_audit; secrets are never logged in plaintext.
  // Supports multi-field credentials (scope, name, kind, fields, meta).
  app.post("/api/vault", requireSession({ roles: ["admin", "engineer", "operator", "security"] }), async (req, res) => {
    const { scope, name } = req.body ?? {};
    let { kind, fields, meta, value } = req.body ?? {};
    if (!scope || !name) {
      vaultAudit({ action: "write", scope, name, req, ok: false, reason: "missing fields" });
      return res.status(400).json({ ok: false, error: "scope/name required" });
    }
    if (!fields && value != null) {
      kind = kind || "api_key";
      fields = { api_key: String(value) };
    }
    kind = kind || "api_key";
    fields = fields || {};
    meta = meta && typeof meta === "object" ? meta : {};
    if (!VAULT_KIND_FIELDS[kind]) {
      vaultAudit({ action: "write", scope, name, req, ok: false, reason: `unknown kind: ${kind}` });
      return res.status(400).json({ ok: false, error: `unknown kind: ${kind}` });
    }
    if (Object.keys(fields).length === 0) {
      vaultAudit({ action: "write", scope, name, req, ok: false, reason: "no fields" });
      return res.status(400).json({ ok: false, error: "at least one field required" });
    }
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      const tenant_id = ctx?.tenantId || req.session?.tenant_id || "default";
      const is_global = ctx?.isSuperAdmin ? (scope === "global" || scope === "system") : false;
      meta.owner_id = meta.owner_id || ctx?.userId || ctx?.actor || null;
      meta.visibility = meta.visibility || "private";
      const out = await putSecretV2(pool, { scope, name, kind, fields, meta, tenant_id, is_global });
      vaultAudit({
        action: "write", scope, name, req,
        meta: { kind, fields_changed: Object.keys(fields), meta_keys: Object.keys(meta) },
      });
      res.json({ ok: true, id: out.id, kind: out.kind, field_names: out.field_names });
    } catch (e) {
      vaultAudit({ action: "write", scope, name, req, ok: false, reason: e.message });
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/vault/:scope/:name", requireSession({ roles: ["admin", "engineer", "operator", "security"] }), async (req, res) => {
    try {
      const out = await getSecretAllFields(pool, req.params.scope, req.params.name);
      if (!out) {
        vaultAudit({ action: "read", scope: req.params.scope, name: req.params.name, req, ok: false, reason: "not found" });
        return res.status(404).end();
      }
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      if (ctx && !ctx.isSuperAdmin) {
        const ownerId = out.meta?.owner_id;
        const matches = [ctx.userId, ctx.username, ctx.actor].filter(Boolean).map(s => String(s).toLowerCase());
        const isOwner = ownerId && matches.includes(String(ownerId).toLowerCase());
        const isWorkspace = out.meta?.visibility === "workspace";
        const isSystem = (!ownerId && (out.is_global || out.scope === "system"));
        if (!isOwner && !isWorkspace && !isSystem && !ctx.isTenantAdmin) {
          return res.status(403).json({ ok: false, error: "Access denied" });
        }

        // Vault Reveal Permission Gate:
        // Only the author of the secret or callers holding the explicit 'vault' action verb can unmask plaintext fields!
        if (!isOwner && !ctx.canRevealVault) {
          vaultAudit({ action: "unmask_denied", scope: req.params.scope, name: req.params.name, req, ok: false, reason: "missing 'vault' action permission" });
          return res.status(403).json({
            ok: false,
            error: "Vault reveal action ('vault') is required to unmask shared or system credentials."
          });
        }
      }
      vaultAudit({ action: "read", scope: req.params.scope, name: req.params.name, req, meta: { kind: out.kind, field_count: Object.keys(out.fields).length } });
      res.json({
        scope: req.params.scope, name: req.params.name,
        kind: out.kind, meta: out.meta, fields: out.fields,
        value: out.fields.api_key ?? null,
      });
    } catch (e) {
      vaultAudit({ action: "read", scope: req.params.scope, name: req.params.name, req, ok: false, reason: e.message });
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/vault/:scope/:name/fields", requireSession({ roles: ["admin", "engineer", "operator", "security"] }), async (req, res) => {
    try {
      const out = await listSecretFieldNames(pool, req.params.scope, req.params.name);
      if (!out) return res.status(404).end();
      res.json({ scope: req.params.scope, name: req.params.name, ...out });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.get("/api/vault", requireSession({ roles: ["admin", "engineer", "operator", "security"] }), async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      const scope = req.query.scope ? String(req.query.scope) : null;
      const tenantId = ctx?.tenantId || req.session?.tenant_id || "default";
      const isSuperAdmin = ctx ? ctx.isSuperAdmin : (req.session?.role === "admin" && tenantId === "default");
      const isTenantAdmin = ctx ? ctx.isTenantAdmin : false;
      let query = `SELECT s.scope, s.name, s.kind, s.meta, s.created_at, s.updated_at, s.tenant_id, s.is_global,
                COALESCE(
                  (SELECT array_agg(f.field_name ORDER BY f.field_name)
                     FROM vault_secret_fields f WHERE f.secret_id = s.id),
                  ARRAY['api_key']::text[]
                ) AS field_names
           FROM vault_secrets s`;
      const params = [];
      const whereParts = [];
      if (scope) {
        params.push(scope);
        whereParts.push(`s.scope = $${params.length}`);
      }
      if (!isSuperAdmin) {
        if (isTenantAdmin) {
          params.push(tenantId);
          whereParts.push(`(s.tenant_id = $${params.length} OR s.is_global = true OR s.scope = 'global' OR s.scope = 'system')`);
        } else {
          const userMatches = [ctx?.userId, ctx?.username, ctx?.actor].filter(Boolean).map(s => String(s).toLowerCase());
          params.push(tenantId);
          const tSlot = `$${params.length}`;
          if (userMatches.length > 0) {
            const uSlots = userMatches.map(u => {
              params.push(u);
              return `$${params.length}`;
            });
            whereParts.push(`(
              (lower(COALESCE(s.meta->>'owner_id', '')) = ANY(ARRAY[${uSlots.join(",")}]::text[]))
              OR (s.meta->>'visibility' = 'workspace' AND s.tenant_id = ${tSlot})
              OR ((s.meta->>'owner_id' IS NULL OR s.meta->>'owner_id' = '') AND (s.is_global = true OR s.scope = 'system'))
            )`);
          } else {
            whereParts.push(`(
              (s.meta->>'visibility' = 'workspace' AND s.tenant_id = ${tSlot})
              OR ((s.meta->>'owner_id' IS NULL OR s.meta->>'owner_id' = '') AND (s.is_global = true OR s.scope = 'system'))
            )`);
          }
        }
      }
      if (whereParts.length) {
        query += " WHERE " + whereParts.join(" AND ");
      }
      query += " ORDER BY s.scope, s.name";

      const { rows } = await pool.query(query, params);
      vaultAudit({ action: "list", scope: scope ?? "*", name: "*", req, meta: { count: rows.length } });
      res.json({ items: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.delete("/api/vault/:scope/:name", requireSession({ roles: ["admin", "engineer", "operator", "security"] }), async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      const tenantId = ctx?.tenantId || req.session?.tenant_id || "default";
      const isSuperAdmin = ctx ? ctx.isSuperAdmin : (req.session?.role === "admin" && tenantId === "default");
      const isTenantAdmin = ctx ? ctx.isTenantAdmin : false;

      const curRes = await pool.query("SELECT * FROM vault_secrets WHERE scope=$1 AND name=$2", [req.params.scope, req.params.name]);
      if (!curRes.rows[0]) return res.status(404).end();
      const sRow = curRes.rows[0];

      if (!isSuperAdmin) {
        if (isTenantAdmin && (sRow.tenant_id === tenantId || sRow.tenant_id === "default")) {
          // allowed for tenant admin
        } else {
          const ownerId = sRow.meta?.owner_id;
          const matches = [ctx?.userId, ctx?.username, ctx?.actor].filter(Boolean).map(s => String(s).toLowerCase());
          if (!ownerId || !matches.includes(String(ownerId).toLowerCase())) {
            return res.status(403).json({ ok: false, error: "Read-only credential — only the author or administrator may delete this secret." });
          }
        }
      }

      const { rowCount } = await pool.query("DELETE FROM vault_secrets WHERE scope=$1 AND name=$2", [req.params.scope, req.params.name]);
      vaultAudit({ action: "delete", scope: req.params.scope, name: req.params.name, req, ok: rowCount > 0, reason: rowCount ? null : "not found" });
      if (!rowCount) return res.status(404).end();
      res.json({ ok: true });
    } catch (e) {
      vaultAudit({ action: "delete", scope: req.params.scope, name: req.params.name, req, ok: false, reason: e.message });
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/vault/bulk-delete", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length) return res.json({ ok: true, deleted: 0 });
      let deleted = 0;
      for (const it of items) {
        const scope = String(it?.scope || "").trim();
        const name = String(it?.name || "").trim();
        if (!scope || !name) continue;
        const { rowCount } = await pool.query("DELETE FROM vault_secrets WHERE scope=$1 AND name=$2", [scope, name]);
        if (rowCount) deleted++;
        vaultAudit({ action: "delete-bulk", scope, name, req, ok: rowCount > 0, reason: rowCount ? null : "not found" });
      }
      res.json({ ok: true, deleted, requested: items.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/vault-audit", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 1000);
      const scope = req.query.scope ? String(req.query.scope) : null;
      const { rows } = await pool.query(
        scope
          ? "SELECT * FROM vault_audit WHERE scope=$1 ORDER BY ts DESC LIMIT $2"
          : "SELECT * FROM vault_audit ORDER BY ts DESC LIMIT $1",
        scope ? [scope, limit] : [limit]
      );
      res.json({ items: rows });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  // Verifies the tamper-evident cryptographic hash chain of vault_audit logs.
  app.get("/api/vault-audit/verify", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 5000, 50000);
      const result = await verifyAuditChain(pool, { limit });
      res.json({ ok: result.ok, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Rebuilds and recomputes the audit hash chain from scratch.
  app.post("/api/vault-audit/rebuild", requireSession({ roles: ["admin"] }), async (_req, res) => {
    try {
      await rebuildAuditChain(pool);
      const result = await verifyAuditChain(pool, { limit: 50000 });
      res.json({ ok: result.ok, rebuilt: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  return { vaultAudit };
}
