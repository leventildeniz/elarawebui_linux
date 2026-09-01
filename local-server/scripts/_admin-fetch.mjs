// _admin-fetch.mjs — shared loopback HTTP helper for maintenance scripts.
// If ADMIN_API_TOKEN is a valid ASCII value, it is sent for compatibility.
// Loopback-only maintenance endpoints do not require a token.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// local-server/scripts/_admin-fetch.mjs  →  local-server/.env
// Mutlak yol şart: ESM `import "dotenv/config"` CWD'deki .env'i okur,
// script repo kökünden çağrılırsa local-server/.env'i kaçırır.
dotenv.config({ path: path.resolve(HERE, "..", ".env") });

const BASE = process.env.MIDDLEWARE_BASE || "http://127.0.0.1:3005";

function getToken() {
  const t = String(process.env.ADMIN_API_TOKEN || "").trim();
  if (!t) return "";
  if (!/^[\x00-\x7F]+$/.test(t)) return "";
  return t;
}

export async function adminPost(pathname, { dryRun = false, body = null } = {}) {
  const token = getToken();
  const url = `${BASE}${pathname}${dryRun ? (pathname.includes("?") ? "&" : "?") + "dryRun=1" : ""}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-Admin-Token"] = token;
  const init = {
    method: "POST",
    headers,
  };
  if (body) init.body = JSON.stringify(body);
  const r = await fetch(url, init);
  let j;
  try { j = await r.json(); } catch { j = { ok: false, status: r.status, error: "non-json response" }; }
  return { status: r.status, json: j };
}

export async function adminGet(pathname) {
  const token = getToken();
  const url = `${BASE}${pathname}`;
  const headers = token ? { "X-Admin-Token": token } : {};
  const r = await fetch(url, { headers });
  let j;
  try { j = await r.json(); } catch { j = { ok: false, status: r.status, error: "non-json response" }; }
  return { status: r.status, json: j };
}
