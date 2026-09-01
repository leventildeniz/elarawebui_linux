import { AnimatePresence, motion } from "motion/react";
import { Gem } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MetaForgeApprovalCardProps = {
  /** Short jewel-tone label shown next to the MetaForge mark. */
  id?: string;
  title: string;
  description: ReactNode;
  /** Optional mono facts rendered under the description. */
  facts?: { label: string; value: string }[];
  approveLabel?: string;
  rejectLabel?: string;
  /** Controlled visibility. Leave undefined for self-managed open/closed state. */
  open?: boolean;
  defaultOpen?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  className?: string;
  status?: "pending" | "applied" | "rejected" | "failed" | "rolled_back";
};

/**
 * MetaForge Approval Card — a high-tech module that settles inside the
 * conversation when the system proposes a new capability or tool.
 * Glassmorphic anthracite body, 1px sapphire hairline, jewel accents.
 */
export function MetaForgeApprovalCard({
  id = "mf.proposal",
  title,
  description,
  facts,
  approveLabel = "APPROVE",
  rejectLabel = "REJECT",
  open,
  defaultOpen = true,
  onApprove,
  onReject,
  className,
  status = "pending",
}: MetaForgeApprovalCardProps) {
  const [selfOpen, setSelfOpen] = useState(defaultOpen);
  const isOpen = open ?? selfOpen;

  const close = () => {
    if (open === undefined) setSelfOpen(false);
  };

  const isResolved = status !== "pending";

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.article
          initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            "relative overflow-hidden rounded-[14px] p-5",
            "border border-[color-mix(in_oklab,var(--sapphire)_34%,transparent)]",
            "bg-[color-mix(in_oklab,var(--raised)_62%,transparent)] backdrop-blur-xl",
            "shadow-[0_18px_40px_-30px_oklch(0_0_0/0.9)] transition-shadow duration-200",
            "hover:shadow-[0_0_44px_-22px_var(--sapphire),0_18px_40px_-30px_oklch(0_0_0/0.9)]",
            className,
          )}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(to right, transparent, color-mix(in oklab, var(--sapphire) 75%, transparent), transparent)",
            }}
          />

          <header className="flex items-center gap-2">
            <motion.span
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.16, ease: "easeInOut" }}
              className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-sapphire/12"
            >
              <Gem className="h-3.5 w-3.5 text-sapphire" strokeWidth={1.6} />
            </motion.span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-muted-foreground/65">
              metaforge · {id}
            </span>
          </header>

          <h3 className="mt-3.5 text-[16.5px] font-medium leading-snug tracking-[-0.01em] text-foreground">
            {title}
          </h3>
          <div className="mt-2.5 max-w-[64ch] text-[14.5px] leading-[1.7] text-muted-foreground">
            {description}
          </div>

          {facts && facts.length > 0 && (
            <dl className="mt-4 grid gap-x-8 gap-y-2 font-mono text-[11.5px] sm:grid-cols-2">
              {facts.map((f) => (
                <div key={f.label} className="flex items-center justify-between gap-4">
                  <dt className="uppercase tracking-[0.16em] text-muted-foreground/55">
                    {f.label}
                  </dt>
                  <dd className="text-foreground/90">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <footer className="mt-6 flex items-center justify-end gap-2.5">
            {isResolved ? (
              <div className={cn(
                "h-9 flex items-center justify-center rounded-lg px-5 font-mono text-[11.5px] uppercase tracking-[0.18em]",
                status === "applied" ? "border border-emerald/20 text-emerald bg-emerald/5" :
                status === "rejected" ? "border border-ruby/20 text-ruby bg-ruby/5" :
                "border border-white/10 text-muted-foreground bg-raised/30"
              )}>
                {status}
              </div>
            ) : (
              <>
                <button
                  onClick={() => {
                    onReject?.();
                    close();
                  }}
                  className="h-9 rounded-lg px-4 font-mono text-[11.5px] uppercase tracking-[0.18em] text-muted-foreground/70 transition-colors hover:bg-raised/70 hover:text-foreground"
                >
                  {rejectLabel}
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.16, ease: "easeInOut" }}
                  onClick={() => {
                    onApprove?.();
                    close();
                  }}
                  className="h-9 rounded-lg border border-[color-mix(in_oklab,var(--emerald)_38%,transparent)] bg-[color-mix(in_oklab,var(--emerald)_12%,transparent)] px-5 font-mono text-[11.5px] uppercase tracking-[0.18em] text-emerald shadow-[0_0_26px_-12px_var(--emerald)] transition-shadow hover:shadow-[0_0_34px_-8px_var(--emerald)]"
                >
                  {approveLabel}
                </motion.button>
              </>
            )}
          </footer>
        </motion.article>
      )}
    </AnimatePresence>
  );
}
