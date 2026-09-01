// =============================================================================
// Runtime Safety Net — cockpit for legacy 72B-era protection layers.
// All knobs are visible in the UI but default OFF. Operator turns them on
// only when needed. State persists via /api/rag/settings (DatabaseAPI);
// server applies live (LOCALQueue, agent priority, transport reset, keepwarm).
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ShieldAlert, Flame, Timer, Layers, Sparkles, RotateCcw } from "lucide-react";
import { DatabaseAPI } from "@/lib/api-client";
import { toast } from "sonner";

type SettingsResp = Awaited<ReturnType<typeof DatabaseAPI.ragSettings>>;
type Settings = SettingsResp["settings"];

type Preset = {
  id: "small-fast" | "balanced" | "big-72b-legacy";
  label: string;
  blurb: string;
  patch: Record<string, number | boolean>;
};

const PRESETS: Preset[] = [
  {
    id: "small-fast",
    label: "Small / Fast (default)",
    blurb: "Gemma4-31B-q6 · all protection layers OFF · agent shares chat priority.",
    patch: {
      LOCALBootWarmup: false,
      LOCALColdWarmupOnDemand: false,
      LOCALKeepwarmEnabled: false,
      LOCALSelfHealEnabled: false,
      runtimeWatchdogEnabled: false,
      LOCALPreflightResetEnabled: false,
      agentQueueBehindChat: false,
      LOCALQueueConcurrency: 2,
      httpSocketTimeoutMs: 75_000,
      LOCALStreamTotalMs: 60_000,
      LOCALQueueWaitMs: 30_000,
      LOCALColdFirstTokenMs: 60_000,
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    blurb: "Cold warmup + self-heal ON; medium budgets · agent still equal to chat.",
    patch: {
      LOCALBootWarmup: false,
      LOCALColdWarmupOnDemand: true,
      LOCALKeepwarmEnabled: false,
      LOCALSelfHealEnabled: true,
      runtimeWatchdogEnabled: false,
      LOCALPreflightResetEnabled: false,
      agentQueueBehindChat: false,
      LOCALQueueConcurrency: 2,
      httpSocketTimeoutMs: 120_000,
      LOCALStreamTotalMs: 90_000,
      LOCALQueueWaitMs: 45_000,
      LOCALColdFirstTokenMs: 90_000,
    },
  },
  {
    id: "big-72b-legacy",
    label: "Big-Model (72B legacy)",
    blurb: "Legacy 72B behavior: all warmups ON · keepwarm pinger · agent behind chat · 3-min budgets.",
    patch: {
      LOCALBootWarmup: true,
      LOCALColdWarmupOnDemand: true,
      LOCALKeepwarmEnabled: true,
      LOCALKeepwarmIntervalMs: 45_000,
      LOCALSelfHealEnabled: true,
      runtimeWatchdogEnabled: true,
      LOCALPreflightResetEnabled: true,
      agentQueueBehindChat: true,
      LOCALQueueConcurrency: 1,
      httpSocketTimeoutMs: 180_000,
      LOCALStreamTotalMs: 120_000,
      LOCALQueueWaitMs: 90_000,
      LOCALColdFirstTokenMs: 120_000,
    },
  },
];

function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant="outline" className={`text-[10px] font-mono ${active ? "border-orange-500/60 text-orange-400" : "border-muted-foreground/40 text-muted-foreground"}`}>
      {active ? "ACTIVE" : "OFF"}
    </Badge>
  );
}

