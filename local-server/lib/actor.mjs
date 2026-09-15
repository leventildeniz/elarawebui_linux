// local-server/lib/actor.mjs
// Actor resolution, RBAC visibility filtering and loopback gate helpers.
// Pure utility functions (zero-dep): _isLoopbackReq, _hasLoopbackAdminToken,
//   _isAdminTokenKnowledgePath, _isLoopbackAgentRunPath, buildVisibility
// Pool-bound resolvers (DI): resolveDefaultActor, resolveActor, resolveActorContext
//
// Usage:
//   import { initActorRegistry, resolveActor, _isLoopbackReq, ... } from "./lib/actor.mjs";
//   initActorRegistry({ pool });  // Once after pool connection is established

let _pool = null;

export function initActorRegistry({ pool }) {
  if (!pool) throw new Error("[actor] initActorRegistry: database pool required");
  _pool = pool;
}

// ---- pool-bound resolvers --------------------------------------------------

export async function resolveDefaultActor() {
  if (!_pool) throw new Error("[actor] resolveDefaultActor: registry not initialized");
  const { rows } = await _pool.query(
    "SELECT username FROM app_users ORDER BY created_at ASC LIMIT 1"
  );
  return rows[0]?.username ? String(rows[0].username).toLowerCase() : null;
}

export async function resolveActor(req) {
  if (req?.session?.username) {
    return String(req.session.username).trim().toLowerCase();
  }
  if (req?.actor) {
    return String(req.actor).trim().toLowerCase();
  }
  if (_hasLoopbackAdminToken(req)) {
    return await resolveDefaultActor();
  }
  if (_isLoopbackReq(req)) {
    const loopbackActor = String(req?.headers?.["x-user"] || req?.headers?.["x-username"] || "").trim().toLowerCase();
    if (loopbackActor) return loopbackActor;
  }
  return null;
}

// Sovereign hierarchy: Super-Admin (role='admin' & tenant_id='default' OR first registered Mimar) sees EVERYTHING.
// TenantAdmin (role='admin' with tenant_id!='default') sees ALL items in their own tenant.
// Regular users see MINE + GROUP + WORKSPACE strictly within their own tenant (+ global system assets).
export async function resolveActorContext(req) {
  const actor = await resolveActor(req);
  const sessionTenantId = req?.session?.tenant_id || req?.headers?.["x-tenant-id"] || null;
  if (!actor) {
    return {
      actor: null,
      isAdmin: false,
      isSuperAdmin: false,
      isTenantAdmin: false,
      userId: null,
      tenantId: sessionTenantId || "default",
      groupIds: [],
      role: "viewer"
    };
  }
  try {
    const { rows } = await _pool.query(
      "SELECT id, role, tenant_id, groups, template_id FROM app_users WHERE lower(username)=lower($1) LIMIT 1",
      [actor]
    );
    const userRow = rows[0];
    const role = String(userRow?.role ?? "").toLowerCase();
    const userId = userRow?.id || null;
    const userTenantId = userRow?.tenant_id || sessionTenantId || "default";
    
    let groupIds = Array.isArray(userRow?.groups) ? [...userRow.groups] : [];
    let groupRoles = [];
    let templateIds = [userRow?.template_id].filter(Boolean);

    if (userId) {
      const gRes = await _pool.query(
        "SELECT id, role, template_id FROM app_groups WHERE (members ? $1 OR id = ANY($2::text[])) AND (tenant_id = $3 OR tenant_id = 'default' OR is_global = true)",
        [userId, groupIds.length > 0 ? groupIds : ['__none__'], userTenantId]
      );
      groupIds = Array.from(new Set([...groupIds, ...gRes.rows.map(g => g.id)]));
      groupRoles = gRes.rows.map(g => String(g.role || '').toLowerCase()).filter(Boolean);
      for (const g of gRes.rows) {
        if (g.template_id) templateIds.push(g.template_id);
      }
    }

    let templateRoles = [];
    let templateGrantsMcpServer = false;
    if (templateIds.length > 0) {
      const tRes = await _pool.query(
        "SELECT grants FROM app_templates WHERE id = ANY($1::text[])",
        [Array.from(new Set(templateIds))]
      );
      for (const tRow of tRes.rows) {
        const rArr = tRow?.grants?.roles;
        if (Array.isArray(rArr)) {
          templateRoles.push(...rArr.map(r => String(r).toLowerCase()));
        }
        const g = tRow?.grants;
        if (g?.mcpServer?.length > 0 || g?.mcp?.includes("server") || g?.mcp?.includes("gateway") || g?.mcp?.includes("*")) {
          templateGrantsMcpServer = true;
        }
      }
    }

    // Roles derive strictly from the account and assigned groups — templates govern AI inference, not RBAC roles
    const allRoles = [role, ...groupRoles].filter(Boolean).map(r => String(r).toLowerCase());
    let effectiveRole = role || "viewer";
    if (allRoles.includes("admin") || allRoles.includes("sovereign")) {
      effectiveRole = "admin";
    } else if (allRoles.includes("tenant-admin") || allRoles.includes("tenantadmin") || allRoles.includes("tenant admin")) {
      effectiveRole = "tenant-admin";
    } else if (allRoles.includes("engineer") || allRoles.includes("platform")) {
      effectiveRole = "engineer";
    } else if (allRoles.includes("operator")) {
      effectiveRole = "operator";
    } else if (allRoles.includes("security")) {
      effectiveRole = "security";
    }
    
    const defaultActor = await resolveDefaultActor();
    const isFirstMimar = !!defaultActor && actor === defaultActor;
    const isSuperAdmin = (effectiveRole === "admin" || effectiveRole === "sovereign" || isFirstMimar) && userTenantId === "default";
    const isTenantAdmin = isSuperAdmin || ((effectiveRole === "admin" || effectiveRole === "sovereign" || effectiveRole === "tenant-admin") && userTenantId !== "default") || effectiveRole === "tenant-admin";
    const canManageMcpServer = isSuperAdmin || templateGrantsMcpServer;
    
    return {
      actor,
      username: actor,
      isAdmin: isSuperAdmin,
      isSuperAdmin,
      isTenantAdmin,
      canManageMcpServer,
      userId,
      tenantId: userTenantId,
      groupIds,
      role: effectiveRole
    };
  } catch {}

  // Mimar fallback: the first-registered user is the system architect.
  const defaultActor = await resolveDefaultActor();
  const isSuperAdmin = !!defaultActor && actor === defaultActor;
  return {
    actor,
    username: actor,
    isAdmin: isSuperAdmin,
    isSuperAdmin,
    isTenantAdmin: false,
    userId: null,
    tenantId: sessionTenantId || "default",
    groupIds: [],
    role: isSuperAdmin ? "admin" : "viewer"
  };
}

