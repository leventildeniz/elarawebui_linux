// Shared "Run History" table — used by Tools & Agents pages.
// Merges two sources:
//   1. /api/tool-invocations  — persisted tool calls (incl. !slug(...) dispatches)
//   2. /api/agents/runs       — live spawned-agent registry (in-memory)
// Both are surfaced in one table so operators see EVERY agent/tool activity
// regardless of which entrypoint fired it.

import { useEffect, useMemo, useState } from "react";
import { ToolInvocationsAPI, AgentsAPI, type ToolInvocationRow, type LiveAgentRun, type AgentRunHistoryRow } from "@/lib/api-client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";

interface Props {
  toolId?: string;
  agentId?: string;
  packId?: string;
  limit?: number;
  pollMs?: number;
  showTool?: boolean;
  showAgent?: boolean;
  /** Restrict which run sources are merged into the table. Default: all. */
  sources?: Source[];
}
type Source = "tool-call" | "agent-run" | "agent-history";
type Row = {
  key: string;
  source: Source;
  tool_id: string;
  agent_id: string;
  username: string;
  adapter: string;
  status: string;
  started_at: string | null;
  duration_ms: number | null;
};

function fromInvocation(r: ToolInvocationRow): Row {
  return {
    key: `inv:${r.id}`,
    source: "tool-call",
    tool_id: r.tool_id,
    agent_id: r.agent_id || "",
    username: r.username || "",
    adapter: r.adapter || "",
    status: r.status,
    started_at: r.started_at ?? null,
    duration_ms: r.duration_ms ?? null,
  };
}

function fromAgentRun(r: LiveAgentRun): Row {
  return {
    key: `run:${r.runId}`,
    source: "agent-run",
    tool_id: "",
    agent_id: r.agentId,
    username: "",
    adapter: "spawn",
    status: r.cancelRequested ? "cancelling" : "running",
    started_at: new Date(r.startedAt).toISOString(),
    duration_ms: r.ageMs ?? null,
  };
}

function fromAgentHistory(r: AgentRunHistoryRow): Row {
  const isToolCall = r.source === "tool-call";
  return {
    key: isToolCall ? `tcall:${r.run_id}` : `hist:${r.run_id}`,
    source: isToolCall ? "tool-call" : "agent-history",
    tool_id: r.tool_id || "",
    agent_id: r.agent_id || "",
    username: r.username || "",
    adapter: isToolCall ? "tool" : (r.source || "spawn"),
    status: r.status,
    started_at: r.started_at,
    duration_ms: r.duration_ms,
  };
}

