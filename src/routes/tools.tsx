import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  ExternalLink,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { Tag } from "@/components/sovereign/primitives";
import { OwnerChip } from "@/components/sovereign/ownership-controls";
import { useOwnerCtx } from "@/lib/ownership";
import type { JewelName } from "@/lib/avatar-library";
import { getIcon } from "@/lib/icon-library";
import { jewelPalette } from "@/lib/avatar-library";
import {
  forgeAdapterCatalog,
  forgeKinds,
  forgeTargetCatalog,
  useForge,
  useForgeKind,
  type ForgeItem,
} from "@/lib/forge-store";
import { useToolPanel, type ToolConfig } from "@/lib/tool-panel-store";
import { useAdapters } from "@/lib/adapter-store";
import { useTargets } from "@/lib/target-store";
import {
  isolationSeed,
  resolveSandbox,
  useCollection,
  type IsolationProfile,
} from "@/lib/security-store";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-sapphire/50";
const mono = "font-mono text-[12.5px]";

const kindTone: Record<string, JewelName> = {
  trigger: "emerald",
  action: "sapphire",
  logic: "amethyst",
  output: "topaz",
};

function MiniButton({
  children,
  onClick,
  tone = "sapphire",
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border bg-raised/30 px-3 py-[6px] font-mono text-[12px] text-foreground/90 transition-all duration-150 ease-in-out"
      style={{ borderColor: `color-mix(in oklab, var(--${tone}) 40%, transparent)` }}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ card -- */

function ToolCard({
  item,
  config,
  sandbox,
  onToggle,
  onConfig,
  onForge,
  onOrphan,
}: {
  item: ForgeItem;
  config: ToolConfig;
  sandbox: IsolationProfile | null;
  onToggle: () => void;
  onConfig: () => void;
  onForge: () => void;
  onOrphan: () => void;
}) {
  const Icon = getIcon(item.icon);
  const tone = jewelPalette[item.jewel];
  const ownerCtx = useOwnerCtx();
  
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
            className="mt-[2px] flex size-8 shrink-0 items-center justify-center rounded-lg border"
            style={{
              borderColor: `${tone.to}38`,
              background: `linear-gradient(140deg, ${tone.from}1f, ${tone.to}10)`,
              boxShadow: `0 0 18px -10px ${tone.to}`,
            }}
          >
            <Icon size={15} strokeWidth={1.7} style={{ color: tone.to }} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] text-foreground">{item.name}</div>
            <div className="truncate font-mono text-[11.5px] text-muted-foreground/60">
              {item.id}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* ACCESS BADGE / OWNER CHIP */}
          {(item as any).visibility && (
             <OwnerChip record={item as any} ctx={ownerCtx} />
          )}
          <ShieldCheck
            size={14}
            strokeWidth={1.7}
            className={config.enabled ? "text-emerald/80" : "text-muted-foreground/40"}
          />
          <button
            type="button"
            onClick={onToggle}
            aria-label={config.enabled ? "Disable tool" : "Enable tool"}
            className={cn(
              "relative h-5 w-9 rounded-full border transition-colors duration-150",
              config.enabled
                ? "border-emerald/50 bg-emerald/25"
                : "border-white/10 bg-white/[0.06]",
            )}
            title={config.enabled ? "Disable tool" : "Enable tool"}
          >
            <span
              className={cn(
                "absolute top-[2px] h-[15px] w-[15px] rounded-full transition-all duration-150 ease-in-out",
                config.enabled ? "left-[18px] bg-emerald" : "left-[2px] bg-white/45",
              )}
            />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.system && <Tag>SYS</Tag>}
        <Tag tone={kindTone[item.kind] ?? "sapphire"}>{item.kind}</Tag>
        <Tag tone="amethyst">{item.handler}</Tag>
        {item.scriptPath && <Tag tone="sapphire">{item.scriptPath}</Tag>}
        <Tag tone="topaz">
          {item.params.length} param{item.params.length === 1 ? "" : "s"}
        </Tag>
        {config.adapters.length > 0 && <Tag tone="emerald">{config.adapters.length} adapters</Tag>}
        <Tag tone={sandbox ? "emerald" : "ruby"}>
          {sandbox ? `sandbox · ${sandbox.name}` : "no sandbox"}
        </Tag>
      </div>

      <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground/75">
        {item.description || "No description."}
      </p>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onConfig}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-raised/30 py-2 font-mono text-[12px] text-foreground/90 transition-all duration-150 ease-in-out hover:border-sapphire/40 hover:text-sapphire"
        >
          <Settings2 size={12} strokeWidth={1.8} /> Config
        </button>
        <button
          onClick={onForge}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-raised/30 py-2 font-mono text-[12px] text-foreground/90 transition-all duration-150 ease-in-out hover:border-amethyst/40 hover:text-amethyst"
        >
          <ExternalLink size={12} strokeWidth={1.8} /> Forge
        </button>
        <button
          onClick={async () => {
            const ok = await confirmAction({
              title: "Orphan Tool?",
              body: `Remove ${item.name} from the control panel? (The definition stays in the Forge Factory).`,
              confirmLabel: "Orphan",
              tone: "ruby",
            });
            if (ok) onOrphan();
          }}
          title="Orphan — hides the tool from this panel only"
          className="rounded-lg border border-white/[0.07] bg-raised/30 px-2.5 py-2 text-ruby/75 transition-colors hover:border-ruby/40 hover:text-ruby"
        >
          <Trash2 size={12} strokeWidth={1.8} />
        </button>
      </div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- dialog -- */

