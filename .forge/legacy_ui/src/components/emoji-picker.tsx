// Native emoji picker — uses system font (macOS Apple Color Emoji etc.). No deps.
// Performance: PopoverContent is forceMount + animation-free + content-visibility,
// so after first open the grid stays in DOM and toggle is single-frame.
import { memo, useState } from "react";
import { Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { EMOJI_GROUPS } from "@/lib/emoji";

interface Props {
  onPick: (emoji: string) => void;
  size?: "sm" | "icon";
}

const EmojiGrid = memo(function EmojiGrid({ onPick }: { onPick: (e: string) => void }) {
  return (
    <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
      {EMOJI_GROUPS.map(g => (
        <div
          key={g.label}
          style={{ contentVisibility: "auto", containIntrinsicSize: "200px" } as React.CSSProperties}
        >
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{g.label}</p>
          <div className="grid grid-cols-8 gap-1">
            {g.emojis.map(it => (
              <button key={it.name} type="button" title={`:${it.name}:`}
                onClick={() => onPick(it.e)}
                className="h-8 w-8 rounded hover:bg-muted text-lg leading-none flex items-center justify-center">
                {it.e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

export const EmojiPicker = memo(function EmojiPicker({ onPick, size = "icon" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size={size} title="Insert emoji">
          <Smile className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        forceMount
        align="end"
        className="w-72 p-2 !animate-none data-[state=closed]:hidden data-[state=closed]:animate-none data-[state=open]:animate-none"
      >
        <EmojiGrid onPick={(e) => { onPick(e); setOpen(false); }} />
      </PopoverContent>
    </Popover>
  );
});
