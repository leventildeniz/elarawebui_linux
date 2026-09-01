export async function syncTriggerSchedules(pool, graphKind, graphId, nodes, ownerId = null) {
  if (!['workflow', 'orchestration'].includes(graphKind)) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Wipe missing nodes from schedule
    const nodeIds = nodes.map(n => String(n.id));
    if (nodeIds.length > 0) {
      await client.query(
        "DELETE FROM trigger_schedules WHERE graph_kind=$1 AND graph_id=$2 AND node_id != ALL($3::text[])",
        [graphKind, graphId, nodeIds]
      );
    } else {
      await client.query("DELETE FROM trigger_schedules WHERE graph_kind=$1 AND graph_id=$2", [graphKind, graphId]);
    }

    // Upsert triggers
    for (const node of nodes) {
      if (node.kind !== 'trigger' || !node.schedule) continue;
      const s = node.schedule;
      const summary = node.meta || "Trigger";

      await client.query(
        `INSERT INTO trigger_schedules(graph_kind, graph_id, node_id, node_label, mode, every_minutes, fire_at, weekday, day_of_month, cron_expr, timezone, summary, owner_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
         ON CONFLICT (graph_kind, graph_id, node_id) DO UPDATE SET
           node_label = EXCLUDED.node_label,
           mode = EXCLUDED.mode,
           every_minutes = EXCLUDED.every_minutes,
           fire_at = EXCLUDED.fire_at,
           weekday = EXCLUDED.weekday,
           day_of_month = EXCLUDED.day_of_month,
           cron_expr = EXCLUDED.cron_expr,
           timezone = EXCLUDED.timezone,
           summary = EXCLUDED.summary,
           updated_at = now()`,
        [
          graphKind, graphId, node.id, node.label || 'Trigger',
          s.mode || 'manual',
          s.everyMinutes || 15,
          s.time || '08:00',
          s.weekday ?? 1,
          s.dayOfMonth ?? 1,
          s.cron || '0 8 * * *',
          s.timezone || 'UTC',
          summary,
          ownerId
        ]
      );
    }
    
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(()=>{});
    console.error("[trigger-sync] failed:", e.message);
  } finally {
    client.release();
  }
}
