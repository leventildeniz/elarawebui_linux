import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Wifi, Plus, Minus, Activity, AlertTriangle, ShieldCheck, ShieldAlert, RotateCw, Power, Trash2, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSecurity } from "@/lib/security-store";
import { createLocalId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { BridgeAPI, SystemAPI, resolveApiBaseUrl } from "@/lib/api-client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/middleware")({ component: MiddlewarePage });

type LinkState = "up" | "down" | "checking";
type Breaker = "closed" | "open" | "halfopen";

function MiddlewarePage() {
  const { t } = useI18n();
  const { middleware: m, setMiddleware } = useSecurity();
  const [hb, setHb] = useState<{ status: LinkState; latency: number }>({ status: "checking", latency: 0 });
  const [bridge, setBridge] = useState<{ mw: LinkState; agents3001: LinkState; llm: LinkState }>({ mw: "checking", agents3001: "checking", llm: "checking" });
  const [breaker, setBreaker] = useState<Breaker>("closed");
  const [failures, setFailures] = useState(0);
  const [lastCheck, setLastCheck] = useState<string>("—");
  const cooldownRef = useRef<number>(0);
  const apiBaseUrl = resolveApiBaseUrl();

  useEffect(() => {
    let alive = true;
    const TIMEOUT_MS = 30000;       // sabırlı: Mac yavaş yanıtsa beklesin
    const FAILURE_THRESHOLD = 6;    // anlık paket kaybında tüneli kapatma
    const POLL_MS = 3000;
    const ping = async () => {
      const t0 = performance.now();
      let proxyUp: LinkState = "down";
      try {
        const res = await fetch(`${apiBaseUrl}/api/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        const body = await res.json().catch(() => null) as { status?: string } | null;
        proxyUp = res.ok && body?.status === "ok" ? "up" : "down";
        if (alive) setHb({ status: proxyUp, latency: Math.round(performance.now() - t0) });
      } catch {
        if (alive) setHb({ status: "down", latency: 0 });
      }
      const bh = await BridgeAPI.health();
      if (!alive) return;
      const next = {
        mw: (proxyUp === "up" ? "up" : "down") as LinkState,
        agents3001: (bh.agents3001 ? "up" : "down") as LinkState,
        llm: (bh.llm ? "up" : "down") as LinkState,
      };
      setBridge(next);
      setLastCheck(new Date().toLocaleTimeString());
      // Sadece proxy hattı breaker'ı tetikler; agent/llm bilgi amaçlı.
      const proxyDown = next.mw === "down";
      setFailures(prev => {
        const n = proxyDown ? prev + 1 : 0;
        if (n >= FAILURE_THRESHOLD) {
          setBreaker("open");
          cooldownRef.current = Date.now() + 15000;
        } else if (!proxyDown) {
          setBreaker(b => b === "closed" ? "closed" : (Date.now() > cooldownRef.current ? "closed" : "halfopen"));
        }
        return n;
      });
    };
    ping();
    const id = setInterval(ping, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [apiBaseUrl]);

  const breakerColor = breaker === "open" ? "text-destructive" : breaker === "halfopen" ? "text-amber-400" : "text-primary";
  const breakerLabel = breaker === "open" ? t("mw.open") : breaker === "halfopen" ? t("mw.halfopen") : t("mw.closed");
  const dot = (s: LinkState) =>
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${s==="up"?"bg-primary shadow-[0_0_10px] shadow-primary":s==="down"?"bg-destructive animate-pulse":"bg-muted-foreground"}`}/>;

  return (
    <PageShell>
      <PageHeader title={t("mw.title")} subtitle={t("mw.subtitle")} />

      {breaker === "open" && (
        <div className="mb-4 rounded-md border border-destructive/60 bg-destructive/10 px-4 py-3 flex items-center gap-3 animate-pulse">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <span className="font-mono text-sm font-bold text-destructive tracking-widest">{t("mw.alert")}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="glass"><CardContent className="p-6 space-y-4">
          <h3 className="font-bold text-sm font-mono uppercase tracking-widest">Server</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Frontend Port</Label>
              <Input type="number" value={m.port} onChange={e=>setMiddleware({...m, port:Number(e.target.value)})} className="font-mono mt-1"/></div>
            <div><Label>Backend API URL</Label>
              <Input value={apiBaseUrl} readOnly className="font-mono mt-1"/></div>
          </div>
          <div className="flex items-center gap-3 border-t border-border pt-3">
            <Wifi className={`h-4 w-4 ${hb.status==="up"?"text-primary":hb.status==="down"?"text-destructive":"text-muted-foreground"}`}/>
            <span className="text-xs font-mono uppercase">{hb.status==="up"?t("mw.up"):hb.status==="down"?t("mw.down"):t("mw.checking")}</span>
            {hb.status==="up" && <Badge variant="outline" className="font-mono text-[10px]">{hb.latency} ms</Badge>}
          </div>
        </CardContent></Card>

        <Card className="glass"><CardContent className="p-6 space-y-4">
          <h3 className="font-bold text-sm font-mono uppercase tracking-widest flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary"/>{t("mw.tunnel")}
          </h3>
          <div className="text-5xl font-bold text-primary font-mono">{m.tunnelLatencyMs}<span className="text-base text-muted-foreground"> ms</span></div>
          <p className="text-xs text-muted-foreground">{t("mw.latency_hint")}</p>
          <Input type="number" value={m.tunnelLatencyMs}
            onChange={e=>setMiddleware({...m, tunnelLatencyMs:Number(e.target.value)})}
            className="font-mono"/>
        </CardContent></Card>

        <ServicesHealthCard lastCheck={lastCheck} />

        <Card className={`glass ${breaker==="open"?"border-destructive/60":""}`}><CardContent className="p-6 space-y-3">
          <h3 className="font-bold text-sm font-mono uppercase tracking-widest flex items-center gap-2">
            <ShieldAlert className={`h-4 w-4 ${breakerColor}`}/>{t("mw.breaker")}
          </h3>
          <div className={`text-3xl font-bold font-mono ${breakerColor}`}>{breakerLabel}</div>
          <div className="text-xs font-mono text-muted-foreground">{t("mw.failures")}: <span className="text-foreground">{failures}</span></div>
          <Button size="sm" variant="outline" onClick={() => { setBreaker("closed"); setFailures(0); cooldownRef.current = 0; }}>
            <RotateCw className="h-3.5 w-3.5 mr-1"/>{t("mw.reset_breaker")}
          </Button>
        </CardContent></Card>
      </div>

      <Card className="glass mt-4"><CardContent className="p-6 space-y-4">
        <h3 className="font-bold text-sm font-mono uppercase tracking-widest">{t("mw.security_filters")}</h3>
        {([
          ["IP Whitelisting", "ipWhitelistEnabled"],
          ["Rate Limiting", "rateLimitEnabled"],
          ["Binary File Interception (.pcap, .pdf, .vsdx ...)", "binaryInterceptionEnabled"],
        ] as const).map(([label, k]) => (
          <div key={k} className="flex items-center justify-between border border-border rounded p-3">
            <span className="text-sm">{label}</span>
            <Switch checked={m[k]} onCheckedChange={(v)=>setMiddleware({ ...m, [k]: v })}/>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("mw.ip_whitelist")}</Label>
            <textarea rows={3} value={m.ipWhitelist.join("\n")}
              onChange={e=>setMiddleware({...m, ipWhitelist:e.target.value.split("\n").map(s=>s.trim()).filter(Boolean)})}
              className="w-full mt-1 p-2 rounded-md bg-card/50 border border-border text-xs font-mono"/>
          </div>
          <div>
            <Label>Rate Limit (req/min)</Label>
            <Input type="number" value={m.rateLimitRpm}
              onChange={e=>setMiddleware({...m, rateLimitRpm:Number(e.target.value)})} className="font-mono mt-1"/>
          </div>
        </div>
      </CardContent></Card>

      <Card className="glass mt-4"><CardContent className="p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm font-mono uppercase tracking-widest">{t("mw.routing_table")}</h3>
          <Button size="sm" variant="outline"
            onClick={()=>setMiddleware({...m, proxyTargets:[...m.proxyTargets, {id:createLocalId(), path:"/api/new", target:"http://127.0.0.1:8000"}]})}>
            <Plus className="h-3.5 w-3.5 mr-1"/>Add Route
          </Button>
        </div>
        <div className="grid grid-cols-12 gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          <span className="col-span-4">Path</span><span className="col-span-7">Target</span><span></span>
        </div>
        {m.proxyTargets.map(p => (
          <div key={p.id} className="grid grid-cols-12 gap-2">
            <Input className="col-span-4 font-mono text-xs h-9" value={p.path}
              onChange={e=>setMiddleware({...m, proxyTargets:m.proxyTargets.map(x=>x.id===p.id?{...x,path:e.target.value}:x)})}/>
            <Input className="col-span-7 font-mono text-xs h-9" value={p.target}
              onChange={e=>setMiddleware({...m, proxyTargets:m.proxyTargets.map(x=>x.id===p.id?{...x,target:e.target.value}:x)})}/>
            <Button size="icon" variant="ghost" className="col-span-1 h-9 w-9 text-destructive"
              onClick={()=>setMiddleware({...m, proxyTargets:m.proxyTargets.filter(x=>x.id!==p.id)})}>
              <Minus className="h-3.5 w-3.5"/>
            </Button>
          </div>
        ))}
      </CardContent></Card>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Services Health Card — picks services defined in Settings → Services Tower,
// probes each one, shows LED + start/stop/restart + delete (remove from list).
// ---------------------------------------------------------------------------

type SvcKind = "http" | "postgres";
interface SvcDef { key: string; name: string; kind: SvcKind; url?: string }
interface SvcStatus { state: "running" | "stopped" | "restarting"; latency: number; detail?: string }

const REGISTRY_KEY = "settings.services.registry.v1";
const PICKED_KEY = "middleware.services.picked.v1";

function readRegistry(): SvcDef[] {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function readPicked(): string[] {
  try { return JSON.parse(localStorage.getItem(PICKED_KEY) ?? "[]"); } catch { return []; }
}
function writePicked(ids: string[]) {
  try { localStorage.setItem(PICKED_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

function ServicesHealthCard({ lastCheck }: { lastCheck: string }) {
  const { t } = useI18n();
  const [registry, setRegistry] = useState<SvcDef[]>(() => readRegistry());
  const [picked, setPicked] = useState<string[]>(() => readPicked());
  const [statuses, setStatuses] = useState<Record<string, SvcStatus>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Re-read registry when dropdown opens or storage changes (cross-tab).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === REGISTRY_KEY) setRegistry(readRegistry());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => { if (menuOpen) setRegistry(readRegistry()); }, [menuOpen]);

  const services = useMemo(
    () => picked.map(k => registry.find(r => r.key === k)).filter(Boolean) as SvcDef[],
    [picked, registry],
  );

  const probe = async () => {
    if (!services.length) { setStatuses({}); return; }
    try {
      const r = await SystemAPI.servicesProbe(services.map(s => ({ key: s.key, name: s.name, url: s.url, kind: s.kind })));
      const map: Record<string, SvcStatus> = {};
      for (const s of r.services) map[s.key] = { state: s.state, latency: s.latency, detail: s.detail };
      setStatuses(map);
    } catch { /* keep last */ }
  };
  useEffect(() => {
    probe();
    const id = setInterval(probe, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);

  const togglePick = (k: string) => {
    setPicked(prev => {
      const next = prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k];
      writePicked(next);
      return next;
    });
  };
  const removePick = (k: string) => {
    setPicked(prev => {
      const next = prev.filter(x => x !== k);
      writePicked(next);
      return next;
    });
  };

  const act = async (s: SvcDef, action: "start" | "stop" | "restart") => {
    setBusy(`${s.key}:${action}`);
    try {
      const r = await SystemAPI.serviceAction(s.key, action);
      toast.success(`${s.name} · ${action} · ${r.message}`);
      setStatuses(prev => ({
        ...prev,
        [s.key]: { ...(prev[s.key] || { state: "stopped", latency: 0 }), state: action === "stop" ? "stopped" : action === "restart" ? "restarting" : (prev[s.key]?.state ?? "stopped") },
      }));
      setTimeout(probe, 2000);
    } catch (e) {
      toast.error(`${s.name} ${action} failed · ${(e as Error).message}`);
    } finally { setBusy(null); }
  };

  const ledColor = (s?: SvcStatus["state"]) =>
    s === "running" ? "#22c55e" : s === "restarting" ? "#f59e0b" : "#ef4444";
  const ledLabel = (s?: SvcStatus["state"]) =>
    s === "running" ? "UP" : s === "restarting" ? "RESTART" : "DOWN";

  return (
    <Card className="glass">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold text-sm font-mono uppercase tracking-widest flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />{t("mw.health")}
          </h3>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-7 text-[10px] bg-gradient-primary text-primary-foreground">
                <Plus className="h-3 w-3 mr-1" /> Add Service
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-h-80 overflow-y-auto">
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest">
                Settings → Services Tower
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {registry.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground font-mono">
                  {t("mw.no_services")}
                </div>
              )}
              {registry.map(s => {
                const isOn = picked.includes(s.key);
                return (
                  <DropdownMenuItem
                    key={s.key}
                    onSelect={(e) => { e.preventDefault(); togglePick(s.key); }}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{s.name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">
                        {s.kind === "postgres" ? "postgres pool" : s.url}
                      </p>
                    </div>
                    {isOn && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-2">
          {services.length === 0 && (
            <p className="text-xs text-muted-foreground font-mono">
              {t("mw.list_empty")}
            </p>
          )}
          {services.map(s => {
            const st = statuses[s.key];
            return (
              <div key={s.key} className="flex items-center justify-between rounded border border-border px-3 py-2 gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                    style={{
                      background: ledColor(st?.state),
                      boxShadow: `0 0 8px ${ledColor(st?.state)}, 0 0 2px ${ledColor(st?.state)}`,
                      animation: st?.state === "restarting" ? "pulse 1s ease-in-out infinite" : undefined,
                    }}
                    title={ledLabel(st?.state)}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-mono truncate">{s.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground truncate">
                      {ledLabel(st?.state)}{st?.latency ? ` · ${st.latency}ms` : ""}{st?.detail ? ` · ${st.detail}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" disabled={busy === `${s.key}:start`} className="h-7 text-[10px]" onClick={() => act(s, "start")}>
                    <Power className="h-3 w-3 mr-1 text-emerald-500" />Start
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === `${s.key}:stop`} className="h-7 text-[10px]" onClick={() => act(s, "stop")}>
                    <Power className="h-3 w-3 mr-1 text-destructive" />Stop
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === `${s.key}:restart`} className="h-7 text-[10px]" onClick={() => act(s, "restart")}>
                    <RotateCw className="h-3 w-3 mr-1 text-amber-400" />Restart
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title={t("mw.remove_from_list")} onClick={() => removePick(s.key)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground pt-1">{t("mw.lastcheck")}: {lastCheck}</div>
      </CardContent>
    </Card>
  );
}
