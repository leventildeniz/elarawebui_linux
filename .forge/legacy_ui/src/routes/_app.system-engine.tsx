import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Cpu, Database, BrainCircuit, FolderTree, Globe, Power, Play, Square, Terminal, Activity, ServerCog, Compass, ShieldCheck, Plug, Radio, Shield } from "lucide-react";
import { SystemEngineAPI, EngineIntentAPI, EngineRuntimeAPI, RbacAPI, resolveApiBaseUrl, actorHeaders, type EngineSnapshot, type SystemLogEvent, type IntentConfigDTO, type RbacEntry, type RuntimeProviderCfg, type RuntimeProviderId, type RuntimeProviderResponse } from "@/lib/api-client";
import { IntentGuardCard, AgentsAllowlistCard, ToolsAllowlistCard, DeniedToolsCard, BridgeTelemetryCard } from "@/components/orchestrator-bridge-cards";
import { DatabaseOps } from "@/components/database-ops";
import { RuntimeSafetyNet } from "@/components/runtime-safety-net";
import { useI18n } from "@/lib/i18n";
import { useRbac } from "@/lib/rbac";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useVisiblePoll } from "@/lib/use-visible-poll";

export const Route = createFileRoute("/_app/system-engine")({
  component: SystemEnginePage,
});

function workerToneFor(status: string): { dot: string; label: string } {
  switch (status) {
    case "online-auto":     return { dot: "bg-emerald-500", label: "engine.worker.online_auto" };
    case "online-external": return { dot: "bg-cyan-500",    label: "engine.worker.online_external" };
    case "starting":        return { dot: "bg-amber-500 animate-pulse", label: "engine.worker.starting" };
    default:                return { dot: "bg-destructive", label: "engine.worker.down" };
  }
}

