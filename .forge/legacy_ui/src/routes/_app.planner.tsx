// Faz 6 — Planner control surface. Toggle, mode, limits, telemetry, debug drawer.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PlannerAPI, SystemAPI, type ModelDTO, type PlannerRunRow, type PlannerSettings, type PlannerStats } from "@/lib/api-client";
import { useRbac } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Brain, Activity, RefreshCw, AlertTriangle, CheckCircle2, Clock, Wrench, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/planner")({ component: PlannerPage });

function PlannerPage() {
  const { isAdmin, allowedTabs, ready } = useRbac();
  const can = isAdmin || allowedTabs.has("planner");

  const [settings, setSettings] = useState<PlannerSettings | null>(null);
  const [stats, setStats] = useState<PlannerStats | null>(null);
  const [rows, setRows] = useState<PlannerRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState(7);
  const [models, setModels] = useState<ModelDTO[]>([]);

  const reload = async () => {
    setLoading(true);
    try {
      const [s, st, r, m] = await Promise.all([
        PlannerAPI.getSettings(),
        PlannerAPI.stats(days).catch(() => null),
        PlannerAPI.recent(50).catch(() => ({ ok: true, rows: [] as PlannerRunRow[] })),
        SystemAPI.listModels().catch(() => [] as ModelDTO[]),
      ]);
      setSettings(s);
      if (st) setStats(st.stats);
      setRows(r.rows || []);
      setModels(m || []);
    } catch (e: any) {
      toast.error(`Planner load failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (ready && can) void reload(); /* eslint-disable-next-line */ }, [ready, can, days]);

  if (!ready) return <div className="p-6 text-xs text-muted-foreground">…</div>;
  if (!can) return <div className="p-6 text-sm text-muted-foreground">You don't have permission for this tab.</div>;
  if (!settings) return <div className="p-6 text-xs text-muted-foreground">Loading planner…</div>;

  const save = async (patch: Partial<PlannerSettings>) => {
    setSaving(true);
    try {
      const upd = await PlannerAPI.saveSettings(patch);
      setSettings(upd);
      toast.success("Planner settings saved");
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-gradient-primary glow flex items-center justify-center">
            <Brain className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Planner v0</h1>
            <p className="text-xs text-muted-foreground">Tool orchestration layer · opt-in · shadow/active</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={settings.enabled ? "default" : "outline"} className="font-mono text-[10px]">
            {settings.enabled ? `ON · ${settings.mode}` : "OFF"}
          </Badge>
          <Button size="sm" variant="outline" onClick={reload} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      {settings._autoFallbackTriggered && !settings.enabled && (
        <div className="border border-amber-500/40 bg-amber-500/10 rounded p-3 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0" />
          <div className="flex-1 text-xs">
            <div className="font-semibold text-amber-200">Auto-fallback triggered</div>
            <div className="text-muted-foreground">
              The error rate over the last {settings.autoFallback.windowSize} runs exceeded the threshold ({Math.round(settings.autoFallback.errorRateThreshold * 100)}%).
              Planner was forced to <span className="font-mono">enabled=false</span> for safety ({new Date(settings._autoFallbackTriggered).toLocaleString()}).
              Investigate the cause and re-enable when ready.
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => save({ enabled: true, _autoFallbackTriggered: null } as any)}>
            Re-enable
          </Button>
        </div>
      )}

      <Tabs defaultValue="control">
        <TabsList>
          <TabsTrigger value="control">Control</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="runs">Runs ({rows.length})</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        {/* CONTROL */}
        <TabsContent value="control" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" /> Master Switch
              </CardTitle>
              <CardDescription>When the planner is off, chat behaves exactly like before. Rollback is one click.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded border">
                <div>
                  <Label className="text-sm font-medium">Planner enabled</Label>
                  <p className="text-xs text-muted-foreground">Runs a planning LLM step on every chat turn.</p>
                </div>
                <Switch checked={settings.enabled} onCheckedChange={(v) => save({ enabled: v })} disabled={saving} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded border space-y-2">
                  <Label className="text-xs">Mode</Label>
                  <Select value={settings.mode} onValueChange={(v) => save({ mode: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shadow">shadow — log only</SelectItem>
                      <SelectItem value="active">active — inject into answer</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Shadow → 0 risk, telemetry accumulates.<br/>Active → tool outputs are appended to the answer context.
                  </p>
                </div>
                <div className="p-3 rounded border space-y-2">
                  <Label className="text-xs">Max tools / turn</Label>
                  <Input type="number" min={0} max={8} value={settings.maxTools}
                    onChange={(e) => setSettings({ ...settings, maxTools: Number(e.target.value) })}
                    onBlur={() => save({ maxTools: settings.maxTools })} />
                  <p className="text-[11px] text-muted-foreground">At most N tools per turn. 0 = plan only, don't execute.</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded border space-y-1">
                  <Label className="text-xs">Tool timeout (ms)</Label>
                  <Input type="number" min={500} max={60000} value={settings.toolTimeoutMs}
                    onChange={(e) => setSettings({ ...settings, toolTimeoutMs: Number(e.target.value) })}
                    onBlur={() => save({ toolTimeoutMs: settings.toolTimeoutMs })} />
                </div>
                <div className="p-3 rounded border space-y-1">
                  <Label className="text-xs">Planner timeout (ms)</Label>
                  <Input type="number" min={500} max={20000} value={settings.plannerTimeoutMs}
                    onChange={(e) => setSettings({ ...settings, plannerTimeoutMs: Number(e.target.value) })}
                    onBlur={() => save({ plannerTimeoutMs: settings.plannerTimeoutMs })} />
                </div>
                <div className="p-3 rounded border space-y-1">
                  <Label className="text-xs">RAG bypass margin (active)</Label>
                  <Input type="number" step="0.05" min={0} max={1} value={settings.minScoreForActive}
                    onChange={(e) => setSettings({ ...settings, minScoreForActive: Number(e.target.value) })}
                    onBlur={() => save({ minScoreForActive: settings.minScoreForActive })} />
                  <p className="text-[10px] text-muted-foreground">When RAG top1 ≥ (1 − this), the planner stays out of the way.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* INSIGHTS */}
        <TabsContent value="insights" className="space-y-4">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Range:</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 24 hours</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {stats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total runs" value={stats.summary.total ?? 0} />
                <StatCard label="Shadow" value={stats.summary.shadow_runs ?? 0} />
                <StatCard label="Active" value={stats.summary.active_runs ?? 0} />
                <StatCard label="RAG hit" value={stats.summary.rag_hits ?? 0} />
                <StatCard label="With tools" value={stats.summary.with_tools ?? 0} hint="≥1 tool ran" />
                <StatCard label="Both empty" value={stats.summary.both_empty ?? 0} hint="RAG and tools empty" />
                <StatCard label="Grounded" value={stats.summary.grounded_ok ?? 0} hint="Answers backed by RAG" />
                <StatCard label="Contradictions" value={stats.summary.contradictions ?? 0} hint="Cross-check flag" />
                <StatCard label="Planner avg" value={`${stats.summary.avg_planner_ms ?? 0}ms`} />
                <StatCard label="Tools avg" value={`${stats.summary.avg_tools_ms ?? 0}ms`} />
                <StatCard label="Total avg" value={`${stats.summary.avg_latency_ms ?? 0}ms`} />
              </div>
              <Card>
                <CardHeader><CardTitle className="text-sm">Most-called tools</CardTitle></CardHeader>
                <CardContent>
                  {stats.top_tools.length ? (
                    <div className="space-y-2">
                      {stats.top_tools.map((t) => (
                        <div key={t.slug} className="flex items-center justify-between text-xs font-mono p-2 rounded border">
                          <span className="flex items-center gap-2"><Wrench className="h-3 w-3" /> {t.slug}</span>
                          <span className="text-muted-foreground">{t.calls} calls · {t.ok}/{t.calls} ok · {t.avg_ms}ms</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-muted-foreground">No data yet.</p>}
                </CardContent>
              </Card>
            </>
          ) : <p className="text-xs text-muted-foreground">No statistics.</p>}
        </TabsContent>

        {/* RUNS */}
        <TabsContent value="runs" className="space-y-2">
          {rows.length === 0 && <p className="text-xs text-muted-foreground p-4">No planner runs yet. Flip the master switch on and ask a question in chat.</p>}
          {rows.map((r) => <RunRow key={r.id} r={r} />)}
        </TabsContent>

        {/* ADVANCED */}
        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Custom planner prompt</CardTitle>
              <CardDescription>Leave blank to use the default prompt. The {`{MAX_TOOLS}`} placeholder is substituted at runtime.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea rows={10} value={settings.systemPrompt || ""}
                placeholder="Default prompt active…"
                onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })} />
              <Button size="sm" onClick={() => save({ systemPrompt: settings.systemPrompt || null })} disabled={saving}>
                Save
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Override model (optional)</CardTitle>
              <CardDescription>Use a different model for the planner step. "Default" → runtime decides.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={settings.model || "__default__"} onValueChange={(v) => save({ model: v === "__default__" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Default (runtime picks)</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.modelName || m.id}>
                      {m.modelName || m.id} <span className="text-muted-foreground">· {m.provider}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!models.length && <p className="text-[10px] text-muted-foreground">No models registered — add one from the Models tab.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Cross-check</CardTitle>
              <CardDescription>Flag runs where tool output contradicts RAG sources. Detection heuristic: numbers returned by a tool that don't appear anywhere in the RAG context are marked suspicious.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-3 rounded border">
                <Label className="text-sm">Contradiction detection enabled</Label>
                <Switch checked={settings.crossCheckEnabled} onCheckedChange={(v) => save({ crossCheckEnabled: v })} disabled={saving} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Auto-fallback (circuit breaker)</CardTitle>
              <CardDescription>
                If the error rate over the last N runs crosses the threshold, the planner turns itself off. Prevents a bad tool or planner revision from degrading answer quality.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded border">
                <Label className="text-sm">Auto-fallback enabled</Label>
                <Switch checked={settings.autoFallback.enabled}
                  onCheckedChange={(v) => save({ autoFallback: { ...settings.autoFallback, enabled: v } })}
                  disabled={saving} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Window (runs)</Label>
                  <Input type="number" min={5} max={200} value={settings.autoFallback.windowSize}
                    onChange={(e) => setSettings({ ...settings, autoFallback: { ...settings.autoFallback, windowSize: Number(e.target.value) } })}
                    onBlur={() => save({ autoFallback: settings.autoFallback })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Error threshold (0-1)</Label>
                  <Input type="number" step="0.05" min={0.05} max={1} value={settings.autoFallback.errorRateThreshold}
                    onChange={(e) => setSettings({ ...settings, autoFallback: { ...settings.autoFallback, errorRateThreshold: Number(e.target.value) } })}
                    onBlur={() => save({ autoFallback: settings.autoFallback })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Min runs</Label>
                  <Input type="number" min={3} max={100} value={settings.autoFallback.minRuns}
                    onChange={(e) => setSettings({ ...settings, autoFallback: { ...settings.autoFallback, minRuns: Number(e.target.value) } })}
                    onBlur={() => save({ autoFallback: settings.autoFallback })} />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Example: window=20, threshold=0.5 → planner shuts off if 50% of the last 20 runs failed.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: any; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold font-mono">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function RunRow({ r }: { r: PlannerRunRow }) {
  const okTools = r.tools_called.filter(t => t.ok).length;
  const failTools = r.tools_called.length - okTools;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="w-full text-left p-3 rounded border hover:bg-muted/50 transition flex items-start gap-3">
          <Badge variant={r.mode === "active" ? "default" : "outline"} className="font-mono text-[10px] shrink-0">{r.mode}</Badge>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{r.question}</div>
            <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-3 mt-1">
              <span><Clock className="h-3 w-3 inline mr-1" />{r.latency_ms ?? "-"}ms</span>
              <span><Wrench className="h-3 w-3 inline mr-1" />{okTools}✓ {failTools > 0 && <span className="text-destructive">{failTools}✗</span>}</span>
              {r.grounded && <span className="text-emerald-500"><CheckCircle2 className="h-3 w-3 inline mr-1" />grounded</span>}
              {r.contradiction && <span className="text-amber-500"><AlertTriangle className="h-3 w-3 inline mr-1" />contradiction</span>}
              <span className="ml-auto">{new Date(r.created_at).toLocaleString()}</span>
            </div>
          </div>
        </button>
      </SheetTrigger>
      <SheetContent className="w-[640px] sm:max-w-[640px] overflow-y-auto">
        <SheetHeader><SheetTitle>Planner Run · {r.id.slice(0, 8)}</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4 text-xs">
          <Section title="Question">{r.question}</Section>
          <Section title="Plan reasoning">{r.plan?.reasoning || <em>empty</em>}</Section>
          <Section title="Steps">
            <pre className="bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(r.plan?.steps || [], null, 2)}</pre>
          </Section>
          <Section title="Tool outputs">
            {r.tools_called.length === 0 && <em>no tools called</em>}
            {r.tools_called.map((t, i) => (
              <div key={i} className="border rounded p-2 mb-2">
                <div className="font-mono text-[11px] flex items-center justify-between">
                  <span>{t.slug} · {t.ms}ms</span>
                  <Badge variant={t.ok ? "default" : "destructive"} className="text-[10px]">{t.ok ? "ok" : "fail"}</Badge>
                </div>
                <pre className="mt-2 text-[10px] overflow-x-auto whitespace-pre-wrap">{t.ok ? (typeof t.output === "string" ? t.output : JSON.stringify(t.output, null, 2)) : t.error}</pre>
              </div>
            ))}
          </Section>
          <Section title="Answer preview">{r.answer_preview || <em>not recorded</em>}</Section>
          <Section title="Metrics">
            <div className="font-mono">RAG top1: {r.rag_top1 ?? "-"} · planner {r.planner_ms ?? "-"}ms · tools {r.tools_ms ?? "-"}ms · total {r.latency_ms ?? "-"}ms</div>
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{title}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
