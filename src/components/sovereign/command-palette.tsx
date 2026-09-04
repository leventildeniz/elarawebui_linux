import { AnimatePresence, motion } from "motion/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare,
  Search,
  CornerDownLeft,
  X,
  PanelsTopLeft,
  Bot,
  Zap,
  Cpu,
  GitFork,
} from "lucide-react";
import { paletteSurfaces } from "@/lib/palette-surfaces";
import { cn } from "@/lib/utils";
import { useChats } from "@/lib/chat-store";
import { useAgents } from "@/lib/agent-store";
import { useSkills } from "@/lib/skill-store";
import { useModels } from "@/lib/model-store";
import { useWorkflows } from "@/lib/workflow-store";

export type PaletteTarget = {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  to: string;
  group: string;
};

type Row =
  | {
      kind: "nav";
      key: string;
      label: string;
      hint: string;
      icon: PaletteTarget["icon"];
      to: string;
    }
  | {
      kind: "surface";
      key: string;
      label: string;
      hint: string;
      icon: PaletteTarget["icon"];
      to: string;
      search: Record<string, string>;
    }
  | {
      kind: "chat";
      key: string;
      label: string;
      hint: string;
      icon: PaletteTarget["icon"];
      id: string;
    }
  | {
      kind: "agent";
      key: string;
      label: string;
      hint: string;
      icon: PaletteTarget["icon"];
      id: string;
    }
  | {
      kind: "skill";
      key: string;
      label: string;
      hint: string;
      icon: PaletteTarget["icon"];
      id: string;
    }
  | {
      kind: "model";
      key: string;
      label: string;
      hint: string;
      icon: PaletteTarget["icon"];
      id: string;
    }
  | {
      kind: "workflow";
      key: string;
      label: string;
      hint: string;
      icon: PaletteTarget["icon"];
      id: string;
    };

export function CommandPalette({
  open,
  onClose,
  targets,
}: {
  open: boolean;
  onClose: () => void;
  targets: PaletteTarget[];
}) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const { chats, setActive } = useChats();
  const { agents } = useAgents();
  const { skills } = useSkills();
  const { models } = useModels();
  const { workflows } = useWorkflows();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    setQ("");
    setCursor(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);

    const nav: Row[] = targets
      .filter((t) => match(t.label) || match(t.group))
      .map((t) => ({
        kind: "nav",
        key: `n:${t.to}`,
        label: t.label,
        hint: t.group,
        icon: t.icon,
        to: t.to,
      }));

    const surfaces: Row[] = paletteSurfaces
      .filter((s) => match(s.label) || match(s.group))
      .map((s) => ({
        kind: "surface",
        key: `s:${s.to}:${Object.values(s.search).join("/")}`,
        label: s.label,
        hint: s.group,
        icon: PanelsTopLeft,
        to: s.to,
        search: s.search,
      }));

    const agentRows: Row[] = (agents || [])
      .filter((a) => match(a.name) || match(a.squad) || match(a.description || ""))
      .slice(0, 6)
      .map((a) => ({
        kind: "agent",
        key: `agt:${a.id}`,
        label: a.name,
        hint: a.squad ? `Agent · ${a.squad}` : "Agent",
        icon: Bot,
        id: a.id,
      }));

    const skillRows: Row[] = (skills || [])
      .filter((sk) => match(sk.name) || match(sk.description || ""))
      .slice(0, 6)
      .map((sk) => ({
        kind: "skill",
        key: `sk:${sk.id}`,
        label: sk.name,
        hint: "Skill",
        icon: Zap,
        id: sk.id,
      }));

    const modelRows: Row[] = (models || [])
      .filter((m) => match(m.name) || match(m.modelId) || match(m.vendor || ""))
      .slice(0, 4)
      .map((m) => ({
        kind: "model",
        key: `mdl:${m.id}`,
        label: m.name,
        hint: m.vendor ? `Model · ${m.vendor}` : "Model",
        icon: Cpu,
        id: m.id,
      }));

    const workflowRows: Row[] = (workflows || [])
      .filter((w) => match(w.name))
      .slice(0, 4)
      .map((w) => ({
        kind: "workflow",
        key: `wf:${w.id}`,
        label: w.name,
        hint: "Workflow",
        icon: GitFork,
        id: w.id,
      }));

    const threads: Row[] = chats
      .filter((c) => match(c.title))
      .slice(0, 6)
      .map((c) => ({
        kind: "chat",
        key: `c:${c.id}`,
        label: c.title,
        hint: "Chat",
        icon: MessageSquare,
        id: c.id,
      }));

    return [...nav, ...surfaces, ...agentRows, ...skillRows, ...modelRows, ...workflowRows, ...threads];
  }, [q, targets, paletteSurfaces, agents, skills, models, workflows, chats]);

  useEffect(() => setCursor(0), [q]);

  const run = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "nav") navigate({ to: row.to });
    else if (row.kind === "surface") navigate({ to: row.to, search: row.search });
    else if (row.kind === "agent") navigate({ to: "/agents" });
    else if (row.kind === "skill") navigate({ to: "/skills" });
    else if (row.kind === "model") navigate({ to: "/models" });
    else if (row.kind === "workflow") navigate({ to: "/flows" });
    else {
      setActive(row.id);
      navigate({ to: "/" });
    }
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/55 px-4 pt-[14vh] backdrop-blur-[3px]"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[620px] overflow-hidden rounded-xl border border-sapphire/25 bg-[var(--panel)]/95 shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_28px_80px_-24px_rgba(0,0,0,0.9),0_0_44px_-18px_var(--sapphire-glow,rgba(56,120,255,0.5))] backdrop-blur-xl"
          >
            <div className="flex items-center gap-2.5 border-b border-border/40 px-4 py-3">
              <Search className="h-[17px] w-[17px] text-sapphire/80" strokeWidth={1.6} />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(c + 1, rows.length - 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(c - 1, 0));
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    run(rows[cursor]);
                  }
                }}
                placeholder="Search modules, panels and chats…"
                className="w-full bg-transparent font-display text-[15px] text-foreground placeholder:text-muted-foreground/45 focus:outline-none"
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
                esc
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close search"
                className="rounded-md p-1.5 text-muted-foreground/55 transition-colors hover:bg-raised/70 hover:text-foreground"
                title="Close search"
              >
                <X className="h-4 w-4" strokeWidth={1.7} />
              </button>
            </div>

            <div className="max-h-[52vh] overflow-y-auto py-1.5">
              {rows.length === 0 && (
                <p className="px-4 py-6 text-center font-mono text-[11.5px] uppercase tracking-[0.18em] text-muted-foreground/45">
                  no matches
                </p>
              )}
              {rows.map((row, i) => {
                const Icon = row.icon;
                return (
                  <button
                    key={row.key}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => run(row)}
                    className={cn(
                      "flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors",
                      i === cursor ? "bg-sapphire/10" : "hover:bg-raised/40",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon
                        className={cn(
                          "h-[16px] w-[16px] shrink-0",
                          i === cursor ? "text-sapphire" : "text-muted-foreground/65",
                        )}
                        strokeWidth={1.5}
                      />
                      <span className="truncate text-[14px] text-foreground/90">{row.label}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/40">
                        {row.hint}
                      </span>
                      {i === cursor && (
                        <CornerDownLeft
                          className="h-[13px] w-[13px] text-sapphire/70"
                          strokeWidth={1.6}
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
