import { createFileRoute } from "@tanstack/react-router";
import { canEdit as canEditOwned, editRefusal } from "@/lib/ownership";
import { ReadOnlyBanner, SharePopover } from "@/components/sovereign/ownership-controls";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Copy, Plus, Save, Trash2, Workflow } from "lucide-react";
import { Shell } from "@/components/sovereign/shell";
import { JewelButton } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { WorkflowCanvas } from "@/components/sovereign/workflow-canvas";
import { TriggerScheduleCard } from "@/components/sovereign/trigger-schedule-card";
import { OutputBindingCard } from "@/components/sovereign/output-binding-card";
import { nodeGlyph } from "@/lib/node-glyph";
import { RunControls } from "@/components/sovereign/run-controls";
import { useRunController } from "@/lib/run-controller";
import { toast } from "sonner";
import { fetchApi } from "@/lib/api";
import { guardRun, signPayload, useVerdict } from "@/lib/signing";
import { SignatureBadge } from "@/components/sovereign/signature-badge";
import { useChains, type StudioChain } from "@/lib/orchestration-store";
import { useWorkflows } from "@/lib/workflow-store";
import { jewelPalette } from "@/lib/avatar-library";
import { orchestrationControls, orchestrationLogic } from "@/mocks/orchestrations";
import type { WorkflowNodeKind } from "@/mocks/workflows";

