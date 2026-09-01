import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Database,
  HardDrive,
  Activity,
  Zap,
  Gauge,
  BrainCircuit,
  Play,
  RotateCcw,
  FolderSearch,
  Sliders,
  Save,
  Trash2,
  Square,
} from "lucide-react";
import {
  DatabaseAPI,
  SystemAPI,
  type DatabaseStatsDTO,
  type EmbeddingBackfillEvent,
  type EmbeddingHealthDTO,
} from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

function fmtBytes(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function Donut({
  value,
  label,
  sub,
  tone = "ok",
}: {
  value: number;
  label: string;
  sub?: string;
  tone?: "ok" | "warn";
}) {
  const v = Math.max(0, Math.min(100, value));
  const stroke = tone === "warn" ? "hsl(var(--destructive))" : "hsl(var(--primary))";
  const c = 2 * Math.PI * 28;
  const dash = (v / 100) * c;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width="80"
        height="80"
        viewBox="0 0 80 80"
        className="drop-shadow-[0_0_8px_hsl(var(--primary)/0.4)]"
      >
        <circle cx="40" cy="40" r="28" stroke="hsl(var(--border))" strokeWidth="6" fill="none" />
        <circle
          cx="40"
          cy="40"
          r="28"
          stroke={stroke}
          strokeWidth="6"
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 40 40)"
        />
        <text
          x="40"
          y="44"
          textAnchor="middle"
          className="fill-foreground text-[13px] font-mono font-bold"
        >
          {v.toFixed(v < 10 ? 1 : 0)}%
        </text>
      </svg>
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      {sub && <p className="text-[9px] font-mono text-muted-foreground/70">{sub}</p>}
    </div>
  );
}

