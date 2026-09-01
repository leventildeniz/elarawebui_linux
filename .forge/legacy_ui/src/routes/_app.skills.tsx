import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SkillsAPI, SkillBindingsAPI, type SkillDef, type SkillRunSummary, type AgentAdapterBinding, type AgentTargetBinding } from "@/lib/api-client";
import { BindingChips } from "@/components/binding-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LazyTextarea } from "@/components/lazy-textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Sparkles, Trash2, Play, RefreshCw, Shield, Flame, Eye, FolderOpen, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { SkillRunDrawer } from "@/components/skill-action-drawer";
import { McpExposedBadge } from "@/components/mcp-exposed-badge";
import { ExecutionPolicyForm, DEFAULT_POLICY, sanitizePolicy } from "@/components/execution-policy-form";
import { IconGridPicker, AGENT_ICON_LOOKUP } from "@/components/icon-grid-picker";
import { ColorPalettePicker } from "@/components/color-palette-picker";
import { MacFilePicker } from "@/components/mac-file-picker";
import { BrainSelect, InterpreterSelect } from "@/components/runtime-brain-picker";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/skills")({ component: SkillsPage });

const RISK_BADGE: Record<string, { c: string; icon: typeof Shield }> = {
  read: { c: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: Eye },
  write: { c: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: Shield },
  critical: { c: "bg-destructive/15 text-destructive border-destructive/30", icon: Flame },
};

function emptySkill(): Partial<SkillDef> & { slug: string; name: string } {
  return {
    slug: "", name: "", description: "", icon: "Sparkles", color: "#a855f7",
    required_tools: [], param_schema: { type: "object", properties: {} },
    risk_level: "read", requires_approval: false, script_kind: "python",
    script_body: "",
    script_path: "",
    model: "", interpreter_path: "",
    rollback_body: "",
    instructions: "",
  };
}

