import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowUpRight,
  ChevronDown,
  Lock,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { DataTable, KpiGrid, ReportPanel } from "@/components/sovereign/report-kit";
import { JewelButton } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import {
  memoryScopes,
  useMemoryStore,
  type MemoryPolicy,
  type MemoryScope,
} from "@/lib/memory-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/memory")({
  validateSearch: (s: Record<string, unknown>) => ({ view: (s["view"] as string) ?? undefined }),
  head: () => ({
    meta: [
      { title: "Memory — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Working set, episodic traces, semantic facts and the compaction policy that keeps context sharp.",
      },
      { property: "og:title", content: "Memory — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Working set, episodic traces, semantic facts and the compaction policy that keeps context sharp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MemoryPage,
});

const field =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-sapphire/50";

const fmt = (n: number) => n.toLocaleString("en-US");
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

function MemoryPage() {
  const search = useRouterState({ select: (s) => s.location.search }) as { view?: string };
  const view =
    search?.view === "episodic" || search?.view === "semantic" || search?.view === "policy"
      ? search.view
      : "working";

  const mem = useMemoryStore();
  // We sum up the tokens of individual message outputs, but realistically the "context in use" 
  // is closer to the final working block's token count if it includes the prompt, 
  // or a sum if they represent distinct chunks. Let's use the most recent block's tokens 
  // as the most accurate representation of current context size if available, otherwise 0.
  const used = useMemo(() => mem.working.length > 0 ? (mem.working[0]?.tokens || 0) : 0, [mem.working]);
  const pct = Math.min(100, (used / mem.policy.contextWindow) * 100);

  return (
    <Surface wide title="Memory" meta="WORKING SET · EPISODIC · SEMANTIC · POLICY">
      <div className="space-y-6">
        <KpiGrid
          items={[
            {
              label: "Context in use",
              value: `${fmt(used)} tok`,
              hint: `${pct.toFixed(1)}% of ${fmt(mem.policy.contextWindow)}`,
              tone: "sapphire",
            },
            {
              label: "Working blocks",
              value: String(mem.working.length),
              hint: `${mem.working.filter((w) => w.pinned).length} pinned`,
              tone: "emerald",
            },
            {
              label: "Episodic traces",
              value: String(mem.episodic.length),
              hint: `${mem.policy.episodicRetentionDays}d retention`,
              tone: "amethyst",
            },
            {
              label: "Semantic facts",
              value: String(mem.facts.length),
              hint: mem.policy.autoPromoteFacts ? "auto-promotion on" : "manual promotion",
              tone: "topaz",
            },
          ]}
        />

        {view === "working" && <WorkingTab mem={mem} used={used} pct={pct} />}
        {view === "episodic" && <EpisodicTab mem={mem} />}
        {view === "semantic" && <SemanticTab mem={mem} />}
        {view === "policy" && <PolicyTab mem={mem} />}
      </div>
    </Surface>
  );
}

type Mem = ReturnType<typeof useMemoryStore>;

function WorkingTab({ mem, used, pct }: { mem: Mem; used: number; pct: number }) {
  // 1. Thread ID'lere gore grupla
  const grouped = useMemo(() => {
    const groups: Record<string, typeof mem.working> = {};
    for (const w of mem.working) {
      const tId = w.thread_id || "global";
      if (!groups[tId]) groups[tId] = [];
      groups[tId].push(w);
    }
    return groups;
  }, [mem.working]);

  return (
    <>
      <ReportPanel
        title="Context window"
        hint={`${fmt(used)} of ${fmt(mem.policy.contextWindow)} tokens resident · compaction at ${mem.policy.compactAt}%`}
      >
        <div className="relative h-[10px] overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${pct}%`,
              background: pct > mem.policy.compactAt ? "var(--topaz)" : "var(--sapphire)",
              boxShadow: `0 0 12px -2px ${pct > mem.policy.compactAt ? "var(--topaz)" : "var(--sapphire)"}`,
            }}
          />
          <div
            className="absolute top-0 h-full w-px bg-ruby/70"
            style={{ left: `${mem.policy.compactAt}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground/55">
          <span>{pct.toFixed(1)}% resident</span>
          <span>compaction threshold {mem.policy.compactAt}%</span>
        </div>
      </ReportPanel>

      <ReportPanel
        title="Working set"
        hint="Blocks currently occupying the live context. Pinned blocks survive compaction."
      >
        <div className="space-y-6">
          {Object.entries(grouped).map(([threadId, blocks]) => (
            <div key={threadId} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/50">
                  {threadId === "global" ? "Global Context" : `Thread: ${threadId}`}
                </span>
                <span className="font-mono text-[10.5px] text-muted-foreground/40">
                  {blocks.length} block{blocks.length !== 1 ? 's' : ''}
                </span>
              </div>
              {blocks.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.012] px-4 py-3"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background: `var(--${w.tone})`,
                      boxShadow: `0 0 8px -1px var(--${w.tone})`,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-foreground/90">{w.label}</div>
                    <div className="font-mono text-[11.5px] text-muted-foreground/55">{w.origin}</div>
                  </div>
                  <div className="font-mono text-[12px] text-muted-foreground/70">
                    {fmt(w.tokens)} tok
                  </div>
                  <button
                    type="button"
                    onClick={() => mem.togglePin(w.id)}
                    className={cn(
                      "rounded-lg border border-white/[0.08] p-1.5 transition-colors",
                      w.pinned
                        ? "text-emerald border-emerald/40 bg-emerald/10"
                        : "text-muted-foreground/70 hover:text-foreground",
                    )}
                    aria-label={w.pinned ? "Unpin block" : "Pin block"}
                    title={w.pinned ? "Unpin block" : "Pin block"}
                  >
                    {w.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => mem.dropWorking(w.id)}
                    className="rounded-lg border border-white/[0.08] p-1.5 text-muted-foreground/70 transition-colors hover:border-ruby/40 hover:text-ruby"
                    aria-label="Evict block"
                    title="Evict block"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ))}
          {!mem.working.length && (
            <p className="py-6 text-center font-mono text-[12px] text-muted-foreground/50">
              Working set is empty — the next turn will rehydrate it.
            </p>
          )}
        </div>
      </ReportPanel>
    </>
  );
}

function EpisodicTab({ mem }: { mem: Mem }) {
  const tone = { resolved: "emerald", handover: "sapphire", failed: "ruby" } as const;
  return (
    <ReportPanel
      title="Episodic traces"
      hint={`Compacted session records · ${mem.policy.episodicRetentionDays} day retention`}
      action={
        <button
          type="button"
          onClick={() => {
            mem.clearEpisodic();
            toast.success("Episodic traces cleared");
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-raised/40 px-3 py-1.5 font-mono text-[11.5px] text-muted-foreground/80 transition-colors hover:border-ruby/40 hover:text-ruby"
        >
          <Trash2 className="h-3.5 w-3.5" /> Purge
        </button>
      }
    >
      <div className="space-y-2">
        {mem.episodic.map((e) => (
          <div key={e.id} className="rounded-xl border border-white/[0.06] bg-white/[0.012] p-4">
            <div className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground/60">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: `var(--${tone[e.outcome]})`,
                  boxShadow: `0 0 8px -1px var(--${tone[e.outcome]})`,
                }}
              />
              <span className="uppercase tracking-[0.12em]">{e.outcome}</span>
              <span>·</span>
              <span>{e.actor}</span>
              <span>·</span>
              <span>{e.thread}</span>
              <span>·</span>
              <span>{fmt(e.tokens)} tok</span>
              <span className="ml-auto">{ago(e.at)}</span>
            </div>
            <p className="mt-2 text-[13.5px] text-foreground/90">{e.summary}</p>
            <button
              type="button"
              onClick={() => {
                mem.promote(e);
                toast.success("Promoted to semantic memory");
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-sapphire/40 bg-sapphire/10 px-2.5 py-1 font-mono text-[11.5px] text-sapphire transition-colors hover:bg-sapphire/20"
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> Promote to fact
            </button>
          </div>
        ))}
        {!mem.episodic.length && (
          <p className="py-6 text-center font-mono text-[12px] text-muted-foreground/50">
            No episodic traces retained.
          </p>
        )}
      </div>
    </ReportPanel>
  );
}

function SemanticTab({ mem }: { mem: Mem }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<MemoryScope>("workspace");

  const add = () => {
    if (!key.trim() || !value.trim()) return;
    mem.addFact({
      key: key.trim(),
      value: value.trim(),
      scope,
      confidence: 1,
      source: "operator",
      locked: false,
    });
    setKey("");
    setValue("");
    toast.success("Fact written to semantic memory");
  };

  return (
    <>
      <ReportPanel
        title="Write a fact"
        hint="Durable knowledge injected into every eligible context"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr_auto_auto]">
          <input
            className={field}
            placeholder="key · e.g. org.timezone"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <input
            className={field}
            placeholder="value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="relative">
            <select
              className={cn(field, "appearance-none pr-8")}
              value={scope}
              onChange={(e) => setScope(e.target.value as MemoryScope)}
            >
              {memoryScopes.map((s) => (
                <option key={s.id} value={s.id} className="bg-canvas">
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60"
            />
          </div>
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald/40 bg-emerald/10 px-3 py-2 text-[13px] font-medium text-emerald transition-colors hover:bg-emerald/20"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      </ReportPanel>

      <ReportPanel
        title="Semantic facts"
        hint="Locked facts are never overwritten by automatic promotion"
      >
        {mem.facts.length > 0 ? (
          <DataTable
            columns={["Key", "Value", "Scope", "Confidence", "Source", "Updated", ""]}
            rows={mem.facts.map((f) => [
              <span key="k" className="font-mono text-[12.5px] text-foreground">
                {f.key}
              </span>,
              <span key="v" className="text-[13px] text-foreground/85">
                {f.value}
              </span>,
              <span
                key="s"
                className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground/65"
              >
                {f.scope}
              </span>,
              <span key="c" className="font-mono text-[12px] text-muted-foreground/75">
                {(f.confidence * 100).toFixed(0)}%
              </span>,
              <span key="src" className="font-mono text-[11.5px] text-muted-foreground/60">
                {f.source}
              </span>,
              <span key="u" className="font-mono text-[11.5px] text-muted-foreground/60">
                {ago(f.updatedAt)}
              </span>,
              <span key="a" className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => mem.patchFact(f.id, { locked: !f.locked })}
                  className={cn(
                    "rounded-lg border border-white/[0.08] p-1.5 transition-colors",
                    f.locked
                      ? "border-topaz/40 bg-topaz/10 text-topaz"
                      : "text-muted-foreground/70 hover:text-foreground",
                  )}
                  aria-label={f.locked ? "Unlock fact" : "Lock fact"}
                  title={f.locked ? "Unlock fact" : "Lock fact"}
                >
                  {f.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: "Delete semantic fact?",
                      body: `Are you sure you want to delete the fact "${f.key}"? This action cannot be undone.`,
                      confirmLabel: "Delete Fact",
                      cancelLabel: "Cancel",
                      tone: "ruby",
                    });
                    if (ok) {
                      mem.removeFact(f.id);
                      toast.success("Fact deleted");
                    }
                  }}
                  className="rounded-lg border border-white/[0.08] p-1.5 text-muted-foreground/70 transition-colors hover:border-ruby/40 hover:text-ruby"
                  aria-label="Delete fact"
                  title="Delete fact"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>,
            ])}
          />
        ) : (
          <p className="py-6 text-center font-mono text-[12px] text-muted-foreground/50">
            No semantic facts written yet.
          </p>
        )}
      </ReportPanel>
    </>
  );
}

function PolicyTab({ mem }: { mem: Mem }) {
  const [draft, setDraft] = useState<MemoryPolicy>(mem.policy);

  useEffect(() => {
    setDraft(mem.policy);
  }, [mem.policy]);

  const patchDraft = (patch: Partial<MemoryPolicy>) => setDraft((d) => ({ ...d, ...patch }));

  const dirty = useMemo(() => {
    return (Object.keys(mem.policy) as (keyof MemoryPolicy)[]).some(
      (k) => mem.policy[k] !== draft[k],
    );
  }, [mem.policy, draft]);

  const handleSave = () => {
    mem.patchPolicy(draft);
    toast.success("Policy saved");
  };

  const handleReset = async () => {
    const ok = await confirmAction({
      title: "Reset retention policy?",
      body: "This will revert all compaction, retention and promotion settings to their defaults. Unsaved changes will be lost.",
      confirmLabel: "Reset",
      cancelLabel: "Cancel",
      tone: "ruby",
    });
    if (!ok) return;
    mem.resetPolicy();
    toast.success("Policy reset to defaults");
  };

  const p = draft;
  return (
    <ReportPanel
      title="Retention & compaction policy"
      hint="Governs what stays resident, what is summarised and what is promoted"
      action={
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-topaz">
              unsaved
            </span>
          )}
          <JewelButton size="sm" variant="ghost" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.7} />
            Reset
          </JewelButton>
          <JewelButton size="sm" variant="primary" onClick={handleSave} disabled={!dirty}>
            <Save className="h-3.5 w-3.5" strokeWidth={1.7} />
            Save
          </JewelButton>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Slider
          label="Compaction threshold"
          hint="% of context window before auto-compaction"
          min={40}
          max={95}
          value={p.compactAt}
          suffix="%"
          onChange={(v) => patchDraft({ compactAt: v })}
        />
        <Slider
          label="Keep last turns"
          hint="verbatim turns preserved during compaction"
          min={2}
          max={24}
          value={p.keepLastTurns}
          suffix=" turns"
          onChange={(v) => patchDraft({ keepLastTurns: v })}
        />
        <Slider
          label="Episodic retention"
          hint="days before traces are discarded"
          min={7}
          max={365}
          value={p.episodicRetentionDays}
          suffix=" days"
          onChange={(v) => patchDraft({ episodicRetentionDays: v })}
        />
        <Slider
          label="Promotion threshold"
          hint="confidence required for auto-promotion"
          min={50}
          max={99}
          value={Math.round(p.promoteThreshold * 100)}
          suffix="%"
          onChange={(v) => patchDraft({ promoteThreshold: v / 100 })}
        />

        <div className="space-y-3">
          <Toggle
            label="Auto-promote facts"
            hint="Lift durable knowledge out of episodes"
            value={p.autoPromoteFacts}
            onChange={(v) => patchDraft({ autoPromoteFacts: v })}
          />
          <Toggle
            label="Deduplicate on write"
            hint="Collapse near-identical facts"
            value={p.dedupe}
            onChange={(v) => patchDraft({ dedupe: v })}
          />
          <Toggle
            label="Redact secrets"
            hint="Strip credentials before persisting"
            value={p.redactSecrets}
            onChange={(v) => patchDraft({ redactSecrets: v })}
          />
          <Toggle
            label="Embed on write"
            hint="Index every memory for retrieval"
            value={p.embedOnWrite}
            onChange={(v) => patchDraft({ embedOnWrite: v })}
          />
        </div>

        <div className="space-y-3">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/55">
              Studio context budget
            </div>
            <input
              type="number"
              className={cn(field, "mt-1.5 font-mono")}
              value={p.contextWindow}
              onChange={(e) => patchDraft({ contextWindow: Number(e.target.value) || 0 })}
            />
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground/50">
              Soft governance ceiling for compaction. The model's own context window is the hard
              limit and is enforced separately — this value can only trigger earlier, never extend
              it.
            </p>
          </div>
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/55">
              Summarizer
            </div>
            <input
              className={cn(field, "mt-1.5 font-mono")}
              value={p.summarizer}
              onChange={(e) => patchDraft({ summarizer: e.target.value })}
            />
          </div>
        </div>
      </div>
    </ReportPanel>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  value,
  suffix,
  onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-foreground/90">{label}</span>
        <span className="font-mono text-[12px] text-sapphire">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--sapphire)]"
      />
      <p className="mt-1 font-mono text-[11px] text-muted-foreground/50">{hint}</p>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.012] px-4 py-3 text-left transition-colors hover:border-white/[0.12]"
    >
      <span>
        <span className="block text-[13px] text-foreground/90">{label}</span>
        <span className="block font-mono text-[11px] text-muted-foreground/50">{hint}</span>
      </span>
      <span
        className={cn(
          "relative h-[18px] w-[34px] shrink-0 rounded-full transition-colors",
          value ? "bg-emerald/40" : "bg-white/[0.08]",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all",
            value ? "left-[18px] bg-emerald" : "left-[2px] bg-white/50",
          )}
          style={value ? { boxShadow: "0 0 10px -1px var(--emerald)" } : undefined}
        />
      </span>
    </button>
  );
}
