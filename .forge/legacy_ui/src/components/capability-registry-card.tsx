// Tur-5 — Unified Capability Registry + Capability Packs admin surface.
// Mounted as a tab inside /system-engine. Admin-only.
//
// Two cards in one file:
//   1. CapabilityPacksCard — list / create / edit / delete sectoral packs
//      (capability_packs table). Drives `Activate Pack` flow elsewhere.
//   2. CapabilityRegistryCard — list / toggle / rename slug / re-sync the
//      unified `capabilities` view that backs the chat `!slug` dispatcher.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LazyTextarea } from "@/components/lazy-textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Plus, Trash2, Pencil, Layers, BookOpen, AlertTriangle, Wrench, Sparkles, FolderSearch, X, Bot, History } from "lucide-react";
import { RunHistoryTable } from "@/components/run-history-table";
import { toast } from "sonner";
import {
  CapabilityPacksAPI, CapabilitiesAPI, ForgeAPI, SkillsAPI, ToolsAPI, AgentsDiscoveryAPI,
  type CapabilityPack, type CapabilityRow, type ActionDef, type SkillDef,
} from "@/lib/api-client";
import { MacFolderPicker } from "@/components/mac-folder-picker";
import { BrainSelect, InterpreterSelect } from "@/components/runtime-brain-picker";

// ---------------------------------------------------------------------------
// Capability Packs
// ---------------------------------------------------------------------------
const EMPTY_PACK: Partial<CapabilityPack> = {
  id: "", name: "", sector: "general", description: "", icon: "Shield",
  color: "#06b6d4", action_ids: [], skill_ids: [], brand_keywords: [],
  default_model: "", default_interpreter_path: "",
};


function BrandKeywordsField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    const next = Array.from(new Set([...(value || []), ...parts]));
    onChange(next);
    setDraft("");
  };
  const remove = (kw: string) => onChange((value || []).filter((x) => x !== kw));
  return (
    <div className="space-y-1">
      <span className="text-muted-foreground">Brand Keywords ({(value || []).length})</span>
      <div className="border border-border rounded p-2 space-y-2">
        {(value || []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(value || []).map((kw) => (
              <Badge key={kw} variant="secondary" className="text-[10px] h-5 gap-1 pr-1">
                {kw}
                <button type="button" onClick={() => remove(kw)} className="hover:text-destructive" aria-label={`Remove ${kw}`}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(draft); }
              else if (e.key === "Backspace" && !draft && (value || []).length) {
                onChange((value || []).slice(0, -1));
              }
            }}
            onBlur={() => draft && commit(draft)}
            placeholder="checkpoint, fortigate, palo alto…  (Enter / comma to add)"
            className="h-7 text-xs"
          />
          <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => commit(draft)} disabled={!draft.trim()}>Add</Button>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        RAG retrieval filter — agents bound to this pack are restricted to these brands. Empty = unrestricted. Normalized to lowercase.
      </p>
    </div>
  );
}

