import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, ChevronDown, Download, Pause, Play, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { JewelButton } from "@/components/sovereign/primitives";
import {
  auditStreams,
  actors,
  defaultFilter,
  download,
  fmtTs,
  filterEvents,
  severities,
  severityTone,
  toCsv,
  toNdjson,
  toTxt,
  useAuditLog,
  windows,
  type AuditFilter,
  type Severity,
  type WindowId,
} from "@/lib/audit-store";
import { exportReportPdf } from "@/lib/report-pdf";
import { cn } from "@/lib/utils";

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, close]);
  return ref;
}

const trigger =
  "flex items-center gap-2.5 rounded-lg border border-white/[0.08] bg-black/25 px-4 py-2.5 font-mono text-[13px] text-foreground/85 transition-colors hover:border-sapphire/40";

export function Dropdown({
  label,
  value,
  children,
  width = "w-[260px]",
}: {
  label: string;
  value: string;
  children: (close: () => void) => React.ReactNode;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={trigger}>
        <span className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/55">
          {label}
        </span>
        <span>{value}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground/50 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "absolute left-0 z-40 mt-2 max-h-[360px] overflow-y-auto rounded-xl border border-white/[0.09] bg-panel/95 p-2 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.5)] backdrop-blur-xl",
            width,
          )}
        >
          {children(() => setOpen(false))}
        </motion.div>
      )}
    </div>
  );
}

export function Option({
  active,
  onClick,
  children,
  hint,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left font-mono text-[13px] text-foreground/80 transition-colors hover:bg-white/[0.05]"
    >
      <span className="min-w-0 truncate">
        {children}
        {hint && <span className="ml-2 text-[11px] text-muted-foreground/45">{hint}</span>}
      </span>
      {active && <Check className="h-4 w-4 shrink-0 text-emerald" />}
    </button>
  );
}

