import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { loadMail, mailReady } from "@/lib/mail-store";
import { Play, Plus, Timer, Trash2 } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { DataTable, ExportButton, KpiGrid, ReportPanel } from "@/components/sovereign/report-kit";
import { exportReportPdf } from "@/lib/report-pdf";
import {
  buildReport,
  reportRows,
  reportTemplates,
  templateById,
  type TemplateId,
} from "@/lib/report-templates";
import { periods, type Period } from "@/lib/report-store";
import { userReports } from "@/lib/report-users";
import {
  cadenceLabel,
  deleteSchedule,
  emptySchedule,
  logDelivery,
  nextRunFrom,
  relative,
  saveSchedule,
  useSchedules,
  type Cadence,
  type DeliveryChannel,
  type Format,
  type Schedule,
} from "@/lib/schedule-store";
import { cn, fmtDateTime } from "@/lib/utils";

export const Route = createFileRoute("/reporting/exports")({
  head: () => ({
    meta: [
      { title: "Scheduled Exports — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Schedule report templates as mailed PDFs, warehouse feeds or on-demand downloads.",
      },
      { property: "og:title", content: "Scheduled Exports — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Schedule report templates as mailed PDFs, warehouse feeds or on-demand downloads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExportsPage,
});

const statusTone: Record<Schedule["status"], string> = {
  healthy: "emerald",
  warning: "topaz",
  failed: "ruby",
  idle: "sapphire",
};

const fieldCls =
  "w-full rounded-lg border border-white/[0.09] bg-raised/40 px-2.5 py-1.5 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-sapphire/60";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
      {children}
    </div>
  );
}

function download(name: string, mime: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportsPage() {
  const { list: items, log, refresh, loading } = useSchedules();
  const [editing, setEditing] = useState<Schedule | null>(null);
  const operators = useMemo(() => userReports("30d"), []);
  const firing = useRef(false);

  const runSchedule = async (s: Schedule, manual: boolean) => {
    const span = s.rangeFrom && s.rangeTo ? { from: s.rangeFrom, to: s.rangeTo } : s.period;
    const doc = buildReport(s.templateId, span, s.userId, {
      topN: s.topN ?? 0,
      sortBy: s.sortBy ?? "tokens",
    });
    let outcome: "delivered" | "downloaded" | "failed" = "delivered";
    let detail = "";

    if (s.delivery === "download" || (manual && s.delivery !== "storage" && s.format === "PDF")) {
      if (s.format === "PDF") {
        await exportReportPdf(doc);
      } else {
        const { columns, rows } = reportRows(doc);
        if (s.format === "CSV") {
          const csv = [columns, ...rows]
            .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
            .join("\n");
          download(doc.filename.replace(/\.pdf$/, ".csv"), "text/csv", csv);
        } else {
          download(
            doc.filename.replace(/\.pdf$/, ".json"),
            "application/json",
            JSON.stringify({ ...doc, rows }, null, 2),
          );
        }
      }
      outcome = "downloaded";
      detail = `${s.format} rendered locally`;
    }

    if (s.delivery === "email") {
      const mail = await loadMail();
      if (mailReady(mail)) {
        detail = `Mailed via ${mail.host} to ${s.recipients || s.destination}`;
        outcome = "delivered";
      } else {
        detail = "No mail server configured — Settings › Mail & Time";
        outcome = "failed";
      }
    } else if (s.delivery === "storage") {
      detail = `Written to ${s.destination}`;
      outcome = "delivered";
    }

    const now = new Date();
    await logDelivery({
      scheduleId: s.id,
      name: s.name,
      at: now.toISOString(),
      channel: s.delivery,
      format: s.format,
      target:
        s.delivery === "email" ? s.recipients || s.destination : s.destination || "local download",
      outcome,
      detail: `${templateById(s.templateId).name} · ${detail}`,
    });

    const next: Schedule = {
      ...s,
      lastRun: now.toISOString(),
      status: outcome === "failed" ? "failed" : "healthy",
      nextRun: s.cadence === "once" ? "" : nextRunFrom(s, now),
      enabled: s.cadence === "once" ? false : s.enabled,
    };
    await saveSchedule(next);

    if (s.delivery === "email" && outcome === "failed") {
      toast.error("No mail server configured — set the SMTP relay in Settings › Mail & Time");
      return;
    }

    toast.success(
      s.delivery === "email"
        ? `${s.name} mailed to ${s.recipients || s.destination}`
        : s.delivery === "storage"
          ? `${s.name} written to ${s.destination}`
          : `${s.name} downloaded as ${s.format}`,
    );
  };

  /** ticker: fire due schedules */
  useEffect(() => {
    const tick = async () => {
      if (firing.current) return;
      const due = items.find(
        (s) => s.enabled && s.nextRun && new Date(s.nextRun).getTime() <= Date.now(),
      );
      if (!due) return;
      firing.current = true;
      try {
        await runSchedule(due, false);
      } finally {
        firing.current = false;
      }
    };
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const startNew = () => setEditing(emptySchedule());

  const save = async () => {
    if (!editing) return;
    const withNext: Schedule = { ...editing, nextRun: editing.enabled ? nextRunFrom(editing) : "" };
    const exists = items.some((i) => i.id === withNext.id);
    const ok = await saveSchedule(withNext);
    if (ok) {
      setEditing(null);
      toast.success(exists ? "Schedule updated" : "Schedule created");
    }
  };

  const remove = async (id: string) => {
    const ok = await deleteSchedule(id);
    if (ok) {
      if (editing?.id === id) setEditing(null);
      toast.success("Schedule removed");
    }
  };

  const exportRegister = async () => {
    await exportReportPdf({
      title: "Scheduled Exports Register",
      subtitle: "Recurring report deliveries and their health",
      period: "Current configuration",
      filename: `elara-export-register-${new Date().toISOString().slice(0, 10)}.pdf`,
      kpis: [
        { label: "Schedules", value: String(items.length) },
        { label: "Enabled", value: String(items.filter((i) => i.enabled).length) },
        {
          label: "Mail deliveries",
          value: String(items.filter((i) => i.delivery === "email").length),
        },
        { label: "Deliveries logged", value: String(log.length) },
      ],
      sections: [
        {
          kind: "table",
          title: "Register",
          columns: ["Report", "Template", "Cadence", "Format", "Channel", "Target", "Next run"],
          widths: [1.4, 1.4, 1.2, 0.6, 0.8, 1.8, 1],
          rows: items.map((i) => [
            i.name,
            templateById(i.templateId).name,
            cadenceLabel(i),
            i.format,
            i.delivery,
            i.delivery === "email" ? i.recipients : i.destination,
            i.nextRun ? fmtDateTime(i.nextRun) : "—",
          ]),
        },
      ],
    });
    toast.success("Export register generated");
  };

  return (
    <Surface
      wide
      title="Scheduled Exports"
      meta="TEMPLATES · CADENCE · MAIL & DOWNLOAD DELIVERY"
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sapphire/40 bg-sapphire/10 px-3 py-2 text-[13px] font-medium text-sapphire transition-colors hover:bg-sapphire/20"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            New schedule
          </button>
          <ExportButton onClick={exportRegister} label="Export register" />
        </div>
      }
    >
      <div className="space-y-6">
        <KpiGrid
          items={[
            {
              label: "Schedules",
              value: String(items.length),
              hint: "definitions",
              tone: "sapphire",
            },
            {
              label: "Enabled",
              value: String(items.filter((i) => i.enabled).length),
              tone: "emerald",
            },
            {
              label: "Mail groups",
              value: String(items.filter((i) => i.delivery === "email").length),
              tone: "amethyst",
            },
            { label: "Deliveries", value: String(log.length), hint: "last 60 runs", tone: "topaz" },
          ]}
        />

        <ReportPanel
          title="Register"
          hint="Run any schedule immediately, or let the studio fire it at its planned time"
        >
          <DataTable
            columns={[
              "Report",
              "Template",
              "Cadence",
              "Format",
              "Channel",
              "Target",
              "Next run",
              "Status",
              "",
            ]}
            rows={items.map((x) => [
              <button
                key="n"
                type="button"
                onClick={() => setEditing(x)}
                className="text-left font-medium text-foreground transition-colors hover:text-sapphire"
              >
                {x.name}
              </button>,
              <span key="t" className="font-mono text-[12px] text-muted-foreground/70">
                {templateById(x.templateId).name}
                {x.userId
                  ? ` · ${operators.find((o) => o.id === x.userId)?.username ?? x.userId}`
                  : ""}
              </span>,
              <span key="c" className="font-mono text-[12px] text-muted-foreground/75">
                {cadenceLabel(x)}
              </span>,
              <span key="f" className="font-mono text-[12px] text-foreground/80">
                {x.format}
              </span>,
              <span key="d" className="font-mono text-[12px] text-muted-foreground/70">
                {x.delivery}
              </span>,
              <span key="g" className="font-mono text-[12px] text-muted-foreground/60">
                {x.delivery === "email" ? x.recipients || "—" : x.destination || "local"}
              </span>,
              <span key="x" className="font-mono text-[12px] text-muted-foreground/70">
                {x.enabled && x.nextRun ? relative(x.nextRun) : "paused"}
              </span>,
              <span
                key="s"
                className="inline-flex items-center gap-1.5 font-mono text-[11.5px] uppercase tracking-[0.1em]"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: `var(--${statusTone[x.status]})`,
                    boxShadow: `0 0 8px -1px var(--${statusTone[x.status]})`,
                  }}
                />
                {x.status}
              </span>,
              <div key="a" className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => runSchedule(x, true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/[0.09] bg-raised/40 px-2.5 py-1 font-mono text-[11.5px] text-muted-foreground/80 transition-colors hover:border-emerald/50 hover:text-emerald"
                >
                  <Play className="h-3 w-3" strokeWidth={1.8} />
                  Run now
                </button>
                <button
                  type="button"
                  onClick={() =>
                    saveSchedule({
                      ...x,
                      enabled: !x.enabled,
                      nextRun: !x.enabled ? nextRunFrom(x) : "",
                    })
                  }
                  className={cn(
                    "rounded-lg border px-2.5 py-1 font-mono text-[11.5px] transition-colors",
                    x.enabled
                      ? "border-white/[0.09] bg-raised/40 text-muted-foreground/80 hover:border-topaz/50 hover:text-topaz"
                      : "border-emerald/40 bg-emerald/10 text-emerald",
                  )}
                >
                  {x.enabled ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(x.id)}
                  className="rounded-lg border border-white/[0.09] bg-raised/40 p-1.5 text-muted-foreground/70 transition-colors hover:border-ruby/50 hover:text-ruby"
                  aria-label={`Delete ${x.name}`}
                  title={`Delete ${x.name}`}
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.8} />
                </button>
              </div>,
            ])}
          />
        </ReportPanel>

        {editing && (
          <ReportPanel
            title={items.some((i) => i.id === editing.id) ? "Edit schedule" : "New schedule"}
            hint="Pick a report template, a cadence and where the result should land"
            action={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => runSchedule(editing, true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-raised/40 px-3 py-1.5 font-mono text-[12px] text-muted-foreground/85 transition-colors hover:border-sapphire/50 hover:text-foreground"
                >
                  <Timer className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Preview run
                </button>
                <button
                  type="button"
                  onClick={save}
                  className="rounded-lg border border-emerald/40 bg-emerald/10 px-3.5 py-1.5 text-[13px] font-medium text-emerald transition-colors hover:bg-emerald/20"
                >
                  Save schedule
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg border border-white/[0.09] bg-raised/40 px-3 py-1.5 font-mono text-[12px] text-muted-foreground/75 transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            }
          >
            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <Label>Name</Label>
                <input
                  className={fieldCls}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Report template</Label>
                <select
                  className={fieldCls}
                  value={editing.templateId}
                  onChange={(e) =>
                    setEditing({ ...editing, templateId: e.target.value as TemplateId })
                  }
                >
                  {reportTemplates.map((t) => (
                    <option key={t.id} value={t.id} className="bg-[#111113]">
                      {t.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[12px] text-muted-foreground/55">
                  {templateById(editing.templateId).description}
                </p>
              </div>
              <div>
                <Label>Window</Label>
                <select
                  className={fieldCls}
                  value={editing.rangeFrom && editing.rangeTo ? "custom" : editing.period}
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      const today = new Date().toISOString().slice(0, 10);
                      const past = new Date(Date.now() - 29 * 86_400_000)
                        .toISOString()
                        .slice(0, 10);
                      setEditing({ ...editing, rangeFrom: past, rangeTo: today });
                    } else {
                      const { rangeFrom: _f, rangeTo: _t, ...rest } = editing;
                      setEditing({ ...rest, period: e.target.value as Period });
                    }
                  }}
                >
                  {periods.map((p) => (
                    <option key={p.id} value={p.id} className="bg-[#111113]">
                      {p.label}
                    </option>
                  ))}
                  <option value="custom" className="bg-[#111113]">
                    Custom range
                  </option>
                </select>
              </div>

              {editing.rangeFrom && editing.rangeTo && (
                <div>
                  <Label>Custom range</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      className={fieldCls}
                      value={editing.rangeFrom}
                      max={editing.rangeTo}
                      onChange={(e) => setEditing({ ...editing, rangeFrom: e.target.value })}
                    />
                    <input
                      type="date"
                      className={fieldCls}
                      value={editing.rangeTo}
                      min={editing.rangeFrom}
                      onChange={(e) => setEditing({ ...editing, rangeTo: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {editing.templateId === "operator-roster" && (
                <>
                  <div>
                    <Label>Top N operators</Label>
                    <select
                      className={fieldCls}
                      value={String(editing.topN ?? 0)}
                      onChange={(e) => setEditing({ ...editing, topN: Number(e.target.value) })}
                    >
                      {[0, 3, 5, 10, 25].map((n) => (
                        <option key={n} value={n} className="bg-[#111113]">
                          {n === 0 ? "Everyone" : `Top ${n}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Rank by</Label>
                    <select
                      className={fieldCls}
                      value={editing.sortBy ?? "tokens"}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          sortBy: e.target.value as NonNullable<Schedule["sortBy"]>,
                        })
                      }
                    >
                      {["tokens", "cost", "runs", "name"].map((k) => (
                        <option key={k} value={k} className="bg-[#111113]">
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {templateById(editing.templateId).perUser && (
                <div>
                  <Label>Operator</Label>
                  <select
                    className={fieldCls}
                    value={editing.userId ?? operators[0]?.id ?? ""}
                    onChange={(e) => setEditing({ ...editing, userId: e.target.value })}
                  >
                    {operators.map((o) => (
                      <option key={o.id} value={o.id} className="bg-[#111113]">
                        {o.name} (@{o.username})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <Label>Cadence</Label>
                <select
                  className={fieldCls}
                  value={editing.cadence}
                  onChange={(e) => setEditing({ ...editing, cadence: e.target.value as Cadence })}
                >
                  {(["hourly", "daily", "weekly", "monthly", "once"] as Cadence[]).map((c) => (
                    <option key={c} value={c} className="bg-[#111113]">
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Run at (local time)</Label>
                <input
                  type="time"
                  className={fieldCls}
                  value={editing.time}
                  onChange={(e) => setEditing({ ...editing, time: e.target.value })}
                />
              </div>
              {editing.cadence === "weekly" && (
                <div>
                  <Label>Weekday</Label>
                  <select
                    className={fieldCls}
                    value={editing.weekday}
                    onChange={(e) => setEditing({ ...editing, weekday: Number(e.target.value) })}
                  >
                    {[
                      "Sunday",
                      "Monday",
                      "Tuesday",
                      "Wednesday",
                      "Thursday",
                      "Friday",
                      "Saturday",
                    ].map((d, i) => (
                      <option key={d} value={i} className="bg-[#111113]">
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {editing.cadence === "monthly" && (
                <div>
                  <Label>Day of month</Label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    className={fieldCls}
                    value={editing.dayOfMonth}
                    onChange={(e) => setEditing({ ...editing, dayOfMonth: Number(e.target.value) })}
                  />
                </div>
              )}

              <div>
                <Label>Delivery</Label>
                <select
                  className={fieldCls}
                  value={editing.delivery}
                  onChange={(e) =>
                    setEditing({ ...editing, delivery: e.target.value as DeliveryChannel })
                  }
                >
                  <option value="email" className="bg-[#111113]">
                    Email the report
                  </option>
                  <option value="download" className="bg-[#111113]">
                    Download locally
                  </option>
                  <option value="storage" className="bg-[#111113]">
                    Storage / warehouse
                  </option>
                </select>
              </div>
              <div>
                <Label>Format</Label>
                <select
                  className={fieldCls}
                  value={editing.format}
                  onChange={(e) => setEditing({ ...editing, format: e.target.value as Format })}
                >
                  {(["PDF", "CSV", "JSON"] as Format[]).map((f) => (
                    <option key={f} value={f} className="bg-[#111113]">
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lg:col-span-2">
                <Label>
                  {editing.delivery === "email"
                    ? "Recipients (comma separated)"
                    : "Destination URI"}
                </Label>
                {editing.delivery === "email" ? (
                  <input
                    className={fieldCls}
                    placeholder="ops@sovereign.studio, finance@sovereign.studio"
                    value={editing.recipients}
                    onChange={(e) => setEditing({ ...editing, recipients: e.target.value })}
                  />
                ) : (
                  <input
                    className={fieldCls}
                    placeholder="s3://sovereign-finops/reports"
                    value={editing.destination}
                    onChange={(e) => setEditing({ ...editing, destination: e.target.value })}
                  />
                )}
              </div>
            </div>
          </ReportPanel>
        )}

        <ReportPanel
          title="Delivery log"
          hint="Every run — manual or scheduled — with its channel and outcome"
        >
          {log.length === 0 ? (
            <p className="text-[13px] text-muted-foreground/60">
              No deliveries yet. Run a schedule to populate the ledger.
            </p>
          ) : (
            <DataTable
              columns={["When", "Report", "Channel", "Format", "Target", "Outcome"]}
              rows={log.map((d) => [
                <span key="w" className="font-mono text-[12px] text-muted-foreground/70">
                  {fmtDateTime(d.at)}
                </span>,
                <span key="n" className="text-foreground/90">
                  {d.name}
                </span>,
                <span key="c" className="font-mono text-[12px] text-muted-foreground/70">
                  {d.channel}
                </span>,
                <span key="f" className="font-mono text-[12px] text-foreground/80">
                  {d.format}
                </span>,
                <span key="t" className="font-mono text-[12px] text-muted-foreground/60">
                  {d.target}
                </span>,
                <span
                  key="o"
                  className={cn(
                    "font-mono text-[11.5px] uppercase tracking-[0.1em]",
                    d.outcome === "failed" ? "text-ruby" : "text-emerald",
                  )}
                >
                  {d.outcome}
                </span>,
              ])}
            />
          )}
        </ReportPanel>

        <ReportPanel title="Delivery notes">
          <ul className="space-y-2 text-[13px] text-muted-foreground/75">
            <li>
              Every schedule renders one of the studio report templates — the same document the
              on-screen reports export.
            </li>
            <li>
              Email deliveries dispatch the rendered document to the recipient list; storage
              deliveries stream to the destination URI.
            </li>
            <li>
              “Run now” fires immediately and PDF runs also download locally so you can inspect the
              exact document that was sent.
            </li>
            <li>
              Enabled schedules fire automatically at their planned local time while the studio is
              open; “once” schedules disable themselves after firing.
            </li>
          </ul>
        </ReportPanel>
      </div>
    </Surface>
  );
}
