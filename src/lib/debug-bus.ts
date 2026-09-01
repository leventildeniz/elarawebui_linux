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

const lines: Record<string, { level: DebugLevel; scope: string; msg: string }[]> = {
  chat: [
    { level: "info", scope: "chat.request", msg: "thread=thr_9f3 turn=14 attachments=0" },
    { level: "debug", scope: "chat.compose", msg: "context budget 41_820 / 200_000 tokens" },
    { level: "trace", scope: "chat.stream", msg: "delta chunk len=42" },
  ],
  rag: [
    { level: "info", scope: "rag.search.start", msg: "kb=contracts top_k=8 hybrid=true" },
    { level: "debug", scope: "rag.rerank", msg: "cross-encoder reordered 8 → 5 chunks" },
    { level: "warn", scope: "rag.recall", msg: "low similarity 0.41 on best chunk" },
  ],
  model: [
    { level: "info", scope: "model.first_token", msg: "provider=azure model=gpt-5 ttft=812ms" },
    { level: "info", scope: "model.responded", msg: "in=1_842 out=613 tokens cost=$0.0184" },
    { level: "error", scope: "model.error", msg: "429 rate_limited · failing over" },
  ],
  auth: [
    { level: "debug", scope: "auth.verify", msg: "jwt exp=+42m scope=studio.rw" },
    { level: "warn", scope: "auth.rbac", msg: "capability forge.publish denied for role analyst" },
  ],
  pdf: [
    { level: "info", scope: "doc.parse", msg: "invoice_q3.pdf 14 pages · 2.1s" },
    { level: "debug", scope: "doc.ocr", msg: "page 7 fallback to OCR (no text layer)" },
  ],
  other: [{ level: "trace", scope: "misc.emit", msg: "unclassified emitter ping" }],
  agent: [
    { level: "info", scope: "agent.step.start", msg: "planner-01 step 3/6 tool=rag.search" },
    { level: "debug", scope: "agent.tool", msg: "args validated against schema v2" },
    { level: "error", scope: "agent.retry", msg: "tool timeout 30000ms · attempt 2/3" },
  ],
  approvals: [
    {
      level: "warn",
      scope: "gate.bypass",
      msg: "DEV: approval gate skipped for flow:nightly-index",
    },
  ],
  heartbeat: [{ level: "trace", scope: "beat.tick", msg: "scheduler alive · queue depth 3" }],
  sse: [
    { level: "trace", scope: "sse.frame", msg: 'data: {"type":"content_block_delta","index":0}' },
    { level: "trace", scope: "sse.frame", msg: "event: ping" },
  ],
  latency: [
    { level: "debug", scope: "lat.hop", msg: "gateway 8ms · router 3ms · provider 812ms" },
    { level: "warn", scope: "lat.budget", msg: "p95 exceeded 1500ms budget" },
  ],
  sql: [
    { level: "debug", scope: "sql.exec", msg: "select * from threads where owner=$1 · 4.2ms" },
    { level: "warn", scope: "sql.plan", msg: "seq scan on events (est 42k rows)" },
  ],
  cache: [
    { level: "debug", scope: "cache.hit", msg: "embeddings:contracts:sha1 · 0.4ms" },
    { level: "info", scope: "cache.evict", msg: "lru dropped 128 entries" },
  ],
  net: [
    { level: "debug", scope: "net.fetch", msg: "POST api.provider.ai/v1/messages 200 · 640ms" },
    { level: "error", scope: "net.dns", msg: "ENOTFOUND relay.internal · retry in 2s" },
  ],
  queue: [
    { level: "debug", scope: "job.dequeue", msg: "worker-3 took index_kb · depth 12" },
    { level: "warn", scope: "job.retry", msg: "attempt 2/5 · backoff 4s" },
  ],
  storage: [
    { level: "debug", scope: "stor.put", msg: "artifacts/report_0812.pdf 1.8MB · 240ms" },
    { level: "warn", scope: "stor.quota", msg: "bucket at 82% of 500GB" },
  ],
  vector: [
    { level: "info", scope: "vec.upsert", msg: "1_024 vectors dim=3072 shard=2" },
    { level: "debug", scope: "vec.probe", msg: "ann nprobe=24 recall~0.96 · 11ms" },
  ],
  memory: [
    { level: "info", scope: "mem.recall", msg: "semantic hit 3 items score>0.82" },
    { level: "debug", scope: "mem.compact", msg: "episodic rollup 18 turns → 1 digest" },
  ],
  prompt: [
    { level: "debug", scope: "prm.assemble", msg: "8 layers merged · 6_140 tokens" },
    { level: "warn", scope: "prm.truncate", msg: "layer=examples trimmed to fit budget" },
  ],
  embed: [
    { level: "debug", scope: "emb.batch", msg: "64 chunks encoded · 380ms" },
    { level: "info", scope: "emb.model", msg: "text-embed-3-large dim=3072" },
  ],
  flows: [
    { level: "info", scope: "flow.run", msg: "nightly-index node 4/9 action=upsert" },
    { level: "error", scope: "flow.node", msg: "branch guard failed · run halted" },
  ],
  skills: [
    { level: "debug", scope: "skill.resolve", msg: "tool=web.fetch v1.3 from registry" },
    { level: "warn", scope: "skill.args", msg: "coerced string → number for depth" },
  ],
  scheduler: [
    { level: "trace", scope: "cron.fire", msg: "0 */4 * * * → flow:reindex" },
    { level: "warn", scope: "cron.drift", msg: "fired 3.4s late" },
  ],
  mcp: [
    { level: "info", scope: "mcp.handshake", msg: "server=filesystem protocol=2025-06 ok" },
    { level: "debug", scope: "mcp.tools", msg: "12 tools advertised" },
    { level: "error", scope: "mcp.transport", msg: "stdio closed unexpectedly · restarting" },
  ],
  adapters: [
    { level: "info", scope: "adpt.sync", msg: "confluence cursor=2026-08-17T11:02Z · 42 docs" },
    { level: "warn", scope: "adpt.backoff", msg: "429 from source · sleeping 30s" },
  ],
  targets: [
    { level: "debug", scope: "tgt.deliver", msg: "slack#ops ack 200 · 120ms" },
    { level: "error", scope: "tgt.dlq", msg: "3 payloads moved to dead letter" },
  ],
  webhook: [
    { level: "info", scope: "hook.in", msg: "POST /api/public/webhook sig=ok" },
    { level: "warn", scope: "hook.sig", msg: "signature mismatch · rejected 401" },
  ],
  routing: [
    { level: "info", scope: "rout.select", msg: "mode=smart → azure (latency 812ms)" },
    { level: "warn", scope: "rout.failover", msg: "primary breaker open · switched to bedrock" },
  ],
  mail: [
    { level: "debug", scope: "smtp.send", msg: "relay.corp:587 tls · report to 3 recipients" },
    { level: "warn", scope: "ntp.drift", msg: "clock offset +142ms" },
  ],
  vault: [
    { level: "debug", scope: "vlt.read", msg: "secret=provider/azure lease 12h" },
    { level: "warn", scope: "vlt.rotate", msg: "key age 89d · rotation due" },
  ],
  rbac: [
    { level: "debug", scope: "rbac.grant", msg: "role=operator capability=flows.run" },
    { level: "error", scope: "rbac.deny", msg: "user=levent capability=vault.reveal denied" },
  ],
  audit: [
    { level: "trace", scope: "adt.write", msg: "event=model.updated actor=levent" },
    { level: "debug", scope: "adt.sweep", msg: "retention 30d · 1_204 rows pruned" },
  ],
  siem: [
    { level: "debug", scope: "siem.forward", msg: "batch=250 events CEF → 10.0.4.11:6514" },
    { level: "error", scope: "siem.tls", msg: "handshake failed · backlog 1_820" },
  ],
  deny: [{ level: "warn", scope: "deny.policy", msg: "orchestrator bridge deny list evaluated" }],
  cost: [
    { level: "info", scope: "cost.tick", msg: "spend $4.12/hr · budget $8.00/hr" },
    { level: "warn", scope: "cost.threshold", msg: "80% of daily budget consumed" },
  ],
};

