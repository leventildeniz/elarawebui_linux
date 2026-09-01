import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  BookOpen,
  Bot,
  ChevronRight,
  FolderPlus,
  Lock,
  Plug,
  RefreshCw,
  Search,
  Sparkles,
  ShieldAlert,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton } from "@/components/sovereign/primitives";
import { SaveButton } from "@/components/sovereign/action-buttons";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { useAgents } from "@/lib/agent-store";
import { useSkills } from "@/lib/skill-store";
import { useForge } from "@/lib/forge-store";
import { useToolPanel } from "@/lib/tool-panel-store";
import { useMcp } from "@/lib/mcp-store";
import { useAccess } from "@/lib/rbac-store";
import {
  kindPrefix,
  kindTone,
  refKey,
  slugKey,
  useRegistry,
  type RegistryKind,
  type RegistryRoots,
} from "@/lib/registry-store";

const description =
  "Single dispatcher index for every callable surface — agent disk seeds, forge tools, skills and MCP client tools.";

export const Route = createFileRoute("/registry")({
  head: () => ({
    meta: [
      { title: "Capability Registry — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Capability Registry — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RegistryPage,
});

type Row = {
  kind: RegistryKind;
  slug: string;
  name: string;
  refId: string;
  origin: string;
};

/**
 * Scope chip — the registry is workspace-wide truth, so destructive verbs are
 * role-bound rather than owner-bound. The copy stays informational: the surface
 * is fully readable, only the listed actions sit with governance.
 */
function SealChip({ verbs }: { verbs: string[] }) {
  if (!verbs.length) return null;
  const label = verbs.includes("write") ? "view only" : "managed by governance";
  return (
    <motion.span
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      title={`Your role can read this registry. ${verbs
        .map((v) => `"${v}"`)
        .join(" and ")} ${verbs.length > 1 ? "are" : "is"} handled by an administrator.`}
      className="flex items-center gap-1.5 rounded-lg border border-topaz/30 bg-topaz/[0.06] px-2.5 py-[5px] font-mono text-[11px] uppercase tracking-[0.14em] text-topaz/85"
      style={{ boxShadow: "0 0 18px -12px var(--topaz)" }}
    >
      <ShieldAlert className="h-3 w-3" strokeWidth={1.8} />
      role scope · {label}
    </motion.span>
  );
}

/** Uniform lock copy so every refused verb reads the same across the surface. */
const sealNote = (verb: string) =>
  `Your role can view this registry — "${verb}" is handled by an administrator.`;

const kindLabels: { id: RegistryKind | "all"; label: string }[] = [
  { id: "all", label: "All kinds" },
  { id: "agent", label: "Agents" },
  { id: "skill", label: "Skills" },
  { id: "tool", label: "Tools" },
  { id: "mcp", label: "MCP tools" },
];

function RegistryPage() {
  const { agents } = useAgents();
  const { skills } = useSkills();
  const { items } = useForge();
  const { orphans } = useToolPanel();
  const { clients } = useMcp();
  const reg = useRegistry();
  const access = useAccess();
  const canWrite = access.can("write");
  const canPurge = access.can("delete");
  const sealed = [!canWrite && "write", !canPurge && "delete"].filter(Boolean) as string[];

  const [kind, setKind] = useState<RegistryKind | "all">("all");
  const [query, setQuery] = useState("");
  const [pulse, setPulse] = useState(0);

  const rows = useMemo<Row[]>(() => {
    const agentRows: Row[] = agents.map((a) => ({
      kind: "agent",
      slug: `@${slugKey(a.name)}`,
      name: a.name,
      refId: `agent.${refKey(a.name)}`,
      origin: a.squad,
    }));
    const skillRows: Row[] = skills.map((s) => ({
      kind: "skill",
      slug: slugKey(s.name),
      name: s.name,
      refId: `skill.${refKey(s.name)}`,
      origin: s.squad,
    }));
    const toolRows: Row[] = items
      .filter((t) => !orphans.includes(t.id))
      .map((t) => ({
        kind: "tool",
        slug: `/${slugKey(t.name)}`,
        name: t.name,
        refId: `tool.${refKey(t.name)}`,
        origin: t.category,
      }));
    const mcpRows: Row[] = clients
      .filter((c) => c.enabled)
      .map((c) => ({
        kind: "mcp",
        slug: `#${slugKey(c.name)}`,
        name: c.name,
        refId: `mcp.${refKey(c.name)}`,
        origin: `${c.transport} · ${c.tools} tools`,
      }));
    return [...agentRows, ...skillRows, ...toolRows, ...mcpRows].filter(
      (r) => !reg.deleted.includes(r.refId),
    );
  }, [agents, skills, items, orphans, clients, reg.deleted]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => kind === "all" || r.kind === kind)
      .filter(
        (r) =>
          !q ||
          r.slug.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.refId.toLowerCase().includes(q),
      )
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.slug.localeCompare(b.slug));
  }, [rows, kind, query]);

  const counts = useMemo(
    () => ({
      agent: rows.filter((r) => r.kind === "agent").length,
      skill: rows.filter((r) => r.kind === "skill").length,
      tool: rows.filter((r) => r.kind === "tool").length,
      mcp: rows.filter((r) => r.kind === "mcp").length,
    }),
    [rows],
  );

  return (
    <Surface
      title="Capability Registry"
      meta={`dispatcher index · ${rows.length} rows · @ agent · ! skill · / tool · # mcp`}
      wide
      crumb="Capability Registry"
      action={
        <div className="flex items-center gap-2">
          <SealChip verbs={sealed} />
          {(
            [
              ["skills", counts.skill],
              ["tools", counts.tool],
              ["agents", counts.agent],
              ["mcp", counts.mcp],
            ] as const
          ).map(([label, n]) => (
            <span
              key={label}
              className="rounded-lg border border-white/[0.08] bg-raised/40 px-2.5 py-[5px] font-mono text-[11.5px] text-muted-foreground"
            >
              {label} <span className="text-foreground/90">{n}</span>
            </span>
          ))}
          <button
            onClick={() => {
              setPulse((p) => p + 1);
              (["agents", "tools", "skills"] as const).forEach((k) => reg.markScan(k));
            }}
            className="flex items-center gap-2 rounded-lg border border-sapphire/40 bg-sapphire/10 px-3 py-[6px] text-[12.5px] font-medium text-foreground transition-colors hover:bg-sapphire/20"
            style={{ boxShadow: "0 0 18px -8px var(--sapphire)" }}
          >
            <motion.span key={pulse} animate={{ rotate: 360 }} transition={{ duration: 0.34 }}>
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
            </motion.span>
            Re-sync from sources
          </button>
        </div>
      }
    >
      <p className="max-w-[70ch] text-[14.5px] leading-relaxed text-muted-foreground">
        {description}
      </p>

      {/* discovery roots */}
      <section className="mt-10">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60">
          discovery roots — per kind
        </div>
        <div className="space-y-3">
          <RootBlock
            kind="agents"
            icon={Bot}
            tone="sapphire"
            count={counts.agent}
            reg={reg}
            canWrite={canWrite}
            canPurge={canPurge}
          />
          <RootBlock
            kind="tools"
            icon={Wrench}
            tone="amethyst"
            count={counts.tool}
            reg={reg}
            canWrite={canWrite}
            canPurge={canPurge}
          />
          <RootBlock
            kind="skills"
            icon={Sparkles}
            tone="emerald"
            count={counts.skill}
            reg={reg}
            canWrite={canWrite}
            canPurge={canPurge}
            note="Skills are primarily DB-managed (prompt templates). Disk scan picks up optional per-skill Python helpers."
          />
          <RootBlock
            kind="mcp"
            icon={Plug}
            tone="topaz"
            count={counts.mcp}
            reg={reg}
            canWrite={canWrite}
            canPurge={canPurge}
            readOnly
            note="MCP tools are discovered from registered MCP clients — no disk root required."
          />
        </div>
      </section>

      {/* filter bar */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as RegistryKind | "all")}
            className="appearance-none rounded-lg border border-white/[0.08] bg-raised/40 py-[9px] pl-3 pr-9 text-[13px] text-foreground outline-none focus:border-sapphire/50"
          >
            {kindLabels.map((k) => (
              <option key={k.id} value={k.id} className="bg-[#111113]">
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search slug / name / ref_id"
            className="w-full rounded-lg border border-white/[0.08] bg-raised/40 py-[9px] pl-9 pr-3 font-mono text-[12.5px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-sapphire/50"
          />
        </div>
        {reg.deleted.length > 0 && (
          <button
            onClick={reg.restoreAll}
            disabled={!canPurge}
            title={canPurge ? undefined : sealNote("delete")}
            className="rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[8px] text-[12.5px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            Restore {reg.deleted.length} deleted
          </button>
        )}
      </div>

      {/* table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.08]">
        <div className="grid grid-cols-[92px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_78px_44px] items-center gap-3 border-b border-white/[0.06] bg-raised/40 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground/60">
          <span>kind</span>
          <span>slug</span>
          <span>name</span>
          <span>ref_id</span>
          <span>enabled</span>
          <span />
        </div>
        <div className="max-h-[520px] overflow-y-auto">
          {visible.map((r) => {
            const on = !reg.disabled.includes(r.refId);
            const tone = kindTone[r.kind];
            return (
              <div
                key={r.refId}
                className="grid grid-cols-[92px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_78px_44px] items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 transition-colors hover:bg-raised/30"
              >
                <span
                  className="w-fit rounded-md border px-2 py-[2px] font-mono text-[10.5px] uppercase tracking-[0.08em]"
                  style={{
                    borderColor: `color-mix(in oklab, var(--${tone}) 40%, transparent)`,
                    color: `var(--${tone})`,
                    background: `color-mix(in oklab, var(--${tone}) 10%, transparent)`,
                  }}
                >
                  {r.kind}
                </span>
                <span
                  className="truncate font-mono text-[12.5px]"
                  style={{ color: `var(--${tone})` }}
                  title={r.slug}
                >
                  {r.slug}
                </span>
                <span className="truncate text-[13px] text-foreground/90">{r.name}</span>
                <span
                  className="truncate font-mono text-[12px] text-muted-foreground"
                  title={r.origin}
                >
                  {r.refId}
                </span>
                <button
                  onClick={() => reg.toggleEnabled(r.refId)}
                  aria-label={`toggle ${r.slug}`}
                  className={`relative h-[20px] w-[38px] rounded-full border transition-colors ${
                    on ? "border-sapphire/50 bg-sapphire/30" : "border-white/10 bg-white/[0.06]"
                  }`}
                  style={on ? { boxShadow: "0 0 14px -6px var(--sapphire)" } : undefined}
                  title={`toggle ${r.slug}`}
                >
                  <motion.span
                    className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-foreground"
                    animate={{ left: on ? 20 : 3 }}
                    transition={{ duration: 0.15, ease: "easeInOut" }}
                  />
                </button>
                <button
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: "Delete from registry?",
                      body: `Are you sure you want to hard delete ${r.slug}? The source definition survives in its own workspace, but it will be hidden from the dispatcher.`,
                      confirmLabel: "Delete",
                      tone: "ruby",
                    });
                    if (ok) reg.hardDelete(r.refId);
                  }}
                  aria-label={`delete ${r.slug}`}
                  disabled={!canPurge}
                  title={canPurge ? undefined : sealNote("delete")}
                  className="justify-self-end text-muted-foreground/50 transition-colors hover:text-ruby disabled:cursor-not-allowed disabled:text-muted-foreground/20 disabled:hover:text-muted-foreground/20"
                >
                  {canPurge ? (
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                  ) : (
                    <Lock className="h-3.5 w-3.5" strokeWidth={1.6} />
                  )}
                </button>
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
              No registry rows match this filter.
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground/60">
        Slug = chat dispatcher key (unique · @ agent · ! skill · / tool · # mcp). Disabling hides
        the row from the dispatcher. Hard delete only removes the registry row — the source
        definition survives in its own workspace. Roots and hard deletes are governance verbs — they
        follow the role bound to this session, not object ownership.
      </p>
    </Surface>
  );
}

function RootBlock({
  kind,
  icon: Icon,
  tone,
  count,
  reg,
  note,
  readOnly,
  canWrite,
  canPurge,
}: {
  kind: keyof RegistryRoots | "mcp";
  icon: typeof Bot;
  tone: string;
  count: number;
  reg: ReturnType<typeof useRegistry>;
  note?: string;
  readOnly?: boolean;
  canWrite: boolean;
  canPurge: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const paths = kind === "mcp" ? [] : reg.roots[kind];
  const scanned = reg.lastScan[kind];

  return (
    <div className="rounded-xl border border-white/[0.08] bg-raised/25">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-left">
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform ${open ? "rotate-90" : ""}`}
            strokeWidth={1.8}
          />
          <Icon className="h-3.5 w-3.5" strokeWidth={1.7} style={{ color: `var(--${tone})` }} />
          <span className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-foreground/90">
            {kind}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-topaz/80">
            · {scanned ? "synced" : readOnly ? "live from mcp clients" : "using defaults"}
          </span>
          {!open && paths.length > 0 && (
            <span className="font-mono text-[11px] text-muted-foreground/45">
              {paths.length} folder{paths.length > 1 ? "s" : ""}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {kind !== "agents" && !readOnly && (
            <>
              <JewelButton
                size="sm"
                variant="outline"
                disabled={!canWrite}
                title={canWrite ? undefined : sealNote("write")}
                onClick={() => {
                  setOpen(true);
                  setAdding(true);
                }}
              >
                {canWrite ? (
                  <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.6} />
                ) : (
                  <Lock className="h-3.5 w-3.5" strokeWidth={1.6} />
                )}
                Add folder
              </JewelButton>
              <JewelButton size="sm" variant="outline" onClick={() => reg.markScan(kind)}>
                Scan {kind}
              </JewelButton>
            </>
          )}
          <span
            className="rounded-lg border px-2.5 py-[5px] font-mono text-[11.5px]"
            style={{
              borderColor: `color-mix(in oklab, var(--${tone}) 35%, transparent)`,
              color: `var(--${tone})`,
            }}
          >
            {count}
          </span>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/[0.06] px-4 pb-4 pt-3">
          {adding && !readOnly && canWrite && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    reg.addRoot(kind as keyof RegistryRoots, draft);
                    setDraft("");
                    setAdding(false);
                  }
                }}
                placeholder="/absolute/path/to/folder"
                className="h-9 min-w-[260px] flex-1 rounded-lg border border-white/[0.08] bg-canvas/60 px-3 font-mono text-[12px] text-foreground outline-none focus:border-sapphire/50"
              />
              <SaveButton
                disabled={!draft.trim()}
                onSave={() => {
                  reg.addRoot(kind as keyof RegistryRoots, draft);
                  setDraft("");
                  setAdding(false);
                }}
              />
              <JewelButton
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft("");
                  setAdding(false);
                }}
              >
                Cancel
              </JewelButton>
            </div>
          )}

          {paths.length > 0 ? (
            <div className="space-y-2">
              {paths.map((p) => (
                <RootRow
                  key={p}
                  path={p}
                  onSave={(next) => reg.updateRoot(kind as keyof RegistryRoots, p, next)}
                  onDelete={() => reg.removeRoot(kind as keyof RegistryRoots, p)}
                  canWrite={canWrite}
                  canPurge={canPurge}
                />
              ))}
            </div>
          ) : (
            !adding && (
              <p className="font-mono text-[11.5px] text-muted-foreground/45">
                {readOnly ? "no disk roots — discovery is live" : "no folders registered yet"}
              </p>
            )
          )}

          {note && (
            <p className="mt-3 flex items-start gap-2 text-[12px] italic text-muted-foreground/70">
              <BookOpen className="mt-[2px] h-3 w-3 shrink-0" strokeWidth={1.6} />
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RootRow({
  path,
  onSave,
  onDelete,
  canWrite,
  canPurge,
}: {
  path: string;
  onSave: (next: string) => void;
  onDelete: () => void;
  canWrite: boolean;
  canPurge: boolean;
}) {
  const [value, setValue] = useState(path);
  const dirty = value.trim() !== path && value.trim().length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        readOnly={!canWrite}
        title={canWrite ? undefined : sealNote("write")}
        className="h-9 min-w-[260px] flex-1 rounded-lg border border-white/[0.06] bg-canvas/50 px-3 font-mono text-[12px] text-muted-foreground outline-none read-only:cursor-not-allowed read-only:opacity-60 focus:border-sapphire/50 focus:text-foreground"
      />
      <SaveButton disabled={!dirty || !canWrite} onSave={() => onSave(value)} />
      <JewelButton
        size="sm"
        variant="outline"
        disabled={!canPurge}
        title={canPurge ? undefined : sealNote("delete")}
        className="hover:border-ruby/45 hover:text-ruby"
        onClick={async () => {
          const ok = await confirmAction({
            title: "Delete discovery folder?",
            body: path,
            confirmLabel: "Delete",
            tone: "ruby",
          });
          if (ok) onDelete();
        }}
      >
        {canPurge ? (
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
        ) : (
          <Lock className="h-3.5 w-3.5" strokeWidth={1.7} />
        )}
        Delete
      </JewelButton>
    </div>
  );
}
