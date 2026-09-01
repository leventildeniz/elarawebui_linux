import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { FileText, Music } from "lucide-react";
import type { Attachment } from "./composer";

const TEXTY =
  /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|yaml|sql|csv))|\.(txt|md|json|csv|log|ya?ml|ts|tsx|js|jsx|py|rs|go|sql|sh|ini|env|toml)$/i;

function isTexty(f: Attachment) {
  return f.kind === "file" && (TEXTY.test(f.mime ?? "") || TEXTY.test(f.name));
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Reads the first ~4 KB of a texty attachment for the hover preview. */
function useTextPeek(file: Attachment, active: boolean) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active || text !== null || failed || !file.url || !isTexty(file)) return;
    let alive = true;
    void fetch(file.url)
      .then((r) => r.blob())
      .then((b) => b.slice(0, 4096).text())
      .then((t) => alive && setText(t))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [active, file, text, failed]);

  return text;
}

function PreviewCard({ file, rect }: { file: Attachment; rect: DOMRect }) {
  const text = useTextPeek(file, true);
  if (typeof document === "undefined") return null;
  const width = 340;
  const left = Math.min(
    Math.max(12, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - 12,
  );
  const above = rect.top > window.innerHeight / 2;

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: above ? 6 : -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: above ? 6 : -6, scale: 0.98 }}
      transition={{ duration: 0.14 }}
      style={{
        left,
        width,
        ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      }}
      className="glass pointer-events-none fixed z-[200] overflow-hidden rounded-[12px] border border-white/[0.08] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.7)]"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
        <span className="truncate text-[12.5px] text-foreground/90">{file.name}</span>
        <span className="ml-2 shrink-0 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/55">
          {formatSize(file.size)}
        </span>
      </div>

      {file.kind === "image" && file.url ? (
        <img
          src={file.url}
          alt={file.name}
          className="max-h-[260px] w-full bg-[var(--canvas-deep)] object-contain"
        />
      ) : file.kind === "audio" ? (
        <div className="flex items-center gap-2.5 px-3 py-4 text-[12.5px] text-muted-foreground/70">
          <Music className="h-4 w-4 text-emerald" strokeWidth={1.6} />
          Audio attachment
        </div>
      ) : isTexty(file) ? (
        <pre className="max-h-[240px] overflow-hidden whitespace-pre-wrap break-words bg-[var(--canvas-deep)] px-3 py-2.5 font-mono text-[11.5px] leading-[1.65] text-foreground/80">
          {text ?? "Reading…"}
        </pre>
      ) : (
        <div className="flex items-center gap-2.5 px-3 py-4 text-[12.5px] text-muted-foreground/70">
          <FileText className="h-4 w-4 text-sapphire" strokeWidth={1.6} />
          No inline preview for this type
        </div>
      )}
    </motion.div>,
    document.body,
  );
}

/** Wraps a file chip/row and shows a floating preview on hover. */
export function FileHoverPreview({
  file,
  children,
  className,
}: {
  file: Attachment;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  return (
    <div
      ref={ref}
      className={className}
      onMouseEnter={() => setRect(ref.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={() => setRect(null)}
    >
      {children}
      <AnimatePresence>
        {rect && <PreviewCard key="preview" file={file} rect={rect} />}
      </AnimatePresence>
    </div>
  );
}
