import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Plug, Pencil, Trash2, Zap, RotateCcw,
  Globe, Terminal, Code2, Workflow, Boxes, Cpu, KeyRound,
  ChevronDown, ChevronRight, Tags, Network, PlayCircle, X, Check,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AdaptersAPI, VaultAPI, AdapterDictAPI,
  type AdapterRow, type AdapterRunner, type AdapterCategory,
  type ConnectionType, type VaultItem, type AdapterDictItem, type AdapterDictKind,
} from "@/lib/api-client";

export const Route = createFileRoute("/_app/adapters")({ component: AdaptersPage });

const RISKS = ["low", "medium", "high", "critical"] as const;

const RUNNER_ICON: Record<string, typeof Globe> = {
  http: Globe,
  python: Code2,
  shell: Terminal,
  mcp: Boxes,
  forge: Workflow,
  builtin: Cpu,
};

const RISK_TONE: Record<string, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  high: "bg-destructive/15 text-destructive border-destructive/30",
  critical: "bg-destructive/25 text-destructive border-destructive/50",
};

interface FormState {
  id?: string;
  name: string;
  description: string;
  adapter: AdapterRunner;
  category: AdapterCategory;
  connection_type: ConnectionType;
  risk_level: typeof RISKS[number];
  requires_approval: boolean;
  enabled: boolean;
  tags: string;
  config: string;
  vault_scope: string;
  vault_name: string;
  vault_field: string;
}

const emptyForm = (): FormState => ({
  name: "", description: "", adapter: "http" as AdapterRunner, category: "cloud" as AdapterCategory,
  connection_type: "rest_token" as ConnectionType, risk_level: "low", requires_approval: false,
  enabled: true, tags: "", config: "{}", vault_scope: "", vault_name: "", vault_field: "",
});

