import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { boardTones, useTelemetryBoards } from "@/lib/telemetry-board-store";
import { confirmAction } from "./confirm-dialog";
import { cn } from "@/lib/utils";

const fixedViews = [
  { id: "system", label: "System General", tone: "sapphire" },
  { id: "operators", label: "Operators", tone: "amethyst" },
  { id: "database", label: "Database", tone: "topaz" },
] as const;

type FleetView = (typeof fixedViews)[number]["id"] | "agents";

/** Fleet Telemetry header bar — fixed cockpit views plus user-made telemetry cards. */
export function TelemetryCardTabs({ view }: { view: FleetView }) {
  const navigate = useNavigate();
  const { boards, active, setActive, create, update, remove } = useTelemetryBoards();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) ref.current?.focus();
  }, [creating]);

  const commit = () => {
    setCreating(false);
    if (!name.trim()) return;
    create(name, boardTones[boards.length % boardTones.length]!, []);
    setName("");
    navigate({ to: "/fleet", search: { view: "agents" } });
  };

  const openBoard = (id: string) => {
    setActive(id);
    navigate({ to: "/fleet", search: { view: "agents" } });
  };

  const deleteBoard = async (id: string, label: string) => {
    const ok = await confirmAction({
      title: "Delete this card?",
      body: `Delete telemetry card "${label}"? Its streams stop being monitored.`,
      confirmLabel: "Delete",
    });
    if (ok) remove(id);
  };

  return (
    <div className="ml-2 hidden flex-wrap items-center gap-1.5 md:flex">
      {fixedViews.map((t) => (
        <Link
          key={t.id}
          to="/fleet"
          search={{ view: t.id }}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-colors duration-100 ease-out",
            view === t.id
              ? "border-white/20 bg-raised/60 text-foreground"
              : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground",
          )}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
          />
          {t.label}
        </Link>
      ))}

      {boards.length > 0 && <span className="mx-1 h-4 w-px bg-white/[0.08]" />}

      {boards.map((b) =>
        editing === b.id ? (
          <InlineName
            key={b.id}
            initial={b.name}
            onCommit={(v) => {
              setEditing(null);
              if (v.trim()) update(b.id, { name: v.trim() });
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div
            key={b.id}
            onClick={() => openBoard(b.id)}
            onDoubleClick={() => setEditing(b.id)}
            className={cn(
              "group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-colors duration-100 ease-out",
              view === "agents" && active === b.id
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground",
            )}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${b.tone})`, boxShadow: `0 0 8px -1px var(--${b.tone})` }}
            />
            {b.name} · {b.entries.length}
            <span className="flex items-center gap-1 opacity-0 transition-opacity duration-100 ease-out group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(b.id);
                }}
                aria-label="Rename card"
                title="Rename card"
              >
                <Pencil size={11} className="text-muted-foreground/70 hover:text-sapphire" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteBoard(b.id, b.name);
                }}
                aria-label="Delete card"
                title="Delete card"
              >
                <X size={11} className="text-muted-foreground/70 hover:text-ruby" />
              </button>
            </span>
          </div>
        ),
      )}

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
            placeholder="Card name"
            className="h-6 w-[130px] bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <button onClick={commit} aria-label="Create card" title="Create card">
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
          <Plus size={13} strokeWidth={1.8} /> Add card
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
        className="h-6 w-[130px] bg-transparent font-mono text-[12px] text-foreground outline-none"
      />
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onCommit(value)}
        aria-label="Save card name"
        title="Save card name"
      >
        <Check size={13} className="text-emerald" />
      </button>
    </div>
  );
}
