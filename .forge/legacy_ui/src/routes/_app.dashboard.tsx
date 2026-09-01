import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Activity, Cpu, Database, Bot, Wrench, Workflow as WfIcon, Shield, Zap, TrendingUp, Users as UsersIcon, LogOut,
  Plus, Trash2, UserPlus, Check, ShieldCheck, ShieldOff, Play, Square, Loader2, X,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useEffect, useMemo, useState } from "react";
import { MetricsAPI, AgentsAPI, SystemAPI, WorkflowAPI, type MetricsFrame, type AgentRow, type ModelDTO, type HealthDTO } from "@/lib/api-client";
import { useSystem } from "@/lib/system-store";
import { useSessions } from "@/lib/sessions-store";
import { useAuth } from "@/lib/auth";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { useAgentRuns } from "@/hooks/use-agent-runs";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ProviderUsageCard } from "@/components/provider-usage-card";


export const Route = createFileRoute("/_app/dashboard")({ component: Dashboard });

const portFromBridge = (url?: string | null) => url?.match(/:(\d+)/)?.[1] ?? "3005";
const isAgentLive = (a: AgentRow) =>
  !!a.last_active && Date.now() - new Date(a.last_active).getTime() <= 5 * 60_000;
const isAgentArmed = (a: AgentRow) => ["active", "armed"].includes(String(a.status || "").toLowerCase());
const agentSignalLabel = (a: AgentRow) => {
  if (isAgentLive(a)) return "live <5m";
  if (isAgentArmed(a)) return "armed · no signal";
  if (a.status === "error") return "bridge error";
  return a.last_active ? `last ${new Date(a.last_active).toLocaleTimeString()}` : "no signal";
};
const fmtAgo = (ms: number | null | undefined) => {
  if (ms == null) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
};

