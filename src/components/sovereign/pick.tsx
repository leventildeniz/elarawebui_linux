  import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { JewelTone } from "@/lib/rbac-store";

const fieldCls =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";

type Opt = { value: string; label: string; disabled?: boolean; hint?: string };

export function Pick({
  value,
  options,
  onChange,
  tone,
}: {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  tone?: JewelTone;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${fieldCls} flex items-center justify-between text-left`}
      >
        <span className="truncate">{current?.label ?? "— None —"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-[280px] overflow-auto rounded-lg border border-white/[0.09] bg-[#111113]/95 p-1 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={o.disabled}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left font-mono text-[12px] transition-colors ${
                o.disabled
                  ? "cursor-not-allowed text-muted-foreground/35"
                  : "text-foreground/85 hover:bg-white/[0.05]"
              }`}
            >
              <span className="truncate">
                {o.label}
              </span>
              {o.hint && <span className="shrink-0 text-muted-foreground/50">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
