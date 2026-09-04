import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Plug, Plus, RefreshCw, RotateCcw, Server, Trash2 } from "lucide-react";
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
      const data = await fetchApi("/system/services");
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
    try {
      const res = await fetchApi(`/system/services/${id}/control`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setServices((s) =>
          s.map((x) => (x.id === id ? { ...x, online: res.online, detail: res.detail } : x)),
        );
      }
    } catch (e) {
      console.error(`Failed to ${action} service`, e);
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
            <JewelButton size="sm" variant="outline" onClick={() => setServices((r) => [...r])}>
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
    </Surface>
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
