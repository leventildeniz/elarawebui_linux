import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LazyTextarea } from "@/components/lazy-textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Save, Trash2, Hammer, ArrowUp, ArrowDown, Copy, Zap, Plug, Crosshair, X, FolderOpen, AlertTriangle } from "lucide-react";
import { MacFilePicker } from "@/components/mac-file-picker";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ForgeAPI, AdaptersAPI, TargetsAPI, TargetGroupsAPI, ToolBindingsAPI,
  type ActionDef, type ParamSchema, type ParamType, type ForgeKind,
  type AdapterRow, type TargetRow, type TargetGroupRow,
  type AgentAdapterBinding, type AgentTargetBinding,
} from "@/lib/api-client";
import { ExecutionPolicyForm, DEFAULT_POLICY, sanitizePolicy } from "@/components/execution-policy-form";
import { IconGridPicker, AGENT_ICON_LOOKUP } from "@/components/icon-grid-picker";
import { ColorPalettePicker } from "@/components/color-palette-picker";
import { BrainSelect, InterpreterSelect } from "@/components/runtime-brain-picker";
import { useI18n } from "@/lib/i18n";
import { useRbac } from "@/lib/rbac";

export const Route = createFileRoute("/_app/forge")({
  validateSearch: (s: Record<string, unknown>) => ({ new: s.new ? 1 : undefined as 1 | undefined }),
  component: ForgePage,
});

const PARAM_TYPES: ParamType[] = ["text", "textarea", "number", "boolean", "select", "secret", "json", "ctxRef"];
const KINDS: ForgeKind[] = ["trigger", "action", "logic", "output"];

function emptyAction(kind: ForgeKind = "action"): ActionDef {
  const id = `custom.${kind}.${Date.now().toString(36)}`;
  return {
    id, kind, name: "New " + kind, category: "Custom", provider: "",
    icon: "Zap", color: "#06b6d4", description: "",
    params: [], outputs: [], runtime: { handler: "noop" },
    is_system: false, priority: 5,
  };
}

