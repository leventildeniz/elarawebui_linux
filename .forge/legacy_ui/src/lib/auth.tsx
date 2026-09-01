import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { IdentityAPI, AuthAPI } from "./api-client";

export type Role = "Viewer" | "Operator" | "Engineer" | "Admin" | "Security";

export interface User {
  username: string;
  role: Role;
  provider?: string;
  sessionId?: string;
  allowedProviders?: string[];
  canOverrideProvider?: boolean;
  allowedModels?: string[];
  canOverrideModel?: boolean;
  allowedAgents?: string[];
  allowedTools?: string[];
  templateId?: string;
}

export interface AuthProviderConfig {
  id: "local" | "ldap" | "radius" | "saml" | "oidc" | "oauth2";
  enabled: boolean;
  host?: string;
  port?: string;
  host2?: string;
  port2?: string;
  baseDn?: string;
  bindDn?: string;
  bindPassword?: string;
  secret?: string;
  realm?: string;
  metadataUrl?: string;
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  redirectUri?: string;
  scope?: string;
  defaultRole?: Role;
  // LDAP role mapping: AD/LDAP group memberOf → role.
  userFilter?: string;
  userDnTemplate?: string;
  // RADIUS / NPS attribute mapping (Filter-Id / Class / Vendor-Specific).
  roleAttribute?: "Filter-Id" | "Class" | "Vendor-Specific";
  nasIp?: string;
  nasIdentifier?: string;
  // Shared role map: { "Domain Admins": "Admin", "Operators": "Operator", ... }
  roleMap?: Record<string, Role>;
  // RADIUS auth method: PAP (User-Password) or MSCHAPv2 (NPS-friendly).
  authMethod?: "pap" | "mschapv2";
  // Live-test fields (NOT persisted — stripped before save).
  testUsername?: string;
  testPassword?: string;
}

export interface RbacRule {
  id: string;
  match: string; // username, email, group or "*"
  provider: AuthProviderConfig["id"];
  role: Role;
}

export interface BrandConfig {
  name: string;
  tagline: string;
  logoUrl: string;
}

const DEFAULT_PROVIDERS: AuthProviderConfig[] = [
  { id: "local",  enabled: true,  defaultRole: "Operator" },
  { id: "ldap",   enabled: false, host: "ldap.example.com", port: "389", baseDn: "dc=example,dc=com", bindDn: "cn=admin,dc=example,dc=com", bindPassword: "", defaultRole: "Viewer" },
  { id: "radius", enabled: false, host: "radius.example.com", port: "1812", secret: "",                  defaultRole: "Viewer" },
  { id: "saml",   enabled: false, metadataUrl: "https://idp.example.com/metadata", realm: "local-os",    defaultRole: "Viewer" },
  { id: "oidc",   enabled: false, issuer: "https://idp.example.com", clientId: "", clientSecret: "", redirectUri: "", scope: "openid profile email", defaultRole: "Viewer" },
  { id: "oauth2", enabled: false, authorizeUrl: "", tokenUrl: "", userinfoUrl: "", clientId: "", clientSecret: "", redirectUri: "", scope: "read", defaultRole: "Viewer" },
];

const DEFAULT_RBAC: RbacRule[] = [
  { id: "r1", match: "admin",  provider: "local", role: "Admin" },
  { id: "r2", match: "sec",    provider: "local", role: "Security" },
  { id: "r3", match: "*",      provider: "local", role: "Operator" },
];

const DEFAULT_BRAND: BrandConfig = {
  name: "AI OS",
  tagline: "Local-first AI operating system",
  logoUrl: "",
};

interface AuthCtx {
  user: User | null;
  ready: boolean;
  login: (u: string, p: string, provider?: string) => Promise<void>;
  logout: () => void;
  attempts: number;
  providers: AuthProviderConfig[];
  setProviders: (p: AuthProviderConfig[]) => void;
  rbac: RbacRule[];
  setRbac: (r: RbacRule[]) => void;
  brand: BrandConfig;
  setBrand: (b: BrandConfig) => void;
}

const Ctx = createContext<AuthCtx>({
  user: null, ready: false, login: async () => {}, logout: () => {}, attempts: 0,
  providers: DEFAULT_PROVIDERS, setProviders: () => {},
  rbac: DEFAULT_RBAC, setRbac: () => {},
  brand: DEFAULT_BRAND, setBrand: () => {},
});

function load<T>(key: string, fb: T): T {
  if (typeof window === "undefined") return fb;
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fb; } catch { return fb; }
}

