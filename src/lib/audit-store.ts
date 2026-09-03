/**
 * Unified audit + log spine for ELARA Sovereign Studio.
 * Every system / operator action lands in PostgreSQL `agent_logs` / `audit_events`
 * and streams to the UI via Server-Sent Events (/api/audit/stream).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listDenyEvents, onDenyEvent, type DenyEvent } from "./deny-events";
import { listRbacEvents, onRbacEvent, type RbacEvent } from "./rbac-events";
import { listPlannerEvents, onPlannerEvent, type PlannerEvent } from "./planner-events";
import { fetchApi } from "./api";

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
  "admin",
  "system",
  "scheduler",
  "mcp://vault",
  "agent://forge_master",
  "agent://orchestrator",
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

export type RawLogRecord = {
  id?: string | number;
  thread_id?: string | null;
  agent?: string;
  level?: string;
  message?: string;
  meta?: {
    actor?: string;
    stream?: string;
    provider?: string;
    detail?: string;
    error?: string;
    step?: string | number;
    ms?: number;
    ip?: string;
    reqId?: string;
    [key: string]: unknown;
  } | null;
  created_at?: string | number | null;
  ts?: number;
  actor?: string;
};

/** Parse and format raw log items into clean, human-readable AuditEvent */
export function normalizeRawLog(data: RawLogRecord): AuditEvent {
  const meta = typeof data.meta === "object" && data.meta !== null ? data.meta : {};
  const rawMsg = String(data.message || "");

  let action = "log";
  let target = String(data.agent || "system");
  let detail = rawMsg;

  if (rawMsg.includes(":")) {
    const colonIdx = rawMsg.indexOf(":");
    action = rawMsg.slice(0, colonIdx).trim();
    const rest = rawMsg.slice(colonIdx + 1).trim();
    if (rest) target = rest;
  }

  // Format clean detail description
  if (action === "login") {
    const provider = meta.provider ? `via ${meta.provider} provider` : "";
    detail = `Session authenticated successfully ${provider}`.trim();
  } else if (meta.detail && typeof meta.detail === "string") {
    detail = meta.detail;
  } else if (meta.error) {
    detail = `Error: ${meta.error}`;
  } else if (meta.step) {
    detail = `Step ${meta.step} · ${meta.ms ? `${meta.ms}ms` : "completed"}`;
  } else if (rawMsg.includes(":") && rawMsg.length > action.length + target.length + 2) {
    detail = rawMsg;
  }

  let stream = "system";
  if (data.agent === "checkpoint" || data.agent === "system") {
    stream = meta.stream || "system";
  } else if (data.agent === "auth" || action === "login" || action === "logout") {
    stream = "auth";
  } else if (data.agent === "chain" || data.agent === "workflow") {
    stream = "workflows";
  } else if (data.agent === "rbac") {
    stream = "rbac";
  } else if (data.agent === "vault") {
    stream = "secrets";
  } else if (data.agent === "mcp") {
    stream = "mcp";
  } else if (data.agent === "rag") {
    stream = "rag";
  } else if (meta.stream) {
    stream = meta.stream;
  }

  const lvl: Severity =
    data.level === "warn" || data.level === "warning"
      ? "warn"
      : data.level === "error"
        ? "error"
        : data.level === "debug"
          ? "debug"
          : data.level === "critical"
            ? "critical"
            : data.level === "notice"
              ? "notice"
              : "info";

  return {
    id: `log_${data.id || Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: data.created_at ? new Date(data.created_at).getTime() : data.ts || Date.now(),
    stream,
    severity: lvl,
    actor: meta.actor || data.actor || "system",
    action,
    target,
    detail,
    ip: meta.ip || "127.0.0.1",
    reqId: data.thread_id || meta.reqId || "-",
  };
}

/** Fold a planner turn into the journal */
function plannerToAudit(e: PlannerEvent): AuditEvent {
  const detail =
    e.action === "planner.blocked"
      ? `Tool scope blocked: ${e.blocked.join(", ")}`
      : e.action === "planner.scope"
        ? `Scope updated → ${e.tools.join(", ") || "none"}`
        : `${e.mode} plan · tools: ${e.tools.join(", ") || "none"} · "${e.question}"`;
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

/** Normalize an RBAC mutation into a journal record */
function rbacToAudit(e: RbacEvent): AuditEvent {
  const severe =
    e.action === "rbac.grant" ||
    e.action === "rbac.role.delete" ||
    e.action === "rbac.action.grant" ||
    e.action === "rbac.denied";
  return {
    id: e.id,
    at: e.at,
    stream: "rbac",
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
  workflow: "workflows",
};

/** Normalize a bridge deny-list mutation into a journal record */
function denyToAudit(e: DenyEvent): AuditEvent {
  return {
    id: e.id,
    at: e.at,
    stream: denyStreamFor[e.category] || "policy",
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

export function useAuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [live, setLive] = useState(false);
  const [retention, setRetention] = useState<WindowId>("30d");
  const liveRef = useRef(live);
  liveRef.current = live;

  // Initial load of historical records from PostgreSQL
  useEffect(() => {
    let active = true;

    const fetchHistory = async () => {
      try {
        const res = await fetchApi("/logs?limit=400");
        if (Array.isArray(res) && active) {
          const history = res.map(normalizeRawLog);
          setEvents((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            const fresh = history.filter((h) => !existingIds.has(h.id));
            return [...fresh, ...prev].sort((a, b) => b.at - a.at).slice(0, 4000);
          });
        }
      } catch (err) {
        console.error("[useAuditLog] Failed to fetch audit history:", err);
      }
    };

    fetchHistory();

    const denials = listDenyEvents().map(denyToAudit);
    const rbac = listRbacEvents().map(rbacToAudit);
    const planner = listPlannerEvents().map(plannerToAudit);
    setEvents((prev) => [...denials, ...rbac, ...planner, ...prev].sort((a, b) => b.at - a.at));

    const offDeny = onDenyEvent((e) =>
      setEvents((prev) => [denyToAudit(e), ...prev].slice(0, 4000)),
    );
    const offRbac = onRbacEvent((e) =>
      setEvents((prev) => [rbacToAudit(e), ...prev].slice(0, 4000)),
    );
    const offPlanner = onPlannerEvent((e) =>
      setEvents((prev) => [plannerToAudit(e), ...prev].slice(0, 4000)),
    );

    return () => {
      active = false;
      offDeny();
      offRbac();
      offPlanner();
    };
  }, []);

  // SSE stream connection when LIVE is turned on
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connect = () => {
      if (!liveRef.current) return;
      if (es) {
        es.close();
      }

      const sessionId =
        typeof window !== "undefined" ? localStorage.getItem("sovereign.sessionId") : null;
      const url = sessionId ? `/api/audit/stream?session_id=${sessionId}` : "/api/audit/stream";
      es = new EventSource(url);

      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (
            data &&
            data.message !== "stream.heartbeat" &&
            data.message !== "Audit feed connected"
          ) {
            const ev = normalizeRawLog(data);
            setEvents((prev) => [ev, ...prev].slice(0, 4000));
          }
        } catch (err) {
          console.error("[useAuditLog] SSE parse error:", err);
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
    }

    return () => {
      if (es) (es as EventSource).close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [live]);

  // Rotation: prune events exceeding the retention threshold
  useEffect(() => {
    const ms = windows.find((w) => w.id === retention)?.ms ?? 0;
    const id = window.setInterval(() => {
      const cut = Date.now() - ms;
      setEvents((prev) => prev.filter((e) => e.at >= cut));
    }, 15_000);
    return () => window.clearInterval(id);
  }, [retention]);

  // Purge buffer locally and in PostgreSQL
  const purge = useCallback(async () => {
    setEvents([]);
    try {
      await fetchApi("/logs/purge", { method: "POST" });
    } catch (err) {
      console.warn("[useAuditLog] Remote log purge notice:", err);
    }
  }, []);

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

export function fmtTs(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function toCsv(rows: AuditEvent[]): string {
  const headers = [
    "Timestamp",
    "Level",
    "Stream",
    "Actor",
    "Action",
    "Target",
    "Detail",
    "IP",
    "ReqId",
  ];
  const lines = rows.map((r) =>
    [fmtTs(r.at), r.severity, r.stream, r.actor, r.action, r.target, r.detail, r.ip, r.reqId]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

export function toNdjson(rows: AuditEvent[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

export function toTxt(rows: AuditEvent[]): string {
  return rows
    .map(
      (r) =>
        `[${fmtTs(r.at)}] [${r.severity.toUpperCase().padEnd(5)}] [${r.stream.padEnd(8)}] ${r.actor} -> ${r.action} (${r.target}): ${r.detail}`,
    )
    .join("\n");
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