export function CapabilityPacksCard() {

  const [packs, setPacks] = useState<CapabilityPack[]>([]);
  const [historyPackId, setHistoryPackId] = useState<string | null>(null);
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<Partial<CapabilityPack> | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [p, a, s] = await Promise.all([
        CapabilityPacksAPI.list(),
        ForgeAPI.list(),
        SkillsAPI.list().catch((err) => {
          console.error("[packs] SkillsAPI.list failed", err);
          toast.error(`Skills load failed: ${(err as Error)?.message || err}`);
          return [] as SkillDef[];
        }),
      ]);
      // Normalize legacy rows that may not yet carry skill_ids.
      setPacks(p.map((x) => ({ ...x, skill_ids: Array.isArray(x.skill_ids) ? x.skill_ids : [] })));
      setActions(a.filter((x) => x.kind === "action"));
      setSkills(s);
    } catch (e) {
      toast.error(`Packs load failed: ${(e as Error).message}`);
    } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const handleSave = async () => {
    if (!editor) return;
    if (!editor.name?.trim()) return toast.error("Name required");
    try {
      const existing = packs.find((p) => p.id === editor.id);
      if (existing) {
        await CapabilityPacksAPI.update(editor.id!, editor);
        toast.success("Pack updated");
      } else {
        const r = await CapabilityPacksAPI.create(editor);
        toast.success(`Pack created: ${r.id}`);
      }
      setEditor(null);
      await refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleDelete = async (p: CapabilityPack) => {
    if (!confirm(`Delete pack "${p.name}"?${p.is_system ? " (system pack — will be tombstoned)" : ""}`)) return;
    try {
      await CapabilityPacksAPI.remove(p.id);
      toast.success("Pack deleted");
      await refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  const grouped = useMemo(() => {
    const g: Record<string, CapabilityPack[]> = {};
    for (const p of packs) (g[p.sector] = g[p.sector] || []).push(p);
    return g;
  }, [packs]);

  return (
    <Card className="glass border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-mono uppercase tracking-wide">
          <Layers className="h-4 w-4 text-primary" /> Capability Packs · {packs.length}
        </CardTitle>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={refresh} title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Dialog open={editor !== null} onOpenChange={(o) => !o && setEditor(null)}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-7 text-[11px] bg-gradient-primary text-primary-foreground"
                      onClick={() => setEditor({ ...EMPTY_PACK })}>
                <Plus className="h-3 w-3 mr-1" /> New pack
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>{editor?.id && packs.find((p) => p.id === editor?.id) ? "Edit pack" : "New pack"}</DialogTitle></DialogHeader>
              {editor && (
                <div className="space-y-3 font-mono text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1"><span className="text-muted-foreground">ID (slug)</span>
                      <Input value={editor.id || ""} onChange={(e) => setEditor({ ...editor, id: e.target.value })}
                             placeholder="auto-generated if empty" disabled={!!packs.find((p) => p.id === editor.id)} />
                    </label>
                    <label className="space-y-1"><span className="text-muted-foreground">Name</span>
                      <Input value={editor.name || ""} onChange={(e) => setEditor({ ...editor, name: e.target.value })} />
                    </label>
                    <label className="space-y-1"><span className="text-muted-foreground">Sector</span>
                      <Input value={editor.sector || ""} onChange={(e) => setEditor({ ...editor, sector: e.target.value })} />
                    </label>
                    <label className="space-y-1"><span className="text-muted-foreground">Icon</span>
                      <Input value={editor.icon || ""} onChange={(e) => setEditor({ ...editor, icon: e.target.value })} />
                    </label>
                    <label className="space-y-1"><span className="text-muted-foreground">Color</span>
                      <Input type="color" value={editor.color || "#06b6d4"} onChange={(e) => setEditor({ ...editor, color: e.target.value })} className="h-8 p-1" />
                    </label>
                  </div>
                  <label className="block space-y-1"><span className="text-muted-foreground">Description</span>
                    <LazyTextarea rows={2} value={editor.description || ""} onChange={(v) => setEditor({ ...editor, description: v })} />
                  </label>
                  <BrandKeywordsField
                    value={editor.brand_keywords || []}
                    onChange={(next) => setEditor({ ...editor, brand_keywords: next })}
                  />

                  <label className="block space-y-1">
                    <span className="text-muted-foreground">System prompt overlay</span>
                    <LazyTextarea
                      rows={5}
                      placeholder="Optional. Prepended to the bound agent's own system prompt (pack first, agent last)."
                      value={editor.system_prompt || ""}
                      onChange={(v) => setEditor({ ...editor, system_prompt: v })}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Sectoral persona / house tone. Leave blank to inherit nothing. Multi-pack: joined alphabetically by pack name with separators.
                    </p>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1"><span className="text-muted-foreground">Default brain (model or provider)</span>
                      <BrainSelect
                        value={editor.default_model || ""}
                        onChange={(v) => setEditor({ ...editor, default_model: v })}
                      />
                    </label>
                    <label className="space-y-1"><span className="text-muted-foreground">Default interpreter (Python)</span>
                      <InterpreterSelect
                        value={editor.default_interpreter_path || ""}
                        onChange={(v) => setEditor({ ...editor, default_interpreter_path: v })}
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-muted-foreground -mt-1">
                    Inherited by bound agents when their own brain / interpreter is empty. Leave blank to skip.
                  </p>
                  <div className="space-y-1">
                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                      <Wrench className="h-3 w-3" /> Tools ({(editor.action_ids || []).length})
                    </span>
                    <div className="max-h-40 overflow-auto border border-border rounded p-2 space-y-1">
                      {actions.map((a) => {
                        const checked = (editor.action_ids || []).includes(a.id);
                        return (
                          <label key={a.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 px-1 rounded">
                            <input type="checkbox" checked={checked} onChange={(e) => {
                              const cur = new Set(editor.action_ids || []);
                              if (e.target.checked) cur.add(a.id); else cur.delete(a.id);
                              setEditor({ ...editor, action_ids: Array.from(cur) });
                            }} />
                            <span className="inline-flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                              {a.name}{a.is_system ? " · SYS" : ""}
                            </span>
                          </label>
                        );
                      })}
                      {!actions.length && <p className="text-muted-foreground">No actions in library.</p>}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3" /> Skills ({(editor.skill_ids || []).length})
                    </span>
                    <div className="max-h-40 overflow-auto border border-border rounded p-2 space-y-1">
                      {skills.map((s) => {
                        const checked = (editor.skill_ids || []).includes(s.id);
                        return (
                          <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 px-1 rounded">
                            <input type="checkbox" checked={checked} onChange={(e) => {
                              const cur = new Set(editor.skill_ids || []);
                              if (e.target.checked) cur.add(s.id); else cur.delete(s.id);
                              setEditor({ ...editor, skill_ids: Array.from(cur) });
                            }} />
                            <span className="inline-flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                              !{s.slug} · {s.name}{s.is_system ? " · SYS" : ""}
                            </span>
                          </label>
                        );
                      })}
                      {!skills.length && <p className="text-muted-foreground">No skills in library.</p>}
                    </div>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditor(null)}>Cancel</Button>
                <Button onClick={handleSave} className="bg-gradient-primary text-primary-foreground">Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {Object.keys(grouped).length === 0 && <p className="text-xs font-mono text-muted-foreground">No packs yet.</p>}
        {Object.entries(grouped).map(([sector, list]) => (
          <div key={sector} className="space-y-1">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{sector}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {list.map((p) => {
                const histOpen = historyPackId === p.id;
                return (
                <div key={p.id} className={`border border-border rounded p-2 bg-card/30 ${histOpen ? "md:col-span-2" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                        <span className="font-mono text-xs truncate">{p.name}</span>
                        {p.is_system && <Badge variant="outline" className="text-[9px] h-4">SYS</Badge>}
                        <Badge variant="secondary" className="text-[9px] h-4">{p.action_ids.length} tools</Badge>
                        <Badge variant="secondary" className="text-[9px] h-4">{(p.skill_ids || []).length} skills</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">{p.description}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className={`h-6 w-6 p-0 ${histOpen ? "text-primary" : ""}`} onClick={() => setHistoryPackId(histOpen ? null : p.id)} title="Run history"><History className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditor({ ...p })} title="Edit"><Pencil className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDelete(p)} title="Delete"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                  {histOpen && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Run history · agents bound to this pack</p>
                      <RunHistoryTable limit={50} packId={p.id} sources={["agent-run", "agent-history", "tool-call"]} showAgent showTool />

                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Capability Registry (unified skills+tools+agents view)
// ---------------------------------------------------------------------------
export function CapabilityRegistryCard() {
  const [rows, setRows] = useState<CapabilityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | "skill" | "tool" | "agent">("all");
  const [search, setSearch] = useState("");
  const [slugEdit, setSlugEdit] = useState<{ id: string; value: string } | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await CapabilitiesAPI.list({ all: true });
      setRows(r.capabilities);
    } catch (e) { toast.error(`Registry load failed: ${(e as Error).message}`); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await CapabilitiesAPI.sync();
      toast.success(`Synced · skills=${r.counts.skills} tools=${r.counts.tools} agents=${r.counts.agents}`);
      await refresh();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSyncing(false); }
  };

  const toggleEnabled = async (row: CapabilityRow, enabled: boolean) => {
    try { await CapabilitiesAPI.update(row.id, { enabled }); await refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const saveSlug = async () => {
    if (!slugEdit) return;
    try {
      await CapabilitiesAPI.update(slugEdit.id, { slug: slugEdit.value });
      toast.success("Slug updated");
      setSlugEdit(null);
      await refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleDelete = async (row: CapabilityRow) => {
    if (!row.orphan) return toast.info("Source row still exists — disable instead.");
    if (!confirm(`Hard-delete orphan capability "${row.slug}"?`)) return;
    try { await CapabilitiesAPI.remove(row.id); await refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => kindFilter === "all" || r.kind === kindFilter)
      .filter((r) => !q || r.slug.includes(q) || r.name.toLowerCase().includes(q) || r.ref_id.toLowerCase().includes(q));
  }, [rows, kindFilter, search]);

  const stats = useMemo(() => {
    const s = { skill: 0, tool: 0, agent: 0, disabled: 0, orphan: 0 };
    for (const r of rows) {
      s[r.kind]++;
      if (!r.enabled) s.disabled++;
      if (r.orphan) s.orphan++;
    }
    return s;
  }, [rows]);

  return (
    <Card className="glass border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-mono uppercase tracking-wide">
          <BookOpen className="h-4 w-4 text-primary" /> Capability Registry · {rows.length}
        </CardTitle>
        <div className="flex gap-1 items-center">
          <Badge variant="outline" className="text-[10px]">skills {stats.skill}</Badge>
          <Badge variant="outline" className="text-[10px]">tools {stats.tool}</Badge>
          <Badge variant="outline" className="text-[10px]">agents {stats.agent}</Badge>
          {stats.disabled > 0 && <Badge variant="secondary" className="text-[10px]">disabled {stats.disabled}</Badge>}
          {stats.orphan > 0 && <Badge variant="destructive" className="text-[10px]">orphan {stats.orphan}</Badge>}
          <Button size="sm" variant="ghost" onClick={refresh} title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="h-7 text-[11px]">
            {syncing ? "Syncing…" : "Re-sync from sources"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Per-kind discovery roots — each block owns its own paths + scan. */}
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Discovery roots — per kind
          </p>
          <DiscoveryRootBlock
            kind="agent"
            label="Agents"
            icon={<Bot className="h-3.5 w-3.5" />}
            api={AgentsDiscoveryAPI}
            onAfterScan={refresh}
          />
          <DiscoveryRootBlock
            kind="tool"
            label="Tools"
            icon={<Wrench className="h-3.5 w-3.5" />}
            api={ToolsAPI}
            onAfterScan={refresh}
          />
          <DiscoveryRootBlock
            kind="skill"
            label="Skills"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            api={SkillsAPI}
            onAfterScan={refresh}
          />
        </div>

        <div className="flex gap-2">
          <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as typeof kindFilter)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="skill">Skills</SelectItem>
              <SelectItem value="tool">Tools</SelectItem>
              <SelectItem value="agent">Agents</SelectItem>
            </SelectContent>
          </Select>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search slug / name / ref_id" className="h-8 text-xs" />
        </div>
        <div className="border border-border rounded max-h-[480px] overflow-auto">
          <table className="w-full text-[11px] font-mono">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr className="text-left">
                <th className="px-2 py-1.5">kind</th>
                <th className="px-2 py-1.5">slug</th>
                <th className="px-2 py-1.5">name</th>
                <th className="px-2 py-1.5">ref_id</th>
                <th className="px-2 py-1.5 text-center">enabled</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={`border-b border-border/40 hover:bg-muted/30 ${r.orphan ? "bg-destructive/5" : ""}`}>
                  <td className="px-2 py-1"><Badge variant="outline" className="text-[9px]">{r.kind}</Badge></td>
                  <td className="px-2 py-1">
                    {slugEdit?.id === r.id ? (
                      <span className="flex gap-1">
                        <Input value={slugEdit.value} onChange={(e) => setSlugEdit({ ...slugEdit, value: e.target.value })} className="h-6 text-xs" />
                        <Button size="sm" className="h-6 px-2 text-[10px]" onClick={saveSlug}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setSlugEdit(null)}>×</Button>
                      </span>
                    ) : (
                      <button className="text-primary hover:underline" onClick={() => setSlugEdit({ id: r.id, value: r.slug })}>
                        !{r.slug}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1 truncate max-w-[200px]" title={r.name}>{r.name}</td>
                  <td className="px-2 py-1 truncate max-w-[200px] text-muted-foreground" title={r.ref_id}>{r.ref_id}</td>
                  <td className="px-2 py-1 text-center">
                    <Switch checked={r.enabled} onCheckedChange={(v) => toggleEnabled(r, v)} />
                  </td>
                  <td className="px-2 py-1 text-right">
                    {r.orphan && <AlertTriangle className="inline h-3 w-3 text-destructive mr-1" />}
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => handleDelete(r)} disabled={!r.orphan} title={r.orphan ? "Hard delete orphan" : "Disable instead — source still exists"}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">No rows.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">
          Slug = chat dispatcher key (unique · <code>@</code> agent · <code>!</code> skill · <code>/</code> tool).
          Disabling hides the row from the dispatcher. Hard delete is only available for orphan rows.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DiscoveryRootBlock — one block per kind (agent / tool / skill).
// Each owns its own roots list, picker, save, and scan button.
// ---------------------------------------------------------------------------
interface DiscoveryAPI {
  getDiscoveryRoots: () => Promise<{ ok: true; roots: string[]; fallback: string[]; effective: string[] }>;
  setDiscoveryRoots: (roots: string[]) => Promise<{ ok: true; roots: string[] }>;
  scan: (roots?: string[]) => Promise<{
    ok: true;
    scan: { added: number; updated: number; orphaned: number; total: number; roots: string[] };
  }>;
}

function DiscoveryRootBlock({
  kind, label, icon, api, onAfterScan,
}: {
  kind: "agent" | "tool" | "skill";
  label: string;
  icon: React.ReactNode;
  api: DiscoveryAPI;
  onAfterScan: () => Promise<void> | void;
}) {
  const [roots, setRoots] = useState<string[]>([]);
  const [fallback, setFallback] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<{ added: number; updated: number; orphaned: number; total: number } | null>(null);

  const load = async () => {
    try {
      const r = await api.getDiscoveryRoots();
      setRoots(r.roots);
      setFallback(r.fallback);
      setDirty(false);
    } catch (e) { toast.error(`${label} roots load: ${(e as Error).message}`); }
  };
  useEffect(() => { void load(); }, []);

  const addRoot = (p: string) => {
    setRoots((prev) => prev.includes(p) ? prev : [...prev, p]);
    setDirty(true);
  };
  const removeRoot = (p: string) => {
    setRoots((prev) => prev.filter((x) => x !== p));
    setDirty(true);
  };
  const save = async () => {
    try {
      await api.setDiscoveryRoots(roots);
      toast.success(roots.length ? `${label}: saved ${roots.length} root(s)` : `${label}: cleared — using defaults`);
      setDirty(false);
      await load();
    } catch (e) { toast.error(`Save failed: ${(e as Error).message}`); }
  };
  const scan = async () => {
    setScanning(true);
    try {
      const r = await api.scan(roots.length ? roots : undefined);
      setLastScan(r.scan);
      toast.success(`${label} scan · added=${r.scan.added} updated=${r.scan.updated} orphaned=${r.scan.orphaned} (total=${r.scan.total})`);
      await onAfterScan();
    } catch (e) { toast.error((e as Error).message); }
    finally { setScanning(false); }
  };

  return (
    <div className="border border-border/60 rounded p-2 space-y-2 bg-muted/20">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
          {icon} {label}
          {roots.length === 0 && <span className="text-amber-500">· using defaults</span>}
          {dirty && <span className="text-primary">· unsaved</span>}
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setPicker(true)}>
            <FolderSearch className="h-3 w-3 mr-1" /> Add folder
          </Button>
          {dirty && (
            <Button size="sm" className="h-6 text-[10px] bg-gradient-primary text-primary-foreground" onClick={save}>
              Save
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={scan} disabled={scanning}>
            {scanning ? "Scanning…" : `Scan ${label.toLowerCase()}`}
          </Button>
          {lastScan && lastScan.total > 0 && (
            <Badge
              variant="outline"
              className="text-[10px]"
              title={`Last scan: added ${lastScan.added}, updated ${lastScan.updated}, orphaned ${lastScan.orphaned}`}
            >
              {lastScan.total}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {roots.length === 0 && fallback.map((p) => (
          <Badge key={p} variant="outline" className="text-[10px] font-mono opacity-60">{p}</Badge>
        ))}
        {roots.map((p) => (
          <Badge key={p} variant="secondary" className="text-[10px] font-mono gap-1">
            {p}
            <button onClick={() => removeRoot(p)} className="hover:text-destructive" title="Remove">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      {kind === "skill" && (
        <p className="text-[10px] italic text-muted-foreground">
          Skills are primarily DB-managed (prompt templates). Disk scan picks up optional per-skill Python helpers.
        </p>
      )}
      <MacFolderPicker
        open={picker}
        onOpenChange={setPicker}
        onPick={(p) => addRoot(p)}
        title={`Add ${label.toLowerCase()} discovery root`}
        description={`Pick any absolute directory. The scanner will walk it recursively for *.py ${kind}s.`}
      />
    </div>
  );
}
