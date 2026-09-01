import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, KeyRound, Lock, ShieldCheck } from "lucide-react";
import {
  ROLE_ACTIONS,
  SCOPE_GROUPS,
  TAB_SCOPES,
  roleActions,
  isSovereign,
  setEnforcement,
  startPreview,
  exitPreview,
  useAccess,
  useRoles,
} from "@/lib/rbac-store";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { cn } from "@/lib/utils";
import { Shell } from "@/components/sovereign/shell";

export const Route = createFileRoute("/rbac")({
  head: () => ({
    meta: [
      { title: "RBAC — Elara Sovereign Studio" },
      {
        name: "description",
        content:
          "Role-based access control: one tab per role, granting exactly which studio surfaces each principal may open.",
      },
      { property: "og:title", content: "RBAC — Elara Sovereign Studio" },
      {
        property: "og:description",
        content: "Grant, revoke and author studio roles with per-tab permission scopes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RbacPage,
});

const label = "mb-1.5 block font-mono text-[11px] tracking-[0.14em] text-muted-foreground/70";
const field =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";

function RbacPage() {
  const { roles, active, updateRole, toggleScope, setAll, toggleAction, cloneRole } = useRoles();
  const { enforced, previewing, previewRole } = useAccess();
  const role = roles.find((r) => r.id === active) ?? roles[0];

  if (!role) return null;

  const locked = role.system;

  return (
    <Shell crumb="RBAC">
      <div className="mx-auto w-full max-w-[1180px] px-6 pb-24 pt-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl border"
              style={{
                borderColor: `color-mix(in oklab, var(--${role.tone}) 45%, transparent)`,
                boxShadow: `0 0 22px -12px var(--${role.tone})`,
              }}
            >
              <KeyRound size={16} style={{ color: `var(--${role.tone})` }} strokeWidth={1.6} />
            </span>
            <div>
              <h1 className="font-mono text-[15px] tracking-[0.06em] text-foreground">
                {role.name}
                <span className="ml-2 text-[11px] tracking-[0.16em] text-muted-foreground/60">
                  {role.scopes.length}/{TAB_SCOPES.length} TABS
                </span>
              </h1>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground/70">{role.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => cloneRole(role.id)}
              title="Clone this role — copy every tab and verb into a new editable principal."
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[6px] font-mono text-[11px] tracking-[0.14em] text-muted-foreground/80 transition-colors hover:border-sapphire/45 hover:text-foreground"
            >
              <Copy size={12} /> CLONE
            </button>
            <button
              onClick={async () => {
                if (previewing) {
                  exitPreview();
                  return;
                }
                if (enforced) {
                  setEnforcement(false);
                  return;
                }
                if (isSovereign(role)) {
                  setEnforcement(true);
                  return;
                }
                const ok = await confirmAction({
                  title: `Preview the studio as "${role.name}"?`,
                  body: `The studio will render as this principal — ${role.scopes.length} of ${TAB_SCOPES.length} tabs. This is a simulation only: your own grants are not changed or revoked, and a banner keeps one-click EXIT PREVIEW available on every surface.`,
                  confirmLabel: "Enter preview",
                });
                if (ok) startPreview(role.id);
              }}
              className={cn(
                "rounded-lg border px-3 py-[6px] font-mono text-[11px] tracking-[0.14em] transition-colors",
                previewing
                  ? "border-topaz/45 bg-topaz/10 text-topaz shadow-[0_0_20px_-12px_var(--topaz)]"
                  : enforced
                    ? "border-emerald/45 bg-emerald/10 text-emerald shadow-[0_0_20px_-12px_var(--emerald)]"
                    : "border-white/[0.08] bg-raised/40 text-muted-foreground/70 hover:border-emerald/35",
              )}
              title="Preview renders the studio through the selected role. It never edits or revokes your own grants — exit any time from the banner."
            >
              {previewing
                ? `EXIT PREVIEW · ${(previewRole?.name ?? role.name).toUpperCase()}`
                : enforced
                  ? isSovereign(role)
                    ? "ARMED · ADMIN EXEMPT"
                    : `ARMED · AS ${role.name.toUpperCase()}`
                  : `PREVIEW AS ${role.name.toUpperCase()}`}
            </button>
            {locked ? (
              <span className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[6px] font-mono text-[11px] tracking-[0.14em] text-muted-foreground/70">
                <Lock size={12} /> SYSTEM ROLE
              </span>
            ) : (
              <>
                <button
                  onClick={() => setAll(role.id, true)}
                  className="rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[6px] font-mono text-[11px] tracking-[0.14em] text-muted-foreground/80 transition-colors hover:border-emerald/45 hover:text-foreground"
                >
                  GRANT ALL
                </button>
                <button
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: `Reset "${role.name}" permissions?`,
                      body: "Every granted tab scope is revoked for this role.",
                      confirmLabel: "Reset",
                    });
                    if (ok) setAll(role.id, false);
                  }}
                  className="rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[6px] font-mono text-[11px] tracking-[0.14em] text-muted-foreground/80 transition-colors hover:border-ruby/45 hover:text-foreground"
                >
                  RESET
                </button>
              </>
            )}
          </div>
        </header>

        {!locked && (
          <section className="mb-5 grid gap-4 rounded-xl border border-white/[0.07] bg-white/[0.015] p-5 md:grid-cols-2">
            <div>
              <span className={label}>ROLE NAME</span>
              <input
                className={field}
                value={role.name}
                onChange={(e) => updateRole(role.id, { name: e.target.value })}
              />
            </div>
            <div>
              <span className={label}>DESCRIPTION</span>
              <input
                className={field}
                value={role.description}
                onChange={(e) => updateRole(role.id, { description: e.target.value })}
              />
            </div>
          </section>
        )}

        <section className="mb-5 rounded-xl border border-white/[0.07] bg-white/[0.015] p-5">
          <header className="mb-4 flex items-center gap-2">
            <ShieldCheck size={14} className="text-emerald/80" />
            <h2 className="font-mono text-[11.5px] tracking-[0.16em] text-muted-foreground/80">
              ACTION VERBS · WHAT THIS ROLE MAY DO
            </h2>
          </header>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {ROLE_ACTIONS.map((a) => (
              <ScopeRow
                key={a.id}
                label={a.label}
                hint={a.hint}
                tone={role.tone}
                checked={roleActions(role).includes(a.id)}
                locked={locked}
                onToggle={() => toggleAction(role.id, a.id)}
              />
            ))}
          </div>
          <p className="mt-4 font-mono text-[11px] tracking-[0.1em] text-muted-foreground/50">
            Verbs gate mutations inside a granted tab — a role may read a surface without writing to
            it.
          </p>
        </section>

        <section className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-5">
          <header className="mb-4 flex items-center gap-2">
            <ShieldCheck size={14} className="text-sapphire/80" />
            <h2 className="font-mono text-[11.5px] tracking-[0.16em] text-muted-foreground/80">
              TAB PERMISSIONS · ARCHITECT DECIDES
            </h2>
          </header>

          <div className="space-y-5">
            {SCOPE_GROUPS.map((g) => (
              <div key={g.id}>
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: `var(--${g.tone})`,
                      boxShadow: `0 0 8px -1px var(--${g.tone})`,
                    }}
                  />
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/60">
                    {g.label}
                  </span>
                  <span className="h-px flex-1 bg-white/[0.06]" />
                  <span className="font-mono text-[10.5px] text-muted-foreground/45">
                    {g.items.filter((i) => role.scopes.includes(i.id)).length}/{g.items.length}
                  </span>
                </div>
                <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
                  {g.items.map((item) => (
                    <ScopeRow
                      key={item.id}
                      label={item.label}
                      tone={role.tone}
                      checked={role.scopes.includes(item.id)}
                      locked={locked}
                      onToggle={() => toggleScope(role.id, item.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-5 font-mono text-[11px] tracking-[0.1em] text-muted-foreground/50">
            Admin role always sees every tab · unregistered scope = chat only ·
            {previewing
              ? " preview active — you are rendering as another principal; your own grants are untouched."
              : enforced
                ? " enforcement armed — navigation is filtered live, but admin principals are always exempt."
                : " enforcement off — grants are recorded but not applied."}
          </p>
        </section>
      </div>
    </Shell>
  );
}

function ScopeRow({
  label: name,
  hint,
  tone,
  checked,
  locked,
  onToggle,
}: {
  label: string;
  hint?: string;
  tone: string;
  checked: boolean;
  locked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={locked}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
        locked ? "cursor-not-allowed opacity-80" : "hover:bg-white/[0.03]",
      )}
    >
      <span
        className={cn(
          "grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border transition-all duration-200",
          checked ? "border-transparent" : "border-white/15 bg-raised/30",
        )}
        style={
          checked
            ? {
                background: `var(--${tone})`,
                boxShadow: `0 0 12px -4px var(--${tone})`,
              }
            : undefined
        }
      >
        {checked && <Check size={11} className="text-black/80" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block font-mono text-[12.5px]",
            checked ? "text-foreground" : "text-muted-foreground/60",
          )}
        >
          {name}
        </span>
        {hint && (
          <span className="block truncate text-[11px] text-muted-foreground/45">{hint}</span>
        )}
      </span>
    </button>
  );
}
