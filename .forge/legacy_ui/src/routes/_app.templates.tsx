import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Minus, Database, Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSystem } from "@/lib/system-store";
import {
  TemplatesAPI,
  AgentsAPI,
  ProvidersAPI,
  ForgeAPI,
  SkillsAPI,
  type AiProviderDTO,
  type TemplateDTO,
  type TemplateAssignmentDTO,
  type ActionDef,
  type SkillDef,
  getBridgeCandidates,
  getBridgeOverride,
  setBridgeOverride,
} from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { AllowedVisionProfilesChips } from "@/components/allowed-vision-profiles-chips";

export const Route = createFileRoute("/_app/templates")({ component: TemplatesPage });

const makeTemplateId = () => "tpl-" + Date.now();
const makeParamId = () => "param-" + Date.now();
const makeAssignmentId = () => "assign-" + Date.now();

function TemplatesPage() {
  const { t } = useI18n();
  const { agents, models: sysModels } = useSystem();
  const [agentNames, setAgentNames] = useState<string[]>(agents.map((a) => a.name));
  const [templates, setTemplates] = useState<TemplateDTO[]>([]);
  const [assignments, setAssignments] = useState<TemplateAssignmentDTO[]>([]);
  const [llmProviders, setLlmProviders] = useState<AiProviderDTO[]>([]);
  const [tools, setTools] = useState<ActionDef[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillDef[]>([]);
  useEffect(() => {
    const load = () => ProvidersAPI.list()
      .then(r => {
        setLlmProviders(r.filter(p => p.isActive !== false));
        setProviderError(null);
      })
      .catch((e) => {
        setLlmProviders([]);
        setProviderError((e as Error).message);
      });
    load(); const id = setInterval(load, 8000); return () => clearInterval(id);
  }, []);
  const [selId, setSelId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const sel = templates.find((t) => t.id === selId);

  // initial hydrate from PostgreSQL
  const hydrate = async () => {
    setLoading(true);
    setLoadError(null);
    // probe connectivity directly so a silent empty list doesn't masquerade as success
    let online = false;
    for (const base of getBridgeCandidates()) {
      try {
        const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(30000) });
        if (r.ok) {
          online = true;
          break;
        }
      } catch {
        /* try next candidate */
      }
    }
    if (!online) {
      setLoadError("Bridge unreachable. Check the connection settings.");
      setLoading(false);
      return;
    }
    try {
      const [tpls, asg] = await Promise.all([TemplatesAPI.list(), TemplatesAPI.listAssignments()]);
      setTemplates(tpls);
      setAssignments(asg);
      setSelId(tpls[0]?.id ?? "");
    } catch (e) {
      setLoadError((e as Error).message || "Bridge unreachable");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    hydrate();
    AgentsAPI.list()
      .then((rows) => setAgentNames(rows.map((a) => a.name)))
      .catch(() => setAgentNames(agents.map((a) => a.name)));
    ForgeAPI.list({ kind: "action" })
      .then((rows) => setTools(rows))
      .catch(() => setTools([]));
    SkillsAPI.list().then(setSkills).catch(() => setSkills([]));
  }, []);

  // debounced upsert of selected template
  const dirtyRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const queueUpsert = (t: TemplateDTO) => {
    const map = dirtyRef.current;
    const prev = map.get(t.id);
    if (prev) clearTimeout(prev);
    map.set(
      t.id,
      setTimeout(async () => {
        try {
          await TemplatesAPI.upsert(t);
        } catch (e) {
          toast.error(`Save failed: ${(e as Error).message}`);
        }
        map.delete(t.id);
      }, 500),
    );
  };

  const upd = (patch: Partial<TemplateDTO>) => {
    if (!sel) return;
    const next = { ...sel, ...patch };
    setTemplates(templates.map((t) => (t.id === sel.id ? next : t)));
    queueUpsert(next);
  };

  const addTpl = async () => {
    try {
      const fresh = await TemplatesAPI.upsert({
        id: makeTemplateId(),
        name: "New Template",
        systemPrompt: "",
        temperature: 0.4,
        topP: 0.9,
        maxTokens: 4096,
        params: [],
        agents: [],
        ownerEditable: true,
      });
      setTemplates([fresh, ...templates]);
      setSelId(fresh.id);
      toast.success("Template sealed in PostgreSQL");
    } catch (e) {
      toast.error(`Create failed: ${(e as Error).message}`);
    }
  };

  const deleteTpl = async () => {
    if (!sel) return;
    try {
      await TemplatesAPI.remove(sel.id);
      const remaining = templates.filter((t) => t.id !== sel.id);
      setTemplates(remaining);
      setAssignments(assignments.filter((a) => a.templateId !== sel.id));
      setSelId(remaining[0]?.id ?? "");
      toast.success("Template removed");
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`);
    }
  };

  const persistAssignments = async (next: TemplateAssignmentDTO[]) => {
    setAssignments(next);
    try {
      await TemplatesAPI.saveAssignments(next);
    } catch (e) {
      toast.error(`Assignment save failed: ${(e as Error).message}`);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title={t("page.templates.title")}
        subtitle={t("page.templates.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`text-[10px] font-mono gap-1 ${loadError ? "border-destructive text-destructive" : ""}`}
            >
              {loadError ? <WifiOff className="h-3 w-3" /> : <Database className="h-3 w-3" />}
              {loading
                ? "loading…"
                : loadError
                  ? "offline"
                  : `${templates.length} templates · ${assignments.length} assignments`}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => setBridgeOpen(true)}>
              <Wifi className="h-4 w-4 mr-1" />
              Connection
            </Button>
            <Button
              onClick={addTpl}
              disabled={!!loadError}
              className="bg-gradient-primary text-primary-foreground"
            >
              <Plus className="h-4 w-4 mr-1" />
              New Template
            </Button>
          </div>
        }
      />

      {loadError && (
        <Card className="glass border-destructive/40 mb-4">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-mono text-destructive">⚠ {loadError}</p>
              <p className="text-[11px] font-mono text-muted-foreground mt-1">
                The Mac IP may have changed. Enter the current address below.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => setBridgeOpen(true)}>
                Connection Settings
              </Button>
              <Button size="sm" onClick={hydrate}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <BridgeDialog open={bridgeOpen} onOpenChange={setBridgeOpen} onSaved={hydrate} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card className="glass lg:col-span-3">
          <CardContent className="p-3 space-y-1">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelId(t.id)}
                className={`w-full text-left border rounded p-2 ${selId === t.id ? "border-primary" : "border-border"}`}
              >
                <p className="text-xs font-medium">{t.name}</p>
                <p className="text-[10px] font-mono text-muted-foreground">
                  temp {t.temperature} · {t.agents.length} agents
                </p>
              </button>
            ))}
            {!loading && templates.length === 0 && (
              <p className="text-[11px] font-mono text-muted-foreground p-2">No templates yet.</p>
            )}
          </CardContent>
        </Card>

        {sel && (
          <Card className="glass lg:col-span-9">
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("tpl.tpl_name")}</Label>
                  <Input
                    value={sel.name}
                    onChange={(e) => upd({ name: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex items-center gap-2 border border-border rounded p-2 h-9">
                    <Switch
                      checked={sel.ownerEditable}
                      onCheckedChange={(v) => upd({ ownerEditable: v })}
                    />
                    <span className="text-xs font-mono">{t("tpl.user_can_modify")}</span>
                  </div>
                  <Button variant="outline" className="text-destructive" onClick={deleteTpl}>
                    Delete
                  </Button>
                </div>
              </div>

              <div>
                <Label>{t("tpl.system_prompt")}</Label>
                <Textarea
                  rows={3}
                  value={sel.systemPrompt}
                  onChange={(e) => upd({ systemPrompt: e.target.value })}
                  className="font-mono mt-1"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Temperature · {sel.temperature}</Label>
                  <Slider
                    value={[sel.temperature * 100]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) => upd({ temperature: v[0] / 100 })}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label>Top-P · {sel.topP}</Label>
                  <Slider
                    value={[sel.topP * 100]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) => upd({ topP: v[0] / 100 })}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label>{t("tpl.max_tokens")}</Label>
                  <Input
                    type="number"
                    value={sel.maxTokens}
                    onChange={(e) => upd({ maxTokens: Number(e.target.value) })}
                    className="font-mono mt-1"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>{t("tpl.custom_params")}</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      upd({
                        params: [...sel.params, { id: makeParamId(), name: "", value: "" }],
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {sel.params.map((p) => (
                    <div key={p.id} className="flex gap-2">
                      <Input
                        className="font-mono text-xs h-9"
                        placeholder="name"
                        value={p.name}
                        onChange={(e) =>
                          upd({
                            params: sel.params.map((x) =>
                              x.id === p.id ? { ...x, name: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Input
                        className="font-mono text-xs h-9"
                        placeholder="value"
                        value={p.value}
                        onChange={(e) =>
                          upd({
                            params: sel.params.map((x) =>
                              x.id === p.id ? { ...x, value: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-destructive"
                        onClick={() => upd({ params: sel.params.filter((x) => x.id !== p.id) })}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label>{t("tpl.allowed_agents")}</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {agentNames.map((a) => {
                    const on = sel.agents.includes(a);
                    return (
                      <Badge
                        key={a}
                        onClick={() =>
                          upd({
                            agents: on ? sel.agents.filter((x) => x !== a) : [...sel.agents, a],
                          })
                        }
                        className={`cursor-pointer font-mono ${on ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground"}`}
                      >
                        {a}
                      </Badge>
                    );
                  })}
                  {agentNames.length === 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">No agents registered yet.</span>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>{t("tpl.allowed_tools")}</Label>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {(sel.allowedTools ?? []).length || "all"}/{tools.length}
                  </Badge>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground mb-2">
                  Leave empty to grant access to every active tool. Selecting locks the template to this list only.
                </p>
                <div className="flex flex-wrap gap-2">
                  {tools.map((tool) => {
                    const at = sel.allowedTools ?? [];
                    const on = at.includes(tool.id);
                    return (
                      <button
                        key={tool.id}
                        onClick={() =>
                          upd({
                            allowedTools: on ? at.filter((x) => x !== tool.id) : [...at, tool.id],
                          })
                        }
                        className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
                        title={tool.description || tool.id}
                      >
                        {on ? "✓ " : ""}{tool.name}
                      </button>
                    );
                  })}
                  {tools.length === 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">No tools defined in the Forge yet.</span>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>{t("tpl.allowed_skills")}</Label>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {(sel.allowedSkills ?? []).length || "all"}/{skills.length}
                  </Badge>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground mb-2">
                  Sealed procedures (! triggers). Empty = grants all skills. Selecting locks the template to this list only.
                </p>
                <div className="flex flex-wrap gap-2">
                  {skills.map((sk) => {
                    const at = sel.allowedSkills ?? [];
                    const on = at.includes(sk.slug);
                    const riskColor = sk.risk_level === "critical" ? "border-destructive text-destructive" : sk.risk_level === "write" ? "border-chart-3 text-chart-3" : "border-border text-muted-foreground";
                    return (
                      <button
                        key={sk.id}
                        onClick={() =>
                          upd({
                            allowedSkills: on ? at.filter((x) => x !== sk.slug) : [...at, sk.slug],
                          })
                        }
                        className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary bg-primary/10" : riskColor}`}
                        title={`${sk.description || sk.slug} · risk:${sk.risk_level}`}
                      >
                        {on ? "✓ " : "!"}{sk.slug}
                      </button>
                    );
                  })}
                  {skills.length === 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">No skills sealed yet.</span>
                  )}
                </div>
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t("users.llm_perm")}</Label>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {(sel.allowedProviders ?? []).length || "all"}/{llmProviders.length || "—"}
                    </Badge>
                    <Switch
                      checked={sel.canOverrideProvider !== false}
                      onCheckedChange={(v) => upd({ canOverrideProvider: v })}
                    />
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {t("tpl.user_can_pick")}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">
                  {t("tpl.llm_hint")}
                </p>
                {providerError && (
                  <p className="text-[10px] font-mono text-destructive">
                    Provider API: {providerError}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {llmProviders.length === 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">{t("users.no_llm")}</span>
                  )}
                  {llmProviders.map((p) => {
                    const ap = sel.allowedProviders ?? [];
                    const on = ap.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() =>
                          upd({ allowedProviders: on ? ap.filter((x) => x !== p.id) : [...ap, p.id] })
                        }
                        className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"} ${!p.isActive ? "opacity-50" : ""}`}
                      >
                        {on ? "✓ " : ""}
                        {p.providerName}
                        {!p.isActive && <span className="ml-1 text-[9px]">(off)</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t("tpl.allowed_models")}</Label>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {(sel.allowedModels ?? []).length || "all"}/{sysModels.length || "—"}
                  </Badge>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">
                  {t("tpl.allowed_models_hint")}
                </p>
                <div className="flex items-center gap-2 mb-1">
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] font-mono"
                    onClick={() => upd({ allowedModels: sysModels.map(m => m.id) })}>
                    {t("users.select_all")}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] font-mono"
                    onClick={() => upd({ allowedModels: [] })}>
                    {t("users.select_none")}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sysModels.length === 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">{t("users.no_models")}</span>
                  )}
                  {sysModels.map((m) => {
                    const am = sel.allowedModels ?? [];
                    const on = am.includes(m.id);
                    const label = m.modelName || m.id.split(/[\\/]/).filter(Boolean).pop() || m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() =>
                          upd({ allowedModels: on ? am.filter((x) => x !== m.id) : [...am, m.id] })
                        }
                        className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
                      >
                        {on ? "✓ " : ""}{label}
                        <span className="ml-1 text-[9px] opacity-60">{m.provider}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <AllowedVisionProfilesChips scope="templates" id={sel.id} />
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="glass mt-4">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm font-mono uppercase tracking-widest">
              User → Template Assignments
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                persistAssignments([
                  ...assignments,
                  { id: makeAssignmentId(), username: "", templateId: templates[0]?.id ?? "" },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t("tpl.assign")}
            </Button>
          </div>
          {assignments.map((a) => (
            <div key={a.id} className="grid grid-cols-12 gap-2">
              <Input
                className="col-span-5 font-mono text-xs h-9"
                placeholder="username"
                value={a.username}
                onChange={(e) =>
                  persistAssignments(
                    assignments.map((x) =>
                      x.id === a.id ? { ...x, username: e.target.value } : x,
                    ),
                  )
                }
              />
              <Select
                value={a.templateId}
                onValueChange={(v) =>
                  persistAssignments(
                    assignments.map((x) => (x.id === a.id ? { ...x, templateId: v } : x)),
                  )
                }
              >
                <SelectTrigger className="col-span-6 h-9">
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="col-span-1 h-9 w-9 text-destructive"
                onClick={() => persistAssignments(assignments.filter((x) => x.id !== a.id))}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {assignments.length === 0 && (
            <p className="text-[11px] font-mono text-muted-foreground">
              {t("tpl.no_assignments")}
            </p>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

function BridgeDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [override, setOverride] = useState("");
  const [probing, setProbing] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, "ok" | "fail" | "pending">>({});

  useEffect(() => {
    if (!open) return;
    setOverride(getBridgeOverride() ?? "");
    setCandidates(getBridgeCandidates());
    setResults({});
  }, [open]);

  const probeAll = async () => {
    setProbing(true);
    const list = getBridgeCandidates();
    setCandidates(list);
    const next: Record<string, "ok" | "fail" | "pending"> = {};
    list.forEach((u) => (next[u] = "pending"));
    setResults({ ...next });
    await Promise.all(
      list.map(async (base) => {
        try {
          const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(30000) });
          next[base] = r.ok ? "ok" : "fail";
        } catch {
          next[base] = "fail";
        }
        setResults({ ...next });
      }),
    );
    setProbing(false);
  };

  const save = () => {
    setBridgeOverride(override.trim() || null);
    toast.success("Connection settings saved");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{t("tpl.bridge_settings")}</DialogTitle>
          <DialogDescription>
            Without an override, the bridge connects directly through the current window
            hostname on port :3005.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Override URL (optional)</Label>
            <Input
              className="font-mono text-xs mt-1"
              placeholder="http://192.168.1.50:3005"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
            />
          </div>

          <div className="border border-border rounded p-2 space-y-1 max-h-48 overflow-auto">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                Candidate addresses
              </p>
              <Button size="sm" variant="ghost" onClick={probeAll} disabled={probing}>
                {probing ? "Scanning…" : "Test All"}
              </Button>
            </div>
            {candidates.map((u) => {
              const s = results[u];
              return (
                <div key={u} className="flex items-center justify-between text-[11px] font-mono">
                  <span className="truncate">{u}</span>
                  <span
                    className={
                      s === "ok"
                        ? "text-emerald-500"
                        : s === "fail"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {s === "ok"
                      ? "● online"
                      : s === "fail"
                        ? "● offline"
                        : s === "pending"
                          ? "…"
                          : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} className="bg-gradient-primary text-primary-foreground">
            Save & Refresh
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
