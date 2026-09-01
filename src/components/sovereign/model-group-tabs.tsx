import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Check, Eye, Pencil, Plus, X } from "lucide-react";
import { useModelGroups, useModels } from "@/lib/model-store";
import { confirmAction } from "./confirm-dialog";
import { cn } from "@/lib/utils";

/**
 * Header bar for the model registry: one tab per model group (Local LLM,
 * Cloud Based, plus anything the operator adds) followed by Vision.
 */
export function ModelGroupTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onVision = pathname === "/vision";
  const { models, update } = useModels();
  const { groups, active, setActive, addGroup, renameGroup, removeGroup } = useModelGroups();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) ref.current?.focus();
  }, [creating]);

  const count = (groupId: string) => models.filter((m) => m.group === groupId).length;

  const commit = async () => {
    if (!name.trim()) {
      setCreating(false);
      return;
    }
    const id = await addGroup(name);
    setActive(id);
    setName("");
    setCreating(false);
  };

  const commitRename = async (id: string, oldName: string, next: string) => {
    const clean = next.trim();
    setEditing(null);
    if (!clean || clean === oldName) return;
    await renameGroup(id, clean);
    // Mimari not: Tab ismi (name) değiştiğinde, modellerin içinde kayıtlı olan 'group' alanı ID tuttuğu için (name tutmadığı için) 
    // tüm modelleri forEach ile update etmeye gerek kalmadı!
  };

  const deleteGroup = async (id: string, groupName: string, n: number) => {
    const ok = await confirmAction({
      title: "Delete this group?",
      body:
        n > 0
          ? `Delete group "${groupName}"? Its ${n} model${n > 1 ? "s" : ""} will move to Unassigned.`
          : `Are you sure you want to delete the empty group "${groupName}"?`,
      confirmLabel: "Delete",
      tone: "ruby",
    });
    if (!ok) return;

    if (n > 0) {
      models
        .filter((m) => m.group === id)
        .forEach((m) => update(m.id, { group: "unassigned" }));
    }
    await removeGroup(id);
    if (active === id) setActive(groups[0]?.id ?? "local");
  };

  return (
    <div className="ml-2 hidden items-center gap-1.5 md:flex">
      {groups.map((g) => {
        const n = count(g.id);
        if (editing === g.id) {
          return (
            <InlineName
              key={g.id}
              initial={g.name}
              onCommit={(v) => commitRename(g.id, g.name, v)}
              onCancel={() => setEditing(null)}
            />
          );
        }
        return (
          <Tab
            key={g.id}
            to="/models"
            active={!onVision && active === g.id}
            tone={g.tone}
            onSelect={() => setActive(g.id)}
            onRename={() => setEditing(g.id)}
            onRemove={() => deleteGroup(g.id, g.name, n)}
          >
            {g.name} · {n}
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
            placeholder="Group name"
            className="h-6 w-[130px] bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <button onClick={commit} aria-label="Create model group" title="Create model group">
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
          <Plus size={13} strokeWidth={1.8} /> Add model group
        </motion.button>
      )}

      <span className="mx-1 h-4 w-px bg-white/[0.08]" />

      <Link
        to="/vision"
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-colors duration-100 ease-out",
          onVision
            ? "border-white/20 bg-raised/60 text-foreground"
            : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground",
        )}
      >
        <Eye size={13} strokeWidth={1.7} className="text-amethyst" />
        Vision
      </Link>
    </div>
  );
}

function Tab({
  to,
  active,
  tone,
  onSelect,
  onRename,
  onRemove,
  children,
}: {
  to: string;
  active: boolean;
  tone: string;
  onSelect: () => void;
  onRename: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "group flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-colors duration-100 ease-out",
        active
          ? "border-white/20 bg-raised/60 text-foreground"
          : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground",
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: `var(--${tone})`, boxShadow: `0 0 8px -1px var(--${tone})` }}
      />
      <Link to={to} onClick={onSelect} className="whitespace-nowrap">
        {children}
      </Link>
      <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onRename}
          aria-label="Rename group"
          className="hover:text-sapphire"
          title="Rename group"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={onRemove}
          aria-label="Delete group"
          className="hover:text-ruby"
          title="Delete group"
        >
          <X size={12} />
        </button>
      </span>
    </span>
  );
}

function InlineName({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <div className="flex items-center gap-1 rounded-lg border border-sapphire/45 bg-raised/50 px-2 py-[3px]">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(value);
          if (e.key === "Escape") onCancel();
        }}
        className="h-6 w-[130px] bg-transparent font-mono text-[12px] text-foreground outline-none"
      />
      <button onClick={() => onCommit(value)} aria-label="Save name" title="Save name">
        <Check size={13} className="text-emerald" />
      </button>
      <button onClick={onCancel} aria-label="Cancel" title="Cancel">
        <X size={13} className="text-muted-foreground/70 hover:text-ruby" />
      </button>
    </div>
  );
}
