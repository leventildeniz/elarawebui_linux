import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Archive, Check, CheckCircle2, Clock, Gem, RotateCcw, Trash2, Undo2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Shell } from "@/components/sovereign/shell";
import { useForgePlans, type ForgeActionKind, type ForgePlan } from "@/lib/metaforge-store";
import { useApprovalAuthority } from "@/lib/approver-gate";
import { ApproverBanner } from "@/components/sovereign/approver-banner";
import { confirmAction } from "@/components/sovereign/confirm-dialog";

export const Route = createFileRoute("/meta-forge")({
  head: () => ({
    meta: [
      { title: "Meta-Forge — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "The system improving itself: every forge plan with its actions, approval state and a full rollback ledger.",
      },
      { property: "og:title", content: "Meta-Forge — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Forge plans, generated actions and rollbacks — the self-evolution ledger.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MetaForge,
});

const kindTone: Record<ForgeActionKind, string> = {
  tool: "sapphire",
  skill: "amethyst",
  agent: "topaz",
  pack: "emerald",
  model: "ruby",
  mcp: "platinum",
};

const statusTone: Record<ForgePlan["status"], string> = {
  pending: "topaz",
  applied: "emerald",
  rejected: "ruby",
  rolled_back: "ruby",
};

const FILTERS = ["all", "pending", "applied", "rejected", "rolled_back"] as const;

function MetaForge() {
  const { plans, trash, hydrated, approve, reject, rollback, reapply, reset, restore, fetchTrash, restoreTrash, purgeTrash, emptyTrash } = useForgePlans();
  const auth = useApprovalAuthority();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [trashOpen, setTrashOpen] = useState(false);

  /** Every ledger mutation runs through the RBAC `approve` verb. */
  const guard = async (verb: string, planId: string, run: () => void) => {
    if (!auth.canApprove) {
      auth.denied(
        "meta-forge",
        `${auth.handle} tried to ${verb} plan ${planId} without the approve verb`,
      );
      await confirmAction({
        title: "Approve verb required",
        body: `Your role (${auth.role?.name ?? "unknown"}) cannot decide forge plans. Grant the "Approve" verb in RBAC, or bind this principal to a role that already holds it.`,
        confirmLabel: "Understood",
        tone: "ruby",
      });
      return;
    }
    run();
  };
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetMode, setResetMode] = useState<"logs_only" | "clean_sweep">("logs_only");

  const list = useMemo(
    () =>
      [...plans]
        .sort((a, b) => b.createdAt - a.createdAt)
        .filter((p) => filter === "all" || p.status === filter),
    [plans, filter],
  );

  const counts = useMemo(
    () => ({
      pending: plans.filter((p) => p.status === "pending").length,
      applied: plans.filter((p) => p.status === "applied").length,
      rolled_back: plans.filter((p) => p.status === "rolled_back").length,
    }),
    [plans],
  );

  return (
    <Shell crumb="Meta-Forge">
      <div className="mx-auto h-full w-full max-w-[1180px] overflow-y-auto px-8 py-8">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <h1 className="flex items-center gap-2.5 font-mono text-[13px] uppercase tracking-[0.22em] text-foreground/90">
              <Gem className="h-4 w-4 text-sapphire" strokeWidth={1.6} /> Forge plans
            </h1>
            <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted-foreground">
              Every capability the system proposed for itself — actions it would create, who signed
              off, and a rollback for anything already applied.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3 font-mono text-[11px] tracking-[0.12em] text-muted-foreground/60">
            <span className="text-topaz">{mounted ? counts.pending : 0} pending</span>
            <span className="text-emerald">{mounted ? counts.applied : 0} applied</span>
            <span className="text-ruby">{mounted ? counts.rolled_back : 0} rolled back</span>
            <button
              onClick={() => {
                fetchTrash();
                setTrashOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 transition-colors hover:text-foreground hover:border-amethyst/50"
            >
              <Archive className="h-3 w-3 text-amethyst" strokeWidth={1.6} />
              trash ({trash.length})
            </button>
            <button
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" strokeWidth={1.6} /> reset ledger
            </button>
          </div>
        </header>

        {confirmReset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-[min(480px,94vw)] rounded-[14px] border border-border bg-panel p-6 shadow-2xl">
              <h2 className="font-mono text-[13px] uppercase tracking-[0.2em] text-foreground">
                Reset Forge Ledger
              </h2>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
                Choose how you want to reset the Meta-Forge evolution ledger:
              </p>

              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => setResetMode("logs_only")}
                  className={cn(
                    "w-full text-left rounded-xl border p-3.5 transition-all duration-150 relative",
                    resetMode === "logs_only"
                      ? "border-sapphire/70 bg-sapphire/[0.12] shadow-[0_0_24px_-10px_var(--sapphire)]"
                      : "border-white/[0.08] bg-raised/30 hover:border-white/20 hover:bg-raised/50"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-sapphire">
                      1. Clear History Only (Log Purge)
                    </div>
                    <div className={cn(
                      "h-4 w-4 rounded-full border flex items-center justify-center transition-colors",
                      resetMode === "logs_only"
                        ? "border-sapphire bg-sapphire text-white"
                        : "border-white/20 bg-transparent"
                    )}>
                      {resetMode === "logs_only" && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                    </div>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground pr-5">
                    Removes plan records from the ledger. All active tools, workflows and webhooks remain deployed and functioning.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setResetMode("clean_sweep")}
                  className={cn(
                    "w-full text-left rounded-xl border p-3.5 transition-all duration-150 relative",
                    resetMode === "clean_sweep"
                      ? "border-ruby/70 bg-ruby/[0.12] shadow-[0_0_24px_-10px_var(--ruby)]"
                      : "border-white/[0.08] bg-raised/30 hover:border-white/20 hover:bg-raised/50"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-ruby">
                      2. Clean Sweep & Rollback (Factory Reset)
                    </div>
                    <div className={cn(
                      "h-4 w-4 rounded-full border flex items-center justify-center transition-colors",
                      resetMode === "clean_sweep"
                        ? "border-ruby bg-ruby text-white"
                        : "border-white/20 bg-transparent"
                    )}>
                      {resetMode === "clean_sweep" && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                    </div>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground pr-5">
                    Rolls back all generated tools and workflows (moves files to .forge-trash, clears DB records) and purges the ledger.
                  </p>
                </button>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded-md border border-border px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    reset(resetMode);
                    setConfirmReset(false);
                  }}
                  className={cn(
                    "rounded-md border px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-all",
                    resetMode === "clean_sweep"
                      ? "border-ruby/50 bg-ruby/20 text-ruby hover:bg-ruby/30 shadow-[0_0_18px_-6px_var(--ruby)]"
                      : "border-sapphire/50 bg-sapphire/20 text-sapphire hover:bg-sapphire/30 shadow-[0_0_18px_-6px_var(--sapphire)]"
                  )}
                >
                  Confirm Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {trashOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
            <div className="w-[min(640px,96vw)] max-h-[85vh] flex flex-col rounded-[16px] border border-border bg-panel p-6 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.07]">
                <div className="flex items-center gap-2.5">
                  <Archive className="h-4 w-4 text-amethyst" strokeWidth={1.8} />
                  <h2 className="font-mono text-[13px] uppercase tracking-[0.2em] text-foreground">
                    Archived Artifacts (.forge-trash)
                  </h2>
                  <span className="rounded-full bg-amethyst/15 text-amethyst px-2 py-0.5 font-mono text-[10.5px]">
                    {trash.length} files
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setTrashOpen(false)}
                  className="rounded-md p-1 text-muted-foreground/60 hover:text-foreground hover:bg-raised/50 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="mt-3 text-[13px] text-muted-foreground">
                Python tools and agents backed up here during plan rollbacks. You can restore any artifact back to the active catalog or permanently purge it.
              </p>

              <div className="mt-4 flex-1 overflow-y-auto space-y-2 max-h-[460px] pr-1 divide-y divide-white/[0.04]">
                {trash.map((item) => (
                  <div
                    key={item.fileName}
                    className="pt-2.5 first:pt-0 flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "rounded-[4px] px-1.5 py-0.5 font-mono text-[10px] uppercase font-semibold",
                          item.kind === "agent" ? "bg-topaz/15 text-topaz border border-topaz/30" : "bg-sapphire/15 text-sapphire border border-sapphire/30"
                        )}>
                          {item.kind}
                        </span>
                        <span className="font-mono text-[12.5px] font-medium text-foreground truncate" title={item.fileName}>
                          {item.slug}
                        </span>
                      </div>
                      {item.description && (
                        <p className="mt-0.5 text-[11.5px] text-muted-foreground/75 truncate">
                          {item.description}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-muted-foreground/50">
                        <span className="flex items-center gap-1">
                          <Clock size={10} /> {new Date(item.trashedAt).toLocaleString()}
                        </span>
                        <span>{(item.sizeBytes / 1024).toFixed(1)} KB</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          await restoreTrash(item.fileName);
                          toast.success(`Restored ${item.slug} back to active catalog!`);
                        }}
                        className="rounded-md border border-emerald/40 bg-emerald/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-emerald transition-all hover:bg-emerald/20 hover:shadow-[0_0_12px_-4px_var(--emerald)]"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await purgeTrash(item.fileName);
                          toast("Permanently purged artifact.");
                        }}
                        title="Delete permanently"
                        className="rounded-md border border-border p-1.5 text-muted-foreground/50 transition-colors hover:text-ruby hover:border-ruby/40 hover:bg-ruby/10"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}

                {trash.length === 0 && (
                  <div className="py-12 text-center font-mono text-[12px] text-muted-foreground/45">
                    Trash is empty. No archived artifacts found.
                  </div>
                )}
              </div>

              <div className="mt-5 pt-3 border-t border-white/[0.07] flex items-center justify-between">
                {trash.length > 0 ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: "Empty all trash?",
                        body: "This will permanently delete all files in .forge-trash. This action cannot be undone.",
                        confirmLabel: "Empty Trash",
                        tone: "ruby",
                      });
                      if (ok) {
                        await emptyTrash();
                        toast("Emptied all trash.");
                      }
                    }}
                    className="rounded-md border border-ruby/30 bg-ruby/[0.06] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ruby transition-colors hover:bg-ruby/15"
                  >
                    Empty Trash
                  </button>
                ) : <div />}

                <button
                  type="button"
                  onClick={() => setTrashOpen(false)}
                  className="rounded-md border border-border px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        <ApproverBanner auth={auth} gate="ledger" notify="forge" />

        <div className="mt-6 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="rounded-md border px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] transition-colors"
              style={
                filter === f
                  ? {
                      borderColor: "color-mix(in oklab, var(--sapphire) 42%, transparent)",
                      background: "color-mix(in oklab, var(--sapphire) 12%, transparent)",
                      color: "var(--sapphire)",
                    }
                  : {
                      borderColor: "var(--border)",
                      color: "color-mix(in oklab, var(--muted-foreground) 80%, transparent)",
                    }
              }
            >
              {f.replace("_", " ")}
            </button>
          ))}
        </div>

        <div className="mt-4 divide-y divide-border/60 rounded-[14px] border border-border/70 bg-panel/45 backdrop-blur-md">
          {mounted && (
            <AnimatePresence initial={false}>
              {list.map((p) => (
                <PlanRow
                  key={p.id}
                  plan={p}
                  locked={!auth.canApprove}
                  onApprove={() => guard("approve", p.id, () => approve(p.id))}
                  onReject={() => guard("reject", p.id, () => reject(p.id))}
                  onRollback={async () => {
                    const ok = await confirmAction({
                      title: "Rollback this forge plan?",
                      body: `This will move generated tools to .forge-trash and remove workflows/chains from the active studio. You can restore or re-apply at any time from the ledger or trash hub.`,
                      confirmLabel: "Rollback",
                      tone: "ruby",
                    });
                    if (ok) guard("roll back", p.id, () => rollback(p.id));
                  }}
                  onReapply={() => guard("re-apply", p.id, () => reapply(p.id))}
                />
              ))}
            </AnimatePresence>
          )}
          {(!mounted || list.length === 0) && (
            <div className="px-5 py-10 text-center">
              <p className="font-mono text-[12px] text-muted-foreground/50">
                {!mounted ? "loading ledger..." : plans.length === 0 ? "ledger is empty" : "no plans in this state"}
              </p>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

function PlanRow({
  plan,
  locked,
  onApprove,
  onReject,
  onRollback,
  onReapply,
}: {
  plan: ForgePlan;
  onApprove: () => void;
  onReject: () => void;
  onRollback: () => void;
  onReapply: () => void;
  locked: boolean;
}) {
  const tone = statusTone[plan.status];
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const fmt = (t: number) => (mounted ? new Date(t).toLocaleString() : "");

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
      className="flex gap-5 px-5 py-4 transition-colors hover:bg-raised/25"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]"
            style={{
              border: `1px solid color-mix(in oklab, var(--${tone}) 38%, transparent)`,
              background: `color-mix(in oklab, var(--${tone}) 12%, transparent)`,
              color: `var(--${tone})`,
            }}
          >
            {plan.status === "rolled_back" ? "rolled back" : plan.status}
          </span>
          <span className="font-mono text-[11.5px] text-muted-foreground/60">
            {fmt(plan.createdAt)} · {plan.actor}
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground/35">{plan.id}</span>
        </div>

        <p className="mt-2 max-w-[92ch] text-[14px] leading-[1.65] text-foreground/90">
          {plan.prompt}
        </p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {plan.actions.map((a) => (
            <span
              key={`${a.kind}:${a.name}`}
              className="rounded-md px-2 py-1 font-mono text-[11px]"
              style={{
                border: `1px solid color-mix(in oklab, var(--${kindTone[a.kind]}) 32%, transparent)`,
                background: `color-mix(in oklab, var(--${kindTone[a.kind]}) 10%, transparent)`,
                color: `var(--${kindTone[a.kind]})`,
                opacity: plan.status === "rolled_back" || plan.status === "rejected" ? 0.45 : 1,
                textDecoration: plan.status === "rolled_back" ? "line-through" : "none",
              }}
            >
              + {a.kind}:{a.name}
            </span>
          ))}
        </div>

        {plan.status === "rolled_back" && plan.rolledBackAt && (
          <p className="mt-2 font-mono text-[11px] text-ruby/85">
            [rolled back · {fmt(plan.rolledBackAt)}]
          </p>
        )}
      </div>

      <div className="flex w-[136px] shrink-0 flex-col items-stretch gap-1.5">
        {plan.status === "pending" && (
          <>
            <ActionButton
              tone="emerald"
              icon={CheckCircle2}
              label="approve"
              locked={locked}
              onClick={onApprove}
            />
            <ActionButton
              tone="muted"
              icon={XCircle}
              label="reject"
              locked={locked}
              onClick={onReject}
            />
          </>
        )}
        {plan.status === "applied" && (
          <ActionButton
            tone="ruby"
            icon={Undo2}
            label="rollback"
            locked={locked}
            onClick={onRollback}
          />
        )}
        {plan.status === "rolled_back" && (
          <ActionButton
            tone="sapphire"
            icon={RotateCcw}
            label="re-apply"
            locked={locked}
            onClick={onReapply}
          />
        )}
        {plan.status === "rejected" && (
          <ActionButton
            tone="sapphire"
            icon={RotateCcw}
            label="re-open"
            locked={locked}
            onClick={onReapply}
          />
        )}
      </div>
    </motion.article>
  );
}

function ActionButton({
  tone,
  icon: Icon,
  label,
  locked,
  onClick,
}: {
  tone: string;
  icon: typeof CheckCircle2;
  label: string;
  locked?: boolean;
  onClick: () => void;
}) {
  const muted = tone === "muted";
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.14, ease: "easeInOut" }}
      onClick={onClick}
      title={locked ? "Requires the approve verb" : undefined}
      className="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] data-[locked=true]:opacity-45"
      data-locked={locked ? "true" : "false"}
      style={
        muted
          ? {
              borderColor: "var(--border)",
              color: "color-mix(in oklab, var(--muted-foreground) 85%, transparent)",
            }
          : {
              borderColor: `color-mix(in oklab, var(--${tone}) 40%, transparent)`,
              background: `color-mix(in oklab, var(--${tone}) 12%, transparent)`,
              color: `var(--${tone})`,
              boxShadow: `0 0 24px -16px var(--${tone})`,
            }
      }
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.7} /> {label}
    </motion.button>
  );
}
