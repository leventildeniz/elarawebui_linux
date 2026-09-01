// Sortable + pinnable chat thread sidebar list. Uses dnd-kit (vertical list)
// inside two zones: pinned (top, sticky order) and recent (drag to reorder).
// Order is persisted via UserPrefsAPI (chatOrder = { pinned, recent }) so it
// follows the user across machines, with a localStorage fallback for offline.
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pin, PinOff, Edit3, Trash2, GripVertical } from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserPrefsAPI, type ChatThread } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";

type ChatOrder = { pinned: string[]; recent: string[]; colors?: Record<string, string> };
const LS_KEY = (u: string) => `chat.order.${u}`;

// Same palette as the Workflows board so the cockpit feels coherent.
const CHAT_COLORS = ["#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#3b82f6", "#eab308"];

function readCache(user: string | null): ChatOrder {
  if (!user) return { pinned: [], recent: [], colors: {} };
  try {
    const raw = localStorage.getItem(LS_KEY(user));
    if (!raw) return { pinned: [], recent: [], colors: {} };
    const j = JSON.parse(raw);
    return {
      pinned: Array.isArray(j?.pinned) ? j.pinned.map(String) : [],
      recent: Array.isArray(j?.recent) ? j.recent.map(String) : [],
      colors: (j?.colors && typeof j.colors === "object") ? j.colors as Record<string, string> : {},
    };
  } catch { return { pinned: [], recent: [], colors: {} }; }
}
function writeCache(user: string | null, o: ChatOrder) {
  if (!user) return;
  try { localStorage.setItem(LS_KEY(user), JSON.stringify(o)); } catch {/* noop */}
}

