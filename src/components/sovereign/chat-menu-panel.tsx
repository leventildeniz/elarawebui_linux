import { FileDown, FileText, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatColors, type ChatThread, type ChatColor } from "@/lib/chat-store";
import { downloadMarkdown, exportPdf } from "@/lib/chat-export";

export function MenuItem({
  icon: Icon,
  label,
  onClick,
  tone,
}: {
  icon: typeof Pin;
  label: string;
  onClick: () => void;
  tone?: "ruby";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13.5px] font-medium transition-colors",
        tone === "ruby"
          ? "text-ruby/90 hover:bg-ruby/12 hover:text-ruby"
          : "text-foreground/85 hover:bg-raised/60 hover:text-foreground",
      )}
    >
      <Icon className="h-[15px] w-[15px]" strokeWidth={1.6} />
      {label}
    </button>
  );
}

/** Shared action list for a chat thread — used in the sidebar and the top bar. */
export function ChatMenuPanel({
  chat,
  onRename,
  onTogglePin,
  onSetColor,
  onDelete,
  onClose,
}: {
  chat: ChatThread;
  onRename: () => void;
  onTogglePin: () => void;
  onSetColor: (c: ChatColor) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <MenuItem
        icon={Pencil}
        label="Rename"
        onClick={() => {
          onRename();
          onClose();
        }}
      />
      <MenuItem
        icon={chat.pinned ? PinOff : Pin}
        label={chat.pinned ? "Unpin" : "Pin"}
        onClick={() => {
          onTogglePin();
          onClose();
        }}
      />
      <MenuItem
        icon={FileText}
        label="Export Markdown"
        onClick={() => {
          downloadMarkdown(chat);
          onClose();
        }}
      />
      <MenuItem
        icon={FileDown}
        label="Export PDF"
        onClick={() => {
          void exportPdf(chat);
          onClose();
        }}
      />

      <div className="my-1 h-px bg-white/[0.07]" />
      <div className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
        Color
      </div>
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        {chatColors.map((col) => (
          <button
            key={col.key}
            aria-label={col.label}
            title={col.label}
            onClick={() => onSetColor(col.key)}
            className={cn(
              "h-4 w-4 rounded-full border transition-transform hover:scale-110",
              chat.color === col.key ? "border-foreground/70" : "border-white/15",
            )}
            style={
              col.key === "none"
                ? { background: "transparent" }
                : { background: col.token, boxShadow: `0 0 10px -3px ${col.token}` }
            }
          />
        ))}
      </div>

      <div className="my-1 h-px bg-white/[0.07]" />
      <MenuItem
        icon={Trash2}
        label="Delete"
        tone="ruby"
        onClick={() => {
          onDelete();
          onClose();
        }}
      />
    </>
  );
}
