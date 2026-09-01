// lib/agents-manifest.mjs — Elara'ya ajan listesi enjeksiyon yardımcısı.
//
// 2026-06-29 Komutan onayı: System prompt'a `{AGENTS}` placeholder konur,
// `elaraAgentManifestMode` knob'una göre runtime'da doldurulur:
//   off    → "" (boş, prompt kısa kalır)
//   lazy   → sadece kullanıcı niyeti "meta" (ajan listesi sorusu) ise dolu
//   always → her turda dolu (legacy davranış)
//
// Default lazy. Statik regex/whitelist yok — meta intent semantic
// classifier'dan gelir (rag/intent-classifier.mjs INTENT_ANCHORS.meta).
//
// 60s TTL cache: agents tablosu her turda hit edilmesin.

import fs from "node:fs";
import path from "node:path";

const CACHE_TTL_MS = 60_000;
let _cache = null;     // { renderedAt, text, count, squads }
let _inflight = null;  // de-duplicate concurrent renders

const PLACEHOLDER = "{AGENTS}";
export const AGENTS_PLACEHOLDER = PLACEHOLDER;

const DISK_SKIP_DIRS = new Set(["_shared", "__pycache__", ".git", "node_modules"]);
const DISK_SKIP_FILES = new Set(["__init__.py", "config_center.py", "bridge_service.py"]);

function _isManifestIntent(kind, mode, subKind) {
  const k = String(kind || "").toLowerCase();
  const m = String(mode || "").toLowerCase();
  const s = String(subKind || "").toLowerCase();
  return s === "agent_manifest" || k === "agent_manifest" || (k === "meta" && m === "agent-manifest");
}

// NOTE: `isAgentManifestQuestion` (regex) and `inferAgentManifestAnswerLocale`
// (regex+diacritics) were removed 2026-07-03. Static regex/whitelist detection
// violates the project rule "sistemde regex/whitelist/statik sözlük YASAK".
// Manifest-direct routing is now driven by the semantic intent classifier
// (`INTENT_ANCHORS.agent_manifest`) via `refined.subKind === "agent_manifest"`.
// Locale for the direct answer comes from the caller (chat-stream/orchestrate
// already derive it from the request body / conversation).



function _candidateAgentFiles(row) {
  const out = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  try {
    const m = row?.meta || null;
    if (m && typeof m === "object") {
      push(m.agentPath);
      push(m.agent_path);
      const script = String(m.script || "").trim();
      if (script) {
        push(path.resolve(process.cwd(), "../agents", script));
        push(path.resolve(process.cwd(), "agents", script));
      }
    }
  } catch { /* meta corrupt */ }
  push(row?.agent_path);
  return out;
}

