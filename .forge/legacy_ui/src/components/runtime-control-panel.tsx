// Runtime Control Panel — Settings → Runtime tab.
// Tek mercii: chat hot-path knobları + watchdog + worker self-heal + manual
// restart. Backend hatları:
//   - GET/POST /api/rag/settings    → RAG_SETTINGS (warmup, self-heal, watchdog enable, history, dispatch)
//   - GET/POST /api/engine/watchdog → RUNTIME_WATCHDOG_CFG + workerSelfHeal
//   - POST     /api/system/restart-LOCAL → manuel local runtime restart
//
// Hiçbir default değiştirmez; yalnız mevcut RAG_SETTINGS/watchdog hatlarını
// kullanıcı yüzeyine taşır. /system-engine ve /knowledge'taki eski kartlar
// hâlâ çalışır; bu panel "tek mercii" rolünü üstlenir.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Activity, RotateCw, AlertTriangle } from "lucide-react";
import { resolveApiBaseUrl, actorHeaders } from "@/lib/api-client";
import { toast } from "sonner";

type RuntimeKnobs = {
  // chat hot-path
  userAgentMentionDispatch: boolean;
  skipOuterLlmOnAgentRewrite: boolean;
  streamAgentExec: boolean;
  LOCALHistoryKeep: number;
  preRagDeadlineMs: number;
  ragProbeDeadlineMs: number;
  // warmup / self-heal / watchdog
  LOCALBootWarmup: boolean;
  LOCALColdWarmupOnDemand: boolean;
  runtimeWatchdogEnabled: boolean;
  LOCALSelfHealEnabled: boolean;
};

type WatchdogTimers = {
  headersMs: number;
  firstTokenMs: number;
  idleDeltaMs: number;
  warmingNoticeMs: number;
  coldFirstTokenMs: number;
  streamTimeoutMs: number;
  warmupTimeoutMs: number;
};

type WorkerSelfHeal = { cooldownMs: number; respawnMax: number };

const DEFAULT_KNOBS: RuntimeKnobs = {
  userAgentMentionDispatch: false,
  skipOuterLlmOnAgentRewrite: true,
  streamAgentExec: true,
  LOCALHistoryKeep: 4,
  preRagDeadlineMs: 4000,
  ragProbeDeadlineMs: 3000,
  LOCALBootWarmup: false,
  LOCALColdWarmupOnDemand: false,
  runtimeWatchdogEnabled: false,
  LOCALSelfHealEnabled: false,
};

