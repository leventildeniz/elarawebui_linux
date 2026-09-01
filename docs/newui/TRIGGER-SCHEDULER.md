# Trigger Scheduler — Component, API Wiring & Schema

Everything needed to lift the trigger cadence feature out of the UI and bind it to `api-v2.mjs` + PostgreSQL.

- UI component: `src/components/sovereign/trigger-schedule-card.tsx`
- UI model: `TriggerSchedule` / `WorkflowNode` in `src/mocks/workflows.ts`
- Mount points: `src/routes/orchestration.tsx`, `src/routes/flows.tsx`
- SQL: `db/trigger_scheduler_schema.sql`

---

## 1. Data model (UI)

```ts
// src/mocks/workflows.ts
export type TriggerSchedule = {
  mode: "manual" | "interval" | "daily" | "weekly" | "monthly" | "cron";
  everyMinutes: number;   // interval mode
  time: string;           // "HH:mm" for daily / weekly / monthly
  weekday: number;        // 0 = Sunday
  dayOfMonth: number;     // 1..31
  cron: string;           // five-field cron
  timezone: string;       // IANA zone, from TIMEZONES in src/lib/mail-store.ts
};

export type WorkflowNode = {
  id: string;
  kind: "trigger" | "action" | "skill" | "logic" | "output";
  label: string;
  meta: string;           // human summary, kept in sync with the schedule
  x: number;
  y: number;
  schedule?: TriggerSchedule;
};
```

Defaults and the summary formatter are exported from the card:

```ts
import { defaultSchedule, scheduleSummary, TriggerScheduleCard }
  from "@/components/sovereign/trigger-schedule-card";
```

`scheduleSummary()` output examples: `every 15m · UTC`, `daily 08:00 · Europe/Istanbul`,
`Monday 09:30 · UTC`, `day 1 · 08:00 · UTC`, `cron 0 8 * * * · UTC`, `manual · on demand`.

---

## 2. Component contract

```tsx
<TriggerScheduleCard
  node={selectedNode}                 // WorkflowNode with kind === "trigger"
  disabled={!canEdit}                 // RBAC / sealed graph
  onChange={(schedule, meta) => {
    // persist onto the node; `meta` is the canvas caption
    patchNode(selectedNode.id, { schedule, meta });
  }}
/>
```

It is fully controlled — it holds no internal state, so swapping the local store
for an API mutation requires changing only the `onChange` body in the two routes.

Current wiring (mock/local store):

```tsx
{selectedNode?.kind === "trigger" && (
  <TriggerScheduleCard
    node={selectedNode}
    onChange={(schedule, meta) =>
      setNodes((ns) => ns.map((n) => (n.id === selectedNode.id ? { ...n, schedule, meta } : n)))
    }
  />
)}
```

---

## 3. REST contract for `api-v2.mjs`

Base: `/api/v2`. `graphKind` is `workflow` or `orchestration`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/graphs/:graphKind/:graphId/schedules` | all trigger schedules of a graph |
| PUT | `/graphs/:graphKind/:graphId/nodes/:nodeId/schedule` | upsert one node's cadence |
| DELETE | `/graphs/:graphKind/:graphId/nodes/:nodeId/schedule` | drop cadence (back to manual) |
| POST | `/schedules/:id/run` | fire now (manual dispatch) |
| GET | `/schedules/:id/runs?limit=50` | run history |
| PATCH | `/schedules/:id` | `{ enabled: boolean }` arm/disarm |

### PUT payload

```json
{
  "nodeLabel": "Daily Trigger",
  "schedule": {
    "mode": "daily",
    "everyMinutes": 15,
    "time": "08:00",
    "weekday": 1,
    "dayOfMonth": 1,
    "cron": "0 8 * * *",
    "timezone": "Europe/Istanbul"
  },
  "summary": "daily 08:00 · Europe/Istanbul"
}
```

### Response

```json
{
  "id": "9f1c…",
  "nodeId": "n1",
  "schedule": { "...": "same shape as above" },
  "summary": "daily 08:00 · Europe/Istanbul",
  "enabled": true,
  "nextRunAt": "2026-08-24T05:00:00.000Z",
  "lastRunAt": null,
  "lastStatus": null
}
```

### Express handler sketch

```js
// api-v2.mjs
app.put('/api/v2/graphs/:graphKind/:graphId/nodes/:nodeId/schedule', auth, async (req, res) => {
  const { graphKind, graphId, nodeId } = req.params;
  const { schedule: s, summary, nodeLabel } = req.body;
  if (!['workflow', 'orchestration'].includes(graphKind)) return res.status(400).json({ error: 'bad graphKind' });

  const { rows } = await pool.query(
    `INSERT INTO trigger_schedules
       (graph_kind, graph_id, node_id, node_label, mode, every_minutes, fire_at,
        weekday, day_of_month, cron_expr, timezone, summary, owner_id, next_run_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (graph_kind, graph_id, node_id) DO UPDATE SET
       node_label=EXCLUDED.node_label, mode=EXCLUDED.mode, every_minutes=EXCLUDED.every_minutes,
       fire_at=EXCLUDED.fire_at, weekday=EXCLUDED.weekday, day_of_month=EXCLUDED.day_of_month,
       cron_expr=EXCLUDED.cron_expr, timezone=EXCLUDED.timezone, summary=EXCLUDED.summary,
       next_run_at=EXCLUDED.next_run_at
     RETURNING *`,
    [graphKind, graphId, nodeId, nodeLabel ?? 'Trigger', s.mode, s.everyMinutes, s.time,
     s.weekday, s.dayOfMonth, s.cron, s.timezone, summary, req.user.id,
     computeNextRun(s)]   // see §5
  );
  res.json(toDto(rows[0]));
});
```

`toDto` maps snake_case columns back into the exact `TriggerSchedule` shape the UI expects —
keep that mapping in one place so the component never changes.

---

## 4. Front-end swap (mock → API)

Add `src/lib/schedule-api.ts`:

```ts
export async function saveNodeSchedule(
  graphKind: "workflow" | "orchestration",
  graphId: string,
  nodeId: string,
  nodeLabel: string,
  schedule: TriggerSchedule,
  summary: string,
) {
  const res = await fetch(
    `/api/v2/graphs/${graphKind}/${graphId}/nodes/${nodeId}/schedule`,
    { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeLabel, schedule, summary }) },
  );
  if (!res.ok) throw new Error("schedule save failed");
  return res.json();
}
```

Then in `orchestration.tsx` / `flows.tsx` replace the local `patchNode` call:

```tsx
onChange={(schedule, meta) => {
  patchNode(selectedNode.id, { schedule, meta });          // optimistic UI
  void saveNodeSchedule(kind, graph.id, selectedNode.id, selectedNode.label, schedule, meta)
    .catch(() => toast.error("Schedule not persisted"));
}}
```

On graph load, merge the API rows back into the nodes:

```ts
nodes = nodes.map((n) => {
  const row = schedules.find((s) => s.nodeId === n.id);
  return row ? { ...n, schedule: row.schedule, meta: row.summary } : n;
});
```

Nothing else in the UI needs to change.

---

## 5. Next-run computation (server side)

Use `luxon` (or `cron-parser` for cron mode) — always evaluate in the stored IANA zone:

```js
import { DateTime } from 'luxon';
import parser from 'cron-parser';

