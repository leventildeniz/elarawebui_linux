// local-server/lib/routes/self-healing.mjs
// Self-Healing Tool Optimization Watchdog Endpoints

import { requireSession } from "../session-gate.mjs";
import { scanToolHealth, simulateToolAnomaly } from "../self-healing.mjs";

export async function mountSelfHealingRoutes(app, deps) {
  const { pool, broadcastAudit, enqueueWrite } = deps;
  const admin = requireSession();

  // --- GET STATUS ---
  app.get("/api/self-healing/status", admin, async (req, res) => {
    try {
      const [invocationsRes, pendingTicketsRes] = await Promise.all([
        pool.query(`
          WITH latest_approvals AS (
            SELECT tool, MAX(decided_at) as last_healed_at
            FROM approval_requests
            WHERE origin = 'self_healing' AND status = 'approved'
            GROUP BY tool
          )
          SELECT 
            ti.tool_id,
            COUNT(*)::int AS total_runs,
            COUNT(CASE WHEN ti.status IN ('error', 'timeout', 'rejected', 'cancelled') THEN 1 END)::int AS error_count,
            ROUND(AVG(COALESCE(ti.duration_ms, 0)))::int AS avg_duration_ms
          FROM tool_invocations ti
          LEFT JOIN latest_approvals la ON la.tool = ti.tool_id OR la.tool = ('tool.' || ti.tool_id) OR ('tool.' || la.tool) = ti.tool_id
          WHERE ti.started_at >= NOW() - INTERVAL '7 days'
            AND (la.last_healed_at IS NULL OR ti.started_at > la.last_healed_at)
          GROUP BY ti.tool_id
          ORDER BY error_count DESC
          LIMIT 20
        `),
        pool.query(`
          SELECT id, title, tool, target, status, created_at, args
          FROM approval_requests
          WHERE origin = 'self_healing'
          ORDER BY created_at DESC
          LIMIT 10
        `),
      ]);

      const degraded = invocationsRes.rows.filter((r) => {
        const total = Number(r.total_runs) || 0;
        const errs = Number(r.error_count) || 0;
        const avgMs = Number(r.avg_duration_ms) || 0;
        const failRate = total > 0 ? errs / total : 0;
        return total >= 3 && (failRate >= 0.25 || avgMs > 4000);
      });

      res.json({
        ok: true,
        summary: {
          totalToolsActive: invocationsRes.rows.length,
          degradedToolsCount: degraded.length,
          pendingHealingTickets: pendingTicketsRes.rows.filter((t) => t.status === "pending").length,
        },
        degraded,
        recentTickets: pendingTicketsRes.rows,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- TRIGGER ON-DEMAND HEALTH SCAN ---
  app.post("/api/self-healing/scan", admin, async (req, res) => {
    const ctx = typeof deps.resolveActorContext === "function" ? await deps.resolveActorContext(req) : null;
    const isAllowed = ctx?.isSuperAdmin || (typeof deps.isAdminCaller === "function" && await deps.isAdminCaller(req));
    if (!isAllowed) {
      return res.status(403).json({ ok: false, error: "Access denied: Platform Sovereign (SuperAdmin) required." });
    }
    try {
      const report = await scanToolHealth({ pool, broadcastAudit, enqueueWrite });
      res.json({ ok: true, report });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- SIMULATE TOOL ANOMALY (TEST / DEMO) ---
  app.post("/api/self-healing/simulate", admin, async (req, res) => {
    const ctx = typeof deps.resolveActorContext === "function" ? await deps.resolveActorContext(req) : null;
    const isAllowed = ctx?.isSuperAdmin || (typeof deps.isAdminCaller === "function" && await deps.isAdminCaller(req));
    if (!isAllowed) {
      return res.status(403).json({ ok: false, error: "Access denied: Platform Sovereign (SuperAdmin) required." });
    }
    try {
      const { toolId = "tool.whois_geo", errorCount = 4, totalRuns = 5, avgDurationMs = 5200, autoScan = true } = req.body || {};
      const sim = await simulateToolAnomaly(pool, { toolId, errorCount, totalRuns, avgDurationMs });

      let report = null;
      if (autoScan) {
        report = await scanToolHealth({ pool, broadcastAudit, enqueueWrite });
      }

      res.json({ ok: true, simulated: sim, scanReport: report });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
