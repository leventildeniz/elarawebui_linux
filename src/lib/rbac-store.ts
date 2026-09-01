import { useEffect, useState } from "react";
import { emitRbac } from "./rbac-events";

import { fetchApi } from "@/lib/api";

export type JewelTone = "sapphire" | "emerald" | "amethyst" | "ruby" | "topaz" | "canvas";

/** Scope groups mirror the live sidebar navigation, one scope per real tab. */
export const SCOPE_GROUPS = [
  {
    id: "core",
    label: "Core",
    tone: "sapphire" as JewelTone,
    items: [
      { id: "chat", label: "Chat" },
      { id: "agents", label: "Agents" },
      { id: "memory", label: "Memory" },
      { id: "rag-documents", label: "RAG Documents" },
      { id: "planner", label: "Planner" },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    tone: "amethyst" as JewelTone,
    items: [
      { id: "orchestration", label: "Orchestration" },
      { id: "flows", label: "Workflows" },
    ],
  },
  {
    id: "forge",
    label: "Forge",
    tone: "emerald" as JewelTone,
    items: [
      { id: "skills", label: "Skills" },
      { id: "tools", label: "Tools" },
      { id: "capabilities", label: "Capabilities" },
      { id: "factory", label: "Forge Factory" },
      { id: "meta-forge", label: "Meta-Forge" },
      { id: "mcp", label: "MCP" },
      { id: "adapters", label: "Adapters" },
    ],
  },
  {
    id: "runtime",
    label: "Runtime",
    tone: "topaz" as JewelTone,
    items: [
      { id: "engine", label: "System Engine" },
      { id: "models", label: "Models" },
      { id: "fleet", label: "Fleet Telemetry" },
      { id: "vision", label: "Vision" },
      { id: "runtime", label: "Python Runtime" },
      { id: "targets", label: "Targets" },
      { id: "system", label: "Logs / Audit" },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    tone: "ruby" as JewelTone,
    items: [
      { id: "knowledge", label: "Knowledge / RAG" },
      { id: "rbac", label: "RBAC" },
      { id: "policy", label: "Policies & Security" },
      { id: "approvals", label: "Approval Queue" },
      { id: "security", label: "CVE Feed / Audit" },
      { id: "users", label: "Users & Groups" },
      { id: "middleware", label: "Middleware" },
      { id: "settings", label: "Settings" },
    ],
  },
  {
    id: "reporting",
    label: "Reporting",
    tone: "sapphire" as JewelTone,
    items: [
      { id: "reporting-overview", label: "Overview" },
      { id: "reporting-usage", label: "Usage Analytics" },
      { id: "reporting-cost", label: "Cost & Spend" },
      { id: "reporting-users", label: "Operator Analytics" },
      { id: "reporting-rag", label: "RAG Analytics" },
      { id: "reporting-exports", label: "Scheduled Exports" },
    ],
  },
  {
    id: "studio",
    label: "Studio",
    tone: "amethyst" as JewelTone,
    items: [
      { id: "registry", label: "Capability Registry" },
      { id: "authentication", label: "Authentication" },
      { id: "converter", label: "Global Converter" },
      { id: "services", label: "Services" },
      { id: "certificates", label: "Certificates" },
      { id: "mail", label: "Mail & Time" },
      { id: "siem", label: "SIEM" },
      { id: "telemetry-sources", label: "Telemetry Sources" },
      { id: "vision-audio", label: "Vision Audio" },
      { id: "backup", label: "Backup & Restore" },
      { id: "theme", label: "Theme" },
      { id: "account", label: "Account" },
    ],
  },
] as const;

export const TAB_SCOPES = SCOPE_GROUPS.flatMap((g) => g.items.map((i) => i.id)) as TabScope[];

export type TabScope = (typeof SCOPE_GROUPS)[number]["items"][number]["id"];

export const SCOPE_LABELS: Record<string, string> = Object.fromEntries(
  SCOPE_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])),
);

