# Trigger & Output Wiring — UI Model, API Contract, SQL Schema

Everything needed to lift the **trigger source plane** and the **output sink plane** out of the
Sovereign UI and bind them to `api-v2.mjs` + PostgreSQL. Applies identically to both graph kinds:

| Graph kind | Route | Store |
| --- | --- | --- |
| `workflow` | `src/routes/flows.tsx` | `src/lib/workflow-store.ts` |
| `orchestration` | `src/routes/orchestration.tsx` | `src/lib/orchestration-store.ts` |

Components:

- `src/components/sovereign/trigger-schedule-card.tsx` — trigger inspector (source + cadence)
- `src/components/sovereign/output-binding-card.tsx` — output inspector (sink)
- Types: `src/mocks/workflows.ts`
- Cadence-only doc (next-run maths, worker loop): `docs/TRIGGER-SCHEDULER.md`

---

## 1. UI data model

A node carries up to three optional payloads. Only trigger nodes use `schedule`/`binding`,
only output nodes use `sink`.

```ts
// src/mocks/workflows.ts
export type WorkflowNode = {
  id: string;
  kind: "trigger" | "action" | "skill" | "logic" | "output";
  label: string;
  meta: string;          // human caption on the canvas, auto-generated
  x: number; y: number;
  schedule?: TriggerSchedule;   // WHEN
  binding?: TriggerBinding;     // WHAT feeds it
  sink?: OutputBinding;         // WHERE the result lands
};
```

### 1.1 TriggerSchedule (cadence)

```ts
{
  mode: "manual" | "interval" | "daily" | "weekly" | "monthly" | "cron";
  everyMinutes: number;   // interval
  time: string;           // "HH:mm" for daily/weekly/monthly
  weekday: number;        // 0 = Sunday
  dayOfMonth: number;     // 1..31
  cron: string;           // five-field
  timezone: string;       // IANA
}
```

### 1.2 TriggerBinding (source)

```ts
{
  kind: "manual" | "schedule" | "webhook" | "email" | "file";

  // webhook (event-driven, cadence hidden in the UI)
  webhookId: string;            // adapter id from the webhook registry
  method: "ANY" | "POST" | "PUT" | "GET";
  matchPath: string;            // dotted payload path, e.g. "event.type"
  matchValue: string;           // required value at matchPath
  requireSignature: boolean;

  // email (polled — cadence acts as poll interval)
  mailbox: string;              // ops@sovereign.local
  folder: string;               // INBOX, INBOX/Alerts…
  fromFilter: string;           // "*@partner.com"
  subjectContains: string;      // "[INCIDENT]"
  attachmentsOnly: boolean;
  markRead: boolean;

  // file drop (polled)
  watchPath: string;            // /var/sovereign/inbox
  glob: string;                 // *.csv
}
```

Adapters come from `useKnowledge().webhooks` (`src/lib/knowledge-store.ts`); the public URL is
`webhookUrl(adapter)` → `${bridgeHost}/api/webhooks/${slug}` unless the adapter has a `urlOverride`.

### 1.3 OutputBinding (sink)

```ts
{
  kind: "report" | "email" | "webhook" | "database" | "syslog" | "alarm" | "file";
  onFailure: "halt" | "continue" | "retry";
  retries: number;

  // report
  format: "markdown" | "pdf" | "html" | "json";
  templateId: string;           // reportTemplates ids: executive | usage | cost | operator-roster | operator-detail
  includeCitations: boolean;

  // email
  to: string; cc: string; subject: string; attachArtifact: boolean;

  // webhook push
  webhookId: string; method: "POST" | "PUT" | "PATCH"; urlOverride: string;

  // database
  table: string; writeMode: "insert" | "upsert"; conflictKey: string;

  // syslog
  syslogHost: string; syslogPort: number; facility: string;
  severity: "debug" | "info" | "notice" | "warning" | "error" | "critical";

  // alarm
  channel: "bell" | "siem" | "both";

  // file drop
  path: string; filename: string;   // "{workflow}-{run}.md"
}
```

