// Forge (action library) route module
// Extracted from server.mjs (T-2c, 2026-05-30).
// All external deps passed via DI — no module-level side effects.

import path from "node:path";

const FORGE_HANDLERS = new Set(["builtin", "http", "noop", "python"]);
const FORGE_KINDS = new Set(["trigger", "action", "logic", "output"]);
const FORGE_PARAM_TYPES = new Set([
  "text", "textarea", "number", "boolean", "select", "secret", "json", "ctxRef",
]);

function sanitizeForgeAction(input) {
  const a = input || {};
  if (!a.id || typeof a.id !== "string") throw new Error("id required");
  if (!FORGE_KINDS.has(a.kind)) throw new Error("invalid kind");
  if (!a.name || typeof a.name !== "string") throw new Error("name required");
  const params = Array.isArray(a.params) ? a.params : [];
  for (const p of params) {
    if (!p?.key || !FORGE_PARAM_TYPES.has(p.type)) throw new Error(`bad param: ${JSON.stringify(p)}`);
  }
  const outputs = Array.isArray(a.outputs) ? a.outputs : [];
  let runtime = (a.runtime && typeof a.runtime === "object") ? { ...a.runtime } : { handler: "builtin" };
  // Legacy alias — `python_agent` was the old disk-script handler name.
  if (runtime.handler === "python_agent") runtime.handler = "python";
  if (!FORGE_HANDLERS.has(runtime.handler)) throw new Error("invalid runtime.handler");
  if (runtime.handler === "python") {
    const script = String(runtime.script || "").trim();
    if (!script) throw new Error("runtime.script required for python handler");
    if (!path.isAbsolute(script)) throw new Error("runtime.script must be an absolute path");
    if (!script.toLowerCase().endsWith(".py")) throw new Error("runtime.script must end with .py");
    runtime.script = script;
  }
  // Priority: 1 (background) … 10 (critical). Default 5 = neutral.
  const priorityRaw = Number(a.priority);
  const priority = Number.isFinite(priorityRaw)
    ? Math.max(1, Math.min(10, Math.round(priorityRaw))) : 5;
  return {
    id: a.id, kind: a.kind, name: a.name,
    category: a.category || "General",
    provider: a.provider || "",
    icon: a.icon || "Zap",
    color: a.color || "#06b6d4",
    description: a.description || "",
    // Per-tool system prompt (mirrors agents/models). Free-form markdown;
    // chat hot path prepends it as a tool-scoped system message.
    system_prompt: typeof a.system_prompt === "string" ? a.system_prompt : "",
    params, outputs, runtime, priority,
  };
}

export { sanitizeForgeAction };

export function mountForgeRoutes(app, deps) {
  const { pool, resolveActorContext } = deps;

  app.get("/api/forge/actions", async (req, res) => {
    try {
      const { kind, category, scope } = req.query;
      const ctx = await resolveActorContext(req);
      const where = []; const params = [];
      if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
      if (category) { params.push(category); where.push(`category = $${params.length}`); }
      // Sovereign visibility: Admin/Mimar see EVERYTHING; users see own + system + legacy NULL.
      if (scope === "all" || ctx.isAdmin) {
        // unfiltered — Admin sees the entire arsenal
      } else if (ctx.actor) {
        params.push(ctx.actor);
        where.push(`(lower(owner_user_id) = $${params.length} OR owner_user_id IS NULL OR COALESCE(is_system,false)=true)`);
      } else {
        where.push(`owner_user_id IS NULL OR COALESCE(is_system,false)=true`);
      }
      const sql = `SELECT al.id, al.kind, al.name, al.category, al.provider, al.icon, al.color, al.description,
                          al.params, al.outputs, al.runtime, al.execution_policy, al.is_system,
                          al.owner_user_id, al.updated_at, al.risk_level, al.requires_approval,
                          al.priority, al.system_prompt, al.visibility, al.shared_with,
                          (SELECT slug FROM capabilities c WHERE c.ref_id = al.id AND c.kind='tool' LIMIT 1) AS slug
                   FROM action_library al ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                   ORDER BY al.priority DESC, al.is_system DESC, al.category, al.name`;
      const { rows } = await pool.query(sql, params);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.get("/api/forge/actions/:id", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM action_library WHERE id=$1", [req.params.id]);
      if (!rows[0]) return res.status(404).end();
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post("/api/forge/actions", async (req, res) => {
    try {
      const a = sanitizeForgeAction(req.body);
      const ctx = await resolveActorContext(req);
      const existing = (await pool.query("SELECT is_system, owner_user_id FROM action_library WHERE id=$1", [a.id])).rows[0];
      if (existing?.is_system && !ctx.isAdmin) {
        return res.status(403).json({ error: "system actions can only be edited by admin" });
      }
      const owner = req.body.ownerId || req.body.owner_id || existing?.owner_user_id || ctx.userId || req.actor || null;
      const policy = (req.body && typeof req.body.execution_policy === "object" && req.body.execution_policy)
        ? req.body.execution_policy : null;
      // Admin updates on system rows preserve is_system=true; new rows always user-owned.
      const visibility = req.body.visibility || 'workspace';
      const shared_with = Array.isArray(req.body.shared_with) ? req.body.shared_with : [];

      await pool.query(
        `INSERT INTO action_library(id, kind, name, category, provider, icon, color, description, params, outputs, runtime, execution_policy, priority, system_prompt, is_system, owner_user_id, visibility, shared_with, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::jsonb, '{"enforce_strict":true,"override_temperature_mode":"force_zero","retry_count":2,"retry_backoff_ms":500,"timeout_ms":30000,"output_format":"raw","custom_params":[]}'::jsonb),$14,$15,false,$13,$16,$17::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET
           kind=EXCLUDED.kind, name=EXCLUDED.name, category=EXCLUDED.category, provider=EXCLUDED.provider,
           icon=EXCLUDED.icon, color=EXCLUDED.color, description=EXCLUDED.description,
           params=EXCLUDED.params, outputs=EXCLUDED.outputs, runtime=EXCLUDED.runtime,
           execution_policy=COALESCE(EXCLUDED.execution_policy, action_library.execution_policy),
           priority=EXCLUDED.priority,
           system_prompt=EXCLUDED.system_prompt,
           is_system=action_library.is_system,
           owner_user_id=COALESCE(action_library.owner_user_id, EXCLUDED.owner_user_id),
           visibility=EXCLUDED.visibility,
           shared_with=EXCLUDED.shared_with,
           updated_at=now()`,
        [a.id, a.kind, a.name, a.category, a.provider, a.icon, a.color, a.description,
         JSON.stringify(a.params), JSON.stringify(a.outputs), JSON.stringify(a.runtime),
         policy ? JSON.stringify(policy) : null, owner, a.priority, a.system_prompt, visibility, JSON.stringify(shared_with)]
      );
      res.json({ ok: true, id: a.id });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  app.delete("/api/forge/actions/:id", async (req, res) => {
    try {
      const ctx = await resolveActorContext(req);
      const existing = (await pool.query("SELECT is_system FROM action_library WHERE id=$1", [req.params.id])).rows[0];
      if (!existing) return res.status(404).end();
      if (existing.is_system && !ctx.isAdmin) {
        return res.status(403).json({ error: "system actions can only be deleted by admin" });
      }
      await pool.query("DELETE FROM action_library WHERE id=$1", [req.params.id]);
      if (existing.is_system) {
        // Persist tombstone so seed boot doesn't resurrect it.
        await pool.query(
          `INSERT INTO action_seed_skip(id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
          [req.params.id]
        );
      }
      res.status(204).end();
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });
}