export const Route = createFileRoute("/orchestration")({
  head: () => ({
    meta: [
      { title: "Orchestration — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Wire whole workflows into sovereign chains: each chain is a tab, each stage is a pipeline, magnet-snapped through branch, merge and approval control nodes.",
      },
      { property: "og:title", content: "Orchestration — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Magnetic workflow-to-workflow orchestration graph for the whole fleet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OrchestrationDesigner,
});

const nid = () => `o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

function OrchestrationDesigner() {
  const { chains, ctx: ownerCtx, hydrated, activeId, create, update, duplicate } = useChains();
  const { workflows } = useWorkflows();
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [liveRunId, setLiveRunId] = useState<string | null>(null);

  const active = chains.find((c) => c.id === activeId) ?? chains[0];
  const activeKey = active?.id;
  const savedView = active?.view;
  const selectedNode = active?.nodes.find((n) => n.id === selected);

  // restore the saved canvas position/zoom once the store is hydrated
  // and again whenever the active chain changes
  const restoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || !activeKey) return;
    if (restoredRef.current === activeKey) return;
    restoredRef.current = activeKey;
    setPan({ x: savedView?.x ?? 0, y: savedView?.y ?? 0 });
    setZoom(savedView?.zoom ?? 0.9);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, hydrated, savedView]);

  const runSteps = useMemo(() => {
    if (!active) return [];
    
    // Sort nodes topologically (mock visual execution matching the backend behavior)
    const { nodes, edges } = active;
    const incoming = new Map<string, number>();
    nodes.forEach(n => incoming.set(n.id, 0));
    edges.forEach(e => incoming.set(e.to, (incoming.get(e.to) || 0) + 1));
    
    const queue: typeof nodes = [];
    const triggers = nodes.filter(n => n.kind === "trigger" || n.label.toLowerCase().includes("trigger"));
    if (triggers.length > 0) {
      queue.push(...triggers);
    } else {
      queue.push(...nodes.filter(n => (incoming.get(n.id) || 0) === 0));
    }
    
    const sorted = [];
    const visited = new Set<string>();
    
    while (queue.length > 0 && sorted.length < nodes.length) {
      const node = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      sorted.push({ id: node.id, label: node.label });
      
      const branches = edges.filter(e => e.from === node.id);
      for (const e of branches) {
        const next = nodes.find(n => n.id === e.to);
        if (next && !visited.has(next.id)) queue.push(next);
      }
    }
    
    // Fallback for isolated nodes
    for (const node of nodes) {
      if (!visited.has(node.id)) sorted.push({ id: node.id, label: node.label });
    }
    
    return sorted;
  }, [active]);
  const payload = useMemo(
    () => ({
      nodes: (active?.nodes ?? []).map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        meta: n.meta,
      })),
      edges: (active?.edges ?? []).map((e) => ({ id: e.id, from: e.from, to: e.to })),
    }),
    [active],
  );
  const verdict = useVerdict(active?.id, payload);

  const run = useRunController({
    preflight: () => {
      if (!active) return false;
      const verdictNow = guardRun(active.id, active.name, payload);
      if (verdictNow.blocked) {
        toast.error("Blocked by signed workflow policy", {
          description: verdictNow.message ?? "signature verification failed",
        });
        return false;
      }
      if (verdictNow.message) {
        toast.warning("Signature warning", { description: verdictNow.message });
      }

      // Trigger backend execution
      fetchApi(`/api/chains/${active.id}/run`, {
        method: "POST",
        body: JSON.stringify({ context: {} })
      }).then(res => {
        if (res.runId) setLiveRunId(res.runId);
      }).catch(err => console.error("Failed to trigger orchestration chain", err));

      return true;
    },
    onStop: () => {
      if (liveRunId) {
        fetchApi(`/api/chains/runs/${liveRunId}/stop`, { method: "POST" })
          .catch(err => console.error("Failed to stop chain run", err));
        setLiveRunId(null);
      }
    },
    onRestart: () => {
      if (liveRunId) {
        fetchApi(`/api/chains/runs/${liveRunId}/stop`, { method: "POST" })
          .catch(() => {});
      }
      if (!active) return;
      
      // Trigger new backend execution
      fetchApi(`/api/chains/${active.id}/run`, {
        method: "POST",
        body: JSON.stringify({ context: {} })
      }).then(res => {
        if (res.runId) setLiveRunId(res.runId);
      }).catch(err => console.error("Failed to trigger orchestration chain", err));
    },
    steps: runSteps,
    label: active?.name ?? "Orchestration",
    intervalMs: 1100,
    onComplete: () => {
      if (active) update(active.id, { runs: active.runs + 1 });
    },
  });

  useEffect(() => setSelected(run.current?.id ?? null), [run.current?.id]);

  if (!active) {
    return (
      <Shell crumb="Orchestration">
        <div className="flex h-full items-center justify-center">
          <button
            onClick={() => create()}
            className="flex items-center gap-2 rounded-lg border border-amethyst/40 bg-amethyst/12 px-4 py-2 font-mono text-[12.5px] text-amethyst"
          >
            <Plus className="h-4 w-4" strokeWidth={1.8} /> create chain
          </button>
        </div>
      </Shell>
    );
  }

  /* Read-only when the chain belongs to another desk: mutations are dropped. */
  const canvasWritable = canEditOwned(active, ownerCtx);
  const canvasRefusal = editRefusal(active, ownerCtx);
  const patch = (fn: (c: StudioChain) => Partial<StudioChain>) => {
    if (!canvasWritable) return;
    update(active.id, fn(active));
  };

  const addNode = (label: string, kind: WorkflowNodeKind, meta: string, x?: number, y?: number) =>
    patch((c) => ({
      nodes: [
        ...c.nodes,
        {
          id: nid(),
          kind,
          label,
          meta,
          x: x ?? 140 + c.nodes.length * 44,
          y: y ?? 150 + (c.nodes.length % 4) * 96,
        },
      ],
    }));

  const removeStage = async (id: string) => {
    const node = active.nodes.find((n) => n.id === id);
    const ok = await confirmAction({
      title: `Delete "${node?.label ?? "stage"}"?`,
      body: "The stage and every link attached to it are removed from this chain.",
      confirmLabel: "Delete stage",
    });
    if (!ok) return;
    patch((c) => ({
      nodes: c.nodes.filter((n) => n.id !== id),
      edges: c.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    setSelected((cur) => (cur === id ? null : cur));
  };

  const accent = jewelPalette[active.jewel].to;

  return (
    <Shell crumb="Orchestration">
      {canvasRefusal && (
        <div className="px-5 pt-4">
          <ReadOnlyBanner reason={canvasRefusal} />
        </div>
      )}
      <div className="flex h-full min-h-0">
        {/* stage library */}
        <aside className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/70 px-5 py-5">
          <div className="mono-label">Stage library</div>

          <StagePicker
            label="Trigger"
            tone="sapphire"
            kind="trigger"
            options={["Manual Trigger", "Schedule Trigger", "Webhook Trigger", "File Drop Trigger"]}
            onAdd={(v) => addNode(v, "trigger", "entry · 100%")}
          />

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-amethyst">
                Workflows
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground/45">
                {workflows.length}
              </span>
            </div>
            <StagePicker
              tone="amethyst"
              options={workflows.map((w) => w.name)}
              onAdd={(v) => {
                const wf = workflows.find((w) => w.name === v);
                addNode(
                  v,
                  "workflow",
                  wf ? `workflow · ${wf.nodes.length} nodes` : "workflow · linked",
                );
              }}
            />
            <div className="mt-2 space-y-1.5">
              {workflows.map((w) => (
                <div
                  key={w.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/elara-skill", w.name)}
                  onDoubleClick={() =>
                    addNode(w.name, "workflow", `workflow · ${w.nodes.length} nodes`)
                  }
                  className="flex cursor-grab items-center gap-2 rounded-lg border border-border/60 bg-raised/25 px-3 py-2 transition-colors hover:border-amethyst/40 hover:bg-raised/50 active:cursor-grabbing"
                >
                  <Workflow
                    className="h-3.5 w-3.5 shrink-0"
                    strokeWidth={1.6}
                    style={{ color: jewelPalette[w.jewel].to }}
                  />
                  <span className="truncate font-mono text-[12px] text-foreground/85">
                    {w.name}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/50">
                    {w.nodes.length}n
                  </span>
                </div>
              ))}
            </div>
          </div>

          <StagePicker
            label="Logic"
            tone="ruby"
            kind="logic"
            options={orchestrationLogic}
            onAdd={(v) => addNode(v, "logic", "condition · branch")}
          />

          <StagePicker
            label="Control"
            tone="topaz"
            kind="action"
            meta="control"
            options={orchestrationControls}
            onAdd={(v) => addNode(v, "action", "control · 100%")}
          />

          <StagePicker
            label="Output"
            tone="emerald"
            kind="output"
            options={[
              "Executive Digest",
              "Command Report",
              "Markdown Report",
              "Webhook Push",
              "Email",
            ]}
            onAdd={(v) => addNode(v, "output", "output · 100%")}
          />

          {selectedNode?.kind === "trigger" && (
            <div className="mt-2 w-full">
              <TriggerScheduleCard
                node={selectedNode}
                disabled={!canvasWritable}
                onChange={(schedule, meta, binding) =>
                  patch((c) => ({
                    nodes: c.nodes.map((n) =>
                      n.id === selectedNode.id ? { ...n, schedule, meta, binding } : n
                    ),
                  }))
                }
              />
            </div>
          )}

          {selectedNode?.kind === "output" && (
            <div className="mt-2 w-full">
              <OutputBindingCard
                node={selectedNode}
                disabled={!canvasWritable}
                onChange={(sink, meta) =>
                  patch((c) => ({
                    nodes: c.nodes.map((n) => (n.id === selectedNode.id ? { ...n, sink, meta } : n)),
                  }))
                }
              />
            </div>
          )}

          <p className="mt-1 font-mono text-[10.5px] leading-relaxed tracking-[0.06em] text-muted-foreground/45">
            each stage is a whole workflow · drag a right port onto the next stage to magnet-snap
            the chain
          </p>
        </aside>

        {/* designer */}
        <section className="flex min-w-0 flex-1 flex-col p-4">
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="mb-3 flex flex-wrap items-center gap-3 rounded-[14px] border border-border bg-panel/70 px-4 py-2.5 backdrop-blur-md"
          >
            <span className="flex items-center gap-2 truncate font-mono text-[13px] text-foreground/95">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: accent, boxShadow: `0 0 10px -1px ${accent}` }}
              />
              {active.name}
            </span>
            <SharePopover
              record={active}
              ctx={ownerCtx}
              disabled={!canvasWritable}
              reason={canvasRefusal}
              onChange={(p) => update(active.id, p)}
            />
            <button
              onClick={() =>
                update(active.id, { status: active.status === "live" ? "draft" : "live" })
              }
              className="rounded-md border border-border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              {active.status}
            </button>
            <span className="font-mono text-[11px] tracking-[0.1em] text-muted-foreground/55">
              runs · {active.runs}
            </span>
            <SignatureBadge id={active.id} verdict={verdict} />

            <button
              disabled={!selected}
              onClick={() => {
                if (!selected) return;
                void removeStage(selected);
              }}
              className="flex items-center gap-1.5 font-mono text-[11.5px] tracking-[0.08em] text-ruby/90 transition-opacity disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} /> delete stage
            </button>

            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="mono-label">size</span>
                <input
                  type="range"
                  min={50}
                  max={150}
                  value={Math.round(zoom * 100)}
                  onChange={(e) => setZoom(Number(e.target.value) / 100)}
                  className="h-1 w-24 accent-[var(--sapphire)]"
                  aria-label="Canvas zoom"
                />
                <span className="font-mono text-[11px] text-muted-foreground/65">
                  {Math.round(zoom * 100)}%
                </span>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground/55">
                {active.nodes.length} stages · {active.edges.length} links
              </span>
              <JewelButton
                size="sm"
                variant="primary"
                onClick={() => {
                  update(active.id, { view: { x: pan.x, y: pan.y, zoom } });
                  const rec = signPayload(active.id, active.name, payload);
                  if (rec)
                    toast.success("Saved & signed", {
                      description: `${rec.algorithm} · ${rec.fingerprint}`,
                    });
                  else toast.success("Saved");
                }}
              >
                <Save className="h-3.5 w-3.5" strokeWidth={1.6} /> Save
              </JewelButton>
              <RunControls ctrl={run} label="run orchestration" />
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ y: 0, scale: 0.985 }}
                onClick={() => duplicate(active.id)}
                className="flex items-center gap-2 rounded-lg border border-sapphire/40 bg-sapphire/12 px-3 py-1.5 font-mono text-[11.5px] tracking-[0.1em] text-sapphire transition-all duration-200 hover:bg-sapphire/20 hover:shadow-[0_0_28px_-8px_var(--sapphire)]"
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.6} /> duplicate
              </motion.button>
            </div>
          </motion.div>

          <div className="relative min-h-0 flex-1">
            <WorkflowCanvas
              nodes={active.nodes}
              edges={active.edges}
              zoom={zoom}
              selected={selected}
              pan={pan}
              onPanChange={setPan}
              onSelect={setSelected}
              onMoveNode={(id, x, y) =>
                patch((c) => ({ nodes: c.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }))
              }
              onConnect={(from, to) =>
                patch((c) =>
                  c.edges.some((e) => e.from === from && e.to === to)
                    ? {}
                    : { edges: [...c.edges, { id: `oe${Date.now()}`, from, to }] },
                )
              }
              onDeleteNode={(id) => void removeStage(id)}
              onDeleteEdge={(id) => patch((c) => ({ edges: c.edges.filter((e) => e.id !== id) }))}
              onDropSkill={(label, x, y) => {
                const wf = workflows.find((w) => w.name === label);
                addNode(
                  label,
                  "workflow",
                  wf ? `workflow · ${wf.nodes.length} nodes` : "workflow · linked",
                  x,
                  y,
                );
              }}
            />
          </div>
        </section>
      </div>
    </Shell>
  );
}

function StagePicker({
  label,
  tone,
  options,
  kind,
  meta,
  onAdd,
}: {
  label?: string;
  tone: string;
  options: string[];
  kind?: WorkflowNodeKind;
  meta?: string;
  onAdd: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const current = value || options[0] || "";
  const CurrentIcon = nodeGlyph(kind ?? "action", current, meta ?? "").Icon;

  return (
    <div>
      {label && (
        <div className="mb-1.5 flex items-center justify-between">
          <span
            className="font-mono text-[11px] uppercase tracking-[0.14em]"
            style={{ color: `var(--${tone})` }}
          >
            {label}
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground/45">{options.length}</span>
        </div>
      )}
      <div className="flex gap-1.5">
        <div
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-raised/40 pl-2.5"
          style={{ borderColor: `color-mix(in oklab, var(--${tone}) 22%, var(--border))` }}
        >
          <CurrentIcon
            className="h-4 w-4 shrink-0"
            strokeWidth={1.7}
            style={{ color: `var(--${tone})` }}
          />
          <select
            value={current}
            onChange={(e) => setValue(e.target.value)}
            disabled={!options.length}
            className="min-w-0 flex-1 bg-transparent py-2 pr-2 font-mono text-[12px] text-foreground/90 outline-none disabled:opacity-40"
          >
            {options.length === 0 && <option value="">none registered</option>}
            {options.map((o, idx) => (
              <option key={`${o}-${idx}`} value={o} className="bg-panel">
                {o}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => current && onAdd(current)}
          disabled={!current}
          aria-label={`Add ${label ?? "stage"} node`}
          className="flex items-center gap-1 rounded-lg border px-2.5 font-mono text-[11.5px] transition-colors disabled:opacity-30"
          style={{
            borderColor: `color-mix(in oklab, var(--${tone}) 40%, transparent)`,
            background: `color-mix(in oklab, var(--${tone}) 12%, transparent)`,
            color: `var(--${tone})`,
          }}
          title={`Add ${label ?? "stage"} node`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} /> add
        </button>
      </div>
    </div>
  );
}
