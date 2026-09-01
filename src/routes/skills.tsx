import { useCallback, useMemo, useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";
import { canEdit as canEditOwned, editRefusal, useOwnerCtx, type Owned } from "@/lib/ownership";
import { OwnerChip, ReadOnlyBanner, ShareControl } from "@/components/sovereign/ownership-controls";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronUp, Pencil, Play, Plus, Search, Trash2, X } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, StatusDot, Tag } from "@/components/sovereign/primitives";
import { IconPicker, JewelSwatches } from "@/components/sovereign/identity";
import { getIcon } from "@/lib/icon-library";
import { jewelPalette } from "@/lib/avatar-library";
import {
  emptySkill,
  outputFormats,
  riskLevels,
  skillAdapterCatalog,
  skillTargetCatalog,
  useSkills,
  useSkillSquads,
  type SkillRisk,
  type StudioSkill,
  type TempOverride,
} from "@/lib/skill-store";
import { useModels } from "@/lib/model-store";
import { useMcp } from "@/lib/mcp-store";
import { useWorkflows } from "@/lib/workflow-store";
import { usePlanners } from "@/lib/planner-store";
import { useRuntimes } from "@/lib/runtime-store";
import {
  resolveSandbox,
  skillIsolationSeed,
  useCollection,
  type IsolationProfile,
} from "@/lib/security-store";
import { gateAction } from "@/lib/approval-gate";
import { cn, fmtDateTime } from "@/lib/utils";

