import { useState, type ReactNode } from "react";
import { periods, type Period } from "@/lib/report-store";
import { resolveSpan, spanSlug, type Span } from "@/lib/report-users";
import { motion } from "motion/react";
import { FileDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiGrid({
  items,
}: {
  items: { label: string; value: string; hint?: string; tone?: string }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((k, i) => (
        <motion.div
          key={k.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015] p-4"
        >
          <span
            className="absolute left-0 top-0 h-full w-px"
            style={{
              background: `var(--${k.tone ?? "sapphire"})`,
              boxShadow: `0 0 12px -2px var(--${k.tone ?? "sapphire"})`,
            }}
          />
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60">
            {k.label}
          </div>
          <div className="mt-2 font-mono text-[22px] font-medium text-foreground">{k.value}</div>
          {k.hint && (
            <div className="mt-1 font-mono text-[11px] text-muted-foreground/55">{k.hint}</div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

export function ReportPanel({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.012] p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70">
            {title}
          </h2>
          {hint && <p className="mt-1 text-[12.5px] text-muted-foreground/60">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function BarList({
  rows,
  tone = "sapphire",
}: {
  rows: { label: string; value: number; caption: string }[];
  tone?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-foreground/90">{r.label}</span>
            <span className="font-mono text-[12px] text-muted-foreground/70">{r.caption}</span>
          </div>
          <div className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-white/[0.05]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(r.value / max) * 100}%` }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full"
              style={{ background: `var(--${tone})`, boxShadow: `0 0 10px -2px var(--${tone})` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DataTable({
  columns,
  rows,
  align,
}: {
  columns: string[];
  rows: ReactNode[][];
  align?: ("left" | "right")[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                className={cn(
                  "border-b border-white/[0.07] pb-2 font-mono text-[10.5px] uppercase tracking-[0.13em] font-normal text-muted-foreground/55",
                  align?.[i] === "right" ? "text-right" : "text-left",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="transition-colors hover:bg-white/[0.02]">
              {r.map((cell, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "border-b border-white/[0.04] py-2.5 pr-4 text-foreground/85",
                    align?.[ci] === "right" ? "text-right font-mono" : "",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Sparkline({
  values,
  tone = "sapphire",
  height = 64,
}: {
  values: number[];
  tone?: string;
  height?: number;
}) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * 100;
    const y = 100 - ((v - min) / Math.max(1, max - min)) * 100;
    return `${x},${y}`;
  });
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }} className="w-full">
      <polyline
        points={`0,100 ${pts.join(" ")} 100,100`}
        fill={`color-mix(in oklab, var(--${tone}) 16%, transparent)`}
        stroke="none"
      />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={`var(--${tone})`}
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function ExportButton({
  onClick,
  label = "Export PDF",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald/40 bg-emerald/10 px-3.5 py-2 text-[13px] font-medium text-emerald transition-colors hover:bg-emerald/20"
    >
      <FileDown className="h-3.5 w-3.5" strokeWidth={1.8} />
      {label}
    </button>
  );
}

export function PeriodSwitch({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-raised/30 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-md px-2.5 py-1 font-mono text-[11.5px] transition-colors",
            value === o.id
              ? "bg-white/[0.08] text-foreground"
              : "text-muted-foreground/70 hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Shared period control for every reporting surface: the three presets plus a
 * Custom range with inline date inputs. Returns the resolved span, its label
 * and the rendered control so each report only wires it into its action slot.
 */
export function useReportSpan(initial: Period = "30d") {
  const [period, setPeriod] = useState<Period>(initial);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const span: Span = custom ? { from, to } : period;
  const resolved = resolveSpan(span);

  const control = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {custom && (
        <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-raised/30 px-2 py-1">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md bg-transparent px-1 font-mono text-[11.5px] text-foreground outline-none"
          />
          <span className="font-mono text-[11px] text-muted-foreground/40">→</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md bg-transparent px-1 font-mono text-[11.5px] text-foreground outline-none"
          />
        </div>
      )}
      <PeriodSwitch
        value={custom ? "custom" : period}
        onChange={(v) => {
          if (v === "custom") setCustom(true);
          else {
            setCustom(false);
            setPeriod(v as Period);
          }
        }}
        options={[
          ...periods.map((p) => ({ id: p.id, label: p.label })),
          { id: "custom", label: "Custom" },
        ]}
      />
    </div>
  );

  return {
    span,
    control,
    label: resolved.label,
    slug: spanSlug(span),
    days: resolved.days,
    end: resolved.end,
  };
}
