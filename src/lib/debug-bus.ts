import { useCallback, useEffect, useRef, useState } from "react";
import { onDenyEvent, type DenyEvent } from "./deny-events";
import { onRbacEvent, type RbacEvent } from "./rbac-events";

/**
 * Live debugging bus.
 * A master ON/OFF switch plus per-feature channels grouped into
 * sources / workflow / infra. When a channel is armed its frames stream into
 * the live console; everything else is dropped at the emitter so the buffer
 * stays cheap.
 */

export type DebugGroup = "sources" | "workflow" | "infra" | "integrations" | "governance";

export type DebugChannel = {
  id: string;
  label: string;
  group: DebugGroup;
  /** tag rendered in the console gutter */
  tag: string;
  hint: string;
};

export const debugChannels: DebugChannel[] = [
  {
    id: "chat",
    label: "Chat",
    group: "sources",
    tag: "chat",
    hint: "composer → request → stream lifecycle",
  },
  {
    id: "rag",
    label: "RAG",
    group: "sources",
    tag: "rag",
    hint: "retrieval, rerank and chunk scoring",
  },
  {
    id: "model",
    label: "Model",
    group: "sources",
    tag: "model",
    hint: "provider calls, tokens, ttft",
  },
  {
    id: "auth",
    label: "Auth",
    group: "sources",
    tag: "auth",
    hint: "sessions, tokens, rbac checks",
  },
  {
    id: "pdf",
    label: "Documents",
    group: "sources",
    tag: "doc",
    hint: "parsing, OCR and export pipeline",
  },
  { id: "other", label: "Other", group: "sources", tag: "misc", hint: "unclassified emitters" },
  {
    id: "agent",
    label: "Agent trace",
    group: "workflow",
    tag: "agent",
    hint: "planner steps, tool calls, retries",
  },
  {
    id: "approvals",
    label: "Approval bypass",
    group: "workflow",
    tag: "gate",
    hint: "dev-only: skip approval gates",
  },
  {
    id: "heartbeat",
    label: "Heartbeat",
    group: "workflow",
    tag: "beat",
    hint: "scheduler ticks and keepalives",
  },
  {
    id: "sse",
    label: "Raw SSE frames",
    group: "infra",
    tag: "sse",
    hint: "unparsed transport frames",
  },
  {
    id: "latency",
    label: "Latency overlay",
    group: "infra",
    tag: "lat",
    hint: "per-hop timing breakdown",
  },
  {
    id: "sql",
    label: "Query plan",
    group: "infra",
    tag: "sql",
    hint: "database statements and plans",
  },
  {
    id: "cache",
    label: "Cache",
    group: "infra",
    tag: "cache",
    hint: "hit/miss, eviction, warmups",
  },
  { id: "net", label: "Network", group: "infra", tag: "net", hint: "outbound http, retries, dns" },
  {
    id: "queue",
    label: "Queue / jobs",
    group: "infra",
    tag: "job",
    hint: "worker queue depth, retries, dead letters",
  },
  {
    id: "storage",
    label: "Storage",
    group: "infra",
    tag: "stor",
    hint: "object store reads, writes, quota",
  },
  {
    id: "vector",
    label: "Vector store",
    group: "infra",
    tag: "vec",
    hint: "index writes, ANN probes, shard health",
  },
  {
    id: "memory",
    label: "Memory engine",
    group: "sources",
    tag: "mem",
    hint: "working set, episodic rollups, recall hits",
  },
  {
    id: "prompt",
    label: "Prompt assembly",
    group: "sources",
    tag: "prm",
    hint: "layer merge, template render, token budget",
  },
  {
    id: "embed",
    label: "Embeddings",
    group: "sources",
    tag: "emb",
    hint: "batch encode, dims, throughput",
  },
  {
    id: "flows",
    label: "Workflow runs",
    group: "workflow",
    tag: "flow",
    hint: "node execution, branches, run state",
  },
  {
    id: "skills",
    label: "Skills / tools",
    group: "workflow",
    tag: "skill",
    hint: "tool registry resolve, arg schema, results",
  },
  {
    id: "scheduler",
    label: "Scheduler / cron",
    group: "workflow",
    tag: "cron",
    hint: "cron fires, drift, missed windows",
  },
  {
    id: "mcp",
    label: "MCP servers",
    group: "integrations",
    tag: "mcp",
    hint: "handshake, tool list, transport frames",
  },
  {
    id: "adapters",
    label: "Adapters",
    group: "integrations",
    tag: "adpt",
    hint: "source adapters, sync cursors, backoff",
  },
  {
    id: "targets",
    label: "Targets",
    group: "integrations",
    tag: "tgt",
    hint: "delivery targets, ack, dead letters",
  },
  {
    id: "webhook",
    label: "Webhooks",
    group: "integrations",
    tag: "hook",
    hint: "inbound payloads, signature checks",
  },
  {
    id: "routing",
    label: "Provider routing",
    group: "integrations",
    tag: "rout",
    hint: "failover, round-robin, circuit breaker",
  },
  {
    id: "mail",
    label: "Mail & time",
    group: "integrations",
    tag: "smtp",
    hint: "smtp relay, ntp drift, delivery",
  },
  {
    id: "vault",
    label: "Secret vault",
    group: "governance",
    tag: "vlt",
    hint: "secret reads, rotation, lease expiry",
  },
  {
    id: "rbac",
    label: "RBAC / policy",
    group: "governance",
    tag: "rbac",
    hint: "capability grants, denials, drift",
  },
  {
    id: "audit",
    label: "Audit journal",
    group: "governance",
    tag: "adt",
    hint: "journal writes, retention sweeps",
  },
  {
    id: "siem",
    label: "SIEM forwarder",
    group: "governance",
    tag: "siem",
    hint: "forward batches, tls handshake, backlog",
  },
  {
    id: "cost",
    label: "Cost & quota",
    group: "governance",
    tag: "cost",
    hint: "spend ticks, budget thresholds, throttles",
  },
  {
    id: "deny",
    label: "Deny list",
    group: "governance",
    tag: "deny",
    hint: "orchestrator bridge deny-list adds, removals and clears",
  },
];

