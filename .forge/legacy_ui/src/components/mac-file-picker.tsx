import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronUp, FileCode, Folder, Home, Check } from "lucide-react";
import { AgentsAPI } from "@/lib/api-client";
import { toast } from "sonner";

type BrowseData = Awaited<ReturnType<typeof AgentsAPI.browse>>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath?: string;
  /** Allowed file extensions (lowercase, with dot). Default `[".py"]`. */
  accept?: string[];
  onPick: (absolutePath: string) => void;
  title?: string;
  description?: string;
}

/**
 * File picker — same backend as MacFolderPicker (`/api/agents/browse`).
 * Operator navigates directories, then clicks a file to confirm. Pure UI.
 */
export function MacFilePicker({
  open, onOpenChange, initialPath, accept, onPick, title, description,
}: Props) {
  const [data, setData] = useState<BrowseData | null>(null);
  const [loading, setLoading] = useState(false);
  const exts = (accept ?? [".py"]).map((e) => e.toLowerCase());

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

  const pick = (abs: string) => { onPick(abs); onOpenChange(false); };

  const filteredFiles = (data?.files ?? []).filter((f) =>
    exts.length === 0 || exts.includes((f.ext || "").toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title || "Select file"}</DialogTitle>
          <DialogDescription>
            {description || `Pick any file from disk. Filter: ${exts.join(", ") || "any"}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1 pb-2 border-b border-border">
          {(data?.shortcuts ?? []).map((s) => (
            <Button key={s.path} type="button" variant="outline" size="sm" className="h-7 text-[11px] font-mono"
              onClick={() => navigate(s.path)}>
              <Home className="h-3 w-3 mr-1" />{s.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2 py-2 text-[11px] font-mono">
          {data?.parent != null && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => navigate(data.parent!)}>
              <ChevronUp className="h-3 w-3 mr-1" /> Up
            </Button>
          )}
          <Input
            value={data?.path ?? ""}
            onChange={(e) => setData((d) => d ? { ...d, path: e.target.value } : d)}
            onKeyDown={(e) => { if (e.key === "Enter") navigate((e.target as HTMLInputElement).value); }}
            className="h-7 font-mono text-[11px]"
            placeholder="/absolute/path"
          />
        </div>

        <div className="flex-1 overflow-auto border border-border rounded">
          {loading && <p className="text-xs font-mono text-muted-foreground p-3">Loading…</p>}
          {!loading && (
            <ul className="divide-y divide-border/40">
              {(data?.dirs ?? []).map((d) => (
                <li key={d.path}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent/40 flex items-center gap-2"
                    onClick={() => navigate(d.path)}
                  >
                    <Folder className="h-3.5 w-3.5 text-amber-400 shrink-0" /> {d.name}
                  </button>
                </li>
              ))}
              {filteredFiles.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-primary/10 flex items-center gap-2"
                    onClick={() => pick(f.path)}
                  >
                    <FileCode className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-muted-foreground text-[10px]">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                    <Check className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                  </button>
                </li>
              ))}
              {(data?.dirs?.length ?? 0) === 0 && filteredFiles.length === 0 && (
                <li className="px-3 py-6 text-center text-[11px] font-mono text-muted-foreground">
                  No subfolders or matching files here.
                </li>
              )}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