export function AuditPanel({
  initialStream,
  initialQuery,
}: {
  initialStream?: string | undefined;
  initialQuery?: string | undefined;
} = {}) {
  const { events, live, setLive, retention, setRetention, purge } = useAuditLog();
  const [f, setF] = useState<AuditFilter>(() => ({
    ...defaultFilter,
    streams: initialStream ? [initialStream] : defaultFilter.streams,
    query: initialQuery || defaultFilter.query,
  }));

  const rows = useMemo(() => filterEvents(events, f), [events, f]);
  const stats = useMemo(() => {
    const bySev = rows.reduce<Record<string, number>>((a, e) => {
      a[e.severity] = (a[e.severity] ?? 0) + 1;
      return a;
    }, {});
    return bySev;
  }, [rows]);

  const win = windows.find((w) => w.id === f.window)!;

  return (
    <section className="space-y-6">
      {/* control bar */}
      <div className="flex flex-wrap items-center gap-3.5 rounded-xl border border-white/[0.07] bg-white/[0.012] px-4 py-4">
        <Dropdown label="window" value={win.label}>
          {(close) =>
            windows.map((w) => (
              <Option
                key={w.id}
                active={w.id === f.window}
                onClick={() => {
                  setF((p) => ({ ...p, window: w.id as WindowId }));
                  close();
                }}
              >
                {w.label}
              </Option>
            ))
          }
        </Dropdown>

        <Dropdown
          label="streams"
          value={f.streams.length ? `${f.streams.length} selected` : "all"}
          width="w-[250px]"
        >
          {() => (
            <>
              <Option onClick={() => setF((p) => ({ ...p, streams: [] }))}>all streams</Option>
              {auditStreams.map((s) => (
                <Option
                  key={s}
                  active={f.streams.includes(s)}
                  onClick={() =>
                    setF((p) => ({
                      ...p,
                      streams: p.streams.includes(s)
                        ? p.streams.filter((x) => x !== s)
                        : [...p.streams, s],
                    }))
                  }
                >
                  {s}
                </Option>
              ))}
            </>
          )}
        </Dropdown>

        <Dropdown label="min level" value={f.minSeverity} width="w-[180px]">
          {(close) =>
            severities.map((s) => (
              <Option
                key={s}
                active={s === f.minSeverity}
                onClick={() => {
                  setF((p) => ({ ...p, minSeverity: s as Severity }));
                  close();
                }}
              >
                <span className={severityTone[s]}>{s}</span>
              </Option>
            ))
          }
        </Dropdown>

        <Dropdown label="actor" value={f.actor || "any"} width="w-[280px]">
          {(close) => (
            <>
              <Option
                active={!f.actor}
                onClick={() => {
                  setF((p) => ({ ...p, actor: "" }));
                  close();
                }}
              >
                any actor
              </Option>
              {actors.map((a) => (
                <Option
                  key={a}
                  active={a === f.actor}
                  onClick={() => {
                    setF((p) => ({ ...p, actor: a }));
                    close();
                  }}
                >
                  {a}
                </Option>
              ))}
            </>
          )}
        </Dropdown>

        <Dropdown
          label="retention"
          value={windows.find((w) => w.id === retention)!.label}
          width="w-[260px]"
        >
          {(close) =>
            windows.map((w) => (
              <Option
                key={w.id}
                active={w.id === retention}
                onClick={() => {
                  setRetention(w.id as WindowId);
                  close();
                }}
              >
                {w.label}
              </Option>
            ))
          }
        </Dropdown>

        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/40" />
          <input
            value={f.query}
            onChange={(e) => setF((p) => ({ ...p, query: e.target.value }))}
            placeholder="filter actor · action · target · request id"
            className="w-full rounded-lg border border-white/[0.08] bg-black/25 py-2.5 pl-9 pr-3 font-mono text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-sapphire/50"
          />
        </div>

        <button
          type="button"
          onClick={() => setLive(!live)}
          title={live ? "Click to pause live event stream" : "Click to resume live event stream"}
          className={cn(
            "flex items-center gap-2.5 rounded-lg border px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.14em] transition-colors",
            live
              ? "border-emerald/45 bg-emerald/10 text-emerald shadow-[0_0_15px_-4px_var(--emerald)]"
              : "border-white/[0.09] bg-black/25 text-muted-foreground/60 hover:border-white/[0.18]",
          )}
        >
          {live ? <Pause className="h-3.5 w-3.5 text-emerald" /> : <Play className="h-3.5 w-3.5" />}
          <span>{live ? "live stream" : "stream held"}</span>
        </button>
      </div>

      {/* summary */}
      <div className="flex flex-wrap items-center gap-4 font-mono text-[12px] text-muted-foreground/60">
        <span className="text-foreground/80">{rows.length.toLocaleString("en-US")} records</span>
        <span>of {events.length.toLocaleString("en-US")} retained</span>
        {severities.map((s) =>
          stats[s] ? (
            <span key={s} className={severityTone[s]}>
              {s} · {stats[s]}
            </span>
          ) : null,
        )}
        <span className="ml-auto flex items-center gap-2">
          <JewelButton
            size="sm"
            variant="outline"
            onClick={() => {
              download(`audit-${f.window}.csv`, toCsv(rows), "text/csv");
              toast.success(`${rows.length} records exported · CSV`);
            }}
          >
            <Download className="mr-1.5 inline h-4 w-4" />
            CSV
          </JewelButton>
          <JewelButton
            size="sm"
            variant="outline"
            onClick={() => {
              download(`audit-${f.window}.ndjson`, toNdjson(rows), "application/x-ndjson");
              toast.success(`${rows.length} records exported · NDJSON`);
            }}
          >
            NDJSON
          </JewelButton>
          <JewelButton
            size="sm"
            variant="outline"
            onClick={() => {
              download(`audit-${f.window}.txt`, toTxt(rows), "text/plain");
              toast.success(`${rows.length} records exported · TXT`);
            }}
          >
            TXT
          </JewelButton>
          <JewelButton
            size="sm"
            variant="outline"
            onClick={async () => {
              const capped = rows.slice(0, 800);
              await exportReportPdf({
                title: "Logs / Audit",
                subtitle: "Elara Sovereign Studio — append-only audit journal",
                period: `${win.label} · ${capped.length} of ${rows.length} records`,
                filename: `audit-${f.window}.pdf`,
                kpis: severities
                  .filter((s) => stats[s])
                  .map((s) => ({ label: s, value: String(stats[s]) })),
                sections: [
                  {
                    kind: "table",
                    title: "Journal",
                    columns: ["Timestamp", "Level", "Stream", "Actor", "Action", "Detail"],
                    widths: [2.1, 1, 1.1, 1.8, 1.8, 4.4],
                    rows: capped.map((e) => [
                      fmtTs(e.at),
                      e.severity,
                      e.stream,
                      e.actor,
                      e.action,
                      `${e.target} — ${e.detail}`,
                    ]),
                  },
                ],
              });
              toast.success(`${capped.length} records exported · PDF`);
            }}
          >
            PDF
          </JewelButton>
          <JewelButton
            size="sm"
            variant="danger"
            onClick={() => {
              purge();
              toast.success("Journal buffer purged");
            }}
          >
            <Trash2 className="mr-1.5 inline h-4 w-4" />
            Purge
          </JewelButton>
        </span>
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.012]">
        <div className="flex items-center gap-5 border-b border-white/[0.06] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/45">
          <span className="w-[150px] shrink-0">timestamp</span>
          <span className="w-[72px] shrink-0">level</span>
          <span className="w-[96px] shrink-0">stream</span>
          <span className="w-[210px] shrink-0">actor</span>
          <span className="w-[200px] shrink-0">action</span>
          <span className="flex-1">detail</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center font-mono text-[13px] text-muted-foreground/45">
            no records inside this window
          </p>
        ) : (
          <ol className="max-h-[62vh] divide-y divide-white/[0.04] overflow-y-auto">
            {rows.slice(0, 400).map((e) => (
              <li key={e.id} className="flex items-start gap-5 px-5 py-3 hover:bg-white/[0.02]">
                <span className="w-[150px] shrink-0 font-mono text-[12.5px] text-muted-foreground/60">
                  {fmtTs(e.at)}
                </span>
                <span
                  className={cn(
                    "w-[72px] shrink-0 font-mono text-[11px] uppercase",
                    severityTone[e.severity],
                  )}
                >
                  {e.severity}
                </span>
                <span className="w-[96px] shrink-0 font-mono text-[12px] text-amethyst/70">
                  {e.stream}
                </span>
                <span className="w-[210px] shrink-0 truncate font-mono text-[12px] text-foreground/70">
                  {e.actor}
                </span>
                <span className="w-[200px] shrink-0 truncate font-mono text-[12px] text-sapphire/75">
                  {e.action}
                </span>
                <span className="min-w-0 flex-1 font-mono text-[12.5px] text-muted-foreground/75">
                  {e.target && e.target !== e.stream && !e.detail.startsWith(e.target) ? (
                    <span className="text-foreground/90">{e.target} — </span>
                  ) : null}
                  {e.detail}
                  <span className="ml-2 text-[11px] text-muted-foreground/35">
                    {e.ip} · req {e.reqId}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {rows.length > 400 && (
        <p className="font-mono text-[11.5px] text-muted-foreground/40">
          showing newest 400 of {rows.length.toLocaleString("en-US")} — narrow the window or export
          for the rest
        </p>
      )}
    </section>
  );
}
