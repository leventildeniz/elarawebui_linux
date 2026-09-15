import { useEffect, useState } from "react";
import { emitRbac } from "./rbac-events";

import { fetchApi } from "@/lib/api";
import { currentAccount, readGroups } from "@/lib/group-store";
import { isGodPrincipal } from "@/lib/knowledge-space-store";

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
      { id: "rag-documents", label: "RAG Documents" },
      { id: "memory-working", label: "Working Set" },
      { id: "memory-episodic", label: "Episodic Memory" },
      { id: "memory-semantic", label: "Semantic Memory" },
      { id: "memory-policy", label: "Memory Policy" },
      { id: "planner-tool", label: "Tool Planner" },
      { id: "planner-skill", label: "Skill Planner" },
      { id: "planner-mcp", label: "MCP Planner" },
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
      { id: "mcp-server", label: "MCP Server" },
      { id: "mcp-client", label: "MCP Client" },
      { id: "adapters", label: "Adapters" },
      { id: "webhooks", label: "Webhooks" },
    ],
  },
  {
    id: "runtime",
    label: "Runtime",
    tone: "topaz" as JewelTone,
    items: [
      { id: "engine-intent", label: "Intent Router" },
      { id: "engine-bridge", label: "Orchestrator Bridge" },
      { id: "models", label: "Models" },
      { id: "vision", label: "Vision" },
      { id: "fleet-general", label: "System General" },
      { id: "fleet-operators", label: "Operators Telemetry" },
      { id: "fleet-database", label: "Database Telemetry" },
      { id: "fleet-agents", label: "Fleet Agents" },
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
      { id: "knowledge-control", label: "RAG Control" },
      { id: "knowledge-spaces", label: "Access Spaces" },
      { id: "knowledge-aliases", label: "Brand Aliases" },
      { id: "knowledge-tuning", label: "Advanced Tuning" },
      { id: "rbac", label: "RBAC" },
      { id: "api-tokens", label: "Developer Hub" },
      { id: "policy-vault", label: "Secret Vault" },
      { id: "policy-genguard", label: "GenGuard" },
      { id: "policy-isolation", label: "Tool Isolation" },
      { id: "policy-skill-isolation", label: "Skill Isolation" },
      { id: "policy-mcp-isolation", label: "MCP Isolation" },
      { id: "policy-signed", label: "Signed Workflows" },
      { id: "policy-engine", label: "Policy Engine" },
      { id: "approvals", label: "Approval Queue" },
      { id: "security", label: "CVE Feed / Audit" },
      { id: "users-users", label: "Users" },
      { id: "users-groups", label: "Groups" },
      { id: "users-templates", label: "Templates" },
      { id: "users-compliance", label: "RBAC Compliance" },
      { id: "users-tenants", label: "Tenants" },
    ],
  },
  {
    id: "governance-settings",
    label: "Governance Settings",
    tone: "ruby" as JewelTone,
    items: [
      { id: "settings", label: "Multi-Provider Routing" },
      { id: "converter", label: "Global Converter" },
      { id: "services", label: "Services Infrastructure" },
      { id: "web-search", label: "Web Search Engine" },
      { id: "certificates", label: "Certificates & TLS" },
      { id: "mail", label: "Mail & Time Sync" },
      { id: "siem", label: "SIEM Forwarder" },
      { id: "telemetry-sources", label: "Telemetry Sources" },
      { id: "vision-audio", label: "Vision Audio" },
      { id: "backup", label: "Backup & Restore" },
      { id: "registry", label: "Capability Registry" },
      { id: "authentication", label: "Authentication Sources" },
      { id: "theme", label: "Theme Customization" },
      { id: "account", label: "Account Profile" },
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
      { id: "reporting-invoicing", label: "Tenant Invoicing" },
      { id: "reporting-users", label: "Operator Analytics" },
      { id: "reporting-rag", label: "RAG Analytics" },
      { id: "reporting-exports", label: "Scheduled Exports" },
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
  "rag-documents": "/rag-documents",
  "memory-working": "/memory",
  "memory-episodic": "/memory",
  "memory-semantic": "/memory",
  "memory-policy": "/memory",
  "planner-tool": "/planner",
  "planner-skill": "/planner",
  "planner-mcp": "/planner",
  orchestration: "/orchestration",
  flows: "/flows",
  skills: "/skills",
  tools: "/tools",
  capabilities: "/capabilities",
  factory: "/factory",
  "meta-forge": "/meta-forge",
  "mcp-server": "/mcp",
  "mcp-client": "/mcp",
  adapters: "/adapters",
  webhooks: "/adapters",
  "engine-intent": "/engine",
  "engine-bridge": "/engine",
  models: "/models",
  "fleet-general": "/fleet",
  "fleet-operators": "/fleet",
  "fleet-database": "/fleet",
  "fleet-agents": "/fleet",
  vision: "/vision",
  runtime: "/runtime",
  targets: "/targets",
  system: "/system",
  "knowledge-control": "/knowledge",
  "knowledge-spaces": "/knowledge",
  "knowledge-aliases": "/knowledge",
  "knowledge-tuning": "/knowledge",
  rbac: "/rbac",
  "api-tokens": "/api-tokens",
  "policy-vault": "/policy",
  "policy-genguard": "/policy",
  "policy-isolation": "/policy",
  "policy-skill-isolation": "/policy",
  "policy-mcp-isolation": "/policy",
  "policy-signed": "/policy",
  "policy-engine": "/policy",
  approvals: "/approvals",
  security: "/security",
  "users-users": "/users",
  "users-groups": "/users",
  "users-templates": "/users",
  "users-compliance": "/users",
  "users-tenants": "/users",
  settings: "/settings",
  converter: "/converter",
  services: "/services",
  "web-search": "/web-search",
  certificates: "/certificates",
  mail: "/mail",
  siem: "/siem",
  "telemetry-sources": "/telemetry-sources",
  "vision-audio": "/vision-audio",
  backup: "/backup",
  registry: "/registry",
  authentication: "/authentication",
  theme: "/theme",
  account: "/account",
  "reporting-overview": "/reporting/overview",
  "reporting-usage": "/reporting/usage",
  "reporting-cost": "/reporting/cost",
  "reporting-invoicing": "/reporting/invoicing",
  "reporting-users": "/reporting/users",
  "reporting-rag": "/reporting/rag",
  "reporting-exports": "/reporting/exports",
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
  if (isSovereign(role)) return [...ROLE_ACTIONS.map((a) => a.id)];
  return role.actions ?? DEFAULT_ACTIONS[role.id] ?? ["read"];
}

/** Check if the active signed-in principal has cluster-wide SuperAdmin rights. */
function isCallerSuperAdmin(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const acc = currentAccount();
    if (!acc) return false;
    const directGroups = (acc as any)?.groups || [];
    const groupIds = Array.from(
      new Set([
        ...directGroups,
        ...readGroups().filter((g) => g.members.includes(acc.id)).map((g) => g.id),
      ]),
    );
    return isGodPrincipal(acc.id, acc.role, groupIds);
  } catch {
    return false;
  }
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
    scopes: ALL.filter(
      (s) =>
        !["rbac", "security", "approvals"].includes(s) &&
        !s.startsWith("users-") &&
        !s.startsWith("policy-"),
    ),
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
      "policy-vault",
      "rbac",
      "users-users",
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
  // Zero-Trust: If an account is signed in and not admin, enforcement is ALWAYS active
  const me = currentAccount();
  if (me?.role && !/^admin(istrator)?s?$/i.test(me.role.trim())) {
    return true;
  }
  const stored = window.localStorage.getItem(ENFORCE_KEY);
  if (stored !== null) return stored === "1";
  return false;
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
  const stored = window.localStorage.getItem(SESSION_ROLE_KEY);
  if (stored) return stored;
  const me = currentAccount();
  if (me?.role) return me.role.trim().toLowerCase();
  return null;
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
export async function bindSessionRole(roleName: string | undefined): Promise<Role | undefined> {
  if (typeof window === "undefined" || !roleName) return undefined;
  let allRoles = read();
  if (!allRoles.length) {
    try {
      const data = await fetchApi("/api/identity/roles");
      if (Array.isArray(data) && data.length > 0) {
        allRoles = data.map((r: Role) =>
          isSovereign(r)
            ? { ...r, scopes: [...TAB_SCOPES], actions: [...ROLE_ACTIONS.map((a) => a.id)] }
            : r,
        );
        window.localStorage.setItem(KEY, JSON.stringify(allRoles));
      }
    } catch {}
  }
  const key = roleName.trim().toLowerCase();
  const role =
    allRoles.find((r) => r.name.trim().toLowerCase() === key || r.id.toLowerCase() === key) ??
    allRoles.find((r) => r.id.toLowerCase().includes(key) || key.includes(r.id.toLowerCase()));
  if (!role) {
    const isGov = /^admin/i.test(key);
    window.localStorage.setItem(ACTIVE_KEY, key);
    window.localStorage.setItem(SESSION_ROLE_KEY, key);
    window.localStorage.setItem(ENFORCE_KEY, isGov ? "0" : "1");
    window.localStorage.setItem(BOUND_KEY, isGov ? "0" : "1");
    window.dispatchEvent(new CustomEvent(EVENT));
    return undefined;
  }
  window.localStorage.setItem(ACTIVE_KEY, role.id);
  window.localStorage.setItem(SESSION_ROLE_KEY, role.id);
  window.localStorage.removeItem(PREVIEW_KEY);
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
    if (!Array.isArray(parsed) || !parsed.length) return defaultRoles;
    return parsed.map((r) => {
      if (isSovereign(r)) {
        return {
          ...r,
          scopes: [...TAB_SCOPES],
          actions: [...ROLE_ACTIONS.map((a) => a.id)],
        };
      }
      return r;
    });
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
  const name = String(role.name || "").trim().toLowerCase();
  return role.id === "admin" || name === "admin" || name === "super admin" || name === "sovereign";
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
  const me = currentAccount();

  if (preview) {
    const r = roles.find((x) => x.id.toLowerCase() === preview.toLowerCase() || x.name.toLowerCase() === preview.toLowerCase());
    if (r) return r;
  }

  if (session) {
    const r = roles.find((x) => x.id.toLowerCase() === session.toLowerCase() || x.name.toLowerCase() === session.toLowerCase());
    if (r) return r;
  }

  if (me?.role) {
    const r = roles.find((x) => x.id.toLowerCase() === me.role.toLowerCase() || x.name.toLowerCase() === me.role.toLowerCase());
    if (r) return r;
    // If not in roles list yet, return a safe scoped role (never admin!)
    if (!/^admin(istrator)?s?$/i.test(me.role.trim())) {
      return {
        id: me.role.toLowerCase(),
        name: me.role,
        provider: "Local",
        tone: "topaz",
        description: `${me.role} role`,
        system: false,
        scopes: ["chat"],
        actions: ["read"],
      };
    }
  }

  const activeId = readActive(roles);
  return (
    roles.find((r) => r.id === activeId) ??
    roles.find((r) => r.id === "admin") ??
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
  const [roles, setRoles] = useState<Role[]>(read);
  const [active, setActiveState] = useState<string>(() => readActive(read()));
  const [loaded, setLoaded] = useState<boolean>(() => (typeof window !== "undefined" && read().length > 0));

  useEffect(() => {
    const sync = async () => {
      let currentRoles: Role[] = [];
      try {
        const data = await fetchApi("/api/identity/roles");
        if (Array.isArray(data) && data.length > 0) {
          const mapped = data.map((r: Role) => {
            if (isSovereign(r)) {
              return {
                ...r,
                scopes: [...TAB_SCOPES],
                actions: [...ROLE_ACTIONS.map((a) => a.id)],
              };
            }
            return r;
          });
          setRoles(mapped);
          currentRoles = mapped;
          if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(mapped));
        } else {
          setRoles([]);
          if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify([]));
        }
      } catch (e) {
        console.error("Failed to fetch roles:", e);
        setRoles(read());
      } finally {
        setLoaded(true);
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
    if (!role) return;
    if (isSovereign(role)) return; // Root admin is immutable sovereign
    if (role.system && !isCallerSuperAdmin()) return; // Baseline system roles can only be edited by SuperAdmin
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
    if (!role) return;
    if (isSovereign(role)) return; // Root admin is immutable sovereign
    if (role.system && !isCallerSuperAdmin()) return;
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
    if (!role) return;
    if (isSovereign(role)) return; // Root admin is immutable sovereign
    if (role.system && !isCallerSuperAdmin()) return;
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
    loaded,
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
  const { roles, active, loaded } = useRoles();
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
    window.addEventListener("sovereign:identity", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("sovereign:identity", sync);
    };
  }, []);

  const me = currentAccount();
  const isSuperUser = me?.role ? /^admin(istrator)?s?$/i.test(me.role.trim()) : false;

  const role =
    (previewId ? roles.find((r) => r.id.toLowerCase() === previewId.toLowerCase() || r.name.toLowerCase() === previewId.toLowerCase()) : undefined) ??
    (sessionId ? roles.find((r) => r.id.toLowerCase() === sessionId.toLowerCase() || r.name.toLowerCase() === sessionId.toLowerCase()) : undefined) ??
    (me?.role ? roles.find((r) => r.id.toLowerCase() === me.role.toLowerCase() || r.name.toLowerCase() === me.role.toLowerCase()) : undefined) ??
    (isSuperUser ? (roles.find((r) => r.id === active) ?? roles[0]) : undefined) ??
    readActiveRole();

  const isReady = isSuperUser || Boolean(role) || loaded;
  const scopes = new Set<string>(role?.scopes ?? (isSuperUser ? TAB_SCOPES : []));
  const actions = roleActions(role);

  return {
    role,
    ready: isReady,
    enforced,
    actions,
    previewing: Boolean(previewId) && !bound,
    previewRole: previewId ? roles.find((r) => r.id === previewId) : undefined,
    sovereign: isSuperUser || isSovereign(role),
    can: (a: RoleAction) => isSuperUser || isSovereign(role) || actions.includes(a),
    allows: (pathOrScope: string) => {
      if (isSuperUser || isSovereign(role)) return true;
      if (pathOrScope === "/" || pathOrScope === "/account" || pathOrScope === "/theme") return true;

      if (!role) {
        if (!isReady) return true;
        // Safe default: non-admin without loaded role can only see public floor
        return pathOrScope === "/" || pathOrScope === "/account" || pathOrScope === "/theme";
      }

      // 1. If checking a specific tab scope (e.g. "engine-intent", "policy-vault", "fleet-agents")
      if (TAB_SCOPES.includes(pathOrScope as TabScope)) {
        return scopes.has(pathOrScope);
      }

      // 2. If checking a surface route path (e.g. "/engine", "/policy", "/users")
      const matchingScopes = Object.entries(SCOPE_ROUTES)
        .filter(([scope, path]) => path === pathOrScope && TAB_SCOPES.includes(scope as TabScope))
        .map(([scope]) => scope);

      if (matchingScopes.length > 0) {
        return matchingScopes.some((s) => scopes.has(s));
      }

      // 3. Direct match if identifier is explicitly contained in scopes
      if (scopes.has(pathOrScope)) return true;

      // 4. Zero-Trust deny by default for unmapped or unauthorized routes/scopes
      return false;
    },
  };
}
