import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { ForgeAPI, type ActionDef, type ForgeKind } from "@/lib/api-client";
import { toast } from "sonner";

interface Props {
  /** Restrict picker to these Forge kinds. Default: all. */
  kinds?: ForgeKind[];
  /** Called with the selected ActionDef when user clicks Add. */
  onAdd: (action: ActionDef) => void;
  /** Optional polling interval (ms) to auto-refresh the library. Default 4000. */
  pollMs?: number;
  /** Compact label override. */
  label?: string;
}

/**
 * Live-polling Forge action picker. Dropdown shows the current `action_library`
 * grouped by kind. Add inserts the chosen action into the parent canvas.
 * Trash deletes the action from the library (PostgreSQL) — system actions are
 * protected. No "sync" toggle: this is the single source of truth.
 */
export function ForgePicker({ kinds, onAdd, pollMs = 4000, label = "Forge" }: Props) {
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    ForgeAPI.list()
      .then((rows) => setActions(kinds?.length ? rows.filter((a) => kinds.includes(a.kind)) : rows))
      .catch(() => { /* bridge offline */ })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, (kinds || []).join(",")]);

  const current = actions.find((a) => a.id === selected);

  const grouped = (["trigger", "action", "logic", "output"] as ForgeKind[]).map((k) => ({
    k, items: actions.filter((a) => a.kind === k),
  })).filter((g) => g.items.length);

  const handleAdd = () => {
    if (!current) return toast.info("Pick a Forge action first");
    onAdd(current);
  };

  const handleDelete = async () => {
    if (!current) return;
    if (current.is_system) return toast.error("System action — cannot delete");
    if (!confirm(`Delete "${current.name}" from Forge library?`)) return;
    await ForgeAPI.remove(current.id);
    toast.success("Removed from Forge");
    setSelected("");
    refresh();
  };

  return (
    <div className="border border-border rounded p-2 space-y-2 bg-card/40">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {label} · {actions.length}
        </p>
        <div className="flex gap-1">
          <button onClick={refresh} title="Refresh" className="text-muted-foreground hover:text-primary">
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          <a href="/forge" className="text-[10px] font-mono text-primary hover:underline">manage →</a>
        </div>
      </div>
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="h-8 text-[11px] font-mono">
          <SelectValue placeholder={actions.length ? "Pick an action…" : "Library empty"} />
        </SelectTrigger>
        <SelectContent>
          {grouped.map((g) => (
            <SelectGroup key={g.k}>
              <SelectLabel className="text-[10px] uppercase font-mono">{g.k}</SelectLabel>
              {g.items.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-[11px] font-mono">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                    {a.name}{a.is_system ? " · SYS" : ""}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-1">
        <Button size="sm" className="h-7 flex-1 text-[11px] bg-gradient-primary text-primary-foreground" onClick={handleAdd} disabled={!current}>
          <Plus className="h-3 w-3 mr-1" />Add
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={handleDelete} disabled={!current || current.is_system} title="Delete from Forge library">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {current?.description && (
        <p className="text-[10px] font-mono text-muted-foreground line-clamp-2">{current.description}</p>
      )}
    </div>
  );
}
