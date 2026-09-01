import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Minimal, zen image lightbox: no toolbars, no downloads, just a close button. */
export function ImageViewer({
  src,
  alt,
  open,
  onClose,
}: {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[300] flex items-center justify-center bg-canvas/85 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "relative max-h-[50vh] max-w-[min(64vw,480px)] overflow-hidden rounded-xl",
              "border border-white/[0.08] bg-raised/40 shadow-[0_28px_80px_-32px_rgba(0,0,0,0.8)]",
            )}
          >
            <button
              onClick={onClose}
              aria-label="Close image"
              className="absolute right-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] bg-canvas/80 text-muted-foreground/70 transition-colors hover:text-foreground"
              title="Close image"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            <img
              src={src}
              alt={alt}
              className="max-h-[50vh] max-w-[min(64vw,480px)] object-contain"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
