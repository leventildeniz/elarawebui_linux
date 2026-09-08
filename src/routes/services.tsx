import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Activity, CheckCircle2, Database, HardDrive, Layers, Network, Plug, Plus, RefreshCw, RotateCcw, Server, Shield, Trash2, Zap } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { ResetButton, SaveButton } from "@/components/sovereign/action-buttons";
import { JewelButton } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { VaultKeyField } from "@/components/sovereign/vault-key-field";
import { cn } from "@/lib/utils";
import { fetchApi } from "@/lib/api";

const description =
  "Background services tower — probes, systemd and launchd lifecycle control, transport and credential bindings for every studio service.";

export const Route = createFileRoute("/services")({
  head: () => ({
    meta: [
      { title: "Services — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Services — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ServicesPage,
});

const labelCls =
  "mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60";
const fieldCls =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-sapphire/50";

type Manager = "systemd" | "launchd" | "custom";
type Transport = "local-agent" | "ssh";

type SearchProviderType = "duckduckgo" | "tavily" | "searxng" | "brave";

type SearchProvider = {
  id: string;
  name: string;
  provider_type: SearchProviderType;
  base_url: string;
  api_key_ref: string;
  priority: number;
  active: boolean;
};

const emptySearchDraft: Omit<SearchProvider, "id"> = {
  name: "",
  provider_type: "tavily",
  base_url: "",
  api_key_ref: "",
  priority: 5,
  active: true,
};

type Service = {
  id: string;
  key: string;
  name: string;
  kind: string;
  probe: string;
  username: string;
  /** vault entry id or `raw://<raw>` */
  credential: string;
  manager: Manager;
  unit: string;
  sudo: boolean;
  transport: Transport;
  host: string;
  startCmd: string;
  stopCmd: string;
  restartCmd: string;
  statusCmd: string;
  online: boolean;
  detail: string;
};

const emptyDraft = {
  key: "",
  name: "",
  kind: "HTTP probe",
  probe: "",
  username: "",
  credential: "",
  manager: "systemd" as Manager,
  unit: "",
  sudo: true,
  transport: "local-agent" as Transport,
  host: "",
  startCmd: "",
  stopCmd: "",
  restartCmd: "",
  statusCmd: "",
};

type Draft = typeof emptyDraft;

const serviceKinds = [
  "HTTP probe",
  "Postgres",
  "Redis / Valkey",
  "Ollama / Local runtime",
  "Custom daemon",
] as const;

const KINDS = serviceKinds;
const STORE_KEY = "sovereign.services.tower";

const defaultService: Service = {
  id: "svc.default",
  key: "default",
  name: "Service",
  kind: "HTTP probe",
  probe: "http://127.0.0.1:8080/health",
  username: "",
  credential: "",
  manager: "systemd",
  unit: "",
  sudo: false,
  transport: "local-agent",
  host: "",
  startCmd: "",
  stopCmd: "",
  restartCmd: "",
  statusCmd: "",
  online: false,
  detail: "",
};

/** derives the lifecycle command for a manager + unit pair */
function lifecycleCmd(
  action: "start" | "stop" | "restart" | "status",
  d: Pick<Draft, "manager" | "unit" | "sudo">,
) {
  const unit = d.unit.trim() || "my-service";
  const sudo = d.sudo ? "sudo " : "";
  if (d.manager === "systemd") {
    return action === "status"
      ? `systemctl is-active ${unit}`
      : `${sudo}systemctl ${action} ${unit}`;
  }
  if (d.manager === "launchd") {
    const target = unit.includes("/") ? unit : `system/${unit}`;
    if (action === "status") return `launchctl print ${target}`;
    if (action === "restart") return `${sudo}launchctl kickstart -k ${target}`;
    return `${sudo}launchctl ${action === "start" ? "kickstart" : "kill SIGTERM"} ${target}`;
  }
  return "";
}

function normalize(s: Partial<Service>): Service {
  return { ...defaultService, ...s } as Service;
}

function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [ready, setReady] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft });

  // Web Search Providers State
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [addingProvider, setAddingProvider] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [draftProvider, setDraftProvider] = useState<Omit<SearchProvider, "id">>({
    ...emptySearchDraft,
  });

  const fetchServices = useCallback(async () => {
    try {
      const data = await fetchApi("/api/system/services");
      if (Array.isArray(data) && data.length > 0) {
        setServices(data.map(normalize));
      } else {
        setServices([]);
      }
    } catch (err) {
      console.error("Failed to load services from API", err);
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setServices((JSON.parse(raw) as Partial<Service>[]).map(normalize));
    }
    setReady(true);
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const data = await fetchApi("/api/search-providers");
      if (Array.isArray(data)) setProviders(data);
    } catch (err) {
      console.error("Failed to load search providers", err);
    }
  }, []);

  useEffect(() => {
    fetchServices();
    fetchProviders();
    const timer = setInterval(fetchServices, 10000);
    return () => clearInterval(timer);
  }, [fetchServices, fetchProviders]);

  const add = async () => {
    if (!draft.key.trim()) return;
    const newService = {
      ...draft,
      key: draft.key.trim(),
      name: draft.name || draft.key.trim(),
    };
    try {
      const data = await fetchApi("/system/services", {
        method: "POST",
        body: JSON.stringify(newService),
      });
      setServices((s) => [
        ...s,
        {
          ...newService,
          id: data.id,
          online: false,
          detail: "PENDING · not probed yet",
        } as Service,
      ]);
    } catch (e) {
      console.error("Failed to add service", e);
    }
    setDraft({ ...emptyDraft });
    setAdding(false);
  };

  const updateService = async (id: string, patch: Partial<Service>) => {
    try {
      await fetchApi(`/system/services/${id}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setServices((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    } catch (e) {
      console.error("Failed to update service", e);
    }
  };

  const addProvider = async () => {
    const name = draftProvider.name.trim() || draftProvider.provider_type;
    try {
      const payload = { ...draftProvider, name };
      const res = await fetchApi("/api/search-providers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res.id) {
        setProviders((p) => [...p, { ...payload, id: res.id } as SearchProvider]);
      }
    } catch (e) {
      console.error("Failed to add search provider", e);
    }
    setDraftProvider({ ...emptySearchDraft });
    setAddingProvider(false);
  };

  const saveProvider = async (id: string, patch: Partial<SearchProvider>) => {
    try {
      const existing = providers.find((x) => x.id === id);
      if (!existing) return;
      const payload = { ...existing, ...patch };
      await fetchApi("/api/search-providers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setProviders((p) => p.map((x) => (x.id === id ? payload : x)));
    } catch (e) {
      console.error("Failed to update search provider", e);
    }
  };

  const removeProvider = async (id: string) => {
    try {
      await fetchApi(`/api/search-providers/${id}`, { method: "DELETE" });
      setProviders((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      console.error("Failed to remove search provider", e);
    }
  };

  const handleAction = async (id: string, action: string) => {
    const sName = services.find((x) => x.id === id)?.name || "Service";
    const toastId = toast.loading(`${action.toUpperCase()} signal sending to ${sName}...`);
    try {
      const res = await fetchApi(`/api/system/services/${id}/control`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      });
      if (res?.ok) {
        setServices((s) =>
          s.map((x) => (x.id === id ? { ...x, online: res.online, detail: res.detail } : x)),
        );
        toast.success(`${sName} ${action} completed: ${res.detail}`, { id: toastId });
      } else {
        toast.error(res?.error || `Failed to ${action} ${sName}`, { id: toastId });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Failed to ${action} service`, e);
      toast.error(msg || `Failed to ${action} ${sName}`, { id: toastId });
    }
  };

  return (
    <Surface wide crumb="Services" title="Services" meta="BACKGROUND SERVICES TOWER · LIFECYCLE">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-6"
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-foreground">
            Background services tower
          </h2>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-muted-foreground/50">
              auto-refresh 30 s
            </span>
            <JewelButton size="sm" variant="outline" onClick={() => fetchServices()}>
              <RefreshCw size={12} /> Refresh
            </JewelButton>
            <JewelButton
              size="sm"
              variant="primary"
              onClick={() => {
                setEditing(null);
                setAdding((v) => !v);
              }}
            >
              <Plus size={12} /> Add service
            </JewelButton>
            <JewelButton
              size="sm"
              variant="outline"
              className="hover:border-topaz/45 hover:text-topaz"
              onClick={async () => {
                const ok = await confirmAction({
                  title: "Reload services from backend?",
                  body: "Re-syncs the tower with the database services state.",
                  confirmLabel: "Reload",
                  tone: "sapphire",
                });
                if (ok) fetchServices();
              }}
            >
              <RotateCcw size={12} /> Reload
            </JewelButton>
          </div>
        </header>

        {adding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-5 overflow-hidden rounded-xl border border-white/[0.07] bg-raised/25 p-5"
          >
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-sapphire">
              New service
            </span>
            <ServiceForm draft={draft} onChange={(d) => setDraft({ ...draft, ...d })} />
            <div className="mt-4 flex items-center justify-end gap-2">
              <JewelButton size="sm" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </JewelButton>
              <SaveButton label="Add" disabled={!draft.key.trim()} onSave={add} />
            </div>
          </motion.div>
        )}

        <div className="mt-5 grid gap-2">
          {services.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-white/[0.06] bg-raised/25 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: s.online ? "var(--emerald)" : "var(--ruby)",
                      boxShadow: `0 0 10px -1px ${s.online ? "var(--emerald)" : "var(--ruby)"}`,
                    }}
                  />
                  <Server size={14} className="text-muted-foreground/50" strokeWidth={1.6} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] text-foreground">{s.name}</span>
                      {s.manager !== "custom" && (
                        <span className="rounded-md border border-white/[0.09] px-1.5 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
                          {s.manager}
                          {s.sudo ? " · sudo" : ""}
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground/55">
                      <span className={s.online ? "text-emerald" : "text-ruby"}>
                        {s.online ? "ONLINE" : "OFFLINE"}
                      </span>{" "}
                      · {s.detail}
                      {s.username ? ` · user ${s.username}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(["Start", "Stop", "Restart"] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => handleAction(s.id, a.toLowerCase())}
                      className="rounded-md px-2 py-1 font-mono text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
                    >
                      {a}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setAdding(false);
                      setEditing((e) => (e === s.id ? null : s.id));
                    }}
                    className="rounded-md p-1 text-muted-foreground/60 hover:text-sapphire"
                    aria-label="configure"
                    title="configure"
                  >
                    <Plug size={13} strokeWidth={1.7} />
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: `Delete ${s.name}?`,
                        body: "The service is removed from the tower. You can re-add it with the Add service form or Restore defaults.",
                        confirmLabel: "Delete",
                        tone: "ruby",
                      });
                      if (ok) {
                        try {
                          await fetchApi(`/api/system/services/${s.id}`, { method: "DELETE" });
                          setServices((rows) => rows.filter((r) => r.id !== s.id));
                        } catch (e) {
                          console.error("Failed to delete service", e);
                        }
                      }
                    }}
                    className="rounded-md p-1 text-muted-foreground/50 hover:text-ruby"
                    aria-label="delete"
                    title="delete"
                  >
                    <Trash2 size={13} strokeWidth={1.7} />
                  </button>
                </div>
              </div>

              {editing === s.id && (
                <ServiceEditor
                  service={s}
                  onClose={() => setEditing(null)}
                  onSave={async (patch) => {
                    try {
                      await fetchApi(`/api/system/services/${s.id}`, {
                        method: "PUT",
                        body: JSON.stringify(patch),
                      });
                      setServices((rows) =>
                        rows.map((r) => (r.id === s.id ? { ...r, ...patch } : r)),
                      );
                    } catch (e) {
                      console.error("Failed to update service", e);
                    }
                  }}
                />
              )}
            </div>
          ))}
          {services.length === 0 && (
            <p className="font-mono text-[11.5px] text-muted-foreground/45">
              tower empty — add a service or restore defaults
            </p>
          )}
        </div>
      </motion.section>

      {/* WEB SEARCH PROVIDERS TOWER */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.015] p-6"
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-foreground">
            Web Search Engine Tower
          </h2>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-muted-foreground/50">
              fallback engine chain
            </span>
            <JewelButton
              size="sm"
              variant="primary"
              onClick={() => {
                setAddingProvider(true);
                setEditingProvider(null);
                setDraftProvider({ ...emptySearchDraft });
              }}
            >
              <Plus size={12} /> Add provider
            </JewelButton>
          </div>
        </header>

        {addingProvider && (
          <div className="mt-4 rounded-xl border border-white/[0.06] bg-raised/20 p-5">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <span className="font-mono text-[12px] uppercase tracking-wider text-sapphire">
                New Search Provider
              </span>
              <button
                onClick={() => setAddingProvider(false)}
                className="text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                close
              </button>
            </div>

            <div className="mt-4 grid gap-x-5 gap-y-3 md:grid-cols-2">
              <div>
                <span className={labelCls}>Name</span>
                <input
                  className={fieldCls}
                  placeholder="e.g. My Tavily Account"
                  value={draftProvider.name}
                  onChange={(e) => setDraftProvider({ ...draftProvider, name: e.target.value })}
                />
              </div>
              <div>
                <span className={labelCls}>Provider Type</span>
                <select
                  className={fieldCls}
                  value={draftProvider.provider_type}
                  onChange={(e) =>
                    setDraftProvider({
                      ...draftProvider,
                      provider_type: e.target.value as SearchProviderType,
                    })
                  }
                >
                  <option value="tavily" className="bg-panel">
                    Tavily Search API
                  </option>
                  <option value="searxng" className="bg-panel">
                    SearXNG (Self-Hosted)
                  </option>
                  <option value="duckduckgo" className="bg-panel">
                    DuckDuckGo (Free HTML)
                  </option>
                  <option value="brave" className="bg-panel">
                    Brave Search API
                  </option>
                </select>
              </div>
              <div>
                <span className={labelCls}>Priority (1=High, 10=Low)</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  className={fieldCls}
                  value={draftProvider.priority}
                  onChange={(e) =>
                    setDraftProvider({
                      ...draftProvider,
                      priority: parseInt(e.target.value, 10) || 5,
                    })
                  }
                />
              </div>
              <div className="md:col-span-2">
                <span className={labelCls}>Base URL (SearXNG etc.)</span>
                <input
                  className={fieldCls}
                  placeholder="http://my-searxng:8080/search"
                  value={draftProvider.base_url}
                  onChange={(e) => setDraftProvider({ ...draftProvider, base_url: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <span className={labelCls}>API Key / Credential</span>
                <VaultKeyField
                  value={draftProvider.api_key_ref}
                  onChange={(v) => setDraftProvider({ ...draftProvider, api_key_ref: v })}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3 border-t border-white/[0.06] pt-4">
              <ResetButton
                title="Reset Provider?"
                onReset={() => setDraftProvider({ ...emptySearchDraft })}
              />
              <SaveButton onSave={addProvider} />
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-[2px]">
          {providers.map((p) => (
            <div key={p.id} className="group relative">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-transparent bg-white/[0.015] px-4 py-3 transition-colors hover:border-white/[0.04] hover:bg-white/[0.03]">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => saveProvider(p.id, { active: !p.active })}
                    className={cn(
                      "flex h-[20px] w-[34px] items-center rounded-full border transition-all duration-200",
                      p.active ? "border-emerald/50 bg-emerald/15" : "border-white/10 bg-white/5",
                    )}
                  >
                    <span
                      className={cn(
                        "h-[12px] w-[12px] rounded-full transition-all duration-200",
                        p.active ? "ml-[18px] bg-emerald" : "ml-[3px] bg-muted-foreground/40",
                      )}
                    />
                  </button>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-medium text-foreground">
                        {p.name}
                      </span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/60">
                        {p.provider_type}
                      </span>
                      <span className="rounded bg-topaz/10 px-1.5 py-0.5 font-mono text-[10px] text-topaz">
                        P{p.priority}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11.5px] text-muted-foreground/50">
                      {p.id} {p.base_url && `· ${p.base_url}`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => {
                      setAddingProvider(false);
                      setEditingProvider((e) => (e === p.id ? null : p.id));
                    }}
                    className="rounded-md p-1 text-muted-foreground/60 hover:text-sapphire"
                    aria-label="configure"
                    title="configure"
                  >
                    <Plug size={13} strokeWidth={1.7} />
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: `Delete ${p.name}?`,
                        body: "The search provider will be removed from the fallback chain.",
                        confirmLabel: "Delete",
                        tone: "ruby",
                      });
                      if (ok) removeProvider(p.id);
                    }}
                    className="rounded-md p-1 text-muted-foreground/50 hover:text-ruby"
                    aria-label="delete"
                    title="delete"
                  >
                    <Trash2 size={13} strokeWidth={1.7} />
                  </button>
                </div>
              </div>

              {editingProvider === p.id && (
                <div className="mb-4 mt-2 rounded-xl border border-white/[0.06] bg-raised/20 p-5">
                  <div className="grid gap-x-5 gap-y-3 md:grid-cols-2">
                    <div>
                      <span className={labelCls}>Name</span>
                      <input
                        className={fieldCls}
                        value={p.name}
                        onChange={(e) => saveProvider(p.id, { name: e.target.value })}
                      />
                    </div>
                    <div>
                      <span className={labelCls}>Provider Type</span>
                      <select
                        className={fieldCls}
                        value={p.provider_type}
                        onChange={(e) =>
                          saveProvider(p.id, {
                            provider_type: e.target.value as SearchProviderType,
                          })
                        }
                      >
                        <option value="tavily" className="bg-panel">
                          Tavily Search API
                        </option>
                        <option value="searxng" className="bg-panel">
                          SearXNG (Self-Hosted)
                        </option>
                        <option value="duckduckgo" className="bg-panel">
                          DuckDuckGo (Free HTML)
                        </option>
                        <option value="brave" className="bg-panel">
                          Brave Search API
                        </option>
                      </select>
                    </div>
                    <div>
                      <span className={labelCls}>Priority (1=High, 10=Low)</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        className={fieldCls}
                        value={p.priority}
                        onChange={(e) =>
                          saveProvider(p.id, {
                            priority: parseInt(e.target.value, 10) || 5,
                          })
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <span className={labelCls}>Base URL (SearXNG etc.)</span>
                      <input
                        className={fieldCls}
                        value={p.base_url}
                        onChange={(e) => saveProvider(p.id, { base_url: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <span className={labelCls}>API Key / Credential</span>
                      <VaultKeyField
                        value={p.api_key_ref}
                        onChange={(v) => saveProvider(p.id, { api_key_ref: v })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {providers.length === 0 && (
            <p className="font-mono text-[11.5px] text-muted-foreground/45">
              tower empty — add a search engine to enable web capabilities
            </p>
          )}
        </div>
      </motion.section>

      {/* ENTERPRISE HA CLUSTER & INFRASTRUCTURE HUB */}
      <EnterpriseInfrastructureHub />
    </Surface>
  );
}

/* ------------------------------------------------------------- infra hub */

type InfraOverview = {
  database: {
    status: string;
    activeUri: string;
    databaseName: string;
    version: string;
    latencyMs: number;
    pool: { totalCount: number; idleCount: number; waitingCount: number };
  };
  redis: {
    enabled: boolean;
    mode: string;
    activeUri: string;
    semanticCache: boolean;
    ttlSeconds: number;
  };
  rabbitmq: {
    enabled: boolean;
    mode: string;
    activeUri: string;
    prefetch: number;
  };
  storage: {
    mode: "local" | "s3";
    localPath: string;
    s3Endpoint: string;
    s3Bucket: string;
  };
};

function EnterpriseInfrastructureHub() {
  const [infra, setInfra] = useState<InfraOverview | null>(null);
  const [loading, setLoading] = useState(true);

  // Database State
  const [dbCandidate, setDbCandidate] = useState("");
  const [dbTesting, setDbTesting] = useState(false);
  const [dbResult, setDbResult] = useState<{ ok: boolean; msg: string; latency?: number | undefined } | null>(
    null,
  );

  // Redis State
  const [redisEnabled, setRedisEnabled] = useState(false);
  const [redisUri, setRedisUri] = useState("redis://127.0.0.1:6379");
  const [semanticCache, setSemanticCache] = useState(true);
  const [redisTtl, setRedisTtl] = useState(86400);
  const [redisTesting, setRedisTesting] = useState(false);
  const [redisResult, setRedisResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // RabbitMQ State
  const [rmqEnabled, setRmqEnabled] = useState(false);
  const [rmqUri, setRmqUri] = useState("amqp://guest:guest@127.0.0.1:5672");
  const [rmqPrefetch, setRmqPrefetch] = useState(10);
  const [rmqTesting, setRmqTesting] = useState(false);
  const [rmqResult, setRmqResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Storage State
  const [storageMode, setStorageMode] = useState<"local" | "s3">("local");
  const [localPath, setLocalPath] = useState("./uploads");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Bucket, setS3Bucket] = useState("elara-knowledge");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [storageTesting, setStorageTesting] = useState(false);
  const [storageResult, setStorageResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchInfra = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await fetchApi("/api/infra/overview")) as InfraOverview;
      if (data && data.database) {
        setInfra(data);
        setDbCandidate(data.database.activeUri || "");
        setRedisEnabled(data.redis.enabled);
        setRedisUri(data.redis.activeUri || "redis://127.0.0.1:6379");
        setSemanticCache(data.redis.semanticCache);
        setRedisTtl(data.redis.ttlSeconds || 86400);
        setRmqEnabled(data.rabbitmq.enabled);
        setRmqUri(data.rabbitmq.activeUri || "amqp://guest:guest@127.0.0.1:5672");
        setRmqPrefetch(data.rabbitmq.prefetch || 10);
        setStorageMode(data.storage.mode || "local");
        setLocalPath(data.storage.localPath || "./uploads");
        setS3Endpoint(data.storage.s3Endpoint || "");
        setS3Bucket(data.storage.s3Bucket || "elara-knowledge");
      }
    } catch (e) {
      console.warn("[InfraHub] Failed to fetch overview", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInfra();
  }, [fetchInfra]);

  const handleTestDb = async () => {
    if (!dbCandidate.trim()) return;
    setDbTesting(true);
    setDbResult(null);
    try {
      const res = (await fetchApi("/api/infra/db/test", {
        method: "POST",
        body: JSON.stringify({ connectionString: dbCandidate.trim() }),
      })) as { ok: boolean; message?: string; latencyMs?: number; error?: string };
      if (res?.ok) {
        setDbResult({
          ok: true,
          msg: res.message || "Connection verified successfully.",
          latency: res.latencyMs ?? 0,
        });
        toast.success(`PostgreSQL verified (${res.latencyMs ?? 0}ms)`);
      } else {
        setDbResult({ ok: false, msg: res?.error || "Connection failed." });
        toast.error(res?.error || "Connection failed.");
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      setDbResult({ ok: false, msg: err });
      toast.error(err);
    } finally {
      setDbTesting(false);
    }
  };

  const handleSaveDb = async () => {
    if (!dbCandidate.trim()) return;
    const ok = await confirmAction({
      title: "Save Cluster Database Configuration?",
      body: "Updates the primary cluster database connection in application settings.",
      confirmLabel: "Save Configuration",
      tone: "sapphire",
    });
    if (!ok) return;

    try {
      await fetchApi("/api/infra/db/save", {
        method: "POST",
        body: JSON.stringify({ connectionString: dbCandidate.trim() }),
      });
      toast.success("Database cluster settings saved.");
      fetchInfra();
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to save DB configuration: ${err}`);
    }
  };

  const handleTestRedis = async () => {
    setRedisTesting(true);
    setRedisResult(null);
    try {
      const res = (await fetchApi("/api/infra/redis/test", {
        method: "POST",
        body: JSON.stringify({ uri: redisUri }),
      })) as { ok: boolean; message?: string; latencyMs?: number; error?: string };
      if (res?.ok) {
        setRedisResult({ ok: true, msg: res.message || "Redis reached successfully." });
        toast.success(`Redis verified (${res.latencyMs}ms)`);
      } else {
        setRedisResult({ ok: false, msg: res?.error || "Connection failed." });
        toast.error(res?.error || "Redis connection failed.");
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      setRedisResult({ ok: false, msg: err });
      toast.error(err);
    } finally {
      setRedisTesting(false);
    }
  };

  const handleSaveRedis = async () => {
    try {
      await fetchApi("/api/infra/redis/save", {
        method: "POST",
        body: JSON.stringify({
          enabled: redisEnabled,
          uri: redisUri,
          semanticCache,
          ttlSeconds: redisTtl,
        }),
      });
      toast.success("Redis caching settings saved.");
      fetchInfra();
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to save Redis config: ${err}`);
    }
  };

  const handleTestRabbitmq = async () => {
    setRmqTesting(true);
    setRmqResult(null);
    try {
      const res = (await fetchApi("/api/infra/rabbitmq/test", {
        method: "POST",
        body: JSON.stringify({ uri: rmqUri }),
      })) as { ok: boolean; message?: string; latencyMs?: number; error?: string };
      if (res?.ok) {
        setRmqResult({ ok: true, msg: res.message || "RabbitMQ handshake verified." });
        toast.success(`RabbitMQ verified (${res.latencyMs}ms)`);
      } else {
        setRmqResult({ ok: false, msg: res?.error || "Connection failed." });
        toast.error(res?.error || "RabbitMQ connection failed.");
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      setRmqResult({ ok: false, msg: err });
      toast.error(err);
    } finally {
      setRmqTesting(false);
    }
  };

  const handleSaveRabbitmq = async () => {
    try {
      await fetchApi("/api/infra/rabbitmq/save", {
        method: "POST",
        body: JSON.stringify({
          enabled: rmqEnabled,
          uri: rmqUri,
          prefetch: rmqPrefetch,
        }),
      });
      toast.success("RabbitMQ broker settings saved.");
      fetchInfra();
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to save RabbitMQ config: ${err}`);
    }
  };

  const handleTestStorage = async () => {
    setStorageTesting(true);
    setStorageResult(null);
    try {
      const res = (await fetchApi("/api/infra/storage/test", {
        method: "POST",
        body: JSON.stringify({
          mode: storageMode,
          localPath,
          s3: {
            endpoint: s3Endpoint,
            bucket: s3Bucket,
            region: s3Region,
            accessKey: s3AccessKey,
            secretKey: s3SecretKey,
          },
        }),
      })) as { ok: boolean; message?: string; latencyMs?: number; error?: string };
      if (res?.ok) {
        setStorageResult({ ok: true, msg: res.message || "Storage verified successfully." });
        toast.success(`Storage verified (${res.latencyMs}ms)`);
      } else {
        setStorageResult({ ok: false, msg: res?.error || "Storage probe failed." });
        toast.error(res?.error || "Storage probe failed.");
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      setStorageResult({ ok: false, msg: err });
      toast.error(err);
    } finally {
      setStorageTesting(false);
    }
  };

  const handleSaveStorage = async () => {
    try {
      await fetchApi("/api/infra/storage/save", {
        method: "POST",
        body: JSON.stringify({
          mode: storageMode,
          localPath,
          s3: {
            endpoint: s3Endpoint,
            bucket: s3Bucket,
            region: s3Region,
            accessKey: s3AccessKey,
            secretKey: s3SecretKey,
          },
        }),
      });
      toast.success("Storage configuration saved.");
      fetchInfra();
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to save storage config: ${err}`);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.015] p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
        <div>
          <h2 className="flex items-center gap-2.5 font-mono text-[13px] uppercase tracking-[0.18em] text-foreground">
            <Layers size={14} className="text-sapphire" />
            Enterprise HA Cluster & Infrastructure Hub
          </h2>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground/60">
            DUAL-MODE CLUSTER · DATABASE, CACHING, TASK BROKER & STORAGE MANAGEMENT
          </p>
        </div>
        <JewelButton size="sm" variant="outline" onClick={fetchInfra} disabled={loading}>
          <RefreshCw size={12} className={cn(loading && "animate-spin")} /> Refresh Hub
        </JewelButton>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* 1. DATABASE & CLUSTER HUB */}
        <div className="flex flex-col justify-between rounded-xl border border-white/[0.07] bg-raised/20 p-5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-[12.5px] font-medium text-foreground">
                <Database size={15} className="text-sapphire" />
                PostgreSQL Cluster Hub
              </div>
              <span
                className={cn(
                  "rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                  infra?.database.status === "healthy"
                    ? "bg-emerald/15 text-emerald border border-emerald/30"
                    : "bg-ruby/15 text-ruby border border-ruby/30"
                )}
              >
                {infra?.database.status === "healthy" ? `ONLINE · ${infra.database.latencyMs}ms` : "OFFLINE"}
              </span>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground/60 border-b border-white/[0.04] pb-3">
              <span>DB: <strong className="text-foreground">{infra?.database.databaseName || "elara_db"}</strong></span>
              <span>Version: <strong className="text-foreground">{infra?.database.version || "18.x"}</strong></span>
              <span>Pool: <strong className="text-foreground">{infra?.database.pool.idleCount || 1} idle / {infra?.database.pool.totalCount || 1} total</strong></span>
            </div>

            <div className="mt-4">
              <span className={labelCls}>Cluster Connection String (Primary / PgBouncer)</span>
              <input
                className={fieldCls}
                placeholder="postgres://user:pass@192.168.1.10:5432/elara_db"
                value={dbCandidate}
                onChange={(e) => setDbCandidate(e.target.value)}
              />
            </div>

            {dbResult && (
              <div
                className={cn(
                  "mt-3 rounded-lg border px-3 py-2 font-mono text-[11px]",
                  dbResult.ok
                    ? "border-emerald/30 bg-emerald/10 text-emerald"
                    : "border-ruby/30 bg-ruby/10 text-ruby"
                )}
              >
                {dbResult.ok ? <CheckCircle2 size={13} className="inline mr-1.5" /> : null}
                {dbResult.msg}
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/[0.04] pt-3.5">
            <JewelButton size="sm" variant="outline" onClick={handleTestDb} disabled={dbTesting}>
              <Activity size={12} /> {dbTesting ? "Testing..." : "Test Connection"}
            </JewelButton>
            <JewelButton size="sm" variant="primary" onClick={handleSaveDb}>
              Save Config
            </JewelButton>
          </div>
        </div>

        {/* 2. REDIS ACCELERATION TIER */}
        <div className="flex flex-col justify-between rounded-xl border border-white/[0.07] bg-raised/20 p-5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-[12.5px] font-medium text-foreground">
                <Zap size={15} className="text-topaz" />
                Redis Acceleration Tier
              </div>
              <span
                className={cn(
                  "rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                  redisEnabled
                    ? "bg-emerald/15 text-emerald border border-emerald/30"
                    : "bg-topaz/15 text-topaz border border-topaz/30"
                )}
              >
                {redisEnabled ? "REDIS CLUSTER" : "IN-MEMORY FALLBACK"}
              </span>
            </div>

            <div className="mt-3.5 flex items-center justify-between border-b border-white/[0.04] pb-3">
              <span className="font-mono text-[11.5px] text-muted-foreground/80">Enable Redis Caching</span>
              <Toggle on={redisEnabled} label="" onClick={() => setRedisEnabled(!redisEnabled)} />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <span className={labelCls}>Redis URI</span>
                <input
                  className={fieldCls}
                  placeholder="redis://127.0.0.1:6379"
                  value={redisUri}
                  onChange={(e) => setRedisUri(e.target.value)}
                />
              </div>
              <div>
                <span className={labelCls}>Cache TTL (sec)</span>
                <input
                  type="number"
                  className={fieldCls}
                  value={redisTtl}
                  onChange={(e) => setRedisTtl(Number(e.target.value) || 86400)}
                />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="font-mono text-[11.5px] text-muted-foreground/80">Semantic Response Cache</span>
              <Toggle on={semanticCache} label="" onClick={() => setSemanticCache(!semanticCache)} />
            </div>

            {redisResult && (
              <div
                className={cn(
                  "mt-3 rounded-lg border px-3 py-2 font-mono text-[11px]",
                  redisResult.ok
                    ? "border-emerald/30 bg-emerald/10 text-emerald"
                    : "border-ruby/30 bg-ruby/10 text-ruby"
                )}
              >
                {redisResult.msg}
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/[0.04] pt-3.5">
            <JewelButton size="sm" variant="outline" onClick={handleTestRedis} disabled={redisTesting}>
              <Activity size={12} /> {redisTesting ? "Testing..." : "Test Connection"}
            </JewelButton>
            <JewelButton size="sm" variant="primary" onClick={handleSaveRedis}>
              Save Redis
            </JewelButton>
          </div>
        </div>

        {/* 3. RABBITMQ TASK & DAG BROKER */}
        <div className="flex flex-col justify-between rounded-xl border border-white/[0.07] bg-raised/20 p-5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-[12.5px] font-medium text-foreground">
                <Network size={15} className="text-amethyst" />
                RabbitMQ Task & DAG Broker
              </div>
              <span
                className={cn(
                  "rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                  rmqEnabled
                    ? "bg-emerald/15 text-emerald border border-emerald/30"
                    : "bg-topaz/15 text-topaz border border-topaz/30"
                )}
              >
                {rmqEnabled ? "AMQP BROKER ACTIVE" : "DIRECT SYNC FALLBACK"}
              </span>
            </div>

            <div className="mt-3.5 flex items-center justify-between border-b border-white/[0.04] pb-3">
              <span className="font-mono text-[11.5px] text-muted-foreground/80">Enable RabbitMQ Task Broker</span>
              <Toggle on={rmqEnabled} label="" onClick={() => setRmqEnabled(!rmqEnabled)} />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <span className={labelCls}>AMQP Broker URI</span>
                <input
                  className={fieldCls}
                  placeholder="amqp://guest:guest@127.0.0.1:5672"
                  value={rmqUri}
                  onChange={(e) => setRmqUri(e.target.value)}
                />
              </div>
              <div>
                <span className={labelCls}>Worker Prefetch</span>
                <input
                  type="number"
                  className={fieldCls}
                  value={rmqPrefetch}
                  onChange={(e) => setRmqPrefetch(Number(e.target.value) || 10)}
                />
              </div>
            </div>

            {rmqResult && (
              <div
                className={cn(
                  "mt-3 rounded-lg border px-3 py-2 font-mono text-[11px]",
                  rmqResult.ok
                    ? "border-emerald/30 bg-emerald/10 text-emerald"
                    : "border-ruby/30 bg-ruby/10 text-ruby"
                )}
              >
                {rmqResult.msg}
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/[0.04] pt-3.5">
            <JewelButton size="sm" variant="outline" onClick={handleTestRabbitmq} disabled={rmqTesting}>
              <Activity size={12} /> {rmqTesting ? "Testing..." : "Test Connection"}
            </JewelButton>
            <JewelButton size="sm" variant="primary" onClick={handleSaveRabbitmq}>
              Save RabbitMQ
            </JewelButton>
          </div>
        </div>

        {/* 4. SHARED STORAGE HUB */}
        <div className="flex flex-col justify-between rounded-xl border border-white/[0.07] bg-raised/20 p-5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-[12.5px] font-medium text-foreground">
                <HardDrive size={15} className="text-emerald" />
                Shared Storage Hub (NFS / S3 / MinIO)
              </div>
              <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {storageMode === "s3" ? "S3 / MINIO OBJECT STORE" : "LOCAL / NFS MOUNT"}
              </span>
            </div>

            <div className="mt-3.5 flex items-center gap-4 border-b border-white/[0.04] pb-3 font-mono text-[11.5px]">
              <label className="flex items-center gap-2 cursor-pointer text-foreground">
                <input
                  type="radio"
                  name="storageMode"
                  checked={storageMode === "local"}
                  onChange={() => setStorageMode("local")}
                  className="accent-sapphire"
                />
                Local / NFS Directory
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-foreground">
                <input
                  type="radio"
                  name="storageMode"
                  checked={storageMode === "s3"}
                  onChange={() => setStorageMode("s3")}
                  className="accent-sapphire"
                />
                S3 / MinIO Object Storage
              </label>
            </div>

            {storageMode === "local" ? (
              <div className="mt-4">
                <span className={labelCls}>Local Uploads / Shared NFS Mount Directory</span>
                <input
                  className={fieldCls}
                  placeholder="/mnt/elara_shared/uploads or ./uploads"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                />
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <span className={labelCls}>S3 / MinIO Endpoint URL</span>
                  <input
                    className={fieldCls}
                    placeholder="https://minio.sirket.local:9000"
                    value={s3Endpoint}
                    onChange={(e) => setS3Endpoint(e.target.value)}
                  />
                </div>
                <div>
                  <span className={labelCls}>Bucket Name</span>
                  <input
                    className={fieldCls}
                    placeholder="elara-knowledge"
                    value={s3Bucket}
                    onChange={(e) => setS3Bucket(e.target.value)}
                  />
                </div>
                <div>
                  <span className={labelCls}>Region</span>
                  <input
                    className={fieldCls}
                    placeholder="us-east-1"
                    value={s3Region}
                    onChange={(e) => setS3Region(e.target.value)}
                  />
                </div>
                <div>
                  <span className={labelCls}>Access Key ID</span>
                  <input
                    className={fieldCls}
                    placeholder="minioadmin"
                    value={s3AccessKey}
                    onChange={(e) => setS3AccessKey(e.target.value)}
                  />
                </div>
              </div>
            )}

            {storageResult && (
              <div
                className={cn(
                  "mt-3 rounded-lg border px-3 py-2 font-mono text-[11px]",
                  storageResult.ok
                    ? "border-emerald/30 bg-emerald/10 text-emerald"
                    : "border-ruby/30 bg-ruby/10 text-ruby"
                )}
              >
                {storageResult.msg}
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/[0.04] pt-3.5">
            <JewelButton size="sm" variant="outline" onClick={handleTestStorage} disabled={storageTesting}>
              <Activity size={12} /> {storageTesting ? "Testing..." : "Test Storage Probe"}
            </JewelButton>
            <JewelButton size="sm" variant="primary" onClick={handleSaveStorage}>
              Save Storage
            </JewelButton>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground/75"
    >
      <span
        className={cn(
          "relative h-[20px] w-[38px] rounded-full border transition-colors",
          on ? "border-transparent bg-emerald" : "border-white/12 bg-raised/50",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all",
            on ? "left-[21px] bg-canvas" : "left-[3px] bg-muted-foreground/60",
          )}
        />
      </span>
      {label}
    </button>
  );
}

function ServiceForm({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const managed = draft.manager !== "custom";

  return (
    <div className="mt-4 grid gap-x-5 gap-y-3 md:grid-cols-2">
      <div>
        <span className={labelCls}>Key (unique)</span>
        <input
          className={fieldCls}
          placeholder="my-service"
          value={draft.key}
          onChange={(e) => onChange({ key: e.target.value })}
        />
      </div>
      <div>
        <span className={labelCls}>Name</span>
        <input
          className={fieldCls}
          placeholder="My Service"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div>
        <span className={labelCls}>Kind</span>
        <select
          className={cn(fieldCls, "appearance-none")}
          value={draft.kind}
          onChange={(e) => onChange({ kind: e.target.value })}
        >
          {KINDS.map((k) => (
            <option key={k} value={k} className="bg-canvas">
              {k}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className={labelCls}>
          {draft.kind === "Process" || draft.kind === "PostgreSQL"
            ? "Process name"
            : draft.kind === "Command" ||
                draft.kind === "systemd systemctl" ||
                draft.kind === "launchctl"
              ? "Command / unit"
              : "Probe URL"}
        </span>
        <input
          className={fieldCls}
          placeholder={
            draft.kind === "Process" || draft.kind === "PostgreSQL"
              ? "postgres"
              : draft.kind === "Command" ||
                  draft.kind === "systemd systemctl" ||
                  draft.kind === "launchctl"
                ? "launchctl start com.postgresql.postgres"
                : "http://127.0.0.1:8080/health"
          }
          value={draft.probe}
          onChange={(e) => onChange({ probe: e.target.value })}
        />
      </div>
      <div>
        <span className={labelCls}>Username</span>
        <input
          className={fieldCls}
          placeholder="postgres"
          value={draft.username}
          onChange={(e) => onChange({ username: e.target.value })}
        />
      </div>
      <div>
        <span className={labelCls}>Password / credential</span>
        <VaultKeyField
          value={draft.credential}
          onChange={(next) => onChange({ credential: next })}
          placeholder="••••••••"
        />
      </div>

      {/* ---------------------------------------------------- lifecycle -- */}
      <div className="md:col-span-2 mt-2 border-t border-white/[0.06] pt-4">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-sapphire">
          Lifecycle control
        </span>
      </div>

      <div>
        <span className={labelCls}>Service manager</span>
        <select
          className={cn(fieldCls, "appearance-none")}
          value={draft.manager}
          onChange={(e) => onChange({ manager: e.target.value as Manager })}
        >
          <option value="systemd" className="bg-canvas">
            systemd (Linux)
          </option>
          <option value="launchd" className="bg-canvas">
            launchd (macOS)
          </option>
          <option value="custom" className="bg-canvas">
            Custom commands
          </option>
        </select>
      </div>
      <div>
        <span className={labelCls}>
          {draft.manager === "launchd" ? "Launchd label" : "Unit name"}
        </span>
        <input
          className={fieldCls}
          placeholder={draft.manager === "launchd" ? "com.postgresql.postgres" : "postgresql"}
          value={draft.unit}
          disabled={!managed}
          onChange={(e) => onChange({ unit: e.target.value })}
        />
      </div>
      <div>
        <span className={labelCls}>Transport</span>
        <select
          className={cn(fieldCls, "appearance-none")}
          value={draft.transport}
          onChange={(e) => onChange({ transport: e.target.value as Transport })}
        >
          <option value="local-agent" className="bg-canvas">
            Local agent
          </option>
          <option value="ssh" className="bg-canvas">
            SSH
          </option>
        </select>
      </div>
      <div>
        <span className={labelCls}>
          {draft.transport === "ssh" ? "SSH host (user@host)" : "Agent endpoint"}
        </span>
        <input
          className={fieldCls}
          placeholder={draft.transport === "ssh" ? "ops@10.0.0.14" : "http://127.0.0.1:7788/agent"}
          value={draft.host}
          onChange={(e) => onChange({ host: e.target.value })}
        />
      </div>

      <div className="md:col-span-2">
        <Toggle
          on={draft.sudo}
          onClick={() => onChange({ sudo: !draft.sudo })}
          label="Elevate lifecycle commands with sudo (whitelist them in /etc/sudoers.d for NOPASSWD)"
        />
      </div>

      {managed ? (
        <div className="md:col-span-2">
          <span className={labelCls}>Resolved commands</span>
          <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-raised/30 p-4 font-mono text-[11.5px] leading-relaxed text-sapphire/85">
            {(["start", "stop", "restart", "status"] as const)
              .map((a) => `${a.padEnd(8)}${lifecycleCmd(a, draft)}`)
              .join("\n")}
          </pre>
        </div>
      ) : (
        (
          [
            ["Start command", "startCmd", "pg_ctl start -D /var/lib/postgresql/data"],
            ["Stop command", "stopCmd", "pg_ctl stop -D /var/lib/postgresql/data"],
            ["Restart command", "restartCmd", "pg_ctl restart -D /var/lib/postgresql/data"],
            ["Status command", "statusCmd", "pg_isready -q"],
          ] as const
        ).map(([label, key, ph]) => (
          <div key={key}>
            <span className={labelCls}>{label}</span>
            <input
              className={fieldCls}
              placeholder={ph}
              value={draft[key]}
              onChange={(e) => onChange({ [key]: e.target.value } as Partial<Draft>)}
            />
          </div>
        ))
      )}
    </div>
  );
}

function toDraft(s: Service): Draft {
  return {
    key: s.key,
    name: s.name,
    kind: s.kind,
    probe: s.probe,
    username: s.username,
    credential: s.credential,
    manager: s.manager,
    unit: s.unit,
    sudo: s.sudo,
    transport: s.transport,
    host: s.host,
    startCmd: s.startCmd,
    stopCmd: s.stopCmd,
    restartCmd: s.restartCmd,
    statusCmd: s.statusCmd,
  };
}

function ServiceEditor({
  service,
  onSave,
  onClose,
}: {
  service: Service;
  onSave: (patch: Partial<Service>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(toDraft(service));

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-sapphire">
        Service credentials, probe & lifecycle
      </span>
      <ServiceForm draft={draft} onChange={(d) => setDraft({ ...draft, ...d })} />
      <div className="mt-4 flex items-center justify-end gap-2">
        <JewelButton size="sm" variant="outline" onClick={onClose}>
          Close
        </JewelButton>
        <ResetButton
          title="Discard changes?"
          body="Reverts this service back to its saved configuration."
          onReset={() => setDraft(toDraft(service))}
        />
        <SaveButton
          onSave={() => {
            onSave({ ...draft, name: draft.name || draft.key });
          }}
        />
      </div>
    </div>
  );
}