function GlassCard({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className={`glass border-primary/20 ${accent ? "shadow-[0_0_24px_-12px_hsl(var(--primary))]" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" /> {label}
        </div>
        <p className="mt-2 truncate font-mono text-base font-bold text-foreground" title={value}>{value}</p>
        {sub && <p className="mt-1 truncate text-[10px] font-mono text-muted-foreground/70" title={sub}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ServiceControlCard() {
  const { t } = useI18n();
  const [serviceName, setServiceName] = useState("elara-worker");
  const [busy, setBusy] = useState(false);

  const handleAction = async (action: "start" | "stop" | "restart") => {
    if (!serviceName.trim()) {
      toast.error("Please enter a service name");
      return;
    }
    setBusy(true);
    try {
      const r = await SystemEngineAPI.serviceAction(serviceName.trim(), action);
      if (r.ok) {
        toast.success(`${serviceName} ${action}ed successfully`);
      } else {
        toast.error(`${serviceName} ${action} failed: ${r.error || "Unknown error"}`);
      }
    } catch (e) {
      toast.error(`Service ${action} failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="glass border-primary/20 mt-4">
      <CardHeader>
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <ServerCog className="h-4 w-4 text-primary" /> System Service Control
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input 
            value={serviceName} 
            onChange={(e) => setServiceName(e.target.value)} 
            placeholder="Service name (e.g. elara-worker)" 
            className="h-9 font-mono text-xs flex-1" 
          />
          <div className="flex gap-1">
            <Button 
              variant="outline" 
              size="sm" 
              className="h-9 text-[10px] font-mono" 
              onClick={() => setServiceName("elara-worker")}
            >
              worker
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="h-9 text-[10px] font-mono" 
              onClick={() => setServiceName("elara-middleware")}
            >
              middleware
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="flex-1 h-9 font-mono text-xs gap-2" 
            disabled={busy} 
            onClick={() => handleAction("start")}
          >
            <Play className="h-3 w-3" /> Start
          </Button>
          <Button 
            variant="outline" 
            className="flex-1 h-9 font-mono text-xs gap-2" 
            disabled={busy} 
            onClick={() => handleAction("stop")}
          >
            <Square className="h-3 w-3" /> Stop
          </Button>
          <Button 
            variant="outline" 
            className="flex-1 h-9 font-mono text-xs gap-2" 
            disabled={busy} 
            onClick={() => handleAction("restart")}
          >
            <Activity className="h-3 w-3" /> Restart
          </Button>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">
          Interface for system-level managers (systemd on Linux, launchd on macOS). 
          Targeting .plist or .service units.
        </p>
      </CardContent>
    </Card>
  );
}

function OverviewTab({ snap }: { snap: EngineSnapshot | null }) {
  const { t } = useI18n();
  if (!snap) {
    return <p className="text-xs font-mono text-muted-foreground">⏳ {t("engine.console.empty")}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <GlassCard icon={ServerCog} label={t("engine.card.backend")} value={`:${snap.server.port}`} sub={`PID ${snap.server.pid} · ${snap.server.node} · uptime ${snap.server.uptime_s}s`} accent />
      <GlassCard icon={Cpu} label={t("engine.card.llm_endpoint")} value={snap.llm.baseUrl ?? "—"} sub={snap.llm.model ?? ""} />
      <GlassCard icon={BrainCircuit} label={t("engine.card.llm_model")} value={snap.llm.model ?? "—"} />
      <GlassCard icon={BrainCircuit} label={t("engine.card.embed_model")} value={snap.embed.model ?? "—"} sub={`${snap.embed.dim}D · ${snap.embed.baseUrl ?? ""}`} />
      <GlassCard icon={Database} label={t("engine.card.database")} value={snap.database.url ?? "—"} sub={`pool max=${snap.database.pool.max} · idle=${snap.database.pool.idle} · waiting=${snap.database.pool.waiting}`} />
      <GlassCard icon={Activity} label={t("engine.card.worker")} value={`:${snap.worker.port} · ${snap.worker.status}`} sub={snap.worker.backend ? `${snap.worker.backend} · pid ${snap.worker.pid ?? "—"} · ${snap.worker.uptime_s}s` : (snap.worker.lastError ?? "")} />
      <GlassCard icon={FolderTree} label={t("engine.card.upload_dir")} value={snap.server.uploadDir} />
      <GlassCard icon={Globe} label={t("engine.card.cors")} value={snap.server.cors.length ? snap.server.cors.join(" · ") : "—"} />
    </div>
  );
}

function ConsoleTab() {
  const { t } = useI18n();
  const [events, setEvents] = useState<SystemLogEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "server" | "worker">("all");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stop = SystemEngineAPI.streamLogs((e) => {
      setEvents((prev) => {
        const next = [...prev, e];
        if (next.length > 1000) next.splice(0, next.length - 1000);
        return next;
      });
    });
    return stop;
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events]);
  const filtered = filter === "all" ? events : events.filter((e) => e.source === filter);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("engine.console.filter")}</span>
        {(["all", "server", "worker"] as const).map((k) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} className="h-7 font-mono text-[10px]" onClick={() => setFilter(k)}>
            {t(`engine.console.${k}` as any)}
          </Button>
        ))}
        <Badge variant="outline" className="ml-auto font-mono text-[10px]">{filtered.length} lines</Badge>
      </div>
      <div ref={ref} className="h-[480px] overflow-auto rounded-lg border border-border bg-black/85 p-3 font-mono text-[11px] leading-relaxed text-emerald-300/90">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground">⌁ {t("engine.console.empty")}</p>
        ) : (
          filtered.map((e, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-muted-foreground/60 shrink-0">{new Date(e.ts).toISOString().slice(11, 19)}</span>
              <span className={`shrink-0 ${e.source === "worker" ? "text-cyan-400" : "text-primary"}`}>[{e.source}]</span>
              <span className="whitespace-pre-wrap break-all">{e.line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SystemEnginePage() {
  const { t } = useI18n();
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [activeTab, setActiveTab] = useState<string>("overview");

  useEffect(() => {
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const s = await SystemEngineAPI.engine();
        if (s) setSnap(s);
      } catch { /* keep last snap; header badge reflects worker tone */ }
      finally { inFlight = false; }
    };
    void tick();
  }, []);
  useVisiblePoll(async () => {
    try { const s = await SystemEngineAPI.engine(); if (s) setSnap(s); } catch { /* */ }
  }, 30000);

  const tone = useMemo(() => workerToneFor(snap?.worker.status ?? "down"), [snap?.worker.status]);

  const startWorker = async () => {
    setBusy("start");
    try {
      const r = await SystemEngineAPI.startWorker();
      if (r.ok) toast.success(t("engine.toast.worker_started"));
      else toast.error(`${t("engine.toast.worker_failed")}${r.error ? ` · ${r.error}` : ""}`);
    } catch (e) {
      toast.error(`${t("engine.toast.worker_failed")} · ${(e as Error).message}`);
    } finally { setBusy(null); }
  };
  const stopWorker = async () => {
    setBusy("stop");
    try { await SystemEngineAPI.stopWorker(); toast.success(t("engine.toast.worker_stopped")); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <PageShell>
      <PageHeader
        title={t("engine.title")}
        subtitle={t("engine.subtitle")}
        actions={
          <>
            <Badge variant="outline" className="gap-1.5 font-mono text-[10px]">
              <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
              {t(tone.label as any)}
              {snap?.worker.pid ? ` · pid ${snap.worker.pid}` : ""}
            </Badge>
            <Badge variant="outline" className="gap-1.5 font-mono text-[10px] text-muted-foreground">
              <Activity className="h-3 w-3" /> {t("engine.worker.autonomous")}
            </Badge>
          </>
        }
      />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="font-mono text-xs">
          <TabsTrigger value="overview"><Power className="mr-1 h-3.5 w-3.5" />{t("engine.tab.overview")}</TabsTrigger>
          <TabsTrigger value="runtime"><Plug className="mr-1 h-3.5 w-3.5" />Runtime</TabsTrigger>
          <TabsTrigger value="intent"><Compass className="mr-1 h-3.5 w-3.5" />Intent Router</TabsTrigger>
          <TabsTrigger value="bridge"><Radio className="mr-1 h-3.5 w-3.5" />Orchestrator Bridge</TabsTrigger>
          <TabsTrigger value="rbac"><ShieldCheck className="mr-1 h-3.5 w-3.5" />Tab RBAC</TabsTrigger>
          <TabsTrigger value="vector"><BrainCircuit className="mr-1 h-3.5 w-3.5" />{t("engine.tab.vector")}</TabsTrigger>
          <TabsTrigger value="safety"><Shield className="mr-1 h-3.5 w-3.5" />Runtime Safety</TabsTrigger>
          <TabsTrigger value="console"><Terminal className="mr-1 h-3.5 w-3.5" />{t("engine.tab.console")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab snap={snap} /></TabsContent>
        {activeTab === "runtime" && <TabsContent value="runtime" forceMount><RuntimeProviderCard /></TabsContent>}
        {activeTab === "intent" && <TabsContent value="intent" forceMount className="space-y-4"><IntentRouterCard /><WatchdogCard /><TransportCard /></TabsContent>}
        {activeTab === "bridge" && <TabsContent value="bridge" forceMount className="space-y-4"><IntentGuardCard /><AgentsAllowlistCard /><ToolsAllowlistCard /><DeniedToolsCard /><BridgeTelemetryCard /></TabsContent>}
        {activeTab === "rbac" && <TabsContent value="rbac" forceMount><RbacEditorCard /></TabsContent>}
        {activeTab === "vector" && <TabsContent value="vector" forceMount><DatabaseOps /></TabsContent>}
        {activeTab === "safety" && <TabsContent value="safety" forceMount><RuntimeSafetyNet /></TabsContent>}
        {activeTab === "console" && <TabsContent value="console" forceMount><ConsoleTab /></TabsContent>}
      </Tabs>
    </PageShell>
  );
}

// ---- Intent Router (Architect direksiyon) ----------------------------------
function IntentRouterCard() {
  const { locale } = useI18n();
  const [cfg, setCfg] = useState<IntentConfigDTO>({
    technicalThreshold: 0.5,
    forceRagMode: "auto",
    semanticThreshold: 0.35,
    classifierMode: "hybrid",
    classifierPrompt: "",
  });
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => {
    try {
      const r = await EngineIntentAPI.get();
      setCfg(r.config);
      setPromptDraft(r.config.classifierPrompt || r.defaultClassifierPrompt || "");
      setDefaultPrompt(r.defaultClassifierPrompt || "");
    } catch { /* */ }
    finally { setLoading(false); }
  })(); }, []);
  const save = async (next: IntentConfigDTO) => {
    setCfg(next);
    try { await EngineIntentAPI.set(next); toast.success("Intent router updated"); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Card className="glass border-primary/20">
      <CardHeader><CardTitle className="text-sm font-mono">Semantic Intent Router · ELARA-native Pipeline</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] font-mono">
          <span className="font-bold uppercase tracking-widest text-destructive">⛔ {"BYPASS DISABLED · POLICY V4"}</span>
          <p className="mt-1 text-muted-foreground">
            {"Instant template bypass removed. Every request — chit-chat or technical — flows through the active runtime. The router only shapes system-prompt tone (smalltalk vs query); it no longer routes around the model."}
          </p>
        </div>
        {loading ? <p className="text-xs font-mono text-muted-foreground">⏳ loading…</p> : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span>Similarity Threshold (RAG anchor)</span>
                <Input type="number" min={0.05} max={1} step={0.01} value={cfg.semanticThreshold}
                  onChange={(e) => setCfg(c => ({ ...c, semanticThreshold: Math.min(1, Math.max(0.05, Number(e.target.value) || 0.35)) }))}
                  onBlur={() => save(cfg)}
                  className="h-7 w-24 font-mono text-xs" />
              </div>
              <Slider value={[cfg.semanticThreshold]} min={0.05} max={1} step={0.01}
                onValueChange={(v) => setCfg(c => ({ ...c, semanticThreshold: v[0] }))}
                onValueCommit={(v) => save({ ...cfg, semanticThreshold: v[0] })} />
              <p className="text-[10px] font-mono text-muted-foreground">{"Query is compared to the technical/library concept vector. Below this threshold the router bypasses RAG/PostgreSQL and answers directly."}</p>
            </div>
            <div className="space-y-2">
              <span className="text-[11px] font-mono">Classifier Mode</span>
              <div className="flex gap-2">
                {(["embedding","llm","hybrid"] as const).map(m => (
                  <Button key={m} size="sm" variant={cfg.classifierMode === m ? "default" : "outline"}
                    className="h-7 font-mono text-[11px]"
                    onClick={() => save({ ...cfg, classifierMode: m })}>{m}</Button>
                ))}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground">{"embedding → runtime cosine gate · llm → zero-shot to local LLM · hybrid → embedding first, LLM fallback."}</p>
            </div>
            <div className="space-y-2">
              <span className="text-[11px] font-mono">Intent Classifier Prompt</span>
              <Textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                onBlur={() => save({ ...cfg, classifierPrompt: promptDraft })}
                className="min-h-32 font-mono text-xs"
                placeholder={defaultPrompt}
              />
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-mono text-muted-foreground">{"Local LLM uses this prompt to answer 'RAG or chit-chat?'. No dictionary — intent is decided by the model."}</p>
                <Button size="sm" variant="ghost" className="h-6 font-mono text-[10px]"
                  onClick={() => { setPromptDraft(defaultPrompt); save({ ...cfg, classifierPrompt: defaultPrompt }); }}>
                  reset
                </Button>
              </div>
            </div>
            <div className="space-y-2 pt-2 border-t border-border/40">
              <span className="text-[11px] font-mono text-muted-foreground">Force RAG Mode (override)</span>
              <div className="flex gap-2">
                {(["auto","always","never"] as const).map(m => (
                  <Button key={m} size="sm" variant={cfg.forceRagMode === m ? "default" : "outline"}
                    className="h-7 font-mono text-[11px]"
                    onClick={() => save({ ...cfg, forceRagMode: m })}>{m}</Button>
                ))}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground">{"always → bypass router, every query hits RAG · never → RAG off · auto → semantic router decides."}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Tab-level RBAC editor (Admin only) ------------------------------------
function RbacEditorCard() {
  const { locale } = useI18n();
  const { isAdmin } = useRbac();
  const [allTabs, setAllTabs] = useState<string[]>([]);
  const [entries, setEntries] = useState<RbacEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try { const r = await RbacAPI.list(); setAllTabs(r.allTabs); setEntries(r.entries); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  if (!isAdmin) return <p className="text-xs font-mono text-muted-foreground">🛡️ {"Admin access required."}</p>;

  const toggle = async (e: RbacEntry, tab: string) => {
    const has = e.allowed_tabs.includes(tab);
    const next = has ? e.allowed_tabs.filter(t => t !== tab) : [...e.allowed_tabs, tab];
    try {
      await RbacAPI.save({ scopeType: e.scope_type, scopeId: e.scope_id, allowedTabs: next });
      setEntries(prev => prev.map(x => (x.scope_type === e.scope_type && x.scope_id === e.scope_id) ? { ...x, allowed_tabs: next } : x));
    } catch (err) { toast.error((err as Error).message); }
  };

  return (
    <Card className="glass border-primary/20">
      <CardHeader><CardTitle className="text-sm font-mono">{"Tab Permissions · Architect decides"}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {loading ? <p className="text-xs font-mono text-muted-foreground">⏳ loading…</p> : entries.map(e => (
          <div key={`${e.scope_type}:${e.scope_id}`} className="rounded border border-border/60 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px]">{e.scope_type}</Badge>
              <span className="font-mono text-xs">{e.scope_id}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{e.allowed_tabs.length}/{allTabs.length}</span>
            </div>
            <div className="grid grid-cols-3 gap-1 md:grid-cols-5">
              {allTabs.map(tab => {
                const label = tab;
                return (
                  <label key={tab} className="flex items-center gap-2 text-[11px] font-mono cursor-pointer" title={tab}>
                    <Checkbox checked={e.allowed_tabs.includes(tab)} onCheckedChange={() => toggle(e, tab)} />
                    <span className="truncate">{label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <p className="text-[10px] font-mono text-muted-foreground">{"Admin role always sees every tab · unregistered scope = chat only."}</p>
      </CardContent>
    </Card>
  );
}

// ---- Runtime Provider Switch (LOCAL / Legacy HTTP / Custom) ----------------------
const EMPTY_MODELS: Record<RuntimeProviderId, string[]> = { LOCAL: [], legacy: [], custom: [] };
const EMPTY_PRESETS: Record<RuntimeProviderId, { baseUrl: string; model: string }> = {
  LOCAL:    { baseUrl: "http://127.0.0.1:/v1", model: "" },
  legacy: { baseUrl: "http://127.0.0.1:",   model: "" },
  custom: { baseUrl: "",                          model: "" },
};

function normalizeRuntimeData(r: RuntimeProviderResponse) {
  const config: RuntimeProviderCfg = {
    provider: r.config?.provider ?? "LOCAL",
    baseUrl:  r.config?.baseUrl  ?? "",
    model:    r.config?.model    ?? "",
    models:   { ...EMPTY_MODELS, ...(r.config?.models ?? {}) },
  };
  const presets = { ...EMPTY_PRESETS, ...(r.presets ?? {}) };
  const resolved = r.resolved ?? { baseUrl: "", upstreamBaseUrl: "", model: "", isLocal: false, hydrated: false, updatedAt: null };
  return { config, presets, resolved };
}

function RuntimeProviderCard() {
  const { locale } = useI18n();
  const [data, setData] = useState<{ config: RuntimeProviderCfg; resolved: RuntimeProviderResponse["resolved"]; presets: Record<RuntimeProviderId, { baseUrl: string; model: string }> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [baseDraft, setBaseDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [newModelDraft, setNewModelDraft] = useState("");

  const apply = (r: RuntimeProviderResponse) => {
    const norm = normalizeRuntimeData(r);
    setData(norm);
    setBaseDraft(norm.config.baseUrl || "");
    setModelDraft(norm.config.model || "");
  };

  const refresh = async () => {
    try { apply(await EngineRuntimeAPI.get()); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const save = async (next: Partial<RuntimeProviderCfg>) => {
    setBusy(true);
    try {
      const r = await EngineRuntimeAPI.set(next);
      apply(r);
      toast.success(`Runtime saved · ${r.resolved?.baseUrl ?? ""}`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  if (loading || !data) {
    return <p className="text-xs font-mono text-muted-foreground">⏳ loading…</p>;
  }
  const { config, resolved, presets } = data;
  const providerModels = config.models[config.provider] ?? [];
  const activeProviderPreset = presets[config.provider] ?? { baseUrl: "", model: "" };

  const addModel = () => {
    const m = newModelDraft.trim();
    if (!m) return;
    if (providerModels.includes(m)) { setNewModelDraft(""); return; }
    const nextModels = { ...config.models, [config.provider]: [...providerModels, m] };
    setNewModelDraft("");
    void save({ provider: config.provider, baseUrl: config.baseUrl, model: config.model || m, models: nextModels });
  };
  const removeModel = (m: string) => {
    const nextList = providerModels.filter(x => x !== m);
    const nextModels = { ...config.models, [config.provider]: nextList };
    const nextActive = config.model === m ? (nextList[0] ?? "") : config.model;
    void save({ provider: config.provider, baseUrl: config.baseUrl, model: nextActive, models: nextModels });
  };
  const pickModel = (m: string) => {
    setModelDraft(m);
    void save({ provider: config.provider, baseUrl: config.baseUrl, model: m, models: config.models });
  };

  return (
    <Card className="glass border-primary/20">
      <CardHeader>
        <CardTitle className="text-sm font-mono">
          Runtime Provider · {"Local / Legacy HTTP / Custom — Configuration Console"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <span className="text-[11px] font-mono">Provider</span>
          <div className="flex flex-wrap gap-2">
            {(["LOCAL","legacy","custom"] as const).map(p => (
              <Button key={p} size="sm" variant={config.provider === p ? "default" : "outline"}
                disabled={busy}
                className="h-8 font-mono text-[11px] uppercase"
                onClick={() => save({ provider: p, baseUrl: "", model: "", models: config.models })}>
                {p}
              </Button>
            ))}
          </div>
          <p className="text-[10px] font-mono text-muted-foreground">{"Local runtime → :/v1 · Legacy HTTP → : · Custom → your own endpoint. Selection is persisted to PostgreSQL and survives reboots."}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Base URL override</span>
            <Input value={baseDraft} onChange={(e) => setBaseDraft(e.target.value)}
              placeholder={activeProviderPreset.baseUrl || "http://127.0.0.1:/v1"}
              className="h-8 font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Active model</span>
            <Input value={modelDraft} onChange={(e) => setModelDraft(e.target.value)}
              placeholder={activeProviderPreset.model || "qwen2.5:72b"}
              className="h-8 font-mono text-xs" />
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <Button size="sm" disabled={busy}
              onClick={() => save({ provider: config.provider, baseUrl: baseDraft.trim(), model: modelDraft.trim(), models: config.models })}
              className="h-8 font-mono text-[11px]">
              {"Apply"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => save({ provider: config.provider, baseUrl: "", model: "", models: config.models })}
              className="h-8 font-mono text-[11px]">
              {"Reset to preset"}
            </Button>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {"Active"}: <span className="text-emerald-400">{resolved.baseUrl}</span> · <span className="text-cyan-400">{resolved.model || "—"}</span>
            </span>
          </div>
          <p className="md:col-span-2 font-mono text-[10px] text-muted-foreground">
            {"Persistent store"}: {resolved.hydrated ? "PostgreSQL app_settings" : "pending"} · upstream: <span className="text-foreground">{resolved.upstreamBaseUrl || resolved.baseUrl || "—"}</span>
          </p>
        </div>

        <div className="space-y-2 pt-3 border-t border-border/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-widest">{"Model catalog"} · {config.provider}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{providerModels.length} {"models"}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 min-h-[32px]">
            {providerModels.length === 0 ? (
              <span className="text-[10px] font-mono text-muted-foreground">
                {"No models yet — add below."}
              </span>
            ) : providerModels.map(m => {
              const active = config.model === m;
              return (
                <Badge key={m}
                  variant={active ? "default" : "outline"}
                  className="font-mono text-[10px] cursor-pointer gap-1.5"
                  onClick={() => pickModel(m)}>
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                  {m}
                  <span
                    role="button"
                    aria-label="remove"
                    onClick={(e) => { e.stopPropagation(); removeModel(m); }}
                    className="ml-1 opacity-60 hover:opacity-100">×</span>
                </Badge>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Input value={newModelDraft} onChange={(e) => setNewModelDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
              placeholder={activeProviderPreset.model || "model name (e.g. qwen2.5:72b)"}
              className="h-8 font-mono text-xs" />
            <Button size="sm" disabled={busy || !newModelDraft.trim()}
              onClick={addModel} className="h-8 font-mono text-[11px]">
              {"Add"}
            </Button>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground">{"Register multiple models per provider. Click to switch active, × to remove. Selection is persisted to PostgreSQL."}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Runtime Watchdog Cockpit (v5) ---------------------------------------
function WatchdogCard() {
  const { locale } = useI18n();
  type WatchdogCfg = { headersMs: number; firstTokenMs: number; idleDeltaMs: number; warmingNoticeMs: number; coldFirstTokenMs: number; streamTimeoutMs: number; warmupTimeoutMs: number };
  type WorkerSelfHeal = { cooldownMs: number; respawnMax: number };
  type WorkerSelfHealFloors = { cooldownMs: number; respawnMax: number; respawnMaxCeiling: number };
  const [cfg, setCfg] = useState<WatchdogCfg | null>(null);
  const [floors, setFloors] = useState<WatchdogCfg | null>(null);
  const [selfHeal, setSelfHeal] = useState<WorkerSelfHeal | null>(null);
  const [selfHealFloors, setSelfHealFloors] = useState<WorkerSelfHealFloors | null>(null);
  const [loading, setLoading] = useState(true);
  const base = resolveApiBaseUrl();
  useEffect(() => { (async () => {
    try {
      const r = await fetch(`${base}/api/engine/watchdog`).then(x => x.json());
      setCfg(r.config); setFloors(r.floors);
      if (r.workerSelfHeal) setSelfHeal(r.workerSelfHeal);
      if (r.workerSelfHealFloors) setSelfHealFloors(r.workerSelfHealFloors);
    } catch { /* */ }
    finally { setLoading(false); }
  })(); }, [base]);
  const save = async (next: typeof cfg, nextSelfHeal?: WorkerSelfHeal | null) => {
    if (!next) return;
    setCfg(next);
    if (nextSelfHeal) setSelfHeal(nextSelfHeal);
    try {
      const body: Record<string, unknown> = { ...next };
      if (nextSelfHeal) body.workerSelfHeal = nextSelfHeal;
      const r = await fetch(`${base}/api/engine/watchdog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(x => x.json());
      setCfg(r.config);
      if (r.workerSelfHeal) setSelfHeal(r.workerSelfHeal);
      toast.success("Watchdog configuration saved");
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Card className="glass border-primary/20">
      <CardHeader><CardTitle className="text-sm font-mono">Runtime Watchdog · Freeze vs Cold-Start (v5)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-mono">
          <span className="font-bold uppercase tracking-widest text-amber-600">⏱️ {"GLOBAL FALLBACK"}</span>
          <p className="mt-1 text-muted-foreground">{"These values apply only when the selected model leaves Runtime Safety empty. Model card values win."}</p>
        </div>
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] font-mono">
          <span className="font-bold uppercase tracking-widest text-destructive">🔒 {"MODEL > GLOBAL > BOOT"}</span>
          <p className="mt-1 text-muted-foreground">{"Effective timeout is resolved per request and logged as runtime-safety with source=model/global/env."}</p>
        </div>
        {loading || !cfg || !floors ? <p className="text-xs font-mono text-muted-foreground">⏳ loading…</p> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([
              ["headersMs", "Header timeout (ms)", "Cap for runtime HTTP response. Cold-start buffer."],
              ["firstTokenMs", "First-token timeout (ms)", "Headers received; window for first delta."],
              ["idleDeltaMs", "Idle delta timeout (ms)", "Max gap between tokens; exceeded = broken stream."],
              ["warmingNoticeMs", "Warming notice (ms)", "After this delay 'local_warming' frame is sent to client."],
              ["coldFirstTokenMs", "Cold first-token timeout (ms)", "Extra first-token budget for cold or freshly swapped models."],
              ["streamTimeoutMs", "Total stream timeout (ms)", "Hard ceiling for one model answer."],
              ["warmupTimeoutMs", "Warmup timeout (ms)", "Budget for optional local warmup probes."],
            ] as const).map(([key, label, hint]) => (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span>{label}</span>
                  <Input type="number" min={floors[key]} step={1000} value={cfg[key]}
                    onChange={(e) => setCfg(c => c ? { ...c, [key]: Math.max(floors[key], Number(e.target.value) || floors[key]) } : c)}
                    onBlur={() => save(cfg)}
                    className="h-7 w-28 font-mono text-xs" />
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">{hint} · min: {Math.round(floors[key]/1000)}s</p>
              </div>
            ))}
          </div>
        )}
        {selfHeal && selfHealFloors && (
          <div className="space-y-3 border-t border-border/40 pt-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">Worker self-heal</h4>
              <span className="text-[10px] font-mono text-muted-foreground">Embedding worker respawn policy</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span>Worker self-heal cooldown (s)</span>
                  <Input type="number" min={Math.round(selfHealFloors.cooldownMs / 1000)} step={10}
                    value={Math.round(selfHeal.cooldownMs / 1000)}
                    onChange={(e) => setSelfHeal(s => s ? { ...s, cooldownMs: Math.max(selfHealFloors.cooldownMs, (Number(e.target.value) || 0) * 1000) } : s)}
                    onBlur={() => save(cfg, selfHeal)}
                    className="h-7 w-28 font-mono text-xs" />
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">Minimum gap between two self-heal attempts. · min: {Math.round(selfHealFloors.cooldownMs/1000)}s</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span>Worker respawn max attempts</span>
                  <Input type="number" min={selfHealFloors.respawnMax} max={selfHealFloors.respawnMaxCeiling} step={1}
                    value={selfHeal.respawnMax}
                    onChange={(e) => setSelfHeal(s => s ? { ...s, respawnMax: Math.min(selfHealFloors.respawnMaxCeiling, Math.max(selfHealFloors.respawnMax, Number(e.target.value) || selfHealFloors.respawnMax)) } : s)}
                    onBlur={() => save(cfg, selfHeal)}
                    className="h-7 w-28 font-mono text-xs" />
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">Circuit breaker trips above this many respawns per 10-minute window. · min: {selfHealFloors.respawnMax} · max: {selfHealFloors.respawnMaxCeiling}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- v7 · Transport Cockpit (Persistent Tunnel + Preflight Reset) ---------
// v9 — KV heartbeat + offline mode visible to operator.
type TransportState = {
  keepAlive: boolean;
  resetEnabled: boolean;
  resetUrl: string;
  lastResetAt: number;
  lastResetStatus: string;
  lastResetDetail: string;
  lastAbortAt: number;
  lastAbortReason: string;
  inflight: number;
  lastActivityAt: number;
  heartbeatMs: number;
  heartbeatEnabled: boolean;
  lastHeartbeatAt: number;
  lastHeartbeatStatus: string;
  lastHeartbeatDetail: string;
  hfOffline: boolean;
  transformersOffline: boolean;
  hfDatasetsOffline: boolean;
};
function TransportCard() {
  const { locale } = useI18n();
  const [state, setState] = useState<TransportState | null>(null);
  const [resetUrl, setResetUrl] = useState("");
  const [hbMs, setHbMs] = useState<number>(120000);
  const [restartingLocal, setRestartingLocal] = useState(false);
  const base = resolveApiBaseUrl();
  const load = async () => {
    try {
      const r = await fetch(`${base}/api/engine/transport`).then(x => x.json());
      setState(r.transport);
      setResetUrl(r.transport?.resetUrl || "");
      if (Number.isFinite(Number(r.transport?.heartbeatMs))) setHbMs(Number(r.transport.heartbeatMs));
    } catch { /* */ }
  };
  useEffect(() => { void load(); }, [base]);
  useVisiblePoll(load, 15000);
  const save = async (patch: Partial<TransportState>) => {
    try {
      const r = await fetch(`${base}/api/engine/transport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then(x => x.json());
      setState(r.transport);
      setResetUrl(r.transport?.resetUrl || "");
      toast.success("Transport configuration saved");
    } catch (e) { toast.error((e as Error).message); }
  };
  const fmtTs = (n: number) => n ? new Date(n).toLocaleTimeString() : "—";
  const fmtAgo = (n: number) => {
    if (!n) return "—";
    const s = Math.floor((Date.now() - n) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    return `${Math.floor(s/3600)}h ago`;
  };
  const offlineSealed = state?.hfOffline && state?.transformersOffline && state?.hfDatasetsOffline;
  return (
    <Card className="glass border-primary/20">
      <CardHeader><CardTitle className="text-sm font-mono">Runtime Transport · Persistent Tunnel + KV Heartbeat (v9)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] font-mono">
          <span className="font-bold uppercase tracking-widest text-emerald-600">🔗 {"PERSISTENT KEEP-ALIVE TUNNEL"}</span>
          <p className="mt-1 text-muted-foreground">{"The middleware routes to the active runtime through a single undici Agent (keep-alive). No new TCP/handshake per chat. Aborted requests are released from the runtime slot via reader.cancel. KV cache stays warm via periodic heartbeat."}</p>
        </div>
        {!state ? <p className="text-xs font-mono text-muted-foreground">⏳ loading…</p> : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-[11px] font-mono">
              <div><div className="text-muted-foreground">Keep-Alive</div><div className="font-bold">{state.keepAlive ? "ON" : "OFF"}</div></div>
              <div><div className="text-muted-foreground">Inflight</div><div className="font-bold">{state.inflight}</div></div>
              <div><div className="text-muted-foreground">Last reset</div><div className="font-bold">{state.lastResetStatus} · {fmtTs(state.lastResetAt)}</div></div>
              <div><div className="text-muted-foreground">Last abort</div><div className="font-bold truncate" title={state.lastAbortReason}>{fmtTs(state.lastAbortAt)}</div></div>
              <div><div className="text-muted-foreground">Last runtime activity</div><div className="font-bold">{fmtAgo(state.lastActivityAt)}</div></div>
              <div><div className="text-muted-foreground">Heartbeat</div><div className="font-bold">{state.heartbeatEnabled ? `${Math.round(state.heartbeatMs/1000)}s` : "OFF"}</div></div>
              <div><div className="text-muted-foreground">Last heartbeat</div><div className="font-bold truncate" title={state.lastHeartbeatDetail}>{state.lastHeartbeatStatus} · {fmtAgo(state.lastHeartbeatAt)}</div></div>
              <div>
                <div className="text-muted-foreground">{"Offline status"}</div>
                <div className={`font-bold ${offlineSealed ? "text-emerald-500" : "text-red-500"}`}>{offlineSealed ? "🔒 ENFORCED" : "⚠ LEAK RISK"}</div>
              </div>
            </div>

            <div className="space-y-2 rounded border border-primary/20 p-3">
              <div className="text-[11px] font-mono uppercase tracking-widest">{"KV Cache Heartbeat"}</div>
              <p className="text-[10px] font-mono text-muted-foreground">{"Periodic mini warmup (max_tokens=1, temp=0). Skipped if recent activity falls within 75% of the window. Waits for inflight to clear. Interval changes apply on next server restart."}</p>
              <div className="flex flex-wrap gap-2 items-center">
                <Input
                  type="number"
                  value={hbMs}
                  onChange={(e) => setHbMs(Number(e.target.value) || 0)}
                  min={30000}
                  step={10000}
                  className="h-7 font-mono text-xs w-32"
                />
                <span className="text-[10px] font-mono text-muted-foreground">ms (min 30000)</span>
                <Button size="sm" onClick={() => save({ heartbeatMs: hbMs })}>{"Apply Interval"}</Button>
                <Button size="sm" variant="outline" onClick={() => save({ heartbeatEnabled: !state.heartbeatEnabled })}>
                  {state.heartbeatEnabled ? "Disable" : "Enable"}
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded border border-primary/20 p-3">
              <div className="text-[11px] font-mono uppercase tracking-widest">{"Pre-emptive Runtime Reset URL"}</div>
              <p className="text-[10px] font-mono text-muted-foreground">{"Each orchestrate posts to this URL before LOCAL (KV/slot sweep). When empty, a 'skipped' trace is emitted — no blind requests to fake endpoints."}</p>
              <div className="flex gap-2">
                <Input value={resetUrl} onChange={(e) => setResetUrl(e.target.value)} placeholder="http://127.0.0.1:/reset" className="h-7 font-mono text-xs" />
                <Button size="sm" onClick={() => save({ resetUrl, resetEnabled: resetUrl.trim().length > 0 })}>{"Apply"}</Button>
                <Button size="sm" variant="outline" onClick={() => save({ resetEnabled: !state.resetEnabled })}>
                  {state.resetEnabled ? "Disable" : "Enable"}
                </Button>
              </div>
              {state.lastResetDetail && (
                <p className="text-[10px] font-mono text-muted-foreground">last detail: {state.lastResetDetail}</p>
              )}
            </div>

            <div className="space-y-2 rounded border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="text-[11px] font-mono uppercase tracking-widest text-amber-600">{"Restart Runtime (zombie slot recovery)"}</div>
              <p className="text-[10px] font-mono text-muted-foreground">{"For single-slot local runtimes (e.g. local_lm.server), an aborted turn keeps generating server-side, so the next request waits → first-token timeout. This kills the local runtime process, lets the supervisor respawn it (~30-60s) and clears the queue/slot. Use when chat freezes on 'preparing context'. Remote/custom runtimes are not killed — a generic reset is attempted instead."}</p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={restartingLocal}
                  onClick={async () => {
                    setRestartingLocal(true);
                    try {
                      const res = await fetch(`${base}/api/system/restart-runtime`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", ...actorHeaders() },
                      });
                      if (!res.ok) {
                        const detail = await res.text().catch(() => "");
                        if (res.status === 401 || res.status === 403) {
                          toast.error(`Runtime restart denied (HTTP ${res.status}) — admin session required or non-loopback caller.${detail ? ` · ${detail.slice(0, 160)}` : ""}`);
                        } else {
                          toast.error(`Runtime restart failed (HTTP ${res.status})${detail ? ` · ${detail.slice(0, 160)}` : ""}`);
                        }
                        return;
                      }
                      const r = await res.json();
                      if (r.ok) {
                        const before = Array.isArray(r.beforePids) ? r.beforePids.join(",") || "none" : "?";
                        const after = Array.isArray(r.afterPids) ? r.afterPids.join(",") || "none" : "?";
                        if (r.back) {
                          toast.success(`Runtime restarted · back online · killed ${r.killed} · pid ${before}→${after}`);
                        } else if (r.status === "restart-noop") {
                          toast.error(`Runtime restart had no effect · zombie PID still alive [${(r.stillAlive || []).join(",")}] · killed ${r.killed}`);
                        } else if (r.realRestart) {
                          toast.success(`Runtime killed (${r.killed}) · model reloading… · pid ${before}→${after}`);
                        } else {
                          toast.message(`Runtime restart · killed ${r.killed} · ${r.status} · pid ${before}→${after}`);
                        }
                      }
                      else toast.error(r.error || "Runtime restart failed");
                      await load();
                    } catch (e) { toast.error((e as Error).message); }
                    finally { setRestartingLocal(false); }
                  }}
                >
                  {restartingLocal ? "Restarting…" : "Restart Runtime"}
                </Button>
                <span className="text-[10px] font-mono text-muted-foreground">{"Inflight: "}{state.inflight}{" · dirty slot recovery"}</span>
              </div>
            </div>


            <div className={`rounded border px-3 py-2 text-[11px] font-mono ${offlineSealed ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>
              <span className={`font-bold uppercase tracking-widest ${offlineSealed ? "text-emerald-600" : "text-red-600"}`}>
                {offlineSealed ? "🔒 OFFLINE MODE ENFORCED" : "⚠ OFFLINE MODE BREACHED"}
              </span>
              <div className="mt-1 grid grid-cols-3 gap-2 text-[10px]">
                <div>HF_HUB_OFFLINE=<span className="font-bold">{state.hfOffline ? "1" : "0"}</span></div>
                <div>TRANSFORMERS_OFFLINE=<span className="font-bold">{state.transformersOffline ? "1" : "0"}</span></div>
                <div>HF_DATASETS_OFFLINE=<span className="font-bold">{state.hfDatasetsOffline ? "1" : "0"}</span></div>
              </div>
              <p className="mt-1 text-muted-foreground">{"Set via .env and inherited by worker subprocesses. If breached, add HF_HUB_OFFLINE=1, TRANSFORMERS_OFFLINE=1, HF_DATASETS_OFFLINE=1 to local-server/.env and restart."}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Cockpit cards (IntentGuardCard / AgentsAllowlistCard / BridgeTelemetryCard)
// live in src/components/orchestrator-bridge-cards.tsx and are imported at the
// top of this file. Keeping them outside the route module prevents strict TS
// resolution from tripping on forward references.