Placeholders substituted by the executor: `{workflow}`, `{run}`, `{node}`, `{ts}`.

---

## 2. Component contracts

Both cards are fully controlled — no internal state beyond the copy-button flash.

```tsx
{selectedNode?.kind === "trigger" && (
  <TriggerScheduleCard
    node={selectedNode}
    disabled={!canvasWritable}
    onChange={(schedule, meta, binding) =>
      patch((d) => ({
        nodes: d.nodes.map((n) =>
          n.id === selectedNode.id ? { ...n, schedule, meta, binding } : n),
      }))
    }
  />
)}

{selectedNode?.kind === "output" && (
  <OutputBindingCard
    node={selectedNode}
    disabled={!canvasWritable}
    onChange={(sink, meta) =>
      patch((d) => ({
        nodes: d.nodes.map((n) => (n.id === selectedNode.id ? { ...n, sink, meta } : n)),
      }))
    }
  />
)}
```

Helpers exported for reuse (validation, server-side captions):

```ts
import { defaultSchedule, defaultBinding, inferSourceKind, cadenceSummary, triggerSummary }
  from "@/components/sovereign/trigger-schedule-card";
import { defaultSink, inferSinkKind, sinkSummary }
  from "@/components/sovereign/output-binding-card";
```

`inferSourceKind(label)` / `inferSinkKind(label)` self-heal legacy nodes that have no payload
(e.g. a node called "Webhook Trigger" resolves to `kind: "webhook"`).

---

## 3. REST contract (`api-v2.mjs`)

Base `/api/v2`. `graphKind ∈ { workflow, orchestration }`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/graphs/:graphKind/:graphId/nodes/:nodeId/binding` | read trigger schedule + binding |
| PUT | `/graphs/:graphKind/:graphId/nodes/:nodeId/binding` | upsert trigger schedule + binding |
| DELETE | `/graphs/:graphKind/:graphId/nodes/:nodeId/binding` | reset to manual |
| GET | `/graphs/:graphKind/:graphId/nodes/:nodeId/sink` | read output sink |
| PUT | `/graphs/:graphKind/:graphId/nodes/:nodeId/sink` | upsert output sink |
| DELETE | `/graphs/:graphKind/:graphId/nodes/:nodeId/sink` | remove sink |
| POST | `/schedules/:id/run` | fire now |
| PATCH | `/schedules/:id` | `{ enabled: boolean }` arm / disarm |
| GET | `/schedules/:id/runs?limit=50` | run history |
| GET | `/sinks/:id/deliveries?limit=50` | delivery history |
| POST | `/sinks/:id/test` | send a probe payload through the sink |
| POST | `/hooks/:slug` | **inbound** webhook entry — dispatches every armed webhook trigger bound to that adapter |

### 3.1 PUT trigger binding

```json
{
  "nodeLabel": "Sev-1 Webhook",
  "schedule": { "mode": "manual", "everyMinutes": 15, "time": "08:00", "weekday": 1,
                "dayOfMonth": 1, "cron": "0 8 * * *", "timezone": "UTC" },
  "binding": { "kind": "webhook", "webhookId": "wh_pagerduty", "method": "POST",
               "matchPath": "event.type", "matchValue": "incident.opened",
               "requireSignature": true },
  "summary": "webhook · PagerDuty · event.type=incident.opened"
}
```

Response adds `id`, `enabled`, `nextRunAt` (null for event-driven kinds), `lastRunAt`, `lastStatus`.

### 3.2 PUT output sink

```json
{
  "nodeLabel": "Executive Digest",
  "sink": { "kind": "email", "onFailure": "retry", "retries": 3,
            "to": "board@sovereign.local", "cc": "", "subject": "[ELARA] {workflow} run {run}",
            "attachArtifact": true, "format": "pdf", "templateId": "executive" },
  "summary": "mail · board@sovereign.local"
}
```

### 3.3 Handler sketch

```js
app.put('/api/v2/graphs/:graphKind/:graphId/nodes/:nodeId/binding', auth, async (req, res) => {
  const { graphKind, graphId, nodeId } = req.params;
  const { schedule: s, binding: b, summary, nodeLabel } = req.body;
  if (!['workflow', 'orchestration'].includes(graphKind))
    return res.status(400).json({ error: 'bad graphKind' });

  const eventDriven = b.kind === 'webhook' || b.kind === 'manual';
  const { rows } = await pool.query(
    `INSERT INTO trigger_schedules
       (graph_kind, graph_id, node_id, node_label, mode, every_minutes, fire_at, weekday,
        day_of_month, cron_expr, timezone, source_kind, binding, summary, owner_id, next_run_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (graph_kind, graph_id, node_id) DO UPDATE SET
       node_label=EXCLUDED.node_label, mode=EXCLUDED.mode, every_minutes=EXCLUDED.every_minutes,
       fire_at=EXCLUDED.fire_at, weekday=EXCLUDED.weekday, day_of_month=EXCLUDED.day_of_month,
       cron_expr=EXCLUDED.cron_expr, timezone=EXCLUDED.timezone,
       source_kind=EXCLUDED.source_kind, binding=EXCLUDED.binding,
       summary=EXCLUDED.summary, next_run_at=EXCLUDED.next_run_at
     RETURNING *`,
    [graphKind, graphId, nodeId, nodeLabel ?? 'Trigger', s.mode, s.everyMinutes, s.time,
     s.weekday, s.dayOfMonth, s.cron, s.timezone, b.kind, b, summary, req.user.id,
     eventDriven ? null : computeNextRun(s)],   // computeNextRun → docs/TRIGGER-SCHEDULER.md §5
  );
  res.json(toTriggerDto(rows[0]));
});

