import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plug, RefreshCw, Download, Copy, Pause, Play, Trash2, Radio } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveApiBaseUrl, LogsAPI, ProvidersAPI, type AgentLog, type AiProviderDTO, type ProviderPingResult } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/debug")({ component: DebugPage });

type Category = "chat" | "rag" | "model" | "auth" | "pdf" | "agent" | "infra" | "other";
const CATEGORIES: { id: Category; label: string; group: "src" | "wf" | "infra" }[] = [
  { id: "chat",  label: "Chat",   group: "src" },
  { id: "rag",   label: "RAG",    group: "src" },
  { id: "model", label: "Model",  group: "src" },
  { id: "auth",  label: "Auth",   group: "src" },
  { id: "pdf",   label: "PDF",    group: "src" },
  { id: "other", label: "Other",  group: "src" },
  { id: "agent", label: "Agent Trace", group: "wf" },
  { id: "infra", label: "Infra Latency", group: "infra" },
];

function categorize(msg: string): Category {
  const m = msg.toLowerCase();
  if (m.startsWith("agent.")) return "agent";
  if (m.startsWith("infra.") || m.startsWith("stream.frame")) return "infra";
  if (m.startsWith("chat.") || m.startsWith("stream.")) return "chat";
  if (m.startsWith("rag.")) return "rag";
  if (m.startsWith("model.")) return "model";
  if (m.startsWith("auth.")) return "auth";
  if (m.startsWith("pdf.")) return "pdf";
  return "other";
}

function fmtLog(l: AgentLog) {
  const ts = new Date(l.created_at!).toLocaleTimeString();
  const meta = l.meta ? ` · ${JSON.stringify(l.meta)}` : "";
  return `[${ts}] ${String(l.level).toUpperCase().padEnd(5)} · ${String(l.agent).padEnd(11)} · ${l.message}${meta}`;
}

function tsForFilename() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const CATS_KEY = "elara.debug.cats";
const FLAGS_KEY = "elara.debug.flags";
type DebugFlags = { bypassApprovals: boolean; heartbeat: boolean; rawSse: boolean; latencyOverlay: boolean };
const FLAGS_DEFAULT: DebugFlags = { bypassApprovals: false, heartbeat: true, rawSse: false, latencyOverlay: true };

function loadCats(): Set<Category> {
  if (typeof localStorage === "undefined") return new Set(CATEGORIES.map(c => c.id));
  try {
    const raw = localStorage.getItem(CATS_KEY);
    if (!raw) return new Set(CATEGORIES.map(c => c.id));
    return new Set(JSON.parse(raw) as Category[]);
  } catch { return new Set(CATEGORIES.map(c => c.id)); }
}
function loadFlags(): DebugFlags {
  if (typeof localStorage === "undefined") return FLAGS_DEFAULT;
  try {
    const raw = localStorage.getItem(FLAGS_KEY);
    if (!raw) return FLAGS_DEFAULT;
    return { ...FLAGS_DEFAULT, ...(JSON.parse(raw) as Partial<DebugFlags>) };
  } catch { return FLAGS_DEFAULT; }
}

