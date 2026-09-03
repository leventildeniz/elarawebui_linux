import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowDown, ArrowUp, Copy, Plus, Save, Search, Trash2, X } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { Tag } from "@/components/sovereign/primitives";
import { IconPicker, JewelSwatches } from "@/components/sovereign/identity";
import { getIcon } from "@/lib/icon-library";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { ShareControl } from "@/components/sovereign/ownership-controls";
import { jewelPalette } from "@/lib/avatar-library";
import { useModels } from "@/lib/model-store";
import { useRuntimes } from "@/lib/runtime-store";
import { useAdapters } from "@/lib/adapter-store";
import { useTargets } from "@/lib/target-store";
import { fetchApi } from "@/lib/api";
import {
  emptyForgeItem,
  forgeAdapterCatalog,
  forgeHandlers,
  forgeKinds,
  forgeOutputFormats,
  forgeParamTypes,
  forgeTargetCatalog,
  useForge,
  useForgeKind,
  type ForgeItem,
  type ForgeKind,
  type ForgeTempOverride,
} from "@/lib/forge-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/factory")({
  validateSearch: (search: Record<string, unknown>): { item?: string; create?: boolean } => ({
    item: typeof search["item"] === "string" ? search["item"] : "",
    create: search["create"] === true || search["create"] === "true",
  }),
  head: () => ({
    meta: [
      { title: "Forge Factory — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Define your own triggers, actions, logic and outputs. Every definition carries its own schema, runtime, bindings and execution policy.",
      },
      { property: "og:title", content: "Forge Factory — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Author triggers, actions, logic gates and output sinks with typed parameters, runtime handlers and strict execution policy.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ForgeFactory,
});

const input =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[13.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";
const mono = cn(input, "font-mono text-[12.5px]");

const kindTone: Record<ForgeKind, "emerald" | "sapphire" | "amethyst" | "topaz"> = {
  trigger: "emerald",
  action: "sapphire",
  logic: "amethyst",
  output: "topaz",
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mono-label mb-2 block">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11.5px] text-muted-foreground/60">{hint}</span>}
    </label>
  );
}

function Section({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-raised/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="mono-label">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function MiniButton({
  children,
  onClick,
  tone = "sapphire",
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "sapphire" | "emerald";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-[5px] font-mono text-[11.5px] text-foreground transition-all duration-150 ease-in-out",
        tone === "sapphire"
          ? "border-sapphire/45 bg-sapphire/10 hover:bg-sapphire/20"
          : "border-emerald/45 bg-emerald/10 hover:bg-emerald/20",
      )}
    >
      {children}
    </button>
  );
}

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={label}
      className="flex items-center gap-2"
      title={label}
    >
      <span
        className={cn(
          "relative h-5 w-9 rounded-full border transition-colors duration-150",
          on ? "border-emerald/50 bg-emerald/25" : "border-white/10 bg-white/[0.05]",
        )}
      >
        <motion.span
          layout
          transition={{ duration: 0.16, ease: "easeInOut" }}
          className={cn(
            "absolute top-[2px] h-[15px] w-[15px] rounded-full",
            on ? "left-[18px] bg-emerald" : "left-[2px] bg-white/45",
          )}
        />
      </span>
    </button>
  );
}

type PickerItem = string | { id: string; label: string };

function PickerRow({
  label,
  catalog,
  selected,
  onChange,
  empty,
}: {
  label: string;
  catalog: readonly PickerItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  empty: string;
}) {
  const normId = (c: PickerItem) => (typeof c === "string" ? c : c.id);
  const normLabel = (c: PickerItem) => (typeof c === "string" ? c : c.label);

  const available = catalog.filter((c) => !selected.includes(normId(c)));
  const [pick, setPick] = useState("");
  const value = available.find((c) => normId(c) === pick) ? pick : (available.length && available[0] ? normId(available[0]) : "");
  return (
    <Section
      label={`${label} · ${selected.length}`}
      action={
        <div className="flex items-center gap-2">
          <select
            value={value}
            disabled={!available.length}
            onChange={(e) => setPick(e.target.value)}
            className={cn(mono, "h-[32px] w-auto min-w-[180px] py-0")}
          >
            {available.length ? (
              available.map((c) => (
                <option key={normId(c)} value={normId(c)} className="bg-panel">
                  {normLabel(c)}
                </option>
              ))
            ) : (
              <option className="bg-panel">all bound</option>
            )}
          </select>
          <MiniButton
            onClick={() => {
              if (!value) return;
              onChange([...selected, value]);
              setPick("");
            }}
          >
            <Plus size={12} strokeWidth={2} /> Add
          </MiniButton>
        </div>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {selected.length ? (
          selected.map((s) => {
            const item = catalog.find((c) => normId(c) === s);
            const displayLabel = item ? normLabel(item) : s;
            return (
              <span
                key={s}
                className="flex items-center gap-1.5 rounded-lg border border-sapphire/45 bg-sapphire/10 px-2.5 py-1 font-mono text-[11.5px] text-foreground"
              >
                {displayLabel}
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((x) => x !== s))}
                  aria-label={`Remove ${displayLabel}`}
                  title={`Remove ${displayLabel}`}
                >
                  <X
                    size={11}
                    className="text-muted-foreground/70 transition-colors hover:text-ruby"
                  />
                </button>
              </span>
            );
          })
        ) : (
          <span className="font-mono text-[11.5px] text-muted-foreground/50">{empty}</span>
        )}
      </div>
    </Section>
  );
}

