import { useMemo, useState } from "react";
import { canEdit as canEditOwned, editRefusal } from "@/lib/ownership";
import { toast } from "sonner";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  Cable,
  Layers,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Webhook,
  X,
  Zap,
} from "lucide-react";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { Surface } from "@/components/sovereign/surface";
import { WebhookAdaptersPanel } from "@/components/sovereign/webhook-adapters";
import { Tag } from "@/components/sovereign/primitives";
import {
  emptyAdapter,
  riskTones,
  useAdapters,
  vaultScopes,
  type Adapter,
  type AdapterRisk,
  type DictEntry,
  type DictKind,
} from "@/lib/adapter-store";
import { gateAction } from "@/lib/approval-gate";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-sapphire/50";
const mono = "font-mono text-[12.5px]";

const dictMeta: Record<DictKind, { label: string; tone: string; icon: typeof Layers }> = {
  category: { label: "Category", tone: "amethyst", icon: Layers },
  connection: { label: "Connection", tone: "sapphire", icon: Cable },
  runner: { label: "Runner", tone: "emerald", icon: Play },
};

function MiniButton({
  children,
  onClick,
  tone = "sapphire",
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border bg-raised/30 px-3 py-[6px] font-mono text-[12px] text-foreground/90 transition-all duration-150 ease-in-out hover:bg-raised/60"
      style={{ borderColor: `color-mix(in oklab, var(--${tone}) 40%, transparent)` }}
    >
      {children}
    </button>
  );
}

function Toggle({
  on,
  onClick,
  tone = "emerald",
}: {
  on: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150"
      style={{
        borderColor: on
          ? `color-mix(in oklab, var(--${tone}) 55%, transparent)`
          : "rgba(255,255,255,0.1)",
        background: on
          ? `color-mix(in oklab, var(--${tone}) 22%, transparent)`
          : "rgba(255,255,255,0.06)",
      }}
    >
      <span
        className={cn(
          "absolute top-[2px] h-[15px] w-[15px] rounded-full transition-all duration-150 ease-in-out",
          on ? "left-[18px]" : "left-[2px] bg-white/45",
        )}
        style={
          on
            ? { background: `var(--${tone})`, boxShadow: `0 0 12px -2px var(--${tone})` }
            : undefined
        }
      />
    </button>
  );
}

/* ----------------------------------------------------------- dictionaries -- */

