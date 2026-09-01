import { useState } from "react";
import { motion } from "motion/react";
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type Telemetry = {
  firstTokenMs: number;
  totalMs: number;
  tokens: number;
  model: string;
  effort: string;
};

/** Mono telemetry strip rendered above an agent answer. */
export function TelemetryStrip({ t, live }: { t: Telemetry; live?: boolean }) {
  const tps = t.totalMs > 0 ? Math.round((t.tokens / t.totalMs) * 1000) : 0;
  const items: [string, string][] = [
    ["ttft", `${t.firstTokenMs} ms`],
    ["elapsed", `${(t.totalMs / 1000).toFixed(2)} s`],
    ["tokens", `${t.tokens}`],
    ["tok/s", `${tps}`],
    ["model", t.model],
    ["effort", t.effort],
  ];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground/45"
    >
      {live && (
        <span className="flex items-center gap-1.5 text-emerald">
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-emerald"
            animate={{ opacity: [1, 0.25, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
          STREAMING
        </span>
      )}
      {items.map(([k, v]) => (
        <span key={k}>
          <span className="text-muted-foreground/35">{k}</span>{" "}
          <span className="text-foreground/60">{v}</span>
        </span>
      ))}
    </motion.div>
  );
}

/** like / dislike / retry / copy row under an agent answer. */
export function MessageActions({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [copied, setCopied] = useState(false);

  const btn =
    "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/45 transition-colors hover:bg-raised/70 hover:text-foreground";

  return (
    <div className="mt-4 flex items-center gap-0.5">
      <button
        aria-label="Copy answer"
        title="Copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            /* clipboard unavailable */
          }
        }}
        className={cn(btn, copied && "text-emerald hover:text-emerald")}
      >
        {copied ? (
          <Check className="h-[14px] w-[14px]" strokeWidth={1.7} />
        ) : (
          <Copy className="h-[14px] w-[14px]" strokeWidth={1.7} />
        )}
      </button>
      <button aria-label="Retry" title="Retry" onClick={onRetry} className={btn}>
        <RotateCcw className="h-[14px] w-[14px]" strokeWidth={1.7} />
      </button>
      <button
        aria-label="Good answer"
        title="Good answer"
        onClick={() => setVote((v) => (v === "up" ? null : "up"))}
        className={cn(btn, vote === "up" && "text-emerald hover:text-emerald")}
      >
        <ThumbsUp className="h-[14px] w-[14px]" strokeWidth={1.7} />
      </button>
      <button
        aria-label="Bad answer"
        title="Bad answer"
        onClick={() => setVote((v) => (v === "down" ? null : "down"))}
        className={cn(btn, vote === "down" && "text-ruby hover:text-ruby")}
      >
        <ThumbsDown className="h-[14px] w-[14px]" strokeWidth={1.7} />
      </button>
    </div>
  );
}
