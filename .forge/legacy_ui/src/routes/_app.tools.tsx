import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunHistoryTable } from "@/components/run-history-table";
import { McpExposedBadge } from "@/components/mcp-exposed-badge";
import { Hammer, RefreshCw, Settings2, Wrench, Zap, ExternalLink, Package, Check, Copy, Link2, Trash2, Plug, Crosshair, X, ShieldCheck, ShieldOff, Plus, Search } from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { IntentBridgeAPI } from "@/lib/api-client";
import {
  ForgeAPI, CapabilityPacksAPI, AdaptersAPI, TargetsAPI, TargetGroupsAPI, ToolBindingsAPI,
  ToolApprovalsAPI, ToolInvocationsAPI,
  type ActionDef, type ParamSchema, type CapabilityPack, type UserCapability,
  type AdapterRow, type TargetRow, type TargetGroupRow,
  type AgentAdapterBinding, type AgentTargetBinding,
  type ToolApprovalRow, type ToolInvocationRow,
} from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { useRbac } from "@/lib/rbac";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/tools")({ component: ToolsPage });

const LS_KEY = "tools.overrides.v1";
const LS_HIDDEN_KEY = "tools.hidden.v1";

interface ToolOverride {
  enabled: boolean;
  paramDefaults: Record<string, unknown>;
}
type Overrides = Record<string, ToolOverride>;

const loadOverrides = (): Overrides => {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}"); } catch { return {}; }
};
const saveOverrides = (o: Overrides) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(o));
};

const loadHidden = (): string[] => {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(LS_HIDDEN_KEY) ?? "[]"); } catch { return []; }
};
const saveHidden = (ids: string[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_HIDDEN_KEY, JSON.stringify(ids));
};

/** Read by chat to know which tools the assistant may auto-trigger. */
export function getEnabledTools(actions: ActionDef[]): ActionDef[] {
  const ov = loadOverrides();
  const hidden = new Set(loadHidden());
  return actions.filter((a) => a.kind === "action" && !hidden.has(a.id) && (ov[a.id]?.enabled ?? true));
}