export const AUTH_PROVIDERS = ["Local", "LDAP", "RADIUS", "SAML", "OIDC", "OAuth2"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/** Action verbs a role may exercise on the surfaces it can open. */
export const ROLE_ACTIONS = [
  { id: "read", label: "Read", hint: "Open surfaces and inspect state." },
  { id: "write", label: "Write", hint: "Create and edit studio objects." },
  { id: "approve", label: "Approve", hint: "Clear the approval queue and meta-forge proposals." },
  { id: "delete", label: "Delete", hint: "Destroy objects, roles and registry entries." },
  { id: "export", label: "Export", hint: "Download reports, journals and templates." },
  { id: "vault", label: "Vault reveal", hint: "Resolve and unmask stored secrets." },
  {
    id: "rag-ingest",
    label: "RAG ingest",
    hint: "Upload and remove documents inside the knowledge spaces this principal reads.",
  },
  {
    id: "rag-agent",
    label: "RAG agent forge",
    hint: "Create and retire the read-only librarian bound to a knowledge space.",
  },
  {
    id: "plan-execute",
    label: "Planner execute",
    hint: "Run planners in active mode — tools, skills and MCP calls actually fire.",
  },
  {
    id: "isolation",
    label: "Isolation admin",
    hint: "Create sandbox profiles and bind them to tools, skills and MCP clients.",
  },
  {
    id: "workspace-all",
    label: "Workspace override",
    hint: "See and edit studio objects owned by other principals — otherwise every desk is private.",
  },
] as const;

export type RoleAction = (typeof ROLE_ACTIONS)[number]["id"];

/** Which studio route each scope unlocks — the enforcement map for nav + guard. */
export const SCOPE_ROUTES: Record<string, string> = {
  chat: "/",
  agents: "/agents",
  memory: "/memory",
  "rag-documents": "/rag-documents",
  planner: "/planner",
  orchestration: "/orchestration",
  flows: "/flows",
  skills: "/skills",
  tools: "/tools",
  capabilities: "/capabilities",
  factory: "/factory",
  "meta-forge": "/meta-forge",
  mcp: "/mcp",
  adapters: "/adapters",
  engine: "/engine",
  models: "/models",
  fleet: "/fleet",
  vision: "/vision",
  runtime: "/runtime",
  targets: "/targets",
  system: "/system",
  knowledge: "/knowledge",
  rbac: "/rbac",
  policy: "/policy",
  approvals: "/approvals",
  security: "/security",
  users: "/users",
  settings: "/settings",
  "reporting-overview": "/reporting/overview",
  "reporting-usage": "/reporting/usage",
  "reporting-cost": "/reporting/cost",
  "reporting-users": "/reporting/users",
  "reporting-rag": "/reporting/rag",
  "reporting-exports": "/reporting/exports",
  registry: "/registry",
  authentication: "/authentication",
  converter: "/converter",
  services: "/services",
  certificates: "/certificates",
  mail: "/mail",
  siem: "/siem",
  "telemetry-sources": "/telemetry-sources",
  "vision-audio": "/vision-audio",
  backup: "/backup",
  theme: "/theme",
  account: "/account",
};

/** Reverse map: route path → scope id. */
export const ROUTE_SCOPES: Record<string, string> = Object.fromEntries(
  Object.entries(SCOPE_ROUTES).map(([scope, path]) => [path, scope]),
);

export type Role = {
  id: string;
  name: string;
  provider: AuthProvider;
  tone: JewelTone;
  description: string;
  system: boolean;
  scopes: TabScope[];
  /** Action verbs — absent on legacy records, resolved via `roleActions()`. */
  actions?: RoleAction[];
};

const DEFAULT_ACTIONS: Record<string, RoleAction[]> = {
  admin: [
    "read",
    "write",
    "approve",
    "delete",
    "export",
    "vault",
    "rag-ingest",
    "rag-agent",
    "plan-execute",
    "isolation",
    "workspace-all",
  ],
  engineer: ["read", "write", "export", "rag-ingest", "rag-agent", "plan-execute"],
  operator: ["read", "approve", "export", "rag-ingest"],
  security: [
    "read",
    "write",
    "approve",
    "delete",
    "export",
    "vault",
    "rag-ingest",
    "rag-agent",
    "plan-execute",
    "isolation",
    "workspace-all",
  ],

  viewer: ["read"],
};

/** Effective action set for a role — legacy records fall back to read-only. */
export function roleActions(role: Role | undefined): RoleAction[] {
  if (!role) return [];
  return role.actions ?? DEFAULT_ACTIONS[role.id] ?? ["read"];
}

const ALL = [...TAB_SCOPES];

const defaultRoles: Role[] = [];

/**
 * Named starting points for a new role — an architect picks one instead of
 * hand-checking 45 tabs. `scopes: null` means "every tab".
 */
export const ROLE_PRESETS: {
  id: string;
  label: string;
  hint: string;
  scopes: TabScope[] | null;
  actions: RoleAction[];
}[] = [
  {
    id: "blank",
    label: "Blank",
    hint: "Chat only — grant the rest by hand.",
    scopes: ["chat"],
    actions: ["read"],
  },
  {
    id: "platform",
    label: "Platform Engineer",
    hint: "Everything except RBAC, users, policy and approvals.",
    scopes: ALL.filter((s) => !["rbac", "users", "policy", "security", "approvals"].includes(s)),
    actions: ["read", "write", "delete", "export", "vault", "rag-ingest", "plan-execute"],
  },
  {
    id: "sovereign",
    label: "Sovereign (admin clone)",
    hint: "Every tab and every verb — a second full-power principal.",
    scopes: null,
    actions: [
      "read",
      "write",
      "approve",
      "delete",
      "export",
      "vault",
      "rag-ingest",
      "plan-execute",
    ],
  },
  {
    id: "approver",
    label: "Approver",
    hint: "Reads the studio, clears the approval queue, writes nothing else.",
    scopes: ["chat", "approvals", "meta-forge", "system", "reporting-overview", "account", "theme"],
    actions: ["read", "approve", "export"],
  },
  {
    id: "auditor",
    label: "Auditor",
    hint: "Read-only across governance, audit and reporting surfaces.",
    scopes: [
      "chat",
      "system",
      "security",
      "policy",
      "rbac",
      "users",
      "siem",
      "reporting-overview",
      "reporting-usage",
      "reporting-cost",
      "reporting-users",
      "reporting-rag",
      "account",
      "theme",
    ],
    actions: ["read", "export"],
  },
];

const KEY = "sovereign:rbac:roles:v7";
const ACTIVE_KEY = "sovereign:rbac:active";
const ENFORCE_KEY = "sovereign:rbac:enforce";
const BOUND_KEY = "sovereign:rbac:bound";
const SESSION_ROLE_KEY = "sovereign:rbac:session-role";
const PREVIEW_KEY = "sovereign:rbac:preview";
const EVENT = "sovereign:rbac";

export function readEnforcement(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENFORCE_KEY) === "1";
}

