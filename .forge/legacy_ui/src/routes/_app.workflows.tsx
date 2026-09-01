import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Play,
  
  Plus,
  Save,
  Trash2,
  Search,
  Copy,
  Square,
  Pencil,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { WorkflowAPI, LogsAPI, resolveApiBaseUrl, SkillsAPI, AgentsAPI, type ActionDef, type SkillDef, type AgentRow } from "@/lib/api-client";
import { useSystem } from "@/lib/system-store";
import { ForgePicker } from "@/components/forge-picker";
import { WF_BG_THEMES, wfBgStyle, exportCanvasPdf, exportGraphMd, exportGraphVisio } from "@/lib/wf-canvas";

export const Route = createFileRoute("/_app/workflows")({ component: WorkflowsPage });

type WfStatus = "running" | "paused" | "draft" | "scheduled";
type NodeType = "input" | "output" | "default";

interface FlowNode {
  id: string;
  type?: NodeType;
  position: { x: number; y: number };
  data: { label: string; model?: string; scale?: number; actionId?: string; params?: Record<string, unknown> };
  style?: CSSProperties;
  actionId?: string; // mirrored at top-level so backend runtime sees it
  config?: { params: Record<string, unknown> };
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
  style?: CSSProperties;
}

type Node = FlowNode;
type Edge = FlowEdge;

interface Workflow {
  id: string;
  name: string;
  status: WfStatus;
  nodes: Node[];
  edges: Edge[];
  trigger: string;
  createdAt: string;
  runs: number;
  color?: string;
  isSystem?: boolean;
  description?: string;
}

interface LibNode {
  id: string;
  kind: string;
  label: string;
  color: string;
  group: "Trigger" | "Action" | "Output";
  custom?: boolean;
}

const NODE_WIDTH_BASE = 196;
const NODE_HEIGHT_BASE = 64;
const CANVAS_MIN_HEIGHT = 480;
function computeCanvasHeight() {
  if (typeof window === "undefined") return 580;
  return Math.max(CANVAS_MIN_HEIGHT, window.innerHeight - 240);
}

// background themes & helpers moved to src/lib/wf-canvas.ts


const DEFAULT_LIB: LibNode[] = [
  {
    id: "tr-email",
    kind: "trigger",
    label: "Trigger · Email",
    color: "var(--chart-3)",
    group: "Trigger",
  },
  {
    id: "tr-cron",
    kind: "trigger",
    label: "Trigger · Cron",
    color: "var(--chart-3)",
    group: "Trigger",
  },
  {
    id: "tr-webhook",
    kind: "trigger",
    label: "Trigger · Webhook",
    color: "var(--chart-3)",
    group: "Trigger",
  },
  {
    id: "tr-file",
    kind: "trigger",
    label: "Trigger · File Drop",
    color: "var(--chart-3)",
    group: "Trigger",
  },
  // Agent slot placeholders removed — agents are now hydrated dynamically
  // from AgentsAPI.list() inside <AgentsLibrarySection /> so the canvas
  // mirrors the real on-disk registry instead of 3 hardcoded names.

  {
    id: "ac-pcap",
    kind: "python",
    label: "Python · parse_pcap",
    color: "var(--chart-2)",
    group: "Action",
  },
  {
    id: "ac-regex",
    kind: "python",
    label: "Python · regex",
    color: "var(--chart-2)",
    group: "Action",
  },
  {
    id: "ac-validate",
    kind: "validate",
    label: "Validate · Schema",
    color: "var(--chart-4)",
    group: "Action",
  },
  {
    id: "ot-pg",
    kind: "store",
    label: "Output · PostgreSQL",
    color: "var(--chart-5)",
    group: "Output",
  },
  {
    id: "ot-syslog",
    kind: "notify",
    label: "Output · Syslog",
    color: "var(--accent)",
    group: "Output",
  },
  {
    id: "ot-alarm",
    kind: "notify",
    label: "Output · Alarm",
    color: "var(--destructive)",
    group: "Output",
  },
  {
    id: "ot-email",
    kind: "notify",
    label: "Output · Email",
    color: "var(--accent)",
    group: "Output",
  },
];

function nodeStyle(color: string): CSSProperties {
  return {
    background: "color-mix(in oklab, var(--card) 76%, transparent)",
    color: "var(--foreground)",
    border: `1px solid ${color}`,
    borderRadius: 10,
    padding: 10,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    boxShadow: `0 0 18px color-mix(in oklab, ${color} 25%, transparent)`,
  };
}