export const Route = createFileRoute("/skills")({
  head: () => ({
    meta: [
      { title: "Skills Engine — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Sealed procedures the fleet can invoke with !slug — each skill bundles instructions, a script body, a brain, an execution policy and its adapter and target bindings.",
      },
      { property: "og:title", content: "Skills Engine — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Author, seal and dispatch callable skills with strict execution policy, rollback bodies and scoped bindings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SkillsEngine,
});

const input =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[13.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";
const area = cn(input, "font-mono text-[12px] leading-relaxed");

const riskTone: Record<SkillRisk, "emerald" | "sapphire" | "topaz" | "ruby"> = {
  read: "emerald",
  write: "sapphire",
  exec: "topaz",
  destructive: "ruby",
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
        "rounded-lg border px-3 py-1.5 font-mono text-[11.5px] transition-all duration-150 ease-in-out",
        active
          ? "border-sapphire/50 bg-sapphire/10 text-foreground shadow-[0_0_18px_-8px_var(--sapphire)]"
          : "border-white/[0.07] bg-raised/30 text-muted-foreground/80 hover:border-sapphire/30 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Dropdown + Add binding picker — same grammar as the Agent editor. */
function PickerRow({
  label,
  catalog,
  selected,
  onChange,
  empty,
}: {
  label: string;
  catalog: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
  empty: string;
}) {
  const available = catalog.filter((c) => !selected.includes(c));
  const [pick, setPick] = useState("");
  const value = available.includes(pick) ? pick : (available[0] ?? "");

  return (
    <div className="rounded-xl border border-white/[0.06] bg-raised/20 p-4">
      <div className="mono-label mb-2">
        {label} · {selected.length}
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
              <option key={c} value={c} className="bg-panel">
                {c}
              </option>
            ))
          ) : (
            <option className="bg-panel">all bound</option>
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
          selected.map((s) => (
            <span
              key={s}
              className="flex items-center gap-1.5 rounded-lg border border-sapphire/45 bg-sapphire/10 px-2.5 py-1 font-mono text-[11.5px] text-foreground shadow-[0_0_18px_-8px_var(--sapphire)]"
            >
              {s}
              <button
                type="button"
                onClick={() => onChange(selected.filter((x) => x !== s))}
                aria-label={`Remove ${s}`}
                title={`Remove ${s}`}
              >
                <X
                  size={11}
                  className="text-muted-foreground/70 transition-colors hover:text-ruby"
                />
              </button>
            </span>
          ))
        ) : (
          <span className="font-mono text-[11.5px] text-muted-foreground/50">{empty}</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- card */

function SkillCard({
  skill,
  sandbox,
  onRun,
  onEdit,
  onDelete,
}: {
  skill: StudioSkill;
  sandbox: IsolationProfile | null;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = getIcon(skill.icon);
  const tone = jewelPalette[skill.jewel];
  /* A skill from another desk may be read and run, never edited or destroyed. */
  const ownerCtx = useOwnerCtx();
  const writable = canEditOwned(skill, ownerCtx);
  const refusal = editRefusal(skill, ownerCtx);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
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
            <div className="truncate font-mono text-[13.5px] text-foreground">{skill.name}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <OwnerChip record={skill} ctx={ownerCtx} />
          <StatusDot tone={skill.enabled ? "emerald" : "ruby"} pulse={skill.enabled} />
          <Tag tone="amethyst">{skill.type}</Tag>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground/75">
        {skill.description || "No description."}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Tag tone="emerald">{skill.stats.calls} runs</Tag>
        <Tag tone={sandbox ? "emerald" : "ruby"}>
          {sandbox ? `sandbox · ${sandbox.name}` : "no sandbox"}
        </Tag>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onRun}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.07] bg-raised/30 py-2 font-mono text-[12px] text-foreground/90 transition-all duration-150 ease-in-out hover:border-emerald/40 hover:text-emerald"
        >
          <Play size={12} strokeWidth={1.8} /> Run
        </button>
        <button
          onClick={onEdit}
          title={refusal || "Edit skill"}
          className="rounded-lg border border-white/[0.07] bg-raised/30 px-3 py-2 font-mono text-[12px] text-foreground/85 transition-colors hover:border-sapphire/40 hover:text-sapphire"
        >
          <span className="flex items-center gap-1.5">
            <Pencil size={12} strokeWidth={1.8} /> Edit
          </span>
        </button>
        <button
          onClick={onDelete}
          disabled={!writable}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-raised/30 text-muted-foreground transition-colors hover:bg-ruby/15 hover:text-ruby disabled:opacity-40"
          title={refusal || `Delete ${skill.name}`}
          aria-label={`Delete ${skill.name}`}
        >
          <Trash2 size={13} strokeWidth={1.8} />
        </button>
      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------- editor */

type Draft = Omit<StudioSkill, "id" | "createdAt">;

function SkillEditor({
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
  /* Draft lives inside the modal: typing never re-renders the whole page. */
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const onChange = useCallback(
    (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })),
    [],
  );
  const { models } = useModels();
  const { squads } = useSkillSquads();
  const squadNames = squads.map((s) => s.name);
  const { runtimes } = useRuntimes();
  const { clients: mcpClients } = useMcp();
  const { workflows } = useWorkflows();
  const { planners } = usePlanners();
  const [localScripts, setLocalScripts] = useState<any[]>([]);

  useEffect(() => {
    fetchApi("/api/system/local-scripts").then(res => {
      if (res && res.scripts) setLocalScripts(res.scripts);
    }).catch(e => console.error("Failed to load local scripts", e));
  }, []);
  const [tab, setTab] = useState<"general" | "execution">("general");
  const ownerCtx = useOwnerCtx();
  const owned = draft as Owned;
  const isNew = !(draft as { id?: string }).id;
  const writable = isNew || canEditOwned(owned, ownerCtx);
  const refusal = writable ? "" : editRefusal(owned, ownerCtx);
  const [paramKey, setParamKey] = useState("");
  const [paramValue, setParamValue] = useState("");

  const tabs = [
    ["general", "General"],
    ["execution", "Execution"],
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-canvas/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
        className="glass relative flex max-h-[88vh] w-full max-w-[840px] flex-col rounded-2xl border border-sapphire/25 shadow-[0_0_80px_-30px_var(--sapphire)]"
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div>
            <h2 className="text-[17px] font-medium tracking-tight text-foreground">{title}</h2>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground/55">
              trigger this skill in chat
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" title="Close">
            <X size={16} className="text-muted-foreground hover:text-foreground" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-white/[0.06] px-6 py-3">
          {tabs.map(([id, label]) => (
            <Chip key={id} active={tab === id} onClick={() => setTab(id)}>
              {label}
            </Chip>
          ))}
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <ReadOnlyBanner reason={refusal} />
          {tab === "general" && (
            <>
              <div className="grid gap-4 sm:grid-cols-1">
                <Field label="Name">
                  <input
                    value={draft.name}
                    onChange={(e) => onChange({ name: e.target.value })}
                    placeholder="Hook Formula Writer"
                    className={input}
                  />
                </Field>
              </div>

              <Field label="Squad">
                <select
                  value={draft.squad && draft.squad !== "Unassigned" ? draft.squad : (squadNames[0] || "")}
                  onChange={(e) => onChange({ squad: e.target.value })}
                  className={cn(input, "font-mono")}
                >
                  {[...new Set([...squadNames, draft.squad].filter(s => s && s !== "Unassigned"))].map((s) => (
                    <option key={s!} value={s!} className="bg-panel">
                      {s}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Description">
                <textarea
                  value={draft.description}
                  onChange={(e) => onChange({ description: e.target.value })}
                  rows={2}
                  className={cn(input, "resize-y")}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Skill Type">
                  <select
                    value={draft.type}
                    onChange={(e) => onChange({ type: e.target.value as Draft["type"] })}
                    className={cn(input, "font-mono")}
                  >
                    <option value="native" className="bg-panel">Native</option>
                    <option value="python" className="bg-panel">Python</option>
                    <option value="workflow" className="bg-panel">Workflow</option>
                    <option value="mcp" className="bg-panel">MCP</option>
                  </select>
                </Field>
              </div>

              <Field label="Icon">
                <IconPicker
                  value={draft.icon}
                  jewel={draft.jewel}
                  onSelect={(icon) => onChange({ icon })}
                  height={190}
                />
              </Field>

              <Field label="Accent">
                <JewelSwatches value={draft.jewel} onChange={(jewel) => onChange({ jewel })} />
              </Field>

              <Field
                label="Instructions (markdown — merit rules)"
                hint="Markdown · the model sees these rules verbatim."
              >
                <textarea
                  value={draft.instructions}
                  onChange={(e) => onChange({ instructions: e.target.value })}
                  rows={8}
                  className={cn(area, "resize-y")}
                />
              </Field>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-4">
                <div className="mono-label mb-1">access</div>
                <p className="mb-3 text-[12.5px] text-muted-foreground/70">
                  Skills you author stay private to your desk until you widen the band.
                </p>
                <ShareControl
                  record={owned}
                  disabled={!writable}
                  onChange={(patch) => onChange(patch as Partial<Draft>)}
                />
              </div>
            </>
          )}

          {tab === "execution" && (
            <>
              {draft.type === "python" && (
                <>
                  <Field label="Script path (from disk roots)">
                    <select
                      value={draft.scriptPath}
                      onChange={(e) => onChange({ scriptPath: e.target.value })}
                      className={cn(input, "font-mono")}
                    >
                      <option value="" className="bg-panel italic text-muted-foreground">
                        Select a python file...
                      </option>
                      {localScripts.map(sc => (
                        <option key={sc.path} value={sc.path} className="bg-panel">
                          {sc.folder}/{sc.relPath}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Interpreter (python)"
                    hint="Pick the venv / conda / system Python that runs this skill."
                  >
                    <select
                      value={draft.runtimeId}
                      onChange={(e) => onChange({ runtimeId: e.target.value })}
                      className={cn(input, "font-mono")}
                    >
                      <option value="" className="bg-panel">
                        Select interpreter…
                      </option>
                      {runtimes.map((r) => (
                        <option key={r.id} value={r.id} className="bg-panel">
                          {r.name} · {r.version}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}

              {draft.type === "workflow" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Workflow ID">
                    <select
                      value={draft.workflowId}
                      onChange={(e) => onChange({ workflowId: e.target.value })}
                      className={cn(input, "font-mono")}
                    >
                      <option value="" className="bg-panel italic text-muted-foreground">
                        Select a workflow...
                      </option>
                      {workflows.map((wf) => (
                        <option key={wf.id} value={wf.id} className="bg-panel text-foreground">
                          {wf.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Orchestrator / Planner (Optional)">
                    <select
                      className={cn(input, "font-mono")}
                      defaultValue=""
                    >
                      <option value="" className="bg-panel italic text-muted-foreground">
                        Default engine logic...
                      </option>
                      {planners.filter(p => p.kind === "skill").map((pl) => (
                        <option key={pl.id} value={pl.id} className="bg-panel text-foreground">
                          {pl.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}

              {draft.type === "mcp" && (
                <Field label="MCP Client ID">
                  <select
                    value={draft.mcpClientId}
                    onChange={(e) => onChange({ mcpClientId: e.target.value })}
                    className={cn(input, "font-mono")}
                  >
                    <option value="" className="bg-panel italic text-muted-foreground">
                      Select an MCP Client...
                    </option>
                    {mcpClients.map((client) => (
                      <option key={client.id} value={client.id} className="bg-panel">
                        {client.name || client.id}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {draft.type === "native" && (
                <div className="rounded-xl border border-white/[0.06] bg-raised/20 p-6 text-center">
                  <p className="text-[13px] text-muted-foreground">
                    Native skills are executed by the Elara Sovereign Studio engine internally.
                    <br />
                    No additional execution bindings are required.
                  </p>
                </div>
              )}

              <div className="mt-4 flex items-center gap-3">
                <Toggle on={draft.enabled} onToggle={() => onChange({ enabled: !draft.enabled })} />
                <span className="mono-label">Skill enabled</span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-6 py-4">
          <JewelButton size="sm" variant="outline" onClick={onClose}>
            Close
          </JewelButton>
          <JewelButton size="sm" onClick={() => onSave(draft)} disabled={!writable} title={refusal}>
            Save
          </JewelButton>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

function SkillsEngine() {
  const { skills, runs, create, update, remove, run } = useSkills();
  const skillIsolation = useCollection<IsolationProfile>(
    "sovereign.security.skill-isolation",
    skillIsolationSeed,
    "siso",
  );
  const { squads, active } = useSkillSquads();
  const activeSquad = squads.find((s) => s.id === active);
  const [tab, setTab] = useState<"library" | "runs">("library");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);

  const filtered = useMemo(
    () =>
      skills
        .filter((s) => !activeSquad || s.squad === activeSquad.name)
        .filter((s) =>
          `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()),
        ),
    [skills, query, activeSquad],
  );

  const save = async (d: Draft) => {
    if (!editing) return;
    const draft = {
      ...d,
      name: d.name || "Untitled skill",
      squad: d.squad && d.squad !== "Unassigned" ? d.squad : (activeSquad?.name || "Unassigned"),
    };
    try {
      if (editing.id) await update(editing.id, draft);
      else await create(draft);
      setEditing(null);
    } catch (err: any) {
      const msg = err.message || "Failed to save skill";
      await confirmAction({
        title: "Validation Error",
        body: msg === "script_path required for python skill" 
          ? "A Python script file must be selected in the Execution tab." 
          : msg,
        confirmLabel: "OK",
        cancelLabel: "CLOSE",
        tone: "ruby"
      });
    }
  };

  return (
    <Surface
      title="Skills Engine"
      meta={`sealed procedures · trigger with !slug in chat · ${skills.length} skills`}
      wide
      action={
        <JewelButton
          size="sm"
          onClick={() =>
            setEditing({
              id: null,
              draft: { ...emptySkill, squad: activeSquad?.name ?? "Unassigned" },
            })
          }
          className="gap-1.5"
        >
          <Plus size={13} strokeWidth={1.8} /> New skill
        </JewelButton>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={tab === "library"} onClick={() => setTab("library")}>
          Library · {filtered.length}
        </Chip>
        <Chip active={tab === "runs"} onClick={() => setTab("runs")}>
          Run History · {runs.length}
        </Chip>
        {tab === "library" && (
          <div className="ml-auto flex min-w-[220px] items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3">
            <Search size={14} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter skills…"
              className="h-9 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        )}
      </div>

      {tab === "library" ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <SkillCard
              key={s.id}
              skill={s}
              sandbox={resolveSandbox(skillIsolation.items, s.id)}
              onRun={() => void run(s)}
              onEdit={() => setEditing({ id: s.id, draft: { ...s } })}
              onDelete={async () => {
                const ok = await confirmAction({
                  title: `Delete ${s.name}?`,
                  body: "This skill will be permanently removed from the registry.",
                  confirmLabel: "Delete",
                  tone: "ruby",
                });
                if (ok) remove(s.id);
              }}
            />
          ))}
          {!filtered.length && (
            <div className="col-span-full rounded-xl border border-dashed border-white/[0.08] px-4 py-14 text-center font-mono text-[12.5px] text-muted-foreground/55">
              no skills match
            </div>
          )}
        </div>
      ) : (
        <div className="glass mt-6 overflow-hidden rounded-xl border border-white/[0.06]">
          <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.6fr_1fr_0.7fr] gap-3 border-b border-white/[0.06] px-4 py-3">
            {["Skill", "Source", "User", "Status", "Started", "Duration"].map((h) => (
              <span key={h} className="mono-label">
                {h}
              </span>
            ))}
          </div>
          <div className="max-h-[58vh] overflow-y-auto">
            {runs.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[1.4fr_0.8fr_0.7fr_0.6fr_1fr_0.7fr] gap-3 border-b border-white/[0.04] px-4 py-2.5 font-mono text-[12px] text-muted-foreground/80 last:border-0 hover:bg-raised/25"
              >
                <span className="truncate text-foreground/90">!{r.slug}</span>
                <span className="truncate">{r.source}</span>
                <span className="truncate">{r.user}</span>
                <span className={r.status === "ok" ? "text-emerald" : "text-ruby"}>{r.status}</span>
                <span className="truncate">{fmtDateTime(r.startedAt)}</span>
                <span>{(r.durationMs / 1000).toFixed(2)}s</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <SkillEditor
            initialDraft={editing.draft}
            title={editing.id ? "Edit Skill" : "New Skill"}
            onClose={() => setEditing(null)}
            onSave={save}
          />
        )}
      </AnimatePresence>
    </Surface>
  );
}

function NumberStepper({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : String(value);

  const clamp = (v: number) => {
    let n = v;
    if (typeof min === "number") n = Math.max(min, n);
    if (typeof max === "number") n = Math.min(max, n);
    return Number(n.toFixed(4));
  };

  const bump = (dir: 1 | -1) => {
    const next = clamp((Number.isFinite(value) ? value : 0) + dir * step);
    setText(String(next));
    onChange(next);
  };

  return (
    <div
      className={cn(
        "mt-2 flex items-stretch overflow-hidden rounded-lg border border-white/[0.07] bg-raised/40 transition-colors focus-within:border-sapphire/50",
        className,
      )}
    >
      <input
        inputMode="decimal"
        value={shown}
        onFocus={() => {
          setText(String(value));
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          const n = Number(text);
          onChange(Number.isFinite(n) && text.trim() !== "" ? clamp(n) : 0);
        }}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw !== "" && !/^-?\d*\.?\d*$/.test(raw)) return;
          setText(raw);
          const n = Number(raw);
          if (raw !== "" && Number.isFinite(n)) onChange(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            bump(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            bump(-1);
          }
        }}
        className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-[13px] text-foreground outline-none"
      />
      <div className="flex w-6 shrink-0 flex-col border-l border-white/[0.07]">
        <button
          type="button"
          aria-label="Increase"
          onClick={() => bump(1)}
          className="flex flex-1 items-center justify-center text-muted-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-sapphire"
          title="Increase"
        >
          <ChevronUp className="h-3 w-3" strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Decrease"
          onClick={() => bump(-1)}
          className="flex flex-1 items-center justify-center border-t border-white/[0.07] text-muted-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-sapphire"
          title="Decrease"
        >
          <ChevronDown className="h-3 w-3" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
