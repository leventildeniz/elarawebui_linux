import { motion } from "motion/react";
import { RefreshCw, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Jewel = "sapphire" | "emerald" | "amethyst" | "topaz" | "ruby";

/** Shared jewel-precision card shell: 1px sapphire hairline + glass body. */
function CardShell({
  children,
  className,
  index = 0,
  tone = "sapphire",
}: {
  children: ReactNode;
  className?: string;
  index?: number;
  tone?: Jewel;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative overflow-hidden rounded-xl p-5 backdrop-blur-xl transition-shadow duration-300",
        "border border-[color-mix(in_oklab,var(--sapphire)_22%,transparent)]",
        "bg-[color-mix(in_oklab,var(--raised)_45%,transparent)]",
        "hover:border-[color-mix(in_oklab,var(--sapphire)_38%,transparent)]",
        "hover:shadow-[0_0_38px_-24px_var(--sapphire)]",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-80"
        style={{
          background: `linear-gradient(to right, transparent, var(--${tone}), transparent)`,
        }}
      />
      {children}
    </motion.div>
  );
}

export function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground/60">
        {label}
      </h2>
      {hint && (
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground/40">
          {hint}
        </span>
      )}
    </div>
  );
}

/** Compact grid — quick-glance stat tile. */
export function StatCard({
  icon: Icon,
  label,
  value,
  tone = "sapphire",
  index = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: Jewel;
  index?: number;
}) {
  return (
    <CardShell index={index} tone={tone} className="p-4">
      <span
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
        style={{
          background: `color-mix(in oklab, var(--${tone}) 12%, transparent)`,
          color: `var(--${tone})`,
        }}
      >
        <Icon className="h-4 w-4" strokeWidth={1.6} />
      </span>
      <div className="mt-4 truncate font-mono text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground/55">
        {label}
      </div>
      <div className="mt-1.5 truncate font-mono text-[17px] font-medium tracking-[-0.01em] text-foreground">
        {value}
      </div>
    </CardShell>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[22px] w-[40px] shrink-0 rounded-full border transition-colors duration-200",
        checked
          ? "border-[color-mix(in_oklab,var(--emerald)_45%,transparent)] bg-[color-mix(in_oklab,var(--emerald)_18%,transparent)] shadow-[0_0_20px_-10px_var(--emerald)]"
          : "border-border bg-raised/60",
      )}
      title={label}
    >
      <motion.span
        animate={{ x: checked ? 19 : 2 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={cn(
          "absolute top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full transition-colors duration-200",
          checked ? "bg-emerald" : "bg-muted-foreground/55",
        )}
      />
    </button>
  );
}

/** Detailed config — title, description and a switch. */
export function ConfigCard({
  title,
  description,
  defaultChecked = false,
  meta,
  index = 0,
}: {
  title: string;
  description: string;
  defaultChecked?: boolean;
  meta?: string;
  index?: number;
}) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <CardShell index={index} tone="emerald" className="p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-[15.5px] font-medium tracking-[-0.01em] text-foreground">
            {title}
          </h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>
          {meta && (
            <div className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/45">
              {meta}
            </div>
          )}
        </div>
        <Toggle checked={on} onChange={setOn} label={title} />
      </div>
    </CardShell>
  );
}

/** Actionable card — title, supporting line and a small action button. */
export function ActionCard({
  title,
  description,
  action = "Yenile",
  meta,
  tone = "sapphire",
  index = 0,
  onAction,
}: {
  title: string;
  description: string;
  action?: string;
  meta?: string;
  tone?: Jewel;
  index?: number;
  onAction?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <CardShell index={index} tone={tone} className="flex flex-col p-5">
      <h3 className="text-[15.5px] font-medium tracking-[-0.01em] text-foreground">{title}</h3>
      <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-muted-foreground">
        {description}
      </p>
      <div className="mt-5 flex items-center justify-between gap-3">
        {meta && (
          <span className="truncate font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/45">
            {meta}
          </span>
        )}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.16, ease: "easeInOut" }}
          onClick={() => {
            setBusy(true);
            onAction?.();
            setTimeout(() => setBusy(false), 900);
          }}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 font-mono text-[11px] uppercase tracking-[0.16em] transition-shadow"
          style={{
            color: `var(--${tone})`,
            borderColor: `color-mix(in oklab, var(--${tone}) 34%, transparent)`,
            background: `color-mix(in oklab, var(--${tone}) 10%, transparent)`,
          }}
        >
          <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} strokeWidth={1.8} />
          {action}
        </motion.button>
      </div>
    </CardShell>
  );
}
