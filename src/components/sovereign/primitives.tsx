import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const spring = { type: "spring", stiffness: 260, damping: 30, mass: 0.7 } as const;

export const rise = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
};

export type Jewel = "sapphire" | "emerald" | "amethyst" | "topaz" | "ruby" | "platinum" | "canvas";

const jewelText: Record<Jewel, string> = {
  sapphire: "text-sapphire",
  emerald: "text-emerald",
  amethyst: "text-amethyst",
  topaz: "text-topaz",
  ruby: "text-ruby",
  platinum: "text-platinum",
  canvas: "text-muted-foreground",
};

const jewelBg: Record<Jewel, string> = {
  sapphire: "bg-sapphire",
  emerald: "bg-emerald",
  amethyst: "bg-amethyst",
  topaz: "bg-topaz",
  ruby: "bg-ruby",
  platinum: "bg-platinum",
  canvas: "bg-canvas",
};

export function GlassPanel({
  className,
  children,
  ...props
}: HTMLMotionProps<"div"> & { children?: ReactNode }) {
  return (
    <motion.div className={cn("glass rounded-xl", className)} {...props}>
      {children}
    </motion.div>
  );
}

export function Sheen({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-px w-full bg-gradient-to-r from-transparent via-border to-transparent",
        className,
      )}
    />
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mono-label", className)}>{children}</div>;
}

export function StatusDot({ tone = "emerald", pulse }: { tone?: Jewel; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && (
        <span
          className={cn("absolute inset-0 animate-ping rounded-full opacity-60", jewelBg[tone])}
        />
      )}
      <span className={cn("relative h-2 w-2 rounded-full", jewelBg[tone])} />
    </span>
  );
}

export function Tag({
  children,
  tone = "sapphire",
  className,
}: {
  children: ReactNode;
  tone?: Jewel;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-raised/60 px-2 py-0.5 font-mono text-[11px] tracking-wide",
        jewelText[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type ButtonProps = HTMLMotionProps<"button"> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md";
};

export function JewelButton({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  const variants: Record<string, string> = {
    primary:
      "bg-sapphire/15 text-sapphire border border-sapphire/40 hover:bg-sapphire/25 hover:shadow-[0_0_28px_-8px_var(--sapphire)]",
    outline: "border border-border text-foreground/85 hover:bg-raised hover:text-foreground",
    ghost: "text-muted-foreground hover:text-foreground hover:bg-raised/70",
    danger:
      "bg-ruby/12 text-ruby border border-ruby/35 hover:bg-ruby/20 hover:shadow-[0_0_28px_-8px_var(--ruby)]",
  };
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ y: 0, scale: 0.985 }}
      transition={spring}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-200",
        size === "sm" ? "h-9 px-3 text-[13px]" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}

export function MonoRow({ label, value, tone }: { label: string; value: ReactNode; tone?: Jewel }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="mono-label">{label}</span>
      <span className={cn("font-mono text-[13px] text-foreground/90", tone && jewelText[tone])}>
        {value}
      </span>
    </div>
  );
}
