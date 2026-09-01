// local-server/lib/routes/meta-forge.mjs
// Elara self-authoring endpoints (plan-first, admin-only apply).
//
// Naming: "meta-forge" to avoid collision with existing forge.mjs
// (action library editor). Mounted at /api/meta-forge/*.

import { buildInventory, validateForgePlan } from "../meta-forge/planner.mjs";
import { applyForgePlan, rollbackForgePlan } from "../meta-forge/apply.mjs";
import { refreshCapabilitiesAfterForgeApply } from "../meta-forge/refresh.mjs";

const ENSURE_SQL = ``;

let _ensured = false;
async function ensureForgeTables(pool) {
  if (_ensured) return;
  await pool.query(ENSURE_SQL);
  _ensured = true;
}

export function mountMetaForgeRoutes(app, deps) {
  const { pool, resolveActorContext, hydrateAllowedAgentsFromDb } = deps;
  ensureForgeTables(pool).catch(e => console.error("[meta-forge] ensure failed:", e?.message || e));

  async function requireAdmin(req, res) {
    try {
      const ctx = await resolveActorContext(req);
      if (!ctx?.isAdmin) {
        res.status(403).json({ error: "admin only" });
        return null;
      }
      return ctx;
    } catch {
      res.status(401).json({ error: "unauthorized" });
      return null;
    }
  }

  // Read-only inventory — used by the Meta/forge_master agent to know what
  // already exists before proposing new artifacts.
  app.get("/api/meta-forge/inventory", async (req, res) => {
    try {
      const inv = await buildInventory(pool);
      res.json({ ok: true, inventory: inv });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // List forge plans (history + pending).
  app.get("/api/meta-forge/plans", async (req, res) => {
    const status = req.query?.status ? String(req.query.status) : null;
    const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit, 10) || 50));
    const params = [];
    let where = "";
    if (status) { params.push(status); where = `WHERE status=$1`; }
    const { rows } = await pool.query(
      `SELECT id, actor AS requested_by, prompt AS intent, status, rolled_back_at, note AS error, created_at, created_at AS updated_at,
              jsonb_build_object('create', actions) AS plan_json
         FROM forge_plans ${where}
        ORDER BY created_at DESC
        LIMIT ${limit}`,
      params,
    );
    res.json({ ok: true, plans: rows });
  });

  app.get("/api/meta-forge/plans/:id", async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.id, p.actor AS requested_by, p.prompt AS intent, p.status, p.rolled_back_at, p.note AS error, p.created_at, p.created_at AS updated_at,
              jsonb_build_object('create', p.actions) AS plan_json,
              COALESCE(json_agg(json_build_object(
                'kind', a.kind, 'slug', a.slug,
                'disk_path', a.disk_path, 'db_row_id', a.db_row_id,
                'created_at', a.created_at))
              FILTER (WHERE a.kind IS NOT NULL), '[]'::json) AS artifacts
         FROM forge_plans p
         LEFT JOIN forge_artifacts a ON a.plan_id=p.id
        WHERE p.id=$1
        GROUP BY p.id`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "plan not found" });
    res.json({ ok: true, plan: rows[0] });
  });

  // Submit a plan (from the forge_master agent OR manual test from UI).
  // Body: { intent, plan: { reuse, create } }
  app.post("/api/meta-forge/plans", async (req, res) => {
    try {
      const body = req.body || {};
      const intent = String(body.intent || "").slice(0, 2000);
      if (!intent.trim()) return res.status(400).json({ error: "intent required" });
      const plan = validateForgePlan(body.plan);
      const requestedBy = body.requested_by || (await resolveActorContext(req).catch(() => null))?.user?.email || "system";
      const { rows } = await pool.query(
        `INSERT INTO forge_plans (id, actor, prompt, actions, status)
         VALUES ($1, $2, $3, $4::jsonb, 'pending')
         RETURNING id, created_at`,
        [`mf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`, requestedBy, intent, JSON.stringify(plan.create || [])],
      );
      res.json({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
    } catch (e) {
      res.status(400).json({ error: String(e?.message || e) });
    }
  });

  // Approve + apply. Admin only.
  app.post("/api/meta-forge/plans/:id/apply", async (req, res) => {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    const { rows } = await pool.query(
      `SELECT id, jsonb_build_object('create', actions) AS plan_json, status FROM forge_plans WHERE id=$1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: "plan not found" });
    const p = rows[0];
    if (p.status !== "pending" && p.status !== "approved" && p.status !== "failed" && p.status !== "rolled_back") {
      return res.status(409).json({ error: `plan status is ${p.status}` });
    }
    try {
      const result = await applyForgePlan({ pool, planId: p.id, plan: p.plan_json });
      const finalStatus = result.failed.length && !result.applied.length ? "failed" : "applied";
      await pool.query(
        `UPDATE forge_plans SET status=$2, rolled_back_at=now(), note=$3 WHERE id=$1`,
        [p.id, finalStatus, result.failed.length ? JSON.stringify(result.failed) : null],
      );
      let refresh = null;
      if (finalStatus === "applied") {
        try { refresh = await refreshCapabilitiesAfterForgeApply({ pool, plan: p.plan_json }); }
        catch (e) { refresh = { error: String(e?.message || e) }; }
        try { await hydrateAllowedAgentsFromDb?.(); } catch { /* best-effort */ }
      }
      res.json({ ok: true, status: finalStatus, refresh, ...result });
    } catch (e) {
      await pool.query(
        `UPDATE forge_plans SET status='failed', note=$2 WHERE id=$1`,
        [p.id, String(e?.message || e)],
      );
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/meta-forge/plans/:id/reject", async (req, res) => {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    const reason = String(req.body?.reason || "").slice(0, 500);
    await pool.query(
      `UPDATE forge_plans SET status='rejected', note=$2 WHERE id=$1`,
      [req.params.id, reason || null],
    );
    res.json({ ok: true });
  });

  app.post("/api/meta-forge/plans/:id/rollback", async (req, res) => {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    try {
      const result = await rollbackForgePlan({ pool, planId: req.params.id });
      await pool.query(
        `UPDATE forge_plans SET status='rolled_back', note=COALESCE(note,'') || ' [rolled back]' WHERE id=$1`,
        [req.params.id],
      );
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // 2026-07-05 — Auto-Creator: Undo alias (admin-only) — cleaner semantics
  // for /system-engine → Auto-Forge Log. Same as rollback but sets
  // status='undone' so the log distinguishes admin-driven undo.
  app.post("/api/meta-forge/plans/:id/undo", async (req, res) => {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    try {
      const result = await rollbackForgePlan({ pool, planId: req.params.id });
      await pool.query(
        `UPDATE forge_plans SET status='rolled_back', note=COALESCE(note,'') || ' [undone by admin]' WHERE id=$1`,
        [req.params.id],
      );
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.delete("/api/meta-forge/plans", async (req, res) => {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    try {
      await pool.query("DELETE FROM forge_plans");
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // 2026-07-05 — Approve / reject a pending_review capability (admin-only).
  // Body: { action: 'approve' | 'reject', reason?: string }
  app.post("/api/capabilities/:id/review", async (req, res) => {
    const ctx = await requireAdmin(req, res); if (!ctx) return;
    const action = String(req.body?.action || "").toLowerCase();
    const reason = String(req.body?.reason || "").slice(0, 500);
    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
    }
    try {
      if (action === "approve") {
        const r = await pool.query(
          `UPDATE capabilities
              SET review_status='approved', live=true, updated_at=now()
            WHERE id=$1
            RETURNING id, slug, kind, live, review_status`,
          [req.params.id],
        );
        if (!r.rows.length) return res.status(404).json({ error: "capability not found" });
        try { await hydrateAllowedAgentsFromDb?.(); } catch { /* */ }
        res.json({ ok: true, capability: r.rows[0] });
      } else {
        const r = await pool.query(
          `UPDATE capabilities
              SET review_status='rejected', live=false, updated_at=now(),
                  reasoning = COALESCE(reasoning,'') || CASE WHEN $2::text IS NULL OR $2::text = '' THEN '' ELSE E'\n[rejected] ' || $2::text END
            WHERE id=$1
            RETURNING id, slug, kind, live, review_status`,
          [req.params.id, reason || null],
        );
        if (!r.rows.length) return res.status(404).json({ error: "capability not found" });
        res.json({ ok: true, capability: r.rows[0] });
      }
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
