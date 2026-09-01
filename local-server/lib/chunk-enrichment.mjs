// chunk-enrichment.mjs — Deterministik chunk preamble üreticisi.
// Tek doğru kaynak: hem ingest hattı (server.mjs rebuildChunksForFile) hem
// batch script (scripts/enrich-structured-chunks.mjs) bu modülü import eder.
// LLM çağrısı YOK — saf string op, ingest hattını yavaşlatmaz.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBrandAliasesPath } from "./state-paths.mjs";

const __here = path.dirname(fileURLToPath(import.meta.url));
const ALIASES_PATH = getBrandAliasesPath();


// ── Alias cache: dosya mtime + 5sn TTL ───────────────────────────────────
let _aliasCache = null;
let _aliasMtimeMs = 0;
let _aliasCheckedAt = 0;
const ALIAS_TTL_MS = 5000;

function loadAliases() {
  const now = Date.now();
  if (_aliasCache && now - _aliasCheckedAt < ALIAS_TTL_MS) return _aliasCache;
  _aliasCheckedAt = now;
  try {
    if (!fs.existsSync(ALIASES_PATH)) {
      _aliasCache = {};
      _aliasMtimeMs = 0;
      return _aliasCache;
    }
    const st = fs.statSync(ALIASES_PATH);
    if (_aliasCache && st.mtimeMs === _aliasMtimeMs) return _aliasCache;
    const raw = fs.readFileSync(ALIASES_PATH, "utf8");
    const obj = JSON.parse(raw);
    _aliasCache = obj && typeof obj === "object" ? obj : {};
    _aliasMtimeMs = st.mtimeMs;
    return _aliasCache;
  } catch {
    _aliasCache = _aliasCache || {};
    return _aliasCache;
  }
}

function aliasLine(brand) {
  const aliases = loadAliases();
  const key = aliases[brand]
    ? brand
    : Object.keys(aliases).filter((k) => String(k || "").toLowerCase().replace(/[_\-].*$/, "").trim() === String(brand || "").toLowerCase().replace(/[_\-].*$/, "").trim())[0];
  const entry = key ? aliases[key] : null;
  if (!entry || !Array.isArray(entry.aliases) || !entry.aliases.length) return null;
  const clean = entry.aliases.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 12);
  if (!clean.length) return null;
  return `Also known as: ${clean.join(", ")}.`;
}

