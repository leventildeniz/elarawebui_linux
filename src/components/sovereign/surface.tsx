import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Shell } from "./shell";

/**
 * Shared studio surface: quiet header, generous whitespace, scrollable body.
 * Used by every non-chat route so the workspaces feel like one OS.
 */
export function Surface({
  title,
  meta,
  action,
  children,
  wide,
  full,
  crumb,
}: {
  title?: string;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  full?: boolean;
  crumb?: string;
}) {
  return (
    <Shell crumb={crumb ?? title}>
      <div className="relative h-full overflow-y-auto">
        <div className="pointer-events-none absolute left-1/2 top-[-14%] h-[320px] w-[680px] -translate-x-1/2 rounded-full bg-sapphire/5 blur-[160px]" />
        <div
          className={cn(
            "relative mx-auto w-full px-6 pb-24 pt-20 sm:px-10",
            full ? "max-w-[1760px]" : wide ? "max-w-[1180px]" : "max-w-[900px]",
          )}
        >
          {(title || meta || action) && (
            <motion.header
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-wrap items-end justify-between gap-4"
            >
              <div>
                {title && (
                  <h1 className="text-[28px] font-medium leading-tight tracking-tight text-foreground">
                    {title}
                  </h1>
                )}
                {meta && (
                  <p className="mt-2 font-mono text-[11.5px] tracking-[0.1em] text-muted-foreground/60">
                    {meta}
                  </p>
                )}
              </div>
              {action}
            </motion.header>
          )}

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className={cn(title || meta || action ? "mt-12" : "mt-6")}
          >
            {children}
          </motion.div>
        </div>
      </div>
    </Shell>
  );
}

export function Row({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group grid items-center gap-4 border-t border-border/70 py-5 transition-colors first:border-t-0 hover:bg-raised/25",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Meter({ value, tone = "sapphire" }: { value: number; tone?: string }) {
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-raised">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.44, ease: [0.22, 1, 0.36, 1] }}
        className="h-full rounded-full"
        style={{ background: `var(--${tone})`, boxShadow: `0 0 12px -2px var(--${tone})` }}
      />
    </div>
  );
}
