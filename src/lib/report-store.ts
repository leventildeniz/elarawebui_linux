/**
 * Reporting datasets — Live PostgreSQL-backed rollups for the ELARA Reporting module.
 * Feeds Overview, Usage, and FinOps Cost surfaces while keeping screen and PDF export in parity.
 */

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";

export type Period = "7d" | "30d" | "90d";

export const periods: { id: Period; label: string; days: number }[] = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
];

export const periodLabel = (p: Period) => periods.find((x) => x.id === p)?.label ?? "Last 30 days";

export type DayPoint = {
  day: string;
  runs: number;
  tokens: number;
  cost: number;
  errors: number;
  latency: number;
};

export type Totals = {
  runs: number;
  tokens: number;
  cost: number;
  errors: number;
  latency: number;
  successRate: number;
};

export type Breakdown = {
  label: string;
  runs: number;
  tokens: number;
  cost: number;
  share: number;
};

export type CostTariffs = {
  vectorStorageRate: number;
  objectStorageRate: number;
  gpuHourRate: number;
  egressRate: number;
};

export type CostLine = {
  item: string;
  category: "inference" | "infrastructure" | "storage" | "egress";
  unit: string;
  quantity: string;
  rate: string;
  amount: number;
};

export type ScheduledExport = {
  id: string;
  name: string;
  cadence: string;
  format: "PDF" | "CSV" | "JSON";
  destination: string;
  recipients: string;
  lastRun: string;
  nextRun: string;
  status: "healthy" | "warning" | "failed" | "idle";
};

export const fmtInt = (n: number) => (Number(n) || 0).toLocaleString("en-US");
export const fmtMoney = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtTokens = (n: number) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
};

export function totals(rows: DayPoint[]): Totals {
  const runs = rows.reduce((a, r) => a + r.runs, 0);
  const tokens = rows.reduce((a, r) => a + r.tokens, 0);
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const errors = rows.reduce((a, r) => a + r.errors, 0);
  const latency = Math.round(rows.reduce((a, r) => a + r.latency, 0) / Math.max(1, rows.length));
  return {
    runs,
    tokens,
    cost: Number(cost.toFixed(2)),
    errors,
    latency,
    successRate: Number((100 - (errors / Math.max(1, runs)) * 100).toFixed(2)),
  };
}

export function seriesRange(days: number, end: number): DayPoint[] {
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end - i * 86_400_000);
    out.push({
      day: d.toISOString().slice(0, 10),
      runs: 0,
      tokens: 0,
      cost: 0,
      errors: 0,
      latency: 0,
    });
  }
  return out;
}

export function series(period: Period): DayPoint[] {
  const days = periods.find((p) => p.id === period)?.days ?? 30;
  return seriesRange(days, Date.now());
}

export function byProvider(t: Totals): Breakdown[] {
  return [
    { label: "Local sovereign runtime", runs: t.runs, tokens: t.tokens, cost: t.cost, share: 100 },
  ];
}

export function bySquad(t: Totals): Breakdown[] {
  return [
    { label: "Platform engineering", runs: t.runs, tokens: t.tokens, cost: t.cost, share: 100 },
  ];
}

export function byWorkload(t: Totals): Breakdown[] {
  return [
    { label: "Chat orchestration", runs: t.runs, tokens: t.tokens, cost: t.cost, share: 100 },
  ];
}

export function costLines(t: Totals): CostLine[] {
  const m = t.tokens / 1_000_000;
  return [
    {
      item: "Cloud inference · input tokens",
      category: "inference",
      unit: "1M tokens",
      quantity: `${(m * 0.7).toFixed(2)}M`,
      rate: "$2.10",
      amount: Number((m * 0.7 * 2.1).toFixed(2)),
    },
    {
      item: "Cloud inference · output tokens",
      category: "inference",
      unit: "1M tokens",
      quantity: `${(m * 0.3).toFixed(2)}M`,
      rate: "$8.40",
      amount: Number((m * 0.3 * 8.4).toFixed(2)),
    },
    {
      item: "Local runtime GPU hours",
      category: "infrastructure",
      unit: "GPU-hour",
      quantity: `${(t.runs / 260).toFixed(1)}h`,
      rate: "$1.15",
      amount: Number(((t.runs / 260) * 1.15).toFixed(2)),
    },
    {
      item: "Vector store · resident index",
      category: "storage",
      unit: "GB-month",
      quantity: "1.0GB",
      rate: "$0.22",
      amount: 0.22,
    },
    {
      item: "Object storage · artefacts & exports",
      category: "storage",
      unit: "GB-month",
      quantity: "2.8GB",
      rate: "$0.021",
      amount: 0.06,
    },
    {
      item: "Egress · webhooks and deliveries",
      category: "egress",
      unit: "GB",
      quantity: "0.1GB",
      rate: "$0.08",
      amount: 0.01,
    },
  ];
}

// ---------------------------------------------------------------------------
// Async Data Fetchers
// ---------------------------------------------------------------------------

function buildQueryString(params: {
  span?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}): string {
  const q = new URLSearchParams();
  if (params.from && params.to) {
    q.set("from", params.from);
    q.set("to", params.to);
  } else if (params.span) {
    q.set("span", params.span);
  }
  const str = q.toString();
  return str ? `?${str}` : "";
}

export async function fetchOverviewReport(
  params: {
    span?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  } = {},
) {
  return fetchApi(`/reporting/overview${buildQueryString(params)}`);
}

export async function fetchUsageReport(
  params: {
    span?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  } = {},
) {
  return fetchApi(`/reporting/usage${buildQueryString(params)}`);
}

export async function fetchCostReport(
  params: {
    span?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  } = {},
) {
  return fetchApi(`/reporting/cost${buildQueryString(params)}`);
}

