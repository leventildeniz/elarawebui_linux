#!/usr/bin/env node
// dump-agent-prompt.mjs — bir agent slug'ı için MLX'e GİDECEK system prompt
// katmanlarını DB + diskten dump eder. Salt-okur; yazma yok.
//
// Kullanım:
//   bun run local-server/scripts/dump-agent-prompt.mjs <slug>
//   bun run local-server/scripts/dump-agent-prompt.mjs firewall_oracle
//
// Şema notu (2026-06-02 fix):
//   - agents: meta jsonb (systemPrompt burada), capability_pack_id (text)
//   - app_agents: id="agent.<slug>", name, script_path, tags
//   - capability_packs: id, name, system_prompt  (NO slug)
//   - action_library: id, name, system_prompt    (NO slug)
//   - capabilities: slug ↔ ref_id köprüsü (kind='tool')
//
// Aranan kirlilik desenleri (her katman sonunda rapor edilir):
//   <|im_start|> <|im_end|> <|begin_of_text|> <|start_header_id|>
//   user: / assistant: / Kullanıcı: / Yanıt:

import pg from "pg";

const slug = (process.argv[2] || "").trim();
if (!slug) {
  console.error("usage: dump-agent-prompt.mjs <agent_slug>");
  process.exit(2);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(2);
}

const PATTERNS = [
  /<\|im_start\|>/g,
  /<\|im_end\|>/g,
  /<\|begin_of_text\|>/g,
  /<\|start_header_id\|>/g,
  /<\|end_header_id\|>/g,
  /<\|eot_id\|>/g,
  /\buser\s*:/gi,
  /\bassistant\s*:/gi,
  /\bKullanıcı\s*:/g,
  /\bYanıt\s*:/g,
];

function scanLeaks(label, text) {
  const t = String(text || "");
  const hits = [];
  for (const re of PATTERNS) {
    const m = t.match(re);
    if (m && m.length) hits.push(`${re.source} ×${m.length}`);
  }
  console.log(`\n--- ${label} (${t.length} chars) ---`);
  if (!t.length) {
    console.log("  (empty)");
    return;
  }
  if (hits.length) {
    console.log(`  ⚠ LEAK PATTERNS: ${hits.join(", ")}`);
  } else {
    console.log("  ✓ no role-token literals");
  }
  const preview = t.slice(0, 400).replace(/\n/g, "\\n");
  console.log(`  preview: ${preview}${t.length > 400 ? "…" : ""}`);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

let totalLeakHits = 0;

try {
  const agentId = `agent.${slug}`;

  // 1) app_agents (disk-scan registry — script_path + tags)
  const appA = await client.query(
    `SELECT id, name, agent_name, script_path, role, status, tags
       FROM app_agents
      WHERE id = $1 OR lower(name) = lower($2) OR lower(agent_name) = lower($2)
      LIMIT 1`,
    [agentId, slug],
  );
  if (appA.rowCount) {
    const r = appA.rows[0];
    console.log(`app_agents: id=${r.id} name=${r.name || r.agent_name} role=${r.role} status=${r.status}`);
    console.log(`  script_path=${r.script_path || "—"}`);
    console.log(`  tags=${JSON.stringify(r.tags || [])}`);
  } else {
    console.log(`app_agents: (no row for ${slug})`);
  }

  // 2) agents (brain registry — meta.systemPrompt + capability_pack_id)
  const ag = await client.query(
    `SELECT id, name, model, meta, capability_pack_id
       FROM agents
      WHERE id = $1 OR lower(name) = lower($2)
      LIMIT 1`,
    [agentId, slug],
  );
  let agentMeta = null;
  let packId = null;
  if (ag.rowCount) {
    const a = ag.rows[0];
    agentMeta = a.meta || {};
    packId = a.capability_pack_id || null;
    console.log(`\nagents: id=${a.id} name=${a.name} model=${a.model || "—"} pack=${packId || "—"}`);
    const sp = String(agentMeta.systemPrompt ?? "");
    scanLeaks("agents.meta.systemPrompt", sp);
    if (sp.length === 0) {
      // bazı yerlerde alternatif key olabilir
      const altKeys = Object.keys(agentMeta).filter((k) => /prompt/i.test(k));
      if (altKeys.length) {
        console.log(`  (meta has prompt-like keys: ${altKeys.join(", ")})`);
      }
    }
  } else {
    console.log(`\nagents: (no brain row for ${slug} — disk-only agent)`);
  }

  // 3) capability_packs overlay
  if (packId) {
    const p = await client.query(
      `SELECT id, name, sector, system_prompt FROM capability_packs WHERE id = $1`,
      [packId],
    );
    if (p.rowCount) {
      const row = p.rows[0];
      console.log(`\npack: id=${row.id} name=${row.name} sector=${row.sector}`);
      scanLeaks(`capability_packs[${row.id}].system_prompt`, row.system_prompt);
    } else {
      console.log(`\npack: (id=${packId} not found)`);
    }
  } else {
    console.log(`\npack: (no capability_pack_id bound)`);
  }

  // 4) @tools manifest — disk header + action_library.system_prompt
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(process.cwd(), "agents");
  let toolSlugs = [];
  let agentFile = null;
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === `${slug}.py`) {
        agentFile = full;
        const txt = fs.readFileSync(full, "utf8");
        const m = txt.match(/^#\s*@tools\s*:\s*(.+)$/mi);
        if (m) toolSlugs = m[1].split(",").map((s) => s.trim()).filter((s) => s && s !== "-");
      }
    }
  }
  walk(root);
  console.log(`\nagent disk file: ${agentFile || "—"}`);
  console.log(`@tools header: ${toolSlugs.length ? toolSlugs.join(", ") : "—"}`);

  if (toolSlugs.length) {
    const t = await client.query(
      `SELECT c.slug, al.id AS tool_id, al.name AS tool_name, al.system_prompt
         FROM capabilities c
         JOIN action_library al ON al.id = c.ref_id
        WHERE c.kind = 'tool' AND c.slug = ANY($1)`,
      [toolSlugs],
    );
    const seen = new Set(t.rows.map((r) => r.slug));
    for (const tool of t.rows) {
      scanLeaks(`action_library[${tool.slug} → ${tool.tool_id}].system_prompt`, tool.system_prompt);
    }
    const missing = toolSlugs.filter((s) => !seen.has(s));
    if (missing.length) {
      console.log(`\n  (tools not resolved via capabilities: ${missing.join(", ")})`);
    }
  }

  // 5) Disk dosyasının kendisi — gömülü literal'ler
  if (agentFile) {
    const body = fs.readFileSync(agentFile, "utf8");
    scanLeaks(`disk:${path.relative(process.cwd(), agentFile)}`, body);
  }

  console.log("\n--- ÖZET ---");
  console.log("Yukarıdaki katmanlardan herhangi birinde ⚠ LEAK PATTERNS varsa,");
  console.log("o katmanı /system-engine UI'dan temizle (kaynağı temizle, regex koyma).");
  console.log("Disk dosyasında leak varsa .py içindeki few-shot/örnek diyalogu sök.");
} finally {
  await client.end();
}
