// Meta-Forge tab — Elara's self-authoring plans (agent/tool/skill/pack).
// Phase-1a: inventory view + plans list + approve/reject/rollback.
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell, PageHeader } from "@/components/page-shell";
import { useRbac } from "@/lib/rbac";
import { Sparkles, CheckCircle2, XCircle, Undo2, RefreshCw, Library } from "lucide-react";
import { actorHeaders } from "@/lib/api-client";

export const Route = createFileRoute("/_app/meta-forge")({ component: MetaForgePage });

type Plan = {
  id: string;
  requested_by: string;
  intent: string;
  plan_json: { reuse?: Array<{ kind: string; slug: string; why?: string }>;
               create?: Array<{ kind: string; slug: string; name?: string; description?: string;
                                body?: string; tools?: string[]; skills?: string[] }> };
  status: "pending" | "approved" | "rejected" | "applied" | "failed";
  applied_at: string | null;
  error: string | null;
  created_at: string;
};

type Inventory = {
  counts: Record<string, number>;
  agents: Array<{ slug: string; name: string; description: string }>;
  tools: Array<{ slug: string; name: string; description: string }>;
  skills: Array<{ slug: string; name: string; description: string }>;
  packs: Array<{ slug: string; name: string; description: string }>;
  mcp_exposed: Array<{ kind: string; slug: string }>;
};

