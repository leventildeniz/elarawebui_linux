import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Surface } from "@/components/sovereign/surface";
import {
  BarList,
  DataTable,
  ExportButton,
  KpiGrid,
  ReportPanel,
  Sparkline,
  useReportSpan,
} from "@/components/sovereign/report-kit";
import { exportReportPdf } from "@/lib/report-pdf";
import { fmtInt } from "@/lib/report-store";
import { useKnowledge } from "@/lib/knowledge-store";
import { useSpaces } from "@/lib/knowledge-space-store";
import { useRagQueries, rank } from "@/lib/rag-analytics-store";
import { fileKind } from "@/lib/file-kind";

export const Route = createFileRoute("/reporting/rag")({
  head: () => ({
    meta: [
      { title: "RAG Analytics — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Ingest volume, uploader activity, space routing and query analytics for the retrieval layer.",
      },
      { property: "og:title", content: "RAG Analytics — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Ingest volume, uploader activity, space routing and query analytics for the retrieval layer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RagAnalyticsPage,
});

const fmtSize = (mb: number) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;

const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

function RagAnalyticsPage() {
  const { control, label: spanText, slug: spanId, days, end } = useReportSpan();
  const knowledge = useKnowledge();
  const { spaces } = useSpaces();
  const { rows: queries } = useRagQueries();

  const since = end - (days - 1) * 86_400_000;
  const until = end + 86_400_000;
  const spaceName = (id?: string) => spaces.find((s) => s.id === id)?.name ?? "unassigned";

  const docs = useMemo(
    () => knowledge.sources.filter((s) => (s.addedAt ?? 0) >= since && (s.addedAt ?? 0) < until),
    [knowledge.sources, since, until],
  );
  const qs = useMemo(
    () => queries.filter((q) => q.at >= since && q.at < until),
    [queries, since, until],
  );

  const totalMb = docs.reduce((n, d) => n + (d.sizeMb ?? 0), 0);
  const chunks = docs.reduce((n, d) => n + (d.chunks ?? 0), 0);
  const indexed = docs.filter((d) => d.status === "indexed").length;
  const pending = docs.filter((d) => d.status === "pending").length;

  const uploaders = useMemo(
    () =>
      rank(
        docs,
        (d) => d.ownerName || "unknown",
        (d) => d.sizeMb ?? 0,
      ),
    [docs],
  );
  const uploaderDocs = useMemo(() => rank(docs, (d) => d.ownerName || "unknown"), [docs]);
  const bySpace = useMemo(() => rank(docs, (d) => spaceName(d.space)), [docs, spaces]);
  const byType = useMemo(() => rank(docs, (d) => fileKind(d.name).label), [docs]);
  const askers = useMemo(() => rank(qs, (q) => q.principal), [qs]);
  const routedSpaces = useMemo(
    () =>
      rank(
        qs.flatMap((q) => q.spaces.map((s) => ({ s }))),
        (x) => x.s,
      ),
    [qs],
  );
  const topQueries = useMemo(
    () => rank(qs, (q) => q.query.trim().toLowerCase()).slice(0, 12),
    [qs],
  );

  /** Daily ingest volume + query volume for the sparklines. */
  const daily = useMemo(() => {
    const out: { day: string; mb: number; queries: number; docs: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const from = end - i * 86_400_000;
      const to = from + 86_400_000;
      const dd = knowledge.sources.filter((s) => (s.addedAt ?? 0) >= from && (s.addedAt ?? 0) < to);
      out.push({
        day: new Date(from).toISOString().slice(0, 10),
        mb: dd.reduce((n, d) => n + (d.sizeMb ?? 0), 0),
        docs: dd.length,
        queries: queries.filter((q) => q.at >= from && q.at < to).length,
      });
    }
    return out;
  }, [knowledge.sources, queries, days, end]);

  const exportPdf = async () => {
    await exportReportPdf({
      title: "RAG Analytics",
      subtitle: "Ingest volume, uploader activity and retrieval queries",
      period: spanText,
      filename: `elara-rag-${spanId}.pdf`,
      kpis: [
        {
          label: "Documents",
          value: fmtInt(docs.length),
          hint: `${indexed} indexed · ${pending} pending`,
        },
        { label: "Ingested volume", value: fmtSize(totalMb), hint: "raw upload size" },
        { label: "Chunks", value: fmtInt(chunks), hint: "written to the index" },
        { label: "Queries", value: fmtInt(qs.length), hint: "retrieval-backed answers" },
      ],
      sections: [
        {
          kind: "table",
          title: "Top uploaders",
          columns: ["Operator", "Documents", "Volume", "Share"],
          widths: [2.4, 1, 1, 0.8],
          rows: uploaders.map((u) => [
            u.label,
            fmtInt(uploaderDocs.find((d) => d.label === u.label)?.value ?? 0),
            fmtSize(u.value),
            `${u.share}%`,
          ]),
        },
        {
          kind: "bars",
          title: "Volume by space",
          rows: bySpace.map((s) => ({
            label: s.label,
            value: s.value,
            caption: `${s.value} docs · ${s.share}%`,
          })),
        },
        {
          kind: "table",
          title: "Most active queriers",
          columns: ["Operator", "Queries", "Share"],
          widths: [2.4, 1, 0.8],
          rows: askers.map((a) => [a.label, fmtInt(a.value), `${a.share}%`]),
        },
        {
          kind: "table",
          title: "Most asked questions",
          columns: ["Question", "Hits"],
          widths: [4, 1],
          rows: topQueries.map((q) => [q.label, fmtInt(q.value)]),
        },
      ],
    });
    toast.success("RAG analytics exported");
  };

  return (
    <Surface
      wide
      title="RAG Analytics"
      meta={`RETRIEVAL & INGEST ANALYTICS · ${spanText.toUpperCase()}`}
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
              label: "Documents",
              value: fmtInt(docs.length),
              hint: `${indexed} indexed · ${pending} pending`,
              tone: "sapphire",
            },
            {
              label: "Ingested volume",
              value: fmtSize(totalMb),
              hint: "raw upload size",
              tone: "emerald",
            },
            {
              label: "Chunks indexed",
              value: fmtInt(chunks),
              hint: "vector + fts",
              tone: "amethyst",
            },
            {
              label: "Queries",
              value: fmtInt(qs.length),
              hint: `${qs.filter((q) => q.hit).length} keyword-routed`,
              tone: "topaz",
            },
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <ReportPanel title="Ingest volume" hint={`MB per day · ${spanText}`}>
            <Sparkline values={daily.map((d) => d.mb)} tone="emerald" height={110} />
          </ReportPanel>
          <ReportPanel title="Query volume" hint="Retrieval-backed answers per day">
            <Sparkline values={daily.map((d) => d.queries)} tone="sapphire" height={110} />
          </ReportPanel>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <ReportPanel title="Top uploaders" hint="By ingested volume">
            <BarList
              rows={uploaders.map((u) => ({
                label: u.label,
                value: u.value,
                caption: `${fmtSize(u.value)} · ${fmtInt(uploaderDocs.find((d) => d.label === u.label)?.value ?? 0)} docs`,
              }))}
              tone="emerald"
            />
          </ReportPanel>
          <ReportPanel title="Most active queriers" hint="Retrieval calls per operator">
            <BarList
              rows={askers.map((a) => ({
                label: a.label,
                value: a.value,
                caption: `${fmtInt(a.value)} queries · ${a.share}%`,
              }))}
              tone="sapphire"
            />
          </ReportPanel>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <ReportPanel title="Corpus by space" hint="Permission boundary distribution">
            <BarList
              rows={bySpace.map((s) => ({
                label: s.label,
                value: s.value,
                caption: `${fmtInt(s.value)} docs · ${s.share}%`,
              }))}
              tone="amethyst"
            />
          </ReportPanel>
          <ReportPanel title="File type mix">
            <BarList
              rows={byType.map((t) => ({
                label: t.label,
                value: t.value,
                caption: `${fmtInt(t.value)} · ${t.share}%`,
              }))}
              tone="topaz"
            />
          </ReportPanel>
        </div>

        <ReportPanel title="Most asked questions" hint="Deduplicated query text">
          {topQueries.length ? (
            <DataTable
              columns={["Question", "Hits", "Share"]}
              align={["left", "right", "right"]}
              rows={topQueries.map((q) => [q.label, fmtInt(q.value), `${q.share}%`])}
            />
          ) : (
            <div className="py-8 text-center font-mono text-[12px] text-muted-foreground/50">
              no retrieval queries recorded in this window
            </div>
          )}
        </ReportPanel>

        <ReportPanel title="Space routing" hint="Which spaces the router actually searched">
          <BarList
            rows={routedSpaces.map((s) => ({
              label: s.label,
              value: s.value,
              caption: `${fmtInt(s.value)} hits · ${s.share}%`,
            }))}
            tone="sapphire"
          />
        </ReportPanel>

        <ReportPanel title="Query ledger" hint="Newest first">
          {qs.length ? (
            <DataTable
              columns={["When", "Operator", "Question", "Spaces", "Docs", "Chunks", "Blocked"]}
              align={["left", "left", "left", "left", "right", "right", "right"]}
              rows={qs
                .slice(0, 60)
                .map((q) => [
                  ago(q.at),
                  q.principal,
                  q.query.length > 72 ? `${q.query.slice(0, 72)}…` : q.query,
                  q.spaces.join(", ") || "all readable",
                  String(q.docs),
                  String(q.chunks),
                  String(q.blocked),
                ])}
            />
          ) : (
            <div className="py-8 text-center font-mono text-[12px] text-muted-foreground/50">
              no queries yet — retrieval-backed answers appear here automatically
            </div>
          )}
        </ReportPanel>

        <ReportPanel title="Ingest ledger" hint="Every document written to the corpus">
          {docs.length ? (
            <DataTable
              columns={[
                "Document",
                "Type",
                "Uploader",
                "Space",
                "Size",
                "Chunks",
                "Status",
                "Added",
              ]}
              align={["left", "left", "left", "left", "right", "right", "left", "left"]}
              rows={docs
                .slice()
                .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
                .map((d) => [
                  d.name,
                  fileKind(d.name).label,
                  d.ownerName || "—",
                  spaceName(d.space),
                  d.sizeMb ? fmtSize(d.sizeMb) : "—",
                  fmtInt(d.chunks ?? 0),
                  d.status,
                  d.addedAt ? ago(d.addedAt) : "—",
                ])}
            />
          ) : (
            <div className="py-8 text-center font-mono text-[12px] text-muted-foreground/50">
              no documents ingested in this window
            </div>
          )}
        </ReportPanel>
      </div>
    </Surface>
  );
}
