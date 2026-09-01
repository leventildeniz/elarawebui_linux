/**
 * Reporting datasets — deterministic, derived rollups used by the four
 * reporting surfaces and by the PDF exporter so screen and document match.
 */

export type Period = "7d" | "30d" | "90d";

export const periods: { id: Period; label: string; days: number }[] = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
];

export const periodLabel = (p: Period) => periods.find((x) => x.id === p)!.label;

/** Stable pseudo-random in [0,1) from an integer seed. */
function rnd(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export type DayPoint = {
  day: string;
  runs: number;
  tokens: number;
  cost: number;
  errors: number;
  latency: number;
};

export function series(period: Period): DayPoint[] {
  const days = periods.find((p) => p.id === period)!.days;
  return seriesRange(days, Date.now());
}

/** Same synthetic series over an arbitrary window — powers custom ranges. */
export function seriesRange(days: number, end: number): DayPoint[] {
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end - i * 86_400_000);
    const s = d.getUTCFullYear() * 1000 + d.getUTCMonth() * 40 + d.getUTCDate();
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const base = weekend ? 0.45 : 1;
    const runs = Math.round((820 + rnd(s) * 640) * base);
    const tokens = Math.round(runs * (2100 + rnd(s + 7) * 1400));
    out.push({
      day: d.toISOString().slice(0, 10),
      runs,
      tokens,
      cost: Number(((tokens / 1_000_000) * 3.1 + runs * 0.0016).toFixed(2)),
      errors: Math.round(runs * (0.004 + rnd(s + 13) * 0.012)),
      latency: Math.round(640 + rnd(s + 21) * 520),
    });
  }
  return out;
}

export type Totals = {
  runs: number;
  tokens: number;
  cost: number;
  errors: number;
  latency: number;
  successRate: number;
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

export type Breakdown = {
  label: string;
  runs: number;
  tokens: number;
  cost: number;
  share: number;
};

function split(t: Totals, weights: { label: string; w: number }[]): Breakdown[] {
  const sum = weights.reduce((a, b) => a + b.w, 0);
  return weights.map((x) => ({
    label: x.label,
    runs: Math.round((t.runs * x.w) / sum),
    tokens: Math.round((t.tokens * x.w) / sum),
    cost: Number(((t.cost * x.w) / sum).toFixed(2)),
    share: Number(((x.w / sum) * 100).toFixed(1)),
  }));
}

export const byProvider = (t: Totals) =>
  split(t, [
    { label: "Local runtime (sovereign)", w: 46 },
    { label: "OpenAI", w: 21 },
    { label: "Anthropic", w: 17 },
    { label: "Google", w: 9 },
    { label: "Groq", w: 7 },
  ]);

export const bySquad = (t: Totals) =>
  split(t, [
    { label: "Platform engineering", w: 32 },
    { label: "Analytics", w: 24 },
    { label: "Support automation", w: 19 },
    { label: "Security ops", w: 15 },
    { label: "Research", w: 10 },
  ]);

export const byWorkload = (t: Totals) =>
  split(t, [
    { label: "Chat orchestration", w: 38 },
    { label: "Workflow runs", w: 27 },
    { label: "RAG retrieval", w: 18 },
    { label: "Tool / MCP calls", w: 11 },
    { label: "Embeddings", w: 6 },
  ]);

export type CostLine = {
  item: string;
  category: "inference" | "infrastructure" | "storage" | "egress";
  unit: string;
  quantity: string;
  rate: string;
  amount: number;
};

export function costLines(t: Totals): CostLine[] {
  const m = t.tokens / 1_000_000;
  return [
    {
      item: "Cloud inference · input tokens",
      category: "inference",
      unit: "1M tokens",
      quantity: `${(m * 0.62).toFixed(2)}M`,
      rate: "$2.10",
      amount: Number((m * 0.62 * 2.1).toFixed(2)),
    },
    {
      item: "Cloud inference · output tokens",
      category: "inference",
      unit: "1M tokens",
      quantity: `${(m * 0.18).toFixed(2)}M`,
      rate: "$8.40",
      amount: Number((m * 0.18 * 8.4).toFixed(2)),
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
      quantity: "41.6GB",
      rate: "$0.22",
      amount: 9.15,
    },
    {
      item: "Object storage · artefacts & exports",
      category: "storage",
      unit: "GB-month",
      quantity: "118.4GB",
      rate: "$0.021",
      amount: 2.49,
    },
    {
      item: "Egress · webhooks and deliveries",
      category: "egress",
      unit: "GB",
      quantity: "26.9GB",
      rate: "$0.08",
      amount: 2.15,
    },
  ];
}

export type ScheduledExport = {
  id: string;
  name: string;
  cadence: string;
  format: "PDF" | "CSV" | "JSON";
  destination: string;
  recipients: string;
  lastRun: string;
  nextRun: string;
  status: "healthy" | "warning" | "failed";
};

export const scheduledExports: ScheduledExport[] = [
  {
    id: "x1",
    name: "Executive rollup",
    cadence: "Weekly · Mon 07:00",
    format: "PDF",
    destination: "mail://leadership",
    recipients: "5 recipients",
    lastRun: "2 days ago",
    nextRun: "in 5 days",
    status: "healthy",
  },
  {
    id: "x2",
    name: "Cost & spend ledger",
    cadence: "Monthly · 1st 02:00",
    format: "CSV",
    destination: "s3://sovereign-finops/reports",
    recipients: "finops",
    lastRun: "12 days ago",
    nextRun: "in 18 days",
    status: "healthy",
  },
  {
    id: "x3",
    name: "Usage analytics feed",
    cadence: "Daily · 01:15",
    format: "JSON",
    destination: "warehouse://bigquery.elara_usage",
    recipients: "pipeline",
    lastRun: "9 hours ago",
    nextRun: "in 15 hours",
    status: "warning",
  },
  {
    id: "x4",
    name: "Policy & approval audit",
    cadence: "Weekly · Fri 18:00",
    format: "PDF",
    destination: "mail://governance",
    recipients: "3 recipients",
    lastRun: "4 days ago",
    nextRun: "in 3 days",
    status: "healthy",
  },
  {
    id: "x5",
    name: "Agent SLA digest",
    cadence: "Daily · 06:00",
    format: "PDF",
    destination: "mail://ops-oncall",
    recipients: "8 recipients",
    lastRun: "failed",
    nextRun: "retry pending",
    status: "failed",
  },
];

export const fmtInt = (n: number) => n.toLocaleString("en-US");
export const fmtMoney = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtTokens = (n: number) =>
  n >= 1_000_000_000
    ? `${(n / 1_000_000_000).toFixed(2)}B`
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : `${(n / 1000).toFixed(1)}K`;