type PickerItem = string | { id: string; label: string };

function Picker({
  label,
  catalog,
  selected,
  onChange,
  hint,
}: {
  label: string;
  catalog: readonly PickerItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  hint: string;
}) {
  const normId = (c: PickerItem) => (typeof c === "string" ? c : c.id);
  const normLabel = (c: PickerItem) => (typeof c === "string" ? c : c.label);

  const available = catalog.filter((c) => !selected.includes(normId(c)));
  const [pick, setPick] = useState("");
  const value = available.find((c) => normId(c) === pick) ? pick : (available.length && available[0] ? normId(available[0]) : "");

  return (
    <div className="rounded-xl border border-white/[0.06] bg-raised/20 p-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
        {label} · {selected.length}/{catalog.length}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <select
            value={value}
            disabled={!available.length}
            onChange={(e) => setPick(e.target.value)}
            className={cn(field, mono, "h-[32px] w-auto min-w-[170px] py-0")}
          >
            {available.length ? (
              available.map((c) => (
                <option key={normId(c)} value={normId(c)} className="bg-panel">
                  {normLabel(c)}
                </option>
              ))
            ) : (
              <option className="bg-panel">all granted</option>
            )}
          </select>
          <button
            type="button"
            disabled={!value}
            onClick={() => {
              if (!value) return;
              onChange([...selected, value]);
              setPick("");
            }}
            className="flex items-center gap-1.5 rounded-lg border border-sapphire/45 bg-sapphire/10 px-3 py-1 font-mono text-[11.5px] text-foreground transition-all hover:bg-sapphire/20 disabled:opacity-40"
          >
            <Plus size={11} strokeWidth={2} /> Add
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {selected.length ? (
          selected.map((s) => {
            const item = catalog.find((c) => normId(c) === s);
            const displayLabel = item ? normLabel(item) : s;
            return (
              <span
                key={s}
                className="group flex items-center gap-1.5 rounded-lg border border-sapphire/45 bg-sapphire/10 px-2 py-1 font-mono text-[11px] text-foreground"
              >
                {displayLabel}
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((x) => x !== s))}
                >
                  <X
                    size={10}
                    className="text-muted-foreground/70 transition-colors hover:text-ruby"
                  />
                </button>
              </span>
            );
          })
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground/50">{hint}</span>
        )}
      </div>
    </div>
  );
}

