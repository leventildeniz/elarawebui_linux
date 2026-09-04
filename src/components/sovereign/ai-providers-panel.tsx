import { useMemo, useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { KeyRound, Network, Plus, Sparkles, Trash2, X } from "lucide-react";
import { JewelButton, StatusDot } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { type SecretEntry } from "@/lib/security-store";
import { useVaultStore } from "@/lib/vault-store";
import { VaultKeyField, vaultKeyLabel, isKeyBound } from "@/components/sovereign/vault-key-field";
import {
  routingModes,
  useProviders,
  type ProviderKind,
  type OverrideAudience,
} from "@/lib/provider-store";
import { useRoles } from "@/lib/rbac-store";
import { useIdentity } from "@/lib/group-store";
import { cn } from "@/lib/utils";

const fieldCls =
  "w-full rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-2 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
      {children}
    </span>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        on ? "border-sapphire/50 bg-sapphire/25" : "border-white/[0.1] bg-black/30",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={cn(
          "absolute top-[2px] h-3.5 w-3.5 rounded-full",
          on
            ? "left-[18px] bg-sapphire shadow-[0_0_12px_-2px_var(--sapphire)]"
            : "left-[2px] bg-muted-foreground/60",
        )}
      />
    </button>
  );
}

export function AiProvidersPanel() {
  const vault = useVaultStore();
  const { roles } = useRoles();
  const { groups, accounts } = useIdentity();

  useEffect(() => {
    vault.fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { providers, routing, add, update, remove, patchRouting, loading } = useProviders();

  const [draft, setDraft] = useState({
    name: "",
    kind: "llm" as ProviderKind,
    priority: 100,
    baseUrl: "",
    model: "",
    secretId: "",
    active: true,
    isCheapest: false,
  });

  const counts = useMemo(
    () => ({
      llm: providers.filter((p) => p.kind === "llm").length,
      active: providers.filter((p) => p.active).length,
    }),
    [providers],
  );

  const secretLabel = (id: string) => vaultKeyLabel(id, vault.items);
  const [editingId, setEditingId] = useState<string | null>(null);

  const secretBound = (id: string) => isKeyBound(id, vault.items);

  const blank = {
    name: "",
    kind: "llm" as ProviderKind,
    priority: 100,
    baseUrl: "",
    model: "",
    secretId: "",
    active: true,
    isCheapest: false,
  };

  const submit = async () => {
    if (!draft.name.trim()) return;

    // Explicitly destructure draft to ensure we send all fields including isCheapest
    const payload = {
      name: draft.name.trim(),
      kind: draft.kind,
      priority: draft.priority,
      baseUrl: draft.baseUrl,
      model: draft.model,
      secretId: draft.secretId,
      active: draft.active,
      isCheapest: draft.isCheapest,
    };

    if (editingId) {
      await update(editingId, payload);
      setEditingId(null);
    } else {
      await add(payload);
    }

    setDraft(blank);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(blank);
  };

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading config...</div>;
  }

  return (
    <div className="space-y-6">
      {/* routing */}
      <section className="glass rounded-xl border border-white/[0.07] p-6">
        <div className="flex flex-wrap items-baseline gap-3">
          <Network className="h-4 w-4 self-center text-sapphire" strokeWidth={1.6} />
          <h2 className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-foreground/80">
            Multi-provider routing
          </h2>
          <span className="ml-auto rounded-md border border-white/[0.08] px-2 py-1 font-mono text-[10.5px] text-muted-foreground/70">
            {counts.llm} LLM · {counts.active} active
          </span>
        </div>
        <p className="mt-3 max-w-3xl font-mono text-[11.5px] leading-relaxed text-muted-foreground/70">
          Decides which provider(s) serve a request. When user override is on, the chat dropdown has
          the final say (single = lock, multi = parallel fan-out).
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <Label>Default mode</Label>
            <select
              className={fieldCls}
              value={routing.mode}
              onChange={(e) => patchRouting({ mode: e.target.value as never })}
            >
              {routingModes.map((m) => (
                <option key={m.key} value={m.key} className="bg-canvas">
                  {m.label} — {m.hint}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Label>Retries per hop</Label>
            <input
              className={fieldCls}
              type="number"
              min={0}
              value={routing.retries}
              onChange={(e) => patchRouting({ retries: Number(e.target.value) })}
            />
          </label>
          <label className="block">
            <Label>Timeout (ms)</Label>
            <input
              className={fieldCls}
              type="number"
              min={1000}
              step={500}
              value={routing.timeoutMs}
              onChange={(e) => patchRouting({ timeoutMs: Number(e.target.value) })}
            />
          </label>
          <div className="flex items-end gap-3 pb-1">
            <Toggle
              on={routing.allowUserOverride}
              onClick={() => patchRouting({ allowUserOverride: !routing.allowUserOverride })}
            />
            <span className="text-[12.5px] text-foreground/85">
              Allow user override (chat dropdown)
            </span>
          </div>
        </div>

        {routing.allowUserOverride && (
          <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Label>Override Audience Scope</Label>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: "everyone", label: "Everyone (All Users)" },
                      { id: "admins", label: "Admins Only" },
                      { id: "groups", label: "User Groups" },
                      { id: "users", label: "Specific Users" },
                      { id: "roles", label: "Roles" },
                    ] as const
                  ).map((aud) => (
                    <button
                      key={aud.id}
                      type="button"
                      onClick={() =>
                        patchRouting({
                          overrideAudience: aud.id as OverrideAudience,
                        })
                      }
                      className={cn(
                        "rounded-lg border px-3 py-1.5 font-mono text-[11.5px] transition-colors",
                        (routing.overrideAudience || "everyone") === aud.id
                          ? "border-sapphire/50 bg-sapphire/15 text-sapphire shadow-[0_0_12px_-3px_var(--sapphire)]"
                          : "border-white/[0.08] bg-black/25 text-muted-foreground/70 hover:text-foreground",
                      )}
                    >
                      {aud.label}
                    </button>
                  ))}
                </div>
              </div>

              {routing.overrideAudience === "groups" && (
                <div className="min-w-[280px] flex-1 border-t border-white/[0.06] pt-3 sm:border-t-0 sm:pt-0">
                  <Label>Permitted User Groups (Click to Toggle)</Label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {groups.length === 0 ? (
                      <span className="font-mono text-[11px] text-muted-foreground/40">No identity groups defined in Users & Groups</span>
                    ) : (
                      groups.map((g) => {
                        const active = (routing.overrideGroups || []).some(
                          (ag) => ag.toLowerCase() === g.id.toLowerCase() || ag.toLowerCase() === g.name.toLowerCase(),
                        );
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => {
                              const cur = routing.overrideGroups || [];
                              const next = active
                                ? cur.filter((x) => x.toLowerCase() !== g.id.toLowerCase() && x.toLowerCase() !== g.name.toLowerCase())
                                : [...cur, g.name];
                              patchRouting({ overrideGroups: next });
                            }}
                            className={cn(
                              "flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
                              active
                                ? "border-emerald/40 bg-emerald/10 text-emerald"
                                : "border-white/[0.07] bg-black/20 text-muted-foreground/50 hover:text-foreground",
                            )}
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: `var(--${g.tone || "sapphire"})` }}
                            />
                            {active ? "✓ " : "+ "}
                            {g.name}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {routing.overrideAudience === "users" && (
                <div className="min-w-[280px] flex-1 border-t border-white/[0.06] pt-3 sm:border-t-0 sm:pt-0">
                  <Label>Permitted User Accounts (Click to Toggle)</Label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {accounts.length === 0 ? (
                      <span className="font-mono text-[11px] text-muted-foreground/40">No user accounts found</span>
                    ) : (
                      accounts.map((u) => {
                        const active = (routing.overrideUsers || []).some(
                          (au) => au.toLowerCase() === u.username.toLowerCase() || au.toLowerCase() === u.id.toLowerCase(),
                        );
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              const cur = routing.overrideUsers || [];
                              const next = active
                                ? cur.filter((x) => x.toLowerCase() !== u.username.toLowerCase() && x.toLowerCase() !== u.id.toLowerCase())
                                : [...cur, u.username];
                              patchRouting({ overrideUsers: next });
                            }}
                            className={cn(
                              "rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
                              active
                                ? "border-emerald/40 bg-emerald/10 text-emerald"
                                : "border-white/[0.07] bg-black/20 text-muted-foreground/50 hover:text-foreground",
                            )}
                          >
                            {active ? "✓ " : "+ "}
                            {u.name || u.username} ({u.username})
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {routing.overrideAudience === "roles" && (
                <div className="min-w-[280px] flex-1 border-t border-white/[0.06] pt-3 sm:border-t-0 sm:pt-0">
                  <Label>Permitted Roles (Click to Toggle)</Label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {roles.map((r) => {
                      const active = (routing.overrideRoles || ["Admin", "Operator"]).some(
                        (ar) => ar.toLowerCase() === r.name.toLowerCase(),
                      );
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            const cur = routing.overrideRoles || ["Admin", "Operator"];
                            const next = active
                              ? cur.filter((x) => x.toLowerCase() !== r.name.toLowerCase())
                              : [...cur, r.name];
                            patchRouting({ overrideRoles: next });
                          }}
                          className={cn(
                            "rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
                            active
                              ? "border-emerald/40 bg-emerald/10 text-emerald"
                              : "border-white/[0.07] bg-black/20 text-muted-foreground/50 hover:text-foreground",
                          )}
                        >
                          {active ? "✓ " : "+ "}
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Smart Router Regex Rules Builder */}
        {routing.mode === "smart_router" && (
          <div className="mt-6 border-t border-white/[0.06] pt-5">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-foreground/80 mb-3">
              Regex Routing Rules (Evaluated top to bottom)
            </h3>
            <div className="space-y-2">
              {(routing.smartRules || []).map((rule, idx) => (
                <div key={rule.id} className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-muted-foreground/50 w-4">{idx + 1}.</span>
                  <input
                    className={cn(fieldCls, "flex-1 font-mono text-[12px] placeholder:text-muted-foreground/30")}
                    placeholder="^.*(code|script).*$"
                    value={rule.pattern}
                    onChange={(e) => {
                      const updated = [...(routing.smartRules || [])];
                      if (updated[idx]) {
                        updated[idx].pattern = e.target.value;
                        patchRouting({ smartRules: updated });
                      }
                    }}
                  />
                  <span className="font-mono text-[10px] text-muted-foreground/50">→</span>
                  <select
                    className={cn(fieldCls, "w-[200px]")}
                    value={rule.providerId}
                    onChange={(e) => {
                      const updated = [...(routing.smartRules || [])];
                      if (updated[idx]) {
                        updated[idx].providerId = e.target.value;
                        patchRouting({ smartRules: updated });
                      }
                    }}
                  >
                    <option value="" disabled className="bg-canvas text-muted-foreground">Select AI provider</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id} className="bg-canvas">{p.name} ({p.kind})</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const updated = (routing.smartRules || []).filter((_, i) => i !== idx);
                      patchRouting({ smartRules: updated });
                    }}
                    className="text-ruby/60 hover:text-ruby transition-colors p-1"
                    title="Remove rule"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  const updated = [
                    ...(routing.smartRules || []), 
                    { id: `rule_${Math.random().toString(36).slice(2, 6)}`, pattern: "", providerId: "" }
                  ];
                  patchRouting({ smartRules: updated });
                }}
                className="mt-2 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-sapphire hover:text-sapphire/80 transition-colors"
              >
                <Plus size={12} /> Add Rule
              </button>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground/50 leading-relaxed">
                Hint: If the prompt matches the regex pattern, it will be routed to the selected provider. If no rules match, the system falls back to the top active provider in the registry.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* add / edit provider */}
      <section className="glass rounded-xl border border-white/[0.07] p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
          <div className="flex items-baseline gap-3">
            <Sparkles className="h-4 w-4 self-center text-amethyst" strokeWidth={1.6} />
            <h2 className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-foreground/80">
              {editingId ? "Edit Provider" : "Add Provider"}
            </h2>
            <span className="ml-auto flex items-center gap-2 font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground/60">
              <KeyRound className="h-3 w-3" strokeWidth={1.7} /> vault-bound or manual keys
            </span>
          </div>
          {editingId && (
            <button
              onClick={cancelEdit}
              className="text-[11px] font-mono text-muted-foreground/60 hover:text-foreground transition-colors uppercase tracking-widest"
            >
              Cancel Edit
            </button>
          )}
        </div>

        <div className="mt-5 grid gap-5 md:items-end">
          <p className="font-mono text-[11.5px] text-muted-foreground/60 max-w-xl">
            Fill in the details for your model provider.
            For local endpoints, use 127.0.0.1 instead of localhost.
          </p>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <label className="block">
            <Label>Provider name</Label>
            <input
              className={fieldCls}
              placeholder="Gemini · Tavily · OpenAI"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="block">
            <Label>Kind</Label>
            <select
              className={fieldCls}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as ProviderKind })}
            >
              <option value="llm" className="bg-canvas">
                LLM
              </option>
              <option value="search" className="bg-canvas">
                Search
              </option>
            </select>
          </label>
          <label className="block">
            <Label>Priority</Label>
            <input
              className={fieldCls}
              type="number"
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
            />
          </label>
          <label className="block">
            <Label>Base URL (optional)</Label>
            <input
              className={fieldCls}
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            />
          </label>
          <label className="block">
            <Label>Model (optional)</Label>
            <input
              className={fieldCls}
              placeholder="gemini-2.0-flash"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          </label>
          <div className="block">
            <Label>Credential · vault or manual</Label>
            <VaultKeyField
              value={draft.secretId}
              onChange={(secretId) => setDraft({ ...draft, secretId })}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-6 border-t border-white/[0.05] pt-4">
          <div className="flex items-center gap-3">
            <Toggle on={draft.active} onClick={() => setDraft({ ...draft, active: !draft.active })} />
            <span className="text-[12.5px] text-foreground/85">Active</span>
          </div>
          <div className="flex items-center gap-3">
            <Toggle on={draft.isCheapest} onClick={() => setDraft({ ...draft, isCheapest: !draft.isCheapest })} />
            <span className="text-[12.5px] text-foreground/85" title="Marks this provider as the destination when 'Cheapest first' mode is active.">
              Mark as cheapest (Cost optimized)
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {editingId && (
              <JewelButton size="sm" variant="outline" onClick={cancelEdit}>
                Cancel
              </JewelButton>
            )}
            <JewelButton size="sm" onClick={submit}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2} /> {editingId ? "Save changes" : "Save provider"}
            </JewelButton>
          </div>
        </div>
      </section>

      {/* list */}
      <section className="glass rounded-xl border border-white/[0.07] p-6">
        <div className="flex items-baseline gap-3">
          <h2 className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-foreground/80">
            Registered providers
          </h2>
          <span className="text-[12px] text-muted-foreground/70">
            ordered by priority · failover walks top-down
          </span>
        </div>

        {providers.length === 0 ? (
          <p className="mt-5 font-mono text-[11.5px] text-muted-foreground/60">
            No providers yet. Add Gemini / Tavily / OpenAI above.
          </p>
        ) : (
          <div className="mt-4">
            <AnimatePresence initial={false}>
              {[...providers]
                .sort((a, b) => a.priority - b.priority)
                .map((p) => (
                  <motion.div
                    key={p.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className={cn(
                      "grid grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-4 border-t border-white/[0.05] py-3 first:border-t-0",
                      editingId === p.id && "bg-white/[0.02] -mx-4 px-4 rounded"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <StatusDot tone={p.active ? "emerald" : "ruby"} />
                      {p.isCheapest && (
                        <span className="rounded bg-emerald/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-emerald/80 border border-emerald/20" title="Cost optimized (Cheapest)">
                          Cheapest
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] text-foreground/95 flex items-center gap-2">
                        <button
                          onClick={() => {
                            setDraft({
                              name: p.name,
                              kind: p.kind,
                              priority: p.priority,
                              baseUrl: p.baseUrl || "",
                              model: p.model || "",
                              secretId: p.secretId || "",
                              active: p.active,
                              isCheapest: p.isCheapest,
                            });
                            setEditingId(p.id);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="hover:text-sapphire transition-colors font-medium text-left"
                          title="Edit provider"
                        >
                          {p.name}
                        </button>
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground/65">
                        {p.kind} · priority {p.priority} · {p.model || "default model"}
                      </div>
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground/65">
                      {p.baseUrl || "—"}
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px]">
                      <KeyRound
                        className={cn(
                          "h-3 w-3 shrink-0",
                          secretBound(p.secretId) ? "text-emerald" : "text-topaz",
                        )}
                        strokeWidth={1.7}
                      />
                      <span
                        className={cn(
                          "truncate",
                          secretBound(p.secretId)
                            ? "text-foreground/80"
                            : "text-muted-foreground/60",
                        )}
                      >
                        {secretLabel(p.secretId)}
                      </span>
                    </div>
                    <Toggle on={p.active} onClick={() => update(p.id, { active: !p.active })} />
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await confirmAction({
                          title: `Delete provider ${p.name}?`,
                          body: "This provider will be permanently removed from the routing pool. This action cannot be undone.",
                          confirmLabel: "Delete",
                          cancelLabel: "Cancel",
                        });
                        if (ok) remove(p.id);
                      }}
                      className="text-muted-foreground/50 transition-colors hover:text-ruby"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </motion.div>
                ))}
            </AnimatePresence>
          </div>
        )}
      </section>
    </div>
  );
}
