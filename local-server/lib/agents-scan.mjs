// =============================================================================
// agents-scan.mjs — disk → app_agents registry source (Tur-7.2)
// =============================================================================
// Scans AGENTS_DISCOVERY_ROOTS (default: repo /agents) for *.py files and
// upserts rows into `app_agents` with script_path=<abs>. Symmetric to
// tools-scan.mjs / skills-scan.mjs — keep them in lockstep.
//
// Header contract (all optional except @agent):
//   # @agent:        <slug>         (lowercase, [a-z0-9_-])
//   # @description:  <one line>
//   # @role:         general|researcher|writer|... (free text, default 'general')
//   # @icon:         Bot
//   # @color:        #06b6d4
//   # @priority:     1..10
//
// Files prefixed with `_` are skipped (treated as helpers).
//
// Orphan policy: rows tagged `source:disk-agents` whose script vanished get
// `status='error'` and tag `orphan:disk`. Hard-delete is operator-only via
// the Capabilities tab.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["__pycache__", "node_modules", ".git", ".venv", "venv"]);
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function listPyFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      const name = ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
        walk(path.join(dir, name), depth + 1);
        continue;
      }
      if (!ent.isFile() || !name.endsWith(".py")) continue;
      // Skip helper / private files (e.g. _shared/__init__.py, _helpers.py).
      if (name.startsWith("_")) continue;
      out.push(path.join(dir, name));
    }
  };
  walk(root, 0);
  return out;
}

function parseHeader(text, fallbackSlug) {
  const meta = {
    slug: fallbackSlug,
    description: "",
    role: "general",
    icon: "Bot",
    color: "#06b6d4",
    priority: null,
  };
  const lines = text.split(/\r?\n/).slice(0, 60);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith("#") && !line.startsWith('"""') && !line.startsWith("'''")) break;
    const m = line.match(/^#\s*@(agent|description|role|icon|color|priority)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (!val) continue;
    if (key === "agent") meta.slug = val.toLowerCase();
    else if (key === "description") meta.description = val;
    else if (key === "role") meta.role = val.toLowerCase();
    else if (key === "icon") meta.icon = val;
    else if (key === "color") meta.color = val;
    else if (key === "priority") {
      const n = Number(val);
      if (Number.isFinite(n)) meta.priority = Math.max(1, Math.min(10, Math.round(n)));
    }
  }
  if (!meta.description) {
    const dm = text.match(/"""([^"\n]+)/);
    if (dm) meta.description = dm[1].trim();
  }
  return meta;
}

function humanize(slug) {
  return slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function defaultAgentsRoots(repoRoot) {
  if (process.env.AGENTS_DISCOVERY_ROOTS) {
    return process.env.AGENTS_DISCOVERY_ROOTS.split(":").filter(Boolean);
  }
  return [path.resolve(repoRoot, "agents")];
}

export async function scanAgentsDir({ pool, roots }) {
  const seenScripts = new Set();
  const seenIds = new Set();
  const records = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of listPyFiles(root)) {
      let text = "";
      try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
      const fallbackSlug = path.basename(file, ".py").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
      const meta = parseHeader(text, fallbackSlug);
      if (!SLUG_RE.test(meta.slug)) continue;
      const id = `agent.${meta.slug}`;
      if (seenIds.has(id)) continue; // duplicate slug: first wins
      seenIds.add(id);
      seenScripts.add(file);
      records.push({
        id,
        slug: meta.slug,
        name: humanize(meta.slug),
        description: meta.description,
        role: meta.role,
        scriptPath: file,
      });
    }
  }

  let added = 0;
  let updated = 0;
  for (const r of records) {
    const cur = await pool.query("SELECT id, tags FROM app_agents WHERE id=$1", [r.id]);
    const exists = cur.rows.length > 0;
    // Re-discovery clears any prior orphan marker.
    const tags = ["source:disk-agents"];
    await pool.query(
      `INSERT INTO app_agents
         (id, agent_name, name, script_path, bridge_url, role, status, description,
          owner_user_id, is_system, tags, updated_at)
       VALUES ($1,$2,$2,$3,'',$4,'idle',$5,NULL,false,$6,now())
       ON CONFLICT (id) DO UPDATE SET
         agent_name=EXCLUDED.agent_name,
         name=EXCLUDED.name,
         script_path=EXCLUDED.script_path,
         role=EXCLUDED.role,
         description=EXCLUDED.description,
         status=CASE WHEN app_agents.status='error' THEN 'idle' ELSE app_agents.status END,
         tags=EXCLUDED.tags,
         updated_at=now()`,
      [r.id, r.name, r.scriptPath, r.role, r.description, tags]
    );
    if (exists) updated++; else added++;
  }

  // Orphan sweep — disk-agents rows whose script vanished.
  const { rows: existingDisk } = await pool.query(
    `SELECT id, script_path, tags FROM app_agents WHERE 'source:disk-agents' = ANY(tags)`
  );
  let orphaned = 0;
  for (const row of existingDisk) {
    const script = row?.script_path;
    if (!script) continue;
    if (seenScripts.has(script)) continue;
    if (fs.existsSync(script)) continue;
    const nextTags = Array.from(new Set([...(row.tags || []), "orphan:disk"]));
    await pool.query(
      `UPDATE app_agents SET tags=$1, status='error', updated_at=now() WHERE id=$2`,
      [nextTags, row.id]
    );
    orphaned++;
  }

  return { added, updated, orphaned, total: records.length, roots };
}
