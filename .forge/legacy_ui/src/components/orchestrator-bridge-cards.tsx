// Orchestrator Bridge cockpit cards — extracted into a dedicated component file
// so strict TS resolution never trips on forward references inside the
// system-engine route module. Explicit imports = zero stale-name surface.
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShieldAlert, ListChecks, Radio, Globe, Loader2, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { IntentBridgeAPI, SkillsAPI, type IntentGuardMode, type BridgeEvent } from "@/lib/api-client";

export function IntentGuardCard() {
  const { locale } = useI18n();
  const [mode, setMode] = useState<IntentGuardMode>("auto");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try { const r = await IntentBridgeAPI.getGuard(); setMode(r.mode); }
      catch { /* */ } finally { setLoading(false); }
    })();
  }, []);
  const save = async (m: IntentGuardMode) => {
    setMode(m);
    try { await IntentBridgeAPI.setGuard(m); toast.success("Intent Guard updated"); }
    catch (e) { toast.error((e as Error).message); }
  };
  const desc: Record<IntentGuardMode, string> = {
    "auto": "Automatic: execution triggers (!cmd, @[agent.py], *.py, tool_call) override bypass; smalltalk may still bypass.",
    "force-on": "Force ON: every request is treated as execution-bound; semantic/length-heuristic bypass fully disabled.",
    "force-off": "Force OFF: guard inactive, legacy semantic router behaviour (for test/debug).",
  };
  return (
    <Card className="glass border-primary/20">
      <CardHeader>
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-primary" />
          {"Intent Guard Override"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? <p className="text-xs font-mono text-muted-foreground">⏳ loading…</p> : (
          <>
            <div className="flex flex-wrap gap-2">
              {(["auto", "force-on", "force-off"] as const).map((m) => (
                <Button key={m} size="sm" variant={mode === m ? "default" : "outline"}
                  className="h-7 font-mono text-[11px]" onClick={() => save(m)}>
                  {m}
                </Button>
              ))}
            </div>
            <p className="text-[10px] font-mono text-muted-foreground">{desc[mode]}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AgentsAllowlistCard() {
  const { locale } = useI18n();
  const [list, setList] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const r = await IntentBridgeAPI.getAllowlist();
        setList((r.allowed || []).join(", "));
        setSource(r.source || "db");
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      const arr = list.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await IntentBridgeAPI.setAllowlist(arr);
      setList(r.allowed.join(", "));
      toast.success(`Sealed · ${r.allowed.length} agents`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };
  return (
    <Card className="glass border-primary/20">
      <CardHeader>
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          {"Allowed Python Agents"}
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">{source}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? <p className="text-xs font-mono text-muted-foreground">⏳ loading…</p> : (
          <>
            <Textarea
              value={list}
              onChange={(e) => setList(e.target.value)}
              className="min-h-20 font-mono text-xs"
              placeholder="researcher.py, live-internet-harvester.py, osint-runner.py"
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono text-muted-foreground">{"Comma-separated · *.py only · sealed into runtime instantly (DB + memory)."}</p>
              <Button size="sm" disabled={saving} onClick={save} className="h-7 font-mono text-[11px]">
                {saving ? "…" : "Seal"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ToolsAllowlistCard() {
  const [list, setList] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const r = await IntentBridgeAPI.getToolsAllowlist();
        setList((r.allowed || []).join(", "));
        setSource(r.source || "db");
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      const arr = list.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await IntentBridgeAPI.setToolsAllowlist(arr);
      setList(r.allowed.join(", "));
      toast.success(`Sealed · ${r.allowed.length} tools`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };
  return (
    <Card className="glass border-primary/20">
      <CardHeader>
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          {"Allowed Tools (auto-trigger)"}
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">{source}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? <p className="text-xs font-mono text-muted-foreground">⏳ loading…</p> : (
          <>
            <Textarea
              value={list}
              onChange={(e) => setList(e.target.value)}
              className="min-h-20 font-mono text-xs"
              placeholder="tool-slug-1, tool-slug-2, action-id-3"
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono text-muted-foreground">{"Comma-separated · tool slug or action_library id · empty = allow all."}</p>
              <Button size="sm" disabled={saving} onClick={save} className="h-7 font-mono text-[11px]">
                {saving ? "…" : "Seal"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DeniedToolsCard() {
  const [list, setList] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    try {
      const r = await IntentBridgeAPI.getToolsDenylist();
      setList((r.denied || []).join(", "));
      setSource(r.source || "db");
    } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    setSaving(true);
    try {
      const arr = list.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await IntentBridgeAPI.setToolsDenylist(arr);
      setList((r.denied || []).join(", "));
      toast.success(`Sealed · ${(r.denied || []).length} disarmed`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };
  return (
    <Card className="glass border-destructive/30">
      <CardHeader>
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <ShieldOff className="h-4 w-4 text-red-400" />
          {"Disarmed Tools (manual block)"}
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">{source}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? <p className="text-xs font-mono text-muted-foreground">⏳ loading…</p> : (
          <>
            <Textarea
              value={list}
              onChange={(e) => setList(e.target.value)}
              className="min-h-20 font-mono text-xs"
              placeholder="ai.summarize, mail.read, log.analyze"
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono text-muted-foreground">{"Comma-separated · syncs with Tools page Arm/Disarm shield · disarmed tools are blocked from auto-trigger."}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={saving} onClick={load} className="h-7 font-mono text-[11px]">Refresh</Button>
                <Button size="sm" disabled={saving} onClick={save} className="h-7 font-mono text-[11px]">
                  {saving ? "…" : "Seal"}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function BridgeTelemetryCard() {
  const { locale } = useI18n();
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stop = IntentBridgeAPI.streamTelemetry((e) => {
      setEvents((prev) => {
        const next = [...prev, e];
        if (next.length > 200) next.splice(0, next.length - 200);
        return next;
      });
    });
    return stop;
  }, []);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [events]);
  const fmt = (e: BridgeEvent) => {
    const parts: string[] = [];
    if (e.kind) parts.push(e.kind);
    if (e.status) parts.push(e.status);
    if (e.script) parts.push(e.script);
    if (e.mode) parts.push(`mode=${e.mode}`);
    if (e.reason) parts.push(`reason=${e.reason}`);
    if (e.route) parts.push(`route=${e.route}`);
    if (typeof e.executedCallsSize === "number") parts.push(`calls=${e.executedCallsSize}`);
    if (typeof e.latencyMs === "number") parts.push(`${e.latencyMs}ms`);
    if (typeof e.chars === "number") parts.push(`${e.chars}c`);
    if (typeof e.count === "number") parts.push(`n=${e.count}`);
    if (e.thread_id) parts.push(`thr=${String(e.thread_id).slice(0, 8)}`);
    return parts.join(" · ");
  };
  const toneFor = (e: BridgeEvent) => {
    if (e.status === "error" || e.kind === "error") return "text-destructive";
    if (e.kind === "guard") return "text-amber-300";
    if (e.kind === "allowlist") return "text-cyan-300";
    if (e.kind === "python_agent") return "text-primary";
    return "text-emerald-300/90";
  };
  return (
    <Card className="glass border-primary/20">
      <CardHeader>
        <CardTitle className="text-sm font-mono flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary animate-pulse" />
          {"Bridge Telemetry · Live Stream"}
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">{events.length}/200</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={ref} className="h-[320px] overflow-auto rounded-lg border border-border bg-black/85 p-3 font-mono text-[11px] leading-relaxed">
          {events.length === 0 ? (
            <p className="text-muted-foreground">⌁ {"Bridge silent · waiting for first event."}</p>
          ) : (
            events.map((e, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-muted-foreground/60 shrink-0">{new Date(e.ts).toISOString().slice(11, 19)}</span>
                <span className={`whitespace-pre-wrap break-all ${toneFor(e)}`}>{fmt(e)}</span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

