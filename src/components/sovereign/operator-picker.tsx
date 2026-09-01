import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type PickOption = { id: string; name: string; meta: string };

/** Typeahead multi-select — scales to directory-sized rosters (LDAP/AD later). */
export function OperatorPicker({
  options,
  value,
  onToggle,
  onClear,
}: {
  options: PickOption[];
  value: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => `${o.name} ${o.meta}`.toLowerCase().includes(needle))
    : options;
  const picked = options.filter((o) => value.includes(o.id));

  return (
    <div ref={box} className="relative min-w-[280px] flex-1">
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-lg border bg-canvas-deep/60 px-2 py-[5px] transition-colors",
          open ? "border-sapphire/50" : "border-white/[0.08]",
        )}
      >
        {picked.length === 0 ? (
          <span className="font-mono text-[11px] text-sapphire/80">Everyone</span>
        ) : (
          picked.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onToggle(o.id)}
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.06] px-2 py-1 text-[11.5px] text-foreground transition-colors hover:border-ruby/40 hover:text-ruby"
            >
              <span>{o.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground/55">×</span>
            </button>
          ))
        )}
        <input
          className="min-w-[80px] flex-1 bg-transparent py-1 font-mono text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground/40"
          placeholder={picked.length ? "" : "add operator…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !q && picked.length)
              onToggle(picked[picked.length - 1]!.id);
          }}
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="font-mono text-[10px] text-muted-foreground/50 hover:text-foreground"
          >
            clear
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-20 mt-1.5 max-h-[260px] w-full overflow-auto rounded-xl border border-white/[0.08] bg-canvas-deep p-1 shadow-xl">
          {shown.length === 0 ? (
            <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground/50">No match</div>
          ) : (
            shown.map((o) => {
              const selected = value.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onToggle(o.id);
                    setQ("");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors",
                    selected ? "bg-sapphire/10 text-sapphire" : "hover:bg-white/[0.04]",
                  )}
                >
                  <span className="text-[12.5px]">{o.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground/55">{o.meta}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
