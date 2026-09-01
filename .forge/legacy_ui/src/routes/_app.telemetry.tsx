import { createFileRoute } from "@tanstack/react-router";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Activity, Plus, Trash2, Database, Bot, Globe, Cpu, Zap, AlertTriangle, RefreshCw, ChevronDown, ChevronRight, Pencil, Play } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSystem, type TelemetryWatcher, type TelemetryKind } from "@/lib/system-store";
import { MetricsAPI, TelemetryAPI, resolveApiBaseUrl, type MetricsFrame, type DbPulse, type AgentRuntimeStatus, type ProbeResult, type DbDetail } from "@/lib/api-client";
import { toast } from "sonner";
import { ProviderUsageCard } from "@/components/provider-usage-card";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/telemetry")({ component: TelemetryPage });

const SYS_METRICS: TelemetryWatcher["metric"][] = ["cpu","ram","gpu","LOCAL","tps","latency","queue","errors","hallucination"];
const UNIT: Record<TelemetryWatcher["metric"], string> = {
  cpu: "%", ram: "%", gpu: "%", LOCAL: "%", tps: "tok/s", latency: "ms", queue: "", errors: "", hallucination: "%",
};

const KIND_LABEL: Record<TelemetryKind, string> = {
  system: "System Metric", agent: "Python Agent", db_pulse: "PostgreSQL Pulse",
  llm_tokens: "LLM Token Usage", llm_speed: "LLM Speed (tok/s)", endpoint: "Custom Endpoint",
};
const KIND_ICON: Record<TelemetryKind, typeof Cpu> = {
  system: Cpu, agent: Bot, db_pulse: Database, llm_tokens: Zap, llm_speed: Activity, endpoint: Globe,
};

interface ProbeHistory { ok: boolean; latency: number; ts: number; error?: string }

// Faz 9 contract'larından geçen, yan etkisi olmayan GET endpoint'leri.
// Quick-Add satırından tek tıkla pinlenebilir. Aynı URL tekrar eklenmez.
type ProbePreset = { path: string; label: string; requiresSession?: boolean; expectStatuses?: number[] };
const PROBE_PRESETS: { group: "Health" | "Core Reads" | "RAG / Worker" | "Audit / SIEM" | "Orchestration"; items: ProbePreset[] }[] = [
  {
    group: "Health",
    items: [
      { path: "/health",          label: "Health" },
      // Deep health "degraded" durumunda 503 döner (cevap var ama alt sistem fail).
      // Bunu down saymıyoruz; endpoint cevap veriyorsa yeşil/sarı izleyelim.
      { path: "/health/deep",     label: "Health Deep",     expectStatuses: [200, 503] },
      { path: "/api/health",      label: "API Health" },
      { path: "/api/health/deep", label: "API Health Deep", expectStatuses: [200, 503] },
    ],
  },
  {
    group: "Core Reads",
    items: [
      { path: "/api/capabilities",                 label: "Capabilities",      requiresSession: true },
      { path: "/api/LOCAL-queue/stats",              label: "LOCAL Queue",         requiresSession: true },
      { path: "/api/cve?limit=1",                  label: "CVE Feed",          requiresSession: true },
      { path: "/api/tool-approvals/pending",       label: "Approvals Pending", requiresSession: true },
      { path: "/api/tool-invocations?limit=10",    label: "Tool Invocations",  requiresSession: true },
      { path: "/api/workflows",                    label: "Workflows",         requiresSession: true },
      { path: "/api/agents",                       label: "Agents",            requiresSession: true },
      { path: "/api/skills",                       label: "Skills",            requiresSession: true },
      { path: "/api/models",                       label: "Models",            requiresSession: true },
      { path: "/api/forge/actions",                label: "Forge Actions",     requiresSession: true },
      { path: "/api/runs?limit=10",                label: "Workflow Runs",     requiresSession: true },
      { path: "/api/chains",                       label: "Workflow Chains",   requiresSession: true },
    ],
  },
  {
    group: "RAG / Worker",
    items: [
      { path: "/api/rag/health",            label: "RAG Health",      requiresSession: true },
      { path: "/api/rag/settings",          label: "RAG Settings",    requiresSession: true },
      { path: "/api/system/worker/status",  label: "Worker Status" },
      { path: "/api/telemetry/db-pulse",    label: "DB Pulse" },
    ],
  },
  {
    group: "Audit / SIEM",
    items: [
      { path: "/api/vault-audit/verify?limit=10",  label: "Vault Audit Verify",requiresSession: true },
      { path: "/api/vault-audit?limit=10",         label: "Vault Audit Log",   requiresSession: true },
      { path: "/api/siem/config",                  label: "SIEM Config",       requiresSession: true },
      { path: "/api/skills/runs?limit=10",         label: "Skill Runs",        requiresSession: true },
    ],
  },
  {
    group: "Orchestration",
    items: [
      { path: "/api/chat/orchestrate",     label: "Orchestrate Probe", requiresSession: true },
      { path: "/api/agents/discover",      label: "Agents Discover",   requiresSession: true },
      { path: "/api/agents/browse",        label: "Agents Browse",     requiresSession: true },
      { path: "/api/agents/interpreters",  label: "Interpreters",      requiresSession: true },
    ],
  },
];
const ALL_PROBE_PRESETS = PROBE_PRESETS.flatMap(g => g.items);

