import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ExternalLink, Plus, RefreshCw, Rss, ShieldAlert, Trash2, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { syncCveSources } from "@/lib/cve-feed.functions";
import {
  ecosystems,
  isCustomProvider,
  isPackageProvider,
  providerLabel,
  providerTone,
  sourcePresets,
  useFeedSources,
  type FeedProvider,
  type FeedSource,
  type SourcePreset,
} from "@/lib/cve-sources";

import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, Sheen, StatusDot, Tag } from "@/components/sovereign/primitives";
import { type Jewel } from "@/components/sovereign/primitives";
import {
  cveStatusTone,
  severityTone,
  useActiveWatchlist,
  useCveFeed,
  useWatchlists,
  type CveEntry,
  type CveStatus,
} from "@/lib/cve-store";
import { cn } from "@/lib/utils";

const description =
  "Vulnerability feed and security audit trail across dependencies, adapters and runtime images.";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "CVE Feed / Audit — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "CVE Feed / Audit — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { view: "feed" | "sources" } => ({
    view: search["view"] === "sources" ? "sources" : "feed",
  }),
  component: SecurityPage,
});

const STATUSES: CveStatus[] = ["new", "acknowledged", "mitigated", "ignored"];

function SecurityPage() {
  const { view } = Route.useSearch();
  const navigate = useNavigate();
  const { entries, update, merge } = useCveFeed();
  const { lists } = useWatchlists();
  const { active } = useActiveWatchlist();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const scoped = useMemo(() => {
    const wl = lists.find((l) => l.id === active)?.name;
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => (wl ? e.watchlist === wl : true))
      .filter((e) =>
        q ? [e.cve, e.title, e.component, e.summary].join(" ").toLowerCase().includes(q) : true,
      )
      .sort((a, b) => b.score - a.score);
  }, [entries, lists, active, query]);

  const counts = {
    critical: scoped.filter((e) => e.severity === "critical").length,
    high: scoped.filter((e) => e.severity === "high").length,
    open: scoped.filter((e) => e.status === "new" || e.status === "acknowledged").length,
    mitigated: scoped.filter((e) => e.status === "mitigated").length,
  };

  const open = entries.find((e) => e.id === openId) ?? null;

  return (
    <Surface
      title="CVE Feed"
      meta={`${scoped.length} advisories · ${counts.critical} critical · ${counts.high} high`}
      crumb="CVE Feed"
      full
      action={
        <div className="flex items-center gap-2">
          {(
            [
              ["feed", "Advisories"],
              ["sources", "Feed sources"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => navigate({ to: "/security", search: { view: id } })}
              className={cn(
                "rounded-lg border px-3 py-[6px] text-[13px] font-medium transition-colors",
                view === id
                  ? "border-white/20 bg-raised/60 text-foreground"
                  : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
          {view === "feed" && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="CVE-2026, parser, adapter…"
              className="h-9 w-[280px] rounded-lg border border-border/70 bg-raised/40 px-3.5 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-sapphire/45"
            />
          )}
        </div>
      }
    >
      {view === "sources" ? (
        <SourcesPanel watchlists={lists.map((l) => l.name)} onImported={merge} />
      ) : (
        <>
          {/* summary strip */}
          <div className="grid gap-3 sm:grid-cols-4">
            {(
              [
                ["critical", counts.critical, "ruby"],
                ["high", counts.high, "topaz"],
                ["open", counts.open, "sapphire"],
                ["mitigated", counts.mitigated, "emerald"],
              ] as const
            ).map(([label, value, tone]) => (
              <div
                key={label}
                className="rounded-xl border border-border/80 bg-raised/20 px-4 py-3.5"
                style={{ boxShadow: `inset 0 0 40px -34px var(--${tone})` }}
              >
                <div className="flex items-center gap-2">
                  <StatusDot tone={tone} pulse={label === "critical" && value > 0} />
                  <span className="mono-label">{label}</span>
                </div>
                <div
                  className="mt-2 font-mono text-[26px] leading-none"
                  style={{ color: `var(--${tone})` }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
            <div className="overflow-hidden rounded-xl border border-border/80 bg-raised/15">
              <div className="grid grid-cols-[150px_minmax(0,1fr)_120px_130px_110px] items-center gap-4 px-5 py-3">
                {["cve", "advisory", "severity", "status", "published"].map((h) => (
                  <span key={h} className="mono-label">
                    {h}
                  </span>
                ))}
              </div>
              <Sheen />
              {scoped.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground/70">
                  <ShieldAlert size={22} strokeWidth={1.4} className="text-emerald/70" />
                  <span className="font-mono text-[12.5px]">no advisories in this watchlist</span>
                </div>
              ) : (
                scoped.map((e) => (
                  <motion.button
                    key={e.id}
                    whileHover={{ backgroundColor: "rgba(255,255,255,0.02)" }}
                    onClick={() => setOpenId(e.id)}
                    className={cn(
                      "grid w-full grid-cols-[150px_minmax(0,1fr)_120px_130px_110px] items-center gap-4 border-t border-border/60 px-5 py-4 text-left",
                      openId === e.id && "bg-raised/45",
                    )}
                  >
                    <span className="font-mono text-[12px] text-foreground/90">{e.cve}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-foreground/95">
                        {e.title}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11.5px] text-muted-foreground/60">
                        {e.component} {e.version} → {e.fixedIn}
                      </span>
                    </span>
                    <Tag tone={severityTone[e.severity]}>
                      {e.score.toFixed(1)} · {e.severity}
                    </Tag>
                    <Tag tone={cveStatusTone[e.status]}>{e.status}</Tag>
                    <span className="font-mono text-[11.5px] text-muted-foreground/60">
                      {new Date(e.publishedAt).toISOString().slice(0, 10)}
                    </span>
                  </motion.button>
                ))
              )}
            </div>

            {open ? (
              <Drawer entry={open} onClose={() => setOpenId(null)} onUpdate={update} />
            ) : (
              <div className="hidden items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-24 font-mono text-[12.5px] text-muted-foreground/60 xl:flex">
                select an advisory
              </div>
            )}
          </div>
        </>
      )}
    </Surface>
  );
}

function Drawer({
  entry,
  onClose,
  onUpdate,
}: {
  entry: CveEntry;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<CveEntry>) => void;
}) {
  const [note, setNote] = useState(entry.note);
  return (
    <motion.aside
      key={entry.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="h-fit overflow-hidden rounded-xl border border-sapphire/25 bg-raised/25 backdrop-blur-xl"
    >
      <header className="flex items-center gap-2 px-5 pt-5">
        <ShieldAlert size={14} className="text-sapphire" strokeWidth={1.7} />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-muted-foreground/65">
          advisory · {entry.cve}
        </span>
        <button
          onClick={onClose}
          className="ml-auto"
          aria-label="Close advisory"
          title="Close advisory"
        >
          <X size={14} className="text-muted-foreground/60 hover:text-foreground" />
        </button>
      </header>

      <div className="px-5 pb-5 pt-3.5">
        <h2 className="text-[17px] font-medium leading-snug text-foreground">{entry.title}</h2>
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
          {entry.summary}
        </p>

        <div className="mt-4 grid gap-x-6 gap-y-2 font-mono text-[11.5px] sm:grid-cols-2">
          {[
            ["score", `${entry.score.toFixed(1)} ${entry.severity}`],
            ["watchlist", entry.watchlist],
            ["component", `${entry.component} ${entry.version}`],
            ["fixed in", entry.fixedIn],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="uppercase tracking-[0.16em] text-muted-foreground/55">{k}</span>
              <span className="truncate text-foreground/90">{v}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-border/70 bg-canvas/50 px-3.5 py-2.5 font-mono text-[11.5px] text-muted-foreground">
          {entry.vector}
        </div>

        <div className="mt-4">
          <span className="mono-label">affected assets</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entry.affected.map((a) => (
              <Tag key={a} tone="amethyst">
                {a}
              </Tag>
            ))}
          </div>
        </div>

        <a
          href={entry.reference}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-sapphire hover:underline"
        >
          <ExternalLink size={12} strokeWidth={1.7} /> reference
        </a>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => onUpdate(entry.id, { note })}
          rows={2}
          placeholder="Triage note…"
          className="mt-4 w-full resize-none rounded-lg border border-border/70 bg-canvas/50 px-3.5 py-2.5 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-sapphire/45"
        />

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {STATUSES.filter((s) => s !== entry.status).map((s) => (
            <JewelButton
              key={s}
              size="sm"
              variant={s === "ignored" ? "ghost" : "outline"}
              onClick={() => onUpdate(entry.id, { status: s, note })}
            >
              {s === "acknowledged"
                ? "Acknowledge"
                : s === "mitigated"
                  ? "Mitigate"
                  : s === "ignored"
                    ? "Ignore"
                    : "Reopen"}
            </JewelButton>
          ))}
        </div>
      </div>
    </motion.aside>
  );
}

function SourcesPanel({
  watchlists,
  onImported,
}: {
  watchlists: string[];
  onImported: (rows: Parameters<ReturnType<typeof useCveFeed>["merge"]>[0]) => void;
}) {
  const { sources, add, update, remove } = useFeedSources();
  const run = useServerFn(syncCveSources);
  const [busy, setBusy] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [picker, setPicker] = useState(false);

  const sync = async (only?: FeedSource) => {
    const batch = (only ? [only] : sources.filter((s) => s.enabled)).filter(
      (s) => s.query.trim() || s.url.trim() || s.provider === "kev",
    );
    if (!batch.length) {
      setSummary("nothing to sync — enable a source and give it a package, keyword or URL");
      return;
    }
    setBusy(only ? only.id : "all");
    setSummary("");
    try {
      const { results } = await run({
        data: {
          sources: batch.map((s) => ({
            id: s.id,
            provider: s.provider,
            watchlist: s.watchlist,
            ecosystem: s.ecosystem,
            query: s.query,
            version: s.version,
            url: s.url,
            headers: s.headers,
            map: s.map,
            defaultScore: s.defaultScore,
            minScore: s.minScore,
          })),
        },
      });
      let added = 0;
      for (const r of results) {
        const src = batch.find((s) => s.id === r.sourceId);
        if (!src) continue;
        if (r.advisories.length) {
          onImported(
            r.advisories.map((a) => ({
              cve: a.cve,
              title: a.title,
              summary: a.summary,
              score: a.score,
              severity: a.severity,
              watchlist: src.watchlist,
              component: a.component,
              version: a.version,
              fixedIn: a.fixedIn,
              vector: a.vector,
              reference: a.reference,
              publishedAt: a.publishedAt,
              origin: a.key,
              sourceId: src.id,
            })),
          );
          added += r.advisories.length;
        }
        update(src.id, { lastSyncAt: Date.now(), lastResult: r.message });
      }
      setSummary(`${added} new advisor${added === 1 ? "y" : "ies"} imported`);
    } catch (err) {
      setSummary(err instanceof Error ? err.message : "sync failed");
    } finally {
      setBusy(null);
    }
  };

  const drop = async (s: FeedSource) => {
    const ok = await confirmAction({
      title: "Remove this feed source?",
      body: `${s.label || providerLabel[s.provider]}. Advisories already imported stay in the feed.`,
      confirmLabel: "Remove",
      tone: "ruby",
    });
    if (ok) remove(s.id);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[720px] text-[13.5px] leading-relaxed text-muted-foreground">
          Advisories are pulled from public vulnerability databases, exploitation catalogues and any
          intelligence feed you define — RSS/Atom bulletins or a custom JSON endpoint with your own
          field mapping and auth headers.
        </p>
        <div className="flex items-center gap-2">
          <JewelButton size="sm" variant="outline" onClick={() => setPicker(true)}>
            <Plus size={13} strokeWidth={1.8} /> Add source
          </JewelButton>
          <JewelButton size="sm" onClick={() => sync()} disabled={busy !== null}>
            <RefreshCw
              size={13}
              strokeWidth={1.8}
              className={busy === "all" ? "animate-spin" : ""}
            />
            {busy === "all" ? "Syncing…" : "Sync all"}
          </JewelButton>
        </div>
      </div>

      {summary && (
        <div className="mt-4 rounded-lg border border-sapphire/25 bg-raised/25 px-4 py-2.5 font-mono text-[12px] text-foreground/85">
          {summary}
        </div>
      )}

      {picker && (
        <SourcePicker
          onClose={() => setPicker(false)}
          onPick={async (preset) => {
            await add(watchlists[0] ?? "Dependencies", {
              ...preset.patch,
              label: preset.patch.label ?? preset.name,
            });
            setPicker(false);
          }}
        />
      )}

      <div className="mt-6 space-y-3">
        {sources.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/[0.08] py-20 text-muted-foreground/70">
            <Rss size={20} strokeWidth={1.4} className="text-sapphire/70" />
            <span className="font-mono text-[12.5px]">no feed sources defined</span>
          </div>
        )}

        {sources.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border border-border/80 bg-raised/20 px-5 py-4"
            style={{ boxShadow: `inset 0 0 60px -50px var(--${providerTone[s.provider]})` }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => update(s.id, { enabled: !s.enabled })}
                className={cn(
                  "flex h-5 w-9 items-center rounded-full border px-[2px] transition-colors",
                  s.enabled ? "border-emerald/50 bg-emerald/20" : "border-white/10 bg-raised/60",
                )}
                aria-label="Toggle source"
                title="Toggle source"
              >
                <span
                  className={cn(
                    "h-3.5 w-3.5 rounded-full transition-transform",
                    s.enabled ? "translate-x-4 bg-emerald" : "bg-muted-foreground/50",
                  )}
                />
              </button>

              <input
                value={s.label}
                onChange={(e) => update(s.id, { label: e.target.value })}
                placeholder="source name"
                className="h-9 w-[200px] rounded-lg border border-border/70 bg-canvas/50 px-3.5 text-[13px] text-foreground outline-none focus:border-sapphire/45"
              />

              <Select
                value={s.provider}
                onChange={(v) => update(s.id, { provider: v as FeedProvider })}
                options={(Object.keys(providerLabel) as FeedProvider[]).map((p) => [
                  p,
                  providerLabel[p],
                ])}
              />

              {isPackageProvider(s.provider) && (
                <Select
                  value={s.ecosystem}
                  onChange={(v) => update(s.id, { ecosystem: v })}
                  options={ecosystems.map((e) => [e, e])}
                />
              )}

              <input
                value={s.query}
                onChange={(e) => update(s.id, { query: e.target.value })}
                placeholder={
                  isPackageProvider(s.provider)
                    ? "package name"
                    : s.provider === "nvd"
                      ? "keyword (nginx, openssl…)"
                      : "filter term (optional)"
                }
                className="h-9 w-[200px] rounded-lg border border-border/70 bg-canvas/50 px-3.5 font-mono text-[12.5px] text-foreground outline-none focus:border-sapphire/45"
              />

              {isPackageProvider(s.provider) && (
                <input
                  value={s.version}
                  onChange={(e) => update(s.id, { version: e.target.value })}
                  placeholder="version (optional)"
                  className="h-9 w-[140px] rounded-lg border border-border/70 bg-canvas/50 px-3.5 font-mono text-[12.5px] text-foreground outline-none focus:border-sapphire/45"
                />
              )}

              <Select
                value={s.watchlist}
                onChange={(v) => update(s.id, { watchlist: v })}
                options={watchlists.map((w) => [w, `→ ${w}`])}
              />

              <label className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground/70">
                min score
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={s.minScore}
                  onChange={(e) => update(s.id, { minScore: Number(e.target.value) })}
                  className="h-9 w-[70px] rounded-lg border border-border/70 bg-canvas/50 px-2.5 text-center font-mono text-[12.5px] text-foreground outline-none focus:border-sapphire/45"
                />
              </label>

              <div className="ml-auto flex items-center gap-2">
                <JewelButton
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => sync(s)}
                >
                  <RefreshCw
                    size={12}
                    strokeWidth={1.8}
                    className={busy === s.id ? "animate-spin" : ""}
                  />
                  Sync
                </JewelButton>
                <button onClick={() => drop(s)} aria-label="Remove source" title="Remove source">
                  <Trash2 size={14} className="text-ruby/70 hover:text-ruby" />
                </button>
              </div>
            </div>

            {(isCustomProvider(s.provider) || s.provider === "kev") && (
              <div className="mt-3 space-y-2 rounded-lg border border-white/[0.06] bg-canvas/40 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    value={s.url}
                    onChange={(e) => update(s.id, { url: e.target.value })}
                    placeholder={
                      s.provider === "json"
                        ? "https://intel.internal/api/advisories"
                        : "https://vendor.example/security/feed.xml"
                    }
                    className="h-9 min-w-[340px] flex-1 rounded-lg border border-border/70 bg-canvas/60 px-3.5 font-mono text-[12.5px] text-foreground outline-none focus:border-sapphire/45"
                  />
                  <label className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground/70">
                    default score
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      value={s.defaultScore}
                      onChange={(e) => update(s.id, { defaultScore: Number(e.target.value) })}
                      className="h-9 w-[70px] rounded-lg border border-border/70 bg-canvas/60 px-2.5 text-center font-mono text-[12.5px] text-foreground outline-none focus:border-sapphire/45"
                    />
                  </label>
                </div>

                {isCustomProvider(s.provider) && (
                  <textarea
                    value={s.headers}
                    onChange={(e) => update(s.id, { headers: e.target.value })}
                    rows={2}
                    placeholder={"Authorization: Bearer …\nX-Api-Key: …"}
                    className="w-full resize-none rounded-lg border border-border/70 bg-canvas/60 px-3.5 py-2.5 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-sapphire/45"
                  />
                )}

                {s.provider === "json" && (
                  <div className="grid gap-2 sm:grid-cols-4">
                    {(
                      [
                        ["items", "items path"],
                        ["id", "id field"],
                        ["title", "title field"],
                        ["summary", "summary field"],
                        ["score", "score field"],
                        ["published", "date field"],
                        ["link", "link field"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="flex flex-col gap-1">
                        <span className="mono-label">{label}</span>
                        <input
                          value={s.map[k]}
                          onChange={(e) => update(s.id, { map: { ...s.map, [k]: e.target.value } })}
                          placeholder={k === "items" ? "data.results" : k}
                          className="h-8 rounded-lg border border-border/70 bg-canvas/60 px-3 font-mono text-[12px] text-foreground outline-none focus:border-sapphire/45"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[11.5px] text-muted-foreground/60">
              <Tag tone={providerTone[s.provider] as Jewel}>{providerLabel[s.provider]}</Tag>
              <span>{s.lastResult}</span>
              {s.lastSyncAt && (
                <span>
                  · last sync {new Date(s.lastSyncAt).toISOString().slice(0, 16).replace("T", " ")}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourcePicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (preset: SourcePreset) => void;
}) {
  const groups = ["Advisory databases", "Threat intelligence", "Custom"] as const;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-[760px] overflow-auto rounded-xl border border-sapphire/25 bg-raised/60 p-6 backdrop-blur-2xl"
      >
        <header className="flex items-center gap-2">
          <Rss size={14} className="text-sapphire" strokeWidth={1.7} />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.24em] text-muted-foreground/65">
            add feed source
          </span>
          <button
            onClick={onClose}
            className="ml-auto"
            aria-label="Close picker"
            title="Close picker"
          >
            <X size={14} className="text-muted-foreground/60 hover:text-foreground" />
          </button>
        </header>

        {groups.map((g) => (
          <div key={g} className="mt-5">
            <span className="mono-label">{g}</span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {sourcePresets
                .filter((p) => p.group === g)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onPick(p)}
                    className="rounded-lg border border-border/70 bg-canvas/40 px-4 py-3 text-left transition-colors hover:border-sapphire/45 hover:bg-raised/40"
                  >
                    <div className="flex items-center gap-2">
                      <StatusDot tone={providerTone[p.patch.provider ?? "osv"] as Jewel} />
                      <span className="text-[13.5px] text-foreground/95">{p.name}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground/70">
                      {p.blurb}
                    </p>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg border border-border/70 bg-canvas/50 px-3 font-mono text-[12.5px] text-foreground outline-none focus:border-sapphire/45"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v} className="bg-canvas">
          {label}
        </option>
      ))}
    </select>
  );
}