// Server provider rows are { id, enabled, config:{...} }; the UI flattens
// config back onto the row so existing field bindings keep working.
function rowsToProviders(rows: Array<{ id: string; enabled: boolean; config: Record<string, unknown> }>): AuthProviderConfig[] {
  const byId = new Map(rows.map(r => [r.id, r]));
  return DEFAULT_PROVIDERS.map(d => {
    const r = byId.get(d.id);
    if (!r) return d;
    return { ...d, ...(r.config as Partial<AuthProviderConfig>), id: d.id, enabled: !!r.enabled };
  });
}
function providersToRows(list: AuthProviderConfig[]) {
  return list.map(p => {
    // Live-test credentials are session-only; never persist them.
    const { id, enabled, testUsername: _tu, testPassword: _tp, ...rest } = p;
    void _tu; void _tp;
    return { id, enabled: !!enabled, config: rest as Record<string, unknown> };
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // SSR-safe: start with deterministic defaults so the server-rendered HTML
  // matches the client's first paint. Real values from localStorage are
  // hydrated in a single post-mount effect; only then do we flip `ready`.
  // This avoids React #418 hydration flashes that briefly remount the tree
  // and surface the "Verifying session…" splash on every page.
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [providers, setProvidersState] = useState<AuthProviderConfig[]>(DEFAULT_PROVIDERS);
  const [rbac, setRbac] = useState<RbacRule[]>(DEFAULT_RBAC);
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND);

  const setUserSync = (next: User | null) => {
    if (typeof window !== "undefined") {
      if (next) localStorage.setItem("user", JSON.stringify(next));
      else localStorage.removeItem("user");
    }
    setUser(next);
  };

  // Single post-mount hydration pass — keeps SSR/CSR identical, then loads
  // persisted state from localStorage on the client only.
  useEffect(() => {
    if (typeof window !== "undefined") {
      const u = load<User | null>("user", null);
      const p = load<AuthProviderConfig[]>("providers", DEFAULT_PROVIDERS);
      const r = load<RbacRule[]>("rbac", DEFAULT_RBAC);
      const b = load<BrandConfig>("brand", DEFAULT_BRAND);
      if (u) setUser(u);
      setProvidersState(p);
      setRbac(r);
      setBrand(b);
    }
    setReady(true);
  }, []);

  // Hydrate provider config from PostgreSQL (sovereign source of truth).
  // Falls back silently to localStorage if the bridge is offline.
  useEffect(() => {
    let cancel = false;
    (async () => {
      const r = await AuthAPI.listProviders();
      if (cancel) return;
      if (r.ok && Array.isArray(r.providers) && r.providers.length) {
        setProvidersState(rowsToProviders(r.providers));
      }
    })();
    return () => { cancel = true; };
  }, []);

  // setProviders pushes to server (admin-gated) AND mirrors locally for offline.
  const setProviders = (next: AuthProviderConfig[]) => {
    setProvidersState(next);
    if (typeof window !== "undefined") localStorage.setItem("providers", JSON.stringify(next));
    void AuthAPI.saveProviders(providersToRows(next));
  };

  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("rbac", JSON.stringify(rbac)); }, [rbac]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("brand", JSON.stringify(brand)); }, [brand]);

  const login = async (username: string, password: string, provider: string = "local") => {
    if (!username || password.length < 3) {
      setAttempts((a) => a + 1);
      throw new Error("invalid");
    }
    const device = typeof navigator !== "undefined" ? `${navigator.userAgent.split(" ").slice(-2).join(" ")}` : "";
    // Bridge cold-start retry — local mac'te bridge bazen ilk istekte yavaş
    // cevap veriyor; "iki defa şifre girme" semptomu buradan geliyordu.
    // 250ms → 800ms ve 2 retry (toplam 3 deneme) ile soğuk başlangıç kapatıldı.
    const attempt = () => IdentityAPI.login({ username, password, provider, device }).catch(
      () => ({ ok: false, error: "Bridge Connection Error" } as Awaited<ReturnType<typeof IdentityAPI.login>>),
    );
    let bridge = await attempt();
    const isTransient = (e?: string) => !e || /bridge|network|timeout|fetch|connection/i.test(e);
    if (!bridge.ok && isTransient(bridge.error)) {
      await new Promise((r) => setTimeout(r, 800));
      bridge = await attempt();
    }
    if (!bridge.ok && isTransient(bridge.error)) {
      await new Promise((r) => setTimeout(r, 1500));
      bridge = await attempt();
    }
    if (bridge.ok && bridge.user) {
      setUserSync({
        username: bridge.user.username,
        role: bridge.user.role as Role,
        provider: bridge.user.provider,
        sessionId: bridge.sessionId,
        allowedProviders: bridge.user.allowedProviders ?? [],
        canOverrideProvider: bridge.user.canOverrideProvider !== false,
        allowedModels: (bridge.user as { allowedModels?: string[] }).allowedModels ?? [],
        canOverrideModel: (bridge.user as { canOverrideModel?: boolean }).canOverrideModel !== false,
        allowedAgents: (bridge.user as { allowedAgents?: string[] }).allowedAgents ?? [],
        allowedTools: (bridge.user as { allowedTools?: string[] }).allowedTools ?? [],
        templateId: bridge.user.templateId,
      });
      setAttempts(0);
      return;
    }
    if (bridge.error && /credentials|locked|disabled|expired|disabled|failed|reject/i.test(bridge.error)) {
      setAttempts((a) => a + 1);
      throw new Error(bridge.error);
    }
    setAttempts((a) => a + 1);
    throw new Error(bridge.error || "Bridge Connection Error");
  };
  const logout = () => setUserSync(null);

  return (
    <Ctx.Provider value={{ user, ready, login, logout, attempts, providers, setProviders, rbac, setRbac, brand, setBrand }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
export const ROLES: Role[] = ["Viewer", "Operator", "Engineer", "Admin", "Security"];
export const ROLE_PERMS: Record<Role, string> = {
  Viewer:   "chat (read-only)",
  Operator: "run workflows",
  Engineer: "add tools",
  Admin:    "manage runtime",
  Security: "audit & logs",
};