export interface ChatThreadListProps {
  threads: ChatThread[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onRename: (id: string, nextTitle: string) => void;
  onDelete: (id: string) => void;
}

export function ChatThreadList({ threads, activeId, onActivate, onRename, onDelete }: ChatThreadListProps) {
  const { user } = useAuth();
  const userKey = user?.username ?? null;
  const [order, setOrder] = useState<ChatOrder>(() => readCache(userKey));
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushed = useRef<string>("");
  const justPulled = useRef<boolean>(false);

  // ---- Pull from server (per user) ----
  useEffect(() => {
    let cancelled = false;
    setOrder(readCache(userKey));
    if (!userKey) return;
    (async () => {
      const r = await UserPrefsAPI.get();
      if (cancelled || !r.ok) return;
      const co = (r.prefs?.chatOrder ?? null) as ChatOrder | null;
      if (co && (Array.isArray(co.pinned) || Array.isArray(co.recent) || co.colors)) {
        const next: ChatOrder = {
          pinned: Array.isArray(co.pinned) ? co.pinned.map(String) : [],
          recent: Array.isArray(co.recent) ? co.recent.map(String) : [],
          colors: (co.colors && typeof co.colors === "object") ? co.colors : {},
        };
        justPulled.current = true;
        setOrder(next);
        writeCache(userKey, next);
        lastPushed.current = JSON.stringify(next);
        setTimeout(() => { justPulled.current = false; }, 0);
      }
    })();
    return () => { cancelled = true; };
  }, [userKey]);

  // ---- Push (debounced) ----
  useEffect(() => {
    if (!userKey || justPulled.current) return;
    const snap = JSON.stringify(order);
    if (snap === lastPushed.current) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      lastPushed.current = snap;
      writeCache(userKey, order);
      await UserPrefsAPI.put({ chatOrder: order }).catch(() => {});
    }, 600);
    return () => { if (pushTimer.current) clearTimeout(pushTimer.current); };
  }, [order, userKey]);

  // ---- Reconcile order with the live thread list (drop missing, add new) ----
  const { pinnedList, recentList } = useMemo(() => {
    const idSet = new Set(threads.map(t => t.id));
    const byId = new Map(threads.map(t => [t.id, t]));
    const pinnedIds = order.pinned.filter(id => idSet.has(id));
    const pinnedSet = new Set(pinnedIds);
    // Recent ordering: respect saved order first, then append any new threads
    // (sorted by updated_at desc) that aren't pinned and not in saved order.
    const savedRecent = order.recent.filter(id => idSet.has(id) && !pinnedSet.has(id));
    const savedSet = new Set(savedRecent);
    const fresh = threads
      .filter(t => !pinnedSet.has(t.id) && !savedSet.has(t.id))
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
      .map(t => t.id);
    const recentIds = [...fresh, ...savedRecent];
    return {
      pinnedList: pinnedIds.map(id => byId.get(id)!).filter(Boolean),
      recentList: recentIds.map(id => byId.get(id)!).filter(Boolean),
    };
  }, [threads, order]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const togglePin = useCallback((id: string) => {
    setOrder(prev => {
      const isPinned = prev.pinned.includes(id);
      if (isPinned) {
        return {
          ...prev,
          pinned: prev.pinned.filter(x => x !== id),
          recent: [id, ...prev.recent.filter(x => x !== id)],
        };
      }
      return {
        ...prev,
        pinned: [id, ...prev.pinned],
        recent: prev.recent.filter(x => x !== id),
      };
    });
  }, []);

  const setColor = useCallback((id: string, color: string | null) => {
    setOrder(prev => {
      const colors = { ...(prev.colors || {}) };
      if (!color) delete colors[id]; else colors[id] = color;
      return { ...prev, colors };
    });
  }, []);

  const onDragEnd = useCallback((zone: "pinned" | "recent") => (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder(prev => {
      const list = zone === "pinned" ? [...prev.pinned] : [...recentList.map(t => t.id)];
      const oldIdx = list.indexOf(String(active.id));
      const newIdx = list.indexOf(String(over.id));
      if (oldIdx < 0 || newIdx < 0) return prev;
      const next = arrayMove(list, oldIdx, newIdx);
      return zone === "pinned"
        ? { ...prev, pinned: next }
        : { ...prev, recent: next };
    });
  }, [recentList]);

  return (
    <ScrollArea className="flex-1">
      <div className="p-2 space-y-3">
        {pinnedList.length > 0 && (
          <div>
            <div className="px-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Pinned · {pinnedList.length}
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd("pinned")}>
              <SortableContext items={pinnedList.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  {pinnedList.map(th => (
                    <SortableRow
                      key={th.id} thread={th} pinned
                      isActive={activeId === th.id}
                      color={order.colors?.[th.id] ?? null}
                      onActivate={onActivate} onRename={onRename}
                      onDelete={onDelete} onTogglePin={togglePin} onSetColor={setColor}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}

        <div>
          {pinnedList.length > 0 && (
            <div className="px-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Recent
            </div>
          )}
          {recentList.length === 0 && pinnedList.length === 0 && (
            <div className="text-[11px] text-muted-foreground p-2 font-mono">No threads yet.</div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd("recent")}>
            <SortableContext items={recentList.map(t => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {recentList.map(th => (
                  <SortableRow
                    key={th.id} thread={th} pinned={false}
                    isActive={activeId === th.id}
                    color={order.colors?.[th.id] ?? null}
                    onActivate={onActivate} onRename={onRename}
                    onDelete={onDelete} onTogglePin={togglePin} onSetColor={setColor}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </ScrollArea>
  );
}

function SortableRow({
  thread, pinned, isActive, color,
  onActivate, onRename, onDelete, onTogglePin, onSetColor,
}: {
  thread: ChatThread;
  pinned: boolean;
  isActive: boolean;
  color: string | null;
  onActivate: (id: string) => void;
  onRename: (id: string, nextTitle: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onSetColor: (id: string, color: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: thread.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const renameThread = () => {
    const next = prompt("Rename chat", thread.title);
    if (next && next.trim() && next !== thread.title) onRename(thread.id, next.trim());
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={{
            ...style,
            // Left edge color stripe when the thread is colored.
            boxShadow: color ? `inset 3px 0 0 0 ${color}` : undefined,
          }}
          className={`flex flex-col w-full rounded text-xs transition-colors ${
            isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
          }`}
        >
          <div className="flex items-start gap-1 px-1 pt-1">
            <button
              {...attributes}
              {...listeners}
              className="mt-1 p-1 rounded text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing"
              title="Drag to reorder"
              aria-label="Drag to reorder"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onActivate(thread.id)} className="text-left flex-1 min-w-0 pr-1 py-1">
              <div className="font-medium truncate flex items-center gap-1">
                {pinned && <Pin className="h-3 w-3 text-amber-400 shrink-0" />}
                {color && (
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: color, boxShadow: `0 0 6px ${color}80` }}
                  />
                )}
                <span className="truncate">{thread.title}</span>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {new Date(thread.updated_at).toLocaleTimeString()}
              </div>
            </button>
          </div>

          {/* Workflow-style color palette */}
          <div className="flex items-center gap-1 px-1.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
            {CHAT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Set color ${c}`}
                title={color === c ? "Click again to clear" : "Set chat color"}
                onClick={() => onSetColor(thread.id, color === c ? null : c)}
                className={`h-3 w-3 rounded-full border transition-transform hover:scale-110 ${
                  color === c ? "border-foreground ring-1 ring-foreground/40" : "border-border/60"
                }`}
                style={{ background: c }}
              />
            ))}
            {color && (
              <button
                type="button"
                onClick={() => onSetColor(thread.id, null)}
                className="ml-1 text-[9px] font-mono text-muted-foreground hover:text-foreground"
                title="Clear color"
              >
                ×
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 px-1.5 pb-1.5 pt-1">
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePin(thread.id); }}
              className={`flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-mono transition-colors ${
                isActive ? "text-foreground/80 hover:bg-background/40" : "text-muted-foreground/80 hover:bg-accent/40"
              } hover:text-amber-400`}
              title={pinned ? "Unpin chat" : "Pin chat"}
            >
              {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              {pinned ? "Unpin" : "Pin"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); renameThread(); }}
              className={`flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-mono transition-colors ${
                isActive ? "text-foreground/80 hover:bg-background/40" : "text-muted-foreground/80 hover:bg-accent/40"
              } hover:text-primary`}
              title="Rename chat"
            >
              <Edit3 className="h-3.5 w-3.5" /> Rename
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${thread.title}"?`)) onDelete(thread.id); }}
              className={`flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-mono transition-colors ${
                isActive ? "text-foreground/80 hover:bg-background/40" : "text-muted-foreground/80 hover:bg-accent/40"
              } hover:text-destructive`}
              title="Delete chat"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => onTogglePin(thread.id)}>
          {pinned ? <PinOff className="h-3 w-3 mr-2" /> : <Pin className="h-3 w-3 mr-2" />}
          {pinned ? "Unpin" : "Pin to top"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={renameThread}>
          <Edit3 className="h-3 w-3 mr-2" /> Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <div className="px-2 py-1.5 flex items-center gap-1.5">
          {CHAT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Set color ${c}`}
              onClick={() => onSetColor(thread.id, color === c ? null : c)}
              className={`h-4 w-4 rounded-full border ${color === c ? "border-foreground" : "border-border/60"}`}
              style={{ background: c }}
            />
          ))}
          {color && (
            <button
              type="button"
              onClick={() => onSetColor(thread.id, null)}
              className="ml-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            >
              clear
            </button>
          )}
        </div>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => { if (confirm(`Delete "${thread.title}"?`)) onDelete(thread.id); }}
        >
          <Trash2 className="h-3 w-3 mr-2" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
