// =============================================================================
// skills-scan.mjs — disk → skills registry source (Tur-7)
// =============================================================================
// Scans SKILLS_DISCOVERY_ROOTS (default: repo /skills) for *.py files and
// upserts rows into `skills` with script_kind='python' and script_path=<abs>.
// Symmetric to tools-scan.mjs — keep the two in lockstep.
//
// Header contract (all optional except @skill):
//   # @skill:        <slug>            (lowercase, [a-z0-9_-])
//   # @description:  <one line>
//   # @args:         {"key": "string"} (JSON object; key→type)
//   # @category:     Skills            (ignored by skills table; kept for parity)
//   # @icon:         Sparkles
//   # @color:        #a855f7
//   # @risk:         read|write|critical
//   # @approval:     true|false
//
// Orphan policy: if a row was scanned earlier and the script file is gone,
// we set `requires_approval=true` and tag `orphan:disk` so the operator sees
// it in Capabilities. We do NOT hard-delete — Capabilities tab does that.
// =============================================================================

import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["__pycache__", "node_modules", ".git", ".venv", "venv"]);
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RISK_SET = new Set(["read", "write", "critical"]);

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
    icon: "Sparkles",
    color: "#a855f7",
    risk: "read",
    approval: false,
  };
  const lines = text.split(/\r?\n/).slice(0, 60);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith("#") && !line.startsWith('"""') && !line.startsWith("'''")) break;
    const m = line.match(/^#\s*@(skill|description|args|icon|color|risk|approval|category)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (!val) continue;
    if (key === "skill") meta.slug = val.toLowerCase();
    else if (key === "description") meta.description = val;
    else if (key === "args") { try { meta.args = JSON.parse(val); } catch { /* keep {} */ } }
    else if (key === "icon") meta.icon = val;
    else if (key === "color") meta.color = val;
    else if (key === "risk") { if (RISK_SET.has(val.toLowerCase())) meta.risk = val.toLowerCase(); }
    else if (key === "approval") meta.approval = /^(1|true|yes|on)$/i.test(val);
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

function argsToParamSchema(argsSchema) {
  if (!argsSchema || typeof argsSchema !== "object") return { type: "object", properties: {} };
  const properties = {};
  const required = [];
  for (const [key, type] of Object.entries(argsSchema)) {
    const t = typeof type === "string" ? type.toLowerCase() : "string";
    let jt = "string";
    if (t === "number" || t === "int" || t === "integer" || t === "float") jt = "number";
    else if (t === "bool" || t === "boolean") jt = "boolean";
    else if (t === "json" || t === "object") jt = "object";
    else if (t === "array") jt = "array";
    properties[key] = { type: jt };
    required.push(key);
  }
  return { type: "object", properties, required };
}

export function defaultSkillsRoots(repoRoot) {
  if (process.env.SKILLS_DISCOVERY_ROOTS) {
    return process.env.SKILLS_DISCOVERY_ROOTS.split(":").filter(Boolean);
  }
  return [path.resolve(repoRoot, "skills")];
}

export async function scanSkillsDir({ pool, roots }) {
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
      const id = `skill.${meta.slug}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      seenScripts.add(file);
      records.push({
        id,
        slug: meta.slug,
        name: humanize(meta.slug),
        description: meta.description,
        icon: meta.icon,
        color: meta.color,
        risk: meta.risk,
        approval: meta.approval,
        paramSchema: argsToParamSchema(meta.args),
        scriptPath: file,
      });
    }
  }

  let added = 0;
  let updated = 0;
  for (const r of records) {
    const cur = await pool.query("SELECT id FROM skills WHERE id=$1", [r.id]);
    const exists = cur.rows.length > 0;
    await pool.query(
      `INSERT INTO skills
         (id, slug, name, description, icon, color, required_tools, param_schema,
          risk_level, requires_approval, script_kind, script_body, script_path,
          rollback_body, instructions, is_system, tags, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7::jsonb,$8,$9,'python','',$10,'','',false,$11,now())
       ON CONFLICT (id) DO UPDATE SET
         slug=EXCLUDED.slug,
         name=EXCLUDED.name,
         description=EXCLUDED.description,
         icon=EXCLUDED.icon,
         color=EXCLUDED.color,
         param_schema=EXCLUDED.param_schema,
         risk_level=EXCLUDED.risk_level,
         requires_approval=EXCLUDED.requires_approval,
         script_kind='python',
         script_path=EXCLUDED.script_path,
         tags=EXCLUDED.tags,
         updated_at=now()`,
      [
        r.id, r.slug, r.name, r.description, r.icon, r.color,
        JSON.stringify(r.paramSchema),
        r.risk, !!r.approval,
        r.scriptPath,
        ["source:disk-skills"],
      ]
    );
    if (exists) updated++; else added++;
  }

  // Orphan sweep — disk-skills rows whose script disappeared.
  const { rows: existingDisk } = await pool.query(
    `SELECT id, script_path, tags FROM skills WHERE 'source:disk-skills' = ANY(tags)`
  );
  let orphaned = 0;
  for (const row of existingDisk) {
    const script = row?.script_path;
    if (!script) continue;
    if (seenScripts.has(script)) continue;
    if (fs.existsSync(script)) continue;
    const nextTags = Array.from(new Set([...(row.tags || []), "orphan:disk"]));
    await pool.query(
      `UPDATE skills SET tags=$1, requires_approval=true, updated_at=now() WHERE id=$2`,
      [nextTags, row.id]
    );
    orphaned++;
  }

  return { added, updated, orphaned, total: records.length, roots };
}
