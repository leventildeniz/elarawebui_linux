import { createFileRoute } from "@tanstack/react-router";
import { updateAccountPassword } from "@/lib/credential-store";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Lock,
  Mail,
  MailX,
  Plus,
  Save,
  Trash2,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { confirmAction } from "@/components/sovereign/confirm-dialog";

import { AvatarPicker, EntityAvatar } from "@/components/sovereign/identity";
import { Surface, Row } from "@/components/sovereign/surface";
import { Tag, JewelButton } from "@/components/sovereign/primitives";
import { SCOPE_LABELS, TAB_SCOPES, roleActions, useRoles } from "@/lib/rbac-store";
import { useIdentity, type Account } from "@/lib/group-store";
import type { JewelTone } from "@/lib/rbac-store";
import {
  DIRECTORY_KINDS,
  directoryGroupByDn,
  fetchDirectoryGroups,
  fetchDirectoryUsers,
  type DirectoryGroup,
  type DirectoryUser,
} from "@/mocks/directory";

import { useAuthProviders, PROVIDER_SPECS } from "@/lib/auth-provider-store";
import { useModels } from "@/lib/model-store";
import { useProviders } from "@/lib/provider-store";
import { useAgents } from "@/lib/agent-store";
import { useSkills } from "@/lib/skill-store";
import { useMcp } from "@/lib/mcp-store";
import { useCapabilities } from "@/lib/capability-store";
import { useWorkflows } from "@/lib/workflow-store";
import { useNotifyPrefs } from "@/lib/notify-store";
import { useChains } from "@/lib/orchestration-store";
import { useAdapters } from "@/lib/adapter-store";
import { useTargets } from "@/lib/target-store";
import { useVisionModels } from "@/lib/vision-store";
import { useKnowledge } from "@/lib/knowledge-store";
import { useSpaces } from "@/lib/knowledge-space-store";
import { useRagFolders } from "@/lib/rag-folder-store";
import {
  isolationSeed,
  mcpIsolationSeed,
  skillIsolationSeed,
  useCollection,
  type IsolationProfile,
} from "@/lib/security-store";
import { secretSeed } from "@/lib/security-store";
import { promptSchema } from "@/lib/prompt-store";
import { usePlanners } from "@/lib/planner-store";
import { useRuntimes } from "@/lib/runtime-store";
import { useForgePlans } from "@/lib/metaforge-store";
import { useForge } from "@/lib/forge-store";
import { useTelemetryBoards } from "@/lib/telemetry-board-store";
import { reportTemplates } from "@/lib/report-templates";
import { fmtDateTime } from "@/lib/utils";
import {
  useUserTemplates,
  grantMeta,
  selfServiceMeta,
  type GrantKey,
  type SelfServiceKey,
  type TemplateParamKey,
  type UserTemplate,
} from "@/lib/user-template-store";

const description =
  "Identity management for the studio: operators, groups, provisioning templates and RBAC compliance posture.";

export type UsersView = "users" | "groups" | "templates" | "compliance";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "Users & Groups — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Users & Groups — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { view: UsersView } => {
    const v = search["view"];
    return {
      view: v === "groups" || v === "templates" || v === "compliance" ? (v as UsersView) : "users",
    };
  },
  component: UsersRoute,
});

/** Explicit save affordance — state is persisted continuously, but this handles manual triggers (like saving passwords). */
function SaveButton({ label, entity, onSave }: { label: string; entity: string; onSave?: () => Promise<void> }) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  void label;
  void entity;
  
  const handleClick = async () => {
    if (saving) return;
    setSaving(true);
    
    if (onSave) {
      await onSave();
    }
    
    setSaved(true);
    setSaving(false);
    toast.success(`${label} saved`, { description: entity });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
  };

  return (
    <JewelButton
      size="sm"
      variant="primary"
      disabled={saving}
      onClick={handleClick}
    >
      {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
      {saving ? "Saving…" : saved ? "Saved" : "Save"}
    </JewelButton>
  );
}

