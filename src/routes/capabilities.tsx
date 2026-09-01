import { useCallback, useMemo, useState } from "react";
import { canEdit as canEditOwned, editRefusal } from "@/lib/ownership";
import { OwnerChip, ShareControl } from "@/components/sovereign/ownership-controls";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Copy, Layers, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, Tag } from "@/components/sovereign/primitives";
import { IconPicker, JewelSwatches } from "@/components/sovereign/identity";
import { getIcon } from "@/lib/icon-library";
import { jewelPalette } from "@/lib/avatar-library";
import {
  capabilitySectors,
  emptyPack,
  slugifyPack,
  useCapabilities,
  useCapabilitySquads,
  type CapabilityPack,
} from "@/lib/capability-store";
import { useForge } from "@/lib/forge-store";
import { useSkills } from "@/lib/skill-store";
import { useModels } from "@/lib/model-store";
import { useRuntimes } from "@/lib/runtime-store";
import { useMcp } from "@/lib/mcp-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/capabilities")({
  head: () => ({
    meta: [
      { title: "Capabilities — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Capability Registry: sectoral packs binding tools, skills and MCP servers to agents, with brand filters, persona overlays and default brains.",
      },
      { property: "og:title", content: "Capabilities — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Single source of truth for the tools, skills and MCP servers bound to your agents.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CapabilityRegistry,
});

const input =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[13.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";
const area = cn(input, "font-mono text-[12px] leading-relaxed");

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mono-label mb-2 block">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11.5px] text-muted-foreground/60">{hint}</span>}
    </label>
  );
}

type PickItem = { id: string; label: string; tone: string };

/** Dropdown + Add grant picker — same pattern as the Agent editor. */
function GrantPicker({
  title,
  items,
  selected,
  onToggle,
  emptyHint,
}: {
  title: string;
  items: PickItem[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyHint?: string;
}) {
  const available = useMemo(() => items.filter((i) => !selected.includes(i.id)), [items, selected]);
  const [pick, setPick] = useState("");
  const value = available.some((a) => a.id === pick) ? pick : (available[0]?.id ?? "");
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-raised/20 p-4">
      <div className="mono-label mb-2">
        {title} · {selected.length}/{items.length}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value}
          disabled={!available.length}
          onChange={(e) => setPick(e.target.value)}
          className={cn(input, "h-[34px] w-auto min-w-[220px] flex-1 py-1 font-mono text-[12.5px]")}
        >
          {available.length ? (
            available.map((i) => (
              <option key={i.id} value={i.id} className="bg-panel">
                {i.label}
              </option>
            ))
          ) : (
            <option className="bg-panel">
              {items.length ? "all granted" : "nothing available"}
            </option>
          )}
        </select>
        <button
          type="button"
          disabled={!value}
          onClick={() => {
            if (!value) return;
            onToggle(value);
            setPick("");
          }}
          className="flex items-center gap-1.5 rounded-lg border border-sapphire/45 bg-sapphire/10 px-3 py-[6px] font-mono text-[12px] text-foreground shadow-[0_0_20px_-10px_var(--sapphire)] transition-all duration-150 ease-in-out hover:bg-sapphire/20 disabled:opacity-40"
        >
          <Plus size={12} strokeWidth={2} /> Add
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {selected.length ? (
          selected.map((id) => {
            const item = byId.get(id);
            return (
              <span
                key={id}
                className="flex items-center gap-1.5 rounded-lg border border-sapphire/45 bg-sapphire/10 px-2.5 py-1 font-mono text-[11.5px] text-foreground shadow-[0_0_18px_-8px_var(--sapphire)]"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: item?.tone ?? "var(--sapphire)" }}
                />
                {item?.label ?? id}
                <button
                  type="button"
                  onClick={() => onToggle(id)}
                  aria-label={`Remove ${id}`}
                  title={`Remove ${id}`}
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
          <span className="font-mono text-[11.5px] text-muted-foreground/50">nothing granted</span>
        )}
      </div>
      {!items.length && emptyHint && (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground/50">{emptyHint}</p>
      )}
    </div>
  );
}

/** Pack editor — draft state lives here so typing never re-renders the registry. */
function PackEditor({
  initialPack,
  isNew,
  squadNames,
  models,
  runtimes,
  toolItems,
  skillItems,
  mcpItems,
  onClose,
  onSave,
}: {
  initialPack: CapabilityPack;
  isNew: boolean;
  squadNames: string[];
  models: { id: string; name: string }[];
  runtimes: { id: string; name: string }[];
  toolItems: PickItem[];
  skillItems: PickItem[];
  mcpItems: PickItem[];
  onClose: () => void;
  onSave: (pack: CapabilityPack) => void;
}) {
  const [draft, setDraft] = useState<CapabilityPack>(initialPack);
  const patch = useCallback(
    (p: Partial<CapabilityPack>) => setDraft((cur) => ({ ...cur, ...p })),
    [],
  );
  const toggle = useCallback((key: "tools" | "skills" | "mcpServers", id: string) => {
    setDraft((cur) => {
      const list = cur[key];
      return { ...cur, [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] };
    });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 backdrop-blur-sm"
      onClick={() => onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="glass my-6 w-full max-w-[860px] rounded-2xl border border-sapphire/25 p-6"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[17px] font-medium tracking-tight text-foreground">
            {isNew ? "New pack" : "Edit pack"}
          </h2>
          <button
            type="button"
            aria-label="close"
            onClick={() => onClose()}
            className="rounded-md p-1.5 text-muted-foreground/60 hover:bg-white/[0.05] hover:text-foreground"
            title="close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="id (slug)" hint="Auto-generated from the name.">
            <input
              className={cn(input, "font-mono text-[12.5px] cursor-not-allowed opacity-60 bg-black/10")}
              value={isNew ? slugifyPack(draft.name || "new pack") : draft.id}
              readOnly
            />
          </Field>
          <Field label="name">
            <input
              className={input}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field label="sector">
            <select
              className={input}
              value={draft.sector}
              onChange={(e) => patch({ sector: e.target.value })}
            >
              {[...new Set([...capabilitySectors, draft.sector])].map((s) => (
                <option key={s} value={s} className="bg-panel">
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="squad" hint="Header tabs scope the registry to one squad.">
            <select
              className={input}
              value={draft.squad && draft.squad !== "Unassigned" ? draft.squad : (squadNames[0] || "")}
              onChange={(e) => patch({ squad: e.target.value })}
            >
              {[...new Set([...squadNames, draft.squad].filter(s => s && s !== "Unassigned"))].map((s) => (
                <option key={s!} value={s!} className="bg-panel">
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="accent">
            <JewelSwatches
              value={draft.jewel}
              onChange={(j) => patch({ jewel: j })}
              className="pt-1.5"
            />
          </Field>
          <Field label="visibility">
            <ShareControl
              record={draft}
              onChange={(p) => patch(p)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <span className="mono-label mb-2 block">icon</span>
          <IconPicker
            value={draft.icon}
            jewel={draft.jewel}
            height={150}
            onSelect={(name) => patch({ icon: name })}
          />
        </div>

        <div className="mt-4 grid gap-4">
          <Field label="description">
            <textarea
              rows={2}
              className={area}
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>

          <Field
            label={`brand keywords (${draft.brandKeywords.length})`}
            hint="RAG retrieval filter — bound agents are restricted to these brands. Empty = unrestricted."
          >
            <input
              className={cn(input, "font-mono text-[12px]")}
              placeholder="checkpoint, fortigate, palo alto… (comma separated)"
              value={draft.brandKeywords.join(", ")}
              onChange={(e) =>
                patch({
                  brandKeywords: e.target.value
                    .split(",")
                    .map((k) => k.trim().toLowerCase())
                    .filter(Boolean),
                })
              }
            />
          </Field>

          <Field
            label="system prompt overlay"
            hint="Optional sectoral persona. Prepended to the bound agent's own system prompt (pack first, agent last)."
          >
            <textarea
              rows={3}
              className={area}
              value={draft.systemOverlay}
              onChange={(e) => patch({ systemOverlay: e.target.value })}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="default brain"
              hint="Inherited when the bound agent has no brain of its own."
            >
              <select
                className={cn(
                  input, 
                  "font-mono", 
                  (!draft.brainModelId || draft.brainModelId === "system_default") && "text-[#00ffaa] border-[#00ffaa]/30 shadow-[0_0_15px_-5px_#00ffaa]/20"
                )}
                value={(!draft.brainModelId || draft.brainModelId === "system_default") ? "system_default" : draft.brainModelId}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "system_default") patch({ brainModelId: "" }); // or null/system_default
                  else patch({ brainModelId: v });
                }}
              >
                <option value="system_default" className="bg-panel font-bold tracking-wider" style={{ color: '#00ffaa' }}>
                  ✦ Use System Default
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.id} className="bg-panel text-foreground">
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="default interpreter (python)" hint="Leave blank to skip.">
              <select
                className={input}
                value={draft.interpreterId}
                onChange={(e) => patch({ interpreterId: e.target.value })}
              >
                <option value="" className="bg-panel">
                  Select runtime…
                </option>
                {runtimes.map((r) => (
                  <option key={r.id} value={r.id} className="bg-panel">
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <GrantPicker
            title="tools"
            items={toolItems}
            selected={draft.tools}
            onToggle={(id: string) => toggle("tools", id)}
          />
          <GrantPicker
            title="skills"
            items={skillItems}
            selected={draft.skills}
            onToggle={(id: string) => toggle("skills", id)}
          />
          <GrantPicker
            title="mcp clients"
            items={mcpItems}
            selected={draft.mcpServers}
            onToggle={(id: string) => toggle("mcpServers", id)}
            emptyHint="no mcp clients registered — add them in MCP · Client"
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <JewelButton variant="ghost" size="sm" onClick={() => onClose()}>
            Cancel
          </JewelButton>
          <JewelButton size="sm" onClick={() => onSave(draft)} disabled={!draft.name.trim()}>
            Save
          </JewelButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CapabilityRegistry() {
  const { packs, ctx, create, update, remove, duplicate } = useCapabilities();
  const { items: forgeItems } = useForge();
  const { skills } = useSkills();
  const { models } = useModels();
  const { runtimes } = useRuntimes();
  const { clients } = useMcp();
  const { squads, active } = useCapabilitySquads();
  const activeSquad = squads.find((s) => s.id === active);
  const squadNames = squads.map((s) => s.name);

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CapabilityPack | null>(null);
  const [isNew, setIsNew] = useState(false);

  const toolItems: PickItem[] = useMemo(
    () =>
      forgeItems.map((t) => ({
        id: t.id,
        label: `${t.category} · ${t.name}${t.system ? " · SYS" : ""}`,
        tone: (jewelPalette[t.jewel as keyof typeof jewelPalette] || jewelPalette.sapphire).to,
      })),
    [forgeItems],
  );

  const skillItems: PickItem[] = useMemo(
    () =>
      skills.map((s) => ({
        id: s.id,
        label: `${s.name}`,
        tone: (jewelPalette[(s.jewel ?? "sapphire") as keyof typeof jewelPalette] || jewelPalette.sapphire).to,
      })),
    [skills],
  );

  const mcpItems: PickItem[] = useMemo(
    () =>
      clients.map((c) => ({
        id: c.id,
        label: `${c.name || c.id} · ${c.transport}${c.enabled ? "" : " · off"}`,
        tone: c.status === "error" ? jewelPalette.ruby.to : jewelPalette.emerald.to,
      })),
    [clients],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return packs.filter(
      (p) =>
        (!activeSquad || p.squad === activeSquad.name) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.sector.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)),
    );
  }, [packs, query, activeSquad]);

  const grouped = useMemo(() => {
    const map = new Map<string, CapabilityPack[]>();
    for (const p of filtered) map.set(p.sector, [...(map.get(p.sector) ?? []), p]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function openNew() {
    setIsNew(true);
    setEditing({
      ...emptyPack,
      id: "",
      squad: activeSquad?.name ?? "Unassigned",
      createdAt: Date.now(),
    } as CapabilityPack);
  }

  function save(pack: CapabilityPack) {
    const id = pack.id || slugifyPack(pack.name);
    if (isNew) create({ ...pack, id });
    else update(pack.id, pack);
    setEditing(null);
    setIsNew(false);
  }

  return (
    <Surface
      title="Capabilities"
      meta={`capability registry · ${activeSquad ? activeSquad.name.toLowerCase() + " squad" : "all squads"} · ${filtered.length} packs`}
      wide
      action={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search packs…"
              className={cn(input, "w-[220px] py-1.5 pl-9 font-mono text-[12px]")}
            />
          </div>
          <JewelButton size="sm" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> New pack
          </JewelButton>
        </div>
      }
    >
      <div className="space-y-10">
        {grouped.length === 0 && (
          <p className="font-mono text-[12px] text-muted-foreground/50">no packs match</p>
        )}
        {grouped.map(([sector, list]) => (
          <section key={sector}>
            <div className="mono-label mb-3">{sector}</div>
            <div className="grid gap-3 lg:grid-cols-2">
              {list.map((p) => {
                const Icon = getIcon(p.icon) ?? Layers;
                const pal = jewelPalette[p.jewel as keyof typeof jewelPalette] || jewelPalette.sapphire;
                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                    className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015] px-4 py-3.5 transition-colors hover:border-white/[0.13]"
                  >
                    <div
                      className="pointer-events-none absolute -left-10 -top-10 h-24 w-24 rounded-full opacity-30 blur-3xl"
                      style={{ background: pal.to }}
                    />
                    <div className="relative flex items-start gap-3">
                      <span
                        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border"
                        style={{
                          borderColor: `${pal.to}55`,
                          background: `linear-gradient(140deg, ${pal.from}33, ${pal.to}18)`,
                          color: pal.ink,
                        }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] text-foreground/95">{p.name}</span>
                          {p.system && <Tag tone="platinum">SYS</Tag>}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Tag tone="sapphire">{p.tools?.length || 0} tools</Tag>
                          <Tag tone="amethyst">{p.skills?.length || 0} skills</Tag>
                          <Tag tone="emerald">{p.mcpServers?.length || 0} mcp</Tag>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground/75">
                          {p.description || "No description."}
                        </p>
                        <div className="mt-1.5 font-mono text-[10.5px] text-muted-foreground/40">
                          {p.id}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label="duplicate pack"
                          onClick={() => duplicate(p.id)}
                          className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-white/[0.05] hover:text-foreground"
                          title="duplicate pack"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="edit pack"
                          onClick={() => {
                            setIsNew(false);
                            setEditing(p);
                          }}
                          className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-white/[0.05] hover:text-foreground"
                          title="edit pack"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <OwnerChip
                          record={p}
                          ctx={ctx}
                        />
                        <button
                          type="button"
                          aria-label="delete pack"
                          disabled={!canEditOwned(p, ctx)}
                          title={editRefusal(p, ctx)}
                          onClick={async () => {
                            const ok = await confirmAction({
                              title: "Delete this pack?",
                              body: `Are you sure you want to permanently delete capability pack "${p.name}"? Active agents bound to this pack will lose their grants.`,
                              confirmLabel: "Delete",
                              tone: "ruby",
                            });
                            if (ok) remove(p.id);
                          }}
                          className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-ruby/10 hover:text-ruby disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <AnimatePresence>
        {editing && (
          <PackEditor
            key={editing.id || "new"}
            initialPack={editing}
            isNew={isNew}
            squadNames={squadNames}
            models={models}
            runtimes={runtimes}
            toolItems={toolItems}
            skillItems={skillItems}
            mcpItems={mcpItems}
            onClose={() => setEditing(null)}
            onSave={save}
          />
        )}
      </AnimatePresence>
    </Surface>
  );
}
