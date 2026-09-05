import { useEffect, useMemo, useState } from "react";
import { useMcp } from "@/lib/mcp-store";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, Sheen, StatusDot, Tag } from "@/components/sovereign/primitives";
import { EntityAvatar, IconPicker, JewelSwatches } from "@/components/sovereign/identity";
import { getIcon } from "@/lib/icon-library";
import { jewelPalette } from "@/lib/avatar-library";
import {
  emptyAgent,
  useAgents,
  useSquads,
  type AgentRun,
  type StudioAgent,
} from "@/lib/agent-store";
import { useKnowledge } from "@/lib/knowledge-store";
import { useCapabilities } from "@/lib/capability-store";
import { useSkills } from "@/lib/skill-store";
import { useAdapters } from "@/lib/adapter-store";
import { useTargets } from "@/lib/target-store";
import { useForge } from "@/lib/forge-store";
import { resolveAliases } from "@/lib/rag-keywords";
import { isDestructiveTool } from "@/lib/rag-agent";
import { useSpaces } from "@/lib/knowledge-space-store";
import { canEdit as canEditOwned, editRefusal, useOwnerCtx, type Owned } from "@/lib/ownership";
import { OwnerChip, ReadOnlyBanner, ShareControl } from "@/components/sovereign/ownership-controls";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { useModels } from "@/lib/model-store";
import { useRuntimes } from "@/lib/runtime-store";
import { cn, fmtDateTime } from "@/lib/utils";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "Agent Orchestrator — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Provision, supervise and retire autonomous agents. Every agent carries a signed identity, a scoped toolset, tuned inference parameters and its own escalation path.",
      },
      { property: "og:title", content: "Agent Orchestrator — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Local bridge, live agent registry and per-agent identity for the Elara Sovereign fleet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgentOrchestrator,
});

