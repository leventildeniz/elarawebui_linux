import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Surface } from "@/components/sovereign/surface";
import {
  BarList,
  DataTable,
  ExportButton,
  KpiGrid,
  useReportSpan,
  ReportPanel,
  Sparkline,
} from "@/components/sovereign/report-kit";
import { exportReportPdf } from "@/lib/report-pdf";
import {
  byProvider,
  bySquad,
  byWorkload,
  fmtInt,
  fmtMoney,
  fmtTokens,
  seriesRange,
  totals,
} from "@/lib/report-store";

export const Route = createFileRoute("/reporting/usage")({
  head: () => ({
    meta: [
      { title: "Usage Analytics — Elara Sovereign Studio" },
      {
        name: "description",
        content: "Token, workload and latency analytics across squads, providers and workloads.",
      },
      { property: "og:title", content: "Usage Analytics — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Token, workload and latency analytics across squads, providers and workloads.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UsagePage,
});

function UsagePage() {
  const { span, control, label: spanText, slug: spanId, days, end } = useReportSpan();
  const rows = useMemo(() => seriesRange(days, end), [days, end]);
  const t = useMemo(() => totals(rows), [rows]);
  const workloads = useMemo(() => byWorkload(t), [t]);
  const providers = useMemo(() => byProvider(t), [t]);
  const squads = useMemo(() => bySquad(t), [t]);
  const peak = useMemo(() => rows.reduce((a, r) => (r.runs > a.runs ? r : a), rows[0]!), [rows]);

  const exportPdf = async () => {
    await exportReportPdf({
      title: "Usage Analytics",
      subtitle: "Token, workload and latency analytics",
      period: spanText,
      filename: `elara-usage-${spanId}.pdf`,
      kpis: [
        { label: "Tokens", value: fmtTokens(t.tokens), hint: "input + output" },
        { label: "Runs", value: fmtInt(t.runs), hint: `peak ${fmtInt(peak.runs)} on ${peak.day}` },
        {
          label: "Avg tokens / run",
          value: fmtInt(Math.round(t.tokens / Math.max(1, t.runs))),
          hint: "context + generation",
        },
        { label: "p50 latency", value: `${t.latency}ms`, hint: "end-to-end" },
      ],
      sections: [
        {
          kind: "bars",
          title: "Workload mix",
          rows: workloads.map((w) => ({
            label: w.label,
            value: w.tokens,
            caption: `${fmtTokens(w.tokens)} · ${w.share}%`,
          })),
        },
        {
          kind: "table",
          title: "Provider usage",
          columns: ["Provider", "Runs", "Tokens", "Share", "Spend"],
          widths: [2.4, 1, 1, 0.8, 1],
          rows: providers.map((p) => [
            p.label,
            fmtInt(p.runs),
            fmtTokens(p.tokens),
            `${p.share}%`,
            fmtMoney(p.cost),
          ]),
        },
        {
          kind: "table",
          title: "Squad usage",
          columns: ["Squad", "Runs", "Tokens", "Share"],
          widths: [2.4, 1, 1, 0.8],
          rows: squads.map((s) => [s.label, fmtInt(s.runs), fmtTokens(s.tokens), `${s.share}%`]),
        },
        {
          kind: "table",
          title: "Daily usage ledger",
          columns: ["Date", "Runs", "Tokens", "Errors", "Latency"],
          rows: rows.map((r) => [
            r.day,
            fmtInt(r.runs),
            fmtTokens(r.tokens),
            r.errors,
            `${r.latency}ms`,
          ]),
        },
      ],
    });
    toast.success("Usage report exported");
  };

  return (
    <Surface
      wide
      title="Usage Analytics"
      meta={`TOKEN & WORKLOAD ANALYTICS · ${spanText.toUpperCase()}`}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {control}
          <ExportButton onClick={exportPdf} />
        </div>
      }
    >
      <div className="space-y-6">
        <KpiGrid
          items={[
            {
              label: "Tokens",
              value: fmtTokens(t.tokens),
              hint: "input + output",
              tone: "emerald",
            },
            {
              label: "Runs",
              value: fmtInt(t.runs),
              hint: `peak ${fmtInt(peak.runs)}`,
              tone: "sapphire",
            },
            {
              label: "Avg tokens / run",
              value: fmtInt(Math.round(t.tokens / Math.max(1, t.runs))),
              hint: "context + generation",
              tone: "amethyst",
            },
            { label: "p50 latency", value: `${t.latency}ms`, hint: "end-to-end", tone: "topaz" },
          ]}
        />

        <ReportPanel title="Token throughput" hint={`Daily tokens · ${spanText}`}>
          <Sparkline values={rows.map((r) => r.tokens)} tone="emerald" height={110} />
        </ReportPanel>

        <div className="grid gap-6 lg:grid-cols-2">
          <ReportPanel title="Workload mix">
            <BarList
              rows={workloads.map((w) => ({
                label: w.label,
                value: w.tokens,
                caption: `${fmtTokens(w.tokens)} · ${w.share}%`,
              }))}
              tone="amethyst"
            />
          </ReportPanel>
          <ReportPanel title="Latency distribution" hint="Rolling daily p50">
            <Sparkline values={rows.map((r) => r.latency)} tone="topaz" height={110} />
            <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-[12px]">
              <div>
                <div className="text-muted-foreground/50">MIN</div>
                <div className="text-foreground">{Math.min(...rows.map((r) => r.latency))}ms</div>
              </div>
              <div>
                <div className="text-muted-foreground/50">AVG</div>
                <div className="text-foreground">{t.latency}ms</div>
              </div>
              <div>
                <div className="text-muted-foreground/50">MAX</div>
                <div className="text-foreground">{Math.max(...rows.map((r) => r.latency))}ms</div>
              </div>
            </div>
          </ReportPanel>
        </div>

        <ReportPanel title="Provider usage">
          <DataTable
            columns={["Provider", "Runs", "Tokens", "Share", "Spend"]}
            align={["left", "right", "right", "right", "right"]}
            rows={providers.map((p) => [
              p.label,
              fmtInt(p.runs),
              fmtTokens(p.tokens),
              `${p.share}%`,
              fmtMoney(p.cost),
            ])}
          />
        </ReportPanel>

        <ReportPanel title="Daily usage ledger">
          <DataTable
            columns={["Date", "Runs", "Tokens", "Errors", "Latency"]}
            align={["left", "right", "right", "right", "right"]}
            rows={rows
              .slice()
              .reverse()
              .map((r) => [
                r.day,
                fmtInt(r.runs),
                fmtTokens(r.tokens),
                String(r.errors),
                `${r.latency}ms`,
              ])}
          />
        </ReportPanel>
      </div>
    </Surface>
  );
}