function AdaptersPage() {
  const [items, setItems] = useState<AdapterRow[]>([]);
  const [vault, setVault] = useState<VaultItem[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [dicts, setDicts] = useState<AdapterDictItem[]>([]);
  const [editingDictId, setEditingDictId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [addingKind, setAddingKind] = useState<AdapterDictKind | null>(null);
  const [addValue, setAddValue] = useState("");
  const [addLabel, setAddLabel] = useState("");
  const [dictPanelOpen, setDictPanelOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("adapters.dict.open") !== "0"; } catch { return true; }
  });
  const [highlightKind, setHighlightKind] = useState<AdapterDictKind | null>(null);
  const dictCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const refresh = async () => {
    const r = await AdaptersAPI.list();
    setItems(r.items);
    const v = await VaultAPI.list();
    setVault(v.items);
    const d = await AdapterDictAPI.list();
    setDicts(d.items);
  };
  useEffect(() => { void refresh(); }, []);

  const dictOptions = (kind: AdapterDictKind) =>
    dicts.filter(d => d.kind === kind).map(d => d.value);
  const categoryOpts = dictOptions("category");
  const connectionOpts = dictOptions("connection");
  const runnerOpts = dictOptions("runner");

  const togglePanel = () => {
    setDictPanelOpen(v => {
      const next = !v;
      try { localStorage.setItem("adapters.dict.open", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  const focusDictCard = (kind: AdapterDictKind) => {
    if (!dictPanelOpen) {
      setDictPanelOpen(true);
      try { localStorage.setItem("adapters.dict.open", "1"); } catch { /* ignore */ }
    }
    setHighlightKind(kind);
    // If the column is empty, jump straight into "add new" so the user can type.
    if (!dicts.some((d) => d.kind === kind)) {
      setAddingKind(kind); setAddValue(""); setAddLabel("");
    }
    setTimeout(() => {
      dictCardRefs.current[kind]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    setTimeout(() => setHighlightKind(null), 1800);
  };


  const usedByCount = (kind: AdapterDictKind, value: string): number => {
    return items.filter(it => {
      if (kind === "category") return it.category === value;
      if (kind === "connection") return it.connection_type === value;
      if (kind === "runner") return it.adapter === value;
      return false;
    }).length;
  };

  const startAdd = (kind: AdapterDictKind) => {
    setAddingKind(kind); setAddValue(""); setAddLabel("");
    cancelEditDict();
  };
  const cancelAdd = () => { setAddingKind(null); setAddValue(""); setAddLabel(""); };
  const submitAdd = async () => {
    if (!addingKind || !addValue.trim()) return;
    try {
      await AdapterDictAPI.create(addingKind, addValue.trim(), addLabel.trim() || undefined);
      cancelAdd();
      const d = await AdapterDictAPI.list();
      setDicts(d.items);
      toast.success("Added");
    } catch (e) { toast.error(`Add failed · ${(e as Error).message}`); }
  };
  const startEditDict = (it: AdapterDictItem) => {
    cancelAdd();
    setEditingDictId(it.id); setEditValue(it.value); setEditLabel(it.label ?? "");
  };
  const cancelEditDict = () => { setEditingDictId(null); setEditValue(""); setEditLabel(""); };
  const saveEditDict = async (it: AdapterDictItem) => {
    try {
      await AdapterDictAPI.update(it.id, { value: editValue.trim(), label: editLabel.trim() || null });
      const d = await AdapterDictAPI.list();
      setDicts(d.items);
      cancelEditDict();
      toast.success("Updated");
    } catch (e) { toast.error(`Update failed · ${(e as Error).message}`); }
  };
  const removeDict = async (it: AdapterDictItem) => {
    const refCount = usedByCount(it.kind, it.value);
    const base = it.builtin ? `Delete seed entry "${it.value}"?` : `Delete "${it.value}"?`;
    const suffix = refCount > 0 ? ` It is referenced by ${refCount} adapter${refCount === 1 ? "" : "s"} — delete anyway?` : "";
    if (!confirm(base + suffix)) return;
    try {
      await AdapterDictAPI.remove(it.id);
      setDicts(prev => prev.filter(x => x.id !== it.id));
      toast.success("Deleted");
    } catch (e) { toast.error(`Delete failed · ${(e as Error).message}`); }
  };

  const openCreate = () => { setForm(emptyForm()); setOpen(true); };
  const openEdit = async (row: AdapterRow) => {
    try {
      const r = await AdaptersAPI.get(row.id);
      const it = r.item;
      const spec = Array.isArray(it.vault_binding_spec) && it.vault_binding_spec[0];
      setForm({
        id: it.id,
        name: it.name, description: it.description ?? "",
        adapter: it.adapter, category: it.category, connection_type: it.connection_type,
        risk_level: it.risk_level, requires_approval: it.requires_approval,
        enabled: it.enabled, tags: (it.tags || []).join(","),
        config: JSON.stringify(it.config ?? {}, null, 2),
        vault_scope: String((it.config as Record<string, unknown>)?.vault_scope ?? ""),
        vault_name:  String((it.config as Record<string, unknown>)?.vault_name ?? ""),
        vault_field: spec ? spec.field : String((it.config as Record<string, unknown>)?.vault_field ?? ""),
      });
      setOpen(true);
    } catch (e) { toast.error((e as Error).message); }
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(form.config || "{}"); }
    catch { toast.error("Config must be valid JSON"); return; }
    if (form.vault_scope) cfg.vault_scope = form.vault_scope;
    if (form.vault_name)  cfg.vault_name  = form.vault_name;
    if (form.vault_field) cfg.vault_field = form.vault_field;
    const body = {
      name: form.name.trim(),
      description: form.description,
      adapter: form.adapter,
      category: form.category,
      connection_type: form.connection_type,
      risk_level: form.risk_level,
      requires_approval: form.requires_approval,
      enabled: form.enabled,
      tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
      config: cfg,
      vault_binding_spec: form.vault_field
        ? [{ env_alias: form.vault_field.toUpperCase(), field: form.vault_field }]
        : [],
    };
    setSaving(true);
    try {
      if (form.id) await AdaptersAPI.update(form.id, body);
      else         await AdaptersAPI.create(body);
      toast.success(form.id ? "Adapter updated" : "Adapter created");
      setOpen(false); await refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const remove = async (row: AdapterRow) => {
    if (!confirm(`Delete adapter "${row.name}"?`)) return;
    try { await AdaptersAPI.remove(row.id); toast.success("Deleted"); await refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const test = async (row: AdapterRow) => {
    try {
      const r = await AdaptersAPI.test(row.id);
      toast.success(`Test · ${JSON.stringify(r.checks)}`);
    } catch (e) { toast.error((e as Error).message); }
  };
  const toggleEnabled = async (row: AdapterRow) => {
    try {
      await AdaptersAPI.update(row.id, { ...row, enabled: !row.enabled });
      await refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <PageShell>
      <PageHeader
        title="Adapters"
        subtitle="Cloud · Network · Social · Content · AI · DB — single registry, flexible connection_type"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh}><RotateCcw className="h-3.5 w-3.5 mr-1" />Refresh</Button>
            <Button size="sm" onClick={openCreate}><Plus className="h-3.5 w-3.5 mr-1" />New Adapter</Button>
          </div>
        }
      />

      {/* Dictionaries panel — view/edit/delete/add categories, connections, runners */}
      <Card className="border-border">
        <button
          type="button"
          onClick={togglePanel}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            {dictPanelOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="text-sm font-semibold">Dictionaries</span>
            <span className="text-xs text-muted-foreground">
              · {categoryOpts.length} categories · {connectionOpts.length} connections · {runnerOpts.length} runners
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {dictPanelOpen ? "Hide" : "Show"}
          </span>
        </button>
        {dictPanelOpen && (
          <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-border pt-3">
            {(["category", "connection", "runner"] as const).map((kind) => (
              <div
                key={kind}
                ref={(el) => { dictCardRefs.current[kind] = el; }}
                className={`rounded-md border transition-all ${
                  highlightKind === kind ? "border-primary ring-2 ring-primary/40" : "border-border"
                }`}
              >
                <DictionaryColumn
                  kind={kind}
                  icon={kind === "category" ? Tags : kind === "connection" ? Network : PlayCircle}
                  entries={dicts.filter(d => d.kind === kind)}
                  usedBy={(v) => usedByCount(kind, v)}
                  editingId={editingDictId}
                  editValue={editValue}
                  editLabel={editLabel}
                  setEditValue={setEditValue}
                  setEditLabel={setEditLabel}
                  onStartEdit={startEditDict}
                  onCancelEdit={cancelEditDict}
                  onSaveEdit={saveEditDict}
                  onRemove={removeDict}
                  addingKind={addingKind}
                  addValue={addValue}
                  addLabel={addLabel}
                  setAddValue={setAddValue}
                  setAddLabel={setAddLabel}
                  onStartAdd={() => startAdd(kind)}
                  onCancelAdd={cancelAdd}
                  onSubmitAdd={submitAdd}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((it) => {
          const RunnerIcon = RUNNER_ICON[it.adapter] || Plug;
          const vaultCfg = (it.config || {}) as Record<string, unknown>;
          const vaultStr = [vaultCfg.vault_scope, vaultCfg.vault_name, vaultCfg.vault_field]
            .filter(Boolean).join(" · ");
          const borderTone = !it.enabled
            ? "border-l-muted-foreground/40"
            : it.requires_approval
              ? "border-l-amber-500"
              : "border-l-primary/60";
          return (
            <Card key={it.id} className={`border-border border-l-2 ${borderTone}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <RunnerIcon className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-semibold truncate">{it.name}</span>
                    </div>
                    {it.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{it.description}</p>
                    )}
                  </div>
                  <Switch checked={it.enabled} onCheckedChange={() => void toggleEnabled(it)} />
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <Meta label="Category" value={it.category} />
                  <Meta label="Connection" value={it.connection_type} mono />
                  <Meta label="Runner" value={it.adapter} mono />
                  <div className="space-y-0.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Risk</div>
                    <Badge variant="outline" className={`text-[10px] ${RISK_TONE[it.risk_level] || ""}`}>
                      {it.risk_level}
                    </Badge>
                  </div>
                  <div className="col-span-2 space-y-0.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Vault</div>
                    {vaultStr ? (
                      <div className="flex items-center gap-1 text-xs font-mono">
                        <KeyRound className="h-3 w-3 text-muted-foreground" />
                        <span className="truncate">{vaultStr}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                  {it.tags?.length ? (
                    <div className="col-span-2 flex flex-wrap gap-1 pt-0.5">
                      {it.tags.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                    <span>{it.id.slice(0, 8)}</span>
                    {it.requires_approval && (
                      <Badge variant="outline" className="text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-600">approval</Badge>
                    )}
                    {!it.enabled && (
                      <Badge variant="outline" className="text-[10px]">disabled</Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void openEdit(it)}>
                      <Pencil className="h-3 w-3 mr-1" />Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void test(it)}>
                      <Zap className="h-3 w-3 mr-1" />Test
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => void remove(it)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!items.length && (
          <Card className="border-dashed col-span-full">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No adapters yet. Click "New Adapter" to start — add a Cloudflare token, a Checkpoint SSH, or an X.com post webhook.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Adapter" : "New Adapter"}</DialogTitle>
            <DialogDescription>
              Define a reusable connector. Category, Connection and Runner options are fully editable in the Manage dialogs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Tags (comma)</label>
                <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Description</label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <DictSelect
                label="Category"
                value={form.category}
                options={categoryOpts}
                onChange={(v) => setForm({ ...form, category: v as AdapterCategory })}
                onManage={() => focusDictCard("category")}
              />
              <DictSelect
                label="Connection"
                value={form.connection_type}
                options={connectionOpts}
                onChange={(v) => setForm({ ...form, connection_type: v as ConnectionType })}
                onManage={() => focusDictCard("connection")}
              />
              <DictSelect
                label="Runner"
                value={form.adapter}
                options={runnerOpts}
                onChange={(v) => setForm({ ...form, adapter: v as AdapterRunner })}
                onManage={() => focusDictCard("runner")}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Vault scope</label>
                <Select value={form.vault_scope || "__none__"} onValueChange={(v) => setForm({ ...form, vault_scope: v === "__none__" ? "" : v, vault_name: "", vault_field: "" })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— none —</SelectItem>
                    {[...new Set(vault.map((v) => v.scope))].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Vault name</label>
                <Select value={form.vault_name || "__none__"} onValueChange={(v) => setForm({ ...form, vault_name: v === "__none__" ? "" : v, vault_field: "" })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {vault.filter((v) => v.scope === form.vault_scope).map((v) => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Field</label>
                <Select value={form.vault_field || "__none__"} onValueChange={(v) => setForm({ ...form, vault_field: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {(vault.find((v) => v.scope === form.vault_scope && v.name === form.vault_name)?.field_names || []).map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Config (JSON) — e.g. {"{ \"base_url\": \"https://api.cloudflare.com/client/v4\" }"}</label>
              <Textarea rows={6} className="font-mono text-xs" value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Risk</label>
                <Select value={form.risk_level} onValueChange={(v) => setForm({ ...form, risk_level: v as typeof RISKS[number] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RISKS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Switch checked={form.requires_approval} onCheckedChange={(v) => setForm({ ...form, requires_approval: v })} />
                <span className="text-xs">Requires approval</span>
              </div>
              <div className="flex items-end gap-2">
                <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                <span className="text-xs">Enabled</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xs truncate ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function DictSelect({
  label, value, options, onChange, onManage,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onManage: () => void;
}) {
  const empty = options.length === 0;
  const missing = !!value && !options.includes(value);
  const items = missing ? [...options, value] : options;
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">{label}</label>
        <button type="button" className="text-[10px] text-primary hover:underline" onClick={onManage}>⚙ Manage</button>
      </div>
      {empty ? (
        <button
          type="button"
          onClick={onManage}
          className="w-full h-10 px-3 text-xs text-left border border-dashed border-primary/40 hover:border-primary hover:bg-primary/5 rounded-md text-primary font-medium transition-colors"
        >
          + Add first {label.toLowerCase()}
        </button>
      ) : (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {items.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}


interface DictionaryColumnProps {
  kind: AdapterDictKind;
  icon: typeof Globe;
  entries: AdapterDictItem[];
  usedBy: (value: string) => number;
  editingId: number | null;
  editValue: string;
  editLabel: string;
  setEditValue: (v: string) => void;
  setEditLabel: (v: string) => void;
  onStartEdit: (it: AdapterDictItem) => void;
  onCancelEdit: () => void;
  onSaveEdit: (it: AdapterDictItem) => void;
  onRemove: (it: AdapterDictItem) => void;
  addingKind: AdapterDictKind | null;
  addValue: string;
  addLabel: string;
  setAddValue: (v: string) => void;
  setAddLabel: (v: string) => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onSubmitAdd: () => void;
}

function DictionaryColumn(p: DictionaryColumnProps) {
  const Icon = p.icon;
  const adding = p.addingKind === p.kind;
  const title = p.kind === "category" ? "Category" : p.kind === "connection" ? "Connection" : "Runner";
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">{title}</span>
          <span className="text-[10px] text-muted-foreground">{p.entries.length} {p.entries.length === 1 ? "entry" : "entries"}</span>
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={p.onStartAdd} disabled={adding} title={`Add ${title.toLowerCase()}`}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {adding && (
        <div className="border border-primary/40 bg-primary/5 rounded p-2 space-y-2">
          <Input
            value={p.addValue}
            onChange={(e) => p.setAddValue(e.target.value)}
            placeholder="value (slug)"
            className="font-mono text-xs h-7"
            autoFocus
          />
          <Input
            value={p.addLabel}
            onChange={(e) => p.setAddLabel(e.target.value)}
            placeholder="label (optional)"
            className="text-xs h-7"
          />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={p.onCancelAdd}>
              <X className="h-3 w-3 mr-1" />Cancel
            </Button>
            <Button size="sm" className="h-6 px-2 text-xs" onClick={p.onSubmitAdd} disabled={!p.addValue.trim()}>
              <Check className="h-3 w-3 mr-1" />Save
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
        {p.entries.map((d) => {
          const isEditing = p.editingId === d.id;
          const refs = p.usedBy(d.value);
          if (isEditing) {
            return (
              <div key={d.id} className="border border-primary/40 bg-primary/5 rounded p-2 space-y-2">
                <Input
                  value={p.editValue}
                  onChange={(e) => p.setEditValue(e.target.value)}
                  placeholder="value (slug)"
                  className="font-mono text-xs h-7"
                  autoFocus
                />
                <Input
                  value={p.editLabel}
                  onChange={(e) => p.setEditLabel(e.target.value)}
                  placeholder="label (optional)"
                  className="text-xs h-7"
                />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={p.onCancelEdit}>
                    <X className="h-3 w-3 mr-1" />Cancel
                  </Button>
                  <Button size="sm" className="h-6 px-2 text-xs" onClick={() => p.onSaveEdit(d)} disabled={!p.editValue.trim()}>
                    <Check className="h-3 w-3 mr-1" />Save
                  </Button>
                </div>
              </div>
            );
          }
          return (
            <div
              key={d.id}
              className="group flex items-center justify-between gap-2 rounded border border-border/60 hover:border-border bg-card px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs truncate">{d.value}</span>
                  {d.builtin && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">seed</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {d.label && (
                    <span className="text-[10px] text-muted-foreground truncate">{d.label}</span>
                  )}
                  <span className={`text-[10px] ${refs > 0 ? "text-primary" : "text-muted-foreground"}`}>
                    used by {refs}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => p.onStartEdit(d)} title="Edit">
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => p.onRemove(d)} title="Delete">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          );
        })}
        {!p.entries.length && !adding && (
          <button
            type="button"
            onClick={p.onStartAdd}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-primary border border-dashed border-primary/40 hover:border-primary hover:bg-primary/5 rounded py-3 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add first {title.toLowerCase()}
          </button>
        )}

      </div>
    </div>
  );
}
