import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "lucide-react";

export type ConfirmRequest = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "ruby" | "sapphire" | "topaz" | "emerald";
};

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

let notify: ((p: Pending | null) => void) | null = null;

/** Promise-based, studio-styled replacement for window.confirm(). */
export function confirmAction(req: ConfirmRequest): Promise<boolean> {
  if (!notify) return Promise.resolve(window.confirm(req.title));
  return new Promise<boolean>((resolve) => {
    notify?.({ ...req, resolve });
  });
}

/** Mounted once at the app root. */
export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    notify = setPending;
    return () => {
      notify = null;
    };
  }, []);

  const close = (ok: boolean) => {
    console.log("close called with ok=", ok, "pending is", pending); pending?.resolve(ok);
    setPending(null);
  };

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const tone = pending?.tone ?? "ruby";

  return (
    <AnimatePresence>
      {pending && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => { e.stopPropagation(); close(false); }}
            className="fixed inset-0 z-[200] bg-canvas/75 backdrop-blur-[3px]"
          />
          <motion.div
            role="alertdialog"
            aria-label={pending.title}
            initial={{ opacity: 0, y: 12, scale: 0.98, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, scale: 0.98, filter: "blur(6px)" }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            
             className="obsidian-slab fixed left-1/2 top-1/2 z-[201] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-[16px] p-6"
            style={{ boxShadow: `0 40px 90px -50px var(--${tone})` }}
          >
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border"
                style={{
                  borderColor: `color-mix(in oklab, var(--${tone}) 45%, transparent)`,
                  boxShadow: `0 0 26px -14px var(--${tone})`,
                }}
              >
                <AlertTriangle size={16} strokeWidth={1.6} style={{ color: `var(--${tone})` }} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[16px] font-medium tracking-tight text-foreground">
                  {pending.title}
                </h2>
                {pending.body && (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground/80">
                    {pending.body}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); close(false); }}
                className="rounded-lg border border-white/[0.08] bg-raised/40 px-3.5 py-[7px] font-mono text-[11.5px] tracking-[0.14em] text-muted-foreground/80 transition-colors hover:border-white/20 hover:text-foreground"
              >
                {(pending.cancelLabel ?? "CANCEL").toUpperCase()}
              </button>
              <button
                autoFocus
                onClick={(e) => { e.stopPropagation(); close(true); }}
                className="rounded-lg border px-3.5 py-[7px] font-mono text-[11.5px] tracking-[0.14em] text-foreground transition-all"
                style={{
                  borderColor: `color-mix(in oklab, var(--${tone}) 55%, transparent)`,
                  background: `color-mix(in oklab, var(--${tone}) 14%, transparent)`,
                  boxShadow: `0 0 24px -12px var(--${tone})`,
                }}
              >
                {(pending.confirmLabel ?? "CONFIRM").toUpperCase()}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
