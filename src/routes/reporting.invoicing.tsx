import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Building2, KeyRound, Layers, Download, Check, ChevronDown } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton } from "@/components/sovereign/primitives";
import { ObsidianSelect } from "@/components/sovereign/obsidian-select";
import {
  DataTable,
  KpiGrid,
  useReportSpan,
  ReportPanel,
} from "@/components/sovereign/report-kit";
import { exportReportPdf } from "@/lib/report-pdf";
import { fmtInt, fmtMoney, fmtTokens } from "@/lib/report-store";
import { fetchApi } from "@/lib/api";

export const Route = createFileRoute("/reporting/invoicing")({
  head: () => ({
    meta: [
      { title: "Tenant Invoicing & Billing — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Multi-tenant B2B AI metering, token ledger, API key usage and one-click official PDF invoice generation.",
      },
      { property: "og:title", content: "Tenant Invoicing & Billing — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Multi-tenant B2B AI metering and official PDF invoice generation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InvoicingPage,
});

type InvoicingData = {
  span: { label: string; slug: string; days: number; startDate: string; endDate: string };
  totals: {
    total_runs: number;
    total_tokens: number;
    total_cost: number;
    cache_hits: number;
    total_tenants: number;
  };
  tenants: Array<{
    tenant_id: string;
    runs: number;
    tokens: number;
    cost: number;
    cache_hits: number;
    active_keys: number;
    share: number;
  }>;
  keys: Array<{
    api_key_id: string;
    key_name: string;
    key_prefix: string;
    tier: string;
    tenant_id: string;
    runs: number;
    tokens: number;
    cost: number;
  }>;
  models: Array<{
    model: string;
    runs: number;
    tokens: number;
    cost: number;
  }>;
};

type Opt = { value: string; label: string; disabled?: boolean; hint?: string };

function ObsidianPick({
  value,
  options,
  onChange,
  icon,
}: {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#121216] px-3 py-1.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-white/20 focus:border-sapphire/50"
      >
        {icon}
        <span className="truncate">{current?.label ?? "Select..."}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[220px] max-h-[280px] overflow-auto rounded-lg border border-white/[0.09] bg-[#111113]/95 p-1 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={o.disabled}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left font-mono text-[12px] transition-colors ${
                o.disabled
                  ? "cursor-not-allowed text-muted-foreground/35"
                  : "text-foreground/85 hover:bg-white/[0.05]"
              }`}
            >
              <span className="truncate">
                {o.label}
                {o.hint && <span className="ml-1.5 opacity-50">· {o.hint}</span>}
              </span>
              {o.value === value && (
                <Check className="h-3.5 w-3.5 text-sapphire" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InvoicingPage() {
  const { span, control, label: spanText, slug: spanId } = useReportSpan();
  const [data, setData] = useState<InvoicingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTenant, setSelectedTenant] = useState<string>("all");

  const queryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (typeof span === "string") {
      params["span"] = span;
    } else {
      params["from"] = span.from;
      params["to"] = span.to;
    }
    if (selectedTenant && selectedTenant !== "all") {
      params["tenant_id"] = selectedTenant;
    }
    return params;
  }, [span, selectedTenant]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams(queryParams).toString();
      const res = await fetchApi(`/api/reporting/invoicing?${q}`);
      if (res?.totals) {
        setData(res);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Failed to load invoice metrics: " + msg);
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const exportPdf = async () => {
    if (!data) return;

    await exportReportPdf({
      title: "B2B AI Usage & Invoicing Report",
      subtitle: `Enterprise Token Metering & Sovereign Infrastructure Ledger (${selectedTenant === "all" ? "All Tenants" : `Tenant: ${selectedTenant}`})`,
      period: spanText,
      filename: `elara-invoice-${selectedTenant}-${spanId}.pdf`,
      kpis: [
        {
          label: "Total Billed",
          value: fmtMoney(data.totals.total_cost),
          hint: spanText,
        },
        {
          label: "Total Tokens",
          value: fmtTokens(data.totals.total_tokens),
          hint: "input + output",
        },
        {
          label: "API Requests",
          value: fmtInt(data.totals.total_runs),
          hint: "metered completions",
        },
        {
          label: "Cache Savings",
          value: `${data.totals.cache_hits} hits`,
          hint: "0ms $0.00 offload",
        },
      ],
      sections: [
        {
          kind: "table",
          title: "Tenant Billing Summary",
          columns: ["Tenant / Client", "Active Keys", "Requests", "Tokens", "Total Amount"],
          widths: [2.2, 1, 1, 1, 1.2],
          rows: data.tenants.map((t) => [
            t.tenant_id,
            fmtInt(t.active_keys),
            fmtInt(t.runs),
            fmtTokens(t.tokens),
            fmtMoney(t.cost),
          ]),
        },
        {
          kind: "table",
          title: "API Key Breakdown",
          columns: ["Key Name", "Prefix", "Tier", "Requests", "Tokens", "Amount"],
          widths: [2.0, 1.2, 0.8, 0.8, 1, 1],
          rows: data.keys.map((k) => [
            k.key_name,
            k.key_prefix,
            k.tier.toUpperCase(),
            fmtInt(k.runs),
            fmtTokens(k.tokens),
            fmtMoney(k.cost),
          ]),
        },
        {
          kind: "table",
          title: "Model Consumption Ledger",
          columns: ["Model Name", "Requests", "Tokens", "Spend"],
          widths: [2.4, 1, 1.2, 1],
          rows: data.models.map((m) => [
            m.model,
            fmtInt(m.runs),
            fmtTokens(m.tokens),
            fmtMoney(m.cost),
          ]),
        },
      ],
    });
    toast.success("Official PDF Invoice downloaded!");
  };

  const totals = data?.totals || {
    total_runs: 0,
    total_tokens: 0,
    total_cost: 0,
    cache_hits: 0,
    total_tenants: 0,
  };

  return (
    <Surface
      title="Tenant Invoicing & Metering"
      meta="B2B BILLING · TOKEN LEDGER · PDF EXPORT"
      wide
    >
      <div className="space-y-6">
        {/* Top Controls: Span Picker, Tenant Filter, Export PDF */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            {control}

            {/* Tenant Filter using ObsidianSelect */}
            <ObsidianSelect
              full={false}
              className="min-w-[180px]"
              value={selectedTenant}
              icon={<Building2 className="h-3.5 w-3.5 text-sapphire shrink-0" />}
              options={[
                { value: "all", label: `All Tenants (${totals.total_tenants})` },
                ...(data?.tenants.map((t) => ({
                  value: t.tenant_id,
                  label: t.tenant_id,
                })) || []),
              ]}
              onChange={(v) => setSelectedTenant(v)}
            />
          </div>

          <JewelButton
            variant="primary"
            size="sm"
            onClick={() => { exportPdf(); }}
            disabled={loading || !data}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download Official PDF Invoice
          </JewelButton>
        </div>

        {/* KPI Grid */}
        <KpiGrid
          items={[
            {
              label: "Total Invoiced",
              value: fmtMoney(totals.total_cost),
              hint: spanText,
              tone: "emerald",
            },
            {
              label: "Total Tokens Metered",
              value: fmtTokens(totals.total_tokens),
              hint: `${fmtInt(totals.total_runs)} completions`,
              tone: "sapphire",
            },
            {
              label: "Cache Savings",
              value: `${totals.cache_hits} Hits`,
              hint: "0ms instant Redis offload",
              tone: "topaz",
            },
            {
              label: "Active Tenants",
              value: fmtInt(totals.total_tenants),
              hint: `${data?.keys.length || 0} active API keys`,
              tone: "sapphire",
            },
          ]}
        />

        {/* Tenant Billing Breakdown */}
        <div className="space-y-4">
          <ReportPanel
            title="Tenant Account Ledger"
            hint="Aggregated token volume, run counts and billable total per tenant"
          >
            <DataTable
              columns={[
                "Tenant Account",
                "Active Keys",
                "Requests",
                "Token Volume",
                "Share",
                "Total Amount",
              ]}
              align={["left", "right", "right", "right", "right", "right"]}
              rows={(data?.tenants || []).map((t) => [
                <div key="name" className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-sapphire" />
                  <span className="font-medium text-foreground">{t.tenant_id}</span>
                </div>,
                fmtInt(t.active_keys),
                fmtInt(t.runs),
                fmtTokens(t.tokens),
                `${t.share}%`,
                <span key="cost" className="font-mono font-semibold text-emerald">
                  {fmtMoney(t.cost)}
                </span>,
              ])}
            />
          </ReportPanel>

          {/* API Key Metering Table */}
          <ReportPanel
            title="API Key Metering Breakdown"
            hint="Granular token consumption and cost attributed to individual application keys"
          >
            <DataTable
              columns={["Application / Key Name", "Prefix", "Tier", "Requests", "Tokens", "Amount"]}
              align={["left", "left", "left", "right", "right", "right"]}
              rows={(data?.keys || []).map((k, idx) => [
                <div key={`k-name-${idx}`} className="flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 text-sapphire" />
                  <span className="font-medium text-foreground">{k.key_name}</span>
                </div>,
                <span key={`k-prefix-${idx}`} className="font-mono text-xs text-muted-foreground">
                  {k.key_prefix}
                </span>,
                <span
                  key={`k-tier-${idx}`}
                  className="rounded bg-sapphire/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-sapphire"
                >
                  {k.tier}
                </span>,
                fmtInt(k.runs),
                fmtTokens(k.tokens),
                <span key={`k-cost-${idx}`} className="font-mono text-foreground">
                  {fmtMoney(k.cost)}
                </span>,
              ])}
            />
          </ReportPanel>

          {/* Model Usage Table */}
          <ReportPanel
            title="Model Consumption Ledger"
            hint="Spend and token distribution across local sovereign models and external providers"
          >
            <DataTable
              columns={["Model / RAG Space", "Requests", "Tokens Metered", "Spend"]}
              align={["left", "right", "right", "right"]}
              rows={(data?.models || []).map((m, idx) => [
                <div key={`m-name-${idx}`} className="flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 text-topaz" />
                  <span className="font-medium text-foreground">{m.model}</span>
                </div>,
                fmtInt(m.runs),
                fmtTokens(m.tokens),
                <span key={`m-cost-${idx}`} className="font-mono text-foreground">
                  {fmtMoney(m.cost)}
                </span>,
              ])}
            />
          </ReportPanel>
        </div>
      </div>
    </Surface>
  );
}
