import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  Braces,
  Check,
  ChevronDown,
  History as HistoryIcon,
  Copy,
  Database,
  FileText,
  Folder,
  Layers,
  Link2,
  Play,
  Plus,
  Square,
  RefreshCw,
  Save,
  Search,
  Share2,
  Tag as TagIcon,
  Trash2,
  Type,
  Upload,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, StatusDot, Tag } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import {
  topEntities,
  useKnowledge,
  type KnowledgeSource,
  type SourceKind,
} from "@/lib/knowledge-store";
import { tuningSchema, useTuning, type Knob, type TuningGroup } from "@/lib/tuning-store";
import { gateAction } from "@/lib/approval-gate";
import { currentAccount } from "@/lib/group-store";
import { KnowledgeSpacesTab } from "@/components/sovereign/knowledge-spaces";
import { checkUpload, extOf, useSpaceAccess } from "@/lib/knowledge-space-store";
import { cn, fmtDate } from "@/lib/utils";
import { fetchApi } from "@/lib/api";

const views = ["control", "spaces", "aliases", "tuning"] as const;
type Tab = (typeof views)[number];

export const Route = createFileRoute("/knowledge")({
  validateSearch: (search: Record<string, unknown>): { view: Tab } => {
    const v = search["view"];
    return { view: views.includes(v as Tab) ? (v as Tab) : "control" };
  },
  head: () => ({
    meta: [
      { title: "Knowledge Hub (RAG) — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Ingestion control, chunk health, brand aliases, vector forge telemetry, webhook adapters and graph retrieval for the sovereign knowledge layer.",
      },
      { property: "og:title", content: "Knowledge Hub (RAG) — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Ingestion control, chunk health, brand aliases, vector forge telemetry and graph retrieval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: KnowledgePage,
});

const field =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-sapphire/50";
const label = "mono-label mb-1.5 block";

function KnowledgePage() {
  const { view: tab } = Route.useSearch();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Surface
      title="Knowledge Hub (RAG)"
      meta="PDF · TXT · URL · Drive · auto-extract .zip/.tar/.rar"
      wide
      action={
        <div className="flex items-center gap-1.5">
          {tab === "control" && (
            <JewelButton size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={13} /> Add Source
            </JewelButton>
          )}
        </div>
      }
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {tab === "control" && <ControlTab />}
          {tab === "spaces" && <KnowledgeSpacesTab />}
          {tab === "aliases" && <BrandAliasesTab />}
          {tab === "tuning" && <AdvancedTuningTab />}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {addOpen && <AddSourceDialog onClose={() => setAddOpen(false)} />}
      </AnimatePresence>
    </Surface>
  );
}

/* ----------------------------------------------------------- control tab */

function ControlTab() {
  const k = useKnowledge();
  const access = useSpaceAccess();
  const [spin, setSpin] = useState(false);

  // Retrieval boundary: a source is only visible when the principal reads its
  // space. Admin principals are sovereign and see everything.
  const visible = k.sources.filter(
    (s) => access.sovereign || (s.space ? access.canRead(s.space) : true),
  );
  const spaceName = (id?: string) => access.spaces.find((x) => x.id === id)?.name ?? "unscoped";

  const refresh = () => {
    setSpin(true);
    setTimeout(() => setSpin(false), 700);
  };

  const metrics: {
    label: string;
    value: number;
    tone?: "ruby" | "topaz" | "emerald" | undefined;
  }[] = [
    { label: "Chunks", value: k.health.chunks },
    { label: "FTS NULL", value: k.health.ftsNull, tone: k.health.ftsNull ? "topaz" : undefined },
    { label: "Embed OK", value: k.health.embedOk, tone: "emerald" },
    { label: "Embed Pending", value: k.health.embedPending },
    { label: "In Progress", value: k.health.inProgress },
    { label: "Stale", value: k.health.stale, tone: k.health.stale ? "topaz" : undefined },
    {
      label: "Embed Error",
      value: k.health.embedError,
      tone: k.health.embedError ? "ruby" : undefined,
    },
    { label: "Sources", value: k.sources.length },
    { label: "Parse OK", value: k.health.parseOk },
    { label: "Parse Low", value: k.health.parseLow },
  ];

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Activity size={15} className="text-sapphire" />
            <h2 className="text-[16.5px] font-medium tracking-tight text-foreground">
              RAG Control &amp; Health
            </h2>
            <Tag tone="platinum">single source of truth</Tag>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCw size={13} className={cn(spin && "animate-spin")} /> Refresh
          </button>
        </div>

        <div className="mt-5 space-y-2.5">
          <ToggleRow
            title="Auto Ingestion"
            badge={k.autoIngestion ? "ON · watching disk" : "OFF · Manual sync only"}
            badgeTone={k.autoIngestion ? "emerald" : "ruby"}
            hint="OFF means disk changes never start ingestion by themselves. Sources are indexed only from explicit Add Source / Sync actions."
            checked={k.autoIngestion}
            onChange={(v) => k.patch({ autoIngestion: v })}
          />
          <ToggleRow
            title="Auto Re-enrich on Ingest"
            badge={k.autoReEnrich ? "ON · automatic" : "OFF · manual from /knowledge/aliases"}
            badgeTone={k.autoReEnrich ? "emerald" : "platinum"}
            hint="When ON, every successful document add (file / URL / inline text) automatically spawns brand re-enrichment + stale-marks chunks. Per-brand 409 guard prevents duplicate jobs. Default OFF."
            checked={k.autoReEnrich}
            onChange={(v) => k.patch({ autoReEnrich: v })}
          />
        </div>

        <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.05] sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="bg-panel/60 px-4 py-3">
              <div className="mono-label">{m.label}</div>
              <div
                className={cn(
                  "mt-1 font-mono text-[15px] text-foreground",
                  m.tone === "ruby" && "text-ruby",
                  m.tone === "topaz" && "text-topaz",
                  m.tone === "emerald" && "text-emerald",
                )}
              >
                {(m.value ?? 0).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <MaintButton 
            icon={<Zap size={13} />} 
            onClick={() => fetchApi("/api/rag/repair-fts", { method: "POST" })}
          >
            Repair FTS
          </MaintButton>
          <MaintButton 
            icon={<RefreshCw size={13} />}
            onClick={() => fetchApi("/api/knowledge/embeddings/mark-pending", { method: "POST" })}
          >
            Retry Embeddings ({k.batchSize})
          </MaintButton>
          <MaintButton 
            icon={<Trash2 size={13} />}
            onClick={() => fetchApi("/api/knowledge/embeddings/mark-pending", { method: "POST", body: JSON.stringify({ retryErrors: true }) })}
          >
            Drain Errors ×3
          </MaintButton>

          <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-raised/30 p-1">
            {([500, 1000, 2500] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => k.patch({ batchSize: n })}
                className={cn(
                  "rounded-md px-2.5 py-1 font-mono text-[12px] transition-colors",
                  k.batchSize === n
                    ? "bg-sapphire/15 text-sapphire shadow-[0_0_20px_-12px_var(--sapphire)]"
                    : "text-muted-foreground/75 hover:text-foreground",
                )}
              >
                {n}
              </button>
            ))}
          </div>

          <MaintButton 
            icon={<Layers size={13} />}
            onClick={() => fetchApi("/api/rag/dedupe-chunks", { method: "POST" })}
          >
            Dedupe Chunks
          </MaintButton>
          <MaintButton 
            icon={<TagIcon size={13} />}
            onClick={() => fetchApi("/api/rag/brand-backfill", { method: "POST" })}
          >
            Re-derive Brands
          </MaintButton>
          <MaintButton 
            icon={<Braces size={13} />}
            onClick={() => fetchApi("/api/rag/reprocess-oversized-html", { method: "POST" })}
          >
            Reprocess Oversized HTML
          </MaintButton>

          <Tag tone="amethyst" className="ml-auto">
            model: {k.embedModel}
          </Tag>
        </div>

        <div className="mt-5 grid gap-4 rounded-lg border border-white/[0.06] bg-raised/25 p-4 sm:grid-cols-3">
          <Detail label="index" value="pgvector · hnsw (m=16, ef=64)" />
          <Detail label="chunking" value="1024 tok · 128 overlap" />
          <Detail label="reranker" value="bge-reranker-v2-m3" />
          <Detail label="parser" value="unstructured + OCR fallback" />
          <Detail label="dedupe" value="simhash · 0.94 threshold" />
          <Detail label="last sweep" value={<ClientClock />} />
        </div>
      </Panel>

      <Fold title="Sync Detail" meta="live worker stream · job history" tone="sapphire">
        <SyncDetailBody />
      </Fold>

      <Fold
        title="Sources"
        meta={
          access.sovereign
            ? `${visible.length} mapped · sovereign view`
            : `${visible.length} of ${k.sources.length} visible in your spaces`
        }
        tone="sapphire"
      >
        <div className="space-y-1.5">
          {visible.length === 0 && (
            <p className="py-6 text-center text-[13px] text-muted-foreground/70">
              No sources readable in your spaces.
            </p>
          )}
          {visible.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              spaceName={spaceName(s.space)}
              canRemove={access.sovereign || access.canWrite(s.space ?? "")}
              onRemove={() => k.removeSource(s.id)}
            />
          ))}
        </div>
      </Fold>
    </div>
  );
}