// Link legacy ownerless rows with default actor (first registered operator).
// Idempotent: called once after database bootstrap.
export async function autoLinkLegacyOwnership({ migrateReady } = {}) {
  if (!_pool) throw new Error("[actor] autoLinkLegacyOwnership: registry not initialized");
  try {
    if (migrateReady) await migrateReady;
    const defaultActor = await resolveDefaultActor();
    if (!defaultActor) return;
    await _pool.query("UPDATE agents SET owner_id=$1 WHERE owner_id IS NULL", [defaultActor]);
    await _pool.query("UPDATE app_agents SET owner_user_id=$1 WHERE owner_user_id IS NULL", [defaultActor]);
    await _pool.query("UPDATE adapters SET owner_id=$1 WHERE owner_id IS NULL", [defaultActor]);
    await _pool.query("UPDATE runtimes SET owner_id=$1 WHERE owner_id IS NULL", [defaultActor]);
    await _pool.query("UPDATE guard_rules SET owner_id=$1 WHERE owner_id IS NULL", [defaultActor]);
    await _pool.query("UPDATE policy_rules SET owner_id=$1 WHERE owner_id IS NULL", [defaultActor]);
    await _pool.query("UPDATE isolation_profiles SET owner_id=$1 WHERE fallback = false AND owner_id IS NULL", [defaultActor]);
    const runtimeTable = await _pool.query("SELECT to_regclass('public.runtimes_config') AS table_name");
    if (runtimeTable.rows[0]?.table_name) {
      await _pool.query("UPDATE runtimes_config SET owner_user_id=$1 WHERE owner_user_id IS NULL", [defaultActor]);
    }
    console.log(`[tenant] active user sealed: ${defaultActor}; legacy ownerless agents linked`);
  } catch (e) { console.error("[tenant auto-link]", e.message); }
}



// ---- pure helpers ----------------------------------------------------------

/**
 * Check if the calling actor has mutation rights (edit / delete) on a specific entity row.
 * - SuperAdmin can mutate any row.
 * - TenantAdmin can mutate rows in their tenant.
 * - Regular users can ONLY mutate rows they own (row.owner_id === ctx.userId OR row.owner_id === ctx.actor).
 */
export function canActorEdit(ctx, row) {
  if (!ctx) return false;
  if (ctx.isSuperAdmin) return true;
  if (ctx.isTenantAdmin && (row?.tenant_id === ctx.tenantId || row?.tenant_id === "default")) return true;
  if (!row) return false;

  const ownerId = String(row.owner_id || row.owner_user_id || row.owner || row.created_by || "").trim().toLowerCase();
  if (!ownerId) {
    // Unowned system or legacy seed rows are read-only for regular users
    return false;
  }

  const matches = [ctx.userId, ctx.username, ctx.actor]
    .filter(Boolean)
    .map(s => String(s).trim().toLowerCase());

  return matches.includes(ownerId);
}

