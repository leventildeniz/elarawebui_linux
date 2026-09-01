import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Plug, ShieldCheck, Info, Plus, Trash2 } from "lucide-react";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { toast } from "sonner";
import { fetchApi } from "@/lib/api";

import { Surface } from "@/components/sovereign/surface";
import {
  PROVIDER_SPECS,
  POSTURE_COPY,
  defaultProvider,
  fieldLabel,
  useAuthProviders,
  validateProvider,
  type FieldSpec,
  type ProviderConfig,
  type ProviderId,
  type ProviderPosture,
} from "@/lib/auth-provider-store";

import { useRoles } from "@/lib/rbac-store";
import { ResetButton, SaveButton } from "@/components/sovereign/action-buttons";
import { cn } from "@/lib/utils";

const description =
  "Identity providers for the studio — Local, Microsoft Entra ID, LDAP / on-prem MS AD, RADIUS, SAML, OIDC and OAuth2 with per-provider group-to-template and role mapping.";

export const Route = createFileRoute("/authentication")({
  head: () => ({
    meta: [
      { title: "Authentication — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Authentication — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthenticationPage,
});

const labelCls =
  "mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60";
const fieldCls =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-sapphire/50";

function AuthenticationPage() {
  const { providers, update, addSource, removeSource } = useAuthProviders();
  const { roles } = useRoles();
  const roleNames = roles.map((r) => r.name);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, ProviderConfig>>({});

  const toggle = (id: string) => setOpen((s) => ({ ...s, [id]: !s[id] }));

  const draftOf = (stored: ProviderConfig) => drafts[stored.key] ?? stored;

  const setDraft = (id: string, next: ProviderConfig) => setDrafts((d) => ({ ...d, [id]: next }));
  const clearDraft = (id: string) =>
    setDrafts((d) => {
      const { [id]: _drop, ...rest } = d;
      return rest;
    });

  return (
    <Surface
      wide
      crumb="Authentication"
      title="Authentication"
      meta="IDENTITY PROVIDERS · GROUP MAPPING · CONFIG VALIDATION"
    >
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-topaz/22 bg-[color-mix(in_oklab,var(--topaz)_6%,transparent)] px-4 py-3">
        <Info size={14} strokeWidth={1.7} className="mt-[2px] shrink-0 text-topaz" />
        <p className="max-w-[900px] font-mono text-[11.5px] leading-relaxed text-muted-foreground/75">
          <span className="text-topaz">
            Local is the only provider signing principals in today.
          </span>{" "}
          Everything else on this page is a stored, validated configuration — no directory is
          contacted from the studio runtime, so nothing here reports a live bind. LDAP and RADIUS
          are raw wire protocols that need a bridge service inside the domain network; SAML, OIDC
          and OAuth2 need their redirect handshake wired to a deployment. Group grants resolve in
          one order everywhere:{" "}
          <span className="text-foreground/80">
            user template → role map → provider default role
          </span>
          .
        </p>
      </div>

      <div className="grid gap-6">
        {PROVIDER_SPECS.map((spec, gi) => {
          const kindSources = providers.filter((p) => p.id === spec.id);
          return (
            <section key={spec.id} className="grid gap-0">
              <header
                className="flex items-center justify-between gap-4 rounded-t-xl border border-white/[0.07] px-4 py-3"
                style={{
                  background: `linear-gradient(90deg, color-mix(in oklab, var(--${spec.tone}) 9%, transparent), transparent 62%)`,
                  borderBottomColor: `color-mix(in oklab, var(--${spec.tone}) 22%, transparent)`,
                }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="h-4 w-[2px] shrink-0 rounded-full"
                    style={{
                      background: `var(--${spec.tone})`,
                      boxShadow: `0 0 10px -2px var(--${spec.tone})`,
                    }}
                  />
                  <h2
                    className="truncate font-mono text-[12.5px] font-medium uppercase tracking-[0.18em]"
                    style={{ color: `var(--${spec.tone})` }}
                  >
                    {spec.label}
                  </h2>
                  <PostureChip posture={spec.posture} />
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground/45">
                    {kindSources.length} source{kindSources.length === 1 ? "" : "s"}
                  </span>
                </div>
                {spec.id !== "local" && (
                  <button
                    onClick={() => {
                      const src = addSource(spec.id);
                      setOpen((s) => ({ ...s, [src.key]: true }));
                    }}
                    title={`Add another ${spec.label} source (domain, tenant or cluster)`}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-white/[0.12] px-3 py-[6px] font-mono text-[11px] tracking-[0.12em] text-muted-foreground/70 transition-colors hover:border-sapphire/50 hover:text-foreground"
                  >
                    <Plus size={12} strokeWidth={1.8} /> ADD SOURCE
                  </button>
                )}
              </header>

              <div
                className="grid gap-2 rounded-b-xl border border-t-0 border-white/[0.07] bg-white/[0.008] p-2.5 pl-4"
                style={{
                  borderLeftColor: `color-mix(in oklab, var(--${spec.tone}) 26%, transparent)`,
                }}
              >
              {kindSources.map((stored, i) => {

                const cfg = draftOf(stored);
                const dirty = JSON.stringify(cfg) !== JSON.stringify(stored);
                const isOpen = !!open[stored.key];
                const filled = spec.fields.filter((f) => (cfg.fields[f.key] || "").trim()).length;

                return (
                  <motion.section
                    key={stored.key}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.15,
                      delay: Math.min(gi * 0.03 + i * 0.03, 0.24),
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className={cn(
                      "overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015] transition-colors",
                      isOpen && "bg-white/[0.022]",
                    )}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggle(stored.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(stored.key);
                        }
                      }}
                      className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left outline-none focus-visible:bg-white/[0.03]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={
                            cfg.enabled
                              ? {
                                  background: `var(--${spec.tone})`,
                                  boxShadow: `0 0 8px -1px var(--${spec.tone})`,
                                }
                              : { background: "color-mix(in oklab, white 18%, transparent)" }
                          }
                        />
                        <input
                          value={cfg.label}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setDraft(stored.key, { ...cfg, label: e.target.value })}
                          title="Source name — the domain, tenant or cluster this configuration points at"
                          placeholder="Source name"
                          className="w-[220px] rounded-md border border-transparent bg-transparent px-2 py-[3px] font-mono text-[12.5px] text-foreground outline-none transition-colors hover:border-white/[0.09] focus:border-sapphire/50"
                        />
                        {!isOpen && (
                          <span className="truncate font-mono text-[11px] text-muted-foreground/50">
                            {filled}/{spec.fields.length} configured · default: {cfg.defaultRole}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <Toggle
                          on={cfg.enabled}
                          disabled={spec.id === "local"}
                          tone={spec.tone}
                          onChange={(v) => setDraft(stored.key, { ...cfg, enabled: v })}
                        />
                        {spec.id !== "local" && (
                          <button
                            title={`Remove source "${cfg.label}"`}
                            aria-label="Remove source"
                            onClick={(e) => {
                              e.stopPropagation();
                              void (async () => {
                                const ok = await confirmAction({
                                  title: `Remove source "${cfg.label}"?`,
                                  body: "This identity source and its stored configuration are deleted.",
                                  confirmLabel: "Remove",
                                });
                                if (ok) {
                                  clearDraft(stored.key);
                                  removeSource(stored.key);
                                }
                              })();
                            }}
                            className="text-muted-foreground/45 transition-colors hover:text-ruby"
                          >
                            <Trash2 size={14} strokeWidth={1.6} />
                          </button>
                        )}
                        <motion.span
                          animate={{ rotate: isOpen ? 180 : 0 }}
                          transition={{ duration: 0.14, ease: "easeInOut" }}
                          className="text-muted-foreground/50"
                        >
                          <ChevronDown size={16} strokeWidth={1.5} />
                        </motion.span>
                      </div>
                    </div>

                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <div className="border-t border-white/[0.05] px-5 pb-5 pt-4">
                            <p className="mb-4 font-mono text-[12px] leading-relaxed text-muted-foreground/65">
                              {spec.note ?? POSTURE_COPY[spec.posture].blurb}
                            </p>

                            {spec.fields.length > 0 && (
                              <div className="grid gap-x-5 gap-y-3 md:grid-cols-2">
                                {spec.fields.map((f) => (
                                  <Field
                                    key={f.key}
                                    spec={f}
                                    value={cfg.fields[f.key] ?? ""}
                                    onChange={(v) =>
                                      setDraft(stored.key, {
                                        ...cfg,
                                        fields: { ...cfg.fields, [f.key]: v },
                                      })
                                    }
                                  />
                                ))}
                              </div>
                            )}

                            {spec.hint && (
                              <p className="mt-3 max-w-[820px] font-mono text-[10.5px] leading-relaxed text-muted-foreground/45">
                                {spec.hint}
                              </p>
                            )}

                            <div className="mt-4 border-t border-white/[0.05] pt-4">
                              <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/80">
                                Routing & Priority
                              </h3>
                              <div className="grid gap-x-5 gap-y-3 md:grid-cols-2">
                                <label className="block">
                                  <span className={labelCls}>Priority (Lower is preferred)</span>
                                  <input
                                    className={fieldCls}
                                    type="number"
                                    value={cfg.priority}
                                    onChange={(e) =>
                                      setDraft(stored.key, {
                                        ...cfg,
                                        priority: parseInt(e.target.value) || 0,
                                      })
                                    }
                                  />
                                </label>
                              </div>
                            </div>

                            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-4">
                              <div className="flex items-center gap-2.5">
                                <span className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground/60">
                                  DEFAULT ROLE FOR NEW ACCOUNTS
                                </span>
                                <RoleSelect
                                  value={cfg.defaultRole}
                                  options={roleNames}
                                  onChange={(v) => setDraft(stored.key, { ...cfg, defaultRole: v })}
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                {spec.testable && <ValidateConfig id={spec.id} cfg={cfg} />}
                                {dirty && (
                                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-topaz">
                                    unsaved
                                  </span>
                                )}
                                <ResetButton
                                  onReset={() => {
                                    clearDraft(stored.key);
                                    const d = defaultProvider(spec.id, stored.key, stored.label);
                                    update(stored.key, {
                                      enabled: d.enabled,
                                      defaultRole: d.defaultRole,
                                      fields: d.fields,
                                    });
                                  }}
                                  title={`Reset source "${cfg.label}"?`}
                                  body="Unsaved edits are discarded and this identity source reverts to factory defaults."
                                />

                                <SaveButton
                                  disabled={!dirty}
                                  onSave={() => {
                                    update(stored.key, {
                                      enabled: cfg.enabled,
                                      priority: cfg.priority,
                                      defaultRole: cfg.defaultRole,
                                      fields: cfg.fields,
                                    });
                                    clearDraft(stored.key);
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.section>
                );
              })}
              </div>
            </section>

          );
        })}
      </div>

    </Surface>
  );
}

function Field({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={spec.wide ? "md:col-span-2" : undefined}>
      <span className={labelCls}>{spec.label}</span>
      {spec.type === "select" ? (
        <select
          value={value || spec.options?.[0] || ""}
          onChange={(e) => onChange(e.target.value)}
          className={cn(fieldCls, "appearance-none")}
        >
          {spec.options?.map((o) => (
            <option key={o} value={o} className="bg-canvas">
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={spec.type === "password" ? "password" : "text"}
          value={value}
          placeholder={spec.placeholder ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={fieldCls}
        />
      )}
    </div>
  );
}

function RoleSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="appearance-none rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[6px] font-mono text-[12.5px] text-foreground outline-none transition-colors hover:border-sapphire/45 focus:border-sapphire/50"
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-canvas">
          {o}
        </option>
      ))}
    </select>
  );
}

function PostureChip({ posture }: { posture: ProviderPosture }) {
  const copy = POSTURE_COPY[posture];
  return (
    <span
      title={copy.blurb}
      className="rounded-md border px-2 py-[3px] font-mono text-[9.5px] uppercase tracking-[0.16em]"
      style={{
        borderColor: `color-mix(in oklab, var(--${copy.tone}) 34%, transparent)`,
        color: `var(--${copy.tone})`,
        background: `color-mix(in oklab, var(--${copy.tone}) 7%, transparent)`,
      }}
    >
      {copy.chip}
    </span>
  );
}

/**
 * Real API validation: checks reachability by sending the config to the backend.
 * Local validation checks missing/malformed fields first before creating network requests.
 */
function ValidateConfig({ id, cfg }: { id: ProviderId; cfg: ProviderConfig }) {
  const [verdict, setVerdict] = useState<ReturnType<typeof validateProvider> | null>(null);
  const [networkOk, setNetworkOk] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    const localVerdict = validateProvider(id, cfg);
    setVerdict(localVerdict);
    setNetworkOk(null);

    if (localVerdict.complete && (id === "ldap" || id === "radius" || id === "oidc" || id === "saml")) {
      setLoading(true);
      try {
        const res = await fetchApi("/identity/auth-providers/test", {
          method: "POST",
          body: JSON.stringify({ id, config: cfg.fields })
        });
        if (res.ok) {
          toast.success(res.message || "Provider test successful");
          setNetworkOk(true);
        } else {
          toast.error(res.error || "Provider connection failed");
          setNetworkOk(false);
        }
      } catch (e: any) {
        toast.error(e.message || "Provider connection failed");
        setNetworkOk(false);
      } finally {
        setLoading(false);
      }
    }

    window.setTimeout(() => {
      setVerdict(null);
      setNetworkOk(null);
    }, 8000);
  };

  const problems = verdict
    ? [
        ...verdict.missing.map((k) => `${fieldLabel(id, k)} missing`),
        ...verdict.malformed.map((k) => `${fieldLabel(id, k)} is not an absolute URL`),
        ...verdict.badJson.map((k) => `${fieldLabel(id, k)} is not valid JSON`),
      ]
    : [];

  return (
    <div className="flex items-center gap-2.5">
      {loading && (
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-sapphire">
          TESTING...
        </span>
      )}
      {!loading && verdict?.complete && networkOk === true && (
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-emerald">
          <ShieldCheck size={12} /> REACHABLE & VALID
        </span>
      )}
      {!loading && verdict?.complete && networkOk === false && (
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-ruby">
          <ShieldCheck size={12} /> VALID BUT UNREACHABLE
        </span>
      )}
      {!loading && verdict?.complete && networkOk === null && (
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-emerald">
          <ShieldCheck size={12} /> CONFIG COMPLETE
        </span>
      )}
      {!loading && verdict && !verdict.complete && (
        <span
          title={problems.join(" · ")}
          className="max-w-[320px] truncate font-mono text-[11px] text-ruby"
        >
          {problems[0]}
          {problems.length > 1 ? ` · +${problems.length - 1} more` : ""}
        </span>
      )}
      <button
        onClick={run}
        disabled={loading}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-3 py-[6px] font-mono text-[11px] tracking-[0.12em] transition-colors",
          loading ? "opacity-50 cursor-not-allowed" : "",
          verdict?.complete && networkOk !== false
            ? "border-emerald/30 bg-emerald/10 text-emerald hover:bg-emerald/20"
            : "border-white/[0.08] bg-raised/40 text-muted-foreground/80 hover:border-sapphire/50 hover:text-foreground"
        )}
      >
        <Plug size={12} strokeWidth={1.7} />
        VALIDATE CONFIG
      </button>
    </div>
  );
}

function Toggle({
  on,
  tone,
  disabled,
  onChange,
}: {
  on: boolean;
  tone: string;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={cn(
        "relative h-[22px] w-[42px] rounded-full border transition-colors",
        on ? "border-transparent" : "border-white/12 bg-raised/50",
        disabled && "cursor-not-allowed opacity-70",
      )}
      style={
        on ? { background: `var(--${tone})`, boxShadow: `0 0 16px -6px var(--${tone})` } : undefined
      }
    >
      <motion.span
        layout
        transition={{ duration: 0.14, ease: "easeInOut" }}
        className={cn(
          "absolute top-[2px] h-[16px] w-[16px] rounded-full",
          on ? "left-[23px] bg-canvas" : "left-[3px] bg-muted-foreground/60",
        )}
      />
    </button>
  );
}