function ConfigDialog({
  tool,
  config,
  onClose,
  onSave,
}: {
  tool: ForgeItem;
  config: ToolConfig;
  onClose: () => void;
  onSave: (patch: Partial<ToolConfig>) => void;
}) {
  const [draft, setDraft] = useState<ToolConfig>(config);
  const set = (patch: Partial<ToolConfig>) => setDraft((p) => ({ ...p, ...patch }));

  const { adapters } = useAdapters();
  const { targets } = useTargets();

  const dynamicAdapterCatalog = adapters.map(a => ({ id: a.id, label: a.name || a.id }));
  const dynamicTargetCatalog = targets.map(t => ({ id: t.name, label: t.name }));

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
          <div>
            <h3 className="text-[17px] font-medium tracking-tight text-foreground">
              Configure · {tool.name}
            </h3>
            <p className="mt-1.5 max-w-[460px] text-[12.5px] leading-relaxed text-muted-foreground/75">
              Defaults saved into the Forge action so chat, chains and agents inherit them. Use{" "}
              <span className="font-mono text-sapphire">{"{{params.x}}"}</span> in runtime
              templates.
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
          {tool.params.length ? (
            tool.params.map((p) => (
              <div key={p.id}>
                <div className="mono-label mb-1.5">
                  {p.label || p.key} · {p.type}
                </div>
                <input
                  value={draft.defaults[p.key] ?? p.value ?? ""}
                  onChange={(e) =>
                    set({ defaults: { ...draft.defaults, [p.key]: e.target.value } })
                  }
                  className={field}
                  placeholder={`default for ${p.key}`}
                />
              </div>
            ))
          ) : (
            <p className="font-mono text-[12px] text-muted-foreground/55">
              This tool exposes no parameters.
            </p>
          )}

          <div className="border-t border-white/[0.06] pt-4">
            <div className="mono-label mb-1.5">tool system prompt</div>
            <textarea
              rows={5}
              value={draft.systemPrompt}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              placeholder="Tool-specific instructions injected into the model's system prompt before this tool runs (e.g. 'Always cite source IP, never invent flags.')."
              className={cn(field, mono, "resize-y leading-relaxed")}
            />
            <p className="mt-1.5 text-[11.5px] text-muted-foreground/55">
              Saved into <span className="font-mono">action_library.system_prompt</span> · inherited
              by agents, chains and chat tool calls.
            </p>
          </div>

          <Picker
            label="Adapters"
            catalog={dynamicAdapterCatalog}
            selected={draft.adapters}
            onChange={(adapters) => set({ adapters })}
            hint="No adapters bound · tool runs standalone."
          />
          <Picker
            label="Targets"
            catalog={dynamicTargetCatalog}
            selected={draft.targets}
            onChange={(targets) => set({ targets })}
            hint="No targets bound."
          />
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

function ToolControlPanel() {
  const navigate = useNavigate();
  const { items } = useForge();
  const { kind, setKind } = useForgeKind();
  const { orphans, dismissed, configOf, orphan, restore, restoreAll, dismissOrphan, setConfig } =
    useToolPanel();

  const isolation = useCollection<IsolationProfile>(
    "sovereign.security.isolation",
    isolationSeed,
    "iso",
  );

  const [tab, setTab] = useState<"library" | "orphans">("library");
  const [query, setQuery] = useState("");
  const [configId, setConfigId] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          !orphans.includes(i.id) &&
          (kind === "all" || i.kind === kind) &&
          (!query.trim() ||
            `${i.id} ${i.name} ${i.category}`.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [items, orphans, kind, query],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, ForgeItem[]>();
    visible.forEach((i) => map.set(i.category, [...(map.get(i.category) ?? []), i]));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const orphanItems = useMemo(
    () => items.filter((i) => orphans.includes(i.id) && !dismissed.includes(i.id)),
    [items, orphans, dismissed],
  );
  const configItem = items.find((i) => i.id === configId) ?? null;

  const openInForge = (item: ForgeItem) => {
    setKind(item.kind);
    void navigate({ to: "/factory", search: { item: item.id } });
  };

  const enabledCount = visible.filter((i) => configOf(i.id).enabled).length;
  const kindLabel = kind === "all" ? "all kinds" : kind;

  return (
    <Surface
      wide
      title="Tool Control Panel"
      meta={`${visible.length} tools · ${enabledCount} enabled · ${kindLabel}`}
      crumb="Tools"
      action={
        <div className="flex items-center gap-2">
          <MiniButton onClick={() => setKind("all")}>
            <Wrench size={12} strokeWidth={2} /> All kinds
          </MiniButton>
          <MiniButton
            tone="emerald"
            onClick={() => {
              setKind(kind === "all" ? "action" : kind);
              void navigate({ to: "/factory", search: { create: true, item: "" } });
            }}
          >
            <Plus size={12} strokeWidth={2} /> New tool
          </MiniButton>
          <MiniButton
            tone="amethyst"
            onClick={() => void navigate({ to: "/factory", search: { item: "" } })}
          >
            <ExternalLink size={12} strokeWidth={2} /> Open Forge
          </MiniButton>
        </div>
      }
    >
      <p className="mt-4 max-w-[760px] text-[13.5px] leading-relaxed text-muted-foreground/75">
        Synced with the Forge Factory · tools are grouped by the action kind they were forged in.
        Trash orphans a tool from this panel only — the definition stays in the Forge, where
        permanent deletion lives.
      </p>

      <div className="mt-6 flex items-center gap-1.5">
        {(
          [
            ["library", `Library · ${visible.length}`],
            ["orphans", `Orphans · ${orphanItems.length}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "rounded-lg border px-3 py-[6px] font-mono text-[12px] transition-all duration-150 ease-in-out",
              tab === id
                ? "border-sapphire/45 bg-sapphire/10 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/75 hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3">
          <Search size={14} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools…"
            className="h-9 w-[220px] bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      {tab === "library" ? (
        <div className="mt-6 space-y-7">
          {grouped.map(([category, list]) => (
            <div key={category}>
              <div className="mono-label mb-2.5">{category}</div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.map((i) => (
                  <ToolCard
                    key={i.id}
                    item={i}
                    config={configOf(i.id)}
                    sandbox={resolveSandbox(isolation.items, i.id)}
                    onToggle={() => setConfig(i.id, { enabled: !configOf(i.id).enabled })}
                    onConfig={() => setConfigId(i.id)}
                    onForge={() => openInForge(i)}
                    onOrphan={() => orphan(i.id)}
                  />
                ))}
              </div>
            </div>
          ))}
          {!grouped.length && (
            <div className="glass rounded-xl border border-white/[0.06] p-10 text-center">
              <p className="font-mono text-[12.5px] text-muted-foreground/70">
                No tools in this kind. Forge one in the Factory.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {orphanItems.length ? (
            <>
              <div className="flex justify-end">
                <MiniButton tone="emerald" onClick={restoreAll}>
                  <RotateCcw size={12} strokeWidth={2} /> Restore all
                </MiniButton>
              </div>
              {orphanItems.map((i) => (
                <div
                  key={i.id}
                  className="glass flex items-center gap-3 rounded-xl border border-white/[0.06] px-4 py-3"
                >
                  <Tag tone={kindTone[i.kind] ?? "sapphire"}>{i.kind}</Tag>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-foreground">{i.name}</div>
                    <div className="truncate font-mono text-[11.5px] text-muted-foreground/55">
                      {i.id}
                    </div>
                  </div>
                  <MiniButton onClick={() => openInForge(i)}>
                    <ExternalLink size={12} strokeWidth={2} /> Forge
                  </MiniButton>
                  <MiniButton tone="emerald" onClick={() => restore(i.id)}>
                    <RotateCcw size={12} strokeWidth={2} /> Restore
                  </MiniButton>
                  <MiniButton tone="ruby" onClick={() => dismissOrphan(i.id)}>
                    <X size={12} strokeWidth={2} /> Remove
                  </MiniButton>
                </div>
              ))}
            </>
          ) : (
            <div className="glass rounded-xl border border-white/[0.06] p-10 text-center">
              <p className="font-mono text-[12.5px] text-muted-foreground/70">
                No orphaned tools. Trashed tools land here — never deleted.
              </p>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {configItem && (
          <ConfigDialog
            tool={configItem}
            config={configOf(configItem.id)}
            onClose={() => setConfigId(null)}
            onSave={(patch) => setConfig(configItem.id, patch)}
          />
        )}
      </AnimatePresence>
    </Surface>
  );
}

export const Route = createFileRoute("/tools")({
  head: () => ({
    meta: [
      { title: "Tool Control Panel — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Every forged tool in one panel: kind-scoped grouping, defaults, system prompts, adapter and target bindings.",
      },
      { property: "og:title", content: "Tool Control Panel — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Kind-scoped tool registry synced with the Forge Factory: enable, configure defaults, bind adapters and targets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ToolControlPanel,
});
