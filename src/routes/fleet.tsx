import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Cpu, Database, Pause, Play, Plus, X } from "lucide-react";
import { Surface, Meter } from "@/components/sovereign/surface";
import { Sheen, StatusDot, Tag } from "@/components/sovereign/primitives";
import { useAgents } from "@/lib/agent-store";
import { useWorkflows } from "@/lib/workflow-store";
import { useChains } from "@/lib/orchestration-store";
import { useSkills } from "@/lib/skill-store";
import { useMcp } from "@/lib/mcp-store";
import { useForge } from "@/lib/forge-store";
import { useCapabilities } from "@/lib/capability-store";
import { useIdentity } from "@/lib/group-store";
import {
  dbTableSample,
  formatUptime,
  useLiveTelemetry,
  useAgentTelemetryStatus,
  useOperatorTelemetryStatus,
  providerUsage,
  agentSample,
} from "@/lib/telemetry-live";
import { useTelemetryBoards, type BoardEntry, type BoardKind } from "@/lib/telemetry-board-store";
import { useEngine } from "@/lib/engine-store";

import { cn } from "@/lib/utils";

type View = "system" | "operators" | "database" | "agents";

const views: View[] = ["system", "operators", "database", "agents"];

export const Route = createFileRoute("/fleet")({
  validateSearch: (search: Record<string, unknown>): { view?: View } => ({
    view: views.includes(search["view"] as View) ? (search["view"] as View) : "system",
  }),

  head: () => ({
    meta: [
      { title: "Fleet Telemetry — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Live cockpit for the Sovereign runtime: host vitals, database health, connected operators, inventory and per-agent telemetry.",
      },
      { property: "og:title", content: "Fleet Telemetry — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Host vitals, AI quality signals and live per-agent telemetry in one cockpit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FleetView,
});

/* ------------------------------------------------------------- primitives */

function Card({
  label,
  meta,
  children,
  className,
}: {
  label: string;
  meta?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-[12px] border border-white/[0.06] bg-white/[0.015] px-5 py-4 ${className ?? ""}`}
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <span className="mono-label">{label}</span>
        {meta && <span className="font-mono text-[10.5px] text-muted-foreground/45">{meta}</span>}
      </div>
      {children}
    </motion.section>
  );
}

function Spark({ data, tone = "sapphire" }: { data: number[]; tone?: string }) {
  const path = useMemo(() => {
    if (!data.length) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    return data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * 100;
        const y = 28 - ((v - min) / span) * 26 - 1;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [data]);

  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-8 w-full">
      <path
        d={path}
        fill="none"
        stroke={`var(--${tone})`}
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
        style={{ filter: `drop-shadow(0 0 5px var(--${tone}))` }}
      />
    </svg>
  );
}

function Vital({
  label,
  value,
  unit,
  pct,
  tone = "sapphire",
  series,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  pct?: number;
  tone?: string;
  series?: number[];
  sub?: string;
}) {
  return (
    <div className="rounded-[10px] border border-white/[0.05] bg-white/[0.012] px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <span className="mono-label">{label}</span>
        {sub && <span className="font-mono text-[10px] text-muted-foreground/45">{sub}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className="font-mono text-[22px] leading-none tracking-tight"
          style={{ color: `var(--${tone})`, textShadow: `0 0 18px var(--${tone})` }}
        >
          {value}
        </span>
        {unit && <span className="font-mono text-[11px] text-muted-foreground/55">{unit}</span>}
      </div>
      {series ? (
        <div className="mt-1.5 -mb-1">
          <Spark data={series} tone={tone} />
        </div>
      ) : pct !== undefined ? (
        <div className="mt-3">
          <Meter value={pct} tone={tone} />
        </div>
      ) : null}
    </div>
  );
}

function KV({ k, v, tone }: { k: string; v: string; tone?: string | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4 py-[7px]">
      <span className="mono-label">{k}</span>
      <span
        className="font-mono text-[12.5px]"
        style={tone ? { color: `var(--${tone})` } : { color: "rgba(226,232,240,0.9)" }}
      >
        {v}
      </span>
    </div>
  );
}

const toneFor = (v: number, warn: number, bad: number) =>
  v >= bad ? "ruby" : v >= warn ? "topaz" : "emerald";

/* ------------------------------------------------------------------ route */

function FleetView() {
  const { view } = Route.useSearch();
  if (view === "agents") return <AgentsTelemetry />;
  if (view === "operators") return <OperatorsTelemetry />;
  if (view === "database") return <DatabaseTelemetry />;
  return <SystemGeneral />;
}

/* --------------------------------------------------------- system general */

function SystemGeneral() {
  const [paused, setPaused] = useState(false);
  const t = useLiveTelemetry(paused);
  const { agents } = useAgents();
  const { workflows } = useWorkflows();
  const { chains } = useChains();
  const { skills } = useSkills();
  const mcp = useMcp();
  const { items: tools } = useForge();
  const { packs } = useCapabilities();
  const { accounts } = useIdentity();

  const h = t.host;
  const ai = t.ai;

  const liveAgents = agents.filter((a) => a.enabled && a.live).length;
  const activeWorkflows = workflows.filter((w) => w.status !== "draft").length;
  const mcpClients = mcp.clients ?? [];
  const online = accounts.filter((a) => !a.locked && a.status === "active");

  return (
    <Surface
      title="System General"
      meta={`live sampler · 2s interval · uptime ${formatUptime(h.uptimeSec)}`}
      wide
      crumb="Fleet Telemetry"
      action={
        <button
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[6px] font-mono text-[11.5px] text-muted-foreground/80 transition-colors hover:border-sapphire/40 hover:text-foreground"
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {paused ? "resume stream" : "pause stream"}
        </button>
      }
    >
      <div className="space-y-8">
        {/* ---------------------------------------------------- host vitals */}
        <Card
          label="host vitals"
          meta={`sov-prod-01 · load ${h.loadAvg.map((l) => l.toFixed(2)).join(" / ")}`}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Vital
              label="cpu"
              value={h.cpu.toFixed(0)}
              unit="%"
              tone={toneFor(h.cpu, 70, 88)}
              series={t.history.cpu}
              sub={`${h.cores.length} cores`}
            />
            <Vital
              label="gpu"
              value={h.gpu.toFixed(0)}
              unit="%"
              tone={toneFor(h.gpu, 80, 93)}
              series={t.history.gpu}
              sub={`${h.gpuTemp.toFixed(0)}°C`}
            />
            <Vital
              label="memory"
              value={((h.ram / 100) * h.ramTotalGb).toFixed(1)}
              unit={`/ ${h.ramTotalGb} GB`}
              tone={toneFor(h.ram, 75, 90)}
              series={t.history.ram}
              sub={`swap ${h.swap.toFixed(1)}%`}
            />
            <Vital
              label="vram"
              value={h.vram.toFixed(0)}
              unit="%"
              pct={h.vram}
              tone={toneFor(h.vram, 80, 93)}
              sub="48 GB pool"
            />
          </div>

          <div className="mt-4 rounded-[10px] border border-white/[0.05] bg-white/[0.012] px-4 py-3.5">
            <div className="mb-3 flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5 text-sapphire" strokeWidth={1.6} />
              <span className="mono-label">per-core load</span>
            </div>
            <div className="flex items-end gap-1.5">
              {h.cores.map((c, i) => (
                <div key={i} className="flex-1">
                  <div className="flex h-14 items-end">
                    <motion.div
                      animate={{ height: `${Math.max(4, c)}%` }}
                      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                      className="w-full rounded-[3px]"
                      style={{
                        background: `var(--${toneFor(c, 70, 90)})`,
                        boxShadow: `0 0 10px -3px var(--${toneFor(c, 70, 90)})`,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 text-center font-mono text-[9px] text-muted-foreground/40">
                    {i}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* ------------------------------------------- network / disk / db */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card label="network interface" meta="eno1 · 10 GbE">
            <div className="grid grid-cols-2 gap-3">
              <Vital
                label="rx"
                value={h.netRx.toFixed(0)}
                unit="Mb/s"
                tone="sapphire"
                series={t.history.netRx}
              />
              <Vital
                label="tx"
                value={h.netTx.toFixed(0)}
                unit="Mb/s"
                tone="amethyst"
                series={t.history.netTx}
              />
            </div>
            <div className="mt-2">
              <KV
                k="errors / drops"
                v={`${h.netErrors} / 0`}
                tone={h.netErrors ? "topaz" : "emerald"}
              />
              <KV k="link" v="up · full duplex" tone="emerald" />
              <KV k="tunnel" v="mTLS · verified" tone="emerald" />
            </div>
          </Card>

          <Card label="storage i/o" meta="nvme raid-10">
            <div className="grid grid-cols-2 gap-3">
              <Vital
                label="read"
                value={h.diskRead.toFixed(0)}
                unit="MB/s"
                tone="emerald"
                pct={Math.min(100, h.diskRead / 6)}
              />
              <Vital
                label="write"
                value={h.diskWrite.toFixed(0)}
                unit="MB/s"
                tone="topaz"
                pct={Math.min(100, h.diskWrite / 4)}
              />
            </div>
            <div className="mt-2">
              <KV k="capacity" v="2.1 / 8.0 TB" />
              <KV k="vector store" v="412 GB · healthy" tone="emerald" />
              <KV k="snapshot" v="18 min ago" />
            </div>
          </Card>

          <Card label="database" meta="postgres 16 · primary">
            <div className="grid grid-cols-2 gap-3">
              <Vital
                label="connections"
                value={`${h.dbConns}`}
                unit={`/ ${h.dbPool}`}
                tone={toneFor((h.dbConns / h.dbPool) * 100, 70, 90)}
                pct={(h.dbConns / h.dbPool) * 100}
              />
              <Vital
                label="qps"
                value={h.dbQps.toFixed(0)}
                unit="q/s"
                tone="sapphire"
                pct={Math.min(100, h.dbQps / 18)}
              />
            </div>
            <div className="mt-2">
              <KV k="status" v="online" tone="emerald" />
              <KV
                k="replica lag"
                v={`${h.dbLagMs.toFixed(0)} ms`}
                tone={toneFor(h.dbLagMs, 60, 100)}
              />
              <KV k="wal / cache hit" v="ok · 99.2%" tone="emerald" />
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------------ inventory */}
        <Card label="studio inventory" meta="read-only telemetry · no navigation">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
            {[
              { label: "agents", total: t.inventory.agents.total, run: t.inventory.agents.active, tone: "sapphire" },
              {
                label: "workflows",
                total: t.inventory.workflows.total,
                run: t.inventory.workflows.active,
                tone: "emerald",
              },
              {
                label: "orchestrators",
                total: t.inventory.orchestrators.total,
                run: t.inventory.orchestrators.active,
                tone: "amethyst",
              },
              {
                label: "skills",
                total: t.inventory.skills.total,
                run: t.inventory.skills.active,
                tone: "topaz",
              },
              {
                label: "tools",
                total: t.inventory.tools.total,
                run: t.inventory.tools.active,
                tone: "emerald",
              },
              {
                label: "capability packs",
                total: t.inventory.packs.total,
                run: t.inventory.packs.active,
                tone: "amethyst",
              },
              {
                label: "mcp clients",
                total: t.inventory.mcp.total,
                run: t.inventory.mcp.active,
                tone: "ruby",
              },
              { label: "users", total: t.inventory.users.total, run: t.inventory.users.active, tone: "sapphire" },
            ].map((x) => (
              <div
                key={x.label}
                className="rounded-[10px] border border-white/[0.05] bg-white/[0.012] px-4 py-3.5"
              >
                <div className="mono-label">{x.label}</div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span
                    className="font-mono text-[22px] leading-none"
                    style={{ color: `var(--${x.tone})`, textShadow: `0 0 18px var(--${x.tone})` }}
                  >
                    {x.total}
                  </span>
                  <span className="font-mono text-[10.5px] text-muted-foreground/50">
                    {x.run} active
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* ---------------------------------------------- ai quality signals */}
        <Card label="ai quality &amp; throughput" meta="rolling 5 min window">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Vital
              label="throughput"
              value={(ai.throughput / 1000).toFixed(1)}
              unit="k tok/s"
              tone="sapphire"
              series={t.history.throughput}
            />
            <Vital
              label="p95 latency"
              value={ai.p95.toFixed(0)}
              unit="ms"
              tone={toneFor(ai.p95, 800, 1500)}
              series={t.history.p95}
            />
            <Vital
              label="hallucination"
              value={ai.hallucination.toFixed(2)}
              unit="%"
              tone={toneFor(ai.hallucination, 3, 5)}
              series={t.history.hallucination}
            />
            <Vital
              label="groundedness"
              value={ai.groundedness.toFixed(1)}
              unit="%"
              tone={ai.groundedness < 90 ? "topaz" : "emerald"}
              pct={ai.groundedness}
            />
          </div>
          <div className="mt-4 grid gap-x-8 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
            <KV k="time to first token" v={`${ai.ttft.toFixed(0)} ms`} />
            <KV k="p50 latency" v={`${ai.p50.toFixed(0)} ms`} />
            <KV
              k="queue depth"
              v={`${ai.queueDepth}`}
              tone={ai.queueDepth > 2000 ? "topaz" : undefined}
            />
            <KV
              k="tool error rate"
              v={`${ai.toolErrorRate.toFixed(2)} %`}
              tone={toneFor(ai.toolErrorRate, 2, 4)}
            />
            <KV k="refusal rate" v={`${ai.refusalRate.toFixed(2)} %`} />
            <KV k="prompt cache hit" v={`${ai.cacheHit.toFixed(0)} %`} tone="emerald" />
            <KV
              k="guardrail blocks"
              v={`${ai.guardrailBlocks}`}
              tone={ai.guardrailBlocks ? "topaz" : "emerald"}
            />
            <KV k="spend / hour" v={`$${ai.costPerHour.toFixed(2)}`} tone="topaz" />
            <KV k="retrieval recall" v="94.1 %" tone="emerald" />
          </div>
        </Card>
      </div>
    </Surface>
  );
}

/* -------------------------------------------------------- agent telemetry */

function AgentsTelemetry() {
  const [paused, setPaused] = useState(false);
  const t = useLiveTelemetry(paused);
  const agentsStatus = useAgentTelemetryStatus(paused);
  const { agents } = useAgents();
  const { workflows } = useWorkflows();
  const { skills } = useSkills();
  const { clients: mcpClients } = useMcp();
  const { boards, active, hydrated, addEntries, removeEntry } = useTelemetryBoards();
  const { config: engine } = useEngine();
  const [pickerOpen, setPickerOpen] = useState(false);

  const catalog = useMemo(() => {
    const rows: CatalogRow[] = [];
    agents.forEach((a) => rows.push({ kind: "agent", id: a.id, name: a.name, meta: a.squad }));
    workflows.forEach((w) =>
      rows.push({ kind: "workflow", id: w.id, name: w.name, meta: "workflow" }),
    );
    skills.forEach((k) => rows.push({ kind: "skill", id: k.id, name: k.name, meta: k.squad }));
    mcpClients.forEach((c) =>
      rows.push({ kind: "tool", id: c.id, name: c.name, meta: `${c.tools} tools` }),
    );
    return rows;
  }, [agents, workflows, skills, mcpClients]);

  const board = boards.find((b) => b.id === active) ?? boards[0];
  const lookup = (e: BoardEntry) => catalog.find((c) => c.kind === e.kind && c.id === e.id);

  /** RAG state for agents only: engine mode can force it, agents carry their own switch. */
  const ragState = (e: BoardEntry): boolean => {
    if (e.kind !== "agent") return false;
    if (engine.ragMode === "never") return false;
    if (engine.ragMode === "always") return true;
    const a = agents.find((x) => x.id === e.id);
    return !!a?.rag;
  };

  if (hydrated && !board) {
    return (
      <Surface title="Telemetry Cards" meta="no cards yet" wide crumb="Fleet Telemetry">
        <div className="rounded-[12px] border border-dashed border-white/[0.10] bg-white/[0.012] px-6 py-12 text-center">
          <div className="text-[15px] text-foreground/85">No telemetry card yet</div>
          <div className="mono-label mt-1.5">
            use “Add card” in the header — e.g. “Social Media Squad” — then deploy agents,
            workflows, skills or tools into it
          </div>
        </div>
      </Surface>
    );
  }

  return (
    <Surface
      title={board?.name ?? "Telemetry"}
      meta={`${board?.entries.length ?? 0} streams · 2s interval`}
      wide
      crumb="Fleet Telemetry"
      action={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[6px] font-mono text-[11.5px] text-muted-foreground/80 transition-colors hover:border-sapphire/40 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> add stream
          </button>
          <StreamToggle paused={paused} onToggle={() => setPaused((p) => !p)} />
        </div>
      }
    >
      {board && board.entries.length === 0 ? (
        <button
          onClick={() => setPickerOpen(true)}
          className="flex w-full items-center gap-3 rounded-[12px] border border-dashed border-white/[0.10] bg-white/[0.012] px-6 py-10 transition-colors hover:border-sapphire/45"
        >
          <span className="mx-auto text-center">
            <span className="block text-[14px] text-foreground/85">This card is empty</span>
            <span className="mono-label mt-1 block">
              deploy agents · workflows · skills · tools into “{board.name}”
            </span>
          </span>
        </button>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {board?.entries.map((e, i) => {
            const item = lookup(e);
            
            // First map from realistic data if available, fallback to wave
            let s = agentSample(e.id, t.tick);
            const liveStat = agentsStatus.find((a) => a.id === e.id && a.kind === e.kind);
            if (liveStat) {
              const isExecuting = liveStat.runtime === "executing";
              const calls = liveStat.calls ?? liveStat.metrics?.calls ?? 0;
              const success = liveStat.success ?? liveStat.metrics?.success ?? 0;
              const errors =
                success > 0
                  ? Number(((calls - success) / (calls || 1)).toFixed(2))
                  : calls > 0
                    ? 1
                    : 0;

              s = {
                ...s,
                load: isExecuting ? Math.max(60, s.load) : 0,
                tokens: isExecuting ? s.tokens : 0,
                p95: isExecuting ? s.p95 : 0,
                errors,
                queue: isExecuting ? Math.max(1, s.queue) : 0,
                ctx: isExecuting ? s.ctx : 0,
              };
            }

            return (
              <StreamCard
                key={`${e.kind}:${e.id}`}
                index={i}
                name={item?.name ?? e.id}
                meta={item?.meta ?? "unavailable"}
                id={e.id}
                kind={e.kind}
                paused={paused}
                rag={e.kind === "agent" ? ragState(e) : undefined}
                sample={s}
                onRemove={() => board && removeEntry(board.id, e)}
              />
            );
          })}
        </div>
      )}

      {pickerOpen && board && (
        <StreamPicker
          catalog={catalog.filter(
            (c) => !board.entries.some((e) => e.kind === c.kind && e.id === c.id),
          )}
          boardName={board.name}
          onClose={() => setPickerOpen(false)}
          onDeploy={(entries) => {
            addEntries(board.id, entries);
            setPickerOpen(false);
          }}
        />
      )}
    </Surface>
  );
}

const kindTone: Record<BoardKind, string> = {
  agent: "emerald",
  workflow: "sapphire",
  skill: "amethyst",
  tool: "topaz",
};

function toneClass(tone: string | undefined) {
  return tone === "topaz"
    ? "text-topaz"
    : tone === "ruby"
      ? "text-ruby"
      : tone === "emerald"
        ? "text-emerald"
        : "text-foreground/80";
}

function StreamCard({
  index,
  name,
  meta,
  id,
  kind,
  paused,
  rag,
  sample,
  onRemove,
}: {
  index: number;
  name: string;
  meta: string;
  id: string;
  kind: BoardKind;
  paused: boolean;
  rag: boolean | undefined;
  sample: ReturnType<typeof agentSample>;
  onRemove: () => void;
}) {
  const tone = kindTone[kind] as "emerald";
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: Math.min(index, 8) * 0.03, ease: [0.22, 1, 0.36, 1] }}
      className="group relative rounded-[14px] border border-white/[0.06] bg-white/[0.015] px-5 py-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-[6px]">
            <StatusDot tone={tone} pulse={!paused} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium text-foreground/95">{name}</div>
            <div className="mono-label mt-0.5 truncate">
              {id} · {meta}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {kind === "agent" && (
            <span
              title={`RAG ${rag ? "on" : "off"}`}
              className={cn(
                "rounded-md border px-1.5 py-[2px] font-mono text-[10.5px] uppercase tracking-[0.12em]",
                rag
                  ? "border-emerald/35 bg-emerald/[0.08] text-emerald shadow-[0_0_8px_hsl(var(--emerald)/0.25)]"
                  : "border-white/[0.08] bg-white/[0.02] text-muted-foreground/55",
              )}
            >
              rag
            </span>
          )}
          <Tag tone={tone}>{kind}</Tag>

          <button
            onClick={onRemove}
            aria-label={`Remove ${name}`}
            className="rounded-md p-1 text-muted-foreground/0 transition-colors hover:text-ruby group-hover:text-muted-foreground/45"
            title={`Remove ${name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Vital
          label="load"
          value={sample.load.toFixed(0)}
          unit="%"
          pct={sample.load}
          tone={toneFor(sample.load, 75, 90)}
        />
        <Vital
          label="tok/s"
          value={sample.tokens.toFixed(0)}
          pct={Math.min(100, (sample.tokens / 4000) * 100)}
          tone="sapphire"
        />
        <Vital
          label="p95"
          value={sample.p95.toFixed(0)}
          unit="ms"
          pct={Math.min(100, (sample.p95 / 1500) * 100)}
          tone={toneFor(sample.p95, 700, 1200)}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 border-t border-white/[0.05] pt-1.5">
        <KV k="queue" v={String(sample.queue)} />
        <KV k="error rate" v={`${sample.errors} %`} tone={toneFor(sample.errors, 2, 4)} />
        <KV k="context used" v={`${sample.ctx.toFixed(0)} %`} tone={toneFor(sample.ctx, 75, 92)} />
        <KV k="stream" v={paused ? "paused" : "streaming"} tone={paused ? "topaz" : "emerald"} />
      </div>
    </motion.section>
  );
}

type CatalogRow = { kind: BoardKind; id: string; name: string; meta: string };

function StreamPicker({
  catalog,
  boardName,
  onClose,
  onDeploy,
}: {
  catalog: CatalogRow[];
  boardName: string;
  onClose: () => void;
  onDeploy: (entries: BoardEntry[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<BoardKind | "all">("all");
  const [picked, setPicked] = useState<BoardEntry[]>([]);

  const rows = catalog.filter(
    (c) =>
      (kind === "all" || c.kind === kind) &&
      (c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.meta.toLowerCase().includes(query.toLowerCase())),
  );

  const has = (c: CatalogRow) => picked.some((p) => p.kind === c.kind && p.id === c.id);

  const toggle = (c: CatalogRow) =>
    setPicked((p) =>
      has(c)
        ? p.filter((x) => !(x.kind === c.kind && x.id === c.id))
        : [...p, { kind: c.kind, id: c.id }],
    );

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="obsidian-slab fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(96vw,860px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[16px] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[17px] text-foreground/95">Deploy streams</div>
            <div className="mono-label mt-1">into “{boardName}”</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {(["all", "agent", "workflow", "skill", "tool"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                "rounded-md border px-3 py-1 font-mono text-[11.5px] transition-colors",
                kind === k
                  ? "border-sapphire/45 bg-sapphire/10 text-foreground"
                  : "border-white/[0.08] text-muted-foreground/60 hover:text-foreground",
              )}
            >
              {k}
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search…"
            className="ml-auto w-[200px] rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-1.5 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-sapphire/45"
          />
        </div>

        <div className="mt-4 max-h-[340px] overflow-y-auto rounded-[12px] border border-white/[0.06]">
          {rows.length === 0 && (
            <div className="mono-label px-4 py-6 text-center">nothing matches</div>
          )}
          {rows.map((c) => (
            <button
              key={`${c.kind}:${c.id}`}
              onClick={() => toggle(c)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 text-left transition-colors last:border-b-0",
                has(c) ? "bg-sapphire/[0.07]" : "hover:bg-white/[0.03]",
              )}
            >
              <span
                className={cn(
                  "grid h-4 w-4 place-items-center rounded-[4px] border",
                  has(c) ? "border-sapphire bg-sapphire/25" : "border-white/15",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground/90">
                {c.name}
              </span>
              <span className="mono-label">{c.meta}</span>
              <Tag tone={kindTone[c.kind] as "emerald"}>{c.kind}</Tag>
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <span className="mono-label">{picked.length} streams selected</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-white/[0.08] px-4 py-2 font-mono text-[12px] text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              cancel
            </button>
            <button
              onClick={() => onDeploy(picked)}
              disabled={!picked.length}
              className="rounded-lg border border-emerald/40 bg-emerald/10 px-4 py-2 font-mono text-[12px] text-emerald transition-colors hover:bg-emerald/20 disabled:opacity-40"
            >
              deploy
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- operators */

const fmtTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : `${n}`;

function StreamToggle({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[6px] font-mono text-[11.5px] text-muted-foreground/80 transition-colors hover:border-sapphire/40 hover:text-foreground"
    >
      {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
      {paused ? "resume stream" : "pause stream"}
    </button>
  );
}

function OperatorsTelemetry() {
  const [paused, setPaused] = useState(false);
  const t = useLiveTelemetry(paused);
  const agentsStatus = useAgentTelemetryStatus(paused);
  const opData = useOperatorTelemetryStatus(paused);
  const { accounts, groups, groupsOf } = useIdentity();

  const online = accounts.filter((a) => !a.locked && a.status === "active");
  const usage: any[] = opData.providers.length > 0 ? opData.providers : [];
  
  const localTokens = usage
    .filter((p: any) => p.hosting === "local")
    .reduce((s: number, p: any) => s + p.tokensIn + p.tokensOut, 0);
  const cloudTokens = usage
    .filter((p: any) => p.hosting === "cloud")
    .reduce((s: number, p: any) => s + p.tokensIn + p.tokensOut, 0);
  const cloudCost = usage.reduce((s: number, p: any) => s + p.costUsd, 0);
  const total = localTokens + cloudTokens || 1;

  return (
    <Surface
      title="Operators"
      meta={`${online.length} live sessions · ${groups.length} groups · token ledger 24 h`}
      wide
      crumb="Fleet Telemetry"
      action={<StreamToggle paused={paused} onToggle={() => setPaused((p) => !p)} />}
    >
      <div className="space-y-8">
        <Card label="token ledger" meta="rolling 24 h · local vs cloud split">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Vital
              label="local tokens"
              value={fmtTokens(localTokens)}
              tone="emerald"
              pct={(localTokens / total) * 100}
              sub={`${((localTokens / total) * 100).toFixed(0)} % of fleet`}
            />
            <Vital
              label="cloud tokens"
              value={fmtTokens(cloudTokens)}
              tone="sapphire"
              pct={(cloudTokens / total) * 100}
              sub={`${((cloudTokens / total) * 100).toFixed(0)} % of fleet`}
            />
            <Vital label="cloud spend" value={`$${cloudCost.toFixed(2)}`} tone="topaz" sub="24 h" />
            <Vital
              label="requests"
              value={fmtTokens(usage.reduce((s: number, p: any) => s + p.requests, 0))}
              tone="amethyst"
              sub={`${usage.length} providers`}
            />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {[
                    "provider",
                    "hosting",
                    "model",
                    "tokens in",
                    "tokens out",
                    "requests",
                    "p95",
                    "err",
                    "cost",
                  ].map((c) => (
                    <th key={c} className="mono-label py-2 text-left font-normal last:text-right">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usage.map((p: any) => (
                  <tr key={p.id} className="border-b border-white/[0.04] last:border-b-0">
                    <td className="py-2.5 text-[13px] text-foreground/90">{p.name}</td>
                    <td className="py-2.5">
                      <Tag tone={p.hosting === "local" ? "emerald" : "sapphire"}>{p.hosting}</Tag>
                    </td>
                    <td className="py-2.5 font-mono text-[11.5px] text-muted-foreground/60">
                      {p.model}
                    </td>
                    <td className="py-2.5 font-mono text-[12px]">{fmtTokens(p.tokensIn)}</td>
                    <td className="py-2.5 font-mono text-[12px]">{fmtTokens(p.tokensOut)}</td>
                    <td className="py-2.5 font-mono text-[12px]">{fmtTokens(p.requests)}</td>
                    <td
                      className="py-2.5 font-mono text-[12px]"
                      style={{ color: `var(--${toneFor(p.p95, 600, 1200)})` }}
                    >
                      {p.p95} ms
                    </td>
                    <td
                      className="py-2.5 font-mono text-[12px]"
                      style={{ color: `var(--${toneFor(p.errorRate, 2, 4)})` }}
                    >
                      {p.errorRate} %
                    </td>
                    <td className="py-2.5 text-right font-mono text-[12px] text-topaz">
                      {p.costUsd ? `$${p.costUsd.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          label="connected operators"
          meta={`${online.length} live · per-principal provider spend`}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {online.map((a, i) => {
              const uMatch = opData.accounts.find((x: any) => x.accountId === a.id);
              
              // Aggregate real account usage from API
              const acctProviders = opData.accounts.filter((x: any) => x.accountId === a.id);
              const totalAcctTokens = acctProviders.reduce((s: number, x: any) => s + x.tokensIn + x.tokensOut, 0);
              const totalAcctReq = acctProviders.reduce((s: number, x: any) => s + x.requests, 0);
              const totalAcctP95 = acctProviders.length > 0 ? Math.max(...acctProviders.map((x: any) => x.p95)) : 0;
              
              const u = {
                tokens: totalAcctTokens,
                requests: totalAcctReq,
                p95: totalAcctP95,
                costUsd: 0, // Currently no cost tracking
                sessions: 1, 
                providers: acctProviders.map((p: any) => ({
                   provider: p.providerName,
                   hosting: p.hosting,
                   model: "default",
                   tokens: p.tokensIn + p.tokensOut,
                   costUsd: 0,
                }))
              };
              
              const s = agentSample(a.id, t.tick);
              const memberOf = groupsOf(a.id);

              const opAgentCalls =
                agentsStatus.reduce((acc, st) => acc + (st.calls ?? st.metrics?.calls ?? 0), 0) /
                Math.max(1, online.length);
              
              return (
                <div
                  key={a.id}
                  className="rounded-[10px] border border-white/[0.05] bg-white/[0.012] px-4 py-3.5"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1.5">
                      <StatusDot tone={i % 3 === 0 ? "sapphire" : "emerald"} pulse={i % 3 === 0} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] text-foreground/95">{a.name}</div>
                      <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground/55">
                        {a.username} · {a.role} · {a.provider} ·{" "}
                        {memberOf.map((g) => g.name).join(", ") || "no group"}
                      </div>
                    </div>
                    <span className="font-mono text-[10.5px] text-muted-foreground/45">
                      {a.lastSeen}
                    </span>
                  </div>

                  <div className="my-3.5">
                    <Sheen />
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    <Vital label="tokens" value={fmtTokens(u.tokens)} tone="sapphire" />
                    <Vital label="requests" value={`${u.requests + Math.round(opAgentCalls)}`} tone="amethyst" />
                    <Vital
                      label="p95"
                      value={`${u.p95}`}
                      unit="ms"
                      tone={toneFor(u.p95, 700, 1200)}
                    />
                    <Vital label="spend" value={`$${u.costUsd.toFixed(2)}`} tone="topaz" />
                  </div>

                  <div className="mt-3 space-y-1">
                    {u.providers.map((p) => (
                      <div key={p.provider} className="flex items-center gap-3 py-[5px]">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            background: `var(--${p.hosting === "local" ? "emerald" : "sapphire"})`,
                            boxShadow: `0 0 8px -1px var(--${p.hosting === "local" ? "emerald" : "sapphire"})`,
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/80">
                          {p.provider}
                          <span className="ml-2 font-mono text-[10.5px] text-muted-foreground/45">
                            {p.model}
                          </span>
                        </span>
                        <span className="font-mono text-[11.5px] text-muted-foreground/70">
                          {fmtTokens(p.tokens)} tok
                        </span>
                        <span className="w-14 text-right font-mono text-[11.5px] text-topaz">
                          {p.costUsd ? `$${p.costUsd.toFixed(2)}` : "local"}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 font-mono text-[10.5px] text-muted-foreground/40">
                    {u.sessions} session{u.sessions > 1 ? "s" : ""} · {s.queue} queued
                  </div>
                </div>
              );
            })}
            {online.length === 0 && (
              <p className="font-mono text-[11.5px] text-muted-foreground/45">no active sessions</p>
            )}
          </div>
        </Card>
      </div>
    </Surface>
  );
}

/* -------------------------------------------------------------- database */

function DatabaseTelemetry() {
  const [paused, setPaused] = useState(false);
  const t = useLiveTelemetry(paused);
  const h = t.host;

  const samples = t.dbTables.map((tb) => ({ ...tb, s: tb.s || dbTableSample(tb.name, t.tick) }));
  const totalSize = t.dbMetrics.totalSizeBytes / (1024 * 1024) || t.dbTables.reduce((s, x) => s + x.sizeMb + x.indexMb, 0);
  const totalRows = t.dbTables.reduce((s, x) => s + x.rows, 0);
  const reads = t.dbMetrics.clusterReads;
  const writes = t.dbMetrics.clusterWrites;

  return (
    <Surface
      title="Database"
      meta={`postgres 16 · ${t.dbTables.length} tables · ${totalSize >= 1024 ? (totalSize / 1024).toFixed(1) : totalSize.toFixed(1)} ${totalSize >= 1024 ? "GB" : "MB"}`}
      wide
      crumb="Fleet Telemetry"
      action={<StreamToggle paused={paused} onToggle={() => setPaused((p) => !p)} />}
    >
      <div className="space-y-8">
        <Card label="cluster health" meta="primary · 1 replica">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Vital
              label="connections"
              value={`${h.dbConns}`}
              unit={`/ ${h.dbPool}`}
              tone={toneFor((h.dbConns / h.dbPool) * 100, 70, 90)}
              pct={(h.dbConns / h.dbPool) * 100}
            />
            <Vital
              label="throughput"
              value={t.dbMetrics.throughput.toFixed(0)}
              unit="q/s"
              tone="sapphire"
              pct={Math.min(100, t.dbMetrics.throughput / 18)}
            />
            <Vital
              label="replica lag"
              value={h.dbLagMs.toFixed(0)}
              unit="ms"
              tone={toneFor(h.dbLagMs, 60, 100)}
              pct={Math.min(100, h.dbLagMs)}
            />
            <Vital
              label="dataset"
              value={totalSize >= 1024 ? (totalSize / 1024).toFixed(1) : totalSize.toFixed(1)}
              unit={totalSize >= 1024 ? "GB" : "MB"}
              tone="amethyst"
              sub={`${(totalRows / 1_000_000).toFixed(2)}M rows`}
            />
          </div>
          <div className="mt-4 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            <KV k="reads / s" v={reads.toFixed(0)} tone="emerald" />
            <KV k="writes / s" v={writes.toFixed(0)} tone="topaz" />
            <KV k="cache hit ratio" v={`${t.dbMetrics.cacheHitRatio} %`} tone="emerald" />
            <KV k="wal" v="local · sync" tone="emerald" />
            <KV k="autovacuum" v={t.dbMetrics.autovacuum} tone={t.dbMetrics.autovacuum === "active" ? "topaz" : "emerald"} />
            <KV k="last backup" v="local" tone="emerald" />
          </div>
        </Card>

        <Card label="tables" meta="live per-relation i/o">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {[
                    "table",
                    "rows",
                    "size",
                    "index",
                    "reads/s",
                    "writes/s",
                    "idx hit",
                    "seq scans",
                    "locks",
                    "latency",
                  ].map((c) => (
                    <th key={c} className="mono-label py-2 text-left font-normal last:text-right">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {samples.map((tb) => (
                  <tr key={tb.name} className="border-b border-white/[0.04] last:border-b-0">
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <Database
                          className="h-3.5 w-3.5"
                          strokeWidth={1.5}
                          style={{
                            color: `var(--${
                              tb.kind === "vector"
                                ? "amethyst"
                                : tb.kind === "audit"
                                  ? "ruby"
                                  : tb.kind === "queue"
                                    ? "topaz"
                                    : "sapphire"
                            })`,
                          }}
                        />
                        <span className="font-mono text-[12.5px] text-foreground/90">
                          {tb.schema}.{tb.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 font-mono text-[12px]">{fmtTokens(tb.rows)}</td>
                    <td className="py-2.5 font-mono text-[12px]">
                      {tb.sizeMb >= 1024
                        ? `${(tb.sizeMb / 1024).toFixed(1)} GB`
                        : `${tb.sizeMb} MB`}
                    </td>
                    <td className="py-2.5 font-mono text-[12px] text-muted-foreground/65">
                      {tb.indexMb >= 1024
                        ? `${(tb.indexMb / 1024).toFixed(1)} GB`
                        : `${tb.indexMb} MB`}
                    </td>
                    <td className="py-2.5 font-mono text-[12px] text-emerald">
                      {tb.s.reads.toFixed(0)}
                    </td>
                    <td className="py-2.5 font-mono text-[12px] text-topaz">
                      {tb.s.writes.toFixed(0)}
                    </td>
                    <td
                      className="py-2.5 font-mono text-[12px]"
                      style={{ color: `var(--${tb.s.indexHit < 95 ? "topaz" : "emerald"})` }}
                    >
                      {tb.s.indexHit.toFixed(2)} %
                    </td>
                    <td
                      className="py-2.5 font-mono text-[12px]"
                      style={{ color: `var(--${toneFor(tb.s.seqScans, 10, 16)})` }}
                    >
                      {tb.s.seqScans}
                    </td>
                    <td className="py-2.5 font-mono text-[12px]">{tb.s.locks}</td>
                    <td
                      className="py-2.5 text-right font-mono text-[12px]"
                      style={{ color: `var(--${toneFor(tb.s.latencyMs, 4, 6)})` }}
                    >
                      {tb.s.latencyMs.toFixed(2)} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card label="storage footprint" meta="table + index share">
            <div className="space-y-2.5">
              {samples
                .slice()
                .sort((a, b) => b.sizeMb + b.indexMb - (a.sizeMb + a.indexMb))
                .slice(0, 6)
                .map((tb) => {
                  const pct = totalSize > 0 ? ((tb.sizeMb + tb.indexMb) / totalSize) * 100 : 0;
                  return (
                    <div key={tb.name}>
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-[11.5px] text-foreground/80">
                          {tb.name}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground/50">
                          {pct.toFixed(1)} %
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <Meter value={pct} tone={tb.kind === "vector" ? "amethyst" : "sapphire"} />
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>

          <Card label="maintenance signals" meta="dead tuples · vacuum · slow queries">
            <div className="grid gap-x-8 sm:grid-cols-2">
              {samples
                .slice()
                .sort((a, b) => b.s.bloat - a.s.bloat)
                .slice(0, 6)
                .map((tb) => (
                <KV
                  key={tb.name}
                  k={`${tb.name.replace(/_/g, " ")} dead tuples`}
                  v={`${tb.s.bloat.toFixed(1)} %`}
                  tone={toneFor(tb.s.bloat, 30, 80)}
                />
              ))}
            </div>
            <div className="mt-3">
              <Sheen />
            </div>
            <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
              <KV k="slow queries (>500 ms)" v={`${t.dbMetrics.slowQueries} / 5 min`} tone={t.dbMetrics.slowQueries > 0 ? "topaz" : "emerald"} />
              <KV k="deadlocks" v={`${t.dbMetrics.deadlocks}`} tone={t.dbMetrics.deadlocks > 0 ? "ruby" : "emerald"} />
              <KV k="temp files" v={`${t.dbMetrics.tempFiles} · ${(t.dbMetrics.tempBytes / (1024 * 1024)).toFixed(1)} MB`} />
              <KV k="idle in transaction" v={`${t.dbMetrics.idleInTx}`} tone={t.dbMetrics.idleInTx > 0 ? "topaz" : "emerald"} />
            </div>
          </Card>
        </div>
      </div>
    </Surface>
  );
}
