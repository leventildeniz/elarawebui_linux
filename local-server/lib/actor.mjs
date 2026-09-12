// local-server/lib/actor.mjs
// Block D — actor resolution + RBAC visibility + loopback gate helpers.
// 2026-05-30 monolit-avı: server.mjs'ten ayrıldı.
//
// Saf util'ler (zero-dep): _isLoopbackReq, _hasLoopbackAdminToken,
//   _isAdminTokenKnowledgePath, _isLoopbackAgentRunPath, buildVisibility
// Pool-bağımlı (DI): resolveDefaultActor, resolveActor, resolveActorContext
//
// Kullanım:
//   import { initActorRegistry, resolveActor, _isLoopbackReq, ... } from "./lib/actor.mjs";
//   initActorRegistry({ pool });  // pool kurulduktan sonra, bir kez

let _pool = null;

export function initActorRegistry({ pool }) {
  if (!pool) throw new Error("[actor] initActorRegistry: pool gerekli");
  _pool = pool;
}

// ---- pool-bound resolvers --------------------------------------------------

export async function resolveDefaultActor() {
  if (!_pool) throw new Error("[actor] resolveDefaultActor: registry init edilmedi");
  const { rows } = await _pool.query(
    "SELECT username FROM app_users ORDER BY created_at ASC LIMIT 1"
  );
  return rows[0]?.username ? String(rows[0].username).toLowerCase() : null;
}

export async function resolveActor(req) {
  const actor = String(
    req?.session?.username ||
    req?.actor ||
    req?.headers?.["x-user"] ||
    req?.headers?.["x-username"] ||
    ""
  ).trim().toLowerCase();
  if (actor) return actor;
  if (_hasLoopbackAdminToken(req)) {
    return await resolveDefaultActor();
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
      "SELECT id, role, tenant_id FROM app_users WHERE lower(username)=lower($1) LIMIT 1",
      [actor]
    );
    const role = String(rows[0]?.role ?? "").toLowerCase();
    const userId = rows[0]?.id || null;
    const userTenantId = rows[0]?.tenant_id || sessionTenantId || "default";
    
    let groupIds = [];
    if (userId) {
      const gRes = await _pool.query(
        "SELECT id FROM app_groups WHERE members ? $1 AND (tenant_id = $2 OR tenant_id = 'default')",
        [userId, userTenantId]
      );
      groupIds = gRes.rows.map(g => g.id);
    }
    
    const defaultActor = await resolveDefaultActor();
    const isFirstMimar = !!defaultActor && actor === defaultActor;
    const isSuperAdmin = (role === "admin" || role === "sovereign" || isFirstMimar) && userTenantId === "default";
    const isTenantAdmin = (role === "admin" || role === "sovereign") && userTenantId !== "default";
    
    return {
      actor,
      isAdmin: isSuperAdmin,
      isSuperAdmin,
      isTenantAdmin,
      userId,
      tenantId: userTenantId,
      groupIds,
      role
    };
  } catch {}

  // Mimar fallback: the first-registered user is the system architect.
  const defaultActor = await resolveDefaultActor();
  const isSuperAdmin = !!defaultActor && actor === defaultActor;
  return {
    actor,
    isAdmin: isSuperAdmin,
    isSuperAdmin,
    isTenantAdmin: false,
    userId: null,
    tenantId: sessionTenantId || "default",
    groupIds: [],
    role: isSuperAdmin ? "admin" : "viewer"
  };
}

// 2026-05-30 R-2: Legacy ownerless satırların owner_user_id'sini default
// actor (ilk kayıtlı user = Mimar) ile geri yamala. Idempotent; boot'ta
// migrateReady çözüldükten sonra bir kez çağrılır. agents / app_agents /
// models tabloları kesin; runtimes_config opsiyonel (varsa yamalanır).
export async function autoLinkLegacyOwnership({ migrateReady } = {}) {
  if (!_pool) throw new Error("[actor] autoLinkLegacyOwnership: registry init edilmedi");
  try {
    if (migrateReady) await migrateReady;
    const defaultActor = await resolveDefaultActor();
    if (!defaultActor) return;
    await _pool.query("UPDATE agents SET owner_id=$1 WHERE owner_id IS NULL", [defaultActor]);
    await _pool.query("UPDATE app_agents SET owner_user_id=$1 WHERE owner_user_id IS NULL", [defaultActor]);
    const runtimeTable = await _pool.query("SELECT to_regclass('public.runtimes_config') AS table_name");
    if (runtimeTable.rows[0]?.table_name) {
      await _pool.query("UPDATE runtimes_config SET owner_user_id=$1 WHERE owner_user_id IS NULL", [defaultActor]);
    }
    console.log(`[tenant] active user sealed: ${defaultActor}; legacy ownerless agents linked`);
  } catch (e) { console.error("[tenant auto-link]", e.message); }
}



// ---- pure helpers ----------------------------------------------------------

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
    const clause = `(COALESCE(${globalCol}, false) = true OR ${tenantCol} = ${tenantSlot} OR ${tenantCol} IS NULL)`;
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
  const clause = `((COALESCE(${globalCol}, false) = true OR ${tenantCol} = ${tenantSlot} OR ${tenantCol} IS NULL) AND (${innerScope}))`;

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

// Set'i dışarıdan geçiyoruz ki server.mjs'teki FAZ2_ADMIN_TOKEN_MUTATION_PATHS
// tek mercii kalsın (path konfigürasyonu mutation guard ile birlikte yaşıyor).
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
  // /api/agents/:id/run veya /api/agents/:id/stop — loopback dispatch
  // (diagnostic script, agent→agent bridge). Handler body validation +
  // agent existence check'ini kendi içinde yapıyor.
  const parts = String(reqPath || "").split("/").filter(Boolean);
  return parts.length === 4
    && parts[0] === "api"
    && parts[1] === "agents"
    && (parts[3] === "run" || parts[3] === "stop");
}
