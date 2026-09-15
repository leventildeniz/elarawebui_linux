import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Globe, Plug, Plus, RotateCcw, Trash2, KeyRound } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { JewelButton } from "@/components/sovereign/primitives";
import { ResetButton, SaveButton } from "@/components/sovereign/action-buttons";
import { VaultKeyField } from "@/components/sovereign/vault-key-field";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { useAccess } from "@/lib/rbac-store";
import { useOwnerCtx } from "@/lib/ownership";
import { fetchApi } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const description =
  "Web search engine management — configure Tavily, SearXNG, DuckDuckGo and Brave search providers with fallback prioritization and multi-tenant credential binding.";

export const Route = createFileRoute("/web-search")({
  head: () => ({
    meta: [
      { title: "Web Search — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Web Search — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WebSearchPage,
});

const labelCls =
  "mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60";
const fieldCls =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-sapphire/50";

type SearchProviderType = "duckduckgo" | "tavily" | "searxng" | "brave";

type SearchProvider = {
  id: string;
  name: string;
  provider_type: SearchProviderType;
  base_url: string;
  api_key_ref: string;
  priority: number;
  active: boolean;
  tenant_id?: string;
  is_global?: boolean;
};

const emptySearchDraft: Omit<SearchProvider, "id"> = {
  name: "",
  provider_type: "tavily",
  base_url: "",
  api_key_ref: "",
  priority: 5,
  active: true,
};

function WebSearchPage() {
  const access = useAccess();
  const ownerCtx = useOwnerCtx();
  const canWrite = access.can("write");
  const canDelete = access.can("delete");

  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [addingProvider, setAddingProvider] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [draftProvider, setDraftProvider] = useState<Omit<SearchProvider, "id">>({
    ...emptySearchDraft,
  });

  const fetchProviders = useCallback(async () => {
    try {
      const data = await fetchApi("/api/search-providers");
      if (Array.isArray(data)) setProviders(data);
    } catch (err) {
      console.error("Failed to load search providers", err);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const addProvider = async () => {
    if (!canWrite) {
      toast.error("Write action verb required to add search providers");
      return;
    }
    const name = draftProvider.name.trim() || draftProvider.provider_type;
    try {
      const payload = { ...draftProvider, name };
      const res = await fetchApi("/api/search-providers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res.id) {
        setProviders((p) => [...p, { ...payload, id: res.id } as SearchProvider]);
        toast.success(`Search provider "${name}" added`);
      }
    } catch (e) {
      console.error("Failed to add search provider", e);
      toast.error("Failed to add search provider");
    }
    setDraftProvider({ ...emptySearchDraft });
    setAddingProvider(false);
  };

  const saveProvider = async (id: string, patch: Partial<SearchProvider>) => {
    if (!canWrite) {
      toast.error("Write action verb required to modify search providers");
      return;
    }
    try {
      const existing = providers.find((x) => x.id === id);
      if (!existing) return;
      const payload = { ...existing, ...patch };
      await fetchApi("/api/search-providers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setProviders((p) => p.map((x) => (x.id === id ? payload : x)));
      toast.success(`Provider "${existing.name}" updated`);
    } catch (e) {
      console.error("Failed to update search provider", e);
      toast.error("Failed to update search provider");
    }
  };

  const removeProvider = async (id: string) => {
    if (!canDelete) {
      toast.error("Delete action verb required to remove search providers");
      return;
    }
    const p = providers.find((x) => x.id === id);
    try {
      await fetchApi(`/api/search-providers/${id}`, { method: "DELETE" });
      setProviders((prev) => prev.filter((x) => x.id !== id));
      toast.success(`Provider "${p?.name || id}" removed`);
    } catch (e) {
      console.error("Failed to remove search provider", e);
      toast.error("Failed to delete search provider");
    }
  };

  const activeCount = providers.filter((p) => p.active).length;

  return (
    <Surface
      wide
      crumb="Web Search"
      title="Web Search Engine"
      meta={`${providers.length} providers · ${activeCount} active · fallback chain priority`}
    >
      <div className="space-y-6">
        {/* Info Banner */}
        <div className="flex items-start gap-3 rounded-xl border border-sapphire/22 bg-[color-mix(in_oklab,var(--sapphire)_6%,transparent)] px-4 py-3">
          <Globe size={16} strokeWidth={1.7} className="mt-[2px] shrink-0 text-sapphire" />
          <div className="font-mono text-[11.5px] leading-relaxed text-muted-foreground/75">
            <span className="text-sapphire font-medium">
              Multi-tenant live web search engine tower.
            </span>{" "}
            During an agent or chat turn with web search enabled, the orchestrator walks this
            priority chain (1 = highest priority). If a tenant configures their own provider, it
            takes precedence over the cluster baseline.
          </div>
        </div>

        {/* Search Providers Card */}
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-foreground">
                Search Provider Chain
              </h2>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground/50">
                Fallback sequence executed top-down on search tool calls
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canWrite && (
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
              )}
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
                  className="text-muted-foreground/60 transition-colors hover:text-foreground font-mono text-[11px]"
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
                  <span className={labelCls}>Priority (1=Highest, 10=Lowest)</span>
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
                  <span className={labelCls}>Base URL (SearXNG / Custom Endpoint)</span>
                  <input
                    className={fieldCls}
                    placeholder="http://my-searxng:8080/search"
                    value={draftProvider.base_url}
                    onChange={(e) => setDraftProvider({ ...draftProvider, base_url: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <span className={labelCls}>API Key / Credential Reference</span>
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

          <div className="mt-6 flex flex-col gap-[3px]">
            {providers.map((p) => {
              const isEditing = editingProvider === p.id;
              return (
                <div key={p.id} className="group relative">
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-transparent bg-white/[0.015] px-4 py-3 transition-colors hover:border-white/[0.04] hover:bg-white/[0.03]">
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => saveProvider(p.id, { active: !p.active })}
                        className={cn(
                          "flex h-[20px] w-[34px] items-center rounded-full border transition-all duration-200",
                          p.active ? "border-emerald/50 bg-emerald/15" : "border-white/10 bg-white/5",
                          !canWrite && "opacity-50 cursor-not-allowed",
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
                          {p.is_global && (
                            <span className="rounded bg-sapphire/10 px-1.5 py-0.5 font-mono text-[10px] text-sapphire">
                              GLOBAL
                            </span>
                          )}
                        </div>
                        <div className="mt-1 font-mono text-[11.5px] text-muted-foreground/50">
                          {p.id} {p.base_url && `· ${p.base_url}`}{" "}
                          {p.api_key_ref && `· key: ${p.api_key_ref.slice(0, 16)}…`}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {canWrite && (
                        <button
                          onClick={() => {
                            setAddingProvider(false);
                            setEditingProvider((e) => (e === p.id ? null : p.id));
                          }}
                          className="rounded-md p-1.5 text-muted-foreground/60 hover:text-sapphire transition-colors"
                          aria-label="configure"
                          title="Configure provider"
                        >
                          <Plug size={13} strokeWidth={1.7} />
                        </button>
                      )}
                      {canDelete && (
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
                          className="rounded-md p-1.5 text-muted-foreground/50 hover:text-ruby transition-colors"
                          aria-label="delete"
                          title="Delete provider"
                        >
                          <Trash2 size={13} strokeWidth={1.7} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline Configure Drawer */}
                  {isEditing && (
                    <div className="mt-1 rounded-xl border border-white/[0.06] bg-raised/20 p-4">
                      <div className="grid gap-x-5 gap-y-3 md:grid-cols-2">
                        <div>
                          <span className={labelCls}>Name</span>
                          <input
                            className={fieldCls}
                            value={p.name}
                            onChange={(e) =>
                              setProviders((arr) =>
                                arr.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)),
                              )
                            }
                          />
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
                              setProviders((arr) =>
                                arr.map((x) =>
                                  x.id === p.id
                                    ? { ...x, priority: parseInt(e.target.value, 10) || 5 }
                                    : x,
                                ),
                              )
                            }
                          />
                        </div>
                        <div className="md:col-span-2">
                          <span className={labelCls}>Base URL</span>
                          <input
                            className={fieldCls}
                            value={p.base_url || ""}
                            onChange={(e) =>
                              setProviders((arr) =>
                                arr.map((x) =>
                                  x.id === p.id ? { ...x, base_url: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </div>
                        <div className="md:col-span-2">
                          <span className={labelCls}>API Key / Credential</span>
                          <VaultKeyField
                            value={p.api_key_ref}
                            onChange={(v) =>
                              setProviders((arr) =>
                                arr.map((x) => (x.id === p.id ? { ...x, api_key_ref: v } : x)),
                              )
                            }
                          />
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
                        <button
                          onClick={() => setEditingProvider(null)}
                          className="px-3 py-1 font-mono text-[11px] text-muted-foreground/60 hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <SaveButton onSave={() => {
                          saveProvider(p.id, p);
                          setEditingProvider(null);
                        }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {providers.length === 0 && (
              <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] p-6 text-center">
                <Globe className="mx-auto h-6 w-6 text-muted-foreground/40" />
                <div className="mt-2 text-[13px] text-muted-foreground/70">
                  No search providers configured.
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground/45">
                  Add Tavily, SearXNG or DuckDuckGo to arm live search in chat.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </Surface>
  );
}
