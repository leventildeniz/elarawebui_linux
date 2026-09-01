import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { useAgents, useSquads } from "@/lib/agent-store";
import { confirmAction } from "./confirm-dialog";
import { cn } from "@/lib/utils";

/** Header squad bar for the Agent Orchestrator — scopes the roster to one squad. */
export function SquadTabs() {
  const { agents, update } = useAgents();
  const { squads, active, setActive, addSquad, renameSquad, removeSquad } = useSquads();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) ref.current?.focus();
  }, [creating]);

  const commit = () => {
    if (!name.trim()) {
      setCreating(false);
      return;
    }
    const id = addSquad(name);
    setActive(id);
    setName("");
    setCreating(false);
  };

  const count = (squadName: string) => (agents || []).filter((a) => a.squad === squadName).length;

  const commitRename = (id: string, oldName: string, next: string) => {
    const clean = next.trim();
    setEditing(null);
    if (!clean || clean === oldName) return;
    renameSquad(id, clean);
    agents.filter((a) => a.squad === oldName).forEach((a) => update(a.id, { squad: clean }));
  };

  const deleteSquad = async (id: string, squadName: string, n: number) => {
    const ok = await confirmAction({
      title: "Delete this group?",
      body: `Delete squad "${squadName}"? Its ${n} agent${n > 1 ? "s" : ""} will move to Unassigned.`,
      confirmLabel: "Delete",
      tone: "ruby",
    });
    if (!ok) return;

    if (n > 0) {
      agents
        .filter((a) => a.squad === squadName)
        .forEach((a) => update(a.id, { squad: "Unassigned" }));
    }
    removeSquad(id);
    if (active === id) setActive("all");
  };

  return (
    <div className="ml-2 hidden items-center gap-1.5 md:flex">
      <Tab active={active === "all"} tone="sapphire" onClick={() => setActive("all")}>
        All · {(agents || []).length}
      </Tab>

      {(squads || []).map((s) => {
        const n = count(s.name);
        if (editing === s.id) {
          return (
            <InlineName
              key={s.id}
              initial={s.name}
              onCommit={(v) => commitRename(s.id, s.name, v)}
              onCancel={() => setEditing(null)}
            />
          );
        }
        return (
          <Tab
            key={s.id}
            active={active === s.id}
            tone={s.tone}
            onClick={() => setActive(s.id)}
            onRename={() => setEditing(s.id)}
            onRemove={() => deleteSquad(s.id, s.name, n)}
          >
            {s.name} · {n}
          </Tab>
        );
      })}

      {creating ? (
        <div className="flex items-center gap-1 rounded-lg border border-sapphire/45 bg-raised/50 px-2 py-[3px]">
          <input
            ref={ref}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Squad name"
            className="h-6 w-[120px] bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <button onClick={commit} aria-label="Create squad" title="Create squad">
            <Check size={13} className="text-emerald" />
          </button>
          <button onClick={() => setCreating(false)} aria-label="Cancel" title="Cancel">
            <X size={13} className="text-muted-foreground/70 hover:text-ruby" />
          </button>
        </div>
      ) : (
        <motion.button
          whileHover={{ scale: 1.05 }}
          transition={{ duration: 0.16, ease: "easeInOut" }}
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/[0.12] px-2.5 py-[5px] text-[13px] font-medium text-muted-foreground/70 transition-colors hover:border-sapphire/50 hover:text-foreground"
        >
          <Plus size={13} strokeWidth={1.8} /> Add squad
        </motion.button>
      )}
    </div>
  );
}

function InlineName({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  return (
    <div className="flex items-center gap-1 rounded-lg border border-sapphire/45 bg-raised/50 px-2 py-[3px]">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(value);
          if (e.key === "Escape") onCancel();
        }}
        className="h-6 w-[120px] bg-transparent font-mono text-[12px] text-foreground outline-none"
      />
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onCommit(value)}
        aria-label="Save squad name"
        title="Save squad name"
      >
        <Check size={13} className="text-emerald" />
      </button>
    </div>
  );
}

function Tab({
  active,
  tone,
  onClick,
  onRename,
  onRemove,
  children,
}: {
  active: boolean;
  tone: string;
  onClick: () => void;
  onRename?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onRename}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-colors duration-100 ease-out",
        active
          ? "border-white/20 bg-raised/60 text-foreground"
          : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground",
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: `var(--${tone})`, boxShadow: `0 0 8px -1px var(--${tone})` }}
      />
      {children}
      {(onRename || onRemove) && (
        <span className="flex items-center gap-1 opacity-0 transition-opacity duration-100 ease-out group-hover:opacity-100">
          {onRename && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
              aria-label="Rename squad"
              title="Rename squad"
            >
              <Pencil size={11} className="text-muted-foreground/70 hover:text-sapphire" />
            </button>
          )}
          {onRemove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              aria-label="Delete squad"
              title="Delete squad"
            >
              <X size={12} className="text-ruby/70 hover:text-ruby" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
