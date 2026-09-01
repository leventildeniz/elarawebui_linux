import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChats, type ChatColor } from "@/lib/chat-store";
import { ChatMenuPanel } from "./chat-menu-panel";

const dot: Record<ChatColor, string> = {
  none: "transparent",
  sapphire: "var(--sapphire)",
  emerald: "var(--emerald)",
  amethyst: "var(--amethyst)",
  topaz: "var(--topaz)",
  ruby: "var(--ruby)",
};

export function ChatList({ hideHeader = false }: { hideHeader?: boolean }) {
  const { ready, chats, activeId, setActive, rename, togglePin, setColor, remove } = useChats();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !panelRef.current?.contains(t)) setMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const openMenu = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = 240;
    const height = 300;
    setAnchor({
      top: Math.min(r.bottom + 6, window.innerHeight - height - 12),
      left: Math.min(r.right - width, window.innerWidth - width - 12),
    });
    setMenu(id);
  };

  const current = chats.find((c) => c.id === menu);

  // Nothing renders until localStorage is read — avoids the seed list flashing
  // (e.g. the "atlas" thread) before the operator's real active chat appears.
  if (!ready) return <div ref={wrapRef} className={hideHeader ? "" : "mt-5"} />;

  return (
    <div ref={wrapRef} className={hideHeader ? "" : "mt-5"}>
      {!hideHeader && (
        <div className="px-2.5 pb-1.5 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/55">
          Chats
        </div>
      )}

      {chats.map((c) => {
        const open = menu === c.id;
        const isActive = c.id === activeId;
        return (
          <div key={c.id} className="relative">
            {editing === c.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  rename(c.id, draft);
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    rename(c.id, draft);
                    setEditing(null);
                  }
                  if (e.key === "Escape") setEditing(null);
                }}
                className="w-full rounded-lg border border-sapphire/40 bg-raised/60 px-2.5 py-[6px] text-[14.5px] font-medium text-foreground outline-none"
              />
            ) : (
              <div className="group flex items-center gap-2 rounded-lg px-2.5 py-[7px]">
                {isActive && (
                  <span className="absolute left-[2px] top-1/2 h-4 w-[1.5px] -translate-y-1/2 rounded-full bg-sapphire" />
                )}
                {c.color !== "none" && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: dot[c.color], boxShadow: `0 0 10px -2px ${dot[c.color]}` }}
                  />
                )}
                {c.pinned && (
                  <Pin className="h-3.5 w-3.5 shrink-0 text-sapphire" strokeWidth={1.6} />
                )}
                <button
                  onClick={() => {
                    setActive(c.id);
                    void navigate({ to: "/" });
                  }}
                  onDoubleClick={() => {
                    setDraft(c.title);
                    setEditing(c.id);
                  }}
                  className={cn(
                    "min-w-0 flex-1 truncate text-left text-[14.5px] font-medium",
                    isActive ? "text-foreground" : "text-muted-foreground/75",
                  )}
                >
                  {c.title}
                </button>
                <button
                  aria-label="Chat actions"
                  onClick={(e) => (open ? setMenu(null) : openMenu(c.id, e.currentTarget))}
                  className={cn(
                    "shrink-0 rounded-md p-1 text-muted-foreground/60 transition-opacity hover:text-foreground",
                    open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                  title="Chat actions"
                >
                  <MoreHorizontal className="h-4 w-4" strokeWidth={1.6} />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {chats.length === 0 && (
        <div className="px-2.5 py-2 text-[13px] text-muted-foreground/50">No chats yet.</div>
      )}

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {current && anchor && (
              <motion.div
                ref={panelRef}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                style={{ top: anchor.top, left: anchor.left, width: 240 }}
                className="glass fixed z-[200] rounded-xl p-1.5"
              >
                <ChatMenuPanel
                  chat={current}
                  onRename={() => {
                    setDraft(current.title);
                    setEditing(current.id);
                  }}
                  onTogglePin={() => togglePin(current.id)}
                  onSetColor={(col) => setColor(current.id, col)}
                  onDelete={() => remove(current.id)}
                  onClose={() => setMenu(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
