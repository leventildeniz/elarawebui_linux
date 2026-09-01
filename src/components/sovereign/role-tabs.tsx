import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { ROLE_PRESETS, useRoles } from "@/lib/rbac-store";
import { TAB_SCOPES } from "@/lib/rbac-store";
import { confirmAction } from "./confirm-dialog";
import { cn } from "@/lib/utils";

/** Header role bar for RBAC — one tab per role, plus role creation. */
export function RoleTabs() {
  const { roles, active, setActive, addRole, updateRole, removeRole } = useRoles();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("blank");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) ref.current?.focus();
  }, [creating]);

  const commit = () => {
    if (!name.trim()) {
      setCreating(false);
      return;
    }
    addRole(name, "Local", preset);
    setName("");
    setPreset("blank");
    setCreating(false);
  };

  return (
    <div className="ml-2 hidden items-center gap-1.5 md:flex">
      {roles.map((r) => {
        if (editing === r.id) {
          return (
            <InlineName
              key={r.id}
              initial={r.name}
              onCommit={(v) => {
                setEditing(null);
                const clean = v.trim();
                if (clean && clean !== r.name) updateRole(r.id, { name: clean });
              }}
              onCancel={() => setEditing(null)}
            />
          );
        }
        return (
          <Tab
            key={r.id}
            active={active === r.id}
            tone={r.tone}
            onClick={() => setActive(r.id)}
            onRename={r.system ? undefined : () => setEditing(r.id)}
            onRemove={
              r.system
                ? undefined
                : () => {
                    void (async () => {
                      const ok = await confirmAction({
                        title: `Delete role "${r.name}"?`,
                        body: "Principals bound to this role fall back to chat-only access.",
                        confirmLabel: "Delete",
                      });
                      if (ok) removeRole(r.id);
                    })();
                  }
            }
          >
            {r.name}
            <span className="font-mono text-[11px] text-muted-foreground/50">
              {r.scopes.length}/{TAB_SCOPES.length}
            </span>
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
              if (e.key === "Enter") {
                e.preventDefault(); // Prevent accidental dual triggers
                commit();
              }
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Role name"
            className="h-6 w-[120px] bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <button onClick={(e) => { e.preventDefault(); commit(); }} aria-label="Create role" title="Create role">
            <Check size={13} className="text-emerald" />
          </button>
          <button onClick={(e) => { e.preventDefault(); setCreating(false); }} aria-label="Cancel" title="Cancel">
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
          <Plus size={13} strokeWidth={1.8} /> Add role
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
        aria-label="Save role name"
        title="Save role name"
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
        "group flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-colors duration-100 ease-out",
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
              aria-label="Rename role"
              title="Rename role"
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
              aria-label="Delete role"
              title="Delete role"
            >
              <X size={12} className="text-ruby/70 hover:text-ruby" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