// ── Structured detect ────────────────────────────────────────────────────
function isStructured(row) {
  const brand = String(row.brand || "");
  if (/(_api|_api_raw|_kb)$/i.test(brand)) return true;
  const p = String(row.path || "").toLowerCase();
  if (/\.(json|yaml|yml|toml)(\b|$|#|\?)/.test(p)) return true;
  const head = String(row.content || "").slice(0, 64).trimStart();
  if (/^[\{\[]/.test(head)) return true;
  if (/^(---|openapi:|swagger:|paths:|servers:)/i.test(head)) return true;
  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────────
const HTTP_VERBS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
const VERSION_RE = /^(r\d+(?:[._-]\d+)*|v\d+(?:[._-]\d+)*|\d+(?:\.\d+){1,3}|fos\d+|asa\d+)$/i;

function tokensFromPath(p) {
  try {
    const base = String(p || "").split("/").pop().replace(/\.[a-z0-9]+$/i, "");
    return base.split(/[_\-\.]+/).filter(Boolean);
  } catch {
    return [];
  }
}

function detectMethod(content, pathTokens) {
  for (const v of HTTP_VERBS) {
    if (pathTokens.includes(v) || pathTokens.includes(v.toLowerCase())) return v;
    const re = new RegExp(`["']?method["']?\\s*[:=]\\s*["']?${v}\\b`, "i");
    if (re.test(content)) return v;
  }
  if (/\b(curl|fetch|requests\.get|axios\.get)\b/i.test(content)) {
    const m = content.match(/-X\s+(GET|POST|PUT|DELETE|PATCH)/i);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function detectAuth(content) {
  const sigs = [];
  if (/Authorization:\s*Bearer\b/i.test(content) || /\bBearer\s+[A-Za-z0-9_\-\.]/.test(content)) sigs.push("Bearer token");
  if (/X-API-Key|api[_-]?key/i.test(content)) sigs.push("API key header");
  if (/Basic\s+[A-Za-z0-9+/=]{8,}/.test(content) || /Authorization:\s*Basic\b/i.test(content)) sigs.push("Basic auth");
  if (/oauth2|client_credentials|grant_type/i.test(content)) sigs.push("OAuth2");
  if (/csrftoken|csrf_token/i.test(content)) sigs.push("CSRF token");
  if (/cookie|session_id|sessionid/i.test(content)) sigs.push("Session cookie");
  return sigs;
}

function detectEndpoint(content, pathTokens) {
  const m = content.match(/(?:["'`]|^|\s)((?:https?:\/\/[^"'`\s]+)?\/api\/[A-Za-z0-9_\-\/\{\}:.]+)/);
  if (m) return m[1].slice(0, 200);
  const apiToken = pathTokens.find((t) => /^api/i.test(t));
  if (apiToken) return "/" + pathTokens.join("/");
  return null;
}

function keywordsFromContent(content) {
  const KW = ["curl", "token", "bearer", "authentication", "authorize", "login",
              "logout", "session", "api key", "endpoint", "request", "response",
              "header", "payload", "json", "yaml", "swagger", "openapi"];
  const lower = String(content || "").toLowerCase();
  const found = [];
  for (const k of KW) if (lower.includes(k)) found.push(k);
  return found.slice(0, 10);
}

// ── Preamble builders ────────────────────────────────────────────────────
function buildStructuredPreamble(row) {
  const brand = row.brand || "unknown";
  const tokens = tokensFromPath(row.path || "");
  const content = String(row.content || "");
  const method = detectMethod(content, tokens);
  const auth = detectAuth(content);
  const endpoint = detectEndpoint(content, tokens);
  const kws = keywordsFromContent(content);

  const title = tokens
    .filter((t) => !HTTP_VERBS.includes(t.toUpperCase()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() || "reference";

  const lines = [];
  lines.push(`[${brand}] REST API / structured reference — ${title}`);
  if (method) lines.push(`HTTP method: ${method}.`);
  if (endpoint) lines.push(`Endpoint: ${endpoint}.`);
  if (auth.length) lines.push(`Authentication: ${auth.join(", ")}.`);
  if (kws.length) lines.push(`Keywords: ${kws.join(", ")}, curl, example, REST API.`);
  lines.push(`Use case: programmatic ${brand} access via REST API; useful for automation, scripting, and curl examples.`);
  const aL = aliasLine(brand);
  if (aL) lines.push(aL);
  return lines.join("\n") + "\n\n" + content;
}

function buildGenericPreamble(row) {
  const brand = row.brand || "unknown";
  const tokens = tokensFromPath(row.path || "");
  const content = String(row.content || "");
  const versions = tokens.filter((t) => VERSION_RE.test(t));
  const titleTokens = tokens.filter((t) => !versions.includes(t));
  const title = titleTokens.join(" ").replace(/\s+/g, " ").trim() || brand;
  const versionClause = versions.length ? ` ${versions.join(" ")} sürümü` : "";

  const lines = [];
  lines.push(`[${brand}] ${title}${versionClause} dokümantasyon parçası.`);
  if (versions.length) {
    lines.push(`Bu içerik ${brand} ${versions.join(" ")} sürümüne aittir.`);
    lines.push(`This excerpt belongs to ${brand} version ${versions.join(" ")} documentation.`);
  } else {
    lines.push(`Bu içerik ${brand} ürün ailesinin ${title} bölümünden alıntıdır.`);
    lines.push(`This excerpt is from ${brand} ${title} reference.`);
  }
  const aL = aliasLine(brand);
  if (aL) lines.push(aL);
  return lines.join("\n") + "\n\n" + content;
}

// ── Public API ───────────────────────────────────────────────────────────
export function enrichChunkContent(row) {
  // Saf fn: { brand, path, content } → string. Boş content güvenli.
  if (!row || typeof row !== "object") return "";
  return isStructured(row) ? buildStructuredPreamble(row) : buildGenericPreamble(row);
}

// Geriye dönük uyumluluk için script'in import edebileceği named export'lar:
export {
  loadAliases,
  aliasLine,
  isStructured,
  buildStructuredPreamble as buildPreamble,
  buildGenericPreamble,
};
