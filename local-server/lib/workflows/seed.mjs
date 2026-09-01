// System Workflows seed (W-2 revised, 2026-06-01).
// Seeds the `workflows` table (NOT workflow_chains) with read-only templates
// shaped exactly like UI-authored workflows so /workflows page renders them
// and POST /api/workflows/:id/trigger walks them via skill nodes.
//
// Architectural note: Workflows = atomic skill chains. Orchestration =
// upper layer that chains workflows. System templates therefore live in
// `workflows`. Yesterday's mis-seed into `workflow_chains` is cleaned up
// once (guarded), so Orchestration starts empty and the operator builds
// chains over real workflows.

const Y = 200;
const STEP_X = 240;
const START_X = 80;
const NODE_W = 196;

function nodeStyle(color) {
  return {
    background: color || "var(--primary)",
    color: "var(--primary-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "8px 12px",
    fontSize: "12px",
    width: NODE_W,
  };
}

function buildSkillGraph(skillSlugs, color) {
  const nodes = [];
  const edges = [];

  const triggerId = "node-trigger";
  nodes.push({
    id: triggerId,
    type: "input",
    position: { x: START_X, y: Y },
    data: { label: "Manual Trigger", params: {} },
    style: nodeStyle(color),
    config: { params: { kind: "trigger" } },
  });

  let prev = triggerId;
  let x = START_X + STEP_X;
  skillSlugs.forEach((slug, idx) => {
    const id = `node-skill-${idx + 1}`;
    nodes.push({
      id,
      type: "default",
      position: { x, y: Y },
      data: { label: `! ${slug}`, params: {} },
      style: nodeStyle(color),
      config: { params: { skillSlug: slug, kind: "skill" } },
    });
    edges.push({
      id: `edge-${prev}-${id}`,
      source: prev,
      target: id,
      animated: true,
    });
    prev = id;
    x += STEP_X;
  });
  return { nodes, edges };
}

export const SYSTEM_WORKFLOWS = [
  {
    id: "sys.netsec.incident-to-report",
    name: "NetSec · Incident → Vulnerability Report",
    description: "Triage an incoming alert, then turn the findings into a structured vulnerability write-up.",
    color: "#ef4444",
    skills: ["incident-triage", "vuln-write-up"],
  },
  {
    id: "sys.netsec.firewall-review-change",
    name: "NetSec · Firewall Rule Review → Change Request",
    description: "Review a firewall ruleset and emit a ready-to-submit change request.",
    color: "#f59e0b",
    skills: ["firewall-rule-review", "change-request"],
  },
  {
    id: "sys.netsec.ddos-compliance",
    name: "NetSec · DDoS Runbook → Compliance Map",
    description: "Generate a DDoS mitigation runbook and map controls to compliance frameworks.",
    color: "#0ea5e9",
    skills: ["ddos-runbook", "compliance-map"],
  },
  {
    id: "sys.social.content-launch",
    name: "Social · Hook → Caption → Hashtags",
    description: "Build a launch-ready post: opening hook, localized caption, hashtag strategy.",
    color: "#ec4899",
    skills: ["hook-formula", "caption-localize", "hashtag-strategy"],
  },
  {
    id: "sys.social.crisis-flow",
    name: "Social · Crisis Response → CTA → Report",
    description: "Draft a crisis response, attach a CTA micro-copy, and seal a Markdown report.",
    color: "#8b5cf6",
    skills: ["crisis-response", "cta-microcopy", "markdown-report"],
  },
];

export async function seedSystemWorkflows({ pool, migrateReady }) {
  try {
    await migrateReady;

    // One-time cleanup: yesterday's seed pushed these into workflow_chains by
    // mistake. Remove them so Orchestration starts clean. Guarded by a marker
    // row in app_settings so we only do it once even if operator later
    // re-creates a sys.* chain manually.
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now())`
      );
      const { rows } = await pool.query(
        `SELECT 1 FROM app_settings WHERE key='workflows.sys_chain_cleanup.v1'`
      );
      if (!rows.length) {
        await pool.query(`DELETE FROM workflow_chains WHERE id LIKE 'sys.%'`);
        await pool.query(
          `INSERT INTO app_settings(key, value) VALUES ('workflows.sys_chain_cleanup.v1', '{"done":true}'::jsonb)
           ON CONFLICT (key) DO NOTHING`
        );
        console.log("[workflows] cleaned up legacy sys.* chains from workflow_chains");
      }
    } catch (e) {
      console.error("[workflows seed cleanup]", e.message);
    }

    await pool.query(
      `CREATE TABLE IF NOT EXISTS workflows_seed_skip (id text PRIMARY KEY, deleted_at timestamptz NOT NULL DEFAULT now())`
    );
    const { rows: skipRows } = await pool.query(`SELECT id FROM workflows_seed_skip`);
    const skip = new Set(skipRows.map((r) => r.id));

    let inserted = 0;
    for (const w of SYSTEM_WORKFLOWS) {
      if (skip.has(w.id)) continue;
      const { nodes, edges } = buildSkillGraph(w.skills, w.color);
      const graph = {
        nodes,
        edges,
        color: w.color,
        status: "draft",
        trigger: "Manual",
        runs: 0,
        is_system: true,
        description: w.description,
      };
      // Insert-only: never overwrite operator edits.
      await pool.query(
        `INSERT INTO workflows(id, name, graph, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (id) DO NOTHING`,
        [w.id, w.name, graph]
      );
      inserted += 1;
    }
    console.log(`[workflows] seeded ${inserted} system workflows (${skip.size} skipped)`);
  } catch (e) {
    console.error("[workflows seed]", e.message);
  }
}

// Back-compat alias: keep the old export name resolving to the new function
// so any stale import paths surface as a clear no-op rather than a crash.
export const seedSystemChains = seedSystemWorkflows;
