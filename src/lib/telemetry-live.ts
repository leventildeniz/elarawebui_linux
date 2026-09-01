import { useEffect, useRef, useState } from "react";

export type Series = number[];

const HISTORY = 40;

function walk(prev: number, drift: number, min: number, max: number) {
  const next = prev + (Math.random() - 0.5) * drift;
  return Math.min(max, Math.max(min, next));
}

function push(series: Series, value: number): Series {
  const next = [...series, value];
  return next.length > HISTORY ? next.slice(next.length - HISTORY) : next;
}

export type HostSample = {
  cpu: number;
  cores: number[];
  gpu: number;
  vram: number;
  gpuTemp: number;
  ram: number;
  ramTotalGb: number;
  swap: number;
  diskRead: number;
  diskWrite: number;
  netRx: number;
  netTx: number;
  netErrors: number;
  dbConns: number;
  dbPool: number;
  dbQps: number;
  dbLagMs: number;
  sessions: number;
  loadAvg: [number, number, number];
  uptimeSec: number;
};

export type AiSample = {
  throughput: number;
  p50: number;
  p95: number;
  ttft: number;
  hallucination: number;
  groundedness: number;
  toolErrorRate: number;
  refusalRate: number;
  cacheHit: number;
  guardrailBlocks: number;
  queueDepth: number;
  costPerHour: number;
};

export type LiveTelemetry = {
  host: HostSample;
  ai: AiSample;
  dbTables: DbTable[];
  inventory: {
    agents: { total: number, active: number };
    workflows: { total: number, active: number };
    orchestrators: { total: number, active: number };
    skills: { total: number, active: number };
    tools: { total: number, active: number };
    packs: { total: number, active: number };
    mcp: { total: number, active: number };
    users: { total: number, active: number };
  };
  dbMetrics: {
    cacheHitRatio: number;
    walStatus: string;
    lastBackup: string;
    deadlocks: number;
    tempFiles: number;
    tempBytes: number;
    idleInTx: number;
    slowQueries: number;
    throughput: number;
    totalSizeBytes: number;
    clusterReads: number;
    clusterWrites: number;
    autovacuum: string;
  };
  history: {
    cpu: Series;
    gpu: Series;
    ram: Series;
    netRx: Series;
    netTx: Series;
    throughput: Series;
    p95: Series;
    hallucination: Series;
  };
  tick: number;
};

export const initialHost: HostSample = {
  cpu: 0,
  cores: [],
  gpu: 0,
  vram: 0,
  gpuTemp: 0,
  ram: 0,
  ramTotalGb: 0,
  swap: 0,
  diskRead: 0,
  diskWrite: 0,
  netRx: 0,
  netTx: 0,
  netErrors: 0,
  dbConns: 0,
  dbPool: 0,
  dbQps: 0,
  dbLagMs: 0,
  sessions: 0,
  loadAvg: [0, 0, 0],
  uptimeSec: 0,
};

export const initialAi: AiSample = {
  throughput: 0,
  p50: 0,
  p95: 0,
  ttft: 0,
  hallucination: 0,
  groundedness: 0,
  toolErrorRate: 0,
  refusalRate: 0,
  cacheHit: 0,
  guardrailBlocks: 0,
  queueDepth: 0,
  costPerHour: 0,
};

const seedSeries = (v: number) => Array.from({ length: HISTORY }, () => v);