function slugify(name: string, kind: ForgeKind) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const prefix = kind === "action" ? "tool" : kind;
  return `${prefix}.${base || "untitled"}`;
}

function ForgeFactory() {
  const { items, create, update, remove } = useForge();
  const { kind } = useForgeKind();
  const { models } = useModels();
  const { runtimes } = useRuntimes();
  const { adapters } = useAdapters();
  const { targets } = useTargets();
  const [localScripts, setLocalScripts] = useState<any[]>([]);

  useEffect(() => {
    fetchApi("/api/system/local-scripts")
      .then(res => { if (res && res.scripts) setLocalScripts(res.scripts); })
      .catch(e => console.error("Failed to load local scripts", e));
  }, []);

  const dynamicAdapterCatalog = adapters.map(a => ({ id: a.id, label: a.name || a.id }));
  const dynamicTargetCatalog = targets.map(t => ({ id: t.name, label: t.name }));
  const [editorTab, setEditorTab] = useState<"identity" | "schema" | "runtime" | "policy">(
    "identity",
  );

  const { item: focusId, create: shouldCreate } = useSearch({ from: "/factory" });
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ForgeItem | null>(() => {
    if (shouldCreate) {
      return {
        ...emptyForgeItem,
        kind: kind === "all" ? "action" : kind,
        id: "",
        createdAt: Date.now(),
      } as ForgeItem;
    }
    return null;
  });
  const [creating, setCreating] = useState(shouldCreate);
  const [saved, setSaved] = useState(false);

  const scoped = useMemo(
    () =>
      items.filter(
        (i) =>
          (kind === "all" || i.kind === kind) &&
          (!query.trim() ||
            `${i.id} ${i.name} ${i.category}`.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [items, kind, query],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, ForgeItem[]>();
    scoped.forEach((i) => map.set(i.category, [...(map.get(i.category) ?? []), i]));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [scoped]);

  useEffect(() => {
    if (!focusId) return;
    const target = items.find((i) => i.id === focusId);
    if (!target) return;
    setCreating(false);
    setSelectedId(target.id);
    setDraft({ ...target });
  }, [focusId, items]);

  useEffect(() => {
    if (creating) return;
    if (selectedId && items.some((i) => i.id === selectedId)) return;
    const first = scoped[0] ?? null;
    setSelectedId(first?.id ?? null);
    setDraft(first ? { ...first } : null);
  }, [scoped, creating, selectedId, items]);

  const select = (i: ForgeItem) => {
    setCreating(false);
    setSelectedId(i.id);
    setDraft({ ...i });
  };

  const startNew = () => {
    const nextKind: ForgeKind = kind === "all" ? "action" : kind;
    setCreating(true);
    setSelectedId(null);
    setDraft({
      ...emptyForgeItem,
      kind: nextKind,
      id: "",
      createdAt: Date.now(),
    } as ForgeItem);
  };

  const duplicate = () => {
    if (!draft) return;
    setCreating(true);
    setSelectedId(null);
    setDraft({ ...draft, id: "", name: `${draft.name} copy`, system: false });
  };

  const patch = (p: Partial<ForgeItem>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = () => {
    if (!draft) return;
    const id = draft.id.trim() || slugify(draft.name, draft.kind);
    const payload = { ...draft, id, name: draft.name.trim() || id };
    if (creating || !items.some((i) => i.id === id)) create(payload);
    else update(id, payload);
    setCreating(false);
    setSelectedId(id);
    setDraft(payload);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const kindLabel =
    kind === "all" ? "definition" : forgeKinds.find((k) => k.id === kind)!.label.toLowerCase();

  return (
    <Surface
      wide
      title="Forge Factory"
      meta={`${scoped.length} definitions · ${kind === "all" ? "all kinds" : kindLabel}`}
      crumb="Forge Factory"
      action={
        <div className="flex items-center gap-2">
          <MiniButton onClick={startNew}>
            <Plus size={12} strokeWidth={2} /> New {kind === "all" ? "action" : kindLabel}
          </MiniButton>
          <MiniButton onClick={duplicate}>
            <Copy size={12} strokeWidth={2} /> Duplicate
          </MiniButton>
          <MiniButton tone="emerald" onClick={save}>
            <Save size={12} strokeWidth={2} /> {saved ? "Saved" : "Save"}
          </MiniButton>
        </div>
      }
    >
      <p className="mt-4 max-w-[720px] text-[13.5px] leading-relaxed text-muted-foreground/75">
        Define your own triggers, actions, logic and outputs. Whichever tab you author in becomes
        the definition&apos;s kind automatically.
      </p>

      <div className="mt-8 grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* ------------------------------------------------------------ list */}
        <div className="glass h-fit rounded-xl border border-white/[0.06] p-3">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3">
            <Search size={14} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search definitions…"
              className="h-9 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1">
            {grouped.map(([category, list]) => (
              <div key={category}>
                <div className="mono-label mb-1.5">{category}</div>
                <div className="space-y-1.5">
                  {list.map((i) => {
                    const Icon = getIcon(i.icon);
                    return (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => select(i)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all duration-150 ease-in-out",
                          selectedId === i.id
                            ? "border-sapphire/50 bg-sapphire/10"
                            : "border-white/[0.06] bg-raised/25 hover:border-sapphire/30 hover:bg-raised/45",
                        )}
                      >
                        <Icon
                          size={14}
                          strokeWidth={1.7}
                          className="shrink-0"
                          style={{ color: jewelPalette[i.jewel].to }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-foreground">
                            {i.name}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-muted-foreground/60">
                            {i.id}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {i.system && <Tag>SYS</Tag>}
                          <Tag tone={kindTone[i.kind]}>{i.kind}</Tag>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {!grouped.length && (
              <p className="px-1 py-6 text-center font-mono text-[12px] text-muted-foreground/50">
                Nothing here yet — create a {kindLabel}.
              </p>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------- editor */}
        {draft ? (
          <div className="glass space-y-5 rounded-xl border border-white/[0.06] p-5">
            <div className="flex flex-wrap gap-1.5 border-b border-white/[0.06] pb-4">
              {(
                [
                  ["identity", "Identity"],
                  ["schema", `Schema · ${draft.params.length + draft.outputs.length}`],
                  ["runtime", "Runtime & bindings"],
                  ["policy", "Execution policy"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setEditorTab(id)}
                  className={cn(
                    "rounded-lg border px-3 py-[6px] font-mono text-[12px] transition-all duration-150 ease-in-out",
                    editorTab === id
                      ? "border-sapphire/45 bg-sapphire/10 text-foreground shadow-[0_0_18px_-8px_var(--sapphire)]"
                      : "border-white/[0.06] bg-raised/25 text-muted-foreground/75 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {editorTab === "identity" && (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="ID" hint="Auto-derived from the name when left empty.">
                    <input
                      value={draft.id}
                      onChange={(e) => patch({ id: e.target.value })}
                      placeholder={slugify(draft.name, draft.kind)}
                      disabled={true}
                      className={cn(mono, "disabled:opacity-50")}
                    />
                  </Field>
                  <Field label="Kind" hint="Preset by the active header tab.">
                    <select
                      value={draft.kind}
                      onChange={(e) => patch({ kind: e.target.value as ForgeKind })}
                      className={input}
                    >
                      {forgeKinds.map((k) => (
                        <option key={k.id} value={k.id} className="bg-panel">
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Name">
                    <input
                      value={draft.name}
                      onChange={(e) => patch({ name: e.target.value })}
                      className={input}
                    />
                  </Field>
                  <Field label="Category">
                    <input
                      value={draft.category}
                      onChange={(e) => patch({ category: e.target.value })}
                      className={input}
                    />
                  </Field>
                  <Field label="Provider">
                    <input
                      value={draft.provider}
                      onChange={(e) => patch({ provider: e.target.value })}
                      className={mono}
                    />
                  </Field>
                  <Field
                    label="Priority"
                    hint="1 = low · 10 = critical. Sort key for picker + approval queue."
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={draft.priority}
                        onChange={(e) => patch({ priority: Number(e.target.value) })}
                        className="h-1 flex-1 accent-[var(--topaz)]"
                      />
                      <span className="font-mono text-[12px] text-topaz">P{draft.priority}</span>
                    </div>
                  </Field>
                </div>

                <Field label="Icon (lucide name)">
                  <IconPicker
                    value={draft.icon}
                    jewel={draft.jewel}
                    onSelect={(name) => patch({ icon: name })}
                    height={200}
                  />
                </Field>

                <Field label="Color">
                  <JewelSwatches value={draft.jewel} onChange={(j) => patch({ jewel: j })} />
                </Field>

                <Field label="Description">
                  <textarea
                    rows={3}
                    value={draft.description}
                    onChange={(e) => patch({ description: e.target.value })}
                    className={cn(input, "resize-y")}
                  />
                </Field>
                
                {/* ACCESS BLOCK */}
                <div className="pt-2">
                  <div className="mono-label mb-2">ACCESS</div>
                  <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
                    <p className="mb-4 text-[12.5px] text-muted-foreground/80">
                      Tools you author stay private to your desk until you widen the band.
                    </p>
                    <ShareControl 
                      record={{ visibility: draft.visibility, sharedWith: draft.sharedWith }} 
                      disabled={draft.system}
                      onChange={(patchData) => {
                        patch({ 
                          visibility: patchData.visibility ?? draft.visibility,
                          sharedWith: patchData.sharedWith ?? draft.sharedWith 
                        });
                      }} 
                    />
                  </div>
                </div>
              </div>
            )}

            {/* input parameters */}
            {editorTab === "schema" && (
              <div className="space-y-5">
                <Section
                  label="Input parameters"
                  action={
                    <MiniButton
                      onClick={() =>
                        patch({
                          params: [
                            ...draft.params,
                            {
                              id: `p.${Math.random().toString(36).slice(2, 7)}`,
                              key: "",
                              label: "",
                              type: "string",
                              value: "",
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={12} strokeWidth={2} /> Field
                    </MiniButton>
                  }
                >
                  <div className="space-y-2">
                    {draft.params.map((p, idx) => (
                      <div key={p.id} className="flex flex-wrap items-center gap-2">
                        <input
                          value={p.key}
                          placeholder="key"
                          onChange={(e) =>
                            patch({
                              params: draft.params.map((x) =>
                                x.id === p.id ? { ...x, key: e.target.value } : x,
                              ),
                            })
                          }
                          className={cn(mono, "w-[150px]")}
                        />
                        <input
                          value={p.label}
                          placeholder="Label"
                          onChange={(e) =>
                            patch({
                              params: draft.params.map((x) =>
                                x.id === p.id ? { ...x, label: e.target.value } : x,
                              ),
                            })
                          }
                          className={cn(input, "w-[170px]")}
                        />
                        <select
                          value={p.type}
                          onChange={(e) =>
                            patch({
                              params: draft.params.map((x) =>
                                x.id === p.id ? { ...x, type: e.target.value } : x,
                              ),
                            })
                          }
                          className={cn(mono, "w-[130px]")}
                        >
                          {forgeParamTypes.map((t) => (
                            <option key={t} value={t} className="bg-panel">
                              {t}
                            </option>
                          ))}
                        </select>
                        <input
                          value={p.value}
                          placeholder="default"
                          onChange={(e) =>
                            patch({
                              params: draft.params.map((x) =>
                                x.id === p.id ? { ...x, value: e.target.value } : x,
                              ),
                            })
                          }
                          className={cn(mono, "w-[130px]")}
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Move up"
                            onClick={() => {
                              if (idx === 0) return;
                              const next = [...draft.params];
                              [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
                              patch({ params: next });
                            }}
                            className="text-muted-foreground/60 transition-colors hover:text-sapphire"
                            title="Move up"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label="Move down"
                            onClick={() => {
                              if (idx === draft.params.length - 1) return;
                              const next = [...draft.params];
                              [next[idx + 1], next[idx]] = [next[idx]!, next[idx + 1]!];
                              patch({ params: next });
                            }}
                            className="text-muted-foreground/60 transition-colors hover:text-sapphire"
                            title="Move down"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label="Remove field"
                            onClick={() =>
                              patch({ params: draft.params.filter((x) => x.id !== p.id) })
                            }
                            className="text-ruby/70 transition-colors hover:text-ruby"
                            title="Remove field"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {!draft.params.length && (
                      <span className="font-mono text-[11.5px] text-muted-foreground/50">
                        No input parameters.
                      </span>
                    )}
                  </div>
                </Section>

                {/* outputs */}
                <Section
                  label="Outputs (downstream ctx)"
                  action={
                    <MiniButton
                      onClick={() =>
                        patch({
                          outputs: [
                            ...draft.outputs,
                            {
                              id: `o.${Math.random().toString(36).slice(2, 7)}`,
                              key: "",
                              label: "",
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={12} strokeWidth={2} /> Output
                    </MiniButton>
                  }
                >
                  <div className="space-y-2">
                    {draft.outputs.map((o) => (
                      <div key={o.id} className="flex items-center gap-2">
                        <input
                          value={o.key}
                          placeholder="key"
                          onChange={(e) =>
                            patch({
                              outputs: draft.outputs.map((x) =>
                                x.id === o.id ? { ...x, key: e.target.value } : x,
                              ),
                            })
                          }
                          className={cn(mono, "flex-1")}
                        />
                        <input
                          value={o.label}
                          placeholder="Label"
                          onChange={(e) =>
                            patch({
                              outputs: draft.outputs.map((x) =>
                                x.id === o.id ? { ...x, label: e.target.value } : x,
                              ),
                            })
                          }
                          className={cn(input, "flex-1")}
                        />
                        <button
                          type="button"
                          aria-label="Remove output"
                          onClick={() =>
                            patch({ outputs: draft.outputs.filter((x) => x.id !== o.id) })
                          }
                          className="text-ruby/70 transition-colors hover:text-ruby"
                          title="Remove output"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    {!draft.outputs.length && (
                      <span className="font-mono text-[11.5px] text-muted-foreground/50">
                        No outputs declared.
                      </span>
                    )}
                  </div>
                </Section>
              </div>
            )}

            {/* runtime */}
            {editorTab === "runtime" && (
              <div className="space-y-5">
                <Section label="Runtime">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Brain (model or provider)"
                      hint="Optional — falls back to caller's brain."
                    >
                      <select
                        value={!draft.brainModelId ? "" : draft.brainModelId}
                        onChange={(e) => patch({ brainModelId: e.target.value })}
                        className={cn(
                          input, 
                          "font-mono", 
                          !draft.brainModelId && "text-[#00ffaa] border-[#00ffaa]/30 shadow-[0_0_15px_-5px_#00ffaa]/20"
                        )}
                      >
                        <option value="" className="bg-panel font-bold tracking-wider" style={{ color: '#00ffaa' }}>
                          ✦ Use System Default
                        </option>
                        {models.map((m) => (
                          <option key={m.id} value={m.id} className="bg-panel text-foreground">
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Interpreter (Python)" hint="Used only when handler is python.">
                      <select
                        value={draft.interpreterId}
                        onChange={(e) => patch({ interpreterId: e.target.value })}
                        className={input}
                      >
                        <option value="" className="bg-panel">
                          Select interpreter…
                        </option>
                        {runtimes.map((r) => (
                          <option key={r.id} value={r.id} className="bg-panel">
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Handler">
                      <select
                        value={draft.handler}
                        onChange={(e) => patch({ handler: e.target.value as ForgeItem["handler"] })}
                        className={input}
                      >
                        {forgeHandlers.map((h) => (
                          <option key={h.id} value={h.id} className="bg-panel">
                            {h.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label="Script path (from disk roots)"
                      hint="Runs via the disk runner — the script's own cwd is used."
                    >
                      <select
                        value={draft.scriptPath}
                        onChange={(e) => patch({ scriptPath: e.target.value })}
                        className={cn(input, "font-mono")}
                      >
                        <option value="" className="bg-panel italic text-muted-foreground">
                          Select a python file...
                        </option>
                        {localScripts.map(sc => (
                          <option key={sc.path} value={sc.path} className="bg-panel">
                            {sc.relPath}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </Section>

                <PickerRow
                  label="Adapters"
                  catalog={dynamicAdapterCatalog}
                  selected={draft.adapters}
                  onChange={(next) => patch({ adapters: next })}
                  empty="No adapters bound · definition runs standalone."
                />
                <PickerRow
                  label="Targets"
                  catalog={dynamicTargetCatalog}
                  selected={draft.targets}
                  onChange={(next) => patch({ targets: next })}
                  empty="No targets bound."
                />
              </div>
            )}

            {/* execution policy */}
            {editorTab === "policy" && (
              <div className="space-y-5">
                <Section
                  label="Execution policy"
                  action={
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground/70">
                        Enforce strict
                      </span>
                      <Toggle
                        on={draft.enforceStrict}
                        onToggle={() => patch({ enforceStrict: !draft.enforceStrict })}
                        label="Enforce strict"
                      />
                    </div>
                  }
                >
                  <div className="space-y-4">
                    <div>
                      <span className="mono-label mb-2 block">Override temperature</span>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {(
                          [
                            ["off", "Off"],
                            ["zero", "Force-Zero (0.0)"],
                            ["safe-low", "Safe-Low (0.01)"],
                            ["custom", "Custom"],
                          ] as [ForgeTempOverride, string][]
                        ).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => patch({ tempOverride: id })}
                            className={cn(
                              "rounded-lg border py-1.5 font-mono text-[11.5px] transition-all duration-150 ease-in-out",
                              draft.tempOverride === id
                                ? "border-sapphire/50 bg-sapphire/15 text-foreground shadow-[0_0_18px_-8px_var(--sapphire)]"
                                : "border-white/[0.07] bg-raised/30 text-muted-foreground/80 hover:text-foreground",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {draft.tempOverride === "custom" && (
                        <input
                          type="number"
                          step="0.05"
                          value={draft.tempCustom}
                          onChange={(e) => patch({ tempCustom: Number(e.target.value) })}
                          className={cn(mono, "mt-2 w-[140px]")}
                        />
                      )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Retry count">
                        <input
                          type="number"
                          min={0}
                          value={draft.retryCount}
                          onChange={(e) => patch({ retryCount: Number(e.target.value) })}
                          className={mono}
                        />
                      </Field>
                      <Field label="Timeout (ms)">
                        <input
                          type="number"
                          min={100}
                          step={100}
                          value={draft.timeoutMs}
                          onChange={(e) => patch({ timeoutMs: Number(e.target.value) })}
                          className={mono}
                        />
                      </Field>
                    </div>

                    <Field label="Output format enforcer">
                      <select
                        value={draft.outputFormat}
                        onChange={(e) =>
                          patch({ outputFormat: e.target.value as ForgeItem["outputFormat"] })
                        }
                        className={input}
                      >
                        {forgeOutputFormats.map((f) => (
                          <option key={f.id} value={f.id} className="bg-panel">
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Section
                      label="Custom params (override agent)"
                      action={
                        <MiniButton
                          onClick={() =>
                            patch({
                              customParams: [
                                ...draft.customParams,
                                {
                                  id: `c.${Math.random().toString(36).slice(2, 7)}`,
                                  key: "",
                                  value: "",
                                },
                              ],
                            })
                          }
                        >
                          <Plus size={12} strokeWidth={2} /> Add
                        </MiniButton>
                      }
                    >
                      <div className="space-y-2">
                        {draft.customParams.map((c) => (
                          <div key={c.id} className="flex items-center gap-2">
                            <input
                              value={c.key}
                              placeholder="top_k"
                              onChange={(e) =>
                                patch({
                                  customParams: draft.customParams.map((x) =>
                                    x.id === c.id ? { ...x, key: e.target.value } : x,
                                  ),
                                })
                              }
                              className={cn(mono, "flex-1")}
                            />
                            <input
                              value={c.value}
                              placeholder="40"
                              onChange={(e) =>
                                patch({
                                  customParams: draft.customParams.map((x) =>
                                    x.id === c.id ? { ...x, value: e.target.value } : x,
                                  ),
                                })
                              }
                              className={cn(mono, "flex-1")}
                            />
                            <button
                              type="button"
                              aria-label="Remove param"
                              onClick={() =>
                                patch({
                                  customParams: draft.customParams.filter((x) => x.id !== c.id),
                                })
                              }
                              className="text-ruby/70 transition-colors hover:text-ruby"
                              title="Remove param"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                        {!draft.customParams.length && (
                          <span className="font-mono text-[11.5px] text-muted-foreground/50">
                            e.g. top_k=40, repetition_penalty=1.1, mirostat_eta=0.1
                          </span>
                        )}
                      </div>
                    </Section>
                  </div>
                </Section>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
              <button
                type="button"
                disabled={creating || !selectedId}
                onClick={async () => {
                  if (!selectedId) return;
                  const ok = await confirmAction({
                    title: `Delete ${draft?.name || "this definition"}?`,
                    body: draft?.system
                      ? "This is a system definition. Deleting it requires an admin override and places a tombstone so it won't respawn on boot."
                      : "This definition will be permanently removed from the Forge.",
                    confirmLabel: "Delete",
                    tone: "ruby",
                  });
                  if (!ok) return;
                  remove(selectedId);
                  setSelectedId(null);
                  setDraft(null);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-ruby/40 bg-ruby/10 px-3 py-[7px] font-mono text-[12px] text-ruby transition-colors hover:bg-ruby/20 disabled:opacity-40"
              >
                <Trash2 size={12} strokeWidth={1.9} /> Delete
              </button>
              <button
                type="button"
                onClick={save}
                className="flex items-center gap-2 rounded-lg border border-emerald/50 bg-emerald/15 px-4 py-[7px] font-mono text-[12.5px] text-foreground shadow-[0_0_26px_-10px_var(--emerald)] transition-colors hover:bg-emerald/25"
              >
                <Save size={13} strokeWidth={1.9} /> {saved ? "Saved" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <div className="glass flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-white/[0.1] p-8">
            <button
              type="button"
              onClick={startNew}
              className="flex items-center gap-2 rounded-lg border border-sapphire/45 bg-sapphire/10 px-4 py-2 font-mono text-[12.5px] text-foreground transition-colors hover:bg-sapphire/20"
            >
              <Plus size={13} strokeWidth={2} /> New {kindLabel}
            </button>
          </div>
        )}
      </div>
    </Surface>
  );
}
