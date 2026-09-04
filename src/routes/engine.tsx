import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Ban as BanIcon, Plus, Shield, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, Sheen, Tag } from "@/components/sovereign/primitives";
import { emitDeny, type DenyCategory } from "@/lib/deny-events";
import { fetchApi } from "@/lib/api";

import {
  useEngine,
  defaultClassifierPrompt,
  type ClassifierMode,
  type GuardOverride,
  type RagMode,
} from "@/lib/engine-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/engine")({
  validateSearch: (search: Record<string, unknown>): { view: "intent" | "bridge" } => {
    const v = search["view"];
    return {
      view: v === "bridge" ? "bridge" : "intent",
    };
  },

  head: () => ({
    meta: [
      { title: "System Engine — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Semantic Intent Router and Orchestrator Bridge: routing thresholds, classifier mode and the agent/tool execution allowlists that govern every run.",
      },
      { property: "og:title", content: "System Engine — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Semantic Intent Router and Orchestrator Bridge: routing thresholds, classifier mode and execution allowlists.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EnginePage,
});

const field =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground outline-none transition-colors focus:border-sapphire/50";

function EnginePage() {
  const { view } = Route.useSearch();

  return (
    <Surface title="System Engine" meta="semantic intent router · orchestrator bridge" wide>
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {view === "bridge" ? <OrchestratorBridge /> : <IntentRouter />}
        </motion.div>
      </AnimatePresence>
    </Surface>
  );
}

function Panel({
  title,
  icon,
  hint,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          {icon && <span className="text-sapphire/80">{icon}</span>}
          <h2 className="text-[14.5px] font-medium tracking-tight text-foreground">{title}</h2>
        </div>
        {right}
      </header>
      {children}
      {hint && (
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted-foreground/55">
          {hint}
        </p>
      )}
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn(
            "rounded-lg border px-3 py-[5px] font-mono text-[12px] transition-all duration-150 ease-in-out",
            value === o
              ? "border-sapphire/45 bg-sapphire/12 text-sapphire shadow-[0_0_24px_-14px_var(--sapphire)]"
              : "border-white/[0.07] bg-raised/25 text-muted-foreground/80 hover:border-white/15 hover:text-foreground",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- runtime */

function IntentRouter() {
  const { config, update, reset } = useEngine();

  const [draftPrompt, setDraftPrompt] = useState(config.classifierPrompt);
  const dirtyPrompt = draftPrompt !== config.classifierPrompt;

  useEffect(() => {
    setDraftPrompt(config.classifierPrompt);
  }, [config.classifierPrompt]);

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "rounded-xl border p-5",
          config.bypassEnabled
            ? "border-emerald/30 bg-emerald/[0.05]"
            : "border-ruby/30 bg-ruby/[0.05]",
        )}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BanIcon size={14} className={config.bypassEnabled ? "text-emerald" : "text-ruby"} />
              <span className="font-mono text-[12px] tracking-[0.14em] text-foreground/90">
                {config.bypassEnabled ? "BYPASS ENABLED" : "BYPASS DISABLED"} · POLICY V4
              </span>
            </div>
            <p className="mt-2 max-w-[86ch] text-[13.5px] leading-relaxed text-muted-foreground">
              Instant template bypass removed. Every request — chit-chat or technical — flows
              through the active runtime. The router only shapes system-prompt tone (smalltalk vs
              query); it no longer routes around the model.
            </p>
          </div>
          <JewelButton
            variant={config.bypassEnabled ? "danger" : "outline"}
            size="sm"
            onClick={async () => {
              const next = !config.bypassEnabled;
              await update({ bypassEnabled: next });
              toast.success(next ? "Bypass enabled." : "Bypass disabled.");
            }}
          >
            {config.bypassEnabled ? "Disable bypass" : "Enable bypass"}
          </JewelButton>
        </div>
      </div>

      <Panel
        title="Similarity Threshold (RAG anchor)"
        hint="Query is compared to the technical/library concept vector. Below this threshold the router bypasses RAG/PostgreSQL and answers directly."
        right={
          <span className="rounded-md border border-white/[0.08] bg-raised/50 px-2.5 py-1 font-mono text-[12.5px] text-sapphire">
            {config.similarity.toFixed(2)}
          </span>
        }
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={config.similarity}
          onChange={(e) => update({ similarity: Number(e.target.value) })}
          className="w-full accent-[var(--sapphire)]"
          aria-label="Similarity threshold"
        />
      </Panel>

      <Panel
        title="Classifier Mode"
        hint="embedding → runtime cosine gate · llm → zero-shot to local LLM · hybrid → embedding first, LLM fallback."
      >
        <Segmented<ClassifierMode>
          value={config.classifier}
          options={["embedding", "llm", "hybrid"] as const}
          onChange={(v) => update({ classifier: v })}
        />
      </Panel>

      <Panel
        title="Intent Classifier Prompt"
        hint="Local LLM uses this prompt to answer 'RAG or chit-chat?'. No dictionary — intent is decided by the model."
        right={
          <div className="flex items-center gap-2">
            <JewelButton
              variant="outline"
              size="sm"
              onClick={async () => {
                const ok = await confirmAction({
                  title: "Reset classifier prompt?",
                  body: "This will restore the default intent classifier prompt. Unsaved changes will be lost.",
                  confirmLabel: "Reset",
                  cancelLabel: "Cancel",
                  tone: "ruby",
                });
                if (!ok) return;
                await update({ classifierPrompt: defaultClassifierPrompt });
                setDraftPrompt(defaultClassifierPrompt);
                toast.success("Intent classifier prompt reset to default.");
              }}
            >
              Reset
            </JewelButton>
            <JewelButton
              size="sm"
              disabled={!dirtyPrompt}
              onClick={async () => {
                await update({ classifierPrompt: draftPrompt });
                toast.success("Intent classifier prompt saved successfully.");
              }}
            >
              Save
            </JewelButton>
          </div>
        }
      >
        <textarea
          rows={5}
          value={draftPrompt}
          onChange={(e) => setDraftPrompt(e.target.value)}
          className={field}
        />
      </Panel>

      <Panel
        title="Force RAG Mode (override)"
        hint="always → bypass router, every query hits RAG · never → RAG off · auto → semantic router decides."
      >
        <Segmented<RagMode>
          value={config.ragMode}
          options={["auto", "always", "never"] as const}
          onChange={(v) => update({ ragMode: v })}
        />
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- bridge */

function OrchestratorBridge() {
  const { config, update } = useEngine();
  const [agents, setAgents] = useState<{ id: string; label: string }[]>([]);
  const [skills, setSkills] = useState<{ id: string; label: string }[]>([]);
  const [tools, setTools] = useState<{ id: string; label: string }[]>([]);
  const [mcp, setMcp] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    // Fetch live catalogs to populate dropdowns safely without relying on localStorage stores
    const fetchCatalogs = async () => {
      try {
        const [a, s, f, m] = await Promise.all([
          fetchApi("/agents").catch(() => []),
          fetchApi("/skills").catch(() => []),
          fetchApi("/forge/actions").catch(() => []),
          fetchApi("/api/mcp/client/servers").catch(() => null),
        ]);

        if (Array.isArray(a)) {
          setAgents(
            a.map((ag: { script_path?: string; name?: string; id?: string }) => ({
              id:
                ag.script_path?.split("/").pop() ||
                `${(ag.name || "").toLowerCase().replace(/\s+/g, "_")}.py`,
              label: ag.name || ag.id || "agent",
            })),
          );
        }
        if (Array.isArray(s)) {
          setSkills(
            s.map((sk: { slug?: string; id?: string; name?: string }) => ({
              id: sk.slug || sk.id || "skill",
              label: sk.name || sk.slug || "skill",
            })),
          );
        }
        if (Array.isArray(f)) {
          setTools(
            f.map((t: { id: string; name?: string }) => ({
              id: t.id,
              label: t.name || t.id,
            })),
          );
        }
        if (m && typeof m === "object" && Array.isArray((m as { servers?: unknown[] }).servers)) {
          const srvs = (m as { servers: { slug?: string; id?: string; name?: string }[] }).servers;
          // Expected DenyList format: id: "mcp.<slug>", label: "Server Name"
          setMcp(
            srvs.map((server) => ({
              id: `mcp.${server.slug || server.id}`,
              label: server.name || server.id || "server",
            })),
          );
        }
      } catch (e) {
        console.error("Failed to load bridge catalogs", e);
      }
    };
    fetchCatalogs();
  }, []);

  return (
    <div className="space-y-6">
      <Panel
        title="Intent Guard Override"
        icon={<Shield size={14} />}
        hint="Automatic: execution triggers (!cmd, @[agent.py], *.py, tool_call) override bypass; smalltalk may still bypass."
      >
        <Segmented<GuardOverride>
          value={config.guard}
          options={["auto", "force-on", "force-off"] as const}
          onChange={(v) => update({ guard: v })}
        />
      </Panel>

      <div className="rounded-xl border border-emerald/25 bg-emerald/[0.04] px-5 py-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-emerald" />
          <span className="font-mono text-[12px] tracking-[0.14em] text-foreground/90">
            DENY-LIST MODE · DEFAULT PERMIT
          </span>
        </div>
        <p className="mt-2 max-w-[86ch] text-[13.5px] leading-relaxed text-muted-foreground">
          Everything registered in the studio is permitted by default. Only the entries added below
          are blocked from the orchestrator bridge — pick them from the dropdown or type a custom
          id.
        </p>
      </div>

      <DenyList
        title="Denied Agents"
        category="agent"
        icon={<BanIcon size={14} className="text-ruby" />}
        value={config.deniedAgents}
        options={agents}
        addLabel="Add agent"
        placeholder="agent_name.py"
        hint="Blocked python agents · empty = every agent permitted."
        onChange={(v) => update({ deniedAgents: v })}
      />

      <DenyList
        title="Denied Tools"
        category="tool"
        icon={<BanIcon size={14} className="text-ruby" />}
        value={config.deniedTools}
        options={tools}
        addLabel="Add tool"
        placeholder="tool.slug"
        hint="Blocked from auto-trigger · syncs with the Tools page Arm/Disarm shield."
        onChange={(v) => update({ deniedTools: v })}
      />

      <DenyList
        title="Denied Skills"
        category="skill"
        icon={<BanIcon size={14} className="text-ruby" />}
        value={config.deniedSkills}
        options={skills}
        addLabel="Add skill"
        placeholder="skill-slug"
        hint="Blocked skills · empty = every skill in the Skills Engine permitted."
        onChange={(v) => update({ deniedSkills: v })}
      />

      <DenyList
        title="Denied MCP Clients"
        category="mcp"
        icon={<BanIcon size={14} className="text-ruby" />}
        value={config.deniedMcp}
        options={mcp}
        addLabel="Add MCP client"
        placeholder="mcp-client-id"
        hint="This studio is the MCP server · these are the connected MCP clients. Blocked clients never reach the dispatcher (# sigil)."
        onChange={(v) => update({ deniedMcp: v })}
      />
    </div>
  );
}

type DenyOption = { id: string; label: string };

function DenyList({
  title,
  icon,
  category,
  value,
  options,
  addLabel,
  placeholder,
  hint,
  onChange,
}: {
  title: string;
  icon: React.ReactNode;
  category: DenyCategory;
  value: string;
  options: DenyOption[];
  addLabel: string;
  placeholder: string;
  hint: string;
  onChange: (v: string) => void;
}) {
  const entries = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const commit = (next: string[]) => onChange([...new Set(next)].join(", "));
  const labelFor = (id: string) => options.find((o) => o.id === id)?.label || id;
  const add = (id: string) => {
    const clean = id.trim();
    if (!clean) return;
    if (entries.includes(clean)) {
      setManual("");
      setOpen(false);
      return;
    }
    commit([...entries, clean]);
    emitDeny({ category, action: "deny.add", target: clean, label: labelFor(clean) });
    setManual("");
    setOpen(false);
  };

  const available = options.filter((o) => !entries.includes(o.id));

  return (
    <Panel
      title={title}
      icon={icon}
      hint={hint}
      right={
        <div className="flex items-center gap-2">
          <Tag tone={entries.length ? "ruby" : "emerald"}>
            {entries.length ? `${entries.length} denied` : "all permitted"}
          </Tag>
          <div className="relative" ref={boxRef}>
            <JewelButton variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
              <Plus size={13} className="mr-1" /> {addLabel}
            </JewelButton>
            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.14 }}
                  className="absolute right-0 z-30 mt-2 w-[300px] rounded-xl border border-white/[0.08] bg-raised/95 p-2 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
                >
                  <div className="max-h-[240px] overflow-y-auto">
                    {available.length === 0 && (
                      <p className="px-2 py-3 font-mono text-[11.5px] text-muted-foreground">
                        nothing left to deny
                      </p>
                    )}
                    {available.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => add(o.id)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground/85 transition-colors hover:bg-white/[0.05]"
                      >
                        <span className="truncate">{o.label}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {o.id}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2 border-t border-white/[0.06] pt-2">
                    <input
                      value={manual}
                      placeholder={placeholder}
                      onChange={(e) => setManual(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          add(manual);
                        }
                      }}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-canvas/60 px-2.5 font-mono text-[12px] text-foreground outline-none focus:border-sapphire/40"
                    />
                    <JewelButton size="sm" onClick={() => add(manual)}>
                      Add
                    </JewelButton>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      }
    >
      {entries.length === 0 ? (
        <p className="font-mono text-[12px] text-muted-foreground">
          no denials · everything in this category is permitted
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {entries.map((id) => (
            <span
              key={id}
              className="group inline-flex items-center gap-2 rounded-lg border border-ruby/25 bg-ruby/[0.07] px-2.5 py-1.5 font-mono text-[12px] text-foreground/90"
            >
              {id}
              <button
                type="button"
                aria-label={`Remove ${id}`}
                onClick={() => {
                  commit(entries.filter((e) => e !== id));
                  emitDeny({ category, action: "deny.remove", target: id, label: labelFor(id) });
                }}
                className="text-muted-foreground transition-colors hover:text-ruby"
                title={`Remove ${id}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3">
        <Sheen />
      </div>
      <div className="mt-3 flex justify-end">
        <JewelButton
          variant="outline"
          size="sm"
          disabled={entries.length === 0}
          onClick={async () => {
            const ok = await confirmAction({
              title: `Clear ${title.toLowerCase()}?`,
              body: "Every entry in this deny list will be removed and the category becomes fully permitted.",
              confirmLabel: "Clear",
              cancelLabel: "Cancel",
              tone: "ruby",
            });
            if (!ok) return;
            emitDeny({ category, action: "deny.clear", target: category, label: title });
            onChange("");
          }}
        >
          Clear all
        </JewelButton>
      </div>
    </Panel>
  );
}

