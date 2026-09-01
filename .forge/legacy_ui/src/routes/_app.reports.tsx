import { createFileRoute } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FileDown, BarChart3, CalendarIcon, Plus, Trash2, Mail, ShieldAlert, RefreshCw, Sparkles, Settings2, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { format, differenceInDays } from "date-fns";
import { LogsAPI, MetricsAPI, ProvidersAPI, type AgentLog, type MetricsFrame, type ProviderUsageResponse } from "@/lib/api-client";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend,
} from "recharts";
import { useSecurity } from "@/lib/security-store";
import { useSystem, type ReportSchedule } from "@/lib/system-store";
import { useAuth } from "@/lib/auth";
import { loadEvents } from "@/lib/safety";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { drawHeader, drawFooter, drawKpiCards, drawLineChart, drawBarChart, drawPieChart, REPORT_PALETTE } from "@/lib/pdf-report";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_app/reports")({ component: ReportsPage });

const COLORS = ["#7c3aed", "#06b6d4", "#f59e0b", "#ef4444", "#10b981"];

type ReportPoint = { day: string; cpu: number; ram: number; gpu: number; latency: number; success: number; tokens: number; sessions: number };

function ReportsPage() {
  const { t } = useI18n();
  const { brand, rbac } = useAuth();
  const sec = useSecurity();
  const { schedules, setSchedules } = useSystem();

  const [scope, setScope] = useState<"system"|"users"|"audit"|"providers">("system");
  const [from, setFrom] = useState<Date>(() => { const d = new Date(); d.setDate(d.getDate()-6); return d; });
  const [to, setTo]     = useState<Date>(new Date());
  const [userFilter, setUserFilter] = useState<string>("__all__");
  const [groupFilter, setGroupFilter] = useState<string>("__all__");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditLevel, setAuditLevel] = useState<string>("__all__");
  const [auditAgent, setAuditAgent] = useState<string>("__all__");
  const [serverLogs, setServerLogs] = useState<AgentLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const refreshLogs = async () => {
    setLogsLoading(true);
    try {
      const r = await LogsAPI.list({ limit: 500 });
      setServerLogs(Array.isArray(r) ? r : []);
    } catch { /* offline → fallback to local audit only */ }
    finally { setLogsLoading(false); }
  };
  useEffect(() => { if (scope === "audit") void refreshLogs(); }, [scope]);

  // ---- provider usage
  const [provHours, setProvHours] = useState(24);
  const [providerUsage, setProviderUsage] = useState<ProviderUsageResponse | null>(null);
  const refreshUsage = async () => {
    try { setProviderUsage(await ProvidersAPI.usage(provHours, "hour")); } catch { /* offline */ }
  };
  useEffect(() => { if (scope === "providers") { void refreshUsage(); const id = setInterval(refreshUsage, 15000); return () => clearInterval(id); } }, [scope, provHours]);

  const allUsers = useMemo(() => Array.from(new Set(sec.audit.map(a => a.user))).filter(Boolean), [sec.audit]);
  const allGroups = useMemo(() => Array.from(new Set(rbac.map(r => r.role))), [rbac]);

  const filteredAudit = useMemo(() => sec.audit.filter(a =>
    (userFilter === "__all__" || a.user === userFilter) &&
    (groupFilter === "__all__" || rbac.some(r => r.match.toLowerCase() === a.user.toLowerCase() && r.role === groupFilter))
  ), [sec.audit, userFilter, groupFilter, rbac]);

  // Live metrics buffer — accumulates samples while page is open so the
  // chart shows real CPU/RAM/GPU/latency instead of hardcoded zeros.
  // Hydrate from server-side ring buffer so charts are populated immediately.
  const [frames, setFrames] = useState<MetricsFrame[]>([]);
  useEffect(() => {
    let cancelled = false;
    void MetricsAPI.history(10).then((hist) => {
      if (!cancelled && hist.length) setFrames((p) => (p.length ? p : hist.slice(-119)));
    });
    const unsub = MetricsAPI.subscribe((f) => setFrames((p) => [...p.slice(-119), f]));
    return () => { cancelled = true; unsub(); };
  }, []);

  // Provider count for the Providers tab header (configured vs. used)
  const [providerCount, setProviderCount] = useState<number>(0);
  useEffect(() => {
    if (scope !== "providers") return;
    void ProvidersAPI.list().then((rows) => setProviderCount(Array.isArray(rows) ? rows.length : 0)).catch(() => {});
  }, [scope]);

  const days = Math.max(1, differenceInDays(to, from) + 1);
  const data = useMemo<ReportPoint[]>(() => {
    if (frames.length === 0) {
      return Array.from({ length: days }).map((_, i) => ({
        day: `T-${days - i}`, cpu: 0, ram: 0, gpu: 0, latency: 0, success: 100, tokens: 0, sessions: 0,
      }));
    }
    // Bucket the live frames into ~24 slots so the chart is readable.
    const slots = Math.min(24, frames.length);
    const size = Math.ceil(frames.length / slots);
    const out: ReportPoint[] = [];
    for (let i = 0; i < slots; i++) {
      const slice = frames.slice(i * size, (i + 1) * size);
      if (!slice.length) continue;
      const a = (k: keyof MetricsFrame) => slice.reduce((s, f) => s + (Number(f[k]) || 0), 0) / slice.length;
      out.push({
        day: new Date(slice[slice.length - 1].ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        cpu: Math.round(a("cpu")), ram: Math.round(a("ram")), gpu: Math.round(a("gpu")),
        latency: Math.round(a("latency")), success: 100,
        tokens: Math.round(slice.reduce((s, f) => s + (f.tps || 0), 0)),
        sessions: slice.reduce((s, f) => s + (f.queue || 0), 0),
      });
    }
    return out;
  }, [frames, days]);
  const ref = useRef<HTMLDivElement>(null);

  const guardEvts = loadEvents();
  const guardDist = [
    { name: "Input Blocked",   value: guardEvts.filter(e => e.direction === "input").length },
    { name: "Output Redacted", value: guardEvts.filter(e => e.direction === "output").length },
  ];
  const auditByUser = Object.entries(
    filteredAudit.reduce<Record<string, number>>((acc, a) => { acc[a.user] = (acc[a.user] ?? 0) + 1; return acc; }, {}),
  ).map(([user, count]) => ({ user, count }));

  // ---- merged audit (local sec.audit + server agent_logs) ----
  type Row = { ts: string; actor: string; action: string; level: string; meta?: string; source: "local"|"server" };
  const mergedAudit: Row[] = useMemo(() => {
    const local: Row[] = sec.audit.map(a => ({
      ts: a.ts, actor: a.user, action: a.action,
      level: a.result === "ok" ? "info" : a.result === "deny" ? "warn" : "error",
      meta: a.meta, source: "local" as const,
    }));
    const remote: Row[] = serverLogs.map(l => ({
      ts: l.created_at ?? new Date().toISOString(),
      actor: l.agent, action: l.message, level: l.level,
      meta: l.meta ? (typeof l.meta === "string" ? l.meta : JSON.stringify(l.meta)) : undefined,
      source: "server" as const,
    }));
    const fromMs = from.getTime(); const toMs = to.getTime() + 86400000;
    return [...local, ...remote]
      .filter(r => { const t = new Date(r.ts).getTime(); return t >= fromMs && t <= toMs; })
      .filter(r => auditLevel === "__all__" || r.level === auditLevel)
      .filter(r => auditAgent === "__all__" || r.actor === auditAgent)
      .filter(r => !auditQuery || `${r.actor} ${r.action} ${r.meta ?? ""}`.toLowerCase().includes(auditQuery.toLowerCase()))
      .sort((a,b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  }, [sec.audit, serverLogs, from, to, auditLevel, auditAgent, auditQuery]);
  const auditActors = useMemo(() => Array.from(new Set([...sec.audit.map(a=>a.user), ...serverLogs.map(l=>l.agent)])), [sec.audit, serverLogs]);

  const exportPdf = async () => {
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4", compress: true });
    const W = pdf.internal.pageSize.getWidth();
    const scopeLabel = scope === "system" ? "System" : scope === "users" ? "User" : scope === "audit" ? "Audit Logs" : "Provider Token Usage";
    drawHeader(pdf, {
      brand: brand.name || "AI OS",
      scope: scopeLabel,
      from: format(from, "yyyy-MM-dd"),
      to: format(to, "yyyy-MM-dd"),
    });

    if (scope === "providers") {
      const totals = providerUsage?.totals ?? [];
      const sumTok = totals.reduce((s, r) => s + r.total_tokens, 0);
      const sumCalls = totals.reduce((s, r) => s + r.calls, 0);
      const sumPrompt = totals.reduce((s, r) => s + r.prompt_tokens, 0);
      const sumResp = totals.reduce((s, r) => s + r.response_tokens, 0);
      let cy = drawKpiCards(pdf, 100, [
        { label: "Total Tokens", value: sumTok.toLocaleString() },
        { label: "Prompt Tokens", value: sumPrompt.toLocaleString() },
        { label: "Response Tokens", value: sumResp.toLocaleString() },
        { label: "API Calls", value: String(sumCalls) },
      ]);
      cy += 4;
      drawPieChart(pdf, {
        x: 40, y: cy, w: W - 80, h: 220,
        title: "Provider Token Distribution",
        slices: totals.map((r) => ({ name: r.providerName, value: r.total_tokens })),
      });
      cy += 232;
      autoTable(pdf, {
        startY: cy,
        head: [["Provider", "Kind", "Prompt", "Response", "Total", "Calls", "Avg Lat"]],
        body: totals.map((r) => [
          r.providerName, r.kind, r.prompt_tokens.toLocaleString(),
          r.response_tokens.toLocaleString(), r.total_tokens.toLocaleString(),
          String(r.calls), `${Math.round(r.avg_latency || 0)}ms`,
        ]),
        foot: [[
          "TOTAL", "",
          sumPrompt.toLocaleString(), sumResp.toLocaleString(), sumTok.toLocaleString(),
          String(sumCalls), "",
        ]],
        headStyles: { fillColor: REPORT_PALETTE.primary },
        footStyles: { fillColor: REPORT_PALETTE.ink, textColor: 255 },
        styles: { fontSize: 9 },
        margin: { bottom: 40 },
      });
    } else if (scope === "audit") {
      autoTable(pdf, {
        startY: 100,
        head: [["Timestamp", "Actor", "Level", "Action", "Source", "Meta"]],
        body: mergedAudit.map((r) => [
          new Date(r.ts).toLocaleString(), r.actor, r.level.toUpperCase(),
          r.action, r.source, r.meta ?? "—",
        ]),
        headStyles: { fillColor: REPORT_PALETTE.primary },
        styles: { fontSize: 8, cellWidth: "wrap" },
        columnStyles: { 3: { cellWidth: 180 }, 5: { cellWidth: 120 } },
        margin: { bottom: 40 },
      });
    } else {
      // system / users — fully vector charts
      const isSystem = scope === "system";
      const kpis = isSystem
        ? [
            { label: "Avg CPU", value: `${avg(data, "cpu")}%` },
            { label: "Avg RAM", value: `${avg(data, "ram")}%` },
            { label: "Avg GPU", value: `${avg(data, "gpu")}%` },
            { label: "Avg Latency", value: `${avg(data, "latency")}ms` },
          ]
        : [
            { label: "Sessions", value: `${sum(data, "sessions")}` },
            { label: "Users", value: `${auditByUser.length}` },
            { label: "Tokens", value: `${sum(data, "tokens").toLocaleString()}` },
            { label: "Avg Latency", value: `${avg(data, "latency")}ms` },
          ];
      let cy = drawKpiCards(pdf, 100, kpis);
      cy += 4;
      drawLineChart(pdf, {
        x: 40, y: cy, w: W - 80, h: 200,
        title: isSystem ? "System Health · M5 MAX (128GB)" : "User Activity Trend",
        data, xKey: "day",
        series: isSystem
          ? [
              { key: "cpu", label: "CPU %", color: REPORT_PALETTE.primary },
              { key: "ram", label: "RAM %", color: REPORT_PALETTE.cyan },
              { key: "gpu", label: "GPU %", color: REPORT_PALETTE.amber },
            ]
          : [
              { key: "sessions", label: "Sessions", color: REPORT_PALETTE.primary },
              { key: "tokens", label: "Tokens", color: REPORT_PALETTE.cyan },
            ],
      });
      cy += 212;
      const halfW = (W - 80 - 12) / 2;
      drawBarChart(pdf, {
        x: 40, y: cy, w: halfW, h: 180,
        title: "Latency & Success",
        data, xKey: "day",
        series: [
          { key: "latency", label: "Latency", color: REPORT_PALETTE.red },
          { key: "success", label: "Success", color: REPORT_PALETTE.green },
        ],
      });
      drawPieChart(pdf, {
        x: 40 + halfW + 12, y: cy, w: halfW, h: 180,
        title: "GenGuard Distribution",
        slices: guardDist.map((g) => ({ name: g.name, value: g.value })),
      });
      cy += 192;

      if (scope === "users") {
        if (cy > pdf.internal.pageSize.getHeight() - 220) { pdf.addPage(); cy = 60; }
        drawBarChart(pdf, {
          x: 40, y: cy, w: W - 80, h: 180,
          title: "Audit by User",
          data: auditByUser.length ? auditByUser : [{ user: "-", count: 0 }],
          xKey: "user",
          series: [{ key: "count", label: "Audit events", color: REPORT_PALETTE.primary }],
        });
        pdf.addPage();
        autoTable(pdf, {
          startY: 60,
          head: [["Timestamp", "User", "Action", "Result", "Meta"]],
          body: filteredAudit.slice(0, 50).map((a) => [
            new Date(a.ts).toLocaleString(), a.user, a.action, a.result, a.meta ?? "—",
          ]),
          headStyles: { fillColor: REPORT_PALETTE.primary },
          styles: { fontSize: 8 },
          margin: { bottom: 40 },
        });
      }
    }

    drawFooter(pdf, brand.name || "AI OS");
    pdf.save(`${(brand.name||"report").replace(/\s+/g,"_")}_${scope}_${format(from,"yyyyMMdd")}-${format(to,"yyyyMMdd")}.pdf`);
    toast.success("PDF downloaded");
  };

  // ---- scheduler
  const [schedOpen, setSchedOpen] = useState(false);
  const [draft, setDraft] = useState<ReportSchedule>({
    id: "", name: "", scope: "system", cadence: "daily", email: "", enabled: true,
  });
  const openSched = () => { setDraft({ id: `sch-${Date.now()}`, name: "", scope: "system", cadence: "daily", email: "", enabled: true }); setSchedOpen(true); };
  const saveSched = () => {
    if (!draft.name || !draft.email) { toast.error("Name and email required"); return; }
    setSchedules([draft, ...schedules]); setSchedOpen(false); toast.success("Schedule created");
  };
  const removeSched = (id: string) => setSchedules(schedules.filter(s=>s.id!==id));

  return (
    <PageShell>
      <PageHeader title={t("page.reports.title")}
        subtitle={t("page.reports.subtitle")}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Tabs value={scope} onValueChange={v=>setScope(v as typeof scope)}>
              <TabsList className="h-9">
                <TabsTrigger value="system">{t("rep.tab_system")}</TabsTrigger>
                <TabsTrigger value="users">{t("rep.tab_users")}</TabsTrigger>
                <TabsTrigger value="audit"><ShieldAlert className="h-3.5 w-3.5 mr-1"/>{t("rep.tab_audit")}</TabsTrigger>
                <TabsTrigger value="providers"><Sparkles className="h-3.5 w-3.5 mr-1"/>{t("rep.tab_providers")}</TabsTrigger>
              </TabsList>
            </Tabs>
            <DateBtn label="From" date={from} on={setFrom}/>
            <DateBtn label="To"   date={to}   on={setTo}/>
            {scope === "users" && (
              <>
                <Select value={userFilter} onValueChange={setUserFilter}>
                  <SelectTrigger className="h-9 w-36 text-xs"><SelectValue placeholder={t("common.user")}/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("common.all_users")}</SelectItem>
                    {allUsers.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={groupFilter} onValueChange={setGroupFilter}>
                  <SelectTrigger className="h-9 w-36 text-xs"><SelectValue placeholder={t("common.group")}/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("common.all_groups")}</SelectItem>
                    {allGroups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            )}
            <Button onClick={exportPdf} className="bg-gradient-primary text-primary-foreground">
              <FileDown className="h-4 w-4 mr-1"/>Generate PDF
            </Button>
          </div>
        }
      />

      {scope === "audit" ? (
        <Card className="glass">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-mono uppercase tracking-widest flex items-center gap-2 mr-auto">
                <ShieldAlert className="h-4 w-4 text-primary"/>Audit Logs
                <Badge variant="outline" className="font-mono text-[9px] ml-2">{mergedAudit.length} rows</Badge>
              </h3>
              <Input value={auditQuery} onChange={e=>setAuditQuery(e.target.value)}
                placeholder={t("rep.search_ph")} className="h-9 w-64 text-xs"/>
              <Select value={auditLevel} onValueChange={setAuditLevel}>
                <SelectTrigger className="h-9 w-32 text-xs"><SelectValue placeholder={t("common.level")}/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("common.all_levels")}</SelectItem>
                  <SelectItem value="info">info</SelectItem>
                  <SelectItem value="warn">warn</SelectItem>
                  <SelectItem value="error">error</SelectItem>
                  <SelectItem value="debug">debug</SelectItem>
                </SelectContent>
              </Select>
              <Select value={auditAgent} onValueChange={setAuditAgent}>
                <SelectTrigger className="h-9 w-40 text-xs"><SelectValue placeholder={t("common.actor")}/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("common.all_actors")}</SelectItem>
                  {auditActors.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-9" onClick={refreshLogs} disabled={logsLoading}>
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1", logsLoading && "animate-spin")}/>Refresh
              </Button>
            </div>

            <div className="border border-border rounded overflow-hidden">
              <div className="grid grid-cols-[160px_120px_70px_1fr_70px] gap-2 px-3 py-2 bg-muted/30 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                <span>{t("common.timestamp")}</span><span>{t("common.actor")}</span><span>{t("common.level")}</span><span>{t("common.action")}</span><span>{t("common.source")}</span>
              </div>
              <div className="max-h-[520px] overflow-auto">
                {mergedAudit.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-4">No audit entries in this range.</p>
                ) : mergedAudit.map((r, i) => (
                  <div key={i} className="grid grid-cols-[160px_120px_70px_1fr_70px] gap-2 px-3 py-2 border-t border-border text-[11px] font-mono items-start">
                    <span className="text-muted-foreground">{new Date(r.ts).toLocaleString()}</span>
                    <span className="truncate">{r.actor}</span>
                    <Badge variant="outline" className={cn("text-[9px] w-fit",
                      r.level === "error" && "border-destructive text-destructive",
                      r.level === "warn"  && "border-amber-500 text-amber-500",
                      r.level === "info"  && "border-primary text-primary",
                    )}>{r.level}</Badge>
                    <span className="break-words">
                      {r.action}
                      {r.meta && <span className="text-muted-foreground"> · {r.meta}</span>}
                    </span>
                    <Badge variant="outline" className="text-[9px] w-fit">{r.source}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : scope === "providers" ? (
        <ProvidersUsageView usage={providerUsage} hours={provHours} setHours={setProvHours} refresh={refreshUsage} providerCount={providerCount}/>
      ) : (
      <div ref={ref} className="space-y-4 bg-background p-4 rounded">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(scope === "system" ? [
            ["Avg CPU", `${avg(data,"cpu")}%`],
            ["Avg RAM", `${avg(data,"ram")}%`],
            ["Avg GPU", `${avg(data,"gpu")}%`],
            ["Avg Latency", `${avg(data,"latency")}ms`],
          ] : [
            ["Sessions",   `${sum(data,"sessions")}`],
            ["Users",      `${auditByUser.length}`],
            ["Tokens",     `${sum(data,"tokens").toLocaleString()}`],
            ["Avg Latency",`${avg(data,"latency")}ms`],
          ]).map(([l,v]) => (
            <Card key={l} className="glass"><CardContent className="p-4">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{l}</p>
              <p className="text-2xl font-bold text-primary mt-1">{v}</p>
            </CardContent></Card>
          ))}
        </div>

        <Card className="glass"><CardContent className="p-4">
          <h3 className="text-sm font-mono uppercase tracking-widest mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary"/>
            {scope === "system" ? "System Health · M5 MAX (128GB)" : "User Activity Trend"}
          </h3>
          <div style={{height:260}}>
            {frames.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground font-mono italic">
                Streaming metrics… keep this page open to accumulate samples.
              </div>
            ) : (
              <ResponsiveContainer><LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={10}/>
                <YAxis stroke="var(--muted-foreground)" fontSize={10}/>
                <Tooltip contentStyle={{background:"var(--card)",border:"1px solid var(--border)"}}/>
                <Legend/>
                {scope === "system" ? <>
                  <Line type="monotone" dataKey="cpu" stroke={COLORS[0]} strokeWidth={2} dot={false}/>
                  <Line type="monotone" dataKey="ram" stroke={COLORS[1]} strokeWidth={2} dot={false}/>
                  <Line type="monotone" dataKey="gpu" stroke={COLORS[2]} strokeWidth={2} dot={false}/>
                </> : <>
                  <Line type="monotone" dataKey="sessions" stroke={COLORS[0]} strokeWidth={2} dot={false}/>
                  <Line type="monotone" dataKey="tokens"   stroke={COLORS[1]} strokeWidth={2} dot={false}/>
                </>}
              </LineChart></ResponsiveContainer>
            )}
          </div>
        </CardContent></Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="glass"><CardContent className="p-4">
            <h3 className="text-sm font-mono uppercase tracking-widest mb-3">{t("rep.latency_success")}</h3>
            <div style={{height:240}}>
              <ResponsiveContainer><BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={10}/>
                <YAxis stroke="var(--muted-foreground)" fontSize={10}/>
                <Tooltip contentStyle={{background:"var(--card)",border:"1px solid var(--border)"}}/>
                <Legend/><Bar dataKey="latency" fill={COLORS[3]}/><Bar dataKey="success" fill={COLORS[4]}/>
              </BarChart></ResponsiveContainer>
            </div>
          </CardContent></Card>

          <Card className="glass"><CardContent className="p-4">
            <h3 className="text-sm font-mono uppercase tracking-widest mb-3">{t("rep.genguard_dist")}</h3>
            <div style={{height:240}}>
              {guardDist.every(g => g.value === 0) ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground font-mono italic">
                  No GenGuard events recorded in this range.
                </div>
              ) : (
                <ResponsiveContainer><PieChart>
                  <Pie data={guardDist} dataKey="value" nameKey="name" outerRadius={80} label>
                    {guardDist.map((_,i)=> <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                  </Pie><Tooltip/><Legend/>
                </PieChart></ResponsiveContainer>
              )}
            </div>
          </CardContent></Card>
        </div>

        {scope === "users" && (
          <Card className="glass"><CardContent className="p-4">
            <h3 className="text-sm font-mono uppercase tracking-widest mb-3">{t("rep.audit_by_user")}</h3>
            <div style={{height:240}}>
              <ResponsiveContainer><BarChart data={auditByUser.length?auditByUser:[{user:"-",count:0}]}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                <XAxis dataKey="user" stroke="var(--muted-foreground)" fontSize={10}/>
                <YAxis stroke="var(--muted-foreground)" fontSize={10}/>
                <Tooltip contentStyle={{background:"var(--card)",border:"1px solid var(--border)"}}/>
                <Bar dataKey="count" fill={COLORS[0]}/>
              </BarChart></ResponsiveContainer>
            </div>
          </CardContent></Card>
        )}
      </div>
      )}

      {/* ---------------- SCHEDULES ---------------- */}
      <Card className="glass mt-6"><CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm font-mono uppercase tracking-widest flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary"/>Scheduled Reports
          </h3>
          <Dialog open={schedOpen} onOpenChange={setSchedOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-gradient-primary text-primary-foreground" onClick={openSched}>
                <Plus className="h-3.5 w-3.5 mr-1"/>New Schedule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t("rep.schedule_email")}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>{t("rep.schedule_name")}</Label>
                  <Input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} className="mt-1"/></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Scope</Label>
                    <Select value={draft.scope} onValueChange={v=>setDraft({...draft,scope:v as ReportSchedule["scope"]})}>
                      <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="system">System</SelectItem>
                        <SelectItem value="users">Users</SelectItem>
                        <SelectItem value="audit">{t("rep.tab_audit")}</SelectItem>
                      </SelectContent>
                    </Select></div>
                  <div><Label>Cadence</Label>
                    <Select value={draft.cadence} onValueChange={v=>setDraft({...draft,cadence:v as ReportSchedule["cadence"]})}>
                      <SelectTrigger className="mt-1"><SelectValue/></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                      </SelectContent>
                    </Select></div>
                </div>
                <div><Label>Recipient Email(s)</Label>
                  <Input value={draft.email} onChange={e=>setDraft({...draft,email:e.target.value})} placeholder="ops@example.com, soc@example.com" className="mt-1 font-mono"/></div>
              </div>
              <DialogFooter><Button onClick={saveSched} className="bg-gradient-primary text-primary-foreground">Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {schedules.length === 0 ? (
          <p className="text-xs text-muted-foreground">No schedules yet.</p>
        ) : schedules.map(s => (
          <div key={s.id} className="border border-border rounded p-3 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium">{s.name}</p>
              <p className="text-[10px] font-mono text-muted-foreground">
                {s.scope} · {s.cadence} · {s.email}
              </p>
            </div>
            <Switch checked={s.enabled}
              onCheckedChange={v=>setSchedules(schedules.map(x=>x.id===s.id?{...x,enabled:v}:x))}/>
            <Badge variant="outline" className="font-mono text-[9px]">{s.enabled?"active":"paused"}</Badge>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={()=>removeSched(s.id)}>
              <Trash2 className="h-3.5 w-3.5"/>
            </Button>
          </div>
        ))}
      </CardContent></Card>
    </PageShell>
  );
}

function DateBtn({ label, date, on }: { label: string; date: Date; on: (d: Date)=>void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("h-9 font-mono text-xs", !date && "text-muted-foreground")}>
          <CalendarIcon className="h-3.5 w-3.5 mr-1"/>{label}: {format(date, "yyyy-MM-dd")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={(d)=> d && on(d)} initialFocus className={cn("p-3 pointer-events-auto")}/>
      </PopoverContent>
    </Popover>
  );
}

function avg<T extends Record<string, number | unknown>>(rows: T[], k: keyof T) {
  if (!rows.length) return 0;
  return Math.round(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0) / rows.length);
}
function sum<T extends Record<string, number | unknown>>(rows: T[], k: keyof T) {
  return rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
}

