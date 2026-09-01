import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Lock } from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/sovereign/surface";
import { EntityAvatar } from "@/components/sovereign/identity";
import { avatarStyles, jewelNames } from "@/lib/avatar-library";
import { applyTheme, storedThemeId, themePresets } from "@/lib/theme-store";
import { useIdentity } from "@/lib/group-store";
import { updateAccountPassword } from "@/lib/credential-store";
import { useUserTemplates, selfServiceMeta, type SelfServiceKey } from "@/lib/user-template-store";
import {
  canEdit,
  emptyPrefs,
  memoryCeiling,
  readPrefs,
  writePrefs,
  type UserPrefs,
} from "@/lib/user-prefs-store";
import {
  defaultProfile,
  readProfile,
  writeProfile,
  type OperatorProfile,
} from "@/components/sovereign/operator-card";
import { cn } from "@/lib/utils";

const description =
  "Operator workspace: identity, avatar library, studio themes, delegated model preferences and credential rotation.";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Account — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Account — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AccountPage,
});

const tabs = [
  { id: "identity", label: "Identity" },
  { id: "appearance", label: "Appearance" },
  { id: "theme", label: "Studio theme" },
  { id: "model", label: "Model preferences" },
  { id: "security", label: "Security" },
] as const;

type TabId = (typeof tabs)[number]["id"];