function Dashboard() {
  const { t } = useI18n();
  const [m, setM] = useState<MetricsFrame | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [models, setModels] = useState<ModelDTO[]>([]);
  const [workflows, setWorkflows] = useState<{ id: string }[]>([]);
  const [logs, setLogs] = useState<{ ts: string; agent: string; msg: string }[]>([]);
  const [health, setHealth] = useState<HealthDTO | null>(null);
  const { tools } = useSystem();
  const dashRuns = useAgentRuns(true);
  const seenRunsRef = (globalThis as { __dashRunSeen?: Set<string> }).__dashRunSeen
    ?? ((globalThis as { __dashRunSeen?: Set<string> }).__dashRunSeen = new Set<string>());

  useEffect(() => {
    // Prime immediately from snapshot so "Connecting…" placeholder resolves
    // before the first SSE tick (~5s) and survives an empty history buffer.
    void MetricsAPI.snapshot().then((frame) => {
      if (frame && typeof frame === "object") setM((prev) => prev ?? frame);
    });
    void MetricsAPI.history(1).then((frames) => {
      if (frames && frames.length) setM((prev) => prev ?? frames[frames.length - 1]);
    });
    const stop = MetricsAPI.subscribe(setM);
    return stop;
  }, []);

  useVisiblePoll(async () => {

    try {
      const [a, mods, wfs, h] = await Promise.all([
        AgentsAPI.list().catch(() => [] as AgentRow[]),
        SystemAPI.listModels().catch(() => []),
        WorkflowAPI.list().catch(() => []),
        SystemAPI.health().catch(() => null),
      ]);
      setAgents(a); setModels(mods); setWorkflows(wfs); setHealth(h);
    } catch { /* bridge offline */ }
  }, 5000);

  useEffect(() => {
    if (!m) return;
    const stamp = new Date(m.ts).toLocaleTimeString();
    setLogs((prev) => {
      const next = m.agents.slice(0, 4).map((a) => ({
        ts: stamp, agent: a.id, msg: `tps=${a.tps} · lat=${a.latency}ms · err=${a.errors}`,
      }));
      const merged = [...next, ...prev].slice(0, 8);
      return merged;
    });
  }, [m]);

  // Feed dispatch events into the Execution Timeline so it has data
  // even when bridge telemetry (`m.agents`) is empty.
  useEffect(() => {
    if (!dashRuns.runs.length) return;
    const fresh = dashRuns.runs.filter((r) => !seenRunsRef.has(r.runId));
    if (!fresh.length) return;
    fresh.forEach((r) => seenRunsRef.add(r.runId));
    const stamp = new Date().toLocaleTimeString();
    setLogs((prev) => {
      const entries = fresh.map((r) => ({
        ts: stamp,
        agent: r.agentId,
        msg: `dispatched · pid ${r.pid} · ${r.script.split("/").pop() || r.script}`,
      }));
      return [...entries, ...prev].slice(0, 8);
    });
  }, [dashRuns.runs, seenRunsRef]);


  const liveAgents  = agents.filter(isAgentLive).length;
  const armedAgents = agents.filter(isAgentArmed).length;
  const squadBreakdown = useMemo(() => {
    const map = new Map<string, { live: number; total: number }>();
    for (const a of agents) {
      const sq = ((a.meta ?? {}) as { squad?: string }).squad?.trim() || "Unassigned";
      const cur = map.get(sq) ?? { live: 0, total: 0 };
      cur.total += 1;
      if (isAgentLive(a)) cur.live += 1;
      map.set(sq, cur);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    });
  }, [agents]);
  const runningWfs = workflows.length;
  const toolsCount = tools.length;

  const pgInfo = useMemo(() => {
    const db = health?.db;
    if (db && typeof db === "object") {
      return {
        ok: !!db.ok,
        detail: db.ok
          ? `${db.database ?? "db"} · ${db.latencyMs ?? 0}ms`
          : `down · ${db.error ?? "no handshake"}`,
      };
    }
    if (typeof db === "boolean") return { ok: db, detail: db ? "handshake ok" : "no handshake" };
    return { ok: false, detail: "no handshake" };
  }, [health]);

  return (
    <PageShell>
      <PageHeader title={t("dash.title")} subtitle={t("dash.subtitle")} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi label="Armed · Live" value={`${armedAgents} · ${liveAgents} / ${agents.length}`} icon={Bot} />
        <Kpi label={t("dash.workflows")} value={String(runningWfs)} icon={WfIcon} />
        <Kpi label={t("dash.tools_loaded")} value={String(toolsCount)} icon={Wrench} />
        <Kpi label={t("dash.tps")} value={String(m?.tps ?? "—")} icon={Zap} delta={m ? "live" : undefined} />
      </div>

      {squadBreakdown.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-6 -mt-3" title="Active runs per squad">
          {squadBreakdown.map(([sq, c]) => (
            <Badge key={sq} variant="outline" className="font-mono text-[10px]">
              {sq} {c.live}/{c.total}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" /> {t("dash.bare_metal")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Meter label="CPU" value={m?.cpu ?? null} suffix="%" />
            <Meter label="RAM" value={m?.ram ?? null} suffix="%" />
            <Meter label="GPU / LOCAL" value={m?.gpu ?? null} suffix="%" />
            <Meter label="LOCAL KV" value={m?.LOCAL ?? null} suffix="%" />
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> {t("dash.live_telemetry")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Sparkline frame={m} />
            <div className="grid grid-cols-4 gap-3 mt-4 text-center">
              <Stat label={t("dash.latency")} value={m ? `${m.latency}ms` : "—"} />
              <Stat label={t("dash.queue")} value={m ? String(m.queue) : "—"} />
              <Stat label={t("dash.throughput")} value={m ? `${m.tps} t/s` : "—"} />
              <Stat
                label={t("dash.hallucination")}
                value={m ? `${(m.hallucination ?? 0).toFixed(1)}%` : "—"}
                tone={m && (m.hallucination ?? 0) > 50 ? "warn" : "ok"}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" /> {t("dash.agent_telemetry")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(m?.agents ?? []).map((a) => {
              const dotCls = a.live
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                : a.armed
                  ? "bg-amber-400"
                  : "bg-muted-foreground/40";
              return (
                <div key={a.id} className="border border-border rounded-lg p-3 bg-card/40">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-mono">{a.id}</span>
                    <span className={`inline-block h-2 w-2 rounded-full ${dotCls}`} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Stat label="TPS" value={a.tps} />
                    <Stat label="Last Call" value={a.latency > 0 ? `${a.latency}ms` : "—"} />
                    <Stat label="Err" value={a.errors} />
                  </div>
                  <div className="mt-2 text-center text-[10px] font-mono text-muted-foreground">
                    seen {fmtAgo(a.staleness ?? null)}
                  </div>
                </div>
              );
            })}
            {!m && <p className="text-xs text-muted-foreground font-mono col-span-3">{t("dash.connecting_metrics")}</p>}
            {m && (m.agents ?? []).length === 0 && <p className="text-xs text-muted-foreground font-mono col-span-3">{t("dash.no_agent_tele")}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <ServiceCard name={t("dash.svc_llm")} status={models.length ? "running" : "stopped"} icon={Cpu} detail={`${models.length} model(s)`} />
        <ServiceCard name={t("dash.svc_pg")} status={pgInfo.ok ? "running" : "stopped"} icon={Database} detail={pgInfo.detail} />
        <ServiceCard name={t("dash.svc_agents")} status={liveAgents ? "running" : agents.length ? "idle" : "stopped"} icon={Bot} detail={`${liveAgents}/${agents.length} live · ${armedAgents} armed`} />
        <ServiceCard name={t("dash.svc_workflows")} status={runningWfs ? "running" : "idle"} icon={WfIcon} detail={`${runningWfs} defined`} />
        <ServiceCard name={t("dash.svc_policy")} status="running" icon={Shield} detail="local rules" />
        <ServiceCard name={t("dash.svc_tools")} status={toolsCount ? "running" : "idle"} icon={Wrench} detail={`${toolsCount} tools`} />
      </div>

      <ActiveSessionsCard />
      <ProviderUsageCard hours={24} compact />
      <AgentsPanel models={models} />
      

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" /> {t("dash.exec_timeline")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">{t("dash.waiting_telemetry")}</p>
          ) : (
            <ul className="space-y-2 font-mono text-xs">
              {logs.map((i, idx) => (
                <li key={idx} className="flex gap-3 items-center border-b border-border/40 pb-2 last:border-0">
                  <span className="text-muted-foreground">{i.ts}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">{i.agent}</Badge>
                  <span className="flex-1">{i.msg}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      
    </PageShell>
  );
}

function Kpi({ label, value, icon: Icon, delta }: { label: string; value: string; icon: LucideIcon; delta?: string }) {
  return (
    <Card className="glass relative overflow-hidden">
      <div className="absolute top-0 right-0 h-24 w-24 opacity-10" style={{ background: "var(--gradient-primary)", filter: "blur(40px)" }} />
      <CardContent className="p-4 relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {delta && <p className="text-[10px] text-primary font-mono mt-0.5">{delta}</p>}
          </div>
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </CardContent>
    </Card>
  );
}

function Meter({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  const hasValue = typeof value === "number" && Number.isFinite(value);
  return (
    <div>
      <div className="flex justify-between text-xs font-mono mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className={hasValue ? "text-primary font-bold" : "text-muted-foreground font-bold"}>
          {hasValue ? `${(value as number).toFixed(0)}${suffix ?? ""}` : "—"}
        </span>
      </div>
      <Progress value={hasValue ? (value as number) : 0} className="h-1.5" />
    </div>
  );
}

function Stat({ label, value, tone = "ok" }: { label: string; value: string | number; tone?: "ok" | "warn" }) {
  return (
    <div className="border border-border rounded p-2 bg-card/40">
      <p className="text-[9px] uppercase font-mono tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold mt-0.5 ${tone === "warn" ? "text-destructive" : "text-primary"}`}>{value}</p>
    </div>
  );
}

function ServiceCard({ name, status, icon: Icon, detail }: { name: string; status: "running" | "idle" | "stopped"; icon: LucideIcon; detail?: string }) {
  const color = status === "running" ? "text-primary" : status === "idle" ? "text-muted-foreground" : "text-destructive";
  return (
    <Card className="glass">
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className={`h-5 w-5 ${color}`} />
          <div>
            <p className="text-sm font-medium">{name}</p>
            <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-widest">
              {status}{detail ? ` · ${detail}` : ""}
            </p>
          </div>
        </div>
        <span className={`pulse-dot ${status === "running" ? "" : "!bg-muted-foreground"}`} />
      </CardContent>
    </Card>
  );
}

function Sparkline({ frame }: { frame: MetricsFrame | null }) {
  const [points, setPoints] = useState<number[]>(() => Array.from({ length: 40 }, () => 0));
  useEffect(() => {
    if (!frame) return;
    setPoints((p) => [...p.slice(1), Math.max(0, Math.min(100, frame.cpu ?? 0))]);
  }, [frame]);
  const w = 400, h = 80;
  const path = points.map((v, i) => `${(i / (points.length - 1)) * w},${h - (v / 100) * h}`).join(" L ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M ${path} L ${w},${h} L 0,${h} Z`} fill="url(#sparkFill)" />
      <path d={`M ${path}`} fill="none" stroke="var(--primary)" strokeWidth="1.5" />
    </svg>
  );
}

function ActiveSessionsCard() {
  const { t } = useI18n();
  const { sessions, disconnect } = useSessions();
  const { user } = useAuth();
  const isAdmin = (user?.role || "").toLowerCase() === "admin";
  const handle = (id: string, name: string) => {
    if (!isAdmin) { toast.error(t("dash.only_admin_disconnect")); return; }
    if (!confirm(`${t("dash.disconnect")}: "${name}"?`)) return;
    disconnect(id);
    toast.success(`"${name}" — ${t("dash.disconnect")}`);
  };
  return (
    <Card className="glass mb-6">
      <CardHeader>
        <CardTitle className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-primary" /> {t("dash.active_sessions")}
          <Badge variant="outline" className="ml-2 font-mono text-[10px]">{t("dash.online_count").replace("{n}", String(sessions.length))}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground font-mono">{t("dash.no_active_users")}</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {sessions.map(s => {
              const isSelf = !!user?.sessionId && user.sessionId === s.id;
              return (
                <li key={s.id} className="flex items-center gap-3 py-2 text-xs font-mono">
                  <span className="pulse-dot" />
                  <span className="font-bold text-primary min-w-[100px]">
                    {s.username}{isSelf && <span className="ml-1 text-[9px] text-muted-foreground">{t("dash.you")}</span>}
                  </span>
                  <Badge variant="outline" className="text-[9px]">{s.role}</Badge>
                  <Badge variant="outline" className="text-[9px]">{s.provider.toUpperCase()}</Badge>
                  <span className="text-muted-foreground">{s.ip || "—"}</span>
                  <span className="text-muted-foreground hidden md:inline">{s.device}</span>
                  <span className="text-muted-foreground hidden lg:inline ml-auto">
                    {t("dash.since")} {new Date(s.connectedAt).toLocaleTimeString()}
                  </span>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto lg:ml-2 text-destructive border-destructive/40 hover:bg-destructive/10"
                      onClick={() => handle(s.id, s.username)}
                      disabled={isSelf}
                      title={isSelf ? t("dash.use_logout") : t("dash.disconnect")}
                    >
                      <LogOut className="h-3.5 w-3.5 mr-1" /> {t("dash.disconnect")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const ROSTER_KEY = "dashboard.roster.pinned.v1";
function loadPinned(): string[] {
  try { return JSON.parse(localStorage.getItem(ROSTER_KEY) ?? "[]"); } catch { return []; }
}
function savePinned(ids: string[]) {
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

function AgentsPanel({ models }: { models: ModelDTO[] }) {
  const { locale } = useI18n();
  const L = <T,>(tr: T, en: T): T => (en);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinned, setPinned] = useState<string[]>(() => loadPinned());
  const [menuOpen, setMenuOpen] = useState(false);
  const [dispatching, setDispatching] = useState<Record<string, boolean>>({});
  const agentRuns = useAgentRuns(true);


  const refresh = async () => {
    try { setAgents(await AgentsAPI.list()); }
    catch { setAgents([]); }
    finally { setLoading(false); }
  };
  useVisiblePoll(refresh, 5000);

  const rosterAgents = useMemo(
    () => pinned.map(id => agents.find(a => a.id === id)).filter(Boolean) as AgentRow[],
    [pinned, agents],
  );
  const activeCount = useMemo(() => rosterAgents.filter(isAgentLive).length, [rosterAgents]);
  const armedCount  = useMemo(() => rosterAgents.filter(isAgentArmed).length, [rosterAgents]);
  const liveRunCount = useMemo(
    () => rosterAgents.reduce((acc, a) => acc + (agentRuns.counts[a.id] || 0), 0),
    [rosterAgents, agentRuns.counts],
  );

  const modelNameFor = (id?: string | null) => {
    if (!id) return "—";
    const mm = models.find((x) => x.id === id);
    return mm?.modelName || id.split(/[\\/]/).filter(Boolean).pop() || id;
  };

  const togglePin = (id: string) => {
    setPinned(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      savePinned(next);
      return next;
    });
  };

  const removeFromRoster = (a: AgentRow) => {
    setPinned(prev => {
      const next = prev.filter(x => x !== a.id);
      savePinned(next);
      return next;
    });
    toast.success(`"${a.name}" removed from roster`);
  };

  const toggle = async (a: AgentRow) => {
    const enable = a.status !== "active";
    const r = await AgentsAPI.toggle(a.id, enable);
    const bridgeConfigured = !!(a.bridge_url && a.bridge_url.trim());
    if (!r.ok) toast.error(`Agent "${a.name}" ${enable ? "arming" : "disarming"} failed · ${r.bridge.message}`);
    else if (r.status === "idle") toast.success(`Agent "${a.name}" disarmed · local registry updated`);
    else if (r.signal) toast.success(`Agent "${a.name}" armed · ${r.bridge.message}`);
    else if (!bridgeConfigured) toast.success(`Agent "${a.name}" armed · local registry`);
    else toast.message(`Agent "${a.name}" armed · awaiting first heartbeat`);
    await refresh();
  };

  const dispatch = async (a: AgentRow) => {
    setDispatching((d) => ({ ...d, [a.id]: true }));
    try {
      const r = await AgentsAPI.run(a.id, {});
      const meta = (a.meta ?? {}) as { script?: string };
      const scriptName = meta.script ? String(meta.script).split("/").pop() : "agent";
      if (r.ok) toast.success(`${a.name} · ${scriptName} · ${r.latencyMs ?? 0}ms`);
      else toast.error(`${a.name} failed · ${r.error ?? r.agent_error?.text ?? "unknown"}`);
    } catch (e) {
      toast.error(`${a.name} dispatch failed · ${(e as Error).message}`);
    } finally {
      setDispatching((d) => { const n = { ...d }; delete n[a.id]; return n; });
      await refresh();
    }
  };

  return (
    <Card className="glass mb-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" /> {"Agent Roster"}
            <Badge variant="outline" className="ml-2 font-mono text-[10px]">{`${armedCount} armed · ${activeCount} live · ${liveRunCount} running · ${rosterAgents.length} total`}</Badge>
          </CardTitle>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="bg-gradient-primary text-primary-foreground">
                <UserPlus className="h-3.5 w-3.5 mr-1" /> {"New"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-h-80 overflow-y-auto">
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest">
                {"Agents from Agents tab"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {agents.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground font-mono">
                  {"No agents defined yet. Add them from the Agents tab."}
                </div>
              )}
              {agents.map(a => {
                const isPinned = pinned.includes(a.id);
                return (
                  <DropdownMenuItem
                    key={a.id}
                    onSelect={(e) => { e.preventDefault(); togglePin(a.id); }}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Bot className={`h-3.5 w-3.5 ${a.status === "active" ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{a.name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">
                        {modelNameFor(a.model)} · :{a.port ?? portFromBridge(a.bridge_url)}
                      </p>
                    </div>
                    {isPinned && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-xs text-muted-foreground font-mono">{"Connecting to agents bridge…"}</p>}
        {!loading && rosterAgents.length === 0 && (
          <p className="text-xs text-muted-foreground font-mono">
            <>Roster is empty. Use the <span className="text-primary">"New"</span> button to pick agents from the Agents tab.</>
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {rosterAgents.map(a => {
            const busy = !!dispatching[a.id];
            const armed = isAgentArmed(a);
            const liveRuns = agentRuns.counts[a.id] || 0;
            return (
              <div key={a.id} className="flex items-center gap-2 border border-border rounded p-2 bg-card/40">
                <span className={`pulse-dot ${liveRuns > 0 ? "" : isAgentLive(a) ? "" : a.status === "error" ? "!bg-destructive" : "!bg-muted-foreground"}`}
                  style={liveRuns > 0 ? { boxShadow: "0 0 14px var(--destructive), 0 0 4px var(--destructive)", background: "var(--destructive)" } : isAgentLive(a) ? { boxShadow: "0 0 12px var(--primary), 0 0 4px var(--primary)" } : undefined}/>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">
                    {a.name}
                    {liveRuns > 0 && (
                      <span className="ml-1 font-mono text-[9px] text-destructive">· running×{liveRuns}</span>
                    )}
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground truncate">{modelNameFor(a.model)} · :{a.port ?? portFromBridge(a.bridge_url)} · {agentSignalLabel(a)}</p>
                </div>
                {liveRuns > 0 ? (
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7"
                    title={`Stop ${liveRuns} live run(s) for this agent`}
                    onClick={async () => {
                      try { await agentRuns.cancel(a.id); toast.success(`Stop signal sent · ${a.name}`); }
                      catch (e) { toast.error((e as Error).message); }
                    }}
                  >
                    <Square className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                ) : (
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7"
                    title="Dispatch this agent's script once"
                    disabled={busy}
                    onClick={() => dispatch(a)}
                  >
                    {busy
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Play className="h-3.5 w-3.5 text-primary" />}
                  </Button>
                )}
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  title={armed ? "Disarm agent (allow-list off)" : "Arm agent (allow-list on)"}
                  onClick={() => toggle(a)}
                >
                  {armed
                    ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    : <ShieldOff className="h-3.5 w-3.5 text-muted-foreground" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Remove from roster" onClick={() => removeFromRoster(a)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

