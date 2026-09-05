import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, AlertTriangle, Check, ChevronDown, Pause, Play, Plus, X } from "lucide-react";
import { Sheen } from "./primitives";
import {
  agentSample,
  useAgentTelemetryStatus,
  useLiveTelemetry,
  type LiveTelemetry,
  type AgentStatusItem,
} from "@/lib/telemetry-live";
import { useModels } from "@/lib/model-store";
import { useEngine } from "@/lib/engine-store";

import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- spark */

function Spark({ data, tone }: { data: number[]; tone: string }) {
  const { line, area } = useMemo(() => {
    if (data.length < 2) return { line: "", area: "" };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 26 - ((v - min) / span) * 23 - 1.5;
      return [x, y] as const;
    });
    const line = pts
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
    return { line, area: `${line} L100,28 L0,28 Z` };
  }, [data]);

  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full">
      <path d={area} fill={`color-mix(in oklab, var(--${tone}) 16%, transparent)`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={`var(--${tone})`}
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
        style={{ filter: `drop-shadow(0 0 6px var(--${tone}))` }}
      />
    </svg>
  );
}

/* ------------------------------------------------------------- catalog */

type MetricDef = {
  id: string;
  label: string;
  unit?: string;
  tone: string;
  group: "inference" | "quality" | "host" | "data";
  /** live value in display units */
  value: (t: LiveTelemetry) => number;
  /** lower is better → delta sign flips */
  inverse?: boolean;
  digits?: number;
};

export const runtimeMetrics: MetricDef[] = [
  {
    id: "throughput",
    label: "throughput",
    unit: "k tok/s",
    tone: "sapphire",
    group: "inference",
    value: (t) => t.ai.throughput / 1000,
    digits: 1,
  },
  {
    id: "p95",
    label: "p95 latency",
    unit: "ms",
    tone: "amethyst",
    group: "inference",
    value: (t) => t.ai.p95,
    inverse: true,
    digits: 0,
  },
  {
    id: "p50",
    label: "p50 latency",
    unit: "ms",
    tone: "amethyst",
    group: "inference",
    value: (t) => t.ai.p50,
    inverse: true,
    digits: 0,
  },
  {
    id: "ttft",
    label: "ttft",
    unit: "ms",
    tone: "sapphire",
    group: "inference",
    value: (t) => t.ai.ttft,
    inverse: true,
    digits: 0,
  },
  {
    id: "queue",
    label: "queue depth",
    unit: "jobs",
    tone: "topaz",
    group: "inference",
    value: (t) => t.ai.queueDepth,
    inverse: true,
    digits: 0,
  },
  {
    id: "cost",
    label: "spend rate",
    unit: "$/hr",
    tone: "topaz",
    group: "inference",
    value: (t) => t.ai.costPerHour,
    inverse: true,
    digits: 2,
  },

  {
    id: "hallucination",
    label: "hallucination",
    unit: "%",
    tone: "ruby",
    group: "quality",
    value: (t) => t.ai.hallucination,
    inverse: true,
    digits: 1,
  },
  {
    id: "groundedness",
    label: "groundedness",
    unit: "%",
    tone: "emerald",
    group: "quality",
    value: (t) => t.ai.groundedness,
    digits: 1,
  },
  {
    id: "toolErrors",
    label: "tool errors",
    unit: "%",
    tone: "ruby",
    group: "quality",
    value: (t) => t.ai.toolErrorRate,
    inverse: true,
    digits: 2,
  },
  {
    id: "refusal",
    label: "refusal rate",
    unit: "%",
    tone: "topaz",
    group: "quality",
    value: (t) => t.ai.refusalRate,
    inverse: true,
    digits: 2,
  },
  {
    id: "cacheHit",
    label: "cache hit",
    unit: "%",
    tone: "emerald",
    group: "quality",
    value: (t) => t.ai.cacheHit,
    digits: 0,
  },
  {
    id: "guardrail",
    label: "guardrail blocks",
    tone: "topaz",
    group: "quality",
    value: (t) => t.ai.guardrailBlocks,
    inverse: true,
    digits: 0,
  },

  {
    id: "cpu",
    label: "cpu",
    unit: "%",
    tone: "sapphire",
    group: "host",
    value: (t) => t.host.cpu,
    inverse: true,
    digits: 0,
  },
  {
    id: "gpu",
    label: "gpu",
    unit: "%",
    tone: "emerald",
    group: "host",
    value: (t) => t.host.gpu,
    inverse: true,
    digits: 0,
  },
  {
    id: "vram",
    label: "vram",
    unit: "%",
    tone: "emerald",
    group: "host",
    value: (t) => t.host.vram,
    inverse: true,
    digits: 0,
  },
  {
    id: "gpuTemp",
    label: "gpu temp",
    unit: "°c",
    tone: "topaz",
    group: "host",
    value: (t) => t.host.gpuTemp,
    inverse: true,
    digits: 0,
  },
  {
    id: "ram",
    label: "memory",
    unit: "%",
    tone: "amethyst",
    group: "host",
    value: (t) => t.host.ram,
    inverse: true,
    digits: 0,
  },
  {
    id: "load",
    label: "load avg",
    tone: "sapphire",
    group: "host",
    value: (t) => t.host.loadAvg[0],
    inverse: true,
    digits: 2,
  },
  {
    id: "netRx",
    label: "net rx",
    unit: "mb/s",
    tone: "sapphire",
    group: "host",
    value: (t) => t.host.netRx,
    digits: 0,
  },
  {
    id: "netTx",
    label: "net tx",
    unit: "mb/s",
    tone: "sapphire",
    group: "host",
    value: (t) => t.host.netTx,
    digits: 0,
  },
  {
    id: "netErrors",
    label: "net errors",
    tone: "ruby",
    group: "host",
    value: (t) => t.host.netErrors,
    inverse: true,
    digits: 0,
  },

  {
    id: "dbQps",
    label: "db qps",
    tone: "emerald",
    group: "data",
    value: (t) => t.host.dbQps,
    digits: 0,
  },
  {
    id: "dbLag",
    label: "db lag",
    unit: "ms",
    tone: "topaz",
    group: "data",
    value: (t) => t.host.dbLagMs,
    inverse: true,
    digits: 0,
  },
  {
    id: "dbConns",
    label: "db conns",
    tone: "sapphire",
    group: "data",
    value: (t) => t.host.dbConns,
    digits: 0,
  },
  {
    id: "sessions",
    label: "sessions",
    tone: "amethyst",
    group: "data",
    value: (t) => t.host.sessions,
    digits: 0,
  },
];

