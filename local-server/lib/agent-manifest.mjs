// =============================================================================
// agent-manifest.mjs — TUR-6
// Disk'teki agent .py dosyalarından `# @tools: a, b, c` header satırını okur,
// cache'ler ve gate kararı için tools[] döner. "-" veya boş → LLM-only (boş array).
// =============================================================================

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "../agents");
const _cache = new Map(); // agentId -> { tools: string[], file: string, mtime: number }
let _scanned = false;

function parseHeader(text) {
  // İlk 40 satıra bak; `# @tools: a, b` veya `# @tools: -`
  const lines = text.split(/\r?\n/).slice(0, 40);
  for (const line of lines) {
    const m = line.match(/^\s*#\s*@tools\s*:\s*(.+)$/i);
    if (!m) continue;
    const raw = m[1].trim();
    if (!raw || raw === "-") return [];
    return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return null; // header yok → manifest tanımsız
}

async function scanDir(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { await scanDir(full); continue; }
    if (!e.name.endsWith(".py") || e.name.startsWith("_")) continue;
    try {
      const stat = await fs.stat(full);
      const text = await fs.readFile(full, "utf8");
      const tools = parseHeader(text);
      const id = e.name.replace(/\.py$/, "");
      _cache.set(id, { tools: tools ?? null, file: full, mtime: stat.mtimeMs });
    } catch { /* skip */ }
  }
}

export async function loadManifests({ force = false } = {}) {
  if (_scanned && !force) return;
  _cache.clear();
  await scanDir(ROOT);
  _scanned = true;
}

export async function getAgentManifest(agentId) {
  await loadManifests();
  const id = String(agentId || "").trim().toLowerCase();
  if (!id) return null;
  return _cache.get(id) || null;
}

export async function reloadManifests() {
  await loadManifests({ force: true });
  return {
    count: _cache.size,
    agents: Array.from(_cache.entries()).map(([id, v]) => ({
      id, tools: v.tools, manifest: v.tools !== null,
    })),
  };
}

export function isLoopback(req) {
  const ip = (req.ip || req.connection?.remoteAddress || "").replace("::ffff:", "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}
