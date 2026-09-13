import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
};

/**
 * ObsidianSelect — A sleek, dark theme-reactive custom dropdown
 * Replaces native OS <select> to prevent bright gray/white flashes.
 */
export function ObsidianSelect({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className,
  buttonClassName,
  full = true,
  icon,
}: {
  value: string | undefined | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  full?: boolean;
  icon?: React.ReactNode;
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
    <div ref={ref} className={cn("relative", full && "w-full", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.09] bg-raised/40 px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors hover:border-white/20 focus:border-sapphire/50",
          buttonClassName
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {icon}
          <span className={cn("truncate", !current && "text-muted-foreground/60")}>
            {current?.label || placeholder}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200",
            open && "rotate-180"
          )}
          strokeWidth={1.8}
        />
      </button>

      {open && (
        <div className="obsidian-slab absolute left-0 right-0 top-[calc(100%+4px)] z-[90] max-h-64 overflow-y-auto rounded-xl p-1.5 shadow-[0_24px_68px_-20px_rgba(0,0,0,0.85)]">
          {options.length === 0 ? (
            <div className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground/50">
              No options available
            </div>
          ) : (
            options.map((o) => {
              const isSelected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 font-mono text-[11.5px] transition-colors text-left",
                    o.disabled
                      ? "cursor-not-allowed opacity-35"
                      : isSelected
                        ? "bg-sapphire/20 text-sapphire border border-sapphire/35 font-medium"
                        : "text-foreground/90 hover:bg-white/[0.07] hover:text-foreground"
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0 flex-1">
                    {o.icon}
                    <span className="truncate">{o.label}</span>
                  </span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-sapphire shrink-0" strokeWidth={2.5} />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