/**
 * True when the active role came from a real sign-in (not an architect
 * preview). A bound session gets no governance escape hatch.
 */
export function readSessionBound(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(BOUND_KEY) === "1";
}

/** Role id the architect is currently simulating (null when not previewing). */
export function readPreviewRoleId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PREVIEW_KEY);
}

/** The role the signed-in principal actually carries — never a preview. */
export function readSessionRoleId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_ROLE_KEY);
}

/**
 * Enter a simulation of another principal. The architect's own grants are
 * untouched — the studio only *renders* as that role until the preview is
 * exited, and RBAC/Users/Chat always stay reachable to leave it.
 */
export function startPreview(roleId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREVIEW_KEY, roleId);
  window.localStorage.setItem(ENFORCE_KEY, "1");
  window.localStorage.setItem(BOUND_KEY, "0");
  window.dispatchEvent(new CustomEvent(EVENT));
  emitRbac({
    action: "rbac.preview",
    role: "studio",
    target: roleId,
    detail: `architect entered a read-through preview as role "${roleId}" — own grants unchanged`,
  });
}

/** Leave the simulation and restore the architect's own session role. */
export function exitPreview() {
  if (typeof window === "undefined") return;
  const previous = readPreviewRoleId();
  window.localStorage.removeItem(PREVIEW_KEY);
  const session = readSessionRoleId();
  const sessionRole = session ? read().find((r) => r.id === session) : undefined;
  window.localStorage.setItem(ENFORCE_KEY, sessionRole && !isSovereign(sessionRole) ? "1" : "0");
  window.localStorage.setItem(BOUND_KEY, sessionRole && !isSovereign(sessionRole) ? "1" : "0");
  window.dispatchEvent(new CustomEvent(EVENT));
  emitRbac({
    action: "rbac.preview",
    role: "studio",
    target: previous ?? "none",
    detail: "preview exited — the architect's own scope is active again",
  });
}

