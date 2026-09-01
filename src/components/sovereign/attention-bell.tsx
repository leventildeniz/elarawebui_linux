import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Gem, Mail, MailWarning, ShieldCheck } from "lucide-react";
import { sinceLabel, usePendingApprovals, useQueueSwitch } from "@/lib/approval-store";
import { useApprovalAuthority } from "@/lib/approver-gate";
import { useForgePlans } from "@/lib/metaforge-store";
import { useOutbox } from "@/lib/notify-store";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  to: string;
  label: string;
  meta: string;
  tone: "topaz" | "sapphire";
  mine: boolean;
};

/**
 * Global attention beacon.
 *
 * Surfaces anything waiting on a human verdict — queue tickets routed to the
 * signed-in principal first, then Meta-Forge plans — so no operator has to
 * open a gate page just to discover there is work.
 */
export function AttentionBell() {
  const [open, setOpen] = useState(false);
  const queue = useQueueSwitch();
  const pending = usePendingApprovals();
  const auth = useApprovalAuthority();
  const { plans } = useForgePlans();
  const outbox = useOutbox();

  const items = useMemo<Item[]>(() => {
    const approvals: Item[] = (queue.enabled ? pending : []).map((r) => ({
      id: r.id,
      to: "/approvals",
      label: r.title,
      meta: `${r.requester}${r.requesterGroup ? ` · ${r.requesterGroup}` : ""} · ${sinceLabel(r.createdAt)}`,
      tone: "topaz",
      mine: auth.canDecide(r),
    }));
    const forge: Item[] = plans
      .filter((p) => p.status === "pending")
      .map((p) => ({
        id: p.id,
        to: "/meta-forge",
        label: p.prompt,
        meta: `${p.actor} · forge plan · ${p.actions.length} action${p.actions.length === 1 ? "" : "s"}`,
        tone: "sapphire",
        mine: auth.canApprove,
      }));
    return [...approvals, ...forge].sort((a, b) => Number(b.mine) - Number(a.mine));
  }, [queue.enabled, pending, plans, auth]);

  const mine = items.filter((i) => i.mine).length;
  const total = items.length;
  const failedMail = outbox.filter((n) => n.state === "blocked").length;
  const hot = mine > 0;

  return (
    <div className="relative">
      <button
        aria-label="Action required"
        title={
          total
            ? `${total} item${total === 1 ? "" : "s"} awaiting a verdict`
            : "Nothing awaiting a verdict"
        }
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex h-7 w-7 items-center justify-center rounded-md transition-colors",
          total
            ? hot
              ? "text-topaz hover:bg-topaz/10"
              : "text-sapphire/80 hover:bg-sapphire/10"
            : "text-muted-foreground/50 hover:bg-raised/60 hover:text-foreground",
        )}
        style={hot ? { textShadow: "0 0 14px var(--topaz)" } : undefined}
      >
        <AlertTriangle className="h-[17px] w-[17px]" strokeWidth={1.6} />
        {total > 0 && (
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-[3px] font-mono text-[9.5px] font-bold leading-none text-canvas",
              hot ? "bg-topaz" : "bg-sapphire",
            )}
            style={{ boxShadow: `0 0 10px -1px var(--${hot ? "topaz" : "sapphire"})` }}
          >
            {total}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="absolute right-0 top-9 z-50 w-[360px] overflow-hidden rounded-[12px] border border-white/[0.08] bg-panel/95 backdrop-blur-xl shadow-[0_24px_60px_-30px_oklch(0_0_0/0.9)]"
            >
              <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-2.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70">
                  action required
                </span>
                <span className="font-mono text-[11px] text-topaz">{mine} on your desk</span>
              </div>

              <div className="max-h-[340px] overflow-y-auto">
                {items.length === 0 ? (
                  <div className="flex items-center gap-2 px-3.5 py-6 text-[12.5px] text-muted-foreground/65">
                    <ShieldCheck className="h-4 w-4 text-emerald" strokeWidth={1.6} />
                    every gate is clear
                  </div>
                ) : (
                  items.map((i) => (
                    <Link
                      key={`${i.to}-${i.id}`}
                      to={i.to}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2.5 border-b border-white/[0.04] px-3.5 py-2.5 transition-colors last:border-0 hover:bg-raised/50"
                    >
                      {i.tone === "topaz" ? (
                        <AlertTriangle
                          className="mt-[3px] h-[13px] w-[13px] shrink-0 text-topaz"
                          strokeWidth={1.7}
                        />
                      ) : (
                        <Gem
                          className="mt-[3px] h-[13px] w-[13px] shrink-0 text-sapphire"
                          strokeWidth={1.7}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground/90">
                          {i.label}
                        </span>
                        <span className="block truncate font-mono text-[10.5px] text-muted-foreground/60">
                          {i.meta}
                        </span>
                      </span>
                      {i.mine && (
                        <span className="mt-[2px] shrink-0 rounded-full border border-topaz/40 bg-topaz/[0.12] px-1.5 py-[1px] font-mono text-[9.5px] leading-none text-topaz">
                          you
                        </span>
                      )}
                    </Link>
                  ))
                )}
              </div>

              <Link
                to="/mail"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 border-t border-white/[0.06] px-3.5 py-2.5 font-mono text-[10.5px] text-muted-foreground/65 transition-colors hover:text-foreground"
              >
                {failedMail ? (
                  <MailWarning className="h-[13px] w-[13px] text-ruby" strokeWidth={1.7} />
                ) : (
                  <Mail className="h-[13px] w-[13px] text-sapphire/80" strokeWidth={1.7} />
                )}
                {failedMail
                  ? `${failedMail} notice${failedMail === 1 ? "" : "s"} could not leave the relay`
                  : "approver notice template"}
              </Link>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
