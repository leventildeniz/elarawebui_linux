import { useMemo, useRef, useState, useEffect } from "react";
import { canEdit as canEditOwned, editRefusal } from "@/lib/ownership";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  Crosshair,
  Download,
  FolderPlus,
  Pencil,
  Plus,
  Plug,
  RotateCcw,
  FileSpreadsheet,
  Info,
  Search,
  Star,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { Surface } from "@/components/sovereign/surface";
import { Tag } from "@/components/sovereign/primitives";
import { useAdapters } from "@/lib/adapter-store";
import { useVaultStore } from "@/lib/vault-store";
import {
  emptyEndpoint,
  emptyGroup,
  emptyTarget,
  groupKinds,
  kindTones,
  importColumns,
  importTemplateCsv,
  parseTargetImport,
  resolveImportGroups,
  riskTones,
  targetRisks,
  targetsToCsv,
  useTargets,
  vaultScopes,
  type Endpoint,
  type Target,
  type TargetGroup,
  type TargetGroupKind,
  type TargetRisk,
} from "@/lib/target-store";
import { gateAction } from "@/lib/approval-gate";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-sapphire/50";
const mono = "font-mono text-[12.5px]";

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

function Select({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <div className="mono-label mb-1.5">{label}</div>}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(field, mono, "appearance-none pr-8")}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-panel">
              {o.label}
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
}

function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  width = "680px",
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  width?: string;
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
        style={{ maxWidth: width }}
        className="glass my-6 w-full rounded-xl border border-sapphire/30 p-6 shadow-[0_0_80px_-40px_var(--sapphire)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[17px] font-medium tracking-tight text-foreground">{title}</h3>
            <p className="mt-1.5 max-w-[520px] text-[12.5px] leading-relaxed text-muted-foreground/75">
              {description}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" title="Close">
            <X
              size={16}
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
            />
          </button>
        </div>
        <div className="mt-5 space-y-4">{children}</div>
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4">
          {footer}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------ group dialog */

function GroupDialog({
  group,
  onClose,
  onSave,
}: {
  group: TargetGroup;
  onClose: () => void;
  onSave: (g: TargetGroup) => void;
}) {
  const [draft, setDraft] = useState<TargetGroup>(group);
  const set = (p: Partial<TargetGroup>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <Dialog
      title={group.name ? `Edit group · ${group.name}` : "New Group"}
      description="Group hosts by vendor or role — Forti, Checkpoint, Netscaler, Linux DMZ…"
      onClose={onClose}
      width="520px"
      footer={
        <>
          <MiniButton tone="platinum" onClick={onClose}>
            Cancel
          </MiniButton>
          <MiniButton
            tone="sapphire"
            onClick={() => {
              if (!draft.name.trim()) return;
              onSave(draft);
              onClose();
            }}
          >
            Save group
          </MiniButton>
        </>
      }
    >
      <div>
        <div className="mono-label mb-1.5">name *</div>
        <input
          autoFocus
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          className={field}
        />
      </div>
      <Select
        label="kind"
        value={draft.kind}
        options={groupKinds.map((k) => ({ value: k, label: k }))}
        onChange={(kind) => set({ kind: kind as TargetGroupKind })}
      />
      <div>
        <div className="mono-label mb-1.5">description</div>
        <input
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
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
    </Dialog>
  );
}

/* ----------------------------------------------------------- target dialog */

