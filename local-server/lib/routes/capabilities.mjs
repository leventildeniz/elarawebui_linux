// Block J Tur 1A — Capabilities + Capability Packs + Discovery Scans
// Pure transfer from server.mjs (lines 13650-14021). No behavior changes.
import path from "node:path";
import fs from "node:fs";

export function mountCapabilityRoutes(app, deps) {
  const {
    pool,
    requireSession,
    resolveActorContext,
    buildVisibility,
    listCapabilities,
    syncCapabilitiesFromSources,
    invalidatePackFilterCache,
    scanToolsDir, defaultToolsRoots,
    scanSkillsDir, defaultSkillsRoots,
    scanAgentsDir, defaultAgentsRoots,
    repoRoot,
  } = deps;

  async function resolveToolsRoots(bodyRoots) {
    if (Array.isArray(bodyRoots) && bodyRoots.length) {
      return bodyRoots.map((p) => String(p)).filter(Boolean);
    }
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='tools.discovery_roots'");
      const arr = rows[0]?.value?.roots;
      if (Array.isArray(arr) && arr.length) return arr.map(String).filter(Boolean);
    } catch { /* fall through */ }
    return defaultToolsRoots(repoRoot);
  }

  async function resolveSkillsRoots(bodyRoots) {
    if (Array.isArray(bodyRoots) && bodyRoots.length) {
      return bodyRoots.map((p) => String(p)).filter(Boolean);
    }
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='skills.discovery_roots'");
      const arr = rows[0]?.value?.roots;
      if (Array.isArray(arr) && arr.length) return arr.map(String).filter(Boolean);
    } catch { /* fall through */ }
    return defaultSkillsRoots(repoRoot);
  }

  async function resolveAgentsRoots(bodyRoots) {
    if (Array.isArray(bodyRoots) && bodyRoots.length) {
      return bodyRoots.map((p) => String(p)).filter(Boolean);
    }
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='agents.discovery_roots'");
      const arr = rows[0]?.value?.roots;
      if (Array.isArray(arr) && arr.length) return arr.map(String).filter(Boolean);
    } catch { /* fall through */ }
    return defaultAgentsRoots(repoRoot);
  }

  app.get("/api/capabilities/squads", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM capability_squads ORDER BY sort_order ASC, name ASC");
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/capabilities/squads", async (req, res) => {
    try {
      const { name, color } = req.body || {};
      const sq = String(name || "").trim();
      if (!sq) return res.status(400).json({ error: "name required" });
      const { rows } = await pool.query(
        "INSERT INTO capability_squads (name, color) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET color=EXCLUDED.color RETURNING *",
        [sq, color || 'sapphire']
      );
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.put("/api/capabilities/squads/:name", async (req, res) => {
    try {
      const oldName = String(req.params.name).trim();
      const newName = String(req.body.name || "").trim();
      if (!newName) return res.status(400).json({ error: "name required" });
      
      const exists = await pool.query("SELECT 1 FROM capability_squads WHERE name=$1", [oldName]);
      if (!exists.rowCount) return res.status(404).json({ error: "not found" });
      
      await pool.query("UPDATE capability_squads SET name=$2 WHERE name=$1", [oldName, newName]);
      await pool.query("UPDATE capability_packs SET squad=$2 WHERE squad=$1", [oldName, newName]);
      
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.delete("/api/capabilities/squads/:name", async (req, res) => {
    try {
      const sq = String(req.params.name).trim();
      await pool.query("DELETE FROM capability_squads WHERE name=$1", [sq]);
      await pool.query("UPDATE capability_packs SET squad='Unassigned' WHERE squad=$1", [sq]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/capability-packs", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      const vis = buildVisibility(ctx, 1, 'owner_id');
      const { rows } = await pool.query(
        `SELECT id, name, sector, description, icon, jewel as color, tools as action_ids, skills as skill_ids, mcp_servers as mcp_server_ids, brand_keywords, system_overlay as system_prompt, system as is_system, brain_model_id as default_model, interpreter_id as default_interpreter_path, updated_at, owner_id as owner_user_id, squad, visibility, shared_with
         FROM capability_packs
         WHERE ${vis.clause}
         ORDER BY system DESC, name`,
        vis.params
      );
      res.json({ ok: true, items: rows });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.delete("/api/capability-packs/:id", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      const existing = (await pool.query("SELECT system as is_system FROM capability_packs WHERE id=$1", [req.params.id])).rows[0];
      if (!existing) return res.status(404).end();
      if (existing.is_system && !ctx.isAdmin) {
        return res.status(403).json({ error: "system packs can only be deleted by admin" });
      }
      await pool.query("DELETE FROM capability_packs WHERE id=$1", [req.params.id]);
      if (existing.is_system) {
        await pool.query(`INSERT INTO pack_seed_skip(id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [req.params.id]);
      }
      res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/capability-packs", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      if (!ctx.isAdmin) return res.status(403).json({ error: "admin only" });
      const b = req.body || {};
      const id = String(b.id || `pack-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
      const name = String(b.name || "").trim();
      if (!name) return res.status(400).json({ error: "name required" });
      const sector = String(b.sector || "general").trim();
      const description = String(b.description || "").trim();
      const icon = String(b.icon || "Shield");
      const color = String(b.color || "#06b6d4");
      const action_ids = Array.isArray(b.action_ids) ? b.action_ids.map(String) : [];
      const skill_ids = Array.isArray(b.skill_ids) ? b.skill_ids.map(String) : [];
      const mcp_server_ids = Array.isArray(b.mcp_server_ids) ? b.mcp_server_ids.map(String) : [];
      const brand_keywords = Array.isArray(b.brand_keywords)
        ? b.brand_keywords.map(s => String(s).trim().toLowerCase()).filter(Boolean)
        : [];
      const default_model = (b.default_model == null ? null : String(b.default_model).trim()) || null;
      const default_interpreter_path = (b.default_interpreter_path == null ? null : String(b.default_interpreter_path).trim()) || null;
      const system_prompt = typeof b.system_prompt === "string" ? b.system_prompt : "";
      const visibility = typeof b.visibility === "string" ? b.visibility : "workspace";
      const shared_with = Array.isArray(b.shared_with) ? b.shared_with.map(String) : [];

      const owner = b.ownerId || b.owner_id || ctx.userId || req.actor || null;
      const ownerName = b.ownerName || b.owner_name || null;

      await pool.query(
        `INSERT INTO capability_packs(id,name,sector,description,icon,jewel,tools,skills,mcp_servers,brand_keywords,system_overlay,system,brain_model_id,interpreter_id,owner_id,owner_name,squad,visibility,shared_with,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,$13,$14,$15,$16,$17,$18,now())
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,sector=EXCLUDED.sector,
           description=EXCLUDED.description,icon=EXCLUDED.icon,jewel=EXCLUDED.jewel,
           tools=EXCLUDED.tools,skills=EXCLUDED.skills,mcp_servers=EXCLUDED.mcp_servers,brand_keywords=EXCLUDED.brand_keywords,
           system_overlay=EXCLUDED.system_overlay,
           brain_model_id=EXCLUDED.brain_model_id,interpreter_id=EXCLUDED.interpreter_id,
           owner_id=COALESCE(capability_packs.owner_id, EXCLUDED.owner_id),
           owner_name=COALESCE(capability_packs.owner_name, EXCLUDED.owner_name),
           squad=EXCLUDED.squad, visibility=EXCLUDED.visibility, shared_with=EXCLUDED.shared_with`,
        [id, name, sector, description, icon, color, JSON.stringify(action_ids), JSON.stringify(skill_ids), JSON.stringify(mcp_server_ids), JSON.stringify(brand_keywords), system_prompt, default_model, default_interpreter_path, owner, ownerName, b.squad || "Unassigned", visibility, JSON.stringify(shared_with)]
      );

      const sq = String(b.squad || "").trim();
      if (sq && sq !== "Unassigned") {
        await pool.query("INSERT INTO capability_squads (name) VALUES ($1) ON CONFLICT DO NOTHING", [sq]);
      }

      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.patch("/api/capability-packs/:id", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      if (!ctx.isAdmin) return res.status(403).json({ error: "admin only" });
      const existing = (await pool.query("SELECT * FROM capability_packs WHERE id=$1", [req.params.id])).rows[0];
      if (!existing) return res.status(404).json({ error: "not found" });
      const b = req.body || {};
      const next = {
        name: typeof b.name === "string" ? b.name : existing.name,
        sector: typeof b.sector === "string" ? b.sector : existing.sector,
        squad: typeof b.squad === "string" ? b.squad : existing.squad,
        description: typeof b.description === "string" ? b.description : existing.description,
        icon: typeof b.icon === "string" ? b.icon : existing.icon,
        jewel: typeof b.color === "string" ? b.color : existing.jewel,
        tools: Array.isArray(b.action_ids) ? b.action_ids.map(String) : (Array.isArray(existing.tools) ? existing.tools : []),
        skills: Array.isArray(b.skill_ids) ? b.skill_ids.map(String) : (Array.isArray(existing.skills) ? existing.skills : []),
        mcp_servers: Array.isArray(b.mcp_server_ids) ? b.mcp_server_ids.map(String) : (Array.isArray(existing.mcp_servers) ? existing.mcp_servers : []),
        brand_keywords: Array.isArray(b.brand_keywords)
          ? b.brand_keywords.map(s => String(s).trim().toLowerCase()).filter(Boolean)
          : (Array.isArray(existing.brand_keywords) ? existing.brand_keywords : []),
        brain_model_id: ("default_model" in b)
          ? ((b.default_model == null ? null : String(b.default_model).trim()) || null)
          : (existing.brain_model_id ?? null),
        interpreter_id: ("default_interpreter_path" in b)
          ? ((b.default_interpreter_path == null ? null : String(b.default_interpreter_path).trim()) || null)
          : (existing.interpreter_id ?? null),
        system_overlay: typeof b.system_prompt === "string" ? b.system_prompt : (existing.system_overlay ?? ""),
        visibility: typeof b.visibility === "string" ? b.visibility : (existing.visibility ?? "workspace"),
        shared_with: Array.isArray(b.shared_with) ? b.shared_with.map(String) : (Array.isArray(existing.shared_with) ? existing.shared_with : [])
      };
      await pool.query(
        `UPDATE capability_packs SET name=$2,sector=$3,description=$4,icon=$5,jewel=$6,tools=$7,skills=$8,mcp_servers=$9,brand_keywords=$10,brain_model_id=$11,interpreter_id=$12,system_overlay=$13,squad=$14,visibility=$15,shared_with=$16 WHERE id=$1`,
        [req.params.id, next.name, next.sector, next.description, next.icon, next.jewel, JSON.stringify(next.tools), JSON.stringify(next.skills), JSON.stringify(next.mcp_servers), JSON.stringify(next.brand_keywords), next.brain_model_id, next.interpreter_id, next.system_overlay, next.squad, next.visibility, JSON.stringify(next.shared_with)]
      );

      const sq = String(next.squad || "").trim();
      if (sq && sq !== "Unassigned") {
        await pool.query("INSERT INTO capability_squads (name) VALUES ($1) ON CONFLICT DO NOTHING", [sq]);
      }

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.patch("/api/capabilities/:id", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const b = req.body || {};
      const existing = (await pool.query("SELECT * FROM capabilities WHERE id=$1", [req.params.id])).rows[0];
      if (!existing) return res.status(404).json({ error: "not found" });
      const patches = [];
      const args = [req.params.id];
      if (typeof b.enabled === "boolean") { args.push(b.enabled); patches.push(`enabled=$${args.length}`); }
      if (typeof b.slug === "string" && b.slug.trim()) {
        const s = b.slug.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-_]{0,79}$/.test(s)) return res.status(400).json({ error: "invalid slug" });
        const dup = await pool.query(`SELECT 1 FROM capabilities WHERE lower(slug)=$1 AND id<>$2 LIMIT 1`, [s, req.params.id]);
        if (dup.rowCount) return res.status(409).json({ error: "slug already in use" });
        args.push(s); patches.push(`slug=$${args.length}`);
      }
      if (!patches.length) return res.json({ ok: true, noop: true });
      patches.push(`updated_at=now()`);
      await pool.query(`UPDATE capabilities SET ${patches.join(", ")} WHERE id=$1`, args);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.delete("/api/capabilities/:id", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const row = (await pool.query("SELECT kind,ref_id FROM capabilities WHERE id=$1", [req.params.id])).rows[0];
      if (!row) return res.status(404).json({ error: "not found" });
      const src = row.kind === "skill" ? "skills" : row.kind === "tool" ? "action_library" : "app_agents";
      const stillExists = await pool.query(`SELECT 1 FROM ${src} WHERE id=$1 LIMIT 1`, [row.ref_id]).catch(() => ({ rowCount: 0 }));
      if (stillExists.rowCount) {
        return res.status(409).json({ error: "source row still exists — disable instead (PATCH enabled=false)" });
      }
      await pool.query("DELETE FROM capabilities WHERE id=$1", [req.params.id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.get("/api/capabilities", async (req, res) => {
    try {
      const kind = req.query.kind ? String(req.query.kind) : null;
      const all = String(req.query.all || "") === "1";
      const rows = await listCapabilities({ kind, enabledOnly: !all });
      if (all) {
        const wanted = { skill: [], tool: [], agent: [] };
        for (const r of rows) if (wanted[r.kind]) wanted[r.kind].push(r.ref_id);
        const livenessByKind = {};
        for (const [k, ids] of Object.entries(wanted)) {
          if (!ids.length) { livenessByKind[k] = new Set(); continue; }
          const src = k === "skill" ? "skills" : k === "tool" ? "action_library" : "app_agents";
          try {
            const { rows: live } = await pool.query(`SELECT id FROM ${src} WHERE id = ANY($1::text[])`, [ids]);
            livenessByKind[k] = new Set(live.map(x => x.id));
          } catch { livenessByKind[k] = new Set(ids); }
        }
        for (const r of rows) r.orphan = !livenessByKind[r.kind]?.has(r.ref_id);
      }
      res.json({ ok: true, capabilities: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/capabilities/sync", requireSession({ roles: ["admin"] }), async (_req, res) => {
    try {
      const counts = await syncCapabilitiesFromSources();
      res.json({ ok: true, counts });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/tools/scan", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const roots = await resolveToolsRoots(req.body?.roots);
      const scan = await scanToolsDir({ pool, roots });
      const counts = await syncCapabilitiesFromSources().catch(() => null);
      res.json({ ok: true, scan, capabilities: counts, roots });
    } catch (e) {
      console.error("[tools-scan] failed:", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/tools/discovery-roots", requireSession({ roles: ["admin"] }), async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='tools.discovery_roots'");
      const arr = Array.isArray(rows[0]?.value?.roots) ? rows[0].value.roots.map(String) : [];
      const fallback = defaultToolsRoots(repoRoot);
      res.json({ ok: true, roots: arr, fallback, effective: arr.length ? arr : fallback });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/tools/discovery-roots", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const incoming = Array.isArray(req.body?.roots) ? req.body.roots : [];
      const clean = [];
      for (const raw of incoming) {
        const p = String(raw || "").trim();
        if (!p) continue;
        if (!path.isAbsolute(p)) return res.status(400).json({ ok: false, error: `not absolute: ${p}` });
        try {
          const st = fs.statSync(p);
          if (!st.isDirectory()) return res.status(400).json({ ok: false, error: `not a directory: ${p}` });
        } catch (e) {
          return res.status(400).json({ ok: false, error: `unreadable: ${p} (${e.message || e})` });
        }
        if (!clean.includes(p)) clean.push(p);
      }
      await pool.query(
        `INSERT INTO app_settings(key, value) VALUES ('tools.discovery_roots', $1)
         ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
        [{ roots: clean }]
      );
      res.json({ ok: true, roots: clean });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/skills/scan", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const roots = await resolveSkillsRoots(req.body?.roots);
      const scan = await scanSkillsDir({ pool, roots });
      const counts = await syncCapabilitiesFromSources().catch(() => null);
      res.json({ ok: true, scan, capabilities: counts, roots });
    } catch (e) {
      console.error("[skills-scan] failed:", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/skills/discovery-roots", requireSession({ roles: ["admin"] }), async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='skills.discovery_roots'");
      const arr = Array.isArray(rows[0]?.value?.roots) ? rows[0].value.roots.map(String) : [];
      const fallback = defaultSkillsRoots(repoRoot);
      res.json({ ok: true, roots: arr, fallback, effective: arr.length ? arr : fallback });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/skills/discovery-roots", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const incoming = Array.isArray(req.body?.roots) ? req.body.roots : [];
      const clean = [];
      for (const raw of incoming) {
        const p = String(raw || "").trim();
        if (!p) continue;
        if (!path.isAbsolute(p)) return res.status(400).json({ ok: false, error: `not absolute: ${p}` });
        try {
          const st = fs.statSync(p);
          if (!st.isDirectory()) return res.status(400).json({ ok: false, error: `not a directory: ${p}` });
        } catch (e) {
          return res.status(400).json({ ok: false, error: `unreadable: ${p} (${e.message || e})` });
        }
        if (!clean.includes(p)) clean.push(p);
      }
      await pool.query(
        `INSERT INTO app_settings(key, value) VALUES ('skills.discovery_roots', $1)
         ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
        [{ roots: clean }]
      );
      res.json({ ok: true, roots: clean });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/agents/scan", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const roots = await resolveAgentsRoots(req.body?.roots);
      const scan = await scanAgentsDir({ pool, roots });
      const counts = await syncCapabilitiesFromSources().catch(() => null);
      res.json({ ok: true, scan, capabilities: counts, roots });
    } catch (e) {
      console.error("[agents-scan] failed:", e);
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.get("/api/agents/discovery-roots", requireSession({ roles: ["admin"] }), async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='agents.discovery_roots'");
      const arr = Array.isArray(rows[0]?.value?.roots) ? rows[0].value.roots.map(String) : [];
      const fallback = defaultAgentsRoots(repoRoot);
      res.json({ ok: true, roots: arr, fallback, effective: arr.length ? arr : fallback });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.put("/api/agents/discovery-roots", requireSession({ roles: ["admin"] }), async (req, res) => {
    try {
      const incoming = Array.isArray(req.body?.roots) ? req.body.roots : [];
      const clean = [];
      for (const raw of incoming) {
        const p = String(raw || "").trim();
        if (!p) continue;
        if (!path.isAbsolute(p)) return res.status(400).json({ ok: false, error: `not absolute: ${p}` });
        try {
          const st = fs.statSync(p);
          if (!st.isDirectory()) return res.status(400).json({ ok: false, error: `not a directory: ${p}` });
        } catch (e) {
          return res.status(400).json({ ok: false, error: `unreadable: ${p} (${e.message || e})` });
        }
        if (!clean.includes(p)) clean.push(p);
      }
      await pool.query(
        `INSERT INTO app_settings(key, value) VALUES ('agents.discovery_roots', $1)
         ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
        [{ roots: clean }]
      );
      res.json({ ok: true, roots: clean });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