function SkillsPage() {
  const { t, locale } = useI18n();
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [history, setHistory] = useState<SkillRunSummary[]>([]);
  const [editing, setEditing] = useState<(Partial<SkillDef> & { slug: string; name: string }) | null>(null);
  const [paramsJson, setParamsJson] = useState<string>("{}");
  const [running, setRunning] = useState<SkillDef | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [skillAdapters, setSkillAdapters] = useState<AgentAdapterBinding[]>([]);
  const [skillTargets, setSkillTargets] = useState<AgentTargetBinding[]>([]);
  const [scriptPickerOpen, setScriptPickerOpen] = useState(false);

  const refresh = async () => {
    const [skillsRes, histRes] = await Promise.allSettled([
      SkillsAPI.list(),
      SkillsAPI.history({ limit: 50 }),
    ]);
    if (skillsRes.status === "fulfilled") setSkills(skillsRes.value);
    else toast.error("Skills yüklenemedi: " + String((skillsRes.reason as Error)?.message ?? skillsRes.reason));
    if (histRes.status === "fulfilled") setHistory(histRes.value);
    else toast.error("Run history yüklenemedi: " + String((histRes.reason as Error)?.message ?? histRes.reason));
  };
  useEffect(() => { refresh(); const id = setInterval(refresh, 8000); return () => clearInterval(id); }, []);

  // Load skill bindings whenever the editor opens with a real skill id.
  useEffect(() => {
    const sid = editing?.id;
    if (!sid) { setSkillAdapters([]); setSkillTargets([]); return; }
    let cancelled = false;
    (async () => {
      const [a, tg] = await Promise.all([
        SkillBindingsAPI.adapterList(sid),
        SkillBindingsAPI.targetList(sid),
      ]);
      if (cancelled) return;
      setSkillAdapters(a.items || []);
      setSkillTargets(tg.items || []);
    })();
    return () => { cancelled = true; };
  }, [editing?.id]);

  const handleSave = async () => {
    if (!editing) return;
    try {
      const saved = await SkillsAPI.save({
        ...editing,
        param_schema: typeof editing.param_schema === "string"
          ? JSON.parse(editing.param_schema as unknown as string)
          : editing.param_schema || {},
        execution_policy: sanitizePolicy(editing.execution_policy ?? DEFAULT_POLICY),
      } as Partial<SkillDef> & { slug: string; name: string });
      // Persist bindings after the skill itself is saved (we need an id).
      const sid = (saved as { id?: string })?.id || editing.id;
      if (sid) {
        await Promise.all([
          SkillBindingsAPI.adapterSave(sid, skillAdapters).catch((e) => toast.error(`Adapter save: ${(e as Error).message}`)),
          SkillBindingsAPI.targetSave(sid, skillTargets).catch((e) => toast.error(`Target save: ${(e as Error).message}`)),
        ]);
      }
      toast.success(t("skills.sealed_ok"));
      setEditing(null); refresh();
    } catch (e) { toast.error(String((e as Error).message)); }
  };

  const handleRun = async () => {
    if (!running) return;
    try {
      // Free-text input — backend coerceParams auto-wraps into { query } / first required key.
      const raw = (paramsJson || "").trim();
      let params: Record<string, unknown>;
      if (!raw) {
        params = {};
      } else if (raw.startsWith("{")) {
        // operator still pasted JSON — honor it
        try { params = JSON.parse(raw); } catch { params = { query: raw }; }
      } else {
        params = { query: raw };
      }
      const r = await SkillsAPI.run(running.slug, params);
      setActiveRunId(r.runId);
      toast.success(r.status === "awaiting_approval" ? t("skills.awaiting") : t("skills.running"));
      setRunning(null); setParamsJson("");
    } catch (e) { toast.error(String((e as Error).message)); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> {t("skills.title")}</h1>
          <p className="text-xs text-muted-foreground font-mono">{t("skills.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="h-3 w-3" /></Button>
          <Button size="sm" onClick={() => { setEditing(emptySkill()); }} className="bg-gradient-primary text-primary-foreground">
            <Plus className="h-3 w-3 mr-1" /> {t("skills.new")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="library">
        <TabsList>
          <TabsTrigger value="library">{t("skills.library")} · {skills.length}</TabsTrigger>
          <TabsTrigger value="history">{t("skills.history")} · {history.length}</TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {skills.map((s) => {
              const r = RISK_BADGE[s.risk_level] || RISK_BADGE.read;
              const RIcon = r.icon;
              const SIcon = AGENT_ICON_LOOKUP[s.icon] ?? Sparkles;
              return (
                <div key={s.id} className="border border-border rounded-lg p-3 bg-card/40 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-8 w-8 rounded flex items-center justify-center" style={{ background: `${s.color}20`, color: s.color }}>
                        <SIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono text-sm truncate">!{s.slug}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{s.name}</div>
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-[9px] gap-1 ${r.c}`}><RIcon className="h-2.5 w-2.5" />{s.risk_level}</Badge>
                    <McpExposedBadge kind="skill" slug={s.id} />
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{s.description}</p>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap">
                    {s.requires_approval && <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-300">approval</Badge>}
                    {s.is_system ? <Badge variant="outline" className="text-[9px]">SYS</Badge> : null}
                    <Badge variant="outline" className="text-[9px]">{s.script_kind}</Badge>
                    {s.script_kind === "python" && s.script_path && (
                      <Badge variant="outline" className="text-[9px] text-primary border-primary/40 max-w-[180px] truncate" title={s.script_path}>
                        {s.script_path.split("/").pop()}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1 pt-1">
                    <Button size="sm" variant="outline" className="h-7 flex-1 text-[11px]" onClick={() => { setRunning(s); setParamsJson(""); }}>
                      <Play className="h-3 w-3 mr-1" />{t("skills.run")}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setEditing({ ...s, param_schema: s.param_schema })}>{t("common.edit")}</Button>
                    <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={async () => {
                      if (!confirm(`Delete ${s.slug}?${s.is_system ? "\n\n⚠ SYSTEM skill — yalnızca admin silebilir; bir daha seed edilmez." : ""}`)) return;
                      try { await SkillsAPI.remove(s.id); toast.success("Silindi"); refresh(); }
                      catch (e) { toast.error(String((e as Error).message)); }
                    }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
        <TabsContent value="history">
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr><th className="text-left p-2">Skill</th><th className="text-left p-2">User</th><th className="text-left p-2">Status</th><th className="text-left p-2">Started</th><th className="text-left p-2">Duration</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-border/40 hover:bg-muted/20">
                    <td className="p-2">!{h.skill_slug}</td>
                    <td className="p-2 text-muted-foreground">{h.user_id || "—"}</td>
                    <td className="p-2"><Badge variant="outline" className="text-[9px]">{h.status}</Badge></td>
                    <td className="p-2 text-muted-foreground">{new Date(h.started_at).toLocaleString()}</td>
                    <td className="p-2 text-muted-foreground">{h.duration_ms ? `${Math.round(h.duration_ms)}ms` : "—"}</td>
                    <td className="p-2"><Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setActiveRunId(h.id)}>Detail</Button></td>
                  </tr>
                ))}
                {history.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{t("skills.empty_runs")}</td></tr>}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Editor */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing?.is_system ? t("skills.view_system") : t("skills.editor")}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] uppercase font-mono text-muted-foreground">{t("skills.slug")}</label>
                  <Input  value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase() })} placeholder="audit-vip" /></div>
                <div><label className="text-[10px] uppercase font-mono text-muted-foreground">{t("skills.name")}</label>
                  <Input  value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              </div>
              <div><label className="text-[10px] uppercase font-mono text-muted-foreground">{t("skills.description")}</label>
                <Input  value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[10px] uppercase font-mono text-muted-foreground">{t("skills.risk")}</label>
                  <Select value={editing.risk_level} onValueChange={(v) => setEditing({ ...editing, risk_level: v as SkillDef["risk_level"] })}>
                    <SelectTrigger ><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="read">read</SelectItem><SelectItem value="write">write</SelectItem><SelectItem value="critical">critical</SelectItem></SelectContent>
                  </Select></div>
                <div className="flex items-end gap-2"><Switch  checked={!!editing.requires_approval} onCheckedChange={(v) => setEditing({ ...editing, requires_approval: v })} /><span className="text-xs">{t("skills.requires_approval")}</span></div>
                <div /> 
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono text-muted-foreground">Icon</label>
                <div className="mt-1">
                  <IconGridPicker
                    value={editing.icon ?? "Sparkles"}
                    onChange={(v) => setEditing({ ...editing, icon: v })}
                    color={editing.color ?? "#a855f7"}
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono text-muted-foreground">{t("skills.color")}</label>
                <ColorPalettePicker
                  value={editing.color ?? "#a855f7"}
                  onChange={(v) => setEditing({ ...editing, color: v })}
                  
                />
              </div>
              <div><label className="text-[10px] uppercase font-mono text-muted-foreground">{t("skills.param_schema")}</label>
                <LazyTextarea  className="font-mono text-xs" rows={5}
                  value={typeof editing.param_schema === "string" ? editing.param_schema : JSON.stringify(editing.param_schema, null, 2)}
                  onChange={(v) => setEditing({ ...editing, param_schema: v as unknown as Record<string, unknown> })} /></div>
              <div>
                <label className="text-[10px] uppercase font-mono text-muted-foreground flex items-center gap-2">
                  {t("skills.instructions")}
                  <span className="text-[9px] text-muted-foreground/70 normal-case font-sans">— {t("skills.instructions_hint")}</span>
                </label>
                <LazyTextarea  className="font-mono text-xs" rows={6}
                  placeholder={t("skills.instructions_placeholder")}
                  value={editing.instructions ?? ""} onChange={(v) => setEditing({ ...editing, instructions: v })} />
              </div>
              <div className="border-t border-border pt-3 space-y-2">
                <label className="text-[10px] uppercase font-mono text-muted-foreground">Script kind</label>
                <Select
                  value={editing.script_kind || "js"}
                  onValueChange={(v) => setEditing({ ...editing, script_kind: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="js">js (inline body)</SelectItem>
                    <SelectItem value="python">python (disk file)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editing.script_kind === "python" ? (
                <div>
                  <label className="text-[10px] uppercase font-mono text-muted-foreground flex items-center justify-between">
                    <span>Script path (absolute, .py)</span>
                    {!editing.script_path && (
                      <span className="flex items-center gap-1 text-destructive normal-case font-sans">
                        <AlertTriangle className="h-3 w-3" /> required
                      </span>
                    )}
                  </label>
                  <div className="mt-1 flex gap-1">
                    <Input
                      className="font-mono text-xs"
                      value={editing.script_path ?? ""}
                      onChange={(e) => setEditing({ ...editing, script_path: e.target.value })}
                      placeholder="/abs/path/to/skill.py"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => setScriptPickerOpen(true)}>
                      <FolderOpen className="h-3 w-3 mr-1" /> Browse
                    </Button>
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">
                    Skill runs via the disk runner — any directory allowed.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="text-[10px] uppercase font-mono text-muted-foreground">{t("skills.script_body")}</label>
                  <LazyTextarea className="font-mono text-xs" rows={6} value={editing.script_body ?? ""} onChange={(v) => setEditing({ ...editing, script_body: v })} />
                </div>
              )}
              <div className="border-t border-border pt-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase font-mono text-muted-foreground">Brain (model or provider)</label>
                  <div className="mt-1">
                    <BrainSelect
                      value={editing.model ?? ""}
                      onChange={(v) => setEditing({ ...editing, model: v })}
                    />
                  </div>
                  <p className="text-[9px] font-mono text-muted-foreground mt-1">Optional — falls back to caller's brain.</p>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-mono text-muted-foreground">Interpreter (Python)</label>
                  <div className="mt-1">
                    <InterpreterSelect
                      value={editing.interpreter_path ?? ""}
                      onChange={(v) => setEditing({ ...editing, interpreter_path: v })}
                    />
                  </div>
                  <p className="text-[9px] font-mono text-muted-foreground mt-1">Used when the script shells out to Python.</p>
                </div>
              </div>
              <div><label className="text-[10px] uppercase font-mono text-muted-foreground">{t("skills.rollback_body")}</label>
                <LazyTextarea  className="font-mono text-xs" rows={3} value={editing.rollback_body ?? ""} onChange={(v) => setEditing({ ...editing, rollback_body: v })} /></div>
              <ExecutionPolicyForm
                value={sanitizePolicy(editing.execution_policy ?? DEFAULT_POLICY)}
                onChange={(p) => setEditing({ ...editing, execution_policy: p })}
              />
              {editing.id ? (
                <BindingChips
                  adapters={skillAdapters}
                  targets={skillTargets}
                  onAdaptersChange={setSkillAdapters}
                  onTargetsChange={setSkillTargets}
                  adapterHint="Skill execution will be allowed only through these adapters (vault + risk inherited)."
                  targetHint="Restrict this skill to specific hosts or target groups. Empty = any target."
                />
              ) : (
                <p className="text-[10px] font-mono text-muted-foreground/60 border-t border-border pt-3 mt-3">
                  Save the skill once to enable adapter / target bindings.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("skills.close")}</Button>
            <Button onClick={handleSave} className="bg-gradient-primary text-primary-foreground">{t("skills.seal")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run dialog */}
      <Dialog open={!!running} onOpenChange={(o) => !o && setRunning(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("skills.run")} !{running?.slug}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{running?.description}</p>
            <label className="text-[10px] uppercase font-mono text-muted-foreground">
              {"Query / Command"}
            </label>
            <Input
              autoFocus
              className="font-mono text-xs"
              value={paramsJson}
              onChange={(e) => setParamsJson(e.target.value)}
              placeholder={"Type freely — the system will auto-wrap"}
            />
            <p className="text-[10px] text-muted-foreground/70">
              {"Advanced: paste JSON and it is forwarded verbatim."}
            </p>
            {running?.requires_approval && <p className="text-[11px] text-amber-300">{t("skills.requires_approval_warn")}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunning(null)}>{t("skills.cancel")}</Button>
            <Button onClick={handleRun} className="bg-gradient-primary text-primary-foreground"><Play className="h-3 w-3 mr-1" />{t("skills.trigger")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SkillRunDrawer runId={activeRunId} onClose={() => setActiveRunId(null)} />
      <MacFilePicker
        open={scriptPickerOpen}
        onOpenChange={setScriptPickerOpen}
        accept={[".py"]}
        initialPath={editing?.script_path ? editing.script_path.replace(/\/[^/]+$/, "") : undefined}
        onPick={(abs) => setEditing((d) => d ? { ...d, script_path: abs } : d)}
        title="Pick a Python skill script"
        description="Select the .py file this skill should run. Absolute paths only."
      />
    </div>
  );
}
