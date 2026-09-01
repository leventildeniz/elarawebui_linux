import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listDenyEvents, onDenyEvent, type DenyEvent } from "./deny-events";
import { listRbacEvents, onRbacEvent, type RbacEvent } from "./rbac-events";
import { listPlannerEvents, onPlannerEvent, type PlannerEvent } from "./planner-events";

/** Fold a planner turn (shadow or active) into the journal. */
function plannerToAudit(e: PlannerEvent): AuditEvent {
  const detail =
    e.action === "planner.blocked"
      ? `tool scope blocked ${e.blocked.join(", ")}`
      : e.action === "planner.scope"
        ? `scope updated → ${e.tools.join(", ") || "none"}`
        : `${e.mode} plan · tools ${e.tools.join(", ") || "none"} · ${e.grounded ? "grounded" : "ungrounded"} · "${e.question}"`;
  return {
    id: e.id,
    at: e.at,
    stream: "agents",
    severity: e.action === "planner.blocked" ? "warn" : e.mode === "shadow" ? "debug" : "info",
    actor: `operator://${e.actor}`,
    action: e.action,
    target: e.plannerName,
    detail,
    ip: "127.0.0.1",
    reqId: e.id.slice(-8),
  };
}

/** Normalize an RBAC grant/revoke mutation into a journal record. */
function rbacToAudit(e: RbacEvent): AuditEvent {
  const severe =
    e.action === "rbac.grant" ||
    e.action === "rbac.role.delete" ||
    e.action === "rbac.action.grant" ||
    e.action === "rbac.denied";
  return {
    id: e.id,
    at: e.at,
    stream: "policy",
    severity: e.action === "rbac.denied" ? "error" : severe ? "warn" : "notice",
    actor: e.actor,
    action: e.action,
    target: `role:${e.role}→${e.target}`,
    detail: e.detail,
    ip: "127.0.0.1",
    reqId: e.id.slice(-8),
  };
}

const denyStreamFor: Record<DenyEvent["category"], string> = {
  agent: "agents",
  tool: "policy",
  skill: "policy",
  mcp: "mcp",
  workflow: "policy",
};

/** Normalize a bridge deny-list mutation into a journal record. */
function denyToAudit(e: DenyEvent): AuditEvent {
  return {
    id: e.id,
    at: e.at,
    stream: denyStreamFor[e.category],
    severity:
      e.action === "deny.add" || e.action === "signature.warned"
        ? "warn"
        : e.action === "signature.denied"
          ? "error"
          : "notice",
    actor: e.actor,
    action: e.action,
    target: `${e.category}:${e.target}`,
    detail: e.detail,
    ip: "127.0.0.1",
    reqId: e.id.slice(-8),
  };
}

/**
 * Unified audit + log spine.
 * Every system / operator action lands here as a normalized record so the
 * Logs / Audit workspace can slice it by stream, severity, actor and window.
 * Events are simulated locally (no backend yet) but shaped like a real
 * append-only journal: monotonic ids, UTC timestamps, retention pruning.
 */

export type Severity = "debug" | "info" | "notice" | "warn" | "error" | "critical";

export type AuditEvent = {
  id: string;
  at: number;
  stream: string;
  severity: Severity;
  actor: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
  reqId: string;
};

export const auditStreams = [
  "auth",
  "rbac",
  "policy",
  "secrets",
  "agents",
  "workflows",
  "models",
  "rag",
  "mcp",
  "system",
  "billing",
] as const;

export const severities: Severity[] = ["debug", "info", "notice", "warn", "error", "critical"];

export const severityTone: Record<Severity, string> = {
  debug: "text-muted-foreground/50",
  info: "text-sapphire/80",
  notice: "text-amethyst/80",
  warn: "text-topaz/85",
  error: "text-ruby/85",
  critical: "text-ruby",
};

export const severityRank: Record<Severity, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warn: 3,
  error: 4,
  critical: 5,
};

