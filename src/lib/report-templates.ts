/**
 * Report templates — the single catalogue used by both the on-screen
 * reports and the scheduled delivery engine. A template turns
 * (period, optional operator) into a fully rendered ReportDoc.
 */

import type { ReportDoc } from "@/lib/report-pdf";
import {
  byProvider,
  bySquad,
  byWorkload,
  costLines,
  fmtInt,
  fmtMoney,
  fmtTokens,
  periodLabel,
  series,
  totals,
  type Period,
} from "@/lib/report-store";
import {
  resolveSpan,
  rosterTotals,
  spanSlug,
  userReports,
  type RosterQuery,
  type Span,
} from "@/lib/report-users";

export type TemplateId = "executive" | "usage" | "cost" | "operator-roster" | "operator-detail";

export type ReportTemplate = {
  id: TemplateId;
  name: string;
  description: string;
  tone: "sapphire" | "emerald" | "amethyst" | "topaz" | "ruby";
  /** requires an operator to be selected */
  perUser?: boolean;
};

export const reportTemplates: ReportTemplate[] = [
  {
    id: "executive",
    name: "Executive rollup",
    description: "KPI summary, daily trend and squad breakdown for leadership.",
    tone: "sapphire",
  },
  {
    id: "usage",
    name: "Usage analytics",
    description: "Runs, tokens, latency and workload distribution.",
    tone: "emerald",
  },
  {
    id: "cost",
    name: "Cost & spend ledger",
    description: "Billable lines, provider split and unit rates.",
    tone: "amethyst",
  },
  {
    id: "operator-roster",
    name: "Operator activity roster",
    description: "Every operator: runs, local vs cloud tokens and cost to the studio.",
    tone: "topaz",
  },
  {
    id: "operator-detail",
    name: "Operator deep dive",
    description: "Single operator: workloads, models, activity ledger and spend.",
    tone: "ruby",
    perUser: true,
  },
];

export const templateById = (id: TemplateId) =>
  reportTemplates.find((t) => t.id === id) ?? reportTemplates[0]!;

