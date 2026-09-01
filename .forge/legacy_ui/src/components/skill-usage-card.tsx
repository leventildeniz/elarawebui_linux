import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cpu, MemoryStick, Timer, Sparkles } from "lucide-react";
import { SkillsAPI, type SkillRunDetail } from "@/lib/api-client";

/**
 * Compact, provider-usage-card-styled telemetry card that summarises a
 * completed skill run (CPU peak/avg, RAM peak, duration, steps).
 * Designed to live in the chat stream right under the Seal Report.
 */
export function SkillUsageCard({ runId }: { runId: string }) {
  const [d, setD] = useState<SkillRunDetail | null>(null);
  useEffect(() => {
    let alive = true;
    SkillsAPI.getRun(runId).then(r => alive && setD(r)).catch(() => {});
    // re-poll once after 1.5s in case run finalises after report fires
    const t = setTimeout(() => SkillsAPI.getRun(runId).then(r => alive && setD(r)).catch(() => {}), 1500);
    return () => { alive = false; clearTimeout(t); };
  }, [runId]);

  if (!d) return null;
  const metrics = d.metrics ?? [];
  const cpus = metrics.map(m => m.cpu);
  const rams = metrics.map(m => m.ram_mb);
  const cpuPeak = cpus.length ? Math.max(...cpus) : 0;
  const cpuAvg = cpus.length ? cpus.reduce((a,b)=>a+b,0)/cpus.length : 0;
  const ramPeak = rams.length ? Math.max(...rams) : 0;
  const dur = d.duration_ms ?? (d.ended_at ? new Date(d.ended_at).getTime() - new Date(d.started_at).getTime() : 0);
  const stepCount = (d.steps ?? []).length;

  const tone =
    d.status === "ok" ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" :
    d.status === "error" || d.status === "rolled_back" ? "text-destructive border-destructive/30 bg-destructive/10" :
    "text-primary border-primary/30 bg-primary/10";

  return (
    <Card className="glass mt-2">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-mono uppercase tracking-widest flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-primary" />
            Skill Telemetry · !{d.skill_slug}
          </h4>
          <Badge variant="outline" className={`text-[9px] font-mono uppercase ${tone}`}>{d.status}</Badge>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Stat icon={Timer} label="duration" value={`${Math.round(dur)}ms`} />
          <Stat icon={Cpu} label="cpu peak" value={`${Math.round(cpuPeak)}%`} sub={`avg ${Math.round(cpuAvg)}%`} />
          <Stat icon={MemoryStick} label="ram peak" value={`${Math.round(ramPeak)}MB`} />
          <Stat icon={Sparkles} label="steps" value={String(stepCount)} sub={metrics.length ? `${metrics.length} samples` : ""} />
        </div>
        <Spark data={cpus} />
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Cpu; label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border rounded px-2 py-1.5 bg-muted/20">
      <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
        <Icon className="h-2.5 w-2.5" />{label}
      </div>
      <div className="text-sm font-mono font-semibold">{value}</div>
      {sub && <div className="text-[9px] font-mono text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 320, h = 24;
  const max = Math.max(1, ...data);
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6 mt-2 opacity-70">
      <polyline fill="none" stroke="hsl(var(--primary))" strokeWidth="1.4" points={points} />
    </svg>
  );
}
