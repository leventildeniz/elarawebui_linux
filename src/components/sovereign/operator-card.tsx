import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { X, Check, Lock } from "lucide-react";
import { currentAccount, useIdentity } from "@/lib/group-store";
import { EntityAvatar } from "./identity";
import { avatarStyles, jewelNames, type AvatarStyle, type JewelName } from "@/lib/avatar-library";
import { applyTheme, storedThemeId, themePresets } from "@/lib/theme-store";
import { useUserTemplates, selfServiceMeta, type SelfServiceKey } from "@/lib/user-template-store";
import { canEdit, emptyPrefs, readPrefs, writePrefs, type UserPrefs } from "@/lib/user-prefs-store";
import { cn } from "@/lib/utils";

export type OperatorProfile = {
  name: string;
  role: string;
  style: AvatarStyle;
  jewel: JewelName;
};

const KEY = "sovereign.profile";

export const defaultProfile: OperatorProfile = {
  name: "Operator",
  role: "Sovereign Commander",
  style: "sigil",
  jewel: "sapphire",
};

/**
 * Identity (name + role) is owned by the directory — it is derived from the
 * signed-in account and is never editable here. Only presentation prefs
 * (avatar, jewel, theme) live in local storage.
 */
export function readProfile(): OperatorProfile {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<OperatorProfile>) : {};
    const account = currentAccount();
    return {
      ...defaultProfile,
      style: parsed.style ?? defaultProfile.style,
      jewel: parsed.jewel ?? defaultProfile.jewel,
      name: account?.name ?? defaultProfile.name,
      role: account?.role ?? defaultProfile.role,
    };
  } catch {
    return defaultProfile;
  }
}

export function writeProfile(profile: OperatorProfile) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ style: profile.style, jewel: profile.jewel }));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("sovereign:profile"));
}