// Preset chip'leri her zaman HTTP üzerinden middleware'e gider (3005).
// Sayfa HTTPS olsa bile server-side probe self-signed sertifika riskine
// girmesin diye base'i deterministik HTTP'ye çeviriyoruz. Kullanıcı tek
// tek HTTPS'e geçmek isterse Inspect/Edit dialog'undan elle ayarlar.
function presetProbeBase(): string {
  const base = resolveApiBaseUrl();
  try {
    const u = new URL(base);
    return `http://${u.hostname}:3005`;
  } catch { return base; }
}

function readSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const u = JSON.parse(raw) as { sessionId?: string };
    return u?.sessionId ?? null;
  } catch { return null; }
}


function Sparkline({ points, ok }: { points: number[]; ok: boolean }) {
  if (!points.length) return <div className="h-6" />;
  const max = Math.max(1, ...points);
  const w = 80, h = 22, step = w / Math.max(1, points.length - 1);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${i * step},${h - (p / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="inline-block">
      <path d={d} fill="none" stroke={ok ? "currentColor" : "hsl(var(--destructive))"} strokeWidth="1.5" className="text-primary" />
    </svg>
  );
}

function StatusDot({ tone }: { tone: "ok" | "warn" | "err" | "off" }) {
  const colour = tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "err" ? "bg-destructive" : "bg-muted-foreground/40";
  const pulse = tone === "ok" || tone === "warn" ? "animate-pulse" : "";
  return <span className={`inline-block h-2 w-2 rounded-full ${colour} ${pulse}`} />;
}

function TelemetryPage() {
  const { locale } = useI18n();
  const KIND_LABEL_LOCAL: Record<TelemetryKind, string> = {
    system: "System Metric",
    agent: "Python Agent",
    db_pulse: "PostgreSQL Pulse",
    llm_tokens: "LLM Token Usage",
    llm_speed: "LLM Speed (tok/s)",
    endpoint: "Custom Endpoint",
  };
  const { watchers, setWatchers, models } = useSystem();
  const [frame, setFrame] = useState<MetricsFrame | null>(null);
  const [dbPulse, setDbPulse] = useState<DbPulse | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<AgentRuntimeStatus[]>([]);
  const [probeHistory, setProbeHistory] = useState<Record<string, ProbeHistory[]>>({});
  const alertedRef = useRef<Set<string>>(new Set());

  useEffect(() => MetricsAPI.subscribe(setFrame), []);

  // Poll DB pulse + agent status
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [p, a] = await Promise.all([TelemetryAPI.dbPulse(), TelemetryAPI.agentStatus()]);
      if (!alive) return;
      setDbPulse(prev => p.ok ? p : (prev ? { ...prev, message: p.message } : p));
      setAgentStatuses(a.agents);
    };
    void tick();
  }, []);
  useVisiblePoll(async () => {
    const [p, a] = await Promise.all([TelemetryAPI.dbPulse(), TelemetryAPI.agentStatus()]);
    setDbPulse(prev => p.ok ? p : (prev ? { ...prev, message: p.message } : p));
    setAgentStatuses(a.agents);
  }, 10000);

  // Poll endpoint watchers
  useEffect(() => {
    const endpointWatchers = watchers.filter(w => w.kind === "endpoint");
    if (!endpointWatchers.length) return;
    let alive = true;
    const tick = async () => {
      const baseHost = (() => { try { return new URL(resolveApiBaseUrl()).hostname.toLowerCase(); } catch { return ""; } })();
      const sid = readSessionId();
      const isSameBridge = (u?: string) => {
        if (!u) return false;
        try { return new URL(u).hostname.toLowerCase() === baseHost; } catch { return false; }
      };
      for (const w of endpointWatchers) {
        const headers: Record<string, string> = {};
        if (w.authHeader) headers.Authorization = w.authHeader;
        // Same-bridge endpoint'lerine otomatik session header — preset chip'ler
        // farklı port/scheme'de (http:3005 vs https:10443) olsa da host eşleşirse ekle.
        if (sid && isSameBridge(w.url)) headers["x-session-id"] = sid;
        const r: ProbeResult = await TelemetryAPI.probe({
          kind: w.probeKind ?? "http",
          url: w.url, host: w.host, port: w.port,
          headers: Object.keys(headers).length ? headers : undefined,
          expectStatus: w.expectStatus, expectStatuses: w.expectStatuses, timeoutMs: 5000,
        });
        if (!alive) return;
        setProbeHistory(h => ({ ...h, [w.id]: [...(h[w.id] ?? []).slice(-19), { ok: r.ok, latency: r.latency, ts: Date.now(), error: r.ok ? undefined : (r.message || `HTTP ${(r as { status?: number }).status ?? "?"}`) }] }));
        // Autonomous Bridge alert: dispatch an event the chat can subscribe to.
        if (!r.ok && !alertedRef.current.has(w.id)) {
          alertedRef.current.add(w.id);
          toast.error(`Pulse lost on "${w.label}" — should I take over?`);
          try {
            const evt = { type: "telemetry.alert", watcherId: w.id, label: w.label, message: r.message, ts: Date.now() };
            sessionStorage.setItem("chat:incomingAlert", JSON.stringify(evt));
            window.dispatchEvent(new CustomEvent("elara:telemetry-alert", { detail: evt }));
          } catch { /* ignore */ }
        } else if (r.ok) {
          alertedRef.current.delete(w.id);
        }
      }
    };
    tick();
    const id = setInterval(tick, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [watchers]);

  const [inspectId, setInspectId] = useState<string | null>(null);
  const inspectWatcher = watchers.find(w => w.id === inspectId) ?? null;

  // One-shot migration: önceki sürüm preset'leri https:10443 ile pinliyordu;
  // self-signed cert reddi → "down". Aynı host/path için http:3005'e çevir.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    migratedRef.current = true;
    let changed = false;
    const next = watchers.map(w => {
      if (w.kind !== "endpoint" || !w.url) return w;
      let n = w;
      try {
        const u = new URL(n.url!);
        if (u.protocol === "https:" && u.port === "10443") {
          u.protocol = "http:";
          u.port = "3005";
          changed = true;
          n = { ...n, url: u.toString().replace(/\/$/, ""), probeKind: "http" as const };
        }
      } catch { /* ignore */ }
      // Deep health watcher'ları 503'ü de kabul etmeli (degraded ≠ down).
      const isDeep = /\/health\/deep$/.test(n.url ?? "");
      if (isDeep && !(n.expectStatuses && n.expectStatuses.includes(503))) {
        changed = true;
        n = { ...n, expectStatus: undefined, expectStatuses: [200, 503] };
      }
      return n;
    });
    if (changed) setWatchers(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TelemetryWatcher>({
    id: "", label: "", kind: "system", metric: "cpu", target: "system",
  });
  const openNew = () => {
    setDraft({ id: `w-${Date.now()}`, label: "", kind: "system", metric: "cpu", target: "system" });
    setOpen(true);
  };
  const save = () => {
    if (!draft.label) { toast.error("Label required"); return; }
    if (draft.kind === "endpoint" && !draft.url && !draft.host) { toast.error("URL or host required"); return; }
    if (draft.kind === "agent" && !draft.target.startsWith("agent:")) { toast.error("Pick an agent"); return; }
    setWatchers([draft, ...watchers]);
    setOpen(false);
    toast.success(`Watcher "${draft.label}" sealed`);
  };
  const remove = (id: string) => setWatchers(watchers.filter(w => w.id !== id));

  // Auto-import watcher candidates: every agent + DB pulse appear as suggestions.
  const quickAddAgentWatcher = (agent: AgentRuntimeStatus) => {
    if (watchers.some(w => w.kind === "agent" && w.target === `agent:${agent.id}`)) {
      toast.info(`"${agent.name}" already pinned`); return;
    }
    setWatchers([{ id: `w-${Date.now()}`, label: agent.name, kind: "agent", metric: "queue", target: `agent:${agent.id}` }, ...watchers]);
    toast.success(`Pinned agent "${agent.name}"`);
  };
  const quickAddDbWatcher = () => {
    if (watchers.some(w => w.kind === "db_pulse")) { toast.info("DB Pulse already pinned"); return; }
    setWatchers([{ id: `w-${Date.now()}`, label: "Database Pulse", kind: "db_pulse", metric: "latency", target: "db" }, ...watchers]);
    toast.success("DB Pulse pinned");
  };
  // Faz 9 contract endpoint chip'leri — tek tıkla (veya toplu) pinler.
  const quickAddEndpoint = (preset: ProbePreset): boolean => {
    const url = `${presetProbeBase()}${preset.path}`;
    if (watchers.some(w => w.kind === "endpoint" && w.url === url)) return false;
    const probeKind: TelemetryWatcher["probeKind"] = url.startsWith("https") ? "https" : "http";
    setWatchers([
      { id: `w-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        label: preset.label, kind: "endpoint", metric: "latency",
        target: `endpoint:${preset.path}`, url, probeKind,
        expectStatus: preset.expectStatuses ? undefined : 200,
        expectStatuses: preset.expectStatuses },
      ...watchers,
    ]);
    return true;
  };
  const quickAddEndpointGroup = (items: ProbePreset[], groupLabel: string) => {
    let added = 0;
    const base = presetProbeBase();
    const existingUrls = new Set(watchers.filter(w => w.kind === "endpoint").map(w => w.url));
    const fresh: TelemetryWatcher[] = [];
    for (const p of items) {
      const url = `${base}${p.path}`;
      if (existingUrls.has(url)) continue;
      const probeKind: TelemetryWatcher["probeKind"] = url.startsWith("https") ? "https" : "http";
      fresh.push({
        id: `w-${Date.now()}-${Math.random().toString(36).slice(2,6)}-${added}`,
        label: p.label, kind: "endpoint", metric: "latency",
        target: `endpoint:${p.path}`, url, probeKind,
        expectStatus: p.expectStatuses ? undefined : 200,
        expectStatuses: p.expectStatuses,
      });
      added++;
    }
    if (!added) { toast.info(`${groupLabel}: all already pinned`); return; }
    setWatchers([...fresh, ...watchers]);
    toast.success(`${groupLabel}: ${added} endpoint(s) pinned`);
  };
  const updateWatcher = (id: string, patch: Partial<TelemetryWatcher>) => {
    setWatchers(watchers.map(w => w.id === id ? { ...w, ...patch } : w));
  };

  // Render helpers per watcher kind.
  const renderValue = (w: TelemetryWatcher) => {
    const kind = w.kind ?? "system";
    if (kind === "system") {
      const v = frame ? Number(frame[w.metric as keyof MetricsFrame] ?? 0) : 0;
      return { primary: `${Math.round(v)}${UNIT[w.metric]}`, tone: v > 90 ? "warn" : "ok" as const, sub: w.metric };
    }
    if (kind === "agent") {
      const id = w.target.replace(/^agent:/, "");
      const a = agentStatuses.find(x => x.id === id);
      if (!a) return { primary: "—", tone: "off" as const, sub: "no signal" };
      const tone = a.runtime === "executing" ? "ok" : a.runtime === "idle" ? "warn" : "off";
      const slow = a.lastRunMs && a.lastRunMs > 30000;
      return {
        primary: a.runtime.toUpperCase(),
        tone: slow ? "warn" : tone as "ok"|"warn"|"off",
        sub: `${a.lastRunMs ?? 0}ms · ${a.calls} runs`,
        stdout: a.lastStdout,
      };
    }
    if (kind === "db_pulse") {
      if (!dbPulse) return { primary: "—", tone: "off" as const, sub: "probing…" };
      return {
        primary: `${dbPulse.activeQueries} q`,
        tone: dbPulse.ok ? (dbPulse.latency > 200 ? "warn" : "ok") : "err",
        sub: `${dbPulse.latency}ms · ${dbPulse.totalConnections} conn · pool ${dbPulse.poolSize}`,
      } as const;
    }
    if (kind === "endpoint") {
      const hist = probeHistory[w.id] ?? [];
      const last = hist[hist.length - 1];
      if (!last) return { primary: "…", tone: "off" as const, sub: w.url ?? `${w.host}:${w.port}` };
      const uptime = hist.length ? Math.round((hist.filter(h => h.ok).length / hist.length) * 100) : 0;
      // Warming-up window: don't flash red on the first 1-2 probes — a brand new
      // endpoint frequently needs a few seconds before the upstream is reachable.
      const warming = !last.ok && hist.length < 3;
      const tone = last.ok
        ? (last.latency > 1000 ? "warn" : "ok")
        : (warming ? "warn" : "err");
      return {
        primary: last.ok ? `${last.latency}ms` : (warming ? "…" : "down"),
        tone: tone as "ok"|"warn"|"err",
        sub: warming ? `${w.probeKind ?? "http"} · warming up (${hist.length}/3)` : `uptime ${uptime}% · ${w.probeKind ?? "http"}`,
        spark: hist.map(h => h.latency),
        sparkOk: last.ok,
        lastError: !last.ok ? (last as { error?: string }).error : undefined,
      };
    }
    if (kind === "llm_tokens" || kind === "llm_speed") {
      return { primary: "live", tone: "ok" as const, sub: kind === "llm_tokens" ? "see usage card ↓" : "from chat stream" };
    }
    return { primary: "—", tone: "off" as const, sub: "" };
  };

  const groups = useMemo(() => {
    const g: Record<string, TelemetryWatcher[]> = {};
    for (const w of watchers) {
      const k = w.kind ?? "system";
      (g[k] ||= []).push(w);
    }
    return g;
  }, [watchers]);

  return (
    <PageShell>
      <PageHeader
        title={"Runtime Telemetry"}
        subtitle={"Hardware (Mac) · Model (LLM) · Data Path (DB) · custom endpoints — one panel"}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary text-primary-foreground" onClick={openNew}>
                <Plus className="h-4 w-4 mr-1"/>{"Add Watcher"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{"New Watcher"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>{"Category"}</Label>
                  <Select value={draft.kind ?? "system"} onValueChange={(v) => setDraft({ ...draft, kind: v as TelemetryKind })}>
                    <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(KIND_LABEL_LOCAL) as TelemetryKind[]).map(k => (
                        <SelectItem key={k} value={k}>{KIND_LABEL_LOCAL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{"Label"}</Label>
                  <Input value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} className="mt-1" placeholder={"e.g. CPU Core-1"} />
                </div>

                {draft.kind === "system" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{"Metric"}</Label>
                      <Select value={draft.metric} onValueChange={v => setDraft({ ...draft, metric: v as TelemetryWatcher["metric"] })}>
                        <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                        <SelectContent>{SYS_METRICS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{"Target"}</Label>
                      <Select value={draft.target} onValueChange={v => setDraft({ ...draft, target: v })}>
                        <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system">system</SelectItem>
                          {models.map(m => <SelectItem key={m.id} value={`model:${m.id}`}>model:{m.modelName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {draft.kind === "agent" && (
                  <div>
                    <Label>{"Agent"}</Label>
                    <Select value={draft.target} onValueChange={v => setDraft({ ...draft, target: v })}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder={"Pick agent…"} /></SelectTrigger>
                      <SelectContent>
                        {agentStatuses.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">{"No agents registered"}</div>}
                        {agentStatuses.map(a => <SelectItem key={a.id} value={`agent:${a.id}`}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {draft.kind === "endpoint" && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>{"Protocol"}</Label>
                        <Select value={draft.probeKind ?? "http"} onValueChange={v => setDraft({ ...draft, probeKind: v as TelemetryWatcher["probeKind"] })}>
                          <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="http">HTTP</SelectItem>
                            <SelectItem value="https">HTTPS</SelectItem>
                            <SelectItem value="tcp">TCP Port</SelectItem>
                            <SelectItem value="ping">ICMP Ping</SelectItem>
                            <SelectItem value="rest_auth">REST + Auth</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>{"Expected Status"}</Label>
                        <Input type="number" placeholder="200" value={draft.expectStatus ?? ""} onChange={e => setDraft({ ...draft, expectStatus: Number(e.target.value) || undefined })} className="mt-1" />
                      </div>
                    </div>
                    {(draft.probeKind === "tcp" || draft.probeKind === "ping") ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>{"Host / IP"}</Label>
                          <Input value={draft.host ?? ""} onChange={e => setDraft({ ...draft, host: e.target.value })} placeholder="192.168.1.1" className="mt-1" />
                        </div>
                        <div>
                          <Label>{"Port"}</Label>
                          <Input type="number" value={draft.port ?? ""} onChange={e => setDraft({ ...draft, port: Number(e.target.value) || undefined })} placeholder="22" className="mt-1" disabled={draft.probeKind === "ping"} />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Label>URL</Label>
                        <Input value={draft.url ?? ""} onChange={e => setDraft({ ...draft, url: e.target.value })} placeholder="https://api.example.com/health" className="mt-1" />
                      </div>
                    )}
                    {draft.probeKind === "rest_auth" && (
                      <div>
                        <Label>{"Authorization Header"}</Label>
                        <Input value={draft.authHeader ?? ""} onChange={e => setDraft({ ...draft, authHeader: e.target.value })} placeholder="Bearer eyJhbGc…" className="mt-1 font-mono text-xs" />
                      </div>
                    )}
                  </>
                )}
              </div>
              <DialogFooter>
                <Button onClick={save} className="bg-gradient-primary text-primary-foreground">{"Seal Watcher"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Quick-add row: agents + DB pulse */}
      <Card className="glass mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{"Quick-Add Watchers"}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => quickAddEndpointGroup(ALL_PROBE_PRESETS, "All Probes")} className="font-mono text-[11px]">
                <Globe className="h-3.5 w-3.5 mr-1" /> {`Pin All (${ALL_PROBE_PRESETS.length})`}
              </Button>
              <Button variant="outline" size="sm" onClick={quickAddDbWatcher}>
                <Database className="h-3.5 w-3.5 mr-1" /> {"Pin Database Pulse"}
              </Button>
            </div>
          </div>

          {/* Contract probe presets (Faz 9 — pass alan endpoint seti) */}
          {PROBE_PRESETS.map(g => (
            <div key={g.group} className="mb-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Globe className="h-3 w-3 text-primary/70" />
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{g.group}</p>
                <Button
                  variant="ghost" size="sm"
                  className="h-5 px-2 text-[10px] font-mono"
                  onClick={() => quickAddEndpointGroup(g.items, g.group)}
                >
                  {`Pin ${g.group} (${g.items.length})`}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map(p => {
                  const url = `${presetProbeBase()}${p.path}`;
                  const pinned = watchers.some(w => w.kind === "endpoint" && w.url === url);
                  return (
                    <Button
                      key={p.path}
                      variant="outline" size="sm"
                      className={`font-mono text-[10px] h-7 ${pinned ? "opacity-50" : ""}`}
                      title={p.path}
                      onClick={() => {
                        if (quickAddEndpoint(p)) toast.success(`Pinned "${p.label}"`);
                        else toast.info(`"${p.label}" already pinned`);
                      }}
                    >
                      <Globe className="h-3 w-3 mr-1" /> {p.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Python agents */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Bot className="h-3 w-3 text-primary/70" />
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Agents</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {agentStatuses.length === 0 && <p className="text-xs text-muted-foreground">{"No agents registered yet."}</p>}
              {agentStatuses.map(a => (
                <Button key={a.id} variant="outline" size="sm" onClick={() => quickAddAgentWatcher(a)} className="font-mono text-[11px]">
                  <StatusDot tone={a.runtime === "executing" ? "ok" : a.runtime === "idle" ? "warn" : "off"} />
                  <Bot className="h-3 w-3 mx-1" /> {a.name}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Watcher cards grouped by category */}
      {(Object.keys(groups) as TelemetryKind[]).map(kind => {
        const Icon = KIND_ICON[kind];
        return (
          <div key={kind} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-3.5 w-3.5 text-primary" />
              <h3 className="text-xs font-mono uppercase tracking-widest">{KIND_LABEL_LOCAL[kind]}</h3>
              <Badge variant="outline" className="text-[10px] font-mono">{groups[kind].length}</Badge>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {groups[kind].map(w => {
                const v = renderValue(w);
                return (
                  <Card key={w.id} className="glass relative group">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground truncate">{w.label}</p>
                        <StatusDot tone={v.tone as "ok"|"warn"|"err"|"off"} />
                      </div>
                      <p className="text-xl font-bold mt-1 text-primary truncate">{v.primary}</p>
                      <p className="text-[9px] font-mono text-muted-foreground mt-1 truncate">{v.sub}</p>
                      {w.kind === "endpoint" && (w.url || w.host) && (
                        <p
                          className="text-[9px] font-mono text-muted-foreground/70 mt-0.5 truncate"
                          title={w.url ?? `${w.host}:${w.port ?? ""}`}
                        >
                          → {w.url ?? `${w.host}:${w.port ?? ""}`}
                        </p>
                      )}
                      {("lastError" in v) && v.lastError && (
                        <p
                          className="text-[9px] font-mono text-destructive mt-1 line-clamp-2 break-all"
                          title={v.lastError}
                        >
                          ⚠ {v.lastError}
                        </p>
                      )}
                      {("spark" in v) && v.spark && <div className="mt-1"><Sparkline points={v.spark} ok={!!v.sparkOk} /></div>}
                      {("stdout" in v) && v.stdout && (
                        <pre className="mt-2 text-[9px] font-mono text-muted-foreground/80 bg-card/50 rounded p-1 max-h-12 overflow-hidden">{v.stdout.slice(-120)}</pre>
                      )}
                      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                        {w.kind === "endpoint" && (
                          <Button size="icon" variant="ghost"
                            className="h-5 w-5 text-muted-foreground hover:text-primary"
                            title="Inspect / edit URL"
                            onClick={() => setInspectId(w.id)}>
                            <Pencil className="h-3 w-3"/>
                          </Button>
                        )}
                        <Button size="icon" variant="ghost"
                          className="h-5 w-5 text-destructive"
                          onClick={() => remove(w.id)}>
                          <Trash2 className="h-3 w-3"/>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}

      {watchers.length === 0 && (
        <Card className="glass mb-6"><CardContent className="p-8 text-center text-sm text-muted-foreground">
          <AlertTriangle className="h-5 w-5 mx-auto mb-2 text-amber-500" />
          <span>No watchers. Use <strong>Quick-Add</strong> above or click <strong>Add Watcher</strong> for a custom endpoint.</span>
        </CardContent></Card>
      )}

      <PostgresDetailPanel />

      <ProviderUsageCard hours={24} />

      {/* Bottom: live progress bars for system watchers */}
      <Card className="glass mt-6">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4 text-primary"/>
            <h3 className="text-sm font-mono uppercase tracking-widest">{"Live System Streams"}</h3>
            <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => MetricsAPI.subscribe(setFrame)}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
          <div className="space-y-3">
            {watchers.filter(w => (w.kind ?? "system") === "system").map(w => {
              const v = frame ? Number(frame[w.metric as keyof MetricsFrame] ?? 0) : 0;
              return (
                <div key={w.id}>
                  <div className="flex justify-between text-xs font-mono mb-1">
                    <span className="text-muted-foreground">{w.label} · {w.metric}</span>
                    <span className="text-primary">{v.toFixed(0)}{UNIT[w.metric]}</span>
                  </div>
                  <Progress value={Math.min(100, v)} className="h-1.5"/>
                </div>
              );
            })}
            {watchers.filter(w => (w.kind ?? "system") === "system").length === 0 && (
              <p className="text-xs text-muted-foreground">{"Add a system watcher (CPU/RAM/GPU) to see live bars."}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <InspectWatcherDialog
        watcher={inspectWatcher}
        history={inspectWatcher ? (probeHistory[inspectWatcher.id] ?? []) : []}
        onClose={() => setInspectId(null)}
        onSave={(patch) => { if (inspectId) updateWatcher(inspectId, patch); }}
      />
    </PageShell>
  );
}

function InspectWatcherDialog({
  watcher, history, onClose, onSave,
}: {
  watcher: TelemetryWatcher | null;
  history: ProbeHistory[];
  onClose: () => void;
  onSave: (patch: Partial<TelemetryWatcher>) => void;
}) {
  const [url, setUrl] = useState("");
  const [probeKind, setProbeKind] = useState<NonNullable<TelemetryWatcher["probeKind"]>>("http");
  const [expectStatusText, setExpectStatusText] = useState<string>("200");
  const [authHeader, setAuthHeader] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProbeResult | null>(null);

  useEffect(() => {
    if (!watcher) return;
    setUrl(watcher.url ?? "");
    setProbeKind(watcher.probeKind ?? "http");
    const statuses = watcher.expectStatuses && watcher.expectStatuses.length
      ? watcher.expectStatuses
      : (watcher.expectStatus ? [watcher.expectStatus] : [200]);
    setExpectStatusText(statuses.join(","));
    setAuthHeader(watcher.authHeader ?? "");
    setTestResult(null);
  }, [watcher?.id]);

  if (!watcher) return null;

  const parseStatuses = (): number[] =>
    expectStatusText.split(",").map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);

  const runProbe = async () => {
    setTesting(true);
    try {
      const headers: Record<string, string> = {};
      if (authHeader) headers.Authorization = authHeader;
      const sid = readSessionId();
      const baseHost = (() => { try { return new URL(resolveApiBaseUrl()).hostname.toLowerCase(); } catch { return ""; } })();
      const sameHost = (() => { try { return new URL(url).hostname.toLowerCase() === baseHost; } catch { return false; } })();
      if (sid && sameHost) headers["x-session-id"] = sid;
      const statuses = parseStatuses();
      const r = await TelemetryAPI.probe({
        kind: probeKind, url, headers: Object.keys(headers).length ? headers : undefined,
        expectStatuses: statuses.length ? statuses : undefined,
        expectStatus: statuses.length === 1 ? statuses[0] : undefined,
        timeoutMs: 5000,
      });
      setTestResult(r);
    } finally { setTesting(false); }
  };

  return (
    <Dialog open={!!watcher} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">Inspect · {watcher.label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Probe URL</Label>
            <Input value={url} onChange={e => setUrl(e.target.value)} className="mt-1 font-mono text-[11px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Probe Kind</Label>
              <Select value={probeKind} onValueChange={v => setProbeKind(v as typeof probeKind)}>
                <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">http</SelectItem>
                  <SelectItem value="https">https</SelectItem>
                  <SelectItem value="tcp">tcp</SelectItem>
                  <SelectItem value="ping">ping</SelectItem>
                  <SelectItem value="rest_auth">rest_auth</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Expect Status (comma-separated)</Label>
              <Input value={expectStatusText} onChange={e => setExpectStatusText(e.target.value)} placeholder="200,503" className="mt-1 font-mono text-[11px]" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Authorization Header (optional)</Label>
            <Input value={authHeader} onChange={e => setAuthHeader(e.target.value)} placeholder="Bearer …" className="mt-1 font-mono text-[11px]" />
          </div>

          <div className="rounded border border-border bg-card/40 p-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Recent Probes</p>
              <Button size="sm" variant="outline" onClick={runProbe} disabled={testing || !url} className="h-7 font-mono text-[11px]">
                <Play className="h-3 w-3 mr-1" />{testing ? "Probing…" : "Probe Now"}
              </Button>
            </div>
            {testResult && (
              <div className={`text-[11px] font-mono mb-2 ${testResult.ok ? "text-emerald-500" : "text-destructive"}`}>
                {testResult.ok ? "✓" : "✗"} {testResult.status} · {testResult.latency}ms · {testResult.message}
              </div>
            )}
            {history.length === 0 ? (
              <p className="text-[10px] font-mono text-muted-foreground">No history yet.</p>
            ) : (
              <ul className="space-y-0.5 max-h-32 overflow-auto">
                {history.slice(-8).reverse().map((h, i) => (
                  <li key={i} className={`text-[10px] font-mono ${h.ok ? "text-muted-foreground" : "text-destructive"}`}>
                    {h.ok ? "✓" : "✗"} {h.latency}ms · {new Date(h.ts).toLocaleTimeString()} {h.error ? `· ${h.error}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => {
            const statuses = parseStatuses();
            onSave({
              url,
              probeKind,
              expectStatuses: statuses.length ? statuses : undefined,
              expectStatus: statuses.length === 1 ? statuses[0] : undefined,
              authHeader: authHeader || undefined,
            });
            toast.success("Watcher updated");
            onClose();
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostgresDetailPanel() {
  const [detail, setDetail] = useState<DbDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"tables" | "activity" | "slow">("tables");

  const refresh = async () => {
    setLoading(true);
    try { setDetail(await TelemetryAPI.dbDetail()); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  useVisiblePoll(refresh, 20000);

  const fmtPct = (n: number | null) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
  const fmtUptime = (s: number) => {
    if (!s) return "—";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}g ${h}s` : h ? `${h}s ${m}d` : `${m}d`;
  };

  return (
    <Card className="glass mt-6">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setOpen(o => !o)} className="text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <Database className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-mono uppercase tracking-widest">{"PostgreSQL Detail Telemetry"}</h3>
          {detail?.ok && (
            <Badge variant="outline" className="text-[10px] font-mono text-emerald-500">
              {detail.db} · {detail.sizePretty} · {detail.latency}ms
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {open && (
          <>
            {!detail && <p className="text-xs text-muted-foreground">{"Loading…"}</p>}
            {detail && !detail.ok && <p className="text-xs text-destructive font-mono">{detail.message}</p>}
            {detail && detail.ok && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <Stat label={"Database"} value={detail.db} />
                  <Stat label={"Size"} value={detail.sizePretty} />
                  <Stat label={"Uptime"} value={fmtUptime(detail.uptimeSec)} />
                  <Stat label={"Cache Hit"} value={fmtPct(detail.cacheHitRatio)} />
                  <Stat label={"Index Hit"} value={fmtPct(detail.indexes.hitRatio)} sub={`${detail.indexes.total} ${"indexes"}`} />
                </div>

                <div className="flex gap-2 border-b border-border">
                  <TabBtn on={tab === "tables"} onClick={() => setTab("tables")}>{"Tables"} ({detail.tables.length})</TabBtn>
                  <TabBtn on={tab === "activity"} onClick={() => setTab("activity")}>{"Active Queries"} ({detail.activity.length})</TabBtn>
                  <TabBtn on={tab === "slow"} onClick={() => setTab("slow")}>{"Slow Queries"} ({detail.slowQueries.length})</TabBtn>
                </div>

                {tab === "tables" && (
                  <div className="overflow-auto max-h-96 rounded border border-border">
                    <table className="w-full text-xs font-mono">
                      <thead className="bg-card/60 sticky top-0">
                        <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                          <th className="p-2">{"Table"}</th>
                          <th className="p-2 text-right">{"Rows"}</th>
                          <th className="p-2 text-right">{"Size"}</th>
                          <th className="p-2 text-right">Seq/Idx</th>
                          <th className="p-2 text-right">Ins/Upd/Del</th>
                          <th className="p-2">{"Last Vacuum"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.tables.map(t => (
                          <tr key={`${t.schema}.${t.name}`} className="border-t border-border/50 hover:bg-card/40">
                            <td className="p-2"><span className="text-muted-foreground">{t.schema}.</span>{t.name}</td>
                            <td className="p-2 text-right">{t.rows.toLocaleString()}</td>
                            <td className="p-2 text-right text-primary">{t.sizePretty}</td>
                            <td className="p-2 text-right">{t.seqScans}/{t.idxScans}</td>
                            <td className="p-2 text-right">{t.inserts}/{t.updates}/{t.deletes}</td>
                            <td className="p-2 text-[10px] text-muted-foreground">{t.lastAutovacuum ? new Date(t.lastAutovacuum).toLocaleString() : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === "activity" && (
                  <div className="overflow-auto max-h-96 rounded border border-border">
                    <table className="w-full text-xs font-mono">
                      <thead className="bg-card/60 sticky top-0">
                        <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                          <th className="p-2">PID</th>
                          <th className="p-2">{"User"}</th>
                          <th className="p-2">{"State"}</th>
                          <th className="p-2 text-right">{"Age"}</th>
                          <th className="p-2">Wait</th>
                          <th className="p-2">Query</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.activity.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">{"No active queries"}</td></tr>}
                        {detail.activity.map(a => (
                          <tr key={a.pid} className="border-t border-border/50 hover:bg-card/40 align-top">
                            <td className="p-2">{a.pid}</td>
                            <td className="p-2">{a.usename ?? "—"}</td>
                            <td className="p-2"><Badge variant="outline" className="text-[9px]">{a.state ?? "—"}</Badge></td>
                            <td className="p-2 text-right">{a.age_sec ?? 0}s</td>
                            <td className="p-2 text-[10px] text-muted-foreground">{a.wait_event ? `${a.wait_event_type}/${a.wait_event}` : "—"}</td>
                            <td className="p-2 text-[10px] max-w-[400px] truncate" title={a.query}>{a.query || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === "slow" && (
                  <div className="overflow-auto max-h-96 rounded border border-border">
                    {detail.slowQueries.length === 0 ? (
                      <p className="p-4 text-xs text-muted-foreground text-center">
                        {"pg_stat_statements extension not enabled. To enable: CREATE EXTENSION pg_stat_statements;"}
                      </p>
                    ) : (
                      <table className="w-full text-xs font-mono">
                        <thead className="bg-card/60 sticky top-0">
                          <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                            <th className="p-2">{"Query"}</th>
                            <th className="p-2 text-right">{"Calls"}</th>
                            <th className="p-2 text-right">Mean ms</th>
                            <th className="p-2 text-right">Total ms</th>
                            <th className="p-2 text-right">Rows</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.slowQueries.map((q, i) => (
                            <tr key={i} className="border-t border-border/50 hover:bg-card/40 align-top">
                              <td className="p-2 text-[10px] max-w-[420px] truncate" title={q.query}>{q.query}</td>
                              <td className="p-2 text-right">{q.calls.toLocaleString()}</td>
                              <td className="p-2 text-right text-primary">{q.meanMs.toFixed(1)}</td>
                              <td className="p-2 text-right">{q.totalMs.toFixed(0)}</td>
                              <td className="p-2 text-right">{q.rows.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border bg-card/40 p-3">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-sm font-bold text-primary mt-1 truncate">{value}</p>
      {sub && <p className="text-[9px] font-mono text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 text-xs font-mono uppercase tracking-widest border-b-2 ${on ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
      {children}
    </button>
  );
}