export function computeNextRun(s, from = DateTime.utc()) {
  const zone = s.timezone || 'UTC';
  const now = from.setZone(zone);
  const [h, m] = (s.time || '08:00').split(':').map(Number);
  switch (s.mode) {
    case 'interval': return now.plus({ minutes: s.everyMinutes }).toUTC().toJSDate();
    case 'daily': {
      let t = now.set({ hour: h, minute: m, second: 0, millisecond: 0 });
      if (t <= now) t = t.plus({ days: 1 });
      return t.toUTC().toJSDate();
    }
    case 'weekly': {
      const iso = s.weekday === 0 ? 7 : s.weekday;               // Luxon: 1=Mon..7=Sun
      let t = now.set({ weekday: iso, hour: h, minute: m, second: 0, millisecond: 0 });
      if (t <= now) t = t.plus({ weeks: 1 });
      return t.toUTC().toJSDate();
    }
    case 'monthly': {
      let t = now.set({ day: Math.min(s.dayOfMonth, now.daysInMonth), hour: h, minute: m, second: 0, millisecond: 0 });
      if (t <= now) { const n = now.plus({ months: 1 }); t = n.set({ day: Math.min(s.dayOfMonth, n.daysInMonth), hour: h, minute: m, second: 0, millisecond: 0 }); }
      return t.toUTC().toJSDate();
    }
    case 'cron':
      return parser.parseExpression(s.cron, { tz: zone }).next().toDate();
    default:
      return null;  // manual
  }
}
```

## 6. Worker loop

```js
// every 30s
const { rows } = await pool.query(`
  SELECT * FROM trigger_schedules
   WHERE enabled AND mode <> 'manual' AND next_run_at <= now()
   ORDER BY next_run_at LIMIT 100 FOR UPDATE SKIP LOCKED`);

for (const r of rows) {
  const run = await pool.query(
    `INSERT INTO trigger_runs (schedule_id, graph_kind, graph_id, status)
     VALUES ($1,$2,$3,'running') RETURNING id`, [r.id, r.graph_kind, r.graph_id]);
  await pool.query(
    `UPDATE trigger_schedules SET last_run_at = now(), last_status = 'running', next_run_at = $2
      WHERE id = $1`, [r.id, computeNextRun(fromRow(r))]);
  dispatchGraph(r.graph_kind, r.graph_id, run.rows[0].id);   // your executor
}
```

Run the loop in a single leader process (or wrap with an advisory lock) so a
schedule is never double-fired; `FOR UPDATE SKIP LOCKED` covers concurrent workers.

## 7. Governance notes

- Arming a schedule is a state change — write an `audit_events` row (`trigger.schedule.armed`).
- If the graph is sealed / requires approval, gate `PATCH /schedules/:id { enabled: true }`
  behind the approval queue exactly like workflow publish.
- `owner_id` mirrors the UI ownership plane (`src/lib/ownership.ts`); filter list endpoints by it.

---

## 8. Trigger binding (source plane)

Cadence answers *when*; the binding answers *what feeds it*. Stored on the node as
`binding: TriggerBinding` (`src/mocks/workflows.ts`) and edited in the same inspector card.

```ts
kind: "manual" | "schedule" | "webhook" | "email" | "file"
// webhook: webhookId (adapter from the webhook registry), method, matchPath/matchValue, requireSignature
// email:   mailbox, folder, fromFilter, subjectContains, attachmentsOnly, markRead
// file:    watchPath, glob
```

- `webhook` is event-driven — no cadence is shown; the adapter URL comes from
  `webhookUrl()` in `src/lib/knowledge-store.ts`.
- `email` / `file` are polled — cadence acts as the poll interval.
- Suggested storage: add a `binding jsonb NOT NULL DEFAULT '{}'` column to
  `trigger_schedules`, plus a partial unique index on `(webhook_id)` if a webhook
  adapter may only drive one graph.
- `PUT /graphs/:graphKind/:graphId/nodes/:nodeId/schedule` gains a `binding` field
  in the payload; `toDto` returns it unchanged.
