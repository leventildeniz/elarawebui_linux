import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Library,
  Lock,
  Plus,
  Save,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useAgents } from "@/lib/agent-store";
import { deriveRagAgent } from "@/lib/rag-agent";
import { JewelButton, Tag } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { useIdentity } from "@/lib/group-store";
import {
  ANY_GROUP,
  FILE_TYPES,
  useSpaceAccess,
  useSpaces,
  type KnowledgeSpace,
} from "@/lib/knowledge-space-store";
import { useKnowledge } from "@/lib/knowledge-store";
import { cn } from "@/lib/utils";

function slugify(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const field =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-sapphire/50";
const label = "mono-label mb-1.5 block";

/**
 * Access Spaces — who may query a knowledge domain, who may ingest into it,
 * and which file types each contributor is allowed to push.
 */
export function KnowledgeSpacesTab() {
  const { spaces, addSpace, updateSpace, removeSpace, toggleIn } = useSpaces();
  const { groups, accounts } = useIdentity();
  const { sovereign, canRead, canWrite } = useSpaceAccess();
  const k = useKnowledge();
  const { agents, create: createAgent, remove: removeAgent } = useAgents();
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState<string>(spaces[0]?.id ?? "");
  const active = spaces.find((s) => s.id === activeId) ?? spaces[0];

  const sourceCount = (id: string) => k.sources.filter((s) => s.space === id).length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-white/[0.06] bg-raised/20 px-4 py-3">
        <p className="max-w-3xl font-mono text-[11.5px] leading-relaxed text-muted-foreground/70">
          A space is the retrieval boundary. Readers can query its chunks; contributors can ingest
          into it. Anything outside a principal&apos;s readable spaces never enters their search
          results. Admin principals are sovereign — every space, every type, no ceiling.
        </p>
        <JewelButton size="sm" onClick={async () => { const id = await addSpace(); setActiveId(id); }}>
          <Plus size={13} /> New space
        </JewelButton>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="space-y-1.5">
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveId(s.id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
                s.id === active?.id
                  ? "border-sapphire/40 bg-sapphire/[0.08]"
                  : "border-white/[0.06] bg-raised/25 hover:border-white/12",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-mono text-[12.5px] text-foreground">
                  {s.name}
                </span>
                <span className="block font-mono text-[11px] text-muted-foreground/60">
                  {sourceCount(s.id)} sources · {s.allowedTypes.length || "any"} types
                </span>
              </span>
              {canWrite(s.id) ? (
                <Check size={13} className="shrink-0 text-emerald" />
              ) : canRead(s.id) ? (
                <Users size={13} className="shrink-0 text-sapphire/70" />
              ) : (
                <Lock size={13} className="shrink-0 text-muted-foreground/50" />
              )}
            </button>
          ))}
        </div>

        {active && (
          <motion.div
            key={active.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className="rounded-xl border border-white/[0.07] bg-raised/20 p-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className={label}>space name</span>
                <input
                  className={field}
                  value={active.name}
                  placeholder="e.g. Technical Documentation"
                  onChange={(e) => {
                    const name = e.target.value;
                    const autoSlug = slugify(name);
                    updateSpace(active.id, { name, slug: autoSlug || active.slug });
                  }}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="mono-label">slug (auto-generated)</span>
                  <span className="flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground/60">
                    <Lock size={11} className="text-sapphire/80" /> locked
                  </span>
                </div>
                <input
                  readOnly
                  className={cn(field, "bg-black/40 text-muted-foreground/80 cursor-default border-dashed border-white/10 select-all focus:border-white/10")}
                  value={active.slug}
                  placeholder="auto-generated-slug"
                />
              </div>
            </div>

            <div className="mt-4">
              <span className={label}>description</span>
              <input
                className={field}
                value={active.description}
                placeholder="What lives in this domain…"
                onChange={(e) => updateSpace(active.id, { description: e.target.value })}
              />
            </div>

            <MemberBlock
              title="Readers · may query"
              hint="Retrieval only returns chunks from spaces where the principal is a reader."
              space={active}
              groups={groups.map((g) => ({ id: g.id, name: g.name }))}
              accounts={accounts.map((a) => ({ id: a.id, name: `${a.username} · ${a.name}` }))}
              groupField="readerGroups"
              userField="readerUsers"
              allowAny
              toggle={toggleIn}
            />

            <MemberBlock
              title="Contributors · may upload"
              hint="Contributors can ingest and remove sources inside this space only."
              space={active}
              groups={groups.map((g) => ({ id: g.id, name: g.name }))}
              accounts={accounts.map((a) => ({ id: a.id, name: `${a.username} · ${a.name}` }))}
              groupField="contributorGroups"
              userField="contributorUsers"
              allowAny
              toggle={toggleIn}
            />

            <div className="mt-6 border-t border-border/60 pt-5">
              <span className={label}>allowed upload types</span>
              <div className="flex flex-wrap gap-1.5">
                {FILE_TYPES.map((t) => {
                  const on = active.allowedTypes.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleIn(active.id, "allowedTypes", t)}
                      className={cn(
                        "rounded-md border px-2.5 py-1 font-mono text-[11.5px] uppercase transition-colors",
                        on
                          ? "border-emerald/45 bg-emerald/[0.1] text-emerald"
                          : "border-white/[0.08] bg-raised/30 text-muted-foreground/65 hover:text-foreground",
                      )}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground/50">
                Nothing selected → every parser-supported format is accepted.
              </p>

              <div className="mt-4 max-w-[220px]">
                <span className={label}>max file size (MB)</span>
                <input
                  type="number"
                  min={1}
                  className={field}
                  value={active.maxMb}
                  onChange={(e) =>
                    updateSpace(active.id, { maxMb: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </div>
            </div>

            <RagAgentBlock
              space={active}
              agent={agents.find((a) => a.ragSpaceId === active.id)}
              sovereign={sovereign}
              canWrite={canWrite(active.id)}
              onCreate={async () => {
                const toastId = toast.loading(`Creating RAG librarian for ${active.name}...`);
                try {
                  const draft = deriveRagAgent(active);
                  const id = await createAgent(draft);
                  toast.success(`Created RAG agent "${draft.name}" for ${active.name}.`, { id: toastId });
                  navigate({ to: "/agents" });
                } catch (e: any) {
                  toast.error(e?.message || "Failed to create RAG agent.", { id: toastId });
                }
              }}
              onOpen={() => navigate({ to: "/agents" })}
            />

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-border/60 pt-5">
              <span />
              <div className="flex items-center gap-2">
                <JewelButton
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!sovereign) return;
                    const ok = await confirmAction({
                      title: `Delete space ${active.name}?`,
                      body: "Sources keep their records but lose their permission boundary.",
                      confirmLabel: "Delete",
                      tone: "ruby",
                    });
                    if (ok) {
                      /* cascade: a librarian without its space is an orphan */
                      for (const a of agents.filter((x) => x.ragSpaceId === active.id))
                        removeAgent(a.id);
                      removeSpace(active.id);
                      setActiveId(spaces.find((s) => s.id !== active.id)?.id ?? "");
                    }
                  }}
                >
                  <Trash2 size={13} /> Delete
                </JewelButton>
                <JewelButton size="sm">
                  <Save size={13} /> Saved
                </JewelButton>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function MemberBlock({
  title,
  hint,
  space,
  groups,
  accounts,
  groupField,
  userField,
  allowAny,
  toggle,
}: {
  title: string;
  hint: string;
  space: KnowledgeSpace;
  groups: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  groupField: "readerGroups" | "contributorGroups";
  userField: "readerUsers" | "contributorUsers";
  allowAny?: boolean;
  toggle: (id: string, field: keyof KnowledgeSpace, value: string) => void;
}) {
  const selGroups = space[groupField];
  const selUsers = space[userField];

  return (
    <div className="mt-6 border-t border-border/60 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={label}>{title}</span>
        {allowAny && (
          <button
            type="button"
            onClick={() => toggle(space.id, groupField, ANY_GROUP)}
            className={cn(
              "rounded-lg border px-2.5 py-[6px] font-mono text-[11px] transition-colors",
              selGroups.includes(ANY_GROUP)
                ? "border-emerald/45 bg-emerald/[0.1] text-emerald"
                : "border-white/[0.09] bg-raised/40 text-muted-foreground/70 hover:text-foreground",
            )}
          >
            everyone · {selGroups.includes(ANY_GROUP) ? "on" : "off"}
          </button>
        )}
      </div>

      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1.5 block font-mono text-[11px] text-muted-foreground/55">
            groups
          </span>
          <SearchPicker
            placeholder="+ Add group…"
            options={groups.filter((g) => !selGroups.includes(g.id))}
            onPick={(id) => toggle(space.id, groupField, id)}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selGroups.filter((id) => id !== ANY_GROUP).length === 0 && (
              <span className="font-mono text-[11px] text-muted-foreground/45">no group bound</span>
            )}
            {selGroups
              .filter((id) => id !== ANY_GROUP)
              .map((id) => {
                const g = groups.find((x) => x.id === id);
                if (!g) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-2 rounded-md border border-sapphire/45 bg-sapphire/[0.08] px-2.5 py-1 font-mono text-[11.5px] text-sapphire"
                  >
                    {g.name}
                    <button
                      type="button"
                      onClick={() => toggle(space.id, groupField, id)}
                      aria-label={`Remove ${g.name}`}
                      className="text-sapphire/60 transition-colors hover:text-ruby"
                      title={`Remove ${g.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block font-mono text-[11px] text-muted-foreground/55">
            individual principals
          </span>
          <SearchPicker
            placeholder="+ Add principal…"
            options={accounts.filter((a) => !selUsers.includes(a.id))}
            onPick={(id) => toggle(space.id, userField, id)}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selUsers.length === 0 && (
              <span className="font-mono text-[11px] text-muted-foreground/45">
                group membership only
              </span>
            )}
            {selUsers.map((id) => {
              const a = accounts.find((x) => x.id === id);
              if (!a) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-2 rounded-md border border-emerald/40 px-2.5 py-1 font-mono text-[11.5px] text-foreground"
                >
                  {a.name}
                  <button
                    type="button"
                    onClick={() => toggle(space.id, userField, id)}
                    aria-label={`Remove ${a.name}`}
                    className="text-muted-foreground/60 transition-colors hover:text-ruby"
                    title={`Remove ${a.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-2 font-mono text-[11px] text-muted-foreground/45">{hint}</p>
      {!selGroups.includes(ANY_GROUP) &&
        selGroups.filter((id) => id !== ANY_GROUP).length === 0 &&
        selUsers.length === 0 && (
          <Tag tone="topaz" className="mt-2">
            admins only
          </Tag>
        )}
    </div>
  );
}

/** Compact combobox: click to open, type to filter, pick to bind. */
function SearchPicker({
  placeholder,
  options,
  onPick,
}: {
  placeholder: string;
  options: { id: string; name: string }[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setQ("");
        }}
        className={cn(field, "flex items-center justify-between text-left")}
      >
        <span className="text-muted-foreground/70">{placeholder}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground/50 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="obsidian-slab absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[10px]">
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
              />
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {list.length === 0 && (
                <p className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground/45">
                  nothing left to bind
                </p>
              )}
              {list.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onPick(o.id);
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left font-mono text-[12px] text-muted-foreground/85 transition-colors hover:bg-raised/60 hover:text-foreground"
                >
                  {o.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One librarian per space. The button derives the whole agent from the space
 * (name, tone, description, prompt, read-only tool floor) and hard-binds it,
 * so a second agent can never contend for the same boundary.
 */
function RagAgentBlock({
  space,
  agent,
  sovereign,
  canWrite,
  onCreate,
  onOpen,
}: {
  space: KnowledgeSpace;
  agent: { id: string; name: string; enabled: boolean } | undefined;
  sovereign: boolean;
  canWrite: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const mayCreate = sovereign || canWrite;
  return (
    <div className="mt-6 border-t border-border/60 pt-5">
      <span className={label}>retrieval agent</span>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-raised/25 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Library size={14} className={agent ? "text-emerald" : "text-muted-foreground/55"} />
          <div className="min-w-0">
            <p className="truncate font-mono text-[12.5px] text-foreground">
              {agent ? agent.name : `No librarian bound to ${space.name}`}
            </p>
            <p className="font-mono text-[11px] leading-relaxed text-muted-foreground/60">
              {agent
                ? "Read-only · answers only from this space · cites every claim."
                : "Derives name, prompt, tone and a read-only tool scope from this space."}
            </p>
          </div>
        </div>
        {agent ? (
          <div className="flex items-center gap-2">
            <Tag tone={agent.enabled ? "emerald" : "ruby"}>{agent.enabled ? "live" : "halted"}</Tag>
            <JewelButton size="sm" variant="ghost" onClick={() => onOpen(agent.id)}>
              Open agent <ArrowUpRight size={13} />
            </JewelButton>
          </div>
        ) : (
          <JewelButton
            size="sm"
            onClick={onCreate}
            disabled={!mayCreate}
            title={
              mayCreate ? undefined : "Only contributors of this space may forge its librarian."
            }
          >
            <Plus size={13} /> Create RAG agent
          </JewelButton>
        )}
      </div>
    </div>
  );
}
