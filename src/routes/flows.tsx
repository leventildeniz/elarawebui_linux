import { createFileRoute } from "@tanstack/react-router";
import { canEdit as canEditOwned, editRefusal } from "@/lib/ownership";
import { ReadOnlyBanner, SharePopover } from "@/components/sovereign/ownership-controls";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Copy, Plus, Save, Trash2 } from "lucide-react";
import { Shell } from "@/components/sovereign/shell";
import { JewelButton } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { WorkflowCanvas } from "@/components/sovereign/workflow-canvas";
import { TriggerScheduleCard } from "@/components/sovereign/trigger-schedule-card";
import { OutputBindingCard } from "@/components/sovereign/output-binding-card";
import { RunControls } from "@/components/sovereign/run-controls";
import { useRunController } from "@/lib/run-controller";
import { toast } from "sonner";
import { fetchApi } from "@/lib/api";
import { guardRun, signPayload, useVerdict } from "@/lib/signing";
import { SignatureBadge } from "@/components/sovereign/signature-badge";
import { useWorkflows, type StudioWorkflow } from "@/lib/workflow-store";
import { useAgents } from "@/lib/agent-store";
import { useSkills } from "@/lib/skill-store";
import { useForge } from "@/lib/forge-store";
import { orchestrationLogic } from "@/mocks/orchestrations";
import { useMcp } from "@/lib/mcp-store";
import { jewelPalette } from "@/lib/avatar-library";
import { familyIcon, nodeGlyph, type NodeFamily } from "@/lib/node-glyph";
import type { WorkflowNodeKind } from "@/mocks/workflows";

