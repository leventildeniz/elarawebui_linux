// MCP Client card — connect Elara to external MCP servers as a client.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Radio, RefreshCw, Trash2, Play, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Lock, Plus, ExternalLink,
} from "lucide-react";
import { McpClientAPI, type McpClientServer, type McpClientCreateInput } from "@/lib/api-client";

export function McpClientCard() {
  const [servers, setServers] = useState<McpClientServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const r = await McpClientAPI.list();
      setServers(r.servers || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleProbe = async (id: string) => {
    try {
      const r = await McpClientAPI.probe(id);
      if (r.probe.ok) toast.success(`Probed: ${r.probe.tools?.length ?? 0} tools discovered`);
      else toast.error(`Probe failed: ${r.probe.reason || "unknown"}`);
      await reload();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleToggle = async (id: string, field: "enabled" | "auto_inject", value: boolean) => {
    try {
      await McpClientAPI.update(id, { [field]: value } as Partial<McpClientCreateInput & { enabled: boolean }>);
      await reload();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete MCP server "${name}"?`)) return;
    try {
      await McpClientAPI.remove(id);
      toast.success("Server removed");
      await reload();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" /> MCP Client
            <Badge variant="outline" className="ml-2 text-[10px] font-mono">
              {servers.length} server{servers.length === 1 ? "" : "s"}
            </Badge>
          </span>
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="mr-1 h-3 w-3" /> Add Server
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] font-mono text-muted-foreground">
          Connect the AI model to external MCP servers (Claude Desktop tools, Cursor MCPs, custom SDK servers).
          Enable <strong>Auto-inject</strong> to make a server's tools available to agents as{" "}
          <code className="text-primary">mcp:&lt;slug&gt;.&lt;tool&gt;</code>.
        </p>

        {showAdd && (
          <AddServerForm
            onCancel={() => setShowAdd(false)}
            onCreated={async () => { setShowAdd(false); await reload(); }}
          />
        )}

        {loading ? (
          <p className="text-xs font-mono text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-xs font-mono text-destructive">Failed to load: {error}</p>
        ) : servers.length === 0 ? (
          <p className="text-xs font-mono text-muted-foreground">
            No remote MCP servers configured yet. Click <strong>Add Server</strong> above.
          </p>
        ) : (
          <div className="space-y-2">
            {servers.map((srv) => (
              <ServerRow
                key={srv.id}
                server={srv}
                expanded={expandedId === srv.id}
                onToggleExpand={() => setExpandedId(expandedId === srv.id ? null : srv.id)}
                onProbe={() => handleProbe(srv.id)}
                onToggle={(f, v) => handleToggle(srv.id, f, v)}
                onDelete={() => handleDelete(srv.id, srv.name)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------- Add server form ----------------------------------------------------

function AddServerForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"http" | "sse">("http");
  const [authType, setAuthType] = useState<"none" | "bearer" | "oauth">("none");
  const [bearerToken, setBearerToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error("Name and URL are required");
      return;
    }
    setSubmitting(true);
    try {
      const auth_config = authType === "bearer" ? { token: bearerToken } : {};
      await McpClientAPI.create({
        name: name.trim(),
        url: url.trim(),
        transport,
        auth_type: authType,
        auth_config,
      });
      toast.success("Server added — probing in background");
      onCreated();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-md border border-primary/30 bg-muted/30 p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] font-mono uppercase tracking-wider">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sentry MCP" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] font-mono uppercase tracking-wider">Transport</Label>
          <Select value={transport} onValueChange={(v) => setTransport(v as "http" | "sse")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="http">Streamable HTTP</SelectItem>
              <SelectItem value="sse">SSE</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[10px] font-mono uppercase tracking-wider">URL</Label>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mcp.example.com/mcp"
          className="font-mono text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] font-mono uppercase tracking-wider">Auth</Label>
          <Select value={authType} onValueChange={(v) => setAuthType(v as "none" | "bearer" | "oauth")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (public)</SelectItem>
              <SelectItem value="bearer">Bearer token</SelectItem>
              <SelectItem value="oauth" disabled>OAuth (coming soon)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {authType === "bearer" && (
          <div className="space-y-1.5">
            <Label className="text-[10px] font-mono uppercase tracking-wider">Token</Label>
            <Input
              type="password"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              placeholder="Bearer secret"
              className="font-mono text-xs"
            />
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? "Adding…" : "Add & Probe"}
        </Button>
      </div>
    </div>
  );
}

// ------- Server row ---------------------------------------------------------

function ServerRow({
  server, expanded, onToggleExpand, onProbe, onToggle, onDelete,
}: {
  server: McpClientServer;
  expanded: boolean;
  onToggleExpand: () => void;
  onProbe: () => void | Promise<void>;
  onToggle: (field: "enabled" | "auto_inject", value: boolean) => void;
  onDelete: () => void;
}) {
  const toolCount = Array.isArray(server.tools_cache) ? server.tools_cache.length : 0;
  const statusBadge = server.last_status === "ready"
    ? <Badge className="bg-green-500/15 text-green-500 border-green-500/30"><CheckCircle2 className="mr-1 h-3 w-3" />ready</Badge>
    : server.last_status === "unauthenticated"
    ? <Badge variant="outline" className="border-amber-500/40 text-amber-500"><Lock className="mr-1 h-3 w-3" />auth required</Badge>
    : server.last_status === "error"
    ? <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />error</Badge>
    : <Badge variant="outline">unprobed</Badge>;

  return (
    <div className="rounded-md border border-border/60 bg-card/30">
      <div className="flex items-center gap-2 p-2.5">
        <button onClick={onToggleExpand} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{server.name}</span>
            <code className="text-[10px] font-mono text-muted-foreground">{server.slug}</code>
            {statusBadge}
            <Badge variant="outline" className="text-[10px] font-mono">{toolCount} tools</Badge>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground truncate">
            {server.transport.toUpperCase()} · {server.auth_type} · {server.url}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex flex-col items-end gap-0.5 pr-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase text-muted-foreground">enabled</span>
              <Switch checked={server.enabled} onCheckedChange={(v) => onToggle("enabled", v)} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase text-muted-foreground">auto-inject</span>
              <Switch checked={server.auto_inject} onCheckedChange={(v) => onToggle("auto_inject", v)} />
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={onProbe} title="Probe">
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} title="Delete">
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/40 p-3 space-y-3 bg-muted/20">
          {server.last_error && (
            <div className="text-[10px] font-mono text-destructive">
              Last error: {server.last_error}
            </div>
          )}
          {server.last_probe_at && (
            <div className="text-[10px] font-mono text-muted-foreground">
              Last probe: {new Date(server.last_probe_at).toLocaleString()}
            </div>
          )}
          <Separator />
          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Discovered tools
            </div>
            {toolCount === 0 ? (
              <p className="text-[11px] font-mono text-muted-foreground">
                No tools discovered yet. Click the refresh button to probe.
              </p>
            ) : (
              <div className="space-y-1.5">
                {(server.tools_cache || []).map((t) => (
                  <ToolTestRow key={t.name} serverId={server.id} tool={t} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolTestRow({
  serverId, tool,
}: { serverId: string; tool: { name: string; description?: string } }) {
  const [argsText, setArgsText] = useState("{}");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const args = JSON.parse(argsText || "{}");
      const r = await McpClientAPI.call(serverId, tool.name, args);
      setResult(JSON.stringify(r.result, null, 2));
    } catch (e: unknown) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded border border-border/40 bg-background/40 p-2">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(!open)} className="text-muted-foreground hover:text-foreground">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <code className="text-[11px] font-mono text-primary flex-1 truncate">{tool.name}</code>
        {tool.description && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[40%]">{tool.description}</span>
        )}
        <Button size="sm" variant="ghost" onClick={() => { setOpen(true); run(); }} disabled={running}>
          <Play className="h-3 w-3" />
        </Button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="space-y-1">
            <Label className="text-[9px] font-mono uppercase text-muted-foreground">Arguments (JSON)</Label>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              className="w-full min-h-[60px] rounded border border-border/60 bg-background p-2 font-mono text-[11px]"
            />
          </div>
          {result && (
            <pre className="max-h-64 overflow-auto rounded border border-border/60 bg-background p-2 text-[10px] font-mono whitespace-pre-wrap">
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
