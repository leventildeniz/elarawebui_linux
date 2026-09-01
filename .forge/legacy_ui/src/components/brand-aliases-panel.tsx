import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RefreshCw, Save, X, Plus, Loader2, CheckCircle2, AlertCircle, Tag, Database } from "lucide-react";
import { BrandAliasesAPI, type BrandAliasEntry } from "@/lib/api-client";
import { toast } from "sonner";

type BrandRow = BrandAliasEntry & {
  draft: string[];          // local edit buffer
  dirty: boolean;
  saving: boolean;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function BrandAliasesPanel() {
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirmBrand, setConfirmBrand] = useState<BrandRow | null>(null);
  const [confirmClear, setConfirmClear] = useState<BrandRow | null>(null);
  const pollersRef = useRef<Map<string, number>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const r = await BrandAliasesAPI.list();
      if (!r.ok) throw new Error(r.error || "load failed");
      setRows((prev) => {
        const prevMap = new Map(prev.map((p) => [p.name, p]));
        return r.brands.map((b) => {
          const old = prevMap.get(b.name);
          // Preserve unsaved draft if user is mid-edit
          if (old && old.dirty) {
            return { ...b, draft: old.draft, dirty: true, saving: false };
          }
          return { ...b, draft: [...b.aliases], dirty: false, saving: false };
        });
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll any running re-enrich jobs
  useEffect(() => {
    rows.forEach((r) => {
      const job = r.reenrichJob;
      if (job?.status === "running" && !pollersRef.current.has(r.name)) {
        const id = window.setInterval(async () => {
          try {
            const s = await BrandAliasesAPI.jobStatus(r.name);
            if (s.ok && s.job && s.job.status !== "running") {
              window.clearInterval(id);
              pollersRef.current.delete(r.name);
              if (s.job.status === "ok") {
                toast.success(`${r.name}: re-enrich complete (${s.job.stalemarked ?? 0} chunks marked stale)`);
              } else {
                toast.error(`${r.name}: re-enrich failed (exit ${s.job.exitCode ?? "?"})`);
              }
              refresh();
            }
          } catch { /* ignore transient */ }
        }, 3000);
        pollersRef.current.set(r.name, id);
      }
    });
    return () => {
      // cleanup any pollers when component unmounts
    };
  }, [rows, refresh]);

  useEffect(() => () => {
    pollersRef.current.forEach((id) => window.clearInterval(id));
    pollersRef.current.clear();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      r.draft.some((a) => a.toLowerCase().includes(q))
    );
  }, [rows, search]);

  const updateDraft = (brand: string, fn: (draft: string[]) => string[]) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.name !== brand) return r;
        const draft = fn(r.draft);
        const dirty = JSON.stringify(draft) !== JSON.stringify(r.aliases);
        return { ...r, draft, dirty };
      })
    );
  };

  const save = async (row: BrandRow, opts?: { confirmDelete?: boolean }) => {
    setRows((p) => p.map((r) => r.name === row.name ? { ...r, saving: true } : r));
    try {
      const r = await BrandAliasesAPI.save(row.name, row.draft, opts);
      if (!r.ok) {
        if (r.reason === "empty_save_blocked") {
          setRows((p) => p.map((x) => x.name === row.name ? { ...x, saving: false } : x));
          setConfirmClear(row);
          return;
        }
        throw new Error(r.error || "save failed");
      }
      toast.success(`${row.name}: saved ${r.count} alias(es) — click Re-enrich brand to apply`);
      await refresh();
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
      setRows((p) => p.map((r) => r.name === row.name ? { ...r, saving: false } : r));
    }
  };


  const triggerReenrich = async (row: BrandRow) => {
    try {
      const r = await BrandAliasesAPI.reenrich(row.name);
      if (!r.ok) throw new Error(r.error || "reenrich failed");
      toast.info(`${row.name}: re-enrich started (PID ${r.job?.pid ?? "?"}). This re-embeds ${row.chunkCount.toLocaleString()} chunks.`);
      refresh();
    } catch (e) {
      toast.error(`Re-enrich failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConfirmBrand(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading brands…</div>;
  }
  if (error) {
    return (
      <Card><CardContent className="py-10 text-center">
        <AlertCircle className="mx-auto mb-2 h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => { setLoading(true); refresh(); }}>Retry</Button>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search brands or aliases…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="mr-2 h-4 w-4" />Refresh
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          {rows.length} brand{rows.length === 1 ? "" : "s"} indexed
        </div>
      </div>

      <div className="grid gap-3">
        {filtered.map((row) => (
          <BrandCard
            key={row.name}
            row={row}
            onAdd={(alias) => updateDraft(row.name, (d) => {
              const a = alias.trim();
              if (!a || d.some((x) => x.toLowerCase() === a.toLowerCase())) return d;
              return [...d, a];
            })}
            onRemove={(alias) => updateDraft(row.name, (d) => d.filter((x) => x !== alias))}
            onSave={() => save(row)}
            onReenrich={() => setConfirmBrand(row)}
          />
        ))}
        {filtered.length === 0 && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            No brands match the search.
          </CardContent></Card>
        )}
      </div>

      <AlertDialog open={!!confirmBrand} onOpenChange={(o) => !o && setConfirmBrand(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-enrich {confirmBrand?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Rebuilds the contextual preamble (brand + aliases + version + title) for{" "}
              <strong>{confirmBrand?.chunkCount.toLocaleString()}</strong> chunks and marks
              their embeddings stale so the embed worker re-embeds them in the background.
              Takes several minutes depending on chunk count and worker load. Safe to run
              repeatedly — only changed chunks get re-embedded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmBrand && triggerReenrich(confirmBrand)}>
              Start re-enrich
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmClear} onOpenChange={(o) => !o && setConfirmClear(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all aliases for {confirmClear?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to save an <strong>empty</strong> alias list for{" "}
              <strong>{confirmClear?.name}</strong>, which will remove all{" "}
              <strong>{confirmClear?.aliases.length ?? 0}</strong> previously saved alias(es).
              This is a destructive change and the JSON entry will be deleted. A timestamped
              backup of the aliases file is kept on disk (last 5 writes), but the brand entry
              itself will be gone until you add aliases again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const row = confirmClear;
                setConfirmClear(null);
                if (row) save(row, { confirmDelete: true });
              }}
            >
              Yes, clear aliases
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

function BrandCard({
  row, onAdd, onRemove, onSave, onReenrich,
}: {
  row: BrandRow;
  onAdd: (alias: string) => void;
  onRemove: (alias: string) => void;
  onSave: () => void;
  onReenrich: () => void;
}) {
  const [input, setInput] = useState("");
  const jobRunning = row.reenrichJob?.status === "running";

  const submit = () => {
    if (!input.trim()) return;
    onAdd(input);
    setInput("");
  };

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Database className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-sm font-semibold">{row.name}</span>
          <Badge variant="secondary" className="text-xs">
            {row.chunkCount.toLocaleString()} chunks
          </Badge>
          <span className="text-xs text-muted-foreground">
            Enriched: {timeAgo(row.lastEnrichedAt)}
          </span>
          {row.stale && (
            <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400 text-xs">
              Aliases changed — re-enrich pending
            </Badge>
          )}
          {jobRunning && (
            <Badge variant="outline" className="border-blue-500 text-blue-600 dark:text-blue-400 text-xs">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />Re-enriching…
            </Badge>
          )}
          {row.reenrichJob?.status === "ok" && !jobRunning && (
            <Badge variant="outline" className="border-emerald-500 text-emerald-600 dark:text-emerald-400 text-xs">
              <CheckCircle2 className="mr-1 h-3 w-3" />Last re-enrich OK
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Tag className="h-3.5 w-3.5" />
            Aliases ({row.draft.length})
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-2 min-h-[42px]">
            {row.draft.length === 0 && (
              <span className="text-xs italic text-muted-foreground px-1">
                No aliases yet — type one alternate name below and press Enter (or click Add)
              </span>
            )}
            {row.draft.map((alias) => (
              <Badge key={alias} variant="secondary" className="gap-1 pr-1 text-xs">
                {alias}
                <button
                  type="button"
                  onClick={() => onRemove(alias)}
                  className="rounded hover:bg-destructive/20 p-0.5"
                  aria-label={`Remove ${alias}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              placeholder={`Add one alias for ${row.name} — press Enter to add (e.g. citrix-adc)`}
              className="h-8 flex-1 text-xs"
            />
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={submit} disabled={!input.trim()}>
              <Plus className="mr-1 h-3.5 w-3.5" />Add
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!row.dirty || row.saving} onClick={onSave}>
            {row.saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
            Save aliases
          </Button>
          <Button size="sm" variant="outline" disabled={jobRunning} onClick={onReenrich}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${jobRunning ? "animate-spin" : ""}`} />
            Re-enrich brand
          </Button>
          {row.dirty && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
