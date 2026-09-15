// Phase 2 — Bridge Auth / Session Gate.
//
// Security Architecture:
// `x-user` and `x-user-role` headers are untrusted client-supplied values.
// The cryptographically generated `app_sessions.id` (sid) verified in PostgreSQL
// serves as the single source of truth.
// This module provides:
//   - attachSessionContext: Verifies sid against DB per request, populates req.session
//     with authenticated role, user_id, tenant_id, and provider.
//   - requireSession({ roles }): Enforces authentication (401) and RBAC authorization (403).
//   - isAdminFromSession: Single authoritative check for admin/sovereign session status.
//
// Principle: Fail-safe and non-disruptive. attachSessionContext is invoked globally
// but only populates req.session when a valid, active session is verified.
// Explicit route protection is opted in via `requireSession`.

let _pool = null;
let _initialized = false;

/** Invoked once on boot to bind the PostgreSQL connection pool. */
export function initSessionGate(pool) {
  _pool = pool;
  _initialized = true;
}

function pickSid(req) {
  // Check headers first (standard API requests)
  let sid = String(req?.headers?.["x-session-id"] || "").trim();
  if (sid) return sid;
  
  // Check query params (for file downloads/exports where headers can't be set by the browser)
  sid = String(req?.query?.["x-session-id"] || "").trim();
  return sid || null;
}

/**
 * Express middleware. On every request:
 *   1) Verifies sid against app_sessions if present,
 *   2) Updates last_seen timestamp,
 *   3) Populates req.session = { id, username, role, userId, provider, tenant_id },
 *   4) Sets req.session = null if sid is absent or invalid (open-by-default, guarded by requireSession).
 */
export function attachSessionContext() {
  return async (req, _res, next) => {
    req.session = null;

    // --- v8: Localhost admin token bypass ---
    // Use case: CLI scripts (admin-curl.sh) on the same host need to call
    // POST /api/knowledge/* without a browser cookie. We accept x-admin-token
    // ONLY when (a) ADMIN_API_TOKEN env is set, (b) header matches, AND
    // (c) request originates from loopback. Header alone is not enough.
    // v9: header geldi ama bypass başarısızsa SESSİZ kalmaz; reddi tek satır
    // log'a düşürür. Token değerleri asla log'lanmaz — sadece uzunluk + sebep.
    const adminToken = String(process.env.ADMIN_API_TOKEN || "").trim();
    const sentToken  = String(req?.headers?.["x-admin-token"] || "").trim();
    if (sentToken) {
      if (!adminToken) {
        console.error(`[session-gate] admin-token reject: reason=server-token-unset sent_len=${sentToken.length}`);
      } else if (sentToken !== adminToken) {
        console.error(`[session-gate] admin-token reject: reason=token-mismatch sent_len=${sentToken.length} expected_len=${adminToken.length}`);
      } else {
        const ip = String(req?.ip || req?.socket?.remoteAddress || "");
        const isLoopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("127.");
        if (!isLoopback) {
          console.error(`[session-gate] admin-token reject: reason=non-loopback ip=${ip}`);
        } else {
          req.session = {
            id: "admin-token",
            userId: null,
            username: "admin-cli",
            role: "admin",
            provider: "admin-token",
          };
          return next();
        }
      }
    }

    if (!_initialized || !_pool) return next();
    const sid = pickSid(req);
    if (!sid) return next();

    try {
      const { rows } = await _pool.query(
        `SELECT s.id, s.user_id, s.username, s.role, s.provider, s.tenant_id, s.last_seen,
                u.role AS db_role, u.tenant_id AS user_tenant_id,
                u.locked, u.status AS user_status, u.valid_until
           FROM app_sessions s
           LEFT JOIN app_users u ON lower(u.username) = lower(s.username)
          WHERE s.id = $1
          LIMIT 1`,
        [sid]
      );
      const row = rows[0];
      if (row) {
        // Enforce account security locks, status, and expiration
        const isLocked = Boolean(row.locked) || row.user_status === "locked" || row.user_status === "suspended" || row.user_status === "disabled";
        const isExpired = row.valid_until && new Date(row.valid_until).getTime() < Date.now();
        if (isLocked || isExpired) {
          _pool.query("DELETE FROM app_sessions WHERE id = $1", [sid]).catch(() => {});
          req.session = null;
          return next();
        }

        // Session expiration check (24h ceiling)
        const lastSeen = row.last_seen ? new Date(row.last_seen).getTime() : 0;
        if (!lastSeen || Date.now() - lastSeen <= 24 * 60 * 60 * 1000) {
          const role = String(row.db_role || row.role || "user").toLowerCase();
          req.session = {
            id: row.id,
            userId: row.user_id || null,
            username: String(row.username || "").toLowerCase(),
            role,
            tenant_id: row.tenant_id || row.user_tenant_id || "default",
            provider: row.provider || "local",
          };
          _pool.query("UPDATE app_sessions SET last_seen = now() WHERE id = $1", [sid]).catch(() => {});
          return next();
        }
      }
    } catch (err) {
      // DB error in session resolution
    }
    next();
  };
}

/**
 * Express middleware. `requireSession()` → requires any verified session.
 * `requireSession({ roles: ["admin"] })` → enforces role requirement.
 * 401: Missing or invalid session.
 * 403: Session valid, but insufficient role permissions.
 */
export function requireSession(opts = {}) {
  const requiredRoles = Array.isArray(opts.roles)
    ? opts.roles.map((r) => String(r).toLowerCase())
    : null;
  return async (req, res, next) => {
    if (!req.session) {
      return res.status(401).json({
        ok: false,
        error: "auth_required",
        message: "No valid session found. Please sign in again.",
      });
    }
    const userRole = String(req.session.role || "user").toLowerCase();
    // Admin & Sovereign always have full access across all operations
    if (userRole === "admin" || userRole === "sovereign") {
      return next();
    }
    if (requiredRoles && !requiredRoles.includes(userRole)) {
      // Check if custom role in PostgreSQL app_roles satisfies this operation dynamically
      try {
        if (_pool) {
          const rRes = await _pool.query("SELECT is_system, scopes, actions FROM app_roles WHERE lower(name) = lower($1) OR id = $1 LIMIT 1", [userRole]);
          if (rRes.rows.length > 0) {
            const roleData = rRes.rows[0];
            const actions = Array.isArray(roleData.actions) ? roleData.actions : [];
            if (actions.includes("write") || actions.includes("approve") || actions.includes("workspace-all")) {
              return next();
            }
          }
        }
      } catch {}

      return res.status(403).json({
        ok: false,
        error: "role_required",
        message: `Insufficient permissions for this operation (required roles: ${requiredRoles.join(", ")}).`,
        required: requiredRoles,
        actual: req.session.role,
      });
    }
    next();
  };
}

/** DB-based admin check from verified session. */
export function isAdminFromSession(req) {
  return !!(req?.session && (req.session.role === "admin" || req.session.role === "sovereign"));
}

/** DB-based SuperAdmin check (cluster-wide sovereign principal in default tenant). */
export function isSuperAdminFromSession(req) {
  if (!req?.session) return false;
  const role = String(req.session.role || "").toLowerCase();
  const tenant = String(req.session.tenant_id || "default").toLowerCase();
  return (role === "admin" || role === "sovereign") && (tenant === "default" || !tenant);
}