/**
 * Assert that the calling actor has mutation rights, throwing an HTTP 403 error if not.
 */
export function assertCanEdit(ctx, row, entityLabel = "object") {
  if (!canActorEdit(ctx, row)) {
    const error = new Error(`Read-only ${entityLabel} — only the author or administrator may modify or delete this item.`);
    error.status = 403;
    error.code = "forbidden_read_only";
    throw error;
  }
}

// Build a visibility WHERE clause + params. Super-Admin → 1=1 (unconstrained).
// Tenant / User → Zero-Trust Boundary: (is_global = true OR tenant_id = $tenantId) AND (mine/group/workspace).
export function buildVisibility(
  ctx,
  paramIndexStart = 1,
  ownerCol = "owner_id",
  tenantCol = "tenant_id",
  globalCol = "is_global"
) {
  if (ctx?.isSuperAdmin) return { clause: "1=1", params: [] };

  const tenantId = ctx?.tenantId || "default";
  const userMatches = [ctx?.userId, ctx?.username, ctx?.actor, ctx?.user?.name].filter(Boolean);

  let curParam = paramIndexStart;
  const params = [];

  // Parameter for tenant_id
  const tenantSlot = `$${curParam++}`;
  params.push(tenantId);

  // If TenantAdmin of this tenant, can see all assets in their tenant + all global assets
  if (ctx?.isTenantAdmin) {
    const clause = `(COALESCE(${globalCol}, false) = true OR ${tenantCol} = ${tenantSlot})`;
    return { clause, params };
  }

  // Regular user (mine / group / workspace within their tenant or global)
  let subClauses = [];

  if (userMatches.length > 0) {
    const userPlaceholders = userMatches.map(() => `$${curParam++}`).join(", ");
    params.push(...userMatches);
    subClauses.push(`${ownerCol} = ANY(ARRAY[${userPlaceholders}]::text[])`);
    subClauses.push(`lower(${ownerCol}) = ANY(ARRAY[${userPlaceholders}]::text[])`);
  }

  // Workspace visibility (all members of this tenant can view)
  subClauses.push(`visibility = 'workspace'`);

  // Group visibility (members of the group can view)
  if (ctx?.groupIds && ctx.groupIds.length > 0) {
    const groupPlaceholders = ctx.groupIds.map(() => `$${curParam++}`);
    params.push(...ctx.groupIds);
    const groupChecks = groupPlaceholders.map(p => `shared_with ? ${p}`).join(" OR ");
    subClauses.push(`(visibility = 'shared' AND (${groupChecks}))`);
  }

  // Unowned global seeds (e.g. system tools, default spaces)
  subClauses.push(`(${ownerCol} IS NULL AND (COALESCE(${globalCol}, false) = true OR ${tenantCol} = ${tenantSlot}))`);

  const innerScope = subClauses.join(" OR ");
  const clause = `((COALESCE(${globalCol}, false) = true OR ${tenantCol} = ${tenantSlot}) AND (${innerScope}))`;

  return { clause, params };
}

export function _isLoopbackReq(req) {
  const ip = String(req?.ip || req?.socket?.remoteAddress || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("127.");
}

export function _hasLoopbackAdminToken(req) {
  if (!_isLoopbackReq(req)) return false;
  const expected = String(process.env.ADMIN_API_TOKEN || "").trim();
  const sent = String(req?.headers?.["x-admin-token"] || "").trim();
  return !!expected && !!sent && sent === expected;
}

// External path set passed to maintain single authority from server.mjs
export function _isAdminTokenKnowledgePath(reqPath, adminTokenPaths) {
  if (adminTokenPaths && adminTokenPaths.has(reqPath)) return true;
  const parts = String(reqPath || "").split("/").filter(Boolean);
  return parts.length === 5
    && parts[0] === "api"
    && parts[1] === "knowledge"
    && parts[2] === "source"
    && parts[4] === "crawl-config";
}

export function _isLoopbackAgentRunPath(reqPath) {
  // /api/agents/:id/run or /api/agents/:id/stop — loopback dispatch
  // (diagnostic script, agent-to-agent bridge). Handler validates body and existence.
  const parts = String(reqPath || "").split("/").filter(Boolean);
  return parts.length === 4
    && parts[0] === "api"
    && parts[1] === "agents"
    && (parts[3] === "run" || parts[3] === "stop");
}
