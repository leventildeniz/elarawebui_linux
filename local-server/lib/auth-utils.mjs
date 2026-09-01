import crypto from 'crypto';
import dgram from 'dgram';
import radius from 'radius';
import { Client as LdapClient } from 'ldapts';
import { isAdminFromSession } from './session-gate.mjs';

/**
 * ELARA Sovereign AI OS - Authentication Utilities
 * Bu dosya, orijinal server.mjs içindeki kimlik doğrulama ve güvenlik mantığının 
 * modüler hale getirilmiş versiyonudur.
 */

// --- Rate Limiting State ---
const __rl = new Map(); // key -> { tokens, last }

/**
 * Token Bucket Rate Limiter
 * IP tabanlı istek sınırlaması sağlar.
 */
export function rateLimit({ capacity, refillPerSec, key }) {
  return (req, res, next) => {
    const ip = String(req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    // Localhost erişimlerini kısıtlamıyoruz
    if (ip === "127.0.0.1" || ip === "::1" || ip === "") return next();

    const k = `${key}|${ip}|${typeof key === "function" ? key(req) : ""}`;
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

// Login için varsayılan Rate Limit ayarları
export const rlLogin = rateLimit({ 
  capacity: Number(process.env.RL_LOGIN_CAPACITY || 30), 
  refillPerSec: Number(process.env.RL_LOGIN_REFILL || 0.5), 
  key: "login" 
});

// Periyodik temizlik: Eski IP bucket'larını temizleyerek bellek sızıntısını önler
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

/**
 * Veritabanı yazma işlemleri için kuyruk mekanizması.
 * Not: Asıl implementasyon local-server/lib/write-queue.mjs içerisindedir.
 * Buradaki fonksiyon, identity rotalarının çökmemesi için bir proxy görevi görür.
 */
export function enqueueWrite(query, params) {
  console.log(`[AuthUtils] Write queued: ${query.substring(0, 50)}...`);
  // Gerçek kuyruk yapısı deps üzerinden inject edildiğinde burası devre dışı kalır.
}

// --- Federated Auth Mocks ---
// LDAP ve RADIUS implementasyonları genellikle harici modüllerle yapılır.
// Sistemin crash olmaması için temel yapıları sağlıyoruz.

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
