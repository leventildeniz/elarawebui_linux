// Real authentication backends for federated providers.
// LDAP via `ldapts` (TCP/389 + STARTTLS or 636 ldaps).
// RADIUS via `radius` codec over UDP (PAP); supports NPS Vendor-Specific
// Attributes for role mapping (Filter-Id / Class / VSA Microsoft-Group-IDs).
// All probes return { ok, message, latencyMs, attributes? } so the UI can
// surface real failures (not the previous fake "OK" stub).

import dgram from "node:dgram";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client as LdapClient } from "ldapts";
import radius from "radius";
import { buildMsChap2Response, verifyAuthenticatorResponse } from "./mschapv2.mjs";

// Load the bundled Microsoft VSA dictionary so we can name MS-CHAP attrs
// directly when building/parsing RADIUS packets.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { radius.add_dictionary(path.join(__dirname, "radius-dicts")); } catch { /* noop */ }

// -------------------- LDAP --------------------
function ldapUrl(cfg, secondary = false) {
  const host = secondary ? (cfg.host2 || cfg.host) : cfg.host;
  const port = secondary ? (cfg.port2 || cfg.port) : cfg.port;
  const proto = String(port) === "636" || cfg.tls === true ? "ldaps" : "ldap";
  return `${proto}://${host}:${port || 389}`;
}

export async function probeLdap(cfg) {
  const t0 = Date.now();
  if (!cfg?.host) return { ok: false, message: "host required", latencyMs: 0 };
  const client = new LdapClient({ url: ldapUrl(cfg), timeout: 4000, connectTimeout: 4000 });
  try {
    if (cfg.bindDn && cfg.bindPassword) {
      await client.bind(cfg.bindDn, cfg.bindPassword);
    } else {
      // anonymous bind probe — succeeds if server responds
      await client.bind("", "");
    }
    return { ok: true, message: `LDAP bind ok @ ${cfg.host}:${cfg.port || 389}`, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, message: `LDAP probe failed: ${String(e.message || e)}`, latencyMs: Date.now() - t0 };
  } finally {
    try { await client.unbind(); } catch { /* noop */ }
  }
}

