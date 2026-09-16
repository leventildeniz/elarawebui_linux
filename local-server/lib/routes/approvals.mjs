import { requireSession } from "../session-gate.mjs";
import { applySelfHealingRefactor } from "../self-healing.mjs";

// Resolve caller's department context: member groups, designated approver groups, and group attributes
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
    `SELECT id, name, tenant_id, approvers, self_approval 
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

export async function mountApprovalRoutes(app, deps) {
  const { pool, broadcastAudit, enqueueWrite } = deps;
  const admin = requireSession();

  const emitApprovalLog = (level, action, message, meta = {}) => {
    const fullMeta = { tag: "gate", stream: "governance", ...meta };
    if (broadcastAudit) {
      try {
        broadcastAudit({
          agent: "approvals",
          level,
          message: `approval.${action}: ${message}`,
          meta: fullMeta,
        });
      } catch (err) {
        console.warn("[approvals] broadcastAudit notice:", err.message);
      }
    }
    if (enqueueWrite) {
      try {
        enqueueWrite(
          `INSERT INTO agent_logs(agent, level, message, meta) VALUES ($1,$2,$3,$4)`,
          ["approvals", level, `approval.${action}:${message}`, fullMeta]
        );
      } catch (err) {
        console.warn("[approvals] enqueueWrite notice:", err.message);
      }
    }
  };

  // --- GET APPROVAL STATE ---
  app.get("/api/approvals", admin, async (req, res) => {
    try {
      const ctx = typeof deps.resolveActorContext === "function" ? await deps.resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const tenantId = req.session?.tenant_id || ctx.tenantId || "default";
      const callerUsername = req.session?.username || ctx.username || req.actor || "operator";

      let reqQuery;
      let queryParams = [];

      if (ctx.isSuperAdmin) {
        // SuperAdmin can view all tickets across all tenants
        reqQuery = `SELECT 
            id, title, requester, requester_group, agent_id as agent, 
            tool, target, policy, risk, args, origin, status, note, 
            assigned_to, ttl_ms, expires_at, decided_at, decided_by, created_at, tenant_id 
          FROM approval_requests 
          ORDER BY created_at DESC 
          LIMIT 200`;
      } else if (ctx.isTenantAdmin) {
        // TenantAdmin can view all tickets inside their tenant
        reqQuery = `SELECT 
            id, title, requester, requester_group, agent_id as agent, 
            tool, target, policy, risk, args, origin, status, note, 
            assigned_to, ttl_ms, expires_at, decided_at, decided_by, created_at, tenant_id 
          FROM approval_requests 
          WHERE (tenant_id = $1 OR is_global = true OR tenant_id = 'default')
          ORDER BY created_at DESC 
          LIMIT 200`;
        queryParams = [tenantId];
      } else {
        // Standard Operator: Department-based & Zero-Interference isolation
        const deptCtx = await getCallerDeptContext(pool, callerUsername, ctx.userId, tenantId);
        const relevantGroups = Array.from(new Set([
          ...deptCtx.myGroupNames,
          ...deptCtx.myGroupIds,
          ...deptCtx.approverForGroupNames,
          ...deptCtx.approverForGroupIds
        ]));

        reqQuery = `SELECT 
            id, title, requester, requester_group, agent_id as agent, 
            tool, target, policy, risk, args, origin, status, note, 
            assigned_to, ttl_ms, expires_at, decided_at, decided_by, created_at, tenant_id 
          FROM approval_requests 
          WHERE (tenant_id = $1 OR is_global = true OR tenant_id = 'default')
            AND (
              lower(requester) = lower($2)
              OR assigned_to @> jsonb_build_array($2::text)
              ${relevantGroups.length > 0 ? "OR requester_group = ANY($3::text[])" : ""}
            )
          ORDER BY created_at DESC 
          LIMIT 200`;
        queryParams = relevantGroups.length > 0
          ? [tenantId, callerUsername, relevantGroups]
          : [tenantId, callerUsername];
      }

      const [reqRes, configRes] = await Promise.all([
        pool.query(reqQuery, queryParams),
        pool.query("SELECT * FROM approval_config WHERE id='singleton'")
      ]);

      let config = configRes.rows[0];
      if (!config) {
        await pool.query("INSERT INTO approval_config (id) VALUES ('singleton') ON CONFLICT DO NOTHING");
        const r2 = await pool.query("SELECT * FROM approval_config WHERE id='singleton'");
        config = r2.rows[0] || {};
      }

      // Map 'denied' to 'rejected' for UI
      const requests = reqRes.rows.map(r => ({
        ...r,
        status: r.status === 'denied' ? 'rejected' : r.status
      }));

      res.json({
        ok: true,
        requests,
        config
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- DECIDE ---
  app.patch("/api/approvals/decide", admin, async (req, res) => {
    try {
      const { ids, status, note } = req.body;
      if (!ids || !ids.length) return res.status(400).json({ ok: false, error: "no ids" });

      const ctx = typeof deps.resolveActorContext === "function" ? await deps.resolveActorContext(req) : null;
      const callerUsername = req.session?.username || ctx?.username || req.actor || "operator";
      const callerTenant = ctx?.tenantId || req.session?.tenant_id || "default";

      // 1. Role Action Check: Caller must hold explicit 'approve' verb (or be SuperAdmin)
      const canApprove = ctx?.isSuperAdmin || ctx?.actions?.includes("approve") || ctx?.actions?.includes("*");
      if (!canApprove) {
        return res.status(403).json({ ok: false, error: "Approve action ('approve') is required to clear the approval queue." });
      }

      // 2. Fetch target tickets to enforce Multi-Tenant & Four-Eyes boundaries
      const { rows: targets } = await pool.query("SELECT * FROM approval_requests WHERE id = ANY($1)", [ids]);
      if (!targets.length) return res.status(404).json({ ok: false, error: "approval requests not found" });

      // Multi-tenant check
      if (!ctx?.isSuperAdmin) {
        for (const t of targets) {
          if (t.tenant_id && t.tenant_id !== callerTenant && !t.is_global) {
            return res.status(403).json({ ok: false, error: "Access denied: cannot decide approval request outside your organization." });
          }
        }
      }

      // 3. Multi-Tenant, Four-Eyes & Department Isolation Gate
      const dbStatus = status === 'rejected' ? 'denied' : status;
      if (dbStatus === "approved") {
        const deptCtx = await getCallerDeptContext(pool, callerUsername, ctx?.userId, callerTenant);

        for (const t of targets) {
          const isRequester = t.requester && String(t.requester).toLowerCase() === String(callerUsername).toLowerCase();

          // Layer 1: Scope & Risk Distinction
          if (isRequester) {
            // High / Critical risk demands mandatory Four-Eyes approval (even for admins)
            if (t.risk === "high" || t.risk === "critical") {
              return res.status(403).json({
                ok: false,
                error: `Four-Eyes Principle Violation: High and Critical risk operations require mandatory Four-Eyes approval. You cannot approve your own request (${t.id}). An independent reviewer must sign off.`
              });
            }

            // Low / Medium risk: Check requester's group self-approval policy
            if (!ctx?.isSuperAdmin) {
              const grp = t.requester_group ? (deptCtx.groupMap.get(t.requester_group.toLowerCase()) || deptCtx.groupMap.get(t.requester_group)) : null;
              const allowSelf = grp ? grp.self_approval !== false : false;
              if (!allowSelf) {
                return res.status(403).json({
                  ok: false,
                  error: `Self-Approval Disabled: Group '${t.requester_group || 'unassigned'}' requires an assigned group approver or administrator.`
                });
              }
            }
          } else if (!ctx?.isSuperAdmin && !ctx?.isTenantAdmin) {
            // Layer 2: Department-Based Isolation & Delegation Check (Non-requester operator)
            const assignedList = Array.isArray(t.assigned_to) ? t.assigned_to.map(x => String(x).toLowerCase()) : [];
            const isAssigned = assignedList.includes(callerUsername.toLowerCase());

            const grp = t.requester_group ? (deptCtx.groupMap.get(t.requester_group.toLowerCase()) || deptCtx.groupMap.get(t.requester_group)) : null;
            const approverList = Array.isArray(grp?.approvers) ? grp.approvers : [];
            const isGroupApprover = approverList.includes(deptCtx.userId) || 
              approverList.map(x => String(x).toLowerCase()).includes(callerUsername.toLowerCase());

            // If no specific approvers declared on the group, peer review inside the same group
            const noSpecificApprovers = assignedList.length === 0 && approverList.length === 0;
            const isSameGroupPeer = noSpecificApprovers && (
              deptCtx.myGroupNames.includes(t.requester_group) ||
              deptCtx.myGroupIds.includes(t.requester_group)
            );

            if (!isAssigned && !isGroupApprover && !isSameGroupPeer) {
              return res.status(403).json({
                ok: false,
                error: `Department Isolation: You are not a designated approver or peer reviewer for group '${t.requester_group || 'unassigned'}' (ticket ${t.id}).`
              });
            }
          }
        }
      }

      // 4. Update with verified session identity (prevents 'by' header spoofing)
      const { rows } = await pool.query(
        `UPDATE approval_requests 
         SET status=$1, note=$2, decided_by=$3, decided_at=now()
         WHERE id = ANY($4)
         RETURNING *`,
        [dbStatus, note || "", callerUsername, ids]
      );

      // Apply Self-Healing refactor on approved tickets
      if (dbStatus === "approved") {
        for (const row of rows) {
          if (row.origin === "self_healing") {
            try {
              await applySelfHealingRefactor(pool, row, callerUsername, { broadcastAudit, enqueueWrite });
            } catch (err) {
              console.error(`[approvals] failed to apply self-healing refactor for ${row.id}:`, err);
            }
          }
        }
      }

      const updated = rows.map(r => ({
        ...r,
        status: r.status === 'denied' ? 'rejected' : r.status
      }));

      emitApprovalLog("info", "decide", `${ids.join(", ")} marked ${status} by ${callerUsername}`, { ids, status, by: callerUsername });
      res.json({ ok: true, decided: updated });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // --- REQUEST APPROVAL ---
  app.post("/api/approvals/request", admin, async (req, res) => {
    try {
      const draft = req.body;
      const ctx = typeof deps.resolveActorContext === "function" ? await deps.resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const tenantId = draft.tenant_id || req.session?.tenant_id || ctx.tenantId || "default";
      const callerUsername = req.session?.username || ctx?.username || req.actor || "operator";
      const requester = draft.requester || callerUsername;

      // Server-side department routing fallback
      const deptCtx = await getCallerDeptContext(pool, requester, null, tenantId);
      const requesterGroup = draft.requesterGroup || (deptCtx.myGroupNames[0] || "");
      
      let assignedTo = draft.assignedTo;
      if (!Array.isArray(assignedTo) || assignedTo.length === 0) {
        const grp = requesterGroup ? (deptCtx.groupMap.get(requesterGroup.toLowerCase()) || deptCtx.groupMap.get(requesterGroup)) : null;
        if (grp && Array.isArray(grp.approvers) && grp.approvers.length > 0) {
          const { rows: appUsers } = await pool.query(
            "SELECT username FROM app_users WHERE id = ANY($1::text[])",
            [grp.approvers]
          );
          assignedTo = appUsers.map(u => u.username);
        } else {
          assignedTo = [];
        }
      }

      const ttlMs = parseInt(draft.ttl_ms, 10) || 7200000;
      const expiresAt = new Date(Date.now() + ttlMs);

      const { rows } = await pool.query(
        `INSERT INTO approval_requests 
          (id, title, requester, requester_group, agent_id, tool, target, policy, risk, args, origin, status, ttl_ms, expires_at, assigned_to, tenant_id)
         VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12, $13, $14, $15)
         RETURNING *`,
        [
          draft.id, draft.title, requester, requesterGroup, draft.agent, 
          draft.tool, draft.target, draft.policy, draft.risk, draft.args || '{}', 
          draft.origin || 'seed', ttlMs, expiresAt, JSON.stringify(assignedTo || []),
          tenantId
        ]
      );
      
      const r = rows[0];
      r.status = r.status === 'denied' ? 'rejected' : r.status;
      
      emitApprovalLog("warn", "request", `${draft.title} (${draft.id}) requested by ${draft.requester}`, { id: draft.id, requester: draft.requester, tool: draft.tool });
      res.json({ ok: true, request: r });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // --- CONFIG ---
  app.patch("/api/approvals/config", admin, async (req, res) => {
    try {
      const ctx = typeof deps.resolveActorContext === "function" ? await deps.resolveActorContext(req) : null;
      const isAllowed = ctx?.isSuperAdmin || ctx?.isTenantAdmin || (typeof deps.isAdminCaller === "function" && await deps.isAdminCaller(req));
      if (!isAllowed) {
        return res.status(403).json({ ok: false, error: "Administrative privileges required to modify approval queue configuration." });
      }

      const { queue_armed, allow_self_approve } = req.body;
      const cur = await pool.query("SELECT * FROM approval_config WHERE id='singleton'");
      const cfg = cur.rows[0] || {};
      
      const nextArmed = queue_armed !== undefined ? queue_armed : cfg.queue_armed;
      const nextSelf = allow_self_approve !== undefined ? allow_self_approve : cfg.allow_self_approve;

      const { rows } = await pool.query(
        `UPDATE approval_config 
         SET queue_armed=$1, allow_self_approve=$2, updated_at=now()
         WHERE id='singleton' RETURNING *`,
        [nextArmed, nextSelf]
      );
      emitApprovalLog("warn", "config", `queue armed=${nextArmed} self-approval=${nextSelf}`, { armed: nextArmed, selfApproval: nextSelf });
      res.json({ ok: true, config: rows[0] });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
}