const kindIcon: Record<SourceKind, React.ReactNode> = {
  file: <FileText size={14} />,
  directory: <Folder size={14} />,
  url: <Link2 size={14} />,
  text: <Type size={14} />,
};

const statusTone = {
  indexed: "emerald",
  pending: "sapphire",
  stale: "topaz",
  error: "ruby",
} as const;

function SourceRow({
  source,
  onRemove,
  spaceName,
  canRemove = true,
}: {
  source: KnowledgeSource;
  onRemove: () => void;
  spaceName?: string;
  canRemove?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.06] bg-raised/25 px-4 py-3 transition-colors hover:border-white/12">
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-sapphire">{kindIcon[source.kind]}</span>
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] text-foreground">{source.name}</div>
          <div className="font-mono text-[11.5px] text-muted-foreground/70">
            {source.brand} · {source.chunks.toLocaleString()} chunks ·{" "}
            {fmtDate(source.addedAt)}
            {source.ownerName ? ` · by ${source.ownerName}` : ""}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {spaceName && <Tag tone="sapphire">{spaceName}</Tag>}
        <div className="flex items-center gap-2">
          <StatusDot tone={statusTone[source.status]} pulse={source.status === "pending"} />
          <span className="font-mono text-[11.5px] text-muted-foreground/80">{source.status}</span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          title={canRemove ? undefined : "You are not a contributor of this space."}
          aria-label={`Remove ${source.name}`}
          className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-ruby/10 hover:text-ruby disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/60"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- graph tab */