function StatBox({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded border border-border bg-card/40 p-2">
      <p
        className={`text-base font-mono font-bold ${tone === "warn" ? "text-destructive" : "text-primary"}`}
      >
        {value}
      </p>
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

export function DatabaseOps() {
  const { locale } = useI18n();
  const [s, setS] = useState<DatabaseStatsDTO | null>(null);
  const [embed, setEmbed] = useState<EmbeddingHealthDTO | null>(null);
  const [run, setRun] = useState<EmbeddingBackfillEvent | null>(null);
  const [busy, setBusy] = useState<"mark" | "backfill" | "validate" | "apply" | "cleanup" | "nuke" | "reprocess" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState<string>("");
  const [pathDraftTouched, setPathDraftTouched] = useState(false);
  const [pathStatus, setPathStatus] = useState<"idle" | "verified" | "invalid">("idle");
  const [autoState, setAutoState] = useState<"idle" | "running" | "done">("idle");
  const refreshEmbedding = async () => setEmbed(await DatabaseAPI.embeddingHealth());

  // RAG tuning has been consolidated into Knowledge Hub → RAG Control & Health.
  // This panel keeps inventory / vector forge ops only.


  const libraryOk = !!embed?.library?.exists && !!embed.library.isDirectory && !!embed.library.readable;

  const startBackfill = async (silent = false) => {
    setBusy("backfill");
    setRun(null);
    setAutoState("running");
    try {
      const last = await DatabaseAPI.backfillEmbeddings({ batch: 32, retryErrors: true }, setRun);
      if (!silent) toast.success(`Vector backfill completed · scanned ${last.scanned ?? 0}`);
      await refreshEmbedding();
      setAutoState("done");
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
      setAutoState("idle");
    } finally {
      setBusy(null);
    }
  };

  const stopBackfill = async () => {
    try {
      const r = await SystemAPI.stopJob("backfill");
      const ownerHost = r.owner?.owner_host ?? "worker";
      toast.success(`Stop signal sent to ${ownerHost}`);
      await refreshEmbedding();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    }
  };

  // Autonomous harvest: when path is verified and pending chunks exist, kick
  // off backfill once per session — operator never presses "Start".
  useEffect(() => {
    if (busy) return;
    if (autoState !== "idle") return;
    if (!embed?.configured) return;
    if (!libraryOk) return;
    if ((embed?.totals.pending ?? 0) <= 0) return;
    // Don't double-start: another host (or this one) already owns the job.
    if (embed?.worker && (embed.worker.state === "running" || embed.worker.state === "stopping")) return;
    void startBackfill(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed?.totals.pending, embed?.configured, libraryOk, embed?.worker?.state]);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const [d, e] = await Promise.all([
          DatabaseAPI.stats().catch(() => null),
          DatabaseAPI.embeddingHealth().catch(() => null),
        ]);
        if (!alive) return;
        // Preserve last-known values on transient failure — never blank the UI.
        if (d) setS(d);
        if (e) {
          setEmbed(e);
          if (!pathDraftTouched) setPathDraft(e.library?.path ?? e.defaultRoot ?? "");
        }
        if (d || e) setErr(null);
        else if (!s && !embed) setErr("bridge unreachable");
      } finally {
        inFlight = false;
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxBytes = s ? Math.max(...s.tables.map((t) => t.bytes), 1) : 1;
  const connPct = s ? Math.min(100, (s.connections.total / 100) * 100) : 0;
  const pendingPct = embed?.totals.chunks ? (embed.totals.pending / embed.totals.chunks) * 100 : 0;
  const donePct = embed?.totals.chunks ? (embed.totals.done / embed.totals.chunks) * 100 : 0;
  const markPending = async () => {
    setBusy("mark");
    try {
      const h = await DatabaseAPI.markEmbeddingPending(true);
      setEmbed(h);
      setAutoState("idle"); // allow auto-restart
      toast.success(`Pending queue sealed · ${h.marked.toLocaleString()} chunks`);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };
  const cleanupGhosts = async () => {
    setBusy("cleanup");
    try {
      const r = await DatabaseAPI.cleanupKnowledge(true);
      const [nextStats, nextEmbed] = await Promise.all([
        DatabaseAPI.stats().catch(() => null),
        DatabaseAPI.embeddingHealth().catch(() => null),
      ]);
      if (nextStats) setS(nextStats);
      if (nextEmbed) setEmbed(nextEmbed);
      toast.success(`Ghost index cleanup complete · ${r.removedFiles.toLocaleString()} files · ${r.removedChunks.toLocaleString()} chunks · ${(r.removedDocuments ?? 0).toLocaleString()} docs · ${(r.removedEmbeddings ?? 0).toLocaleString()} embeds`);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const nukeAndReindex = async () => {
    const ok = window.confirm("Physically wipe the RAG/vector DB without starting a scan?");
    if (!ok) return;
    setBusy("nuke");
    setAutoState("idle");
    try {
      const r = await DatabaseAPI.nukeAndReindex();
      setEmbed(r.status);
      const nextStats = await DatabaseAPI.stats().catch(() => null);
      if (nextStats) setS(nextStats);
      if ((r.ghostsRemaining?.total ?? 0) > 0) throw new Error(`Nuke verification failed · ghost records remaining: ${r.ghostsRemaining?.total}`);
      toast.success(`Nuke complete · ${r.removedChunks.toLocaleString()} chunks · ${r.removedEmbeddings.toLocaleString()} embeds removed · scan not started`);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
      setAutoState("idle");
    } finally {
      setBusy(null);
    }
  };

  const reprocessHtmlJson = async () => {
    setBusy("reprocess");
    try {
      const r = await DatabaseAPI.reprocessExtensions([".html", ".htm", ".json"]);
      toast.success(`Re-processing ${r.cleared.toLocaleString()} HTML/JSON files · scan started`);
      const [nextStats, nextEmbed] = await Promise.all([
        DatabaseAPI.stats().catch(() => null),
        DatabaseAPI.embeddingHealth().catch(() => null),
      ]);
      if (nextStats) setS(nextStats);
      if (nextEmbed) setEmbed(nextEmbed);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const validatePath = async () => {
    const candidate = pathDraft.trim();
    if (!candidate) return;
    setBusy("validate");
    try {
      const r = await DatabaseAPI.validateLibraryPath(candidate);
      if (r.verified) {
        setPathStatus("verified");
        toast.success("Path verified · folder visible");
      } else {
        setPathStatus("invalid");
        toast.error(r.error || ("Folder unreadable"));
      }
    } catch (e) {
      setPathStatus("invalid");
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };
  const applyPath = async (scan: boolean) => {
    const candidate = pathDraft.trim();
    if (!candidate) return;
    setBusy("apply");
    try {
      const h = await DatabaseAPI.setLibraryPath(candidate, scan);
      setEmbed(h);
      setPathStatus("verified");
      setPathDraftTouched(false);
      setAutoState("idle"); // re-arm autonomous backfill for the new path
      toast.success(scan
        ? ("Knowledge Base sealed · scan started")
        : ("Knowledge Base sealed"));
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="glass mb-6 border-primary/20">
      <CardHeader>
        <CardTitle className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          {"Database Ops · Live PostgreSQL Telemetry"}
          {s && (
            <Badge
              variant="outline"
              className="ml-2 font-mono text-[10px] text-muted-foreground border-border"
              title={s.database}
            >
              {fmtBytes(s.sizeBytes)}
            </Badge>
          )}
          {err && (
            <Badge variant="outline" className="ml-2 text-destructive font-mono text-[10px]">
              offline
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Live metrics — donuts */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 rounded-lg border border-border bg-card/40">
          <Donut
            value={s?.cache.hitRate ?? 0}
            label="Cache Hit Rate"
            sub={
              s
                ? `${s.cache.blksHit.toLocaleString()} hit / ${s.cache.blksRead.toLocaleString()} read`
                : undefined
            }
            tone={s && s.cache.hitRate < 95 ? "warn" : "ok"}
          />
          <Donut
            value={connPct}
            label="Connections"
            sub={s ? `${s.connections.active} active · ${s.connections.idle} idle` : undefined}
            tone={s && s.connections.total > 80 ? "warn" : "ok"}
          />
          <div className="flex flex-col items-center justify-center gap-1 border border-border rounded p-2 bg-card/40">
            <Zap className="h-5 w-5 text-primary" />
            <p className="text-lg font-mono font-bold text-primary">
              {s ? `${s.throughput.readsPerSec.toFixed(1)}` : "—"}
            </p>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Reads / sec
            </p>
            <p className="text-[9px] font-mono text-muted-foreground/70">
              {s ? `${s.throughput.commitsPerSec.toFixed(1)} commits/s` : ""}
            </p>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 border border-border rounded p-2 bg-card/40">
            <Gauge className="h-5 w-5 text-primary" />
            <p className="text-lg font-mono font-bold text-primary">
              {s ? `${s.throughput.writesPerSec.toFixed(1)}` : "—"}
            </p>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Writes / sec
            </p>
            <p className="text-[9px] font-mono text-muted-foreground/70">
              {s ? `${s.throughput.rollbacksPerSec.toFixed(2)} rollback/s` : ""}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-primary/20 bg-card/40 p-3 space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h4 className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <BrainCircuit className="h-3.5 w-3.5 text-primary" /> Vector Forge · pgvector
                HNSW
              </h4>
              <p className="mt-1 text-[10px] font-mono text-muted-foreground/70 truncate">
                {embed
                  ? `${embed.database ?? "postgres"} · ${embed.dim}D · ${embed.model ?? "LOCAL model not configured"}`
                  : "Checking vector seal…"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="font-mono text-[10px]">
                {embed?.indexes.some((i) => i.name === "idx_kchunks_embedding_hnsw")
                  ? "HNSW sealed"
                  : "HNSW pending"}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="h-8 font-mono text-[10px]"
                disabled={!!busy}
                onClick={markPending}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> {"Recount Pending"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 font-mono text-[10px]"
                disabled={!!busy}
                onClick={cleanupGhosts}
                title={"Physically remove stale vector ghosts"}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> {busy === "cleanup" ? "…" : "Cleanup"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 font-mono text-[10px]"
                disabled={!!busy}
                onClick={nukeAndReindex}
                title={"Physically reset the full RAG DB without starting a scan"}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> {busy === "nuke" ? "Nuking…" : "Nuke"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 font-mono text-[10px]"
                disabled={!!busy}
                onClick={reprocessHtmlJson}
                title={"Clear checksum for .html/.htm/.json so they re-extract with the new parser (PDFs untouched)"}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> {busy === "reprocess" ? "Queuing…" : "Re-process HTML & JSON"}
              </Button>
              {(() => {
                const w = embed?.worker;
                const remoteRunning = !!w && (w.state === "running" || w.state === "stopping") && !w.isLocal;
                const anyRunning = !!w && (w.state === "running" || w.state === "stopping");
                const stopping = w?.state === "stopping" || w?.stopRequested;
                return (
                  <>
                    <Button
                      size="sm"
                      className="h-8 font-mono text-[10px]"
                      disabled={!!busy || embed?.configured === false || remoteRunning || anyRunning}
                      onClick={() => startBackfill(false)}
                      title={remoteRunning ? `Vector Forge already running on ${w?.ownerHost}` : "Start vector backfill"}
                    >
                      <Play className="mr-1 h-3.5 w-3.5" />{" "}
                      {busy === "backfill" || anyRunning
                        ? (remoteRunning ? `Running on ${w?.ownerHost}…` : "Vectoring…")
                        : "Start Backfill"}
                    </Button>
                    {anyRunning && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8 font-mono text-[10px]"
                        disabled={stopping}
                        onClick={stopBackfill}
                        title={`Signal ${w?.ownerHost ?? "worker"} to halt the vector backfill`}
                      >
                        <Square className="mr-1 h-3.5 w-3.5" />
                        {stopping ? "Stopping…" : "Stop"}
                      </Button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
            <StatBox label="Chunks" value={embed?.totals.chunks.toLocaleString() ?? "—"} />
            <StatBox
              label="Pending"
              value={embed?.totals.pending.toLocaleString() ?? "—"}
              tone={pendingPct > 0 ? "warn" : "ok"}
            />
            <StatBox label="Embedded" value={embed?.totals.done.toLocaleString() ?? "—"} />
            <StatBox
              label="Errors"
              value={embed?.totals.errored.toLocaleString() ?? "—"}
              tone={(embed?.totals.errored ?? 0) > 0 ? "warn" : "ok"}
            />
            <StatBox label="Files" value={embed?.totals.files.toLocaleString() ?? "—"} />
          </div>
          <div className="rounded border border-border bg-card/40 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  <FolderSearch className="h-3.5 w-3.5 text-primary" /> Library Path Status
                </p>
                <p className="mt-1 truncate font-mono text-xs text-foreground" title={embed?.library?.path ?? embed?.defaultRoot}>
                  {embed?.library?.path ?? embed?.defaultRoot ?? "—"}
                </p>
              </div>
              <Badge
                variant="outline"
                className={`w-fit font-mono text-[10px] ${libraryOk ? "border-primary/40 text-primary" : "border-destructive/40 text-destructive"}`}
              >
                {libraryOk ? "visible" : "blocked"}
              </Badge>
            </div>
            <div className="mt-3 flex flex-col gap-2 md:flex-row">
              <Input
                value={pathDraft}
                placeholder="~/Documents/library/"
                onChange={(e) => {
                  setPathDraft(e.target.value);
                  setPathDraftTouched(true);
                  setPathStatus("idle");
                }}
                className="font-mono text-xs h-8"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 font-mono text-[10px]"
                  disabled={!!busy || !pathDraft.trim()}
                  onClick={validatePath}
                >
                  {busy === "validate" ? "Checking…" : "Validate"}
                </Button>
                <Button
                  size="sm"
                  className="h-8 font-mono text-[10px]"
                  disabled={!!busy || !pathDraft.trim()}
                  onClick={() => applyPath(false)}
                >
                  {busy === "apply" ? "Sealing…" : "Apply"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 font-mono text-[10px]"
                  disabled={!!busy || !pathDraft.trim()}
                  onClick={() => applyPath(true)}
                  title="Apply path and immediately scan the new library"
                >
                  Apply + Scan
                </Button>
              </div>
            </div>
            {pathStatus !== "idle" && (
              <p
                className={`mt-2 text-[10px] font-mono ${pathStatus === "verified" ? "text-emerald-500" : "text-destructive"}`}
              >
                {pathStatus === "verified" ? "● Path Verified — folder visible and readable" : "● Invalid path — folder not found or unreadable"}
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-center md:grid-cols-4">
              <StatBox label="Seen" value={embed?.library?.filesSeen.toLocaleString() ?? "—"} />
              <StatBox label="Indexable" value={embed?.library?.indexableSeen.toLocaleString() ?? "—"} />
              <StatBox label="Root Chunks" value={embed?.library?.chunks.toLocaleString() ?? "—"} />
              <StatBox label="Path Sync" value={(embed?.library?.lastPathSync?.chunksUpdated ?? 0).toLocaleString()} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
              <span>{"Vector coverage"} · {embed?.source ?? "GET /rag/status"}</span>
              <span>{donePct.toFixed(1)}%</span>
            </div>
            <Progress value={donePct} className="h-2" />
            {(busy === "backfill" || autoState === "running" || embed?.worker?.state === "running" || embed?.worker?.state === "stopping") && (
              <p className="flex items-center gap-2 text-[10px] font-mono text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                {embed?.worker && !embed.worker.isLocal
                  ? `Worker is embedding chunks on ${embed.worker.ownerHost}…`
                  : "Worker is embedding chunks… (autonomous)"}
              </p>
            )}
            {run && (
              <p className="text-[10px] font-mono text-muted-foreground">
                {`scanned ${run.scanned ?? 0} · written ${run.written ?? 0} · errors ${run.errors ?? 0}`}
              </p>
            )}
          </div>
          {embed?.roots?.length ? (
            <div className="grid gap-1 text-[10px] font-mono text-muted-foreground">
              {embed.roots.slice(0, 10).map((r) => (
                <div key={r.root} className="grid grid-cols-12 gap-2">
                  <span className="col-span-7 truncate">{r.root}</span>
                  <span className="col-span-2 text-right">{r.files} files</span>
                  <span className="col-span-3 text-right text-primary">
                    {r.pending.toLocaleString()} pending
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {/* Indexed Objects — every URL/text/file currently in the RAG.
              Operator can confirm that "what I added" is actually present. */}
          {embed?.indexedObjects?.length ? (
            <div className="rounded border border-primary/20 bg-card/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h5 className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  <BrainCircuit className="h-3.5 w-3.5 text-primary" />
                  {"Indexed Objects"}
                </h5>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {Object.entries(embed.indexedTotals ?? {})
                    .filter(([k]) => k !== "total")
                    .map(([k, v]) => `${k}:${v}`).join(" · ")}
                  {" · "}
                  <span className="text-primary">total {embed.indexedTotals?.total ?? embed.indexedObjects.length}</span>
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-border/30">
                {embed.indexedObjects.slice(0, 100).map((o) => (
                  <div key={o.id} className="grid grid-cols-12 gap-2 py-1 text-[10px] font-mono">
                    <span className="col-span-1 uppercase text-primary">{o.type.slice(0,4)}</span>
                    <span className="col-span-7 truncate text-foreground" title={o.url || o.name}>
                      {o.url || o.name}
                    </span>
                    <span className="col-span-2 text-right text-muted-foreground">v{o.version}</span>
                    <span className="col-span-2 text-right text-muted-foreground">{o.chunks} ch</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* RAG tuning lives in Knowledge Hub → RAG Control & Health */}
          <div className="rounded border border-primary/20 bg-card/40 p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <Sliders className="h-3.5 w-3.5 text-primary" />
              RAG Tuning · moved
            </div>
            <p className="flex-1 text-[10px] font-mono text-muted-foreground/80">
              Similarity / Inject / Top-K / Chunk Depth / Margin Gate are now
              tuned from the single RAG Control panel in Knowledge Hub.
            </p>
            <Link to="/knowledge" className="text-[10px] font-mono text-primary underline hover:text-primary/80">
              Open Knowledge Hub →
            </Link>
          </div>

        </div>

        {/* Inventory */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <HardDrive className="h-3.5 w-3.5 text-primary" /> Table Inventory · top{" "}
              {s?.tables.length ?? 0}
            </h4>
            <span className="text-[10px] font-mono text-muted-foreground/70 flex items-center gap-1">
              <Activity className="h-3 w-3" /> source: pg_stat_user_tables
            </span>
          </div>
          {!s ? (
            <p className="text-xs font-mono text-muted-foreground">
              {"Sampling connection telemetry…"}
            </p>
          ) : s.tables.length === 0 ? (
            <p className="text-xs font-mono text-muted-foreground">No public tables yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-[320px] overflow-auto pr-1">
              {s.tables.map((t) => {
                const pct = (t.bytes / maxBytes) * 100;
                const hot = t.bytes > maxBytes * 0.75;
                return (
                  <div
                    key={t.name}
                    className="grid grid-cols-12 gap-2 items-center text-[11px] font-mono"
                  >
                    <span className="col-span-3 truncate text-foreground">{t.name}</span>
                    <span className="col-span-2 text-right text-muted-foreground">
                      {t.rows.toLocaleString()} rows
                    </span>
                    <div className="col-span-5">
                      <Progress
                        value={pct}
                        className={`h-2 ${hot ? "[&>div]:bg-destructive" : "[&>div]:bg-primary"}`}
                      />
                    </div>
                    <span
                      className={`col-span-2 text-right ${hot ? "text-destructive" : "text-primary"}`}
                    >
                      {fmtBytes(t.bytes)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
