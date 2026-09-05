import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Surface } from "@/components/sovereign/surface";
import { OperatorPicker } from "@/components/sovereign/operator-picker";
import {
  BarList,
  DataTable,
  ExportButton,
  KpiGrid,
  PeriodSwitch,
  ReportPanel,
  Sparkline,
} from "@/components/sovereign/report-kit";
import { exportReportPdf } from "@/lib/report-pdf";
import { buildReport } from "@/lib/report-templates";
import { fmtInt, fmtMoney, fmtTokens, periods, type Period } from "@/lib/report-store";
import { useKnowledge } from "@/lib/knowledge-store";
import { useSpaces } from "@/lib/knowledge-space-store";
import { useRagQueries } from "@/lib/rag-analytics-store";
import { fileKind } from "@/lib/file-kind";
import {
  resolveSpan,
  rosterTotals,
  spanLabel,
  userReports,
  useOperatorReports,
  type RosterQuery,
  type SortKey,
  type Span,
} from "@/lib/report-users";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reporting/users")({
  head: () => ({
    meta: [
      { title: "Operator Analytics — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Per-operator activity: what each user ran, tokens spent per workload and the cost to the studio.",
      },
      { property: "og:title", content: "Operator Analytics — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Per-operator activity: what each user ran, tokens spent per workload and the cost to the studio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OperatorsReport,
});

const TOPS = [0, 3, 5, 10, 25] as const;
const SORTS: { id: SortKey; label: string }[] = [
  { id: "tokens", label: "Tokens" },
  { id: "cost", label: "Cost" },
  { id: "runs", label: "Runs" },
  { id: "name", label: "Name" },
];

const fmtSize = (mb: number) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;

const isoDay = (offsetDays: number) =>
  new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

const inputCls =
  "rounded-lg border border-white/[0.08] bg-canvas-deep/60 px-2.5 py-[5px] font-mono text-[11.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";

const chipCls = (active: boolean) =>
  cn(
    "rounded-md px-2.5 py-1 font-mono text-[11.5px] transition-colors",
    active ? "bg-white/[0.08] text-foreground" : "text-muted-foreground/70 hover:text-foreground",
  );

function OperatorsReport() {
  const [period, setPeriod] = useState<Period>("30d");
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(() => isoDay(30));
  const [to, setTo] = useState(() => isoDay(0));
  const [topN, setTopN] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortKey>("tokens");
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState<string[]>([]);

  const span: Span = custom ? { from, to } : period;
  const query: RosterQuery = { topN, sortBy, search, ...(only.length ? { userIds: only } : {}) };

  /** live operator roster from postgres */
  const { operators: everyone } = useOperatorReports(span, { sortBy: "name" });
  const { operators: list, totals: rt, loading } = useOperatorReports(span, query);
  const [selected, setSelected] = useState<string>("");
  const active = useMemo(() => {
    if (selected) {
      const found = list.find((u) => u.id === selected);
      if (found) return found;
    }
    if (only.length === 1) {
      const single = list.find((u) => u.id === only[0]);
      if (single) return single;
    }
    return list[0];
  }, [list, selected, only]);

  /** RAG activity resolved for the operators currently in scope. */
  const knowledge = useKnowledge();
  const { spaces } = useSpaces();
  const { rows: ragQueries } = useRagQueries();
  const spanWin = useMemo(() => {
    const r = resolveSpan(span);
    return { from: r.end - (r.days - 1) * 86_400_000, to: r.end + 86_400_000 };
  }, [custom, from, to, period]);

  const spaceName = (id?: string) => spaces.find((s) => s.id === id)?.name ?? "unassigned";

  const ragFor = (u: { id: string; name: string; username: string }) => {
    const mine = knowledge.sources.filter(
      (d) =>
        (d.owner === u.id || d.ownerName === u.username || d.ownerName === u.name) &&
        (d.addedAt ?? 0) >= spanWin.from &&
        (d.addedAt ?? 0) < spanWin.to,
    );
    const qs = ragQueries.filter(
      (q) =>
        (q.principalId === u.id || q.principal === u.name || q.principal === u.username) &&
        q.at >= spanWin.from &&
        q.at < spanWin.to,
    );
    return {
      docs: mine,
      queries: qs,
      mb: mine.reduce((n, d) => n + (d.sizeMb ?? 0), 0),
      chunks: mine.reduce((n, d) => n + (d.chunks ?? 0), 0),
      lastUpload: mine.reduce((n, d) => Math.max(n, d.addedAt ?? 0), 0),
    };
  };

  const ragRoster = useMemo(
    () =>
      list.map((u) => ({ u, r: ragFor(u) })).filter((x) => x.r.docs.length || x.r.queries.length),
    [list, knowledge.sources, ragQueries, spanWin, spaces],
  );
  const activeRag = active ? ragFor(active) : undefined;

  const toggleOnly = (id: string) =>
    setOnly((o) => {
      const exists = o.includes(id);
      const next = exists ? o.filter((x) => x !== id) : [...o, id];
      if (!exists) {
        setSelected(id);
      } else if (selected === id) {
        setSelected(next[0] || "");
      }
      return next;
    });

  const exportRoster = async () => {
    await exportReportPdf(buildReport("operator-roster", span, undefined, query));
    toast.success(topN ? `Top ${topN} operator roster exported` : "Operator roster exported");
  };

  const exportOne = async () => {
    if (!active) return;
    await exportReportPdf(buildReport("operator-detail", span, active.id, query));
    toast.success(`${active.name} deep dive exported`);
  };

  return (
    <Surface
      wide
      title="Operator Analytics"
      meta="WHO DID WHAT · TOKENS · COST TO THE STUDIO"
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PeriodSwitch
            value={custom ? "custom" : period}
            onChange={(v) => {
              if (v === "custom") setCustom(true);
              else {
                setCustom(false);
                setPeriod(v as Period);
              }
            }}
            options={[
              ...periods.map((p) => ({ id: p.id, label: p.label })),
              { id: "custom", label: "Custom" },
            ]}
          />
          <ExportButton onClick={exportRoster} label="Export roster" />
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-white/[0.07] bg-white/[0.015] px-4 py-3">
          {custom && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/45">
                Range
              </span>
              <input
                type="date"
                className={inputCls}
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="font-mono text-[11px] text-muted-foreground/40">→</span>
              <input
                type="date"
                className={inputCls}
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/45">
              Top
            </span>
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-raised/30 p-1">
              {TOPS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTopN(n)}
                  className={chipCls(topN === n)}
                >
                  {n === 0 ? "All" : `Top ${n}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/45">
              Rank by
            </span>
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-raised/30 p-1">
              {SORTS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSortBy(o.id)}
                  className={chipCls(sortBy === o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <input
            className={cn(inputCls, "min-w-[190px] flex-1")}
            value={search}
            placeholder="filter by name, @user, role…"
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="flex w-full flex-wrap items-center gap-2 border-t border-white/[0.05] pt-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/45">
              Operators
            </span>
            <OperatorPicker
              options={everyone.map((u) => ({
                id: u.id,
                name: u.name,
                meta: `@${u.username} · ${u.role}${u.provider && u.provider !== "local" ? ` · ${u.provider.toUpperCase()}` : ""}`,
              }))}
              value={only}
              onToggle={toggleOnly}
              onClear={() => {
                setOnly([]);
                setSelected("");
              }}
            />
          </div>

          <div className="w-full font-mono text-[11px] text-muted-foreground/45">
            {spanLabel(span)} · {list.length} operator{list.length === 1 ? "" : "s"} in scope
            {topN ? ` · top ${topN} by ${sortBy}` : ""}
          </div>
        </div>

        <KpiGrid
          items={[
            {
              label: "Operators",
              value: String(rt.operators),
              hint: "with recorded activity",
              tone: "sapphire",
            },
            { label: "Runs", value: fmtInt(rt.runs), tone: "emerald" },
            {
              label: "Tokens",
              value: fmtTokens(rt.tokens),
              hint: "input + output",
              tone: "amethyst",
            },
            {
              label: "Cost",
              value: fmtMoney(rt.cost),
              hint: `${fmtMoney(rt.cloudCost)} cloud`,
              tone: "topaz",
            },
          ]}
        />

        <ReportPanel title="Roster" hint="Select an operator to open the deep dive">
          {list.length > 0 ? (
            <DataTable
              columns={[
                "Operator",
                "Role",
                "Provider",
                "Runs",
                "Local tokens",
                "Cloud tokens",
                "Cost",
                "Success",
                "Status",
              ]}
              align={["left", "left", "left", "right", "right", "right", "right", "right", "left"]}
              rows={list.map((u) => {
                const isSelected = active?.id === u.id;
                return [
                  <button
                    key="n"
                    type="button"
                    onClick={() => setSelected(u.id)}
                    className={cn(
                      "flex items-center text-left transition-colors hover:text-sapphire",
                      isSelected ? "text-sapphire font-semibold" : "text-foreground",
                    )}
                  >
                    <span>{u.name}</span>
                    <span className="ml-2 font-mono text-[11.5px] text-muted-foreground/60">
                      @{u.username}
                    </span>
                    {isSelected && (
                      <span className="ml-2 rounded border border-sapphire/40 bg-sapphire/15 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-sapphire">
                        Active
                      </span>
                    )}
                  </button>,
                  <span key="r" className="font-mono text-[12px] text-muted-foreground/75">
                    {u.role}
                  </span>,
                  <span
                    key="p"
                    className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60"
                  >
                    {u.provider || "local"}
                  </span>,
                  fmtInt(u.runs),
                  fmtTokens(u.localTokens),
                  fmtTokens(u.cloudTokens),
                  fmtMoney(u.cost),
                  `${u.successRate}%`,
                  <span
                    key="s"
                    className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground/55"
                  >
                    {u.locked ? "locked" : u.status}
                  </span>,
                ];
              })}
            />
          ) : (
            <div className="py-8 text-center font-mono text-[12px] text-muted-foreground/50">
              {loading ? "Loading operators..." : "No operators found matching the criteria"}
            </div>
          )}
        </ReportPanel>

        {active && (
          <div className="grid gap-6 xl:grid-cols-2">
            <ReportPanel
              title={`Deep dive · ${active.name}`}
              hint={`${active.role} · ${active.email}`}
              action={<ExportButton onClick={exportOne} label="Export operator PDF" />}
            >
              <div className="space-y-4">
                <Sparkline values={active.series.map((d) => d.tokens)} tone="sapphire" />
                <DataTable
                  columns={["Metric", "Value"]}
                  align={["left", "right"]}
                  rows={[
                    ["Sessions", fmtInt(active.sessions)],
                    ["Runs", fmtInt(active.runs)],
                    ["Input tokens", fmtTokens(active.inputTokens)],
                    ["Output tokens", fmtTokens(active.outputTokens)],
                    [
                      "Local runtime",
                      `${fmtTokens(active.localTokens)} · ${fmtMoney(active.localCost)}`,
                    ],
                    [
                      "Cloud providers",
                      `${fmtTokens(active.cloudTokens)} · ${fmtMoney(active.cloudCost)}`,
                    ],
                    ["Tool / MCP calls", fmtInt(active.toolCalls)],
                    ["Approvals raised", fmtInt(active.approvals)],
                    ["Avg latency", `${active.latency}ms`],
                    ["Total cost", fmtMoney(active.cost)],
                  ]}
                />
              </div>
            </ReportPanel>

            <div className="space-y-6">
              <ReportPanel title="Where the tokens went">
                <BarList
                  rows={active.workloads.map((w) => ({
                    label: w.label,
                    value: w.tokens,
                    caption: `${fmtTokens(w.tokens)} · ${fmtMoney(w.cost)}`,
                  }))}
                  tone="emerald"
                />
              </ReportPanel>
              <ReportPanel title="Model usage">
                <BarList
                  rows={active.models.map((w) => ({
                    label: w.label,
                    value: w.tokens,
                    caption: `${fmtTokens(w.tokens)} · ${fmtMoney(w.cost)}`,
                  }))}
                  tone="amethyst"
                />
              </ReportPanel>
            </div>
          </div>
        )}

        <ReportPanel
          title="RAG activity"
          hint="Documents ingested and retrieval queries for the operators in scope"
        >
          {ragRoster.length ? (
            <DataTable
              columns={["Operator", "Documents", "Volume", "Chunks", "Queries", "Last upload"]}
              align={["left", "right", "right", "right", "right", "left"]}
              rows={ragRoster.map(({ u, r }) => {
                const isSelected = active?.id === u.id;
                return [
                  <button
                    key="n"
                    type="button"
                    onClick={() => setSelected(u.id)}
                    className={cn(
                      "flex items-center text-left transition-colors hover:text-sapphire",
                      isSelected ? "text-sapphire font-semibold" : "text-foreground",
                    )}
                  >
                    <span>{u.name}</span>
                    <span className="ml-2 font-mono text-[11.5px] text-muted-foreground/60">
                      @{u.username}
                    </span>
                    {isSelected && (
                      <span className="ml-2 rounded border border-sapphire/40 bg-sapphire/15 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-sapphire">
                        Active
                      </span>
                    )}
                  </button>,
                  fmtInt(r.docs.length),
                  r.mb ? fmtSize(r.mb) : "—",
                  fmtInt(r.chunks),
                  fmtInt(r.queries.length),
                  <span key="l" className="font-mono text-[11.5px] text-muted-foreground/65">
                    {r.lastUpload ? new Date(r.lastUpload).toISOString().slice(0, 10) : "—"}
                  </span>,
                ];
              })}
            />
          ) : (
            <div className="py-8 text-center font-mono text-[12px] text-muted-foreground/50">
              no RAG uploads or queries for the operators in scope
            </div>
          )}
        </ReportPanel>

        {active && activeRag && (
          <div className="grid gap-6 xl:grid-cols-2">
            <ReportPanel
              title={`RAG uploads · ${active.name}`}
              hint={`${activeRag.docs.length} document${activeRag.docs.length === 1 ? "" : "s"} · ${fmtSize(activeRag.mb)}`}
            >
              {activeRag.docs.length ? (
                <DataTable
                  columns={["Document", "Type", "Space", "Size", "Chunks", "Status"]}
                  align={["left", "left", "left", "right", "right", "left"]}
                  rows={activeRag.docs
                    .slice()
                    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
                    .map((d) => [
                      d.name,
                      fileKind(d.name).label,
                      spaceName(d.space),
                      d.sizeMb ? fmtSize(d.sizeMb) : "—",
                      fmtInt(d.chunks ?? 0),
                      <span
                        key="s"
                        className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground/60"
                      >
                        {d.status}
                      </span>,
                    ])}
                />
              ) : (
                <div className="py-8 text-center font-mono text-[12px] text-muted-foreground/50">
                  this operator has not ingested any document in this window
                </div>
              )}
            </ReportPanel>
            <ReportPanel
              title={`RAG queries · ${active.name}`}
              hint="What this operator asked the corpus"
            >
              {activeRag.queries.length ? (
                <DataTable
                  columns={["When", "Question", "Spaces", "Docs"]}
                  align={["left", "left", "left", "right"]}
                  rows={activeRag.queries.slice(0, 25).map((q) => [
                    <span key="w" className="font-mono text-[12px] text-muted-foreground/70">
                      {new Date(q.at).toISOString().slice(5, 16).replace("T", " ")}
                    </span>,
                    q.query.length > 60 ? `${q.query.slice(0, 60)}…` : q.query,
                    <span key="s" className="font-mono text-[11.5px] text-muted-foreground/65">
                      {q.spaces.join(", ") || "all readable"}
                    </span>,
                    String(q.docs),
                  ])}
                />
              ) : (
                <div className="py-8 text-center font-mono text-[12px] text-muted-foreground/50">
                  no retrieval queries recorded for this operator
                </div>
              )}
            </ReportPanel>
          </div>
        )}

        {active && (
          <ReportPanel title="Recent activity" hint="Latest recorded operations for this operator">
            <DataTable
              columns={["When", "Kind", "Detail", "Tokens", "Cost"]}
              align={["left", "left", "left", "right", "right"]}
              rows={active.activity.map((a) => [
                <span key="w" className="font-mono text-[12px] text-muted-foreground/70">
                  {a.at}
                </span>,
                <span
                  key="k"
                  className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-sapphire/80"
                >
                  {a.kind}
                </span>,
                a.detail,
                fmtInt(a.tokens),
                `$${a.cost.toFixed(3)}`,
              ])}
            />
          </ReportPanel>
        )}
      </div>
    </Surface>
  );
}