function _headerDescription(file) {
  try {
    if (!file || !fs.existsSync(file)) return "";
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).slice(0, 80);
    for (const line of lines) {
      const m = line.match(/^\s*#\s*@description\s*:\s*(.+)$/i);
      if (m?.[1]) return String(m[1]).trim();
    }
    // Older NetSec orchestrator-style files had a plain comment instead of
    // @description. Use the first meaningful comment as a last resort.
    for (const line of lines) {
      const m = line.match(/^\s*#\s*(.+)$/);
      const s = String(m?.[1] || "").trim();
      if (!s || s.startsWith("!")) continue;
      if (/^@\w+/i.test(s)) continue;
      if (/^agents\//i.test(s)) continue;
      if (/^tur[-\s]?\d/i.test(s)) continue;
      return s;
    }
  } catch { /* file unreadable */ }
  return "";
}

function _prettyNameFromSlug(slug) {
  return String(slug || "")
    .replace(/\.py$/i, "")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((s) => s ? (s[0].toUpperCase() + s.slice(1)) : s)
    .join("_");
}

function _agentsRootCandidates() {
  const out = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  push(process.env.ELARA_AGENTS_DIR);
  push(path.resolve(process.cwd(), "agents"));
  push(path.resolve(process.cwd(), "../agents"));
  push(path.resolve(process.cwd(), "../../agents"));
  return out;
}

function _discoverDiskAgentRows() {
  const root = _agentsRootCandidates().find((p) => {
    try { return p && fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch { return false; }
  });
  if (!root) return [];
  const rows = [];
  let squads = [];
  try {
    squads = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !DISK_SKIP_DIRS.has(d.name))
      .map((d) => d.name);
  } catch { return []; }
  for (const squad of squads) {
    const squadDir = path.join(root, squad);
    let files = [];
    try {
      files = fs.readdirSync(squadDir, { withFileTypes: true })
        .filter((f) => f.isFile() && /\.py$/i.test(f.name) && !DISK_SKIP_FILES.has(f.name));
    } catch { continue; }
    for (const f of files) {
      const absPath = path.join(squadDir, f.name);
      const id = f.name.replace(/\.py$/i, "").toLowerCase();
      const relScript = `${squad}/${f.name}`;
      rows.push({
        id,
        name: _prettyNameFromSlug(id),
        status: "active",
        agent_path: absPath,
        meta: {
          script: relScript,
          agentPath: absPath,
          squad,
          description: _headerDescription(absPath),
          source: "disk",
        },
      });
    }
  }
  return rows;
}

function _agentDescription(row) {
  let desc = "";
  try {
    const m = row?.meta || null;
    if (m && typeof m === "object") {
      desc = String(m.description || m.summary || "").trim();
    }
  } catch { /* meta corrupt */ }
  if (!desc) desc = String(row?.description || row?.app_description || "").trim();
  if (!desc) {
    for (const file of _candidateAgentFiles(row)) {
      desc = _headerDescription(file);
      if (desc) break;
    }
  }
  return desc.slice(0, 160);
}

function _agentSquad(row) {
  try {
    const m = row?.meta || null;
    if (m && typeof m === "object") {
      const sq = String(m.squadOverride || m.squad || "").trim();
      if (sq) return sq;
    }
  } catch { /* */ }
  for (const file of _candidateAgentFiles(row)) {
    try {
      const parent = path.basename(path.dirname(file));
      if (parent && parent !== "." && parent !== "agents") return parent;
    } catch { /* */ }
  }
  return "Unassigned";
}

function _scriptKey(row) {
  try {
    const m = row?.meta || null;
    if (m && typeof m === "object" && m.script) return `script:${String(m.script).trim().toLowerCase()}`;
  } catch { /* */ }
  const pathish = String(row?.agent_path || "").trim();
  if (pathish) return `path:${pathish.toLowerCase()}`;
  return `id:${String(row?.id || row?.name || "").trim().toLowerCase()}`;
}

function _hasConcreteAgent(row) {
  try {
    const m = row?.meta || null;
    if (m && typeof m === "object" && String(m.script || "").trim()) return true;
  } catch { /* */ }
  return _candidateAgentFiles(row).length > 0;
}

function _agentSlug(row) {
  let raw = "";
  try {
    const m = row?.meta || null;
    if (m && typeof m === "object" && m.script) raw = path.basename(String(m.script));
  } catch { /* */ }
  if (!raw && row?.agent_path) raw = path.basename(String(row.agent_path));
  if (!raw) raw = String(row?.id || row?.name || "").trim();
  if (!raw) return "";
  // Strip .py if present, normalize to slug-form
  return raw.replace(/\.py$/i, "");
}

/**
 * Render the manifest from DB. 60s cache.
 * Returns: { text, count, squads, renderedAt }
 */
export async function renderAgentsManifest({ pool, maxAgents = 60 } = {}) {
  const now = Date.now();
  if (_cache && (now - _cache.renderedAt) < CACHE_TTL_MS) return _cache;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    let rows = [];
    try {
      if (pool) {
        const r = await pool.query(
          `SELECT id, name, meta, status, is_system, agent_path
             FROM agents
            WHERE COALESCE(status,'') <> 'disabled'
            ORDER BY COALESCE(priority,0) DESC, name ASC
            LIMIT $1`,
          [Math.max(1, Math.min(200, maxAgents))],
        );
        rows = r.rows || [];
      }
    } catch (e) {
      console.warn("[agents-manifest]", e.message);
      rows = [];
    }

    const diskRows = _discoverDiskAgentRows();
    const merged = [];
    const seen = new Set();
    for (const row of rows) {
      // If local executable agents are discoverable, do not let old abstract
      // squad/container DB rows (for example only "netsec" / "socialmedia")
      // pollute the manifest. They are not callable individual agents and they
      // are exactly what made the model answer at squad level.
      if (diskRows.length > 0 && !_hasConcreteAgent(row)) continue;
      const key = _scriptKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
    for (const row of diskRows) {
      const key = _scriptKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }

    // Group by squad
    const bySquad = new Map();
    for (const row of merged) {
      const squad = _agentSquad(row);
      if (!bySquad.has(squad)) bySquad.set(squad, []);
      bySquad.get(squad).push({
        slug: _agentSlug(row),
        name: String(row.name || row.id || "").trim(),
        description: _agentDescription(row),
      });
    }

    const squadNames = [...bySquad.keys()].sort((a, b) => a.localeCompare(b));
    const lines = [];
    if (merged.length === 0) {
      lines.push("(No agents registered yet.)");
    } else {
      lines.push(`Agent manifest — source of truth for descriptive/meta answers only.`);
      lines.push(`When the user asks about Elara's agents, enumerate the individual agent rows below with their tasks; do not summarize only the squad names.`);
      lines.push(`Do not execute agents while describing them, and do not emit @[...] tags, tool_call, skill_call, or python_agent blocks in this answer.`);
      for (const sq of squadNames) {
        lines.push(``);
        lines.push(`${sq} squad:`);
        for (const a of bySquad.get(sq)) {
          if (!a.slug) continue;
          const tail = a.description ? ` — ${a.description}` : "";
          lines.push(`- ${a.slug}${tail}`);
        }
      }
    }

    _cache = {
      renderedAt: now,
      text: lines.join("\n"),
      count: merged.length,
      squads: squadNames,
      groups: squadNames.map((sq) => ({ squad: sq, agents: bySquad.get(sq) || [] })),
    };
    return _cache;
  })();

  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}

export function formatAgentsManifestAnswer(manifest, { locale = "tr", question: _question = "" } = {}) {
  const groups = Array.isArray(manifest?.groups) ? manifest.groups : [];
  const total = Number(manifest?.count || groups.reduce((n, g) => n + (Array.isArray(g.agents) ? g.agents.length : 0), 0));
  // Locale comes from the caller (chat body / conversation); no regex sniffing.
  const answerLocale = String(locale || "tr").toLowerCase().startsWith("en") ? "en" : "tr";
  if (!groups.length || total <= 0) {
    return answerLocale === "en" ? "I do not see any registered agents yet." : "Kayıtlı ajan göremiyorum.";
  }
  const tr = answerLocale !== "en";
  const lines = [];
  lines.push(tr
    ? `Elara'nın kayıtlı ${total} ajanı aşağıda; her birini görev tanımıyla listeliyorum:`
    : `Elara has ${total} registered agents; here they are with their task descriptions:`);
  for (const g of groups) {
    const agents = Array.isArray(g.agents) ? g.agents : [];
    if (!agents.length) continue;
    lines.push("");
    lines.push(`**${g.squad}**`);
    for (const a of agents) {
      const slug = String(a.slug || a.name || "").trim();
      if (!slug) continue;
      const desc = String(a.description || "").trim();
      lines.push(`- **${slug}**${desc ? ` — ${desc}` : ""}`);
    }
  }
  lines.push("");
  lines.push(tr
    ? "Not: Bu liste sadece tanıtım amaçlıdır; ajan çalıştırmak istersen açıkça ilgili ajanı çağırmalısın."
    : "Note: This list is descriptive only; explicitly call an agent if you want it to run.");
  return lines.join("\n");
}

export function invalidateAgentsManifestCache() {
  _cache = null;
}

/**
 * Walk messages, replace `{AGENTS}` in system messages.
 *
 * @param {Array} messages
 * @param {Object} opts
 * @param {"off"|"lazy"|"always"} opts.mode
 * @param {string=} opts.intentKind  — semantic intent ("meta" triggers lazy)
 * @param {Function} opts.renderFn   — async () => ({ text, count })
 * @returns {Promise<{messages, injected, mode, count, reason}>}
 */
export async function applyAgentsPlaceholder(messages, opts = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, injected: false, mode: opts.mode || "off", count: 0, reason: "no_messages" };
  }
  const mode = (opts.mode === "always" || opts.mode === "off") ? opts.mode : "lazy";

  // Quickly check whether ANY system message contains the placeholder.
  let hasPlaceholder = false;
  for (const m of messages) {
    if (m?.role === "system" && typeof m.content === "string" && m.content.includes(PLACEHOLDER)) {
      hasPlaceholder = true; break;
    }
  }

  // Decide whether to render or replace with empty.
  let renderManifest = false;
  let reason = "";
  if (mode === "off") { renderManifest = false; reason = "mode_off"; }
  else if (mode === "always") { renderManifest = true; reason = "mode_always"; }
  else { // lazy
    if (_isManifestIntent(opts.intentKind, opts.intentMode, opts.intentSubKind)) { renderManifest = true; reason = "intent_agent_manifest"; }
    else { renderManifest = false; reason = "intent_not_meta"; }
  }

  if (!hasPlaceholder && !renderManifest) {
    return { messages, injected: false, mode, count: 0, reason: "no_placeholder" };
  }

  let manifestText = "";
  let count = 0;
  if (renderManifest && typeof opts.renderFn === "function") {
    try {
      const m = await opts.renderFn();
      manifestText = String(m?.text || "");
      count = Number(m?.count || 0);
    } catch (e) {
      console.warn("[agents-manifest:render]", e.message);
      manifestText = "";
    }
  }

  const replaced = messages.map((m) => {
    if (m?.role !== "system" || typeof m.content !== "string") return m;
    if (!m.content.includes(PLACEHOLDER)) return m;
    return {
      ...m,
      content: m.content.split(PLACEHOLDER).join(manifestText),
      // Tag preserves this system block through downstream suppression
      // (server.mjs smalltalk filter exempts meta.kind === "agent_manifest").
      meta: { ...(m.meta || {}), kind: "agent_manifest", preserve: true },
    };
  });

  // Safety net: older/operator-edited system prompts may say "runtime manifest"
  // but not contain the literal `{AGENTS}` placeholder. In lazy mode this still
  // keeps normal chat short, but meta questions get a one-turn ephemeral system
  // block so the model has the real agent rows instead of hallucinating squads.
  let outMessages = replaced;
  if (!hasPlaceholder && renderManifest && manifestText) {
    const manifestSystem = {
      role: "system",
      content: `Runtime agent manifest for this turn:\n${manifestText}`,
      meta: { kind: "agent_manifest", preserve: true },
    };
    let insertAt = 0;
    for (let i = 0; i < replaced.length; i++) {
      if (replaced[i]?.role === "system") insertAt = i + 1;
    }
    outMessages = [
      ...replaced.slice(0, insertAt),
      manifestSystem,
      ...replaced.slice(insertAt),
    ];
  }


  return {
    messages: outMessages,
    injected: renderManifest && manifestText.length > 0,
    mode,
    count,
    reason: (!hasPlaceholder && renderManifest && manifestText) ? "appended_no_placeholder" : reason,
  };
}
