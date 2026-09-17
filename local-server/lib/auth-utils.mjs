import crypto from 'crypto';
import dgram from 'dgram';
import dns from 'node:dns/promises';
import net from 'node:net';
import radius from 'radius';
import { Client as LdapClient } from 'ldapts';
import { isAdminFromSession, isSuperAdminFromSession } from './session-gate.mjs';

/**
 * ELARA Sovereign AI OS - Authentication Utilities
 * Modular enterprise authentication, credential hashing, and security helpers.
 */

// --- Rate Limiting State ---
const __rl = new Map(); // key -> { tokens, last }

/**
 * Resolves the genuine client IP address behind reverse proxies and CDNs.
 */
export function getRealClientIp(req) {
  const stripV6 = (s) => String(s || "").replace(/^::ffff:/, "").trim();
  const cf = stripV6(req?.headers?.["cf-connecting-ip"]);
  const xreal = stripV6(req?.headers?.["x-real-ip"]);
  const xfwdAll = String(req?.headers?.["x-forwarded-for"] || "")
    .split(",").map(stripV6).filter(Boolean);
  const xfwdReal = xfwdAll.find(ip => ip && ip !== "::1" && !/^127\./.test(ip)) || xfwdAll[0] || "";
  const sock = stripV6(req?.ip || req?.socket?.remoteAddress);
  return cf || xreal || xfwdReal || sock || "127.0.0.1";
}

/**
 * Checks if an IP address belongs to a private, loopback, or cloud-metadata network.
 */
export function isPrivateOrRestrictedIp(ip) {
  if (!net.isIP(ip)) return false;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    return false;
  }
  const norm = ip.toLowerCase();
  if (norm === '::1' || norm === '::') return true;
  if (norm.startsWith('fe80:') || norm.startsWith('fc00:') || norm.startsWith('fd00:')) return true;
  return false;
}

/**
 * Validates that a destination hostname does not resolve to private, loopback, or cloud metadata,
 * UNLESS explicitly approved as a registered Target in the caller's organization.
 */
export async function isSafePublicHost(host, { pool = null, tenantId = "default" } = {}) {
  if ((process.env.ELARA_NETSEC_ALLOW_PRIVATE || "").trim() === "1") return true;
  const cleanHost = String(host || "").trim().toLowerCase();
  if (!cleanHost) return false;

  // Zero-Trust: If this host or IP is an approved Target in this tenant, allow egress.
  if (pool) {
    try {
      const tCheck = await pool.query(
        `SELECT 1 FROM targets 
         WHERE (lower(host) = $1 OR ip = $1) 
           AND (tenant_id = $2 OR is_global = true OR tenant_id = 'default') 
         LIMIT 1`,
        [cleanHost, tenantId]
      );
      if (tCheck.rows.length > 0) return true;
    } catch {}
  }

  try {
    const records = await dns.lookup(cleanHost, { all: true });
    for (const rec of records) {
      if (isPrivateOrRestrictedIp(rec.address)) {
        // If the resolved IP is an approved Target in inventory, permit access
        if (pool) {
          try {
            const ipCheck = await pool.query(
              `SELECT 1 FROM targets 
               WHERE ip = $1 
                 AND (tenant_id = $2 OR is_global = true OR tenant_id = 'default') 
               LIMIT 1`,
              [rec.address, tenantId]
            );
            if (ipCheck.rows.length > 0) return true;
          } catch {}
        }
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Token Bucket Rate Limiter
 * Provides IP-based and key-based request rate limiting.
 */
export function rateLimit({ capacity, refillPerSec, key }) {
  return (req, res, next) => {
    const clientIp = getRealClientIp(req);
    // Only whitelist genuine direct CLI/local loopback requests (not forwarded by external proxy)
    const isDirectLocal = (clientIp === "127.0.0.1" || clientIp === "::1") && !req?.headers?.["x-forwarded-for"] && !req?.headers?.["x-real-ip"];
    if (isDirectLocal) return next();

    const k = `${key}|${clientIp}|${typeof key === "function" ? key(req) : ""}`;
    const now = Date.now();
    
    let b = __rl.get(k);
    if (!b) { 
      b = { tokens: capacity, last: now }; 
      __rl.set(k, b); 
    }

    const elapsed = (now - b.last) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.last = now;

    if (b.tokens < 1) {
      const retryAfter = Math.ceil((1 - b.tokens) / refillPerSec);
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-RateLimit-Limit", String(capacity));
      res.setHeader("X-RateLimit-Remaining", "0");
      return res.status(429).json({ 
        ok: false, 
        code: "rate_limited", 
        error: "Too many requests, please try again later", 
        retryAfter 
      });
    }

    b.tokens -= 1;
    res.setHeader("X-RateLimit-Limit", String(capacity));
    res.setHeader("X-RateLimit-Remaining", String(Math.floor(b.tokens)));
    next();
  };
}

// Default Rate Limiter settings for login endpoints
export const rlLogin = rateLimit({ 
  capacity: Number(process.env.RL_LOGIN_CAPACITY || 30), 
  refillPerSec: Number(process.env.RL_LOGIN_REFILL || 0.5), 
  key: "login" 
});

// Periodic janitor: Prunes expired IP buckets to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of __rl) {
    if (now - b.last > 10 * 60_000) __rl.delete(k);
  }
}, 60_000).unref?.();

// --- Password Security ---

export function randomBytes(n) {
  return crypto.randomBytes(n);
}

export function hashPassword(plain, salt) {
  const s = salt ?? crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(plain ?? ""), s, 64).toString("hex");
  return { hash: h, salt: s };
}