export function buildReport(
  id: TemplateId,
  span: Span,
  userId?: string,
  query: RosterQuery = {},
): ReportDoc {
  /** platform-wide datasets are period-shaped; a custom range maps to the
   *  closest preset for the trend series but keeps its own label. */
  const resolved = resolveSpan(span);
  const period: Period =
    typeof span === "string"
      ? span
      : resolved.days <= 10
        ? "7d"
        : resolved.days <= 45
          ? "30d"
          : "90d";
  const rows = series(period);
  const t = totals(rows);
  const label = typeof span === "string" ? periodLabel(span) : resolved.label;
  const slug = spanSlug(span);
  const stamp = new Date().toISOString().slice(0, 10);

  if (id === "usage") {
    return {
      title: "Usage Analytics",
      subtitle: "Runs, tokens, latency and workload distribution",
      period: label,
      filename: `elara-usage-${slug}-${stamp}.pdf`,
      kpis: [
        { label: "Runs", value: fmtInt(t.runs) },
        { label: "Tokens", value: fmtTokens(t.tokens) },
        { label: "Avg latency", value: `${t.latency}ms` },
        { label: "Success rate", value: `${t.successRate}%` },
      ],
      sections: [
        {
          kind: "table",
          title: "Workload distribution",
          columns: ["Workload", "Runs", "Tokens", "Share"],
          rows: byWorkload(t).map((b) => [
            b.label,
            fmtInt(b.runs),
            fmtTokens(b.tokens),
            `${b.share}%`,
          ]),
        },
        {
          kind: "table",
          title: "Daily trend",
          columns: ["Date", "Runs", "Tokens", "Errors", "Latency"],
          rows: rows
            .slice(-21)
            .map((r) => [r.day, fmtInt(r.runs), fmtTokens(r.tokens), r.errors, `${r.latency}ms`]),
        },
      ],
    };
  }

  if (id === "cost") {
    const lines = costLines(t);
    return {
      title: "Cost & Spend Ledger",
      subtitle: "Billable lines, provider split and unit rates",
      period: label,
      filename: `elara-cost-${slug}-${stamp}.pdf`,
      kpis: [
        { label: "Total spend", value: fmtMoney(t.cost) },
        { label: "Cost / run", value: `$${(t.cost / Math.max(1, t.runs)).toFixed(4)}` },
        { label: "Tokens", value: fmtTokens(t.tokens) },
        { label: "Line items", value: String(lines.length) },
      ],
      sections: [
        {
          kind: "table",
          title: "Billable lines",
          columns: ["Item", "Category", "Quantity", "Rate", "Amount"],
          widths: [2.2, 1, 1, 0.8, 0.9],
          rows: lines.map((l) => [l.item, l.category, l.quantity, l.rate, fmtMoney(l.amount)]),
        },
        {
          kind: "table",
          title: "Provider split",
          columns: ["Provider", "Runs", "Tokens", "Spend", "Share"],
          rows: byProvider(t).map((b) => [
            b.label,
            fmtInt(b.runs),
            fmtTokens(b.tokens),
            fmtMoney(b.cost),
            `${b.share}%`,
          ]),
        },
      ],
    };
  }

  if (id === "operator-roster") {
    const list = userReports(span, query);
    const rt = rosterTotals(list);
    return {
      title: "Operator Activity Roster",
      subtitle:
        (query.topN
          ? `Top ${query.topN} operators by ${query.sortBy ?? "tokens"} · `
          : "Per-operator ") + "runs, token consumption and cost to the studio",
      period: label,
      filename: `elara-operators-${slug}-${stamp}.pdf`,
      kpis: [
        { label: "Operators", value: String(rt.operators) },
        { label: "Runs", value: fmtInt(rt.runs) },
        { label: "Tokens", value: fmtTokens(rt.tokens) },
        { label: "Cost", value: fmtMoney(rt.cost), hint: `${fmtMoney(rt.cloudCost)} cloud` },
      ],
      sections: [
        {
          kind: "table",
          title: "Operators",
          columns: ["Operator", "Role", "Runs", "Local tok", "Cloud tok", "Cost", "Success"],
          widths: [1.7, 1, 0.7, 0.9, 0.9, 0.8, 0.8],
          rows: list.map((u) => [
            `${u.name} (${u.username})`,
            u.role,
            fmtInt(u.runs),
            fmtTokens(u.localTokens),
            fmtTokens(u.cloudTokens),
            fmtMoney(u.cost),
            `${u.successRate}%`,
          ]),
        },
        {
          kind: "bars",
          title: "Cost distribution by operator",
          rows: list.map((u) => ({ label: u.name, value: u.cost, caption: fmtMoney(u.cost) })),
        },
      ],
    };
  }

  if (id === "operator-detail") {
    const list = userReports(span, { ...query, topN: 0 });
    const u = list.find((x) => x.id === userId) ?? list[0];
    if (!u) return buildReport("operator-roster", span, undefined, query);
    return {
      title: `Operator Deep Dive · ${u.name}`,
      subtitle: `${u.role} · ${u.email} · ${u.status}${u.locked ? " · locked" : ""}`,
      period: label,
      filename: `elara-operator-${u.username}-${slug}-${stamp}.pdf`,
      kpis: [
        { label: "Runs", value: fmtInt(u.runs), hint: `${u.sessions} sessions` },
        { label: "Tokens", value: fmtTokens(u.tokens), hint: `${fmtTokens(u.localTokens)} local` },
        { label: "Cost", value: fmtMoney(u.cost), hint: `${fmtMoney(u.cloudCost)} cloud` },
        { label: "Success rate", value: `${u.successRate}%`, hint: `${u.errors} failures` },
      ],
      sections: [
        {
          kind: "table",
          title: "Consumption split",
          columns: ["Metric", "Value"],
          widths: [1.4, 1],
          rows: [
            ["Input tokens", fmtTokens(u.inputTokens)],
            ["Output tokens", fmtTokens(u.outputTokens)],
            ["Local runtime tokens", `${fmtTokens(u.localTokens)}  (${fmtMoney(u.localCost)})`],
            ["Cloud provider tokens", `${fmtTokens(u.cloudTokens)}  (${fmtMoney(u.cloudCost)})`],
            ["Tool / MCP calls", fmtInt(u.toolCalls)],
            ["Approvals raised", fmtInt(u.approvals)],
            ["Average latency", `${u.latency}ms`],
            ["Last seen", u.lastSeen],
          ],
        },
        {
          kind: "table",
          title: "Where the tokens went",
          columns: ["Workload", "Runs", "Tokens", "Cost", "Share"],
          rows: u.workloads.map((w) => [
            w.label,
            fmtInt(w.runs),
            fmtTokens(w.tokens),
            fmtMoney(w.cost),
            `${w.share}%`,
          ]),
        },
        {
          kind: "table",
          title: "Model usage",
          columns: ["Model", "Runs", "Tokens", "Cost", "Share"],
          rows: u.models.map((w) => [
            w.label,
            fmtInt(w.runs),
            fmtTokens(w.tokens),
            fmtMoney(w.cost),
            `${w.share}%`,
          ]),
        },
        {
          kind: "table",
          title: "Recent activity",
          columns: ["When", "Kind", "Detail", "Tokens", "Cost"],
          widths: [1.1, 0.7, 2.2, 0.8, 0.7],
          rows: u.activity.map((a) => [
            a.at,
            a.kind,
            a.detail,
            fmtInt(a.tokens),
            `$${a.cost.toFixed(3)}`,
          ]),
        },
      ],
    };
  }

  return {
    title: "Executive Rollup",
    subtitle: "Platform health, consumption and spend",
    period: label,
    filename: `elara-executive-${slug}-${stamp}.pdf`,
    kpis: [
      { label: "Runs", value: fmtInt(t.runs) },
      { label: "Tokens", value: fmtTokens(t.tokens) },
      { label: "Spend", value: fmtMoney(t.cost) },
      { label: "Success rate", value: `${t.successRate}%` },
    ],
    sections: [
      {
        kind: "bars",
        title: "Squad consumption",
        rows: bySquad(t).map((b) => ({
          label: b.label,
          value: b.tokens,
          caption: fmtTokens(b.tokens),
        })),
      },
      {
        kind: "table",
        title: "Provider split",
        columns: ["Provider", "Runs", "Tokens", "Spend", "Share"],
        rows: byProvider(t).map((b) => [
          b.label,
          fmtInt(b.runs),
          fmtTokens(b.tokens),
          fmtMoney(b.cost),
          `${b.share}%`,
        ]),
      },
      {
        kind: "notes",
        title: "Signals",
        items: [
          `Average latency held at ${t.latency}ms across ${fmtInt(t.runs)} runs.`,
          `${fmtInt(t.errors)} failures recorded (${(100 - t.successRate).toFixed(2)}% of traffic).`,
          `Local sovereign runtime absorbed the largest share of inference, containing cloud spend.`,
        ],
      },
    ],
  };
}

/** Flat rows for CSV / JSON deliveries of the same template. */
export function reportRows(doc: ReportDoc): { columns: string[]; rows: (string | number)[][] } {
  const table = doc.sections.find((s) => s.kind === "table");
  if (table && table.kind === "table") return { columns: table.columns, rows: table.rows };
  return {
    columns: ["Metric", "Value"],
    rows: doc.kpis.map((k) => [k.label, k.value]),
  };
}
