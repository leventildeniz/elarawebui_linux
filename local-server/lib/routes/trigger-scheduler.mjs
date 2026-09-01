export function mountTriggerSchedulerRoutes(app, deps) {
  const { pool, requireSession } = deps;

  // READ binding
  app.get("/api/graphs/:graphKind/:graphId/nodes/:nodeId/binding", async (req, res) => {
    try {
      const { graphKind, graphId, nodeId } = req.params;
      if (!['workflow', 'orchestration'].includes(graphKind)) return res.status(400).end();

      const { rows } = await pool.query(
        "SELECT * FROM trigger_schedules WHERE graph_kind= AND graph_id= AND node_id=",
        [graphKind, graphId, nodeId]
      );
      
      if (!rows[0]) return res.json({ binding: null, schedule: null });

      const r = rows[0];
      // Minimal return formatting based on DB row
      res.json({
        schedule: {
          mode: r.mode,
          everyMinutes: r.every_minutes,
          time: r.fire_at,
          weekday: r.weekday,
          dayOfMonth: r.day_of_month,
          cron: r.cron_expr,
          timezone: r.timezone,
        },
        binding: r.mode !== 'manual' ? { kind: r.mode } : { kind: 'manual' } // Note: real binding logic needs the full payload jsonb or separate tables depending on the exact mock shape
      });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

}