const ALL_SOURCES: Source[] = ["tool-call", "agent-run", "agent-history"];
const SOURCE_LABEL: Record<Source, string> = {
  "tool-call": "Tool calls",
  "agent-run": "Agent (live)",
  "agent-history": "Agent (history)",
};
export function RunHistoryTable({
  toolId, agentId, packId, limit = 100, pollMs = 8000, showTool = true, showAgent = true,
  sources = ALL_SOURCES,
}: Props) {
  const [invocations, setInvocations] = useState<ToolInvocationRow[]>([]);
  const [liveRuns, setLiveRuns] = useState<LiveAgentRun[]>([]);
  const [history, setHistory] = useState<AgentRunHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"all" | Source>("all");

  const allow = useMemo(() => new Set(sources), [sources]);
  // packId scope only makes sense for persisted history (live runs carry no pack).
  const wantInvocations = allow.has("tool-call") && !packId;
  const wantLive = allow.has("agent-run") && !packId;
  const wantHistory = allow.has("agent-history");

  const refresh = async () => {
    setLoading(true);
    try {
      const [inv, runs, hist] = await Promise.all([
        wantInvocations
          ? ToolInvocationsAPI.list({ limit, toolId, agentId }).catch(() => ({ items: [] as ToolInvocationRow[] }))
          : Promise.resolve({ items: [] as ToolInvocationRow[] }),
        wantLive
          ? AgentsAPI.listRuns().catch(() => ({ ok: false, runs: [] as LiveAgentRun[], counts: {}, ts: Date.now() }))
          : Promise.resolve({ ok: false, runs: [] as LiveAgentRun[], counts: {}, ts: Date.now() }),
        wantHistory
          ? AgentsAPI.listRunHistory({ limit, agentId, packId }).catch(() => ({ ok: false, items: [] as AgentRunHistoryRow[] }))
          : Promise.resolve({ ok: false, items: [] as AgentRunHistoryRow[] }),
      ]);
      setInvocations(inv.items);
      const filteredRuns = (runs.runs || []).filter((r) => !agentId || r.agentId === agentId);
      setLiveRuns(filteredRuns);
      setHistory(hist.items || []);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    refresh();
    if (!pollMs) return;
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId, agentId, packId, limit, pollMs, sources]);

  const rows = useMemo<Row[]>(() => {
    // Live runs take precedence over history rows with the same runId.
    const liveIds = new Set(liveRuns.map((r) => r.runId));
    const merged = [
      ...invocations.map(fromInvocation),
      ...liveRuns.map(fromAgentRun),
      ...history.filter((h) => !liveIds.has(h.run_id)).map(fromAgentHistory),
    ].filter((r) => allow.has(r.source));
    merged.sort((a, b) => {
      const ta = a.started_at ? Date.parse(a.started_at) : 0;
      const tb = b.started_at ? Date.parse(b.started_at) : 0;
      return tb - ta;
    });
    return sourceFilter === "all" ? merged : merged.filter((r) => r.source === sourceFilter);
  }, [invocations, liveRuns, history, sourceFilter, allow]);


  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {rows.length} run{rows.length === 1 ? "" : "s"}
          <span className="ml-2 normal-case text-muted-foreground/70">
            {wantInvocations && <>· tool-calls {invocations.length} </>}
            {wantLive && <>· live {liveRuns.length} </>}
            {wantHistory && <>· history {history.length}</>}
          </span>
        </p>
        <div className="flex items-center gap-1">
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
            <SelectTrigger className="h-7 w-36 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {ALL_SOURCES.filter((s) => allow.has(s)).map((s) => (
                <SelectItem key={s} value={s}>{SOURCE_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left p-2">Source</th>
              {showTool && <th className="text-left p-2">Tool</th>}
              {showAgent && <th className="text-left p-2">Agent</th>}
              <th className="text-left p-2">User</th>
              <th className="text-left p-2">Adapter</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Started</th>
              <th className="text-left p-2">Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ok = r.status === "ok" || r.status === "success";
              const failed = r.status === "error" || r.status === "failed";
              const running = r.status === "running" || r.status === "cancelling" || r.status === "pending";
              return (
                <tr key={r.key} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="p-2">
                    <Badge variant="outline" className={`text-[9px] ${r.source === "agent-run" ? "text-purple-400 border-purple-500/40" : "text-cyan-400 border-cyan-500/40"}`}>
                      {r.source}
                    </Badge>
                  </td>
                  {showTool && <td className="p-2 truncate max-w-[220px]">{r.tool_id || "—"}</td>}
                  {showAgent && <td className="p-2 text-muted-foreground truncate max-w-[160px]">{r.agent_id || "—"}</td>}
                  <td className="p-2 text-muted-foreground">{r.username || "—"}</td>
                  <td className="p-2 text-muted-foreground">{r.adapter || "—"}</td>
                  <td className="p-2">
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${ok ? "text-emerald-400 border-emerald-500/40" : failed ? "text-red-400 border-red-500/40" : running ? "text-blue-400 border-blue-500/40" : "text-amber-400 border-amber-500/40"}`}
                    >
                      {r.status}
                    </Badge>
                  </td>
                  <td className="p-2 text-muted-foreground">{r.started_at ? new Date(r.started_at).toLocaleString() : "—"}</td>
                  <td className="p-2 text-muted-foreground">{r.duration_ms != null ? `${r.duration_ms}ms` : "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6 + (showTool ? 1 : 0) + (showAgent ? 1 : 0)} className="p-6 text-center text-muted-foreground">
                  No runs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
