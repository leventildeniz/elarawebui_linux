import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronUp, Folder, Home, Check } from "lucide-react";
import { AgentsAPI } from "@/lib/api-client";
import { toast } from "sonner";

type BrowseData = Awaited<ReturnType<typeof AgentsAPI.browse>>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath?: string;
  onPick: (absolutePath: string) => void;
  title?: string;
  description?: string;
}

/**
 * Folder-only picker. Reuses GET /api/agents/browse (returns dirs + files;
 * we only surface dirs and let the user confirm the current directory).
 */
export function MacFolderPicker({ open, onOpenChange, initialPath, onPick, title, description }: Props) {
  const [data, setData] = useState<BrowseData | null>(null);
  const [loading, setLoading] = useState(false);

  const navigate = async (p?: string) => {
    setLoading(true);
    const r = await AgentsAPI.browse(p);
    setData(r);
    setLoading(false);
    if (!r.ok) toast.error(r.error || "Cannot open folder");
  };

  useEffect(() => {
    if (open) navigate(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const confirm = () => {
    if (!data?.ok || !data.path) return;
    onPick(data.path);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title || "Select folder"}</DialogTitle>
          <DialogDescription>
            {description || "Pick any absolute directory path. Subfolders are walked recursively."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1 pb-2 border-b border-border">
          {(data?.shortcuts ?? []).map((s) => (
            <Button key={s.path} type="button" variant="outline" size="sm" className="h-7 text-[11px] font-mono"
              onClick={() => navigate(s.path)}>
              <Home className="h-3 w-3 mr-1" /> {s.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2 py-2">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
            disabled={!data?.parent}
            onClick={() => data?.parent && navigate(data.parent)}>
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Input
            value={data?.path ?? ""}
            onChange={(e) => setData((d) => d ? { ...d, path: e.target.value } : d)}
            onKeyDown={(e) => { if (e.key === "Enter") navigate((e.target as HTMLInputElement).value); }}
            className="h-7 text-[11px] font-mono"
            placeholder="/Users/you/path"
          />
          <Button type="button" variant="outline" size="sm" className="h-7"
            onClick={() => data && navigate(data.path)}>Go</Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {loading && <p className="text-xs font-mono text-muted-foreground p-3">Loading…</p>}
          {!loading && data?.ok && data.dirs.length === 0 && (
            <p className="text-xs font-mono text-muted-foreground p-3">No subdirectories.</p>
          )}
          {!loading && data?.dirs.map((d) => (
            <button
              key={d.path} type="button"
              onClick={() => navigate(d.path)}
              className="w-full flex items-center gap-2 p-2 rounded border border-border bg-card/40 hover:bg-card/70 text-left"
            >
              <Folder className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-mono">{d.name}</span>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={confirm} disabled={!data?.ok} className="bg-gradient-primary text-primary-foreground">
            <Check className="h-3.5 w-3.5 mr-1" /> Use this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
