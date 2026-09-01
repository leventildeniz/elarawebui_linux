import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { Archive, ChevronDown, Undo2, Landmark, Check, Shrink } from "lucide-react";
import { cn } from "@/lib/utils";

export type MemoryItem = { label?: string; text: string };
export type MemorySection = { heading: string; items: MemoryItem[] };

export type Compaction = {
  /** Turns folded into the summary anchor. */
  turns: number;
  /** Turns kept verbatim in the live window. */
  kept: number;
  tokensBefore: number;
  tokensAfter: number;
  at: number;
  /** Short digest lines describing what was preserved. */
  digest: string[];
  /** Structured technical memory written into the fresh window. */
  memory?: {
    title: string;
    sections: MemorySection[];
  };
  /** Conversational handover brief carried into the fresh window. */
  handover?: {
    /** Opening line, written in the assistant's voice. */
    lede: string;
    objective: string;
    decisions: string[];
    open: string[];
    next: string[];
  };
};

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

/** Renders `inline code` spans inside plain summary text. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code
            key={i}
            className="rounded-[5px] border border-sapphire/20 bg-sapphire/8 px-1.5 py-[1px] font-mono text-[12px] text-sapphire/90"
          >
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const PHASES = [
  "scanning transcript",
  "clustering topics",
  "extracting decisions",
  "distilling technical memory",
  "sealing context anchor",
];

/** Live, animated readout shown while a compaction run is in flight. */
export function CompactingCard({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= PHASES.length) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 340);
    return () => clearTimeout(t);
  }, [step, onDone]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="overflow-hidden rounded-xl border border-amethyst/25 bg-panel/60 backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 border-b border-amethyst/20 bg-amethyst/10 px-4 py-2">
        <motion.span
          animate={{ opacity: [1, 0.35, 1] }}
          transition={{ duration: 1.1, repeat: Infinity }}
          className="inline-flex"
        >
          <Shrink className="h-3 w-3 text-amethyst" strokeWidth={1.8} />
        </motion.span>
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-amethyst">
          compacting context
        </span>
      </div>
      <ul className="space-y-2 px-5 py-4">
        {PHASES.map((p, i) => (
          <li
            key={p}
            className={cn(
              "flex items-center gap-2.5 font-mono text-[11.5px] tracking-[0.06em] transition-colors",
              i < step
                ? "text-foreground/70"
                : i === step
                  ? "text-amethyst"
                  : "text-muted-foreground/30",
            )}
          >
            {i < step ? (
              <Check className="h-3 w-3 text-emerald" strokeWidth={2} />
            ) : (
              <motion.span
                animate={i === step ? { opacity: [0.25, 1, 0.25] } : { opacity: 0.25 }}
                transition={{ duration: 0.9, repeat: Infinity }}
                className="h-[5px] w-[5px] rounded-full bg-current"
              />
            )}
            {p}
            {i === step && <span className="ml-0.5 animate-pulse">…</span>}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function Lane({ label, items, color }: { label: string; items: string[]; color: string }) {
  if (!items.length) return null;
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.24em]" style={{ color }}>
        {label}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2.5 text-[13px] leading-[1.62] text-foreground/78">
            <span
              className="mt-[8px] h-[3px] w-[3px] shrink-0 rounded-full"
              style={{ background: color }}
            />
            <span className="min-w-0">
              <Rich text={it} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Visible in-chat record of a context compaction run, written as a handover note. */
export function CompactionCard({
  c,
  onRestore,
}: {
  c: Compaction;
  onRestore?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const saved = Math.max(0, c.tokensBefore - c.tokensAfter);
  const pct = c.tokensBefore > 0 ? Math.round((saved / c.tokensBefore) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-5"
    >
      {/* hairline divider with the compaction seal */}
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-amethyst/35" />
        <span className="inline-flex items-center gap-2 rounded-full border border-amethyst/25 bg-amethyst/8 px-3 py-1">
          <Archive className="h-3 w-3 text-amethyst" strokeWidth={1.7} />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-amethyst">
            context compacted
          </span>
          <span className="font-mono text-[10px] tracking-[0.1em] text-muted-foreground/45 line-through">
            {fmt(c.tokensBefore)}
          </span>
          <span className="font-mono text-[10px] tracking-[0.1em] text-emerald">
            {fmt(c.tokensAfter)} · −{pct}%
          </span>
        </span>
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-amethyst/35" />
      </div>

      {/* technical compacted memory document */}
      {c.memory && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden rounded-xl border border-amethyst/22 bg-panel/55 backdrop-blur-xl"
        >
          <div className="flex items-center gap-3 border-b border-amethyst/18 bg-amethyst/8 px-5 py-3">
            <Landmark className="h-4 w-4 text-amethyst" strokeWidth={1.6} />
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground/95">
              {c.memory.title}
            </h3>
          </div>
          <div className="space-y-6 px-6 py-5">
            {c.memory.sections.map((s, si) => (
              <motion.section
                key={si}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.14 + si * 0.07, duration: 0.24 }}
              >
                <div className="text-[13px] font-semibold tracking-[-0.005em] text-foreground/90">
                  {si + 1}. {s.heading}
                </div>
                <ul className="mt-2.5 space-y-2">
                  {s.items.map((it, ii) => (
                    <li
                      key={ii}
                      className="flex gap-2.5 text-[13.5px] leading-[1.68] text-foreground/72"
                    >
                      <span className="mt-[9px] h-[3px] w-[3px] shrink-0 rounded-full bg-amethyst/60" />
                      <span className="min-w-0">
                        {it.label && (
                          <span className="font-semibold text-foreground/92">{it.label}: </span>
                        )}
                        <Rich text={it.text} />
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.section>
            ))}
          </div>
        </motion.div>
      )}

      {/* handover note, in the assistant's voice */}
      <div className="pl-0.5">
        <div className="mb-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/55">
          elara · handover
        </div>

        {c.handover ? (
          <div className="space-y-5">
            <p className="text-[16px] leading-[1.72] tracking-[-0.005em] text-foreground/92">
              {c.handover.lede}
            </p>
            <p className="text-[14.5px] leading-[1.7] text-foreground/78">{c.handover.objective}</p>
            <div className="grid gap-5 sm:grid-cols-3">
              <Lane label="settled" items={c.handover.decisions} color="var(--emerald)" />
              <Lane label="still open" items={c.handover.open} color="var(--topaz)" />
              <Lane label="next" items={c.handover.next} color="var(--sapphire)" />
            </div>
          </div>
        ) : (
          <p className="text-[15px] leading-[1.7] text-foreground/80">
            I folded {c.turns} earlier turn{c.turns === 1 ? "" : "s"} and kept {c.kept} verbatim.
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60 transition-colors hover:bg-raised/60 hover:text-foreground"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")}
              strokeWidth={1.7}
            />
            {open ? "hide folded turns" : `folded turns · ${c.turns}`}
          </button>
          {onRestore && (
            <button
              onClick={onRestore}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60 transition-colors hover:bg-raised/60 hover:text-foreground"
            >
              <Undo2 className="h-3.5 w-3.5" strokeWidth={1.7} /> restore
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.ul
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 space-y-1.5 overflow-hidden border-l border-border/60 pl-4"
            >
              {c.digest.map((d, i) => (
                <li key={i} className="text-[12.5px] leading-relaxed text-muted-foreground/70">
                  {d}
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
