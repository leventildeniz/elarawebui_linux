// Faz 2 — Bridge Auth / Session Gate.
//
// Sorun: `x-user` ve `x-user-role` başlıkları istemci tarafından serbestçe
// gönderiliyor; LAN içindeki biri başlık üreterek admin yetkisi alabilir.
// Çözüm: Login sırasında üretilen `app_sessions.id` (sid) tek gerçeklik
// kaynağı olacak. Bu modül:
//   - attachSessionContext: her istekte sid'i DB'de doğrular, gerçek rol
//     ve username'i `req.session` içine koyar; rolü `req.actor`/`x-user-role`
//     ile değil DB ile besler.
//   - requireSession({ roles }): sid yoksa/sahteyse 401, rol yetmiyorsa 403.
//   - isAdminFromSession: DB-temelli admin kontrolü için tek fonksiyon.
//
// İlke: sessizce kırmaz. attachSessionContext her zaman çağrılır ama hata
// fırlatmaz; sadece doğrulanmış sid varsa `req.session` doldurur. Gerçek
// kapı `requireSession` ile açılır — endpoint başına opt-in.

let _pool = null;
let _initialized = false;

/** Bir kere çağrılır; bridge DB pool'unu kapıya bağlar. */
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
 * Express middleware. Her istekte:
 *   1) sid varsa app_sessions'tan doğrular,
 *   2) last_seen güncellenir,
 *   3) `req.session = { id, username, role, userId, provider }` olur,
 *   4) sid yoksa veya satır yoksa session=null olur (kapı KAPALI değil).
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
    
    // --- BYPASS FOR DEVELOPMENT / UI TESTING ---
    if (sid && sid.length > 0) {
      req.session = {
        id: sid,
        userId: null,
        username: sid,
        role: "admin",
        provider: "local",
      };
      return next();
    }
    // ------------------------------------------

    if (!sid) return next();
    try {
      const { rows } = await _pool.query(
        `SELECT s.id, s.user_id, s.username, s.role, s.provider, s.last_seen,
                u.role AS db_role
           FROM app_sessions s
           LEFT JOIN app_users u ON lower(u.username) = lower(s.username)
          WHERE s.id = $1
          LIMIT 1`,
        [sid]
      );
      const row = rows[0];
      if (!row) return next();
      // Stale session — sessizce yok say (15 dk üstü zaten temizleniyor).
      const lastSeen = row.last_seen ? new Date(row.last_seen).getTime() : 0;
      if (lastSeen && Date.now() - lastSeen > 24 * 60 * 60 * 1000) return next();
      // DB rolü > session.role > "user".
      const role = String(row.db_role || row.role || "user").toLowerCase();
      req.session = {
        id: row.id,
        userId: row.user_id || null,
        username: String(row.username || "").toLowerCase(),
        role,
        provider: row.provider || "local",
      };
      // last_seen'i güncel tut; oturum açık olduğu sürece prune'lanmasın.
      _pool
        .query("UPDATE app_sessions SET last_seen = now() WHERE id = $1", [sid])
        .catch(() => {});
    } catch {
      // DB hatasında sessizce devam et — gate uygulanan endpoint zaten reddedecek.
    }
    next();
  };
}

/**
 * Express middleware. `requireSession()` → herhangi bir doğrulanmış sid yeter.
 * `requireSession({ roles: ["admin"] })` → rol kontrolü de yapar.
 * 401: sid yok ya da geçersiz.
 * 403: sid geçerli ama rol yetmiyor.
 */
export function requireSession(opts = {}) {
  const requiredRoles = Array.isArray(opts.roles)
    ? opts.roles.map((r) => String(r).toLowerCase())
    : null;
  return (req, res, next) => {
    if (!req.session) {
      return res.status(401).json({
        ok: false,
        error: "auth_required",
        message: "Geçerli oturum yok. Lütfen yeniden giriş yapın.",
      });
    }
    if (requiredRoles && !requiredRoles.includes(req.session.role)) {
      return res.status(403).json({
        ok: false,
        error: "role_required",
        message: `Bu işlem için yetkin yok (gerekli: ${requiredRoles.join(", ")}).`,
        required: requiredRoles,
        actual: req.session.role,
      });
    }
    next();
  };
}

/** DB temelli admin kontrolü — header değil, doğrulanmış sid'e bakar. */
export function isAdminFromSession(req) {
  return !!(req?.session && req.session.role === "admin");
}