/** retention / rotation windows */
export const windows = [
  { id: "15m", label: "Last 15 minutes", ms: 15 * 60_000 },
  { id: "1h", label: "Last hour", ms: 60 * 60_000 },
  { id: "4h", label: "Last 4 hours", ms: 4 * 60 * 60_000 },
  { id: "12h", label: "Last 12 hours", ms: 12 * 60 * 60_000 },
  { id: "24h", label: "Last 24 hours", ms: 24 * 60 * 60_000 },
  { id: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60_000 },
  { id: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60_000 },
] as const;

export type WindowId = (typeof windows)[number]["id"];

export const actors = [
  "levent@elara",
  "sysadmin@elara",
  "ops.runner",
  "agent://planner-01",
  "agent://forge-03",
  "scheduler",
  "mcp://vault",
];



export type AuditFilter = {
  window: WindowId;
  streams: string[];
  minSeverity: Severity;
  actor: string;
  query: string;
};

export const defaultFilter: AuditFilter = {
  window: "4h",
  streams: [],
  minSeverity: "debug",
  actor: "",
  query: "",
};

export function useAuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  /** tail is held by default — the operator arms it explicitly */
  const [live, setLive] = useState(false);
  const [retention, setRetention] = useState<WindowId>("30d");
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    // Fetch initial historical events from DB
    const fetchHistory = async () => {
      try {
        const { fetchApi } = await import("./api");
        const res = await fetchApi("/api/logs?limit=200");
        if (Array.isArray(res)) {
          const history = res.map((data: any) => ({
            id: `log_${data.id || Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            at: new Date(data.created_at || Date.now()).getTime(),
            stream: data.agent === "checkpoint" ? "system" : (data.agent === "chain" ? "workflows" : (data.meta?.stream || data.agent || "system")),
            severity: (data.level === "warn" ? "warn" : 
                       data.level === "error" ? "error" : 
                       data.level === "debug" ? "debug" : 
                       data.level === "critical" ? "critical" : "info") as Severity,
            actor: data.meta?.actor || "system",
            action: typeof data.message === "string" && data.message.includes(":") ? data.message.split(":")[0].trim() : "log",
            target: data.agent,
            detail: typeof data.message === "string" && data.message.includes(":")
                      ? `${data.message.substring(data.message.indexOf(":") + 1).trim()} — ${typeof data.meta === "object" && data.meta ? JSON.stringify(data.meta) : ""}`
                      : (typeof data.meta === "object" && data.meta ? JSON.stringify(data.meta) : data.message),
            ip: "127.0.0.1",
            reqId: data.thread_id || "-",
          }));
          
          setEvents((prev) => {
            const existingIds = new Set(prev.map(e => e.id));
            const newEvents = history.filter((h: any) => !existingIds.has(h.id));
            return [...prev, ...newEvents].sort((a, b) => b.at - a.at).slice(0, 4000);
          });
        }
      } catch (err) {
        console.error("Failed to fetch audit history", err);
      }
    };
    
    fetchHistory();

    // Keep initial system events but don't seed dummy data
    const denials = listDenyEvents().map(denyToAudit);
    const rbac = listRbacEvents().map(rbacToAudit);
    const planner = listPlannerEvents().map(plannerToAudit);
    
    setEvents([...denials, ...rbac, ...planner].sort((a, b) => b.at - a.at));
    
    const offDeny = onDenyEvent((e) =>
      setEvents((prev) => [denyToAudit(e), ...prev].slice(0, 4000)),
    );
    const offRbac = onRbacEvent((e) =>
      setEvents((prev) => [rbacToAudit(e), ...prev].slice(0, 4000)),
    );
    const offPlanner = onPlannerEvent((e) =>
      setEvents((prev) => [plannerToAudit(e), ...prev].slice(0, 4000)),
    );

    let es: EventSource | null = null;
    let reconnectTimer: any = null;

    const connect = () => {
      if (!liveRef.current) return;
      if (es) {
        es.close();
      }

      // Connect to the backend SSE log stream
      const sessionId = typeof window !== "undefined" ? localStorage.getItem("sovereign.sessionId") : null;
      const url = sessionId ? `/api/audit/stream?session_id=${sessionId}` : "/api/audit/stream";
      es = new EventSource(url);
      
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          
          // Map backend logs (agent_logs/checkpoint schema) to AuditEvent
          if (data && data.message !== "stream.heartbeat" && data.message !== "Audit feed connected") {
            const ev: AuditEvent = {
              id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              at: data.ts || Date.now(),
              stream: data.agent === "checkpoint" ? "system" : (data.agent === "chain" ? "workflows" : (data.meta?.stream || data.agent || "system")),
              severity: (data.level === "warn" ? "warn" : 
                         data.level === "error" ? "error" : 
                         data.level === "debug" ? "debug" : 
                         data.level === "critical" ? "critical" : "info"),
              actor: data.meta?.actor || "system",
              action: data.message.includes(":") ? data.message.split(":")[0].trim() : "log",
              target: data.agent,
              detail: data.message.includes(":") 
                        ? `${data.message.substring(data.message.indexOf(":") + 1).trim()} — ${typeof data.meta === "object" && data.meta ? JSON.stringify(data.meta) : ""}`
                        : (typeof data.meta === "object" && data.meta ? JSON.stringify(data.meta) : data.message),
              ip: "127.0.0.1",
              reqId: data.thread_id || "-",
            };
            setEvents((prev) => [ev, ...prev].slice(0, 4000));
          }
        } catch (err) {
          console.error("SSE parse error", err);
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (liveRef.current) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    if (live) {
      connect();
    } else {
      if (es) {
        (es as EventSource).close();
        es = null;
      }
      clearTimeout(reconnectTimer);
    }

    return () => {
      offDeny();
      offRbac();
      offPlanner();
      if (es) es.close();
      clearTimeout(reconnectTimer);
    };
  }, [live]);



  /** rotation: physically drop anything older than the retention policy */
  useEffect(() => {
    const ms = windows.find((w) => w.id === retention)?.ms ?? 0;
    const id = window.setInterval(() => {
      const cut = Date.now() - ms;
      setEvents((prev) => prev.filter((e) => e.at >= cut));
    }, 10_000);
    return () => window.clearInterval(id);
  }, [retention]);

  const purge = useCallback(() => setEvents([]), []);

  return { events, live, setLive, retention, setRetention, purge };
}

export function filterEvents(events: AuditEvent[], f: AuditFilter): AuditEvent[] {
  const ms = windows.find((w) => w.id === f.window)?.ms ?? 0;
  const cut = Date.now() - ms;
  const min = severityRank[f.minSeverity];
  const q = f.query.trim().toLowerCase();
  return events.filter((e) => {
    if (e.at < cut) return false;
    if (f.streams.length && !f.streams.includes(e.stream)) return false;
    if (severityRank[e.severity] < min) return false;
    if (f.actor && e.actor !== f.actor) return false;
    if (q) {
      const hay = `${e.actor} ${e.action} ${e.target} ${e.detail} ${e.ip} ${e.reqId}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function useAuditSlice(events: AuditEvent[], filter: AuditFilter) {
  return useMemo(() => filterEvents(events, filter), [events, filter]);
}

export function fmtTs(at: number) {
  const d = new Date(at);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function toNdjson(rows: AuditEvent[]) {
  return rows.map((r) => JSON.stringify({ ...r, ts: new Date(r.at).toISOString() })).join("\n");
}

export function toCsv(rows: AuditEvent[]) {
  const head = "ts,severity,stream,actor,action,target,detail,ip,req_id";
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    head,
    ...rows.map((r) =>
      [
        new Date(r.at).toISOString(),
        r.severity,
        r.stream,
        r.actor,
        r.action,
        r.target,
        r.detail,
        r.ip,
        r.reqId,
      ]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}

export function toTxt(rows: AuditEvent[]) {
  return rows
    .map(
      (r) =>
        `${fmtTs(r.at)}  ${r.severity.toUpperCase().padEnd(8)} ${r.stream.padEnd(10)} ${r.actor.padEnd(18)} ${r.action.padEnd(20)} ${r.target} — ${r.detail}  [${r.ip} req ${r.reqId}]`,
    )
    .join("\n");
}

export function download(name: string, body: string, mime: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