function DebugPage() {
  const { t } = useI18n();
  const apiBaseUrl = resolveApiBaseUrl();
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [providers, setProviders] = useState<AiProviderDTO[]>([]);
  const [pings, setPings] = useState<Record<string, ProviderPingResult & { ts?: number }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"checkpoints" | "raw" | "live">("checkpoints");
  const [enabledCats, setEnabledCats] = useState<Set<Category>>(() => loadCats());
  const [flags, setFlags] = useState<DebugFlags>(() => loadFlags());

  // Live Stream state
  const [liveLogs, setLiveLogs] = useState<AgentLog[]>([]);
  const [liveOnline, setLiveOnline] = useState(false);
  const [livePaused, setLivePaused] = useState(false);
  const [eventsPerSec, setEventsPerSec] = useState(0);
  const liveRef = useRef<HTMLPreElement>(null);
  const eventBucketRef = useRef<number[]>([]);
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = livePaused; }, [livePaused]);

  useEffect(() => {
    try { localStorage.setItem(CATS_KEY, JSON.stringify([...enabledCats])); } catch { /* noop */ }
  }, [enabledCats]);
  useEffect(() => {
    try { localStorage.setItem(FLAGS_KEY, JSON.stringify(flags)); } catch { /* noop */ }
  }, [flags]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      LogsAPI.list({ limit: 200 })
        .then((l) => { if (alive) { setLogs(l); setErr(null); } })
        .catch((e) => { if (alive) setErr(`Middleware unreachable @ ${apiBaseUrl}: ${(e as Error).message}`); });
    };
    tick(); const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [apiBaseUrl]);

  useEffect(() => { ProvidersAPI.list().then(setProviders).catch(() => setProviders([])); }, []);

  // Live Stream — connect to /api/audit/stream via EventSource with auto-reconnect
  useEffect(() => {
    let es: EventSource | null = null;
    let backoff = 500;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let staleTimer: ReturnType<typeof setInterval> | null = null;
    let lastFrameAt = Date.now();
    let cancelled = false;

    const appendLiveLog = (data: Partial<AgentLog> & { ts?: number }) => {
      if (pausedRef.current) return;
      const log: AgentLog = {
        agent: String(data.agent || "system"),
        level: (data.level || "info") as AgentLog["level"],
        message: String(data.message || ""),
        meta: data.meta ?? undefined,
        created_at: new Date(data.ts || Date.now()).toISOString(),
        thread_id: data.thread_id ?? undefined,
      };
      setLiveLogs((prev) => {
        const next = [...prev, log];
        return next.length > 500 ? next.slice(-500) : next;
      });
      eventBucketRef.current.push(Date.now());
      lastFrameAt = Date.now();
    };

    const reconnect = () => {
      setLiveOnline(false);
      es?.close();
      if (!cancelled) {
        timer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 5000);
      }
    };

    const connect = () => {
      try {
        es = new EventSource(`${apiBaseUrl}/api/audit/stream`);
        es.onopen = () => { setLiveOnline(true); backoff = 500; lastFrameAt = Date.now(); };
        es.onerror = reconnect;
        es.addEventListener("heartbeat", (ev) => {
          try { appendLiveLog(JSON.parse((ev as MessageEvent).data)); } catch { /* ignore malformed frames */ }
        });
        es.onmessage = (ev) => {
          try {
            appendLiveLog(JSON.parse(ev.data));
          } catch { /* ignore malformed frames */ }
        };
      } catch {
        reconnect();
      }
    };
    connect();

    staleTimer = setInterval(() => {
      if (!cancelled && Date.now() - lastFrameAt > 45000) reconnect();
    }, 5000);

    const epsTimer = setInterval(() => {
      const cutoff = Date.now() - 1000;
      eventBucketRef.current = eventBucketRef.current.filter(t => t > cutoff);
      setEventsPerSec(eventBucketRef.current.length);
    }, 500);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (staleTimer) clearInterval(staleTimer);
      clearInterval(epsTimer);
      es?.close();
    };
  }, [apiBaseUrl]);

  // Auto-scroll live tab
  useEffect(() => {
    if (tab === "live" && !livePaused && liveRef.current) {
      liveRef.current.scrollTop = liveRef.current.scrollHeight;
    }
  }, [liveLogs, tab, livePaused]);

  const ping = async (id: string) => {
    setBusy(id);
    const r = await ProvidersAPI.ping(id);
    setPings(prev => ({ ...prev, [id]: { ...r, ts: Date.now() } }));
    setBusy(null);
    if (r.ok) toast.success(`${t("debug.reachable")} · ${r.latencyMs}ms`);
    else toast.error(`${t("debug.unreachable")}: ${r.error || r.message || r.status || ""}`);
  };
  const pingAll = async () => { for (const p of providers) await ping(p.id); };

  const checkpoints = useMemo(() => logs.filter(l => l.agent === "checkpoint"), [logs]);
  const raw = useMemo(() => logs.filter(l => l.agent !== "checkpoint"), [logs]);

  const catCounts = useMemo(() => {
    const counts: Record<Category, number> = { chat: 0, rag: 0, model: 0, auth: 0, pdf: 0, agent: 0, infra: 0, other: 0 };
    for (const l of checkpoints) counts[categorize(l.message)]++;
    return counts;
  }, [checkpoints]);

  // Latency stats from infra.latency checkpoints
  const latencyStats = useMemo(() => {
    const samples = checkpoints
      .filter(l => String(l.message).startsWith("infra.latency"))
      .map(l => Number((l.meta as { ms?: number } | null)?.ms ?? 0))
      .filter(n => n > 0)
      .sort((a, b) => a - b);
    if (samples.length === 0) return null;
    const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
    return { count: samples.length, p50: p(0.5), p95: p(0.95), max: samples[samples.length - 1] };
  }, [checkpoints]);

  const matchFilter = (l: AgentLog) => {
    if (!filter.trim()) return true;
    const needle = filter.toLowerCase();
    return String(l.message).toLowerCase().includes(needle) ||
      String(l.agent).toLowerCase().includes(needle) ||
      String(l.level).toLowerCase().includes(needle) ||
      (l.meta && JSON.stringify(l.meta).toLowerCase().includes(needle));
  };

  const visible = useMemo(() => {
    let src: AgentLog[];
    if (tab === "checkpoints") src = checkpoints.filter(l => enabledCats.has(categorize(l.message)));
    else if (tab === "raw") src = raw;
    else {
      // live tab — apply category filter to checkpoints; show raw if rawSse flag on
      src = liveLogs.filter(l => {
        if (l.agent === "checkpoint") return enabledCats.has(categorize(l.message));
        if (l.agent === "heartbeat") return flags.heartbeat;
        return flags.rawSse;
      });
    }
    return src.filter(matchFilter);
  }, [tab, checkpoints, raw, liveLogs, filter, enabledCats, flags.rawSse]);

  const toggleCat = (id: Category) => {
    setEnabledCats(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allOn = () => setEnabledCats(new Set(CATEGORIES.map(c => c.id)));
  const allOff = () => setEnabledCats(new Set());

  const downloadTxt = () => {
    const cats = tab === "raw" ? "raw" : [...enabledCats].join(",") || "none";
    const header = `# ELARA Debug Trace · ${new Date().toISOString()}\n# api=${apiBaseUrl} · tab=${tab} · cats=${cats} · filter="${filter}" · count=${visible.length}\n\n`;
    const body = visible.map(fmtLog).join("\n");
    const blob = new Blob([header + body + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `elara-debug-${tab}-${tsForFilename()}.txt`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Indirildi · ${visible.length} satır`);
  };
  const copyAll = () => {
    const text = visible.map(fmtLog).join("\n");
    navigator.clipboard.writeText(text).then(() => toast.success(`Panoya kopyalandı · ${visible.length} satır`));
  };
  const clearLive = () => { setLiveLogs([]); eventBucketRef.current = []; toast.success("Live stream temizlendi"); };

  const clearSessionCache = () => {
    let removed = 0;
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("elara.")) keys.push(k);
      }
      for (const k of keys) { localStorage.removeItem(k); removed++; }
      sessionStorage.clear();
    } catch { /* noop */ }
    toast.success(`Session cache cleared · ${removed} keys`);
  };

  const sourceCats = CATEGORIES.filter(c => c.group === "src");

  return (
    <PageShell>
      <PageHeader title="Debug Center" subtitle="Per-module debugger · live middleware trace · external API health" />

      <Card className="glass mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
              <Plug className="h-4 w-4 text-primary"/>{t("debug.api_health")}
            </h3>
            <Button size="sm" variant="outline" onClick={pingAll} disabled={!!busy || providers.length === 0}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", busy && "animate-spin")}/>{t("debug.ping_all")}
            </Button>
          </div>
          {providers.length === 0 ? (
            <p className="text-xs text-muted-foreground font-mono">No external providers configured. Add some under Settings → AI & Search Providers.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {providers.map(p => {
                const r = pings[p.id];
                const status = !r ? "—" : r.ok ? "OK" : "FAIL";
                return (
                  <div key={p.id} className="border border-border rounded p-3 flex items-center gap-3">
                    <Badge variant="outline" className="font-mono uppercase text-[9px]">{p.kind}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.providerName}</p>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">
                        {p.model || p.baseUrl || "—"}
                        {r && ` · ${r.latencyMs}ms${r.ok ? "" : ` · ${r.error || r.message || r.status || ""}`}`}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn("font-mono text-[10px]",
                      r?.ok && "text-primary border-primary",
                      r && !r.ok && "text-destructive border-destructive")}>{status}</Badge>
                    <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => ping(p.id)}>
                      <Plug className="h-3.5 w-3.5 mr-1"/>{t("debug.ping")}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardContent className="p-0">
          <div className="p-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono uppercase tracking-widest">Live Trace · {apiBaseUrl}</span>
              {err
                ? <Badge variant="outline" className="text-destructive font-mono text-[10px]">offline</Badge>
                : <Badge variant="outline" className="text-primary font-mono text-[10px]">streaming · {visible.length}</Badge>}
              {tab === "live" && (
                <Badge variant="outline" className={cn("font-mono text-[10px] gap-1.5",
                  liveOnline ? "text-primary border-primary" : "text-destructive border-destructive")}>
                  <Radio className={cn("h-3 w-3", liveOnline && "animate-pulse")}/>
                  {liveOnline ? "LIVE" : "RECONNECT"} · {eventsPerSec}/s
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="filter…"
                className="h-7 w-40 text-xs font-mono"
              />
              {tab === "live" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setLivePaused(p => !p)}>
                    {livePaused ? <><Play className="h-3.5 w-3.5 mr-1"/>{t("common.resume")}</> : <><Pause className="h-3.5 w-3.5 mr-1"/>{t("common.pause")}</>}
                  </Button>
                  <Button size="sm" variant="outline" onClick={clearLive}>
                    <Trash2 className="h-3.5 w-3.5 mr-1"/>Clear
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={copyAll} disabled={visible.length === 0}>
                <Copy className="h-3.5 w-3.5 mr-1"/>Copy
              </Button>
              <Button size="sm" variant="outline" onClick={downloadTxt} disabled={visible.length === 0}>
                <Download className="h-3.5 w-3.5 mr-1"/>.txt
              </Button>
            </div>
          </div>

          {/* Sources row */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap bg-muted/20">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mr-1 w-16">{t("debug.sources")}</span>
            {sourceCats.map(c => {
              const on = enabledCats.has(c.id);
              const count = catCounts[c.id];
              return (
                <Toggle
                  key={c.id}
                  pressed={on}
                  onPressedChange={() => toggleCat(c.id)}
                  variant="outline" size="sm"
                  className={cn("h-7 px-2 font-mono text-[10px] uppercase tracking-widest gap-1.5",
                    on ? "data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:border-primary" : "opacity-50")}
                >
                  <span className={cn("inline-block h-1.5 w-1.5 rounded-full", on ? "bg-primary" : "bg-muted-foreground")} />
                  {c.label}
                  <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 h-4">{count}</Badge>
                </Toggle>
              );
            })}
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-[10px] font-mono uppercase" onClick={allOn}>all</Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px] font-mono uppercase" onClick={allOff}>none</Button>
            </div>
          </div>

          {/* Workflow row */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap bg-muted/10">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mr-1 w-16">{t("debug.workflow")}</span>
            <Toggle
              pressed={enabledCats.has("agent")}
              onPressedChange={() => toggleCat("agent")}
              variant="outline" size="sm"
              className="h-7 px-2 font-mono text-[10px] uppercase tracking-widest gap-1.5 data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:border-primary"
            >
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", enabledCats.has("agent") ? "bg-primary" : "bg-muted-foreground")} />
              Agent Trace
              <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 h-4">{catCounts.agent}</Badge>
            </Toggle>
            <Toggle
              pressed={flags.bypassApprovals}
              onPressedChange={() => setFlags(f => ({ ...f, bypassApprovals: !f.bypassApprovals }))}
              variant="outline" size="sm"
              disabled={!import.meta.env.DEV}
              className="h-7 px-2 font-mono text-[10px] uppercase tracking-widest gap-1.5 data-[state=on]:bg-amber-500/10 data-[state=on]:text-amber-500 data-[state=on]:border-amber-500"
              title={import.meta.env.DEV ? "Approval gate'lerini atla" : "Production'da kilitli"}
            >
              Bypass Approvals
              <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 h-4">{import.meta.env.DEV ? "DEV" : "LOCKED"}</Badge>
            </Toggle>
            <Toggle
              pressed={flags.heartbeat}
              onPressedChange={() => setFlags(f => ({ ...f, heartbeat: !f.heartbeat }))}
              variant="outline" size="sm"
              className="h-7 px-2 font-mono text-[10px] uppercase tracking-widest gap-1.5 data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:border-primary"
            >
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", flags.heartbeat ? "bg-primary animate-pulse" : "bg-muted-foreground")} />
              Heartbeat
            </Toggle>
          </div>

          {/* Infra row */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap bg-muted/10">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mr-1 w-16">{t("debug.infra")}</span>
            <Toggle
              pressed={flags.rawSse}
              onPressedChange={() => setFlags(f => ({ ...f, rawSse: !f.rawSse }))}
              variant="outline" size="sm"
              className="h-7 px-2 font-mono text-[10px] uppercase tracking-widest gap-1.5 data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:border-primary"
              title="Show raw SSE/audit frames in Live Stream as well"
            >
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", flags.rawSse ? "bg-primary" : "bg-muted-foreground")} />
              Raw SSE Frames
            </Toggle>
            <Toggle
              pressed={enabledCats.has("infra") && flags.latencyOverlay}
              onPressedChange={() => {
                setFlags(f => ({ ...f, latencyOverlay: !f.latencyOverlay }));
                if (!enabledCats.has("infra")) toggleCat("infra");
              }}
              variant="outline" size="sm"
              className="h-7 px-2 font-mono text-[10px] uppercase tracking-widest gap-1.5 data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:border-primary"
            >
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", flags.latencyOverlay ? "bg-primary" : "bg-muted-foreground")} />
              Latency Overlay
              <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 h-4">{catCounts.infra}</Badge>
            </Toggle>
            {flags.latencyOverlay && latencyStats && (
              <span className="text-[10px] font-mono text-muted-foreground ml-1">
                p50 <b className="text-foreground">{latencyStats.p50}ms</b> · p95 <b className="text-foreground">{latencyStats.p95}ms</b> · max <b className="text-foreground">{latencyStats.max}ms</b> · n={latencyStats.count}
              </span>
            )}
            <div className="ml-auto">
              <Button size="sm" variant="outline" onClick={clearSessionCache} className="h-7 text-[10px] font-mono uppercase">
                <Trash2 className="h-3.5 w-3.5 mr-1"/>Clear Session Cache
              </Button>
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "checkpoints" | "raw" | "live")}>
            <div className="px-3 pt-3">
              <TabsList>
                <TabsTrigger value="checkpoints" className="font-mono text-[11px] uppercase tracking-widest">
                  Checkpoints · {checkpoints.length}
                </TabsTrigger>
                <TabsTrigger value="raw" className="font-mono text-[11px] uppercase tracking-widest">
                  Raw stream · {raw.length}
                </TabsTrigger>
                <TabsTrigger value="live" className="font-mono text-[11px] uppercase tracking-widest gap-1.5">
                  <Radio className={cn("h-3 w-3", liveOnline && "text-primary animate-pulse")}/>
                  Live Stream · {liveLogs.length}
                </TabsTrigger>
              </TabsList>
              {tab === "raw" && (
                <p className="text-[10px] font-mono text-muted-foreground mt-2">
                  Raw stream ignores category toggles — only the substring filter applies.
                </p>
              )}
              {tab === "live" && (
                <p className="text-[10px] font-mono text-muted-foreground mt-2">
                  Real-time SSE stream (audit/stream). Enabled categories are filtered · Raw SSE toggle adds raw frames.
                </p>
              )}
            </div>
            <TabsContent value="checkpoints" className="m-0">
              <pre className="p-4 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-[480px]">
{err
  ? `[ERR] ${err}\n\nDebug: open Settings → Middleware to fix port / API URL.`
  : enabledCats.size === 0
    ? "[muted] All categories disabled. Enable at least one above."
    : visible.length === 0
      ? "[idle] No checkpoints match. Trigger a chat → chat.request, agent.step.start, rag.search.start, model.first_token, model.responded burada akar."
      : visible.map(fmtLog).join("\n")}
              </pre>
            </TabsContent>
            <TabsContent value="raw" className="m-0">
              <pre className="p-4 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-[480px]">
{err
  ? `[ERR] ${err}`
  : visible.length === 0
    ? "[idle] No raw logs match the current filter."
    : visible.map(fmtLog).join("\n")}
              </pre>
            </TabsContent>
            <TabsContent value="live" className="m-0">
              <pre ref={liveRef} className="p-4 font-mono text-[11px] leading-relaxed overflow-auto max-h-[520px]">
{!liveOnline && liveLogs.length === 0
  ? "[connecting] Establishing SSE connection… (auto-reconnect active)"
  : visible.length === 0
    ? "[idle] No frames from enabled categories yet. Trigger a chat or toggle a category."
    : visible.map(fmtLog).join("\n")}
              </pre>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </PageShell>
  );
}