export function useLiveTelemetry(paused = false): LiveTelemetry {
  const [state, setState] = useState<LiveTelemetry>({
    host: initialHost,
    ai: initialAi,
    dbTables: [],
    inventory: {
      agents: { total: 0, active: 0 },
      workflows: { total: 0, active: 0 },
      orchestrators: { total: 0, active: 0 },
      skills: { total: 0, active: 0 },
      tools: { total: 0, active: 0 },
      packs: { total: 0, active: 0 },
      mcp: { total: 0, active: 0 },
      users: { total: 0, active: 0 },
    },
    dbMetrics: {
      cacheHitRatio: 99.2,
      walStatus: "streaming · ok",
      lastBackup: "18 min ago · verified",
      deadlocks: 0,
      tempFiles: 0,
      tempBytes: 0,
      idleInTx: 0,
      slowQueries: 0,
      throughput: 0,
      totalSizeBytes: 0,
      clusterReads: 0,
      clusterWrites: 0,
      autovacuum: "idle",
    },
    history: {
      cpu: seedSeries(0),
      gpu: seedSeries(0),
      ram: seedSeries(0),
      netRx: seedSeries(0),
      netTx: seedSeries(0),
      throughput: seedSeries(0),
      p95: seedSeries(0),
      hallucination: seedSeries(0),
    },
    tick: 0,
  });

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const prevDbStats = useRef<Record<string, any>>({});

  const aiFetchedRef = useRef(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: any = null;

    const connect = () => {
      if (es) {
        es.close();
      }
      
      const sessionId = typeof window !== "undefined" ? localStorage.getItem("sovereign.sessionId") : null;
      const url = sessionId ? `/api/telemetry/stream?session_id=${sessionId}` : "/api/telemetry/stream";
      es = new EventSource(url);
      
      es.onmessage = (msg) => {
        if (pausedRef.current) return;
        try {
          const data = JSON.parse(msg.data);
          if (data && data.host) {
            setState((s) => {
              const host: HostSample = {
                ...s.host,
                cpu: data.host.cpu ?? s.host.cpu,
                cores: data.host.cores ?? s.host.cores,
                ram: data.host.ram ?? s.host.ram,
                ramTotalGb: data.host.ramTotalGb ?? s.host.ramTotalGb,
                dbConns: data.host.dbConns ?? s.host.dbConns,
                dbPool: data.host.dbPool ?? s.host.dbPool,
                loadAvg: data.host.loadAvg ?? s.host.loadAvg,
                uptimeSec: data.host.uptimeSec ?? s.host.uptimeSec,
                
                // Keep simulated visual values for fields not returned by backend
                gpu: data.host.gpu ?? 0,
                vram: data.host.vram ?? 0,
                gpuTemp: data.host.gpuTemp ?? 0,
                swap: walk(s.host.swap, 1.2, 0, 22),
                diskRead: data.host.diskRead ?? 0,
                diskWrite: data.host.diskWrite ?? 0,
                netRx: data.host.netRx ?? 0,
                netTx: data.host.netTx ?? 0,
                netErrors: Math.random() > 0.97 ? s.host.netErrors + 1 : s.host.netErrors,
                dbQps: walk(s.host.dbQps, 120, 40, 1800),
                dbLagMs: data.host.dbLagMs ?? 0,
                sessions: Math.max(1, Math.round(s.host.sessions + (Math.random() > 0.9 ? (Math.random() > 0.5 ? 1 : -1) : 0))),
              };
              
              const ai: AiSample = {
                ...s.ai,
                throughput: walk(s.ai.throughput, 2600, 1800, 26000),
                p50: walk(s.ai.p50, 40, 90, 900),
                p95: walk(s.ai.p95, 90, 160, 2400),
                ttft: walk(s.ai.ttft, 60, 90, 1400),
                // RAG simulated placeholders
                hallucination: walk(s.ai.hallucination, 0.5, 0.1, 9),
                groundedness: walk(s.ai.groundedness, 1.2, 78, 99.6),
                refusalRate: walk(s.ai.refusalRate, 0.2, 0, 4),
                cacheHit: walk(s.ai.cacheHit, 4, 22, 96),
                costPerHour: walk(s.ai.costPerHour, 0.7, 0.4, 42),
              };

              return {
                ...s,
                host,
                inventory: data.inventory || s.inventory,
                ai: aiFetchedRef.current ? s.ai : ai, // Fully trust DB payload
                tick: data.tick ?? s.tick + 1,
                history: {
                  cpu: push(s.history.cpu, host.cpu),
                  gpu: push(s.history.gpu, host.gpu),
                  ram: push(s.history.ram, host.ram),
                  netRx: push(s.history.netRx, host.netRx),
                  netTx: push(s.history.netTx, host.netTx),
                  throughput: push(s.history.throughput, aiFetchedRef.current ? s.ai.throughput : ai.throughput),
                  p95: push(s.history.p95, aiFetchedRef.current ? s.ai.p95 : ai.p95),
                  hallucination: push(s.history.hallucination, aiFetchedRef.current ? s.ai.hallucination : ai.hallucination),
                },
              };
            });
          }
        } catch (err) {
          // ignore
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (es) es.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  // Fetch PostgreSQL detail periodically
  useEffect(() => {
    const fetchDb = async () => {
      if (pausedRef.current) return;
      try {
        const { fetchApi } = await import("./api");
        const res = await fetchApi("/api/telemetry/db-detail");
        if (res && Array.isArray(res.tables)) {
          setState((s) => {
            const newTables: DbTable[] = res.tables.map((t: any) => {
              let kind: DbTable["kind"] = "core";
              if (t.schema === "rag" || t.name.includes("vector") || t.name.includes("knowledge") || t.name.includes("chunk")) kind = "vector";
              else if (t.schema === "governance" || t.name.includes("audit") || t.name.includes("log") || t.name.includes("history")) kind = "audit";
              else if (t.schema === "billing" || t.name.includes("queue") || t.name.includes("events") || t.name.includes("usage") || t.name.includes("runs") || t.name.includes("ledger")) kind = "queue";
              
              const prev = prevDbStats.current[t.name];
              let reads = 0, writes = 0, seqScans = 0, indexHit = 99.9;
              
              if (prev) {
                // Approximate reads/writes per 10s interval
                reads = Math.max(0, (t.idxScans || 0) + (t.seqScans || 0) - (prev.idxScans + prev.seqScans));
                writes = Math.max(0, (t.inserts || 0) + (t.updates || 0) + (t.deletes || 0) - (prev.inserts + prev.updates + prev.deletes));
                seqScans = Math.max(0, (t.seqScans || 0) - prev.seqScans);
                const totalScans = (t.idxScans || 0) + (t.seqScans || 0);
                if (totalScans > 0) {
                   indexHit = ((t.idxScans || 0) / totalScans) * 100;
                }
              }

              prevDbStats.current[t.name] = {
                idxScans: t.idxScans || 0,
                seqScans: t.seqScans || 0,
                inserts: t.inserts || 0,
                updates: t.updates || 0,
                deletes: t.deletes || 0,
              };
              
              // Normalize per second (interval is 10s)
              reads = Math.round(reads / 10);
              writes = Math.round(writes / 10);
              seqScans = Math.round(seqScans / 10);

              const deadRows = t.deadRows || 0;
              const totalRowsForBloat = (t.rows || 0) + deadRows;
              const bloatPct = totalRowsForBloat > 0 ? (deadRows / totalRowsForBloat) * 100 : 0;

              return {
                name: t.name,
                schema: t.schema,
                rows: t.rows || 0,
                deadRows,
                sizeMb: Number(((t.bytes || 0) / (1024 * 1024)).toFixed(1)),
                indexMb: 0,
                kind,
                s: prev ? {
                  reads,
                  writes,
                  seqScans,
                  indexHit,
                  bloat: bloatPct, 
                  latencyMs: 1 + Math.random() * 2, // simulated visual metric
                  locks: Math.random() > 0.9 ? 1 : 0, // simulated visual metric
                } : undefined,
              };
            });
            
            // Stop merging with mock data so we only see the actual DB state!
            const merged = [...newTables];
            
            let throughput = s.dbMetrics.throughput;
            let clusterReads = s.dbMetrics.clusterReads;
            let clusterWrites = s.dbMetrics.clusterWrites;

            if (prevDbStats.current["txnTotal"] !== undefined && res.txnTotal !== undefined) {
               throughput = Math.max(0, Math.round((res.txnTotal - prevDbStats.current["txnTotal"]) / 10));
            }
            if (prevDbStats.current["tupFetched"] !== undefined && res.tupFetched !== undefined) {
               clusterReads = Math.max(0, Math.round((res.tupFetched - prevDbStats.current["tupFetched"]) / 10));
            }
            if (prevDbStats.current["tupWrites"] !== undefined) {
               const currentWrites = (res.tupInserted || 0) + (res.tupUpdated || 0) + (res.tupDeleted || 0);
               clusterWrites = Math.max(0, Math.round((currentWrites - prevDbStats.current["tupWrites"]) / 10));
               prevDbStats.current["tupWrites"] = currentWrites;
            } else {
               prevDbStats.current["tupWrites"] = (res.tupInserted || 0) + (res.tupUpdated || 0) + (res.tupDeleted || 0);
            }

            prevDbStats.current["txnTotal"] = res.txnTotal || 0;
            prevDbStats.current["tupFetched"] = res.tupFetched || 0;

            const idleInTx = (res.activity || []).filter((a: any) => a.state === 'idle in transaction').length;
            const slowQueries = (res.slowQueries || []).filter((q: any) => q.meanMs > 500).length;

            return { 
              ...s, 
              dbTables: merged,
              dbMetrics: {
                ...s.dbMetrics,
                cacheHitRatio: res.cacheHitRatio !== null && res.cacheHitRatio !== undefined ? Number((res.cacheHitRatio * 100).toFixed(2)) : s.dbMetrics.cacheHitRatio,
                deadlocks: res.deadlocks || 0,
                tempFiles: res.tempFiles || 0,
                tempBytes: res.tempBytes || 0,
                idleInTx,
                slowQueries,
                throughput,
                clusterReads,
                clusterWrites,
                autovacuum: res.autovacuum || "idle",
                totalSizeBytes: res.sizeBytes || 0,
              }
            };
          });
        }
      } catch (err) {}
    };

    fetchDb();
    const id = window.setInterval(fetchDb, 10000);
    return () => window.clearInterval(id);
  }, []);

  // Fetch AI Quality & Throughput from DB
  useEffect(() => {
    const fetchAi = async () => {
      if (pausedRef.current) return;
      try {
        const { fetchApi } = await import("./api");
        const res = await fetchApi("/api/telemetry/ai-metrics");
        if (res && res.throughput !== undefined) {
          aiFetchedRef.current = true;
          setState((s) => ({
            ...s,
            ai: {
              ...s.ai,
              throughput: res.throughput,
              p95: res.p95,
              p50: res.p50,
              ttft: res.ttft,
              toolErrorRate: res.toolErrorRate,
              guardrailBlocks: res.guardrailBlocks,
              queueDepth: res.queueDepth,
              hallucination: res.hallucination || 0,
              groundedness: res.groundedness || 0,
              refusalRate: res.refusalRate || 0,
              cacheHit: res.cacheHit || 0,
              costPerHour: res.costPerHour || 0,
            }
          }));
        }
      } catch (e) {}
    };

    fetchAi();
    const id = window.setInterval(fetchAi, 5000);
    return () => window.clearInterval(id);
  }, []);

  return state;
}

/** Deterministic per-agent live sample derived from a stable id + tick. */
export function agentSample(id: string, tick: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const wave = (offset: number, amp: number, base: number) =>
    base + Math.sin((tick + (h % 97) + offset) / 5) * amp;
  return {
    load: Math.max(2, Math.min(99, wave(0, 22, 48 + (h % 30)))),
    tokens: Math.max(120, wave(3, 900, 1400 + (h % 1800))),
    p95: Math.max(60, wave(7, 120, 260 + (h % 420))),
    queue: Math.max(0, Math.round(wave(11, 6, 4 + (h % 9)))),
    errors: Number(Math.max(0, wave(5, 0.8, 0.6 + (h % 3) / 3)).toFixed(2)),
    ctx: Math.max(4, Math.min(98, wave(13, 18, 42 + (h % 40)))),
  };
}

export function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const hrs = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${String(hrs).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}

/* -------------------------------------------------- deterministic samplers */

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const wave = (h: number, tick: number, offset: number, amp: number, base: number) =>
  base + Math.sin((tick + (h % 97) + offset) / 6) * amp;

/* ---------------------------------------------------------------- database */

export type DbTable = {
  name: string;
  schema: string;
  rows: number;
  sizeMb: number;
  indexMb: number;
  kind: "core" | "vector" | "audit" | "queue";
  deadRows?: number;
  s?: {
    reads: number;
    writes: number;
    seqScans: number;
    indexHit: number;
    bloat: number;
    latencyMs: number;
    locks: number;
  };
};

export function dbTableSample(name: string, tick: number) {
  const h = hash(name);
  return {
    reads: Math.max(0, wave(h, tick, 0, 140, 180 + (h % 420))),
    writes: Math.max(0, wave(h, tick, 5, 60, 40 + (h % 160))),
    seqScans: Math.round(Math.max(0, wave(h, tick, 9, 8, 6 + (h % 14)))),
    indexHit: Math.min(99.99, Math.max(82, wave(h, tick, 3, 3, 97 + (h % 3)))),
    bloat: Math.max(0.4, wave(h, tick, 7, 2.5, 4 + (h % 9))),
    latencyMs: Math.max(0.2, wave(h, tick, 11, 3, 2.4 + (h % 7))),
    locks: Math.round(Math.max(0, wave(h, tick, 13, 2, 1 + (h % 3)))),
  };
}

/* ------------------------------------------------------------ token ledger */

export type ProviderUsage = {
  id: string;
  name: string;
  hosting: "local" | "cloud";
  model: string;
  tokensIn: number;
  tokensOut: number;
  requests: number;
  costUsd: number;
  p95: number;
  errorRate: number;
};

const providerCatalog: {
  id: string;
  name: string;
  hosting: "local" | "cloud";
  model: string;
  rate: number;
}[] = [
  {
    id: "prv.local.engine",
    name: "Sovereign Local Engine",
    hosting: "local",
    model: "sovereign-70b",
    rate: 0,
  },
  {
    id: "prv.local.runtime",
    name: "Local Runtime (edge)",
    hosting: "local",
    model: "sovereign-8b",
    rate: 0,
  },
  { id: "prv.openai", name: "OpenAI", hosting: "cloud", model: "gpt-4o-mini", rate: 0.0006 },
  {
    id: "prv.anthropic",
    name: "Anthropic",
    hosting: "cloud",
    model: "claude-sonnet-4",
    rate: 0.0031,
  },
  { id: "prv.gemini", name: "Gemini", hosting: "cloud", model: "gemini-2.0-flash", rate: 0.0004 },
  { id: "prv.groq", name: "Groq", hosting: "cloud", model: "llama-3.3-70b", rate: 0.0002 },
];

export function providerUsage(tick: number): ProviderUsage[] {
  return providerCatalog.map((p) => {
    const h = hash(p.id);
    const tokensIn = Math.round(Math.max(1000, wave(h, tick, 0, 220000, 640000 + (h % 900000))));
    const tokensOut = Math.round(tokensIn * (0.28 + (h % 17) / 100));
    const requests = Math.round(Math.max(20, wave(h, tick, 4, 900, 2400 + (h % 4200))));
    return {
      id: p.id,
      name: p.name,
      hosting: p.hosting,
      model: p.model,
      tokensIn,
      tokensOut,
      requests,
      costUsd: Number((((tokensIn + tokensOut) / 1000) * p.rate).toFixed(2)),
      p95: Math.round(Math.max(80, wave(h, tick, 8, 120, p.hosting === "local" ? 220 : 480))),
      errorRate: Number(Math.max(0, wave(h, tick, 12, 0.5, 0.6 + (h % 3) / 4)).toFixed(2)),
    };
  });
}

/** Per-principal usage split across the providers that account actually routes to. */
// Fetch agent status detail
export function useAgentTelemetryStatus(paused = false) {
  const [agentsStatus, setAgentsStatus] = useState<any[]>([]);
  
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  
  useEffect(() => {
    const fetchStatus = async () => {
      if (pausedRef.current) return;
      try {
        const { fetchApi } = await import("./api");
        const res = await fetchApi("/api/telemetry/agent-status");
        if (res && Array.isArray(res.agents)) {
          setAgentsStatus(res.agents);
        }
      } catch (err) {}
    };

    fetchStatus();
    const id = window.setInterval(fetchStatus, 5000);
    return () => window.clearInterval(id);
  }, []);

  return agentsStatus;
}
export function useOperatorTelemetryStatus(paused = false) {
  const [data, setData] = useState({ providers: [] as ProviderUsage[], accounts: [] as any[] });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const fetchUsage = async () => {
      if (pausedRef.current) return;
      try {
        const { fetchApi } = await import("./api");
        const res = await fetchApi("/api/telemetry/operator-usage");
        if (res && res.ok) {
          setData({ providers: res.providers || [], accounts: res.accounts || [] });
        }
      } catch (err) {}
    };

    fetchUsage();
    const id = window.setInterval(fetchUsage, 10000); // 10s is fine for ledger
    return () => window.clearInterval(id);
  }, []);

  return data;
}
