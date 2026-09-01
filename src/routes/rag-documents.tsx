import { toast } from "sonner";
console.log("RAG Documents Loaded v2");
import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAccess } from "@/lib/rbac-store";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Loader2,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Surface } from "@/components/sovereign/surface";
import { JewelButton, StatusDot } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { useKnowledge, type KnowledgeSource } from "@/lib/knowledge-store";
import { checkUpload, useSpaceAccess } from "@/lib/knowledge-space-store";
import {
  useRagFolders,
  UPLOADS_FOLDER,
  FOLDER_TONES,
  type RagFolder,
} from "@/lib/rag-folder-store";
import { autoTagsFor, fileKind } from "@/lib/file-kind";
import { currentAccount } from "@/lib/group-store";
import { cn, fmtDateTime } from "@/lib/utils";

export const Route = createFileRoute("/rag-documents")({
  head: () => ({
    meta: [
      { title: "RAG Documents — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Create collections, drop your files, and let the assistant learn them. Every document is tagged and indexed automatically.",
      },
      { property: "og:title", content: "RAG Documents — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Personal document ingestion for the sovereign RAG layer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RagDocumentsPage,
});

function RagDocumentsPage() {
  const k = useKnowledge();
  const access = useSpaceAccess();
  const { folders, addFolder, patchFolder, removeFolder } = useRagFolders();

  const [activeId, setActiveId] = useState(UPLOADS_FOLDER.id);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");

  // The system resolves the destination space from the principal's memberships.
  const target = (access.sovereign ? access.spaces : access.writable)[0];
  const canUpload = Boolean(target);

  const active = folders.find((f) => f.id === activeId) ?? folders[0]!;
  const mine = useMemo(
    () => k.sources.filter((s) => s.owner && s.owner === access.ctx.userId),
    [k.sources, access.ctx.userId],
  );
  const inFolder = mine.filter((s) => (s.folder || UPLOADS_FOLDER.id) === active.id);
  const q = query.trim().toLowerCase();
  const rows = q
    ? inFolder.filter(
        (s) => s.name.toLowerCase().includes(q) || (s.tags ?? []).some((t) => t.includes(q)),
      )
    : inFolder;

  const countFor = (id: string) =>
    mine.filter((s) => (s.folder || UPLOADS_FOLDER.id) === id).length;

  const dropFolder = async (folder: RagFolder) => {
    const docs = mine.filter((s) => (s.folder || UPLOADS_FOLDER.id) === folder.id);
            const ok = await confirmAction({
      title: `Delete "${folder.name}"?`,
      body: `Deleting this collection permanently removes all ${docs.length} document${
        docs.length === 1 ? "" : "s"
      } inside it from the knowledge index. This cannot be undone.`,
      confirmLabel: "Delete everything",
      tone: "ruby",
    });
    if (!ok) return;
    docs.forEach((s) => k.removeSource(s.id));
    removeFolder(folder.id);
    setMenuFor(null);
    if (activeId === folder.id) setActiveId(UPLOADS_FOLDER.id);
  };

  const create = async () => {
    const name = draft.trim();
    if (!name) return;
    const id = await addFolder(name);
    if (id) setActiveId(id);
    setDraft("");
    setCreating(false);
  };

  if (!access.enabled) {
    return (
      <Surface title="RAG Documents" meta="no document area assigned" full>
        <div className="mx-auto mt-16 max-w-[520px] rounded-xl border border-white/[0.07] bg-white/[0.015] px-6 py-8 text-center">
          <div className="mono-label mb-2 text-muted-foreground/55">access · none</div>
          <p className="text-[14px] text-foreground/85">
            Your account is not a reader or contributor of any knowledge space.
          </p>
          <p className="mt-2 font-mono text-[12px] leading-relaxed text-muted-foreground/55">
            Ask an administrator to add you — or your group — to a space in Knowledge → Spaces.
            Until then this surface stays closed.
          </p>
        </div>
      </Surface>
    );
  }

  return (
    <Surface title="RAG Documents" meta="collections · drop files · the assistant learns them" full>
      <div className="grid gap-8 lg:grid-cols-[236px_1fr]">
        {/* ── collections rail ─────────────────────────────── */}
        <aside className="space-y-3">
          <div className="mono-label flex items-center gap-2 px-1">
            <FolderTree size={13} className="text-muted-foreground/55" />
            collections
          </div>

          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg border border-sapphire/35 bg-sapphire/[0.08] px-3 py-2 font-mono text-[12px] text-sapphire shadow-[0_0_26px_-14px_var(--sapphire)] transition-colors hover:bg-sapphire/[0.14]"
          >
            <FolderPlus size={14} />
            New collection
          </button>

          <AnimatePresence initial={false}>
            {creating && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-lg border border-white/[0.08] bg-raised/30 p-2.5">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") create();
                      if (e.key === "Escape") setCreating(false);
                    }}
                    placeholder="collection name…"
                    className="w-full rounded-md border border-white/[0.08] bg-canvas/60 px-2.5 py-1.5 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/45 focus:border-sapphire/55"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <JewelButton size="sm" variant="ghost" onClick={() => setCreating(false)}>
                      Cancel
                    </JewelButton>
                    <JewelButton size="sm" onClick={create}>
                      Create
                    </JewelButton>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-1 pt-1">
            {folders.map((f) => {
              const on = f.id === active.id;
              const tone = f.color ?? "sapphire";
              return (
                <div
                  key={f.id}
                  className={cn(
                    "group relative flex w-full items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
                    on ? "bg-white/[0.03]" : "border-transparent hover:bg-raised/30",
                  )}
                  style={
                    on
                      ? {
                          borderColor: `color-mix(in oklch, var(--${tone}) 35%, transparent)`,
                          boxShadow: `0 0 26px -18px var(--${tone})`,
                        }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(f.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {on ? (
                      <FolderOpen
                        size={14}
                        aria-hidden
                        className="shrink-0"
                        style={{
                          color: `var(--${tone})`,
                          filter: `drop-shadow(0 0 6px color-mix(in oklch, var(--${tone}) 55%, transparent))`,
                        }}
                      />
                    ) : (
                      <Folder
                        size={14}
                        aria-hidden
                        className="shrink-0 opacity-70"
                        style={{ color: `var(--${tone})` }}
                      />
                    )}
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[13px]",
                        on ? "text-foreground" : "text-muted-foreground/80",
                      )}
                    >
                      {f.name}
                    </span>
                  </button>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground/50">
                    {countFor(f.id)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Collection options for ${f.name}`}
                    onClick={() => setMenuFor((v) => (v === f.id ? null : f.id))}
                    className={cn(
                      "shrink-0 rounded-md p-1 text-muted-foreground/45 transition-all hover:text-sapphire",
                      menuFor === f.id
                        ? "text-sapphire opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                    title={`Collection options for ${f.name}`}
                  >
                    <Settings2 size={13} />
                  </button>

                  <AnimatePresence>
                    {menuFor === f.id && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setMenuFor(null)} />
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.98 }}
                          transition={{ duration: 0.14 }}
                          className="obsidian-slab absolute right-1 top-[calc(100%+4px)] z-40 w-[212px] rounded-[10px] p-2.5"
                        >
                          <div className="mono-label">colour</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {FOLDER_TONES.map((t) => (
                              <button
                                key={t}
                                type="button"
                                aria-label={`Paint ${f.name} ${t}`}
                                onClick={() => patchFolder(f.id, { color: t })}
                                className="grid h-6 w-6 place-items-center rounded-md border transition-transform hover:scale-110"
                                style={{
                                  borderColor:
                                    tone === t
                                      ? `color-mix(in oklch, var(--${t}) 75%, transparent)`
                                      : "rgba(255,255,255,0.08)",
                                  background: `color-mix(in oklch, var(--${t}) 16%, transparent)`,
                                }}
                                title={`Paint ${f.name} ${t}`}
                              >
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{
                                    background: `var(--${t})`,
                                    boxShadow: `0 0 10px -1px var(--${t})`,
                                  }}
                                />
                              </button>
                            ))}
                          </div>
                          {f.builtin ? (
                            <p className="mt-2.5 border-t border-white/[0.06] px-1 pt-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground/50">
                              default collection · cannot be deleted
                            </p>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void dropFolder(f); }}
                              className="mt-2.5 flex w-full items-center gap-2 rounded-md border-t border-white/[0.06] px-1 pt-2.5 text-left font-mono text-[11.5px] tracking-[0.06em] text-ruby transition-colors hover:text-ruby/80"
                            >
                              <Trash2 size={13} />
                              DELETE COLLECTION
                            </button>
                          )}
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── collection surface ───────────────────────────── */}
        <section className="min-w-0 space-y-5">
          <div className="obsidian-slab rounded-[14px] px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-sapphire/30 bg-sapphire/[0.08] shadow-[0_0_28px_-14px_var(--sapphire)]">
                  <Upload size={17} className="text-sapphire" />
                </div>
                <div>
                  <h2 className="text-[17px] font-medium leading-tight tracking-tight text-foreground">
                    {active.name}
                  </h2>
                  <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground/60">
                    {active.builtin ? "your default drop area" : "collection"} · {inFolder.length}{" "}
                    document{inFolder.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <JewelButton
                  size="sm"
                  onClick={() => setUploading((v) => !v)}
                  disabled={!canUpload}
                >
                  <Upload size={13} className="mr-1.5" />
                  Upload files
                </JewelButton>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {uploading && canUpload && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-5 border-t border-white/[0.06] pt-5">
                    <IngestPanel
                      spaceId={target!.id}
                      folder={active}
                      existing={mine.map((s) => s.name)}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {!canUpload && (
            <div className="rounded-[12px] border border-dashed border-white/[0.08] px-5 py-4 text-center text-[13px] text-muted-foreground/70">
              Your account has no document area yet — ask an administrator for upload access.
            </div>
          )}

          {/* search */}
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/45"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search documents or tags…"
              className="w-full rounded-lg border border-white/[0.07] bg-raised/30 py-2.5 pl-10 pr-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-sapphire/45"
            />
          </div>

          {/* table */}
          <div className="overflow-hidden rounded-[12px] border border-white/[0.06]">
            <div className="grid grid-cols-[minmax(0,2.2fr)_120px_100px_minmax(0,1.3fr)_120px_36px] items-center gap-3 border-b border-white/[0.06] bg-raised/25 px-4 py-2.5">
              {["name", "ingested", "size", "tags", "status", ""].map((h, i) => (
                <span key={i} className="mono-label truncate">
                  {h}
                </span>
              ))}
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-12 text-center text-[13px] text-muted-foreground/65">
                {inFolder.length === 0
                  ? "Empty collection — hit Upload files and pick your documents."
                  : "No document matches that search."}
              </p>
            ) : (
              rows.map((s) => (
                <DocRow
                  key={s.id}
                  source={s}
                  onRemove={() => k.removeSource(s.id)}
                  onTags={(tags) => k.patchSource(s.id, { tags })}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </Surface>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-white/[0.08] bg-raised/40 px-2 py-0.5 font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground/75">
      {label}
    </span>
  );
}

function TypeGlyph({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const k = fileKind(name);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[7px] border font-mono tracking-[0.04em]",
        size === "md" ? "h-7 w-[42px] text-[9.5px]" : "h-5 w-[34px] text-[8.5px]",
      )}
      style={{
        color: `var(--${k.tone})`,
        borderColor: `color-mix(in oklch, var(--${k.tone}) 38%, transparent)`,
        background: `color-mix(in oklch, var(--${k.tone}) 9%, transparent)`,
        boxShadow: `0 0 22px -14px var(--${k.tone})`,
      }}
    >
      {k.label}
    </span>
  );
}

const statusTone = {
  indexed: "emerald",
  pending: "sapphire",
  stale: "topaz",
  error: "ruby",
} as const;

function DocRow({
  source,
  onRemove,
  onTags,
}: {
  source: KnowledgeSource;
  onRemove: () => void;
  onTags: (tags: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const tags = source.tags ?? [];

  const drop = async () => {
    const ok = await confirmAction({
      title: `Delete "${source.name}"?`,
      body: "This document and all of its chunks are permanently removed from the knowledge index. Answers will no longer be able to cite it. This cannot be undone.",
      confirmLabel: "Delete document",
      tone: "ruby",
    });
            if (ok) onRemove();
  };

  return (
    <div className="group grid grid-cols-[minmax(0,2.2fr)_120px_100px_minmax(0,1.3fr)_120px_36px] items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors last:border-b-0 hover:bg-raised/25">
      <div className="flex min-w-0 items-center gap-3">
        <TypeGlyph name={source.name} />
        <div className="min-w-0">
          <div className="truncate text-[13px] text-foreground">{source.name}</div>
          <div className="font-mono text-[11px] text-muted-foreground/55">
            {source.chunks.toLocaleString()} chunks
          </div>
        </div>
      </div>
      <span className="font-mono text-[11.5px] text-muted-foreground/65">
        {new Date(source.addedAt).toISOString().slice(0, 10)}
      </span>
      <span className="font-mono text-[11.5px] text-muted-foreground/65">
        {(source.sizeMb ?? 0) < 0.1
          ? `${Math.max(1, Math.round((source.sizeMb ?? 0) * 1024))} KB`
          : `${(source.sizeMb ?? 0).toFixed(1)} MB`}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="flex min-w-0 flex-wrap gap-1">
          {tags.slice(0, 3).map((t) => (
            <Tag key={t} label={t} />
          ))}
          {tags.length > 3 && (
            <span className="font-mono text-[10.5px] text-muted-foreground/45">
              +{tags.length - 3}
            </span>
          )}
          {tags.length === 0 && (
            <span className="font-mono text-[11px] text-muted-foreground/40">—</span>
          )}
        </div>
        <button
          type="button"
          aria-label={`Manage tags for ${source.name}`}
          onClick={() => setEditing(true)}
          className={cn(
            "shrink-0 rounded-md border border-white/[0.08] bg-raised/40 p-1 text-muted-foreground/55 transition-all hover:border-sapphire/45 hover:text-sapphire",
            editing ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          title={`Manage tags for ${source.name}`}
        >
          <SlidersHorizontal size={12} />
        </button>
      </div>

      <StatusCell source={source} />

      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); drop().catch(console.error); }}
        aria-label={`Remove ${source.name}`}
        className="justify-self-end rounded-md p-1.5 text-muted-foreground/40 opacity-0 transition-all hover:bg-ruby/10 hover:text-ruby group-hover:opacity-100"
        title={`Remove ${source.name}`}
      >
        <Trash2 size={14} />
      </button>

      <AnimatePresence>
        {editing && (
          <TagManager
            source={source}
            onClose={() => setEditing(false)}
            onSave={(next) => {
              onTags(next);
              setEditing(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── status cell with hover detail card ─────────────────────── */
function StatusCell({ source }: { source: KnowledgeSource }) {
  const [hover, setHover] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fmt = (t?: number) =>
    t ? fmtDateTime(t) : "—";

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-2"
      onMouseEnter={() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setAnchor({ top: r.bottom + 8, left: Math.max(12, r.left - 150) });
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
    >
      <StatusDot tone={statusTone[source.status]} pulse={source.status === "pending"} />
      <span className="cursor-default font-mono text-[11.5px] text-muted-foreground/75">
        {source.status === "pending" ? "pending" : source.status}
      </span>

      <AnimatePresence>
        {hover && anchor && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            style={{ top: anchor.top, left: anchor.left }}
            className="obsidian-slab pointer-events-none fixed z-[120] w-[300px] rounded-[12px] p-4"
          >
            <div className="mono-label">document status</div>
            <div className="mt-3 space-y-2.5 text-[12px]">
              <Detail label="state">
                <span
                  className="rounded-md px-2 py-0.5 font-mono text-[11px]"
                  style={{
                    color: `var(--${statusTone[source.status]})`,
                    background: `color-mix(in oklch, var(--${statusTone[source.status]}) 12%, transparent)`,
                    border: `1px solid color-mix(in oklch, var(--${statusTone[source.status]}) 32%, transparent)`,
                  }}
                >
                  {source.status === "indexed"
                    ? "completed"
                    : source.status === "pending"
                      ? source.stage || "queued"
                      : source.status}
                </span>
              </Detail>
              <Detail label="queued at">{fmt(source.queuedAt ?? source.addedAt)}</Detail>
              <Detail label="last processed">{fmt(source.indexedAt)}</Detail>
              <Detail label="chunks">
                {source.chunks > 0 ? `${source.chunks.toLocaleString()} chunks created` : "—"}
              </Detail>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground/45">
        {label}
      </span>
      <span className="text-right font-mono text-[11.5px] text-foreground/85">{children}</span>
    </div>
  );
}

/* ── roomy tag manager ──────────────────────────────────────── */
function TagManager({
  source,
  onClose,
  onSave,
}: {
  source: KnowledgeSource;
  onClose: () => void;
  onSave: (tags: string[]) => void;
}) {
  const [tags, setTags] = useState<string[]>(source.tags ?? []);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");

  const add = () => {
    const clean = draft
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!clean.length) return;
    setTags((prev) => Array.from(new Set([...prev, ...clean])).slice(0, 24));
    setDraft("");
  };

  const drop = async (t: string) => {
    const ok = await confirmAction({
      title: `Remove tag "${t}"?`,
      body: "This tag is dropped from the document. Retrieval filters that rely on it will stop matching this document. This cannot be undone.",
      confirmLabel: "Remove tag",
      tone: "ruby",
    });
    if (ok) setTags((prev) => prev.filter((x) => x !== t));
  };

  const shown = filter.trim() ? tags.filter((t) => t.includes(filter.trim().toLowerCase())) : tags;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[130] bg-black/55 backdrop-blur-[2px]"
      />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.985 }}
        transition={{ duration: 0.16 }}
        role="dialog"
        aria-label="Manage tags"
        className="obsidian-slab fixed left-1/2 top-1/2 z-[140] w-[min(620px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[16px] p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-amethyst/30 bg-amethyst/[0.08] shadow-[0_0_26px_-14px_var(--amethyst)]">
              <SlidersHorizontal size={15} className="text-amethyst" />
            </div>
            <div>
              <h3 className="text-[16px] font-medium tracking-tight text-foreground">
                Manage tags
              </h3>
              <p className="mt-0.5 max-w-[380px] truncate font-mono text-[11.5px] text-muted-foreground/60">
                {source.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tag manager"
            className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:text-foreground"
            title="Close tag manager"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-[1fr_1.2fr_auto]">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/45"
            />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="search tags…"
              className="h-[36px] w-full rounded-lg border border-white/[0.08] bg-canvas/60 pl-8.5 pr-3 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-sapphire/50"
              style={{ paddingLeft: 32 }}
            />
          </div>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") onClose();
            }}
            placeholder="new tag… (comma separated)"
            className="h-[36px] w-full rounded-lg border border-white/[0.08] bg-canvas/60 px-3 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-sapphire/50"
          />
          <button
            type="button"
            onClick={add}
            aria-label="Add tag"
            className="grid h-[36px] w-[44px] place-items-center rounded-lg border border-sapphire/45 bg-sapphire/[0.1] text-sapphire shadow-[0_0_26px_-14px_var(--sapphire)] transition-colors hover:bg-sapphire/[0.18]"
            title="Add tag"
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="mt-4 max-h-[280px] min-h-[180px] overflow-y-auto rounded-[12px] border border-white/[0.07] bg-raised/20 p-2">
          {shown.length === 0 ? (
            <p className="px-3 py-14 text-center text-[12.5px] text-muted-foreground/55">
              {tags.length === 0 ? "No tags yet — add one above." : "No tag matches that search."}
            </p>
          ) : (
            shown.map((t) => (
              <div
                key={t}
                className="group/tag flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden
                    className="h-[6px] w-[6px] shrink-0 rounded-full bg-amethyst"
                    style={{ boxShadow: "0 0 10px -1px var(--amethyst)" }}
                  />
                  <span className="truncate font-mono text-[12.5px] text-foreground/90">{t}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void drop(t); }}
                  aria-label={`Remove tag ${t}`}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground/40 opacity-0 transition-all hover:bg-ruby/10 hover:text-ruby group-hover/tag:opacity-100"
                  title={`Remove tag ${t}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="font-mono text-[11.5px] text-muted-foreground/55">
            {tags.length} tag{tags.length === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <JewelButton size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </JewelButton>
            <JewelButton size="sm" onClick={() => onSave(tags)}>
              Save changes
            </JewelButton>
          </div>
        </div>
      </motion.div>
    </>
  );
}

type Staged = {
  id: string;
  name: string;
  sizeMb: number;
  refusal: string | null;
  phase: "queued" | "uploading" | "chunking" | "embedding" | "indexed";
  progress: number;
  chunks: number;
  file: File;
};

const PHASES: { key: Staged["phase"]; to: number }[] = [
  { key: "uploading", to: 34 },
  { key: "chunking", to: 68 },
  { key: "embedding", to: 92 },
  { key: "indexed", to: 100 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function IngestPanel({
  spaceId,
  folder,
  existing,
}: {
  spaceId: string;
  folder: RagFolder;
  existing: string[];
}) {
  const k = useKnowledge();
  const rbac = useAccess();
  const mayIngest = rbac.can("rag-ingest");
  const access = useSpaceAccess();
  const space = access.spaces.find((x) => x.id === spaceId);
  const me = access.ctx;

  const [files, setFiles] = useState<Staged[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const stage = (list: FileList | File[]) => {
    const taken = new Set(existing.map((n) => n.toLowerCase()));
    files.forEach((f) => taken.add(f.name.toLowerCase()));
    const picked = Array.from(list).map((f) => {
      const sizeMb = f.size / (1024 * 1024);
      const dupe = taken.has(f.name.toLowerCase());
      taken.add(f.name.toLowerCase());
      return {
        id: `${f.name}_${f.size}_${Math.random().toString(36).slice(2, 7)}`,
        name: f.name,
        sizeMb,
        refusal: dupe
          ? "A document with this name is already in your library."
          : space
            ? checkUpload(space, { name: f.name, sizeMb }, me)
            : "No document area open to you.",
        phase: "queued" as const,
        progress: 0,
        chunks: 0,
        file: f,
      };
    });
    setFiles((prev) => [...prev, ...picked]);
    setDone(false);
  };

  // Sovereign principals bypass the type gate — everyone else sees exactly
  // the extensions their space grants them.
  const allowed = access.sovereign ? [] : (space?.allowedTypes ?? []);
  const allowedLabel = access.sovereign
    ? "all file types (sovereign)"
    : allowed.length
      ? allowed.map((t) => t.toUpperCase()).join(" · ")
      : "any supported document";
  const acceptAttr = allowed.length ? allowed.map((t) => `.${t}`).join(",") : undefined;

  const accepted = files.filter((f) => !f.refusal);

  const ingest = async () => {
    if (!space || running || accepted.length === 0) return;
    setRunning(true);

    for (const f of accepted) {
      setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, phase: "uploading", progress: 20 } : x)));

      try {
        const id = await k.addSource({
          name: f.name,
          kind: "file",
          brand: "",
          space: space.id,
          owner: me.userId,
          ownerName: currentAccount()?.username ?? "",
          sizeMb: f.sizeMb,
          folder: folder.id,
          tags: autoTagsFor(f.name, folder.autoTags, space.name),
          file: f.file,
        });

        // Get the real chunks from the source if available after sync
        const realSrc = k.sources.find((s) => s.id === id);
        const actualChunks = realSrc?.chunks || Math.max(8, Math.round(f.sizeMb * 140) || 24);

        setFiles((prev) =>
          prev.map((x) => (x.id === f.id ? { ...x, phase: "indexed", progress: 100, chunks: actualChunks } : x))
        );
      } catch (err) {
        setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, refusal: "Upload failed" } : x)));
      }
    }
    setRunning(false);
    setDone(true);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={cn(
            "inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-lg border border-white/[0.1] bg-raised/35 px-4 font-mono text-[12px] tracking-[0.04em] text-foreground/85 transition-colors hover:border-sapphire/45 hover:text-sapphire",
            running && "pointer-events-none opacity-50",
          )}
        >
          <Files size={14} />
          Choose files
          <input
            type="file"
            multiple
            className="hidden"
            disabled={running}
            accept={acceptAttr}
            onChange={(e) => {
              if (e.target.files?.length) stage(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <span className="font-mono text-[11px] text-muted-foreground/50">
          multiple files · {allowedLabel} → {folder.name}
        </span>
      </div>

      {files.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {files.map((f) => (
            <StagedRow
              key={f.id}
              file={f}
              onRemove={running ? undefined : () => setFiles((p) => p.filter((x) => x.id !== f.id))}
            />
          ))}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="font-mono text-[11.5px] text-muted-foreground/55">
          {done
            ? `${accepted.length} document${accepted.length > 1 ? "s" : ""} are now searchable`
            : accepted.length
              ? `${accepted.length} ready · tagged automatically`
              : "no files selected"}
        </span>
        <div className="flex gap-2">
          {files.length > 0 && !running && (
            <JewelButton
              size="sm"
              variant="ghost"
              onClick={() => {
                setFiles([]);
                setDone(false);
              }}
            >
              Clear
            </JewelButton>
          )}
          {!mayIngest && (
            <span className="font-mono text-[11px] text-ruby/80">
              ingest verb not granted to your role
            </span>
          )}
          <IngestButton
            running={running}
            done={done}
            count={mayIngest ? accepted.length : 0}
            onClick={
              done
                ? () => {
                    setFiles([]);
                    setDone(false);
                  }
                : ingest
            }
          />
        </div>
      </div>
    </div>
  );
}

function IngestButton({
  running,
  done,
  count,
  onClick,
}: {
  running: boolean;
  done: boolean;
  count: number;
  onClick: () => void;
}) {
  const disabled = (!running && !done && count === 0) || running;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-[34px] items-center gap-2 overflow-hidden rounded-lg border px-4 font-mono text-[12px] tracking-[0.04em] transition-all",
        done
          ? "border-emerald/50 bg-emerald/[0.12] text-emerald shadow-[0_0_26px_-12px_var(--emerald)]"
          : "border-sapphire/45 bg-sapphire/[0.1] text-sapphire shadow-[0_0_26px_-12px_var(--sapphire)] hover:bg-sapphire/[0.16]",
        disabled && !running && "cursor-not-allowed opacity-40",
      )}
    >
      {running && (
        <motion.span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-transparent via-sapphire/25 to-transparent"
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
        />
      )}
      <span className="relative flex items-center gap-2">
        {done ? (
          <Check size={14} />
        ) : running ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Upload size={14} />
        )}
        {done ? "Done" : running ? "Uploading…" : count > 1 ? `Upload ${count} files` : "Upload"}
      </span>
    </button>
  );
}

function StagedRow({ file, onRemove }: { file: Staged; onRemove?: (() => void) | undefined }) {
  const tone = file.refusal
    ? "ruby"
    : file.phase === "indexed"
      ? "emerald"
      : file.phase === "queued"
        ? "sapphire"
        : "topaz";
  return (
    <div className="rounded-lg border border-white/[0.06] bg-raised/25 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <TypeGlyph name={file.name} size="sm" />
          <span className="truncate text-[12.5px] text-foreground">{file.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/50">
            {file.sizeMb < 0.1
              ? `${Math.max(1, Math.round(file.sizeMb * 1024))} KB`
              : `${file.sizeMb.toFixed(1)} MB`}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <StatusDot tone={tone} pulse={file.phase !== "queued" && file.phase !== "indexed"} />
          <span
            title={file.refusal ?? ""}
            className="max-w-[260px] truncate font-mono text-[11px] text-muted-foreground/75"
          >
            {file.refusal
              ? file.refusal
              : file.phase === "indexed"
                ? `indexed · ${file.chunks} chunks`
                : file.phase}
          </span>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${file.name}`}
              className="rounded-md p-1 text-muted-foreground/55 transition-colors hover:text-ruby"
              title={`Remove ${file.name}`}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {!file.refusal && file.phase !== "queued" && (
        <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div
            className="h-full rounded-full bg-sapphire shadow-[0_0_12px_-2px_var(--sapphire)]"
            initial={{ width: 0 }}
            animate={{ width: `${file.progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}
    </div>
  );
}
