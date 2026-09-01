import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { nodeGlyph } from "@/lib/node-glyph";
import type { WorkflowEdge, WorkflowNode, WorkflowNodeKind } from "@/mocks/workflows";

export const NODE_W = 236;
export const NODE_H = 66;
const GRID = 8;
const MAGNET_RADIUS = 110;

const kindTone: Record<WorkflowNodeKind, string> = {
  trigger: "sapphire",
  action: "topaz",
  skill: "amethyst",
  logic: "ruby",
  output: "emerald",
  workflow: "amethyst",
};

export function portPos(node: WorkflowNode, side: "in" | "out") {
  return { x: node.x + (side === "out" ? NODE_W : 0), y: node.y + NODE_H / 2 };
}

function bezier(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // fluid horizontal handles: grow with distance, stay generous on back-links
  const reach = Math.max(70, Math.abs(dx) * 0.55 + Math.abs(dy) * 0.22);
  const back = dx < 60 ? Math.min(180, (60 - dx) * 0.6) : 0;
  const c1 = a.x + reach + back;
  const c2 = b.x - reach - back;
  return `M ${a.x} ${a.y} C ${c1} ${a.y}, ${c2} ${b.y}, ${b.x} ${b.y}`;
}

type Draft = {
  from: string;
  cursor: { x: number; y: number };
  magnet: string | null;
};

