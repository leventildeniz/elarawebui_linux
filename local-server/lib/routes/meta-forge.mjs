// local-server/lib/routes/meta-forge.mjs
// Elara self-authoring endpoints (plan-first, admin-only apply).
//
// Naming: "meta-forge" to avoid collision with existing forge.mjs
// (action library editor). Mounted at /api/meta-forge/*.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInventory, validateForgePlan } from "../meta-forge/planner.mjs";
import { applyForgePlan, rollbackForgePlan } from "../meta-forge/apply.mjs";
import { refreshCapabilitiesAfterForgeApply } from "../meta-forge/refresh.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const TRASH_DIR = path.join(PROJECT_ROOT, ".forge-trash");
const TOOLS_DIR = path.join(PROJECT_ROOT, "tools");
const AGENTS_DIR = path.join(PROJECT_ROOT, "agents");

const ENSURE_SQL = ``;

let _ensured = false;
async function ensureForgeTables(pool) {
  if (_ensured) return;
  await pool.query(ENSURE_SQL);
  _ensured = true;
}

export function mountMetaForgeRoutes(app, deps) {
  const { pool, resolveActorContext, hydrateAllowedAgentsFromDb } = deps;
  ensureForgeTables(pool).catch(e => console.error("[meta-forge] ensure failed:", e?.message || e));

  async function getCallerDeptContext(pool, username, userId, tenantId) {
    let userRow = null;
    if (userId) {
      const uRes = await pool.query("SELECT id, username, groups, tenant_id FROM app_users WHERE id = $1", [userId]);
      userRow = uRes.rows[0];
    }
    if (!userRow && username) {
      const uRes = await pool.query("SELECT id, username, groups, tenant_id FROM app_users WHERE lower(username) = lower($1)", [username]);
      userRow = uRes.rows[0];
    }
    const resolvedUserId = userRow?.id || userId || "";
    const groupIds = Array.isArray(userRow?.groups) ? userRow.groups : [];

    const { rows: groups } = await pool.query(
      `SELECT id, name, tenant_id, approvers, self_approval, approver_directory_groups 
       FROM app_groups 
       WHERE (tenant_id = $1 OR tenant_id = 'default' OR is_global = true)`,
      [tenantId || "default"]
    );

    const myGroupIds = [];
    const myGroupNames = [];
    const approverForGroupIds = [];
    const approverForGroupNames = [];
    const groupMap = new Map();

    for (const g of groups) {
      groupMap.set(g.id, g);
      groupMap.set(g.name.toLowerCase(), g);
      if (groupIds.includes(g.id)) {
        myGroupIds.push(g.id);
        myGroupNames.push(g.name);
      }
      const approvers = Array.isArray(g.approvers) ? g.approvers : [];
      const approverGroups = Array.isArray(g.approver_directory_groups) ? g.approver_directory_groups : [];

      const isDirectAppr = approvers.includes(resolvedUserId) || 
        (username && approvers.map(x => String(x).toLowerCase()).includes(username.toLowerCase()));

      const isGroupAppr = approverGroups.some(ag => 
        groupIds.includes(ag) || 
        myGroupNames.map(x => x.toLowerCase()).includes(String(ag).toLowerCase()) ||
        ag === resolvedUserId ||
        (username && String(ag).toLowerCase() === username.toLowerCase())
      );

      if (isDirectAppr || isGroupAppr) {
        approverForGroupIds.push(g.id);
        approverForGroupNames.push(g.name);
      }
    }

    return {
      userId: resolvedUserId,
      username: userRow?.username || username,
      myGroupIds,
      myGroupNames,
      approverForGroupIds,
      approverForGroupNames,
      groupMap
    };
  }

  async function assertPlanActionAccess(pool, ctx, plan, operatorUser, actionName = "manage") {
    if (ctx.isSuperAdmin) return true;
    if (ctx.isTenantAdmin) {
      if (plan.tenant_id && plan.tenant_id !== ctx.tenantId && !plan.is_global) {
        return { ok: false, status: 403, error: `Access denied: cannot ${actionName} plan outside your organization.` };
      }
      return true;
    }
    // Standard Operator
    if (plan.tenant_id && plan.tenant_id !== ctx.tenantId && !plan.is_global) {
      return { ok: false, status: 403, error: `Access denied: cannot ${actionName} plan outside your organization.` };
    }
    if (!plan.actor) return true;

    const isCreator = String(plan.actor).toLowerCase() === String(operatorUser).toLowerCase();
    const creatorDeptCtx = await getCallerDeptContext(pool, plan.actor, null, plan.tenant_id || "default");
    const callerDeptCtx = await getCallerDeptContext(pool, operatorUser, ctx?.userId, ctx?.tenantId || "default");

    if (isCreator) {
      // Layer 1: Scope & Risk Check (Private Desk Self-Approval)
      if (actionName === "apply" || actionName === "reapply") {
        const primaryGroup = creatorDeptCtx.myGroupIds[0] ? creatorDeptCtx.groupMap.get(creatorDeptCtx.myGroupIds[0]) : null;
        const allowSelf = primaryGroup ? primaryGroup.self_approval !== false : true;
        if (!allowSelf) {
          return {
            ok: false,
            status: 403,
            error: `Self-Approval Disabled: Group '${primaryGroup?.name || 'your group'}' requires an assigned group approver or administrator to ${actionName} MetaForge plans.`
          };
        }
      }
      return true;
    } else {
      // Layer 2: Department Isolation (Caller is managing another operator's proposal)
      const isApproverForCreator = creatorDeptCtx.myGroupIds.some(gid => callerDeptCtx.approverForGroupIds.includes(gid));
      const creatorGroup = creatorDeptCtx.myGroupIds[0] ? creatorDeptCtx.groupMap.get(creatorDeptCtx.myGroupIds[0]) : null;
      const noSpecificApprovers = !creatorGroup?.approvers || !creatorGroup.approvers.length;
      const isSameGroupPeer = noSpecificApprovers && creatorDeptCtx.myGroupIds.some(gid => callerDeptCtx.myGroupIds.includes(gid));

      if (!isApproverForCreator && !isSameGroupPeer) {
        return {
          ok: false,
          status: 403,
          error: "Department Isolation: Access denied. This MetaForge proposal belongs to another department's desk."
        };
      }
      return true;
    }
  }

  async function requireApprover(req, res) {
    try {
      const ctx = await resolveActorContext(req);
      const canApprove = ctx?.isSuperAdmin || ctx?.isTenantAdmin || ctx?.actions?.includes("approve") || ctx?.actions?.includes("*");
      if (!canApprove) {
        res.status(403).json({ ok: false, error: "Approval permission ('approve' action verb) required" });
        return null;
      }
      return ctx;
    } catch {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return null;
    }
  }

  async function requireAdmin(req, res) {
    try {
      const ctx = await resolveActorContext(req);
      if (!ctx?.isAdmin) {
        res.status(403).json({ ok: false, error: "admin only" });
        return null;
      }
      return ctx;
    } catch {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return null;
    }
  }

  // Read-only inventory — used by the Meta/forge_master agent to know what
  // already exists before proposing new artifacts.
  app.get("/api/meta-forge/inventory", async (req, res) => {
    try {
      const inv = await buildInventory(pool);
      res.json({ ok: true, inventory: inv });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // List forge plans (history + pending).
  app.get("/api/meta-forge/plans", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const status = req.query?.status ? String(req.query.status) : null;
      const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit, 10) || 50));
      const params = [];
      const whereParts = [];

      if (status) {
        params.push(status);
        whereParts.push(`status = $${params.length}`);
      }

      if (!ctx.isSuperAdmin) {
        if (ctx.isTenantAdmin) {
          params.push(ctx.tenantId || "default");
          whereParts.push(`(tenant_id = $${params.length} OR is_global = true OR tenant_id = 'default')`);
        } else {
          const callerUsername = req.session?.username || ctx.username || req.actor || "operator";
          const deptCtx = await getCallerDeptContext(pool, callerUsername, ctx.userId, ctx.tenantId || "default");

          // Standard Operator: view own plans + plans created by members of groups where caller is approver/peer
          const targetGroupIds = Array.from(new Set([...deptCtx.approverForGroupIds, ...deptCtx.myGroupIds]));
          let authorizedAuthors = [callerUsername];
          if (targetGroupIds.length > 0) {
            const { rows: authorRows } = await pool.query(
              `SELECT username FROM app_users WHERE groups ?| $1::text[]`,
              [targetGroupIds]
            );
            authorizedAuthors.push(...authorRows.map(u => u.username));
          }
          authorizedAuthors = Array.from(new Set(authorizedAuthors.filter(Boolean)));

          params.push(ctx.tenantId || "default");
          const tenantSlot = `$${params.length}`;
          params.push(authorizedAuthors);
          const authorSlot = `$${params.length}`;

          whereParts.push(`(tenant_id = ${tenantSlot} OR is_global = true OR tenant_id = 'default') AND (lower(actor) = ANY(ARRAY(SELECT lower(x) FROM unnest(${authorSlot}::text[]) x)) OR actor = 'chat' OR actor IS NULL)`);
        }
      }

      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT id, actor AS requested_by, prompt AS intent, status, rolled_back_at, note AS error, created_at, created_at AS updated_at,
                jsonb_build_object('create', actions) AS plan_json, tenant_id
           FROM forge_plans ${where}
          ORDER BY created_at DESC
          LIMIT ${limit}`,
        params,
      );
      res.json({ ok: true, plans: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/meta-forge/plans/:id", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const { rows } = await pool.query(
        `SELECT p.id, p.actor AS requested_by, p.prompt AS intent, p.status, p.rolled_back_at, p.note AS error, p.created_at, p.created_at AS updated_at,
                p.tenant_id,
                jsonb_build_object('create', p.actions) AS plan_json,
                COALESCE(json_agg(json_build_object(
                  'kind', a.kind, 'slug', a.slug,
                  'disk_path', a.disk_path, 'db_row_id', a.db_row_id,
                  'created_at', a.created_at))
                FILTER (WHERE a.kind IS NOT NULL), '[]'::json) AS artifacts
           FROM forge_plans p
           LEFT JOIN forge_artifacts a ON a.plan_id=p.id
          WHERE p.id=$1
          GROUP BY p.id`,
        [req.params.id],
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: "plan not found" });
      const plan = rows[0];
      if (!ctx.isSuperAdmin && !ctx.isTenantAdmin) {
        if (plan.tenant_id && plan.tenant_id !== ctx.tenantId && plan.tenant_id !== "default") {
          return res.status(403).json({ ok: false, error: "access denied" });
        }
      }
      res.json({ ok: true, plan });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  // Submit a plan (from the forge_master agent OR manual test from UI).
  // Body: { intent, plan: { reuse, create } }
  app.post("/api/meta-forge/plans", async (req, res) => {
    try {
      const body = req.body || {};
      const intent = String(body.intent || "").slice(0, 2000);
      if (!intent.trim()) return res.status(400).json({ ok: false, error: "intent required" });
      const plan = validateForgePlan(body.plan);
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default", actor: "admin" };
      const requestedBy = body.requested_by || ctx?.username || ctx?.actor || req.session?.username || "system";
      const tenantId = body.tenant_id || (ctx.isSuperAdmin ? (body.tenant_id || "default") : ctx.tenantId);
      const { rows } = await pool.query(
        `INSERT INTO forge_plans (id, actor, prompt, actions, status, tenant_id)
         VALUES ($1, $2, $3, $4::jsonb, 'pending', $5)
         RETURNING id, created_at`,
        [`mf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`, requestedBy, intent, JSON.stringify(plan.create || []), tenantId],
      );
      res.json({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Approve + apply MetaForge plan. Requires 'approve' role action verb or admin.
  app.post("/api/meta-forge/plans/:id/apply", async (req, res) => {
    const ctx = await requireApprover(req, res); if (!ctx) return;
    const { rows } = await pool.query(
      `SELECT id, jsonb_build_object('create', actions) AS plan_json, status, actor, tenant_id, is_global FROM forge_plans WHERE id=$1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "plan not found" });
    const p = rows[0];

    const operatorUser = ctx?.username || ctx?.user?.name || req.session?.username || req.actor || "system";
    const authCheck = await assertPlanActionAccess(pool, ctx, p, operatorUser, "apply");
    if (authCheck !== true) {
      return res.status(authCheck.status).json({ ok: false, error: authCheck.error });
    }

    if (p.status === "applied") {
      return res.json({ ok: true, status: "applied", message: "plan already applied" });
    }
    if (p.status !== "pending" && p.status !== "approved" && p.status !== "failed" && p.status !== "rolled_back") {
      return res.status(409).json({ ok: false, error: `plan status is ${p.status}` });
    }
    try {
      const result = await applyForgePlan({ pool, planId: p.id, plan: p.plan_json, forgedBy: operatorUser });
      const finalStatus = result.failed.length && !result.applied.length ? "failed" : "applied";
      await pool.query(
        `UPDATE forge_plans SET status=$2, note=null WHERE id=$1`,
        [p.id, finalStatus],
      );
      let refresh = null;
      if (finalStatus === "applied") {
        try { refresh = await refreshCapabilitiesAfterForgeApply({ pool, plan: p.plan_json }); } catch {}
      }
      res.json({ ok: true, status: finalStatus, refresh, ...result });
    } catch (e) {
      await pool.query(
        `UPDATE forge_plans SET status='failed', note=$2 WHERE id=$1`,
        [p.id, String(e?.message || e)],
      );
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/meta-forge/plans/:id/reject", async (req, res) => {
    const ctx = await requireApprover(req, res); if (!ctx) return;
    const { rows } = await pool.query(
      `SELECT id, actor, tenant_id, is_global FROM forge_plans WHERE id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "plan not found" });
    const p = rows[0];
    const operatorUser = ctx?.username || ctx?.user?.name || req.session?.username || req.actor || "system";
    const authCheck = await assertPlanActionAccess(pool, ctx, p, operatorUser, "reject");
    if (authCheck !== true) {
      return res.status(authCheck.status).json({ ok: false, error: authCheck.error });
    }

    const reason = String(req.body?.reason || "").slice(0, 500);
    await pool.query(
      `UPDATE forge_plans SET status='rejected', note=$2 WHERE id=$1`,
      [p.id, reason || null],
    );
    res.json({ ok: true });
  });

  app.post("/api/meta-forge/plans/:id/rollback", async (req, res) => {
    const ctx = await requireApprover(req, res); if (!ctx) return;
    const { rows } = await pool.query(
      `SELECT id, actor, tenant_id, is_global FROM forge_plans WHERE id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "plan not found" });
    const p = rows[0];

    const operatorUser = ctx?.username || ctx?.user?.name || req.session?.username || req.actor || "system";
    const authCheck = await assertPlanActionAccess(pool, ctx, p, operatorUser, "rollback");
    if (authCheck !== true) {
      return res.status(authCheck.status).json({ ok: false, error: authCheck.error });
    }

    try {
      const result = await rollbackForgePlan({ pool, planId: req.params.id });
      await pool.query(
        `UPDATE forge_plans SET status='rolled_back', rolled_back_at=now(), note=COALESCE(note,'') || ' [rolled back]' WHERE id=$1`,
        [req.params.id],
      );
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/meta-forge/plans/:id/reapply", async (req, res) => {
    const ctx = await requireApprover(req, res); if (!ctx) return;
    const { rows } = await pool.query(
      `SELECT id, jsonb_build_object('create', actions) AS plan_json, status, actor, tenant_id, is_global FROM forge_plans WHERE id=$1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "plan not found" });
    const p = rows[0];

    const operatorUser = ctx?.username || ctx?.user?.name || req.session?.username || req.actor || "system";
    const authCheck = await assertPlanActionAccess(pool, ctx, p, operatorUser, "reapply");
    if (authCheck !== true) {
      return res.status(authCheck.status).json({ ok: false, error: authCheck.error });
    }

    try {
      const result = await applyForgePlan({ pool, planId: p.id, plan: p.plan_json, forgedBy: operatorUser });
      const finalStatus = result.failed.length && !result.applied.length ? "failed" : "applied";
      await pool.query(
        `UPDATE forge_plans SET status=$2, rolled_back_at=null, note=null WHERE id=$1`,
        [p.id, finalStatus],
      );
      let refresh = null;
      if (finalStatus === "applied") {
        try { refresh = await refreshCapabilitiesAfterForgeApply({ pool, plan: p.plan_json }); } catch {}
      }
      res.json({ ok: true, status: finalStatus, refresh, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Auto-Creator: Undo alias (approver allowed for their own plan or admin)
  app.post("/api/meta-forge/plans/:id/undo", async (req, res) => {
    const ctx = await requireApprover(req, res); if (!ctx) return;
    const { rows } = await pool.query(
      `SELECT id, actor, tenant_id, is_global FROM forge_plans WHERE id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "plan not found" });
    const p = rows[0];

    const operatorUser = ctx?.username || ctx?.user?.name || req.session?.username || req.actor || "system";
    const authCheck = await assertPlanActionAccess(pool, ctx, p, operatorUser, "undo");
    if (authCheck !== true) {
      return res.status(authCheck.status).json({ ok: false, error: authCheck.error });
    }

    try {
      const result = await rollbackForgePlan({ pool, planId: req.params.id });
      await pool.query(
        `UPDATE forge_plans SET status='rolled_back', note=COALESCE(note,'') || ' [undone]' WHERE id=$1`,
        [req.params.id],
      );
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.delete("/api/meta-forge/plans", async (req, res) => {
    const ctx = await requireApprover(req, res); if (!ctx) return;
    const mode = String(req.query?.mode || "logs_only");
    const callerUsername = req.session?.username || ctx?.username || req.actor || "operator";
    const tenantId = ctx?.tenantId || req.session?.tenant_id || "default";

    try {
      // Tier 3: Standard Operator (own desk only, clean sweep strictly forbidden)
      if (!ctx.isSuperAdmin && !ctx.isTenantAdmin) {
        if (mode === "clean_sweep") {
          return res.status(403).json({
            ok: false,
            error: "Clean sweep factory reset is restricted to administrators. You may only clear your own ledger history."
          });
        }
        await pool.query(
          "DELETE FROM forge_plans WHERE (actor = $1 OR lower(actor) = lower($1)) AND (tenant_id = $2 OR tenant_id IS NULL)",
          [callerUsername, tenantId]
        );
        return res.json({ ok: true, mode: "logs_only", scope: "own_desk" });
      }

      // Tier 2: Tenant Admin (scoped to their own organization only)
      if (!ctx.isSuperAdmin && ctx.isTenantAdmin) {
        if (mode === "clean_sweep") {
          const { rows } = await pool.query(
            "SELECT id FROM forge_plans WHERE status IN ('applied', 'pending') AND tenant_id = $1 AND is_global = false",
            [tenantId]
          );
          for (const r of rows) {
            await rollbackForgePlan({ pool, planId: r.id }).catch(() => {});
          }
        }
        await pool.query("DELETE FROM forge_plans WHERE tenant_id = $1 AND is_global = false", [tenantId]);
        return res.json({ ok: true, mode, scope: "tenant", tenantId });
      }

      // Tier 1: SuperAdmin (cluster-wide factory reset or log purge)
      if (mode === "clean_sweep") {
        const { rows } = await pool.query("SELECT id FROM forge_plans WHERE status IN ('applied', 'pending')");
        for (const r of rows) {
          await rollbackForgePlan({ pool, planId: r.id }).catch(() => {});
        }
      }
      await pool.query("DELETE FROM forge_artifacts");
      await pool.query("DELETE FROM forge_plans");
      res.json({ ok: true, mode, scope: "cluster" });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---- TRASH & ARCHIVE HUB ------------------------------------------------
  // List archived/trashed artifacts
  app.get("/api/meta-forge/trash", async (req, res) => {
    try {
      if (!fs.existsSync(TRASH_DIR)) {
        return res.json({ ok: true, items: [] });
      }
      const files = fs.readdirSync(TRASH_DIR).filter((f) => f.endsWith(".py"));
      const items = [];
      for (const fileName of files) {
        try {
          const filePath = path.join(TRASH_DIR, fileName);
          const stats = fs.statSync(filePath);
          const m = fileName.match(/^(tool|agent)-(.*?)-(\d{4}-\d{2}-\d{2}T.*?)\.py$/);
          const kind = m ? m[1] : (fileName.startsWith("agent-") ? "agent" : "tool");
          let slug = m ? m[2] : fileName.replace(/\.py$/, "");
          slug = slug.replace(/^(tool_|agent_|tool\.|agent\.)+/i, "");

          let description = "";
          try {
            const content = fs.readFileSync(filePath, "utf8").slice(0, 1000);
            const descMatch = content.match(/#\s*@description:\s*(.*)$/m);
            if (descMatch) description = descMatch[1].trim();
          } catch {}

          items.push({
            fileName,
            kind,
            slug,
            trashedAt: stats.mtimeMs,
            sizeBytes: stats.size,
            description,
          });
        } catch {}
      }
      items.sort((a, b) => b.trashedAt - a.trashedAt);
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Restore a trashed artifact
  app.post("/api/meta-forge/trash/:fileName/restore", async (req, res) => {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    const fileName = req.params.fileName;
    const filePath = path.join(TRASH_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "file not found in trash" });
    }
    try {
      const m = fileName.match(/^(tool|agent)-(.*?)-(\d{4}-\d{2}-\d{2}T.*?)\.py$/);
      const kind = m ? m[1] : (fileName.startsWith("agent-") ? "agent" : "tool");
      let slug = m ? m[2] : fileName.replace(/\.py$/, "");
      slug = slug.replace(/^(tool_|agent_|tool\.|agent\.)+/i, "");

      const targetDir = kind === "agent" ? AGENTS_DIR : TOOLS_DIR;
      fs.mkdirSync(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, `${slug}.py`);

      fs.copyFileSync(filePath, targetPath);
      fs.unlinkSync(filePath);

      let refresh = null;
      try {
        refresh = await refreshCapabilitiesAfterForgeApply({ pool, plan: { create: [{ kind, slug }] } });
      } catch (e) {
        refresh = { error: String(e?.message || e) };
      }

      res.json({ ok: true, restored: slug, kind, targetPath, refresh });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Delete a specific trashed artifact
  app.delete("/api/meta-forge/trash/:fileName", async (req, res) => {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    const fileName = req.params.fileName;
    const filePath = path.join(TRASH_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "file not found in trash" });
    }
    try {
      fs.unlinkSync(filePath);
      res.json({ ok: true, deleted: fileName });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Empty trash entirely
  app.delete("/api/meta-forge/trash", async (req, res) => {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    try {
      if (fs.existsSync(TRASH_DIR)) {
        const files = fs.readdirSync(TRASH_DIR);
        for (const file of files) {
          try { fs.unlinkSync(path.join(TRASH_DIR, file)); } catch {}
        }
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // Approve / reject a pending_review capability (admin-only).
  // Body: { action: 'approve' | 'reject', reason?: string }
  app.post("/api/capabilities/:id/review", async (req, res) => {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    const action = String(req.body?.action || "").toLowerCase();
    const reason = String(req.body?.reason || "").slice(0, 500);
    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ ok: false, error: "action must be 'approve' or 'reject'" });
    }
    try {
      if (action === "approve") {
        const r = await pool.query(
          `UPDATE capabilities
              SET review_status='approved', live=true, updated_at=now()
            WHERE id=$1
            RETURNING id, slug, kind, live, review_status`,
          [req.params.id],
        );
        if (!r.rows.length) return res.status(404).json({ ok: false, error: "capability not found" });
        try { await hydrateAllowedAgentsFromDb?.(); } catch { /* */ }
        res.json({ ok: true, capability: r.rows[0] });
      } else {
        const r = await pool.query(
          `UPDATE capabilities
              SET review_status='rejected', live=false, updated_at=now(),
                  reasoning = COALESCE(reasoning,'') || CASE WHEN $2::text IS NULL OR $2::text = '' THEN '' ELSE E'\n[rejected] ' || $2::text END
            WHERE id=$1
            RETURNING id, slug, kind, live, review_status`,
          [req.params.id, reason || null],
        );
        if (!r.rows.length) return res.status(404).json({ ok: false, error: "capability not found" });
        res.json({ ok: true, capability: r.rows[0] });
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