let n = 0;
function frame(ch: DebugChannel): DebugFrame {
  const pool = lines[ch.id] ?? lines["other"]!;
  const l = pool[Math.floor(Math.random() * pool.length)]!;
  return {
    id: `f${n++}`,
    at: Date.now(),
    channel: ch.id,
    tag: ch.tag,
    level: l.level,
    scope: l.scope,
    msg: l.msg,
    ms: Math.random() > 0.5 ? Math.round(Math.random() * 900) : null,
  };
}

export const bufferSizes = [200, 500, 1000, 5000];

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
        const res = await fetchApi("/api/logs?limit=200");
        if (Array.isArray(res)) {
          const s = state.current;
          const history: DebugFrame[] = res.map((data: any) => {
            let chId = "other";
            if (data.agent === "checkpoint") chId = "audit";
            else if (data.agent === "workflow" || data.agent === "chain") chId = "flows";
            else if (data.agent?.startsWith("agent://") || data.agent?.startsWith("skill://")) chId = "agent";
            else if (data.agent === "system") chId = "net";

            const ch = debugChannels.find((c) => c.id === chId) || debugChannels.find((c) => c.id === "other")!;
            const lvl: DebugLevel = (data.level === "warn" ? "warn" : 
                                     data.level === "error" ? "error" : 
                                     data.level === "debug" ? "debug" : 
                                     data.level === "trace" ? "trace" : "info");

            return {
              id: `f_${data.id || Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
              at: new Date(data.created_at || Date.now()).getTime(),
              channel: ch.id,
              tag: data.meta?.tag || ch.tag,
              level: lvl,
              scope: typeof data.message === "string" && data.message.includes(":") ? data.message.split(":")[0] : (data.meta?.tag || "sys.log"),
              msg: data.message,
              ms: data.meta?.ms || null,
            };
          });
          
          setFrames((prev) => {
            // we only do this once on mount, so just set the fetched logs
            return [...history.reverse()].slice(-s.buffer);
          });
        }
      } catch (err) {
        console.error("Failed to fetch debug history", err);
      }
    };
    fetchHistory();
  }, []);

  useEffect(() => {
    // Only fetch dummy data for un-mapped ones
    // Real implementation of DebugBus connects to an EventSource
    let es: EventSource | null = null;
    let reconnectTimer: any = null;

    const connect = () => {
      const s = state.current;
      if (!s.on) return;
      if (es) {
        es.close();
      }

      const sessionId = typeof window !== "undefined" ? localStorage.getItem("sovereign.sessionId") : null;
      const url = sessionId ? `/api/audit/stream?session_id=${sessionId}` : "/api/audit/stream";
      es = new EventSource(url);
      es.onmessage = (msg) => {
        const _s = state.current;
        if (_s.paused) return;
        
        try {
          const data = JSON.parse(msg.data);
          if (data && data.message !== "stream.heartbeat" && data.message !== "Audit feed connected") {
            let chId = "other";
            if (data.agent === "checkpoint") chId = "audit";
            else if (data.agent === "workflow" || data.agent === "chain") chId = "flows";
            else if (data.agent?.startsWith("agent://") || data.agent?.startsWith("skill://")) chId = "agent";
            else if (data.agent === "system") chId = "net";

            const ch = debugChannels.find((c) => c.id === chId) || debugChannels.find((c) => c.id === "other")!;
            
            const lvl: DebugLevel = (data.level === "warn" ? "warn" : 
                                     data.level === "error" ? "error" : 
                                     data.level === "debug" ? "debug" : 
                                     data.level === "trace" ? "trace" : "info");
            
            if (levelRank[lvl] < levelRank[_s.level]) return;

            const f: DebugFrame = {
              id: `f_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
              at: data.ts || Date.now(),
              channel: ch.id,
              tag: data.meta?.tag || ch.tag,
              level: lvl,
              scope: data.message.includes(":") ? data.message.split(":")[0] : (data.meta?.tag || "sys.log"),
              msg: data.message,
              ms: data.meta?.ms || null,
            };

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
      clearTimeout(reconnectTimer);
    }

    return () => {
      if (es) es.close();
      clearTimeout(reconnectTimer);
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