function AccountPage() {
  const [tab, setTab] = useState<TabId>("identity");
  const [draft, setDraft] = useState<OperatorProfile>(defaultProfile);
  const [theme, setTheme] = useState("obsidian");
  const [prefs, setPrefs] = useState<UserPrefs>(emptyPrefs);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const { accounts, updateAccount, groupsOf } = useIdentity();
  const { templates } = useUserTemplates();

  const self =
    accounts.find((a) => a.name === draft.name) ??
    accounts.find((a) => a.username === draft.name.toLowerCase()) ??
    accounts[0];

  const templateId = self?.template || groupsOf(self?.id ?? "")[0]?.defaultTemplate || "";
  const template = templates.find((t) => t.id === templateId);
  const delegated = selfServiceMeta.filter((m) => canEdit(template, m.key));

  useEffect(() => {
    setDraft(readProfile());
    setTheme(storedThemeId());
  }, []);

  useEffect(() => {
    setPrefs(self ? readPrefs(self.id) : emptyPrefs());
  }, [self?.id]);

  const arm = (key: SelfServiceKey, patch: Partial<UserPrefs>) =>
    setPrefs((v) => ({ ...v, ...patch, touched: { ...v.touched, [key]: true } }));

  const reset = (key: SelfServiceKey) =>
    setPrefs((v) => ({ ...v, touched: { ...v.touched, [key]: false } }));

  const save = () => {
    writeProfile(draft);
    if (self) writePrefs(self.id, prefs);
    toast.success("Account settings saved");
  };

  return (
    <Surface
      crumb=""
      title={draft.name}
      meta={`OPERATOR · ${(draft.role || "").toUpperCase()}`}
      wide
      action={
        <button
          onClick={save}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald/40 bg-emerald/12 px-3.5 py-2 text-[13px] font-medium text-emerald transition-colors hover:bg-emerald/20"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={1.8} />
          Save changes
        </button>
      }
    >
      <div className="grid gap-10 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-6">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.012] p-6 text-center">
            <EntityAvatar
              seed={draft.name || "operator"}
              label={draft.name}
              style={draft.style}
              jewel={draft.jewel}
              size={104}
            />
            <div className="leading-tight">
              <div className="text-[16px] font-medium text-foreground">{draft.name}</div>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground/55">
                {draft.role}
              </div>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors",
                  tab === t.id
                    ? "border border-sapphire/40 bg-sapphire/10 text-foreground"
                    : "border border-transparent text-muted-foreground/70 hover:bg-raised/40 hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </aside>

        <motion.section
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-8"
        >
          {tab === "identity" && (
            <Panel title="Directory identity" hint="managed by Users & Groups">
              <div className="grid gap-4 sm:grid-cols-2">
                <ReadOnly label="Display name" value={draft.name} />
                <ReadOnly label="Role" value={draft.role} />
                <ReadOnly label="Provider" value={self?.provider ?? "—"} />
                <ReadOnly
                  label="Groups"
                  value={
                    groupsOf(self?.id ?? "")
                      .map((g) => g.name)
                      .join(", ") || "no group"
                  }
                />
                <ReadOnly label="Template" value={template?.name ?? "no template bound"} />
                <ReadOnly
                  label="Validity"
                  value={
                    self?.locked
                      ? "locked by admin"
                      : self?.validUntil
                        ? `valid until ${self.validUntil}`
                        : "no expiry"
                  }
                />
              </div>
            </Panel>
          )}

          {tab === "appearance" && (
            <>
              <Panel title="Avatar style" hint={`${avatarStyles.length} studio sigils`}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {avatarStyles.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setDraft((d) => ({ ...d, style: s.id }))}
                      className={cn(
                        "flex flex-col items-center gap-3 rounded-xl border p-4 transition-colors",
                        draft.style === s.id
                          ? "border-sapphire/50 bg-sapphire/10"
                          : "border-white/[0.06] bg-raised/20 hover:border-white/15",
                      )}
                    >
                      <EntityAvatar
                        seed={draft.name || "operator"}
                        label={draft.name}
                        style={s.id}
                        jewel={draft.jewel}
                        size={64}
                      />
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/65">
                        {s.label}
                      </span>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Jewel" hint="accent + glow">
                <div className="flex flex-wrap gap-4">
                  {jewelNames.map((j) => (
                    <button
                      key={j}
                      aria-label={j}
                      onClick={() => setDraft((d) => ({ ...d, jewel: j }))}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-xl border px-4 py-3 transition-colors",
                        draft.jewel === j
                          ? "border-white/30 bg-white/[0.04]"
                          : "border-white/[0.06] hover:border-white/15",
                      )}
                      title={j}
                    >
                      <span
                        className="h-9 w-9 rounded-full border border-white/15"
                        style={{
                          background: `var(--${j === "platinum" ? "muted-foreground" : j})`,
                        }}
                      />
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">
                        {j}
                      </span>
                    </button>
                  ))}
                </div>
              </Panel>
            </>
          )}

          {tab === "theme" && (
            <Panel title="Studio theme" hint="applies instantly">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {themePresets.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      applyTheme(p);
                      setTheme(p.id);
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                      theme === p.id
                        ? "border-sapphire/50 bg-sapphire/10"
                        : "border-white/[0.06] bg-raised/20 hover:border-white/15",
                    )}
                  >
                    <span
                      className="h-10 w-10 shrink-0 rounded-lg border border-white/10"
                      style={{
                        background: `linear-gradient(135deg, ${p.vars.canvasDeep}, ${p.vars.raised} 60%, ${p.vars.sapphire})`,
                      }}
                    />
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-[13.5px] text-foreground">
                        {p.label}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-muted-foreground/50">
                        {p.hint}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Panel>
          )}

          {tab === "model" && (
            <Panel
              title="Model preferences"
              hint={`${template ? template.name : "no template"}${delegated.length ? ` · ${delegated.length} delegated` : ""}`}
            >
              {delegated.length === 0 ? (
                <p className="font-mono text-[12px] leading-relaxed text-muted-foreground/55">
                  Your template keeps sampling and prompt layers sealed. Ask an administrator to
                  delegate a knob in Users &amp; Groups → Templates.
                </p>
              ) : (
                <div className="grid gap-5 lg:grid-cols-2">
                  {delegated.map((m) => {
                    const on = Boolean(prefs.touched[m.key]);
                    return (
                      <div
                        key={m.key}
                        className="space-y-2 rounded-xl border border-white/[0.06] bg-raised/15 p-4"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/55">
                            {m.label}
                          </span>
                          <button
                            onClick={() => (on ? reset(m.key) : arm(m.key, {}))}
                            className={cn(
                              "ml-auto rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
                              on
                                ? "border-emerald/40 bg-emerald/10 text-emerald"
                                : "border-white/10 text-muted-foreground/55 hover:text-foreground",
                            )}
                          >
                            {on ? "override" : "inherit"}
                          </button>
                        </div>

                        {m.key === "personaPrompt" && (
                          <textarea
                            rows={6}
                            disabled={!on}
                            value={prefs.personaPrompt}
                            onChange={(e) => arm(m.key, { personaPrompt: e.target.value })}
                            placeholder="Tone, formatting and personal working style. Appended as the last prompt layer."
                            className="w-full resize-y rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-sapphire/50 disabled:opacity-45"
                          />
                        )}

                        {m.key === "stopSequences" && (
                          <input
                            disabled={!on}
                            value={prefs.stopSequences}
                            onChange={(e) => arm(m.key, { stopSequences: e.target.value })}
                            placeholder="</end>, ###"
                            className="w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-sapphire/50 disabled:opacity-45"
                          />
                        )}

                        {(m.key === "thinkEnabled" || m.key === "streaming") && (
                          <button
                            disabled={!on}
                            onClick={() =>
                              arm(m.key, { [m.key]: !prefs[m.key] } as Partial<UserPrefs>)
                            }
                            className={cn(
                              "rounded-lg border px-3 py-1.5 font-mono text-[11.5px] transition-colors disabled:opacity-45",
                              prefs[m.key]
                                ? "border-emerald/40 bg-emerald/10 text-emerald"
                                : "border-white/10 text-muted-foreground/60",
                            )}
                          >
                            {prefs[m.key] ? "enabled" : "disabled"}
                          </button>
                        )}

                        {(m.key === "temperature" ||
                          m.key === "topP" ||
                          m.key === "topK" ||
                          m.key === "maxTokens") && (
                          <div className="flex items-center gap-3">
                            <input
                              type="range"
                              disabled={!on}
                              min={m.key === "topK" ? 1 : m.key === "maxTokens" ? 256 : 0}
                              max={m.key === "topK" ? 200 : m.key === "maxTokens" ? 32768 : 1}
                              step={m.key === "topK" || m.key === "maxTokens" ? 1 : 0.01}
                              value={prefs[m.key]}
                              onChange={(e) =>
                                arm(m.key, {
                                  [m.key]: Number(e.target.value),
                                } as Partial<UserPrefs>)
                              }
                              className="h-1 flex-1 accent-[var(--sapphire)] disabled:opacity-45"
                            />
                            <span className="w-16 text-right font-mono text-[11.5px] text-muted-foreground/70">
                              {prefs[m.key]}
                            </span>
                          </div>
                        )}

                        {(m.key === "memoryCompactAt" || m.key === "memoryKeepLastTurns") && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                              <input
                                type="range"
                                disabled={!on}
                                min={m.key === "memoryCompactAt" ? 30 : 1}
                                max={memoryCeiling(template, m.key)}
                                step={1}
                                value={Math.min(prefs[m.key], memoryCeiling(template, m.key))}
                                onChange={(e) => {
                                  const mk = m.key as "memoryCompactAt" | "memoryKeepLastTurns";
                                  arm(mk, {
                                    [mk]: Math.min(
                                      Number(e.target.value),
                                      memoryCeiling(template, mk),
                                    ),
                                  } as Partial<UserPrefs>);
                                }}
                                className="h-1 flex-1 accent-[var(--emerald)] disabled:opacity-45"
                              />
                              <span className="w-16 text-right font-mono text-[11.5px] text-muted-foreground/70">
                                {Math.min(prefs[m.key], memoryCeiling(template, m.key))}
                                {m.key === "memoryCompactAt" ? "%" : ""}
                              </span>
                            </div>
                            <div className="font-mono text-[10.5px] text-muted-foreground/45">
                              Template ceiling {memoryCeiling(template, m.key)}
                              {m.key === "memoryCompactAt" ? "%" : " turns"} — you can only go
                              tighter.
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {tab === "security" && self && (
            <Panel title="Credentials" hint={self.locked ? "locked by admin" : "rotation"}>
              <div className="grid max-w-[560px] gap-4">
                <FieldLabel label="New password">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[14px] text-foreground outline-none transition-colors focus:border-sapphire/50"
                  />
                </FieldLabel>
                <FieldLabel label="Confirm password">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[14px] text-foreground outline-none transition-colors focus:border-sapphire/50"
                  />
                </FieldLabel>
                <div className="flex items-center gap-3">
                  <button
                    disabled={self.locked || pw.length < 10 || pw !== confirm}
                    onClick={async () => {
                      try {
                        await updateAccountPassword(self.id, pw);
                        updateAccount(self.id, { passwordChangedAt: new Date().toISOString() });
                        setPw("");
                        setConfirm("");
                        toast.success("Password updated");
                      } catch (err) {
                        toast.error("Failed to update password");
                      }
                    }}
                    className="rounded-lg border border-emerald/40 bg-emerald/12 px-3 py-1.5 text-[12.5px] text-emerald transition-colors hover:bg-emerald/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Change password
                  </button>
                  <span className="font-mono text-[11px] text-muted-foreground/50">
                    {self.locked ? "Locked — contact an administrator." : "Minimum 10 characters."}
                  </span>
                </div>
              </div>
            </Panel>
          )}
        </motion.section>
      </div>
    </Surface>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.012] p-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-muted-foreground/60">
          {title}
        </h2>
        {hint && (
          <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/40">{hint}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <FieldLabel label={label}>
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-raised/20 px-3 py-2 text-[14px] text-foreground/85">
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" strokeWidth={1.5} />
        <span className="truncate">{value}</span>
      </div>
    </FieldLabel>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/55">
        {label}
      </span>
      {children}
    </label>
  );
}
