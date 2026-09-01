import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Elegant, animated reasoning trace shown above an agent answer. */
export function ThinkingBlock({
  text,
  active,
  elapsedMs,
}: {
  text: string;
  active?: boolean;
  elapsedMs?: number;
}) {
  const [open, setOpen] = useState(!!active);
  const userToggled = useRef(false);
  const wasActive = useRef(!!active);

  // Auto-collapse once reasoning finishes (unless the operator opened it manually).
  useEffect(() => {
    if (wasActive.current && !active && !userToggled.current) setOpen(false);
    if (active) {
      wasActive.current = true;
      if (!userToggled.current) setOpen(true);
    }
  }, [active]);

  const lines = text.split("\n").filter((l) => l.trim());

  return (
    <div
      className={cn(
        "mb-5 overflow-hidden rounded-[12px] border bg-panel/40 transition-colors",
        active ? "border-amethyst/35" : "border-white/[0.06]",
      )}
      style={active ? { boxShadow: "0 0 34px -22px var(--amethyst)" } : undefined}
    >
      <button
        onClick={() => {
          userToggled.current = true;
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        <motion.span
          animate={active ? { opacity: [0.45, 1, 0.45] } : { opacity: 0.7 }}
          transition={{ duration: 1.8, repeat: active ? Infinity : 0, ease: "easeInOut" }}
          className="text-amethyst"
        >
          <Brain className="h-[15px] w-[15px]" strokeWidth={1.6} />
        </motion.span>
        <span
          className={cn(
            "font-mono text-[11px] uppercase tracking-[0.22em]",
            active ? "text-amethyst" : "text-muted-foreground/60",
          )}
        >
          {active ? "thinking" : "thought"}
        </span>
        {active && (
          <span className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1 w-1 rounded-full bg-amethyst"
                animate={{ opacity: [0.2, 1, 0.2], y: [0, -2, 0] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16, ease: "easeInOut" }}
              />
            ))}
          </span>
        )}
        {typeof elapsedMs === "number" && !active && (
          <span className="font-mono text-[11px] text-muted-foreground/45">
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={1.6}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="space-y-1.5 border-t border-white/[0.05] px-4 py-3">
              {lines.map((l, i) => (
                <motion.p
                  key={i}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.15, delay: i * 0.05, ease: "easeOut" }}
                  className="flex gap-2.5 text-[13.5px] leading-[1.7] text-muted-foreground/75"
                >
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-amethyst/70" />
                  <span>{l}</span>
                </motion.p>
              ))}
              {active && (
                <motion.span
                  className="ml-3.5 inline-block h-3 w-[7px] bg-amethyst/70 align-middle"
                  animate={{ opacity: [1, 0.15, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
