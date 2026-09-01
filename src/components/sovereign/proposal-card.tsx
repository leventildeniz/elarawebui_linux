import { motion } from "motion/react";
import { useState } from "react";
import { Check, GitBranch, Loader2, Sparkle } from "lucide-react";
import { toast } from "sonner";
import { Meter } from "./surface";

export type Proposal = {
  id: string;
  title: string;
  summary: string;
  model: string;
  cost: string;
  confidence: number;
  tone: "sapphire" | "amethyst";
};

/**
 * MetaForge proposal card — a jewel-precision plan artifact rendered inline
 * in the conversation. 1px hairline, glass surface, mono metadata.
 */
export function ProposalCard({
  proposal,
  index = 0,
  onRefine,
  onForge,
}: {
  proposal: Proposal;
  index?: number;
  onRefine?: (p: Proposal) => void;
  onForge?: (p: Proposal) => void;
}) {
  const tone = proposal.tone;
  const [state, setState] = useState<"idle" | "refining" | "forging" | "forged">("idle");

  const refine = () => {
    if (state !== "idle") return;
    setState("refining");
    onRefine?.(proposal);
    toast("Refining proposal", { description: `${proposal.id} sent back to MetaForge.` });
    window.setTimeout(() => setState("idle"), 1400);
  };

  const forge = () => {
    if (state === "forging" || state === "forged") return;
    setState("forging");
    onForge?.(proposal);
    window.setTimeout(() => {
      setState("forged");
      toast.success("Forged", { description: `${proposal.title} queued for the runtime.` });
    }, 900);
  };
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.06 * index, ease: [0.22, 1, 0.36, 1] }}
      className="glass group relative overflow-hidden rounded-xl p-5 transition-shadow duration-300 hover:shadow-[0_0_44px_-22px_var(--sapphire)]"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70"
        style={{
          background: `linear-gradient(to right, transparent, var(--${tone}), transparent)`,
        }}
      />
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkle
              className="h-3.5 w-3.5"
              strokeWidth={1.5}
              style={{ color: `var(--${tone})` }}
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/60">
              metaforge · {proposal.id}
            </span>
          </div>
          <h3 className="mt-2.5 text-[15.5px] font-medium leading-snug tracking-tight text-foreground">
            {proposal.title}
          </h3>
        </div>
        <span
          className="shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10.5px]"
          style={{
            color: `var(--${tone})`,
            borderColor: `color-mix(in oklab, var(--${tone}) 32%, transparent)`,
            background: `color-mix(in oklab, var(--${tone}) 9%, transparent)`,
          }}
        >
          {proposal.confidence}%
        </span>
      </header>

      <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{proposal.summary}</p>

      <div className="mt-5">
        <Meter value={proposal.confidence} tone={tone} />
      </div>

      <footer className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 font-mono text-[10.5px] tracking-[0.1em] text-muted-foreground/55">
          <span>{proposal.model}</span>
          <span>{proposal.cost}</span>
        </div>
        <div className="flex items-center gap-1.5 opacity-70 transition-opacity duration-200 group-hover:opacity-100">
          <button
            type="button"
            onClick={refine}
            disabled={state !== "idle"}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-mono text-[11px] text-muted-foreground/80 transition-colors hover:bg-raised/60 hover:text-foreground disabled:opacity-45"
          >
            {state === "refining" ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
            ) : (
              <GitBranch className="h-3 w-3" strokeWidth={1.5} />
            )}
            {state === "refining" ? "refining" : "refine"}
          </button>
          <motion.button
            type="button"
            onClick={forge}
            disabled={state === "forging" || state === "forged"}
            whileHover={{ scale: state === "idle" ? 1.03 : 1 }}
            whileTap={{ scale: state === "idle" ? 0.97 : 1 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11px] transition-shadow disabled:cursor-default"
            style={{
              color: `var(--${tone})`,
              borderColor: `color-mix(in oklab, var(--${tone}) 34%, transparent)`,
              background: `color-mix(in oklab, var(--${tone}) 10%, transparent)`,
              boxShadow: `0 0 22px -12px var(--${tone})`,
            }}
          >
            {state === "forging" ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <Check className="h-3 w-3" strokeWidth={2} />
            )}
            {state === "forged" ? "forged" : state === "forging" ? "forging" : "forge"}
          </motion.button>
        </div>
      </footer>
    </motion.article>
  );
}
