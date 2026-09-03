/**
 * Per-operator activity rollups for the Reporting module.
 * Queries PostgreSQL via /api/reporting/operators while maintaining deterministic fallbacks
 * for SSR, hydration, and offline PDF generation.
 */

import { useEffect, useState } from "react";
import { readAccounts, type Account } from "@/lib/group-store";
import { periods, type Period } from "@/lib/report-store";
import { fetchApi } from "@/lib/api";

/** A reporting window: either a preset period or an explicit date range. */
export type Span = Period | { from: string; to: string };

const DAY = 86_400_000;

/** UTC midnight of today — stable between SSR and hydration. */
function todayUtc(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function resolveSpan(span: Span): { days: number; end: number; label: string } {
  if (typeof span === "string") {
    const p = periods.find((x) => x.id === span) ?? periods[1]!;
    return { days: p.days, end: todayUtc(), label: p.label };
  }
  const from = Date.parse(`${span.from}T00:00:00Z`);
  const to = Date.parse(`${span.to}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
    return { days: 30, end: todayUtc(), label: "Last 30 days" };
  }
  return {
    days: Math.max(1, Math.round((to - from) / DAY) + 1),
    end: to,
    label: `${span.from} → ${span.to}`,
  };
}

export function spanLabel(span: Span): string {
  return resolveSpan(span).label;
}

/** Filename/id safe slug for a span. */
export function spanSlug(span: Span): string {
  return typeof span === "string" ? span : `${span.from}_${span.to}`;
}

export type UserDay = { day: string; runs: number; tokens: number; cost: number };

export type WorkloadLine = {
  label: string;
  runs: number;
  tokens: number;
  cost: number;
  share: number;
};

export type UserReport = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  status: Account["status"];
  locked: boolean;
  provider?: string;
  groups?: string[];
  /** aggregate */
  runs: number;
  tokens: number;
  localTokens: number;
  cloudTokens: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  localCost: number;
  cloudCost: number;
  errors: number;
  successRate: number;
  latency: number;
  sessions: number;
  approvals: number;
  toolCalls: number;
  lastSeen: string;
  series: UserDay[];
  workloads: WorkloadLine[];
  models: WorkloadLine[];
  activity: { at: string; kind: string; detail: string; tokens: number; cost: number }[];
};

export function userReport(acc: Account, _span: Span): UserReport {
  return {
    id: acc.id,
    name: acc.name,
    username: acc.username,
    email: acc.email,
    role: acc.role,
    status: acc.status,
    locked: Boolean(acc.locked),
    runs: 0,
    tokens: 0,
    localTokens: 0,
    cloudTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    localCost: 0,
    cloudCost: 0,
    errors: 0,
    successRate: 100,
    latency: 0,
    sessions: 0,
    approvals: 0,
    toolCalls: 0,
    lastSeen: acc.lastSeen || "recently active",
    series: [],
    workloads: [{ label: "Sovereign chat", runs: 0, tokens: 0, cost: 0, share: 100 }],
    models: [{ label: "sovereign-local-runtime", runs: 0, tokens: 0, cost: 0, share: 100 }],
    activity: [],
  };
}

export type SortKey = "tokens" | "cost" | "runs" | "name";

export type RosterQuery = {
  topN?: number;
  sortBy?: SortKey;
  userIds?: string[];
  search?: string;
};

export function userReports(span: Span, query: RosterQuery = {}): UserReport[] {
  const { topN = 0, sortBy = "tokens", userIds, search } = query;
  let list = readAccounts().map((a) => userReport(a, span));

  if (userIds && userIds.length) list = list.filter((u) => userIds.includes(u.id));
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter((u) =>
      [u.name, u.username, u.email, u.role].some((f) => f.toLowerCase().includes(q)),
    );
  }

  list.sort((a, b) =>
    sortBy === "name"
      ? a.name.localeCompare(b.name)
      : (b[sortBy] as number) - (a[sortBy] as number),
  );

  return topN > 0 ? list.slice(0, topN) : list;
}

export function rosterTotals(list: UserReport[]) {
  return {
    operators: list.length,
    runs: list.reduce((a, r) => a + r.runs, 0),
    tokens: list.reduce((a, r) => a + r.tokens, 0),
    localTokens: list.reduce((a, r) => a + r.localTokens, 0),
    cloudTokens: list.reduce((a, r) => a + r.cloudTokens, 0),
    cost: Number(list.reduce((a, r) => a + r.cost, 0).toFixed(2)),
    cloudCost: Number(list.reduce((a, r) => a + r.cloudCost, 0).toFixed(2)),
  };
}

// ---------------------------------------------------------------------------
// Async Data Fetching Hook
// ---------------------------------------------------------------------------

export async function fetchOperatorReports(span: Span, query: RosterQuery = {}) {
  const q = new URLSearchParams();
  if (typeof span === "string") {
    q.set("span", span);
  } else {
    q.set("from", span.from);
    q.set("to", span.to);
  }

  if (query.topN) q.set("topN", String(query.topN));
  if (query.sortBy) q.set("sortBy", query.sortBy);
  if (query.search) q.set("search", query.search);
  if (query.userIds && query.userIds.length) q.set("userIds", query.userIds.join(","));

  return fetchApi(`/reporting/operators?${q.toString()}`);
}

export function useOperatorReports(span: Span, query: RosterQuery = {}) {
  const [data, setData] = useState<{
    operators: UserReport[];
    totals: ReturnType<typeof rosterTotals>;
    loading: boolean;
  }>({
    operators: [],
    totals: { operators: 0, runs: 0, tokens: 0, localTokens: 0, cloudTokens: 0, cost: 0, cloudCost: 0 },
    loading: true,
  });

  const spanKey = typeof span === "string" ? span : `${span.from}_${span.to}`;
  const queryKey = `${query.topN || 0}_${query.sortBy || "tokens"}_${query.search || ""}_${(query.userIds || []).join(",")}`;

  useEffect(() => {
    let active = true;
    setData((d) => ({ ...d, loading: true }));

    fetchOperatorReports(span, query)
      .then((res) => {
        if (!active || !res) return;
        setData({
          operators: res.operators || [],
          totals: res.totals || { operators: 0, runs: 0, tokens: 0, localTokens: 0, cloudTokens: 0, cost: 0, cloudCost: 0 },
          loading: false,
        });
      })
      .catch((err) => {
        console.error("[useOperatorReports] Failed to fetch operator report:", err);
        if (active) setData((d) => ({ ...d, loading: false }));
      });

    return () => {
      active = false;
    };
  }, [spanKey, queryKey]);

  return data;
}
