import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Cpu, Loader2, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolActivity, ToolRun } from "@/lib/orchestrate-stream";

/** Jewel tone per capability plane: mcp → amethyst · skill → emerald · tool → sapphire. */
function toneOf(name: string) {
  if (name.startsWith("mcp.")) return "amethyst";
  if (name.startsWith("skill")) return "emerald";
  return "sapphire";
}

const toneText: Record<string, string> = {
  sapphire: "text-sapphire",
  emerald: "text-emerald",
  amethyst: "text-amethyst",
};

function StatusGlyph({ run }: { run: ToolRun }) {
  if (run.status === "completed")
    return (
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-emerald/15"
      >
        <Check className="h-[10px] w-[10px] text-emerald" strokeWidth={2.4} />
      </motion.span>
    );
  if (run.status === "failed" || run.status === "denied")
    return (
      <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-ruby/15">
        <X className="h-[10px] w-[10px] text-ruby" strokeWidth={2.4} />
      </span>
    );
  if (run.status === "running")
    return <Loader2 className="h-[13px] w-[13px] animate-spin text-sapphire" strokeWidth={2} />;
  return <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />;
}

/**
 * Live orchestration trace — capability preparation, per-tool execution and
 * agent-loop iterations, streamed from the orchestrator over SSE.
 */
export function ToolActivityBlock({ activity }: { activity: ToolActivity }) {
  const [open, setOpen] = useState(true);
  const live = activity.phase !== "done";
  const running = activity.runs.find((r) => r.status === "running");

  const headline =
    activity.phase === "prepare"
      ? "Preparing capabilities…"
      : activity.phase === "loop"
        ? `Agent reviewing results · turn ${activity.iteration}`
        : running
          ? `Running ${running.name}…`
          : activity.runs.length
            ? `${activity.runs.filter((r) => r.status === "completed").length}/${activity.runs.length} capabilities executed`
            : "Orchestration";

  return (
    <div
      className={cn(
        "mb-5 overflow-hidden rounded-[12px] border bg-panel/40 backdrop-blur-xl transition-colors",
        live ? "border-sapphire/30" : "border-white/[0.06]",
      )}
      style={live ? { boxShadow: "0 0 34px -22px var(--sapphire)" } : undefined}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
        title="Tool activity for this turn"
      >
        {live ? (
          <Loader2 className="h-[15px] w-[15px] animate-spin text-sapphire" strokeWidth={1.8} />
        ) : (
          <Cpu className="h-[15px] w-[15px] text-muted-foreground/60" strokeWidth={1.6} />
        )}
        <span
          className={cn(
            "font-mono text-[11px] uppercase tracking-[0.22em]",
            live ? "text-sapphire" : "text-muted-foreground/60",
          )}
        >
          orchestration
        </span>
        <span className="truncate font-mono text-[11.5px] text-muted-foreground/70">
          {headline}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={1.6}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && activity.runs.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="space-y-1 border-t border-white/[0.05] px-4 py-3">
              {activity.runs.map((run, i) => (
                <motion.div
                  key={run.name}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18, delay: i * 0.05, ease: "easeOut" }}
                  className="flex items-center gap-2.5 py-[3px]"
                >
                  <StatusGlyph run={run} />
                  <span
                    className={cn(
                      "font-mono text-[12.5px]",
                      toneText[toneOf(run.name)] ?? "text-sapphire",
                    )}
                  >
                    {run.name}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/45">
                    {run.status}
                  </span>
                  {typeof run.ms === "number" && run.status !== "running" && (
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground/45">
                      {(run.ms / 1000).toFixed(1)}s
                    </span>
                  )}
                </motion.div>
              ))}

              {activity.approval && !activity.approval.decided && (
                <div className="mt-2 flex items-center gap-2 rounded-md border border-ruby/25 bg-ruby/[0.06] px-2.5 py-1.5">
                  <ShieldAlert className="h-[13px] w-[13px] text-ruby" strokeWidth={1.8} />
                  <span className="font-mono text-[11.5px] text-ruby/90">
                    stream halted · awaiting approval
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