export async function authenticateLdap(cfg, username, password) {
  if (!cfg?.host) return { ok: false, error: "ldap host not configured" };
  if (!username || !password) return { ok: false, error: "username and password required" };
  const client = new LdapClient({ url: ldapUrl(cfg), timeout: 6000, connectTimeout: 5000 });
  try {
    // 1) Service bind to search the user's DN.
    if (cfg.bindDn && cfg.bindPassword) {
      await client.bind(cfg.bindDn, cfg.bindPassword);
    }
    const userFilter = (cfg.userFilter || "(|(uid={u})(sAMAccountName={u})(userPrincipalName={u}))")
      .replace(/\{u\}/g, username.replace(/[\\\(\)\*\0]/g, ""));
    const searchBase = cfg.baseDn || "";
    let userDn = "";
    let entry = null;
    if (searchBase) {
      const r = await client.search(searchBase, {
        scope: "sub",
        filter: userFilter,
        attributes: ["dn", "cn", "mail", "memberOf", "sAMAccountName", "userPrincipalName"],
        sizeLimit: 1,
      });
      entry = r.searchEntries?.[0];
      userDn = entry?.dn || "";
    }
    if (!userDn) {
      // Fallback: build DN from common patterns
      if (username.includes("@")) userDn = username; // userPrincipalName bind (AD)
      else if (cfg.userDnTemplate) userDn = String(cfg.userDnTemplate).replace(/\{u\}/g, username);
      else if (cfg.baseDn) userDn = `uid=${username},${cfg.baseDn}`;
      else return { ok: false, error: "user not found" };
    }
    // 2) Re-bind as the user with their password (the actual auth check).
    try { await client.unbind(); } catch { /* noop */ }
    const userClient = new LdapClient({ url: ldapUrl(cfg), timeout: 6000, connectTimeout: 5000 });
    try {
      await userClient.bind(userDn, password);
    } catch (e) {
      return { ok: false, error: `ldap bind failed: ${String(e.message || e)}` };
    } finally {
      try { await userClient.unbind(); } catch { /* noop */ }
    }
    // 3) Map memberOf groups → role via configured roleMap.
    const groups = Array.isArray(entry?.memberOf) ? entry.memberOf
                  : entry?.memberOf ? [entry.memberOf] : [];
    const role = mapGroupsToRole(groups, cfg) || cfg.defaultRole || "Viewer";
    return {
      ok: true,
      username: entry?.sAMAccountName || entry?.uid || username,
      email: entry?.mail || "",
      role,
      groups: groups.map(g => String(g).split(",")[0].replace(/^cn=/i, "")),
      raw: { dn: userDn },
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    try { await client.unbind(); } catch { /* noop */ }
  }
}

// -------------------- RADIUS --------------------
// Lightweight PAP authenticator. NPS replies with Access-Accept and
// optional attributes used for role mapping.
//   - Filter-Id (RFC 2865 §5.11)        → string
//   - Class (RFC 2865 §5.25)            → string (may be VSA-encoded by NPS)
//   - Vendor-Specific (Microsoft 311)   → e.g. MS-CHAP-User-Domain etc.
// The UI lets the operator pick one of these as `roleAttribute` and supply
// a roleMap { "Domain Admins": "Admin", ... }.
function sendRadius(packet, host, port, secret, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    let done = false;
    const finish = (err, msg) => {
      if (done) return; done = true;
      try { sock.close(); } catch { /* noop */ }
      if (err) reject(err); else resolve(msg);
    };
    const timer = setTimeout(() => finish(new Error("radius timeout")), timeoutMs);
    sock.on("error", (e) => { clearTimeout(timer); finish(e); });
    sock.on("message", (msg) => {
      clearTimeout(timer);
      try {
        const decoded = radius.decode({ packet: msg, secret });
        finish(null, decoded);
      } catch (e) { finish(e); }
    });
    sock.send(packet, 0, packet.length, port, host, (e) => {
      if (e) { clearTimeout(timer); finish(e); }
    });
  });
}

export async function probeRadius(cfg) {
  const t0 = Date.now();
  if (!cfg?.host) return { ok: false, message: "host required", latencyMs: 0 };
  if (!cfg?.secret) return { ok: false, message: "shared secret required", latencyMs: 0 };
  // Status-Server (RFC 5997) — but many servers reject it. Use cheap PAP with
  // a junk user; we only care that the server REPLIES (Access-Reject is fine).
  try {
    const packet = radius.encode({
      code: "Access-Request",
      secret: cfg.secret,
      attributes: [
        ["NAS-IP-Address", "127.0.0.1"],
        ["NAS-Identifier", "elara-cockpit"],
        ["User-Name", "__elara_probe__"],
        ["User-Password", "probe"],
      ],
    });
    const reply = await sendRadius(packet, cfg.host, Number(cfg.port) || 1812, cfg.secret, 4000);
    return {
      ok: true,
      message: `RADIUS reachable · server returned ${reply.code}`,
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, message: `RADIUS probe failed: ${String(e.message || e)}`, latencyMs: Date.now() - t0 };
  }
}