export const debugLevels = ["trace", "debug", "info", "warn", "error"] as const;
export type DebugLevel = (typeof debugLevels)[number];

export const levelRank: Record<DebugLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

export const levelTone: Record<DebugLevel, string> = {
  trace: "text-muted-foreground/45",
  debug: "text-muted-foreground/70",
  info: "text-sapphire/80",
  warn: "text-topaz/85",
  error: "text-ruby/85",
};

export type DebugFrame = {
  id: string;
  at: number;
  channel: string;
  tag: string;
  level: DebugLevel;
  scope: string;
  msg: string;
  ms: number | null;
};

export const bufferSizes = [200, 500, 1000, 5000];

export function parseDebugFrame(data: {
  id?: string | number;
  agent?: string;
  level?: string;
  message?: string;
  meta?: { tag?: string; ms?: number; [key: string]: unknown } | null;
  created_at?: string | number | null;
  ts?: number;
}): DebugFrame {
  let chId = "other";
  const agent = String(data.agent || "");
  if (agent === "checkpoint" || agent === "audit") chId = "audit";
  else if (agent === "workflow" || agent === "chain" || agent === "flows") chId = "flows";
  else if (agent.startsWith("agent://") || agent.startsWith("skill://")) chId = "agent";
  else if (agent === "system") chId = "net";
  else if (agent === "auth") chId = "auth";
  else if (agent === "rag") chId = "rag";
  else if (agent === "mcp") chId = "mcp";
  else if (agent === "vault") chId = "vault";
  else if (agent === "rbac") chId = "rbac";
  else if (agent === "cost") chId = "cost";

  const ch =
    debugChannels.find((c) => c.id === chId) ?? debugChannels.find((c) => c.id === "other")!;

  const rawLvl = String(data.level || "info");
  const lvl: DebugLevel =
    rawLvl === "warn" || rawLvl === "warning"
      ? "warn"
      : rawLvl === "error"
        ? "error"
        : rawLvl === "debug"
          ? "debug"
          : rawLvl === "trace"
            ? "trace"
            : "info";

  const rawMsg = String(data.message || "");
  const tag = data.meta?.tag || ch.tag;
  const scope = rawMsg.includes(":") ? rawMsg.split(":")[0]!.trim() : tag || "sys.log";

  return {
    id: `f_${data.id || Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: data.created_at ? new Date(data.created_at).getTime() : data.ts || Date.now(),
    channel: ch.id,
    tag,
    level: lvl,
    scope,
    msg: rawMsg,
    ms: typeof data.meta?.ms === "number" ? data.meta.ms : null,
  };
}

export function useDebugBus() {
  const [on, setOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [armed, setArmed] = useState<string[]>(["chat", "model", "agent", "deny"]);
  const [level, setLevel] = useState<DebugLevel>("trace");
  const [buffer, setBuffer] = useState(500);
  const [frames, setFrames] = useState<DebugFrame[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const state = useRef({ on, paused, armed, level, buffer });
  state.current = { on, paused, armed, level, buffer };

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const { fetchApi } = await import("./api");
        const res = await fetchApi("/logs?limit=200");
        if (Array.isArray(res)) {
          const s = state.current;
          const history = res.map((r) => parseDebugFrame(r));
          const newCounts: Record<string, number> = {};
          for (const h of history) {
            newCounts[h.channel] = (newCounts[h.channel] ?? 0) + 1;
          }
          setCounts(newCounts);
          setFrames(() => [...history.reverse()].slice(-s.buffer));
        }
      } catch (err) {
        console.error("[useDebugBus] Failed to fetch debug history:", err);
      }
    };
    fetchHistory();
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connect = () => {
      const s = state.current;
      if (!s.on) return;
      if (es) {
        es.close();
      }

      const sessionId =
        typeof window !== "undefined" ? localStorage.getItem("sovereign.sessionId") : null;
      const url = sessionId ? `/api/audit/stream?session_id=${sessionId}` : "/api/audit/stream";
      es = new EventSource(url);

      es.onmessage = (msg) => {
        const _s = state.current;
        if (_s.paused) return;

        try {
          const data = JSON.parse(msg.data);
          if (
            data &&
            data.message !== "stream.heartbeat" &&
            data.message !== "Audit feed connected"
          ) {
            const f = parseDebugFrame(data);
            if (levelRank[f.level] < levelRank[_s.level]) return;

            setFrames((prev) => [...prev, f].slice(-_s.buffer));
            setCounts((prev) => ({ ...prev, [f.channel]: (prev[f.channel] ?? 0) + 1 }));
          }
        } catch (e) {
          /* ignore */
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (state.current.on) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    if (on) {
      connect();
    } else {
      if (es) {
        (es as EventSource).close();
        es = null;
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
    }

    return () => {
      if (es) es.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [on]);

  /** real (non-simulated) frames: deny-list mutations from the bridge */
  useEffect(() => {
    return onDenyEvent((e: DenyEvent) => {
      const s = state.current;
      const f: DebugFrame = {
        id: e.id,
        at: e.at,
        channel: "deny",
        tag: "deny",
        level:
          e.action === "deny.add" || e.action === "signature.warned"
            ? "warn"
            : e.action === "signature.denied"
              ? "error"
              : "info",
        scope: `${e.action}.${e.category}`,
        msg: `${e.detail} · actor=${e.actor}`,
        ms: null,
      };
      if (!s.on || s.paused || !s.armed.includes("deny")) return;
      if (levelRank[f.level] < levelRank[s.level]) return;
      setFrames((prev) => [...prev, f].slice(-s.buffer));
      setCounts((prev) => ({ ...prev, deny: (prev["deny"] ?? 0) + 1 }));
    });
  }, []);

  /** real frames: RBAC grants, revokes and enforcement flips */
  useEffect(() => {
    return onRbacEvent((e: RbacEvent) => {
      const s = state.current;
      const f: DebugFrame = {
        id: e.id,
        at: e.at,
        channel: "rbac",
        tag: "rbac",
        level:
          e.action === "rbac.denied"
            ? "error"
            : e.action === "rbac.grant" || e.action === "rbac.action.grant"
              ? "warn"
              : "info",
        scope: e.action,
        msg: `${e.detail} · actor=${e.actor}`,
        ms: null,
      };
      if (!s.on || s.paused || !s.armed.includes("rbac")) return;
      if (levelRank[f.level] < levelRank[s.level]) return;
      setFrames((prev) => [...prev, f].slice(-s.buffer));
      setCounts((prev) => ({ ...prev, rbac: (prev["rbac"] ?? 0) + 1 }));
    });
  }, []);

  const toggleChannel = useCallback((id: string) => {
    setArmed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const armAll = useCallback(() => setArmed(debugChannels.map((c) => c.id)), []);
  const armNone = useCallback(() => setArmed([]), []);
  const clear = useCallback(() => {
    setFrames([]);
    setCounts({});
  }, []);

  return {
    on,
    setOn,
    paused,
    setPaused,
    armed,
    toggleChannel,
    armAll,
    armNone,
    level,
    setLevel,
    buffer,
    setBuffer,
    frames,
    counts,
    clear,
  };
}

export function framesToText(frames: DebugFrame[]) {
  return frames
    .map(
      (f) =>
        `${new Date(f.at).toISOString()} [${f.level.toUpperCase()}] (${f.tag}) ${f.scope} — ${f.msg}${
          f.ms !== null ? ` · ${f.ms}ms` : ""
        }`,
    )
    .join("\n");
}