function TargetDialog({
  target,
  groups,
  adapters,
  vaultNames,
  onClose,
  onSave,
}: {
  target: Target;
  groups: TargetGroup[];
  adapters: string[];
  vaultNames: Record<string, string[]>;
  onClose: () => void;
  onSave: (t: Target) => void;
}) {
  const [draft, setDraft] = useState<Target>(target);
  const set = (p: Partial<Target>) => setDraft((d) => ({ ...d, ...p }));

  const setEndpoint = (id: string, p: Partial<Endpoint>) =>
    setDraft((d) => ({
      ...d,
      endpoints: d.endpoints.map((e) => (e.id === id ? { ...e, ...p } : e)),
    }));

  const makePrimary = (id: string) =>
    setDraft((d) => ({
      ...d,
      endpoints: d.endpoints.map((e) => ({ ...e, primary: e.id === id })),
    }));

  const generateFromPorts = () =>
    setDraft((d) => {
      const ports = d.ports
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      if (!ports.length) return d;
      return {
        ...d,
        endpoints: ports.map((port, i) => ({
          ...emptyEndpoint(i === 0),
          port,
          label: port === "22" ? "ssh" : port === "443" ? "api" : `port-${port}`,
        })),
      };
    });

  const adapterOptions = [
    { value: "", label: "— none —" },
    ...adapters.map((a) => ({ value: a, label: a })),
  ];
  const inheritAdapters = [
    { value: "", label: "— inherit default —" },
    ...adapters.map((a) => ({ value: a, label: a })),
  ];

  return (
    <Dialog
      title={target.name ? `Edit target · ${target.name}` : "New Target"}
      description="Register a single host, firewall or service. Bind it to an adapter + vault entry for one-click agent connect."
      onClose={onClose}
      width="820px"
      footer={
        <>
          <MiniButton tone="platinum" onClick={onClose}>
            Cancel
          </MiniButton>
          <MiniButton
            tone="emerald"
            onClick={() => {
              if (!draft.name.trim()) return;
              onSave(draft);
              onClose();
            }}
          >
            Save target
          </MiniButton>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mono-label mb-1.5">name *</div>
          <input
            autoFocus
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            className={field}
          />
        </div>
        <Select
          label="group"
          value={draft.groupId}
          options={[
            { value: "", label: "— ungrouped —" },
            ...groups.map((g) => ({ value: g.id, label: g.name })),
          ]}
          onChange={(groupId) => set({ groupId })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="mono-label mb-1.5">ip</div>
          <input
            value={draft.ip}
            onChange={(e) => set({ ip: e.target.value })}
            placeholder="10.0.0.1"
            className={cn(field, mono)}
          />
        </div>
        <div>
          <div className="mono-label mb-1.5">host (fqdn)</div>
          <input
            value={draft.host}
            onChange={(e) => set({ host: e.target.value })}
            placeholder="fw01.corp.local"
            className={cn(field, mono)}
          />
        </div>
        <div>
          <div className="mono-label mb-1.5">port(s)</div>
          <input
            value={draft.ports}
            onChange={(e) => set({ ports: e.target.value })}
            placeholder="443,22,8443"
            className={cn(field, mono)}
          />
        </div>
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
          placeholder="prod, dmz, emea"
          className={field}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          label="default adapter"
          value={draft.adapter}
          options={adapterOptions}
          onChange={(adapter) => set({ adapter })}
        />
        <Select
          label="vault scope"
          value={draft.vaultScope}
          options={["none", ...Object.keys(vaultNames)].map((v) => ({ value: v, label: v }))}
          onChange={(vaultScope) => set({ vaultScope, vaultName: "" })}
        />
        <Select
          label="vault name"
          value={draft.vaultName}
          options={
            draft.vaultScope === "none"
              ? [{ value: "", label: "—" }]
              : (vaultNames[draft.vaultScope] || []).map((name) => ({ value: name, label: name }))
          }
          onChange={(vaultName) => set({ vaultName })}
        />
      </div>

      <div className="grid items-end gap-4 sm:grid-cols-3">
        <Select
          label="risk"
          value={draft.risk}
          options={targetRisks.map((r) => ({ value: r, label: r }))}
          onChange={(risk) => set({ risk: risk as TargetRisk })}
        />
        <div className="flex items-center gap-2.5 pb-2">
          <Toggle
            tone="ruby"
            on={draft.requiresApproval}
            onClick={() => set({ requiresApproval: !draft.requiresApproval })}
          />
          <span className="text-[13px] text-muted-foreground/85">Requires approval</span>
        </div>
        <div>
          <div className="mono-label mb-1.5">owner</div>
          <input
            value={draft.owner}
            onChange={(e) => set({ owner: e.target.value })}
            className={field}
          />
        </div>
      </div>

      <div>
        <div className="mono-label mb-1.5">notes</div>
        <textarea
          rows={3}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
          className={cn(field, "resize-y leading-relaxed")}
        />
      </div>

      {/* endpoints */}
      <div className="rounded-xl border border-white/[0.07] bg-raised/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Plug size={14} strokeWidth={1.7} className="text-amethyst" />
          <span className="text-[13.5px] text-foreground">Endpoints</span>
          <span className="font-mono text-[11.5px] text-muted-foreground/55">
            {draft.endpoints.length}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <MiniButton tone="platinum" onClick={generateFromPorts}>
              Generate from port(s)
            </MiniButton>
            <MiniButton
              tone="sapphire"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  endpoints: [...d.endpoints, emptyEndpoint(!d.endpoints.length)],
                }))
              }
            >
              <Plus size={12} strokeWidth={2} /> Add endpoint
            </MiniButton>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {draft.endpoints.map((ep) => (
            <div
              key={ep.id}
              className="rounded-lg border p-3"
              style={{
                borderColor: ep.primary
                  ? "color-mix(in oklab, var(--sapphire) 40%, transparent)"
                  : "rgba(255,255,255,0.07)",
                boxShadow: ep.primary ? "0 0 24px -18px var(--sapphire)" : undefined,
              }}
            >
              <div className="flex flex-wrap items-end gap-3">
                <button
                  type="button"
                  onClick={() => makePrimary(ep.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-[6px] font-mono text-[11.5px] transition-colors",
                    ep.primary
                      ? "border-topaz/45 bg-topaz/10 text-topaz"
                      : "border-white/[0.07] text-muted-foreground/70 hover:text-foreground",
                  )}
                >
                  <Star size={11} strokeWidth={2} fill={ep.primary ? "currentColor" : "none"} />{" "}
                  Primary
                </button>
                <div className="min-w-[160px] flex-1">
                  <div className="mono-label mb-1.5">label</div>
                  <input
                    value={ep.label}
                    onChange={(e) => setEndpoint(ep.id, { label: e.target.value })}
                    placeholder="api, ssh, mgmt"
                    className={field}
                  />
                </div>
                <div className="w-[110px]">
                  <div className="mono-label mb-1.5">port</div>
                  <input
                    value={ep.port}
                    onChange={(e) => setEndpoint(ep.id, { port: e.target.value })}
                    placeholder="443"
                    className={cn(field, mono)}
                  />
                </div>
                <button
                  type="button"
                  aria-label="Remove endpoint"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      endpoints: d.endpoints.filter((x) => x.id !== ep.id),
                    }))
                  }
                  className="mb-1 rounded-lg border border-white/[0.07] p-2 text-ruby/75 transition-colors hover:border-ruby/40 hover:text-ruby"
                  title="Remove endpoint"
                >
                  <Trash2 size={12} strokeWidth={1.8} />
                </button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Select
                  label="adapter"
                  value={ep.adapter}
                  options={inheritAdapters}
                  onChange={(adapter) => setEndpoint(ep.id, { adapter })}
                />
                <Select
                  label="vault scope"
                  value={ep.vaultScope}
                  options={[
                    { value: "", label: "— inherit default —" },
                    ...["none", ...Object.keys(vaultNames)].map((v) => ({ value: v, label: v })),
                  ]}
                  onChange={(vaultScope) => setEndpoint(ep.id, { vaultScope, vaultName: "" })}
                />
                <Select
                  label="vault name"
                  value={ep.vaultName}
                  options={
                    !ep.vaultScope || ep.vaultScope === "none"
                      ? [{ value: "", label: "— inherit default —" }]
                      : (vaultNames[ep.vaultScope] || []).map((name) => ({ value: name, label: name }))
                  }
                  onChange={(vaultName) => setEndpoint(ep.id, { vaultName })}
                />
              </div>
            </div>
          ))}
          {!draft.endpoints.length && (
            <p className="font-mono text-[12px] text-muted-foreground/55">
              No endpoints — the target default adapter/vault will be used.
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------- page */

function TargetsPage() {
  const {
    saveGroup,
    removeGroup,
    saveTarget,
    removeTarget,
    toggleTarget,
    checkTarget,
    importTargets,
    resetAll,
    ctx: ownerCtx,
    targets,
    groups,
  } = useTargets();
  const { adapters } = useAdapters();
  const adapterNames = useMemo(() => adapters.map((a) => a.name).filter(Boolean), [adapters]);

  const { items: vaultItems, fetch: fetchVault } = useVaultStore();

  // Load vault items on mount
  useEffect(() => {
    fetchVault();
  }, [fetchVault]);

  const vaultNames = useMemo(() => {
    // Collect unique vault names grouped by scope
    return vaultItems.reduce((acc, item) => {
      if (!acc[item.scope]) acc[item.scope] = [];
      if (acc[item.scope] && !acc[item.scope]!.includes(item.name)) {
        acc[item.scope]!.push(item.name);
      }
      return acc;
    }, {} as Record<string, string[]>);
  }, [vaultItems]);

  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [editingGroup, setEditingGroup] = useState<TargetGroup | null>(null);
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(
    () =>
      targets.filter(
        (t) =>
          (group === "all" || t.groupId === group) &&
          (!query.trim() ||
            `${t.id} ${t.name} ${t.ip} ${t.host} ${t.owner} ${t.tags.join(" ")}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())),
      ),
    [targets, group, query],
  );

  const [showImportHelp, setShowImportHelp] = useState(false);
  const [importedNote, setImportedNote] = useState("");

  const download = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const parsed = parseTargetImport(text);
    if (!parsed.length) return;
    /* a "group" column wins; otherwise rows land in the filtered group */
    const byName = resolveImportGroups(text, groups);
    const fallback = group === "all" ? "" : group;
    importTargets(
      parsed.map((t) => ({ ...t, groupId: byName[t.name] ?? fallback })),
      fallback,
    );
    setImportedNote(`${parsed.length} rows imported from ${file.name}`);
  };

  return (
    <Surface
      wide
      title="Targets"
      meta={`${targets.length} targets · ${groups.length} groups · ${targets.filter((t) => t.enabled).length} reachable`}
      crumb="Targets"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <MiniButton
            tone="platinum"
            title="Discard all local changes and restore the factory target registry"
            onClick={async () => {
              const ok = await confirmAction({
                title: "Restore defaults?",
                body: "Every change you made in this target registry is discarded and the factory records come back.",
                confirmLabel: "Restore",
                tone: "topaz",
              });
              if (ok) resetAll();
            }}
          >
            <RotateCcw size={12} strokeWidth={2} /> Restore defaults
          </MiniButton>
          <MiniButton tone="amethyst" onClick={() => setEditingGroup(emptyGroup())}>
            <FolderPlus size={12} strokeWidth={2} /> New group
          </MiniButton>
          <MiniButton tone="emerald" onClick={() => setEditingTarget(emptyTarget())}>
            <Plus size={12} strokeWidth={2} /> New target
          </MiniButton>
          <MiniButton tone="sapphire" onClick={() => fileRef.current?.click()}>
            <Upload size={12} strokeWidth={2} /> Import
          </MiniButton>
          <MiniButton
            tone="topaz"
            onClick={() => download("targets.csv", targetsToCsv(targets, groups), "text/csv")}
          >
            <Download size={12} strokeWidth={2} /> CSV
          </MiniButton>
          <MiniButton
            tone="topaz"
            onClick={() =>
              download("targets.json", JSON.stringify(targets, null, 2), "application/json")
            }
          >
            <Download size={12} strokeWidth={2} /> JSON
          </MiniButton>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = "";
            }}
          />
        </div>
      }
    >
      <p className="max-w-[760px] text-[13.5px] leading-relaxed text-muted-foreground/75">
        Hosts, IPs and services the fleet is allowed to reach — grouped by vendor or role,
        vault-bound and agent-routable. Import a CSV/TSV/host list to bulk-register a fleet of
        endpoints.
      </p>

      {/* batch import guide */}
      <div className="mt-6 glass overflow-hidden rounded-xl border border-sapphire/25">
        <button
          onClick={() => setShowImportHelp((v) => !v)}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-sapphire/[0.04]"
        >
          <Info size={13} strokeWidth={2} className="text-sapphire" />
          <span className="mono-label text-foreground/85">batch import · csv / tsv / txt</span>
          <span className="font-mono text-[11.5px] text-muted-foreground/55">
            bulk-load thousands of endpoints — recognised columns
          </span>
          <ChevronDown
            size={13}
            strokeWidth={2}
            className={cn(
              "ml-auto text-muted-foreground/60 transition-transform duration-200",
              showImportHelp && "rotate-180",
            )}
          />
        </button>
        <AnimatePresence initial={false}>
          {showImportHelp && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden border-t border-white/[0.06]"
            >
              <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                {/* column dictionary */}
                <div className="rounded-lg border border-white/[0.06] bg-raised/25 p-3">
                  <div className="mono-label text-muted-foreground/70">
                    recognised columns · case-insensitive
                  </div>
                  <div className="mt-2.5 space-y-[5px]">
                    {importColumns.map((c) => (
                      <div key={c.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="w-[104px] shrink-0 font-mono text-[12px] text-sapphire/90">
                          {c.key}
                        </span>
                        <span className="font-mono text-[11.5px] text-foreground/70">
                          {c.accepts}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground/50">
                          — {c.note}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground/55">
                    first row must be a header · multi-port cells (
                    <span className="text-topaz/80">"443,22"</span>) and ranges (
                    <span className="text-topaz/80">8000-8005</span>) fan out into endpoints
                  </p>
                </div>

                {/* example + template */}
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg border border-white/[0.06] bg-raised/25 p-3">
                    <div className="mono-label text-muted-foreground/70">csv example</div>
                    <pre className="mt-2 overflow-x-auto font-mono text-[11.5px] leading-[1.7] text-foreground/75">
                      {`name,ip,host,port,group,tags,risk_level
fw01,10.0.0.1,fw01.corp.local,"443,22",Perimeter,prod;dmz,high
fw02,10.0.0.2,fw02.corp.local,443,Perimeter,prod,high
web01,10.0.1.10,,80,Linux DMZ,prod,medium`}
                    </pre>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-raised/25 p-3">
                    <div className="mono-label text-muted-foreground/70">txt shortcut</div>
                    <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground/65">
                      one host per line — <span className="text-foreground/75">ip</span>,{" "}
                      <span className="text-foreground/75">name</span> or{" "}
                      <span className="text-foreground/75">ip:port</span>. Rows without a{" "}
                      <span className="text-foreground/75">group</span> column land in the group you
                      filtered.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <MiniButton
                      tone="emerald"
                      onClick={() =>
                        download("sovereign-targets-template.csv", importTemplateCsv, "text/csv")
                      }
                    >
                      <FileSpreadsheet size={12} strokeWidth={2} /> Download template.csv
                    </MiniButton>
                    <MiniButton tone="sapphire" onClick={() => fileRef.current?.click()}>
                      <Upload size={12} strokeWidth={2} /> Choose file
                    </MiniButton>
                    {importedNote && (
                      <span className="font-mono text-[11.5px] text-emerald/85">
                        {importedNote}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* groups */}
      <div className="mt-8 glass rounded-xl border border-white/[0.06] p-4">
        <div className="flex items-center gap-2.5">
          <span className="mono-label">target groups ({groups.length})</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setGroup("all")}
            className={cn(
              "rounded-lg border px-3 py-[6px] font-mono text-[12px] transition-all duration-150",
              group === "all"
                ? "border-sapphire/45 bg-sapphire/10 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/75 hover:text-foreground",
            )}
          >
            All · {targets.length}
          </button>
          {groups.map((g) => {
            const count = targets.filter((t) => t.groupId === g.id).length;
            const tone = kindTones[g.kind];
            return (
              <div
                key={g.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg border px-2.5 py-[5px] transition-all duration-150",
                  group === g.id ? "bg-raised/50" : "bg-raised/20",
                )}
                style={{
                  borderColor:
                    group === g.id
                      ? `color-mix(in oklab, var(--${tone}) 50%, transparent)`
                      : "rgba(255,255,255,0.06)",
                }}
              >
                <button onClick={() => setGroup(g.id)} className="flex items-center gap-2">
                  <span
                    className="size-[6px] rounded-full"
                    style={{ background: `var(--${tone})`, boxShadow: `0 0 8px var(--${tone})` }}
                  />
                  <span className="font-mono text-[12px] text-foreground/90">{g.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground/55">
                    {g.kind} · {count}
                  </span>
                </button>
                <button
                  onClick={() => setEditingGroup(g)}
                  aria-label={`Edit ${g.name}`}
                  className="text-muted-foreground/50 transition-colors hover:text-sapphire"
                  title={`Edit ${g.name}`}
                >
                  <Pencil size={11} strokeWidth={1.9} />
                </button>
                <button
                  onClick={() => removeGroup(g.id)}
                  aria-label={`Delete ${g.name}`}
                  className="text-muted-foreground/50 transition-colors hover:text-ruby"
                  title={`Delete ${g.name}`}
                >
                  <Trash2 size={11} strokeWidth={1.9} />
                </button>
              </div>
            );
          })}
          {!groups.length && (
            <span className="font-mono text-[12px] text-muted-foreground/55">
              No groups — create one (e.g. “Forti”, “Checkpoint”, “Netscaler”).
            </span>
          )}
        </div>
      </div>

      {/* registry */}
      <div className="mt-6 glass rounded-xl border border-white/[0.06] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="mono-label">targets ({visible.length})</span>
          <div className="ml-auto flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3">
            <Search size={14} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, ip, host, tag…"
              className="h-9 w-[240px] bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        <div className="mt-4 hidden grid-cols-[1.4fr_1.4fr_1fr_1fr_1fr_0.7fr_130px] gap-4 border-b border-white/[0.06] pb-2.5 lg:grid">
          {["name", "ip / host", "group", "adapter", "vault", "risk", ""].map((h, i) => (
            <div key={i} className="mono-label">
              {h}
            </div>
          ))}
        </div>

        <div className="divide-y divide-white/[0.05]">
          {visible.map((t) => {
            const g = groups.find((x) => x.id === t.groupId);
            const tone = riskTones[t.risk];
            const open = expanded === t.id;
            return (
              <div key={t.id}>
                <div className="grid gap-3 py-3 lg:grid-cols-[1.4fr_1.4fr_1fr_1fr_1fr_0.7fr_130px] lg:items-center lg:gap-4">
                  <button
                    onClick={() => setExpanded(open ? null : t.id)}
                    className="flex items-center gap-2.5 text-left"
                  >
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg border"
                      style={{
                        borderColor: `color-mix(in oklab, var(--${tone}) 35%, transparent)`,
                        boxShadow: `0 0 18px -12px var(--${tone})`,
                      }}
                    >
                      <Crosshair size={13} strokeWidth={1.7} style={{ color: `var(--${tone})` }} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] text-foreground">{t.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground/55">
                        {t.id}
                      </span>
                    </span>
                  </button>
                  <div className="font-mono text-[12.5px] text-platinum">
                    {t.ip || "—"}
                    <span className="block text-[11px] text-muted-foreground/55">
                      {t.host || "—"}
                    </span>
                  </div>
                  <div
                    className="font-mono text-[12px]"
                    style={{ color: g ? `var(--${kindTones[g.kind]})` : undefined }}
                  >
                    {g?.name ?? "— ungrouped —"}
                  </div>
                  <div className="font-mono text-[12px] text-muted-foreground/80">
                    {t.adapter || "—"}
                  </div>
                  <div className="font-mono text-[12px] text-topaz/85">
                    {t.vaultScope === "none" ? "—" : `${t.vaultScope}:${t.vaultName || "—"}`}
                  </div>
                  <div className="font-mono text-[12px]" style={{ color: `var(--${tone})` }}>
                    {t.risk}
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <Toggle on={t.enabled} onClick={() => toggleTarget(t.id, !t.enabled)} />
                    <button
                      onClick={() =>
                        t.requiresApproval
                          ? gateAction(
                              {
                                title: `Probe gated target ${t.name}`,
                                origin: "target",
                                tool: "tool.target.check",
                                target: t.name,
                                policy:
                                  "target.requiresApproval — execution against this target is human-gated",
                                risk:
                                  t.risk === "critical" || t.risk === "high"
                                    ? "critical"
                                    : "medium",
                                args: JSON.stringify({ target: t.id, action: "check" }, null, 2),
                              },
                              () => checkTarget(t.id),
                            )
                          : checkTarget(t.id)
                      }
                      aria-label="Check target"
                      className="rounded-lg border border-white/[0.07] p-1.5 text-muted-foreground/75 transition-colors hover:border-emerald/40 hover:text-emerald"
                      title="Check target"
                    >
                      <Zap size={12} strokeWidth={1.8} />
                    </button>
                    <button
                      onClick={() => setEditingTarget(t)}
                      aria-label="Edit target"
                      className="rounded-lg border border-white/[0.07] p-1.5 text-muted-foreground/75 transition-colors hover:border-sapphire/40 hover:text-sapphire"
                      title="Edit target"
                    >
                      <Pencil size={12} strokeWidth={1.8} />
                    </button>
                    <button
                      onClick={() => removeTarget(t.id)}
                      aria-label="Delete target"
                      disabled={!canEditOwned(t, ownerCtx)}
                      title={editRefusal(t, ownerCtx)}
                      className="rounded-lg border border-white/[0.07] p-1.5 text-ruby/75 transition-colors hover:border-ruby/40 hover:text-ruby disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Trash2 size={12} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mb-4 rounded-lg border border-white/[0.06] bg-raised/20 p-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {t.requiresApproval && <Tag tone="ruby">approval</Tag>}
                          {t.owner && <Tag tone="amethyst">owner · {t.owner}</Tag>}
                          {t.ports && <Tag tone="sapphire">ports · {t.ports}</Tag>}
                          {t.tags.map((tag) => (
                            <Tag key={tag} tone="platinum">
                              {tag}
                            </Tag>
                          ))}
                        </div>
                        {t.notes && (
                          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground/75">
                            {t.notes}
                          </p>
                        )}
                        <div className="mt-3 space-y-1.5">
                          {t.endpoints.map((ep) => (
                            <div
                              key={ep.id}
                              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-white/[0.05] px-3 py-2 font-mono text-[11.5px] text-muted-foreground/75"
                            >
                              {ep.primary && <span className="text-topaz">★ primary</span>}
                              <span className="text-foreground/90">{ep.label || "endpoint"}</span>
                              <span>:{ep.port || "—"}</span>
                              <span>adapter · {ep.adapter || t.adapter || "inherit"}</span>
                              <span>
                                vault ·{" "}
                                {(ep.vaultScope || t.vaultScope) === "none"
                                  ? "—"
                                  : ep.vaultScope || t.vaultScope}
                                :{ep.vaultName || t.vaultName || "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                        {t.lastCheck && (
                          <div
                            className="mt-3 rounded-lg border px-3 py-2 font-mono text-[11.5px]"
                            style={{
                              borderColor: t.lastCheck.ok
                                ? "color-mix(in oklab, var(--emerald) 35%, transparent)"
                                : "color-mix(in oklab, var(--ruby) 35%, transparent)",
                              color: t.lastCheck.ok ? "var(--emerald)" : "var(--ruby)",
                            }}
                          >
                            {t.lastCheck.ok ? "REACHABLE" : "UNREACHABLE"} · {t.lastCheck.ms}ms ·{" "}
                            {t.lastCheck.detail}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {!visible.length && (
          <p className="py-10 text-center font-mono text-[12.5px] text-muted-foreground/55">
            No targets. Add one or import from CSV / TSV / TXT.
          </p>
        )}
      </div>

      <AnimatePresence>
        {editingGroup && (
          <GroupDialog
            group={editingGroup}
            onClose={() => setEditingGroup(null)}
            onSave={saveGroup}
          />
        )}
        {editingTarget && (
          <TargetDialog
            target={editingTarget}
            groups={groups}
            adapters={adapterNames}
            vaultNames={vaultNames}
            onClose={() => setEditingTarget(null)}
            onSave={saveTarget}
          />
        )}
      </AnimatePresence>
    </Surface>
  );
}

export const Route = createFileRoute("/targets")({
  head: () => ({
    meta: [
      { title: "Targets — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Target registry: hosts, IPs and services grouped by vendor or role, bound to adapters and vault entries for one-click agent connect.",
      },
      { property: "og:title", content: "Targets — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Grouped, vault-bound, agent-routable infrastructure registry with endpoints and bulk import.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TargetsPage,
});