export function verifyPassword(plain, hashHex, salt) {
  if (!hashHex || !salt) return false;
  try {
    const calc = crypto.scryptSync(String(plain ?? ""), salt, 64);
    const stored = Buffer.from(hashHex, "hex");
    return calc.length === stored.length && crypto.timingSafeEqual(calc, stored);
  } catch (e) {
    return false;
  }
}

// --- ID Generation ---

export const createLocalId = () => crypto.randomUUID();

export const createPrefixedId = (prefix) => 
  `${prefix}${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`;

// --- Authorization Helpers ---

export function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    name: r.display_name || r.username,
    email: r.email || "",
    role: r.role,
    tenantId: r.tenant_id || "default",
    tenant_id: r.tenant_id || "default",
    provider: r.provider,
    status: r.status,
    groups: r.groups || [],
    templateId: r.template_id || null,
    validUntil: r.valid_until ? (
      () => {
        const d = new Date(r.valid_until);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    )() : null,
    mustChangePassword: !!r.must_change_password,
    avatarStyle: r.avatar_style || "sigil",
    avatarJewel: r.avatar_jewel || "sapphire",
    avatarSeed: r.avatar_seed || "",
    locked: r.locked || false,
    passwordChangedAt: r.password_changed_at ? new Date(r.password_changed_at).toISOString() : undefined,
    allowedProviders: Array.isArray(r.allowed_providers) ? r.allowed_providers : [],
    canOverrideProvider: r.can_override_provider !== false,
    allowedAgents: Array.isArray(r.allowed_agents) ? r.allowed_agents : [],
    allowedTools: Array.isArray(r.allowed_tools) ? r.allowed_tools : [],
    allowedSkills: Array.isArray(r.allowed_skills) ? r.allowed_skills : []
  };
}

export async function isAdminCaller(req) {
  return await isAdminFromSession(req);
}

export async function isSuperAdminCaller(req, resolveActorContext) {
  if (typeof resolveActorContext === "function") {
    try {
      const ctx = await resolveActorContext(req);
      if (ctx?.isSuperAdmin) return true;
    } catch {}
  }
  return isSuperAdminFromSession(req);
}

/**
 * Database write queue proxy mechanism.
 * Note: Core implementation resides in local-server/lib/write-queue.mjs.
 * This proxy ensures identity routes remain stable when queue injection is absent.
 */
export function enqueueWrite(query, params) {
  console.log(`[AuthUtils] Write queued: ${query.substring(0, 50)}...`);
  // Deactivated when real write-queue is injected via deps.
}

// --- Federated Identity Providers (LDAP & RADIUS) ---
// Provides enterprise LDAP/Active Directory bind testing and RADIUS authentication.

export async function testLdapConnection(config) {
  const url = config.url;
  if (!url) return { ok: false, error: "LDAP URL missing" };

  const client = new LdapClient({
    url,
    timeout: 3000,
    connectTimeout: 3000,
  });

  try {
    if (config.bindDn && config.bindPassword) {
      await client.bind(config.bindDn, config.bindPassword);
    }
    return { ok: true, message: "LDAP Server reachable and bind successful." };
  } catch (e) {
    return { ok: false, error: `LDAP Connection failed: ${e.message}` };
  } finally {
    try { await client.unbind(); } catch {}
  }
}