const groupLabels: Record<MetricDef["group"], string> = {
  inference: "inference",
  quality: "quality",
  host: "host",
  data: "data",
};

const DEFAULT_WIDGETS = ["throughput", "p95", "gpu", "hallucination"];
const KEY = "sovereign.runtime.widgets";
const HISTORY = 40;

/* --------------------------------------------------------------- widget */

function Widget({
  def,
  value,
  series,
  onRemove,
}: {
  def: MetricDef;
  value: number;
  series: number[];
  onRemove: () => void;
}) {
  const raw = (() => {
    if (series.length < 6) return 0;
    const a = series[series.length - 6] ?? 0;
    const b = series[series.length - 1] ?? 0;
    return a === 0 ? 0 : ((b - a) / a) * 100;
  })();
  const delta = def.inverse ? -raw : raw;
  const up = delta >= 0;

  return (
    <div className="group relative overflow-hidden rounded-[10px] border border-white/[0.07] bg-white/[0.015] p-3 transition-colors hover:border-white/[0.14]">
      <button
        onClick={onRemove}
        aria-label={`Remove ${def.label} widget`}
        className="absolute right-1.5 top-1.5 rounded-md p-0.5 text-muted-foreground/50 opacity-0 transition-all hover:text-ruby group-hover:opacity-100"
        title={`Remove ${def.label} widget`}
      >
        <X className="h-3 w-3" />
      </button>
      <div className="flex items-baseline justify-between gap-2 pr-4">
        <span className="mono-label">{def.label}</span>
        <span
          className={cn(
            "font-mono text-[10px]",
            Math.abs(delta) < 0.5 ? "text-muted-foreground/45" : up ? "text-emerald" : "text-ruby",
          )}
        >
          {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className="font-mono text-[19px] leading-none"
          style={{ color: `var(--${def.tone})` }}
        >
          {value.toFixed(def.digits ?? 0)}
        </span>
        {def.unit && (
          <span className="font-mono text-[10.5px] text-muted-foreground/55">{def.unit}</span>
        )}
      </div>
      <div className="-mx-1 mt-2">
        <Spark data={series} tone={def.tone} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- widget menu */

function WidgetPicker({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const groups = ["inference", "quality", "host", "data"] as const;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/25 px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/70 transition-colors hover:border-sapphire/40 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        widgets
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute right-0 z-50 mt-2 max-h-[420px] w-[260px] overflow-y-auto rounded-xl border border-white/[0.09] bg-panel/95 p-2 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.5)] backdrop-blur-xl"
        >
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <div className="px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground/40">
                {groupLabels[g]}
              </div>
              {runtimeMetrics
                .filter((m) => m.group === g)
                .map((m) => {
                  const on = selected.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onToggle(m.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 font-mono text-[11.5px] transition-colors",
                        on
                          ? "bg-sapphire/10 text-sapphire"
                          : "text-muted-foreground/70 hover:bg-white/[0.04]",
                      )}
                    >
                      <span>{m.label}</span>
                      {on && <Check className="h-3.5 w-3.5" />}
                    </button>
                  );
                })}
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- panel */

export function RuntimeMonitor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const [widgets, setWidgets] = useState<string[]>([]);
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [fleetFilter, setFleetFilter] = useState<"agent" | "workflow" | "orchestrator">("agent");
  const t = useLiveTelemetry(paused || !open);
  const agentsStatus = useAgentTelemetryStatus(paused || !open);
  const { models } = useModels();
  const { config: engine } = useEngine();

  const TONES = ["sapphire", "emerald", "amethyst", "topaz", "ruby"] as const;
  function hashTone(str: string) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return TONES[h % TONES.length];
  }

  /* restore widget layout */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setWidgets(parsed);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    // Fallback if empty or invalid
    setWidgets(DEFAULT_WIDGETS);
  }, []);

  const toggle = (id: string) =>
    setWidgets((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  /* rolling series for every metric currently on the board */
  useEffect(() => {
    setHistory((prev) => {
      const next = { ...prev };
      for (const id of widgets) {
        const def = runtimeMetrics.find((m) => m.id === id);
        if (!def) continue;
        const series = [...(next[id] ?? []), def.value(t)];
        next[id] = series.length > HISTORY ? series.slice(series.length - HISTORY) : series;
      }
      return next;
    });
  }, [t.tick, widgets]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeRate = t.ai.throughput;
  // True cluster capacity bounded by the specific ACTIVE system model config in the DB
  const capacity = useMemo(() => {
    // 1. Get the current active model from the Engine (Orchestrator) config
    const activeModelId = engine.activeModelId;

    // 2. Fetch that exact model from the PostgreSQL models list
    const activeModel = models.find((m) => m.id === activeModelId || m.modelId === activeModelId);

    // 3. Bind exactly to its maxTokens. If it's a new DB with zero configs, fallback gracefully, but never hardcode generic logic.
    return activeModel?.maxTokens ?? 4096;
  }, [models, engine.activeModelId]);

  const budgetPct = Math.min(100, (activeRate / capacity) * 100);
  const budgetTone = budgetPct > 90 ? "ruby" : budgetPct > 70 ? "topaz" : "emerald";

  const alerts = useMemo(() => {
    const out: { tone: string; text: string }[] = [];
    if (t.ai.p95 > 900)
      out.push({ tone: "ruby", text: `p95 latency ${Math.round(t.ai.p95)} ms over SLO` });
    if (t.ai.hallucination > 4)
      out.push({ tone: "topaz", text: `hallucination rate ${t.ai.hallucination.toFixed(1)}%` });
    if (t.ai.toolErrorRate > 3)
      out.push({ tone: "ruby", text: `tool error rate ${t.ai.toolErrorRate.toFixed(1)}%` });
    if (t.ai.queueDepth > 2600)
      out.push({ tone: "topaz", text: `queue depth ${t.ai.queueDepth} jobs` });
    if (t.host.netErrors > 0)
      out.push({ tone: "topaz", text: `${t.host.netErrors} network errors observed` });
    if (activeRate > capacity * 0.9)
      out.push({
        tone: "ruby",
        text: `throughput ${(activeRate / 1000).toFixed(1)}k/s near capacity`,
      });
    return out.slice(0, 4);
  }, [t, activeRate, capacity]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-canvas/60 backdrop-blur-[2px]"
          />
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="glass fixed right-3 top-3 bottom-3 z-50 flex w-[460px] flex-col overflow-hidden rounded-xl"
          >
            {/* header */}
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="relative inline-flex h-2 w-2">
                  {!paused && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-emerald opacity-60" />
                  )}
                  <span
                    className={cn(
                      "relative h-2 w-2 rounded-full",
                      paused ? "bg-muted-foreground/50" : "bg-emerald",
                    )}
                  />
                </span>
                <span className="mono-label">runtime monitor</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPaused((v) => !v)}
                  aria-label={paused ? "Resume live sampling" : "Pause live sampling"}
                  className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 transition-colors hover:text-foreground"
                  title={paused ? "Resume live sampling" : "Pause live sampling"}
                >
                  {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={onClose}
                  aria-label="Close runtime monitor"
                  className="text-muted-foreground/60 transition-colors hover:text-foreground"
                  title="Close runtime monitor"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <Sheen />

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* widget board */}
              <div className="px-4 pt-4">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="mono-label">widgets</span>
                  <WidgetPicker selected={widgets} onToggle={toggle} />
                </div>
                {widgets.length === 0 ? (
                  <div className="rounded-[10px] border border-dashed border-white/[0.1] px-3 py-6 text-center font-mono text-[11px] text-muted-foreground/45">
                    no widgets pinned — add telemetry from the dropdown
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    {widgets.map((id) => {
                      const def = runtimeMetrics.find((m) => m.id === id);
                      if (!def) return null;
                      return (
                        <Widget
                          key={id}
                          def={def}
                          value={def.value(t)}
                          series={history[id] ?? []}
                          onRemove={() => toggle(id)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="pt-4">
                <Sheen />
              </div>

              {/* cluster capacity */}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <span className="mono-label">cluster bandwidth</span>
                  <span className="font-mono text-[12px]" style={{ color: `var(--${budgetTone})` }}>
                    {(activeRate / 1000).toFixed(1)}k / {(capacity / 1000).toFixed(1)}k tok/s
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div
                    animate={{ width: `${budgetPct}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 22 }}
                    className="h-full rounded-full"
                    style={{
                      background: `var(--${budgetTone})`,
                      boxShadow: `0 0 12px -2px var(--${budgetTone})`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground/50">
                  <span>queue {t.ai.queueDepth}</span>
                  <span>cache hit {t.ai.cacheHit.toFixed(0)}%</span>
                  <span>guardrail {t.ai.guardrailBlocks}</span>
                </div>
              </div>
              <Sheen />

              {/* alerts */}
              <div className="px-5 py-4">
                <div className="mono-label mb-2.5">signals</div>
                {alerts.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-[10px] border border-emerald/25 bg-emerald/[0.06] px-3 py-2.5 font-mono text-[11.5px] text-emerald">
                    <Activity className="h-3.5 w-3.5" /> all envelopes nominal
                  </div>
                ) : (
                  <div className="space-y-2">
                    <AnimatePresence initial={false}>
                      {alerts.map((a) => (
                        <motion.div
                          key={a.text}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 font-mono text-[11.5px]"
                          style={{
                            borderColor: `color-mix(in oklab, var(--${a.tone}) 30%, transparent)`,
                            background: `color-mix(in oklab, var(--${a.tone}) 6%, transparent)`,
                            color: `var(--${a.tone})`,
                          }}
                        >
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{a.text}</span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
              <Sheen />

              {/* fleet */}
              <div className="px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="mono-label">active fleet</span>
                    <select
                      className="cursor-pointer bg-transparent font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground outline-none transition-colors hover:text-foreground focus:ring-0 [&>option]:bg-raised [&>option]:text-foreground"
                      value={fleetFilter}
                      onChange={(e) =>
                        setFleetFilter(e.target.value as "agent" | "workflow" | "orchestrator")
                      }
                    >
                      <option value="agent">Agents</option>
                      <option value="workflow">Workflows</option>
                      <option value="orchestrator">Orchestrators</option>
                    </select>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground/45">
                    {agentsStatus.filter((a) => a.kind === fleetFilter && a.id !== "agt.forge_master" && !a.id.startsWith("sys.") && a.runtime === "executing")
                      .length - Object.values(held).filter(Boolean).length}{" "}
                    running
                  </span>
                </div>
                <div className="space-y-2">
                  {agentsStatus
                    .filter((a) => a.kind === fleetFilter && a.id !== "agt.forge_master" && !a.id.startsWith("sys."))
                    .slice(0, 10)
                    .map((a) => {
                      const s = agentSample(a.id, t.tick);
                      const isHeld = held[a.id];
                      const isExecuting = a.runtime === "executing";
                      const load = isHeld ? 0 : isExecuting ? Math.max(60, s.load) : 0;
                      const tone =
                        a.kind === "workflow"
                          ? "emerald"
                          : a.kind === "orchestrator"
                            ? "amethyst"
                            : "sapphire";
                      return (
                        <div
                          key={a.id}
                          className="group rounded-[10px] border border-white/[0.06] bg-white/[0.012] px-3 py-2.5 transition-colors hover:border-white/[0.13]"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="relative inline-flex h-2 w-2 shrink-0">
                              {!isHeld && !paused && isExecuting && (
                                <span
                                  className="absolute inset-0 animate-ping rounded-full opacity-50"
                                  style={{ background: `var(--${tone})` }}
                                />
                              )}
                              <span
                                className="relative h-2 w-2 rounded-full"
                                style={{
                                  background: isHeld ? "rgba(148,163,184,0.5)" : `var(--${tone})`,
                                }}
                              />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12.5px]">{a.name}</div>
                              <div className="font-mono text-[10px] text-muted-foreground/55">
                                {a.id} {a.meta ? `· ${a.meta}` : ""}
                              </div>
                            </div>
                            <span
                              className="font-mono text-[11.5px]"
                              style={{ color: isHeld ? "rgba(148,163,184,0.6)" : `var(--${tone})` }}
                            >
                              {load.toFixed(0)}%
                            </span>
                            <button
                              onClick={() => setHeld((p) => ({ ...p, [a.id]: !p[a.id] }))}
                              aria-label={isHeld ? `Resume ${a.name}` : `Pause ${a.name}`}
                              title={isHeld ? "Resume agent" : "Pause agent"}
                              className="rounded-md border border-white/[0.08] p-1 text-muted-foreground/60 opacity-0 transition-all hover:border-sapphire/40 hover:text-foreground group-hover:opacity-100"
                            >
                              {isHeld ? (
                                <Play className="h-3 w-3" />
                              ) : (
                                <Pause className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.05]">
                            <motion.div
                              animate={{ width: `${load}%` }}
                              transition={{ type: "spring", stiffness: 110, damping: 20 }}
                              className="h-full rounded-full"
                              style={{
                                background: isHeld ? "rgba(148,163,184,0.35)" : `var(--${tone})`,
                                boxShadow: isHeld ? "none" : `0 0 10px -2px var(--${tone})`,
                              }}
                            />
                          </div>
                          <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground/45">
                            <span>{isHeld || !isExecuting ? "0" : Math.round(s.tokens)} tok/s</span>
                            <span>p95 {isHeld || !isExecuting ? "0" : Math.round(s.p95)} ms</span>
                            <span>q {isHeld || !isExecuting ? 0 : s.queue}</span>
                            <span>ctx {isHeld || !isExecuting ? "0" : s.ctx.toFixed(0)}%</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