export const Route = createFileRoute("/flows")({
  head: () => ({
    meta: [
      { title: "Workflow Designer — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Magnetic node graph for orchestration flows: pick agents, skills, tools and MCP clients from the node library and snap trigger → action → output chains together.",
      },
      { property: "og:title", content: "Workflow Designer — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Magnetic node graph for building multi-agent orchestration pipelines.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WorkflowDesigner,
});

const nid = () => `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

type LibraryGroup = {
  id: string;
  label: string;
  kind: WorkflowNodeKind;
  tone: string;
  meta: string;
  options: string[];
};

function WorkflowDesigner() {
  const {
    workflows,
    ctx: ownerCtx,
    hydrated,
    activeId,
    setActiveId,
    create,
    update,
    duplicate,
  } = useWorkflows();
  const { agents } = useAgents();
  const { skills } = useSkills();
  const { items } = useForge();
  const { clients } = useMcp();

  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [liveRunId, setLiveRunId] = useState<string | null>(null);

  const active = workflows.find((w) => w.id === activeId) ?? workflows[0];
  const activeKey = active?.id;
  const savedView = active?.view;
  const selectedNode = active?.nodes.find((n) => n.id === selected);

  // restore the saved canvas position/zoom once the store is hydrated
  // and again whenever the active workflow changes
  const restoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || !activeKey) return;
    if (restoredRef.current === activeKey) return;
    restoredRef.current = activeKey;
    setPan({ x: savedView?.x ?? 0, y: savedView?.y ?? 0 });
    setZoom(savedView?.zoom ?? 1);
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
      fetchApi(`/api/workflows/${active.id}/trigger`, {
        method: "POST",
        body: JSON.stringify(payload)
      }).then(res => {
        if (res.runId) setLiveRunId(res.runId);
      }).catch(err => console.error("Failed to trigger workflow", err));

      return true;
    },
    onStop: () => {
      if (liveRunId) {
        fetchApi(`/api/workflows/runs/${liveRunId}/stop`, { method: "POST" })
          .catch(err => console.error("Failed to stop workflow run", err));
        setLiveRunId(null);
      }
    },
    onRestart: () => {
      if (liveRunId) {
        fetchApi(`/api/workflows/runs/${liveRunId}/stop`, { method: "POST" })
          .catch(() => {});
      }
      if (!active) return;
      
      // Trigger new backend execution
      fetchApi(`/api/workflows/${active.id}/trigger`, {
        method: "POST",
        body: JSON.stringify(payload)
      }).then(res => {
        if (res.runId) setLiveRunId(res.runId);
      }).catch(err => console.error("Failed to trigger workflow", err));
    },
    steps: runSteps,
    label: active?.name ?? "Workflow",
    onComplete: () => {
      if (active) update(active.id, { runs: active.runs + 1 });
    },
  });

  useEffect(() => setSelected(run.current?.id ?? null), [run.current?.id]);

  const groups = useMemo<LibraryGroup[]>(
    () => [
      {
        id: "trigger",
        label: "Trigger",
        kind: "trigger",
        tone: "sapphire",
        meta: "entry · 100%",
        options: [
          "Manual Trigger",
          "Cron Trigger",
          "Webhook Trigger",
          "Email Trigger",
          "File Drop Trigger",
          ...items.filter((i) => i.kind === "trigger").map((i) => i.name),
        ],
      },
      {
        id: "agent",
        label: "Agents",
        kind: "action",
        tone: "topaz",
        meta: "agent · dispatch",
        options: agents.map((a) => `@${a.name}`),
      },
      {
        id: "skill",
        label: "Skills",
        kind: "skill",
        tone: "amethyst",
        meta: "skill · sealed",
        options: [...new Set(skills.map((s) => s.name))],
      },
      {
        id: "tool",
        label: "Tools",
        kind: "action",
        tone: "emerald",
        meta: "tool · action",
        options: [...new Set(items.filter((i) => i.kind !== "trigger").map((i) => `/${i.name}`))],
      },
      {
        id: "mcp",
        label: "MCP clients",
        kind: "action",
        tone: "ruby",
        meta: "mcp · remote",
        options: [...new Set(clients.map((c) => `#${c.name}`))],
      },
      {
        id: "logic",
        label: "Logic",
        kind: "logic",
        tone: "ruby",
        meta: "condition · branch",
        options: orchestrationLogic,
      },
      {
        id: "output",
        label: "Output",
        kind: "output",
        tone: "emerald",
        meta: "output · 100%",
        options: ["Markdown Report", "PostgreSQL", "Syslog", "Alarm", "Email"],
      },
    ],
    [agents, skills, items, clients],
  );

  if (!active) {
    return (
      <Shell crumb="Workflows">
        <div className="flex h-full items-center justify-center">
          <button
            onClick={() => create()}
            className="flex items-center gap-2 rounded-lg border border-sapphire/40 bg-sapphire/12 px-4 py-2 font-mono text-[12.5px] text-sapphire"
          >
            <Plus className="h-4 w-4" strokeWidth={1.8} /> create workflow
          </button>
        </div>
      </Shell>
    );
  }

  /* Read-only when the canvas belongs to another desk: mutations are dropped. */
  const canvasWritable = canEditOwned(active, ownerCtx);
  const canvasRefusal = editRefusal(active, ownerCtx);
  const patch = (fn: (d: StudioWorkflow) => Partial<StudioWorkflow>) => {
    if (!canvasWritable) return;
    update(active.id, fn(active));
  };

  const addNode = (label: string, kind: WorkflowNodeKind, meta: string, x?: number, y?: number) =>
    patch((d) => ({
      nodes: [
        ...d.nodes,
        {
          id: nid(),
          kind,
          label,
          meta,
          x: x ?? 120 + d.nodes.length * 48,
          y: y ?? 140 + (d.nodes.length % 4) * 96,
        },
      ],
    }));

  const removeNode = async (id: string) => {
    const node = active.nodes.find((n) => n.id === id);
    const ok = await confirmAction({
      title: `Delete "${node?.label ?? "node"}"?`,
      body: "The node and every link attached to it are removed from this workflow.",
      confirmLabel: "Delete node",
    });
    if (!ok) return;
    patch((d) => ({
      nodes: d.nodes.filter((n) => n.id !== id),
      edges: d.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    setSelected((cur) => (cur === id ? null : cur));
  };

  const accent = jewelPalette[active.jewel].to;

  return (
    <Shell crumb="Workflows">
      {canvasRefusal && (
        <div className="px-5 pt-4">
          <ReadOnlyBanner reason={canvasRefusal} />
        </div>
      )}
      <div className="flex h-full min-h-0">
        {/* node library */}
        <aside className="flex w-[286px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border/70 px-5 py-5">
          <div className="mono-label">Node library</div>
          {groups.map((g) => (
            <LibraryGroupPicker
              key={g.id}
              group={g}
              onAdd={(label) => addNode(label, g.kind, g.meta)}
            />
          ))}

          {selectedNode?.kind === "trigger" && (
            <div className="mt-2">
              <TriggerScheduleCard
                node={selectedNode}
                disabled={!canvasWritable}
                onChange={(schedule, meta, binding) =>
                  patch((d) => ({
                    nodes: d.nodes.map((n) =>
                      n.id === selectedNode.id ? { ...n, schedule, meta, binding } : n
                    ),
                  }))
                }
              />
            </div>
          )}

          {selectedNode?.kind === "output" && (
            <div className="mt-2">
              <OutputBindingCard
                node={selectedNode}
                disabled={!canvasWritable}
                onChange={(sink, meta) =>
                  patch((d) => ({
                    nodes: d.nodes.map((n) => (n.id === selectedNode.id ? { ...n, sink, meta } : n)),
                  }))
                }
              />
            </div>
          )}

          <p className="mt-1 font-mono text-[10.5px] leading-relaxed tracking-[0.06em] text-muted-foreground/45">
            pick a node · add to canvas · drag a right port onto another node to magnet-snap the
            link
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
                void removeNode(selected);
              }}
              className="flex items-center gap-1.5 font-mono text-[11.5px] tracking-[0.08em] text-ruby/90 transition-opacity disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} /> delete node
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
                {active.nodes.length} nodes · {active.edges.length} links
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
              <RunControls ctrl={run} label="run workflow" />
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
                patch((d) => ({ nodes: d.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }))
              }
              onConnect={(from, to) =>
                patch((d) =>
                  d.edges.some((e) => e.from === from && e.to === to)
                    ? {}
                    : { edges: [...d.edges, { id: `e${Date.now()}`, from, to }] },
                )
              }
              onDeleteNode={(id) => void removeNode(id)}
              onDeleteEdge={(id) => patch((d) => ({ edges: d.edges.filter((e) => e.id !== id) }))}
              onDropSkill={(label, x, y) => addNode(label, "skill", "skill · sealed", x, y)}
            />
          </div>

          {!activeId && <span className="sr-only" onClick={() => setActiveId(active.id)} />}
        </section>
      </div>
    </Shell>
  );
}