const input =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[13.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";
const mono = "font-mono text-[12.5px]";

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

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-raised/25 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mono-label">{label}</div>
          {hint && (
            <div className="mt-1 font-mono text-[11px] text-muted-foreground/55">{hint}</div>
          )}
        </div>
        <input
          value={Number.isFinite(value) && value % 1 !== 0 ? Number(value).toFixed(2) : value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-24 rounded-lg border border-white/[0.08] bg-canvas/60 px-2 py-1 text-right font-mono text-[12.5px] text-sapphire outline-none focus:border-sapphire/50"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ accentColor: "var(--sapphire)" }}
        className="mt-3 h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10"
      />
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-1 font-mono text-[11.5px] transition-all duration-150 ease-in-out",
        active
          ? "border-sapphire/50 bg-sapphire/10 text-foreground shadow-[0_0_18px_-8px_var(--sapphire)]"
          : "border-white/[0.07] bg-raised/30 text-muted-foreground/80 hover:border-sapphire/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Dropdown + Add picker — keeps long catalogs out of the editor until they're granted. */
/** MCP grants — catalog comes from the MCP workspace's client servers. */
function McpPickerRow({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { clients } = useMcp();
  const catalog = clients.map((c) => c.name || c.id);

  return (
    <div>
      <PickerRow label="mcp clients" catalog={catalog} selected={selected} onChange={onChange} />
      {!catalog.length && (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground/50">
          no mcp clients registered — add them in MCP · Client
        </p>
      )}
    </div>
  );
}

type PickerItem = string | { id: string; label: string };

function PickerRow({
  label,
  catalog,
  selected,
  onChange,
}: {
  label: string;
  catalog: readonly PickerItem[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const normId = (c: PickerItem) => (typeof c === "string" ? c : c.id);
  const normLabel = (c: PickerItem) => (typeof c === "string" ? c : c.label);

  const available = catalog.filter((c) => !selected.includes(normId(c)));
  const [pick, setPick] = useState("");
  const value = available.find((c) => normId(c) === pick)
    ? pick
    : available.length && available[0]
      ? normId(available[0])
      : "";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-raised/20 p-4">
      <div className="mono-label mb-2">
        {label} · {selected.length}/{catalog.length}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value}
          disabled={!available.length}
          onChange={(e) => setPick(e.target.value)}
          className={cn(input, "h-[34px] w-auto min-w-[220px] flex-1 py-1 font-mono text-[12.5px]")}
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
          className="flex items-center gap-1.5 rounded-lg border border-sapphire/45 bg-sapphire/10 px-3 py-[6px] font-mono text-[12px] text-foreground shadow-[0_0_20px_-10px_var(--sapphire)] transition-all duration-150 ease-in-out hover:bg-sapphire/20 disabled:opacity-40"
        >
          <Plus size={12} strokeWidth={2} /> Add
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {selected.length ? (
          selected.map((s) => {
            const item = catalog.find((c) => normId(c) === s);
            const displayLabel = item ? normLabel(item) : s;
            return (
              <span
                key={s}
                className="group flex items-center gap-1.5 rounded-lg border border-sapphire/45 bg-sapphire/10 px-2.5 py-1 font-mono text-[11.5px] text-foreground shadow-[0_0_18px_-8px_var(--sapphire)]"
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
          <span className="font-mono text-[11.5px] text-muted-foreground/50">nothing granted</span>
        )}
      </div>
    </div>
  );
}

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2"
      aria-pressed={on}
      aria-label={label ?? "toggle"}
      title={label ?? "toggle"}
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
      <span
        className={cn("font-mono text-[11px]", on ? "text-emerald" : "text-muted-foreground/60")}
      >
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ roster */

function RosterList({
  agents,
  activeId,
  onSelect,
  onDelete,
  flat,
}: {
  agents: StudioAgent[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  flat?: boolean | undefined;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /* Ownership decides whether a row may be destroyed from this desk. */
  const ownerCtx = useOwnerCtx();

  const groups = useMemo(() => {
    const filtered = agents.filter((a) =>
      `${a.name} ${a.squad} ${a.modelId}`.toLowerCase().includes(query.toLowerCase()),
    );
    if (flat) return filtered.length ? ([["", filtered]] as [string, StudioAgent[]][]) : [];
    const map = new Map<string, StudioAgent[]>();
    filtered.forEach((a) => map.set(a.squad, [...(map.get(a.squad) ?? []), a]));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [agents, query, flat]);

  return (
    <div className="glass rounded-xl p-3">
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3">
        <Search size={14} className="text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter roster…"
          className="h-9 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      <div className="mt-3 max-h-[62vh] space-y-3 overflow-y-auto pr-1">
        {groups.map(([squad, list]) => {
          const open = !collapsed[squad];
          const live = list.filter((a) => a.live).length;
          return (
            <div key={squad}>
              <button
                onClick={() => setCollapsed((p) => ({ ...p, [squad]: open }))}
                className={cn(
                  "flex w-full items-center justify-between px-1 py-1.5 text-left",
                  !squad && "hidden",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <motion.span
                    animate={{ rotate: open ? 0 : -90 }}
                    transition={{ duration: 0.16, ease: "easeInOut" }}
                  >
                    <ChevronDown size={13} className="text-muted-foreground/60" />
                  </motion.span>
                  <span className="mono-label">{squad}</span>
                </span>
                <span className="font-mono text-[10.5px] text-muted-foreground/50">
                  {live}/{list.length} live
                </span>
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-1 pt-1">
                      {list.map((a) => {
                        const Icon = getIcon(a.icon);
                        const active = a.id === activeId;
                        return (
                          <div
                            key={a.id}
                            onClick={() => onSelect(a.id)}
                            className={cn(
                              "group flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-all duration-150 ease-in-out",
                              active
                                ? "border-sapphire/45 bg-sapphire/[0.07] shadow-[0_0_28px_-18px_var(--sapphire)]"
                                : "border-transparent hover:border-white/[0.08] hover:bg-raised/40",
                            )}
                          >
                            <Icon
                              size={15}
                              strokeWidth={1.6}
                              style={{
                                color: jewelPalette[a.avatar.jewel].to,
                                opacity: active ? 1 : 0.75,
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13.5px] text-foreground/95">
                                {a.name}
                              </div>
                              <div className="truncate font-mono text-[10.5px] text-muted-foreground/55">
                                {a.provider} · {a.modelId}
                              </div>
                            </div>
                            <OwnerChip record={a} ctx={ownerCtx} className="shrink-0" />
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!canEditOwned(a, ownerCtx)) return;
                                const ok = await confirmAction({
                                  title: `Delete ${a.name}?`,
                                  body: "This agent will be permanently removed from the registry. Existing threads might lose context.",
                                  confirmLabel: "Delete",
                                  tone: "ruby",
                                });
                                if (ok) onDelete(a.id);
                              }}
                              disabled={!canEditOwned(a, ownerCtx)}
                              title={editRefusal(a, ownerCtx) || `Delete ${a.name}`}
                              className="opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20"
                              aria-label={`Delete ${a.name}`}
                            >
                              <Trash2 size={13} className="text-ruby/70 hover:text-ruby" />
                            </button>
                            <StatusDot tone={a.live ? "emerald" : "ruby"} pulse={a.live} />
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {groups.length === 0 && (
          <div className="px-2 py-6 text-center font-mono text-[12px] text-muted-foreground/50">
            no agents match
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

function AgentDetail({
  agent,
  onEdit,
  onUpdate,
  onDispatch,
}: {
  agent: StudioAgent;
  onEdit: () => void;
  onUpdate: (patch: Partial<StudioAgent>) => void;
  onDispatch: () => void;
}) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState(agent.systemPrompt);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setPrompt(agent.systemPrompt);
    setDirty(false);
  }, [agent.id, agent.systemPrompt]);

  const Icon = getIcon(agent.icon);

  return (
    <motion.div
      key={agent.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="glass rounded-xl p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <EntityAvatar
            seed={agent.avatar.seed}
            label={agent.name}
            style={agent.avatar.style}
            jewel={agent.avatar.jewel}
            size={46}
          />
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[19px] font-medium tracking-tight text-foreground">
              <Icon
                size={17}
                strokeWidth={1.6}
                style={{ color: jewelPalette[agent.avatar.jewel].to }}
              />
              {agent.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Tag tone="sapphire">{agent.provider}</Tag>
              <Tag tone="emerald">{agent.modelId}</Tag>
              {agent.bridgeHost ? (
                <Tag tone="topaz">
                  {agent.bridgeHost}:{agent.port || "3005"}
                  {agent.healthEndpoint || "/api/health"}
                </Tag>
              ) : (
                <Tag tone="topaz">:</Tag>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <JewelButton size="sm" variant="outline" onClick={onDispatch} className="gap-1.5">
            <Play size={13} strokeWidth={1.7} /> Dispatch
          </JewelButton>
          <JewelButton size="sm" variant="outline" onClick={onEdit} className="gap-1.5">
            <Pencil size={13} strokeWidth={1.7} /> Edit
          </JewelButton>
          <JewelButton size="sm" onClick={() => navigate({ to: "/" })} className="gap-1.5">
            <MessageSquare size={13} strokeWidth={1.7} /> Send to chat
          </JewelButton>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-emerald/20 bg-emerald/[0.05] p-4">
        <div className="mono-label mb-1.5">stdout · description</div>
        <p className={cn(mono, "leading-relaxed text-emerald/85")}>
          {agent.description || "No description set for this agent."}
        </p>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <span className="mono-label">agent role (system prompt)</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setPrompt(agent.systemPrompt);
              setDirty(false);
            }}
            className="flex items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <RotateCcw size={12} /> Reset
          </button>
          <button
            onClick={() => {
              onUpdate({ systemPrompt: prompt });
              setDirty(false);
            }}
            className={cn(
              "rounded-md border px-2.5 py-1 font-mono text-[11.5px] transition-colors",
              dirty
                ? "border-sapphire/45 bg-sapphire/10 text-sapphire"
                : "border-white/[0.07] text-muted-foreground/50",
            )}
          >
            {dirty ? "Save" : "Saved"}
          </button>
        </div>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          setDirty(true);
        }}
        rows={7}
        className={cn(input, "mt-2 resize-y font-mono text-[12.5px] leading-relaxed")}
      />

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Slider
          label="temperature"
          hint="0 = deterministic · 1 = creative"
          value={agent.temperature}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onUpdate({ temperature: v })}
        />
        <Slider
          label="top-p"
          hint="nucleus sampling focus"
          value={agent.topP}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onUpdate({ topP: v })}
        />
        <Slider
          label="repetition penalty"
          hint="higher values reduce looped phrases"
          value={agent.repetitionPenalty}
          min={1}
          max={2}
          step={0.05}
          onChange={(v) => onUpdate({ repetitionPenalty: v })}
        />
        <Slider
          label="max output tokens"
          hint="cap on response length"
          value={agent.maxTokens}
          min={256}
          max={16384}
          step={256}
          onChange={(v) => onUpdate({ maxTokens: v })}
        />
      </div>

      <Sheen className="my-6" />

      <div className="mono-label mb-3">live stats · from bridge</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { k: "calls", v: String(agent.stats.calls), tone: "sapphire" },
          { k: "success", v: `${agent.stats.success}%`, tone: "emerald" },
          {
            k: "latency",
            v: agent.stats.latencyMs ? `${agent.stats.latencyMs}ms` : "—",
            tone: "topaz",
          },
          { k: "status", v: agent.live ? "active" : "idle", tone: agent.live ? "emerald" : "ruby" },
        ].map((s) => (
          <div
            key={s.k}
            className="rounded-xl border border-white/[0.06] bg-raised/25 p-4 text-center"
          >
            <div className="mono-label">{s.k}</div>
            <div className="mt-2 font-mono text-[17px]" style={{ color: `var(--${s.tone})` }}>
              {s.v}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-raised/25 p-4">
          <div className="mono-label mb-2">capability packs · {(agent.packs || []).length}</div>
          <div className="flex flex-wrap gap-1.5">
            {(agent.packs || []).length ? (
              (agent.packs || []).map((p) => <Chip key={p}>{p}</Chip>)
            ) : (
              <span className="font-mono text-[11.5px] text-muted-foreground/50">
                no packs granted
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-raised/25 p-4">
          <div className="mono-label mb-2">skills · {(agent.skills || []).length}</div>
          <div className="flex flex-wrap gap-1.5">
            {(agent.skills || []).length ? (
              (agent.skills || []).map((s) => <Chip key={s}>{s}</Chip>)
            ) : (
              <span className="font-mono text-[11.5px] text-muted-foreground/50">
                no skills granted
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-raised/25 p-4">
          <div className="mono-label mb-2">tools · {(agent.tools || []).length}</div>
          <div className="flex flex-wrap gap-1.5">
            {(agent.tools || []).length ? (
              (agent.tools || []).map((s) => <Chip key={s}>{s}</Chip>)
            ) : (
              <span className="font-mono text-[11.5px] text-muted-foreground/50">
                no tools granted
              </span>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-raised/25 p-4">
          <div className="mono-label mb-2">mcp clients · {(agent.mcpServers ?? []).length}</div>
          <div className="flex flex-wrap gap-1.5">
            {(agent.mcpServers ?? []).length ? (
              (agent.mcpServers ?? []).map((s) => <Chip key={s}>{s}</Chip>)
            ) : (
              <span className="font-mono text-[11.5px] text-muted-foreground/50">
                no mcp clients granted
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------- editor */

type Draft = Omit<StudioAgent, "id" | "createdAt">;

function AgentEditor({
  initialDraft,
  title,
  onClose,
  onSave,
}: {
  initialDraft: Draft;
  title: string;
  onClose: () => void;
  onSave: (draft: Draft) => void;
}) {
  const k = useKnowledge();
  const [tab, setTab] = useState<"general" | "capabilities" | "runtime" | "rag">("general");
  const [test, setTest] = useState<string | null>(null);
  const { models } = useModels();
  const { squads } = useSquads();
  const squadNames = squads.map((s) => s.name);
  /* Draft lives inside the modal: typing never re-renders the roster behind it. */
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const toggleIn = (key: "skills" | "tools" | "adapters" | "targets" | "ragBrands", v: string) =>
    set({
      [key]: draft[key].includes(v) ? draft[key].filter((x) => x !== v) : [...draft[key], v],
    } as Partial<Draft>);

  /** Brand keywords inherited from the capability packs bound to this agent. */
  const { packs: capabilityPackList } = useCapabilities();
  const { skills: skillList } = useSkills();
  const { items: toolList } = useForge();
  const { adapters: adapterList } = useAdapters();
  const { targets: targetList } = useTargets();

  const dynamicSkillCatalog = skillList.map((s) => ({ id: s.id, label: s.name }));
  const dynamicToolCatalog = toolList.map((t) => ({ id: t.id, label: t.name }));
  const dynamicAdapterCatalog = adapterList.map((a) => ({ id: a.id, label: a.name || a.id }));
  const dynamicTargetCatalog = targetList.map((t) => ({ id: t.name, label: t.name }));
  const dynamicPackCatalog = capabilityPackList.map((p) => ({ id: p.id, label: p.name }));
  /** A space-bound librarian is sealed read-only and cannot leave its space. */
  const { spaces } = useSpaces();
  const { runtimes } = useRuntimes();
  const boundSpace = spaces.find((sp) => sp.id === draft.ragSpaceId);
  const inheritedKeywords = resolveAliases(
    { ragKeywords: "", packs: draft.packs ?? [] },
    capabilityPackList,
  );
  /* An agent from another desk opens read-only — sharing never grants write. */
  const ownerCtx = useOwnerCtx();
  const owned = draft as Owned;
  const isNew = !(draft as { id?: string }).id;
  const writable = isNew || canEditOwned(owned, ownerCtx);
  const refusal = writable ? "" : editRefusal(owned, ownerCtx);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
        className="glass w-full max-w-[880px] rounded-xl border-sapphire/25 p-6 shadow-[0_0_80px_-40px_var(--sapphire)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[19px] font-medium tracking-tight text-foreground">{title}</h3>
            <p className="mt-1 text-[12.5px] text-muted-foreground/70">
              Identity, inference parameters and capability grants are sealed per agent.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" title="Close">
            <X size={17} className="text-muted-foreground hover:text-foreground" />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-1.5">
          {(
            [
              ["general", "General"],
              ["capabilities", "Capabilities"],
              ["runtime", "Inference Settings"],
              ["rag", "Knowledge / RAG"],
            ] as const
          ).map(([id, label]) => (
            <Chip key={id} active={tab === id} onClick={() => setTab(id)}>
              {label}
            </Chip>
          ))}
        </div>

        <Sheen className="my-5" />

        <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
          <ReadOnlyBanner reason={refusal} />
          {tab === "general" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="agent name">
                  <input
                    value={draft.name}
                    onChange={(e) => set({ name: e.target.value })}
                    className={input}
                    placeholder="New Agent"
                  />
                </Field>
                <Field label="squad">
                  <select
                    value={
                      draft.squad && draft.squad !== "Unassigned"
                        ? draft.squad
                        : squadNames[0] || ""
                    }
                    onChange={(e) => set({ squad: e.target.value })}
                    className={cn(input, "font-mono")}
                  >
                    {[
                      ...new Set(
                        [...squadNames, draft.squad].filter((s) => s && s !== "Unassigned"),
                      ),
                    ].map((s) => (
                      <option key={s} value={s} className="bg-panel">
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field
                label="agent role — system prompt"
                hint="The agent's character. Without this it speaks empty."
              >
                <textarea
                  value={draft.systemPrompt}
                  onChange={(e) => set({ systemPrompt: e.target.value })}
                  rows={6}
                  className={cn(input, "resize-y font-mono text-[12.5px] leading-relaxed")}
                />
              </Field>

              <Field label="description">
                <textarea
                  value={draft.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={2}
                  className={cn(input, "resize-y")}
                  placeholder="Free-form notes about this agent's mission, tactics, output style…"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="model" hint="Inherit from registry or system default.">
                  <select
                    value={
                      !draft.modelId || draft.modelId === "system_default"
                        ? "system_default"
                        : models.some((m) => m.id === draft.modelId)
                          ? draft.modelId
                          : "__custom"
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "system_default") {
                        set({ modelId: "system_default", provider: "System Default" });
                      } else if (v === "__custom") {
                        set({ modelId: "", provider: "Custom" });
                      } else {
                        const m = models.find((x) => x.id === v);
                        if (m) set({ modelId: m.id, provider: m.vendor });
                      }
                    }}
                    className={cn(
                      input,
                      "font-mono",
                      (!draft.modelId || draft.modelId === "system_default") &&
                        "text-[#00ffaa] border-[#00ffaa]/30 shadow-[0_0_15px_-5px_#00ffaa]/20",
                    )}
                  >
                    <option
                      value="system_default"
                      className="bg-panel font-bold tracking-wider"
                      style={{ color: "#00ffaa" }}
                    >
                      ✦ Use System Default
                    </option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id} className="bg-panel text-foreground">
                        {m.name} · {m.modelId}
                      </option>
                    ))}
                    <option value="__custom" className="bg-panel italic text-muted-foreground">
                      Custom / manual…
                    </option>
                  </select>
                </Field>
                <Field label="provider (brain)">
                  <input
                    value={draft.provider}
                    disabled={
                      draft.modelId === "system_default" ||
                      models.some((m) => m.id === draft.modelId)
                    }
                    onChange={(e) => set({ provider: e.target.value })}
                    className={cn(
                      input,
                      (draft.modelId === "system_default" ||
                        models.some((m) => m.id === draft.modelId)) &&
                        "opacity-60 cursor-not-allowed",
                    )}
                  />
                </Field>
              </div>

              {draft.modelId !== "system_default" &&
                !!draft.modelId &&
                !models.some((m) => m.id === draft.modelId) && (
                  <Field
                    label="custom model id"
                    hint="Provide a raw model ID string (e.g. gpt-4o, claude-3-sonnet)"
                  >
                    <input
                      value={draft.modelId}
                      onChange={(e) => set({ modelId: e.target.value })}
                      className={cn(input, "font-mono")}
                    />
                  </Field>
                )}

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-raised/25 p-4">
                <div>
                  <div className="mono-label">thinking</div>
                  <div className="mt-1 text-[12px] text-muted-foreground/65">
                    Per-agent override. ON enables the model's reasoning channel for this agent.
                  </div>
                </div>
                <Toggle on={draft.thinking} onToggle={() => set({ thinking: !draft.thinking })} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Slider
                  label="priority"
                  hint="1 = background · 5 = normal · 10 = critical"
                  value={draft.priority}
                  min={1}
                  max={10}
                  step={1}
                  onChange={(v) => set({ priority: v })}
                />
                <Slider
                  label="stop grace (ms)"
                  hint="SIGTERM → wait → SIGKILL"
                  value={draft.stopGraceMs}
                  min={0}
                  max={30000}
                  step={500}
                  onChange={(v) => set({ stopGraceMs: v })}
                />
              </div>

              <div>
                <div className="mono-label mb-2">identity colour</div>
                <JewelSwatches
                  value={draft.avatar.jewel}
                  onChange={(j) => set({ avatar: { ...draft.avatar, jewel: j } })}
                />
              </div>
              <div>
                <div className="mono-label mb-2">icon</div>
                <IconPicker
                  value={draft.icon}
                  jewel={draft.avatar.jewel}
                  height={180}
                  onSelect={(name) => set({ icon: name })}
                />
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-4">
                <div className="mono-label mb-1">access</div>
                <p className="mb-3 text-[12.5px] text-muted-foreground/70">
                  Agents you author stay on your desk. Widen the band only when another team must
                  call this agent.
                </p>
                <ShareControl
                  record={owned}
                  disabled={!writable}
                  onChange={(patch) => set(patch as Partial<Draft>)}
                />
              </div>
            </>
          )}

          {tab === "capabilities" && (
            <>
              <PickerRow
                label="capability packs"
                catalog={dynamicPackCatalog}
                selected={draft.packs || []}
                onChange={(next) => set({ packs: next })}
              />
              <PickerRow
                label="skills"
                catalog={dynamicSkillCatalog}
                selected={draft.skills || []}
                onChange={(next) => set({ skills: next })}
              />
              <PickerRow
                label="tools"
                catalog={
                  boundSpace
                    ? dynamicToolCatalog.filter((t) => !isDestructiveTool(t.id))
                    : dynamicToolCatalog
                }
                selected={(draft.tools || []).filter((t) => !boundSpace || !isDestructiveTool(t))}
                onChange={(next) => set({ tools: next })}
              />
              {boundSpace && (
                <p className="-mt-2 font-mono text-[11px] text-muted-foreground/55">
                  Write, exec and vault tools are withheld — {boundSpace.name} librarians are sealed
                  read-only.
                </p>
              )}
              <McpPickerRow
                selected={draft.mcpServers || []}
                onChange={(next) => set({ mcpServers: next })}
              />
              <PickerRow
                label="adapters"
                catalog={dynamicAdapterCatalog}
                selected={draft.adapters || []}
                onChange={(next) => set({ adapters: next })}
              />
              <PickerRow
                label="targets"
                catalog={dynamicTargetCatalog}
                selected={draft.targets || []}
                onChange={(next) => set({ targets: next })}
              />
            </>
          )}

          {tab === "runtime" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Slider
                  label="context window"
                  hint="4k–128k"
                  value={draft.contextWindow}
                  min={4096}
                  max={131072}
                  step={4096}
                  onChange={(v) => set({ contextWindow: v })}
                />
                <Slider
                  label="max output tokens"
                  value={draft.maxTokens}
                  min={256}
                  max={16384}
                  step={256}
                  onChange={(v) => set({ maxTokens: v })}
                />
              </div>

              <Field label="stop sequences" hint="Comma separated · escapes \n and \t honoured.">
                <input
                  value={(draft.stopSequences || []).join(", ")}
                  onChange={(e) =>
                    set({
                      stopSequences: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className={cn(input, "font-mono")}
                  placeholder="\n\n\n, <|endoftext|>"
                />
              </Field>

              <div className="rounded-xl border border-white/[0.07] bg-raised/25 p-4">
                <div className="flex items-center justify-between">
                  <span className="mono-label">custom parameters</span>
                  <JewelButton
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      set({
                        customParams: [
                          ...draft.customParams,
                          { id: Math.random().toString(36).slice(2, 8), key: "", value: "" },
                        ],
                      })
                    }
                    className="gap-1.5"
                  >
                    <Plus size={13} /> Add
                  </JewelButton>
                </div>
                {!draft.customParams || draft.customParams.length === 0 ? (
                  <div className="mt-2 font-mono text-[11.5px] text-muted-foreground/50">
                    No custom parameters.
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {draft.customParams.map((p) => (
                      <div key={p.id} className="flex items-center gap-2">
                        <input
                          value={p.key}
                          placeholder="key"
                          onChange={(e) =>
                            set({
                              customParams: draft.customParams.map((c) =>
                                c.id === p.id ? { ...c, key: e.target.value } : c,
                              ),
                            })
                          }
                          className={cn(input, "font-mono")}
                        />
                        <input
                          value={p.value}
                          placeholder="value"
                          onChange={(e) =>
                            set({
                              customParams: draft.customParams.map((c) =>
                                c.id === p.id ? { ...c, value: e.target.value } : c,
                              ),
                            })
                          }
                          className={cn(input, "font-mono")}
                        />
                        <button
                          onClick={() =>
                            set({ customParams: draft.customParams.filter((c) => c.id !== p.id) })
                          }
                          aria-label="Remove parameter"
                          title="Remove parameter"
                        >
                          <X size={15} className="text-ruby/70 hover:text-ruby" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "rag" && (
            <>
              <div className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-raised/25 p-4">
                <div>
                  <div className="mono-label">knowledge / rag</div>
                  <div className="mt-1 max-w-[62ch] text-[12px] text-muted-foreground/65">
                    ON — the runtime searches the knowledge base on every dispatch and injects the
                    top matches. Pick one or more brands to scope retrieval; leave empty to search
                    everything.
                  </div>
                </div>
                <Toggle on={draft.rag} onToggle={() => set({ rag: !draft.rag })} />
              </div>

              {boundSpace && (
                <div className="rounded-xl border border-emerald/30 bg-emerald/[0.06] p-4">
                  <div className="mono-label text-emerald">bound space · {boundSpace.name}</div>
                  <p className="mt-1 max-w-[70ch] font-mono text-[11.5px] leading-relaxed text-muted-foreground/70">
                    Retrieval is hard-bound to this space and intersected with the caller&apos;s own
                    readable spaces. The binding can only narrow access, never widen it — a
                    principal without reader rights gets an empty, audited answer.
                  </p>
                </div>
              )}

              <div>
                <div className="mono-label mb-2">brands · {(draft.ragBrands || []).length}</div>
                <div className="flex flex-wrap gap-1.5">
                  {k.brandAliases.map((b: { id: string; brand: string; chunks?: number }) => (
                    <Chip
                      key={b.id}
                      active={(draft.ragBrands || []).includes(b.id)}
                      onClick={() => toggleIn("ragBrands", b.id)}
                    >
                      {b.brand} · {b.chunks || 0} chunks
                    </Chip>
                  ))}
                </div>
              </div>

              <Field
                label="keywords / alias"
                hint="Comma-separated. Boosts documents whose uploader tags or filename match — never widens the brand scope."
              >
                <textarea
                  value={draft.ragKeywords}
                  onChange={(e) => set({ ragKeywords: e.target.value })}
                  rows={3}
                  className={cn(input, "resize-y font-mono")}
                  placeholder="vpn, nat, policy…"
                />
              </Field>

              <div>
                <div className="mono-label mb-2">
                  inherited from capability packs · {inheritedKeywords.length}
                </div>
                {inheritedKeywords.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {inheritedKeywords.map((a) => (
                      <span
                        key={`${a.from}:${a.term}`}
                        title={`From ${a.from}`}
                        className="rounded-full border border-border/70 bg-raised/40 px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground/80"
                      >
                        {a.term} · {a.from}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="font-mono text-[11px] text-muted-foreground/55">
                    No pack keywords — bind a capability pack in the Capabilities tab to inherit its
                    sector vocabulary.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <Sheen className="my-5" />

        <div className="flex justify-end gap-2">
          <JewelButton variant="outline" size="sm" onClick={onClose}>
            Cancel
          </JewelButton>
          <JewelButton
            size="sm"
            onClick={() => onSave(draft)}
            disabled={!draft.name.trim() || !writable}
            title={refusal}
          >
            Save changes
          </JewelButton>
        </div>
      </motion.div>
    </div>
  );
}

/* -------------------------------------------------------------- run history */

function RunHistory({ runs }: { runs: AgentRun[] }) {
  const [filter, setFilter] = useState<string>("all");
  const sources = ["all", ...new Set(runs.map((r) => r.source))];
  const list = runs.filter((r) => filter === "all" || r.source === filter);

  return (
    <div className="glass overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
        <span className="font-mono text-[11.5px] text-muted-foreground/60">
          {list.length} runs · live {runs.filter((r) => r.status === "running").length} · history{" "}
          {runs.length}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
              {s}
            </Chip>
          ))}
        </div>
      </div>

      <div className="max-h-[65vh] overflow-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="sticky top-0 bg-panel/95 backdrop-blur">
            <tr>
              {["source", "agent", "user", "adapter", "status", "started", "duration"].map((h) => (
                <th
                  key={h}
                  className="border-b border-white/[0.07] px-5 py-2.5 text-left font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/55"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-raised/30">
                <td className="border-b border-white/[0.04] px-5 py-2.5">
                  <Tag tone="sapphire">{r.source}</Tag>
                </td>
                <td className="border-b border-white/[0.04] px-5 py-2.5 font-mono text-[12.5px] text-foreground/90">
                  {r.agent}
                </td>
                <td className="border-b border-white/[0.04] px-5 py-2.5 font-mono text-[12.5px] text-muted-foreground/75">
                  {r.user}
                </td>
                <td className="border-b border-white/[0.04] px-5 py-2.5 font-mono text-[12.5px] text-muted-foreground/75">
                  {r.adapter}
                </td>
                <td className="border-b border-white/[0.04] px-5 py-2.5">
                  <Tag
                    tone={r.status === "ok" ? "emerald" : r.status === "error" ? "ruby" : "topaz"}
                  >
                    {r.status}
                  </Tag>
                </td>
                <td className="border-b border-white/[0.04] px-5 py-2.5 font-mono text-[12px] text-muted-foreground/70">
                  {fmtDateTime(r.startedAt)}
                </td>
                <td className="border-b border-white/[0.04] px-5 py-2.5 font-mono text-[12px] text-foreground/80">
                  {r.durationMs}ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- page */

function AgentOrchestrator() {
  const { agents, runs, create, update, remove, dispatch } = useAgents();
  const { squads, active: activeSquad, setActive: setActiveSquad } = useSquads();
  const [tab, setTab] = useState<"roster" | "history">("roster");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editorFor, setEditorFor] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyAgent);
  const [toast, setToast] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const squadName = squads.find((s) => s.id === activeSquad)?.name ?? null;
  const scoped = squadName ? agents.filter((a) => a.squad === squadName) : agents;
  const scopedRuns = squadName ? runs.filter((r) => scoped.some((a) => a.id === r.agentId)) : runs;

  const active = scoped.find((a) => a.id === activeId) ?? scoped[0] ?? null;
  const live = scoped.filter((a) => a.live).length;

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const openEditor = (a?: StudioAgent) => {
    if (a) {
      const { id: _id, createdAt: _c, ...rest } = a;
      setDraft(rest);
      setEditorFor(a.id);
    } else {
      setDraft({ ...emptyAgent, squad: squadName ?? emptyAgent.squad });
      setEditorFor("new");
    }
  };

  return (
    <Surface
      title="Agent Orchestrator"
      crumb="Agents"
      meta={`local bridge · ${squadName ? `squad ${squadName.toLowerCase()}` : "all squads"} · ${mounted ? scoped.length : 0} agents · ${mounted ? live : 0} live`}
      wide
      action={
        <div className="flex flex-wrap items-center gap-2">
          <JewelButton
            size="sm"
            variant="outline"
            onClick={() => {
              window.dispatchEvent(new CustomEvent("sovereign:agents"));
              window.dispatchEvent(new CustomEvent("sovereign:squads"));
              flash("Roster refreshed from the local bridge.");
            }}
          >
            Refresh
          </JewelButton>
          <JewelButton size="sm" onClick={() => openEditor()} className="gap-1.5">
            <Plus size={14} strokeWidth={1.8} /> New agent
          </JewelButton>
        </div>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        <Chip active={tab === "roster"} onClick={() => setTab("roster")}>
          Roster · <span suppressHydrationWarning>{mounted ? scoped.length : 0}</span>
        </Chip>
        <Chip active={tab === "history"} onClick={() => setTab("history")}>
          Run history · <span suppressHydrationWarning>{mounted ? scopedRuns.length : 0}</span>
        </Chip>
      </div>

      <div className="mt-6">
        {tab === "roster" ? (
          <div className="grid gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
            <RosterList
              agents={scoped}
              flat={!!squadName}
              activeId={active?.id ?? null}
              onSelect={setActiveId}
              onDelete={(id) => {
                remove(id);
                if (activeId === id) setActiveId(null);
                flash("Agent retired.");
              }}
            />
            {active ? (
              <AgentDetail
                key={active.id}
                agent={active}
                onEdit={() => openEditor(active)}
                onUpdate={(patch) => update(active.id, patch)}
                onDispatch={() => {
                  dispatch(active);
                  flash(`${active.name} dispatched.`);
                }}
              />
            ) : (
              <div className="glass flex flex-col items-center justify-center gap-4 rounded-xl p-16 text-center">
                <div className="font-mono text-[12.5px] text-muted-foreground/55">
                  {squadName
                    ? `Squad ${squadName} is empty — provision its first agent.`
                    : "No agents in the registry — create one to begin."}
                </div>
                <JewelButton size="sm" onClick={() => openEditor()} className="gap-1.5">
                  <Plus size={14} strokeWidth={1.8} /> New agent
                  {squadName ? ` in ${squadName}` : ""}
                </JewelButton>
              </div>
            )}
          </div>
        ) : (
          <RunHistory runs={scopedRuns} />
        )}
      </div>

      <AnimatePresence>
        {editorFor && (
          <AgentEditor
            initialDraft={draft}
            title={editorFor === "new" ? "New agent" : "Edit agent"}
            onClose={() => setEditorFor(null)}
            onSave={async (draft) => {
              if (editorFor === "new") {
                try {
                  const id = await create(draft);
                  setActiveId(id);
                  const target = squads.find((s) => s.name === draft.squad);
                  if (target && target.id !== activeSquad) setActiveSquad(target.id);
                  flash("Agent sealed into the registry.");
                } catch (e) {
                  flash("Failed to seal agent.");
                }
              } else {
                update(editorFor, draft);
                flash("Agent updated.");
              }
              setEditorFor(null);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="glass fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg border-sapphire/30 px-4 py-2 font-mono text-[12px] text-foreground/90"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </Surface>
  );
}