export async function authenticateRadius(cfg, username, password) {
  if (!cfg?.host) return { ok: false, error: "radius host not configured" };
  if (!cfg?.secret) return { ok: false, error: "radius shared secret missing" };
  if (!username || !password) return { ok: false, error: "username and password required" };

  const method = String(cfg.authMethod || "pap").toLowerCase();
  const port = Number(cfg.port) || 1812;
  const timeout = Number(cfg.timeoutMs) || 6000;
  const baseAttrs = [
    ["NAS-IP-Address", cfg.nasIp || "127.0.0.1"],
    ["NAS-Identifier", cfg.nasIdentifier || "elara-cockpit"],
    ["Service-Type", "Authenticate-Only"],
    ["User-Name", username],
  ];

  let mschapState = null; // for MSCHAPv2 success-verification
  let attributes;
  if (method === "mschapv2") {
    const authChallenge = randomBytes(16);
    const ident = randomBytes(1)[0];
    const built = buildMsChap2Response({ ident, authChallenge, username, password });
    mschapState = { ...built, authChallenge, username };
    attributes = [
      ...baseAttrs,
      ["Vendor-Specific", "Microsoft", [["MS-CHAP-Challenge", authChallenge]]],
      ["Vendor-Specific", "Microsoft", [["MS-CHAP2-Response", built.response]]],
    ];
  } else {
    attributes = [...baseAttrs, ["User-Password", password]];
  }

  try {
    const packet = radius.encode({ code: "Access-Request", secret: cfg.secret, attributes });
    const reply = await sendRadius(packet, cfg.host, port, cfg.secret, timeout);
    if (reply.code !== "Access-Accept") {
      // Surface NPS MS-CHAP-Error if present.
      const vsa = reply.attributes?.["Vendor-Specific"]?.Microsoft;
      const err = vsa?.["MS-CHAP-Error"];
      const tail = err ? ` · ${String(err).replace(/[\x00-\x1f]/g, "")}` : "";
      return { ok: false, error: `RADIUS ${reply.code}${tail}` };
    }

    // Mutual auth (MSCHAPv2): verify NPS Authenticator-Response.
    if (mschapState) {
      const successPayload = reply.attributes?.["Vendor-Specific"]?.Microsoft?.["MS-CHAP2-Success"];
      if (successPayload) {
        const ok = verifyAuthenticatorResponse({
          successPayload: Buffer.isBuffer(successPayload) ? successPayload : Buffer.from(successPayload),
          ntHash: mschapState.ntHash,
          ntResponse: mschapState.ntResponse,
          peerChallenge: mschapState.peerChallenge,
          authChallenge: mschapState.authChallenge,
          username: mschapState.username,
        });
        if (!ok) return { ok: false, error: "RADIUS server authenticator-response failed (mutual auth)" };
      }
    }

    // Collect role-decision attributes.
    const attrs = reply.attributes || {};
    const filterId = attrs["Filter-Id"];
    const klass = attrs["Class"];
    const vsaTokens = [];
    const vsaList = attrs["Vendor-Specific"];
    if (Array.isArray(vsaList)) {
      for (const v of vsaList) {
        try { vsaTokens.push(typeof v === "string" ? v : JSON.stringify(v)); } catch { /* noop */ }
      }
    } else if (vsaList && typeof vsaList === "object") {
      // Named per-vendor dict format from radius lib.
      for (const [vname, kv] of Object.entries(vsaList)) {
        for (const [k, v] of Object.entries(kv || {})) {
          vsaTokens.push(`${vname}:${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
        }
      }
    }
    let candidate = "";
    const choice = String(cfg.roleAttribute || "Filter-Id");
    if (choice === "Filter-Id" && filterId) {
      candidate = Array.isArray(filterId) ? filterId[0] : filterId;
    } else if (choice === "Class" && klass) {
      candidate = Array.isArray(klass) ? klass[0] : klass;
    } else if (choice === "Vendor-Specific" && vsaTokens.length) {
      candidate = vsaTokens.join(",");
    }
    candidate = String(candidate || "").trim();
    const role = mapGroupsToRole([candidate], cfg) || cfg.defaultRole || "Viewer";
    return {
      ok: true,
      username,
      role,
      groups: candidate ? [candidate] : [],
      raw: { filterId, klass, vsa: vsaTokens, method },
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// -------------------- shared role mapper --------------------
// Accepts a list of group/attribute tokens and walks the configured roleMap
// to find the first match. roleMap is { "<token-substring>": "<Role>", ... }.
export function mapGroupsToRole(tokens, cfg) {
  const map = (cfg && cfg.roleMap && typeof cfg.roleMap === "object") ? cfg.roleMap : null;
  if (!map) return null;
  const list = (tokens || []).map(t => String(t || "").toLowerCase());
  for (const [needle, role] of Object.entries(map)) {
    const n = String(needle || "").toLowerCase().trim();
    if (!n) continue;
    if (list.some(t => t.includes(n))) return role;
  }
  return null;
}
