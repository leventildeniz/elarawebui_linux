import { useEffect, useRef, useState } from "react";
import { canEdit as canEditOwned, editRefusal, useOwnerCtx } from "@/lib/ownership";
import { SharePopover } from "@/components/sovereign/ownership-controls";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ArrowLeft,
  Brain,
  Check,
  Save,
  Pencil,
  Plus,
  RotateCw,
  ShieldAlert,
  Trash2,
  ChevronDown,
  Wrench,
  X,
} from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, Sheen, StatusDot, Tag } from "@/components/sovereign/primitives";
import {
  usePlanners,
  plannerStats,
  emptyPlanner,
  plannerKinds,
  logPlannerScope,
  type PlannerKind,
  type Planner,
} from "@/lib/planner-store";
import { useCapabilityUniverse } from "@/lib/tool-universe";
import { useModels } from "@/lib/model-store";
import { useAccess } from "@/lib/rbac-store";
import { cn, fmtDateTime } from "@/lib/utils";

export const Route = createFileRoute("/planner")({
  validateSearch: (search: Record<string, unknown>): { plane: PlannerKind } => ({
    plane:
      search["plane"] === "skill" || search["plane"] === "mcp"
        ? (search["plane"] as PlannerKind)
        : "tool",
  }),
  head: () => ({
    meta: [
      { title: "Planner v1 — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Create, edit and remove tool-orchestration planners. Shadow or active mode, insights, run history and advanced circuit-breaker controls.",
      },
      { property: "og:title", content: "Planner v1 — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Create, edit and remove tool-orchestration planners with shadow/active modes, insights and run telemetry.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlannerPage,
});

type Draft = Omit<Planner, "id" | "createdAt" | "runs">;
type Tab = "control" | "insights" | "runs" | "advanced";

function PlannerPage() {
  const { plane } = Route.useSearch();
  const { planners, create, update, remove } = usePlanners();
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: "new" | "edit"; planner?: Planner } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const active = planners.find((p) => p.id === openId) ?? null;
  /* Planners from other desks stay visible but sealed. */
  const ownerCtx = useOwnerCtx();

  if (active) {
    return (
      <PlannerDetail
        planner={active}
        onBack={() => setOpenId(null)}
        onEdit={() => setDialog({ mode: "edit", planner: active })}
        onDelete={() => {
          remove(active.id);
          setOpenId(null);
        }}
        update={update}
        dialog={
          dialog && (
            <PlannerDialog
              initial={dialog.planner}
              onClose={() => setDialog(null)}
              onSubmit={(draft) => {
                if (dialog.planner) update(dialog.planner.id, draft);
                setDialog(null);
              }}
            />
          )
        }
      />
    );
  }

  const scoped = planners.filter((p) => p.kind === plane);
  const enabled = scoped.filter((p) => p.enabled).length;
  const meta = plannerKinds.find((k) => k.id === plane)!;

  return (
    <Surface
      title={meta.label}
      meta={`${scoped.length} planner · ${enabled} enabled · ${meta.noun} orchestration layer`}
      wide
      action={
        <JewelButton className="gap-2" onClick={() => setDialog({ mode: "new" })}>
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          New planner
        </JewelButton>
      }
    >
      <p className="max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
        Each planner runs a planning step before the answer turn and decides which {meta.noun}s to
        reach for. Keep one in shadow to accumulate telemetry at zero risk, promote another to
        active when the numbers hold. Create as many as you need — every planner is editable and
        removable.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <AnimatePresence initial={false}>
          {scoped.map((p, i) => {
            const s = plannerStats(p);
            return (
              <motion.article
                key={p.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.24, delay: i * 0.018, ease: [0.22, 1, 0.36, 1] }}
                className="glass group relative overflow-hidden rounded-xl p-5 transition-shadow duration-300 hover:shadow-[0_0_38px_-24px_var(--sapphire)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => setOpenId(p.id)}
                    className="flex min-w-0 items-start gap-3 text-left"
                  >
                    <span className="mt-0.5 rounded-lg border border-sapphire/30 bg-sapphire/10 p-2 text-sapphire">
                      <Brain className="h-4 w-4" strokeWidth={1.6} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-[15.5px] font-medium tracking-tight text-foreground">
                        {p.name}
                      </h2>
                      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/60">
                        {p.description}
                      </div>
                    </div>
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    <SharePopover
                      record={p}
                      ctx={ownerCtx}
                      disabled={!canEditOwned(p, ownerCtx)}
                      reason={editRefusal(p, ownerCtx)}
                      onChange={(patch) => update(p.id, patch)}
                    />
                    <StatusDot tone={p.enabled ? "emerald" : "ruby"} pulse={p.enabled} />
                    <Tag tone={p.enabled ? "emerald" : "ruby"}>{p.enabled ? "ON" : "OFF"}</Tag>
                  </span>
                </div>

                <Sheen className="my-4" />

                <dl className="grid grid-cols-2 gap-y-2 font-mono text-[11.5px]">
                  <dt className="text-muted-foreground/55">mode</dt>
                  <dd
                    className={cn(
                      "text-right",
                      p.mode === "active" ? "text-emerald" : "text-amethyst",
                    )}
                  >
                    {p.mode}
                  </dd>
                  <dt className="text-muted-foreground/55">max {meta.noun}s / turn</dt>
                  <dd className="text-right text-foreground/85">{p.maxTools}</dd>
                  <dt className="text-muted-foreground/55">runs</dt>
                  <dd className="text-right text-foreground/85">{s.total}</dd>
                  <dt className="text-muted-foreground/55">total avg</dt>
                  <dd className="text-right text-foreground/85">{s.totalAvg}ms</dd>
                </dl>

                <div className="mt-5 flex items-center gap-2">
                  <JewelButton size="sm" variant="outline" onClick={() => setOpenId(p.id)}>
                    Open
                  </JewelButton>
                  <JewelButton
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    disabled={!canEditOwned(p, ownerCtx)}
                    title={editRefusal(p, ownerCtx)}
                    onClick={() => setDialog({ mode: "edit", planner: p })}
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Edit
                  </JewelButton>
                  <JewelButton
                    size="sm"
                    variant="ghost"
                    className="ml-auto gap-1.5 text-ruby hover:text-ruby"
                    disabled={!canEditOwned(p, ownerCtx)}
                    title={editRefusal(p, ownerCtx)}
                    onClick={() => setConfirm(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Delete
                  </JewelButton>
                </div>

                <AnimatePresence>
                  {confirm === p.id && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-canvas/80 backdrop-blur-[3px]"
                    >
                      <p className="px-6 text-center text-[13.5px] text-foreground/85">
                        Delete <span className="font-mono text-ruby">{p.name}</span>?
                      </p>
                      <div className="flex gap-2">
                        <JewelButton
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            remove(p.id);
                            setConfirm(null);
                          }}
                        >
                          Delete
                        </JewelButton>
                        <JewelButton size="sm" variant="outline" onClick={() => setConfirm(null)}>
                          Cancel
                        </JewelButton>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.article>
            );
          })}
        </AnimatePresence>

        <motion.button
          layout
          onClick={() => setDialog({ mode: "new" })}
          className="flex min-h-[190px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-muted-foreground/70 transition-colors hover:border-sapphire/40 hover:bg-raised/20 hover:text-sapphire"
        >
          <Plus className="h-5 w-5" strokeWidth={1.5} />
          <span className="font-mono text-[11px] uppercase tracking-[0.2em]">new planner</span>
        </motion.button>
      </div>

      <AnimatePresence>
        {dialog && (
          <PlannerDialog
            initial={dialog.planner}
            kind={plane}
            onClose={() => setDialog(null)}
            onSubmit={(draft) => {
              if (dialog.planner) update(dialog.planner.id, draft);
              else create({ ...draft, kind: plane, runs: [] });
              setDialog(null);
            }}
          />
        )}
      </AnimatePresence>
    </Surface>
  );
}

/* ---------------- detail ---------------- */

function PlannerDetail({
  planner,
  onBack,
  onEdit,
  onDelete,
  update,
  dialog,
}: {
  planner: Planner;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  update: (id: string, patch: Partial<Planner>) => void;
  dialog: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("control");
  const [range, setRange] = useState("7");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const s = plannerStats(planner);
  const canExecute = useAccess().can("plan-execute");
  const noun = plannerKinds.find((k) => k.id === planner.kind)?.noun ?? "tool";
  const { models } = useModels();

  const tabs: { id: Tab; label: string }[] = [
    { id: "control", label: "Control" },
    { id: "insights", label: "Insights" },
    { id: "runs", label: `Runs (${planner.runs.length})` },
    { id: "advanced", label: "Advanced" },
  ];

  const set = (patch: Partial<Planner>) => {
    update(planner.id, patch);
    setDirty(true);
    setSaved(false);
  };

  const commit = () => {
    update(planner.id, { updatedAt: Date.now() } as Partial<Planner>);
    setDirty(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Surface
      title={planner.name}
      crumb="Planner v1"
      meta={planner.description}
      wide
      action={
        <div className="flex items-center gap-2">
          <Tag tone={planner.enabled ? "emerald" : "ruby"}>{planner.enabled ? "ON" : "OFF"}</Tag>
          <JewelButton
            size="sm"
            variant="outline"
            className={cn(
              "gap-1.5 transition-colors duration-200",
              saved
                ? "border-emerald/50 text-emerald"
                : dirty
                  ? "border-sapphire/55 text-sapphire"
                  : "opacity-70",
            )}
            onClick={commit}
          >
            {saved ? (
              <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {saved ? "Saved" : dirty ? "Save changes" : "Save"}
          </JewelButton>
          <JewelButton size="sm" variant="outline" className="gap-1.5" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            All planners
          </JewelButton>
          <JewelButton size="sm" variant="ghost" className="gap-1.5" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
            Edit
          </JewelButton>
          <JewelButton
            size="sm"
            variant="ghost"
            className="gap-1.5 text-ruby hover:text-ruby"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Delete
          </JewelButton>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/70 bg-raised/25 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-3.5 py-1.5 font-mono text-[11.5px] tracking-wide transition-colors duration-200",
              tab === t.id
                ? "border border-sapphire/45 bg-sapphire/10 text-sapphire"
                : "border border-transparent text-muted-foreground/70 hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-8 space-y-6">
        {tab === "control" && (
          <Panel
            icon={<Activity className="h-4 w-4" strokeWidth={1.6} />}
            title="Master switch"
            note="When the planner is off, chat behaves exactly like before. Rollback is one click."
          >
            <Toggle
              label="Planner enabled"
              note="Runs a planning LLM step on every chat turn."
              value={planner.enabled}
              onChange={(v) => set({ enabled: v })}
            />

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="mode"
                note="Shadow → zero risk, telemetry accumulates. Active → tool outputs are appended to the answer context."
              >
                <select
                  value={planner.mode}
                  onChange={(e) => set({ mode: e.target.value as Planner["mode"] })}
                  className={inputCls}
                >
                  <option value="shadow" className="bg-panel">
                    shadow — log only
                  </option>
                  <option value="active" className="bg-panel" disabled={!canExecute}>
                    active — execute plan{canExecute ? "" : " · requires planner-execute"}
                  </option>
                </select>
              </Field>
              <Field
                label={`max ${noun}s / turn`}
                note={`At most N ${noun}s per turn. 0 = plan only, don't execute.`}
              >
                <NumberInput value={planner.maxTools} onChange={(v) => set({ maxTools: v })} />
              </Field>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label={`${noun} timeout (ms)`}>
                <NumberInput
                  value={planner.toolTimeout}
                  step={500}
                  onChange={(v) => set({ toolTimeout: v })}
                />
              </Field>
              <Field label="planner timeout (ms)">
                <NumberInput
                  value={planner.plannerTimeout}
                  step={500}
                  onChange={(v) => set({ plannerTimeout: v })}
                />
              </Field>
              <Field
                label="RAG bypass margin (active)"
                note="When RAG top1 ≥ (1 − this), the planner stays out of the way."
              >
                <NumberInput
                  value={planner.ragMargin}
                  step={0.05}
                  onChange={(v) => set({ ragMargin: v })}
                />
              </Field>
            </div>
          </Panel>
        )}

        {tab === "control" && (
          <Panel
            icon={<Wrench className="h-4 w-4" strokeWidth={1.6} />}
            title={`${noun[0]!.toUpperCase()}${noun.slice(1)} scope`}
            note={`Decide exactly which ${noun}s this planner may reach. Everything outside the scope is refused and written to the audit journal.`}
          >
            <ToolScope
              kind={planner.kind}
              policy={planner.toolPolicy}
              list={planner.toolList}
              onPolicy={(p) => {
                set({ toolPolicy: p });
                logPlannerScope({ ...planner, toolPolicy: p });
              }}
              onList={(next) => {
                set({ toolList: next });
                logPlannerScope({ ...planner, toolList: next });
              }}
            />
          </Panel>
        )}

        {tab === "insights" && (
          <>
            <div className="flex items-center gap-3">
              <span className="mono-label">range</span>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value)}
                className="rounded-lg border border-input bg-raised/50 px-3 py-1.5 font-mono text-[12px] outline-none focus:border-sapphire/50"
              >
                <option value="1" className="bg-panel">
                  Last 24 hours
                </option>
                <option value="7" className="bg-panel">
                  Last 7 days
                </option>
                <option value="30" className="bg-panel">
                  Last 30 days
                </option>
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="total runs" value={s.total} />
              <Stat label="shadow" value={s.shadow} tone="amethyst" />
              <Stat label="active" value={s.active} tone="emerald" />
              <Stat label="rag hit" value={s.grounded} tone="sapphire" />
              <Stat label="with tools" value={s.withTools} note="≥1 tool ran" />
              <Stat label="both empty" value={s.bothEmpty} note="RAG and tools empty" />
              <Stat label="errors" value={s.errors} tone="ruby" note="Failed runs" />
              <Stat
                label="contradictions"
                value={s.contradictions}
                tone="topaz"
                note="Cross-check flag"
              />
              <Stat label="planner avg" value={`${s.plannerAvg}ms`} />
              <Stat label="tools avg" value={`${s.toolsAvg}ms`} />
              <Stat label="total avg" value={`${s.totalAvg}ms`} />
            </div>

            <Panel title="Most-called tools">
              {s.topTools.length ? (
                <ul className="space-y-2">
                  {s.topTools.map(([tool, count]) => (
                    <li
                      key={tool}
                      className="flex items-center justify-between font-mono text-[12.5px]"
                    >
                      <span className="text-foreground/85">{tool}</span>
                      <span className="text-sapphire">{count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-mono text-[12.5px] text-muted-foreground/60">No data yet.</p>
              )}
            </Panel>
          </>
        )}

        {tab === "runs" && (
          <Panel title="Run history" note="Every planning step, its tools and its latency.">
            {planner.runs.length ? (
              <div className="divide-y divide-border/60">
                {planner.runs.map((r) => (
                  <div key={r.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tag tone={r.mode === "active" ? "emerald" : "amethyst"}>{r.mode}</Tag>
                        {r.tools.map((t) => (
                          <Tag key={t} tone="sapphire">
                            {t}
                          </Tag>
                        ))}
                        {r.contradiction && <Tag tone="topaz">contradiction</Tag>}
                        {r.error && <Tag tone="ruby">error</Tag>}
                      </div>
                      <p className="mt-2 truncate text-[13.5px] text-foreground/85">{r.question}</p>
                    </div>
                    <div className="text-left font-mono text-[11px] text-muted-foreground/60 sm:text-right">
                      <div>{fmtDateTime(r.at)}</div>
                      <div className="mt-1 text-foreground/70">
                        planner {r.plannerMs}ms · tools {r.toolsMs}ms
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-mono text-[12.5px] text-muted-foreground/60">
                No planner runs yet. Flip the master switch on and ask a question in chat.
              </p>
            )}
            <div className="mt-5 flex justify-end">
              <JewelButton
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => set({ runs: [] })}
              >
                <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                Clear history
              </JewelButton>
            </div>
          </Panel>
        )}

        {tab === "advanced" && (
          <>
            <Panel
              title="Custom planner prompt"
              note="Leave blank to use the default prompt. The {MAX_TOOLS} placeholder is substituted at runtime."
            >
              <textarea
                rows={7}
                value={planner.prompt}
                onChange={(e) => set({ prompt: e.target.value })}
                placeholder="Default prompt active..."
                className="w-full resize-y rounded-lg border border-input bg-raised/50 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed outline-none transition-colors focus:border-sapphire/50"
              />
            </Panel>

            <Panel
              title="Override model (optional)"
              note='Use a different model for the planner step. "Default" → runtime decides.'
            >
              <select
                value={planner.overrideModel}
                onChange={(e) => set({ overrideModel: e.target.value })}
                className={inputCls}
              >
                <option value="" className="bg-panel">
                  Default (runtime picks)
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.id} className="bg-panel">
                    {m.name} — {m.modelId}
                  </option>
                ))}
              </select>
            </Panel>

            <Panel
              title="Cross-check"
              note="Flag runs where tool output contradicts RAG sources. Numbers returned by a tool that don't appear in the RAG context are marked suspicious."
            >
              <Toggle
                label="Contradiction detection enabled"
                value={planner.crossCheck}
                onChange={(v) => set({ crossCheck: v })}
              />
            </Panel>

            <Panel
              icon={<ShieldAlert className="h-4 w-4" strokeWidth={1.6} />}
              title="Auto-fallback (circuit breaker)"
              note="If the error rate over the last N runs crosses the threshold, the planner turns itself off."
            >
              <Toggle
                label="Auto-fallback enabled"
                value={planner.autoFallback}
                onChange={(v) => set({ autoFallback: v })}
              />
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="window (runs)">
                  <NumberInput
                    value={planner.fallbackWindow}
                    onChange={(v) => set({ fallbackWindow: v })}
                  />
                </Field>
                <Field label="error threshold (0–1)">
                  <NumberInput
                    value={planner.fallbackThreshold}
                    step={0.05}
                    onChange={(v) => set({ fallbackThreshold: v })}
                  />
                </Field>
                <Field label="min runs">
                  <NumberInput
                    value={planner.fallbackMinRuns}
                    onChange={(v) => set({ fallbackMinRuns: v })}
                  />
                </Field>
              </div>
              <p className="mt-3 font-mono text-[10.5px] text-muted-foreground/50">
                Example: window=20, threshold=0.5 → planner shuts off if 50% of the last 20 runs
                failed.
              </p>
            </Panel>
          </>
        )}
      </div>

      <AnimatePresence>{dialog}</AnimatePresence>
    </Surface>
  );
}

/* ---------------- pieces ---------------- */

const inputCls =
  "w-full rounded-lg border border-input bg-raised/50 px-3 py-2 font-mono text-[12.5px] outline-none transition-colors focus:border-sapphire/50";

function Panel({
  title,
  note,
  icon,
  children,
}: {
  title: string;
  note?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="glass rounded-xl p-6">
      <div className="flex items-center gap-2 text-foreground">
        {icon && <span className="text-sapphire">{icon}</span>}
        <h2 className="text-[15px] font-medium tracking-tight">{title}</h2>
      </div>
      {note && (
        <p className="mt-2 max-w-[76ch] text-[13px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  note,
  value,
  onChange,
}: {
  label: string;
  note?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-raised/20 px-4 py-3">
      <div>
        <div className="text-[13.5px] text-foreground/90">{label}</div>
        {note && <div className="mt-1 text-[12px] text-muted-foreground/70">{note}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200",
          value
            ? "border-emerald/50 bg-emerald/25 shadow-[0_0_18px_-6px_var(--emerald)]"
            : "border-border bg-raised",
        )}
        title={label}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className={cn(
            "absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full",
            value ? "left-[24px] bg-emerald" : "left-[3px] bg-muted-foreground/60",
          )}
        />
      </button>
    </div>
  );
}

function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mono-label mb-2 block">{label}</span>
      {children}
      {note && (
        <span className="mt-2 block text-[11.5px] leading-relaxed text-muted-foreground/60">
          {note}
        </span>
      )}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <input
      type="number"
      step={step}
      min={0}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={inputCls}
    />
  );
}

function Stat({
  label,
  value,
  note,
  tone = "sapphire",
}: {
  label: string;
  value: number | string;
  note?: string;
  tone?: "sapphire" | "emerald" | "amethyst" | "ruby" | "topaz";
}) {
  const toneCls = {
    sapphire: "text-sapphire",
    emerald: "text-emerald",
    amethyst: "text-amethyst",
    ruby: "text-ruby",
    topaz: "text-topaz",
  }[tone];
  return (
    <div className="glass rounded-xl p-4">
      <div className="mono-label">{label}</div>
      <div className={cn("mt-2 font-mono text-[24px] leading-none", toneCls)}>{value}</div>
      {note && <div className="mt-2 text-[11.5px] text-muted-foreground/60">{note}</div>}
    </div>
  );
}

/* ---------------- tool scope ---------------- */

function ToolScope({
  kind,
  policy,
  list,
  onPolicy,
  onList,
}: {
  kind: PlannerKind;
  policy: Planner["toolPolicy"];
  list: string[];
  onPolicy: (p: Planner["toolPolicy"]) => void;
  onList: (next: string[]) => void;
}) {
  const universe = useCapabilityUniverse(kind);
  const noun = plannerKinds.find((k) => k.id === kind)?.noun ?? "tool";
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const forged = universe.filter((t) => t.source === "forge");
  const unscoped = policy === "allow" ? forged.filter((t) => !list.includes(t.id)) : [];
  const shown = universe.filter((t) => t.id.includes(q.trim().toLowerCase()));

  const toggle = (id: string) =>
    onList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/70 bg-raised/25 p-1">
        {(
          [
            { id: "all", label: `all ${noun}s` },
            { id: "allow", label: "allow-list" },
            { id: "deny", label: "deny-list" },
          ] as const
        ).map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onPolicy(o.id)}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-[11.5px] tracking-wide transition-colors duration-200",
              policy === o.id
                ? "border border-emerald/45 bg-emerald/10 text-emerald"
                : "border border-transparent text-muted-foreground/70 hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      <p className="mt-3 font-mono text-[11px] text-muted-foreground/60">
        {policy === "all"
          ? `every registered ${noun} is reachable — anything registered later is included automatically`
          : policy === "allow"
            ? `only the selected ${noun}s are reachable — anything added later stays out until you pick it`
            : `the selected ${noun}s are refused — everything else, including new ${noun}s, stays reachable`}
      </p>

      {policy !== "all" && (
        <div ref={ref} className="relative mt-4">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground transition-colors hover:border-sapphire/45"
          >
            <span className="truncate text-left">
              {list.length
                ? `${list.length} ${noun}${list.length > 1 ? "s" : ""} ${policy === "allow" ? "allowed" : "denied"}`
                : `select ${noun}s…`}
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform",
                open && "rotate-180",
              )}
              strokeWidth={1.6}
            />
          </button>

          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="glass absolute left-0 top-[calc(100%+6px)] z-[140] max-h-[300px] w-full min-w-[240px] overflow-y-auto rounded-xl p-1.5"
              >
                <input
                  value={q}
                  autoFocus
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={`search ${noun}s…`}
                  className="mb-1 w-full rounded-lg border border-white/[0.06] bg-raised/40 px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-sapphire/45"
                />
                {shown.length === 0 && (
                  <div className="px-2.5 py-2 font-mono text-[11.5px] text-muted-foreground/55">
                    no {noun} matches
                  </div>
                )}
                {shown.map((t) => {
                  const on = list.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggle(t.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 font-mono text-[12.5px] transition-colors",
                        on
                          ? "bg-sapphire/15 text-foreground"
                          : "text-muted-foreground/75 hover:bg-white/[0.04] hover:text-foreground",
                      )}
                    >
                      <span className="truncate">
                        {t.label}
                        {t.source === "forge" && (
                          <span className="ml-2 text-[10px] text-amethyst/80">forged</span>
                        )}
                      </span>
                      {on && <Check size={12} className="text-sapphire" strokeWidth={2.4} />}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {list.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {list.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11.5px] transition-colors duration-200",
                    policy === "allow"
                      ? "border-emerald/40 bg-emerald/8 text-emerald"
                      : "border-ruby/40 bg-ruby/8 text-ruby line-through",
                  )}
                >
                  {id}
                  <X className="h-3 w-3 opacity-50 group-hover:opacity-100" strokeWidth={2} />
                </button>
              ))}
            </div>
          )}

          {unscoped.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-topaz/35 bg-topaz/[0.06] px-3 py-2">
              <span className="font-mono text-[11px] text-topaz">
                {unscoped.length} newly forged {noun}
                {unscoped.length > 1 ? "s" : ""} outside this allow-list
              </span>
              <button
                type="button"
                onClick={() => onList([...list, ...unscoped.map((t) => t.id)])}
                className="rounded-md border border-topaz/45 px-2 py-0.5 font-mono text-[11px] text-topaz transition-colors hover:bg-topaz/10"
              >
                admit all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- dialog ---------------- */

function PlannerDialog({
  initial,
  kind,
  onClose,
  onSubmit,
}: {
  initial?: Planner | undefined;
  kind?: PlannerKind;
  onClose: () => void;
  onSubmit: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => {
    if (!initial) return { ...emptyPlanner, kind: kind ?? "tool" };
    const { id: _id, createdAt: _c, runs: _r, ...rest } = initial;
    return rest;
  });
  const draftNoun = plannerKinds.find((k) => k.id === draft.kind)?.noun ?? "tool";
  const canExecute = useAccess().can("plan-execute");

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-[2px]"
      />
      <motion.div
        role="dialog"
        aria-label={initial ? "Edit planner" : "New planner"}
        initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="obsidian-slab fixed left-1/2 top-1/2 z-50 max-h-[86vh] w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[16px] p-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-medium tracking-tight">
            {initial ? "Edit planner" : "New planner"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground/60 transition-colors hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim()) return;
            onSubmit({ ...draft, name: draft.name.trim() });
          }}
        >
          <Field label="name">
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Research Planner"
              className="w-full rounded-lg border border-input bg-raised/50 px-3 py-2 text-[14px] outline-none transition-colors focus:border-sapphire/50"
            />
          </Field>

          <Field label="description">
            <input
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Tool orchestration layer · opt-in · shadow/active"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="mode">
              <select
                value={draft.mode}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, mode: e.target.value as Planner["mode"] }))
                }
                className={inputCls}
              >
                <option value="shadow" className="bg-panel">
                  shadow — log only
                </option>
                <option value="active" className="bg-panel" disabled={!canExecute}>
                  active — execute plan{canExecute ? "" : " · requires planner-execute"}
                </option>
              </select>
            </Field>
            <Field label={`max ${draftNoun}s / turn`}>
              <NumberInput
                value={draft.maxTools}
                onChange={(v) => setDraft((d) => ({ ...d, maxTools: v }))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={`${draftNoun} timeout (ms)`}>
              <NumberInput
                value={draft.toolTimeout}
                step={500}
                onChange={(v) => setDraft((d) => ({ ...d, toolTimeout: v }))}
              />
            </Field>
            <Field label="planner timeout (ms)">
              <NumberInput
                value={draft.plannerTimeout}
                step={500}
                onChange={(v) => setDraft((d) => ({ ...d, plannerTimeout: v }))}
              />
            </Field>
          </div>

          <Field label={`${draftNoun} scope`}>
            <ToolScope
              kind={draft.kind}
              policy={draft.toolPolicy}
              list={draft.toolList}
              onPolicy={(p) => setDraft((d) => ({ ...d, toolPolicy: p }))}
              onList={(next) => setDraft((d) => ({ ...d, toolList: next }))}
            />
          </Field>

          <Toggle
            label="Planner enabled"
            value={draft.enabled}
            onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
          />

          <div className="flex justify-end gap-2 pt-2">
            <JewelButton type="button" variant="outline" onClick={onClose}>
              Cancel
            </JewelButton>
            <JewelButton type="submit">{initial ? "Save changes" : "Create planner"}</JewelButton>
          </div>
        </form>
      </motion.div>
    </>
  );
}
