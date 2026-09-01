import { createFileRoute } from "@tanstack/react-router";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Save, Trash2, Zap, Play, Pause, Square, Copy, GitBranch, Flag, FlagOff, Workflow as WfIcon, Hammer, Check, Sparkles } from "lucide-react";
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
import { toast } from "sonner";
import { ChainAPI, WorkflowAPI, SkillsAPI, type ChainNode, type ChainEdge, type ChainRow, type ChainRun, type ActionDef, type SkillDef } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { ForgePicker } from "@/components/forge-picker";
import { WF_BG_THEMES, wfBgStyle, exportCanvasPdf, exportGraphMd, exportGraphVisio } from "@/lib/wf-canvas";

export const Route = createFileRoute("/_app/orchestration")({ component: OrchestrationPage });

const NODE_W_BASE = 200;
const NODE_H_BASE = 70;
const CANVAS_MIN_H = 480;
function computeCanvasH() {
  if (typeof window === "undefined") return 580;
  return Math.max(CANVAS_MIN_H, window.innerHeight - 240);
}

type ChainStatus = "running" | "paused" | "draft" | "scheduled";
interface ChainState {
  id: string;
  name: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
  color?: string;
  status?: ChainStatus;
  isSystem?: boolean;
  description?: string;
}
const CHAIN_COLORS = ["#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#3b82f6", "#eab308"];

interface WfMeta { id: string; name: string }