export async function fetchCostTariffs(): Promise<CostTariffs> {
  const res = await fetchApi("/reporting/cost/tariffs");
  return res?.tariffs || { vectorStorageRate: 0, objectStorageRate: 0, gpuHourRate: 0, egressRate: 0 };
}

export async function saveCostTariffs(tariffs: CostTariffs): Promise<CostTariffs> {
  const res = await fetchApi("/reporting/cost/tariffs", {
    method: "PUT",
    body: JSON.stringify(tariffs),
  });
  return res?.tariffs || tariffs;
}

// ---------------------------------------------------------------------------
// React Hooks for Live Data Hydration
// ---------------------------------------------------------------------------

export function useReportingOverview(params: {
  span?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  days?: number | undefined;
  end?: number | undefined;
}) {
  const [data, setData] = useState<{
    totals: Totals;
    rows: DayPoint[];
    squads: Breakdown[];
    providers: Breakdown[];
    loading: boolean;
  }>({
    totals: { runs: 0, tokens: 0, cost: 0, errors: 0, latency: 0, successRate: 100 },
    rows: [],
    squads: [],
    providers: [],
    loading: true,
  });

  useEffect(() => {
    let active = true;
    setData((d) => ({ ...d, loading: true }));

    fetchOverviewReport({ span: params.span, from: params.from, to: params.to })
      .then((res) => {
        if (!active || !res) return;
        setData({
          totals: res.totals || {
            runs: 0,
            tokens: 0,
            cost: 0,
            errors: 0,
            latency: 0,
            successRate: 100,
          },
          rows: res.rows || [],
          squads: res.squads || [],
          providers: res.providers || [],
          loading: false,
        });
      })
      .catch((err) => {
        console.error("[useReportingOverview] Failed to fetch overview data:", err);
        if (active) setData((d) => ({ ...d, loading: false }));
      });

    return () => {
      active = false;
    };
  }, [params.span, params.from, params.to]);

  return data;
}

export function useReportingUsage(params: {
  span?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  days?: number | undefined;
  end?: number | undefined;
}) {
  const [data, setData] = useState<{
    totals: Totals;
    peak: DayPoint;
    rows: DayPoint[];
    workloads: Breakdown[];
    providers: Breakdown[];
    squads: Breakdown[];
    loading: boolean;
  }>({
    totals: { runs: 0, tokens: 0, cost: 0, errors: 0, latency: 0, successRate: 100 },
    peak: { day: "—", runs: 0, tokens: 0, cost: 0, errors: 0, latency: 0 },
    rows: [],
    workloads: [],
    providers: [],
    squads: [],
    loading: true,
  });

  useEffect(() => {
    let active = true;
    setData((d) => ({ ...d, loading: true }));

    fetchUsageReport({ span: params.span, from: params.from, to: params.to })
      .then((res) => {
        if (!active || !res) return;
        setData({
          totals: res.totals || {
            runs: 0,
            tokens: 0,
            cost: 0,
            errors: 0,
            latency: 0,
            successRate: 100,
          },
          peak: res.peak || { day: "—", runs: 0, tokens: 0, cost: 0, errors: 0, latency: 0 },
          rows: res.rows || [],
          workloads: res.workloads || [],
          providers: res.providers || [],
          squads: res.squads || [],
          loading: false,
        });
      })
      .catch((err) => {
        console.error("[useReportingUsage] Failed to fetch usage data:", err);
        if (active) setData((d) => ({ ...d, loading: false }));
      });

    return () => {
      active = false;
    };
  }, [params.span, params.from, params.to]);

  return data;
}

export function useReportingCost(params: {
  span?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  days?: number | undefined;
  end?: number | undefined;
}) {
  const [data, setData] = useState<{
    totals: Totals;
    lines: CostLine[];
    tariffs: CostTariffs;
    ledgerTotal: number;
    perRun: number;
    perMillion: number;
    localOffload: number;
    rows: DayPoint[];
    providers: Breakdown[];
    squads: Breakdown[];
    loading: boolean;
  }>({
    totals: { runs: 0, tokens: 0, cost: 0, errors: 0, latency: 0, successRate: 100 },
    lines: [],
    tariffs: { vectorStorageRate: 0, objectStorageRate: 0, gpuHourRate: 0, egressRate: 0 },
    ledgerTotal: 0,
    perRun: 0,
    perMillion: 0,
    localOffload: 100,
    rows: [],
    providers: [],
    squads: [],
    loading: true,
  });

  const [tick, setTick] = useState(0);
  const refetch = () => setTick((t) => t + 1);

  useEffect(() => {
    let active = true;
    setData((d) => ({ ...d, loading: true }));

    fetchCostReport({ span: params.span, from: params.from, to: params.to })
      .then((res) => {
        if (!active || !res) return;
        setData({
          totals: res.totals || {
            runs: 0,
            tokens: 0,
            cost: 0,
            errors: 0,
            latency: 0,
            successRate: 100,
          },
          lines: res.lines || [],
          tariffs: res.tariffs || { vectorStorageRate: 0, objectStorageRate: 0, gpuHourRate: 0, egressRate: 0 },
          ledgerTotal: Number(res.ledgerTotal || 0),
          perRun: Number(res.perRun || 0),
          perMillion: Number(res.perMillion || 0),
          localOffload: Number(res.localOffload || 100),
          rows: res.rows || [],
          providers: res.providers || [],
          squads: res.squads || [],
          loading: false,
        });
      })
      .catch((err) => {
        console.error("[useReportingCost] Failed to fetch cost data:", err);
        if (active) setData((d) => ({ ...d, loading: false }));
      });

    return () => {
      active = false;
    };
  }, [params.span, params.from, params.to, tick]);

  return { ...data, refetch };
}
