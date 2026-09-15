// Agent discovery, seeding, squads, interpreter listing, validation, and run
// history routes — extracted from server.mjs (Block J, Tur 2C-α, 2026-05-30).
// Pure-extract: behavior is identical to the original inline handlers.
// All cross-module dependencies are dependency-injected via `deps`.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function mountAgentsExtraRoutes(app, deps) {
  const {
    pool,
    AGENT_DISCOVERY_ROOTS,
    _repoAgentsDir,
    resolveActor,
    hydrateAllowedAgentsFromDb,
    ensureAgentSquadsTable,
    DISK_SQUAD_SORT,
    normalizeAgentRow,
    execAsync,
    AGENT_INTERPRETER_HINTS,
    brandSync,
    _brandSlug,
    listAgentRuns,
    liveCountsByAgent,
    cancelAgentRun,
    cancelAllRunsForAgent,
  } = deps;

  // ------------------------------------------------------------------- discover
  app.get("/api/agents/discover", async (_req, res) => {
    const out = [];
    res.json({ roots: [], scripts: [] });
  });

  // ------------------------------------------------------------ seed-from-disk
  app.post("/api/agents/seed-from-disk", async (req, res) => {
    res.json({ ok: true, root: null, squads: [], created: [], updated: [], skipped: [] });
  });

  // ===================================================== squads CRUD (Tur-3b)
  app.get("/api/agents/squads", async (req, res) => {
    try {
      await ensureAgentSquadsTable();
      const ctx = typeof deps.resolveActorContext === "function" ? await deps.resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const vis = deps.buildVisibility ? deps.buildVisibility(ctx, 1, 'owner_id') : { clause: '1=1', params: [] };

      const { rows: defined } = await pool.query(
        `SELECT name, icon, color, sort_order, created_at, owner_id, tenant_id, visibility, shared_with 
         FROM agent_squads WHERE ${vis.clause}`,
        vis.params
      );

      const agentVis = deps.buildVisibility ? deps.buildVisibility(ctx, 1, 'a.owner_id') : { clause: '1=1', params: [] };
      const { rows: counts } = await pool.query(
        `SELECT COALESCE(NULLIF(a.squad,''), 'Unassigned') AS sq,
                COUNT(*)::int AS n
           FROM agents a
          WHERE a.id != 'agt.forge_master' AND (${agentVis.clause})
          GROUP BY 1`,
        agentVis.params
      );

      const countMap = new Map(counts.map((r) => [r.sq, r.n]));
      const merged = new Map();
      for (const r of defined) {
        const count = countMap.get(r.name) || 0;
        const isOwner = ctx.isSuperAdmin || (r.owner_id && (r.owner_id === ctx.userId || String(r.owner_id).toLowerCase() === String(ctx.actor || "").toLowerCase()));
        
        // Empty squads (0 agents visible to this user) are private to their creator
        if (count === 0 && !isOwner) {
          continue;
        }

        merged.set(r.name, {
          name: r.name,
          icon: r.icon || "Shield",
          color: r.color || null,
          sortOrder: r.sort_order ?? 100,
          fromDisk: false,
          agentCount: count,
          ownerId: r.owner_id,
          owner_id: r.owner_id,
          visibility: r.visibility || 'workspace',
          sharedWith: r.shared_with || []
        });
      }

      // Dynamic discovery: also include squads that have at least 1 agent visible to this user
      for (const [sq, n] of countMap) {
        if (merged.has(sq)) continue;
        merged.set(sq, {
          name: sq,
          icon: "Shield",
          color: null,
          sortOrder: sq === "Unassigned" ? 999 : 200,
          fromDisk: false,
          agentCount: n,
          visibility: 'workspace',
          ownerId: null,
          owner_id: null
        });
      }
      const items = [...merged.values()].sort((a, b) =>
        (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name)
      );
      res.json({ items });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/agents/squads", async (req, res) => {
    try {
      await ensureAgentSquadsTable();
      const ctx = typeof deps.resolveActorContext === "function" ? await deps.resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const name = String(req.body?.name || "").trim();
      if (!name) return res.status(400).json({ ok: false, error: "name required" });
      if (name.length > 64) return res.status(400).json({ ok: false, error: "name too long (max 64)" });
      if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(name)) {
        return res.status(400).json({ ok: false, error: "invalid characters" });
      }

      const icon = String(req.body?.icon || "Shield").trim() || "Shield";
      const color = req.body?.color ? String(req.body.color).trim() : null;
      const ownerId = ctx.userId || ctx.actor || null;
      const tenantId = req.body?.tenant_id || ctx.tenantId || "default";
      const visibility = req.body?.visibility || "workspace";
      const sharedWith = Array.isArray(req.body?.shared_with) ? req.body.shared_with : [];

      await pool.query(
        `INSERT INTO agent_squads(name, icon, color, sort_order, owner_id, tenant_id, visibility, shared_with)
         VALUES ($1, $2, $3, 100, $4, $5, $6, $7::jsonb)
         ON CONFLICT (name) DO UPDATE SET 
           icon = EXCLUDED.icon, color = EXCLUDED.color,
           owner_id = COALESCE(agent_squads.owner_id, EXCLUDED.owner_id),
           tenant_id = COALESCE(agent_squads.tenant_id, EXCLUDED.tenant_id)`,
        [name, icon, color, ownerId, tenantId, visibility, JSON.stringify(sharedWith)]
      );
      res.json({ ok: true, name });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.delete("/api/agents/squads/:name", async (req, res) => {
    try {
      await ensureAgentSquadsTable();
      const ctx = typeof deps.resolveActorContext === "function" ? await deps.resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const name = String(req.params.name || "").trim();
      if (!name) return res.status(400).json({ ok: false, error: "name required" });

      const { rows } = await pool.query(
        "SELECT * FROM agent_squads WHERE name=$1", [name]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: "not found" });
      const squadRow = rows[0];

      if ((squadRow.sort_order ?? 100) === DISK_SQUAD_SORT) {
        return res.status(400).json({
          ok: false,
          error: "Disk-defined squad; remove the folder under agents/ to delete",
        });
      }

      // Enforce mutation guard: only the creator or SuperAdmin may delete
      if (deps.assertCanEdit) {
        deps.assertCanEdit(ctx, squadRow, "squad");
      }

      await pool.query(
        `UPDATE agents SET squad = 'Unassigned'
          WHERE squad = $1`,
        [name]
      );
      await pool.query("DELETE FROM agent_squads WHERE name=$1", [name]);
      res.json({ ok: true });
    } catch (e) {
      const status = e.status || 500;
      res.status(status).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.patch("/api/agents/squads/:name", async (req, res) => {
    try {
      await ensureAgentSquadsTable();
      const ctx = typeof deps.resolveActorContext === "function" ? await deps.resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      const oldName = String(req.params.name || "").trim();
      const newName = String(req.body?.newName || "").trim();
      if (!oldName || !newName) return res.status(400).json({ ok: false, error: "oldName and newName required" });
      if (newName.length > 64) return res.status(400).json({ ok: false, error: "newName too long (max 64)" });
      if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(newName)) {
        return res.status(400).json({ ok: false, error: "invalid characters in newName" });
      }
      if (oldName === newName) return res.json({ ok: true, unchanged: true });

      const { rows } = await pool.query(
        "SELECT * FROM agent_squads WHERE name=$1", [oldName]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: "squad not found" });
      const squadRow = rows[0];

      if ((squadRow.sort_order ?? 100) === DISK_SQUAD_SORT) {
        return res.status(400).json({
          ok: false,
          error: "Disk-defined squad; rename the folder under agents/ instead",
        });
      }

      // Enforce mutation guard: only the creator or SuperAdmin may rename
      if (deps.assertCanEdit) {
        deps.assertCanEdit(ctx, squadRow, "squad");
      }

      const { rows: clash } = await pool.query(
        "SELECT 1 FROM agent_squads WHERE name=$1", [newName]
      );
      if (clash.length) return res.status(409).json({ ok: false, error: "newName already exists" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE agent_squads SET name=$2 WHERE name=$1", [oldName, newName]);
        await client.query(
          `UPDATE agents
              SET squad = $2,
                  updated_at = now()
            WHERE squad = $1`,
          [oldName, newName]
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      res.json({ ok: true, name: newName });
    } catch (e) {
      const status = e.status || 500;
      res.status(status).json({ ok: false, error: String(e.message || e) });
    }
  });

  app.post("/api/agents/:id/squad", async (req, res) => {
    try {
      await ensureAgentSquadsTable();
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "id required" });
      const raw = req.body?.squad;
      const squad = (raw === null || raw === undefined || raw === "") ? 'Unassigned' : String(raw).trim();
      const { rows } = await pool.query("SELECT id FROM agents WHERE id=$1", [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: "agent not found" });
      if (squad && squad !== 'Unassigned') {
        const { rows: sq } = await pool.query(
          "SELECT 1 FROM agent_squads WHERE name=$1", [squad]
        );
        if (!sq.length) return res.status(400).json({ ok: false, error: "unknown squad" });
      }
      
      await pool.query(
        "UPDATE agents SET squad=$2, updated_at=now() WHERE id=$1",
        [id, squad]
      );
      const { rows: out } = await pool.query("SELECT * FROM agents WHERE id=$1", [id]);
      res.json({ ok: true, agent: normalizeAgentRow(out[0]) });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // ==================================================================== browse
  app.get("/api/agents/browse", async (req, res) => {
    let target = String(req.query.path || "").trim();
    if (!target || target === "~") target = os.homedir();
    else if (target.startsWith("~/")) target = path.join(os.homedir(), target.slice(2));
    try {
      const abs = path.resolve(target);
      const st = fs.statSync(abs);
      if (!st.isDirectory()) return res.status(400).json({ ok: false, error: "Not a directory", path: abs });
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      const dirs = []; const files = [];
      for (const ent of entries) {
        if (ent.name.startsWith(".")) continue;
        const full = path.join(abs, ent.name);
        try {
          const s = fs.statSync(full);
          if (ent.isDirectory()) dirs.push({ name: ent.name, path: full });
          else if (ent.isFile() && /\.(py|sh|js|mjs|ts)$/i.test(ent.name)) {
            files.push({ name: ent.name, path: full, size: s.size, ext: path.extname(ent.name).toLowerCase() });
          }
        } catch { /* skip unreadable */ }
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
      const parent = path.dirname(abs);
      res.json({
        ok: true,
        path: abs,
        parent: parent === abs ? null : parent,
        home: os.homedir(),
        shortcuts: [
          { label: "Home", path: os.homedir() },
          { label: "Desktop", path: path.join(os.homedir(), "Desktop") },
          { label: "Documents", path: path.join(os.homedir(), "Documents") },
          { label: "Downloads", path: path.join(os.homedir(), "Downloads") },
          { label: brandSync().short_name || "Project", path: path.join(os.homedir(), "Documents", _brandSlug) },
        ],
        dirs, files,
      });
    } catch (e) {
      res.status(404).json({ ok: false, error: String(e.message || e), path: target });
    }
  });

  // ============================================================= interpreters
  app.get("/api/agents/interpreters", async (_req, res) => {
    const out = [];
    const seen = new Set();
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='python.primary'");
      const primary = rows[0]?.value?.path ? String(rows[0].value.path) : "";
      if (primary) {
        try {
          const st = fs.statSync(primary);
          if (st.isFile()) {
            const ver = (await execAsync(primary, ["--version"], 2000)).trim() || rows[0].value?.version || "unknown";
            out.push({ path: primary, version: ver, kind: "primary" });
            seen.add(primary);
          }
        } catch { /* unreachable */ }
      }
    } catch { /* table missing */ }
    try {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='python.runtimes'");
      const list = Array.isArray(rows[0]?.value) ? rows[0].value : [];
      for (const rt of list) {
        const p = String(rt?.python || "").trim();
        if (!p || seen.has(p)) continue;
        try {
          const st = fs.statSync(p);
          if (!st.isFile()) continue;
        } catch { continue; }
        let ver = "unknown";
        try { ver = (await execAsync(p, ["--version"], 2000)).trim() || "unknown"; } catch { /* keep */ }
        out.push({ path: p, version: ver, kind: "runtime", name: rt?.name || "" });
        seen.add(p);
      }
    } catch { /* table missing */ }
    for (const p of AGENT_INTERPRETER_HINTS) {
      if (seen.has(p)) continue;
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
      } catch { continue; }
      const ver = await execAsync(p, ["--version"], 2000);
      out.push({
        path: p,
        version: ver.trim() || "unknown",
        kind: p.includes("/.venv") || p.includes("/venv/") ? "venv" : (p.includes("conda") ? "conda" : "system"),
      });
    }
    res.json({ interpreters: out });
  });

  // ================================================================= validate
  app.post("/api/agents/validate", async (req, res) => {
    const agentPath = String(req.body?.agent_path || "").trim();
    const interpreter = String(req.body?.interpreter_path || "").trim();
    const issues = [];
    let scriptOk = false, interpreterOk = false, interpreterVersion = "", resolvedAgentPath = "";
    if (!agentPath) issues.push("agent_path is required");
    else {
      // Try direct path first; if relative and not found, resolve against agents
      // discovery roots (same list used by disk-scan + spawn).
      const candidates = [];
      if (path.isAbsolute(agentPath)) candidates.push(agentPath);
      else {
        candidates.push(path.resolve(process.cwd(), agentPath));
        const roots = Array.isArray(AGENT_DISCOVERY_ROOTS) ? AGENT_DISCOVERY_ROOTS : [];
        for (const root of roots) {
          if (!root) continue;
          candidates.push(path.resolve(root, agentPath));
          // also try stripping a leading "agents/" segment if root already ends in agents
          const stripped = agentPath.replace(/^agents[/\\]/, "");
          if (stripped !== agentPath) candidates.push(path.resolve(root, stripped));
        }
      }
      let found = null;
      for (const c of candidates) {
        try {
          const st = fs.statSync(c);
          if (st.isFile()) { found = c; break; }
        } catch { /* try next */ }
      }
      if (found) { scriptOk = true; resolvedAgentPath = found; }
      else issues.push(`agent_path not found: tried ${candidates.length} location(s) — ${candidates.slice(0, 3).join(" | ")}`);
    }
    if (interpreter) {
      try {
        const st = fs.statSync(interpreter);
        if (!st.isFile()) issues.push(`interpreter not a file: ${interpreter}`);
        else {
          const ver = await execAsync(interpreter, ["--version"], 2500);
          interpreterVersion = ver.trim();
          if (!interpreterVersion) issues.push(`interpreter did not respond: ${interpreter}`);
          else interpreterOk = true;
        }
      } catch (e) { issues.push(`interpreter probe failed: ${String(e.message || e)}`); }
    }
    res.json({ ok: issues.length === 0, scriptOk, interpreterOk, interpreterVersion, resolvedAgentPath, issues });
  });

  // ==================================================== runs / run-history / cancel
  app.get("/api/agents/runs", (_req, res) => {
    try {
      const runs = listAgentRuns();
      const counts = liveCountsByAgent();
      res.json({ ok: true, runs, counts, ts: Date.now() });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/agents/run-history", async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"), 10) || 100));
      const agentId = String(req.query.agentId || "").trim();
      const packId = String(req.query.packId || "").trim();

      if (packId) {
        const { rows } = await pool.query(
          `(
             SELECT DISTINCT h.run_id, h.agent_id, NULL::text AS tool_id, h.script, h.source,
                    h.status, h.exit_code, h.signal, h.started_at, h.finished_at,
                    h.duration_ms, h.stdout_tail, h.stderr_tail, h.username
               FROM agent_run_history h
               JOIN agent_capability_packs acp ON acp.agent_id = h.agent_id
              WHERE acp.pack_id = $2
           )
           UNION ALL
           (
             SELECT ti.id AS run_id, ti.agent_id, ti.tool_id, NULL::text AS script,
                    'tool-call' AS source, ti.status, NULL::int AS exit_code,
                    NULL::text AS signal, ti.started_at, ti.finished_at, ti.duration_ms,
                    NULL::text AS stdout_tail, ti.error AS stderr_tail, ti.username
               FROM tool_invocations ti
               FROM tool_invocations ti
              WHERE ti.tool_id IN (
                      SELECT jsonb_array_elements_text(action_ids)
                        FROM capability_packs WHERE id = $2
                    )
           )
           LIMIT $1`,
          [limit, packId],
        );
        return res.json({ ok: true, items: rows });
      }

      const params = [limit];
      const conds = [];
      if (agentId) { params.push(agentId); conds.push(`h.agent_id = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT DISTINCT h.run_id, h.agent_id, NULL::text AS tool_id, h.script, h.source, h.status,
                h.exit_code, h.signal, h.started_at, h.finished_at, h.duration_ms,
                h.stdout_tail, h.stderr_tail, h.username
           FROM agent_run_history h
           ${where}
          ORDER BY h.started_at DESC
          LIMIT $1`,
        params,
      );
      res.json({ ok: true, items: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err), items: [] });
    }
  });

  app.post("/api/agents/:id/cancel", async (req, res) => {
    const id = String(req.params.id || "");
    const runId = String(req.query?.runId || req.body?.runId || "").trim();
    const graceMs = Number.isFinite(+req.body?.graceMs) ? +req.body.graceMs : undefined;
    try {
      if (runId) {
        const result = cancelAgentRun(runId, graceMs);
        const status = result.ok ? 200 : 404;
        return res.status(status).json({ ok: result.ok, ...result, runId });
      }
      const results = cancelAllRunsForAgent(id, graceMs);
      return res.json({ ok: true, agentId: id, cancelled: results.length, results });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // 2026-06-29 — Elara agent manifest preview ({AGENTS} placeholder content).
  // UI'da operatör RAG panelinden "Preview manifest" diyebilsin.
  app.get("/api/agents/manifest-preview", async (_req, res) => {
    try {
      const { renderAgentsManifest, invalidateAgentsManifestCache } = await import("../agents-manifest.mjs");
      // Force fresh render so the UI button reflects the latest DB state.
      invalidateAgentsManifestCache();
      const m = await renderAgentsManifest({ pool });
      res.json({ ok: true, text: m.text, count: m.count, squads: m.squads, renderedAt: m.renderedAt });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });
}

