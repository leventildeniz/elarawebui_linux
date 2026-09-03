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
import { fmtInt, fmtMoney, fmtTokens, useReportingCost } from "@/lib/report-store";

export const Route = createFileRoute("/reporting/cost")({
  head: () => ({
    meta: [
      { title: "Cost & Spend — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Inference, infrastructure and storage spend broken down by provider, squad and line item.",
      },
      { property: "og:title", content: "Cost & Spend — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Inference, infrastructure and storage spend broken down by provider, squad and line item.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CostPage,
});

function CostPage() {
  const { span, control, label: spanText, slug: spanId, days, end } = useReportSpan();
  const queryParams = useMemo(() => {
    if (typeof span === "string") return { span };
    return { from: span.from, to: span.to };
  }, [span]);

  const {
    totals: t,
    lines,
    ledgerTotal,
    perRun,
    perMillion,
    localOffload,
    rows,
    providers,
    squads,
    loading,
  } = useReportingCost(queryParams);

  const exportPdf = async () => {
    await exportReportPdf({
      title: "Cost & Spend Report",
      subtitle: "Inference, infrastructure, storage and egress",
      period: spanText,
      filename: `elara-cost-${spanId}.pdf`,
      kpis: [
        { label: "Total spend", value: fmtMoney(ledgerTotal), hint: spanText },
        { label: "Cost / run", value: `$${perRun.toFixed(4)}`, hint: `${fmtInt(t.runs)} runs` },
        { label: "Cost / 1M tokens", value: fmtMoney(perMillion), hint: fmtTokens(t.tokens) },
        {
          label: "Local offload",
          value: `${localOffload}%`,
          hint: "sovereign runtime share",
        },
      ],
      sections: [
        {
          kind: "table",
          title: "Cost ledger",
          columns: ["Line item", "Category", "Quantity", "Rate", "Amount"],
          widths: [2.6, 1.1, 1, 0.8, 1],
          rows: lines.map((l) => [
            l.item,
            l.category,
            `${l.quantity} ${l.unit}`,
            l.rate,
            fmtMoney(l.amount),
          ]),
        },
        {
          kind: "bars",
          title: "Spend by provider",
          rows: providers.map((p) => ({
            label: p.label,
            value: p.cost,
            caption: `${fmtMoney(p.cost)} · ${p.share}%`,
          })),
        },
        {
          kind: "bars",
          title: "Chargeback by squad",
          rows: squads.map((s) => ({
            label: s.label,
            value: s.cost,
            caption: `${fmtMoney(s.cost)} · ${s.share}%`,
          })),
        },
        {
          kind: "notes",
          title: "Cost controls",
          items: [
            `Routing keeps ${providers[0]!.share}% of traffic on the local sovereign runtime; shifting a further 10% would save roughly ${fmtMoney(ledgerTotal * 0.06)} per period.`,
            `Output tokens carry the highest unit rate — prompt-layer compaction is the single largest lever.`,
            `Storage and egress account for ${(((9.15 + 2.49 + 2.15) / ledgerTotal) * 100).toFixed(1)}% of total spend.`,
          ],
        },
      ],
    });
    toast.success("Cost report exported");
  };

  return (
    <Surface
      wide
      title="Cost & Spend"
      meta={`FINOPS LEDGER · ${spanText.toUpperCase()}`}
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
            { label: "Total spend", value: fmtMoney(ledgerTotal), hint: spanText, tone: "topaz" },
            {
              label: "Cost / run",
              value: `$${perRun.toFixed(4)}`,
              hint: `${fmtInt(t.runs)} runs`,
              tone: "sapphire",
            },
            {
              label: "Cost / 1M tokens",
              value: fmtMoney(perMillion),
              hint: fmtTokens(t.tokens),
              tone: "emerald",
            },
            {
              label: "Local offload",
              value: `${localOffload}%`,
              hint: "sovereign runtime",
              tone: "amethyst",
            },
          ]}
        />

        <ReportPanel title="Daily spend" hint={`Burn curve · ${spanText}`}>
          <Sparkline values={rows.map((r) => r.cost)} tone="topaz" height={110} />
        </ReportPanel>

        <ReportPanel title="Cost ledger" hint="Metered line items for the selected period">
          <DataTable
            columns={["Line item", "Category", "Quantity", "Rate", "Amount"]}
            align={["left", "left", "right", "right", "right"]}
            rows={[
              ...lines.map((l) => [
                l.item,
                <span
                  key={l.item}
                  className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-muted-foreground/60"
                >
                  {l.category}
                </span>,
                `${l.quantity} ${l.unit}`,
                l.rate,
                fmtMoney(l.amount),
              ]),
              [
                <span key="total" className="font-medium text-foreground">
                  Total
                </span>,
                "",
                "",
                "",
                <span key="totalv" className="font-mono font-medium text-emerald">
                  {fmtMoney(ledgerTotal)}
                </span>,
              ],
            ]}
          />
        </ReportPanel>

        <div className="grid gap-6 lg:grid-cols-2">
          <ReportPanel title="Spend by provider">
            <BarList
              rows={providers.map((p) => ({
                label: p.label,
                value: p.cost,
                caption: fmtMoney(p.cost),
              }))}
              tone="sapphire"
            />
          </ReportPanel>
          <ReportPanel title="Chargeback by squad">
            <BarList
              rows={squads.map((s) => ({
                label: s.label,
                value: s.cost,
                caption: fmtMoney(s.cost),
              }))}
              tone="emerald"
            />
          </ReportPanel>
        </div>
      </div>
    </Surface>
  );
}
