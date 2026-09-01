import { Mail, MailX, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ApprovalAuthority } from "@/lib/approver-gate";
import { useNotifyPrefs } from "@/lib/notify-store";
import { cn } from "@/lib/utils";

/**
 * Shows who currently holds the `approve` verb on this gate, and why the
 * signed-in principal can (or cannot) act on it.
 */
export function ApproverBanner({
  auth,
  gate,
  notify,
}: {
  auth: ApprovalAuthority;
  gate: string;
  /** when set, renders the "page approvers by email" switch for that gate */
  notify?: "approval" | "forge";
}) {
  const roleNames = auth.approverRoles.map((r) => r.name);
  const groupNames = auth.approverGroups.map((g) => g.name);
  const ok = auth.canApprove;
  const { prefs, update } = useNotifyPrefs();
  const mailOn = notify ? (notify === "approval" ? prefs.approvals : prefs.forge) : false;

  return (
    <div
      className="mt-5 flex flex-wrap items-start gap-2.5 rounded-lg border px-3.5 py-3"
      style={{
        borderColor: `color-mix(in oklab, var(--${ok ? "emerald" : "ruby"}) 30%, transparent)`,
        background: `color-mix(in oklab, var(--${ok ? "emerald" : "ruby"}) 7%, transparent)`,
      }}
    >
      {ok ? (
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald" strokeWidth={1.7} />
      ) : (
        <ShieldAlert size={13} className="mt-0.5 shrink-0 text-ruby" strokeWidth={1.7} />
      )}

      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-mono text-[11.5px] leading-relaxed text-foreground/85">
          {auth.handle} · {auth.role?.name ?? "no role"} ·{" "}
          {ok
            ? auth.enforced
              ? `approve verb granted — you may clear this ${gate}`
              : `enforcement disarmed — every principal may clear this ${gate}`
            : `no approve verb — this ${gate} is read-only for you`}
        </p>
        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground/65">
          approvers · roles: {roleNames.length ? roleNames.join(", ") : "none"}
          {groupNames.length ? ` · groups: ${groupNames.join(", ")}` : ""}
          {auth.approverAccounts.length
            ? ` · principals: ${auth.approverAccounts.map((a) => a.username).join(", ")}`
            : ""}
        </p>
      </div>

      {notify && (
        <button
          type="button"
          onClick={() =>
            update(notify === "approval" ? { approvals: !mailOn } : { forge: !mailOn })
          }
          title={
            mailOn
              ? "approvers are paged by email — template lives in Settings › Mail & Time"
              : "enable to page approvers by email"
          }
          className={cn(
            "ml-auto flex shrink-0 items-center gap-2 self-center rounded-lg border px-2.5 py-[6px] font-mono text-[11px] transition-colors",
            mailOn
              ? "border-emerald/45 bg-emerald/[0.12] text-emerald"
              : "border-white/[0.09] bg-raised/40 text-muted-foreground/70 hover:text-foreground",
          )}
          style={mailOn ? { boxShadow: "0 0 16px -6px var(--emerald)" } : undefined}
        >
          {mailOn ? <Mail size={13} strokeWidth={1.7} /> : <MailX size={13} strokeWidth={1.7} />}
          {mailOn ? "notify approvers · on" : "notify approvers · off"}
        </button>
      )}
    </div>
  );
}