export async function testRadiusConnection(config) {
  if (!config.host || !config.secret) return { ok: false, error: "RADIUS host or secret missing" };
  const port = parseInt(config.port, 10) || 1812;
  
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    
    // We send a malformed/dummy packet just to see if we get a response or timeout
    // Actually, sending a real Access-Request with a dummy user is better to test reachability.
    const packet = radius.encode({
      code: "Access-Request",
      secret: config.secret,
      identifier: 0,
      attributes: [
        ["User-Name", "ping_elara"],
        ["User-Password", "ping_elara"]
      ]
    });

    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      socket.close();
      resolve({ ok: false, error: "RADIUS connection timed out" });
    }, 3000);

    socket.on("message", (msg) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      socket.close();
      resolve({ ok: true, message: "RADIUS Server is reachable." });
    });

    socket.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      socket.close();
      resolve({ ok: false, error: `RADIUS error: ${err.message}` });
    });

    socket.send(packet, 0, packet.length, port, config.host);
  });
}

export async function authenticateLdap(config, username, password) {
  const url = config.url;
  const searchBase = config.userSearchBase;
  const filterTpl = config.userSearchFilter || '(uid={{username}})';
  
  if (!url || !searchBase) {
    return { ok: false, error: "LDAP URL or Search Base missing" };
  }

  const client = new LdapClient({
    url,
    timeout: 5000,
    connectTimeout: 5000,
  });

  try {
    if (config.bindDn && config.bindPassword) {
      await client.bind(config.bindDn, config.bindPassword);
    }

    const filter = filterTpl.replace(/{{username}}/g, username);
    const { searchEntries } = await client.search(searchBase, {
      filter,
      scope: 'sub',
      sizeLimit: 1
    });

    if (searchEntries.length === 0) {
      await client.unbind();
      return { ok: false, error: "User not found" };
    }

    const userEntry = searchEntries[0];
    const userDN = userEntry.dn;

    await client.bind(userDN, password);

    const email = Array.isArray(userEntry.mail) ? userEntry.mail[0] : (userEntry.mail || "");
    const nameStr = Array.isArray(userEntry.displayName) ? userEntry.displayName[0] : 
                    Array.isArray(userEntry.cn) ? userEntry.cn[0] : 
                    (userEntry.displayName || userEntry.cn || username);

    return { 
      ok: true, 
      username, 
      email: String(email), 
      name: String(nameStr),
      role: config.defaultRole || "Viewer",
      groups: [] // Add AD group extraction here later if needed
    };
  } catch (e) {
    return { ok: false, error: `LDAP Auth failed: ${e.message}` };
  } finally {
    try { await client.unbind(); } catch {}
  }
}

export async function authenticateRadius(config, username, password) {
  if (!config.host || !config.secret) return { ok: false, error: "RADIUS provider not fully configured" };
  const port = parseInt(config.port, 10) || 1812;

  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let packet;
    try {
      packet = radius.encode({
        code: "Access-Request",
        secret: config.secret,
        identifier: Math.floor(Math.random() * 255),
        attributes: [
          ["User-Name", username],
          ["User-Password", password]
        ]
      });
    } catch (e) {
      return resolve({ ok: false, error: "Failed to encode RADIUS packet" });
    }

    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      socket.close();
      resolve({ ok: false, error: "RADIUS connection timed out" });
    }, 5000);

    socket.on("message", (msg) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      socket.close();

      try {
        const response = radius.decode({ packet: msg, secret: config.secret });
        if (response.code === "Access-Accept") {
          resolve({ 
            ok: true, 
            username, 
            email: `${username}@radius.local`, // RADIUS doesn't usually return email
            name: username,
            role: config.defaultRole || "Viewer",
            groups: []
          });
        } else {
          resolve({ ok: false, error: "RADIUS authentication rejected (Access-Reject)" });
        }
      } catch (e) {
        resolve({ ok: false, error: "Invalid RADIUS response" });
      }
    });

    socket.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      socket.close();
      resolve({ ok: false, error: `RADIUS error: ${err.message}` });
    });

    socket.send(packet, 0, packet.length, port, config.host);
  });
}
