// Reusable adapter + target binding chip blocks. Used by Tools, Skills,
// Forge, Agents editors. All bound entities use the same wire shape:
//   adapters: { adapter_id, enabled }[]
//   targets:  { scope: 'target'|'group', ref_id, enabled }[]
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plug, Crosshair, X } from "lucide-react";
import {
  AdaptersAPI, TargetsAPI, TargetGroupsAPI,
  type AdapterRow, type TargetRow, type TargetGroupRow,
  type AgentAdapterBinding, type AgentTargetBinding,
} from "@/lib/api-client";

export interface BindingChipsProps {
  adapters: AgentAdapterBinding[];
  targets: AgentTargetBinding[];
  onAdaptersChange: (next: AgentAdapterBinding[]) => void;
  onTargetsChange: (next: AgentTargetBinding[]) => void;
  /** Optional preloaded lists — if omitted, this component fetches them. */
  adapterList?: AdapterRow[];
  targetList?: TargetRow[];
  groupList?: TargetGroupRow[];
  /** Hint string under each header. */
  adapterHint?: string;
  targetHint?: string;
}

export function BindingChips(props: BindingChipsProps) {
  const [adapterList, setAdapterList] = useState<AdapterRow[]>(props.adapterList ?? []);
  const [targetList, setTargetList] = useState<TargetRow[]>(props.targetList ?? []);
  const [groupList, setGroupList] = useState<TargetGroupRow[]>(props.groupList ?? []);

  useEffect(() => {
    if (props.adapterList && props.targetList && props.groupList) return;
    let cancelled = false;
    (async () => {
      const [ad, tg, gr] = await Promise.all([
        AdaptersAPI.list(), TargetsAPI.list(), TargetGroupsAPI.list(),
      ]);
      if (cancelled) return;
      setAdapterList(ad.items || []);
      setTargetList(tg.items || []);
      setGroupList(gr.items || []);
    })();
    return () => { cancelled = true; };
  }, [props.adapterList, props.targetList, props.groupList]);

  const { adapters, targets, onAdaptersChange, onTargetsChange } = props;

  return (
    <>
      {/* Adapters */}
      <div className="border-t border-border pt-4 space-y-2 mt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Plug className="h-3.5 w-3.5" /> Adapters ({adapters.length})
          </p>
          <Select
            value=""
            onValueChange={(v) => {
              if (!v || v === "__none__" || adapters.some((a) => a.adapter_id === v)) return;
              onAdaptersChange([...adapters, { adapter_id: v, enabled: true }]);
            }}
          >
            <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="+ Add adapter…" /></SelectTrigger>
            <SelectContent>
              {adapterList.length === 0 && <SelectItem value="__none__" disabled>No adapters — create one in Adapters</SelectItem>}
              {adapterList
                .filter((a) => !adapters.some((b) => b.adapter_id === a.id))
                .map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="font-mono text-xs">{a.name} · {a.category}/{a.connection_type}</span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        {props.adapterHint && <p className="text-[10px] text-muted-foreground/70">{props.adapterHint}</p>}
        <div className="flex flex-wrap gap-1.5">
          {adapters.length === 0 && (
            <p className="text-[10px] font-mono text-muted-foreground/60">No adapters bound · runs standalone.</p>
          )}
          {adapters.map((b) => {
            const a = adapterList.find((x) => x.id === b.adapter_id);
            return (
              <Badge key={b.adapter_id} variant="outline" className="text-[10px] gap-1 pr-1">
                <Plug className="h-3 w-3" />
                {a?.name ?? b.adapter_id}
                {a && <span className="text-muted-foreground">· {a.category}</span>}
                <button
                  type="button"
                  className="ml-1 hover:text-destructive"
                  onClick={() => onAdaptersChange(adapters.filter((x) => x.adapter_id !== b.adapter_id))}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      </div>

      {/* Targets */}
      <div className="border-t border-border pt-4 space-y-2 mt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Crosshair className="h-3.5 w-3.5" /> Targets ({targets.length})
          </p>
          <div className="flex gap-1">
            <Select
              value=""
              onValueChange={(v) => {
                if (!v || v === "__none__" || targets.some((t) => t.scope === "group" && t.ref_id === v)) return;
                onTargetsChange([...targets, { scope: "group", ref_id: v, enabled: true }]);
              }}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="+ Group…" /></SelectTrigger>
              <SelectContent>
                {groupList.length === 0 && <SelectItem value="__none__" disabled>No groups</SelectItem>}
                {groupList
                  .filter((g) => !targets.some((t) => t.scope === "group" && t.ref_id === g.id))
                  .map((g) => <SelectItem key={g.id} value={g.id}>{g.name} ({g.kind})</SelectItem>)}
              </SelectContent>
            </Select>
            <Select
              value=""
              onValueChange={(v) => {
                if (!v || v === "__none__" || targets.some((t) => t.scope === "target" && t.ref_id === v)) return;
                onTargetsChange([...targets, { scope: "target", ref_id: v, enabled: true }]);
              }}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="+ Target…" /></SelectTrigger>
              <SelectContent>
                {targetList.length === 0 && <SelectItem value="__none__" disabled>No targets — add in Targets</SelectItem>}
                {targetList
                  .filter((t) => !targets.some((b) => b.scope === "target" && b.ref_id === t.id))
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="font-mono text-xs">{t.name} · {t.ip || t.host}</span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {props.targetHint && <p className="text-[10px] text-muted-foreground/70">{props.targetHint}</p>}
        <div className="flex flex-wrap gap-1.5">
          {targets.length === 0 && (
            <p className="text-[10px] font-mono text-muted-foreground/60">No targets bound.</p>
          )}
          {targets.map((b) => {
            const label = b.scope === "group"
              ? groupList.find((g) => g.id === b.ref_id)?.name ?? b.ref_id
              : targetList.find((t) => t.id === b.ref_id)?.name ?? b.ref_id;
            const sub = b.scope === "group" ? "group" :
              targetList.find((t) => t.id === b.ref_id)?.ip || "";
            return (
              <Badge key={`${b.scope}:${b.ref_id}`} variant={b.scope === "group" ? "secondary" : "outline"} className="text-[10px] gap-1 pr-1">
                <Crosshair className="h-3 w-3" />
                {label}
                {sub && <span className="text-muted-foreground">· {sub}</span>}
                <button
                  type="button"
                  className="ml-1 hover:text-destructive"
                  onClick={() => onTargetsChange(targets.filter((x) => !(x.scope === b.scope && x.ref_id === b.ref_id)))}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      </div>
    </>
  );
}
