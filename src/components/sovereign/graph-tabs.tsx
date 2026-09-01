import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, Palette, Pencil, Plus, X } from "lucide-react";
import { jewelNames, jewelPalette, type JewelName } from "@/lib/avatar-library";
import { confirmAction } from "./confirm-dialog";
import { cn } from "@/lib/utils";

export type GraphTabItem = { id: string; name: string; jewel: JewelName };

/** Shared header tab strip for graph designers (workflows, orchestration chains). */
export function GraphTabs({
  items,
  activeId,
  createLabel,
  onSelect,
  onRename,
  onRecolour,
  onRemove,
  onCreate,
}: {
  items: GraphTabItem[];
  activeId: string;
  createLabel: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRecolour: (id: string, jewel: JewelName) => void;
  onRemove: (id: string) => void;
  onCreate: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [painting, setPainting] = useState<string | null>(null);

  return (
    <div className="ml-2 hidden items-center gap-1.5 md:flex">
      {items.map((w) =>
        editing === w.id ? (
          <InlineName
            key={w.id}
            initial={w.name}
            onCommit={(v) => {
              setEditing(null);
              if (v.trim()) onRename(w.id, v.trim());
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div key={w.id} className="relative">
            <Tab
              active={activeId === w.id}
              tone={w.jewel}
              onClick={() => onSelect(w.id)}
              onRename={() => setEditing(w.id)}
              onPaint={() => setPainting(painting === w.id ? null : w.id)}
              onRemove={() => {
                void (async () => {
                  const ok = await confirmAction({
                    title: `Delete this graph?`,
                    body: `Are you sure you want to permanently delete "${w.name}"? This graph and its layout will be removed from the studio.`,
                    confirmLabel: "Delete",
                    tone: "ruby"
                  });
                  if (ok) onRemove(w.id);
                })();
              }}
            >
              {w.name}
            </Tab>
            {painting === w.id && (
              <div className="absolute left-0 top-[calc(100%+6px)] z-50 flex gap-1.5 rounded-lg border border-border bg-panel/95 p-2 backdrop-blur-md">
                {jewelNames.map((j) => (
                  <button
                    key={j}
                    aria-label={`Colour ${j}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onRecolour(w.id, j);
                      setPainting(null);
                    }}
                    className={cn(
                      "h-4 w-4 rounded-full transition-transform hover:scale-110",
                      w.jewel === j && "ring-1 ring-white/50",
                    )}
                    style={{
                      background: `linear-gradient(140deg, ${jewelPalette[j].from}, ${jewelPalette[j].to})`,
                    }}
                    title={`Colour ${j}`}
                  />
                ))}
              </div>
            )}
          </div>
        ),
      )}

      <motion.button
        whileHover={{ scale: 1.05 }}
        transition={{ duration: 0.16, ease: "easeInOut" }}
        onClick={onCreate}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/[0.12] px-2.5 py-[5px] text-[13px] font-medium text-muted-foreground/70 transition-colors hover:border-sapphire/50 hover:text-foreground"
      >
        <Plus size={13} strokeWidth={1.8} /> {createLabel}
      </motion.button>
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
        className="h-6 w-[150px] bg-transparent font-mono text-[12px] text-foreground outline-none"
      />
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onCommit(value)}
        aria-label="Save name"
        title="Save name"
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
  onPaint,
  onRemove,
  children,
}: {
  active: boolean;
  tone: JewelName;
  onClick: () => void;
  onRename: () => void;
  onPaint: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onRename}
      className={cn(
        "group flex max-w-[240px] cursor-pointer items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-colors duration-100 ease-out",
        active
          ? "border-white/20 bg-raised/60 text-foreground"
          : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground",
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: jewelPalette[tone].to,
          boxShadow: `0 0 8px -1px ${jewelPalette[tone].to}`,
        }}
      />
      <span className="truncate">{children}</span>
      <span className="flex items-center gap-1 opacity-0 transition-opacity duration-100 ease-out group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPaint();
          }}
          aria-label="Recolour"
          title="Recolour"
        >
          <Palette size={11} className="text-muted-foreground/70 hover:text-amethyst" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
          aria-label="Rename"
          title="Rename"
        >
          <Pencil size={11} className="text-muted-foreground/70 hover:text-sapphire" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Delete"
          title="Delete"
        >
          <X size={12} className="text-ruby/70 hover:text-ruby" />
        </button>
      </span>
    </div>
  );
}
