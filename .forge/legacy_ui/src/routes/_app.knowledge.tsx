import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell, PageHeader } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Plus, Database, FileText, Globe, HardDrive, Trash2, Upload, Pencil, ShieldCheck, RefreshCw, Webhook, Network, GitCompareArrows, Copy, CheckCircle2, XCircle, Square, Activity, History, Tag, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useEffect, useRef, useState } from "react";
import { useSystem, type KnowledgeSource } from "@/lib/system-store";
import { resolveApiBaseUrl, KnowledgeAPI, VaultAPI } from "@/lib/api-client";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import {
  useWebhooks, updateBuiltin, resetBuiltin, addCustom, updateCustom, removeCustom,
  type BuiltinWebhookKey, type CustomWebhook as CustomWebhookT,
} from "@/lib/webhooks-store";
import { RagControlPanel } from "@/components/rag-control-panel";

const MASK = "••••••••";
const isMasked = (v?: string) => v === MASK;

export const Route = createFileRoute("/_app/knowledge")({ component: KnowledgePage });

const ICONS: Record<KnowledgeSource["type"], typeof FileText> = {
  file: FileText, url: Globe, drive: HardDrive, archive: Database,
};

function KnowledgePage() {
  const { locale, t } = useI18n();
  const { sources, setSources, sourcesHydrated } = useSystem();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"file"|"url"|"text"|"dir">("file");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<KnowledgeSource | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Advanced auth for URL fetch
  const [adv, setAdv] = useState(false);
  const [auth, setAuth] = useState({ username: "", password: "", cookie: "", token: "" });
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [liveProgress, setLiveProgress] = useState<{ status?: string; stage?: string; progress?: number; total?: number; scanned?: number; indexed?: number; skipped?: number; currentFile?: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"live" | "history">("live");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof KnowledgeAPI.listSyncJobs>>["jobs"]>([]);
  const [activeJobs, setActiveJobs] = useState<Awaited<ReturnType<typeof KnowledgeAPI.listSyncJobs>>["jobs"]>([]);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [forceVisibleIds, setForceVisibleIds] = useState<Set<string>>(new Set());
  const [selectedJob, setSelectedJob] = useState<Awaited<ReturnType<typeof KnowledgeAPI.syncJobLog>> | null>(null);
  const [liveEvents, setLiveEvents] = useState<Array<{ seq?: number; ts?: number; stage?: string; message?: string; currentFile?: string; scanned?: number; indexed?: number }>>([]);
  // Local Directory indexer
  const [dirPath, setDirPath] = useState("");
  const [dirRecursive, setDirRecursive] = useState(true);
  const [dirRequireRole, setDirRequireRole] = useState("");
  // Upload modal: brand picker (free text + datalist of existing brands)
  const [uploadBrand, setUploadBrand] = useState("");
  // Per-file upload progress: id → { name, status, pct, error?, chunks? }
  type UploadRow = {
    id: string;
    name: string;
    status: "queued" | "uploading" | "processing" | "done" | "error";
    pct: number;
    error?: string;
    chunks?: number;
  };
  const [uploadQueue, setUploadQueue] = useState<UploadRow[]>([]);
  // Inline brand edit popover state (which source id is open + pending value)
  const [brandEditId, setBrandEditId] = useState<string | null>(null);
  const [brandEditValue, setBrandEditValue] = useState("");

  const saveEdit = async () => {
    if (!editing) return;
    // If the user typed a new value (not the bullet mask), encrypt it via the vault
    // and store only the mask in local state.
    const next: KnowledgeSource = { ...editing };
    for (const field of ["password", "cookie", "token", "mfaCode"] as const) {
      const v = editing[field];
      if (v && !isMasked(v)) {
        await VaultAPI.put(`knowledge:${editing.id}`, field, v);
        next[field] = MASK;
      }
    }
    // Persist crawl policy server-side (URL sources only).
    if (next.type === "url" && !next.id.startsWith("dir:")) {
      const r = await KnowledgeAPI.setCrawlConfig(next.id, (next.crawlConfig ?? null) as Record<string, unknown> | null);
      if (!r.ok) toast.error(r.error || "Crawl policy save failed");
    }
    setSources(sources.map(s => s.id === next.id ? next : s));
    setEditing(null);
    toast.success("Source updated · secrets sealed in vault");
  };

  const CRAWL_PRESETS: Record<"single"|"standard"|"deep", NonNullable<KnowledgeSource["crawlConfig"]>> = {
    single:   { recursive: false, preset: "single" },
    standard: { recursive: true,  preset: "standard", maxDepth: 5, maxPages: 2000,  concurrency: 6, maxTotalBytes: 500*1024*1024,        timeBudgetMs: 30*60*1000,  respectRobots: true, skipNoindex: true },
    deep:     { recursive: true,  preset: "deep",     maxDepth: 8, maxPages: 10000, concurrency: 8, maxTotalBytes: 2*1024*1024*1024,     timeBudgetMs: 2*60*60*1000, respectRobots: true, skipNoindex: true },
  };
  const currentPreset = (cc: KnowledgeSource["crawlConfig"]): "single"|"standard"|"deep"|"custom" => {
    if (!cc || !cc.recursive) return "single";
    if (cc.preset === "standard" || cc.preset === "deep") return cc.preset;
    return "custom";
  };

  const remove = async (id: string) => {
    // CASCADE: PostgreSQL'den knowledge_files + knowledge_chunks + knowledge_sources hepsini uçur.
    const r = await KnowledgeAPI.purge(id.startsWith("dir:") ? { id } : { sourceId: id, id });
    setSources(sources.filter(s => s.id !== id));
    if (r.ok) toast.success(`Source purged · files=${("removedFiles" in r ? r.removedFiles : 0) ?? 0} chunks=${("removedChunks" in r ? r.removedChunks : 0) ?? 0}`);
    else toast.error(r.error || "Purge failed");
  };

  const addFromFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const brand = uploadBrand.trim() || null;
    // Seed queue rows so the user sees "Queued → Uploading X% → Processing → Done".
    const rows: UploadRow[] = Array.from(files).map((f) => ({
      id: `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: f.name,
      status: "queued",
      pct: 0,
    }));
    setUploadQueue((q) => [...rows, ...q]);
    setBusy(true);
    const added: KnowledgeSource[] = [];
    let okCount = 0, failCount = 0;
    try {
      // Sequential upload: keeps the local Mac's parse pipeline (PDF/OCR/Whisper)
      // from thrashing under multi-file load; per-row XHR progress is the win.
      for (let i = 0; i < rows.length; i++) {
        const f = files[i];
        const row = rows[i];
        setUploadQueue((q) => q.map((r) => r.id === row.id ? { ...r, status: "uploading", pct: 0 } : r));
        const r = await KnowledgeAPI.uploadFile(f, {
          brand,
          onProgress: (pct) => {
            setUploadQueue((q) => q.map((x) => x.id === row.id ? { ...x, pct, status: pct >= 99 ? "processing" : "uploading" } : x));
          },
        });
        if (r.ok) {
          okCount++;
          setUploadQueue((q) => q.map((x) => x.id === row.id ? { ...x, status: "done", pct: 100, chunks: r.chunks } : x));
          added.push({
            id: r.id || `k-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: r.name || f.name,
            type: f.name.match(/\.(zip|tar|gz|rar)$/i) ? "archive" : "file",
            chunks: r.chunks ?? Math.ceil(f.size / 800),
            progress: 100, tag: "Uploaded File",
            brand,
          });
        } else {
          failCount++;
          setUploadQueue((q) => q.map((x) => x.id === row.id ? { ...x, status: "error", error: r.error || "embed failed" } : x));
          toast.error(`${f.name} → ${r.error || "embed failed"}`);
        }
      }
      if (added.length) setSources([...added, ...sources]);
      if (okCount) toast.success(`${okCount} file embedded${failCount ? ` · ${failCount} failed` : ""}`);
      if (okCount && !failCount) {
        // Auto-close only on clean success; leave modal open with error rows visible otherwise.
        setTimeout(() => { setOpen(false); setUploadQueue([]); }, 800);
      }
    } finally { setBusy(false); }
  };

  const fetchUrl = async () => {
    // Multi-URL: split by newline/comma/space; each fetched in parallel.
    const urls = name.split(/[\s,]+/).map(u => u.trim()).filter(Boolean);
    const valid = urls.filter(u => /^https?:\/\//i.test(u));
    if (!valid.length) { toast.error("Enter at least one valid URL (http/https)"); return; }
    if (valid.length !== urls.length) toast.warning(`${urls.length - valid.length} non-http entries skipped`);
    setBusy(true);
    try {
      const masked = {
        username: auth.username || undefined,
        password: auth.password ? MASK : undefined,
        cookie:   auth.cookie   ? MASK : undefined,
        token:    auth.token    ? MASK : undefined,
      };
      const results = await Promise.all(valid.map(async (url) => {
        const j = await KnowledgeAPI.fetchUrl({ url, ...auth });
        return { url, j };
      }));
      const added: KnowledgeSource[] = [];
      let okCount = 0, failCount = 0, authCount = 0;
      for (const { url, j } of results) {
        if (!j.ok) {
          failCount++;
          // Do NOT push a card for failed fetches — there is no DB row, so any
          // later Sync would send the fake "k-..." id and trip uuid parsing.
          // Only treat as auth_required when the backend explicitly says so.
          if (j.code === "auth_required") {
            authCount++;
            toast.info(`${url} — requires authentication. Open Advanced and add credentials, then retry.`);
          } else {
            toast.error(`${url} · ${j.error ?? `HTTP ${j.status ?? "?"}`}`);
          }
          continue;
        }

        const sourceId = j.id;
        if (!sourceId) { failCount++; toast.error(`${url} · server returned ok without id`); continue; }
        await Promise.all(
          Object.entries(auth)
            .filter(([, v]) => v)
            .map(([k, v]) => VaultAPI.put(`knowledge:${sourceId}`, k, String(v))),
        );
        okCount++;
        added.push({ id: sourceId, name: j.title ?? url, type: "url",
          chunks: j.chunks ?? 0, progress: 100, url, tag: j.tag ?? "Web Source",
          preview: j.preview, ...masked });
      }
      if (added.length) setSources([...added, ...sources]);
      if (okCount) toast.success(`${okCount} URL scraped${failCount ? ` · ${failCount} failed` : ""}`);
      if (authCount && !adv) setAdv(true); // auto-reveal Advanced so user can paste creds
      setName(""); setAuth({ username: "", password: "", cookie: "", token: "" });
      if (okCount && !failCount) { setAdv(false); setOpen(false); }
    } finally { setBusy(false); }
  };

  const addText = async () => {
    if (!text.trim()) { toast.error("Empty text"); return; }
    setBusy(true);
    try {
      const r = await KnowledgeAPI.embedText({
        name: name || `inline-${new Date().toISOString().slice(0,10)}.txt`,
        content: text, tag: "Inline Text",
      });
      if (!r.ok) { toast.error(r.error || "Embed failed"); return; }
      const s: KnowledgeSource = {
        id: r.id || `k-${Date.now()}`,
        name: name || `inline-${new Date().toISOString().slice(0,10)}.txt`,
        type: "file", chunks: r.chunks ?? Math.ceil(text.length / 800), progress: 100, tag: "Inline Text",
      };
      setSources([s, ...sources]);
      toast.success(`Text embedded · ${s.chunks} chunks sealed`);
      setText(""); setName(""); setOpen(false);
    } finally { setBusy(false); }
  };

  const indexDir = async () => {
    // Multi-path: split by newline or comma; each line/entry indexed in parallel.
    const paths = dirPath.split(/[\n,]+/).map(p => p.trim()).filter(Boolean);
    if (!paths.length) { toast.error("Local directory path required"); return; }
    setBusy(true);
    try {
      const results = await Promise.all(paths.map(p =>
        KnowledgeAPI.indexDirectory({
          path: p, recursive: dirRecursive,
          requireRole: dirRequireRole.trim() || null,
        }).then(r => ({ p, r }))
      ));
      const added: KnowledgeSource[] = [];
      let okCount = 0, failCount = 0;
      for (const { p, r } of results) {
        if (!r.ok) { failCount++; toast.error(`${p} → ${r.error ?? "failed"}`); continue; }
        okCount++;
        added.push({
          id: `dir-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
          name: p, type: "drive",
          chunks: r.indexed, progress: 100, tag: "Local Directory",
          notes: `scanned=${r.scanned} indexed=${r.indexed} skipped=${r.skipped} removed=${r.removed} (${r.durationMs}ms)`,
        });
      }
      if (added.length) setSources([...added, ...sources]);
      if (okCount) toast.success(`${okCount} path indexed${failCount ? ` · ${failCount} failed` : ""}`);
      if (okCount && !failCount) setOpen(false);
    } finally { setBusy(false); }
  };

  // Live progress stream (SSE) for the active sync job
  useEffect(() => {
    if (!activeJobId) return;
    // v12 — when a sync starts, surface the Live panel automatically so the
    // operator always sees what is being scanned/indexed without hunting for it.
    setDetailOpen(true);
    setDetailTab("live");
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    (async () => {
      try {
        const res = await fetch(`${resolveApiBaseUrl()}/api/knowledge/sync/${activeJobId}/events`, {
          headers: { Accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) return;
        reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let lastEv = "message";
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split(/\n\n/);
          buf = blocks.pop() || "";
          for (const block of blocks) {
            let ev = lastEv; let data = "";
            for (const line of block.split(/\r?\n/)) {
              if (line.startsWith("event:")) ev = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            lastEv = ev;
            if (!data) continue;
            try {
              const p = JSON.parse(data);
              if (ev === "progress") {
                setLiveProgress({
                  status: p.status, stage: p.stage, progress: p.progress, total: p.total,
                  scanned: p.scanned, indexed: p.indexed, skipped: p.skipped, currentFile: p.currentFile,
                });
                setLiveEvents(prev => {
                  const next = [...prev, { seq: p.seq, ts: p.ts, stage: p.stage, message: p.message, currentFile: p.currentFile, scanned: p.scanned, indexed: p.indexed }];
                  return next.slice(-300);
                });
              } else if (ev === "done") {
                setLiveProgress(prev => ({ ...prev, status: p.status }));
                setSyncing(false);
                if (p.status === "completed") {
                  toast.success("Sync completed");
                  KnowledgeAPI.list().then(f => { if (f.ok) setSources(f.sources as KnowledgeSource[]); });
                } else if (p.status === "cancelled") {
                  toast.message("Sync stopped");
                } else {
                  toast.error(p.error || "Sync failed");
                }
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* stream closed */ }
    })();
    return () => { cancelled = true; try { reader?.cancel(); } catch { /* noop */ } };
  }, [activeJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh history while Detail dialog is open
  useEffect(() => {
    if (!detailOpen) return;
    let alive = true;
    const tick = async () => {
      const r = await KnowledgeAPI.listSyncJobs(20);
      if (!alive) return;
      if (r.ok) setHistory(r.jobs);
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [detailOpen]);

  // Cross-machine adoption: poll every 2s, adopt the current job if our
  // local activeJobId is empty so Mac↔Dell stay in sync.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        if (alive) timer = setTimeout(tick, 2000);
        return;
      }
      const r = await KnowledgeAPI.listSyncJobs(10);
      if (!alive) return;
      if (r.ok) {
        setActiveJobs(r.jobs);
        const current = r.jobs.find(j => j.jobId === r.currentJobId) || r.jobs.find(j => j.status === "running" || j.status === "queued");
        if (current && (current.status === "running" || current.status === "queued")) {
          setActiveJobId(prev => {
            if (prev && prev === current.jobId) return prev;
            if (!prev) {
              setSyncing(true);
              setLiveEvents([]);
              setLiveProgress({ status: current.status, stage: current.lastEvent?.stage, scanned: current.lastEvent?.scanned, indexed: current.lastEvent?.indexed });
              KnowledgeAPI.syncJobLog(current.jobId).then(log => {
                if (log.ok) {
                  setLiveEvents(log.events.map(e => ({ seq: e.seq, ts: e.ts, stage: e.stage, message: e.message, currentFile: e.currentFile, scanned: e.scanned, indexed: e.indexed })));
                }
              });
              return current.jobId;
            }
            return prev;
          });
        }
      }
      if (alive) timer = setTimeout(tick, 2000);
    };
    tick();
    const onVis = () => { if (typeof document !== "undefined" && !document.hidden) tick(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; if (timer) clearTimeout(timer); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Build per-source job map (active jobs only)
  const liveJobsBySource = (() => {
    const map = new Map<string, typeof activeJobs[number]>();
    for (const j of activeJobs) {
      if (j.status !== "running" && j.status !== "queued") continue;
      const tid = j.targetId;
      if (tid) map.set(tid, j);
    }
    return map;
  })();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const syncSourceCard = async (s: KnowledgeSource) => {
    // Guard against ghost cards (failed adds, legacy "k-..." ids) — Postgres
    // expects a uuid sourceId and would otherwise throw "invalid input syntax".
    if (!s.id.startsWith("dir:") && !UUID_RE.test(s.id)) {
      toast.error("This source was never embedded (no DB row). Remove the card and re-add the URL.");
      return;
    }
    const r = await KnowledgeAPI.syncSource({ sourceId: s.id, id: s.id });
    if (!r.ok || !r.jobId) {
      toast.error(r.error || "Failed to start sync");
      return;
    }
    setSyncing(true);
    setLiveEvents([]);
    setActiveJobId(r.jobId);
    toast.success(`Sync started: ${s.name}`);
  };

  const stopJob = async (jobId: string, opts: { force?: boolean } = {}) => {
    setStoppingIds(prev => { const n = new Set(prev); n.add(jobId); return n; });
    if (!opts.force) {
      setTimeout(() => setForceVisibleIds(prev => { const n = new Set(prev); n.add(jobId); return n; }), 10000);
    }
    const r = await KnowledgeAPI.cancelSync(jobId, opts);
    if (!r.ok) {
      toast.error(r.error || "Stop failed");
      setStoppingIds(prev => { const n = new Set(prev); n.delete(jobId); return n; });
      return;
    }
    toast.message(opts.force ? "Force-Stop sent" : "Stop signal sent");
  };

  // Prune stopping/force flags once a job leaves running/queued state.
  useEffect(() => {
    const liveIds = new Set(activeJobs.filter(j => j.status === "running" || j.status === "queued").map(j => j.jobId));
    setStoppingIds(prev => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) { if (liveIds.has(id)) next.add(id); else changed = true; }
      return changed ? next : prev;
    });
    setForceVisibleIds(prev => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) { if (liveIds.has(id)) next.add(id); else changed = true; }
      return changed ? next : prev;
    });
  }, [activeJobs]);


  const openDetail = async () => {
    setDetailOpen(true);
    setDetailTab(syncing || activeJobId ? "live" : "history");
    if (activeJobId) {
      const log = await KnowledgeAPI.syncJobLog(activeJobId);
      if (log.ok) setSelectedJob(log);
    }
  };

  const loadJobLog = async (jobId: string) => {
    const log = await KnowledgeAPI.syncJobLog(jobId);
    if (log.ok) { setSelectedJob(log); setDetailTab("live"); }
  };

  const fmtTs = (ms?: number | null) => ms ? new Date(ms).toLocaleString() : "—";
  const fmtDur = (ms?: number) => {
    if (!ms || ms < 0) return "—";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60); const sr = s % 60;
    if (m < 60) return `${m}m ${sr}s`;
    const h = Math.floor(m / 60); const mr = m % 60;
    return `${h}h ${mr}m`;
  };
  const statusBadgeCls = (status: string) => {
    const map: Record<string, string> = {
      running: "bg-primary/15 text-primary border-primary/30",
      queued: "bg-muted text-muted-foreground border-border",
      completed: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
      cancelled: "bg-amber-500/15 text-amber-500 border-amber-500/30",
      failed: "bg-destructive/15 text-destructive border-destructive/30",
    };
    return map[status] || "bg-muted text-muted-foreground border-border";
  };

  return (
    <PageShell>
      <PageHeader
        title="Knowledge Hub (RAG)"
        subtitle="PDF · TXT · URL · Drive · auto-extract .zip/.tar/.rar"
        actions={
          <div className="flex items-center gap-2">
            {syncing && liveProgress && (
              <span className="hidden md:flex items-center gap-2 mr-1 px-2 py-1 rounded-md border border-border bg-card/60 text-[11px] font-mono text-muted-foreground max-w-[360px] min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span className="text-foreground truncate" title={liveProgress.stage || liveProgress.status || "running"}>{liveProgress.stage || liveProgress.status || "running"}</span>
                <span className="shrink-0">·</span>
                <span className="shrink-0">{liveProgress.indexed ?? 0} idx / {liveProgress.scanned ?? 0} scan</span>
              </span>
            )}
            <Button asChild variant="outline" size="sm" title="Manage brand aliases">
              <Link to="/knowledge/aliases">
                <Tag className="h-4 w-4 mr-1" />
                Brand Aliases
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openDetail}
              title={"Sync detail"}
            >
              <Activity className={`h-4 w-4 mr-1 ${syncing ? "animate-pulse text-primary" : ""}`} />
              {"Detail"}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-primary text-primary-foreground">
                  <Plus className="h-4 w-4 mr-1"/>Add Source
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t("kn.add_source")}</DialogTitle></DialogHeader>
              <Tabs value={tab} onValueChange={v=>setTab(v as typeof tab)}>
                <TabsList className="mb-3">
                  <TabsTrigger value="file">{t("kn.tab_file")}</TabsTrigger>
                  <TabsTrigger value="dir">{t("kn.tab_dir")}</TabsTrigger>
                  <TabsTrigger value="url">{t("kn.tab_url")}</TabsTrigger>
                  <TabsTrigger value="text">{t("kn.tab_text")}</TabsTrigger>
                </TabsList>
                <TabsContent value="dir" className="space-y-3">
                  <div><Label>Local Directory Path(s) — one per line or comma-separated</Label>
                    <textarea value={dirPath} onChange={e=>setDirPath(e.target.value)}
                      rows={4}
                      placeholder={"~/Documents/library\n~/Documents/notes\n/Volumes/External/archive"}
                      className="w-full mt-1 p-2 rounded bg-card/50 border border-border text-xs font-mono"/></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2 border border-border rounded p-2">
                      <Switch checked={dirRecursive} onCheckedChange={setDirRecursive}/>
                      <span className="text-xs font-mono">{t("kn.recursive")}</span>
                    </div>
                    <div><Label className="text-xs">Require Role (optional)</Label>
                      <Input value={dirRequireRole} onChange={e=>setDirRequireRole(e.target.value)}
                        placeholder={t("kn.tags_ph")} className="mt-1 font-mono h-9"/></div>
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground">
                    Multi-path · Incremental · Hybrid (Vector + FTS) · Permission-aware. PDF/DOCX/XLSX + 40+ file types, up to 300 MB each.
                  </p>
                  <DialogFooter>
                    <Button onClick={indexDir} disabled={busy} className="bg-gradient-primary text-primary-foreground">
                      {busy ? "Indexing…" : "Index Directory"}
                    </Button>
                  </DialogFooter>
                </TabsContent>
                <TabsContent value="file" className="space-y-3">
                  <div>
                    <Label className="text-xs">Brand (optional)</Label>
                    <Input
                      list="upload-brand-list"
                      value={uploadBrand}
                      onChange={(e) => setUploadBrand(e.target.value)}
                      placeholder="Auto-detect — type or pick (e.g. netscaler_docs)"
                      className="mt-1 font-mono h-9"
                    />
                    <datalist id="upload-brand-list">
                      {Array.from(new Set(sources.map((s) => s.brand).filter((b): b is string => !!b))).sort().map((b) => (
                        <option key={b} value={b} />
                      ))}
                    </datalist>
                    <p className="text-[10px] font-mono text-muted-foreground mt-1">
                      Leave empty to auto-detect from filename. Explicit brand overrides inference and applies to every chunk.
                    </p>
                  </div>
                  <div className="border border-dashed border-border rounded p-6 text-center">
                    <Upload className="h-8 w-8 mx-auto mb-2 text-primary"/>
                    <p className="text-xs font-mono mb-1 text-muted-foreground">PDF · DOCX · XLSX · PPTX · VSDX · MP4 · MP3 · WAV · PNG (OCR) · ZIP</p>
                    <p className="text-[10px] font-mono mb-3 text-primary/80">Audio/Video → Whisper · Image → OCR · Visio → XML · Login-walled? Upload here.</p>
                    <input ref={fileInput} type="file" multiple hidden
                      accept=".pdf,.txt,.md,.docx,.doc,.rtf,.xlsx,.xls,.pptx,.ppt,.odt,.odp,.ods,.vsdx,.vsdm,.vstx,.vstm,.vsd,.vss,.vst,.zip,.tar,.gz,.rar,.csv,.json,.xml,.yaml,.yml,.html,.log,.png,.jpg,.jpeg,.webp,.bmp,.tiff,.gif,.mp4,.mov,.mkv,.avi,.webm,.wmv,.flv,.m4v,.mpeg,.mpg,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus"
                      onChange={(e)=>addFromFiles(e.target.files)}/>
                    <Button onClick={()=>fileInput.current?.click()} disabled={busy}>
                      {busy ? "Uploading…" : "Upload & Transcribe"}
                    </Button>
                  </div>
                  {uploadQueue.length > 0 && (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto border border-border rounded p-2 bg-card/40">
                      {uploadQueue.map((r) => (
                        <div key={r.id} className="text-[11px] font-mono">
                          <div className="flex items-center gap-2 mb-0.5">
                            {r.status === "uploading" && <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />}
                            {r.status === "processing" && <Loader2 className="h-3 w-3 animate-spin text-amber-500 shrink-0" />}
                            {r.status === "done" && <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />}
                            {r.status === "error" && <XCircle className="h-3 w-3 text-destructive shrink-0" />}
                            {r.status === "queued" && <span className="h-3 w-3 rounded-full bg-muted shrink-0" />}
                            <span className="truncate flex-1" title={r.name}>{r.name}</span>
                            <span className="text-muted-foreground shrink-0">
                              {r.status === "uploading" && `${r.pct}%`}
                              {r.status === "processing" && "parsing…"}
                              {r.status === "done" && `${r.chunks ?? 0} chunks`}
                              {r.status === "error" && "failed"}
                              {r.status === "queued" && "queued"}
                            </span>
                          </div>
                          {(r.status === "uploading" || r.status === "processing") && (
                            <Progress value={r.status === "processing" ? 100 : r.pct} className="h-1" />
                          )}
                          {r.status === "error" && r.error && (
                            <p className="text-destructive text-[10px] truncate" title={r.error}>{r.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="url" className="space-y-3">
                  <div className="rounded border border-primary/30 bg-primary/5 p-2 text-[11px] font-mono leading-relaxed">
                    🌐 <b>Smart Loader:</b> YouTube · Vimeo · Insta · TikTok · Twitter · Twitch · SoundCloud · Udemy · direct .mp4/.mp3 links → auto yt-dlp + Whisper transcribe.<br/>
                    🔒 <b>Login-walled (Udemy/Coursera)?</b> Paste session Cookie below, or download the file and use the <b>File</b> tab → Upload &amp; Transcribe.
                  </div>
                  <div><Label>URL(s) — one per line, comma or space-separated</Label>
                    <textarea value={name} onChange={e=>setName(e.target.value)}
                      rows={3}
                      placeholder={"https://www.youtube.com/watch?v=...\nhttps://vimeo.com/12345\nhttps://docs.example.com/article"}
                      className="w-full mt-1 p-2 rounded bg-card/50 border border-border text-xs font-mono"/></div>
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={()=>setAdv(v=>!v)} className="text-[11px] font-mono text-primary underline">
                      {adv ? "− Hide Advanced" : "+ Advanced (Auth · Cookie · Token)"}
                    </button>
                    <span className="text-[10px] font-mono text-muted-foreground">tag: Web Source · PostgreSQL</span>
                  </div>
                  {adv && (
                    <div className="space-y-2 border border-border rounded p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div><Label className="text-xs">{t("common.username")}</Label>
                          <Input value={auth.username} onChange={e=>setAuth({...auth, username:e.target.value})} className="mt-1 font-mono h-8"/></div>
                        <div><Label className="text-xs">{t("common.password")}</Label>
                          <Input type="password" value={auth.password} onChange={e=>setAuth({...auth, password:e.target.value})} className="mt-1 font-mono h-8"/></div>
                      </div>
                      <div><Label className="text-xs">Cookie / Session (paste browser Cookie header for MFA-locked sites)</Label>
                        <textarea rows={2} value={auth.cookie} onChange={e=>setAuth({...auth, cookie:e.target.value})}
                          placeholder="sessionid=abc123; csrftoken=..."
                          className="w-full mt-1 p-2 rounded bg-card/50 border border-border text-[11px] font-mono"/></div>
                      <div><Label className="text-xs">Bearer Token (optional)</Label>
                        <Input value={auth.token} onChange={e=>setAuth({...auth, token:e.target.value})} placeholder="eyJhbGciOi..." className="mt-1 font-mono h-8"/></div>
                    </div>
                  )}
                  <DialogFooter>
                    <Button onClick={fetchUrl} disabled={busy} className="bg-gradient-primary text-primary-foreground">
                      {busy ? "Fetching…" : "Fetch & Embed URL"}
                    </Button>
                  </DialogFooter>
                </TabsContent>
                <TabsContent value="text" className="space-y-3">
                  <div><Label>{t("common.title")}</Label>
                    <Input value={name} onChange={e=>setName(e.target.value)} className="mt-1 font-mono"/></div>
                  <div><Label>{t("kn.tab_text")}</Label>
                    <textarea value={text} onChange={e=>setText(e.target.value)} rows={6}
                      className="w-full mt-1 p-2 rounded bg-card/50 border border-border text-xs font-mono"/></div>
                  <DialogFooter><Button onClick={addText} className="bg-gradient-primary text-primary-foreground">{t("kn.embed_text")}</Button></DialogFooter>
                </TabsContent>
              </Tabs>
            </DialogContent>
            </Dialog>
          </div>
        }
      />

      <RagControlPanel />

      <ArchitectModules />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sources.map((s) => {
          const Icon = ICONS[s.type];
          const liveJob = liveJobsBySource.get(s.id);
          const isCardRunning = !!liveJob && (liveJob.status === "running" || liveJob.status === "queued");
          const stopping = !!liveJob && stoppingIds.has(liveJob.jobId);
          const showForce = !!liveJob && forceVisibleIds.has(liveJob.jobId);
          const startedFrom = liveJob?.startedBy?.label || liveJob?.startedBy?.host || null;
          return (
            <Card key={s.id} className="glass">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded bg-gradient-primary glow flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{s.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">
                      {s.chunks} chunks · embedded
                      {isCardRunning && startedFrom && (
                        <span className="ml-2 text-primary">· started from {startedFrom}</span>
                      )}
                    </p>
                  </div>
                  <Badge variant="outline" className={`text-[9px] font-mono ${isCardRunning ? statusBadgeCls(liveJob!.status) : ""}`}>
                    {isCardRunning ? liveJob!.status : s.type}
                  </Badge>
                  {!s.id.startsWith("dir:") && (
                    <Popover
                      open={brandEditId === s.id}
                      onOpenChange={(o) => {
                        if (o) { setBrandEditId(s.id); setBrandEditValue(s.brand || ""); }
                        else setBrandEditId(null);
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Badge
                          variant="outline"
                          className="text-[9px] font-mono gap-1 cursor-pointer hover:border-primary"
                          title="Click to edit brand"
                        >
                          <Tag className="h-2.5 w-2.5" />
                          {s.brand || "unbranded"}
                        </Badge>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-3 space-y-2" align="end">
                        <Label className="text-xs">Brand</Label>
                        <Input
                          list={`brand-list-${s.id}`}
                          value={brandEditValue}
                          onChange={(e) => setBrandEditValue(e.target.value)}
                          placeholder="e.g. netscaler_docs (empty = unbranded)"
                          className="font-mono h-8"
                          autoFocus
                        />
                        <datalist id={`brand-list-${s.id}`}>
                          {Array.from(new Set(sources.map((x) => x.brand).filter((b): b is string => !!b))).sort().map((b) => (
                            <option key={b} value={b} />
                          ))}
                        </datalist>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          Updates every chunk's brand tag. Re-enrichment recommended afterwards (preamble carries the brand string).
                        </p>
                        <div className="flex justify-end gap-2 pt-1">
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setBrandEditId(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            className="h-7"
                            onClick={async () => {
                              const next = brandEditValue.trim() || null;
                              const r = await KnowledgeAPI.updateSourceBrand(s.id, next);
                              if (r.ok) {
                                setSources(sources.map((x) => x.id === s.id ? { ...x, brand: next } : x));
                                toast.success(`Brand updated · ${("updated" in r ? r.updated : 0) ?? 0} chunks re-tagged`);
                                setBrandEditId(null);
                              } else {
                                toast.error(r.error || "Brand update failed");
                              }
                            }}
                          >
                            Save
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  {s.mfaEnabled && <Badge variant="outline" className="text-[9px] font-mono gap-1"><ShieldCheck className="h-2.5 w-2.5"/>MFA</Badge>}
                  {!isCardRunning && (
                    <Button size="sm" variant="outline" className="h-7 px-2 gap-1" onClick={()=>syncSourceCard(s)} title={"Sync this object"}>
                      <RefreshCw className="h-3 w-3"/>{"Sync"}
                    </Button>
                  )}
                  {isCardRunning && !stopping && (
                    <Button size="sm" variant="outline" className="h-7 px-2 gap-1" onClick={()=>stopJob(liveJob!.jobId)} title={"Stop this object"}>
                      <Square className="h-3 w-3"/>{"Stop"}
                    </Button>
                  )}
                  {isCardRunning && stopping && !showForce && (
                    <Button size="sm" variant="outline" className="h-7 px-2 gap-1" disabled>
                      <span className="pulse-dot"/>{"Stopping…"}
                    </Button>
                  )}
                  {isCardRunning && stopping && showForce && (
                    <Button size="sm" variant="destructive" className="h-7 px-2 gap-1" onClick={()=>stopJob(liveJob!.jobId, { force: true })} title="Force stop">
                      <Square className="h-3 w-3"/>{"Force Stop"}
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={()=>setEditing({...s})}>
                    <Pencil className="h-3.5 w-3.5"/>
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={()=>remove(s.id)}>
                    <Trash2 className="h-3.5 w-3.5"/>
                  </Button>
                </div>
                {(s.url || s.username) && (
                  <p className="text-[10px] font-mono text-muted-foreground mb-1 truncate">
                    {s.url} {s.username ? `· ${s.username}` : ""}
                  </p>
                )}
                <div className="flex justify-between text-[10px] font-mono mb-1">
                  <span className="text-muted-foreground">{t("kn.embedding")}</span>
                  <span className="text-primary">
                    {isCardRunning && (liveJob!.total || 0) > 0
                      ? `${Math.round(((liveJob!.progress || 0) / (liveJob!.total || 1)) * 100)}%`
                      : `${s.progress}%`}
                  </span>
                </div>
                <Progress
                  value={isCardRunning && (liveJob!.total || 0) > 0
                    ? Math.round(((liveJob!.progress || 0) / (liveJob!.total || 1)) * 100)
                    : s.progress}
                  className="h-1.5"
                />
              </CardContent>
            </Card>
          );
        })}
        {sources.length === 0 && !sourcesHydrated && (
          <>
            {[0, 1, 2, 3].map((i) => (
              <Card key={`sk-${i}`} className="glass animate-pulse">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded bg-muted/40" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-2/3 bg-muted/40 rounded" />
                      <div className="h-2 w-1/3 bg-muted/30 rounded" />
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-muted/30 rounded" />
                </CardContent>
              </Card>
            ))}
          </>
        )}
        {sources.length === 0 && sourcesHydrated && (
          <Card className="glass md:col-span-2"><CardContent className="p-12 text-center text-muted-foreground text-sm">
            {"No sources. Click Add Source to upload PDFs, TXT, or index URLs."}
          </CardContent></Card>
        )}
      </div>

      {/* Edit dialog with credentials/MFA */}
      <Dialog open={!!editing} onOpenChange={(o)=>!o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("kn.edit_source")}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>{t("common.name")}</Label>
                <Input value={editing.name} onChange={e=>setEditing({...editing, name:e.target.value})} className="mt-1 font-mono"/></div>
              <div><Label>URL / Endpoint</Label>
                <Input value={editing.url ?? ""} onChange={e=>setEditing({...editing, url:e.target.value})}
                  placeholder="https://onedrive.example.com or https://drive.google.com/..." className="mt-1 font-mono"/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{t("common.username")}</Label>
                  <Input value={editing.username ?? ""} onChange={e=>setEditing({...editing, username:e.target.value})} className="mt-1 font-mono"/></div>
                <div><Label>{t("common.password")}</Label>
                  <Input type="password" value={editing.password ?? ""} onChange={e=>setEditing({...editing, password:e.target.value})} className="mt-1 font-mono"/></div>
              </div>
              <div className="flex items-center justify-between border border-border rounded p-2">
                <Label className="text-xs">Multi-Factor Authentication (MFA)</Label>
                <Switch checked={!!editing.mfaEnabled} onCheckedChange={(v)=>setEditing({...editing, mfaEnabled:v})}/>
              </div>
              {editing.mfaEnabled && (
                <div><Label>MFA Code / TOTP Secret</Label>
                  <Input value={editing.mfaCode ?? ""} onChange={e=>setEditing({...editing, mfaCode:e.target.value})} placeholder="123456 or otpauth://..." className="mt-1 font-mono"/></div>
              )}
              <div><Label>{t("common.notes")}</Label>
                <textarea rows={2} value={editing.notes ?? ""} onChange={e=>setEditing({...editing, notes:e.target.value})}
                  className="w-full mt-1 p-2 rounded bg-card/50 border border-border text-xs font-mono"/></div>
              {editing.type === "url" && !editing.id.startsWith("dir:") && (() => {
                const cc = editing.crawlConfig ?? { recursive: false };
                const preset = currentPreset(cc);
                const setPreset = (p: "single"|"standard"|"deep") =>
                  setEditing({ ...editing, crawlConfig: { ...CRAWL_PRESETS[p] } });
                const patchCustom = (patch: Partial<NonNullable<KnowledgeSource["crawlConfig"]>>) =>
                  setEditing({ ...editing, crawlConfig: { ...(cc.recursive ? cc : CRAWL_PRESETS.standard), ...patch, preset: "custom" } });
                return (
                  <div className="border border-border rounded p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">URL Crawl Policy</Label>
                      <Badge variant="outline" className="text-[10px] font-mono">{preset}</Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[10px] font-mono">
                      {(["single","standard","deep","custom"] as const).map((p) => (
                        <Button key={p} size="sm" variant={preset===p?"default":"outline"} className="h-7 text-[10px]"
                          onClick={() => p === "custom" ? patchCustom({}) : setPreset(p)}>
                          {p === "single" ? "Single" : p === "standard" ? "Standard" : p === "deep" ? "Deep" : "Custom"}
                        </Button>
                      ))}
                    </div>
                    {cc.recursive && (
                      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                        <div><Label className="text-[10px]">maxDepth (1-8)</Label>
                          <Input type="number" min={1} max={8} value={cc.maxDepth ?? 5}
                            onChange={e=>patchCustom({ maxDepth: Math.min(8, Math.max(1, Number(e.target.value)||5)) })}
                            className="h-7 text-[11px] mt-1"/></div>
                        <div><Label className="text-[10px]">maxPages (1-10000)</Label>
                          <Input type="number" min={1} max={10000} value={cc.maxPages ?? 2000}
                            onChange={e=>patchCustom({ maxPages: Math.min(10000, Math.max(1, Number(e.target.value)||2000)) })}
                            className="h-7 text-[11px] mt-1"/></div>
                        <div><Label className="text-[10px]">concurrency (1-10)</Label>
                          <Input type="number" min={1} max={10} value={cc.concurrency ?? 6}
                            onChange={e=>patchCustom({ concurrency: Math.min(10, Math.max(1, Number(e.target.value)||6)) })}
                            className="h-7 text-[11px] mt-1"/></div>
                      </div>
                    )}
                    {cc.recursive && (
                      <div className="flex items-center gap-4 text-[11px]">
                        <label className="flex items-center gap-2"><Switch checked={cc.respectRobots !== false} onCheckedChange={(v)=>patchCustom({ respectRobots: v })}/> robots.txt</label>
                        <label className="flex items-center gap-2"><Switch checked={cc.skipNoindex !== false} onCheckedChange={(v)=>patchCustom({ skipNoindex: v })}/> skip noindex</label>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">Policy is saved; crawl starts when you press Sync. Note: the Deep preset can take 1+ hour.</p>
                  </div>
                );
              })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={()=>setEditing(null)}>{t("common.cancel")}</Button>
            <Button onClick={saveEdit} className="bg-gradient-primary text-primary-foreground">{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="w-[min(calc(100vw-2rem),64rem)] max-w-5xl max-h-[calc(100vh-2rem)] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              {"Sync Detail"}
            </DialogTitle>
          </DialogHeader>
          <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as "live" | "history")} className="min-w-0 overflow-hidden">
            <TabsList className="mb-3">
              <TabsTrigger value="live" className="gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                {"Live"}
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="h-3.5 w-3.5" />
                {"History"}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="live" className="space-y-3">
              {!activeJobId && !selectedJob && (
                <div className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border rounded-md">
                  {"No active sync. Pick a job from History →"}
                </div>
              )}
              {(activeJobId || selectedJob) && (() => {
                // Live panel hem aktif SSE (liveProgress) hem de History'den
                // seçilen geçmiş job için (selectedJob) çalışsın. Aktif yokken
                // selectedJob.events son elemanından stage/scanned/indexed türet.
                const lastEv = selectedJob?.events?.[selectedJob.events.length - 1];
                const status   = liveProgress?.status   ?? selectedJob?.status ?? "queued";
                const stage    = liveProgress?.stage    ?? lastEv?.stage ?? "—";
                const scanned  = liveProgress?.scanned  ?? lastEv?.scanned  ?? 0;
                const indexed  = liveProgress?.indexed  ?? lastEv?.indexed  ?? 0;
                const progress = liveProgress?.progress ?? selectedJob?.progress ?? 0;
                const total    = liveProgress?.total    ?? selectedJob?.total ?? 0;
                const currentFile = liveProgress?.currentFile ?? lastEv?.currentFile;
                const evs = (liveEvents.length ? liveEvents : (selectedJob?.events || []));
                return (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs min-w-0">
                      <div className="min-w-0 rounded-md border border-border bg-card/40 p-2">
                        <div className="text-muted-foreground">{"Status"}</div>
                        <Badge variant="outline" className={`mt-1 font-mono ${statusBadgeCls(status)}`}>
                          {status}
                        </Badge>
                      </div>
                      <div className="min-w-0 rounded-md border border-border bg-card/40 p-2">
                        <div className="text-muted-foreground">{"Stage"}</div>
                        <div className="mt-1 font-mono text-foreground truncate">{stage}</div>
                      </div>
                      <div className="min-w-0 rounded-md border border-border bg-card/40 p-2">
                        <div className="text-muted-foreground">{"Scanned / Indexed"}</div>
                        <div className="mt-1 font-mono text-foreground">{scanned} / {indexed}</div>
                      </div>
                      <div className="min-w-0 rounded-md border border-border bg-card/40 p-2">
                        <div className="text-muted-foreground">{"Progress"}</div>
                        <div className="mt-1 font-mono text-foreground">{progress}/{total || "?"}</div>
                      </div>
                    </div>
                    {currentFile && (
                      <div className="min-w-0 w-full">
                        <div className="text-[11px] font-mono text-muted-foreground truncate" title={currentFile}>
                          <span className="text-foreground">▸ </span>{currentFile}
                        </div>
                      </div>
                    )}
                    <Progress value={total ? Math.min(100, ((progress || 0) / total) * 100) : 0} className="h-1.5" />
                    <ScrollArea className="h-[min(320px,calc(100vh-22rem))] min-h-[180px] max-w-full rounded-md border border-border bg-background/40 overflow-hidden">
                      <div className="w-full min-w-0 max-w-full overflow-hidden p-2 space-y-1 font-mono text-[11px]">
                        {evs.slice().reverse().map((e, i) => (
                          <div key={(e.seq ?? i)} className="grid min-w-0 max-w-full grid-cols-[4.75rem_auto_minmax(0,1fr)_auto] items-start gap-2 hover:bg-muted/30 rounded px-1 py-0.5 overflow-hidden">
                            <span className="text-muted-foreground/60 shrink-0">{e.ts ? new Date(e.ts).toLocaleTimeString() : ""}</span>
                            <Badge variant="outline" className="text-[9px] py-0 h-4 shrink-0 font-mono">{e.stage || "·"}</Badge>
                            <span className="block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-foreground/80" title={e.currentFile || e.message}>
                              {e.message || e.currentFile || "—"}
                            </span>
                            {typeof e.indexed === "number" && (
                              <span className="text-emerald-500/80 shrink-0">+{e.indexed}</span>
                            )}
                          </div>
                        ))}
                        {evs.length === 0 && (
                          <div className="text-muted-foreground p-3 text-center">{"No events yet…"}</div>
                        )}
                      </div>
                    </ScrollArea>
                  </>
                );
              })()}
            </TabsContent>

            <TabsContent value="history" className="space-y-2">
              {history.length === 0 && (
                <div className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border rounded-md">
                  {"No history yet"}
                </div>
              )}
              <ScrollArea className="h-[min(420px,calc(100vh-18rem))] min-h-[220px] max-w-full overflow-hidden">
                <div className="space-y-1.5 pr-2 min-w-0 max-w-full overflow-hidden">
                  {history.map((j) => (
                    <button
                      key={j.jobId}
                      onClick={() => loadJobLog(j.jobId)}
                      className="w-full min-w-0 text-left rounded-md border border-border bg-card/40 hover:bg-card/70 transition-colors p-2.5 text-xs overflow-hidden"
                    >
                      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                        <Badge variant="outline" className={`font-mono text-[10px] ${statusBadgeCls(j.status)}`}>{j.status}</Badge>
                        {j.current && <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">live</Badge>}
                        <span className="min-w-0 truncate font-mono text-muted-foreground">{fmtTs(j.started)}</span>
                        <span className="ml-auto font-mono text-muted-foreground">{fmtDur(j.durationMs)}</span>
                      </div>
                      <div className="mt-1 grid min-w-0 grid-cols-3 gap-2 font-mono text-[11px] text-muted-foreground">
                        <span>{"Progress"}: <span className="text-foreground">{j.progress}/{j.total || "?"}</span></span>
                        <span>{"Total chunks"}: <span className="text-foreground">{j.chunkReport?.total_chunks ?? "—"}</span></span>
                        <span>R82: <span className="text-foreground">{j.chunkReport?.cpR82?.chunks ?? "—"}</span></span>
                      </div>
                      {j.lastEvent?.message && (
                        <div className="mt-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted-foreground">▸ {j.lastEvent.message}</div>
                      )}
                      {j.error && <div className="mt-1 text-[11px] text-destructive truncate">{j.error}</div>}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

// =============================================================================
// Architect Modules — Webhooks · Graph RAG · Cross-Reference Engine
// =============================================================================
type WebhookInfo = Awaited<ReturnType<typeof KnowledgeAPI.webhookInfo>>;
type GraphStats = Awaited<ReturnType<typeof KnowledgeAPI.graphStats>>;
type CrossRef   = Awaited<ReturnType<typeof KnowledgeAPI.crossReference>>;

function ArchitectModules() {
  return (
    <Card className="glass">
      <CardContent className="p-4">
        <Tabs defaultValue="webhooks">
          <TabsList className="mb-3">
            <TabsTrigger value="webhooks"><Webhook className="h-3.5 w-3.5 mr-1"/>Webhooks</TabsTrigger>
            <TabsTrigger value="graph"><Network className="h-3.5 w-3.5 mr-1"/>Graph RAG</TabsTrigger>
            <TabsTrigger value="crossref"><GitCompareArrows className="h-3.5 w-3.5 mr-1"/>Cross-Ref</TabsTrigger>
          </TabsList>
          <TabsContent value="webhooks"><WebhooksPanel/></TabsContent>
          <TabsContent value="graph"><GraphPanel/></TabsContent>
          <TabsContent value="crossref"><CrossRefPanel/></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function WebhooksPanel() {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const wh = useWebhooks();
  useEffect(() => { KnowledgeAPI.webhookInfo().then(setInfo); }, []);
  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success(t("wh.copied")); };

  const builtinRows: { key: BuiltinWebhookKey; label: string; hint: string }[] = [
    { key: "telegram", label: "Telegram",  hint: "Bot setWebhook · X-Telegram-Bot-Api-Secret-Token" },
    { key: "teams",    label: "MS Teams",  hint: "Outgoing Webhook · HMAC-SHA256" },
    { key: "whatsapp", label: "WhatsApp",  hint: "Cloud API · hub.verify_token + X-Hub-Signature-256" },
    { key: "signal",   label: "Signal",    hint: "signal-cli bridge · Bearer token" },
    { key: "generic",  label: "Generic",   hint: "Slack/Discord/IFTTT · Bearer token" },
  ];

  return (
    <div className="space-y-5">
      {/* ---------- Built-in adapters ---------- */}
      <section className="space-y-2">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            {t("wh.builtin_title")}
          </div>
          <p className="text-[11px] font-mono text-muted-foreground mt-1">{t("wh.builtin_hint")}</p>
        </div>
        {builtinRows.map((r) => (
          <BuiltinWebhookRow key={r.key} k={r.key} label={r.label} hint={r.hint}
            envUrl={info?.endpoints[r.key] || ""} envSecret={!!info?.secrets_configured[r.key]}
            onCopy={copy} />
        ))}
      </section>

      {/* ---------- Custom subscribers ---------- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              {t("wh.custom_title")}
            </div>
            <p className="text-[11px] font-mono text-muted-foreground mt-1">{t("wh.custom_hint")}</p>
          </div>
          <CustomWebhookDialog mode="create">
            <Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1"/>{t("wh.add")}</Button>
          </CustomWebhookDialog>
        </div>
        {wh.customs.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground border border-dashed border-border rounded p-3">
            {t("wh.empty_customs")}
          </div>
        ) : (
          wh.customs.map((c) => <CustomWebhookRow key={c.id} item={c} onCopy={copy} />)
        )}
      </section>

      <p className="text-[10px] font-mono text-muted-foreground">
        {"Note: this panel is a registry. The bridge .env is managed separately; new secrets are not honoured until the service is restarted."}
      </p>
    </div>
  );
}

// ---------- Built-in row ----------
function BuiltinWebhookRow({ k, label, hint, envUrl, envSecret, onCopy }: {
  k: BuiltinWebhookKey; label: string; hint: string; envUrl: string; envSecret: boolean;
  onCopy: (s: string) => void;
}) {
  const { t } = useI18n();
  const wh = useWebhooks();
  const ov = wh.builtins[k];
  const [showSecret, setShowSecret] = useState(false);
  const url = ov.urlOverride || envUrl || "—";
  const status: "env" | "local" | "missing" =
    ov.secret ? "local" : envSecret ? "env" : "missing";

  return (
    <div className="border border-border rounded p-3 space-y-2 bg-muted/10">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] font-mono w-20 justify-center">{label}</Badge>
        <code className="flex-1 text-[11px] font-mono truncate text-primary" title={hint}>{url}</code>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onCopy(url)} title={t("wh.copy")}>
          <Copy className="h-3.5 w-3.5"/>
        </Button>
        {status === "env" && (
          <Badge variant="outline" className="text-[9px] font-mono gap-1 text-emerald-400 border-emerald-400/40">
            <CheckCircle2 className="h-3 w-3"/>{t("wh.status_env")}
          </Badge>
        )}
        {status === "local" && (
          <Badge variant="outline" className="text-[9px] font-mono gap-1 text-sky-400 border-sky-400/40">
            <ShieldCheck className="h-3 w-3"/>{t("wh.status_local")}
          </Badge>
        )}
        {status === "missing" && (
          <Badge variant="outline" className="text-[9px] font-mono gap-1 text-amber-400 border-amber-400/40">
            <XCircle className="h-3 w-3"/>{t("wh.status_missing")}
          </Badge>
        )}
        <Switch checked={ov.enabled} onCheckedChange={(v) => updateBuiltin(k, { enabled: v })}
          aria-label={ov.enabled ? t("wh.enabled") : t("wh.disabled")} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] font-mono text-muted-foreground">{t("wh.secret")}</Label>
          <div className="flex gap-1">
            <Input type={showSecret ? "text" : "password"} value={ov.secret}
              onChange={(e) => updateBuiltin(k, { secret: e.target.value })}
              placeholder="••••••••" className="h-8 text-xs font-mono" />
            <Button size="icon" variant="ghost" className="h-8 w-8"
              onClick={() => setShowSecret((s) => !s)}
              title={showSecret ? t("wh.hide_secret") : t("wh.show_secret")}>
              {showSecret ? <XCircle className="h-3.5 w-3.5"/> : <CheckCircle2 className="h-3.5 w-3.5"/>}
            </Button>
          </div>
        </div>
        <div>
          <Label className="text-[10px] font-mono text-muted-foreground">{t("wh.url_override")}</Label>
          <Input value={ov.urlOverride}
            onChange={(e) => updateBuiltin(k, { urlOverride: e.target.value })}
            placeholder={envUrl || "https://…"} className="h-8 text-xs font-mono" />
        </div>
      </div>
      <div className="flex items-center justify-end">
        <Button size="sm" variant="ghost" className="h-7 text-[11px]"
          onClick={() => { resetBuiltin(k); toast.success(t("wh.removed")); }}>
          <RefreshCw className="h-3 w-3 mr-1"/>{t("wh.reset")}
        </Button>
      </div>
    </div>
  );
}

// ---------- Custom row ----------
function CustomWebhookRow({ item, onCopy }: { item: CustomWebhookT; onCopy: (s: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="border border-border rounded p-2 flex items-center gap-2">
      <Badge variant="outline" className="text-[10px] font-mono">{item.label}</Badge>
      <code className="flex-1 text-[11px] font-mono truncate text-primary">{item.url}</code>
      {item.tag && <Badge variant="secondary" className="text-[9px] font-mono">{item.tag}</Badge>}
      <Badge variant="outline"
        className={`text-[9px] font-mono ${item.enabled ? "text-emerald-400 border-emerald-400/40" : "text-muted-foreground"}`}>
        {item.enabled ? t("wh.enabled") : t("wh.disabled")}
      </Badge>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onCopy(item.url)} title={t("wh.copy")}>
        <Copy className="h-3.5 w-3.5"/>
      </Button>
      <CustomWebhookDialog mode="edit" item={item}>
        <Button size="icon" variant="ghost" className="h-7 w-7" title={t("wh.edit")}>
          <Pencil className="h-3.5 w-3.5"/>
        </Button>
      </CustomWebhookDialog>
      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
        title={t("wh.remove")}
        onClick={() => {
          if (confirm(t("wh.confirm_remove"))) { removeCustom(item.id); toast.success(t("wh.removed")); }
        }}>
        <Trash2 className="h-3.5 w-3.5"/>
      </Button>
    </div>
  );
}

// ---------- Add/Edit dialog ----------
function CustomWebhookDialog({ mode, item, children }: {
  mode: "create" | "edit"; item?: CustomWebhookT; children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(item?.label ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [secret, setSecret] = useState(item?.secret ?? "");
  const [tag, setTag] = useState(item?.tag ?? "Source: Custom");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [showSecret, setShowSecret] = useState(false);

  const reset = () => {
    setLabel(item?.label ?? ""); setUrl(item?.url ?? ""); setSecret(item?.secret ?? "");
    setTag(item?.tag ?? "Source: Custom"); setNotes(item?.notes ?? "");
    setEnabled(item?.enabled ?? true); setShowSecret(false);
  };

  const submit = () => {
    if (!label.trim()) { toast.error(t("wh.label_required")); return; }
    if (!url.trim()) { toast.error(t("wh.url_required")); return; }
    if (mode === "create") {
      addCustom({ label: label.trim(), url: url.trim(), secret, tag: tag.trim(), notes, enabled });
    } else if (item) {
      updateCustom(item.id, { label: label.trim(), url: url.trim(), secret, tag: tag.trim(), notes, enabled });
    }
    toast.success(t("wh.saved"));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) reset(); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? t("wh.add") : t("wh.edit")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-[10px] font-mono text-muted-foreground">{t("wh.label")}</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-[10px] font-mono text-muted-foreground">{t("wh.url")}</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-9 text-sm font-mono" />
          </div>
          <div>
            <Label className="text-[10px] font-mono text-muted-foreground">{t("wh.secret")}</Label>
            <div className="flex gap-1">
              <Input type={showSecret ? "text" : "password"} value={secret}
                onChange={(e) => setSecret(e.target.value)} className="h-9 text-sm font-mono" />
              <Button type="button" size="icon" variant="ghost" className="h-9 w-9"
                onClick={() => setShowSecret((s) => !s)}
                title={showSecret ? t("wh.hide_secret") : t("wh.show_secret")}>
                {showSecret ? <XCircle className="h-3.5 w-3.5"/> : <CheckCircle2 className="h-3.5 w-3.5"/>}
              </Button>
            </div>
          </div>
          <div>
            <Label className="text-[10px] font-mono text-muted-foreground">{t("wh.tag")}</Label>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-[10px] font-mono text-muted-foreground">{t("wh.notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={t("wh.notes_placeholder")} className="h-9 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <span className="text-xs">{enabled ? t("wh.enabled") : t("wh.disabled")}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("wh.cancel")}</Button>
          <Button onClick={submit}>{t("wh.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GraphPanel() {
  const { t } = useI18n();
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [q, setQ] = useState("");
  const [neigh, setNeigh] = useState<Awaited<ReturnType<typeof KnowledgeAPI.graphNeighbors>> | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => KnowledgeAPI.graphStats().then(setStats);
  useEffect(() => { refresh(); }, []);
  const lookup = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try { setNeigh(await KnowledgeAPI.graphNeighbors(q.trim())); }
    finally { setBusy(false); }
  };
  const purgeOrphans = async () => {
    setBusy(true);
    try {
      const r = await KnowledgeAPI.purgeGraphOrphans();
      if (r.ok) toast.success(`Graph cleanup · entities=${r.removedEntities} edges=${r.removedEdges}`);
      else toast.error(r.error || "Graph cleanup failed");
      await refresh();
    } finally { setBusy(false); }
  };
  const orphanTotal = (stats?.orphanEntities ?? 0) + (stats?.orphanEdges ?? 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-border rounded p-3">
          <div className="text-[10px] font-mono text-muted-foreground">{t("kn.entities")}</div>
          <div className="text-2xl font-bold text-primary">{stats?.entities ?? "—"}</div>
        </div>
        <div className="border border-border rounded p-3">
          <div className="text-[10px] font-mono text-muted-foreground">{t("kn.edges")}</div>
          <div className="text-2xl font-bold text-primary">{stats?.edges ?? "—"}</div>
        </div>
        <div className="border border-border rounded p-3">
          <div className="text-[10px] font-mono text-muted-foreground">Orphan Entities</div>
          <div className={`text-2xl font-bold ${stats?.orphanEntities ? "text-destructive" : "text-primary"}`}>{stats?.orphanEntities ?? "—"}</div>
        </div>
        <div className="border border-border rounded p-3">
          <div className="text-[10px] font-mono text-muted-foreground">Orphan Edges</div>
          <div className={`text-2xl font-bold ${stats?.orphanEdges ? "text-destructive" : "text-primary"}`}>{stats?.orphanEdges ?? "—"}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded border border-border bg-card/40 p-2">
        <Badge variant="outline" className={`text-[10px] font-mono ${orphanTotal ? "border-destructive/40 text-destructive" : "border-primary/40 text-primary"}`}>
          {orphanTotal ? "Cleanup needed" : "Graph clean"}
        </Badge>
        <span className="text-[11px] font-mono text-muted-foreground truncate">
          Entity count comes from the graph tables; orphan values are leftover graph rows no longer attached to chunks.
        </span>
        <Button size="sm" variant="outline" className="ml-auto h-7" disabled={busy || !orphanTotal} onClick={purgeOrphans}>
          {busy ? "Working…" : "Purge Orphans"}
        </Button>
      </div>
      <div>
        <div className="text-[10px] font-mono text-muted-foreground mb-1">TOP ENTITIES (by degree)</div>
        <div className="flex flex-wrap gap-1">
          {(stats?.top ?? []).map((t, i) => (
            <Badge key={i} variant="outline" className="text-[10px] font-mono">
              {t.name} · <span className="text-muted-foreground ml-1">{t.type}</span> · <span className="text-primary ml-1">{t.degree}</span>
            </Badge>
          ))}
          {!stats?.top.length && <span className="text-[11px] font-mono text-muted-foreground">No entities yet — ingest sources to build the graph.</span>}
        </div>
      </div>
      <div className="flex gap-2">
        <Input value={q} onChange={e=>setQ(e.target.value)} placeholder="e.g. 192.168.1.10 or CVE-2024-3400 or Fortigate"
               className="font-mono h-9"/>
        <Button onClick={lookup} disabled={busy} className="bg-gradient-primary text-primary-foreground">
          {busy ? "…" : "Find Neighbors"}
        </Button>
        <Button variant="outline" onClick={refresh}><RefreshCw className="h-3.5 w-3.5"/></Button>
      </div>
      {neigh && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {neigh.entities.map((e, i) => (
              <Badge key={i} className="text-[10px] font-mono bg-primary/20 text-primary border border-primary/40">
                {e.name} <span className="ml-1 text-muted-foreground">{e.type}</span>
              </Badge>
            ))}
            {!neigh.entities.length && <span className="text-[11px] font-mono text-muted-foreground">No entities matched in query.</span>}
          </div>
          <div className="space-y-1 max-h-64 overflow-auto">
            {neigh.chunks.map(c => (
              <div key={c.id} className="border border-border rounded p-2 text-[11px] font-mono">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Badge variant="outline" className="text-[9px]">{c.source_type || "?"}</Badge>
                  <span className="truncate">{c.path}</span>
                  <span className="ml-auto">v{c.version || 1}</span>
                </div>
                <div className="text-foreground/90 mt-1 line-clamp-3">{c.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CrossRefPanel() {
  const { locale } = useI18n();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<CrossRef | null>(null);
  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try { setData(await KnowledgeAPI.crossReference(q.trim())); }
    finally { setBusy(false); }
  };
  const groupOrder = ["file","url","video","audio","image","messaging","text"];
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-mono text-muted-foreground">
        {"Parallel retrieval across every source group (File · URL · Video · Audio · Image · Messaging · Text) — conflicts surfaced side-by-side using version + timestamp."}
      </p>
      <div className="flex gap-2">
        <Input value={q} onChange={e=>setQ(e.target.value)} placeholder={"e.g. VPN MTU · Checkpoint NAT rule 42 · CVE-2024-3400"}
               className="font-mono h-9"/>
        <Button onClick={run} disabled={busy} className="bg-gradient-primary text-primary-foreground">
          {busy ? "Cross-checking…" : "Cross-Reference"}
        </Button>
      </div>
      {data && (
        <>
          {data.synthesis && (
            <div className="border border-primary/30 bg-primary/5 rounded p-3 text-[11px] font-mono whitespace-pre-wrap">
              {data.synthesis}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {groupOrder.filter(g => (data.groups[g]?.length ?? 0) > 0).map(g => (
              <div key={g} className="border border-border rounded p-2">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px] font-mono uppercase">{g}</Badge>
                  <span className="text-[10px] font-mono text-muted-foreground">{data.groups[g].length} hit</span>
                </div>
                <div className="space-y-1">
                  {data.groups[g].map((h, i) => (
                    <div key={i} className="text-[10px] font-mono">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="truncate">{h.title || "(untitled)"}</span>
                        {h.brand && <span className="text-primary">· {h.brand}</span>}
                        <span className="ml-auto">v{h.version || 1}{h.timestamp ? ` · ${String(h.timestamp).slice(0,10)}` : ""}</span>
                      </div>
                      <div className="text-foreground/80 line-clamp-3">{h.snippet}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {Object.values(data.groups).every(a => !a.length) && (
              <div className="text-[11px] font-mono text-muted-foreground md:col-span-2">No matches across any source type.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