function DictColumn({ kind }: { kind: DictKind }) {
  const { dict, upsertDict, removeDict, usedBy } = useAdapters();
  const meta = dictMeta[kind];
  const Icon = meta.icon;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ key: string; label: string }>({ key: "", label: "" });

  const startNew = () => {
    setEditing("new");
    setDraft({ key: "", label: "" });
  };

  const commit = () => {
    const key = draft.key.trim().toLowerCase().replace(/\s+/g, "_");
    if (!key) return setEditing(null);
    const id = editing === "new" ? `d.${key}.${Date.now().toString(36)}` : editing!;
    upsertDict(kind, { id, key, label: draft.label.trim() || key });
    setEditing(null);
  };

  return (
    <div className="glass rounded-xl border border-white/[0.06] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={14} strokeWidth={1.7} style={{ color: `var(--${meta.tone})` }} />
          <span className="text-[13.5px] text-foreground">{meta.label}</span>
          <span className="font-mono text-[11.5px] text-muted-foreground/55">
            {dict[kind].length} entries
          </span>
        </div>
        <button
          onClick={startNew}
          aria-label={`Add ${meta.label}`}
          className="rounded-md border border-white/[0.07] p-1 text-muted-foreground/70 transition-colors hover:border-sapphire/40 hover:text-sapphire"
          title={`Add ${meta.label}`}
        >
          <Plus size={13} strokeWidth={2} />
        </button>
      </div>

      <div className="mt-3 space-y-1.5">
        <AnimatePresence initial={false}>
          {editing === "new" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1.5 rounded-lg border border-sapphire/40 bg-sapphire/[0.06] p-2">
                <input
                  autoFocus
                  value={draft.key}
                  onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
                  placeholder="key"
                  className={cn(field, mono, "py-1")}
                />
                <input
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="Label"
                  className={cn(field, "py-1")}
                />
                <button
                  onClick={commit}
                  aria-label="Save entry"
                  className="text-emerald"
                  title="Save entry"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => setEditing(null)}
                  aria-label="Cancel"
                  className="text-muted-foreground/70"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {dict[kind].map((entry: DictEntry) =>
          editing === entry.id ? (
            <div
              key={entry.id}
              className="flex items-center gap-1.5 rounded-lg border border-sapphire/40 bg-sapphire/[0.06] p-2"
            >
              <input
                autoFocus
                value={draft.key}
                onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
                className={cn(field, mono, "py-1")}
              />
              <input
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                className={cn(field, "py-1")}
              />
              <button
                onClick={commit}
                aria-label="Save entry"
                className="text-emerald"
                title="Save entry"
              >
                <Check size={14} />
              </button>
              <button
                onClick={() => setEditing(null)}
                aria-label="Cancel"
                className="text-muted-foreground/70"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div
              key={entry.id}
              className="group flex items-center justify-between gap-2 rounded-lg border border-white/[0.05] bg-raised/25 px-3 py-2 transition-colors hover:border-white/[0.12]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[12.5px] text-foreground">
                    {entry.key}
                  </span>
                  {entry.seed && <Tag>seed</Tag>}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted-foreground/60">
                  <span className="truncate">{entry.label}</span>
                  <span
                    className="font-mono"
                    style={{ color: usedBy(kind, entry.key) ? `var(--${meta.tone})` : undefined }}
                  >
                    used by {usedBy(kind, entry.key)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  aria-label={`Edit ${entry.key}`}
                  onClick={() => {
                    setEditing(entry.id);
                    setDraft({ key: entry.key, label: entry.label });
                  }}
                  className="text-muted-foreground/70 transition-colors hover:text-sapphire"
                  title={`Edit ${entry.key}`}
                >
                  <Pencil size={12.5} />
                </button>
                <button
                  aria-label={`Delete ${entry.key}`}
                  onClick={() => removeDict(kind, entry.id)}
                  className="text-muted-foreground/70 transition-colors hover:text-ruby"
                  title={`Delete ${entry.key}`}
                >
                  <Trash2 size={12.5} />
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ card -- */

function AdapterCard({
  adapter,
  onEdit,
  onTest,
  onToggle,
  onDelete,
}: {
  adapter: Adapter;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const tone = riskTones[adapter.risk];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="glass flex flex-col rounded-xl border border-white/[0.06] p-4 transition-colors duration-150 hover:border-sapphire/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="mt-[2px] flex size-8 shrink-0 items-center justify-center rounded-lg border border-sapphire/30 bg-sapphire/[0.08]"
            style={{ boxShadow: "0 0 18px -10px var(--sapphire)" }}
          >
            <Cable size={15} strokeWidth={1.7} className="text-sapphire" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] text-foreground">{adapter.name || "untitled"}</div>
            <div className="truncate font-mono text-[11.5px] text-muted-foreground/60">
              {adapter.id}
            </div>
          </div>
        </div>
        <Toggle on={adapter.enabled} onClick={onToggle} />
      </div>

      <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground/75">
        {adapter.description || "No description."}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {(
          [
            ["category", adapter.category, "amethyst"],
            ["connection", adapter.connection, "sapphire"],
            ["runner", adapter.runner, "emerald"],
            ["risk", adapter.risk, tone],
          ] as const
        ).map(([label, value, t]) => (
          <div key={label}>
            <div className="mono-label">{label}</div>
            <div className="mt-1 font-mono text-[12.5px]" style={{ color: `var(--${t})` }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Tag tone={adapter.vaultScope === "none" ? "platinum" : "topaz"}>
          vault ·{" "}
          {adapter.vaultScope === "none" ? "—" : `${adapter.vaultName}.${adapter.vaultField}`}
        </Tag>
        {adapter.requiresApproval && <Tag tone="ruby">approval</Tag>}
        {adapter.tags.map((t) => (
          <Tag key={t} tone="sapphire">
            {t}
          </Tag>
        ))}
      </div>

      {adapter.lastTest && (
        <div
          className="mt-3 rounded-lg border px-3 py-2 font-mono text-[11.5px]"
          style={{
            borderColor: adapter.lastTest.ok
              ? "color-mix(in oklab, var(--emerald) 35%, transparent)"
              : "color-mix(in oklab, var(--ruby) 35%, transparent)",
            color: adapter.lastTest.ok ? "var(--emerald)" : "var(--ruby)",
          }}
        >
          {adapter.lastTest.ok ? "PASS" : "FAIL"} · {adapter.lastTest.ms}ms ·{" "}
          {adapter.lastTest.detail}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onEdit}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-raised/30 py-2 font-mono text-[12px] text-foreground/90 transition-all duration-150 hover:border-sapphire/40 hover:text-sapphire"
        >
          <Pencil size={12} strokeWidth={1.8} /> Edit
        </button>
        <button
          onClick={onTest}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-raised/30 py-2 font-mono text-[12px] text-foreground/90 transition-all duration-150 hover:border-emerald/40 hover:text-emerald"
        >
          <Zap size={12} strokeWidth={1.8} /> Test
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete adapter"
          className="rounded-lg border border-white/[0.07] bg-raised/30 px-2.5 py-2 text-ruby/75 transition-colors hover:border-ruby/40 hover:text-ruby"
          title="Delete adapter"
        >
          <Trash2 size={12} strokeWidth={1.8} />
        </button>
      </div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- dialog -- */

function AdapterDialog({
  adapter,
  onClose,
  onSave,
}: {
  adapter: Adapter;
  onClose: () => void;
  onSave: (next: Adapter) => void;
}) {
  const { dict } = useAdapters();
  const [draft, setDraft] = useState<Adapter>(adapter);
  const set = (p: Partial<Adapter>) => setDraft((d) => ({ ...d, ...p }));

  const selectCls = cn(field, mono, "appearance-none pr-8");

  const Select = ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: string[];
    onChange: (v: string) => void;
  }) => (
    <div>
      <div className="mono-label mb-1.5">{label}</div>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
          {options.map((o) => (
            <option key={o} value={o} className="bg-panel">
              {o}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
        />
      </div>
    </div>
  );

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
        className="glass my-6 w-full max-w-[680px] rounded-xl border border-sapphire/30 p-6 shadow-[0_0_80px_-40px_var(--sapphire)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[17px] font-medium tracking-tight text-foreground">
              {adapter.name ? `Edit · ${adapter.name}` : "New Adapter"}
            </h3>
            <p className="mt-1.5 max-w-[480px] text-[12.5px] leading-relaxed text-muted-foreground/75">
              Define a reusable connector. Category, Connection and Runner options are fully
              editable in the Dictionaries panel.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" title="Close">
            <X
              size={16}
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
            />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mono-label mb-1.5">name</div>
              <input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                className={field}
              />
            </div>
            <div>
              <div className="mono-label mb-1.5">tags (comma)</div>
              <input
                value={draft.tags.join(", ")}
                onChange={(e) =>
                  set({
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
                className={field}
              />
            </div>
          </div>

          <div>
            <div className="mono-label mb-1.5">description</div>
            <input
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              className={field}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="category"
              value={draft.category}
              options={dict.category.map((d) => d.key)}
              onChange={(category) => set({ category })}
            />
            <Select
              label="connection"
              value={draft.connection}
              options={dict.connection.map((d) => d.key)}
              onChange={(connection) => set({ connection })}
            />
            <Select
              label="runner"
              value={draft.runner}
              options={dict.runner.map((d) => d.key)}
              onChange={(runner) => set({ runner })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="vault scope"
              value={draft.vaultScope}
              options={[...vaultScopes]}
              onChange={(vaultScope) => set({ vaultScope })}
            />
            <div>
              <div className="mono-label mb-1.5">vault name</div>
              <input
                value={draft.vaultName}
                onChange={(e) => set({ vaultName: e.target.value })}
                disabled={draft.vaultScope === "none"}
                placeholder="—"
                className={cn(field, mono, draft.vaultScope === "none" && "opacity-40")}
              />
            </div>
            <div>
              <div className="mono-label mb-1.5">field</div>
              <input
                value={draft.vaultField}
                onChange={(e) => set({ vaultField: e.target.value })}
                disabled={draft.vaultScope === "none"}
                placeholder="—"
                className={cn(field, mono, draft.vaultScope === "none" && "opacity-40")}
              />
            </div>
          </div>

          <div>
            <div className="mono-label mb-1.5">
              config (json) — e.g. {'{ "base_url": "https://api.cloudflare.com/client/v4" }'}
            </div>
            <textarea
              rows={6}
              value={draft.config}
              onChange={(e) => set({ config: e.target.value })}
              className={cn(field, mono, "resize-y leading-relaxed")}
            />
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <div className="w-[180px]">
              <Select
                label="risk"
                value={draft.risk}
                options={["low", "medium", "high", "critical"]}
                onChange={(risk) => set({ risk: risk as AdapterRisk })}
              />
            </div>
            <div className="flex items-center gap-2.5 pb-2">
              <Toggle
                tone="ruby"
                on={draft.requiresApproval}
                onClick={() => set({ requiresApproval: !draft.requiresApproval })}
              />
              <span className="font-mono text-[12.5px] text-muted-foreground/80">
                requires approval
              </span>
            </div>
            <div className="flex items-center gap-2.5 pb-2">
              <Toggle on={draft.enabled} onClick={() => set({ enabled: !draft.enabled })} />
              <span className="font-mono text-[12.5px] text-muted-foreground/80">enabled</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/[0.08] bg-raised/30 px-4 py-2 font-mono text-[12.5px] text-foreground/80 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="rounded-lg border border-emerald/50 bg-emerald/15 px-4 py-2 font-mono text-[12.5px] text-foreground shadow-[0_0_26px_-10px_var(--emerald)] transition-colors hover:bg-emerald/25"
          >
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ page -- */

function AdaptersPage() {
  const {
    dict,
    adapters,
    ctx: ownerCtx,
    saveAdapter,
    removeAdapter,
    toggleAdapter,
    testAdapter,
    resetAll,
  } = useAdapters();
  const [dictOpen, setDictOpen] = useState(false);
  const [webhooksOpen, setWebhooksOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [editing, setEditing] = useState<Adapter | null>(null);

  const visible = useMemo(
    () =>
      adapters.filter(
        (a) =>
          (cat === "all" || a.category === cat) &&
          (!query.trim() ||
            `${a.id} ${a.name} ${a.description} ${a.tags.join(" ")}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())),
      ),
    [adapters, cat, query],
  );

  return (
    <Surface
      wide
      title="Adapters"
      meta={`${adapters.length} adapters · ${adapters.filter((a) => a.enabled).length} enabled · ${dict.category.length} categories`}
      crumb="Adapters"
      action={
        <div className="flex items-center gap-2">
          <MiniButton
            tone="platinum"
            title="Discard all local changes and restore the factory adapter registry"
            onClick={async () => {
              const ok = await confirmAction({
                title: "Restore defaults?",
                body: "Every change you made in this adapter registry is discarded and the factory records come back.",
                confirmLabel: "Restore",
                tone: "topaz",
              });
              if (ok) resetAll();
            }}
          >
            <RotateCcw size={12} strokeWidth={2} /> Restore defaults
          </MiniButton>
          <MiniButton tone="emerald" onClick={() => setEditing(emptyAdapter())}>
            <Plus size={12} strokeWidth={2} /> New adapter
          </MiniButton>
        </div>
      }
    >
      <p className="max-w-[760px] text-[13.5px] leading-relaxed text-muted-foreground/75">
        Cloud · Network · Social · Content · AI · DB — one registry, flexible connection types.
        Every adapter binds a category, an auth connection and an execution runner, with optional
        vault-backed secrets.
      </p>

      <div className="mt-8 glass rounded-xl border border-white/[0.06] p-4">
        <button
          onClick={() => setDictOpen((o) => !o)}
          className="flex w-full items-center gap-2.5 text-left"
        >
          <ChevronDown
            size={14}
            className={cn(
              "text-muted-foreground/70 transition-transform duration-150",
              !dictOpen && "-rotate-90",
            )}
          />
          <span className="text-[14px] text-foreground">Dictionaries</span>
          <span className="font-mono text-[11.5px] text-muted-foreground/55">
            {dict.category.length} categories · {dict.connection.length} connections ·{" "}
            {dict.runner.length} runners
          </span>
          <span className="ml-auto font-mono text-[11px] tracking-[0.14em] text-muted-foreground/50">
            {dictOpen ? "HIDE" : "SHOW"}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {dictOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <DictColumn kind="category" />
                <DictColumn kind="connection" />
                <DictColumn kind="runner" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-1.5">
        {["all", ...dict.category.map((d) => d.key)].map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={cn(
              "rounded-lg border px-3 py-[6px] font-mono text-[12px] transition-all duration-150 ease-in-out",
              cat === c
                ? "border-sapphire/45 bg-sapphire/10 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/75 hover:text-foreground",
            )}
          >
            {c}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3">
          <Search size={14} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search adapters…"
            className="h-9 w-[220px] bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((a) => (
          <AdapterCard
            key={a.id}
            adapter={a}
            onEdit={() => setEditing(a)}
            onTest={() =>
              a.requiresApproval
                ? gateAction(
                    {
                      title: `Invoke gated adapter ${a.name}`,
                      origin: "adapter",
                      tool: `adapter.${a.id}`,
                      target: a.name,
                      policy: "adapter.requiresApproval — this adapter is human-gated",
                      risk: "high",
                      args: JSON.stringify({ adapter: a.id, action: "test" }, null, 2),
                    },
                    () => testAdapter(a.id),
                  )
                : testAdapter(a.id)
            }
            onToggle={() => toggleAdapter(a.id)}
            onDelete={() =>
              canEditOwned(a, ownerCtx)
                ? removeAdapter(a.id)
                : toast.error(editRefusal(a, ownerCtx))
            }
          />
        ))}
      </div>
      {!visible.length && (
        <p className="mt-8 font-mono text-[12.5px] text-muted-foreground/55">
          No adapters match this filter.
        </p>
      )}

      <div className="mt-10 glass rounded-xl border border-white/[0.06] p-4">
        <button
          onClick={() => setWebhooksOpen((o) => !o)}
          className="flex w-full items-center gap-2.5 text-left"
        >
          <ChevronDown
            size={14}
            className={cn(
              "text-muted-foreground/70 transition-transform duration-150",
              !webhooksOpen && "-rotate-90",
            )}
          />
          <Webhook size={14} className="text-topaz" />
          <span className="text-[14px] text-foreground">Webhooks</span>
          <span className="font-mono text-[11.5px] text-muted-foreground/55">
            inbound channel adapters · routing to RAG lives in Knowledge Hub
          </span>
          <span className="ml-auto font-mono text-[11px] tracking-[0.14em] text-muted-foreground/50">
            {webhooksOpen ? "HIDE" : "SHOW"}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {webhooksOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-5">
                <WebhookAdaptersPanel />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {editing && (
          <AdapterDialog adapter={editing} onClose={() => setEditing(null)} onSave={saveAdapter} />
        )}
      </AnimatePresence>
    </Surface>
  );
}

export const Route = createFileRoute("/adapters")({
  head: () => ({
    meta: [
      { title: "Adapters — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Adapter registry: cloud, network, social, content, AI and DB connectors with editable category, connection and runner dictionaries.",
      },
      { property: "og:title", content: "Adapters — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "One registry for every connector — flexible connection types, runners and vault-backed secrets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdaptersPage,
});
