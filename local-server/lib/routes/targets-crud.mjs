import { isUuid } from "../utils.mjs";

export function mountTargetsRoutes(app, deps) {
  const { pool, requireSession, resolveActorContext, assertCanEdit, buildVisibility } = deps;

  app.post("/api/targets/reset", requireSession({ roles: ["admin", "sovereign", "tenant-admin"] }), async (req, res) => {
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
    if (!ctx.isSuperAdmin && !ctx.isTenantAdmin) {
      return res.status(403).json({ ok: false, error: "Access denied. Only SuperAdmin or TenantAdmin can reset targets." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (ctx.isSuperAdmin) {
        await client.query("DELETE FROM target_endpoints");
        await client.query("DELETE FROM targets");
        await client.query("DELETE FROM target_groups");
      } else {
        await client.query("DELETE FROM targets WHERE tenant_id = $1", [ctx.tenantId || "default"]);
        await client.query("DELETE FROM target_groups WHERE tenant_id = $1", [ctx.tenantId || "default"]);
      }
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[targets] reset error", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally {
      client.release();
    }
  });

  app.get("/api/targets", requireSession(), async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const tenantId = req.session?.tenant_id || ctx.tenantId || "default";

      const groupQuery = ctx.isSuperAdmin
        ? "SELECT * FROM target_groups ORDER BY created_at ASC"
        : "SELECT * FROM target_groups WHERE (tenant_id = $1 OR is_global = true) ORDER BY created_at ASC";

      const vis = typeof buildVisibility === "function" ? buildVisibility(ctx, 1, 'owner') : { clause: "1=1", params: [] };
      const targetQuery = `SELECT t.*,
               COALESCE(
                 (SELECT json_agg(json_build_object(
                    'id', te.id,
                    'port', COALESCE(te.port::text, ''),
                    'adapter', COALESCE(te.adapter_id, ''),
                    'label', COALESCE(te.label, ''),
                    'vaultScope', COALESCE(te.vault_scope, ''),
                    'vaultName', COALESCE(te.vault_name, ''),
                    'primary', COALESCE(te.is_primary, false)
                  ))
                  FROM target_endpoints te
                  WHERE te.target_id = t.id
                 ),
                 '[]'::json
               ) AS endpoints_json
          FROM targets t
          WHERE ${vis.clause}
          ORDER BY t.created_at DESC`;

      const [gRes, tRes] = await Promise.all([
        pool.query(groupQuery, ctx.isSuperAdmin ? [] : [tenantId]),
        pool.query(targetQuery, vis.params)
      ]);

      const groups = gRes.rows;
      const targets = tRes.rows;
      
      const mappedGroups = groups.map(g => ({
        id: g.id,
        name: g.name,
        kind: g.kind,
        description: g.description,
        tags: g.tags || []
      }));

      const mappedTargets = targets.map(t => ({
        id: t.id,
        name: t.name,
        groupId: t.group_id || "",
        ip: t.ip || "",
        host: t.host || "",
        ports: String(t.port || ""),
        tags: t.tags || [],
        adapter: t.default_adapter_id || "",
        vaultScope: t.vault_scope || "none",
        vaultName: t.vault_name || "",
        risk: t.risk_level || "low",
        requiresApproval: !!t.requires_approval,
        owner: t.owner || "",
        ownerId: t.owner || "",
        ownerName: t.owner || "",
        visibility: t.visibility || "private",
        sharedWith: t.shared_with || [],
        notes: t.notes || "",
        enabled: true,
        createdAt: new Date(t.created_at).getTime(),
        lastCheck: t.last_probe_at ? {
          at: new Date(t.last_probe_at).getTime(),
          ok: t.last_probe_status === "ok",
          detail: String(t.last_probe_status || ""),
          ms: 0
        } : null,
        endpoints: t.endpoints_json || []
      }));

      res.json({ ok: true, state: { groups: mappedGroups, targets: mappedTargets } });
    } catch (e) {
      console.error("[targets] read error", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/targets/groups", requireSession({ roles: ["admin", "engineer"] }), async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const { id, name, kind, description, tags } = req.body;
      const gId = id || `grp-${Math.floor(1000 + Math.random() * 8999)}`;
      const tagsArr = Array.isArray(tags) ? tags : [];
      const tenantId = req.body?.tenant_id || req.session?.tenant_id || ctx.tenantId || "default";
      const isGlobal = ctx.isSuperAdmin ? (req.body?.is_global || false) : false;

      const out = await pool.query(
        `INSERT INTO target_groups (id, name, kind, description, tags, tenant_id, is_global)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [gId, name, kind || "server", description || "", tagsArr, tenantId, isGlobal]
      );
      res.json({ ok: true, group: out.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/targets/groups/:id", requireSession({ roles: ["admin", "engineer"] }), async (req, res) => {
    try {
      const { name, kind, description, tags } = req.body;
      const tagsArr = Array.isArray(tags) ? tags : [];
      const out = await pool.query(
        `UPDATE target_groups SET name=$2, kind=$3, description=$4, tags=$5
         WHERE id=$1 RETURNING *`,
        [req.params.id, name, kind, description, tagsArr]
      );
      if (!out.rowCount) return res.status(404).json({ ok: false, error: "not found" });
      res.json({ ok: true, group: out.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.delete("/api/targets/groups/:id", requireSession({ roles: ["admin", "engineer"] }), async (req, res) => {
    try {
      const out = await pool.query(`DELETE FROM target_groups WHERE id=$1`, [req.params.id]);
      if (!out.rowCount) return res.status(404).json({ ok: false, error: "not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/targets", requireSession({ roles: ["admin", "engineer"] }), async (req, res) => {
    const client = await pool.connect();
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const { id, name, groupId, ip, host, ports, tags, adapter, vaultScope, vaultName, risk, requiresApproval, owner, notes, enabled, endpoints } = req.body;
      const tId = id || `tgt-${Math.floor(1000 + Math.random() * 8999)}`;
      const pt = parseInt(ports, 10);
      const tagsArr = Array.isArray(tags) ? tags : [];
      const tenantId = req.body?.tenant_id || req.session?.tenant_id || ctx.tenantId || "default";
      const isGlobal = ctx.isSuperAdmin ? (req.body?.is_global || false) : false;
      const ownerId = req.body?.owner_id || req.body?.ownerId || req.body?.owner || ctx.userId || req.session?.username || req.actor || "";
      const visibility = req.body?.visibility || "private";
      const sharedWith = Array.isArray(req.body?.sharedWith || req.body?.shared_with) ? JSON.stringify(req.body?.sharedWith || req.body?.shared_with) : "[]";

      await client.query("BEGIN");
      
      const out = await client.query(
        `INSERT INTO targets (id, name, group_id, ip, host, port, tags, default_adapter_id, vault_scope, vault_name, risk_level, requires_approval, owner, notes, tenant_id, is_global, visibility, shared_with)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb) RETURNING *`,
        [tId, name, groupId || null, ip || "", host || "", Number.isFinite(pt) ? pt : null, tagsArr, adapter || null, vaultScope || "", vaultName || "", risk || "low", !!requiresApproval, ownerId, notes || "", tenantId, isGlobal, visibility, sharedWith]
      );
      
      if (Array.isArray(endpoints) && endpoints.length > 0) {
        for (const ep of endpoints) {
          const epPort = parseInt(ep.port, 10);
          await client.query(
            `INSERT INTO target_endpoints (id, target_id, adapter_id, port, label, vault_scope, vault_name, is_primary)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [ep.id || `ep-${Math.floor(1000 + Math.random() * 8999)}`, tId, ep.adapter || null, Number.isFinite(epPort) ? epPort : null, ep.label || "", ep.vaultScope || "", ep.vaultName || "", !!ep.primary]
          );
        }
      }
      
      await client.query("COMMIT");
      res.json({ ok: true, target: out.rows[0] });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[targets] create error", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally {
      client.release();
    }
  });

  app.put("/api/targets/:id", requireSession({ roles: ["admin", "engineer"] }), async (req, res) => {
    const client = await pool.connect();
    try {
      const { name, groupId, ip, host, ports, tags, adapter, vaultScope, vaultName, risk, requiresApproval, owner, notes, enabled, endpoints } = req.body;
      const pt = parseInt(ports, 10);

      const existing = await client.query("SELECT * FROM targets WHERE id=$1", [req.params.id]);
      if (!existing.rowCount) {
        client.release();
        return res.status(404).json({ ok: false, error: "not found" });
      }
      const row = existing.rows[0];
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      if (ctx && assertCanEdit) {
        assertCanEdit(ctx, row, "target");
      }

      const r_name = name !== undefined ? name : row.name;
      const r_group = groupId !== undefined ? (groupId || null) : row.group_id;
      const r_ip = ip !== undefined ? ip : row.ip;
      const r_host = host !== undefined ? host : row.host;
      const r_ports = ports !== undefined ? (Number.isFinite(pt) ? pt : null) : row.port;
      const r_tags = tags !== undefined ? (Array.isArray(tags) ? tags : []) : row.tags;
      const r_adapter = adapter !== undefined ? adapter : row.default_adapter_id;
      const r_vault_scope = vaultScope !== undefined ? vaultScope : row.vault_scope;
      const r_vault_name = vaultName !== undefined ? vaultName : row.vault_name;
      const r_risk = risk !== undefined ? risk : row.risk_level;
      const r_requires = requiresApproval !== undefined ? !!requiresApproval : row.requires_approval;
      const r_owner = owner !== undefined && owner !== "" ? owner : row.owner;
      const r_notes = notes !== undefined ? notes : row.notes;
      const r_visibility = req.body?.visibility !== undefined ? req.body.visibility : (row.visibility || 'private');
      const r_shared = req.body?.sharedWith !== undefined || req.body?.shared_with !== undefined
        ? JSON.stringify(req.body?.sharedWith || req.body?.shared_with || [])
        : JSON.stringify(row.shared_with || []);

      await client.query("BEGIN");
      
      const out = await client.query(
        `UPDATE targets SET name=$2, group_id=$3, ip=$4, host=$5, port=$6, tags=$7, default_adapter_id=$8, vault_scope=$9, vault_name=$10, risk_level=$11, requires_approval=$12, owner=$13, notes=$14, visibility=$15, shared_with=$16::jsonb, updated_at=now()
         WHERE id=$1 RETURNING *`,
        [req.params.id, r_name, r_group, r_ip, r_host, r_ports, r_tags, r_adapter, r_vault_scope, r_vault_name, r_risk, r_requires, r_owner, r_notes, r_visibility, r_shared]
      );
      
      if (endpoints !== undefined) {
        await client.query("DELETE FROM target_endpoints WHERE target_id=$1", [req.params.id]);
        if (Array.isArray(endpoints) && endpoints.length > 0) {
          for (const ep of endpoints) {
            const epPort = parseInt(ep.port, 10);
            await client.query(
              `INSERT INTO target_endpoints (id, target_id, adapter_id, port, label, vault_scope, vault_name, is_primary)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [ep.id || `ep-${Math.floor(1000 + Math.random() * 8999)}`, req.params.id, ep.adapter || null, Number.isFinite(epPort) ? epPort : null, ep.label || "", ep.vaultScope || "", ep.vaultName || "", !!ep.primary]
            );
          }
        }
      }
      
      await client.query("COMMIT");
      res.json({ ok: true, target: out.rows[0] });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[targets] update error", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally {
      client.release();
    }
  });

  app.delete("/api/targets/:id", requireSession({ roles: ["admin", "engineer"] }), async (req, res) => {
    try {
      const existing = await pool.query("SELECT * FROM targets WHERE id=$1", [req.params.id]);
      if (!existing.rowCount) return res.status(404).json({ ok: false, error: "not found" });
      const row = existing.rows[0];
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : null;
      if (ctx && assertCanEdit) {
        assertCanEdit(ctx, row, "target");
      }

      const out = await pool.query(`DELETE FROM targets WHERE id=$1`, [req.params.id]);
      if (!out.rowCount) return res.status(404).json({ ok: false, error: "not found" });
      res.json({ ok: true });
    } catch (e) {
      const status = e.status || 500;
      res.status(status).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/targets/batch", requireSession({ roles: ["admin", "engineer"] }), async (req, res) => {
    const items = Array.isArray(req.body?.targets) ? req.body.targets : [];
    if (!items.length) return res.status(400).json({ ok: false, error: "targets array required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const t of items) {
        const pt = parseInt(t.ports, 10);
        await client.query(
          `INSERT INTO targets (id, name, group_id, ip, host, port, tags, default_adapter_id, vault_scope, vault_name, risk_level, requires_approval, owner, notes, enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, group_id=EXCLUDED.group_id, ip=EXCLUDED.ip, host=EXCLUDED.host, port=EXCLUDED.port, tags=EXCLUDED.tags, default_adapter_id=EXCLUDED.default_adapter_id, vault_scope=EXCLUDED.vault_scope, vault_name=EXCLUDED.vault_name, risk_level=EXCLUDED.risk_level, requires_approval=EXCLUDED.requires_approval, owner=EXCLUDED.owner, notes=EXCLUDED.notes, enabled=EXCLUDED.enabled, updated_at=now()`,
          [t.id || `tgt-${Math.floor(1000 + Math.random() * 8999)}`, t.name, t.groupId || null, t.ip || "", t.host || "", Number.isFinite(pt) ? pt : null, t.tags || [], t.adapter || null, t.vaultScope || "", t.vaultName || "", t.risk || "low", !!t.requiresApproval, t.owner || "", t.notes || "", t.enabled !== false]
        );
      }
      await client.query("COMMIT");
      res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(()=>{});
      res.status(500).json({ ok: false, error: String(e.message || e) });
    } finally {
      client.release();
    }
  });
}
