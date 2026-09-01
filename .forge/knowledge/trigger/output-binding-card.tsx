import { useState } from "react";
import {
  AlarmClock,
  Check,
  Copy,
  Database,
  FileOutput,
  FileText,
  Mail,
  Radio,
  Send,
} from "lucide-react";
import { useKnowledge, webhookUrl } from "@/lib/knowledge-store";
import { reportTemplates } from "@/lib/report-templates";
import type { OutputBinding, OutputSinkKind, WorkflowNode } from "@/mocks/workflows";

/**
 * Sink inspector for a selected output node.
 * Answers WHERE the branch result lands (report, mail, webhook push, database,
 * syslog, alarm, file drop) and keeps the canvas caption in sync.
 */

export const defaultSink: OutputBinding = {
  kind: "report",
  onFailure: "halt",
  retries: 2,
  format: "markdown",
  templateId: "executive",
  includeCitations: true,
  to: "",
  cc: "",
  subject: "",
  attachArtifact: true,
  webhookId: "",
  method: "POST",
  urlOverride: "",
  table: "workflow_outputs",
  writeMode: "insert",
  conflictKey: "id",
  syslogHost: "",
  syslogPort: 514,
  facility: "local0",
  severity: "info",
  channel: "bell",
  path: "/var/sovereign/outbox",
  filename: "{workflow}-{run}.md",
};

/** Guess the sink from a node label so existing canvases self-heal. */
export function inferSinkKind(label: string): OutputSinkKind {
  const l = label.toLowerCase();
  if (l.includes("mail")) return "email";
  if (l.includes("webhook") || l.includes("push")) return "webhook";
  if (l.includes("sql") || l.includes("database") || l.includes("postgres")) return "database";
  if (l.includes("syslog")) return "syslog";
  if (l.includes("alarm") || l.includes("alert")) return "alarm";
  if (l.includes("file") || l.includes("artifact") || l.includes("drop")) return "file";
  return "report";
}

export function sinkSummary(b: OutputBinding, webhookLabel?: string): string {
  switch (b.kind) {
    case "email":
      return `mail · ${b.to || "no recipient"}`;
    case "webhook":
      return `push · ${webhookLabel || b.urlOverride || "unbound"} · ${b.method}`;
    case "database":
      return `db · ${b.table} · ${b.writeMode}`;
    case "syslog":
      return `syslog · ${b.syslogHost || "unbound"}:${b.syslogPort} · ${b.severity}`;
    case "alarm":
      return `alarm · ${b.channel}`;
    case "file":
      return `file · ${b.path}/${b.filename}`;
    default:
      return `report · ${b.format} · ${b.templateId}`;
  }
}

const field =
  "w-full rounded-lg border border-border/70 bg-raised/40 px-2.5 py-1.5 font-mono text-[12px] text-foreground/90 outline-none transition-colors focus:border-emerald/50";

const kindIcon: Record<OutputSinkKind, typeof Radio> = {
  report: FileText,
  email: Mail,
  webhook: Send,
  database: Database,
  syslog: Radio,
  alarm: AlarmClock,
  file: FileOutput,
};