function ToolsPage() {
  const { t } = useI18n();
  const { isAdmin } = useRbac();
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [overrides, setOverrides] = useState<Overrides>(() => loadOverrides());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(loadHidden()));
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configOf, setConfigOf] = useState<ActionDef | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [denied, setDenied] = useState<Set<string>>(new Set());

  const loadDenied = async () => {
    try {
      const r = await IntentBridgeAPI.getToolsDenylist();
      setDenied(new Set(r.denied ?? []));
    } catch { /* bridge down — show all armed */ }
  };
  useEffect(() => { loadDenied(); }, []);

  const toggleArm = async (a: ActionDef) => {
    const next = new Set(denied);
    const willDisarm = !next.has(a.id);
    if (willDisarm) next.add(a.id); else next.delete(a.id);
    setDenied(next); // optimistic
    try {
      await IntentBridgeAPI.setToolsDenylist([...next]);
      toast.success(willDisarm ? `${a.name} disarmed (blocked from auto-trigger)` : `${a.name} armed`);
    } catch (e) {
      // rollback
      const rb = new Set(denied);
      setDenied(rb);
      toast.error(`Arm/disarm failed: ${(e as Error).message}`);
    }
  };

  const hideAction = (a: ActionDef) => {
    if (!confirm(`Hide "${a.name}" from this panel?\n\nThis is a local view-only action. The tool stays in Forge and the database — to delete it permanently, open Forge.`)) return;
    setHidden((prev) => {
      const n = new Set(prev); n.add(a.id);
      saveHidden([...n]);
      return n;
    });
    toast.success(`Hidden: ${a.name} · permanent delete in Forge`);
  };

  const unhideAction = (id: string, name?: string) => {
    setHidden((prev) => {
      const n = new Set(prev); n.delete(id);
      saveHidden([...n]);
      return n;
    });
    toast.success(`Restored${name ? `: ${name}` : ""}`);
  };


  const refresh = async () => {
    setLoading(true);
    try {
      const list = await ForgeAPI.list({ kind: "action" });
      setActions(list);
    } catch (e) {
      toast.error(`Forge bridge unreachable: ${(e as Error).message}`);
      setActions([]);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  useEffect(() => { saveOverrides(overrides); }, [overrides]);

  const toggle = (id: string, v: boolean) =>
    setOverrides((o) => ({ ...o, [id]: { enabled: v, paramDefaults: o[id]?.paramDefaults ?? {} } }));

  const visibleActions = useMemo(
    () => (showHidden ? actions : actions.filter((a) => !hidden.has(a.id))),
    [actions, hidden, showHidden],
  );

  const enabledCount = useMemo(
    () => visibleActions.filter((a) => overrides[a.id]?.enabled ?? true).length,
    [visibleActions, overrides],
  );

  const hiddenCount = useMemo(
    () => actions.filter((a) => hidden.has(a.id)).length,
    [actions, hidden],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, ActionDef[]>();
    for (const a of visibleActions) {
      const arr = m.get(a.category) ?? []; arr.push(a); m.set(a.category, arr);
    }
    // Sort within each category by priority DESC, then name ASC (mirrors server ORDER BY).
    for (const arr of m.values()) {
      arr.sort((x, y) => (Number(y.priority ?? 5) - Number(x.priority ?? 5)) || x.name.localeCompare(y.name));
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visibleActions]);


  const persistConfig = async (a: ActionDef, paramDefaults: Record<string, unknown>) => {
    // 1) Local override (used by chat for auto-inference fallback)
    setOverrides((o) => ({ ...o, [a.id]: { enabled: o[a.id]?.enabled ?? true, paramDefaults } }));
    // 2) Persist as new param defaults in Forge — sealed in PostgreSQL
    if (a.is_system) {
      toast.message("System tool — defaults saved locally only");
      return;
    }
    try {
      await ForgeAPI.save({
        id: a.id, kind: a.kind, name: a.name, category: a.category,
        provider: a.provider, icon: a.icon, color: a.color,
        description: a.description,
        params: a.params.map((p) => ({ ...p, default: paramDefaults[p.key] ?? p.default })),
        outputs: a.outputs, runtime: a.runtime, priority: a.priority,
      });
      toast.success(`"${a.name}" sealed to PostgreSQL`);
      refresh();
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title={t("page.tools.title")}
        subtitle={`Synced with Forge · ${actions.length} tool${actions.length === 1 ? "" : "s"} · ${enabledCount} enabled${hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""} · Trash = hide from this panel only (view-only); permanent delete lives in Forge`}
        actions={
          <div className="flex gap-2">
            {hiddenCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="h-3.5 w-3.5 mr-1" />{t("tools.sync")}</Button>
            <Button className="bg-gradient-primary text-primary-foreground" size="sm" onClick={() => setPickerOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />New Tool</Button>
            <Link to="/forge"><Button variant="outline" size="sm"><Hammer className="h-3.5 w-3.5 mr-1" />{t("tools.open_forge")}</Button></Link>
          </div>
        }
      />


      {/* Capability packs now live in System Engine → Capabilities (single source of truth). */}

      <Tabs defaultValue="library" className="mt-2">
        <TabsList>
          <TabsTrigger value="library">Library · {actions.length}</TabsTrigger>
          <TabsTrigger value="history">Run History</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="space-y-4">
          <ToolTelemetryPanel isAdmin={isAdmin} />

          {loading && <p className="text-xs font-mono text-muted-foreground mb-3">Reading <code>action_library</code> from /api/forge/actions …</p>}

          {!loading && actions.length === 0 && (
            <Card className="glass">
              <CardContent className="p-6 text-xs font-mono text-muted-foreground space-y-2">
                <p>No actions sealed in <code>action_library</code> yet.</p>
                <p>Forge is the single source of truth — every action you create there shows up here automatically as a tool card.</p>
                <Link to="/forge"><Button size="sm" variant="outline"><Hammer className="h-3.5 w-3.5 mr-1" />Forge an action</Button></Link>
              </CardContent>
            </Card>
          )}

          <div className="space-y-6">
            {grouped.map(([cat, list]) => (
              <div key={cat}>
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">{cat}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {list.map((a) => {
                    const ov = overrides[a.id];
                    const enabled = ov?.enabled ?? true;
                    const isHidden = hidden.has(a.id);
                    return (
                      <Card key={a.id} className={`glass ${enabled ? "" : "opacity-60"} ${isHidden ? "ring-1 ring-dashed ring-muted-foreground/30" : ""}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-10 w-10 rounded flex items-center justify-center" style={{ background: a.color, boxShadow: `0 0 18px -4px ${a.color}` }}>
                                <Wrench className="h-5 w-5 text-white" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold font-mono text-sm truncate">{a.name}</p>
                                <p className="text-[10px] text-muted-foreground font-mono truncate">{a.id}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className={`h-7 w-7 ${denied.has(a.id) ? "text-red-400 hover:text-red-300" : "text-emerald-400 hover:text-emerald-300"}`}
                                title={denied.has(a.id) ? "Disarmed · click to arm (allow auto-trigger)" : "Armed · click to disarm (block auto-trigger)"}
                                onClick={() => toggleArm(a)}
                              >
                                {denied.has(a.id) ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                              </Button>
                              <Switch checked={enabled} onCheckedChange={(v) => toggle(a.id, v)} />
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1">
                            {a.is_system && <Badge variant="outline" className="text-[8px] font-mono">SYS</Badge>}
                            {isHidden && <Badge variant="outline" className="text-[8px] font-mono text-muted-foreground">HIDDEN</Badge>}
                            {a.runtime.orphan && (
                              <Badge variant="outline" className="text-[8px] font-mono text-destructive border-destructive/40" title="Source script not found on disk">ORPHAN</Badge>
                            )}
                            {denied.has(a.id) && <Badge variant="outline" className="text-[8px] font-mono text-red-400 border-red-500/40">DISARMED</Badge>}
                            <Badge variant="outline" className="text-[8px] font-mono text-amber-400 border-amber-500/40">P{a.priority ?? 5}</Badge>
                            {a.risk_level && a.risk_level !== "low" && (
                              <Badge variant="outline" className={`text-[8px] font-mono ${a.risk_level === "critical" ? "text-red-400 border-red-500/40" : a.risk_level === "high" ? "text-orange-400 border-orange-500/40" : "text-yellow-400 border-yellow-500/40"}`}>{a.risk_level}</Badge>
                            )}
                            {a.requires_approval && <Badge variant="outline" className="text-[8px] font-mono text-amber-400 border-amber-500/40">approval</Badge>}
                            <Badge variant="outline" className="text-[8px] font-mono">{a.runtime.handler}</Badge>
                            {a.runtime.handler === "python" && a.runtime.script && (
                              <Badge variant="outline" className="text-[8px] font-mono text-primary border-primary/40 max-w-[180px] truncate" title={a.runtime.script}>
                                {a.runtime.script.split("/").pop()}
                              </Badge>
                            )}
                            {a.provider && <Badge variant="outline" className="text-[8px] font-mono">{a.provider}</Badge>}
                            <Badge variant="outline" className="text-[8px] font-mono">{a.params.length} param{a.params.length === 1 ? "" : "s"}</Badge>
                            <McpExposedBadge kind="tool" slug={a.id} />
                            {enabled && !isHidden && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-mono text-emerald-400">
                                <Zap className="h-2.5 w-2.5" /> auto-infer
                              </span>
                            )}
                          </div>

                          {a.description && <p className="text-[11px] text-muted-foreground line-clamp-2">{a.description}</p>}

                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => setConfigOf(a)}>
                              <Settings2 className="h-3 w-3 mr-1" /> Config
                            </Button>
                            <Link to="/forge" className="flex-1">
                              <Button size="sm" variant="outline" className="w-full">
                                <ExternalLink className="h-3 w-3 mr-1" /> Forge
                              </Button>
                            </Link>
                            {isHidden ? (
                              <Button
                                size="sm"
                                variant="outline"
                                title="Restore to panel"
                                onClick={() => unhideAction(a.id, a.name)}
                              >
                                <RefreshCw className="h-3 w-3" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive"
                                title="Hide from this panel (view-only) · permanent delete in Forge"
                                onClick={() => hideAction(a)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}


                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <RunHistoryTable limit={100} sources={["tool-call"]} showTool showAgent={false} />
        </TabsContent>
      </Tabs>

      <ConfigDialog
        action={configOf}
        initial={configOf ? overrides[configOf.id]?.paramDefaults ?? {} : {}}
        onClose={() => setConfigOf(null)}
        onSave={(vals) => { if (configOf) { persistConfig(configOf, vals); setConfigOf(null); } }}
      />

      <ToolPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        existingIds={new Set(actions.map((a) => a.id))}
        onPicked={async (picked) => {
          setPickerOpen(false);
          // If picked item is not already a Tools-visible action (kind !== "action"),
          // flip it so it appears in the panel — operator confirmed by clicking Add.
          if (picked.kind !== "action") {
            try {
              const { is_system: _is, updated_at: _ua, ...rest } = picked;
              void _is; void _ua;
              await ForgeAPI.save({ ...rest, kind: "action" });
              toast.success(`"${picked.name}" promoted to Tools (kind=action)`);
              await refresh();
              const fresh = await ForgeAPI.get(picked.id).catch(() => null);
              setConfigOf(fresh || { ...picked, kind: "action" });
            } catch (e) {
              toast.error(`Promote failed: ${(e as Error).message}`);
            }
            return;
          }
          // Already an action — open Config dialog directly.
          setConfigOf(picked);
        }}
      />
    </PageShell>
  );
}

function ToolPickerDialog({
  open, onClose, existingIds, onPicked,
}: {
  open: boolean;
  onClose: () => void;
  existingIds: Set<string>;
  onPicked: (a: ActionDef) => void;
}) {
  const [all, setAll] = useState<ActionDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "trigger" | "action" | "logic" | "output">("all");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    ForgeAPI.list()
      .then((r) => setAll(r))
      .catch((e) => toast.error(`Forge load: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((a) => kindFilter === "all" || a.kind === kindFilter)
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || (a.category || "").toLowerCase().includes(q))
      .sort((x, y) => x.name.localeCompare(y.name));
  }, [all, search, kindFilter]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Pick a tool from Forge library</DialogTitle>
          <DialogDescription>
            Selecting an item opens its Config dialog. Non-action kinds are promoted to <code>action</code> so they appear in this panel.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search name / id / category"
              className="h-8 pl-7 text-xs font-mono"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as typeof kindFilter)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="trigger">trigger</SelectItem>
              <SelectItem value="action">action</SelectItem>
              <SelectItem value="logic">logic</SelectItem>
              <SelectItem value="output">output</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto border border-border rounded">
          {loading && <p className="p-4 text-xs font-mono text-muted-foreground">Loading Forge library…</p>}
          {!loading && filtered.length === 0 && (
            <p className="p-4 text-xs font-mono text-muted-foreground">No matches.</p>
          )}
          <ul className="divide-y divide-border/40">
            {filtered.map((a) => {
              const already = existingIds.has(a.id);
              return (
                <li key={a.id} className="p-2 flex items-center gap-2 hover:bg-muted/30">
                  <div className="h-8 w-8 rounded flex items-center justify-center shrink-0" style={{ background: a.color }}>
                    <Wrench className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs truncate">{a.name}</span>
                      <Badge variant="outline" className="text-[8px] font-mono">{a.kind}</Badge>
                      {a.is_system && <Badge variant="outline" className="text-[8px] font-mono">SYS</Badge>}
                      {already && <Badge variant="outline" className="text-[8px] font-mono text-emerald-400 border-emerald-500/40">in panel</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">{a.id}{a.category ? ` · ${a.category}` : ""}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onPicked(a)}>
                    {already ? "Config" : a.kind === "action" ? "Add" : "Promote + Add"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Link to="/forge" search={{ new: 1 }} onClick={onClose} className="text-[11px] font-mono text-primary hover:underline">
            Create blank in Forge →
          </Link>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function ConfigDialog({
  action, initial, onClose, onSave,
}: {
  action: ActionDef | null;
  initial: Record<string, unknown>;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [savingSysPrompt, setSavingSysPrompt] = useState(false);
  const [adapterList, setAdapterList] = useState<AdapterRow[]>([]);
  const [targetList, setTargetList] = useState<TargetRow[]>([]);
  const [groupList, setGroupList] = useState<TargetGroupRow[]>([]);
  const [adapters, setAdapters] = useState<AgentAdapterBinding[]>([]);
  const [targets, setTargets] = useState<AgentTargetBinding[]>([]);
  const [bindingsBusy, setBindingsBusy] = useState(false);

  useEffect(() => {
    if (!action) return;
    const seed: Record<string, unknown> = {};
    for (const p of action.params) {
      seed[p.key] = (initial[p.key] !== undefined) ? initial[p.key] : (p.default ?? "");
    }
    setVals(seed);
    setSystemPrompt(action.system_prompt ?? "");
  }, [action, initial]);

  useEffect(() => {
    if (!action) return;
    let cancelled = false;
    (async () => {
      const [ad, tg, gr, ab, tb] = await Promise.all([
        AdaptersAPI.list(),
        TargetsAPI.list(),
        TargetGroupsAPI.list(),
        ToolBindingsAPI.adapterList(action.id),
        ToolBindingsAPI.targetList(action.id),
      ]);
      if (cancelled) return;
      setAdapterList(ad.items || []);
      setTargetList(tg.items || []);
      setGroupList(gr.items || []);
      setAdapters(ab.items || []);
      setTargets(tb.items || []);
    })();
    return () => { cancelled = true; };
  }, [action]);

  if (!action) return null;
  const set = (k: string, v: unknown) => setVals((s) => ({ ...s, [k]: v }));

  const handleSave = async () => {
    if (!action) return;
    setBindingsBusy(true);
    try {
      await Promise.all([
        ToolBindingsAPI.adapterSave(action.id, adapters).catch((e) => toast.error(`Adapter save: ${(e as Error).message}`)),
        ToolBindingsAPI.targetSave(action.id, targets).catch((e) => toast.error(`Target save: ${(e as Error).message}`)),
      ]);
      // Persist system_prompt change via Forge save (full action minus is_system/updated_at).
      if ((action.system_prompt ?? "") !== systemPrompt) {
        setSavingSysPrompt(true);
        try {
          const { is_system: _is, updated_at: _ua, ...rest } = action;
          void _is; void _ua;
          await ForgeAPI.save({ ...rest, system_prompt: systemPrompt });
          toast.success("Tool system prompt sealed");
        } catch (e) {
          toast.error(`System prompt: ${(e as Error).message}`);
        } finally {
          setSavingSysPrompt(false);
        }
      }
    } finally {
      setBindingsBusy(false);
    }
    onSave(vals);
  };

  return (
    <Dialog open={!!action} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure · {action.name}</DialogTitle>
          <DialogDescription>
            Defaults sealed into the Forge action so chat / chains / agents inherit them. Use <code>{`{{params.x}}`}</code> in runtime templates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {action.params.length === 0 && (
            <p className="text-xs font-mono text-muted-foreground">This action declares no parameters. Define them in <Link to="/forge" className="text-primary underline">Forge</Link>.</p>
          )}
          {action.params.map((p) => <ParamField key={p.key} p={p} value={vals[p.key]} onChange={(v) => set(p.key, v)} />)}
        </div>

        {/* Tool System Prompt — prepended to LLM system messages when this tool is invoked. */}
        <div className="border-t border-border pt-4 space-y-2 mt-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Tool System Prompt
            </Label>
            {savingSysPrompt && <span className="text-[10px] font-mono text-muted-foreground">saving…</span>}
          </div>
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Tool-specific instructions injected into the model's system prompt before this tool runs (e.g. 'Always cite source IP, never invent flags.')."
            className="min-h-[100px] font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-[10px] text-muted-foreground/70">
            Sealed into <code>action_library.system_prompt</code>. Inherited by agents, chains, and chat tool calls.
          </p>
        </div>



        {/* Adapters — tool_adapter_bindings; runtime injects bound adapters. */}
        <div className="border-t border-border pt-4 space-y-2 mt-4">
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
            Multi-select. Tool can fan-out across any bound adapter (X, LinkedIn, Instagram, Checkpoint, Forti…). Vault + risk inherited from the adapter.
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

        {/* Targets — tool_target_bindings. */}
        <div className="border-t border-border pt-4 space-y-2 mt-4">
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
            Bind whole groups or individual hosts. Orchestrator will route invocations through these.
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-gradient-primary text-primary-foreground" disabled={bindingsBusy} onClick={handleSave}>
            {bindingsBusy ? "Saving…" : t("tools.seal_defaults")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ParamField({ p, value, onChange }: { p: ParamSchema; value: unknown; onChange: (v: unknown) => void }) {
  const v = value === undefined ? "" : value;
  const label = (
    <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      {p.label || p.key} <span className="opacity-60 normal-case">· {p.type}</span>
    </Label>
  );
  if (p.type === "boolean") {
    return (
      <div className="flex items-center justify-between border border-border rounded p-2">
        {label}
        <Switch checked={Boolean(v)} onCheckedChange={onChange} />
      </div>
    );
  }
  if (p.type === "select") {
    return (
      <div>{label}
        <Select value={String(v ?? "")} onValueChange={onChange}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {(p.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (p.type === "textarea" || p.type === "json") {
    return (
      <div>{label}
        <Textarea value={String(v ?? "")} onChange={(e) => onChange(e.target.value)} className="mt-1 font-mono text-xs" rows={4} placeholder={p.placeholder} />
      </div>
    );
  }
  return (
    <div>{label}
      <Input
        type={p.type === "number" ? "number" : p.type === "secret" ? "password" : "text"}
        value={String(v ?? "")}
        onChange={(e) => onChange(p.type === "number" ? Number(e.target.value) : e.target.value)}
        className="mt-1 font-mono text-xs"
        placeholder={p.placeholder}
      />
    </div>
  );
}

// ============================================================
// Capability Packs Panel — sectoral templates per user
// ============================================================
function CapabilityPacksPanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const username = user?.username ?? "";
  const [packs, setPacks] = useState<CapabilityPack[]>([]);
  const [mine, setMine] = useState<UserCapability[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    CapabilityPacksAPI.list().then(setPacks).catch(() => setPacks([]));
    if (username) CapabilityPacksAPI.listMine(username).then(setMine).catch(() => setMine([]));
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [username]);

  const activePackIds = new Set(mine.filter((m) => m.pack_id && m.enabled).map((m) => m.pack_id!));

  const activate = async (p: CapabilityPack, mode: "reference" | "clone") => {
    if (!username) return toast.error("Sign in to activate capability packs");
    setBusy(p.id);
    try {
      const r = await CapabilityPacksAPI.activatePack(username, p.id, mode);
      toast.success(`"${p.name}" activated · ${r.activated} action${r.activated === 1 ? "" : "s"} · ${mode}`);
      refresh(); onChanged();
    } catch (e) { toast.error(`Activation failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };
  const deactivate = async (p: CapabilityPack) => {
    if (!username) return;
    setBusy(p.id);
    try {
      await CapabilityPacksAPI.deactivatePack(username, p.id);
      toast.success(`"${p.name}" deactivated`);
      refresh(); onChanged();
    } catch (e) { toast.error(`Deactivate failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  if (!packs.length) return null;

  return (
    <Card className="glass mb-4">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <p className="text-sm font-mono uppercase tracking-widest">{t("tools.cap_packs")}</p>
            <Badge variant="outline" className="text-[9px] font-mono">
              {username ? `${activePackIds.size}/${packs.length} active` : "anonymous · sign in to activate"}
            </Badge>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground">
            Sectoral inventories sealed in PostgreSQL · Reference (link) or Clone (copy-on-write)
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          {packs.map((p) => {
            const isActive = activePackIds.has(p.id);
            return (
              <div key={p.id} className={`border rounded p-2 space-y-2 ${isActive ? "border-emerald-500/50 bg-emerald-500/5" : "border-border"}`}>
                <div className="flex items-start gap-2">
                  <div className="h-8 w-8 rounded flex items-center justify-center shrink-0" style={{ background: p.color }}>
                    <Package className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-bold truncate">{p.name}</p>
                    <p className="text-[9px] font-mono text-muted-foreground uppercase">{p.sector} · {p.action_ids.length} actions</p>
                  </div>
                  {isActive && <Check className="h-4 w-4 text-emerald-400" />}
                </div>
                <p className="text-[10px] text-muted-foreground line-clamp-2">{p.description}</p>
                <div className="flex gap-1">
                  {isActive ? (
                    <Button size="sm" variant="outline" className="h-7 flex-1 text-[10px]" disabled={busy === p.id} onClick={() => deactivate(p)}>
                      Deactivate
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" className="h-7 flex-1 text-[10px]" disabled={!username || busy === p.id} onClick={() => activate(p, "reference")}>
                        <Link2 className="h-3 w-3 mr-1" />Link
                      </Button>
                      <Button size="sm" className="h-7 flex-1 text-[10px] bg-gradient-primary text-primary-foreground" disabled={!username || busy === p.id} onClick={() => activate(p, "clone")}>
                        <Copy className="h-3 w-3 mr-1" />Clone
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// ToolTelemetryPanel — recent invocations + pending approvals bridge.
// Read-only; gives operators visibility into what's running and what's waiting.
// ============================================================================
function ToolTelemetryPanel({ isAdmin }: { isAdmin: boolean }) {
  const [invocations, setInvocations] = useState<ToolInvocationRow[]>([]);
  const [pending, setPending] = useState<ToolApprovalRow[]>([]);
  const [adapters, setAdapters] = useState<AdapterRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [inv, pen, ad] = await Promise.all([
        ToolInvocationsAPI.list({ limit: 10 }),
        isAdmin ? ToolApprovalsAPI.pending() : Promise.resolve({ items: [] }),
        AdaptersAPI.list(),
      ]);
      setInvocations(inv.items);
      setPending(pen.items);
      setAdapters(ad.items || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); const id = setInterval(refresh, 15000); return () => clearInterval(id); }, [isAdmin]);

  const stats = useMemo(() => {
    const total = invocations.length;
    const ok = invocations.filter((i) => i.status === "ok" || i.status === "success").length;
    const failed = invocations.filter((i) => i.status === "error" || i.status === "failed").length;
    const durRows = invocations.filter((i) => i.duration_ms);
    const avg = durRows.reduce((a, i) => a + (i.duration_ms || 0), 0) / Math.max(1, durRows.length);
    const adEnabled = adapters.filter((a) => a.enabled !== false).length;
    const adDead = adapters.filter((a) => a.enabled === false);
    return { total, ok, failed, avg: Math.round(avg), adEnabled, adTotal: adapters.length, adDead };
  }, [invocations, adapters]);

  return (
    <Card className="glass mb-4">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-mono uppercase tracking-widest">Tool Telemetry</span>
            <Badge variant="outline" className="text-[9px] font-mono">last {stats.total}</Badge>
            <Badge variant="outline" className="text-[9px] font-mono text-emerald-400 border-emerald-500/40">{stats.ok} ok</Badge>
            {stats.failed > 0 && <Badge variant="outline" className="text-[9px] font-mono text-red-400 border-red-500/40">{stats.failed} failed</Badge>}
            {stats.avg > 0 && <Badge variant="outline" className="text-[9px] font-mono">avg {stats.avg}ms</Badge>}
            {stats.adTotal > 0 && (
              <Badge variant="outline" className={`text-[9px] font-mono ${stats.adDead.length > 0 ? "text-red-400 border-red-500/40" : "text-emerald-400 border-emerald-500/40"}`}
                title={stats.adDead.length ? `Disabled: ${stats.adDead.map(a => a.name).join(", ")}` : "All adapters enabled"}>
                adapters {stats.adEnabled}/{stats.adTotal}
              </Badge>
            )}
            {isAdmin && pending.length > 0 && (
              <Link to="/approvals">
                <Badge variant="outline" className="text-[9px] font-mono text-amber-400 border-amber-500/40 hover:bg-amber-500/10 cursor-pointer">
                  {pending.length} pending approval{pending.length === 1 ? "" : "s"} →
                </Badge>
              </Link>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {invocations.length === 0 ? (
          <p className="text-[10px] font-mono text-muted-foreground">No recent tool invocations.</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {invocations.map((i) => {
              const ok = i.status === "ok" || i.status === "success";
              const failed = i.status === "error" || i.status === "failed";
              return (
                <div key={i.id} className="flex items-center gap-2 text-[10px] font-mono px-2 py-1 rounded hover:bg-accent/30">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${ok ? "bg-emerald-400" : failed ? "bg-red-400" : "bg-amber-400"}`} />
                  <span className="flex-1 truncate">{i.tool_id}</span>
                  {i.adapter && <Badge variant="outline" className="text-[8px] font-mono px-1 py-0">{i.adapter}</Badge>}
                  {i.agent_id && <span className="text-muted-foreground truncate max-w-[120px]">@{i.agent_id}</span>}
                  {i.duration_ms != null && <span className="text-muted-foreground">{i.duration_ms}ms</span>}
                  <Badge variant="outline" className={`text-[8px] font-mono px-1 py-0 ${ok ? "text-emerald-400 border-emerald-500/40" : failed ? "text-red-400 border-red-500/40" : ""}`}>{i.status}</Badge>
                  <span className="text-muted-foreground shrink-0">{i.started_at ? new Date(i.started_at).toLocaleTimeString() : ""}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
