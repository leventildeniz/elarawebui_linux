// =============================================================================
// tools-scan.mjs — disk → action_library registry source
// =============================================================================
// Scans TOOLS_DISCOVERY_ROOTS (default: repo /tools) for *.py files and upserts
// rows into action_library with runtime.handler="python" and a structured
// header derived from `# @tool:` / `# @description:` / `# @args:` comments.
//
// Orphan detection: existing rows tagged `source:disk-tools` whose script path
// no longer exists on disk get runtime.orphan=true and tag `orphan:disk` added.
// Hard-delete stays a Capabilities-tab operator action.
//
// Caller (server.mjs) provides the pool and an optional capability-sync hook.
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
      if (!ent.isFile()) continue;
      if (!name.endsWith(".py")) continue;
      // Skip _-prefixed files UNLESS they live under an _examples folder.
      if (name.startsWith("_")) {
        const parent = path.basename(dir);
        if (parent !== "_examples") continue;
      }
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
    args: {},
    category: "Tools",
    icon: "Wrench",
    color: "#06b6d4",
  };
  const lines = text.split(/\r?\n/).slice(0, 60); // header window
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Stop scanning headers once code begins (heuristic — header lines all start
    // with `#` or `"""`; first non-comment, non-docstring, non-blank line ends it).
    if (!line.startsWith("#") && !line.startsWith('"""') && !line.startsWith("'''")) break;
    const m = line.match(/^#\s*@(tool|description|args|category|icon|color)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (!val) continue;
    if (key === "tool") meta.slug = val.toLowerCase();
    else if (key === "description") meta.description = val;
    else if (key === "args") {
      try { meta.args = JSON.parse(val); }
      catch { /* leave default {} on parse error */ }
    }
    else if (key === "category") meta.category = val;
    else if (key === "icon") meta.icon = val;
    else if (key === "color") meta.color = val;
  }
  // Description fallback — first """docstring""" line.
  if (!meta.description) {
    const dm = text.match(/"""([^"\n]+)/);
    if (dm) meta.description = dm[1].trim();
  }
  return meta;
}

function humanize(slug) {
  return slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function argsToParams(argsSchema) {
  if (!argsSchema || typeof argsSchema !== "object") return [];
  return Object.entries(argsSchema).map(([key, type]) => ({
    key,
    label: humanize(key),
    type: typeof type === "string" ? mapType(type) : "text",
  }));
}

function mapType(t) {
  const x = String(t).toLowerCase();
  if (x === "number" || x === "int" || x === "integer" || x === "float") return "number";
  if (x === "bool" || x === "boolean") return "boolean";
  if (x === "json" || x === "object" || x === "array") return "json";
  return "text";
}

export function defaultToolsRoots(repoRoot) {
  if (process.env.TOOLS_DISCOVERY_ROOTS) {
    return process.env.TOOLS_DISCOVERY_ROOTS.split(":").filter(Boolean);
  }
  return [path.resolve(repoRoot, "tools")];
}

export async function scanToolsDir({ pool, roots }) {
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
      const id = `tool.${meta.slug}`;
      if (seenIds.has(id)) continue; // duplicate slugs: first wins
      seenIds.add(id);
      seenScripts.add(file);
      records.push({
        id,
        slug: meta.slug,
        name: humanize(meta.slug),
        description: meta.description,
        category: meta.category,
        icon: meta.icon,
        color: meta.color,
        params: argsToParams(meta.args),
        runtime: {
          handler: "python",
          script: file,
          source: "disk-tools",
          scanned_at: new Date().toISOString(),
        },
      });
    }
  }

  let added = 0;
  let updated = 0;
  for (const r of records) {
    const cur = await pool.query("SELECT id FROM action_library WHERE id=$1", [r.id]);
    const exists = cur.rows.length > 0;
    await pool.query(
      `INSERT INTO action_library
         (id, kind, name, category, provider, icon, color, description, params, outputs, runtime, tags, is_system, updated_at)
       VALUES ($1,'action',$2,$3,'',$4,$5,$6,$7,'[]'::jsonb,$8,$9,false,now())
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name,
         category=EXCLUDED.category,
         icon=EXCLUDED.icon,
         color=EXCLUDED.color,
         description=EXCLUDED.description,
         params=EXCLUDED.params,
         runtime=EXCLUDED.runtime,
         tags=EXCLUDED.tags,
         updated_at=now()`,
      [
        r.id, r.name, r.category, r.icon, r.color, r.description,
        JSON.stringify(r.params),
        JSON.stringify(r.runtime),
        ["source:disk-tools"],
      ]
    );
    if (exists) updated++; else added++;
  }

  // Orphan sweep — disk-tools rows whose script vanished.
  const { rows: existingDisk } = await pool.query(
    `SELECT id, runtime, tags FROM action_library
      WHERE 'source:disk-tools' = ANY(tags)`
  );
  let orphaned = 0;
  for (const row of existingDisk) {
    const script = row?.runtime?.script;
    if (script && seenScripts.has(script)) continue;
    if (!script) continue;
    if (fs.existsSync(script)) continue;
    const nextRuntime = { ...(row.runtime || {}), orphan: true };
    const nextTags = Array.from(new Set([...(row.tags || []), "orphan:disk"]));
    await pool.query(
      `UPDATE action_library SET runtime=$1, tags=$2, updated_at=now() WHERE id=$3`,
      [JSON.stringify(nextRuntime), nextTags, row.id]
    );
    orphaned++;
  }

  return { added, updated, orphaned, total: records.length, roots };
}
