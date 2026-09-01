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
  bySquad,
  byProvider,
  fmtInt,
  fmtMoney,
  fmtTokens,
  seriesRange,
  totals,
} from "@/lib/report-store";

export const Route = createFileRoute("/reporting/overview")({
  head: () => ({
    meta: [
      { title: "Reporting Overview — Elara Sovereign Studio" },
      {
        name: "description",
        content: "Cross-workspace rollup of orchestration volume, spend and policy outcomes.",
      },
      { property: "og:title", content: "Reporting Overview — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Cross-workspace rollup of orchestration volume, spend and policy outcomes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OverviewPage,
});

function OverviewPage() {
  const { span, control, label: spanText, slug: spanId, days, end } = useReportSpan();
  const rows = useMemo(() => seriesRange(days, end), [days, end]);
  const t = useMemo(() => totals(rows), [rows]);
  const squads = useMemo(() => bySquad(t), [t]);
  const providers = useMemo(() => byProvider(t), [t]);

  const exportPdf = async () => {
    await exportReportPdf({
      title: "Executive Reporting Overview",
      subtitle: "Cross-workspace orchestration rollup",
      period: spanText,
      filename: `elara-overview-${spanId}.pdf`,
      kpis: [
        { label: "Orchestration runs", value: fmtInt(t.runs), hint: `${spanText}` },
        { label: "Tokens processed", value: fmtTokens(t.tokens), hint: "input + output" },
        { label: "Total spend", value: fmtMoney(t.cost), hint: "inference + infra" },
        {
          label: "Success rate",
          value: `${t.successRate}%`,
          hint: `${fmtInt(t.errors)} failed runs`,
        },
      ],
      sections: [
        {
          kind: "bars",
          title: "Volume by squad",
          rows: squads.map((s) => ({
            label: s.label,
            value: s.runs,
            caption: `${fmtInt(s.runs)} runs · ${s.share}%`,
          })),
        },
        {
          kind: "table",
          title: "Provider distribution",
          columns: ["Provider", "Runs", "Tokens", "Spend", "Share"],
          widths: [2.4, 1, 1, 1, 0.8],
          rows: providers.map((p) => [
            p.label,
            fmtInt(p.runs),
            fmtTokens(p.tokens),
            fmtMoney(p.cost),
            `${p.share}%`,
          ]),
        },
        {
          kind: "table",
          title: "Daily trend",
          columns: ["Date", "Runs", "Tokens", "Errors", "p50 latency", "Spend"],
          rows: rows
            .slice(-14)
            .map((r) => [
              r.day,
              fmtInt(r.runs),
              fmtTokens(r.tokens),
              r.errors,
              `${r.latency}ms`,
              fmtMoney(r.cost),
            ]),
        },
        {
          kind: "notes",
          title: "Observations",
          items: [
            `Local sovereign runtime absorbed ${providers[0]!.share}% of all runs, keeping cloud inference spend at ${fmtMoney(providers.slice(1).reduce((a, p) => a + p.cost, 0))}.`,
            `Average end-to-end latency held at ${t.latency}ms across ${fmtInt(t.runs)} runs.`,
            `${fmtInt(t.errors)} runs terminated in error — governance policies auto-retried the recoverable subset.`,
          ],
        },
      ],
    });
    toast.success("Overview report exported");
  };

  return (
    <Surface
      wide
      title="Reporting Overview"
      meta={`CROSS-WORKSPACE ROLLUP · ${spanText.toUpperCase()}`}
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
              label: "Orchestration runs",
              value: fmtInt(t.runs),
              hint: spanText,
              tone: "sapphire",
            },
            {
              label: "Tokens processed",
              value: fmtTokens(t.tokens),
              hint: "input + output",
              tone: "emerald",
            },
            {
              label: "Total spend",
              value: fmtMoney(t.cost),
              hint: "inference + infra",
              tone: "topaz",
            },
            {
              label: "Success rate",
              value: `${t.successRate}%`,
              hint: `${fmtInt(t.errors)} failed`,
              tone: "amethyst",
            },
          ]}
        />

        <ReportPanel title="Run volume" hint={`Daily orchestration runs · ${spanText}`}>
          <Sparkline values={rows.map((r) => r.runs)} height={110} />
          <div className="mt-2 flex justify-between font-mono text-[11px] text-muted-foreground/50">
            <span>{rows[0]!.day}</span>
            <span>{rows[rows.length - 1]!.day}</span>
          </div>
        </ReportPanel>

        <div className="grid gap-6 lg:grid-cols-2">
          <ReportPanel title="Volume by squad">
            <BarList
              rows={squads.map((s) => ({
                label: s.label,
                value: s.runs,
                caption: `${fmtInt(s.runs)} · ${s.share}%`,
              }))}
              tone="emerald"
            />
          </ReportPanel>
          <ReportPanel title="Provider distribution">
            <BarList
              rows={providers.map((p) => ({
                label: p.label,
                value: p.cost,
                caption: fmtMoney(p.cost),
              }))}
              tone="sapphire"
            />
          </ReportPanel>
        </div>

        <ReportPanel title="Daily trend" hint="Most recent 14 sampling days">
          <DataTable
            columns={["Date", "Runs", "Tokens", "Errors", "p50 latency", "Spend"]}
            align={["left", "right", "right", "right", "right", "right"]}
            rows={rows
              .slice(-14)
              .reverse()
              .map((r) => [
                r.day,
                fmtInt(r.runs),
                fmtTokens(r.tokens),
                String(r.errors),
                `${r.latency}ms`,
                fmtMoney(r.cost),
              ])}
          />
        </ReportPanel>
      </div>
    </Surface>
  );
}