/** Operator settings card — avatar, identity and preferences for the signed-in user. */
export function OperatorCard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<OperatorProfile>(defaultProfile);
  const { accounts, updateAccount, groupsOf } = useIdentity();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [theme, setTheme] = useState("obsidian");
  const { templates } = useUserTemplates();
  const [prefs, setPrefs] = useState<UserPrefs>(emptyPrefs);

  const self =
    accounts.find((a) => a.name === draft.name) ??
    accounts.find((a) => a.username === draft.name.toLowerCase()) ??
    accounts[0];

  const templateId = self?.template || groupsOf(self?.id ?? "")[0]?.defaultTemplate || "";
  const template = templates.find((t) => t.id === templateId);
  const delegated = selfServiceMeta.filter((m) => canEdit(template, m.key));

  useEffect(() => {
    if (open) {
      setDraft(readProfile());
      setTheme(storedThemeId());
      setPrefs(self ? readPrefs(self.id) : emptyPrefs());
    }
  }, [open, self?.id]);

  const arm = (key: SelfServiceKey, patch: Partial<UserPrefs>) =>
    setPrefs((v) => ({ ...v, ...patch, touched: { ...v.touched, [key]: true } }));

  const reset = (key: SelfServiceKey) =>
    setPrefs((v) => ({ ...v, touched: { ...v.touched, [key]: false } }));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[520px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-canvas shadow-[0_30px_80px_-30px_oklch(0_0_0/0.9)]"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
              <div className="flex flex-col leading-tight">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/55">
                  operator
                </span>
                <span className="text-[15.5px] font-semibold text-foreground">
                  Account Settings
                </span>
              </div>
              <button
                aria-label="Close"
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-raised/60 hover:text-foreground"
                title="Close"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-5 px-5 py-5">
              <div className="flex items-center gap-4">
                <EntityAvatar
                  seed={draft.name || "operator"}
                  label={draft.name}
                  style={draft.style}
                  jewel={draft.jewel}
                  size={64}
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <ReadOnlyField label="Display name" value={draft.name} />
                  <ReadOnlyField label="Role" value={draft.role} />
                  <p className="font-mono text-[10.5px] text-muted-foreground/45">
                    Managed by the directory — change it in Users &amp; Groups.
                  </p>
                </div>
              </div>

              <Field label="Avatar style">
                <div className="flex flex-wrap gap-1.5">
                  {avatarStyles.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setDraft((d) => ({ ...d, style: s.id }))}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors",
                        draft.style === s.id
                          ? "border-sapphire/50 bg-sapphire/10 text-foreground"
                          : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:text-foreground",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Jewel">
                <div className="flex flex-wrap gap-2">
                  {jewelNames.map((j) => (
                    <button
                      key={j}
                      aria-label={j}
                      onClick={() => setDraft((d) => ({ ...d, jewel: j }))}
                      className={cn(
                        "h-7 w-7 rounded-full border transition-transform",
                        draft.jewel === j
                          ? "scale-110 border-white/40"
                          : "border-white/10 hover:scale-105",
                      )}
                      style={{
                        background: `var(--${j === "platinum" ? "muted-foreground" : j})`,
                      }}
                      title={j}
                    />
                  ))}
                </div>
              </Field>

              <Field label="Studio theme">
                <div className="grid grid-cols-2 gap-2">
                  {themePresets.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        applyTheme(p);
                        setTheme(p.id);
                      }}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                        theme === p.id
                          ? "border-sapphire/50 bg-sapphire/10"
                          : "border-white/[0.06] bg-raised/25 hover:border-white/15",
                      )}
                    >
                      <span
                        className="h-6 w-6 shrink-0 rounded-md border border-white/10"
                        style={{
                          background: `linear-gradient(135deg, ${p.vars.canvasDeep}, ${p.vars.raised} 60%, ${p.vars.sapphire})`,
                        }}
                      />
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate text-[12.5px] text-foreground">
                          {p.label}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground/50">
                          {p.hint}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </Field>

              <div className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.012] p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/55">
                    model preferences
                  </span>
                  <span className="ml-auto font-mono text-[10.5px] text-muted-foreground/45">
                    {template ? template.name : "no template bound"}
                    {delegated.length ? ` · ${delegated.length} delegated` : ""}
                  </span>
                </div>

                {delegated.length === 0 ? (
                  <p className="font-mono text-[11px] leading-relaxed text-muted-foreground/50">
                    Your template keeps sampling and prompt layers sealed. Ask an administrator to
                    delegate a knob in Users &amp; Groups → Templates.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {delegated.map((m) => {
                      const on = Boolean(prefs.touched[m.key]);
                      return (
                        <div key={m.key} className="space-y-1.5">
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
                              rows={3}
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {self && (
                <div className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.012] p-4">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground/60">
                    <Lock className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>
                      {self.role} · {self.provider} ·{" "}
                      {groupsOf(self.id)
                        .map((g) => g.name)
                        .join(", ") || "no group"}
                    </span>
                    <span className="ml-auto">
                      {self.locked
                        ? "account locked by admin"
                        : self.validUntil
                          ? `valid until ${self.validUntil}`
                          : "no expiry"}
                    </span>
                  </div>

                  <Field label="New password">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={pw}
                      onChange={(e) => {
                        setPw(e.target.value);
                        setPwMsg("");
                      }}
                      className="w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[14px] text-foreground outline-none transition-colors focus:border-sapphire/50"
                    />
                  </Field>
                  <Field label="Confirm password">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => {
                        setConfirm(e.target.value);
                        setPwMsg("");
                      }}
                      className="w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 text-[14px] text-foreground outline-none transition-colors focus:border-sapphire/50"
                    />
                  </Field>
                  <div className="flex items-center gap-3">
                    <button
                      disabled={self.locked || pw.length < 10 || pw !== confirm}
                      onClick={() => {
                        updateAccount(self.id, { passwordChangedAt: new Date().toISOString() });
                        setPw("");
                        setConfirm("");
                        setPwMsg("Password updated.");
                      }}
                      className="rounded-lg border border-emerald/40 bg-emerald/12 px-3 py-1.5 text-[12.5px] text-emerald transition-colors hover:bg-emerald/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Change password
                    </button>
                    <span className="font-mono text-[11px] text-muted-foreground/50">
                      {pwMsg ||
                        (self.locked
                          ? "Locked — contact an administrator."
                          : "Minimum 10 characters.")}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
              <button
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-[13px] text-muted-foreground/80 transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  writeProfile(draft);
                  if (self) writePrefs(self.id, prefs);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald/40 bg-emerald/12 px-3.5 py-2 text-[13px] font-medium text-emerald transition-colors hover:bg-emerald/20"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={1.8} />
                Save changes
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-raised/20 px-3 py-2 text-[14px] text-foreground/85">
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" strokeWidth={1.5} />
        <span className="truncate">{value}</span>
      </div>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/55">
        {label}
      </span>
      {children}
    </label>
  );
}
