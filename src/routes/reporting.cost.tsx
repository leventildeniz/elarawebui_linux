import { useMemo, useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { SlidersHorizontal, X, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton } from "@/components/sovereign/primitives";
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
  type CostTariffs,
  saveCostTariffs,
  fmtInt,
  fmtMoney,
  fmtTokens,
  useReportingCost,
} from "@/lib/report-store";

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
  const [tariffOpen, setTariffOpen] = useState(false);

  const queryParams = useMemo(() => {
    if (typeof span === "string") return { span };
    return { from: span.from, to: span.to };
  }, [span]);

  const {
    totals: t,
    lines,
    tariffs,
    ledgerTotal,
    perRun,
    perMillion,
    localOffload,
    rows,
    providers,
    squads,
    loading,
    refetch,
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
          <JewelButton
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setTariffOpen(true)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-topaz" strokeWidth={1.75} />
            <span>Tariff Rates</span>
          </JewelButton>
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

      <TariffsDialog
        open={tariffOpen}
        initial={tariffs}
        onClose={() => setTariffOpen(false)}
        onSaved={refetch}
      />
    </Surface>
  );
}

function TariffsDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: CostTariffs;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<CostTariffs>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(initial);
  }, [initial, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveCostTariffs(draft);
      toast.success("Infrastructure & storage tariffs saved");
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(`Failed to save tariffs: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetToZero = () => {
    setDraft({
      vectorStorageRate: 0,
      objectStorageRate: 0,
      gpuHourRate: 0,
      egressRate: 0,
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-canvas/70 backdrop-blur-[2px]"
          />
          <motion.div
            role="dialog"
            aria-label="FinOps Tariff Rates"
            initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="obsidian-slab fixed left-1/2 top-1/2 z-50 w-[min(92vw,500px)] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-white/[0.08] p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[17px] font-medium tracking-tight">FinOps Tariff Rates</h2>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground/65">
                  Unit rates for storage, GPU runtime and egress bandwidth. Set to 0 for pure on-prem / zero-cost modeling.
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="text-muted-foreground/60 transition-colors hover:text-foreground"
                title="Close"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
                  <span>Vector Store Rate</span>
                  <span className="text-[10px] text-muted-foreground/50">$ / GB-month</span>
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className="w-full rounded-lg border border-white/[0.08] bg-canvas-deep/70 px-3 py-2 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-topaz/60"
                  value={draft.vectorStorageRate}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, vectorStorageRate: Number(e.target.value) || 0 }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
                  <span>Object Storage Rate</span>
                  <span className="text-[10px] text-muted-foreground/50">$ / GB-month</span>
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className="w-full rounded-lg border border-white/[0.08] bg-canvas-deep/70 px-3 py-2 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-topaz/60"
                  value={draft.objectStorageRate}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, objectStorageRate: Number(e.target.value) || 0 }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
                  <span>Local GPU Runtime Rate</span>
                  <span className="text-[10px] text-muted-foreground/50">$ / GPU-hour</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full rounded-lg border border-white/[0.08] bg-canvas-deep/70 px-3 py-2 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-topaz/60"
                  value={draft.gpuHourRate}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, gpuHourRate: Number(e.target.value) || 0 }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-muted-foreground/80">
                  <span>Egress Bandwidth Rate</span>
                  <span className="text-[10px] text-muted-foreground/50">$ / GB</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full rounded-lg border border-white/[0.08] bg-canvas-deep/70 px-3 py-2 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-topaz/60"
                  value={draft.egressRate}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, egressRate: Number(e.target.value) || 0 }))
                  }
                />
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-white/[0.06] pt-4">
                <button
                  type="button"
                  onClick={handleResetToZero}
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/60 transition-colors hover:text-ruby"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset all to $0</span>
                </button>

                <div className="flex items-center gap-2">
                  <JewelButton type="button" size="sm" variant="outline" onClick={onClose}>
                    Cancel
                  </JewelButton>
                  <JewelButton
                    type="submit"
                    size="sm"
                    variant="primary"
                    disabled={saving}
                    className="gap-1.5"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{saving ? "Saving…" : "Save Tariffs"}</span>
                  </JewelButton>
                </div>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