export function RuntimeControlPanel() {
  const base = resolveApiBaseUrl();
  const [knobs, setKnobs] = useState<RuntimeKnobs>(DEFAULT_KNOBS);
  const [timers, setTimers] = useState<WatchdogTimers | null>(null);
  const [floors, setFloors] = useState<WatchdogTimers | null>(null);
  const [selfHeal, setSelfHeal] = useState<WorkerSelfHeal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);

  // Initial fetch — RAG_SETTINGS + watchdog cfg in parallel.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ragRes, wdRes] = await Promise.all([
          fetch(`${base}/api/rag/settings`, { headers: actorHeaders() }).then((r) => r.json()),
          fetch(`${base}/api/engine/watchdog`, { headers: actorHeaders() }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        const s = ragRes?.settings || {};
        setKnobs({
          userAgentMentionDispatch: !!s.userAgentMentionDispatch,
          skipOuterLlmOnAgentRewrite: s.skipOuterLlmOnAgentRewrite !== false,
          streamAgentExec: s.streamAgentExec !== false,
          LOCALHistoryKeep: Number.isFinite(Number(s.LOCALHistoryKeep)) ? Number(s.LOCALHistoryKeep) : 4,
          preRagDeadlineMs: Number.isFinite(Number(s.preRagDeadlineMs)) ? Number(s.preRagDeadlineMs) : 4000,
          ragProbeDeadlineMs: Number.isFinite(Number(s.ragProbeDeadlineMs)) ? Number(s.ragProbeDeadlineMs) : 3000,
          LOCALBootWarmup: !!s.LOCALBootWarmup,
          LOCALColdWarmupOnDemand: !!s.LOCALColdWarmupOnDemand,
          runtimeWatchdogEnabled: !!s.runtimeWatchdogEnabled,
          LOCALSelfHealEnabled: !!s.LOCALSelfHealEnabled,
        });
        if (wdRes?.config) setTimers(wdRes.config);
        if (wdRes?.floors) setFloors(wdRes.floors);
        if (wdRes?.workerSelfHeal) setSelfHeal(wdRes.workerSelfHeal);
      } catch (e) {
        toast.error(`Runtime panel: hydrate failed · ${(e as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [base]);

  const saveKnobs = async (patch: Partial<RuntimeKnobs>) => {
    const next = { ...knobs, ...patch };
    setKnobs(next);
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/rag/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...actorHeaders() },
        body: JSON.stringify(patch),
      }).then((x) => x.json());
      if (r?.ok === false) throw new Error(r?.error === "auth_required" ? "Session expired — please re-login" : r?.error || "save failed");
      toast.success("Runtime knob saved");
    } catch (e) {
      toast.error(`Save failed · ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveTimers = async (patch: Partial<WatchdogTimers>) => {
    if (!timers) return;
    const next = { ...timers, ...patch };
    setTimers(next);
    setBusy(true);
    try {
      const r = await fetch(`${base}/api/engine/watchdog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...actorHeaders() },
        body: JSON.stringify(patch),
      }).then((x) => x.json());
      if (r?.ok === false) throw new Error(r?.error === "auth_required" ? "Session expired — please re-login" : r?.error || "save failed");
      if (r?.config) setTimers(r.config);
      toast.success("Watchdog timeout saved");
    } catch (e) {
      toast.error(`Watchdog save failed · ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const restartRuntime = async () => {
    if (!window.confirm("Restart local runtime (port )? Active chats will be cancelled.")) return;
    setRestartBusy(true);
    try {
      const r = await fetch(`${base}/api/system/restart-LOCAL`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...actorHeaders() },
        body: JSON.stringify({ reason: "manual_settings_runtime", automatic: false }),
      }).then((x) => x.json());
      if (r?.ok === false) throw new Error(r?.error === "auth_required" ? "Session expired — please re-login" : r?.error || "restart failed");
      toast.success(`Runtime restarted · killed=${r?.killed ?? "?"} · back=${r?.back ?? "?"}`);
    } catch (e) {
      toast.error(`Restart failed · ${(e as Error).message}`);
    } finally {
      setRestartBusy(false);
    }
  };

  const allOff = useMemo(() =>
    !knobs.LOCALBootWarmup &&
    !knobs.LOCALColdWarmupOnDemand &&
    !knobs.runtimeWatchdogEnabled &&
    !knobs.LOCALSelfHealEnabled,
  [knobs]);

  if (loading) {
    return <p className="text-xs font-mono text-muted-foreground">⏳ runtime loading…</p>;
  }

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <Card className="glass border-primary/30">
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Local Runtime — Single Source of Truth
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] font-mono text-muted-foreground">
            All warmup, watchdog, self-heal and chat hot-path knobs live here. Defaults are OFF —
            turn things on one at a time so we can see who slows the chat down.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={allOff ? "default" : "outline"} className="font-mono text-[10px]">
              {allOff ? "MINIMAL MODE · all guards off" : "CUSTOM · guards partially on"}
            </Badge>
            <Button size="sm" variant="outline" onClick={restartRuntime} disabled={restartBusy} className="ml-auto h-8 font-mono text-[11px]">
              <RotateCw className={`h-3 w-3 mr-1 ${restartBusy ? "animate-spin" : ""}`} />
              {restartBusy ? "Restarting…" : "Restart Runtime"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Warmup / Self-heal / Watchdog enables */}
      <Card className="glass">
        <CardHeader><CardTitle className="text-sm font-mono">Warmup & Self-Heal</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            label="Boot warmup"
            hint="At middleware boot, send a 1-token probe to wake the model. Default OFF — boot is fast, first chat pays the wake cost."
            checked={knobs.LOCALBootWarmup}
            onChange={(v) => saveKnobs({ LOCALBootWarmup: v })}
            disabled={busy}
          />
          <ToggleRow
            label="Cold warmup on demand"
            hint="Before each chat, if runtime looks cold, send a wake probe. Default OFF to protect unified memory on big models."
            checked={knobs.LOCALColdWarmupOnDemand}
            onChange={(v) => saveKnobs({ LOCALColdWarmupOnDemand: v })}
            disabled={busy}
          />
          <ToggleRow
            label="Zombie self-heal"
            hint="When a first-token timeout fires, auto-restart port . Default OFF — use the manual Restart Runtime button above."
            checked={knobs.LOCALSelfHealEnabled}
            onChange={(v) => saveKnobs({ LOCALSelfHealEnabled: v })}
            disabled={busy}
          />
          <ToggleRow
            label="Runtime watchdog"
            hint="Header / first-token / idle-delta timers. OFF = only client AbortController. Turn on if you want hard timeouts."
            checked={knobs.runtimeWatchdogEnabled}
            onChange={(v) => saveKnobs({ runtimeWatchdogEnabled: v })}
            disabled={busy}
          />
        </CardContent>
      </Card>

      {/* Watchdog timeouts — disabled grayed when watchdog OFF */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            Watchdog Timeouts
            {!knobs.runtimeWatchdogEnabled && (
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                disabled — turn on Runtime Watchdog above
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {timers ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["headersMs","firstTokenMs","idleDeltaMs","warmingNoticeMs","coldFirstTokenMs","streamTimeoutMs","warmupTimeoutMs"] as const).map((k) => (
                <NumberRow
                  key={k}
                  label={k}
                  value={timers[k]}
                  floor={floors?.[k]}
                  disabled={busy || !knobs.runtimeWatchdogEnabled}
                  onCommit={(v) => saveTimers({ [k]: v } as Partial<WatchdogTimers>)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs font-mono text-muted-foreground">⏳ loading…</p>
          )}
        </CardContent>
      </Card>

      {/* Chat hot-path */}
      <Card className="glass">
        <CardHeader><CardTitle className="text-sm font-mono">Chat Hot Path</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            label="Skip outer LLM on agent rewrite"
            hint="When a `@[script.py]` agent dispatch is detected, skip the outer chat LOCAL answer. Default ON — kills double responses."
            checked={knobs.skipOuterLlmOnAgentRewrite}
            onChange={(v) => saveKnobs({ skipOuterLlmOnAgentRewrite: v })}
            disabled={busy}
          />
          <ToggleRow
            label="User @mention → agent dispatch"
            hint='When the user writes `@[script.py]` in chat, the backend stream/orchestrate hattı detects it and spawns the agent (agent RAG runs independently of model RAG). Default ON. Turn OFF only to let the mention fall through to the outer LOCAL.'
            checked={knobs.userAgentMentionDispatch}
            onChange={(v) => saveKnobs({ userAgentMentionDispatch: v })}
            disabled={busy}
          />
          <ToggleRow
            label="Stream agent stdout"
            hint="Pipe Python agent stdout chunks to chat instead of buffering until exit. Default ON."
            checked={knobs.streamAgentExec}
            onChange={(v) => saveKnobs({ streamAgentExec: v })}
            disabled={busy}
          />
          <NumberRow
            label="History keep (turns)"
            value={knobs.LOCALHistoryKeep}
            floor={2}
            disabled={busy}
            onCommit={(v) => saveKnobs({ LOCALHistoryKeep: Math.max(2, Math.min(40, Math.floor(v))) })}
            hint="Truncate messages sent to runtime to the last N user/assistant turns + system. Smaller = lighter KV cache."
          />
          <NumberRow
            label="Pre-RAG deadline (ms)"
            value={knobs.preRagDeadlineMs}
            floor={1500}
            disabled={busy}
            onCommit={(v) => saveKnobs({ preRagDeadlineMs: Math.max(1500, Math.min(15000, Math.floor(v))) })}
            hint="Hard cap on pre-LOCAL pipeline (intent + probe + denoise). Timeout → free-answer fallback."
          />
          <NumberRow
            label="RAG probe deadline (ms)"
            value={knobs.ragProbeDeadlineMs}
            floor={1500}
            disabled={busy}
            onCommit={(v) => saveKnobs({ ragProbeDeadlineMs: Math.max(1500, Math.min(8000, Math.floor(v))) })}
            hint="Hard cap on the RAG probe step alone. Lower = chat falls through faster when retrieval is slow."
          />
        </CardContent>
      </Card>

      {/* Worker self-heal — read-only summary, advanced cockpit stays in /system-engine */}
      {selfHeal && (
        <Card className="glass">
          <CardHeader><CardTitle className="text-sm font-mono">Embedding Worker Self-Heal</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[11px] font-mono text-muted-foreground">
              Cooldown {Math.round(selfHeal.cooldownMs / 1000)}s · respawn cap {selfHeal.respawnMax}/hour.
              Detailed cockpit lives in System Engine.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="glass border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4">
          <div className="flex gap-3 text-[11px] font-mono">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-muted-foreground">
              Backend file names still say <span className="text-foreground">LOCAL</span>; this is the
              local accelerated runtime (LOCAL on Apple Silicon today, swappable tomorrow). UI labels
              use the generic <span className="text-foreground">Runtime</span> wording so nothing in
              the product implies an LOCAL-only architecture.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/40 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-mono">{label}</p>
        {hint && <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function NumberRow({ label, value, floor, disabled, onCommit, hint }: {
  label: string; value: number; floor?: number; disabled?: boolean; onCommit: (v: number) => void; hint?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span>{label}</span>
        {floor != null && <span className="text-muted-foreground text-[10px]">floor {floor}</span>}
      </div>
      <Input
        type="number"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const n = Number(draft); if (Number.isFinite(n) && n !== value) onCommit(n); else setDraft(String(value)); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-8 font-mono text-xs"
      />
      {hint && <p className="text-[10px] font-mono text-muted-foreground">{hint}</p>}
    </div>
  );
}