function clamp(v: number, lo: number, hi: number) { return Math.min(Math.max(v, lo), hi); }
function uid(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function ensureStart(nodes: ChainNode[]): ChainNode[] {
  return nodes.some((n) => n.kind === "start")
    ? nodes
    : [{ id: uid("n"), kind: "start", position: { x: 60, y: 240 }, label: "START" }, ...nodes];
}

function nodeColor(kind: ChainNode["kind"]): string {
  switch (kind) {
    case "start": return "#10b981";
    case "end": return "#ef4444";
    case "condition": return "#f59e0b";
    case "workflow": return "#06b6d4";
    case "action": return "#8b5cf6";
    case "skill": return "#d946ef";
    default: return "#06b6d4";
  }
}

function OrchestrationPage() {
  const { t } = useI18n();
  const [chains, setChains] = useState<ChainState[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [wfs, setWfs] = useState<WfMeta[]>([]);
  const [runs, setRuns] = useState<ChainRun[]>([]);
  const [running, setRunning] = useState(false);
  const [execNode, setExecNode] = useState<string | null>(null);
  const [completedNodes, setCompletedNodes] = useState<Set<string>>(new Set());
  const [flippingNodes, setFlippingNodes] = useState<Set<string>>(new Set());
  const [activeEdges, setActiveEdges] = useState<Set<string>>(new Set());
  const [erroredChains, setErroredChains] = useState<Set<string>>(new Set());
  // Live run state (Play/Stop async model)
  const liveRunIdRef = useRef<string | null>(null);
  const livePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveStartRef = useRef<number>(0);
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);
  const [lastChainResult, setLastChainResult] = useState<{ chainId: string; ok: boolean; durationMs: number; ts: number; error?: string } | null>(null);
  const [chainFlash, setChainFlash] = useState<"ok" | "err" | "stopped" | null>(null);
  const chainFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashChain = (kind: "ok" | "err" | "stopped") => {
    setChainFlash(kind);
    if (chainFlashTimerRef.current) clearTimeout(chainFlashTimerRef.current);
    chainFlashTimerRef.current = setTimeout(() => setChainFlash(null), 4000);
  };
  const wrapRef = useRef<HTMLDivElement>(null);
  const cancelRunRef = useRef<boolean>(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; offX: number; offY: number } | null>(null);
  const [connecting, setConnecting] = useState<{ source: string; branch: ChainEdge["branch"]; x: number; y: number; hover: string | null } | null>(null);
  const [editNode, setEditNode] = useState<ChainNode | null>(null);
  const [canvasH, setCanvasH] = useState<number>(() => computeCanvasH());
  useEffect(() => {
    const onResize = () => setCanvasH(computeCanvasH());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Canvas styling — mirrors workflows tab
  const [nodeScale, setNodeScale] = useState<number>(() => {
    const v = Number(localStorage.getItem("orch.nodeScale"));
    return Number.isFinite(v) && v > 0 ? v : 1;
  });
  useEffect(() => { localStorage.setItem("orch.nodeScale", String(nodeScale)); }, [nodeScale]);
  const [bgTheme, setBgTheme] = useState<string>(() => localStorage.getItem("orch.bgTheme") || "dots-cyan");
  useEffect(() => { localStorage.setItem("orch.bgTheme", bgTheme); }, [bgTheme]);
  const [bgSolid, setBgSolid] = useState<string>(() => localStorage.getItem("orch.bgSolid") || "#0b1220");
  useEffect(() => { localStorage.setItem("orch.bgSolid", bgSolid); }, [bgSolid]);

  const active = useMemo(() => chains.find((c) => c.id === activeId), [chains, activeId]);

  // initial load
  useEffect(() => {
    let cancelled = false;
    Promise.all([ChainAPI.list().catch(() => []), WorkflowAPI.list().catch(() => [])]).then(([rows, wfRows]) => {
      if (cancelled) return;
      const next: ChainState[] = (rows as ChainRow[]).map((r, i) => {
        const g = (r.graph ?? {}) as ChainRow["graph"] & { is_system?: boolean; description?: string };
        return {
          id: r.id, name: r.name,
          nodes: ensureStart((g.nodes ?? []) as ChainNode[]),
          edges: (g.edges ?? []) as ChainEdge[],
          color: g.color || CHAIN_COLORS[i % CHAIN_COLORS.length],
          status: (g.status as ChainStatus | undefined) || "draft",
          isSystem: !!g.is_system,
          description: typeof g.description === "string" ? g.description : undefined,
        };
      });
      setChains(next);
      setActiveId((cur) => cur || next[0]?.id || "");
      setWfs((wfRows as Array<{ id: string; name: string }>).map((w) => ({ id: w.id, name: w.name })));
    });
    return () => { cancelled = true; };
  }, []);

  // refresh runs every 8s when chain selected (visibility-gated)
  useEffect(() => {
    if (!activeId) return;
    ChainAPI.runs(activeId).then(setRuns).catch(() => {});
  }, [activeId]);
  useVisiblePoll(() => {
    if (!activeId) return;
    ChainAPI.runs(activeId).then(setRuns).catch(() => {});
  }, 8000, !!activeId);

  // Mark chain as errored if its latest run failed (status=failed or any trace step has 'error')
  useEffect(() => {
    if (!activeId) return;
    const last = runs[0];
    if (!last) return;
    const traceFailed = Array.isArray(last.trace) && last.trace.some((s) => !!s && typeof s === "object" && "error" in (s as Record<string, unknown>));
    if (last.status === "failed" || traceFailed) {
      setErroredChains((p) => p.has(activeId) ? p : new Set(p).add(activeId));
    }
  }, [runs, activeId]);

  const updateActive = useCallback((fn: (c: ChainState) => ChainState) => {
    setChains((prev) => prev.map((c) => c.id === activeId ? fn(c) : c));
  }, [activeId]);

  const newChain = () => {
    const id = uid("chain");
    const start: ChainNode = { id: uid("n"), kind: "start", position: { x: 60, y: 240 }, label: "START" };
    setChains((prev) => [{ id, name: `Chain ${prev.length + 1}`, nodes: [start], edges: [], color: CHAIN_COLORS[prev.length % CHAIN_COLORS.length], status: "draft" }, ...prev]);
    setActiveId(id);
  };

  const cloneChain = (id: string) => {
    const src = chains.find((c) => c.id === id);
    if (!src) return;
    const nid = uid("chain");
    const idMap = new Map<string, string>();
    const newNodes: ChainNode[] = src.nodes.map((n) => {
      const newId = uid("n");
      idMap.set(n.id, newId);
      return { ...n, id: newId, position: { ...n.position }, params: n.params ? { ...n.params } : undefined };
    });
    const newEdges: ChainEdge[] = src.edges.map((e) => ({
      ...e, id: uid("e"),
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));
    const copy: ChainState = { ...src, id: nid, name: `${src.name} (copy)`, nodes: newNodes, edges: newEdges, status: "draft" };
    setChains((prev) => [copy, ...prev]);
    setActiveId(nid);
    ChainAPI.save({ id: nid, name: copy.name, nodes: newNodes, edges: newEdges, color: copy.color, status: copy.status }).catch(() => {});
  };

  const setChainStatus = (id: string, status: ChainStatus) => {
    const target = chains.find((c) => c.id === id);
    setActiveId(id);
    setChains((prev) => prev.map((c) => c.id === id ? { ...c, status } : c));
    if (target) {
      ChainAPI.save({ ...target, status }).catch(() => {});
    }
  };

  const removeChain = async (id: string) => {
    await ChainAPI.remove(id);
    setChains((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? "");
      return next;
    });
    toast.success("Chain removed");
  };

  const saveChain = async () => {
    if (!active) return;
    const r = await ChainAPI.save({ id: active.id, name: active.name, nodes: active.nodes, edges: active.edges, color: active.color, status: active.status });
    if (r.ok) toast.success("Chain saved · :3005 PostgreSQL"); else toast.error("Save failed");
  };

  // autosave
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => { ChainAPI.save({ id: active.id, name: active.name, nodes: active.nodes, edges: active.edges, color: active.color, status: active.status }).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [active]);

  const teardownChainRun = useCallback(() => {
    if (livePollRef.current) { clearInterval(livePollRef.current); livePollRef.current = null; }
    if (liveTickRef.current) { clearInterval(liveTickRef.current); liveTickRef.current = null; }
    liveRunIdRef.current = null;
    setLiveElapsedMs(0);
    setRunning(false);
    setExecNode(null);
    setActiveEdges(new Set());
    setFlippingNodes(new Set());
    setTimeout(() => setCompletedNodes(new Set()), 2200);
  }, []);

  const runChain = async (chainId = activeId) => {
    const target = chains.find((c) => c.id === chainId);
    if (!target) return;
    if (running) return; // already running
    cancelRunRef.current = false;
    setActiveId(target.id);
    setSelected(null);
    setRunning(true);
    setCompletedNodes(new Set());
    setFlippingNodes(new Set());
    setActiveEdges(new Set());
    setErroredChains((p) => { const n = new Set(p); n.delete(target.id); return n; });
    setChainStatus(target.id, "running");
    liveStartRef.current = Date.now();
    setLiveElapsedMs(0);
    liveTickRef.current = setInterval(() => {
      setLiveElapsedMs(Date.now() - liveStartRef.current);
    }, 250);

    // Visual replay: walk the graph node-by-node so the user sees pulse → flip → edge flow.
    const replay = async () => {
      const startNode = target.nodes.find((n) => n.kind === "start");
      if (!startNode) return;
      let current: ChainNode | undefined = startNode;
      let safety = 0;
      const visited = new Set<string>();
      while (current && safety++ < 64 && !cancelRunRef.current) {
        const cur: ChainNode = current;
        setExecNode(cur.id);
        await new Promise((r) => setTimeout(r, 650));
        setFlippingNodes((p) => new Set(p).add(cur.id));
        setCompletedNodes((p) => new Set(p).add(cur.id));
        setTimeout(() => {
          setFlippingNodes((p) => { const n = new Set(p); n.delete(cur.id); return n; });
        }, 700);
        if (cur.kind === "end") break;
        const candidates: ChainEdge[] = target.edges.filter((e: ChainEdge) => e.source === cur.id);
        const next: ChainEdge | undefined = candidates.find((e: ChainEdge) => e.branch === "true") || candidates[0];
        if (!next) break;
        setActiveEdges((p) => new Set(p).add(next.id));
        await new Promise((r) => setTimeout(r, 550));
        if (visited.has(next.target)) break;
        visited.add(next.target);
        current = target.nodes.find((n) => n.id === next.target);
      }
      setExecNode(null);
    };

    let runId: string;
    try {
      await ChainAPI.save({ id: target.id, name: target.name, nodes: target.nodes, edges: target.edges, color: target.color, status: "running" });
      const r = await ChainAPI.run(target.id);
      if (!r?.runId) throw new Error("chain run did not return runId");
      runId = r.runId;
      liveRunIdRef.current = runId;
      // Fire visual replay in parallel; do not await — UI poll drives final state.
      void replay();
    } catch (e) {
      cancelRunRef.current = true;
      setErroredChains((p) => new Set(p).add(target.id));
      toast.error(`Run failed: ${(e as Error).message}`);
      setChainStatus(target.id, "draft");
      teardownChainRun();
      flashChain("err");
      setLastChainResult({ chainId: target.id, ok: false, durationMs: Date.now() - liveStartRef.current, ts: Date.now(), error: (e as Error).message });
      return;
    }

    livePollRef.current = setInterval(async () => {
      try {
        const live = await ChainAPI.getRun(runId);
        if (!live || live.status === "running") return;
        const dur = live.durationMs ?? Date.now() - liveStartRef.current;
        if (live.status === "done") {
          flashChain("ok");
          toast.success(`✓ Chain ${target.name} · ${dur}ms · run ${runId}`);
          setLastChainResult({ chainId: target.id, ok: true, durationMs: dur, ts: Date.now() });
        } else if (live.status === "stopped") {
          flashChain("stopped");
          toast.message(`⊘ Chain ${target.name} stopped · ${dur}ms`);
          setLastChainResult({ chainId: target.id, ok: false, durationMs: dur, ts: Date.now(), error: "stopped" });
        } else {
          flashChain("err");
          setErroredChains((p) => new Set(p).add(target.id));
          toast.error(`✕ Chain ${target.name} failed · ${live.error ?? "unknown"}`);
          setLastChainResult({ chainId: target.id, ok: false, durationMs: dur, ts: Date.now(), error: live.error ?? "failed" });
        }
        cancelRunRef.current = true;
        setChainStatus(target.id, "draft");
        const newRuns = await ChainAPI.runs(target.id).catch(() => []);
        setRuns(newRuns);
        teardownChainRun();
      } catch {
        /* keep polling; transient errors */
      }
    }, 1000);
  };

  const stopChain = useCallback(async () => {
    const runId = liveRunIdRef.current;
    cancelRunRef.current = true;
    if (runId) {
      try { await ChainAPI.stopRun(runId); } catch { /* may already have finished */ }
      toast.message("Stopping chain…");
      // Final status arrives via poll; do not tear down here.
    } else {
      teardownChainRun();
      if (activeId) setChainStatus(activeId, "draft");
      toast.message("Chain stopped");
    }
  }, [activeId, teardownChainRun]);


  // drop a workflow card from the sidebar
  const onDragStartWf = (e: DragEvent, wf: WfMeta) => {
    e.dataTransfer.setData("application/chain-wf", JSON.stringify(wf));
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragStartTpl = (e: DragEvent, kind: "condition" | "end") => {
    e.dataTransfer.setData("application/chain-tpl", kind);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: DragEvent) => { e.preventDefault(); };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !active) return;
    const pos = {
      x: clamp(e.clientX - rect.left - NODE_W_BASE / 2, 8, rect.width - NODE_W_BASE - 8),
      y: clamp(e.clientY - rect.top - NODE_H_BASE / 2, 8, canvasH - NODE_H_BASE - 8),
    };
    const wf = e.dataTransfer.getData("application/chain-wf");
    const tpl = e.dataTransfer.getData("application/chain-tpl");
    const sk = e.dataTransfer.getData("application/chain-skill");
    if (wf) {
      const m = JSON.parse(wf) as WfMeta;
      const node: ChainNode = { id: uid("n"), kind: "workflow", position: pos, workflowId: m.id, label: m.name };
      updateActive((c) => ({ ...c, nodes: [...c.nodes, node] }));
    } else if (sk) {
      const skill = JSON.parse(sk) as SkillDef;
      const node: ChainNode = {
        id: uid("n"), kind: "skill", position: pos,
        skillSlug: skill.slug, label: `!${skill.slug}`, color: skill.color, params: {},
      };
      updateActive((c) => ({ ...c, nodes: [...c.nodes, node] }));
    } else if (tpl === "condition") {
      const node: ChainNode = { id: uid("n"), kind: "condition", position: pos, expression: "ctx.severity === 'critical'", label: "IF" };
      updateActive((c) => ({ ...c, nodes: [...c.nodes, node] }));
    } else if (tpl === "end") {
      const node: ChainNode = { id: uid("n"), kind: "end", position: pos, label: "END" };
      updateActive((c) => ({ ...c, nodes: [...c.nodes, node] }));
    }
  };

  // Add a Forge action onto the canvas at a default offset
  const addFromForge = (a: ActionDef) => {
    if (!active) return toast.info("Pick a chain first");
    const params: Record<string, unknown> = {};
    for (const p of a.params || []) if (p.default !== undefined) params[p.key] = p.default;
    const kind: ChainNode["kind"] = a.kind === "logic" ? "condition" : "action";
    const node: ChainNode = {
      id: uid("n"),
      kind,
      position: { x: 200 + Math.random() * 200, y: 120 + Math.random() * 200 },
      label: a.name,
      actionId: a.id,
      color: a.color,
      params,
      ...(kind === "condition" ? { expression: "ctx.severity === 'critical'" } : {}),
    };
    updateActive((c) => ({ ...c, nodes: [...c.nodes, node] }));
    setSelected(node.id);
  };

  // Export helpers (PDF / MD / Visio)
  const exportPdf = async () => {
    if (!wrapRef.current || !active) return;
    try { await exportCanvasPdf(wrapRef.current, active.name); toast.success("PDF exported"); }
    catch (e) { toast.error(`PDF failed: ${(e as Error).message}`); }
  };
  const exportMd = () => {
    if (!active) return;
    exportGraphMd(`Chain · ${active.name}`,
      active.nodes.map((n) => ({ id: n.id, label: n.label || n.kind, x: n.position.x, y: n.position.y, meta: `kind=${n.kind}` })),
      active.edges.map((e) => ({ source: e.source, target: e.target, label: e.branch })));
    toast.success("MD exported");
  };
  const exportVisio = () => {
    if (!active) return;
    exportGraphVisio(active.name || "Chain",
      active.nodes.map((n) => ({ id: n.id, label: n.label || n.kind, x: n.position.x, y: n.position.y, w: NODE_W_BASE, h: NODE_H_BASE })),
      active.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      canvasH);
    toast.success("Visio exported");
  };

  // drag node
  useEffect(() => {
    if (!dragging) return;
    const onMove = (ev: PointerEvent) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clamp(ev.clientX - rect.left - dragging.offX, 8, rect.width - NODE_W_BASE - 8);
      const y = clamp(ev.clientY - rect.top - dragging.offY, 8, canvasH - NODE_H_BASE - 8);
      updateActive((c) => ({ ...c, nodes: c.nodes.map((n) => n.id === dragging.id ? { ...n, position: { x, y } } : n) }));
    };
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [dragging, updateActive]);

  // connecting
  useEffect(() => {
    if (!connecting) return;
    const onMove = (ev: PointerEvent) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect || !active) return;
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let hover: string | null = null;
      for (const n of active.nodes) {
        if (n.id === connecting.source) continue;
        if (x >= n.position.x && x <= n.position.x + NODE_W_BASE && y >= n.position.y && y <= n.position.y + NODE_H_BASE) {
          hover = n.id; break;
        }
      }
      setConnecting((p) => p ? { ...p, x, y, hover } : p);
    };
    const onUp = () => {
      setConnecting((cur) => {
        if (cur?.hover && active) {
          const exists = active.edges.some((e) => e.source === cur.source && e.target === cur.hover && e.branch === cur.branch);
          if (!exists) {
            const edge: ChainEdge = { id: uid("e"), source: cur.source, target: cur.hover, branch: cur.branch };
            updateActive((c) => ({ ...c, edges: [...c.edges, edge] }));
          }
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [connecting, active, updateActive]);

  const beginConnect = (ev: ReactPointerEvent, sourceId: string, branch: ChainEdge["branch"]) => {
    ev.stopPropagation();
    ev.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConnecting({ source: sourceId, branch, x: ev.clientX - rect.left, y: ev.clientY - rect.top, hover: null });
  };

  const startMove = (ev: ReactPointerEvent, n: ChainNode) => {
    if (ev.button !== 0) return;
    if ((ev.target as HTMLElement).closest("button, [data-handle]")) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSelected(n.id);
    setDragging({ id: n.id, offX: ev.clientX - rect.left - n.position.x, offY: ev.clientY - rect.top - n.position.y });
  };

  const deleteNode = (id: string) => {
    updateActive((c) => ({
      ...c,
      nodes: c.nodes.filter((n) => n.id !== id),
      edges: c.edges.filter((e) => e.source !== id && e.target !== id),
    }));
    setSelected(null);
  };

  const deleteEdge = (id: string) => updateActive((c) => ({ ...c, edges: c.edges.filter((e) => e.id !== id) }));

  const lastRun = runs[0];
  const activeNodeInRun = execNode || (lastRun?.status === "running" ? lastRun.current_node : null);

  return (
    <PageShell>
      <PageHeader
        title={t("page.orchestration.title")}
        subtitle={t("page.orchestration.subtitle")}
        actions={
          <>
            <Button variant="outline" onClick={newChain}><Plus className="h-4 w-4 mr-1" />{t("orch.new_chain")}</Button>
            <Button variant="outline" onClick={saveChain}><Save className="h-4 w-4 mr-1" />{t("common.save")}</Button>
            <Button
              onClick={() => (running ? stopChain() : runChain())}
              disabled={!active}
              variant={running ? "destructive" : chainFlash === "err" ? "destructive" : "default"}
              className={
                running
                  ? "animate-pulse"
                  : chainFlash === "ok"
                  ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                  : chainFlash === "stopped"
                  ? "bg-muted text-muted-foreground"
                  : "bg-gradient-primary text-primary-foreground"
              }
            >
              {running ? <Square className="h-4 w-4 mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
              {running
                ? `STOP · ${Math.round(liveElapsedMs / 100) / 10}s`
                : chainFlash === "ok"
                ? `✓ ${lastChainResult?.durationMs ?? 0}ms`
                : chainFlash === "stopped"
                ? "⊘ STOPPED"
                : chainFlash === "err"
                ? "✕ Retry"
                : t("skills.trigger")}
            </Button>

          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="glass lg:col-span-3">
          <CardContent className="p-3 space-y-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{t("orch.chains")}</p>
              <div className="space-y-1 max-h-[320px] overflow-auto">
                {chains.map((c) => (
                  <div key={c.id}
                    title={c.description || undefined}
                    className={`border rounded p-2 cursor-pointer ${activeId === c.id ? "border-primary" : "border-border"} ${erroredChains.has(c.id) ? "wf-strobe" : ""}`}
                    onMouseDown={() => { if (activeId !== c.id) { setActiveId(c.id); setSelected(null); setConnecting(null); setDragging(null); } }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color || "var(--primary)" }} />
                        <Input
                          value={c.name}
                          onFocus={(e) => { e.stopPropagation(); setActiveId(c.id); }}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            setActiveId(c.id);
                            setChains((prev) => prev.map((item) => item.id === c.id ? { ...item, name: e.target.value } : item));
                          }}
                          className="h-6 border-0 bg-transparent px-1 text-xs font-medium"
                        />
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {c.isSystem && (
                          <Badge variant="secondary" className="text-[9px] font-mono px-1.5 py-0" title="System template">SYS</Badge>
                        )}
                        <Badge variant="outline" className="text-[9px] font-mono">{c.status ?? "draft"}</Badge>
                      </span>
                    </div>
                    {c.description && (
                      <div className="mt-1 text-[10px] text-muted-foreground leading-snug line-clamp-2">{c.description}</div>
                    )}
                    <div className="mt-1 flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {CHAIN_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`h-4 w-4 rounded-full border ${c.color === color ? "border-foreground" : "border-border"}`}
                          style={{ background: color }}
                          title="Chain color"
                          onClick={() => { setActiveId(c.id); setChains((prev) => prev.map((item) => item.id === c.id ? { ...item, color } : item)); }}
                        />
                      ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {c.nodes.length} nodes · {c.edges.length} edges
                    </div>
                    <div className="flex gap-1 mt-1">
                      {running && activeId === c.id ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-6 px-2 font-mono text-[10px] gap-1 animate-pulse"
                          title="Stop run"
                          onClick={(e) => { e.stopPropagation(); stopChain(); }}>
                          <Square className="h-3 w-3" /> STOP · {Math.round(liveElapsedMs / 100) / 10}s
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant={chainFlash === "ok" && lastChainResult?.chainId === c.id ? "default" : chainFlash === "err" && lastChainResult?.chainId === c.id ? "destructive" : "outline"}
                          className={`h-6 px-2 font-mono text-[10px] gap-1 ${
                            chainFlash === "ok" && lastChainResult?.chainId === c.id ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""
                          }`}
                          title="Run chain"
                          disabled={running}
                          onClick={(e) => { e.stopPropagation(); runChain(c.id); }}>
                          <Play className="h-3 w-3" />
                          {chainFlash === "ok" && lastChainResult?.chainId === c.id ? "DONE" : chainFlash === "err" && lastChainResult?.chainId === c.id ? "FAIL" : chainFlash === "stopped" && lastChainResult?.chainId === c.id ? "STOPPED" : "PLAY"}
                        </Button>
                      )}

                      <Button size="icon" variant="ghost" className="h-6 w-6"
                        onClick={(e) => { e.stopPropagation(); cloneChain(c.id); }}>
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                        onClick={(e) => { e.stopPropagation(); removeChain(c.id); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                {chains.length === 0 && <p className="text-[10px] text-muted-foreground font-mono">{t("orch.no_chains")}</p>}
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">{t("orch.workflows")}</p>
              <div className="space-y-1 max-h-[260px] overflow-auto">
                {wfs.map((w) => (
                  <div key={w.id} draggable onDragStart={(e) => onDragStartWf(e, w)}
                    className="flex items-center gap-2 border border-border rounded p-1.5 cursor-grab active:cursor-grabbing hover:bg-accent/40">
                    <WfIcon className="h-3 w-3 text-primary" />
                    <span className="text-[11px] font-mono truncate">{w.name}</span>
                  </div>
                ))}
                {wfs.length === 0 && <p className="text-[10px] text-muted-foreground font-mono">{t("orch.no_workflows")}</p>}
              </div>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">{t("orch.logic")}</p>
              <div className="space-y-1">
                <div draggable onDragStart={(e) => onDragStartTpl(e, "condition")}
                  className="flex items-center gap-2 border border-border rounded p-1.5 cursor-grab active:cursor-grabbing hover:bg-accent/40">
                  <GitBranch className="h-3 w-3" style={{ color: nodeColor("condition") }} />
                  <span className="text-[11px] font-mono">Condition (IF)</span>
                </div>
                <div draggable onDragStart={(e) => onDragStartTpl(e, "end")}
                  className="flex items-center gap-2 border border-border rounded p-1.5 cursor-grab active:cursor-grabbing hover:bg-accent/40">
                  <FlagOff className="h-3 w-3" style={{ color: nodeColor("end") }} />
                  <span className="text-[11px] font-mono">{t("orch.end")}</span>
                </div>
              </div>
            </div>

            {/* Live Forge picker — actions/triggers/logic from PostgreSQL */}
            <div className="border-t border-border pt-3">
              <ForgePicker onAdd={addFromForge} />
            </div>

            {/* Skills palette — drag onto canvas as skill nodes */}
            <ChainSkillsPalette />

            {lastRun && (
              <div className="border-t border-border pt-3">
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">{t("orch.last_run")}</p>
                <Badge variant="outline" className="font-mono text-[10px]">{lastRun.status}</Badge>
                <pre className="text-[9px] font-mono mt-2 p-2 rounded bg-muted/40 overflow-auto max-h-40">{JSON.stringify(lastRun.context, null, 2)}</pre>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass lg:col-span-9 overflow-hidden">
          <CardContent className="p-0">
            <div className="px-4 py-2 border-b border-border flex items-center gap-3">
              <Input
                value={active?.name ?? ""}
                onChange={(e) => active && setChains((prev) => prev.map((c) => c.id === active.id ? { ...c, name: e.target.value } : c))}
                className="h-8 max-w-xs text-sm font-medium"
                placeholder={t("orch.chain_name_ph")}
              />
              <input
                type="color"
                value={active?.color ?? "#06b6d4"}
                onChange={(e) => active && setChains((prev) => prev.map((c) => c.id === active.id ? { ...c, color: e.target.value } : c))}
                className="h-7 w-8 rounded border border-border bg-transparent cursor-pointer"
                title="Chain color"
              />
              <Badge variant="outline" className="font-mono text-[10px]">{active?.status ?? "draft"}</Badge>
              <span className="text-[10px] font-mono text-muted-foreground">
                {active?.nodes.length ?? 0} nodes · {active?.edges.length ?? 0} edges
              </span>
              {selected && (
                <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => deleteNode(selected)}>
                  <Trash2 className="h-3 w-3 mr-1" />Delete node
                </Button>
              )}
              <Button
                size="sm"
                disabled={!active}
                onClick={() => (running ? stopChain() : runChain())}
                variant={running ? "destructive" : "default"}
                className={
                  running
                    ? "h-7 font-mono text-[11px] tracking-wider animate-pulse"
                    : chainFlash === "ok"
                    ? "h-7 bg-emerald-500 hover:bg-emerald-600 text-white font-mono text-[11px] tracking-wider"
                    : chainFlash === "err"
                    ? "h-7 font-mono text-[11px] tracking-wider"
                    : chainFlash === "stopped"
                    ? "h-7 bg-muted text-muted-foreground font-mono text-[11px] tracking-wider"
                    : "h-7 bg-gradient-primary text-primary-foreground font-mono text-[11px] tracking-wider"
                }
                title={running ? "Click to stop run" : "Run chain"}
              >
                {running ? <Square className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                {running
                  ? `RUNNING ${Math.round(liveElapsedMs / 100) / 10}s · CLICK TO STOP`
                  : chainFlash === "ok"
                  ? `✓ DONE ${lastChainResult?.durationMs ?? 0}MS`
                  : chainFlash === "stopped"
                  ? "⊘ STOPPED"
                  : chainFlash === "err"
                  ? "✕ FAILED — RETRY"
                  : "RUN CHAIN"}
              </Button>

              {runs.length > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground">{runs.length} runs · last {new Date(runs[0].started_at).toLocaleTimeString()}</span>
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
                    <SelectItem value="solid" className="text-[11px] font-mono">{t("orch.solid_color")}</SelectItem>
                  </SelectContent>
                </Select>
                {bgTheme === "solid" && (
                  <input type="color" value={bgSolid} onChange={(e) => setBgSolid(e.target.value)}
                    className="h-7 w-8 rounded border border-border bg-transparent cursor-pointer" title="Solid background color" />
                )}
                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={exportPdf}>PDF</Button>
                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={exportMd}>MD</Button>
                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={exportVisio}>Visio</Button>
              </div>
            </div>

            <div
              ref={wrapRef}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onClick={() => setSelected(null)}
              className={`relative overflow-hidden ${active && erroredChains.has(active.id) ? "wf-strobe rounded" : ""}`}
              style={{ height: canvasH, ...wfBgStyle(bgTheme, bgSolid) }}
            >
              <svg className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
                <defs>
                  <marker id="ch-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L0,6 L9,3 z" fill="currentColor" />
                  </marker>
                </defs>
                {(active?.edges ?? []).map((edge) => {
                  const s = active!.nodes.find((n) => n.id === edge.source);
                  const t = active!.nodes.find((n) => n.id === edge.target);
                  if (!s || !t) return null;
                  const sS = (s.scale ?? 1) * nodeScale;
                  const tS = (t.scale ?? 1) * nodeScale;
                  const x1 = s.position.x + NODE_W_BASE * sS;
                  const y1 = s.position.y + (NODE_H_BASE * sS) / 2;
                  const x2 = t.position.x;
                  const y2 = t.position.y + (NODE_H_BASE * tS) / 2;
                  const mid = Math.max(48, Math.abs(x2 - x1) / 2);
                  const d = `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`;
                  const color = edge.branch === "true" ? "#10b981" : edge.branch === "false" ? "#ef4444" : "#06b6d4";
                  const isFlowing = activeEdges.has(edge.id);
                  const glow = isFlowing ? "#10b981" : color;
                  return (
                    <g key={edge.id} style={{ color }}>
                      <path d={d} fill="none" stroke={color} strokeWidth="2" markerEnd="url(#ch-arrow)" opacity="0.55" />
                      <path d={d} fill="none" stroke={glow}
                        strokeWidth={isFlowing ? 3 : 2.2}
                        strokeDasharray={isFlowing ? "10 6" : "6 8"}
                        opacity={isFlowing ? 1 : 0.6}
                        style={{
                          animation: `${isFlowing ? "wf-dash-fast" : "wf-dash"} ${isFlowing ? "0.55s" : "0.9s"} linear infinite`,
                          filter: isFlowing ? `drop-shadow(0 0 8px ${glow})` : undefined,
                        }} />
                      {isFlowing && (
                        <circle r="4.5" fill={glow} style={{ filter: `drop-shadow(0 0 6px ${glow})` }}>
                          <animateMotion dur="0.9s" repeatCount="indefinite" path={d} />
                        </circle>
                      )}
                      {edge.branch && edge.branch !== "default" && (
                        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} fill={color} fontSize="10" fontFamily="monospace" textAnchor="middle">{edge.branch.toUpperCase()}</text>
                      )}
                      <path d={d} fill="none" stroke="transparent" strokeWidth="14"
                        className="pointer-events-auto cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); deleteEdge(edge.id); }} />
                    </g>
                  );
                })}
                {connecting && active && (() => {
                  const s = active.nodes.find((n) => n.id === connecting.source);
                  if (!s) return null;
                  const sS = (s.scale ?? 1) * nodeScale;
                  const x1 = s.position.x + NODE_W_BASE * sS;
                  const y1 = s.position.y + (NODE_H_BASE * sS) / 2;
                  let x2 = connecting.x, y2 = connecting.y;
                  if (connecting.hover) {
                    const t = active.nodes.find((n) => n.id === connecting.hover);
                    if (t) { const tS = (t.scale ?? 1) * nodeScale; x2 = t.position.x; y2 = t.position.y + (NODE_H_BASE * tS) / 2; }
                  }
                  const mid = Math.max(48, Math.abs(x2 - x1) / 2);
                  const d = `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`;
                  const color = connecting.branch === "true" ? "#10b981" : connecting.branch === "false" ? "#ef4444" : "#06b6d4";
                  return <path d={d} fill="none" stroke={color} strokeWidth="2.4" strokeDasharray="6 6" />;
                })()}
              </svg>

              {active ? active.nodes.map((n) => {
                const color = n.color || nodeColor(n.kind);
                const isActive = activeNodeInRun === n.id;
                const isCompleted = completedNodes.has(n.id);
                const isFlipping = flippingNodes.has(n.id);
                const ns = (n.scale ?? 1) * nodeScale;
                const nW = Math.round(NODE_W_BASE * ns);
                const nH = Math.round(NODE_H_BASE * ns);
                const style: CSSProperties = {
                  position: "absolute",
                  left: n.position.x,
                  top: n.position.y,
                  width: nW,
                  minHeight: nH,
                  background: "color-mix(in oklab, var(--card) 80%, transparent)",
                  border: `2px solid ${color}`,
                  borderRadius: 12,
                  padding: 8,
                  boxShadow: isActive ? `0 0 24px ${color}` : `0 0 12px color-mix(in oklab, ${color} 30%, transparent)`,
                  fontFamily: "var(--font-mono)",
                };
                const cls = [
                  "select-none transition-shadow",
                  selected === n.id ? "ring-2 ring-primary" : "",
                  isActive ? "wf-executing" : "",
                  isCompleted && !isActive ? "wf-completed" : "",
                  isFlipping ? "wf-flip" : "",
                ].filter(Boolean).join(" ");
                return (
                  <div key={n.id}
                    onPointerDown={(e) => startMove(e, n)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => { e.stopPropagation(); setEditNode(n); }}
                    onWheel={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      const delta = e.deltaY > 0 ? -0.08 : 0.08;
                      const next = clamp((n.scale ?? 1) + delta, 0.5, 3);
                      updateActive((c) => ({ ...c, nodes: c.nodes.map((x) => x.id === n.id ? { ...x, scale: next } : x) }));
                    }}
                    className={cls}
                    style={style}
                  >
                    {/* success checkmark badge */}
                    {isCompleted && (
                      <div className="wf-check-badge" style={{ position: "absolute", top: -10, right: -10, zIndex: 6, background: "oklch(0.78 0.22 145)", color: "#0a1f0a", borderRadius: 999, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px oklch(0.78 0.22 145 / 0.85)" }}>
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      </div>
                    )}
                    {/* target handle */}
                    <div data-handle title="Input" style={{ position: "absolute", left: -8, top: nH / 2 - 8, width: 16, height: 16, borderRadius: 999, background: "var(--background)", border: `2px solid ${color}`, zIndex: 5 }} />
                    {/* source handle(s) */}
                    {n.kind === "condition" ? (
                      <>
                        <div data-handle title="TRUE branch · drag to connect"
                          onPointerDown={(e) => beginConnect(e, n.id, "true")}
                          style={{ position: "absolute", right: -8, top: 8, width: 16, height: 16, borderRadius: 999, background: "#10b981", border: "2px solid var(--background)", zIndex: 5, cursor: "crosshair", boxShadow: "0 0 6px #10b981" }} />
                        <div data-handle title="FALSE branch · drag to connect"
                          onPointerDown={(e) => beginConnect(e, n.id, "false")}
                          style={{ position: "absolute", right: -8, bottom: 8, width: 16, height: 16, borderRadius: 999, background: "#ef4444", border: "2px solid var(--background)", zIndex: 5, cursor: "crosshair", boxShadow: "0 0 6px #ef4444" }} />
                      </>
                    ) : n.kind !== "end" ? (
                      <div data-handle title="Output · drag to connect"
                        onPointerDown={(e) => beginConnect(e, n.id, "default")}
                        style={{ position: "absolute", right: -8, top: nH / 2 - 8, width: 16, height: 16, borderRadius: 999, background: color, border: "2px solid var(--background)", zIndex: 5, cursor: "crosshair", boxShadow: `0 0 6px ${color}` }} />
                    ) : null}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                          {n.kind === "start" && <Flag className="h-2.5 w-2.5" />}
                          {n.kind === "end" && <FlagOff className="h-2.5 w-2.5" />}
                          {n.kind === "condition" && <GitBranch className="h-2.5 w-2.5" />}
                          {n.kind === "workflow" && <WfIcon className="h-2.5 w-2.5" />}
                          {n.kind === "action" && <Hammer className="h-2.5 w-2.5" />}
                          {n.kind === "skill" && <Sparkles className="h-2.5 w-2.5" />}
                          {n.kind} · {Math.round(ns * 100)}%
                        </div>
                        <div className="truncate font-medium" style={{ fontSize: 12 * Math.min(ns, 1.6) }} title={n.label}>{n.label || n.kind}</div>
                        {n.kind === "condition" && (
                          <div className="text-[9px] truncate text-muted-foreground" title={n.expression}>{n.expression}</div>
                        )}
                        {n.kind === "action" && n.actionId && (
                          <div className="text-[9px] truncate text-muted-foreground font-mono" title={n.actionId}>⚙ {n.actionId}</div>
                        )}
                        {n.kind === "skill" && n.skillSlug && (
                          <div className="text-[9px] truncate text-fuchsia-300 font-mono" title={n.skillSlug}>✨ !{n.skillSlug}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); if (!running && active) runChain(active.id); }}
                          disabled={running}
                          className="h-5 w-5 inline-flex items-center justify-center rounded border border-border hover:bg-emerald-500/10 text-emerald-500 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Start chain"
                        >
                          <Play className="h-3 w-3" />
                        </button>
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); stopChain(); }}
                          disabled={!running}
                          className="h-5 w-5 inline-flex items-center justify-center rounded border border-border hover:bg-amber-500/10 text-amber-500 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Stop chain"
                        >
                          <Square className="h-3 w-3" />
                        </button>
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); deleteNode(n.id); }}
                          className="h-5 w-5 inline-flex items-center justify-center rounded border border-border hover:bg-destructive/10 text-destructive shrink-0"
                          title="Delete node"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    {/* Resize handle (bottom-right) */}
                    <div
                      title="Drag to resize · or scroll wheel"
                      onPointerDown={(e) => {
                        e.stopPropagation(); e.preventDefault();
                        const startX = e.clientX;
                        const startScale = n.scale ?? 1;
                        const onMove = (ev: PointerEvent) => {
                          const dx = ev.clientX - startX;
                          const next = clamp(startScale + dx / 200, 0.5, 3);
                          updateActive((c) => ({ ...c, nodes: c.nodes.map((x) => x.id === n.id ? { ...x, scale: next } : x) }));
                        };
                        const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
                        window.addEventListener("pointermove", onMove);
                        window.addEventListener("pointerup", onUp);
                      }}
                      style={{ position: "absolute", right: 2, bottom: 2, width: 12, height: 12, cursor: "nwse-resize", borderRight: `2px solid ${color}`, borderBottom: `2px solid ${color}`, opacity: 0.7, zIndex: 4 }}
                    />
                  </div>
                );
              }) : (
                <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground font-mono">
                  No chain selected — create one
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editNode} onOpenChange={(o) => !o && setEditNode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("orch.edit_node")} · {editNode?.kind}</DialogTitle>
          </DialogHeader>
          {editNode && (
            <div className="space-y-3">
              <div>
                <Label>{t("common.label")}</Label>
                <Input value={editNode.label ?? ""} onChange={(e) => setEditNode({ ...editNode, label: e.target.value })} className="mt-1 font-mono" />
              </div>
              {editNode.kind === "condition" && (
                <div>
                  <Label>Expression (uses <code>ctx.*</code>)</Label>
                  <Input
                    value={editNode.expression ?? ""}
                    onChange={(e) => setEditNode({ ...editNode, expression: e.target.value })}
                    placeholder="ctx.severity === 'critical'"
                    className="mt-1 font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Allowed: ctx, literals, === !== &gt; &lt; &amp;&amp; ||</p>
                </div>
              )}
              {editNode.kind === "workflow" && (
                <div>
                  <Label>{t("orch.workflows")}</Label>
                  <select
                    value={editNode.workflowId ?? ""}
                    onChange={(e) => {
                      const wf = wfs.find((w) => w.id === e.target.value);
                      setEditNode({ ...editNode, workflowId: e.target.value, label: wf?.name ?? editNode.label });
                    }}
                    className="mt-1 w-full h-9 rounded border border-border bg-background px-2 text-sm font-mono"
                  >
                    {wfs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}
              {editNode.kind === "skill" && editNode.skillSlug && (
                <SkillBindingsEditor
                  slug={editNode.skillSlug}
                  bindings={editNode.bindings ?? {}}
                  upstream={collectUpstreamCtxKeys(active, editNode.id)}
                  onChange={(b) => setEditNode({ ...editNode, bindings: b })}
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditNode(null)}>{t("common.cancel")}</Button>
            <Button className="bg-gradient-primary text-primary-foreground" onClick={() => {
              if (!editNode) return;
              updateActive((c) => ({ ...c, nodes: c.nodes.map((n) => n.id === editNode.id ? editNode : n) }));
              setEditNode(null);
              toast.success("Node updated");
            }}>
              <Play className="h-3 w-3 mr-1" />Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function ChainSkillsPalette() {
  const [skills, setSkills] = useState<SkillDef[]>([]);
  useEffect(() => {
    SkillsAPI.list().then(setSkills).catch(() => setSkills([]));
  }, []);
  if (skills.length === 0) return null;
  const onDragStartSk = (e: DragEvent, sk: SkillDef) => {
    e.dataTransfer.setData("application/chain-skill", JSON.stringify(sk));
    e.dataTransfer.effectAllowed = "move";
  };
  return (
    <div className="border-t border-border pt-3">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
        <Sparkles className="h-3 w-3 text-fuchsia-400" /> Skills
      </p>
      <div className="space-y-1 max-h-[260px] overflow-auto">
        {skills.map((sk) => (
          <div key={sk.id} draggable onDragStart={(e) => onDragStartSk(e, sk)}
            className="flex items-center gap-2 border border-border rounded p-1.5 cursor-grab active:cursor-grabbing hover:bg-fuchsia-500/10"
            title={`${sk.description || sk.slug} · risk:${sk.risk_level}${sk.requires_approval ? " · approval" : ""}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: sk.color }} />
            <span className="text-[11px] font-mono flex-1 truncate">!{sk.slug}</span>
            <span className="text-[9px] font-mono text-muted-foreground">{sk.risk_level}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Skill Bindings Editor — Visual Binding UI
// Maps the destination skill's input ports to upstream ctx keys
// (or literal values), feeding the backend's `bindings` runtime.
// ============================================================
function collectUpstreamCtxKeys(active: ChainState | undefined, nodeId: string): string[] {
  if (!active) return [];
  // Walk back from nodeId via edges; collect skill outputs (skillSlug params + common ctx fields).
  const byId = new Map(active.nodes.map((n) => [n.id, n] as const));
  const incoming = new Map<string, string[]>();
  for (const e of active.edges) {
    const arr = incoming.get(e.target) ?? [];
    arr.push(e.source);
    incoming.set(e.target, arr);
  }
  const seen = new Set<string>();
  const stack = [nodeId];
  const keys = new Set<string>(["severity", "summary", "ok", "ts"]);
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const src of incoming.get(cur) ?? []) {
      const node = byId.get(src);
      if (node?.kind === "skill" && node.skillSlug) {
        keys.add(`${node.skillSlug}.output`);
      }
      stack.push(src);
    }
  }
  return Array.from(keys);
}

function SkillBindingsEditor({
  slug, bindings, upstream, onChange,
}: {
  slug: string;
  bindings: Record<string, string>;
  upstream: string[];
  onChange: (next: Record<string, string>) => void;
}) {
  const [skill, setSkill] = useState<SkillDef | null>(null);
  useEffect(() => {
    SkillsAPI.list().then((rows) => setSkill(rows.find((s) => s.slug === slug) ?? null)).catch(() => setSkill(null));
  }, [slug]);
  const props = (skill?.param_schema as { properties?: Record<string, { type?: string; description?: string }> } | undefined)?.properties ?? {};
  const portKeys = Object.keys(props);
  if (portKeys.length === 0) {
    return (
      <div className="border border-border rounded p-3">
        <p className="text-[11px] font-mono text-muted-foreground">
          <Sparkles className="inline h-3 w-3 mr-1 text-fuchsia-400" />
          !{slug} — no input ports defined in param_schema.
        </p>
      </div>
    );
  }
  return (
    <div className="border border-border rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-fuchsia-400" /> Bindings · !{slug}</Label>
        <span className="text-[10px] font-mono text-muted-foreground">{portKeys.length} input pin{portKeys.length === 1 ? "" : "s"}</span>
      </div>
      <p className="text-[10px] font-mono text-muted-foreground">
        Use <code>$ctx.field</code> to wire upstream output, or type a literal value.
      </p>
      {portKeys.map((k) => {
        const meta = props[k] ?? {};
        const cur = bindings[k] ?? "";
        return (
          <div key={k} className="grid grid-cols-[120px_1fr] gap-2 items-center">
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-fuchsia-400" title="input pin" />
              <span className="text-[11px] font-mono">{k}</span>
              {meta.type && <span className="text-[9px] font-mono text-muted-foreground">{meta.type}</span>}
            </div>
            <div className="flex gap-1">
              <Input
                value={cur}
                placeholder={meta.description || "$ctx.field or literal"}
                onChange={(e) => onChange({ ...bindings, [k]: e.target.value })}
                className="font-mono text-xs h-8"
              />
              <Select value="" onValueChange={(v) => onChange({ ...bindings, [k]: `$ctx.${v}` })}>
                <SelectTrigger className="w-32 h-8 text-[10px] font-mono"><SelectValue placeholder="$ctx" /></SelectTrigger>
                <SelectContent>
                  {upstream.map((u) => (<SelectItem key={u} value={u} className="text-[11px] font-mono">{u}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
