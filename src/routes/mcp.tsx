import { useMemo, useState } from "react";
import { canEdit as canEditOwned, editRefusal } from "@/lib/ownership";
import { SharePopover } from "@/components/sovereign/ownership-controls";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot,
  Check,
  Copy,
  KeyRound,
  Plug,
  Plus,
  Search,
  Server,
  Sparkles,
  Trash2,
  Wrench,
  X,
  Activity,
} from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton, StatusDot, Tag } from "@/components/sovereign/primitives";
import { VaultKeyField } from "@/components/sovereign/vault-key-field";
import { confirmAction } from "@/components/sovereign/confirm-dialog";

import { useAgents } from "@/lib/agent-store";
import { useSkills } from "@/lib/skill-store";
import { useForge } from "@/lib/forge-store";
import {
  mcpIsolationSeed,
  resolveSandbox,
  useCollection,
  type IsolationProfile,
} from "@/lib/security-store";
import {
  authModes,
  emptyClient,
  useMcp,
  type McpAuthMode,
  type McpClientServer,
} from "@/lib/mcp-store";
import { gateAction } from "@/lib/approval-gate";
import { cn, fmtDate, fmtTime } from "@/lib/utils";
import { useAuthProviders } from "@/lib/auth-provider-store";
import { toast } from "sonner";