function ProvidersUsageView({ usage, hours, setHours, refresh, providerCount }: {
  usage: ProviderUsageResponse | null; hours: number;
  setHours: (h: number)=>void; refresh: ()=>void; providerCount: number;
}) {
  const totals = usage?.totals ?? [];
  const totalTokens = totals.reduce((s,r)=>s+r.total_tokens, 0);
  const totalCalls = totals.reduce((s,r)=>s+r.calls, 0);
  const totalPrompt = totals.reduce((s,r)=>s+r.prompt_tokens, 0);
  const totalResp = totals.reduce((s,r)=>s+r.response_tokens, 0);
  const pieData = totals.map(r => ({ name: r.providerName, value: r.total_tokens }));
  const maxTok = Math.max(1, ...totals.map(r => r.total_tokens));

  const pingAll = async () => {
    try {
      const list = await ProvidersAPI.list();
      if (!list.length) { toast.error("No providers configured. Add one in Models first."); return; }
      toast.message(`Pinging ${list.length} provider${list.length === 1 ? "" : "s"}…`);
      await Promise.allSettled(list.map(p => ProvidersAPI.ping(p.id)));
      refresh();
      toast.success("Ping complete");
    } catch (e) {
      toast.error(`Ping failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="font-mono text-[10px]">
          <Sparkles className="h-3 w-3 mr-1 text-primary"/>
          {providerCount} provider{providerCount === 1 ? "" : "s"} configured
        </Badge>
        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
          <Link to="/models"><Settings2 className="h-3.5 w-3.5 mr-1"/>Manage providers</Link>
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={pingAll} disabled={providerCount === 0}>
          <Zap className="h-3.5 w-3.5 mr-1"/>Send test ping
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Total Tokens", totalTokens.toLocaleString()],
          ["Prompt Tokens", totalPrompt.toLocaleString()],
          ["Response Tokens", totalResp.toLocaleString()],
          ["API Calls", String(totalCalls)],
        ].map(([l,v]) => (
          <Card key={l} className="glass"><CardContent className="p-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{l}</p>
            <p className="text-2xl font-bold text-primary mt-1">{v}</p>
          </CardContent></Card>
        ))}
      </div>

      <Card className="glass"><CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary"/>External Provider Token Distribution
          </h3>
          <div className="flex items-center gap-2">
            <Select value={String(hours)} onValueChange={v=>setHours(Number(v))}>
              <SelectTrigger className="h-9 w-32 text-xs"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 1h</SelectItem>
                <SelectItem value="24">Last 24h</SelectItem>
                <SelectItem value="168">Last 7 days</SelectItem>
                <SelectItem value="720">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-9" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5 mr-1"/>Refresh
            </Button>
          </div>
        </div>
        {totals.length === 0 ? (
          <div className="p-6 text-center font-mono space-y-3">
            <p className="text-xs text-muted-foreground">
              No provider calls recorded in this window.
            </p>
            <p className="text-[10px] text-muted-foreground">
              {providerCount === 0
                ? "Configure Remote, Remote, Tavily or Serper to start collecting usage."
                : "Run a chat or send a test ping to populate this view."}
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                <Link to="/models"><Settings2 className="h-3.5 w-3.5 mr-1"/>Configure a provider</Link>
              </Button>
              <Button size="sm" className="h-8 text-xs bg-gradient-primary text-primary-foreground" onClick={pingAll} disabled={providerCount === 0}>
                <Zap className="h-3.5 w-3.5 mr-1"/>Send test ping
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div style={{height:280}}>
              <ResponsiveContainer><PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={100} label>
                  {pieData.map((_,i)=> <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                </Pie><Tooltip/><Legend/>
              </PieChart></ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {totals.map((r,i) => (
                <div key={i} className="border border-border rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-primary">{r.providerName}</span>
                    <Badge variant="outline" className="text-[9px] uppercase">{r.kind}</Badge>
                  </div>
                  <div className="h-2 bg-muted/30 rounded overflow-hidden">
                    <div className="h-full bg-gradient-primary" style={{ width: `${(r.total_tokens/maxTok)*100}%` }}/>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-2">
                    <span>{r.prompt_tokens.toLocaleString()} prompt</span>
                    <span>{r.response_tokens.toLocaleString()} response</span>
                    <span className="text-primary">{r.total_tokens.toLocaleString()} total · {r.calls} calls</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent></Card>

      <Card className="glass"><CardContent className="p-0">
        <div className="grid grid-cols-[1.4fr_70px_1fr_1fr_1fr_70px_90px] gap-2 px-3 py-2 bg-muted/30 text-[10px] font-mono uppercase tracking-widest text-muted-foreground border-b border-border">
          <span>Provider</span><span>Kind</span><span>Prompt</span><span>Response</span><span>Total</span><span>Calls</span><span>Avg Lat</span>
        </div>
        {totals.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4 font-mono">No data.</p>
        ) : totals.map((r,i)=>(
          <div key={i} className="grid grid-cols-[1.4fr_70px_1fr_1fr_1fr_70px_90px] gap-2 px-3 py-2 border-t border-border text-[11px] font-mono">
            <span className="text-primary">{r.providerName}</span>
            <Badge variant="outline" className="text-[9px] w-fit uppercase">{r.kind}</Badge>
            <span>{r.prompt_tokens.toLocaleString()}</span>
            <span>{r.response_tokens.toLocaleString()}</span>
            <span className="font-bold">{r.total_tokens.toLocaleString()}</span>
            <span>{r.calls}</span>
            <span>{Math.round(r.avg_latency || 0)}ms</span>
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}