export function WorkflowCanvas({
  nodes,
  edges,
  zoom,
  selected,
  pan: panProp,
  onPanChange,
  onSelect,
  onMoveNode,
  onConnect,
  onDeleteNode,
  onDeleteEdge,
  onDropSkill,
}: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  zoom: number;
  selected: string | null;
  pan?: { x: number; y: number };
  onPanChange?: (pan: { x: number; y: number }) => void;
  onSelect: (id: string | null) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnect: (from: string, to: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onDropSkill?: (label: string, x: number, y: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [internalPan, setInternalPan] = useState({ x: 0, y: 0 });
  const pan = panProp ?? internalPan;
  const setPan = useCallback(
    (next: { x: number; y: number }) => {
      if (onPanChange) onPanChange(next);
      else setInternalPan(next);
    },
    [onPanChange],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return { x: (clientX - r.left - pan.x) / zoom, y: (clientY - r.top - pan.y) / zoom };
    },
    [pan, zoom],
  );

  useEffect(() => {
    function move(e: PointerEvent) {
      const p = toCanvas(e.clientX, e.clientY);
      if (dragRef.current) {
        const d = dragRef.current;
        onMoveNode(
          d.id,
          Math.round((p.x - d.dx) / GRID) * GRID,
          Math.round((p.y - d.dy) / GRID) * GRID,
        );
      } else if (panRef.current) {
        const s = panRef.current;
        setPan({ x: s.x + (e.clientX - s.px), y: s.y + (e.clientY - s.py) });
      } else if (draft) {
        let magnet: string | null = null;
        let best = MAGNET_RADIUS;
        for (const n of nodes) {
          if (n.id === draft.from) continue;
          const ip = portPos(n, "in");
          const d = Math.hypot(ip.x - p.x, ip.y - p.y);
          if (d < best) {
            best = d;
            magnet = n.id;
          }
        }
        setDraft({ from: draft.from, cursor: p, magnet });
      }
    }
    function up() {
      if (draft?.magnet) onConnect(draft.from, draft.magnet);
      dragRef.current = null;
      panRef.current = null;
      setDraft(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [draft, nodes, onConnect, onMoveNode, setPan, toCanvas]);

  const nodeById = (id: string) => nodes.find((n) => n.id === id);

  return (
    <div
      ref={wrapRef}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset["bg"] === "1") {
          onSelect(null);
          panRef.current = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const label = e.dataTransfer.getData("text/elara-skill");
        if (!label || !onDropSkill) return;
        const p = toCanvas(e.clientX, e.clientY);
        onDropSkill(
          label,
          Math.round((p.x - NODE_W / 2) / GRID) * GRID,
          Math.round((p.y - NODE_H / 2) / GRID) * GRID,
        );
      }}
      className="relative h-full w-full cursor-grab overflow-hidden rounded-[14px] border border-border bg-canvas-deep active:cursor-grabbing"
    >
      <div
        data-bg="1"
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(oklch(1 0 0 / 9%) 1px, transparent 1px)",
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width="1"
          height="1"
        >
          <defs>
            <linearGradient id="edge-stream" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--sapphire)" stopOpacity="0.85" />
              <stop offset="55%" stopColor="var(--amethyst)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="var(--emerald)" stopOpacity="0.85" />
            </linearGradient>
          </defs>
          {edges.map((e) => {
            const a = nodeById(e.from);
            const b = nodeById(e.to);
            if (!a || !b) return null;
            const d = bezier(portPos(a, "out"), portPos(b, "in"));
            return (
              <g key={e.id} className="edge-group">
                {/* soft bloom underlay */}
                <path
                  d={d}
                  fill="none"
                  stroke="url(#edge-stream)"
                  strokeWidth={5}
                  strokeLinecap="round"
                  opacity={0.14}
                  style={{ filter: "blur(3px)" }}
                />
                {/* solid fluid ribbon */}
                <path
                  d={d}
                  fill="none"
                  stroke="url(#edge-stream)"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  opacity={0.9}
                />
                {/* travelling energy */}
                <path
                  className="edge-flow"
                  d={d}
                  fill="none"
                  stroke="var(--platinum)"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeDasharray="2 16"
                  opacity={0.55}
                />
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  className="pointer-events-auto cursor-pointer"
                  onPointerDown={(ev) => {
                    ev.stopPropagation();
                    onDeleteEdge(e.id);
                  }}
                />
              </g>
            );
          })}

          {draft &&
            (() => {
              const a = nodeById(draft.from);
              if (!a) return null;
              const target = draft.magnet ? nodeById(draft.magnet) : null;
              const end = target ? portPos(target, "in") : draft.cursor;
              const tone = draft.magnet ? "var(--emerald)" : "var(--platinum)";
              const d = bezier(portPos(a, "out"), end);
              return (
                <g>
                  <path
                    d={d}
                    fill="none"
                    stroke={tone}
                    strokeWidth={5}
                    opacity={0.12}
                    style={{ filter: "blur(3px)" }}
                  />
                  <path
                    className="edge-flow"
                    d={d}
                    fill="none"
                    stroke={tone}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeDasharray="6 8"
                  />
                </g>
              );
            })()}
        </svg>

        {nodes.map((n) => {
          const glyph = nodeGlyph(n.kind, n.label, n.meta);
          const tone = glyph.tone ?? kindTone[n.kind];
          const Icon = glyph.Icon;
          const isMagnet = draft?.magnet === n.id;
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(n.id);
                const p = toCanvas(e.clientX, e.clientY);
                dragRef.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y };
              }}
              style={{
                left: n.x,
                top: n.y,
                width: NODE_W,
                height: NODE_H,
                borderColor: `color-mix(in oklab, var(--${tone}) ${selected === n.id || isMagnet ? 70 : 34}%, transparent)`,
                boxShadow:
                  selected === n.id || isMagnet
                    ? `0 0 0 1px color-mix(in oklab, var(--${tone}) 45%, transparent), 0 0 34px -10px var(--${tone})`
                    : `0 10px 30px -22px oklch(0 0 0 / 80%)`,
              }}
              className="group absolute cursor-grab select-none rounded-xl border bg-panel/90 px-3 py-2.5 backdrop-blur-md active:cursor-grabbing"
            >
              <div className="flex h-full items-center gap-2.5">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border"
                  style={{
                    borderColor: `color-mix(in oklab, var(--${tone}) 42%, transparent)`,
                    background: `color-mix(in oklab, var(--${tone}) 14%, transparent)`,
                    boxShadow: `0 0 18px -10px var(--${tone})`,
                    color: `var(--${tone})`,
                  }}
                >
                  <Icon className="h-[17px] w-[17px]" strokeWidth={1.6} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="font-mono text-[9.5px] uppercase tracking-[0.16em]"
                      style={{ color: `var(--${tone})` }}
                    >
                      {glyph.family}
                    </span>
                    <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/45">
                      {n.meta}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[13px] text-foreground/95">
                    {n.label}
                  </div>
                </div>
                <button
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void onDeleteNode(n.id);
                  }}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={`Delete ${n.label}`}
                  title={`Delete ${n.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-ruby/80" strokeWidth={1.6} />
                </button>
              </div>

              {n.kind !== "trigger" && (
                <span
                  className={cn(
                    "absolute -left-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border bg-canvas-deep transition-all",
                    isMagnet ? "scale-125 border-emerald" : "border-border",
                  )}
                  style={isMagnet ? { boxShadow: "0 0 16px -2px var(--emerald)" } : undefined}
                />
              )}
              <span
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDraft({ from: n.id, cursor: portPos(n, "out"), magnet: null });
                }}
                style={{
                  background: `color-mix(in oklab, var(--${tone}) 30%, var(--canvas-deep))`,
                }}
                className="absolute -right-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border border-border transition-transform hover:scale-125"
              />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