function edgeId() {
  return `edge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ed(s: string, t: string): Edge {
  return {
    id: edgeId(),
    source: s,
    target: t,
    animated: true,
    style: { stroke: "var(--primary)" },
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// Workflows hydrate exclusively from the backend (PostgreSQL via :3005).
// No demo seed data is shipped — empty backend means empty UI.
const SEED: Workflow[] = [];

function WorkflowsPage() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  if (!hydrated) return null;
  return <WorkflowsInner />;
}

function WorkflowsInner() {
  const { t } = useI18n();
  const [nodeScale, setNodeScale] = useState<number>(() => {
    const v = Number(localStorage.getItem("wf.nodeScale"));
    return Number.isFinite(v) && v > 0 ? v : 1;
  });
  useEffect(() => { localStorage.setItem("wf.nodeScale", String(nodeScale)); }, [nodeScale]);
  const NODE_WIDTH = Math.round(NODE_WIDTH_BASE * nodeScale);
  const NODE_HEIGHT = Math.round(NODE_HEIGHT_BASE * nodeScale);
  const [bgTheme, setBgTheme] = useState<string>(() => localStorage.getItem("wf.bgTheme") || "dots-cyan");
  useEffect(() => { localStorage.setItem("wf.bgTheme", bgTheme); }, [bgTheme]);
  const [bgSolid, setBgSolid] = useState<string>(() => localStorage.getItem("wf.bgSolid") || "#0b1220");
  useEffect(() => { localStorage.setItem("wf.bgSolid", bgSolid); }, [bgSolid]);
  const [wfs, setWfs] = useState<Workflow[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [lib, setLib] = useState<LibNode[]>(() => {
    try {
      const raw = localStorage.getItem("wf.library");
      return raw ? JSON.parse(raw) : DEFAULT_LIB;
    } catch {
      return DEFAULT_LIB;
    }
  });
  // Forge actions are managed via the live <ForgePicker /> below.
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(
    null,
  );
  const [connecting, setConnecting] = useState<{
    sourceId: string;
    x: number;
    y: number;
    hoverTarget: string | null;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [canvasHeight, setCanvasHeight] = useState<number>(() => computeCanvasHeight());
  useEffect(() => {
    const onResize = () => setCanvasHeight(computeCanvasHeight());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const active = useMemo(() => wfs.find((w) => w.id === activeId), [wfs, activeId]);
  const nodes = active?.nodes ?? [];
  const edges = active?.edges ?? [];

  const updateActive = useCallback(
    (updater: (workflow: Workflow) => Workflow) => {
      setWfs((prev) => prev.map((w) => (w.id === activeId ? updater(w) : w)));
    },
    [activeId],
  );

  const persistCanvas = useCallback(
    async (silent = false) => {
      if (!active) return;
      const result = await WorkflowAPI.save({
        id: active.id,
        name: active.name,
        nodes: active.nodes,
        edges: active.edges,
        color: active.color,
        status: active.status,
        trigger: active.trigger,
        runs: active.runs,
      });
      if (!silent) {
        if (result.ok) toast.success("Workflow saved · synced to PostgreSQL via :3005");
        else toast.error("Save failed · middleware (:3005) unreachable");
      }
    },
    [active],
  );

  const connectNodes = useCallback(
    (source: string, target: string) => {
      if (!source || !target || source === target) return;
      updateActive((w) => {
        const exists = w.edges.some((e) => e.source === source && e.target === target);
        if (exists) return w;
        const a = w.nodes.find((n) => n.id === source)?.data.label ?? source;
        const b = w.nodes.find((n) => n.id === target)?.data.label ?? target;
        const msg = `[Workflow] ${a} to ${b} connected via Port 3005`;
        console.log(msg);
        LogsAPI.push({ agent: "workflow", level: "info", message: msg });
        toast.success(msg);
        return { ...w, edges: [...w.edges, ed(source, target)] };
      });
    },
    [updateActive],
  );

  const deleteNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      updateActive((w) => ({
        ...w,
        nodes: w.nodes.filter((n) => !ids.includes(n.id)),
        edges: w.edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
      }));
      setSelectedNodes((prev) => prev.filter((id) => !ids.includes(id)));
    },
    [updateActive],
  );

  const deleteSelected = useCallback(() => {
    if (selectedNodes.length === 0) {
      toast.info("Select a node first");
      return;
    }
    deleteNodes(selectedNodes);
  }, [deleteNodes, selectedNodes]);

  useEffect(() => {
    localStorage.setItem("wf.library", JSON.stringify(lib));
  }, [lib]);

  // Live hydration: load persisted workflow graphs from backend on mount.
  useEffect(() => {
    let cancelled = false;
    WorkflowAPI.list().then((rows) => {
      if (cancelled) return;
      const next: Workflow[] = rows.map((row, i) => {
        const g = (row.graph ?? {}) as { nodes?: Node[]; edges?: Edge[]; color?: string; status?: WfStatus; trigger?: string; runs?: number; is_system?: boolean; description?: string };
        return {
          id: row.id,
          name: row.name,
          status: g.status ?? "draft",
          trigger: g.trigger ?? "Trigger · Webhook",
          createdAt: new Date(row.updated_at).toISOString(),
          runs: g.runs ?? 0,
          color: g.color ?? WF_COLORS[i % WF_COLORS.length],
          nodes: (g.nodes ?? []) as Node[],
          edges: (g.edges ?? []) as Edge[],
          isSystem: Boolean(g.is_system),
          description: g.description,
        };
      });
      setWfs(next);
      setActiveId((cur) => cur || next[0]?.id || "");
    }).catch(() => { /* bridge offline → keep empty */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => persistCanvas(true), 600);
    return () => clearTimeout(timer);
  }, [active, persistCanvas]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clamp(
        event.clientX - rect.left - dragging.offsetX,
        8,
        Math.max(8, rect.width - NODE_WIDTH - 8),
      );
      const y = clamp(
        event.clientY - rect.top - dragging.offsetY,
        8,
        canvasHeight - NODE_HEIGHT - 8,
      );
      updateActive((w) => ({
        ...w,
        nodes: w.nodes.map((n) => (n.id === dragging.id ? { ...n, position: { x, y } } : n)),
      }));
    };
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, updateActive]);

  useEffect(() => {
    if (!connecting) return;
    const onMove = (event: PointerEvent) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      // detect hover target by point-in-rect (left handle area)
      let hover: string | null = null;
      for (const n of nodes) {
        if (n.id === connecting.sourceId) continue;
        const tx = n.position.x;
        const ty = n.position.y;
        // snap if within 24px of left handle midpoint
        const hx = tx;
        const hy = ty + NODE_HEIGHT / 2;
        if (Math.hypot(x - hx, y - hy) < 36) { hover = n.id; break; }
        if (x >= tx && x <= tx + NODE_WIDTH && y >= ty && y <= ty + NODE_HEIGHT) { hover = n.id; break; }
      }
      setConnecting((prev) => (prev ? { ...prev, x, y, hoverTarget: hover } : prev));
    };
    const onUp = () => {
      setConnecting((cur) => {
        if (cur?.hoverTarget) connectNodes(cur.sourceId, cur.hoverTarget);
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [connecting, nodes, connectNodes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (event.key === "Delete" || event.key === "Backspace") deleteSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected]);

  const [executing, setExecuting] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  // wfId → live runId currently being polled
  const runIdMapRef = useRef<Map<string, string>>(new Map());
  // wfId → setInterval handle for polling
  const pollMapRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // wfId → live elapsed ms (re-renders every 250ms while running)
  const [elapsedMap, setElapsedMap] = useState<Record<string, number>>({});
  const elapsedTimerRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const [lastRun, setLastRun] = useState<{
    wfId: string;
    wfName: string;
    ok: boolean;
    ts: number;
    durationMs: number;
    output?: Record<string, unknown> | null;
    trace?: Array<Record<string, unknown>>;
    error?: string;
  } | null>(null);
  const [erroredWfs, setErroredWfs] = useState<Set<string>>(new Set());
  // Per-workflow last-run badge (✓ / ✕ + duration). Stays visible until next run.
  const [lastRunMap, setLastRunMap] = useState<Record<string, { ok: boolean; durationMs: number; ts: number; error?: string }>>({});
  // Short-lived "just finished" flash (4s) for play-button visual feedback.
  const [flashIds, setFlashIds] = useState<Record<string, "ok" | "err" | "stopped">>({});
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const flashWf = (id: string, kind: "ok" | "err" | "stopped") => {
    setFlashIds((p) => ({ ...p, [id]: kind }));
    const prev = flashTimers.current.get(id);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      setFlashIds((p) => { const { [id]: _drop, ...rest } = p; return rest; });
      flashTimers.current.delete(id);
    }, 4000);
    flashTimers.current.set(id, t);
  };

  const teardownRun = (wfId: string) => {
    const poll = pollMapRef.current.get(wfId);
    if (poll) { clearInterval(poll); pollMapRef.current.delete(wfId); }
    const tick = elapsedTimerRef.current.get(wfId);
    if (tick) { clearInterval(tick); elapsedTimerRef.current.delete(wfId); }
    runIdMapRef.current.delete(wfId);
    setRunningIds((p) => { const n = new Set(p); n.delete(wfId); return n; });
    setElapsedMap((p) => { const { [wfId]: _drop, ...rest } = p; return rest; });
    if (active?.id === wfId) setExecuting(false);
  };

  const stopWorkflow = async (wfId: string) => {
    const runId = runIdMapRef.current.get(wfId);
    if (!runId) {
      teardownRun(wfId);
      return;
    }
    try { await WorkflowAPI.stopRun(runId); }
    catch { /* server may have already finished */ }
    // Final status will arrive via the next poll; show STOPPING in the meantime.
    toast.message(`Stopping ${wfId}…`);
  };

  const triggerWorkflow = async (wfId?: string) => {
    const target = wfId ? wfs.find((w) => w.id === wfId) : active;
    if (!target) return;
    // Toggle: if already running, stop
    if (runningIds.has(target.id)) {
      stopWorkflow(target.id);
      return;
    }
    setRunningIds((p) => new Set(p).add(target.id));
    if (active?.id === target.id) setExecuting(true);
    setErroredWfs((p) => { const n = new Set(p); n.delete(target.id); return n; });
    if (active?.id === target.id) await persistCanvas(true);
    LogsAPI.push({
      agent: "workflow",
      level: "info",
      message: `[Workflow] RUN ${target.name} · ${target.nodes.length} nodes / ${target.edges.length} edges → :3005`,
      meta: { id: target.id },
    });
    const t0 = Date.now();
    setElapsedMap((p) => ({ ...p, [target.id]: 0 }));
    const tick = setInterval(() => {
      setElapsedMap((p) => ({ ...p, [target.id]: Date.now() - t0 }));
    }, 250);
    elapsedTimerRef.current.set(target.id, tick);

    let runId: string;
    try {
      const r = await WorkflowAPI.trigger(target.id, { nodes: target.nodes, edges: target.edges });
      if (!r?.runId) throw new Error("trigger did not return runId");
      runId = r.runId;
      runIdMapRef.current.set(target.id, runId);
    } catch (e) {
      const err = e as Error;
      setErroredWfs((p) => new Set(p).add(target.id));
      toast.error(`Trigger failed: ${err.message || "Middleware (:3005) unreachable"}`);
      setLastRunMap((p) => ({ ...p, [target.id]: { ok: false, durationMs: Date.now() - t0, ts: Date.now(), error: err.message } }));
      flashWf(target.id, "err");
      teardownRun(target.id);
      return;
    }

    // Poll the live run every second.
    const poll = setInterval(async () => {
      try {
        const live = await WorkflowAPI.getRun(runId);
        if (!live || live.status === "running") return;
        // Run finished: success / failed / stopped
        const dur = live.durationMs ?? Date.now() - t0;
        if (live.status === "done") {
          flashWf(target.id, "ok");
          setLastRunMap((p) => ({ ...p, [target.id]: { ok: true, durationMs: dur, ts: Date.now() } }));
          setLastRun({ wfId: target.id, wfName: target.name, ok: true, ts: Date.now(), durationMs: dur, output: live.output, trace: live.trace });
          toast.success(`✓ ${target.name} · ${dur}ms · ${live.trace?.length ?? 0} steps`);
          setWfs((prev) => prev.map((w) => (w.id === target.id ? { ...w, runs: w.runs + 1 } : w)));
        } else if (live.status === "stopped") {
          flashWf(target.id, "stopped");
          setLastRunMap((p) => ({ ...p, [target.id]: { ok: false, durationMs: dur, ts: Date.now(), error: "stopped" } }));
          setLastRun({ wfId: target.id, wfName: target.name, ok: false, ts: Date.now(), durationMs: dur, error: "stopped", trace: live.trace });
          toast.message(`⊘ ${target.name} stopped · ${dur}ms`);
        } else {
          flashWf(target.id, "err");
          setErroredWfs((p) => new Set(p).add(target.id));
          setLastRunMap((p) => ({ ...p, [target.id]: { ok: false, durationMs: dur, ts: Date.now(), error: live.error ?? "failed" } }));
          setLastRun({ wfId: target.id, wfName: target.name, ok: false, ts: Date.now(), durationMs: dur, error: live.error ?? "failed", trace: live.trace });
          toast.error(`✕ ${target.name} failed · ${live.error ?? "unknown error"}`);
        }
        teardownRun(target.id);
      } catch {
        // Poll error: keep trying. If repeated, the run-not-found 404 will eventually surface.
      }
    }, 1000);
    pollMapRef.current.set(target.id, poll);
  };


  const exportPdf = async () => {
    if (!wrapperRef.current || !active) return toast.error("Canvas yok");
    try {
      await exportCanvasPdf(wrapperRef.current, active.name || "workflow");
      toast.success("PDF exported");
    } catch (e) {
      toast.error(`PDF export failed: ${(e as Error).message}`);
    }
  };

  const exportMd = () => {
    if (!active) return;
    exportGraphMd(
      `Workflow · ${active.name}`,
      nodes.map((n) => ({ id: n.id, label: n.data.label, x: n.position.x, y: n.position.y, meta: n.data.model ? `model=${n.data.model}` : undefined })),
      edges.map((e) => ({ source: e.source, target: e.target })),
    );
    toast.success("Markdown exported");
  };

  const exportVisio = () => {
    if (!active) return;
    exportGraphVisio(
      active.name || "Workflow",
      nodes.map((n) => ({ id: n.id, label: n.data.label, x: n.position.x, y: n.position.y, w: NODE_WIDTH, h: NODE_HEIGHT })),
      edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      canvasHeight,
    );
    toast.success("Visio (.vdx) exported");
  };

  const addFromLib = (label: string, color: string, position?: { x: number; y: number }) => {
    const id = `node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nodeType: NodeType = label.startsWith("Trigger")
      ? "input"
      : label.startsWith("Output")
        ? "output"
        : "default";
    updateActive((w) => ({
      ...w,
      trigger: nodeType === "input" ? label : w.trigger,
      nodes: [
        ...w.nodes,
        {
          id,
          type: nodeType,
          position: position ?? { x: 320 + Math.random() * 200, y: 120 + Math.random() * 120 },
          data: { label },
          style: nodeStyle(color),
        },
      ],
    }));
    setSelectedNodes([id]);
  };

  const addFromForge = (action: ActionDef, position?: { x: number; y: number }) => {
    const id = `node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nodeType: NodeType = action.kind === "trigger" ? "input" : action.kind === "output" ? "output" : "default";
    const params: Record<string, unknown> = {};
    for (const p of action.params || []) if (p.default !== undefined) params[p.key] = p.default;
    updateActive((w) => ({
      ...w,
      trigger: nodeType === "input" ? action.name : w.trigger,
      nodes: [...w.nodes, {
        id,
        type: nodeType,
        position: position ?? { x: 320 + Math.random() * 200, y: 120 + Math.random() * 120 },
        data: { label: action.name, actionId: action.id, params },
        style: nodeStyle(action.color),
        actionId: action.id,
        config: { params },
      }],
    }));
    setSelectedNodes([id]);
  };

  const onDragStart = (e: DragEvent, n: LibNode) => {
    e.dataTransfer.setData(
      "application/wf-lib",
      JSON.stringify({ label: n.label, color: n.color }),
    );
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.getData("application/wf-connect")) return;
    const raw = e.dataTransfer.getData("application/wf-lib");
    if (!raw) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { label, color } = JSON.parse(raw);
    const position = {
      x: clamp(e.clientX - rect.left - NODE_WIDTH / 2, 8, Math.max(8, rect.width - NODE_WIDTH - 8)),
      y: clamp(e.clientY - rect.top - NODE_HEIGHT / 2, 8, canvasHeight - NODE_HEIGHT - 8),
    };
    addFromLib(label, color, position);
  };

  const startNodeMove = (event: ReactPointerEvent<HTMLDivElement>, node: Node) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSelectedNodes((prev) =>
      event.shiftKey
        ? prev.includes(node.id)
          ? prev.filter((id) => id !== node.id)
          : [...prev, node.id]
        : [node.id],
    );
    setDragging({
      id: node.id,
      offsetX: event.clientX - rect.left - node.position.x,
      offsetY: event.clientY - rect.top - node.position.y,
    });
  };

  const beginConnect = (event: ReactPointerEvent, nodeId: string) => {
    event.stopPropagation();
    event.preventDefault();
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConnecting({
      sourceId: nodeId,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      hoverTarget: null,
    });
  };

  const deleteEdge = (id: string) =>
    updateActive((w) => ({ ...w, edges: w.edges.filter((e) => e.id !== id) }));

  const WF_COLORS = ["#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#3b82f6", "#eab308"];
  const newWorkflow = () => {
    const id = `wf-${Date.now()}`;
    const color = WF_COLORS[wfs.length % WF_COLORS.length];
    const wf: Workflow = {
      id,
      name: `${t("wf.new")} ${wfs.length + 1}`,
      status: "draft",
      trigger: "Trigger · Webhook",
      createdAt: new Date().toISOString(),
      runs: 0,
      color,
      nodes: [
        {
          id: "1",
          type: "input",
          position: { x: 40, y: 80 },
          data: { label: "Trigger · Webhook" },
          style: nodeStyle(color),
        },
      ],
      edges: [],
    };
    setWfs((prev) => [wf, ...prev]);
    setActiveId(id);
    setSelectedNodes([]);
  };
  const cloneWf = (id: string) => {
    const src = wfs.find((w) => w.id === id);
    if (!src) return;
    const nid = `wf-${Date.now()}`;
    // Deep-clone nodes & edges with fresh IDs so the copy is independent.
    const idMap = new Map<string, string>();
    const newNodes: Node[] = src.nodes.map((n) => {
      const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      idMap.set(n.id, newId);
      return { ...n, id: newId, data: { ...n.data }, position: { ...n.position }, config: n.config ? { params: { ...n.config.params } } : undefined };
    });
    const newEdges: Edge[] = src.edges.map((e) => ({
      ...e,
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));
    const copy: Workflow = { ...src, id: nid, name: `${src.name} (copy)`, status: "draft", runs: 0, nodes: newNodes, edges: newEdges };
    setWfs((prev) => [copy, ...prev]);
    setActiveId(nid);
    // Persist clone immediately so backend has its own row.
    WorkflowAPI.save({ id: nid, name: copy.name, nodes: newNodes, edges: newEdges, color: copy.color, status: copy.status, trigger: copy.trigger, runs: copy.runs }).catch(() => {});
  };
  const removeWf = async (id: string) => {
    await WorkflowAPI.remove(id);
    setWfs((prev) => {
      const next = prev.filter((w) => w.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? "");
      return next;
    });
    toast.success("Workflow removed");
  };
  const setStatus = (id: string, status: WfStatus) => {
    const target = wfs.find((w) => w.id === id);
    setActiveId(id);
    setWfs((prev) => prev.map((w) => (w.id === id ? { ...w, status } : w)));
    if (target) {
      WorkflowAPI.save({ ...target, status }).catch(() => {});
    }
  };

  const filtered = wfs.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()));

  const [libDlg, setLibDlg] = useState<LibNode | null>(null);
  const { models } = useSystem();
  const [modelDlg, setModelDlg] = useState<{ nodeId: string; model: string } | null>(null);
  const setNodeModel = (nodeId: string, model: string) =>
    updateActive((w) => ({
      ...w,
      nodes: w.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, model } } : n)),
    }));
  const editLibItem = (n: LibNode) => setLibDlg({ ...n });
  const newLibItem = (group: LibNode["group"]) =>
    setLibDlg({
      id: `lib-${Date.now()}`,
      kind: "trigger",
      label: `${group} · Custom`,
      color:
        group === "Trigger"
          ? "var(--chart-3)"
          : group === "Action"
            ? "var(--primary)"
            : "var(--accent)",
      group,
      custom: true,
    });
  const saveLibItem = () => {
    if (!libDlg) return;
    setLib((prev) =>
      prev.some((x) => x.id === libDlg.id)
        ? prev.map((x) => (x.id === libDlg.id ? libDlg : x))
        : [...prev, libDlg],
    );
    setLibDlg(null);
    toast.success("Library updated");
  };
  const deleteLibItem = (id: string) => {
    setLib((prev) => prev.filter((x) => x.id !== id));
    toast.success("Removed");
  };

  const groupLabel = (g: LibNode["group"]) =>
    g === "Trigger" ? t("wf.trigger") : g === "Action" ? t("wf.action") : t("wf.output");

  return (
    <PageShell>
      <PageHeader
        title={t("wf.title")}
        subtitle={t("wf.subtitle")}
        actions={
          <>
            <Button variant="outline" onClick={newWorkflow}>
              <Plus className="h-4 w-4 mr-1" />
              {t("wf.new")}
            </Button>
            <Button variant="outline" onClick={() => persistCanvas()}>
              <Save className="h-4 w-4 mr-1" />
              {t("wf.save")}
            </Button>
            <Button
              type="button"
              onClick={() => (executing ? stopWorkflow(active!.id) : triggerWorkflow())}
              disabled={!active}
              variant={executing ? "destructive" : flashIds[active?.id ?? ""] === "err" ? "destructive" : "default"}
              className={
                executing
                  ? "animate-pulse"
                  : flashIds[active?.id ?? ""] === "ok"
                  ? "bg-emerald-500 hover:bg-emerald-600 text-white relative z-10"
                  : flashIds[active?.id ?? ""] === "stopped"
                  ? "bg-muted text-muted-foreground relative z-10"
                  : "bg-gradient-primary text-primary-foreground relative z-10 cursor-pointer pointer-events-auto"
              }
            >
              {executing ? <Square className="h-4 w-4 mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
              {executing
                ? `STOP · ${Math.round((elapsedMap[active?.id ?? ""] ?? 0) / 100) / 10}s`
                : flashIds[active?.id ?? ""] === "ok"
                ? `✓ ${lastRunMap[active?.id ?? ""]?.durationMs ?? 0}ms`
                : flashIds[active?.id ?? ""] === "stopped"
                ? "⊘ STOPPED"
                : flashIds[active?.id ?? ""] === "err"
                ? "✕ Retry"
                : "Trigger"}
            </Button>

          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="glass lg:col-span-3">
          <CardContent className="p-3 space-y-3">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                placeholder={t("wf.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
            <div className="space-y-1 max-h-[260px] overflow-auto">
              {filtered.map((w) => (
                <div
                  key={w.id}
                  className={`border rounded p-2 cursor-pointer ${activeId === w.id ? "border-primary" : "border-border"} ${erroredWfs.has(w.id) ? "wf-strobe" : ""}`}
                  onMouseDown={() => {
                    if (activeId === w.id) return;
                    setActiveId(w.id);
                    setSelectedNodes([]);
                    setConnecting(null);
                    setDragging(null);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: w.color || "var(--primary)" }} />
                      <Input
                        value={w.name}
                        onFocus={(e) => { e.stopPropagation(); setActiveId(w.id); }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          setActiveId(w.id);
                          setWfs((prev) => prev.map((item) => item.id === w.id ? { ...item, name: e.target.value } : item));
                        }}
                        className="h-6 border-0 bg-transparent px-1 text-xs font-medium"
                      />
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {w.isSystem && (
                        <Badge variant="secondary" className="text-[9px] font-mono px-1 py-0">SYS</Badge>
                      )}
                      <Badge variant="outline" className="text-[9px] font-mono">
                        {w.status}
                      </Badge>
                    </div>
                  </div>
                  {w.description && (
                    <p className="mt-1 text-[10px] leading-snug text-muted-foreground line-clamp-2">
                      {w.description}
                    </p>
                  )}
                  <div className="mt-1 flex gap-1" onClick={(e) => e.stopPropagation()}>
                    {WF_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`h-4 w-4 rounded-full border ${w.color === color ? "border-foreground" : "border-border"}`}
                        style={{ background: color }}
                        title="Workflow color"
                        onClick={() => { setActiveId(w.id); setWfs((prev) => prev.map((item) => item.id === w.id ? { ...item, color } : item)); }}
                      />
                    ))}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-2">
                    <span>{w.trigger} · {t("wf.runs")} {w.runs}</span>
                    {lastRunMap[w.id] && (
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                          lastRunMap[w.id].ok
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            : "bg-destructive/15 text-destructive border border-destructive/30"
                        }`}
                        title={lastRunMap[w.id].error || `last run ${new Date(lastRunMap[w.id].ts).toLocaleTimeString()}`}
                      >
                        {lastRunMap[w.id].ok ? `✓ ${lastRunMap[w.id].durationMs}ms` : `✕ ${lastRunMap[w.id].error || "failed"}`}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {runningIds.has(w.id) ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 px-2 font-mono text-[10px] gap-1 animate-pulse"
                        title="Stop run"
                        onClick={(e) => { e.stopPropagation(); stopWorkflow(w.id); }}
                      >
                        <Square className="h-3 w-3" /> STOP · {Math.round((elapsedMap[w.id] ?? 0) / 100) / 10}s
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={flashIds[w.id] === "ok" ? "default" : flashIds[w.id] === "err" ? "destructive" : "outline"}
                        className={`h-7 px-2 font-mono text-[10px] gap-1 ${
                          flashIds[w.id] === "ok" ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""
                        }`}
                        title="Run workflow"
                        onClick={(e) => { e.stopPropagation(); triggerWorkflow(w.id); }}
                      >
                        <Play className="h-3 w-3" />
                        {flashIds[w.id] === "ok" ? "DONE" : flashIds[w.id] === "err" ? "FAIL" : flashIds[w.id] === "stopped" ? "STOPPED" : "PLAY"}

                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        cloneWf(w.id);
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeWf(w.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Forge: live PostgreSQL action library — pick & add */}
            <div className="border-t border-border pt-3">
              <ForgePicker onAdd={(a) => addFromForge(a)} />
            </div>

            {/* Skills: sealed procedures — drag onto canvas as skill nodes */}
            <SkillsLibrarySection
              onAdd={(sk) => {
                const id = `node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                updateActive((w) => ({
                  ...w,
                  nodes: [...w.nodes, {
                    id,
                    type: "default",
                    position: { x: 320 + Math.random() * 200, y: 120 + Math.random() * 120 },
                    data: { label: `! ${sk.slug}`, actionId: undefined, params: {} },
                    style: nodeStyle(sk.risk_level === "critical" ? "var(--destructive)" : sk.risk_level === "write" ? "var(--chart-3)" : "var(--primary)"),
                    config: { params: { skillSlug: sk.slug, kind: "skill" } },
                  }],
                }));
                setSelectedNodes([id]);
              }}
            />
            {/* Agents: live registry from AgentsAPI — add as canvas node */}
            <AgentsLibrarySection
              onAdd={(ag) => {
                const id = `node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                updateActive((w) => ({
                  ...w,
                  nodes: [...w.nodes, {
                    id,
                    type: "default",
                    position: { x: 320 + Math.random() * 200, y: 120 + Math.random() * 120 },
                    data: { label: `@ ${ag.name}`, actionId: undefined, params: {} },
                    style: nodeStyle("var(--chart-1)"),
                    config: { params: { kind: "agent", agentId: ag.id, agentName: ag.name } },
                  }],
                }));
                setSelectedNodes([id]);
              }}
              onRunResult={(info) => setLastRun({
                wfId: `agent:${info.agentId}`,
                wfName: `@${info.agentName}`,
                ok: info.ok,
                ts: Date.now(),
                durationMs: info.durationMs,
                output: info.output,
                trace: [{ kind: "agent", agentId: info.agentId, agentName: info.agentName, ...(info.ok ? {} : { error: info.error }) }],
                error: info.error,
              })}
            />


            <div className="border-t border-border pt-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                {t("wf.library")}
              </p>
              {(["Trigger", "Action", "Output"] as const).map((group) => (
                <div key={group} className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-mono text-muted-foreground/70">
                      {groupLabel(group)}
                    </p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={() => newLibItem(group)}
                      title={t("wf.add_trigger")}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  {lib
                    .filter((n) => n.group === group)
                    .map((n) => (
                      <div
                        key={n.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, n)}
                        className="group/lib border border-border rounded p-1.5 mb-1 hover:bg-accent/40 flex items-center gap-2 cursor-grab active:cursor-grabbing"
                      >
                        <button
                          onClick={() => addFromLib(n.label, n.color)}
                          className="flex items-center gap-2 flex-1 text-left"
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: n.color }}
                          />
                          <span className="text-[11px] font-mono truncate">{n.label}</span>
                        </button>
                        <button
                          className="opacity-0 group-hover/lib:opacity-100 text-muted-foreground hover:text-primary"
                          onClick={() => editLibItem(n)}
                          title={t("common.edit")}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          className="opacity-0 group-hover/lib:opacity-100 text-destructive"
                          onClick={() => deleteLibItem(n.id)}
                          title={t("common.delete")}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="glass lg:col-span-9 overflow-hidden">
          <CardContent className="p-0">
            <div className="px-4 py-2 border-b border-border flex items-center gap-3">
              <Input
                value={active?.name ?? ""}
                onChange={(e) =>
                  active &&
                  setWfs((prev) =>
                    prev.map((w) => (w.id === active.id ? { ...w, name: e.target.value } : w)),
                  )
                }
                className="h-8 max-w-xs text-sm font-medium"
              />
              <input
                type="color"
                value={active?.color ?? "#06b6d4"}
                onChange={(e) => active && setWfs((prev) => prev.map((w) => w.id === active.id ? { ...w, color: e.target.value } : w))}
                className="h-7 w-8 rounded border border-border bg-transparent cursor-pointer"
                title="Workflow color"
              />
              <Badge variant="outline" className="font-mono text-[10px]">
                {active?.status}
              </Badge>
              <span className="text-[10px] text-muted-foreground font-mono">
                {t("wf.runs")} · {active?.runs}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-destructive"
                onClick={deleteSelected}
                disabled={selectedNodes.length === 0}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Delete node ({selectedNodes.length})
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => (executing ? stopWorkflow(active!.id) : triggerWorkflow())}
                disabled={!active}
                variant={executing ? "destructive" : flashIds[active?.id ?? ""] === "err" ? "destructive" : "default"}
                className={
                  executing
                    ? "h-7 font-mono text-[11px] tracking-wider animate-pulse"
                    : flashIds[active?.id ?? ""] === "ok"
                    ? "h-7 bg-emerald-500 hover:bg-emerald-600 text-white font-mono text-[11px] tracking-wider"
                    : "h-7 bg-gradient-primary text-primary-foreground font-mono text-[11px] tracking-wider"
                }
              >
                {executing ? <Square className="h-3 w-3 mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                {executing
                  ? `RUNNING ${Math.round((elapsedMap[active?.id ?? ""] ?? 0) / 100) / 10}s · CLICK TO STOP`
                  : flashIds[active?.id ?? ""] === "ok"
                  ? `✓ DONE ${lastRunMap[active?.id ?? ""]?.durationMs ?? 0}MS`
                  : flashIds[active?.id ?? ""] === "stopped"
                  ? "⊘ STOPPED"
                  : flashIds[active?.id ?? ""] === "err"
                  ? "✕ FAILED — RETRY"
                  : "RUN WORKFLOW"}

              </Button>
              {active && lastRunMap[active.id] && !executing && !flashIds[active.id] && (
                <span
                  className={`text-[10px] font-mono px-2 py-1 rounded border ${
                    lastRunMap[active.id].ok
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : "bg-destructive/10 text-destructive border-destructive/30"
                  }`}
                  title={`last run ${new Date(lastRunMap[active.id].ts).toLocaleTimeString()}`}
                >
                  last: {lastRunMap[active.id].ok ? `✓ ${lastRunMap[active.id].durationMs}ms` : `✕ ${lastRunMap[active.id].error || "failed"}`}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
                  <span>Size</span>
                  <input
                    type="range" min={0.6} max={1.8} step={0.05}
                    value={nodeScale}
                    onChange={(e) => setNodeScale(Number(e.target.value))}
                    className="w-24 accent-primary"
                    title="Node size"
                  />
                  <span className="w-8 text-right">{Math.round(nodeScale * 100)}%</span>
                </div>
                <Select value={bgTheme} onValueChange={setBgTheme}>
                  <SelectTrigger className="h-7 w-36 text-[10px] font-mono"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WF_BG_THEMES.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="text-[11px] font-mono">{b.label}</SelectItem>
                    ))}
                    <SelectItem value="solid" className="text-[11px] font-mono">{t("wf.solid_color")}</SelectItem>
                  </SelectContent>
                </Select>
                {bgTheme === "solid" && (
                  <input
                    type="color"
                    value={bgSolid}
                    onChange={(e) => setBgSolid(e.target.value)}
                    className="h-7 w-8 rounded border border-border bg-transparent cursor-pointer"
                    title="Solid background color"
                  />
                )}
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => exportPdf()}>PDF</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => exportMd()}>MD</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => exportVisio()}>Visio</Button>
                </div>
                <span className="text-[10px] text-muted-foreground font-mono ml-2">
                  {nodes.length} nodes · {edges.length} links
                </span>
              </div>
            </div>
            <div
              ref={wrapperRef}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onClick={() => setSelectedNodes([])}
              className={`relative overflow-hidden ${active && erroredWfs.has(active.id) ? "wf-strobe rounded" : ""}`}
              style={{ height: canvasHeight, ...wfBgStyle(bgTheme, bgSolid) }}
            >
              <svg
                className="absolute inset-0 h-full w-full pointer-events-none"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="wf-arrow"
                    markerWidth="10"
                    markerHeight="10"
                    refX="8"
                    refY="3"
                    orient="auto"
                    markerUnits="strokeWidth"
                  >
                    <path d="M0,0 L0,6 L9,3 z" fill="var(--primary)" />
                  </marker>
                </defs>
                {edges.map((edge) => {
                  const source = nodes.find((n) => n.id === edge.source);
                  const target = nodes.find((n) => n.id === edge.target);
                  if (!source || !target) return null;
                  const sS = source.data.scale ?? 1;
                  const tS = target.data.scale ?? 1;
                  const x1 = source.position.x + NODE_WIDTH * sS;
                  const y1 = source.position.y + (NODE_HEIGHT * sS) / 2;
                  const x2 = target.position.x;
                  const y2 = target.position.y + (NODE_HEIGHT * tS) / 2;
                  const mid = Math.max(48, Math.abs(x2 - x1) / 2);
                  const d = `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`;
                  return (
                    <g key={edge.id}>
                      <path
                        d={d}
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth="2"
                        markerEnd="url(#wf-arrow)"
                        opacity="0.55"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth="2.2"
                        strokeDasharray="6 8"
                        opacity="0.95"
                        style={{ animation: "wf-dash 0.9s linear infinite" }}
                      />
                      <circle r="3.2" fill="var(--primary)">
                        <animateMotion dur="2.4s" repeatCount="indefinite" path={d} />
                      </circle>
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth="14"
                        className="pointer-events-auto cursor-pointer"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteEdge(edge.id);
                        }}
                      />
                    </g>
                  );
                })}
                {connecting && (() => {
                  const src = nodes.find((n) => n.id === connecting.sourceId);
                  if (!src) return null;
                  const sS = src.data.scale ?? 1;
                  const x1 = src.position.x + NODE_WIDTH * sS;
                  const y1 = src.position.y + (NODE_HEIGHT * sS) / 2;
                  let x2 = connecting.x;
                  let y2 = connecting.y;
                  if (connecting.hoverTarget) {
                    const tgt = nodes.find((n) => n.id === connecting.hoverTarget);
                    if (tgt) { const tS = tgt.data.scale ?? 1; x2 = tgt.position.x; y2 = tgt.position.y + (NODE_HEIGHT * tS) / 2; }
                  }
                  const mid = Math.max(48, Math.abs(x2 - x1) / 2);
                  const d = `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`;
                  return (
                    <g>
                      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeDasharray="6 6" style={{ animation: "wf-dash 0.6s linear infinite" }} />
                      <circle cx={x2} cy={y2} r="5" fill="var(--accent)" opacity="0.8" />
                    </g>
                  );
                })()}
              </svg>

              {active ? (
                nodes.map((node) => {
                  const selected = selectedNodes.includes(node.id);
                  const isHoverTarget = connecting?.hoverTarget === node.id;
                  const ns = node.data.scale ?? 1;
                  const nW = Math.round(NODE_WIDTH * ns);
                  const nH = Math.round(NODE_HEIGHT * ns);
                  const tint = active.color;
                  const tintedStyle: CSSProperties = tint
                    ? {
                        ...node.style,
                        border: `1px solid ${tint}`,
                        boxShadow: `0 0 18px color-mix(in oklab, ${tint} 30%, transparent)`,
                      }
                    : (node.style ?? {});
                  return (
                    <div
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      onPointerDown={(event) => startNodeMove(event, node)}
                      onClick={(event) => event.stopPropagation()}
                      onWheel={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const delta = event.deltaY > 0 ? -0.08 : 0.08;
                        const next = clamp((node.data.scale ?? 1) + delta, 0.5, 3);
                        updateActive((w) => ({
                          ...w,
                          nodes: w.nodes.map((n) =>
                            n.id === node.id ? { ...n, data: { ...n.data, scale: next } } : n,
                          ),
                        }));
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (node.data.label.startsWith("Agent")) {
                          setModelDlg({
                            nodeId: node.id,
                            model: node.data.model ?? models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? "",
                          });
                        }
                      }}
                      className={`absolute select-none transition-shadow ${selected ? "ring-2 ring-primary" : ""} ${isHoverTarget ? "ring-2 ring-accent shadow-[0_0_24px_var(--accent)]" : ""} ${executing ? "wf-executing" : ""}`}
                      style={{
                        ...tintedStyle,
                        left: node.position.x,
                        top: node.position.y,
                        width: nW,
                        minHeight: nH,
                      }}
                    >
                      {/* Target handle (left) */}
                      <div
                        title="Input"
                        style={{
                          position: "absolute",
                          left: -8,
                          top: nH / 2 - 8,
                          width: 16,
                          height: 16,
                          borderRadius: 999,
                          background: "var(--background)",
                          border: "2px solid var(--accent)",
                          zIndex: 999,
                          boxShadow: isHoverTarget ? "0 0 12px var(--accent)" : "none",
                        }}
                      />
                      {/* Source handle (right) */}
                      <div
                        title="Output · drag to connect"
                        onPointerDown={(event) => beginConnect(event, node.id)}
                        style={{
                          position: "absolute",
                          right: -8,
                          top: nH / 2 - 8,
                          width: 16,
                          height: 16,
                          borderRadius: 999,
                          background: tint || "var(--primary)",
                          border: "2px solid var(--background)",
                          zIndex: 999,
                          cursor: "crosshair",
                          boxShadow: `0 0 8px ${tint || "var(--primary)"}`,
                        }}
                      />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                            {node.type ?? "action"} · {Math.round(ns * 100)}%
                          </div>
                          <div className="truncate text-xs font-medium" style={{ fontSize: 12 * Math.min(ns, 1.6) }}>{node.data.label}</div>
                          {node.data.label.startsWith("Agent") && (
                            <div className="text-[9px] font-mono text-primary/80 truncate">
                              ⚙ {node.data.model ?? "double-click to bind model"}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteNodes([node.id]);
                            }}
                            className="h-6 w-6 inline-flex items-center justify-center rounded border border-border hover:bg-destructive/10 text-destructive"
                            title={t("common.delete")}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      {/* Resize handle (bottom-right) */}
                      <div
                        title="Drag to resize · or scroll wheel"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          const startX = event.clientX;
                          const startScale = node.data.scale ?? 1;
                          const onMove = (ev: PointerEvent) => {
                            const dx = ev.clientX - startX;
                            const next = clamp(startScale + dx / 200, 0.5, 3);
                            updateActive((w) => ({
                              ...w,
                              nodes: w.nodes.map((n) =>
                                n.id === node.id ? { ...n, data: { ...n.data, scale: next } } : n,
                              ),
                            }));
                          };
                          const onUp = () => {
                            window.removeEventListener("pointermove", onMove);
                            window.removeEventListener("pointerup", onUp);
                          };
                          window.addEventListener("pointermove", onMove);
                          window.addEventListener("pointerup", onUp);
                        }}
                        style={{
                          position: "absolute",
                          right: 2,
                          bottom: 2,
                          width: 12,
                          height: 12,
                          cursor: "nwse-resize",
                          borderRight: `2px solid ${tint || "var(--primary)"}`,
                          borderBottom: `2px solid ${tint || "var(--primary)"}`,
                          opacity: 0.7,
                          zIndex: 998,
                        }}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground font-mono">
                  No workflow selected
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {lastRun && (
        <Card className="glass mt-3">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: lastRun.ok ? "var(--chart-2)" : "var(--destructive)" }}
              />
              <span className="font-semibold">
                {lastRun.ok ? "RAN" : "FAILED"} · {lastRun.wfName}
              </span>
              <span className="text-muted-foreground">
                · {lastRun.durationMs}ms · {lastRun.trace?.length ?? 0} steps
              </span>
              <span className="text-muted-foreground">
                · {new Date(lastRun.ts).toLocaleTimeString()}
              </span>
              <button
                type="button"
                className="ml-auto text-[10px] text-muted-foreground hover:text-foreground underline"
                onClick={() => setLastRun(null)}
              >
                dismiss
              </button>
            </div>
            {lastRun.error && (
              <pre className="text-[11px] font-mono text-destructive whitespace-pre-wrap break-all">
                {lastRun.error}
              </pre>
            )}
            {Array.isArray(lastRun.trace) && lastRun.trace.length > 0 && (
              <div className="space-y-1">
                {lastRun.trace.map((step, i) => {
                  const s = step as Record<string, unknown>;
                  const kind = String(s.kind ?? "node");
                  const label = String(s.skillSlug ?? s.agentName ?? s.agentId ?? s.actionId ?? s.node ?? "");
                  const err = s.error ? String(s.error) : null;
                  return (
                    <div
                      key={i}
                      className="text-[10px] font-mono flex items-start gap-2 border border-border/60 rounded px-2 py-1"
                    >
                      <span className="text-muted-foreground w-5">{i + 1}.</span>
                      <span className="uppercase tracking-wider text-muted-foreground w-14">{kind}</span>
                      <span className="flex-1 truncate">{label}</span>
                      {err ? (
                        <span className="text-destructive truncate max-w-[40%]">{err}</span>
                      ) : (
                        <span className="text-[var(--chart-2)]">ok</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {lastRun.output && (
              <details className="text-[10px] font-mono">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  output JSON
                </summary>
                <pre className="mt-1 p-2 bg-muted/40 rounded overflow-auto max-h-64 whitespace-pre-wrap break-all">
                  {JSON.stringify(lastRun.output, null, 2)}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}


      <Dialog open={!!libDlg} onOpenChange={(o) => !o && setLibDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {libDlg && lib.some((x) => x.id === libDlg.id)
                ? t("common.edit")
                : t("wf.add_trigger")}
            </DialogTitle>
          </DialogHeader>
          {libDlg && (
            <div className="space-y-3">
              <div>
                <Label>Label</Label>
                <Input
                  value={libDlg.label}
                  onChange={(e) => setLibDlg({ ...libDlg, label: e.target.value })}
                  className="mt-1 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Group</Label>
                  <Select
                    value={libDlg.group}
                    onValueChange={(v) => setLibDlg({ ...libDlg, group: v as LibNode["group"] })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Trigger">{t("wf.trigger")}</SelectItem>
                      <SelectItem value="Action">{t("wf.action")}</SelectItem>
                      <SelectItem value="Output">{t("wf.output")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Kind (webhook, log, cron, http...)</Label>
                  <Input
                    value={libDlg.kind}
                    onChange={(e) => setLibDlg({ ...libDlg, kind: e.target.value })}
                    className="mt-1 font-mono"
                  />
                </div>
              </div>
              <div>
                <Label>Color (CSS var or hex)</Label>
                <Input
                  value={libDlg.color}
                  onChange={(e) => setLibDlg({ ...libDlg, color: e.target.value })}
                  className="mt-1 font-mono"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLibDlg(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={saveLibItem} className="bg-gradient-primary text-primary-foreground">
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!modelDlg} onOpenChange={(o) => !o && setModelDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("wf.bind_agent")}</DialogTitle>
          </DialogHeader>
          {modelDlg && (
            <div className="space-y-3">
              <Label>Model</Label>
              <Select
                value={modelDlg.model}
                onValueChange={(v) => setModelDlg({ ...modelDlg, model: v })}
              >
                <SelectTrigger className="mt-1 font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="font-mono">
                      {m.modelName || m.id.split(/[\\/]/).filter(Boolean).pop() || m.id} · {m.provider}{m.isDefault ? " · default" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground font-mono">
                Each agent block can run on its own model. Saved with the workflow graph.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setModelDlg(null)}>{t("common.cancel")}</Button>
            <Button
              className="bg-gradient-primary text-primary-foreground"
              onClick={() => {
                if (!modelDlg) return;
                setNodeModel(modelDlg.nodeId, modelDlg.model);
                setModelDlg(null);
                toast.success("Model bound");
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function SkillsLibrarySection({ onAdd }: { onAdd: (sk: SkillDef) => void }) {
  const [skills, setSkills] = useState<SkillDef[]>([]);
  useEffect(() => {
    SkillsAPI.list().then(setSkills).catch(() => setSkills([]));
  }, []);
  if (skills.length === 0) return null;
  return (
    <div className="border-t border-border pt-3">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
        Skills (sealed procedures)
      </p>
      <div className="space-y-1">
        {skills.map((sk) => {
          const color = sk.risk_level === "critical" ? "var(--destructive)" : sk.risk_level === "write" ? "var(--chart-3)" : "var(--primary)";
          return (
            <button
              key={sk.id}
              onClick={() => onAdd(sk)}
              className="w-full border border-border rounded p-1.5 hover:bg-accent/40 flex items-center gap-2 text-left"
              title={`${sk.description || sk.slug} · risk:${sk.risk_level}${sk.requires_approval ? " · approval" : ""}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
              <span className="text-[11px] font-mono flex-1">!{sk.slug}</span>
              <span className="text-[9px] font-mono text-muted-foreground">{sk.risk_level}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

type AgentRunInfo = {
  agentId: string;
  agentName: string;
  ok: boolean;
  durationMs: number;
  output?: Record<string, unknown>;
  error?: string;
};

function AgentsLibrarySection({
  onAdd,
  onRunResult,
}: {
  onAdd: (ag: AgentRow) => void;
  onRunResult?: (info: AgentRunInfo) => void;
}) {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [runningAgents, setRunningAgents] = useState<Set<string>>(new Set());
  useEffect(() => {
    AgentsAPI.list().then(setAgents).catch(() => setAgents([]));
  }, []);
  if (agents.length === 0) return null;
  // Group by effective_squad for at-a-glance scanning.
  const grouped = agents.reduce<Record<string, AgentRow[]>>((acc, a) => {
    const k = a.effective_squad || "Unassigned";
    (acc[k] ||= []).push(a);
    return acc;
  }, {});
  return (
    <div className="border-t border-border pt-3">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
        Agents (live registry)
      </p>
      <div className="space-y-2">
        {Object.entries(grouped).map(([squad, list]) => (
          <div key={squad}>
            <p className="text-[9px] font-mono text-muted-foreground/70 mb-1">{squad} · {list.length}</p>
            <div className="space-y-1">
              {list.map((ag) => {
                const color = ag.status === "active" ? "var(--chart-2)" : ag.status === "error" ? "var(--destructive)" : "var(--chart-1)";
                const isRunning = runningAgents.has(ag.id);
                return (
                  <div
                    key={ag.id}
                    className="w-full border border-border rounded p-1.5 hover:bg-accent/40 flex items-center gap-1.5"
                    title={`${ag.name} · ${ag.status} · ${ag.model || "no-model"}`}
                  >
                    <button
                      type="button"
                      onClick={() => onAdd(ag)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="text-[11px] font-mono flex-1 truncate">@{ag.name}</span>
                      <span className="text-[9px] font-mono text-muted-foreground">{ag.status}</span>
                    </button>
                    {isRunning ? (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await AgentsAPI.cancel(ag.id);
                            toast.success(`Stopped @${ag.name}`);
                          } catch (err) {
                            toast.error(`Stop failed: ${String((err as Error).message ?? err)}`);
                          } finally {
                            setRunningAgents((s: Set<string>) => { const n = new Set(s); n.delete(ag.id); return n; });
                          }
                        }}
                        className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/20 text-destructive"
                        title="Stop agent"
                      >
                        <Square className="h-3 w-3" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          setRunningAgents((s: Set<string>) => new Set(s).add(ag.id));
                          const t0 = Date.now();
                          try {
                            const r = await AgentsAPI.run(ag.id, {}, "");
                            const dur = Date.now() - t0;
                            const okFlag = !!r?.ok;
                            if (okFlag) toast.success(`@${ag.name} ran · ${dur}ms`);
                            else toast.error(`@${ag.name}: ${r?.error || "failed"}`);
                            onRunResult?.({
                              agentId: ag.id,
                              agentName: ag.name,
                              ok: okFlag,
                              durationMs: dur,
                              output: (r as unknown as { output?: Record<string, unknown> })?.output,
                              error: okFlag ? undefined : (r?.error || "failed"),
                            });
                          } catch (err) {
                            const msg = String((err as Error).message ?? err);
                            toast.error(`@${ag.name}: ${msg}`);
                            onRunResult?.({
                              agentId: ag.id,
                              agentName: ag.name,
                              ok: false,
                              durationMs: Date.now() - t0,
                              error: msg,
                            });
                          } finally {
                            setRunningAgents((s: Set<string>) => { const n = new Set(s); n.delete(ag.id); return n; });
                          }
                        }}
                        className="h-5 w-5 flex items-center justify-center rounded hover:bg-accent text-foreground"
                        title="Run agent"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