export function setEnforcement(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENFORCE_KEY, on ? "1" : "0");
  // Manual arming from the RBAC page is a preview, never a bound session.
  window.localStorage.setItem(BOUND_KEY, "0");
  window.dispatchEvent(new CustomEvent(EVENT));
  emitRbac({
    action: "rbac.enforce",
    role: "studio",
    target: on ? "enabled" : "disabled",
    detail: `scope enforcement ${on ? "armed — navigation now filtered by role" : "disarmed — every surface reachable"}`,
  });
}

/**
 * Bind the session to the role carried by the signed-in principal.
 * Called by the access gate at sign-in: whoever logs in gets *their* role,
 * so an armed studio filters to what that account may actually reach.
 */
export function bindSessionRole(roleName: string | undefined): Role | undefined {
  if (typeof window === "undefined" || !roleName) return undefined;
  const key = roleName.trim().toLowerCase();
  const role =
    read().find((r) => r.name.trim().toLowerCase() === key) ??
    read().find((r) => r.id.toLowerCase() === key);
  if (!role) return undefined;
  window.localStorage.setItem(ACTIVE_KEY, role.id);
  window.localStorage.setItem(SESSION_ROLE_KEY, role.id);
  window.localStorage.removeItem(PREVIEW_KEY);
  // A real principal signs in as themselves: non-sovereign accounts get their
  // scope applied immediately, sovereigns get the unfiltered studio back.
  window.localStorage.setItem(ENFORCE_KEY, isSovereign(role) ? "0" : "1");
  window.localStorage.setItem(BOUND_KEY, isSovereign(role) ? "0" : "1");
  window.dispatchEvent(new CustomEvent(EVENT));
  return role;
}

function read(): Role[] {
  if (typeof window === "undefined") return defaultRoles;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultRoles;
    const parsed = JSON.parse(raw) as Role[];
    return Array.isArray(parsed) && parsed.length ? parsed : defaultRoles;
  } catch {
    return defaultRoles;
  }
}

function write(roles: Role[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(roles));
  window.dispatchEvent(new CustomEvent(EVENT));
}

function readActive(roles: Role[]): string {
  if (typeof window === "undefined") return roles[0]?.id ?? "admin";
  const id = window.localStorage.getItem(ACTIVE_KEY);
  return roles.some((r) => r.id === id) ? id! : (roles[0]?.id ?? "admin");
}

/** Sovereign principals — enforcement never applies to them. */
export function isSovereign(role?: Role | undefined): boolean {
  if (!role) return false;
  return role.id === "admin" || /\badmin(istrator)?s?\b/i.test(role.name);
}

/**
 * Non-hook read of the role this session is *evaluated* as (SSR safe):
 * the previewed role while simulating, otherwise the signed-in principal's
 * role, otherwise the role selected in the RBAC editor.
 */
export function readActiveRole(): Role | undefined {
  const roles = read();
  const preview = readPreviewRoleId();
  const session = readSessionRoleId();
  return (
    (preview ? roles.find((r) => r.id === preview) : undefined) ??
    (session ? roles.find((r) => r.id === session) : undefined) ??
    roles.find((r) => r.id === readActive(roles)) ??
    roles[0]
  );
}

/** Non-hook verb set of the active role. */
export function readRoleActions(): RoleAction[] {
  return roleActions(readActiveRole());
}

/**
 * Non-hook verb check (SSR safe). Mirrors useAccess().can — enforcement is
 * opt-in, sovereign principals always pass. Used by stores so a locked verb is
 * refused at the data layer, not only in the UI.
 */
export function readCan(action: RoleAction): boolean {
  if (!readEnforcement()) return true;
  const role = readActiveRole();
  if (isSovereign(role)) return true;
  return roleActions(role).includes(action);
}

/** Surfaces that stay reachable even when enforcement is armed. */
const ESCAPE_ROUTES = new Set<string>(["/", "/rbac", "/users"]);
/** A signed-in principal only keeps the chat surface as a floor. */
const BOUND_ESCAPE_ROUTES = new Set<string>(["/"]);

const TONES: JewelTone[] = ["sapphire", "emerald", "amethyst", "topaz", "ruby"];