export function OutputBindingCard({
  node,
  disabled,
  onChange,
}: {
  node: WorkflowNode;
  disabled?: boolean;
  onChange: (sink: OutputBinding, meta: string) => void;
}) {
  const k = useKnowledge();
  const [copied, setCopied] = useState(false);

  const b: OutputBinding = {
    ...defaultSink,
    kind: inferSinkKind(node.label),
    ...(node.sink ?? {}),
  };
  const hook = k.webhooks.find((w) => w.id === b.webhookId);
  const set = (patch: Partial<OutputBinding>) => {
    const next = { ...b, ...patch };
    onChange(next, sinkSummary(next, k.webhooks.find((w) => w.id === next.webhookId)?.label));
  };

  const Icon = kindIcon[b.kind];
  const url = b.urlOverride || (hook ? webhookUrl(hook) : "");

  return (
    <div className="rounded-xl border border-emerald/30 bg-emerald/[0.06] p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-emerald" strokeWidth={1.7} />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-emerald">
          Output sink
        </span>
      </div>
      <p className="mb-2.5 truncate font-mono text-[11.5px] text-foreground/80" title={node.label}>
        {node.label}
      </p>

      <fieldset disabled={disabled} className="space-y-2 disabled:opacity-50">
        <label className="block">
          <span className="mono-label">Sink</span>
          <select
            value={b.kind}
            onChange={(e) => set({ kind: e.target.value as OutputSinkKind })}
            className={field}
            title="Where the branch result is delivered"
          >
            <option value="report" className="bg-panel">
              Report · rendered artifact
            </option>
            <option value="email" className="bg-panel">
              Email · SMTP delivery
            </option>
            <option value="webhook" className="bg-panel">
              Webhook · outbound push
            </option>
            <option value="database" className="bg-panel">
              Database · PostgreSQL write
            </option>
            <option value="syslog" className="bg-panel">
              Syslog · forwarder
            </option>
            <option value="alarm" className="bg-panel">
              Alarm · operator attention
            </option>
            <option value="file" className="bg-panel">
              File · artifact drop
            </option>
          </select>
        </label>

        {b.kind === "report" && (
          <>
            <label className="block">
              <span className="mono-label">Template</span>
              <select
                value={b.templateId}
                onChange={(e) => set({ templateId: e.target.value })}
                className={field}
                title="Report template used to render the artifact"
              >
                {reportTemplates.map((t) => (
                  <option key={t.id} value={t.id} className="bg-panel">
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mono-label">Format</span>
              <select
                value={b.format}
                onChange={(e) => set({ format: e.target.value as OutputBinding["format"] })}
                className={field}
                title="Artifact format"
              >
                {(["markdown", "pdf", "html", "json"] as const).map((f) => (
                  <option key={f} value={f} className="bg-panel">
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={b.includeCitations}
                onChange={(e) => set({ includeCitations: e.target.checked })}
                className="accent-emerald"
                title="Append retrieval citations to the artifact"
              />
              <span className="font-mono text-[11px] text-foreground/75">include citations</span>
            </label>
          </>
        )}

        {b.kind === "email" && (
          <>
            <label className="block">
              <span className="mono-label">To</span>
              <input
                value={b.to}
                onChange={(e) => set({ to: e.target.value })}
                placeholder="ops@sovereign.local"
                className={field}
                title="Recipient addresses, comma separated"
              />
            </label>
            <label className="block">
              <span className="mono-label">Cc</span>
              <input
                value={b.cc}
                onChange={(e) => set({ cc: e.target.value })}
                placeholder="optional"
                className={field}
                title="Carbon copy addresses, comma separated"
              />
            </label>
            <label className="block">
              <span className="mono-label">Subject</span>
              <input
                value={b.subject}
                onChange={(e) => set({ subject: e.target.value })}
                placeholder="[ELARA] {workflow} run {run}"
                className={field}
                title="Subject line; {workflow} and {run} are substituted"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={b.attachArtifact}
                onChange={(e) => set({ attachArtifact: e.target.checked })}
                className="accent-emerald"
                title="Attach the rendered artifact to the message"
              />
              <span className="font-mono text-[11px] text-foreground/75">attach artifact</span>
            </label>
          </>
        )}

        {b.kind === "webhook" && (
          <>
            <label className="block">
              <span className="mono-label">Adapter</span>
              <select
                value={b.webhookId}
                onChange={(e) => set({ webhookId: e.target.value })}
                className={field}
                title="Registered webhook adapter used for the push"
              >
                <option value="" className="bg-panel">
                  — select adapter —
                </option>
                {k.webhooks.map((w) => (
                  <option key={w.id} value={w.id} className="bg-panel">
                    {w.label}
                    {w.enabled ? "" : " (off)"}
                  </option>
                ))}
              </select>
            </label>
            {url && (
              <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-raised/30 px-2 py-1.5">
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-emerald">
                  {url}
                </code>
                <button
                  type="button"
                  title="Copy target URL"
                  aria-label="Copy target URL"
                  onClick={() => {
                    navigator.clipboard?.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  }}
                  className="rounded p-1 text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  {copied ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
                </button>
              </div>
            )}
            <label className="block">
              <span className="mono-label">URL override</span>
              <input
                value={b.urlOverride}
                onChange={(e) => set({ urlOverride: e.target.value })}
                placeholder="https://…"
                className={field}
                title="Override the adapter URL for this node only"
              />
            </label>
            <label className="block">
              <span className="mono-label">Method</span>
              <select
                value={b.method}
                onChange={(e) => set({ method: e.target.value as OutputBinding["method"] })}
                className={field}
                title="HTTP method used for the push"
              >
                {(["POST", "PUT", "PATCH"] as const).map((m) => (
                  <option key={m} value={m} className="bg-panel">
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {b.kind === "database" && (
          <>
            <label className="block">
              <span className="mono-label">Table</span>
              <input
                value={b.table}
                onChange={(e) => set({ table: e.target.value })}
                placeholder="workflow_outputs"
                className={field}
                title="Destination table"
              />
            </label>
            <label className="block">
              <span className="mono-label">Write mode</span>
              <select
                value={b.writeMode}
                onChange={(e) => set({ writeMode: e.target.value as OutputBinding["writeMode"] })}
                className={field}
                title="Insert new rows or upsert on the conflict key"
              >
                <option value="insert" className="bg-panel">
                  insert
                </option>
                <option value="upsert" className="bg-panel">
                  upsert
                </option>
              </select>
            </label>
            {b.writeMode === "upsert" && (
              <label className="block">
                <span className="mono-label">Conflict key</span>
                <input
                  value={b.conflictKey}
                  onChange={(e) => set({ conflictKey: e.target.value })}
                  placeholder="id"
                  className={field}
                  title="Column used for ON CONFLICT resolution"
                />
              </label>
            )}
          </>
        )}

        {b.kind === "syslog" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mono-label">Host</span>
                <input
                  value={b.syslogHost}
                  onChange={(e) => set({ syslogHost: e.target.value })}
                  placeholder="siem.local"
                  className={field}
                  title="Syslog collector host"
                />
              </label>
              <label className="block">
                <span className="mono-label">Port</span>
                <input
                  type="number"
                  value={b.syslogPort}
                  onChange={(e) => set({ syslogPort: Number(e.target.value) || 514 })}
                  className={field}
                  title="Syslog collector port"
                />
              </label>
            </div>
            <label className="block">
              <span className="mono-label">Facility</span>
              <input
                value={b.facility}
                onChange={(e) => set({ facility: e.target.value })}
                placeholder="local0"
                className={field}
                title="Syslog facility"
              />
            </label>
            <label className="block">
              <span className="mono-label">Severity</span>
              <select
                value={b.severity}
                onChange={(e) => set({ severity: e.target.value as OutputBinding["severity"] })}
                className={field}
                title="Severity stamped on the emitted record"
              >
                {(["debug", "info", "notice", "warning", "error", "critical"] as const).map((v) => (
                  <option key={v} value={v} className="bg-panel">
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {b.kind === "alarm" && (
          <>
            <label className="block">
              <span className="mono-label">Channel</span>
              <select
                value={b.channel}
                onChange={(e) => set({ channel: e.target.value as OutputBinding["channel"] })}
                className={field}
                title="Where the alarm is raised"
              >
                <option value="bell" className="bg-panel">
                  Attention bell
                </option>
                <option value="siem" className="bg-panel">
                  SIEM stream
                </option>
                <option value="both" className="bg-panel">
                  Bell + SIEM
                </option>
              </select>
            </label>
            <label className="block">
              <span className="mono-label">Severity</span>
              <select
                value={b.severity}
                onChange={(e) => set({ severity: e.target.value as OutputBinding["severity"] })}
                className={field}
                title="Severity of the raised alarm"
              >
                {(["info", "notice", "warning", "error", "critical"] as const).map((v) => (
                  <option key={v} value={v} className="bg-panel">
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {b.kind === "file" && (
          <>
            <label className="block">
              <span className="mono-label">Path</span>
              <input
                value={b.path}
                onChange={(e) => set({ path: e.target.value })}
                placeholder="/var/sovereign/outbox"
                className={field}
                title="Directory the artifact is written to"
              />
            </label>
            <label className="block">
              <span className="mono-label">Filename</span>
              <input
                value={b.filename}
                onChange={(e) => set({ filename: e.target.value })}
                placeholder="{workflow}-{run}.md"
                className={field}
                title="Filename pattern; {workflow} and {run} are substituted"
              />
            </label>
          </>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1.5">
          <label className="block">
            <span className="mono-label">On failure</span>
            <select
              value={b.onFailure}
              onChange={(e) => set({ onFailure: e.target.value as OutputBinding["onFailure"] })}
              className={field}
              title="What the run does when this sink errors"
            >
              <option value="halt" className="bg-panel">
                halt run
              </option>
              <option value="continue" className="bg-panel">
                continue
              </option>
              <option value="retry" className="bg-panel">
                retry
              </option>
            </select>
          </label>
          <label className="block">
            <span className="mono-label">Retries</span>
            <input
              type="number"
              min={0}
              max={10}
              value={b.retries}
              onChange={(e) => set({ retries: Math.max(0, Number(e.target.value) || 0) })}
              className={field}
              title="Delivery attempts before the sink is marked failed"
            />
          </label>
        </div>
      </fieldset>

      {b.kind === "email" && !b.to && (
        <p className="mt-2.5 font-mono text-[10.5px] tracking-[0.06em] text-topaz">
          no recipient bound · delivery will be skipped
        </p>
      )}
      {b.kind === "webhook" && !b.webhookId && !b.urlOverride && (
        <p className="mt-2.5 font-mono text-[10.5px] tracking-[0.06em] text-topaz">
          no target bound · configure adapters on the Adapters page
        </p>
      )}

      <p className="mt-2.5 font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground/50">
        {sinkSummary(b, hook?.label)}
      </p>
    </div>
  );
}
