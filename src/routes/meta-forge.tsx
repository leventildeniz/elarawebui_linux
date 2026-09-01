import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Gem, RotateCcw, Undo2, XCircle } from "lucide-react";
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
  const { plans, approve, reject, rollback, reapply, reset, restore } = useForgePlans();
  const auth = useApprovalAuthority();

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
          <div className="ml-auto flex items-center gap-4 font-mono text-[11px] tracking-[0.12em] text-muted-foreground/60">
            <span className="text-topaz">{counts.pending} pending</span>
            <span className="text-emerald">{counts.applied} applied</span>
            <span className="text-ruby">{counts.rolled_back} rolled back</span>
            <button
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" strokeWidth={1.6} /> reset ledger
            </button>
          </div>
        </header>

        {confirmReset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-[min(420px,90vw)] rounded-[14px] border border-border bg-panel p-5 shadow-2xl">
              <h2 className="font-mono text-[12px] uppercase tracking-[0.2em] text-foreground/90">
                reset ledger
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                This clears every forge plan from the ledger. You can bring the original demo ledger
                back afterwards.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmReset(false)}
                  className="rounded-md border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
                >
                  cancel
                </button>
                <button
                  onClick={() => {
                    reset();
                    setConfirmReset(false);
                  }}
                  className="rounded-md border border-ruby/45 bg-ruby/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ruby transition-colors hover:bg-ruby/20"
                >
                  reset
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
          <AnimatePresence initial={false}>
            {list.map((p) => (
              <PlanRow
                key={p.id}
                plan={p}
                locked={!auth.canApprove}
                onApprove={() => guard("approve", p.id, () => approve(p.id))}
                onReject={() => guard("reject", p.id, () => reject(p.id))}
                onRollback={() => guard("roll back", p.id, () => rollback(p.id))}
                onReapply={() => guard("re-apply", p.id, () => reapply(p.id))}
              />
            ))}
          </AnimatePresence>
          {list.length === 0 && (
            <div className="px-5 py-10 text-center">
              <p className="font-mono text-[12px] text-muted-foreground/50">
                {plans.length === 0 ? "ledger is empty" : "no plans in this state"}
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