export const Route = createFileRoute("/mcp")({
  validateSearch: (search: Record<string, unknown>): { view: "server" | "client" } => ({
    view: search["view"] === "client" ? "client" : "server",
  }),
  head: () => ({
    meta: [
      { title: "MCP — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Expose studio agents, skills and tools over the Model Context Protocol, and connect the fleet to external MCP servers.",
      },
      { property: "og:title", content: "MCP — Elara Sovereign Studio" },
      {
        property: "og:description",
        content:
          "Expose studio agents, skills and tools over the Model Context Protocol, and connect the fleet to external MCP servers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: McpPage,
});

const field =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-sapphire/50";
const label = "mono-label mb-1.5 block";

type Group = "agents" | "skills" | "tools";
type Entity = { id: string; name: string; hint: string };

function McpPage() {
  const { view: tab } = Route.useSearch();

  return (
    <Surface title="MCP" meta="model context protocol · server + client" wide>
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {tab === "server" ? <ServerTab /> : <ClientTab />}
        </motion.div>
      </AnimatePresence>
    </Surface>
  );
}

/* ------------------------------------------------------------------ server */

function CopyTokenButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(token);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-md p-1.5 text-muted-foreground/70 transition-colors hover:bg-raised hover:text-foreground"
      aria-label="Copy token"
      title="Copy token"
    >
      {copied ? <Check size={13} className="text-emerald" /> : <Copy size={13} />}
    </button>
  );
}

function ServerTab() {
  const mcp = useMcp();
  const { agents } = useAgents();
  const { skills } = useSkills();
  const { items } = useForge();
  const { providers } = useAuthProviders();
  const [manage, setManage] = useState<Group | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenLabel, setTokenLabel] = useState("");

  const catalog: Record<Group, Entity[]> = useMemo(
    () => ({
      agents: agents.map((a) => ({ id: a.id, name: a.name, hint: a.role ?? a.id })),
      skills: skills.map((s) => ({ id: s.id, name: s.name, hint: s.id })),
      tools: items.map((t) => ({ id: t.id, name: t.name, hint: `${t.kind} · ${t.category}` })),
    }),
    [agents, skills, items],
  );

  const endpoint = `http://127.0.0.1:8787/mcp/${mcp.server.namespace}`;
  const exposedTotal =
    mcp.server.exposed.agents.length +
    mcp.server.exposed.skills.length +
    mcp.server.exposed.tools.length;

  const copy = () => {
    navigator.clipboard?.writeText(endpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const groups: {
    id: Group;
    label: string;
    icon: React.ReactNode;
    tone: "sapphire" | "emerald" | "amethyst";
  }[] = [
    { id: "agents", label: "Agents", icon: <Bot size={14} />, tone: "sapphire" },
    { id: "skills", label: "Skills", icon: <Sparkles size={14} />, tone: "amethyst" },
    { id: "tools", label: "Tools", icon: <Wrench size={14} />, tone: "emerald" },
  ];

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <StatusDot
                tone={mcp.server.enabled ? "emerald" : "ruby"}
                pulse={mcp.server.enabled}
              />
              <h2 className="text-[16.5px] font-medium tracking-tight text-foreground">
                MCP Server
              </h2>
              <Tag tone={mcp.server.enabled ? "emerald" : "ruby"}>
                {mcp.server.enabled ? "online" : "offline"}
              </Tag>
            </div>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
              Publish selected studio agents, skills and tools to external MCP hosts such as Claude
              Desktop, Cursor or your own client.
            </p>
          </div>
          <Switch
            checked={mcp.server.enabled}
            onChange={(v) => mcp.patchServer({ enabled: v })}
            aria-label="Enable MCP server"
          />
        </div>

        <div className="mt-6 flex items-center gap-2 rounded-lg border border-white/[0.07] bg-raised/30 px-3 py-2.5">
          <span className="mono-label shrink-0">endpoint</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-sapphire">
            {endpoint}
          </code>
          <button
            type="button"
            onClick={copy}
            className="rounded-md p-1.5 text-muted-foreground/70 transition-colors hover:bg-raised hover:text-foreground"
            aria-label="Copy endpoint"
            title="Copy endpoint"
          >
            {copied ? <Check size={14} className="text-emerald" /> : <Copy size={14} />}
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <span className={label}>auth mode</span>
            <select
              className={cn(field, "appearance-none bg-canvas")}
              value={mcp.server.auth}
              onChange={(e) => mcp.patchServer({ auth: e.target.value as McpAuthMode })}
            >
              {authModes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground/70">
              {authModes.find((m) => m.id === mcp.server.auth)?.hint}
            </p>
          </div>
          <div>
            <span className={label}>namespace</span>
            <input
              className={field}
              value={mcp.server.namespace}
              onChange={(e) => mcp.patchServer({ namespace: e.target.value.replace(/\s+/g, "-") })}
            />
          </div>
          <div>
            <span className={label}>rate limit (req/min)</span>
            <input
              type="number"
              min={1}
              className={field}
              value={mcp.server.rateLimit}
              onChange={(e) => mcp.patchServer({ rateLimit: Number(e.target.value) || 1 })}
            />
          </div>
        </div>

        {["oauth2", "oidc", "entra"].includes(mcp.server.auth) && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <span className={label}>primary provider</span>
              <select
                className={cn(field, "appearance-none bg-canvas")}
                value={mcp.server.authSourceKey || ""}
                onChange={(e) => mcp.patchServer({ authSourceKey: e.target.value })}
              >
                <option value="" disabled>Select primary identity source…</option>
                {providers.filter(p => p.id === mcp.server.auth).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label || p.id} ({p.id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className={label}>fallback provider (optional)</span>
              <select
                className={cn(field, "appearance-none bg-canvas")}
                value={mcp.server.authFallbackKey || ""}
                onChange={(e) => mcp.patchServer({ authFallbackKey: e.target.value || null })}
              >
                <option value="">None</option>
                {providers.filter(p => p.id === mcp.server.auth && p.key !== mcp.server.authSourceKey).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label || p.id} ({p.id})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.05] sm:grid-cols-4">
          <Stat label="exposed" value={String(exposedTotal)} />
          <Stat label="tokens" value={String(mcp.tokens.length)} />
          <Stat label="clients" value={String(mcp.clients.length)} />
          <Stat label="rate cap" value={`${mcp.server.rateLimit}/min`} />
        </div>
      </Panel>

      <Panel>
        <SectionTitle title="Exposures" hint="Only selected entities are callable over MCP." />
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {groups.map((g) => {
            const total = catalog[g.id].length;
            const selected = mcp.server.exposed[g.id];
            const exposedEntities = catalog[g.id].filter((e) => selected.includes(e.id));
            return (
              <div
                key={g.id}
                className="flex min-h-[220px] flex-col rounded-xl border border-white/[0.06] bg-raised/25 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span style={{ color: `var(--${g.tone})` }}>{g.icon}</span>
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium text-foreground">{g.label}</div>
                      <div className="font-mono text-[11.5px] text-muted-foreground/70">
                        {exposedEntities.length} of {total} exposed
                      </div>
                    </div>
                  </div>
                  <JewelButton size="sm" variant="outline" onClick={() => setManage(g.id)}>
                    Manage
                  </JewelButton>
                </div>

                <div className="mt-4 flex flex-1 flex-wrap content-start gap-1.5">
                  {exposedEntities.length === 0 ? (
                    <p className="w-full rounded-lg border border-dashed border-white/[0.08] px-3 py-6 text-center font-mono text-[11.5px] text-muted-foreground/60">
                      nothing exposed — this group is not callable
                    </p>
                  ) : (
                    exposedEntities.map((e) => (
                      <span
                        key={e.id}
                        title={e.hint}
                        className="group inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11.5px]"
                        style={{
                          borderColor: `color-mix(in oklab, var(--${g.tone}) 35%, transparent)`,
                          background: `color-mix(in oklab, var(--${g.tone}) 10%, transparent)`,
                          color: `var(--${g.tone})`,
                        }}
                      >
                        <span className="truncate">{e.name}</span>
                        <button
                          type="button"
                          onClick={() => mcp.toggleExposure(g.id, e.id)}
                          className="opacity-50 transition-opacity hover:opacity-100"
                          aria-label={`Unexpose ${e.name}`}
                          title={`Unexpose ${e.name}`}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {mcp.server.auth === "bearer" && (
        <Panel>
          <SectionTitle title="Bearer tokens" hint="Issued once — store them in your MCP host." />
          <div className="mt-4 flex gap-2">
            <input
              className={field}
              placeholder="Token label (e.g. claude-desktop)"
              value={tokenLabel}
              onChange={(e) => setTokenLabel(e.target.value)}
            />
            <JewelButton
              size="sm"
              className="shrink-0"
              onClick={async () => {
                if (!tokenLabel.trim()) return;
                await mcp.createToken(tokenLabel);
                setTokenLabel("");
              }}
            >
              <KeyRound size={13} /> Create
            </JewelButton>
          </div>

          <div className="mt-4 space-y-1.5">
            {mcp.tokens.length === 0 && (
              <p className="py-4 text-center text-[13px] text-muted-foreground/70">
                No tokens issued yet.
              </p>
            )}
            {mcp.tokens.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.06] bg-raised/25 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] text-foreground">{t.label}</div>
                  <div className="font-mono text-[11.5px] text-muted-foreground/65 flex items-center gap-2">
                    {t.rawToken ? (
                      <>
                        <span className="text-sapphire font-bold selection:bg-sapphire/20">
                          {t.rawToken}
                        </span>
                        <CopyTokenButton token={t.rawToken} />
                      </>
                    ) : (
                      <span>{t.prefix}…</span>
                    )}
                    <span className="opacity-50">·</span> created {fmtDate(t.createdAt)} <span className="opacity-50">·</span>{" "}
                    {t.lastUsed
                      ? `last used ${fmtTime(t.lastUsed)}`
                      : "never used"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: "Revoke token?",
                      body: `The token "${t.label}" will be permanently revoked and any connected MCP client using it will immediately lose access.`,
                      confirmLabel: "Revoke",
                      tone: "ruby",
                    });
                    if (ok) mcp.removeToken(t.id);
                  }}
                  className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-ruby/10 hover:text-ruby"
                  aria-label={`Revoke ${t.label}`}
                  title={`Revoke ${t.label}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <AnimatePresence>
        {manage && (
          <ExposureDialog
            group={manage}
            entities={catalog[manage]}
            selected={mcp.server.exposed[manage]}
            onToggle={(id) => mcp.toggleExposure(manage, id)}
            onSetAll={(ids) => mcp.setExposureGroup(manage, ids)}
            onClose={() => setManage(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ExposureDialog({
  group,
  entities,
  selected,
  onToggle,
  onSetAll,
  onClose,
}: {
  group: Group;
  entities: Entity[];
  selected: string[];
  onToggle: (id: string) => void;
  onSetAll: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = entities.filter(
    (e) =>
      e.name.toLowerCase().includes(q.toLowerCase()) ||
      e.hint.toLowerCase().includes(q.toLowerCase()),
  );
  const allOn = entities.length > 0 && selected.length === entities.length;

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
            <h3 className="text-[17px] font-medium capitalize tracking-tight text-foreground">
              Expose {group}
            </h3>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground/75">
              {selected.length} of {entities.length} published over MCP.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" title="Close">
            <X
              size={16}
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
            />
          </button>
        </div>

        <div className="mt-5 flex gap-2">
          <div className="relative flex-1">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
            />
            <input
              className={cn(field, "pl-8")}
              placeholder={`Search ${group}…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <JewelButton
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => onSetAll(allOn ? [] : entities.map((e) => e.id))}
          >
            {allOn ? "Clear all" : "Select all"}
          </JewelButton>
        </div>

        <div className="mt-4 max-h-[380px] space-y-1 overflow-y-auto pr-1">
          {filtered.map((e) => {
            const on = selected.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onToggle(e.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                  on
                    ? "border-sapphire/35 bg-sapphire/[0.08]"
                    : "border-white/[0.06] bg-raised/20 hover:border-white/15",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] text-foreground">{e.name}</div>
                  <div className="truncate font-mono text-[11.5px] text-muted-foreground/65">
                    {e.hint}
                  </div>
                </div>
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    on ? "border-sapphire bg-sapphire/25 text-sapphire" : "border-white/15",
                  )}
                >
                  {on && <Check size={11} />}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-[13px] text-muted-foreground/70">No matches.</p>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <JewelButton size="sm" onClick={onClose}>
            Done
          </JewelButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

import { stampOwner } from "@/lib/ownership";

/* ------------------------------------------------------------------ client */

function ClientTab() {
  const mcp = useMcp();
  const mcpIsolation = useCollection<IsolationProfile>(
    "sovereign.security.mcp-isolation",
    mcpIsolationSeed,
    "miso",
  );
  const [draft, setDraft] = useState<McpClientServer | null>(null);

  const open = (c?: McpClientServer) =>
    setDraft(
      c ?? stampOwner({
        ...emptyClient,
        id: `mcp.${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      } as McpClientServer, "workspace")
    );

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Plug size={15} className="text-emerald" />
              <h2 className="text-[16.5px] font-medium tracking-tight text-foreground">
                MCP Client
              </h2>
              <Tag tone="emerald">{mcp.clients.length} servers</Tag>
            </div>
            <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
              Connect the studio to external MCP servers. Auto-inject makes a server's tools
              available to every agent in the fleet.
            </p>
          </div>
          <JewelButton size="sm" onClick={() => open()}>
            <Plus size={13} /> Add server
          </JewelButton>
        </div>
      </Panel>

      {mcp.clients.length === 0 ? (
        <Panel>
          <p className="py-8 text-center text-[13.5px] text-muted-foreground/75">
            No MCP servers connected yet. Click <span className="text-foreground">Add server</span>{" "}
            to register one.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {mcp.clients.map((c) => (
            <div
              key={c.id}
              className="glass rounded-xl border border-white/[0.07] p-5 transition-shadow duration-300 hover:shadow-[0_0_38px_-24px_var(--sapphire)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusDot tone={c.enabled ? "emerald" : "ruby"} />
                    <span className="truncate text-[15px] font-medium text-foreground">
                      {c.name}
                    </span>
                  </div>
                  <div className="mt-1.5 truncate font-mono text-[11.5px] text-muted-foreground/70">
                    {c.transport.toUpperCase()} · {c.url || "—"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <SharePopover
                    record={c}
                    ctx={mcp.ctx}
                    disabled={!canEditOwned(c, mcp.ctx)}
                    reason={editRefusal(c, mcp.ctx)}
                    onChange={(patch) => mcp.saveClient({ ...c, ...patch })}
                  />
                  <Switch
                    checked={c.enabled}
                    onChange={(v) =>
                      canEditOwned(c, mcp.ctx) && mcp.saveClient({ ...c, enabled: v })
                    }
                    aria-label={`Enable ${c.name}`}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Tag tone={c.autoInject ? "sapphire" : "platinum"}>
                  {c.autoInject ? "auto-inject" : "manual"}
                </Tag>
                <Tag tone="amethyst">{c.tools} tools</Tag>
                {(() => {
                  const box = resolveSandbox(mcpIsolation.items, c.id);
                  return (
                    <Tag tone={box ? "emerald" : "ruby"}>
                      {box ? `sandbox · ${box.name}` : "no sandbox"}
                    </Tag>
                  );
                })()}
              </div>

              <div className="mt-4 flex gap-2">
                <JewelButton 
                  size="sm" 
                  variant="outline" 
                  onClick={() => {
                     toast.promise(mcp.probeClient(c.id), {
                         loading: 'Probing tools...',
                         success: 'Tools updated',
                         error: 'Probe failed'
                     });
                  }}
                  title="Probe server to refresh tools"
                >
                  <Activity size={13} /> Probe
                </JewelButton>
                <JewelButton size="sm" variant="outline" onClick={() => open(c)}>
                  Edit
                </JewelButton>
                <JewelButton
                  size="sm"
                  variant="ghost"
                  className="text-ruby hover:text-ruby hover:bg-ruby/10"
                  disabled={!canEditOwned(c, mcp.ctx)}
                  title={editRefusal(c, mcp.ctx)}
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: "Delete MCP client?",
                      body: `The connection to "${c.name}" will be removed. Tools imported from this client will become unavailable.`,
                      confirmLabel: "Delete client",
                      tone: "ruby",
                    });
                    if (ok) mcp.removeClient(c.id);
                  }}
                >
                  <Trash2 size={13} /> Delete
                </JewelButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {draft && (
          <ClientDialog
            draft={draft}
            onChange={setDraft}
            onClose={() => setDraft(null)}
            onSave={async () => {
              try {
                if (!draft.name.trim()) {
                  toast.error("Name is required");
                  return;
                }
                if (draft.transport !== "stdio" && !draft.url.trim()) {
                  toast.error("URL is required for HTTP/SSE transport");
                  return;
                }
                if (draft.transport === "stdio" && !draft.url.trim()) {
                  toast.error("Command is required for stdio transport");
                  return;
                }

                const known = mcp.clients.some((c) => c.id === draft.id);
                if (known) {
                  await mcp.saveClient(draft);
                  setDraft(null);
                } else {
                  gateAction(
                    {
                      title: `Trust new MCP server ${draft.name || draft.id}`,
                      origin: "credential",
                      tool: "tool.mcp.trust",
                      target: draft.url || draft.name || draft.id,
                      policy: "pol.mcp.trust — unknown MCP endpoints require review",
                      risk: "medium",
                      args: JSON.stringify(
                        { id: draft.id, name: draft.name, url: draft.url },
                        null,
                        2,
                      ),
                    },
                    () => {
                      mcp.saveClient(draft).catch(err => {
                        toast.error(err.message || "Failed to save MCP client");
                      });
                    }
                  );
                  setDraft(null);
                }
              } catch (err: any) {
                toast.error(err.message || "Failed to save MCP client");
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ClientDialog({
  draft,
  onChange,
  onClose,
  onSave,
}: {
  draft: McpClientServer;
  onChange: (c: McpClientServer) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const set = (p: Partial<McpClientServer>) => onChange({ ...draft, ...p });

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
        className="glass my-6 w-full max-w-[560px] rounded-xl border border-sapphire/30 p-6 shadow-[0_0_80px_-40px_var(--sapphire)]"
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[17px] font-medium tracking-tight text-foreground">MCP server</h3>
          <button onClick={onClose} aria-label="Close" title="Close">
            <X
              size={16}
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
            />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <span className={label}>name</span>
            <input
              className={field}
              value={draft.name}
              placeholder="GitHub MCP"
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <div>
              <span className={label}>transport</span>
              <select
                className={cn(field, "appearance-none bg-canvas")}
                value={draft.transport}
                onChange={(e) => set({ transport: e.target.value as McpClientServer["transport"] })}
              >
                <option value="http">HTTP</option>
                <option value="sse">SSE</option>
                <option value="stdio">STDIO</option>
              </select>
            </div>
            {draft.transport === "stdio" ? (
              <div className="grid gap-4 grid-cols-2">
                <div>
                  <span className={label}>command</span>
                  <input
                    className={field}
                    value={draft.url?.split(" ")[0] || ""}
                    placeholder="npx"
                    onChange={(e) => {
                      const argsPart = draft.url?.split(" ").slice(1).join(" ") || "";
                      set({ url: `${e.target.value} ${argsPart}`.trim() });
                    }}
                  />
                </div>
                <div>
                  <span className={label}>arguments</span>
                  <input
                    className={field}
                    value={draft.url?.split(" ").slice(1).join(" ") || ""}
                    placeholder="-y @acme/mcp"
                    onChange={(e) => {
                      const cmdPart = draft.url?.split(" ")[0] || "";
                      set({ url: `${cmdPart} ${e.target.value}`.trim() });
                    }}
                  />
                </div>
              </div>
            ) : (
              <div>
                <span className={label}>url</span>
                <input
                  className={field}
                  value={draft.url}
                  placeholder="https://mcp.example.com/mcp"
                  onChange={(e) => set({ url: e.target.value })}
                />
              </div>
            )}
          </div>
          <div>
            <span className={label}>bearer token (vault or manual · optional)</span>
            <VaultKeyField
              value={draft.token}
              onChange={(token) => set({ token })}
              placeholder="sk_…"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-raised/25 px-4 py-3">
            <div>
              <div className="text-[13.5px] text-foreground">Auto-inject tools</div>
              <div className="text-[11.5px] text-muted-foreground/70">
                Make this server's tools available to every agent.
              </div>
            </div>
            <Switch
              checked={draft.autoInject}
              onChange={(v) => set({ autoInject: v })}
              aria-label="Auto-inject tools"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <JewelButton size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </JewelButton>
          <JewelButton size="sm" onClick={onSave}>
            Save
          </JewelButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ shared */

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="glass rounded-xl border border-white/[0.07] p-6">{children}</div>;
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-[16.5px] font-medium tracking-tight text-foreground">{title}</h2>
      <p className="mt-1.5 text-[12.5px] text-muted-foreground/75">{hint}</p>
    </div>
  );
}

function Stat({ label: l, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel/60 px-4 py-3">
      <div className="mono-label">{l}</div>
      <div className="mt-1 font-mono text-[15px] text-foreground">{value}</div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  ...rest
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[22px] w-[40px] shrink-0 rounded-full border transition-colors duration-200",
        checked ? "border-sapphire/50 bg-sapphire/25" : "border-white/10 bg-raised/60",
      )}
      {...rest}
    >
      <motion.span
        animate={{ x: checked ? 19 : 2 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className={cn(
          "absolute top-[2px] block h-[16px] w-[16px] rounded-full",
          checked ? "bg-sapphire shadow-[0_0_12px_-2px_var(--sapphire)]" : "bg-muted-foreground/60",
        )}
      />
    </button>
  );
}