/* --------------------------------------------------------- cross-ref tab */

/* ------------------------------------------------------------- dialogs */

function AddSourceDialog({ onClose }: { onClose: () => void }) {
  const k = useKnowledge();
  const access = useSpaceAccess();
  const targets = access.sovereign ? access.spaces : access.writable;
  const [kind, setKind] = useState<SourceKind>("file");
  const [brand, setBrand] = useState("");
  const [value, setValue] = useState("");
  const [spaceId, setSpaceId] = useState<string>(targets[0]?.id ?? "");
  const [sizeMb, setSizeMb] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);

  const space = access.spaces.find((x) => x.id === spaceId) ?? targets[0];
  const me = access.ctx;

  const placeholder = useMemo(() => {
    if (kind === "directory") return "/mnt/storage/library or C:\\library";
    if (kind === "url") return "https://docs.example.com/guide";
    if (kind === "text") return "Paste raw knowledge text…";
    return "";
  }, [kind]);

  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const submit = async () => {
    if (kind !== "file" && !value.trim()) return;
    if (!space) {
      setRefusal("You are not a contributor of any knowledge space — ask an admin for access.");
      return;
    }
    const name = kind === "file" ? value || "uploaded-document.pdf" : value.trim();
    if (kind === "file") {
      const denial = checkUpload(space, { name, sizeMb }, me);
      if (denial) {
        setRefusal(denial);
        return;
      }
      if (!uploadFile) {
        setRefusal("No file selected.");
        return;
      }
    } else if (!access.canWrite(space.id)) {
      setRefusal(`You are not a contributor of ${space.name}.`);
      return;
    }
    
    try {
      await k.addSource({
        name,
        kind,
        brand: brand.trim(),
        space: space.id,
        owner: me.userId,
        ownerName: currentAccount()?.username ?? "",
        sizeMb,
        file: uploadFile,
        content: value // for URL/text
      });
      onClose();
    } catch (e: any) {
      setRefusal(e.message || "Failed to ingest source");
    }
  };

  return (
    <Modal onClose={onClose} title="Add Knowledge Source">
      <div className="mt-5 inline-flex items-center gap-1 rounded-lg border border-white/[0.07] bg-raised/30 p-1">
        {(["file", "directory", "url", "text"] as SourceKind[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setKind(t)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] capitalize transition-colors",
              kind === t
                ? "bg-sapphire/15 text-sapphire shadow-[0_0_22px_-14px_var(--sapphire)]"
                : "text-muted-foreground/80 hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-5">
        <span className={label}>knowledge space</span>
        <div className="relative">
          <select
            className={cn(field, "appearance-none bg-panel pr-8")}
            value={space?.id ?? ""}
            onChange={(e) => {
              setSpaceId(e.target.value);
              setRefusal(null);
            }}
          >
            {targets.length === 0 && <option value="">No space open to you</option>}
            {targets.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50"
          />
        </div>
        <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground/65">
          {space
            ? `${
                space.allowedTypes.length
                  ? space.allowedTypes.join(" · ").toUpperCase()
                  : "any supported format"
              } · max ${space.maxMb} MB${access.sovereign ? " · sovereign override active" : ""}`
            : "Ask an admin to add you as a contributor."}
        </p>
      </div>

      <div className="mt-5">
        <span className={label}>brand (optional)</span>
        <input
          className={field}
          placeholder="Auto-detect — type or pick (e.g. netscaler_docs)"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
        />
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground/65">
          Leave empty to auto-detect from filename. Explicit brand overrides inference and applies
          to every chunk.
        </p>
      </div>

      {kind === "file" ? (
        <label className="mt-5 flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed border-white/[0.1] bg-raised/20 px-6 py-8 text-center transition-colors hover:border-sapphire/35">
          <Upload size={22} className="text-sapphire" />
          <div className="font-mono text-[12px] leading-relaxed text-muted-foreground/80">
            PDF · DOCX · XLSX · PPTX · VSDX · MP4 · MP3 · WAV · PNG (OCR) · ZIP
          </div>
          <div className="font-mono text-[11.5px] text-amethyst/85">
            Audio/Video → Whisper · Image → OCR · Visio → XML · Login-walled? Upload here.
          </div>
          <input
            type="file"
            className="hidden"
            accept={
              space && space.allowedTypes.length && !access.sovereign
                ? space.allowedTypes.map((t) => `.${t}`).join(",")
                : undefined
            }
            onChange={(e) => {
              const f = e.target.files?.[0];
              setUploadFile(f ?? null);
              setValue(f?.name ?? "");
              setSizeMb(f ? f.size / (1024 * 1024) : 0);
              setRefusal(
                f && space
                  ? checkUpload(space, { name: f.name, sizeMb: f.size / (1024 * 1024) }, me)
                  : null,
              );
            }}
          />
          {value && (
            <Tag tone={refusal ? "ruby" : "emerald"}>
              {value}
              {sizeMb ? ` · ${sizeMb.toFixed(1)} MB` : ""}
              {extOf(value) ? ` · .${extOf(value)}` : ""}
            </Tag>
          )}
        </label>
      ) : (
        <div className="mt-5">
          <span className={label}>{kind === "text" ? "inline text" : kind}</span>
          {kind === "text" ? (
            <textarea
              rows={6}
              className={cn(field, "resize-none")}
              placeholder={placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <input
              className={field}
              placeholder={placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </div>
      )}

      {refusal && (
        <p className="mt-4 rounded-lg border border-ruby/40 bg-ruby/[0.08] px-3 py-2 font-mono text-[11.5px] text-ruby">
          {refusal}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <JewelButton size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </JewelButton>
        <JewelButton size="sm" onClick={submit}>
          {kind === "file" ? "Upload & Transcribe" : "Ingest"}
        </JewelButton>
      </div>
    </Modal>
  );
}

function BrandAliasesTab() {
  const k = useKnowledge();
  const [q, setQ] = useState("");
  const [pulse, setPulse] = useState(0);

  const list = k.brandAliases.filter(
    (a) =>
      a.brand.toLowerCase().includes(q.toLowerCase()) ||
      a.aliases.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative w-[300px]">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
            />
            <input
              className={cn(field, "pl-8")}
              placeholder="Search brands or aliases…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <JewelButton size="sm" variant="ghost" onClick={async () => {
            setPulse((p) => p + 1);
            await k.syncBackend();
          }}>
            <RefreshCw size={13} className={pulse % 2 ? "animate-spin" : ""} /> Refresh
          </JewelButton>
        </div>
        <Tag tone="amethyst">{k.brandAliases.length} brands indexed</Tag>
      </div>

      {list.length === 0 && (
        <Panel>
          <p className="py-6 text-center text-[13px] text-muted-foreground/70">
            No brands match this filter — brands are derived automatically at ingest time.
          </p>
        </Panel>
      )}

      {list.map((a) => (
        <BrandAliasCard key={a.id} entry={a} />
      ))}
    </div>
  );
}

function BrandAliasCard({
  entry,
}: {
  entry: { id: string; brand: string; aliases: string; chunks?: number; enrichedDaysAgo?: number };
}) {
  const k = useKnowledge();
  const [draft, setDraft] = useState(
    entry.aliases
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [enriching, setEnriching] = useState(false);

  const dirty = draft.join(", ") !== entry.aliases.trim();

  const add = () => {
    const v = input.trim().toLowerCase();
    if (!v || draft.includes(v)) return;
    setDraft([...draft, v]);
    setInput("");
    setSaved(false);
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3">
        <Database size={14} className="text-sapphire" />
        <span className="font-mono text-[14px] tracking-tight text-foreground">{entry.brand}</span>
        <Tag tone="sapphire">{(entry.chunks ?? 0).toLocaleString("en-US")} chunks</Tag>
        <span className="font-mono text-[11.5px] text-muted-foreground/70">
          Enriched: {entry.enrichedDaysAgo ?? 0}d ago
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <TagIcon size={13} className="text-amethyst" />
        <span className={label}>aliases ({draft.length})</span>
      </div>

      <div className="mt-2 flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-white/[0.08] bg-raised/20 px-3 py-2.5">
        {draft.length === 0 && (
          <span className="text-[12.5px] italic text-muted-foreground/60">
            No aliases yet — type an alternate name below and press Enter
          </span>
        )}
        {draft.map((x) => (
          <span
            key={x}
            className="group flex items-center gap-1 rounded-md border border-amethyst/25 bg-amethyst/10 px-2 py-1 font-mono text-[11.5px] text-foreground/85"
          >
            {x}
            <button
              type="button"
              aria-label={`Remove ${x}`}
              onClick={() => {
                setDraft(draft.filter((d) => d !== x));
                setSaved(false);
              }}
              className="text-muted-foreground/60 transition-colors hover:text-ruby"
              title={`Remove ${x}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className={cn(field, "flex-1")}
          placeholder={`Add one alias for ${entry.brand} — press Enter to add (e.g. citrix-adc)`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <JewelButton size="sm" variant="ghost" onClick={add}>
          <Plus size={13} /> Add
        </JewelButton>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <JewelButton
          size="sm"
          disabled={!dirty}
          onClick={() => {
            k.upsertAlias({ id: entry.id, brand: entry.brand, aliases: draft.join(", ") });
            setSaved(true);
          }}
        >
          {saved && !dirty ? <Check size={13} /> : <Layers size={13} />}
          {saved && !dirty ? "Saved" : "Save aliases"}
        </JewelButton>
        <JewelButton
          size="sm"
          variant="ghost"
          onClick={async () => {
            setEnriching(true);
            try {
              await fetchApi("/api/rag/brand-aliases/reenrich", { method: "POST", body: JSON.stringify({ brand: entry.brand }) });
            } finally {
              setEnriching(false);
            }
          }}
        >
          <RefreshCw size={13} className={enriching ? "animate-spin" : ""} />
          {enriching ? "Re-enriching…" : "Re-enrich brand"}
        </JewelButton>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------- vector forge tab */

/* --------------------------------------------------- advanced tuning tab */

/* ------------------------------------------------ advanced system prompts */

function AdvancedTuningTab() {
  const { values, set, resetGroup } = useTuning();
  const [q, setQ] = useState("");
  const [dbStats, setDbStats] = useState<any>(null);
  useEffect(() => {
    fetchApi("/api/rag/db-stats").then(res => {
      if (res && res.ok) setDbStats(res);
    }).catch(() => {});
  }, []);

  const query = q.trim().toLowerCase();
  const groups = useMemo(
    () =>
      tuningSchema
        .map((g) => ({
          ...g,
          knobs: query
            ? g.knobs.filter(
                (k) =>
                  k.label.toLowerCase().includes(query) || k.hint.toLowerCase().includes(query),
              )
            : g.knobs,
        }))
        .filter((g) => g.knobs.length > 0),
    [query],
  );

  const total = tuningSchema.reduce(
    (n, g) => n + g.knobs.filter((k) => k.kind !== "note").length,
    0,
  );

  
  const k = useKnowledge();
  const [path, setPath] = useState("~/Documents/library/");
  const [pathState, setPathState] = useState<"blocked" | "validated" | "applied">("blocked");
  const [pathStats, setPathStats] = useState<any>(null);
  const coverage = k.health.chunks > 0 ? (k.health.embedOk / k.health.chunks) * 100 : 0;
return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-center gap-2.5">
          <Database size={15} className="text-sapphire" />
          <h2 className="text-[16.5px] font-medium tracking-tight text-foreground">
            Database Ops · Live PostgreSQL Telemetry
          </h2>
          <Tag tone="platinum">{dbStats?.dbSizeGb || "0.00 GB"}</Tag>
        </div>

        <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.05] sm:grid-cols-2 lg:grid-cols-4">
          <TeleStat value={dbStats?.telemetry?.hitRate || "0%"} title="cache hit rate" sub={`${(dbStats?.telemetry?.hits || 0).toLocaleString()} hit / ${(dbStats?.telemetry?.reads || 0).toLocaleString()} read`} />
          <TeleStat value={`${dbStats?.telemetry?.totalConnections || 0}`} title="connections" sub={`${dbStats?.telemetry?.activeConnections || 0} active · ${dbStats?.telemetry?.idleConnections || 0} idle`} />
          <TeleStat value={dbStats?.telemetry?.readsPerSec || "0.0"} title="reads / sec" sub={`${(dbStats?.telemetry?.commits || 0).toLocaleString()} total commits`} icon={<Zap size={14} />} />
          <TeleStat value={dbStats?.telemetry?.writesPerSec || "0.0"} title="writes / sec" sub={`${(dbStats?.telemetry?.rollbacks || 0).toLocaleString()} total rollbacks`} icon={<Activity size={14} />} />
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <Braces size={15} className="text-amethyst" />
              <h2 className="text-[16.5px] font-medium tracking-tight text-foreground">
                Vector Forge · pgvector HNSW
              </h2>
            </div>
            <p className="mt-1.5 font-mono text-[11.5px] text-muted-foreground/70">
              Checking vector seal…
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {k.health.embedPending > 0 ? (
              <Tag tone="topaz">HNSW pending ({k.health.embedPending})</Tag>
            ) : k.health.embedError > 0 ? (
              <Tag tone="ruby">HNSW error ({k.health.embedError})</Tag>
            ) : (
              <Tag tone="emerald">HNSW ready</Tag>
            )}
            <MaintButton icon={<RefreshCw size={13} />} onClick={async () => {
              await fetchApi("/api/knowledge/cleanup", { method: "POST" }).catch(() => {});
              k.syncBackend();
            }}>Cleanup</MaintButton>
            <JewelButton
              size="sm"
              variant="danger"
              onClick={async () => {
                const ok = await confirmAction({
                  title: "Nuke Vector Forge?",
                  body: "This will permanently delete all sources, chunks, embeddings, and graph entities from the local knowledge layer. This action cannot be undone.",
                  confirmLabel: "Nuke",
                  tone: "ruby",
                });
                if (ok) k.nuke();
              }}
            >
              <Trash2 size={13} /> Nuke
            </JewelButton>
            <MaintButton icon={<RefreshCw size={13} />} onClick={async () => {
              await fetchApi("/api/rag/reprocess-extensions", { method: "POST", body: JSON.stringify({ extensions: [".html", ".json"] }) }).catch(() => {});
              k.syncBackend();
            }}>Re-process HTML &amp; JSON</MaintButton>
            <JewelButton size="sm" onClick={async () => {
              await fetchApi("/api/knowledge/embeddings/backfill", { method: "POST" }).catch(() => {});
              k.syncBackend();
            }}>
              <Zap size={13} /> Start Backfill
            </JewelButton>
          </div>
        </div>

        <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.05] sm:grid-cols-3 lg:grid-cols-5">
          <ForgeStat label="chunks" value={(k.health.chunks ?? 0).toLocaleString()} />
          <ForgeStat label="pending" value={String(k.health.embedPending ?? 0)} />
          <ForgeStat label="embedded" value={(k.health.embedOk ?? 0).toLocaleString()} />
          <ForgeStat label="errors" value={String(k.health.embedError ?? 0)} />
          <ForgeStat label="files" value={String(k.sources?.length ?? 0)} />
        </div>

        <div className="mt-5 rounded-lg border border-white/[0.06] bg-raised/25 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Folder size={14} className="text-sapphire" />
              <span className="mono-label">library path status</span>
            </div>
            <Tag tone={pathState === "blocked" ? "ruby" : "emerald"}>{pathState}</Tag>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              className={cn(field, "min-w-[260px] flex-1")}
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <MaintButton icon={<Check size={13} />} onClick={async () => {
              try {
                const res = await fetchApi("/api/knowledge/embeddings/library-path/validate", { method: "POST", body: JSON.stringify({ path }) });
                setPathState("validated");
                setPathStats(res);
              } catch (e) {
                setPathState("blocked");
              }
            }}>Validate</MaintButton>
            <MaintButton icon={<Check size={13} />} onClick={async () => {
              try {
                const res = await fetchApi("/api/knowledge/embeddings/library-path", { method: "POST", body: JSON.stringify({ path, scan: false }) });
                setPathState("applied");
                setPathStats(res);
                k.syncBackend();
              } catch (e) {
                setPathState("blocked");
              }
            }}>Apply</MaintButton>
            <MaintButton icon={<Search size={13} />} onClick={async () => {
              try {
                const res = await fetchApi("/api/knowledge/embeddings/library-path", { method: "POST", body: JSON.stringify({ path, scan: true }) });
                setPathState("applied");
                setPathStats(res);
                k.syncBackend();
              } catch (e) {
                setPathState("blocked");
              }
            }}>Apply + Scan</MaintButton>
          </div>

          <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.05] sm:grid-cols-2 lg:grid-cols-4">
            <ForgeStat label="seen" value={pathStats?.access?.filesSeen?.toLocaleString() ?? "—"} />
            <ForgeStat label="indexable" value={pathStats?.access?.indexableSeen?.toLocaleString() ?? "—"} />
            <ForgeStat label="root chunks" value={pathStats?.pathSync?.chunksUpdated?.toLocaleString() ?? "—"} />
            <ForgeStat label="path sync" value={pathStats?.pathSync?.filesUpdated?.toLocaleString() ?? "0"} />
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <span className="mono-label">vector coverage · GET /rag/status</span>
            <span className="font-mono text-[12px] text-sapphire">{coverage.toFixed(1)}%</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-raised/60">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${coverage}%` }}
              transition={{ duration: 0.44, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full bg-sapphire shadow-[0_0_16px_-2px_var(--sapphire)]"
            />
          </div>
        </div>

      </Panel>

      <Fold
        title="Table inventory · top 50"
        meta={`${dbStats?.tableInventory?.length || 0} tables · pg_stat_user_tables`}
        tone="amethyst"
      >
        <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
          {(dbStats?.tableInventory || []).map((t: any) => (
            <div
              key={t.name}
              className="grid items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-raised/30 sm:grid-cols-[minmax(180px,1fr)_110px_1fr_100px]"
            >
              <span className="truncate font-mono text-[12.5px] text-foreground/90">{t.name}</span>
              <span className="text-right font-mono text-[12px] text-muted-foreground/75">
                {t.rows.toLocaleString()} rows
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-raised/60">
                <div
                  className={cn(
                    "h-full rounded-full",
                    t.weight > 0.5
                      ? "bg-ruby shadow-[0_0_14px_-3px_var(--ruby)]"
                      : "bg-sapphire/70",
                  )}
                  style={{ width: `${Math.max(t.weight * 100, 2)}%` }}
                />
              </div>
              <span className="text-right font-mono text-[12px] text-sapphire">{t.size}</span>
            </div>
          ))}
        </div>
      </Fold>
    </div>
  );
}

type TuningVals = Record<string, number | boolean | string | undefined>;

function TuningGroup({
  group,
  values,
  set,
  resetGroup,
  forceOpen,
}: {
  group: { id: string; title: string; meta: string; tone: TuningGroup["tone"]; knobs: Knob[] };
  values: TuningVals;
  set: (id: string, v: number | boolean | string) => void;
  resetGroup: (id: string) => void;
  forceOpen: boolean;
}) {
  const [draft, setDraft] = useState<TuningVals>({});

  const effective = (id: string) => (id in draft ? draft[id] : values[id]);
  const dirty = Object.keys(draft).some((id) => draft[id] !== values[id]);

  const save = () => {
    Object.entries(draft).forEach(([id, v]) => {
      if (v !== undefined && v !== values[id]) set(id, v as number | boolean | string);
    });
    setDraft({});
  };

  return (
    <Fold title={group.title} meta={group.meta} tone={group.tone} defaultOpen={forceOpen}>
      <div className="space-y-1.5">
        {group.knobs.map((k) => (
          <KnobRow
            key={k.id}
            knob={k}
            value={effective(k.id)}
            onChange={(v) => setDraft((d) => ({ ...d, [k.id]: v }))}
            tone={group.tone}
          />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <MaintButton
          icon={<RefreshCw size={13} />}
          onClick={async () => {
            const ok = await confirmAction({
              title: `Reset ${group.title}?`,
              body: "All knobs in this section return to their platform defaults. Unsaved edits are discarded.",
              confirmLabel: "Reset section",
              cancelLabel: "Cancel",
              tone: "ruby",
            });
            if (!ok) return;
            setDraft({});
            resetGroup(group.id);
          }}
        >
          Reset section
        </MaintButton>
        <JewelButton size="sm" variant="primary" disabled={!dirty} onClick={save}>
          Save
        </JewelButton>
      </div>
    </Fold>
  );
}

function KnobRow({
  knob,
  value,
  onChange,
  tone,
}: {
  knob: Knob;
  value: number | boolean | string | undefined;
  onChange: (v: number | boolean | string) => void;
  tone: "sapphire" | "amethyst" | "emerald" | "topaz";
}) {
  if (knob.kind === "note") {
    return (
      <div className="px-1 pb-1 pt-4">
        <div className="mono-label">{knob.label}</div>
        <p className="mt-1.5 max-w-[110ch] font-mono text-[11.5px] leading-relaxed text-muted-foreground/70">
          {knob.hint}
        </p>
      </div>
    );
  }

  const head = (
    <div className="min-w-0">
      <div className="text-[13.5px] font-medium text-foreground">{knob.label}</div>
      <p className="mt-1 max-w-[110ch] font-mono text-[11.5px] leading-relaxed text-muted-foreground/70">
        {knob.hint}
      </p>
    </div>
  );

  if (knob.kind === "toggle") {
    return (
      <div className="flex items-start justify-between gap-6 rounded-lg border border-white/[0.06] bg-raised/25 px-4 py-3">
        {head}
        <Switch
          checked={typeof value === "boolean" ? value : knob.value}
          onChange={onChange}
          aria-label={knob.label}
        />
      </div>
    );
  }

  if (knob.kind === "select") {
    return (
      <div className="flex items-start justify-between gap-6 rounded-lg border border-white/[0.06] bg-raised/25 px-4 py-3">
        {head}
        <select
          value={typeof value === "string" ? value : knob.value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={knob.label}
          className="mt-0.5 shrink-0 rounded-lg border border-white/[0.09] bg-panel px-3 py-1.5 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-sapphire/50"
        >
          {knob.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const num = typeof value === "number" ? value : knob.value;
  const pct = ((num - knob.min) / Math.max(knob.max - knob.min, 1e-9)) * 100;
  const decimals = knob.step < 1 ? (String(knob.step).split(".")[1]?.length ?? 2) : 0;

  return (
    <div className="rounded-lg border border-white/[0.06] bg-raised/25 px-4 py-3">
      <div className="flex items-start justify-between gap-6">
        {head}
        <input
          type="number"
          value={num}
          min={knob.min}
          max={knob.max}
          step={knob.step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) onChange(Math.min(knob.max, Math.max(knob.min, v)));
          }}
          aria-label={`${knob.label} value`}
          className="mt-0.5 w-[104px] shrink-0 rounded-lg border border-white/[0.09] bg-panel px-2.5 py-1.5 text-right font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-sapphire/50"
        />
      </div>

      <div className="relative mt-3 flex h-4 items-center">
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.07]" />
        <div
          className="absolute h-[3px] rounded-full"
          style={{
            width: `${pct}%`,
            background: `var(--${tone})`,
            boxShadow: `0 0 10px -2px var(--${tone})`,
          }}
        />
        <input
          type="range"
          min={knob.min}
          max={knob.max}
          step={knob.step}
          value={num}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={knob.label}
          className="tuning-range relative w-full cursor-pointer appearance-none bg-transparent"
          style={{ ["--knob" as string]: `var(--${tone})` }}
        />
      </div>
      <div className="mt-1 font-mono text-[10.5px] text-muted-foreground/40">
        {knob.min.toFixed(decimals)} — {knob.max.toFixed(decimals)}
      </div>
    </div>
  );
}

function TeleStat({
  value,
  title,
  sub,
  icon,
}: {
  value: string;
  title: string;
  sub: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-panel/60 px-5 py-4 text-center">
      {icon && <div className="mb-1 flex justify-center text-sapphire">{icon}</div>}
      <div className="font-mono text-[24px] tracking-tight text-foreground">{value}</div>
      <div className="mono-label mt-1">{title}</div>
      <div className="mt-1 font-mono text-[11px] text-muted-foreground/60">{sub}</div>
    </div>
  );
}

function ForgeStat({ label: l, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel/60 px-4 py-3 text-center">
      <div className="font-mono text-[16px] text-foreground">{value}</div>
      <div className="mono-label mt-1">{l}</div>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="glass my-6 w-full max-w-[620px] rounded-xl border border-sapphire/30 p-6 shadow-[0_0_80px_-40px_var(--sapphire)]"
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[17px] font-medium tracking-tight text-foreground">{title}</h3>
          <button onClick={onClose} aria-label="Close" title="Close">
            <X
              size={16}
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
            />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

/* -------------------------------------------------------------- shared */

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-[6px] text-[13px] font-medium transition-all duration-150 ease-in-out",
        active
          ? "border-sapphire/40 bg-sapphire/10 text-sapphire shadow-[0_0_26px_-14px_var(--sapphire)]"
          : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-white/15 hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="glass rounded-xl border border-white/[0.07] p-6">{children}</div>;
}

/** Panel content without its own chrome — used inside a Fold. */
function Bare({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

/** Collapsible container — closed by default so the hub stays calm. */
function Fold({
  title,
  meta,
  tone = "sapphire",
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  tone?: "sapphire" | "amethyst" | "emerald" | "topaz";
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="glass overflow-hidden rounded-xl border border-white/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-6 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: `var(--${tone})`, boxShadow: `0 0 8px -1px var(--${tone})` }}
        />
        <span className="text-[15px] font-medium tracking-tight text-foreground">{title}</span>
        {meta && (
          <span className="truncate font-mono text-[11.5px] text-muted-foreground/60">{meta}</span>
        )}
        <ChevronDown
          size={15}
          className={cn(
            "ml-auto shrink-0 text-muted-foreground/60 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="border-t border-white/[0.05] px-6 py-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Live / History sync inspector — streams worker logs, inspects past jobs. */
function SyncDetailBody() {
  const [mode, setMode] = useState<"live" | "history">("live");
  
  // Real DB state (we will connect this fully to GET /api/knowledge/sync-jobs in the next refinement)
  // For now, removing the mock array crash:
  const lines = ["[00:00] Worker idle... No active sync jobs."];
  
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <TabButton
          active={mode === "live"}
          onClick={() => setMode("live")}
          icon={<Activity size={13} />}
        >
          Live
        </TabButton>
        <TabButton
          active={mode === "history"}
          onClick={() => setMode("history")}
          icon={<HistoryIcon size={13} />}
        >
          History
        </TabButton>
      </div>

      <div className="mt-4 rounded-xl border border-white/[0.06] bg-raised/25 p-4">
         <div className="flex h-[200px] flex-col justify-end overflow-hidden rounded-lg bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/60 shadow-inner">
          <div className="flex-1 overflow-y-auto space-y-1">
            {lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-[16.5px] font-medium tracking-tight text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-[80ch] text-[12.5px] leading-relaxed text-muted-foreground/75">
        {hint}
      </p>
    </div>
  );
}

function ClientClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => setNow(new Date().toLocaleString()), []);
  return <>{now ?? "—"}</>;
}

function Detail({ label: l, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mono-label">{l}</div>
      <div className="mt-1 font-mono text-[12.5px] text-foreground/85">{value}</div>
    </div>
  );
}

function BigStat({
  label: l,
  value,
  tone,
  small,
}: {
  label: string;
  value: number;
  tone: "sapphire" | "amethyst";
  small?: boolean;
}) {
  return (
    <div className="bg-panel/60 px-5 py-4">
      <div className="mono-label">{l}</div>
      <div
        className={cn(
          "mt-1 font-mono tracking-tight",
          small ? "text-[20px]" : "text-[26px]",
          tone === "sapphire" ? "text-sapphire" : "text-amethyst",
        )}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function MaintButton({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => Promise<any> | void;
}) {
  const [loading, setLoading] = useState(false);
  const handleClick = async () => {
    if (!onClick || loading) return;
    setLoading(true);
    try {
      await onClick();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={cn("flex items-center gap-2 rounded-lg border border-white/[0.07] bg-raised/30 px-3 py-[7px] text-[12.5px] text-foreground/85 transition-all duration-200 hover:border-sapphire/35 hover:text-sapphire", loading && "opacity-50 cursor-not-allowed")}
    >
      <span className={cn("text-muted-foreground/70", loading && "animate-spin")}>{loading ? <RefreshCw size={13} /> : icon}</span>
      {children}
    </button>
  );
}

function ToggleRow({
  title,
  badge,
  badgeTone,
  hint,
  checked,
  onChange,
}: {
  title: string;
  badge: string;
  badgeTone: "emerald" | "ruby" | "platinum";
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-white/[0.06] bg-raised/25 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[14px] font-medium text-foreground">{title}</span>
          <Tag tone={badgeTone}>{badge}</Tag>
        </div>
        <p className="mt-1.5 max-w-[92ch] font-mono text-[11.5px] leading-relaxed text-muted-foreground/70">
          {hint}
        </p>
      </div>
      <Switch checked={checked} onChange={onChange} aria-label={title} />
    </div>
  );
}

function Switch({
  checked,
  onChange,
  ...rest
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative mt-0.5 h-[22px] w-[40px] shrink-0 rounded-full border transition-colors duration-200",
        checked ? "border-sapphire/50 bg-sapphire/25" : "border-white/10 bg-raised/60",
      )}
      {...rest}
    >
      <motion.span
        animate={{ x: checked ? 19 : 2 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={cn(
          "absolute top-[2px] block h-[16px] w-[16px] rounded-full",
          checked ? "bg-sapphire shadow-[0_0_12px_-2px_var(--sapphire)]" : "bg-muted-foreground/60",
        )}
      />
    </button>
  );
}
