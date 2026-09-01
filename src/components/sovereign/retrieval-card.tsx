import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronRight,
  Database,
  ExternalLink,
  Layers,
  Lock,
  Scale,
  Tags,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RetrievalScope } from "@/lib/space-router";
import type { AliasTerm } from "@/lib/rag-keywords";

export type RetrievalCitation = {
  id: string;
  source: string;
  brand: string;
  /** Knowledge space the chunk was retrieved from. */
  space?: string;
  loc: string;
  /** Document tags that matched the question or an agent/pack alias. */
  matchedTags?: string[];
  score: number;
  rerank: number;
  snippet: string;
};

export type Retrieval = {
  query: string;
  brands: string[];
  candidates: number;
  kept: number;
  reranker: string;
  latencyMs: number;
  citations: RetrievalCitation[];
  /** Alias terms in force for this turn — agent field + inherited pack keywords. */
  aliases?: AliasTerm[];
  /** How many indexed documents matched a tag or alias. */
  boosted?: number;
  /** Which knowledge spaces the question was routed to, and what was withheld. */
  scope?: RetrievalScope;
};

const bar = (v: number) => `${Math.max(4, Math.min(100, v * 100))}%`;

/** RAG evidence panel rendered beneath an agent answer: reranker + citations. */
export function RetrievalCard({ r }: { r: Retrieval }) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="obsidian-slab mt-5 overflow-hidden rounded-[12px]"
      style={{ borderColor: "color-mix(in oklab, var(--emerald) 30%, transparent)" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised/40"
      >
        <span
          className="flex h-6 w-6 items-center justify-center rounded-md"
          style={{
            background: "color-mix(in oklab, var(--emerald) 16%, transparent)",
            boxShadow: "0 0 14px -6px var(--emerald)",
          }}
        >
          <Database className="h-3.5 w-3.5 text-emerald" strokeWidth={1.7} />
        </span>
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.22em] text-emerald">
          rag · reranked
        </span>
        <span className="hidden min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70 sm:block">
          {r.kept}/{r.candidates} chunks · {r.reranker} · {r.latencyMs} ms
        </span>
        <ChevronRight
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-90",
          )}
          strokeWidth={1.6}
        />
      </button>

      {/* collapsed rail: citation chips stay visible for quick scanning */}
      {!open && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {r.citations.slice(0, 4).map((c, i) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-raised/40 px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground/85"
            >
              <span className="text-emerald">[{i + 1}]</span>
              <span className="max-w-[180px] truncate">{c.source}</span>
            </span>
          ))}
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-border/60 px-4 py-3">
              {r.scope && (
                <div className="rounded-[10px] border border-border/60 bg-raised/25 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Target className="h-3 w-3 text-sapphire" strokeWidth={1.7} />
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-sapphire">
                      space routing ·{" "}
                      {r.scope.routedBy === "keyword"
                        ? "matched by question"
                        : "all readable spaces"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.scope.searched.map((s) => (
                      <span
                        key={s.id}
                        className={cn(
                          "rounded-full border px-2.5 py-1 font-mono text-[10.5px]",
                          s.hit
                            ? "border-emerald/40 bg-emerald/10 text-emerald"
                            : "border-border/70 bg-raised/40 text-muted-foreground/80",
                        )}
                      >
                        {s.name}
                        {s.hit ? " ·  routed" : ""}
                      </span>
                    ))}
                    {r.scope.blocked.map((b) => (
                      <span
                        key={b}
                        title="Outside your reader membership — never searched."
                        className="inline-flex items-center gap-1 rounded-full border border-ruby/30 bg-ruby/[0.07] px-2.5 py-1 font-mono text-[10.5px] text-ruby/80"
                      >
                        <Lock className="h-2.5 w-2.5" strokeWidth={2} />
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {r.aliases?.length ? (
                <div className="rounded-[10px] border border-border/60 bg-raised/25 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Tags className="h-3 w-3 text-amethyst" strokeWidth={1.7} />
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-amethyst">
                      keyword plane · {r.aliases.length} alias
                      {typeof r.boosted === "number" ? ` · ${r.boosted} doc boosted` : ""}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.aliases.map((a) => (
                      <span
                        key={`${a.from}:${a.term}`}
                        title={a.from === "agent" ? "Agent keyword" : `Inherited from ${a.from}`}
                        className={cn(
                          "rounded-full border px-2.5 py-1 font-mono text-[10.5px]",
                          a.from === "agent"
                            ? "border-amethyst/40 bg-amethyst/10 text-amethyst"
                            : "border-border/70 bg-raised/40 text-muted-foreground/80",
                        )}
                      >
                        {a.term}
                        {a.from === "agent" ? "" : ` · ${a.from}`}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-[11px] sm:grid-cols-4">
                <Kv icon={Layers} k="candidates" v={String(r.candidates)} />
                <Kv icon={Scale} k="kept" v={String(r.kept)} tone="emerald" />
                <Kv icon={Database} k="index" v={r.brands.join(", ") || "all"} />
                <Kv icon={Scale} k="reranker" v={r.reranker} tone="sapphire" />
              </div>

              <p className="font-mono text-[11px] leading-relaxed text-muted-foreground/70">
                <span className="text-muted-foreground/50">query · </span>
                {r.query}
              </p>

              <div className="space-y-2">
                {r.citations.map((c, i) => (
                  <div
                    key={c.id}
                    className="rounded-[10px] border border-border/60 bg-raised/30 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10.5px] text-emerald">[{i + 1}]</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/90">
                        {c.source}
                      </span>
                      <span className="font-mono text-[10.5px] text-muted-foreground/60">
                        {c.space ? `${c.space} · ` : ""}
                        {c.brand} · {c.loc}
                      </span>
                      <ExternalLink
                        className="h-3 w-3 shrink-0 text-muted-foreground/45"
                        strokeWidth={1.6}
                      />
                    </div>
                    {c.matchedTags?.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.matchedTags.map((t) => (
                          <span
                            key={t}
                            className="rounded-full border border-amethyst/35 bg-amethyst/10 px-2 py-0.5 font-mono text-[10px] text-amethyst"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-[1.6] text-muted-foreground/80">
                      {c.snippet}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <Meter label="vector" value={c.score} tone="sapphire" />
                      <Meter label="rerank" value={c.rerank} tone="emerald" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Kv({
  icon: Icon,
  k,
  v,
  tone,
}: {
  icon: typeof Database;
  k: string;
  v: string;
  tone?: "emerald" | "sapphire";
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground/45" strokeWidth={1.6} />
      <span className="text-muted-foreground/50">{k}</span>
      <span
        className={cn(
          "min-w-0 truncate",
          tone === "emerald"
            ? "text-emerald"
            : tone === "sapphire"
              ? "text-sapphire"
              : "text-foreground/85",
        )}
      >
        {v}
      </span>
    </span>
  );
}

function Meter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "sapphire";
}) {
  const color = tone === "emerald" ? "var(--emerald)" : "var(--sapphire)";
  return (
    <span className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/45">
        {label}
      </span>
      <span className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-border/70">
        <span
          className="block h-full rounded-full"
          style={{ width: bar(value), background: color, boxShadow: `0 0 8px -2px ${color}` }}
        />
      </span>
      <span className="font-mono text-[10.5px] text-foreground/80">{value.toFixed(2)}</span>
    </span>
  );
}