export function useRoles() {
  const [roles, setRoles] = useState<Role[]>(defaultRoles);
  const [active, setActiveState] = useState<string>("admin");

  useEffect(() => {
    const sync = async () => {
      let currentRoles = [];
      try {
        const data = await fetchApi("/api/identity/roles");
        if (Array.isArray(data) && data.length > 0) {
          setRoles(data);
          currentRoles = data;
          if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(data));
        } else {
          setRoles([]);
          if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify([]));
        }
      } catch (e) {
        console.error("Failed to fetch roles:", e);
        setRoles(read());
      }
      setActiveState(readActive(currentRoles));
    };
    sync();

    const syncLocal = () => {
      setRoles(read());
      setActiveState(readActive(read()));
    };

    window.addEventListener(EVENT, syncLocal);
    window.addEventListener("storage", syncLocal);
    return () => {
      window.removeEventListener(EVENT, syncLocal);
      window.removeEventListener("storage", syncLocal);
    };
  }, []);

  const addRole = async (name: string, provider: AuthProvider = "Local", preset = "blank") => {
    let finalName = name.trim();
    let counter = 1;
    while(roles.some(r => r.name.toLowerCase() === finalName.toLowerCase())) {
       counter++;
       finalName = `${name.trim()} ${counter}`;
    }

    const spec = ROLE_PRESETS.find((p) => p.id === preset) ?? ROLE_PRESETS[0]!;
    const id = `${finalName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
    const role: Role = {
      id,
      name: finalName,
      provider,
      tone: TONES[roles.length % TONES.length]!,
      description: "Custom role — grant the tabs this principal may open.",
      system: false,
      scopes: spec.scopes ?? [...ALL],
      actions: [...spec.actions],
    };

    setRoles(prev => {
      const next = [...prev, role];
      if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });

    try {
      await fetchApi("/api/identity/roles", {
        method: "POST",
        body: JSON.stringify(role)
      });
    } catch (e) {
      console.error("Failed to add role:", e);
    }

    setActiveState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_KEY, id);
      window.dispatchEvent(new CustomEvent(EVENT));
    }

    emitRbac({
      action: "rbac.role.create",
      role: role.name,
      target: id,
      detail: `role "${role.name}" authored on provider ${provider} — preset ${spec.label} · ${role.scopes.length} tabs · verbs ${role.actions?.join("/")}`,
    });

    return id;
  };

  const cloneRole = async (id: string) => {
    const src = roles.find((r) => r.id === id);
    if (!src) return "";

    let finalName = `${src.name} (copy)`;
    let counter = 1;
    while(roles.some(r => r.name.toLowerCase() === finalName.toLowerCase())) {
       counter++;
       finalName = `${src.name} (copy ${counter})`;
    }

    const cloneId = `${src.id}-copy-${Math.random().toString(36).slice(2, 6)}`;
    const role: Role = {
      ...src,
      id: cloneId,
      name: finalName,
      system: false,
      scopes: [...src.scopes],
      actions: [...roleActions(src)],
    };
    
    setRoles(prev => {
      const next = [...prev, role];
      if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });

    try {
      await fetchApi("/api/identity/roles", {
        method: "POST",
        body: JSON.stringify(role)
      });
    } catch (e) {
      console.error("Failed to clone role:", e);
    }

    setActiveState(cloneId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_KEY, cloneId);
      window.dispatchEvent(new CustomEvent(EVENT));
    }

    emitRbac({
      action: "rbac.role.create",
      role: role.name,
      target: cloneId,
      detail: `role cloned from "${src.name}" — ${role.scopes.length} tabs carried over`,
    });

    return cloneId;
  };

  const updateRole = async (id: string, patch: Partial<Role>) => {
    const prevRoles = [...roles];
    // Optimistic update
    setRoles(prev => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      await fetchApi(`/api/identity/roles/${id}`, {
        method: "PUT",
        body: JSON.stringify(patch)
      });
    } catch (e) {
      console.error("Failed to update role:", e);
      setRoles(prevRoles); // Rollback on failure (e.g. duplicate name)
      // Ideally show a toast here in a real app, but rollback is critical so F5 matches state.
    }
  };

  const removeRole = async (id: string) => {
    const role = roles.find((r) => r.id === id);
    if (!role) return;
    try {
      await fetchApi(`/api/identity/roles/${id}`, { method: "DELETE" });
      const next = roles.filter((r) => r.id !== id);
      setRoles(next);
      
      if (active === id) {
        const nextActive = next[0]?.id ?? "admin";
        setActiveState(nextActive);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ACTIVE_KEY, nextActive);
          window.dispatchEvent(new CustomEvent(EVENT));
        }
      }
      
      emitRbac({
        action: "rbac.role.delete",
        role: role.name,
        target: id,
        detail: `role "${role.name}" destroyed`,
      });
    } catch (e) {
      console.error("Failed to remove role:", e);
    }
  };

  const toggleScope = async (id: string, scope: TabScope) => {
    const role = roles.find((r) => r.id === id);
    if (!role || role.system) return;
    const has = role.scopes.includes(scope);
    const newScopes = has ? role.scopes.filter((s) => s !== scope) : [...role.scopes, scope];
    await updateRole(id, { scopes: newScopes });
    emitRbac({
      action: has ? "rbac.revoke" : "rbac.grant",
      role: role.name,
      target: scope,
      detail: `${has ? "revoked" : "granted"} tab scope "${SCOPE_LABELS[scope] ?? scope}" for role ${role.name}`,
    });
  };

  const setAll = async (id: string, enable: boolean) => {
    const role = roles.find((r) => r.id === id);
    if (!role || role.system) return;
    await updateRole(id, { scopes: enable ? [...ALL] : [] });
    emitRbac({
      action: enable ? "rbac.grant" : "rbac.revoke",
      role: role.name,
      target: enable ? "all" : "none",
      detail: `${enable ? "granted" : "revoked"} all tab scopes for role ${role.name}`,
    });
  };

  const toggleAction = async (id: string, action: RoleAction) => {
    const role = roles.find((r) => r.id === id);
    if (!role || role.system) return;
    const current = role.actions ?? [];
    const has = current.includes(action);
    const newActions = has ? current.filter((a) => a !== action) : [...current, action];
    await updateRole(id, { actions: newActions });
    emitRbac({
      action: has ? "rbac.revoke" : "rbac.grant",
      role: role.name,
      target: action,
      detail: `${has ? "revoked" : "granted"} action verb "${action}" for role ${role.name}`,
    });
  };

  return {
    roles,
    active,
    setActive: (id: string) => {
      setActiveState(id);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ACTIVE_KEY, id);
        window.dispatchEvent(new CustomEvent(EVENT));
      }
    },
    addRole,
    cloneRole,
    updateRole,
    removeRole,
    toggleScope,
    setAll,
    toggleAction,
  };
}

/**
 * Access resolution for the shell: which surfaces the active role may open and
 * which verbs it may exercise. Enforcement is opt-in via the RBAC page.
 */
export function useAccess() {
  const { roles, active } = useRoles();
  const [enforced, setEnforced] = useState(false);
  const [bound, setBound] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setEnforced(readEnforcement());
      setBound(readSessionBound());
      setPreviewId(readPreviewRoleId());
      setSessionId(readSessionRoleId());
    };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const role =
    (previewId ? roles.find((r) => r.id === previewId) : undefined) ??
    (sessionId ? roles.find((r) => r.id === sessionId) : undefined) ??
    roles.find((r) => r.id === active) ??
    roles[0];
  const scopes = new Set<string>(role?.scopes ?? []);
  const actions = roleActions(role);

  return {
    role,
    enforced,
    actions,
    /** Simulating another principal — the architect's own grants are intact. */
    previewing: Boolean(previewId) && !bound,
    previewRole: previewId ? roles.find((r) => r.id === previewId) : undefined,
    sovereign: isSovereign(role),
    can: (a: RoleAction) => !enforced || isSovereign(role) || actions.includes(a),
    allows: (path: string) => {
      if (!enforced || !role || isSovereign(role)) return true;
      // Escape hatch — the architect can never lock themselves out of the
      // governance surfaces that disarm enforcement.
      if ((bound ? BOUND_ESCAPE_ROUTES : ESCAPE_ROUTES).has(path)) return true;
      const scope = ROUTE_SCOPES[path];
      if (!scope) return true;
      return scopes.has(scope);
    },
  };
}
