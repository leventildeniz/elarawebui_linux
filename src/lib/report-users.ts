/**
 * Per-operator activity rollups for the Reporting module.
 *
 * Derived deterministically from the identity roster so screen, PDF and
 * scheduled deliveries always agree on the same numbers.
 */

import { readAccounts, type Account } from "@/lib/group-store";
import { periods, type Period } from "@/lib/report-store";

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

function rnd(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100_000;
  return h + 1;
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

const WORKLOADS = [
  "Sovereign chat",
  "Workflow runs",
  "RAG retrieval",
  "Tool / MCP calls",
  "Agent squads",
];

const MODELS = [
  { label: "sovereign-local-70b", local: true },
  { label: "gpt-5.1", local: false },
  { label: "claude-sonnet-4.5", local: false },
  { label: "gemini-3-pro", local: false },
  { label: "llama-guard-local", local: true },
];

const KINDS = [
  ["chat", "Sovereign chat thread"],
  ["workflow", "Workflow execution"],
  ["rag", "Knowledge retrieval"],
  ["tool", "MCP tool invocation"],
  ["approval", "MetaForge approval"],
];

function splitWeights(
  total: { runs: number; tokens: number; cost: number },
  labels: string[],
  seed: number,
): WorkloadLine[] {
  const ws = labels.map((_, i) => 0.12 + rnd(seed + i * 17));
  const sum = ws.reduce((a, b) => a + b, 0);
  return labels
    .map((label, i) => ({
      label,
      runs: Math.round((total.runs * ws[i]!) / sum),
      tokens: Math.round((total.tokens * ws[i]!) / sum),
      cost: Number(((total.cost * ws[i]!) / sum).toFixed(2)),
      share: Number(((ws[i]! / sum) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

export function userReport(acc: Account, span: Span): UserReport {
  const { days, end } = resolveSpan(span);
  const seed = hash(acc.id);
  const intensity =
    acc.status === "active" ? 0.6 + rnd(seed) * 0.9 : acc.status === "suspended" ? 0.12 : 0.05;

  const rows: UserDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end - i * DAY);
    const s = seed + d.getUTCFullYear() * 1000 + d.getUTCMonth() * 40 + d.getUTCDate();
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const runs = Math.max(0, Math.round((14 + rnd(s) * 46) * intensity * (weekend ? 0.35 : 1)));
    const tokens = Math.round(runs * (1900 + rnd(s + 5) * 2600));
    rows.push({
      day: d.toISOString().slice(0, 10),
      runs,
      tokens,
      cost: Number(((tokens / 1_000_000) * 3.4).toFixed(2)),
    });
  }

  const runs = rows.reduce((a, r) => a + r.runs, 0);
  const tokens = rows.reduce((a, r) => a + r.tokens, 0);
  const localShare = 0.34 + rnd(seed + 3) * 0.38;
  const localTokens = Math.round(tokens * localShare);
  const cloudTokens = tokens - localTokens;
  const cloudCost = Number(((cloudTokens / 1_000_000) * 4.6).toFixed(2));
  const localCost = Number(((localTokens / 1_000_000) * 0.42).toFixed(2));
  const cost = Number((cloudCost + localCost).toFixed(2));
  const errors = Math.round(runs * (0.003 + rnd(seed + 11) * 0.02));

  const totalsForSplit = { runs, tokens, cost };
  const models = splitWeights(
    totalsForSplit,
    MODELS.map((m) => m.label),
    seed + 41,
  );

  const activity = Array.from({ length: 8 })
    .map((_, i) => {
      const k = KINDS[Math.floor(rnd(seed + i * 9) * KINDS.length) % KINDS.length]!;
      const at = new Date(
        end -
          Math.round(rnd(seed + i * 13) * days * DAY) +
          Math.round(rnd(seed + i * 7) * 86_340_000),
      );
      const tk = Math.round(1200 + rnd(seed + i * 19) * 24_000);
      return {
        at: at.toISOString().slice(0, 16).replace("T", " "),
        kind: k[0]!,
        detail: `${k[1]!} · ${MODELS[Math.floor(rnd(seed + i * 23) * MODELS.length) % MODELS.length]!.label}`,
        tokens: tk,
        cost: Number(((tk / 1_000_000) * 3.4).toFixed(3)),
      };
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    id: acc.id,
    name: acc.name,
    username: acc.username,
    email: acc.email,
    role: acc.role,
    status: acc.status,
    locked: Boolean(acc.locked),
    runs,
    tokens,
    localTokens,
    cloudTokens,
    inputTokens: Math.round(tokens * 0.72),
    outputTokens: tokens - Math.round(tokens * 0.72),
    cost,
    localCost,
    cloudCost,
    errors,
    successRate: Number((100 - (errors / Math.max(1, runs)) * 100).toFixed(2)),
    latency: Math.round(560 + rnd(seed + 29) * 700),
    sessions: Math.max(1, Math.round(runs / (6 + rnd(seed + 31) * 5))),
    approvals: Math.round(runs * (0.01 + rnd(seed + 37) * 0.05)),
    toolCalls: Math.round(runs * (0.4 + rnd(seed + 43) * 1.4)),
    lastSeen: acc.lastSeen,
    series: rows,
    workloads: splitWeights(totalsForSplit, WORKLOADS, seed + 7),
    models,
    activity,
  };
}

export type SortKey = "tokens" | "cost" | "runs" | "name";

export type RosterQuery = {
  /** limit to the top N rows after sorting; 0 = no limit */
  topN?: number;
  sortBy?: SortKey;
  /** restrict to specific operator ids */
  userIds?: string[];
  /** free text on name / username / email / role */
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
    cost: Number(list.reduce((a, r) => a + r.cost, 0).toFixed(2)),
    cloudCost: Number(list.reduce((a, r) => a + r.cloudCost, 0).toFixed(2)),
  };
}