// inbound webhook fan-out
app.all('/api/v2/hooks/:slug', async (req, res) => {
  const hook = await getAdapterBySlug(req.params.slug);
  if (!hook?.enabled) return res.status(404).end();

  const { rows } = await pool.query(
    `SELECT * FROM trigger_schedules
      WHERE enabled AND source_kind = 'webhook' AND binding->>'webhookId' = $1`, [hook.id]);

  for (const r of rows) {
    const b = r.binding;
    if (b.method !== 'ANY' && b.method !== req.method) continue;
    if (b.requireSignature && !verifySignature(req, hook.secret)) continue;
    if (b.matchPath && get(req.body, b.matchPath) !== b.matchValue) continue;
    await dispatchGraph(r.graph_kind, r.graph_id, { trigger: r.node_id, payload: req.body });
  }
  res.json({ accepted: rows.length });
});
```

`toTriggerDto` / `toSinkDto` map snake_case columns back into the exact shapes above — keep those
two functions as the single mapping point so the UI never changes.

### 3.4 Poll workers

- **Cadence worker** (30 s tick): `docs/TRIGGER-SCHEDULER.md` §6, unchanged, but skip rows where
  `source_kind IN ('webhook','manual')`.
- **Mail reader**: for rows with `source_kind = 'email'` whose `next_run_at <= now()`, connect over
  IMAP to `binding->>'mailbox'`, `SEARCH UNSEEN` in `binding->>'folder'`, apply `fromFilter`,
  `subjectContains`, `attachmentsOnly`; dispatch one run per message; honour `markRead`.
- **File watcher**: for `source_kind = 'file'`, list `watchPath` matching `glob`, dispatch per new
  file (dedupe by `sha256`, stored in `trigger_seen_keys`).

### 3.5 Sink delivery

The executor, after the final node of a branch, resolves `output_sinks` for that node and writes
one `sink_deliveries` row per attempt. `on_failure = retry` re-queues up to `retries` with
exponential backoff; `halt` marks the run failed; `continue` records the error and proceeds.

---

## 4. SQL schema

```sql
-- ── trigger plane ────────────────────────────────────────────────────────────
CREATE TYPE trigger_source_kind AS ENUM ('manual','schedule','webhook','email','file');
CREATE TYPE trigger_mode        AS ENUM ('manual','interval','daily','weekly','monthly','cron');