function ForgePage() {
  const { t } = useI18n();
  const { isAdmin } = useRbac();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [filter, setFilter] = useState<ForgeKind | "all">("all");
  const [activeId, setActiveId] = useState<string>("");
  const [draft, setDraft] = useState<ActionDef | null>(null);
  const newAutoTriggered = useRef(false);

  // Tool ↔ Adapter/Target bindings — mirrors Tools/Config dialog.
  const [adapterList, setAdapterList] = useState<AdapterRow[]>([]);
  const [targetList, setTargetList] = useState<TargetRow[]>([]);
  const [groupList, setGroupList] = useState<TargetGroupRow[]>([]);
  const [adapters, setAdapters] = useState<AgentAdapterBinding[]>([]);
  const [targets, setTargets] = useState<AgentTargetBinding[]>([]);
  const [scriptPickerOpen, setScriptPickerOpen] = useState(false);

  useEffect(() => {
    Promise.all([AdaptersAPI.list(), TargetsAPI.list(), TargetGroupsAPI.list()]).then(([a, t, g]) => {
      setAdapterList(a.items || []); setTargetList(t.items || []); setGroupList(g.items || []);
    });
  }, []);

  useEffect(() => {
    if (!draft?.id) { setAdapters([]); setTargets([]); return; }
    let cancelled = false;
    Promise.all([ToolBindingsAPI.adapterList(draft.id), ToolBindingsAPI.targetList(draft.id)]).then(([ab, tb]) => {
      if (cancelled) return;
      setAdapters(ab.items || []); setTargets(tb.items || []);
    });
    return () => { cancelled = true; };
  }, [draft?.id]);

  const bridgeWarned = useRef(false);
  const refresh = () =>
    ForgeAPI.list()
      .then((r) => { setActions(r); bridgeWarned.current = false; })
      .catch(() => {
        if (bridgeWarned.current) return;
        bridgeWarned.current = true;
        toast.error(t("forge.bridge_offline"));
      });
  useEffect(() => { refresh(); }, []);

  // Auto-open new-action draft when arriving via `?new=1` (e.g. from Tools panel "+ New Tool").
  useEffect(() => {
    if (search.new && !newAutoTriggered.current) {
      newAutoTriggered.current = true;
      const a = emptyAction("action");
      setActions((p) => [a, ...p]);
      setActiveId(a.id);
      setDraft({ ...a, params: [...a.params], outputs: [...a.outputs], runtime: { ...a.runtime } });
      navigate({ search: {}, replace: true });
    }
  }, [search.new, navigate]);

  const filtered = useMemo(
    () => actions.filter((a) => filter === "all" || a.kind === filter),
    [actions, filter],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, ActionDef[]>();
    for (const a of filtered) {
      const arr = m.get(a.category) ?? [];
      arr.push(a); m.set(a.category, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const select = (a: ActionDef) => { setActiveId(a.id); setDraft({ ...a, params: [...a.params], outputs: [...a.outputs], runtime: { ...a.runtime } }); };
  const newAction = () => { const a = emptyAction("action"); setActions((p) => [a, ...p]); select(a); };
  const duplicate = () => {
    if (!draft) return;
    const copy: ActionDef = { ...draft, id: `${draft.id}.copy.${Date.now().toString(36)}`, name: draft.name + " (copy)", is_system: false };
    setActions((p) => [copy, ...p]); select(copy);
  };
  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error(t("forge.name_required"));
    try {
      await ForgeAPI.save({
        id: draft.id, kind: draft.kind, name: draft.name, category: draft.category,
        provider: draft.provider, icon: draft.icon, color: draft.color,
        description: draft.description, params: draft.params, outputs: draft.outputs, runtime: draft.runtime,
        execution_policy: sanitizePolicy(draft.execution_policy ?? DEFAULT_POLICY),
      });
      await Promise.all([
        ToolBindingsAPI.adapterSave(draft.id, adapters).catch((e) => toast.error(`Adapter save: ${(e as Error).message}`)),
        ToolBindingsAPI.targetSave(draft.id, targets).catch((e) => toast.error(`Target save: ${(e as Error).message}`)),
      ]);
      toast.success(t("forge.sealed_pg"), {
        action: { label: "Open in Library", onClick: () => navigate({ to: "/tools" }) },
      });
      refresh();
    } catch (e) { toast.error("Save failed: " + (e as Error).message); }
  };
  const remove = async () => {
    if (!draft) return;
    if (draft.is_system && !isAdmin) return toast.error(t("forge.sys_cant_delete"));
    const sysWarn = draft.is_system ? "\n\n⚠ SYSTEM action — admin-only delete. Tombstoned; will not be re-seeded." : "";
    if (!confirm(`${t("forge.delete")} ${draft.name}?${sysWarn}`)) return;
    try {
      await ForgeAPI.remove(draft.id);
      toast.success("Removed");
      setDraft(null); setActiveId("");
      refresh();
    } catch (e) { toast.error("Delete failed: " + (e as Error).message); }
  };

  // --- param helpers
  const updateParam = (i: number, patch: Partial<ParamSchema>) =>
    setDraft((d) => d ? { ...d, params: d.params.map((p, j) => j === i ? { ...p, ...patch } : p) } : d);
  const addParam = () =>
    setDraft((d) => d ? { ...d, params: [...d.params, { key: `field_${d.params.length + 1}`, label: "", type: "text" }] } : d);
  const removeParam = (i: number) =>
    setDraft((d) => d ? { ...d, params: d.params.filter((_, j) => j !== i) } : d);
  const moveParam = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const arr = [...d.params];
      const j = i + dir; if (j < 0 || j >= arr.length) return d;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...d, params: arr };
    });

  const addOutput = () =>
    setDraft((d) => d ? { ...d, outputs: [...d.outputs, { key: `out_${d.outputs.length + 1}`, label: "" }] } : d);
  const updateOutput = (i: number, patch: Partial<{ key: string; label: string }>) =>
    setDraft((d) => d ? { ...d, outputs: d.outputs.map((o, j) => j === i ? { ...o, ...patch } : o) } : d);
  const removeOutput = (i: number) =>
    setDraft((d) => d ? { ...d, outputs: d.outputs.filter((_, j) => j !== i) } : d);

  return (
    <PageShell>
      <PageHeader
        title={t("forge.title")}
        subtitle={t("forge.subtitle")}
        actions={
          <>
            <Button variant="outline" onClick={newAction}><Plus className="h-4 w-4 mr-1" />{t("forge.new_action")}</Button>
            {draft && <Button variant="outline" onClick={duplicate}><Copy className="h-4 w-4 mr-1" />{t("forge.duplicate")}</Button>}
            {draft && <Button onClick={save} className="bg-gradient-primary text-primary-foreground"><Save className="h-4 w-4 mr-1" />{t("common.save")}</Button>}
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Library */}
        <Card className="glass lg:col-span-4">
          <CardContent className="p-3 space-y-3">
            <div className="flex gap-1">
              <Button size="sm" variant={filter === "all" ? "default" : "outline"} className="h-7 text-[10px]" onClick={() => setFilter("all")}>{t("forge.all")}</Button>
              {KINDS.map((k) => (
                <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} className="h-7 text-[10px] capitalize" onClick={() => setFilter(k)}>{t(`forge.${k}` as Parameters<typeof t>[0])}</Button>
              ))}
            </div>
            <div className="max-h-[640px] overflow-auto space-y-3">
              {grouped.length === 0 && <div className="text-xs text-muted-foreground font-mono p-4 text-center">{t("forge.no_actions")}</div>}
              {grouped.map(([cat, list]) => (
                <div key={cat}>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{cat}</p>
                  <div className="space-y-1">
                    {list.map((a) => {
                      const Icon = AGENT_ICON_LOOKUP[a.icon] ?? Zap;
                      return (
                      <button
                        key={a.id}
                        onClick={() => select(a)}
                        className={`w-full text-left border rounded px-2 py-1.5 hover:bg-accent/40 ${activeId === a.id ? "border-primary" : "border-border"}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-6 w-6 rounded flex items-center justify-center shrink-0" style={{ background: `${a.color}20`, color: a.color }}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-xs font-medium truncate flex-1">{a.name}</span>
                          {a.is_system && <Badge variant="outline" className="text-[8px] font-mono">SYS</Badge>}
                          <Badge variant="outline" className="text-[8px] font-mono uppercase">{a.kind}</Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{a.id}</div>
                      </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Editor */}
        <Card className="glass lg:col-span-8">
          <CardContent className="p-4 space-y-4">
            {!draft ? (
              <div className="text-center py-16 text-muted-foreground">
                <Hammer className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">{t("forge.empty_editor")}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] font-mono">{t("forge.id")}</Label>
                    <Input value={draft.id} disabled={draft.is_system} onChange={(e) => setDraft({ ...draft, id: e.target.value })} className="font-mono mt-1" />
                  </div>
                  <div>
                    <Label className="text-[10px] font-mono">{t("forge.kind")}</Label>
                    <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as ForgeKind })}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {KINDS.map((k) => <SelectItem key={k} value={k} className="capitalize">{t(`forge.${k}` as Parameters<typeof t>[0])}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] font-mono">{t("forge.name")}</Label>
                    <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-[10px] font-mono">{t("forge.category")}</Label>
                    <Input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-[10px] font-mono">{t("forge.provider")}</Label>
                    <Input value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} className="mt-1 font-mono" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] font-mono">{t("forge.icon")}</Label>
                    <div className="mt-1">
                      <IconGridPicker value={draft.icon} onChange={(v) => setDraft({ ...draft, icon: v })} color={draft.color} />
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] font-mono">{t("forge.color")}</Label>
                    <ColorPalettePicker value={draft.color} onChange={(v) => setDraft({ ...draft, color: v })} disabled={draft.is_system && !isAdmin} />
                  </div>
                  <div>
                    <Label className="text-[10px] font-mono flex items-center justify-between">
                      <span>Priority</span>
                      <span className="text-amber-400 font-bold">P{draft.priority ?? 5}</span>
                    </Label>
                    <input
                      type="range" min={1} max={10} step={1}
                      value={draft.priority ?? 5}
                      disabled={draft.is_system && !isAdmin}
                      onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
                      className="w-full mt-2 accent-amber-500"
                    />
                    <p className="text-[9px] font-mono text-muted-foreground mt-1">1 = low · 10 = critical. Sort key for picker + approval queue.</p>
                  </div>
                  <div className="flex items-end gap-2">
                    {draft.is_system && <Badge variant="outline" className="text-[10px] font-mono">{t("forge.system_readonly")}</Badge>}
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] font-mono">{t("forge.description")}</Label>
                  <LazyTextarea value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} className="mt-1 text-xs font-mono" rows={2} />
                </div>

                {/* Params */}
                <div className="border-t border-border pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("forge.input_params")}</p>
                    <Button size="sm" variant="outline" className="h-7" onClick={addParam}><Plus className="h-3 w-3 mr-1" />{t("forge.field")}</Button>
                  </div>
                  <div className="space-y-2">
                    {draft.params.map((p, i) => (
                      <div key={i} className="border border-border rounded p-2 grid grid-cols-12 gap-2 items-center">
                        <Input placeholder="key" value={p.key} onChange={(e) => updateParam(i, { key: e.target.value })} className="col-span-3 h-8 text-xs font-mono" />
                        <Input placeholder="label" value={p.label || ""} onChange={(e) => updateParam(i, { label: e.target.value })} className="col-span-3 h-8 text-xs" />
                        <Select value={p.type} onValueChange={(v) => updateParam(i, { type: v as ParamType })}>
                          <SelectTrigger className="col-span-2 h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{PARAM_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input placeholder="default" value={p.default == null ? "" : String(p.default)} onChange={(e) => updateParam(i, { default: e.target.value })} className="col-span-2 h-8 text-xs font-mono" />
                        <div className="col-span-2 flex gap-1 justify-end">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveParam(i, -1)}><ArrowUp className="h-3 w-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveParam(i, 1)}><ArrowDown className="h-3 w-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeParam(i)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                        {p.type === "select" && (
                          <Input
                            placeholder="comma,separated,options"
                            value={(p.options || []).join(",")}
                            onChange={(e) => updateParam(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                            className="col-span-12 h-8 text-xs font-mono"
                          />
                        )}
                      </div>
                    ))}
                    {draft.params.length === 0 && <p className="text-[11px] text-muted-foreground font-mono">{t("forge.no_params")}</p>}
                  </div>
                </div>

                {/* Outputs */}
                <div className="border-t border-border pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("forge.outputs")}</p>
                    <Button size="sm" variant="outline" className="h-7" onClick={addOutput}><Plus className="h-3 w-3 mr-1" />{t("forge.output")}</Button>
                  </div>
                  <div className="space-y-2">
                    {draft.outputs.map((o, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2">
                        <Input placeholder="key" value={o.key} onChange={(e) => updateOutput(i, { key: e.target.value })} className="col-span-5 h-8 text-xs font-mono" />
                        <Input placeholder="label" value={o.label || ""} onChange={(e) => updateOutput(i, { label: e.target.value })} className="col-span-6 h-8 text-xs" />
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeOutput(i)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    ))}
                    {draft.outputs.length === 0 && <p className="text-[11px] text-muted-foreground font-mono">{t("forge.no_outputs")}</p>}
                  </div>
                </div>

                {/* Runtime */}
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("forge.runtime")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] font-mono">Brain (model or provider)</Label>
                      <div className="mt-1">
                        <BrainSelect
                          value={draft.runtime.brain || ""}
                          onChange={(v) => setDraft({ ...draft, runtime: { ...draft.runtime, brain: v } })}
                          disabled={draft.is_system && !isAdmin}
                        />
                      </div>
                      <p className="text-[9px] font-mono text-muted-foreground mt-1">Optional — falls back to caller's brain.</p>
                    </div>
                    <div>
                      <Label className="text-[10px] font-mono">Interpreter (Python)</Label>
                      <div className="mt-1">
                        <InterpreterSelect
                          value={draft.runtime.interpreter || ""}
                          onChange={(v) => setDraft({ ...draft, runtime: { ...draft.runtime, interpreter: v } })}
                          disabled={(draft.is_system && !isAdmin) || draft.runtime.handler !== "python"}
                        />
                      </div>
                      <p className="text-[9px] font-mono text-muted-foreground mt-1">Used only when handler is python.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-[10px] font-mono">{t("forge.handler")}</Label>
                      <Select value={draft.runtime.handler} onValueChange={(v) => setDraft({ ...draft, runtime: { ...draft.runtime, handler: v as "builtin" | "http" | "noop" | "python" } })}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="builtin">builtin (server op)</SelectItem>
                          <SelectItem value="http">http (external)</SelectItem>
                          <SelectItem value="python">python (local script)</SelectItem>
                          <SelectItem value="noop">noop (test)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {draft.runtime.handler === "builtin" && (
                      <div className="col-span-2">
                        <Label className="text-[10px] font-mono">{t("forge.op")}</Label>
                        <Input value={draft.runtime.op || ""} onChange={(e) => setDraft({ ...draft, runtime: { ...draft.runtime, op: e.target.value } })} className="mt-1 font-mono" placeholder="e.g. mail.read" />
                      </div>
                    )}
                    {draft.runtime.handler === "python" && (
                      <div className="col-span-2">
                        <Label className="text-[10px] font-mono flex items-center justify-between">
                          <span>Script path (absolute, .py)</span>
                          {draft.runtime.orphan && (
                            <span className="flex items-center gap-1 text-destructive text-[10px]">
                              <AlertTriangle className="h-3 w-3" /> file missing on disk
                            </span>
                          )}
                        </Label>
                        <div className="mt-1 flex gap-1">
                          <Input
                            value={draft.runtime.script || ""}
                            onChange={(e) => setDraft({ ...draft, runtime: { ...draft.runtime, script: e.target.value } })}
                            className="font-mono text-xs"
                            placeholder="/abs/path/to/tool.py"
                          />
                          <Button type="button" size="sm" variant="outline" onClick={() => setScriptPickerOpen(true)}>
                            <FolderOpen className="h-3 w-3 mr-1" /> Browse
                          </Button>
                        </div>
                        <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">
                          Runs via the disk runner — any directory allowed, script's own cwd is used.
                        </p>
                      </div>
                    )}
                    {draft.runtime.handler === "http" && (
                      <>
                        <div>
                          <Label className="text-[10px] font-mono">{t("forge.method")}</Label>
                          <Input value={draft.runtime.method || "POST"} onChange={(e) => setDraft({ ...draft, runtime: { ...draft.runtime, method: e.target.value } })} className="mt-1 font-mono" />
                        </div>
                        <div>
                          <Label className="text-[10px] font-mono">{t("forge.url_tpl")}</Label>
                          <Input value={draft.runtime.url || ""} onChange={(e) => setDraft({ ...draft, runtime: { ...draft.runtime, url: e.target.value } })} className="mt-1 font-mono" placeholder="https://api.x.com/{{params.id}}" />
                        </div>
                        <div className="col-span-3">
                          <Label className="text-[10px] font-mono">{t("forge.body_tpl")} (use {`{{params.x}}`} / {`{{ctx.y}}`})</Label>
                          <LazyTextarea value={draft.runtime.body || ""} onChange={(v) => setDraft({ ...draft, runtime: { ...draft.runtime, body: v } })} className="mt-1 font-mono text-xs" rows={3} />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Adapters — tool_adapter_bindings; mirrored from Tools/Config. */}
                <div className="border-t border-border pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <Plug className="h-3.5 w-3.5" /> Adapters ({adapters.length})
                    </p>
                    <Select
                      value=""
                      onValueChange={(v) => {
                        if (!v || adapters.some((a) => a.adapter_id === v)) return;
                        setAdapters((arr) => [...arr, { adapter_id: v, enabled: true }]);
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
                  <p className="text-[10px] text-muted-foreground/70">
                    Multi-select. Tool can fan-out across any bound adapter. Vault + risk inherited from the adapter.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {adapters.length === 0 && (
                      <p className="text-[10px] font-mono text-muted-foreground/60">No adapters bound · tool runs standalone.</p>
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
                            onClick={() => setAdapters((arr) => arr.filter((x) => x.adapter_id !== b.adapter_id))}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                {/* Targets — tool_target_bindings; mirrored from Tools/Config. */}
                <div className="border-t border-border pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <Crosshair className="h-3.5 w-3.5" /> Targets ({targets.length})
                    </p>
                    <div className="flex gap-1">
                      <Select
                        value=""
                        onValueChange={(v) => {
                          if (!v || targets.some((t) => t.scope === "group" && t.ref_id === v)) return;
                          setTargets((arr) => [...arr, { scope: "group", ref_id: v, enabled: true }]);
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
                          if (!v || targets.some((t) => t.scope === "target" && t.ref_id === v)) return;
                          setTargets((arr) => [...arr, { scope: "target", ref_id: v, enabled: true }]);
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
                  <p className="text-[10px] text-muted-foreground/70">
                    Bind whole groups or individual hosts. Orchestrator routes invocations through these.
                  </p>
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
                            onClick={() => setTargets((arr) => arr.filter((x) => !(x.scope === b.scope && x.ref_id === b.ref_id)))}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                {/* Execution Policy — strict enforcement for Tools */}
                <div className="border-t border-border pt-3">
                  <ExecutionPolicyForm
                    value={sanitizePolicy(draft.execution_policy ?? DEFAULT_POLICY)}
                    onChange={(p) => setDraft({ ...draft, execution_policy: p })}
                    disabled={draft.is_system && !isAdmin}
                  />
                </div>

                {/* Actions */}
                <div className="border-t border-border pt-3 flex justify-between">
                  <Button variant="outline" className="text-destructive" onClick={remove} disabled={draft.is_system && !isAdmin}>
                    <Trash2 className="h-4 w-4 mr-1" />{t("forge.delete")}
                  </Button>
                  <Button onClick={save} className="bg-gradient-primary text-primary-foreground">
                    <Save className="h-4 w-4 mr-1" />{t("skills.seal")} → PostgreSQL
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <MacFilePicker
        open={scriptPickerOpen}
        onOpenChange={setScriptPickerOpen}
        accept={[".py"]}
        initialPath={draft?.runtime.script ? draft.runtime.script.replace(/\/[^/]+$/, "") : undefined}
        onPick={(abs) => setDraft((d) => d ? { ...d, runtime: { ...d.runtime, script: abs, orphan: false } } : d)}
        title="Pick a Python script"
        description="Select the .py file this tool should run. Absolute paths only."
      />
    </PageShell>
  );
}