function SwitchRow({
  label, caption, value, onChange, icon,
}: {
  label: string; caption: string; value: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-background/30 p-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {icon}
          <Label className="text-xs font-semibold">{label}</Label>
          <StatusBadge active={value} />
        </div>
        <p className="mt-1 text-[10px] font-mono text-muted-foreground leading-relaxed">{caption}</p>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function NumberRow({
  label, caption, value, min, max, step, onCommit, suffix = "ms",
}: {
  label: string; caption: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void; suffix?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  return (
    <div className="space-y-1 rounded-md border border-border/40 bg-background/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-semibold">{label}</Label>
        <div className="flex items-center gap-1">
          <Input
            type="number" min={min} max={max} step={step} value={local}
            onChange={(e) => setLocal(Number(e.target.value))}
            onBlur={() => onCommit(clamp(local))}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="w-24 h-7 font-mono text-[11px] text-center"
          />
          <span className="text-[10px] font-mono text-muted-foreground w-6">{suffix}</span>
        </div>
      </div>
      <Slider min={min} max={max} step={step} value={[local]}
        onValueChange={([v]) => setLocal(v)}
        onValueCommit={([v]) => onCommit(clamp(v))} />
      <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">{caption}</p>
    </div>
  );
}

export function RuntimeSafetyNet() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await DatabaseAPI.ragSettings();
      setSettings(r.settings as Settings);
    } catch (e) {
      toast.error("Failed to load Runtime Safety: " + (e as Error).message);
    }
  };
  useEffect(() => { void load(); }, []);

  const patch = async (p: Partial<Record<string, number | boolean | string>>) => {
    if (busy) return;
    setBusy(true);
    try {
      await DatabaseAPI.saveRagSettings(p);
      await load();
      toast.success("Runtime Safety updated");
    } catch (e) {
      toast.error("Update failed: " + (e as Error).message);
    } finally { setBusy(false); }
  };

  const s = settings as (Settings & {
    LOCALBootWarmup?: boolean; LOCALColdWarmupOnDemand?: boolean; LOCALKeepwarmEnabled?: boolean;
    LOCALKeepwarmIntervalMs?: number; LOCALSelfHealEnabled?: boolean; runtimeWatchdogEnabled?: boolean;
    LOCALPreflightResetEnabled?: boolean; agentQueueBehindChat?: boolean; LOCALQueueConcurrency?: number;
    httpSocketTimeoutMs?: number; LOCALStreamTotalMs?: number; LOCALQueueWaitMs?: number;
    LOCALColdFirstTokenMs?: number; LOCALWarmCacheTtlMs?: number;
  }) | null;

  const activeCount = useMemo(() => {
    if (!s) return 0;
    return [s.LOCALBootWarmup, s.LOCALColdWarmupOnDemand, s.LOCALKeepwarmEnabled,
            s.LOCALSelfHealEnabled, s.runtimeWatchdogEnabled, s.LOCALPreflightResetEnabled,
            s.agentQueueBehindChat].filter(Boolean).length;
  }, [s]);

  if (!s) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      {/* Preset selector */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Presets
            <Badge variant="outline" className="ml-auto text-[10px]">{activeCount} active guards</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            The model is now small (Gemma4-31B-q6 · M5 Max 128GB). The warmup / keepwarm / self-heal / tight-budget
            layers built for the 72B model now act as a brake. Every knob below is <b>visible in the UI but OFF by default</b>;
            enable them via a preset or one switch at a time when needed.
          </p>
          <div className="grid gap-2 md:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => patch(p.patch)}
                className="text-left rounded-md border border-border/60 hover:border-primary/60 hover:bg-primary/5 transition p-2.5 disabled:opacity-50"
              >
                <div className="text-xs font-semibold">{p.label}</div>
                <div className="text-[10px] font-mono text-muted-foreground mt-1 leading-snug">{p.blurb}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Warmup & keep-warm */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Flame className="h-4 w-4 text-orange-400" />Warmup & Keep-Warm</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <SwitchRow
            label="Boot warmup" icon={<Flame className="h-3.5 w-3.5" />}
            caption="Sends a first request to LOCAL on server boot to keep weights hot. Unnecessary on 31B-q6 — the model is ready on its own in 1-2s."
            value={!!s.LOCALBootWarmup}
            onChange={(v) => patch({ LOCALBootWarmup: v })}
          />
          <SwitchRow
            label="On-demand cold warmup"
            caption="If LOCAL has been idle, triggers a background warmup at chat start and shows a 'Model waking up' notice. Rarely needed on small models."
            value={!!s.LOCALColdWarmupOnDemand}
            onChange={(v) => patch({ LOCALColdWarmupOnDemand: v })}
          />
          <SwitchRow
            label="Keep-warm pinger"
            caption="Pings the model periodically to keep it hot. Adds hidden load on the queue; keeping this OFF is fastest on small models."
            value={!!s.LOCALKeepwarmEnabled}
            onChange={(v) => patch({ LOCALKeepwarmEnabled: v })}
          />
          {s.LOCALKeepwarmEnabled && (
            <NumberRow
              label="Keep-warm interval" caption="Idle threshold between two pings. Lower = more frequent pings, higher load."
              value={Number(s.LOCALKeepwarmIntervalMs ?? 45000)} min={15000} max={600000} step={5000}
              onCommit={(v) => patch({ LOCALKeepwarmIntervalMs: v })}
            />
          )}
          <NumberRow
            label="Warm-cache TTL" caption="If the last successful first-token is within this window, LOCAL is treated as 'warm'. After that, the cold path kicks in."
            value={Number(s.LOCALWarmCacheTtlMs ?? 600000)} min={60000} max={3600000} step={30000}
            onCommit={(v) => patch({ LOCALWarmCacheTtlMs: v })}
          />
        </CardContent>
      </Card>

      {/* Timeout budgets */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Timer className="h-4 w-4 text-cyan-400" />Timeout Budgets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[10px] font-mono text-muted-foreground">
            Hierarchy: <b>HTTP socket &gt; LOCAL stream total &gt; LOCAL queue wait</b>. 72B needed 180s+; 31B is fine with 60-75s.
          </p>
          <NumberRow
            label="HTTP socket timeout"
            caption="Node HTTP socket idle timeout (upper bound). Must be greater than LOCAL stream total or you get BrokenPipe."
            value={Number(s.httpSocketTimeoutMs ?? 75000)} min={30000} max={600000} step={5000}
            onCommit={(v) => patch({ httpSocketTimeoutMs: v })}
          />
          <NumberRow
            label="LOCAL stream total"
            caption="Total streamFromLocalLLM stream budget. Must be smaller than HTTP socket and larger than queue wait."
            value={Number(s.LOCALStreamTotalMs ?? 60000)} min={30000} max={600000} step={5000}
            onCommit={(v) => patch({ LOCALStreamTotalMs: v })}
          />
          <NumberRow
            label="LOCAL queue wait"
            caption="Maximum time a chat-lane request waits in the queue. If exceeded, the request times out."
            value={Number(s.LOCALQueueWaitMs ?? 30000)} min={5000} max={300000} step={5000}
            onCommit={(v) => patch({ LOCALQueueWaitMs: v })}
          />
          <NumberRow
            label="Cold first-token cap"
            caption="First-token budget while LOCAL is cold. Warm requests use the cockpit watchdog floor (60s)."
            value={Number(s.LOCALColdFirstTokenMs ?? 60000)} min={30000} max={300000} step={5000}
            onCommit={(v) => patch({ LOCALColdFirstTokenMs: v })}
          />
        </CardContent>
      </Card>

      {/* Queue & self-heal */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Layers className="h-4 w-4 text-purple-400" />Queue & Self-Heal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <NumberRow
            label="LOCAL queue concurrency" suffix="slot"
            caption="How many LOCAL streams can run at once. 72B required 1; 31B-q6 + 128GB RAM handles 2 comfortably."
            value={Number(s.LOCALQueueConcurrency ?? 2)} min={1} max={4} step={1}
            onCommit={(v) => patch({ LOCALQueueConcurrency: v })}
          />
          <SwitchRow
            label="Run agent behind chat"
            caption="ON: agent runs at AGENT_LOW priority, after chat. OFF (default): agent shares chat priority — no waiting."
            value={!!s.agentQueueBehindChat}
            onChange={(v) => patch({ agentQueueBehindChat: v })}
          />
          <Separator className="my-2" />
          <SwitchRow
            label="LOCAL self-heal" icon={<ShieldAlert className="h-3.5 w-3.5" />}
            caption="Restarts LOCAL automatically after a first-token timeout. Timeouts are rare on 31B; keeping this OFF and restarting manually is safer."
            value={!!s.LOCALSelfHealEnabled}
            onChange={(v) => patch({ LOCALSelfHealEnabled: v })}
          />
          <SwitchRow
            label="Runtime watchdog"
            caption="High-level watchdog: measures queue/transport health and suggests actions. OFF by default — the UI snapshot is already visible."
            value={!!s.runtimeWatchdogEnabled}
            onChange={(v) => patch({ runtimeWatchdogEnabled: v })}
          />
          <SwitchRow
            label="Preflight reset (LOCAL_RESET_URL)"
            caption="Posts to LOCAL_RESET_URL before the cold path. Only meaningful when the LOCAL_RESET_URL env var is set."
            value={!!s.LOCALPreflightResetEnabled}
            onChange={(v) => patch({ LOCALPreflightResetEnabled: v })}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => load()} disabled={busy}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" />Refresh
        </Button>
      </div>
    </div>
  );
}
