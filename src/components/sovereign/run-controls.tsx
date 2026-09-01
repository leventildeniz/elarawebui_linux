import { motion, AnimatePresence } from "motion/react";
import { Play, RotateCcw, Square } from "lucide-react";
import type { useRunController } from "@/lib/run-controller";

type Controller = ReturnType<typeof useRunController>;

const stateTone: Record<string, string> = {
  idle: "var(--muted-foreground)",
  starting: "var(--topaz)",
  running: "var(--emerald)",
  stopping: "var(--topaz)",
  stopped: "var(--ruby)",
  done: "var(--sapphire)",
};

/** Run / Stop / Restart cluster with a live stage read-out for graph designers. */
export function RunControls({ ctrl, label }: { ctrl: Controller; label: string }) {
  const tone = stateTone[ctrl.state] ?? "var(--muted-foreground)";

  return (
    <div className="flex items-center gap-2.5">
      <AnimatePresence initial={false}>
        {(ctrl.active || ctrl.state !== "idle") && (
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            className="flex items-center gap-2 rounded-lg border px-2.5 py-1"
            style={{
              borderColor: `color-mix(in oklab, ${tone} 35%, transparent)`,
              background: `color-mix(in oklab, ${tone} 10%, transparent)`,
            }}
          >
            <motion.span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: tone, boxShadow: `0 0 8px -1px ${tone}` }}
              animate={ctrl.active ? { opacity: [1, 0.25, 1] } : { opacity: 1 }}
              transition={{ repeat: ctrl.active ? Infinity : 0, duration: 1.1 }}
            />
            <span
              className="font-mono text-[10.5px] uppercase tracking-[0.14em]"
              style={{ color: tone }}
            >
              {ctrl.state}
            </span>
            {ctrl.current && (
              <span className="max-w-[190px] truncate font-mono text-[11px] text-foreground/75">
                {ctrl.progress}% · {ctrl.current.label}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {ctrl.active ? (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ y: 0, scale: 0.985 }}
          onClick={ctrl.stop}
          className="flex items-center gap-2 rounded-lg border border-ruby/45 bg-ruby/12 px-3 py-1.5 font-mono text-[11.5px] tracking-[0.1em] text-ruby transition-all duration-200 hover:bg-ruby/20 hover:shadow-[0_0_28px_-8px_var(--ruby)]"
        >
          <Square className="h-3.5 w-3.5" strokeWidth={1.8} /> stop
        </motion.button>
      ) : (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ y: 0, scale: 0.985 }}
          onClick={ctrl.start}
          className="flex items-center gap-2 rounded-lg border border-emerald/40 bg-emerald/12 px-3 py-1.5 font-mono text-[11.5px] tracking-[0.1em] text-emerald transition-all duration-200 hover:bg-emerald/20 hover:shadow-[0_0_28px_-8px_var(--emerald)]"
        >
          <Play className="h-3.5 w-3.5" strokeWidth={1.8} /> {label}
        </motion.button>
      )}

      <motion.button
        whileHover={{ y: -1 }}
        whileTap={{ y: 0, scale: 0.985 }}
        onClick={ctrl.restart}
        className="flex items-center gap-2 rounded-lg border border-topaz/40 bg-topaz/10 px-3 py-1.5 font-mono text-[11.5px] tracking-[0.1em] text-topaz transition-all duration-200 hover:bg-topaz/18 hover:shadow-[0_0_28px_-8px_var(--topaz)]"
      >
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.7} /> restart
      </motion.button>
    </div>
  );
}