function LibraryGroupPicker({
  group,
  onAdd,
}: {
  group: LibraryGroup;
  onAdd: (label: string) => void;
}) {
  const [value, setValue] = useState("");
  const options = group.options;
  const current = value || options[0] || "";
  const glyph = nodeGlyph(group.kind, current, group.meta);
  const GroupIcon = familyIcon[group.id as NodeFamily] ?? glyph.Icon;
  const CurrentIcon = glyph.Icon;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span
          className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em]"
          style={{ color: `var(--${group.tone})` }}
        >
          <GroupIcon className="h-3.5 w-3.5" strokeWidth={1.7} />
          {group.label}
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground/45">{options.length}</span>
      </div>
      <div className="flex gap-1.5">
        <div
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-raised/40 pl-2.5"
          style={{ borderColor: `color-mix(in oklab, var(--${group.tone}) 22%, var(--border))` }}
        >
          <CurrentIcon
            className="h-4 w-4 shrink-0"
            strokeWidth={1.7}
            style={{ color: `var(--${group.tone})` }}
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
          aria-label={`Add ${group.label} node`}
          className="flex items-center gap-1 rounded-lg border px-2.5 font-mono text-[11.5px] transition-colors disabled:opacity-30"
          style={{
            borderColor: `color-mix(in oklab, var(--${group.tone}) 40%, transparent)`,
            background: `color-mix(in oklab, var(--${group.tone}) 12%, transparent)`,
            color: `var(--${group.tone})`,
          }}
          title={`Add ${group.label} node`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} /> add
        </button>
      </div>
    </div>
  );
}