CREATE TABLE IF NOT EXISTS trigger_schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_kind    text NOT NULL CHECK (graph_kind IN ('workflow','orchestration')),
  graph_id      uuid NOT NULL,
  node_id       text NOT NULL,
  node_label    text NOT NULL DEFAULT 'Trigger',

  -- cadence
  mode          trigger_mode NOT NULL DEFAULT 'manual',
  every_minutes int  NOT NULL DEFAULT 15 CHECK (every_minutes BETWEEN 1 AND 1440),
  fire_at       text NOT NULL DEFAULT '08:00',
  weekday       int  NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 0 AND 6),
  day_of_month  int  NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 31),
  cron_expr     text NOT NULL DEFAULT '0 8 * * *',
  timezone      text NOT NULL DEFAULT 'UTC',

  -- source
  source_kind   trigger_source_kind NOT NULL DEFAULT 'manual',
  binding       jsonb NOT NULL DEFAULT '{}'::jsonb,

  summary       text,
  enabled       boolean NOT NULL DEFAULT true,
  owner_id      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  next_run_at   timestamptz,
  last_run_at   timestamptz,
  last_status   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (graph_kind, graph_id, node_id)
);

CREATE INDEX IF NOT EXISTS trigger_schedules_due_idx
  ON trigger_schedules (next_run_at)
  WHERE enabled AND source_kind IN ('schedule','email','file');

CREATE INDEX IF NOT EXISTS trigger_schedules_hook_idx
  ON trigger_schedules ((binding->>'webhookId'))
  WHERE source_kind = 'webhook';

CREATE TABLE IF NOT EXISTS trigger_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  uuid NOT NULL REFERENCES trigger_schedules(id) ON DELETE CASCADE,
  graph_kind   text NOT NULL,
  graph_id     uuid NOT NULL,
  status       text NOT NULL DEFAULT 'running',   -- running | ok | failed | skipped
  source_kind  trigger_source_kind,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb, -- webhook body / mail headers / file meta
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS trigger_runs_schedule_idx ON trigger_runs (schedule_id, started_at DESC);

-- dedupe for mail/file pollers (message-id, file sha256)
CREATE TABLE IF NOT EXISTS trigger_seen_keys (
  schedule_id uuid NOT NULL REFERENCES trigger_schedules(id) ON DELETE CASCADE,
  seen_key    text NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_id, seen_key)
);

-- ── output plane ─────────────────────────────────────────────────────────────
CREATE TYPE output_sink_kind AS ENUM
  ('report','email','webhook','database','syslog','alarm','file');

CREATE TABLE IF NOT EXISTS output_sinks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_kind  text NOT NULL CHECK (graph_kind IN ('workflow','orchestration')),
  graph_id    uuid NOT NULL,
  node_id     text NOT NULL,
  node_label  text NOT NULL DEFAULT 'Output',

  kind        output_sink_kind NOT NULL DEFAULT 'report',
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- kind-specific fields (see §1.3)
  on_failure  text NOT NULL DEFAULT 'halt' CHECK (on_failure IN ('halt','continue','retry')),
  retries     int  NOT NULL DEFAULT 2 CHECK (retries BETWEEN 0 AND 10),

  summary     text,
  enabled     boolean NOT NULL DEFAULT true,
  owner_id    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (graph_kind, graph_id, node_id)
);

CREATE INDEX IF NOT EXISTS output_sinks_graph_idx ON output_sinks (graph_kind, graph_id);
CREATE INDEX IF NOT EXISTS output_sinks_hook_idx
  ON output_sinks ((config->>'webhookId')) WHERE kind = 'webhook';

