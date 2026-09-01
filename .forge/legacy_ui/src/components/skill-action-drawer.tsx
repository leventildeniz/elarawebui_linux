import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SkillsAPI, resolveApiBaseUrl } from "@/lib/api-client";
import { CheckCircle2, XCircle, Loader2, Cpu, MemoryStick, ShieldCheck, ShieldX, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

interface Step { i: number; total: number; label: string; ts: number; status: string; }
interface Metric { ts: number; cpu: number; ram_mb: number; }

interface State {
  status: string;
  steps: Step[];
  metrics: Metric[];
  output: unknown;
  error?: string;
  rollback_steps?: Step[];
}

interface Props {
  runId: string | null;
  onClose: () => void;
  /** Called with the completed run report markdown when the run finishes ok */
  onReport?: (md: string) => void;
}

export function SkillRunDrawer({ runId, onClose, onReport }: Props) {
  const { locale } = useI18n();
  const [state, setState] = useState<State>({ status: "queued", steps: [], metrics: [], output: null, rollback_steps: [] });
  const [skillSlug, setSkillSlug] = useState<string>("");
  const esRef = useRef<EventSource | null>(null);
  const startTs = useRef<number>(Date.now());
  const skillSlugRef = useRef<string>("");

  useEffect(() => {
    if (!runId) return;
    startTs.current = Date.now();
    setState({ status: "loading", steps: [], metrics: [], output: null, rollback_steps: [] });

    // Try to get current run row for slug
    SkillsAPI.getRun(runId).then(d => {
      setSkillSlug(d.skill_slug);
      skillSlugRef.current = d.skill_slug;
    }).catch(() => {});

    const url = `${resolveApiBaseUrl()}/api/skills/runs/${encodeURIComponent(runId)}/stream`;
    const es = new EventSource(url);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        setState((prev) => {
          const next = { ...prev };
          if (msg.type === "snapshot") {
            next.status = msg.status; next.steps = msg.steps || []; next.metrics = msg.metrics || []; next.output = msg.output;
          } else if (msg.type === "step") {
            next.steps = [...prev.steps, msg.step];
          } else if (msg.type === "rollback_step") {
            next.rollback_steps = [...(prev.rollback_steps || []), msg.step];
          } else if (msg.type === "metric") {
            next.metrics = [...prev.metrics.slice(-119), msg.metric];
          } else if (msg.type === "status") {
            next.status = msg.status;
          } else if (msg.type === "done") {
            next.status = msg.status; next.output = msg.output ?? prev.output; next.error = msg.error;
            if (msg.status === "ok" && onReport) {
              const md = renderReport(skillSlugRef.current || skillSlug || "skill", msg.output, Date.now() - startTs.current, locale);
              onReport(md);
            }
            es.close();
          } else if (msg.type === "error") {
            next.error = msg.message;
          } else if (msg.type === "approved" || msg.type === "rejected" || msg.type === "cancel_requested") {
            // ignored, status will update
          }
          return next;
        });
      } catch {}
    };
    es.onerror = () => { /* let reconnect logic of EventSource handle it */ };
    return () => { es.close(); esRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const isOpen = !!runId;
  const lastMetric = state.metrics[state.metrics.length - 1];
  const elapsed = isOpen ? Math.round((Date.now() - startTs.current) / 100) / 10 : 0;

  const isRunning = ["queued", "running", "awaiting_approval", "rolling_back"].includes(state.status);

  const handleApprove = async () => { if (runId) { await SkillsAPI.approve(runId).catch((e) => toast.error(String(e.message))); } };
  const handleReject = async () => { if (runId) { await SkillsAPI.reject(runId); onClose(); } };
  const handleCancel = async () => { if (runId) { await SkillsAPI.cancel(runId); } };

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-mono text-sm">
            <span className="text-primary">!{skillSlug || "—"}</span>
            <Badge variant="outline" className={badgeClass(state.status)}>{state.status}</Badge>
            <span className="text-[10px] text-muted-foreground ml-auto">{elapsed}s</span>
          </SheetTitle>
        </SheetHeader>

        {state.status === "awaiting_approval" && (
          <div className="border border-amber-500/30 bg-amber-500/10 rounded p-3 mt-3 space-y-2">
            <p className="text-xs">⚠ {"Awaiting approval — critical skill triggered."}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleApprove} className="bg-emerald-600 hover:bg-emerald-700"><ShieldCheck className="h-3 w-3 mr-1" />{"Approve"}</Button>
              <Button size="sm" variant="outline" onClick={handleReject}><ShieldX className="h-3 w-3 mr-1" />{"Reject"}</Button>
            </div>
          </div>
        )}

        {/* Steps */}
        <div className="mt-4">
          <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1">{"Steps"}</div>
          <ol className="space-y-1">
            {state.steps.map((s, idx) => (
              <li key={idx} className="flex items-center gap-2 text-xs font-mono">
                {idx === state.steps.length - 1 && isRunning
                  ? <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  : <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                <span className="text-muted-foreground">{s.i}/{s.total}</span>
                <span className="truncate">{englishStepLabel(s.label)}</span>
              </li>
            ))}
            {state.steps.length === 0 && <li className="text-[11px] text-muted-foreground italic">{"Pending…"}</li>}
          </ol>
        </div>

        {state.rollback_steps && state.rollback_steps.length > 0 && (
          <div className="mt-3 border border-destructive/30 rounded p-2">
            <div className="text-[10px] uppercase font-mono text-destructive mb-1">Rollback</div>
            <ol className="space-y-1">
              {state.rollback_steps.map((s, idx) => (
                <li key={idx} className="flex items-center gap-2 text-xs font-mono">
                  <XCircle className="h-3 w-3 text-destructive" />
                  <span>{englishStepLabel(s.label)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Metrics */}
        <div className="mt-4 space-y-2">
          <div className="text-[10px] uppercase font-mono text-muted-foreground">Resource (M5 Max scoped)</div>
          <MetricBar icon={Cpu} label="CPU" value={lastMetric?.cpu ?? 0} max={100} unit="%" />
          <MetricBar icon={MemoryStick} label="RAM" value={lastMetric?.ram_mb ?? 0} max={Math.max(1024, (lastMetric?.ram_mb ?? 0) * 1.5)} unit="MB" />
          <Sparkline data={state.metrics.map(m => m.cpu)} />
        </div>

        {/* Diagnostics — only when output.debug.stages exists */}
        <DiagnosticsTable output={state.output} />

        {/* Output */}
        {state.output != null && (
          <div className="mt-4">
            <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1">Run Report</div>
            <pre className="bg-muted/30 rounded p-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap">{JSON.stringify(state.output, null, 2)}</pre>
          </div>
        )}
        {state.error && (
          <div className="mt-3 text-[11px] text-destructive font-mono">{state.error}</div>
        )}

        <div className="mt-4 flex gap-2">
          {isRunning && state.status !== "awaiting_approval" && (
            <Button size="sm" variant="outline" onClick={handleCancel}>Cancel</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} className="ml-auto"><X className="h-3 w-3 mr-1" />Close</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DiagnosticsTable({ output }: { output: unknown }) {
  if (!output || typeof output !== "object") return null;
  const dbg = (output as { debug?: { stages?: Array<Record<string, unknown>> } }).debug;
  const stages = dbg?.stages;
  if (!Array.isArray(stages) || stages.length === 0) return null;
  const rowClass = (s: Record<string, unknown>) => {
    if (s.error) return "text-destructive";
    if (typeof s.hits === "number" && (s.hits as number) > 0) return "text-emerald-400";
    if (s.ok === true) return "text-emerald-400";
    if (s.skipped) return "text-muted-foreground";
    return "text-amber-300";
  };
  const detail = (s: Record<string, unknown>) => {
    if (s.error) return `error: ${String(s.error).slice(0, 80)}`;
    if (typeof s.hits === "number") return `hits: ${s.hits}${s.status ? ` · ${s.status}` : ""}`;
    if (s.skipped) return `skipped: ${s.skipped}`;
    if (s.ok === true) return "ok";
    if (s.status) return `status: ${s.status}`;
    const { name: _n, ...rest } = s;
    return JSON.stringify(rest).slice(0, 80);
  };
  return (
    <div className="mt-4">
      <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1">Diagnostics</div>
      <div className="border border-border/40 rounded overflow-hidden">
        {stages.map((s, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1 text-[11px] font-mono border-b border-border/30 last:border-0">
            <span className="truncate flex-1">{String(s.name || `stage-${i + 1}`)}</span>
            <span className={`truncate text-right ${rowClass(s)}`}>{detail(s)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function badgeClass(status: string) {
  if (status === "ok") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "error" || status === "rolled_back" || status === "cancelled") return "bg-destructive/15 text-destructive border-destructive/30";
  if (status === "awaiting_approval") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-primary/15 text-primary border-primary/30";
}

function englishStepLabel(label: string) {
  const normalized = String(label || "").trim();
  const labels: Record<string, string> = {
    "Niyet çözümleniyor": "Resolving intent",
    "Kaynak köprüsü kuruluyor": "Bridging sources",
    "Hasat ediliyor": "Harvesting",
    "Mühürleniyor": "Sealing",
  };
  return labels[normalized] || normalized;
}

function MetricBar({ icon: Icon, label, value, max, unit }: { icon: typeof Cpu; label: string; value: number; max: number; unit: string; }) {
  const pct = Math.min(100, max ? (value / max) * 100 : 0);
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono">
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="w-8 text-muted-foreground">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
        <div className="h-full bg-gradient-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right">{Math.round(value)}{unit}</span>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 280, h = 32;
  const max = Math.max(1, ...data);
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8 opacity-70">
      <polyline fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" points={points} />
    </svg>
  );
}

type HarvesterResult = { pair?: string; rate?: number; asof?: string; source?: string; summary?: string; city?: string; temperature_c?: number; title?: string; url?: string | null };

function renderReport(slug: string, output: unknown, durationMs: number, _locale: "tr" | "en" = "en"): string {
  void _locale;
  const header = `**🛡 Run Report — !${slug}** _(${Math.round(durationMs)}ms)_`;
  const isObj = output && typeof output === "object";
  const obj = isObj ? (output as { summary?: string; results?: HarvesterResult[]; kind?: string }) : null;
  const lines: string[] = [];

  if (obj && Array.isArray(obj.results) && obj.results.length > 0) {
    for (const r of obj.results.slice(0, 5)) {
      if (r.pair && r.rate != null) {
        lines.push(`• ${r.pair} · ${r.rate.toLocaleString("en-US", { maximumFractionDigits: 4 })}${r.asof ? ` (${r.asof})` : ""}${r.source ? ` — ${r.source}` : ""}`);
      } else if (r.city && r.temperature_c != null) {
        lines.push(`• ${r.city} · ${r.temperature_c}°C${r.summary ? ` — ${r.summary}` : ""}`);
      } else if (r.title || r.summary) {
        const link = r.url ? ` [↗](${r.url})` : "";
        lines.push(`• ${r.title || "—"}${r.summary ? ` — ${r.summary.slice(0, 160)}` : ""}${link}`);
      }
    }
  } else if (obj?.summary) {
    lines.push(`• ${obj.summary}`);
  }

  if (lines.length === 0) {
    // Unknown shape — keep chat readable and leave raw proof in the drawer.
    const compact = output == null ? "Completed without output." : summarizeUnknownOutput(output);
    return [header, `• ${compact}`].join("\n");
  }

  return [
    header,
    ...lines,
  ].join("\n");
}

export function summarizeUnknownOutput(output: unknown) {
  if (typeof output === "string") return output.slice(0, 240);
  if (typeof output === "number" || typeof output === "boolean") return String(output);
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    if (typeof obj.summary === "string") return obj.summary.slice(0, 240);
    if (typeof obj.status === "string") return `status: ${obj.status}`;
    if (typeof obj.kind === "string") return `${obj.kind} completed.`;
    return "Completed. Raw output is available in the Run Report drawer.";
  }
  return "Completed.";
}
