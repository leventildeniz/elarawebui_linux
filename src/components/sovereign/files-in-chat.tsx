import { AnimatePresence, motion } from "motion/react";
import { Download, FileAudio, FileText, Image as ImageIcon, X } from "lucide-react";
import type { Attachment } from "./composer";
import { FileHoverPreview } from "./file-preview";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ext(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toUpperCase() : "FILE";
}

/** Right-hand rail listing every file shared in the conversation. */
export function FilesInChat({ files, onClose }: { files: Attachment[]; onClose?: () => void }) {
  return (
    <aside className="flex h-full w-full min-w-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <span className="text-[15px] font-medium text-foreground">Files in Chat</span>
        {onClose && (
          <button
            aria-label="Close files panel"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-raised/60 hover:text-foreground"
            title="Close files panel"
          >
            <X className="h-4 w-4" strokeWidth={1.6} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-4">
        {files.length === 0 && (
          <p className="px-1 pt-2 text-[13px] leading-[1.7] text-muted-foreground/50">
            Files you attach, drop or paste into the conversation collect here.
          </p>
        )}

        {files.map((f) => {
          const Icon = f.kind === "image" ? ImageIcon : f.kind === "audio" ? FileAudio : FileText;
          return (
            <FileHoverPreview key={f.id} file={f}>
              <div className="group flex items-center gap-3 rounded-[10px] border border-white/[0.05] bg-raised/25 p-2.5 transition-colors hover:bg-raised/50">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-white/[0.07] bg-canvas">
                  {f.kind === "image" && f.url ? (
                    <img src={f.url} alt={f.name} className="h-full w-full object-cover" />
                  ) : (
                    <Icon className="h-[17px] w-[17px] text-sapphire" strokeWidth={1.5} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-foreground">{f.name}</div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/55">
                    {ext(f.name)} {formatSize(f.size)}
                  </div>
                </div>
                {f.url && (
                  <a
                    href={f.url}
                    download={f.name}
                    aria-label={`Download ${f.name}`}
                    title="Download"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-all hover:bg-raised hover:text-foreground group-hover:opacity-100"
                  >
                    <Download className="h-4 w-4" strokeWidth={1.6} />
                  </a>
                )}
              </div>
            </FileHoverPreview>
          );
        })}
      </div>
    </aside>
  );
}

/** Right-side overlay drawer version, mirroring the runtime canvas. */
export function FilesCanvas({
  open,
  files,
  onClose,
}: {
  open: boolean;
  files: Attachment[];
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-canvas/60 backdrop-blur-[2px]"
          />
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="glass fixed bottom-3 right-3 top-3 z-50 flex w-[380px] flex-col overflow-hidden rounded-xl"
          >
            <FilesInChat files={files} onClose={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
