import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Clock, Inbox, ShieldCheck, XCircle, Zap, Activity, Code, Cpu, RefreshCw, Check } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, Sheen, StatusDot, Tag } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { fetchApi } from "@/lib/api";
import {
  originLabel,
  riskTone,
  sinceLabel,
  statusTone,
  ttlLabel,
  useApprovals,
  useQueueSwitch,
  emitSwitch,
  type ApprovalRequest,
  type ApprovalStatus,
} from "@/lib/approval-store";
import { useApprovalAuthority } from "@/lib/approver-gate";
import { ApproverBanner } from "@/components/sovereign/approver-banner";
import { cn } from "@/lib/utils";

const description =
  "Human-in-the-loop gate. Any action a policy marks as sensitive waits here until an authorised reviewer signs it off.";

export const Route = createFileRoute("/approvals")({
  validateSearch: (search: Record<string, unknown>): { view: ApprovalStatus } => {
    const v = search["view"];
    return {
      view:
        v === "approved" || v === "rejected" || v === "expired" ? (v as ApprovalStatus) : "pending",
    };
  },
  head: () => ({
    meta: [
      { title: "Approval Queue — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Approval Queue — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ApprovalsPage,
});

/** Time labels depend on Date.now(); render them only after hydration. */
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

function ApprovalsPage() {
  const { view } = Route.useSearch();
  const mounted = useMounted();
  const { items, decide } = useApprovals();
  const auth = useApprovalAuthority();
  const queue = useQueueSwitch();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<"mine" | "all">("mine");

  const inView = useMemo(
    () => items.filter((r) => r.status === view).sort((a, b) => a.createdAt - b.createdAt),
    [items, view],
  );

  /** "mine" = tickets this principal is actually allowed to clear. */
  const list = useMemo(
    () => (scope === "all" ? inView : inView.filter((r) => auth.canDecide(r))),
    [inView, scope, auth],
  );

  const focus = list.find((r) => selected.includes(r.id)) ?? list[0];
  const marked = selected.filter((id) => list.some((r) => r.id === id));

  const toggle = (id: string, additive: boolean) =>
    setSelected((prev) =>
      additive ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id],
    );

  const act = async (status: ApprovalStatus) => {
    const ids = marked.length ? marked : focus ? [focus.id] : [];
    if (!ids.length) return;
    if (!auth.canApprove) {
      auth.denied(
        "approvals",
        `${auth.handle} tried to mark ${ids.length} request(s) ${status} without the approve verb`,
      );
      await confirmAction({
        title: "Approve verb required",
        body: `Your role (${auth.role?.name ?? "unknown"}) cannot decide approval requests. Grant the "Approve" verb in RBAC, or bind this principal to a role that already holds it.`,
        confirmLabel: "Understood",
        tone: "ruby",
      });
      return;
    }
    const foreign = ids.filter((id) => {
      const r = list.find((x) => x.id === id);
      return r ? !auth.canDecide(r) : false;
    });
    if (foreign.length) {
      const firstBlocked = list.find((x) => x.id === foreign[0]);
      const isOwn = firstBlocked && firstBlocked.requester.toLowerCase() === auth.handle.toLowerCase();
      const isHighRisk = firstBlocked && (firstBlocked.risk === "high" || firstBlocked.risk === "critical");

      let title = "Routed to another approver";
      let body = `${foreign.length} of the selected request${foreign.length > 1 ? "s are" : " is"} delegated to the approvers of the requester's group. Only they — or a sovereign role — can clear it.`;

      if (isOwn && isHighRisk) {
        title = "Mandatory Four-Eyes Approval";
        body = `High and Critical risk operations (${firstBlocked?.tool || "action"}) require mandatory Four-Eyes approval. You cannot self-approve production scope commands.`;
      } else if (isOwn) {
        title = "Self-Approval Disabled";
        body = `Self-approval is disabled for your department group. An assigned group approver or administrator must sign off.`;
      }

      auth.denied(
        "approvals",
        `${auth.handle} tried to decide ${foreign.length} ticket(s) without required authority: ${title}`,
      );
      await confirmAction({
        title,
        body,
        confirmLabel: "Understood",
        tone: "ruby",
      });
      return;
    }
    const own = ids.filter((id) => {
      const r = list.find((x) => x.id === id);
      return r && r.requester.toLowerCase() === auth.handle.toLowerCase();
    });
    if (status === "approved" && own.length && !queue.selfApproval && !auth.sovereign) {
      auth.denied("approvals", `${auth.handle} tried to self-approve ${own.length} own request(s)`);
      await confirmAction({
        title: "Self-approval is off",
        body: `${own.length} of the selected request${own.length > 1 ? "s were" : " was"} raised by you. Four-eyes is enforced: someone else holding the Approve verb has to clear it. Turn on "allow self-approval" above if a single operator runs this studio.`,
        confirmLabel: "Understood",
        tone: "ruby",
      });
      return;
    }
    const ok = await confirmAction({
      title: status === "approved" ? "Approve these requests?" : "Reject these requests?",
      body:
        `${ids.length} request${ids.length > 1 ? "s" : ""} will be marked ${status}.` +
        (status === "approved" ? " The gated action executes immediately." : ""),
      confirmLabel: status === "approved" ? "Approve" : "Reject",
      tone: status === "approved" ? "emerald" : "ruby",
    });
    if (!ok) return;
    decide(ids, status, note.trim(), auth.handle);
    setNote("");
    setSelected([]);
  };

  const pending = items.filter((r) => r.status === "pending");

  return (
    <Surface
      title="Approval Queue"
      meta={`${pending.length} awaiting review · oldest ${
        mounted && pending.length ? sinceLabel(Math.min(...pending.map((r) => r.createdAt))) : "—"
      }`}
      crumb="Approval Queue"
      full
    >
      <p className="max-w-[70ch] text-[14.5px] leading-relaxed text-muted-foreground">
        {description}
      </p>

      <QueueMasterSwitch queue={queue} onTriggerScan={emitSwitch} />

      <ApproverBanner auth={auth} gate="queue" notify="approval" />

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        {/* queue */}
        <div className="rounded-xl border border-border/80 bg-raised/15">
          <div className="flex items-center justify-between gap-3 px-5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="mono-label">
                {view} · {list.length}
              </span>
              <div className="flex items-center gap-1 rounded-md border border-border/60 p-0.5">
                {(["mine", "all"] as const).map((s2) => (
                  <button
                    key={s2}
                    onClick={() => setScope(s2)}
                    className={cn(
                      "rounded px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] transition-colors",
                      scope === s2
                        ? "bg-sapphire/15 text-sapphire"
                        : "text-muted-foreground/60 hover:text-foreground",
                    )}
                  >
                    {s2 === "mine" ? "my desk" : "all"}
                  </button>
                ))}
              </div>
            </div>
            {view === "pending" && list.length > 0 && (
              <button
                onClick={() =>
                  setSelected(marked.length === list.length ? [] : list.map((r) => r.id))
                }
                className="font-mono text-[11.5px] uppercase tracking-[0.16em] text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                {marked.length === list.length ? "clear" : "select all"}
              </button>
            )}
          </div>
          <Sheen />

          {list.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground/70">
              <Inbox size={22} strokeWidth={1.4} className="text-sapphire/70" />
              <span className="font-mono text-[12.5px]">queue clear · nothing {view}</span>
            </div>
          ) : (
            <div className="p-2">
              {list.map((r) => {
                const on = marked.includes(r.id);
                const isFocus = focus?.id === r.id;
                return (
                  <motion.button
                    key={r.id}
                    whileHover={{ x: 2 }}
                    transition={{ duration: 0.14 }}
                    onClick={(e) => toggle(r.id, e.metaKey || e.ctrlKey || e.shiftKey)}
                    className={cn(
                      "mb-1.5 flex w-full items-center gap-4 rounded-lg border px-4 py-3.5 text-left transition-colors",
                      isFocus || on
                        ? "border-sapphire/40 bg-raised/60"
                        : "border-transparent hover:border-white/[0.08] hover:bg-raised/35",
                    )}
                  >
                    <StatusDot tone={riskTone[r.risk]} pulse={r.status === "pending"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-[12px] text-muted-foreground/70">
                          {r.id}
                        </span>
                        <span className="truncate text-[14px] text-foreground/95">{r.title}</span>
                      </div>
                      <div className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground/60">
                        {r.requester}
                        {r.requesterGroup ? ` · ${r.requesterGroup}` : ""} · {r.tool}
                        {" · "}
                        {r.assignedTo && r.assignedTo.length
                          ? `→ ${r.assignedTo.join(", ")}`
                          : "→ shared pool"}
                        {r.origin && r.origin !== "seed" ? ` · ${originLabel[r.origin]}` : ""}
                      </div>
                    </div>
                    <Tag tone={riskTone[r.risk]}>{r.risk}</Tag>
                    <span className="w-[86px] shrink-0 text-right font-mono text-[11.5px] text-muted-foreground/60">
                      {!mounted
                        ? "—"
                        : r.status === "pending"
                          ? ttlLabel(r)
                          : sinceLabel(r.createdAt)}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        {/* detail */}
        {focus ? (
          <DetailPanel
            request={focus}
            mounted={mounted}
            count={marked.length}
            note={note}
            setNote={setNote}
            canApprove={auth.canApprove && auth.canDecide(focus)}
            onApprove={() => act("approved")}
            onReject={() => act("rejected")}
          />
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-24 font-mono text-[12.5px] text-muted-foreground/60">
            select a request
          </div>
        )}
      </div>
    </Surface>
  );
}

function QueueMasterSwitch({ queue, onTriggerScan }: { queue: ReturnType<typeof useQueueSwitch>; onTriggerScan?: () => void }) {
  const { enabled, selfApproval, ready, setEnabled, setSelfApproval } = queue;
  const [scanning, setScanning] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    try {
      await fetchApi("/api/self-healing/scan", { method: "POST" });
      onTriggerScan?.();
    } catch (e) {
      console.error("Health scan error:", e);
    } finally {
      setScanning(false);
    }
  };

  const handleSimulate = async () => {
    setScanning(true);
    try {
      await fetchApi("/api/self-healing/simulate", { method: "POST", body: JSON.stringify({ toolId: "tool.whois_geo", errorCount: 4, totalRuns: 5, avgDurationMs: 5200 }) });
      onTriggerScan?.();
    } catch (e) {
      console.error("Simulation error:", e);
    } finally {
      setScanning(false);
    }
  };

  const toggle = async () => {
    if (!enabled) {
      const ok = await confirmAction({
        title: "Enable the approval queue?",
        body: "Gated skills, adapters, targets, destructive data ops, credential/MCP trust actions and policy CHALLENGE verdicts will stop and wait here for a reviewer. Runtime executions only — permanent system changes stay in Meta-Forge. Keep it off if nobody is on review duty.",
        confirmLabel: "Enable",
        tone: "sapphire",
      });
      if (!ok) return;
      setEnabled(true);
      return;
    }
    const ok = await confirmAction({
      title: "Disable the approval queue?",
      body: "Existing rows stay on record, but no new action is parked — every gated execution runs immediately and is only logged to the audit spine.",
      confirmLabel: "Disable",
      tone: "ruby",
    });
    if (ok) setEnabled(false);
  };

  return (
    <div
      className={cn(
        "mt-6 flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4 transition-colors",
        enabled
          ? "border-emerald/35 bg-emerald/[0.06] shadow-[0_0_50px_-30px_var(--emerald)]"
          : "border-border/50 bg-panel/40",
      )}
    >
      <StatusDot tone={enabled ? "emerald" : "ruby"} />
      <div className="min-w-0">
        <div className="font-mono text-[12px] tracking-[0.14em] text-foreground/85">
          {enabled ? "QUEUE ARMED" : "QUEUE DISABLED"}
        </div>
        <p className="mt-1 max-w-[68ch] text-[12.5px] leading-relaxed text-muted-foreground/70">
          {enabled
            ? "Gated runtime actions park here instead of executing. Creating a skill or adapter never lands in the queue — only running a capability that is flagged gated does."
            : "Master switch is off — gated actions run straight through and are only logged. Turn it on when a reviewer is on duty."}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2.5">
        <button
          type="button"
          disabled={scanning}
          onClick={handleSimulate}
          className="rounded-lg border border-topaz/30 bg-topaz/[0.06] px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-topaz transition-colors hover:bg-topaz/12"
          title="Simulate a tool latency & error spike to test the Self-Healing engine"
        >
          <Activity size={12} className="inline mr-1 -mt-0.5" /> Sim Anomaly
        </button>
        <button
          type="button"
          disabled={scanning}
          onClick={handleScan}
          className="rounded-lg border border-sapphire/35 bg-sapphire/[0.08] px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-sapphire transition-colors hover:bg-sapphire/15"
          title="Trigger on-demand tool health watchdog scan"
        >
          <Zap size={12} className={cn("inline mr-1 -mt-0.5", scanning && "animate-spin")} /> {scanning ? "Scanning…" : "Watchdog Scan"}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => setSelfApproval(!selfApproval)}
          className={cn(
            "rounded-lg border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
            selfApproval
              ? "border-topaz/40 bg-topaz/[0.08] text-topaz"
              : "border-border/60 text-muted-foreground/70 hover:text-foreground",
          )}
          title="When off, a request cannot be cleared by the principal who raised it (four-eyes)."
        >
          self-approval {selfApproval ? "on" : "off"}
        </button>
        <JewelButton
          size="sm"
          variant={enabled ? "outline" : "primary"}
          disabled={!ready}
          onClick={() => void toggle()}
        >
          {enabled ? "Disable" : "Enable"}
        </JewelButton>
      </div>
    </div>
  );
}

function DetailPanel({
  request,
  mounted,
  count,
  note,
  setNote,
  canApprove,
  onApprove,
  onReject,
}: {
  request: ApprovalRequest;
  mounted: boolean;
  count: number;
  note: string;
  setNote: (v: string) => void;
  canApprove: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [codeTab, setCodeTab] = useState<"v2" | "original">("v2");

  const healData = useMemo(() => {
    if (request.origin !== "self_healing") return null;
    try {
      return JSON.parse(request.args);
    } catch {
      return null;
    }
  }, [request.origin, request.args]);

  return (
    <motion.aside
      key={request.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="h-fit overflow-hidden rounded-xl border border-sapphire/25 bg-raised/25 backdrop-blur-xl"
    >
      <header className="flex items-center gap-2 px-5 pt-5">
        {request.origin === "self_healing" ? (
          <Zap size={14} className="text-emerald" strokeWidth={2} />
        ) : (
          <ShieldCheck size={14} className="text-sapphire" strokeWidth={1.7} />
        )}
        <span className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-muted-foreground/65">
          {request.origin === "self_healing" ? "self-healing loop" : "gate"} · {request.id}
        </span>
        <span className="ml-auto">
          <Tag tone={statusTone[request.status]}>{request.status}</Tag>
        </span>
      </header>

      <div className="px-5 pb-5 pt-3.5">
        <h2 className="text-[17px] font-medium leading-snug text-foreground">{request.title}</h2>

        {healData && (
          <div className="mt-3.5 grid grid-cols-3 gap-2.5">
            <div className="rounded-lg border border-ruby/30 bg-ruby/[0.06] p-2.5 text-center">
              <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">Fail Rate</span>
              <span className="font-mono text-[15px] font-semibold text-ruby">{Math.round((healData.metrics?.failRate || 0) * 100)}%</span>
            </div>
            <div className="rounded-lg border border-topaz/30 bg-topaz/[0.06] p-2.5 text-center">
              <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">Avg Latency</span>
              <span className="font-mono text-[15px] font-semibold text-topaz">{healData.metrics?.avgDurationMs || 0}ms</span>
            </div>
            <div className="rounded-lg border border-sapphire/30 bg-sapphire/[0.06] p-2.5 text-center">
              <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">Invocations</span>
              <span className="font-mono text-[15px] font-semibold text-sapphire">{healData.metrics?.totalRuns || 0}</span>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-x-6 gap-y-2 font-mono text-[11.5px] sm:grid-cols-2">
          {[
            ["requester", request.requester],
            ["group", request.requesterGroup || "—"],
            [
              "routed to",
              request.assignedTo && request.assignedTo.length
                ? request.assignedTo.join(", ")
                : "shared pool",
            ],
            ["agent", request.agent],
            ["tool", request.tool],
            ["target", request.target],
            ["raised", mounted ? sinceLabel(request.createdAt) : "—"],
            [
              "window",
              request.status === "pending" ? (mounted ? ttlLabel(request) : "—") : "closed",
            ],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="uppercase tracking-[0.16em] text-muted-foreground/55">{k}</span>
              <span className="truncate text-foreground/90">{v}</span>
            </div>
          ))}
        </div>

        {healData ? (
          <div className="mt-4 space-y-3">
            {/* Root Cause & Optimizations */}
            <div className="rounded-lg border border-emerald/30 bg-emerald/[0.05] p-3.5">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-emerald">
                <ShieldCheck size={13} />
                <span>Root Cause & Self-Healing Synthesis</span>
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/90">
                {healData.rootCause}
              </p>
              {Array.isArray(healData.optimizations) && healData.optimizations.length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {healData.optimizations.map((opt: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 font-mono text-[11px] text-muted-foreground/80">
                      <Check size={12} className="mt-0.5 shrink-0 text-emerald" />
                      <span>{opt}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Code Inspection Tabs */}
            <div className="mt-3">
              <div className="flex items-center justify-between pb-1.5">
                <span className="mono-label">code inspection</span>
                <div className="flex items-center gap-1 rounded-md border border-border/60 p-0.5">
                  <button
                    type="button"
                    onClick={() => setCodeTab("v2")}
                    className={cn(
                      "rounded px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors",
                      codeTab === "v2" ? "bg-emerald/15 text-emerald" : "text-muted-foreground/60 hover:text-foreground"
                    )}
                  >
                    Refactored v2
                  </button>
                  <button
                    type="button"
                    onClick={() => setCodeTab("original")}
                    className={cn(
                      "rounded px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors",
                      codeTab === "original" ? "bg-sapphire/15 text-sapphire" : "text-muted-foreground/60 hover:text-foreground"
                    )}
                  >
                    Original Code
                  </button>
                </div>
              </div>
              <pre className="max-h-[260px] overflow-auto rounded-lg border border-border/70 bg-canvas/70 p-3.5 font-mono text-[11.5px] leading-relaxed text-foreground/90">
                {codeTab === "v2" ? healData.refactoredCode : (healData.originalCode || "# No previous code on disk")}
              </pre>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-topaz/25 bg-topaz/[0.06] px-3.5 py-3">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-topaz" strokeWidth={1.7} />
              <p className="text-[13px] leading-relaxed text-muted-foreground">{request.policy}</p>
            </div>

            <div className="mt-5">
              <span className="mono-label">arguments</span>
              <pre className="mt-2 max-h-[220px] overflow-auto rounded-lg border border-border/70 bg-canvas/60 p-3.5 font-mono text-[12px] leading-relaxed text-foreground/85">
                {request.args}
              </pre>
            </div>
          </>
        )}

        {request.status === "pending" ? (
          <>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Decision note (recorded in the audit journal)…"
              rows={2}
              className="mt-5 w-full resize-none rounded-lg border border-border/70 bg-canvas/50 px-3.5 py-2.5 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-sapphire/45"
            />
            <div className="mt-4 flex items-center justify-end gap-2.5">
              <span className="mr-auto font-mono text-[11px] text-muted-foreground/55">
                {count > 1 ? `${count} selected` : "1 request"}
              </span>
              <JewelButton
                variant="danger"
                size="sm"
                onClick={onReject}
                disabled={!canApprove}
                title={canApprove ? undefined : "Requires the approve verb"}
              >
                <XCircle size={13} strokeWidth={1.8} /> Reject
              </JewelButton>
              <JewelButton
                size="sm"
                onClick={onApprove}
                disabled={!canApprove}
                title={canApprove ? undefined : "Requires the approve verb"}
                className="border-emerald/40 bg-emerald/12 text-emerald hover:bg-emerald/20 hover:shadow-[0_0_28px_-8px_var(--emerald)]"
              >
                <CheckCircle2 size={13} strokeWidth={1.8} /> {request.origin === "self_healing" ? "Approve & Promote v2" : "Approve"}
              </JewelButton>
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-lg border border-border/70 bg-canvas/40 px-3.5 py-3">
            <div className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground/70">
              <Clock size={12} strokeWidth={1.7} />
              {request.decidedBy
                ? `${request.status} by ${request.decidedBy}${mounted ? ` · ${sinceLabel(request.decidedAt ?? request.createdAt)}` : ""}`
                : "expired without a decision"}
            </div>
            {request.note && (
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {request.note}
              </p>
            )}
          </div>
        )}
      </div>
    </motion.aside>
  );
}
