// MCP Server card — configures /mcp endpoint, exposures, tokens, and audit log.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  McpAPI, type McpSettings, type McpExposure, type McpCandidate,
  type McpToken, type McpCallEntry, type McpStats,
} from "@/lib/api-client";
import { AlertCircle, Bot, Wrench, Sparkles, Trash2, Copy, RefreshCw, Play } from "lucide-react";

type Kind = "agent" | "tool" | "skill";

export function McpServerCard() {
  const [settings, setSettings] = useState<McpSettings | null>(null);
  const [stats, setStats] = useState<McpStats | null>(null);
  const [exposures, setExposures] = useState<McpExposure[]>([]);
  const [candidates, setCandidates] = useState<{ agents: McpCandidate[]; tools: McpCandidate[]; skills: McpCandidate[] }>({
    agents: [], tools: [], skills: [],
  });
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [history, setHistory] = useState<McpCallEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTokenLabel, setNewTokenLabel] = useState("");
  const [freshToken, setFreshToken] = useState<{ label: string; token: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [s, e, t, h] = await Promise.all([
        McpAPI.getSettings(), McpAPI.getExposures(), McpAPI.listTokens(), McpAPI.history(30),
      ]);
      setSettings(s.settings); setStats(s.stats);
      setExposures(e.exposures); setCandidates(e.candidates);
      setTokens(t.tokens);
      setHistory(h.history);
      setLoading(false);
    } catch (err: any) {
      toast.error("Failed to load MCP state: " + err.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const patchSettings = async (patch: Partial<McpSettings>) => {
    if (!settings) return;
    try {
      const r = await McpAPI.updateSettings(patch as any);
      setSettings(r.settings);
      toast.success("Settings updated");
    } catch (err: any) { toast.error(err.message); }
  };

  if (loading || !settings) {
    return <Card><CardContent className="p-6 text-xs font-mono text-muted-foreground">Loading MCP state…</CardContent></Card>;
  }

  const exposureMap = new Map(exposures.map((x) => [`${x.kind}:${x.slug}`, x]));
  const endpoint = `${window.location.origin.replace(/:\d+$/, ":3005")}/mcp`;

  return (
    <div className="space-y-4">
      {/* --- Server enable + endpoint --- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-sm">
            <span>MCP Server</span>
            <Badge variant={settings.enabled ? "default" : "outline"}>
              {settings.enabled ? "ONLINE" : "OFFLINE"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded border border-border/40 bg-muted/20 p-3">
            <div>
              <div className="text-xs font-mono">Enable MCP server</div>
              <div className="text-[10px] text-muted-foreground">Publish selected agents/tools/skills over the MCP protocol at <code>/mcp</code></div>
            </div>
            <Switch checked={settings.enabled} onCheckedChange={(v) => patchSettings({ enabled: v })} />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label className="text-[10px] font-mono uppercase text-muted-foreground">Auth mode</Label>
              <Select value={settings.auth_mode} onValueChange={(v) => patchSettings({ auth_mode: v as any })}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="loopback">Loopback only (127.0.0.1)</SelectItem>
                  <SelectItem value="bearer">Bearer token</SelectItem>
                  <SelectItem value="oauth">OAuth (bootstrap: token)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] font-mono uppercase text-muted-foreground">Namespace</Label>
              <Input
                className="mt-1 h-8 text-xs font-mono"
                defaultValue={settings.namespace}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== settings.namespace) patchSettings({ namespace: v }); }}
              />
            </div>
            <div>
              <Label className="text-[10px] font-mono uppercase text-muted-foreground">Rate limit (per min)</Label>
              <Input
                type="number" min={0}
                className="mt-1 h-8 text-xs font-mono"
                defaultValue={settings.rate_limit_per_min}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n !== settings.rate_limit_per_min) patchSettings({ rate_limit_per_min: n });
                }}
              />
            </div>
          </div>

          <div className="rounded border border-border/40 bg-black/20 p-3">
            <div className="mb-1 text-[10px] font-mono uppercase text-muted-foreground">Endpoint</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate text-xs">{endpoint}</code>
              <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(endpoint); toast.success("Copied"); }}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              POST JSON-RPC 2.0 · manifest: <code>{endpoint}/manifest.json</code>
            </div>
          </div>

          {stats && (
            <div className="grid grid-cols-4 gap-2 text-center">
              <StatBox label="TOTAL" value={String(stats.total)} />
              <StatBox label="ERRORS" value={String(stats.errors)} tone={stats.errors ? "warn" : undefined} />
              <StatBox label="LAST HOUR" value={String(stats.last_hour)} />
              <StatBox label="LAST CALL" value={stats.last_call ? new Date(stats.last_call).toLocaleTimeString() : "—"} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Exposures --- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-sm">
            <span>Exposures</span>
            <Button size="sm" variant="ghost" onClick={reload}><RefreshCw className="h-3 w-3" /></Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ExposureBlock
            title="Agents" icon={<Bot className="h-3.5 w-3.5" />}
            items={candidates.agents} kind="agent" exposureMap={exposureMap}
            onToggle={async (k, s, v) => {
              try { await McpAPI.toggleExposure(k, s, v); await reload(); }
              catch (e: any) { toast.error(e.message); }
            }}
          />
          <ExposureBlock
            title="Tools" icon={<Wrench className="h-3.5 w-3.5" />}
            items={candidates.tools} kind="tool" exposureMap={exposureMap}
            onToggle={async (k, s, v) => {
              try { await McpAPI.toggleExposure(k, s, v); await reload(); }
              catch (e: any) { toast.error(e.message); }
            }}
          />
          <ExposureBlock
            title="Skills" icon={<Sparkles className="h-3.5 w-3.5" />}
            items={candidates.skills} kind="skill" exposureMap={exposureMap}
            onToggle={async (k, s, v) => {
              try { await McpAPI.toggleExposure(k, s, v); await reload(); }
              catch (e: any) { toast.error(e.message); }
            }}
          />
        </CardContent>
      </Card>

      {/* --- Tokens --- */}
      {settings.auth_mode !== "loopback" && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Bearer tokens</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Token label (e.g. claude-desktop)"
                value={newTokenLabel}
                onChange={(e) => setNewTokenLabel(e.target.value)}
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                disabled={!newTokenLabel.trim()}
                onClick={async () => {
                  try {
                    const r = await McpAPI.createToken(newTokenLabel.trim());
                    setFreshToken({ label: r.label, token: r.token });
                    setNewTokenLabel("");
                    await reload();
                  } catch (e: any) { toast.error(e.message); }
                }}
              >Create</Button>
            </div>

            {freshToken && (
              <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-3">
                <div className="mb-1 flex items-center gap-2 text-[11px] font-mono uppercase text-yellow-500">
                  <AlertCircle className="h-3.5 w-3.5" /> Copy now · shown once
                </div>
                <div className="text-[10px] text-muted-foreground">Label: {freshToken.label}</div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-black/40 px-2 py-1 text-xs">{freshToken.token}</code>
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(freshToken.token); toast.success("Copied"); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setFreshToken(null)}>Dismiss</Button>
                </div>
              </div>
            )}

            <div className="space-y-1">
              {tokens.length === 0 && <div className="text-[10px] font-mono text-muted-foreground">No tokens yet.</div>}
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded border border-border/40 p-2 text-xs">
                  <div>
                    <div className="font-mono">{t.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {t.token_prefix}…  ·  created {new Date(t.created_at).toLocaleString()}
                      {t.last_used_at ? ` · last used ${new Date(t.last_used_at).toLocaleString()}` : " · never used"}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    try { await McpAPI.revokeToken(t.id); await reload(); }
                    catch (e: any) { toast.error(e.message); }
                  }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- History --- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-sm">
            <span>Audit log</span>
            <Button size="sm" variant="ghost" onClick={reload}><RefreshCw className="h-3 w-3" /></Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="text-[10px] font-mono text-muted-foreground">No calls recorded yet.</div>
          ) : (
            <div className="space-y-1">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-2 rounded border border-border/40 p-2 text-[11px] font-mono">
                  <Badge variant={h.ok ? "outline" : "destructive"} className="w-16 justify-center">
                    {h.ok ? "OK" : "ERR"}
                  </Badge>
                  <span className="w-24 text-muted-foreground">{new Date(h.ts).toLocaleTimeString()}</span>
                  <span className="w-32 truncate">{h.client_id || "—"}</span>
                  <span className="w-28 truncate">{h.method}</span>
                  <span className="flex-1 truncate">{h.tool_name || (h.error || "")}</span>
                  <span className="w-16 text-right text-muted-foreground">{h.duration_ms}ms</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={`rounded border p-2 ${tone === "warn" ? "border-red-500/40 bg-red-500/5" : "border-border/40"}`}>
      <div className="text-[9px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-mono">{value}</div>
    </div>
  );
}

function ExposureBlock({
  title, icon, items, kind, exposureMap, onToggle,
}: {
  title: string; icon: React.ReactNode; items: McpCandidate[]; kind: Kind;
  exposureMap: Map<string, McpExposure>;
  onToggle: (kind: Kind, slug: string, v: boolean) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase text-muted-foreground">
        {icon}<span>{title}</span><span className="opacity-60">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded border border-dashed border-border/40 p-3 text-[10px] font-mono text-muted-foreground">
          None discovered.
        </div>
      ) : (
        <div className="grid gap-1 md:grid-cols-2">
          {items.map((it) => {
            const exp = exposureMap.get(`${kind}:${it.slug}`);
            const enabled = exp?.enabled ?? false;
            return (
              <label
                key={it.slug}
                className="flex items-center gap-3 rounded border border-border/40 bg-muted/10 p-2 text-xs"
              >
                <Switch checked={enabled} onCheckedChange={(v) => onToggle(kind, it.slug, v)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono">{it.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{it.slug}</div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