CREATE TABLE IF NOT EXISTS sink_deliveries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sink_id     uuid NOT NULL REFERENCES output_sinks(id) ON DELETE CASCADE,
  run_id      uuid,                                  -- trigger_runs.id when scheduler-driven
  attempt     int  NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'pending',       -- pending | ok | failed | skipped
  target      text,                                  -- resolved URL / address / table
  artifact_id uuid,                                  -- FK to your artifacts table when rendered
  response    jsonb NOT NULL DEFAULT '{}'::jsonb,
  error       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS sink_deliveries_sink_idx ON sink_deliveries (sink_id, started_at DESC);

-- generic artifact landing table used by the `database` sink default
CREATE TABLE IF NOT EXISTS workflow_outputs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_kind text NOT NULL,
  graph_id   uuid NOT NULL,
  node_id    text NOT NULL,
  run_id     uuid,
  body       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at triggers (reuse the helper from db/v2_master_schema.sql)
CREATE TRIGGER trg_trigger_schedules_updated BEFORE UPDATE ON trigger_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_output_sinks_updated BEFORE UPDATE ON output_sinks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Graph FKs: if `workflows` and `orchestrations` are separate tables, keep `graph_id` untyped as
above (polymorphic) and enforce existence in the API layer, or add two nullable FK columns
(`workflow_id`, `orchestration_id`) with a `CHECK (num_nonnulls(workflow_id, orchestration_id) = 1)`.

---

## 5. Front-end swap (mock → API)

Add `src/lib/graph-binding-api.ts`:

```ts
import type { OutputBinding, TriggerBinding, TriggerSchedule } from "@/mocks/workflows";

type Kind = "workflow" | "orchestration";
const base = (k: Kind, g: string, n: string) => `/api/v2/graphs/${k}/${g}/nodes/${n}`;

export async function saveTriggerBinding(
  k: Kind, graphId: string, nodeId: string, nodeLabel: string,
  schedule: TriggerSchedule, binding: TriggerBinding, summary: string,
) {
  const res = await fetch(`${base(k, graphId, nodeId)}/binding`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeLabel, schedule, binding, summary }),
  });
  if (!res.ok) throw new Error("trigger binding save failed");
  return res.json();
}

export async function saveOutputSink(
  k: Kind, graphId: string, nodeId: string, nodeLabel: string,
  sink: OutputBinding, summary: string,
) {
  const res = await fetch(`${base(k, graphId, nodeId)}/sink`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeLabel, sink, summary }),
  });
  if (!res.ok) throw new Error("sink save failed");
  return res.json();
}
```

Then only the two `onChange` bodies change (optimistic local patch + fire-and-forget persist):

```tsx
onChange={(schedule, meta, binding) => {
  patch((d) => ({ nodes: d.nodes.map((n) =>
    n.id === selectedNode.id ? { ...n, schedule, meta, binding } : n) }));
  void saveTriggerBinding("workflow", active.id, selectedNode.id, selectedNode.label,
    schedule, binding, meta).catch(() => toast.error("Trigger not persisted"));
}}
```

On graph load, merge server rows back onto the nodes:

```ts
nodes = nodes.map((n) => {
  const t = triggers.find((r) => r.nodeId === n.id);
  const s = sinks.find((r) => r.nodeId === n.id);
  return { ...n,
    ...(t ? { schedule: t.schedule, binding: t.binding, meta: t.summary } : {}),
    ...(s ? { sink: s.sink, meta: s.summary } : {}) };
});
```

Nothing else in the UI changes.

---

## 6. Governance notes

- Arming a trigger or enabling a sink is a state change → write an `audit_events` row
  (`trigger.binding.armed`, `sink.enabled`), mirroring the workflow publish flow.
- Sinks that leave the perimeter (`webhook`, `email`, `syslog`, `file`) should be gated by the
  approval queue when the graph is sealed — same gate as `PATCH /schedules/:id { enabled: true }`.
- Webhook secrets stay in the vault; `binding.webhookId` / `config.webhookId` only reference the
  adapter row — never store the raw secret on the node.
- `owner_id` mirrors the UI ownership plane (`src/lib/ownership.ts`); filter every list endpoint
  by desk visibility.
