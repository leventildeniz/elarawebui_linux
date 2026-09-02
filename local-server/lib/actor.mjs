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
  const actor = String(req?.actor || "").trim().toLowerCase();
  if (actor) return actor;
  return await resolveDefaultActor();
}

// Sovereign hierarchy: Admin (role='Admin' OR first registered Mimar) sees EVERYTHING.
// Returns { actor, isAdmin }. Admin bypasses owner_user_id filtering entirely.
export async function resolveActorContext(req) {
  const actor = await resolveActor(req);
  if (!actor) return { actor: null, isAdmin: false, userId: null, groupIds: [] };
  try {
    const { rows } = await _pool.query(
      "SELECT id, role FROM app_users WHERE lower(username)=lower($1) LIMIT 1",
      [actor]
    );
    const role = String(rows[0]?.role ?? "").toLowerCase();
    const userId = rows[0]?.id || null;
    
    let groupIds = [];
    if (userId) {
      const gRes = await _pool.query("SELECT id FROM app_groups WHERE members ? $1", [userId]);
      groupIds = gRes.rows.map(g => g.id);
    }
    
    if (role === "admin") return { actor, isAdmin: true, userId, groupIds };
  } catch {}
  // Mimar fallback: the first-registered user is the system architect.
  const defaultActor = await resolveDefaultActor();
  const isAdmin = !!defaultActor && actor === defaultActor;
  // If we couldn't fetch userId above, we might need a fallback, but normally app_users exists.
  return { actor, isAdmin, userId: null, groupIds: [] };
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

// Build a visibility WHERE clause + params. Admin → no filter (returns null).
export function buildVisibility(ctx, paramIndexStart = 1, ownerCol = "owner_id") {
  if (ctx.isAdmin) return { clause: "1=1", params: [] };
  
  const userMatches = [ctx.userId, ctx.username, ctx.actor, ctx.user?.name].filter(Boolean);
  if (userMatches.length > 0) {
    let placeholders = userMatches.map((_, i) => `$${paramIndexStart + i}`).join(', ');
    let clause = `(${ownerCol} = ANY(ARRAY[${placeholders}]::text[]) OR lower(${ownerCol}) = ANY(ARRAY[${placeholders}]::text[]) OR visibility = 'workspace' OR ${ownerCol} IS NULL`;
    let params = [...userMatches];
    
    if (ctx.groupIds && ctx.groupIds.length > 0) {
      const groupStart = paramIndexStart + userMatches.length;
      const groupChecks = ctx.groupIds.map((g, i) => `shared_with ? $${groupStart + i}`).join(' OR ');
      clause += ` OR (visibility = 'shared' AND (${groupChecks}))`;
      params.push(...ctx.groupIds);
    }
    clause += ')';
    return { clause, params };
  }
  return { clause: `(${ownerCol} IS NULL OR visibility = 'workspace')`, params: [] };
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
