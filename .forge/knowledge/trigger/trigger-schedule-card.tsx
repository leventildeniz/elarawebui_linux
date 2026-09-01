import { CalendarClock, Link2, Mail, Radio, FolderInput, Copy, Check } from "lucide-react";
import { useState } from "react";
import { TIMEZONES } from "@/lib/mail-store";
import { useKnowledge, webhookUrl } from "@/lib/knowledge-store";
import type {
  TriggerBinding,
  TriggerSchedule,
  TriggerSourceKind,
  WorkflowNode,
} from "@/mocks/workflows";

/**
 * Trigger inspector for a selected trigger node.
 * Two planes: WHAT feeds it (binding — webhook adapter, mailbox, watched path)
 * and WHEN it fires (cadence). Both are written onto the node and `meta` is
 * kept in sync so the canvas card shows the human-readable summary.
 */

export const defaultSchedule: TriggerSchedule = {
  mode: "manual",
  everyMinutes: 15,
  time: "08:00",
  weekday: 1,
  dayOfMonth: 1,
  cron: "0 8 * * *",
  timezone: "UTC",
};

export const defaultBinding: TriggerBinding = {
  kind: "manual",
  webhookId: "",
  method: "POST",
  matchPath: "",
  matchValue: "",
  requireSignature: true,
  mailbox: "",
  folder: "INBOX",
  fromFilter: "",
  subjectContains: "",
  attachmentsOnly: false,
  markRead: true,
  watchPath: "/var/sovereign/inbox",
  glob: "*.*",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MAIL_FOLDERS = ["INBOX", "INBOX/Alerts", "INBOX/Reports", "Archive", "Junk"];

/** Guess the inbound plane from a node label so existing canvases self-heal. */
export function inferSourceKind(label: string): TriggerSourceKind {
  const l = label.toLowerCase();
  if (l.includes("webhook") || l.includes("hook")) return "webhook";
  if (l.includes("mail") || l.includes("email") || l.includes("imap")) return "email";
  if (l.includes("file") || l.includes("drop") || l.includes("watch")) return "file";
  if (l.includes("cron") || l.includes("schedule") || l.includes("timer")) return "schedule";
  return "manual";
}

export function cadenceSummary(s: TriggerSchedule): string {
  const tz = s.timezone || "UTC";
  switch (s.mode) {
    case "interval":
      return `every ${s.everyMinutes}m · ${tz}`;
    case "daily":
      return `daily ${s.time} · ${tz}`;
    case "weekly":
      return `${WEEKDAYS[s.weekday] ?? "Monday"} ${s.time} · ${tz}`;
    case "monthly":
      return `day ${s.dayOfMonth} · ${s.time} · ${tz}`;
    case "cron":
      return `cron ${s.cron} · ${tz}`;
    default:
      return "on demand";
  }
}

/** Human caption shown under the node on the canvas. */
export function triggerSummary(
  s: TriggerSchedule,
  b: TriggerBinding,
  webhookLabel?: string,
): string {
  switch (b.kind) {
    case "webhook":
      return `webhook · ${webhookLabel || b.webhookId || "unbound"}${
        b.matchPath ? ` · ${b.matchPath}=${b.matchValue}` : ""
      }`;
    case "email":
      return `mail · ${b.mailbox || "unbound"}/${b.folder} · ${cadenceSummary(s)}`;
    case "file":
      return `watch · ${b.watchPath}/${b.glob} · ${cadenceSummary(s)}`;
    case "schedule":
      return cadenceSummary(s);
    default:
      return "manual · on demand";
  }
}

/** Back-compat export used by earlier wiring. */
export const scheduleSummary = cadenceSummary;

const field =
  "w-full rounded-lg border border-border/70 bg-raised/40 px-2.5 py-1.5 font-mono text-[12px] text-foreground/90 outline-none transition-colors focus:border-sapphire/50";

const kindIcon: Record<TriggerSourceKind, typeof Radio> = {
  manual: Radio,
  webhook: Link2,
  email: Mail,
  file: FolderInput,
  schedule: CalendarClock,
};

export function TriggerScheduleCard({
  node,
  disabled,
  onChange,
}: {
  node: WorkflowNode;
  disabled?: boolean;
  onChange: (schedule: TriggerSchedule, meta: string, binding: TriggerBinding) => void;
}) {
  const k = useKnowledge();
  const [copied, setCopied] = useState(false);

  const s: TriggerSchedule = { ...defaultSchedule, ...(node.schedule ?? {}) };
  const b: TriggerBinding = {
    ...defaultBinding,
    kind: inferSourceKind(node.label),
    ...(node.binding ?? {}),
  };

  const hook = k.webhooks.find((w) => w.id === b.webhookId);
  const emit = (nextS: TriggerSchedule, nextB: TriggerBinding) => {
    const label = k.webhooks.find((w) => w.id === nextB.webhookId)?.label;
    onChange(nextS, triggerSummary(nextS, nextB, label), nextB);
  };
  const set = (patch: Partial<TriggerSchedule>) => emit({ ...s, ...patch }, b);
  const bind = (patch: Partial<TriggerBinding>) => emit(s, { ...b, ...patch });

  const Icon = kindIcon[b.kind];
  const showCadence = b.kind === "schedule" || b.kind === "email" || b.kind === "file";
  const url = hook ? webhookUrl(hook) : "";

  return (
    <div className="rounded-xl border border-sapphire/30 bg-sapphire/[0.06] p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-sapphire" strokeWidth={1.7} />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-sapphire">
          Trigger source
        </span>
      </div>
      <p className="mb-2.5 truncate font-mono text-[11.5px] text-foreground/80" title={node.label}>
        {node.label}
      </p>

      <fieldset disabled={disabled} className="space-y-2 disabled:opacity-50">
        <label className="block">
          <span className="mono-label">Inbound plane</span>
          <select
            value={b.kind}
            onChange={(e) => bind({ kind: e.target.value as TriggerSourceKind })}
            className={field}
            title="What actually feeds this trigger"
          >
            <option value="manual" className="bg-panel">
              Manual · operator dispatch
            </option>
            <option value="schedule" className="bg-panel">
              Schedule · timer / cron
            </option>
            <option value="webhook" className="bg-panel">
              Webhook · inbound HTTP
            </option>
            <option value="email" className="bg-panel">
              Email · mailbox reader
            </option>
            <option value="file" className="bg-panel">
              File drop · watched path
            </option>
          </select>
        </label>

        {/* ── webhook binding ─────────────────────────────────────── */}
        {b.kind === "webhook" && (
          <>
            <label className="block">
              <span className="mono-label">Webhook adapter</span>
              <select
                value={b.webhookId}
                onChange={(e) => bind({ webhookId: e.target.value })}
                className={field}
                title="Which registered webhook adapter fires this trigger"
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

            {hook && (
              <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-raised/30 px-2 py-1.5">
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-sapphire">
                  {url}
                </code>
                <button
                  type="button"
                  title="Copy webhook URL"
                  aria-label="Copy webhook URL"
                  onClick={() => {
                    navigator.clipboard?.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  }}
                  className="rounded p-1 text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  {copied ? (
                    <Check size={12} className="text-emerald" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </div>
            )}

            <label className="block">
              <span className="mono-label">HTTP method</span>
              <select
                value={b.method}
                onChange={(e) => bind({ method: e.target.value as TriggerBinding["method"] })}
                className={field}
                title="Only accept this HTTP method"
              >
                {(["ANY", "POST", "PUT", "GET"] as const).map((m) => (
                  <option key={m} value={m} className="bg-panel">
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mono-label">Match path</span>
                <input
                  value={b.matchPath}
                  onChange={(e) => bind({ matchPath: e.target.value })}
                  placeholder="event.type"
                  className={field}
                  title="Dotted payload path that must match the value below (optional)"
                />
              </label>
              <label className="block">
                <span className="mono-label">Equals</span>
                <input
                  value={b.matchValue}
                  onChange={(e) => bind({ matchValue: e.target.value })}
                  placeholder="incident.opened"
                  className={field}
                  title="Expected value at the match path"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 pt-0.5">
              <input
                type="checkbox"
                checked={b.requireSignature}
                onChange={(e) => bind({ requireSignature: e.target.checked })}
                className="accent-sapphire"
                title="Reject payloads whose signature header fails verification"
              />
              <span className="font-mono text-[11px] text-foreground/75">
                require signed payload
              </span>
            </label>
          </>
        )}

        {/* ── email binding ───────────────────────────────────────── */}
        {b.kind === "email" && (
          <>
            <label className="block">
              <span className="mono-label">Mailbox</span>
              <input
                value={b.mailbox}
                onChange={(e) => bind({ mailbox: e.target.value })}
                placeholder="ops@sovereign.local"
                className={field}
                title="Address polled by the mail reader"
              />
            </label>
            <label className="block">
              <span className="mono-label">Folder</span>
              <select
                value={b.folder}
                onChange={(e) => bind({ folder: e.target.value })}
                className={field}
                title="IMAP folder to read"
              >
                {MAIL_FOLDERS.map((f) => (
                  <option key={f} value={f} className="bg-panel">
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mono-label">From filter</span>
              <input
                value={b.fromFilter}
                onChange={(e) => bind({ fromFilter: e.target.value })}
                placeholder="*@partner.com"
                className={field}
                title="Only read messages from this sender pattern (empty = any)"
              />
            </label>
            <label className="block">
              <span className="mono-label">Subject contains</span>
              <input
                value={b.subjectContains}
                onChange={(e) => bind({ subjectContains: e.target.value })}
                placeholder="[INCIDENT]"
                className={field}
                title="Only read messages whose subject contains this text"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={b.attachmentsOnly}
                onChange={(e) => bind({ attachmentsOnly: e.target.checked })}
                className="accent-sapphire"
                title="Only fire when the message carries attachments"
              />
              <span className="font-mono text-[11px] text-foreground/75">attachments only</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={b.markRead}
                onChange={(e) => bind({ markRead: e.target.checked })}
                className="accent-sapphire"
                title="Mark the message read after it is dispatched"
              />
              <span className="font-mono text-[11px] text-foreground/75">
                mark read after dispatch
              </span>
            </label>
          </>
        )}

        {/* ── file drop binding ───────────────────────────────────── */}
        {b.kind === "file" && (
          <>
            <label className="block">
              <span className="mono-label">Watched path</span>
              <input
                value={b.watchPath}
                onChange={(e) => bind({ watchPath: e.target.value })}
                placeholder="/var/sovereign/inbox"
                className={field}
                title="Directory polled for new files"
              />
            </label>
            <label className="block">
              <span className="mono-label">Glob</span>
              <input
                value={b.glob}
                onChange={(e) => bind({ glob: e.target.value })}
                placeholder="*.csv"
                className={field}
                title="File name pattern that fires the trigger"
              />
            </label>
          </>
        )}

        {/* ── cadence ─────────────────────────────────────────────── */}
        {showCadence && (
          <>
            <div className="pt-1.5">
              <span className="mono-label">
                {b.kind === "schedule" ? "Cadence" : "Poll cadence"}
              </span>
              <select
                value={s.mode}
                onChange={(e) => set({ mode: e.target.value as TriggerSchedule["mode"] })}
                className={field}
                title="How often this trigger fires"
              >
                <option value="manual" className="bg-panel">
                  Manual · on demand
                </option>
                <option value="interval" className="bg-panel">
                  Interval
                </option>
                <option value="daily" className="bg-panel">
                  Daily
                </option>
                <option value="weekly" className="bg-panel">
                  Weekly
                </option>
                <option value="monthly" className="bg-panel">
                  Monthly
                </option>
                <option value="cron" className="bg-panel">
                  Cron expression
                </option>
              </select>
            </div>

            {s.mode === "interval" && (
              <label className="block">
                <span className="mono-label">Every (minutes)</span>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={s.everyMinutes}
                  onChange={(e) => set({ everyMinutes: Math.max(1, Number(e.target.value) || 1) })}
                  className={field}
                  title="Interval between runs in minutes"
                />
              </label>
            )}

            {s.mode === "weekly" && (
              <label className="block">
                <span className="mono-label">Weekday</span>
                <select
                  value={s.weekday}
                  onChange={(e) => set({ weekday: Number(e.target.value) })}
                  className={field}
                  title="Day of the week this trigger fires"
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i} className="bg-panel">
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {s.mode === "monthly" && (
              <label className="block">
                <span className="mono-label">Day of month</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={s.dayOfMonth}
                  onChange={(e) =>
                    set({ dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
                  }
                  className={field}
                  title="Calendar day this trigger fires"
                />
              </label>
            )}

            {(s.mode === "daily" || s.mode === "weekly" || s.mode === "monthly") && (
              <label className="block">
                <span className="mono-label">Fire at</span>
                <input
                  type="time"
                  value={s.time}
                  onChange={(e) => set({ time: e.target.value })}
                  className={field}
                  title="Wall-clock time in the selected timezone"
                />
              </label>
            )}

            {s.mode === "cron" && (
              <label className="block">
                <span className="mono-label">Cron expression</span>
                <input
                  value={s.cron}
                  onChange={(e) => set({ cron: e.target.value })}
                  placeholder="0 8 * * *"
                  className={`${field} tracking-[0.08em]`}
                  title="Standard five-field cron expression"
                />
              </label>
            )}

            {s.mode !== "manual" && (
              <label className="block">
                <span className="mono-label">Timezone</span>
                <select
                  value={s.timezone}
                  onChange={(e) => set({ timezone: e.target.value })}
                  className={field}
                  title="Timezone the schedule is evaluated in"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} className="bg-panel">
                      {tz}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
      </fieldset>

      {b.kind === "webhook" && !b.webhookId && (
        <p className="mt-2.5 font-mono text-[10.5px] leading-relaxed tracking-[0.06em] text-topaz">
          no adapter bound · configure adapters on the Adapters page
        </p>
      )}
      {b.kind === "email" && !b.mailbox && (
        <p className="mt-2.5 font-mono text-[10.5px] leading-relaxed tracking-[0.06em] text-topaz">
          no mailbox bound · reader will not poll
        </p>
      )}

      <p className="mt-2.5 font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground/50">
        {triggerSummary(s, b, hook?.label)}
      </p>
    </div>
  );
}