function MetaForgePage() {
  const { isAdmin } = useRbac();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    const [pr, ir] = await Promise.allSettled([
      fetch("/api/meta-forge/plans?limit=50", { headers: actorHeaders() }).then(r => r.json()),
      fetch("/api/meta-forge/inventory", { headers: actorHeaders() }).then(r => r.json()),
    ]);
    if (pr.status === "fulfilled") setPlans(pr.value?.plans || []);
    else setMsg(`plans: ${String(pr.reason)}`);
    if (ir.status === "fulfilled") setInv(ir.value?.inventory || null);
    else setMsg(m => (m ? m + " · " : "") + `inventory: ${String(ir.reason)}`);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (id: string, kind: "apply" | "reject" | "rollback") => {
    setMsg(null);
    try {
      const r = await fetch(`/api/meta-forge/plans/${id}/${kind}`, { method: "POST",
        headers: { "content-type": "application/json", ...actorHeaders() },
        body: JSON.stringify(kind === "reject" ? { reason: "rejected via UI" } : {}) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setMsg(`${kind} · ${j.status || "ok"}${j.failed?.length ? ` · ${j.failed.length} failed` : ""}`);
      await load();
    } catch (e) { setMsg(`${kind} failed: ${String(e)}`); }
  }, [load]);

  if (!isAdmin) {
    return (
      <PageShell>
        <PageHeader title="Meta-Forge" subtitle="Admin only — AI model self-authoring" />
        <p className="text-xs font-mono text-muted-foreground">
          You don't have permission to view this page.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Meta-Forge"
        subtitle="The AI model proposes new agents / tools / skills / packs — you approve, apply, or rollback."
        actions={
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Admin
            </span>
            <button onClick={load} disabled={loading}
              className="inline-flex items-center gap-1.5 rounded border border-border/60 px-2.5 py-1 text-[10px] font-mono uppercase hover:bg-muted/40">
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Reload
            </button>
          </div>
        }
      />

      {msg && (
        <div className="mb-4 rounded border border-border/60 bg-muted/30 px-3 py-2 text-xs font-mono">
          {msg}
        </div>
      )}

      {/* Inventory summary */}
      <section className="mb-6 rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Library className="h-4 w-4 text-primary" />
          <h2 className="text-xs font-mono uppercase tracking-wider">Current Inventory</h2>
        </div>
        {inv ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <InvCount label="Agents" n={inv.counts.agents ?? 0} />
            <InvCount label="Tools"  n={inv.counts.tools ?? 0} />
            <InvCount label="Skills" n={inv.counts.skills ?? 0} />
            <InvCount label="Packs"  n={inv.counts.packs ?? 0} />
          </div>
        ) : <p className="text-xs font-mono text-muted-foreground">loading…</p>}
        {inv?.mcp_exposed?.length ? (
          <p className="mt-3 text-[10px] font-mono text-muted-foreground">
            🌐 {inv.mcp_exposed.length} entity exposed via MCP.
          </p>
        ) : null}
      </section>

      {/* Plans */}
      <section className="rounded-lg border border-border/60 bg-card/40">
        <div className="border-b border-border/40 px-4 py-3">
          <h2 className="text-xs font-mono uppercase tracking-wider">Forge Plans</h2>
          <p className="mt-1 text-[10px] font-mono text-muted-foreground">
            Phase 1a: skill + pack channels are live. Tool + agent writers arrive in phase 1b.
          </p>
        </div>
        {plans.length === 0 ? (
          <div className="p-6 text-xs font-mono text-muted-foreground">
            No plans yet. The AI model will drop proposals here when it detects a missing capability.
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {plans.map(p => <PlanRow key={p.id} plan={p} onAct={act} />)}
          </ul>
        )}
      </section>
    </PageShell>
  );
}

function InvCount({ label, n }: { label: string; n: number }) {
  return (
    <div className="rounded border border-border/40 bg-background/40 px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-mono">{n}</div>
    </div>
  );
}

function PlanRow({ plan, onAct }: { plan: Plan; onAct: (id: string, k: "apply" | "reject" | "rollback") => void }) {
  const [open, setOpen] = useState(false);
  const reuse = plan.plan_json?.reuse ?? [];
  const create = plan.plan_json?.create ?? [];
  const badge = useMemo(() => {
    const cls: Record<Plan["status"], string> = {
      pending:  "bg-amber-500/15 text-amber-500 border-amber-500/30",
      approved: "bg-sky-500/15 text-sky-500 border-sky-500/30",
      applied:  "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
      rejected: "bg-muted text-muted-foreground border-border/50",
      failed:   "bg-red-500/15 text-red-500 border-red-500/30",
    };
    return cls[plan.status];
  }, [plan.status]);

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => setOpen(!open)} className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className={`rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase ${badge}`}>{plan.status}</span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {new Date(plan.created_at).toLocaleString()} · {plan.requested_by}
            </span>
          </div>
          <p className="mt-1 text-xs">{plan.intent}</p>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-mono">
            {reuse.map((r, i) => (
              <span key={`r${i}`} className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-sky-500">
                reuse {r.kind}:{r.slug}
              </span>
            ))}
            {create.map((c, i) => (
              <span key={`c${i}`} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-500">
                + {c.kind}:{c.slug}
              </span>
            ))}
          </div>
          {plan.error && (
            <p className="mt-1 text-[10px] font-mono text-red-400">{plan.error}</p>
          )}
        </button>
        <div className="flex flex-col gap-1">
          {(plan.status === "pending" || plan.status === "approved" || plan.status === "failed") && (
            <>
              <button onClick={() => onAct(plan.id, "apply")}
                className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono uppercase text-emerald-500 hover:bg-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> {plan.status === "failed" ? "Retry" : "Approve"}
              </button>
              <button onClick={() => onAct(plan.id, "reject")}
                className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] font-mono uppercase text-muted-foreground hover:bg-muted/40">
                <XCircle className="h-3 w-3" /> Reject
              </button>
            </>
          )}
          {plan.status === "applied" && (
            <button onClick={() => onAct(plan.id, "rollback")}
              className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-mono uppercase text-red-500 hover:bg-red-500/20">
              <Undo2 className="h-3 w-3" /> Rollback
            </button>
          )}
        </div>
      </div>
      {open && (
        <pre className="mt-3 overflow-x-auto rounded border border-border/40 bg-background/40 p-3 text-[10px] font-mono">
{JSON.stringify(plan.plan_json, null, 2)}
        </pre>
      )}
    </li>
  );
}