/** Standard ruby delete affordance with confirmation. */
function DeleteButton({
  title,
  body,
  onConfirm,
  children,
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <JewelButton
      size="sm"
      variant="danger"
      onClick={async () => {
        const ok = await confirmAction({
          title,
          body,
          confirmLabel: "Delete",
          cancelLabel: "Cancel",
          tone: "ruby",
        });
        if (ok) onConfirm();
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {children}
    </JewelButton>
  );
}

const COMPLIANCE: { id: string; label: string; detail: string; state: "pass" | "warn" | "fail" }[] =
  [
    {
      id: "chk.privileged-accounts",
      label: "Privileged accounts under review",
      detail: "2 admins, both with MFA and hardware keys enrolled.",
      state: "pass",
    },
    {
      id: "chk.orphan-grants",
      label: "Orphan scope grants",
      detail: "1 suspended account still mapped to the Research group.",
      state: "warn",
    },
    {
      id: "chk.least-privilege",
      label: "Least privilege drift",
      detail: "Operator role holds 11/38 scopes — inside the approved envelope.",
      state: "pass",
    },
    {
      id: "chk.idp-coverage",
      label: "Identity provider coverage",
      detail: "OAuth2 guests bypass device trust; consider tightening.",
      state: "warn",
    },
    {
      id: "chk.session-policy",
      label: "Session ceiling policy",
      detail: "All templates expire within the 12 h governance ceiling.",
      state: "pass",
    },
  ];

const stateTone: Record<"pass" | "warn" | "fail", JewelTone> = {
  pass: "emerald",
  warn: "topaz",
  fail: "ruby",
};

const statusTone: Record<"active" | "suspended" | "invited", JewelTone> = {
  active: "emerald",
  invited: "sapphire",
  suspended: "ruby",
};

const META: Record<UsersView, string> = {
  users: "18 operators · 6 shown · 5 identity providers",
  groups: "5 groups · charter + role mapping",
  templates: "4 provisioning templates · session ceilings",
  compliance: "5 controls · 2 advisories",
};

function UsersRoute() {
  const { view } = Route.useSearch();

  return (
    <Surface wide crumb="Users & Groups" title="Users & Groups" meta={META[view].toUpperCase()}>
      <motion.div
        key={view}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        {view === "users" && <UsersTab />}
        {view === "groups" && <GroupsTab />}
        {view === "templates" && <TemplatesTab />}
        {view === "compliance" && <ComplianceTab />}
      </motion.div>
    </Surface>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] px-5">{children}</div>
  );
}

const fieldCls =
  "w-full rounded-lg border border-white/[0.07] bg-raised/40 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";
const labelCls =
  "mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/55";

type Opt = { value: string; label: string; disabled?: boolean; hint?: string };

function Pick({
  value,
  options,
  onChange,
  tone = "sapphire",
}: {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  tone?: JewelTone;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${fieldCls} flex items-center justify-between text-left`}
      >
        <span className="truncate">{current?.label ?? "— None —"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-[280px] overflow-auto rounded-lg border border-white/[0.09] bg-[#111113]/95 p-1 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={o.disabled}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left font-mono text-[12px] transition-colors ${
                o.disabled
                  ? "cursor-not-allowed text-muted-foreground/35"
                  : "text-foreground/85 hover:bg-white/[0.05]"
              }`}
            >
              <span className="truncate">
                {o.label}
                {o.hint && <span className="ml-1.5 opacity-50">· {o.hint}</span>}
              </span>
              {o.value === value && (
                <Check className="h-3.5 w-3.5" style={{ color: `var(--${tone})` }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Directory group mapping — pull every group out of an AD / Entra / LDAP source
 * and shuttle the ones this studio group should inherit from AVAILABLE into
 * SELECTED. Only rendered for source kinds that expose a browsable group tree.
 */
function DirectoryMapper({
  provider,
  tone,
  selected,
  onChange,
}: {
  provider: string;
  tone: JewelTone;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const kind = useProviderKind(provider);
  const browsable = (DIRECTORY_KINDS as readonly string[]).includes(kind);
  const [catalog, setCatalog] = useState<DirectoryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    setCatalog([]);
    setFetched(false);
    setQ("");
  }, [provider]);

  if (!browsable) return null;

  const pull = () => {
    setLoading(true);
    void fetchDirectoryGroups(kind).then((rows) => {
      setCatalog(rows);
      setFetched(true);
      setLoading(false);
      toast.success("Directory enumerated", {
        description: `${rows.length} groups returned by ${provider}`,
      });
    });
  };

  const term = q.trim().toLowerCase();
  const match = (g: DirectoryGroup) =>
    !term || g.name.toLowerCase().includes(term) || g.dn.toLowerCase().includes(term);
  const available = catalog.filter((g) => !selected.includes(g.dn)).filter(match);
  const chosen = selected.map(
    (dn) => catalog.find((g) => g.dn === dn) ?? { dn, name: dn, members: 0, ou: "unresolved" },
  );

  return (
    <div className="mt-6 border-t border-border/60 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className={labelCls}>Directory group mapping · {selected.length} mapped</span>
          <p className="font-mono text-[11px] text-muted-foreground/45">
            Claims arriving from {provider} that carry one of the selected groups land in this
            studio group.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter groups…"
            title="Filter the directory listing by group name or distinguished name"
            className="h-9 w-[190px] rounded-lg border border-white/[0.09] bg-raised/40 px-3 font-mono text-[11.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-sapphire/50"
          />
          <JewelButton size="sm" onClick={pull} disabled={loading}>
            <Download className="h-3.5 w-3.5" />
            {loading ? "Querying…" : fetched ? "Re-sync groups" : "Fetch groups"}
          </JewelButton>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <DirectoryColumn
          title={`Selected · ${chosen.length}`}
          tone={tone}
          empty="Nothing mapped yet — move groups over from AVAILABLE."
          rows={chosen}
          icon="remove"
          onRow={(dn) => onChange(selected.filter((d) => d !== dn))}
          {...(chosen.length ? { onAll: () => onChange([]), allLabel: "Remove all" } : {})}
        />
        <DirectoryColumn
          title={`Available · ${available.length}`}
          tone={tone}
          empty={
            fetched
              ? "Every matching group is already mapped."
              : "Run FETCH GROUPS to enumerate the directory."
          }
          rows={available}
          icon="add"
          onRow={(dn) => onChange([...selected, dn])}
          {...(available.length
            ? {
                onAll: () => onChange([...selected, ...available.map((g) => g.dn)]),
                allLabel: "Add all",
              }
            : {})}
        />
      </div>
    </div>
  );
}

function DirectoryColumn({
  title,
  tone,
  rows,
  empty,
  icon,
  onRow,
  onAll,
  allLabel,
}: {
  title: string;
  tone: JewelTone;
  rows: DirectoryGroup[];
  empty: string;
  icon: "add" | "remove";
  onRow: (dn: string) => void;
  onAll?: () => void;
  allLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.012]">
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-3.5 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70">
          {title}
        </span>
        {onAll && (
          <button
            onClick={onAll}
            title={allLabel}
            className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/55 transition-colors hover:text-foreground"
          >
            {allLabel}
          </button>
        )}
      </header>
      <div className="max-h-[248px] overflow-y-auto p-2">
        {rows.length === 0 && (
          <p className="px-2 py-3 font-mono text-[11px] text-muted-foreground/40">{empty}</p>
        )}
        {rows.map((g) => (
          <button
            key={g.dn}
            onClick={() => onRow(g.dn)}
            title={g.dn}
            className="group flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.035]"
          >
            <span className="min-w-0">
              <span className="block truncate font-mono text-[12px] text-foreground/90">
                {g.name}
              </span>
              <span className="block truncate font-mono text-[10.5px] text-muted-foreground/45">
                {g.ou} · {g.members} members
              </span>
            </span>
            {icon === "add" ? (
              <Plus
                className="h-3.5 w-3.5 shrink-0 opacity-40 transition-opacity group-hover:opacity-100"
                style={{ color: `var(--${tone})` }}
              />
            ) : (
              <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-ruby" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Directory principal binder — mirrors the group mapping experience: once the
 * account's authentication provider points at a browsable directory (Entra /
 * LDAP), the principals of that source are listed with a filter. Picking one
 * stamps the account's identity fields and joins every studio group that maps
 * the principal's claims.
 */
function DirectoryPrincipalBinder({
  account,
  providerLabel,
}: {
  account: Account;
  providerLabel: string;
}) {
  const { accounts, groups, updateAccount, toggleMember } = useIdentity();
  const { providers } = useAuthProviders();
  const [catalog, setCatalog] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [bound, setBound] = useState(false);

  const source = providers.find((p) => p.label === providerLabel);
  const kind = source && (DIRECTORY_KINDS as readonly string[]).includes(source.id) ? source.id : "";

  useEffect(() => {
    setFilter("");
    setCatalog([]);
    setBound(false);
    if (!kind) return;
    let live = true;
    setLoading(true);
    void fetchDirectoryUsers(kind).then((rows) => {
      if (!live) return;
      setCatalog(rows);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [kind, providerLabel]);

  if (!kind) return null;
  if (bound) return null;

  const taken = new Set(
    accounts
      .filter((a) => a.id !== account.id)
      .flatMap((a) => [a.username.toLowerCase(), a.email.toLowerCase()].filter(Boolean)),
  );
  const q = filter.trim().toLowerCase();
  const rows = catalog.filter(
    (u) =>
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.mail.toLowerCase().includes(q),
  );

  const bind = (u: DirectoryUser) => {
    if (taken.has(u.username.toLowerCase()) || taken.has(u.mail.toLowerCase())) return;
    const hits = groups.filter((g) => (g.directoryGroups ?? []).some((dn) => u.memberOf.includes(dn)));
    updateAccount(account.id, {
      username: u.username,
      name: u.name,
      email: u.mail,
      avatarSeed: u.username,
      provider: providerLabel,
      ...(hits[0]?.defaultRole ? { role: hits[0].defaultRole } : {}),
      ...(u.disabled ? { locked: true } : {}),
    });
    hits.forEach((g) => toggleMember(g.id, account.id));
    setBound(true);
    toast.success("Principal bound", {
      description: hits.length
        ? `${u.name} · joined ${hits.map((g) => g.name).join(", ")}`
        : `${u.name} · no mapped group, role stands alone`,
    });
  };

  return (
    <div className="mt-2.5 rounded-lg border border-white/[0.07] bg-white/[0.015]">
      <div className="flex items-center gap-2 border-b border-white/[0.05] px-2.5 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={loading ? "Querying directory…" : `Filter principals (${catalog.length})`}
          title="Filter directory principals by name, username or mail"
          className="w-full bg-transparent font-mono text-[11.5px] text-foreground/85 outline-none placeholder:text-muted-foreground/40"
        />
        <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
      </div>
      <div className="max-h-[176px] overflow-y-auto p-1.5">
        {!loading && rows.length === 0 && (
          <p className="px-2 py-2.5 font-mono text-[11px] text-muted-foreground/40">
            No principal returned.
          </p>
        )}
        {rows.map((u) => {
          const used = taken.has(u.username.toLowerCase()) || taken.has(u.mail.toLowerCase());
          const bound = account.username.toLowerCase() === u.username.toLowerCase();
          return (
            <button
              key={u.dn}
              type="button"
              disabled={used}
              onClick={() => bind(u)}
              title={used ? "Already provisioned on another account" : `Bind ${u.dn}`}
              className={`group flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                used ? "cursor-not-allowed opacity-35" : "hover:bg-white/[0.035]"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate font-mono text-[12px] text-foreground/90">
                  {u.name} · @{u.username}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground/45">
                  {u.mail}
                  {u.disabled ? " · disabled in directory" : ""}
                </span>
              </span>
              {bound ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald" />
              ) : (
                <Plus className="h-3.5 w-3.5 shrink-0 text-sapphire opacity-0 transition-opacity group-hover:opacity-100" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}





function useProviderOptions(): Opt[] {

  const { providers } = useAuthProviders();
  return providers.map((p) => {
    const spec = PROVIDER_SPECS.find((s) => s.id === p.id);
    const enabled = p.id === "local" || p.enabled;
    const hint = !enabled ? "source disabled" : p.label === spec?.label ? undefined : spec?.label;
    return { value: p.label, label: p.label.toUpperCase(), ...(hint ? { hint } : {}) };
  });
}

/** Resolve which provider kind (entra / ldap / saml …) a source label points at. */
function useProviderKind(label: string): string {
  const { providers } = useAuthProviders();
  const exact = providers.find((p) => p.label === label);
  if (exact) return exact.id;
  const spec = PROVIDER_SPECS.find(
    (x) => x.label.toLowerCase() === label.toLowerCase() || x.id === label.toLowerCase(),
  );
  return spec?.id ?? "local";
}



function UsersTab() {
  const {
    accounts,
    groups,
    groupsOf,
    addAccount,
    updateAccount,
    removeAccount,
    toggleMember,
    expectedRole,
  } = useIdentity();
  const { roles } = useRoles();
  const { templates } = useUserTemplates();
  const providerOptions = useProviderOptions();
  const [activeId, setActiveId] = useState<string>(accounts[0]?.id ?? "");

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];
  const memberOf = active ? groupsOf(active.id) : [];
  const inheritSource = memberOf.find((g) => g.defaultTemplate);
  const inheritedTemplate = inheritSource?.defaultTemplate ?? "";
  const inheritedName = templates.find((t) => t.id === inheritedTemplate)?.name ?? "none";

  const [pendingPassword, setPendingPassword] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  
  // reset pending passwords when switching users
  useEffect(() => {
     setPendingPassword("");
     setPendingConfirm("");
     setPwMsg("");
  }, [activeId]);
  
  const pwReady = pendingPassword.length >= 6 && pendingPassword === pendingConfirm;

  const handleAccountSave = async () => {
    if (pwReady) {
      try {
        if (active) {
          await updateAccountPassword(active.id, pendingPassword);
          updateAccount(active.id, { passwordChangedAt: new Date().toISOString() });
        }
        setPendingPassword("");
        setPendingConfirm("");
        setPwMsg("Passphrase committed — this principal signs in with it now.");
      } catch (err) {
        setPwMsg("Failed to update passphrase.");
      }
    }
  };

  return (
    <>
    <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-3">
        <button
          type="button"
          onClick={async () => {
            const newId = await addAccount();
            if (newId) setActiveId(newId);
          }}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-sapphire/35 bg-sapphire/[0.07] px-3 py-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-sapphire transition-colors hover:bg-sapphire/[0.13]"
        >
          <Plus className="h-3.5 w-3.5" />
          New operator
        </button>
        <div className="space-y-1.5">
          {accounts.map((u) => {
            const gs = groupsOf(u.id);
            const drift = gs.length > 0 && expectedRole(u.id) !== u.role;
            return (
              <button
                key={u.id}
                onClick={() => setActiveId(u.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  u.id === active?.id
                    ? "border-white/[0.14] bg-white/[0.04]"
                    : "border-white/[0.05] hover:bg-white/[0.025]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] text-foreground/90">{u.name}</span>
                  {drift && <Tag tone="ruby">DRIFT</Tag>}
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground/55">
                  @{u.username} · {u.role} · {u.provider}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {active && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-5">
          <header className="mb-5 flex flex-wrap items-center gap-2.5">
            <EntityAvatar
              seed={active.avatarSeed ?? active.username}
              label={active.name}
              style={active.avatarStyle ?? "sigil"}
              jewel={active.avatarJewel ?? "sapphire"}
              size={34}
            />
            <h2 className="text-[16px] text-foreground/95">{active.name}</h2>
            <span className="font-mono text-[11.5px] text-muted-foreground/55">
              @{active.username}
            </span>
            <Tag tone={statusTone[active.status]}>{active.status.toUpperCase()}</Tag>
            {active.locked && <Tag tone="ruby">LOCKED</Tag>}
            <span className="ml-auto font-mono text-[11px] text-muted-foreground/45">
              seen {active.lastSeen}
            </span>
            <JewelButton
              size="sm"
              variant="ghost"
              onClick={() => updateAccount(active.id, { locked: !active.locked })}
            >
              {active.locked ? (
                <Unlock className="h-3.5 w-3.5" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
              {active.locked ? "Unlock" : "Lock"}
            </JewelButton>
            <SaveButton label="Account" entity={`@${active.username}`} onSave={handleAccountSave} />
            <DeleteButton
              title={`Delete ${active.name}?`}
              body={`@${active.username} is removed from the roster and from every group membership. This cannot be undone.`}
              onConfirm={() => {
                removeAccount(active.id);
                setActiveId("");
                toast.success("Account deleted", { description: `@${active.username}` });
              }}
            >
              Delete
            </DeleteButton>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <span className={labelCls}>Display name</span>
              <input
                className={fieldCls}
                value={active.name}
                onChange={(e) => updateAccount(active.id, { name: e.target.value })}
              />
            </div>
            <div>
              <span className={labelCls}>Username</span>
              <input
                className={fieldCls}
                value={active.username}
                onChange={(e) => updateAccount(active.id, { username: e.target.value })}
              />
            </div>
            <div>
              <span className={labelCls}>Email</span>
              <input
                className={fieldCls}
                value={active.email}
                onChange={(e) => updateAccount(active.id, { email: e.target.value })}
              />
            </div>
            <div>
              <span className={labelCls}>Authentication provider</span>
              <Pick
                value={active.provider}
                options={providerOptions}
                onChange={(v) => updateAccount(active.id, { provider: v })}
              />
              <DirectoryPrincipalBinder account={active} providerLabel={active.provider} />
            </div>
            <div>
              <span className={labelCls}>Role (RBAC)</span>
              <Pick
                value={active.role}
                options={roles.map((r) => ({ value: r.name, label: r.name }))}
                onChange={(v) => updateAccount(active.id, { role: v })}
              />
              <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/50">
                {memberOf.length === 0
                  ? "No group — role stands alone."
                  : expectedRole(active.id) === active.role
                    ? `✓ Matches group rule (${expectedRole(active.id)})`
                    : `Drift · group expects ${expectedRole(active.id)}`}
              </p>
            </div>
            <div>
              <span className={labelCls}>Default Template</span>
              <Pick
                value={active.template ?? ""}
                options={[
                  { value: "", label: `— Inherit from group (${inheritedName}) —` },
                  ...templates.map((t) => ({ value: t.id, label: t.name })),
                ]}
                onChange={(v) => updateAccount(active.id, { template: v })}
              />
            </div>
            <div>
              <span className={labelCls}>Valid until (account expiry)</span>
              <input
                type="date"
                className={fieldCls}
                value={active.validUntil ?? ""}
                onChange={(e) => updateAccount(active.id, { validUntil: e.target.value })}
              />
              <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/50">
                {active.validUntil
                  ? new Date(active.validUntil) < new Date()
                    ? "Expired — sign-in refused."
                    : `Expires ${active.validUntil}`
                  : "No expiry — permanent account."}
              </p>
            </div>

          </div>

          <div className="mt-5">
            <span className={labelCls}>Group membership · {memberOf.length}</span>
            <div className="w-full max-w-[280px]">
              <Pick
                value=""
                options={[
                  { value: "", label: "+ Add to group…" },
                  ...groups
                    .filter((g) => !g.members.includes(active.id))
                    .map((g) => ({ value: g.id, label: g.name })),
                ]}
                onChange={(v) => v && toggleMember(v, active.id)}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {memberOf.length === 0 && (
                <span className="font-mono text-[11.5px] text-muted-foreground/45">
                  Not a member of any group.
                </span>
              )}
              {memberOf.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-[11.5px] text-foreground"
                  style={{
                    borderColor: `color-mix(in oklab, var(--${g.tone}) 55%, transparent)`,
                    boxShadow: `0 0 14px -8px var(--${g.tone})`,
                  }}
                >
                  {g.name}
                  <button
                    onClick={() => toggleMember(g.id, active.id)}
                    className="text-muted-foreground/60 transition-colors hover:text-ruby"
                    aria-label={`Remove from ${g.name}`}
                    title={`Remove from ${g.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <p className="mt-3 font-mono text-[11px] text-muted-foreground/45">
              Group membership drives the expected role and inherited template — an account-level
              template overrides the group default.
            </p>
          </div>

          <EffectiveAccess
            roleName={active.role}
            templateName={
              active.template
                ? (templates.find((t) => t.id === active.template)?.name ?? "—")
                : inheritedName
            }
            source={active.template ? "account" : "group"}
            sourceGroup={inheritSource?.name}
          />

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.012] p-4">
              <span className={labelCls}>Avatar · studio library</span>
              <AvatarPicker
                seed={active.avatarSeed ?? active.username}
                label={active.name}
                style={active.avatarStyle ?? "sigil"}
                jewel={active.avatarJewel ?? "sapphire"}
                seeds={accounts.map((a) => a.username)}
                onChange={(next) =>
                  updateAccount(active.id, {
                    avatarSeed: next.seed,
                    avatarStyle: next.style,
                    avatarJewel: next.jewel,
                  })
                }
              />
            </div>

            <AccountSecurity
              key={active.id}
              account={active}
              pw={pendingPassword}
              setPw={setPendingPassword}
              confirm={pendingConfirm}
              setConfirm={setPendingConfirm}
              msg={pwMsg}
              setMsg={setPwMsg}
            />
          </div>
        </div>
      )}
    </div>
    </>
  );

}

/** Resolved view of what a bound account can actually open and do. */
function EffectiveAccess({
  roleName,
  templateName,
  source,
  sourceGroup,
}: {
  roleName: string;
  templateName: string;
  source: "account" | "group";
  sourceGroup?: string | undefined;
}) {
  const { roles } = useRoles();
  const role = roles.find((r) => r.name === roleName);
  const scopes = role?.scopes ?? [];
  const verbs = roleActions(role);

  return (
    <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.012] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={labelCls}>Effective access · resolved</span>
        <div className="flex flex-wrap gap-2">
          <Tag tone="sapphire">{`${scopes.length}/${TAB_SCOPES.length} TABS`}</Tag>
          <Tag tone={verbs.length > 3 ? "ruby" : "emerald"}>
            {verbs.length ? verbs.join(" · ").toUpperCase() : "NO VERBS"}
          </Tag>
          <Tag tone="amethyst">{`TEMPLATE · ${templateName}`}</Tag>
          <Tag tone={source === "account" ? "emerald" : "platinum"}>
            {source === "account"
              ? "ACCOUNT WINS"
              : `INHERITED FROM ${(sourceGroup ?? "GROUP").toUpperCase()}`}
          </Tag>
        </div>
      </div>
      {!role ? (
        <p className="mt-3 font-mono text-[11.5px] text-ruby/80">
          Role "{roleName}" no longer exists in RBAC — this account resolves to chat only.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {scopes.slice(0, 18).map((sc) => (
              <span
                key={sc}
                className="rounded-md border border-white/[0.08] bg-raised/35 px-2 py-[3px] font-mono text-[11px] text-foreground/80"
              >
                {SCOPE_LABELS[sc] ?? sc}
              </span>
            ))}
            {scopes.length > 18 && (
              <span className="px-1 font-mono text-[11px] text-muted-foreground/50">
                +{scopes.length - 18} more
              </span>
            )}
          </div>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground/45">
            Resolution order: account template → group template → studio default. An account-level
            binding always wins, even when the group carries a stricter one. Role grants the
            surfaces and verbs; the template grants the models, tools, budgets and memory contract.
          </p>
        </>
      )}
    </div>
  );
}

function AccountSecurity({
  account,
  pw,
  setPw,
  confirm,
  setConfirm,
  msg,
  setMsg,
}: {
  account: Account;
  pw: string;
  setPw: (v: string) => void;
  confirm: string;
  setConfirm: (v: string) => void;
  msg: string;
  setMsg: (v: string) => void;
}) {
  const MIN = 6;
  const weak = pw.length > 0 && pw.length < MIN;
  const mismatch = confirm.length > 0 && pw !== confirm;
  const ready = pw.length >= MIN && pw === confirm;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.012] p-4">
      <span className={labelCls}>Credentials</span>
      <div className="space-y-3">
        <div>
          <span className={labelCls}>New password</span>
          <input
            type="password"
            className={fieldCls}
            value={pw}
            autoComplete="new-password"
            onChange={(e) => {
              setPw(e.target.value);
              setMsg("");
            }}
          />
        </div>
        <div>
          <span className={labelCls}>Confirm password</span>
          <input
            type="password"
            className={fieldCls}
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => {
              setConfirm(e.target.value);
              setMsg("");
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-muted-foreground/50">
            {msg ||
              (weak
                ? "Minimum 6 characters."
                : mismatch
                  ? "Passwords do not match."
                  : ready
                    ? "✓ Passphrase ready. Click 'Save' above to commit."
                    : account.passwordChangedAt
                      ? `Last rotated ${fmtDateTime(account.passwordChangedAt)}`
                      : `Never rotated — bootstrap credential is the operator ID "${account.username}".`)}
          </span>
        </div>
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground/45">
          Admins rotate any account here; every principal can rotate their own from the operator
          menu → Settings.
        </p>
      </div>
    </div>
  );
}

function GroupsTab() {
  const {
    groups,
    accounts,
    addGroup,
    updateGroup,
    removeGroup,
    toggleMember,
    toggleApprover,
    toggleApproverGroup,
  } =
    useIdentity();
  const { roles } = useRoles();
  const { templates } = useUserTemplates();
  const providerOptions = useProviderOptions();
  const notify = useNotifyPrefs();
  const [activeId, setActiveId] = useState<string>(groups[0]?.id ?? "");

  const active = groups.find((g) => g.id === activeId) ?? groups[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-3">
        <JewelButton
          size="sm"
          className="w-full justify-center"
          onClick={async () => {
            const id = await addGroup();
            setActiveId(id);
          }}
        >
          <Plus className="h-3.5 w-3.5" /> New group
        </JewelButton>
        <div className="mt-3 space-y-1.5">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setActiveId(g.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                g.id === active?.id
                  ? "border-white/[0.14] bg-white/[0.04]"
                  : "border-white/[0.05] hover:bg-white/[0.025]"
              }`}
              style={
                g.id === active?.id ? { boxShadow: `inset 2px 0 0 0 var(--${g.tone})` } : undefined
              }
            >
              <div className="truncate text-[13.5px] text-foreground/90">{g.name}</div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground/55">
                {g.defaultRole} · {g.members.length} members
              </div>
            </button>
          ))}
        </div>
      </div>

      {active && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-5">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: `var(--${active.tone})`,
                  boxShadow: `0 0 10px -1px var(--${active.tone})`,
                }}
              />
              <h2 className="text-[16px] text-foreground/95">{active.name}</h2>
              <span className="font-mono text-[11px] text-muted-foreground/50">{active.id}</span>
            </div>
            <div className="flex items-center gap-2">
              <SaveButton label="Group" entity={active.name} />
              <DeleteButton
                title={`Delete group ${active.name}?`}
                body="The group and its membership rules are removed. Accounts stay, but lose this group's inherited role and template."
                onConfirm={() => {
                  removeGroup(active.id);
                  toast.success("Group deleted", { description: active.name });
                }}
              >
                Delete
              </DeleteButton>
            </div>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <span className={labelCls}>Group name</span>
              <input
                className={fieldCls}
                value={active.name}
                onChange={(e) => updateGroup(active.id, { name: e.target.value })}
              />
            </div>
            <div>
              <span className={labelCls}>Default role</span>
              <Pick
                tone={active.tone}
                value={active.defaultRole}
                options={roles.map((r) => ({ value: r.name, label: r.name }))}
                onChange={(v) => updateGroup(active.id, { defaultRole: v })}
              />
            </div>
            <div>
              <span className={labelCls}>Authentication provider</span>
              <Pick
                tone={active.tone}
                value={active.provider}
                options={providerOptions}
                onChange={(v) => updateGroup(active.id, { provider: v })}
              />
            </div>
            <div>
              <span className={labelCls}>Default Template</span>
              <Pick
                tone={active.tone}
                value={active.defaultTemplate}
                options={[
                  { value: "", label: "— None —" },
                  ...templates.map((t) => ({ value: t.id, label: t.name })),
                ]}
                onChange={(v) => updateGroup(active.id, { defaultTemplate: v })}
              />
            </div>
            <div className="md:col-span-2">
              <span className={labelCls}>Description</span>
              <textarea
                rows={2}
                className={`${fieldCls} resize-y`}
                value={active.description}
                onChange={(e) => updateGroup(active.id, { description: e.target.value })}
              />
            </div>
          </div>

          <DirectoryMapper
            provider={active.provider}
            tone={active.tone}
            selected={active.directoryGroups ?? []}
            onChange={(next) => updateGroup(active.id, { directoryGroups: next })}
          />



          <div className="mt-5">
            <span className={labelCls}>Members · {active.members.length}</span>
            <div className="w-full max-w-[280px]">
              <Pick
                tone={active.tone}
                value=""
                options={[
                  { value: "", label: "+ Add member…" },
                  ...accounts
                    .filter((a) => !active.members.includes(a.id))
                    .map((a) => ({ value: a.id, label: `${a.username} · ${a.name}` })),
                ]}
                onChange={(v) => v && toggleMember(active.id, v)}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {active.members.length === 0 && (
                <span className="font-mono text-[11.5px] text-muted-foreground/45">
                  No members yet — pick accounts from the dropdown.
                </span>
              )}
              {active.members.map((id) => {
                const a = accounts.find((x) => x.id === id);
                if (!a) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-[11.5px] text-foreground"
                    style={{
                      borderColor: `color-mix(in oklab, var(--${active.tone}) 55%, transparent)`,
                      boxShadow: `0 0 14px -8px var(--${active.tone})`,
                    }}
                  >
                    {a.username}
                    <button
                      onClick={() => toggleMember(active.id, id)}
                      className="text-muted-foreground/60 transition-colors hover:text-ruby"
                      aria-label={`Remove ${a.username}`}
                      title={`Remove ${a.username}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
            <p className="mt-3 font-mono text-[11px] text-muted-foreground/45">
              {(active.directoryGroups ?? []).length > 0
                ? "Membership is inherited from the mapped directory groups — manual accounts here are only local additions. "
                : ""}
              Members inherit the group default role and template unless their account carries an
              explicit override — drift is surfaced in RBAC Compliance.
            </p>
          </div>

          <div className="mt-6 border-t border-border/60 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className={labelCls}>Approval delegation</span>
                <p className="font-mono text-[11px] text-muted-foreground/45">
                  Requests raised by this group route to these approvers only. They still need the
                  Approve verb in RBAC.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  notify.update({
                    groups: {
                      ...notify.prefs.groups,
                      [active.name]: !notify.prefs.groups?.[active.name],
                    },
                  })
                }
                title="Email this group's approvers when one of its members raises a request. Template lives in Settings › Mail & Time."
                className={`flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 font-mono text-[11px] transition-colors ${
                  notify.prefs.groups?.[active.name]
                    ? "border-emerald/45 bg-emerald/[0.12] text-emerald"
                    : "border-white/[0.09] bg-raised/40 text-muted-foreground/70 hover:text-foreground"
                }`}
                style={
                  notify.prefs.groups?.[active.name]
                    ? { boxShadow: "0 0 16px -6px var(--emerald)" }
                    : undefined
                }
              >
                {notify.prefs.groups?.[active.name] ? (
                  <Mail className="h-[13px] w-[13px]" strokeWidth={1.7} />
                ) : (
                  <MailX className="h-[13px] w-[13px]" strokeWidth={1.7} />
                )}
                {notify.prefs.groups?.[active.name] ? "email notice · on" : "email notice · off"}
              </button>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <DelegationCard
                title={`Approver accounts · ${(active.approvers ?? []).length}`}
                hint="Individual principals — paged on their account mailbox."
              >
                <Pick
                  tone={active.tone}
                  value=""
                  options={[
                    { value: "", label: "+ Add approver…" },
                    ...accounts
                      .filter((a) => !(active.approvers ?? []).includes(a.id))
                      .map((a) => ({ value: a.id, label: `${a.username} · ${a.name}` })),
                  ]}
                  onChange={(v) => v && toggleApprover(active.id, v)}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {(active.approvers ?? []).length === 0 && (
                    <span className="font-mono text-[11.5px] text-muted-foreground/45">
                      No approver declared — requests fall to the shared pool.
                    </span>
                  )}
                  {(active.approvers ?? []).map((id) => {
                    const a = accounts.find((x) => x.id === id);
                    if (!a) return null;
                    return (
                      <Chip
                        key={id}
                        tone="emerald"
                        label={a.username}
                        meta={a.email || "no mailbox"}
                        title={`${a.name} · ${a.email || "no mailbox"}`}
                        onRemove={() => toggleApprover(active.id, id)}
                      />
                    );
                  })}
                </div>
              </DelegationCard>

              <ApproverDirectoryCard
                provider={active.provider}
                mapped={active.directoryGroups ?? []}
                selected={active.approverDirectoryGroups ?? []}
                onToggle={(dn) => toggleApproverGroup(active.id, dn)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One column of the delegation grid. */
function DelegationCard({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.012] p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70">
            {title}
          </span>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground/40">{hint}</p>
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

/** Removable pill used for approver accounts and directory groups. */
function Chip({
  tone,
  label,
  meta,
  title,
  onRemove,
}: {
  tone: JewelTone;
  label: string;
  meta?: string;
  title?: string;
  onRemove: () => void;
}) {
  return (
    <span
      title={title ?? label}
      className="inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-[11.5px] text-foreground"
      style={{
        borderColor: `color-mix(in oklab, var(--${tone}) 50%, transparent)`,
        boxShadow: `0 0 14px -8px var(--${tone})`,
      }}
    >
      <span className="truncate">{label}</span>
      {meta && <span className="truncate text-[10.5px] text-muted-foreground/45">{meta}</span>}
      <button
        onClick={onRemove}
        className="shrink-0 text-muted-foreground/60 transition-colors hover:text-ruby"
        aria-label={`Remove ${label}`}
        title={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/**
 * Directory groups delegated as approvers. Pulls the live directory listing
 * for the group's identity source, so any AD / Entra / LDAP group can be named
 * as approver — not just the ones already mapped for membership.
 */
function ApproverDirectoryCard({
  provider,
  mapped,
  selected,
  onToggle,
}: {
  provider: string;
  mapped: string[];
  selected: string[];
  onToggle: (dn: string) => void;
}) {
  const kind = useProviderKind(provider);
  const browsable = (DIRECTORY_KINDS as readonly string[]).includes(kind);
  const [catalog, setCatalog] = useState<DirectoryGroup[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!browsable) {
      setCatalog([]);
      return;
    }
    let live = true;
    setLoading(true);
    void fetchDirectoryGroups(kind).then((rows) => {
      if (!live) return;
      setCatalog(rows);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [kind, browsable]);

  const resolve = (dn: string) =>
    catalog.find((g) => g.dn === dn) ?? directoryGroupByDn(dn);

  const options = [
    ...mapped.filter((dn) => !catalog.some((g) => g.dn === dn)).map((dn) => ({ dn })),
    ...catalog.map((g) => ({ dn: g.dn })),
  ]
    .filter((o, i, all) => all.findIndex((x) => x.dn === o.dn) === i)
    .filter((o) => !selected.includes(o.dn))
    .map((o) => {
      const g = resolve(o.dn);
      return {
        value: o.dn,
        label: g?.name ?? o.dn,
        ...(mapped.includes(o.dn) ? { hint: "mapped" } : g?.mail ? { hint: g.mail } : {}),
      };
    });

  return (
    <DelegationCard
      title={`Approver directory groups · ${selected.length}`}
      hint={
        browsable
          ? "Everyone carrying the claim may approve — notice goes to the group mailbox."
          : "This identity source does not expose a browsable group tree."
      }
      {...(loading
        ? {
            action: (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/40">
                querying…
              </span>
            ),
          }
        : {})}
    >
      {browsable ? (
        <Pick
          tone="sapphire"
          value=""
          options={[
            {
              value: "",
              label: loading ? "Loading directory…" : "+ Add approver group…",
            },
            ...options,
          ]}
          onChange={(v) => v && onToggle(v)}
        />
      ) : (
        <p className="font-mono text-[11.5px] text-muted-foreground/45">
          Pick an LDAP / on-prem MS AD or Entra source to delegate directory groups.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {selected.length === 0 && browsable && (
          <span className="font-mono text-[11.5px] text-muted-foreground/45">
            No directory group delegated yet.
          </span>
        )}
        {selected.map((dn) => {
          const g = resolve(dn);
          return (
            <Chip
              key={dn}
              tone="sapphire"
              label={g?.name ?? dn}
              meta={g?.mail ?? "no mail attribute"}
              title={dn}
              onRemove={() => onToggle(dn)}
            />
          );
        })}
      </div>
    </DelegationCard>
  );
}

/* ------------------------------------------------------------------ templates */

function useGrantSources(): Record<GrantKey, { id: string; label: string; meta?: string }[]> {
  const { models } = useModels();
  const { providers } = useProviders();
  const { agents } = useAgents();
  const { skills } = useSkills();
  const mcp = useMcp();
  const { packs } = useCapabilities();
  const { workflows } = useWorkflows();
  const { chains } = useChains();
  const { adapters } = useAdapters();
  const { targets } = useTargets();
  const vision = useVisionModels();
  const knowledge = useKnowledge();
  const { planners } = usePlanners();
  const { spaces } = useSpaces();
  const { folders: ragFolders } = useRagFolders();
  const { runtimes } = useRuntimes();
  const { roles } = useRoles();
  const { plans } = useForgePlans();
  const { items: blueprints } = useForge();
  const { boards } = useTelemetryBoards();
  const toolSandboxes = useCollection<IsolationProfile>(
    "sovereign.security.isolation",
    isolationSeed,
    "iso",
  );
  const skillSandboxes = useCollection<IsolationProfile>(
    "sovereign.security.skill-isolation",
    skillIsolationSeed,
    "siso",
  );
  const mcpSandboxes = useCollection<IsolationProfile>(
    "sovereign.security.mcp-isolation",
    mcpIsolationSeed,
    "miso",
  );

  return {
    models: models.map((m) => ({ id: m.id, label: m.name, meta: m.modelId })),
    providers: providers.map((p) => ({ id: p.id, label: p.name, meta: p.kind })),
    agents: agents.map((a) => ({ id: a.id, label: a.name, meta: a.squad })),
    tools: blueprints.filter(b => b.kind === "action").map((t) => ({ id: t.name, label: t.name, meta: "tool" })),
    skills: skills.map((s) => ({ id: s.id, label: `!${s.name}`, meta: "skill" })),
    mcp: mcp.clients.map((c) => ({ id: c.id, label: c.name, meta: c.transport ?? "mcp" })),
    capabilities: packs.map((p) => ({ id: p.id, label: p.name, meta: p.sector })),
    workflows: workflows.map((w) => ({
      id: w.id,
      label: w.name,
      meta: `${w.nodes?.length ?? 0} nodes`,
    })),
    orchestrators: chains.map((c) => ({ id: c.id, label: c.name, meta: "chain" })),
    adapters: adapters.map((a) => ({ id: a.id, label: a.name, meta: a.category })),
    targets: targets.map((t) => ({ id: t.id, label: t.name, meta: t.risk })),
    vision: vision.models.map((v) => ({ id: v.id, label: v.name, meta: v.modelId })),
    knowledge: knowledge.sources.map((s) => ({ id: s.id, label: s.name, meta: s.kind })),
    ragSpaces: spaces.map((s) => ({ id: s.id, label: s.name, meta: s.slug })),
    ragAgents: agents
      .filter((a) => a.ragSpaceId)
      .map((a) => ({
        id: a.id,
        label: a.name,
        meta: spaces.find((sp) => sp.id === a.ragSpaceId)?.name ?? "space",
      })),
    ragFolders: ragFolders.map((f) => ({ id: f.id, label: f.name, meta: f.color ?? "collection" })),
    vault: secretSeed.map((s) => ({ id: s.id, label: s.name, meta: s.kind })),
    promptLayers: promptSchema.map((x) => ({ id: x.id, label: x.label, meta: x.group })),
    planners: planners.map((x) => ({
      id: x.id,
      label: x.name,
      meta: `${x.kind ?? "tool"} · ${x.mode}`,
    })),
    runtimes: runtimes.map((x) => ({ id: x.id, label: x.name, meta: x.status })),
    sandboxes: [
      ...toolSandboxes.items.map((p) => ({ id: p.id, label: p.name, meta: "tool sandbox" })),
      ...skillSandboxes.items.map((p) => ({ id: p.id, label: p.name, meta: "skill sandbox" })),
      ...mcpSandboxes.items.map((p) => ({ id: p.id, label: p.name, meta: "mcp sandbox" })),
    ],
    metaForge: plans.map((p) => ({ id: p.id, label: p.prompt.slice(0, 48), meta: p.status })),
    blueprints: blueprints.map((b) => ({ id: b.id, label: b.name, meta: b.kind })),
    boards: boards.map((b) => ({ id: b.id, label: b.name, meta: `${b.entries.length} widgets` })),
    reports: reportTemplates.map((r) => ({
      id: r.id,
      label: r.name,
      meta: r.perUser ? "per-operator" : "studio",
    })),
    roles: roles.map((r) => ({ id: r.id, label: r.name, meta: `${r.scopes?.length ?? 0} scopes` })),
  };
}

function MultiPicker({
  label,
  hint,
  tone,
  options,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  tone: JewelTone | "platinum";
  options: { id: string; label: string; meta?: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div ref={ref} className="relative border-t border-border/60 py-5 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] text-foreground/95">{label}</div>
          <div className="mt-1 font-mono text-[11.5px] text-muted-foreground/55">{hint}</div>
        </div>
        <div className="flex items-center gap-2">
          <Tag tone={value.length ? (tone as JewelTone) : "platinum"}>
            {value.length ? `${value.length}/${options.length}` : `all/${options.length}`}
          </Tag>
          <JewelButton size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
            Select <ChevronDown className="h-3.5 w-3.5" />
          </JewelButton>
          {value.length > 0 && (
            <JewelButton size="sm" variant="ghost" onClick={() => onChange([])}>
              Clear
            </JewelButton>
          )}
        </div>
      </div>

      {value.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {value.map((id) => {
            const opt = options.find((o) => o.id === id);
            return (
              <button
                key={id}
                onClick={() => toggle(id)}
                className="group inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-raised/50 px-2 py-1 font-mono text-[11px] text-foreground/85 hover:border-ruby/40 hover:text-ruby"
              >
                {opt?.label ?? id}
                <X className="h-3 w-3 opacity-50 group-hover:opacity-100" />
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-[68px] z-30 w-[340px] overflow-hidden rounded-xl border border-white/10 bg-[#101017]/95 shadow-[0_24px_60px_-20px_black] backdrop-blur-xl">
          <div className="border-b border-white/[0.07] p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter…"
              className="w-full rounded-lg bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center font-mono text-[11.5px] text-muted-foreground/50">
                nothing registered
              </div>
            )}
            {filtered.map((o) => {
              const on = value.includes(o.id);
              return (
                <button
                  key={o.id}
                  onClick={() => toggle(o.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/[0.04]"
                >
                  <span className="min-w-0 truncate text-[13px] text-foreground/90">{o.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {o.meta && (
                      <span className="font-mono text-[10.5px] text-muted-foreground/45">
                        {o.meta}
                      </span>
                    )}
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        on ? "border-emerald/60 bg-emerald/20 text-emerald" : "border-white/15"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  overridden,
  onToggle,
  children,
}: {
  label: string;
  overridden: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
          {label}
        </span>
        <button
          onClick={onToggle}
          className={`rounded-md border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
            overridden
              ? "border-amethyst/45 bg-amethyst/15 text-amethyst"
              : "border-white/10 text-muted-foreground/50 hover:border-white/25 hover:text-foreground/70"
          }`}
        >
          {overridden ? "override" : "inherit"}
        </button>
      </div>
      <div className={overridden ? "mt-2" : "mt-2 opacity-70"}>{children}</div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 font-mono text-[12.5px] text-foreground outline-none focus:border-sapphire/45";

function FoldCard({
  title,
  meta,
  tone = "sapphire",
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  tone?: JewelTone;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`self-start rounded-xl border bg-white/[0.015] transition-colors ${
        open ? `border-${tone}/30` : "border-white/[0.07] hover:border-white/15"
      }`}
      style={
        open ? { borderColor: `color-mix(in oklab, var(--${tone}) 32%, transparent)` } : undefined
      }
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
          {title}
        </span>
        <span className="flex items-center gap-2">
          {meta && <span className="font-mono text-[10.5px] text-muted-foreground/45">{meta}</span>}
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground/50 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && <div className="border-t border-white/[0.06] px-5 py-5">{children}</div>}
    </div>
  );
}

function exportTemplate(tpl: UserTemplate) {
  const blob = new Blob([JSON.stringify(tpl, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tpl.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.template.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Template exported", { description: tpl.name });
}

function TemplatesTab() {
  const { templates, create, update, remove, duplicate } = useUserTemplates();
  const importRef = useRef<HTMLInputElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sources = useGrantSources();

  const active = templates.find((t) => t.id === activeId) ?? templates[0];
  if (!active) {
    return (
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] px-6 py-10 text-center">
        <div className="text-[14px] text-muted-foreground">No templates yet.</div>
        <JewelButton size="sm" className="mt-4" onClick={async () => { const id = await create(); setActiveId(id); }}>
          <Plus className="h-3.5 w-3.5" /> New template
        </JewelButton>
      </div>
    );
  }

  const p = active.params;
  const ov = (k: TemplateParamKey) => Boolean(active.overrides[k]);
  const toggleOv = (k: TemplateParamKey) =>
    update(active.id, { overrides: { ...active.overrides, [k]: !ov(k) } });
  /** Editing a value always arms its override — nothing is read-only. */
  const setParam = <K extends keyof UserTemplate["params"]>(k: K, v: UserTemplate["params"][K]) =>
    update(active.id, {
      params: { ...p, [k]: v },
      overrides: { ...active.overrides, [k as TemplateParamKey]: true },
    });

  const overrideCount = Object.values(active.overrides).filter(Boolean).length;
  const grantCount = grantMeta.filter((g) => active.grants[g.key].length).length;

  return (
    <div className="space-y-6">
      {/* roster — side by side cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className={`rounded-xl border px-4 py-3.5 text-left transition-colors ${
              t.id === active.id
                ? "border-sapphire/45 bg-sapphire/[0.07]"
                : "border-white/[0.07] bg-white/[0.015] hover:border-white/15"
            }`}
          >
            <div className="truncate text-[13.5px] text-foreground/95">{t.name}</div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground/55">
              temp {t.params.temperature.toFixed(2)} ·{" "}
              {Object.values(t.overrides).filter(Boolean).length} overrides ·{" "}
              {t.grants.agents.length || "all"} agents
            </div>
          </button>
        ))}
        <button
          onClick={async () => { const id = await create(); setActiveId(id); }}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/12 px-4 py-3.5 font-mono text-[11.5px] uppercase tracking-[0.14em] text-muted-foreground/60 transition-colors hover:border-sapphire/40 hover:text-sapphire"
        >
          <Plus className="h-3.5 w-3.5" /> New template
        </button>
      </div>

      {/* header */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
              Template name
            </div>
            <input
              value={active.name}
              onChange={(e) => update(active.id, { name: e.target.value })}
              className={`${inputCls} mt-2 text-[14px]`}
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={() => update(active.id, { userCanModify: !active.userCanModify })}
              className={`h-9 rounded-lg border px-3 font-mono text-[11.5px] ${
                active.userCanModify
                  ? "border-emerald/45 bg-emerald/12 text-emerald"
                  : "border-white/10 text-muted-foreground/60"
              }`}
            >
              User can modify
            </button>
            <SaveButton label="Template" entity={active.name} />
            <JewelButton size="sm" variant="outline" onClick={() => duplicate(active.id)}>
              <Copy className="h-3.5 w-3.5" />
            </JewelButton>
            <JewelButton
              size="sm"
              variant="outline"
              onClick={() => exportTemplate(active)}
              title="Export this provisioning contract as JSON"
            >
              <Download className="h-3.5 w-3.5" />
            </JewelButton>
            <JewelButton
              size="sm"
              variant="outline"
              onClick={() => importRef.current?.click()}
              title="Import a template JSON"
            >
              <Upload className="h-3.5 w-3.5" />
            </JewelButton>
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const parsed = JSON.parse(await file.text()) as UserTemplate;
                  if (!parsed?.name || !parsed?.params) throw new Error("shape");
                  const id = await create();
                  update(id, {
                    ...parsed,
                    id,
                    name: `${parsed.name} (imported)`,
                    createdAt: Date.now(),
                  });
                  setActiveId(id);
                  toast.success("Template imported", { description: parsed.name });
                } catch {
                  toast.error("Import failed", { description: "Not a valid template JSON." });
                }
              }}
            />
            <DeleteButton
              title={`Delete template ${active.name}?`}
              body="Accounts and groups pointing at this template fall back to the platform default."
              onConfirm={() => {
                remove(active.id);
                setActiveId(null);
                toast.success("Template deleted", { description: active.name });
              }}
            >
              Delete
            </DeleteButton>
          </div>
        </div>

        <div className="mt-4">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
            Description
          </div>
          <input
            value={active.description}
            onChange={(e) => update(active.id, { description: e.target.value })}
            placeholder="What this provisioning contract is for."
            className={`${inputCls} mt-2`}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Tag tone={overrideCount ? "amethyst" : "platinum"}>
            {overrideCount ? `${overrideCount} PARAM OVERRIDES` : "FULLY INHERITED"}
          </Tag>
          <Tag tone={grantCount ? "sapphire" : "platinum"}>
            {grantCount ? `${grantCount} SCOPED GRANTS` : "ALL GRANTS OPEN"}
          </Tag>
          <span className="font-mono text-[11.5px] text-muted-foreground/55">
            Untouched parameters stay on the allowed model — the template never writes over them.
          </span>
        </div>
      </div>

      {/* self-service delegation */}
      <FoldCard
        title="Self-service — what the user may override"
        meta={`${Object.values(active.userEditable ?? {}).filter(Boolean).length} delegated`}
        tone="emerald"
      >
        <div className="space-y-3">
          <p className="font-mono text-[11.5px] leading-relaxed text-muted-foreground/55">
            Delegated knobs appear in the operator's Account Settings. Policy and security prompt
            layers are never delegated — a persona prompt is appended as the last layer only.
            {!active.userCanModify && " Enable “User can modify” to activate this section."}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {selfServiceMeta.map((m) => {
              const on = Boolean(active.userEditable?.[m.key]);
              return (
                <button
                  key={m.key}
                  disabled={!active.userCanModify}
                  onClick={() =>
                    update(active.id, {
                      userEditable: {
                        ...(active.userEditable ?? {}),
                        [m.key as SelfServiceKey]: !on,
                      },
                    })
                  }
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    on && active.userCanModify
                      ? "border-emerald/45 bg-emerald/10"
                      : "border-white/[0.07] bg-white/[0.015] hover:border-white/15"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-foreground/90">{m.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
                      {on && active.userCanModify ? "delegated" : "locked"}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-muted-foreground/50">
                    {m.hint}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </FoldCard>

      {/* collapsible cards, side by side */}
      <div className="grid gap-4 xl:grid-cols-2">
        <FoldCard
          title="System prompt overlay"
          tone="sapphire"
          meta={ov("systemPrompt") ? "override" : "inherit"}
        >
          <Field
            label="Overlay text"
            overridden={ov("systemPrompt")}
            onToggle={() => toggleOv("systemPrompt")}
          >
            <textarea
              rows={8}
              value={p.systemPrompt}
              onChange={(e) => setParam("systemPrompt", e.target.value)}
              placeholder="Prepended above the model's own system prompt when overridden."
              className={`${inputCls} resize-y leading-relaxed`}
            />
          </Field>
        </FoldCard>

        <FoldCard title="Sampling" tone="amethyst" meta="temperature · top-p · top-k">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={`Temperature — ${p.temperature.toFixed(2)}`}
              overridden={ov("temperature")}
              onToggle={() => toggleOv("temperature")}
            >
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={p.temperature}
                onChange={(e) => setParam("temperature", Number(e.target.value))}
                className="w-full accent-[var(--sapphire)]"
              />
            </Field>
            <Field
              label={`Top-P — ${p.topP.toFixed(2)}`}
              overridden={ov("topP")}
              onToggle={() => toggleOv("topP")}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={p.topP}
                onChange={(e) => setParam("topP", Number(e.target.value))}
                className="w-full accent-[var(--amethyst)]"
              />
            </Field>
            <Field label="Top-K" overridden={ov("topK")} onToggle={() => toggleOv("topK")}>
              <input
                type="number"
                value={p.topK}
                onChange={(e) => setParam("topK", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field
              label="Repetition penalty"
              overridden={ov("repetitionPenalty")}
              onToggle={() => toggleOv("repetitionPenalty")}
            >
              <input
                type="number"
                step={0.05}
                value={p.repetitionPenalty}
                onChange={(e) => setParam("repetitionPenalty", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field
              label="Presence penalty"
              overridden={ov("presencePenalty")}
              onToggle={() => toggleOv("presencePenalty")}
            >
              <input
                type="number"
                step={0.1}
                value={p.presencePenalty}
                onChange={(e) => setParam("presencePenalty", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field
              label="Frequency penalty"
              overridden={ov("frequencyPenalty")}
              onToggle={() => toggleOv("frequencyPenalty")}
            >
              <input
                type="number"
                step={0.1}
                value={p.frequencyPenalty}
                onChange={(e) => setParam("frequencyPenalty", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field label="Seed" overridden={ov("seed")} onToggle={() => toggleOv("seed")}>
              <input
                value={p.seed}
                onChange={(e) => setParam("seed", e.target.value)}
                placeholder="deterministic seed"
                className={inputCls}
              />
            </Field>
            <Field
              label="Stop sequences"
              overridden={ov("stopSequences")}
              onToggle={() => toggleOv("stopSequences")}
            >
              <input
                value={p.stopSequences}
                onChange={(e) => setParam("stopSequences", e.target.value)}
                placeholder="</end>, ###, Observation:"
                className={inputCls}
              />
            </Field>
          </div>
        </FoldCard>

        <FoldCard title="Context & streaming" tone="emerald" meta="tokens · window · chat template">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Max output tokens"
              overridden={ov("maxTokens")}
              onToggle={() => toggleOv("maxTokens")}
            >
              <input
                type="number"
                value={p.maxTokens}
                onChange={(e) => setParam("maxTokens", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field
              label="Context window"
              overridden={ov("contextWindow")}
              onToggle={() => toggleOv("contextWindow")}
            >
              <input
                type="number"
                value={p.contextWindow}
                onChange={(e) => setParam("contextWindow", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field
              label="Chat template (legacy)"
              overridden={ov("chatTemplateId")}
              onToggle={() => toggleOv("chatTemplateId")}
            >
              <select
                value={p.chatTemplateId}
                onChange={(e) => setParam("chatTemplateId", e.target.value)}
                className={inputCls}
                disabled
              >
                <option value={p.chatTemplateId || "auto"} className="bg-[#101017]">
                  Auto (managed by engine)
                </option>
              </select>
            </Field>
            <Field
              label="Streaming"
              overridden={ov("streaming")}
              onToggle={() => toggleOv("streaming")}
            >
              <button
                onClick={() => setParam("streaming", !p.streaming)}
                className={`h-[38px] w-full rounded-lg border font-mono text-[11.5px] ${
                  p.streaming
                    ? "border-emerald/45 bg-emerald/12 text-emerald"
                    : "border-white/10 text-muted-foreground/60"
                }`}
              >
                {p.streaming ? "enabled" : "disabled"}
              </button>
            </Field>
          </div>
        </FoldCard>

        <FoldCard
          title="Reasoning"
          tone="amethyst"
          meta={p.thinkEnabled ? "thinking on" : "thinking off"}
        >
          <div className="grid gap-5">
            <Field
              label="Thinking"
              overridden={ov("thinkEnabled")}
              onToggle={() => toggleOv("thinkEnabled")}
            >
              <button
                onClick={() => setParam("thinkEnabled", !p.thinkEnabled)}
                className={`h-[38px] w-full rounded-lg border font-mono text-[11.5px] ${
                  p.thinkEnabled
                    ? "border-amethyst/45 bg-amethyst/12 text-amethyst"
                    : "border-white/10 text-muted-foreground/60"
                }`}
              >
                {p.thinkEnabled ? "enabled" : "off"}
              </button>
            </Field>
            <Field
              label="Thinking statement"
              overridden={ov("thinkStatement")}
              onToggle={() => toggleOv("thinkStatement")}
            >
              <textarea
                rows={4}
                value={p.thinkStatement}
                onChange={(e) => setParam("thinkStatement", e.target.value)}
                className={`${inputCls} resize-y leading-relaxed`}
              />
            </Field>
          </div>
        </FoldCard>

        <FoldCard
          title="Memory policy"
          tone="emerald"
          meta={`compact ${p.memoryCompactAt}% · keep ${p.memoryKeepLastTurns}`}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={`Compact at — ${p.memoryCompactAt}% of window`}
              overridden={ov("memoryCompactAt")}
              onToggle={() => toggleOv("memoryCompactAt")}
            >
              <input
                type="range"
                min={30}
                max={95}
                step={1}
                value={p.memoryCompactAt}
                onChange={(e) => setParam("memoryCompactAt", Number(e.target.value))}
                className="w-full accent-[var(--emerald)]"
              />
            </Field>
            <Field
              label="Keep last turns verbatim"
              overridden={ov("memoryKeepLastTurns")}
              onToggle={() => toggleOv("memoryKeepLastTurns")}
            >
              <input
                type="number"
                min={1}
                max={64}
                value={p.memoryKeepLastTurns}
                onChange={(e) => setParam("memoryKeepLastTurns", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field
              label="Episodic retention (days)"
              overridden={ov("memoryEpisodicRetentionDays")}
              onToggle={() => toggleOv("memoryEpisodicRetentionDays")}
            >
              <input
                type="number"
                min={1}
                value={p.memoryEpisodicRetentionDays}
                onChange={(e) => setParam("memoryEpisodicRetentionDays", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            {(
              [
                ["memoryAutoPromoteFacts", "Auto-promote facts"],
                ["memoryDedupe", "Dedupe on write"],
                ["memoryRedactSecrets", "Redact secrets"],
                ["memoryEmbedOnWrite", "Embed on write"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label} overridden={ov(k)} onToggle={() => toggleOv(k)}>
                <button
                  onClick={() => setParam(k, !p[k])}
                  className={`h-[38px] w-full rounded-lg border font-mono text-[11.5px] ${
                    p[k]
                      ? "border-emerald/45 bg-emerald/12 text-emerald"
                      : "border-white/10 text-muted-foreground/60"
                  }`}
                >
                  {p[k] ? "enabled" : "disabled"}
                </button>
              </Field>
            ))}
            <p className="sm:col-span-2 font-mono text-[11px] leading-relaxed text-muted-foreground/50">
              Retention, redaction, dedupe and embedding stay operator-only — never delegated. Users
              may only tighten the compact threshold and verbatim turn count.
            </p>
          </div>
        </FoldCard>

        <FoldCard title="Budgets & rate limits" tone="ruby" meta={`${p.requestsPerMin} rpm`}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Daily token ceiling"
              overridden={ov("dailyTokens")}
              onToggle={() => toggleOv("dailyTokens")}
            >
              <input
                type="number"
                value={p.dailyTokens}
                onChange={(e) => setParam("dailyTokens", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field
              label="Monthly cost cap (USD)"
              overridden={ov("monthlyCostUsd")}
              onToggle={() => toggleOv("monthlyCostUsd")}
            >
              <input
                type="number"
                value={p.monthlyCostUsd}
                onChange={(e) => setParam("monthlyCostUsd", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field
              label="Requests / minute"
              overridden={ov("requestsPerMin")}
              onToggle={() => toggleOv("requestsPerMin")}
            >
              <input
                type="number"
                value={p.requestsPerMin}
                onChange={(e) => setParam("requestsPerMin", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <Field
              label="Concurrent sessions"
              overridden={ov("concurrency")}
              onToggle={() => toggleOv("concurrency")}
            >
              <input
                type="number"
                value={p.concurrency}
                onChange={(e) => setParam("concurrency", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
            <div className="sm:col-span-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
                Session ceiling
              </span>
              <input
                value={active.sessionCeiling}
                onChange={(e) => update(active.id, { sessionCeiling: e.target.value })}
                className={`${inputCls} mt-2`}
              />
            </div>
          </div>
        </FoldCard>

        <FoldCard title="Custom parameters" tone="topaz" meta={`${active.custom.length} extra`}>
          <div className="flex justify-end">
            <JewelButton
              size="sm"
              variant="outline"
              onClick={() =>
                update(active.id, {
                  custom: [
                    ...active.custom,
                    { id: Math.random().toString(36).slice(2, 8), key: "", value: "" },
                  ],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </JewelButton>
          </div>
          <div className="mt-3 space-y-2">
            {active.custom.length === 0 && (
              <div className="font-mono text-[11.5px] text-muted-foreground/45">
                No extra parameters — nothing extra is sent to the provider.
              </div>
            )}
            {active.custom.map((c) => (
              <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <input
                  value={c.key}
                  placeholder="key"
                  onChange={(e) =>
                    update(active.id, {
                      custom: active.custom.map((x) =>
                        x.id === c.id ? { ...x, key: e.target.value } : x,
                      ),
                    })
                  }
                  className={inputCls}
                />
                <input
                  value={c.value}
                  placeholder="value"
                  onChange={(e) =>
                    update(active.id, {
                      custom: active.custom.map((x) =>
                        x.id === c.id ? { ...x, value: e.target.value } : x,
                      ),
                    })
                  }
                  className={inputCls}
                />
                <JewelButton
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update(active.id, { custom: active.custom.filter((x) => x.id !== c.id) })
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </JewelButton>
              </div>
            ))}
          </div>
        </FoldCard>

        {/* grants — one card per surface, side by side */}
        {grantMeta.map((g) => (
          <FoldCard
            key={g.key}
            title={g.label}
            tone={g.tone as JewelTone}
            meta={active.grants[g.key].length ? `${active.grants[g.key].length} selected` : "all"}
          >
            <MultiPicker
              label={g.label}
              hint={g.hint}
              tone={g.tone as JewelTone}
              options={sources[g.key]}
              value={active.grants[g.key]}
              onChange={(next) =>
                update(active.id, { grants: { ...active.grants, [g.key]: next } })
              }
            />
          </FoldCard>
        ))}
      </div>
    </div>
  );
}

function ComplianceTab() {
  const { roles } = useRoles();
  const { accounts, groups, groupsOf, expectedRole } = useIdentity();

  const rows = accounts.map((a) => {
    const gs = groupsOf(a.id);
    const expected = gs.length ? expectedRole(a.id) : "—";
    const compliant = gs.length > 0 && expected === a.role;
    return { a, gs, expected, compliant, orphan: gs.length === 0 };
  });

  const aligned = rows.filter((r) => r.compliant).length;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: "Accounts aligned",
            value: `${aligned}/${rows.length}`,
            tone: "emerald" as JewelTone,
          },
          {
            label: "Drifted / orphan",
            value: String(rows.length - aligned),
            tone: rows.length - aligned ? ("ruby" as JewelTone) : ("sapphire" as JewelTone),
          },
          {
            label: "Groups · roles",
            value: `${groups.length} · ${roles.length}`,
            tone: "sapphire" as JewelTone,
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-white/[0.07] bg-white/[0.015] px-5 py-4"
          >
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/55">
              {s.label}
            </div>
            <div className="mt-2 font-mono text-[22px] text-foreground">{s.value}</div>
            <div
              className="mt-3 h-px w-full"
              style={{ background: `color-mix(in oklab, var(--${s.tone}) 45%, transparent)` }}
            />
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015]">
        <div className="border-b border-white/[0.06] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/60">
          RBAC compliance · {aligned}/{rows.length} aligned
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="text-left font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/50">
                {[
                  "User",
                  "Provider",
                  "Assigned role",
                  "Expected (group rule)",
                  "Groups",
                  "Status",
                  "Compliance",
                ].map((h) => (
                  <th key={h} className="px-5 py-2.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, gs, expected, compliant, orphan }) => (
                <tr key={a.id} className="border-t border-white/[0.05]">
                  <td className="px-5 py-3 font-mono text-[12.5px] text-foreground/90">
                    {a.username}
                  </td>
                  <td className="px-5 py-3 font-mono text-[12px] text-muted-foreground/70">
                    {a.provider.toLowerCase()}
                  </td>
                  <td className="px-5 py-3 text-[13px] text-foreground/90">{a.role}</td>
                  <td className="px-5 py-3 font-mono text-[12px] text-muted-foreground/70">
                    {expected}
                  </td>
                  <td className="px-5 py-3 font-mono text-[12px] text-muted-foreground/70">
                    {gs.map((g) => g.name).join(", ") || "—"}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-2 font-mono text-[12px] text-muted-foreground/75">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background: `var(--${statusTone[a.status]})`,
                          boxShadow: `0 0 8px -1px var(--${statusTone[a.status]})`,
                        }}
                      />
                      {a.status}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <Tag tone={compliant ? "emerald" : orphan ? "topaz" : "ruby"}>
                      {compliant ? "✓ COMPLIANT" : orphan ? "NO GROUP" : "DRIFT"}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Panel>
        {COMPLIANCE.map((c) => (
          <Row key={c.id} className="grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="truncate text-[14px] text-foreground/95">{c.label}</div>
              <div className="mt-1.5 font-mono text-[12px] text-muted-foreground/60">
                {c.detail}
              </div>
            </div>
            <Tag tone={stateTone[c.state] as any}>{c.state.toUpperCase()}</Tag>
          </Row>
        ))}
      </Panel>
    </div>
  );
}
