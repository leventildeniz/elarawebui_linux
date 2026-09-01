// Centralised state for Security tab, Middleware config and User Templates.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getApiBaseUrl, TemplatesAPI } from "./api-client";
import { createLocalId } from "./id";

/* ---------------- SIEM ---------------- */
export interface SiemConfig {
  enabled: boolean;
  host: string;
  protocol: "udp" | "tcp" | "tls";
  port: number;
  format: "CEF" | "LEEF" | "JSON" | "RFC5424";
  facility: string;
}

/* ---------------- Vault ---------------- */
export interface VaultEntry { id: string; name: string; value: string; }

/* ---------------- Audit ---------------- */
export interface AuditEntry {
  id: string; ts: string; user: string; action: string; result: "ok" | "deny" | "error"; meta?: string;
}

/* ---------------- Sandbox ---------------- */
export interface SandboxConfig {
  enabled: boolean;
  allowedPaths: string[];
  deniedSyscalls: string[];
}

/* ---------------- Middleware ---------------- */
export interface MiddlewareConfig {
  port: number;
  apiUrl: string;
  ipWhitelistEnabled: boolean;
  ipWhitelist: string[];
  rateLimitEnabled: boolean;
  rateLimitRpm: number;
  binaryInterceptionEnabled: boolean;
  proxyTargets: { id: string; path: string; target: string }[];
  tunnelLatencyMs: number;
}

/* ---------------- PostgreSQL ---------------- */
export interface PgConfig {
  host: string; port: number; database: string;
  username: string; password: string; ssl: boolean;
}

/* ---------------- User Model Templates ---------------- */
export interface ModelTemplate {
  id: string;
  name: string;
  systemPrompt: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  params: { id: string; name: string; value: string }[];
  agents: string[];
  ownerEditable: boolean; // user may modify
  allowedProviders?: string[];
  canOverrideProvider?: boolean;
  allowedModels?: string[];
}
export interface UserAssignment {
  id: string; username: string; templateId: string;
}

/* ---------------- Defaults ---------------- */
const D_SIEM: SiemConfig = {
  enabled: false, host: "siem.example.com", protocol: "udp",
  port: 514, format: "CEF", facility: "local0",
};
const D_VAULT: VaultEntry[] = [
  { id: "v1", name: "OPENAI_API_KEY", value: "" },
  { id: "v2", name: "PG_PASSWORD",    value: "" },
];
const D_AUDIT: AuditEntry[] = [
  { id: "a1", ts: new Date().toISOString(), user: "admin", action: "login",          result: "ok" },
  { id: "a2", ts: new Date().toISOString(), user: "ops",   action: "workflow.run",    result: "ok" },
  { id: "a3", ts: new Date().toISOString(), user: "guest", action: "prompt.injection", result: "deny", meta: "ignore previous" },
];
const D_SANDBOX: SandboxConfig = {
  enabled: true,
  allowedPaths: ["/var/lib/sovereign/work", "/tmp/sandbox"],
  deniedSyscalls: ["fork", "exec", "ptrace"],
};
const D_MID: MiddlewareConfig = {
  port: 3005, apiUrl: getApiBaseUrl(),
  ipWhitelistEnabled: false, ipWhitelist: ["127.0.0.1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  rateLimitEnabled: true, rateLimitRpm: 600,
  binaryInterceptionEnabled: true,
  proxyTargets: [
    { id: "p1", path: "/api/llm",   target: "http://127.0.0.1:11434" },
    { id: "p2", path: "/api/mlx",   target: "http://127.0.0.1:8001" },
    { id: "p3", path: "/api/agent", target: "http://127.0.0.1:8002" },
  ],
  tunnelLatencyMs: 7,
};
const D_PG: PgConfig = {
  host: "localhost", port: 5432, database: "sovereign_ai",
  username: "sovereign", password: "", ssl: false,
};
// Templates + assignments are loaded from PostgreSQL at boot — no static defaults.

/* ---------------- Store ---------------- */
interface Store {
  siem: SiemConfig;       setSiem: (s: SiemConfig) => void;
  vault: VaultEntry[];    setVault: (v: VaultEntry[]) => void;
  audit: AuditEntry[];    setAudit: (a: AuditEntry[]) => void;
  pushAudit: (e: Omit<AuditEntry, "id" | "ts">) => void;
  sandbox: SandboxConfig; setSandbox: (s: SandboxConfig) => void;
  middleware: MiddlewareConfig; setMiddleware: (m: MiddlewareConfig) => void;
  templates: ModelTemplate[];   setTemplates: (t: ModelTemplate[]) => void;
  assignments: UserAssignment[]; setAssignments: (a: UserAssignment[]) => void;
  pg: PgConfig; setPg: (p: PgConfig) => void;
}

function load<T>(k: string, fb: T): T {
  if (typeof window === "undefined") return fb;
  if (k === "sec.middleware") return { ...(fb as MiddlewareConfig), apiUrl: getApiBaseUrl() } as T;
  try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : fb; } catch { return fb; }
}

const Ctx = createContext<Store | null>(null);

export function SecurityProvider({ children }: { children: ReactNode }) {
  const [siem, setSiem]               = useState<SiemConfig>(() => load("sec.siem", D_SIEM));
  const [vault, setVault]             = useState<VaultEntry[]>(() => load("sec.vault", D_VAULT));
  const [audit, setAudit]             = useState<AuditEntry[]>(() => load("sec.audit", D_AUDIT));
  const [sandbox, setSandbox]         = useState<SandboxConfig>(() => load("sec.sandbox", D_SANDBOX));
  const [middleware, setMiddleware]   = useState<MiddlewareConfig>(() => load("sec.middleware", D_MID));
  const [templates, setTemplates]     = useState<ModelTemplate[]>([]);
  const [assignments, setAssignments] = useState<UserAssignment[]>([]);
  const [pg, setPg]                   = useState<PgConfig>(() => load("sec.pg", D_PG));

  useEffect(() => { setMiddleware((current) => ({ ...current, apiUrl: getApiBaseUrl() })); }, []);

  // Sovereign: templates + assignments live in PostgreSQL. Purge any legacy local cache.
  useEffect(() => {
    try { localStorage.removeItem("sec.templates"); localStorage.removeItem("sec.assignments"); } catch { /* */ }
    let cancelled = false;
    (async () => {
      const [tpls, asg] = await Promise.all([
        TemplatesAPI.list().catch(() => []),
        TemplatesAPI.listAssignments().catch(() => []),
      ]);
      if (cancelled) return;
      setTemplates(tpls.map(t => ({
        id: t.id, name: t.name, systemPrompt: t.systemPrompt,
        temperature: t.temperature, topP: t.topP, maxTokens: t.maxTokens,
        params: t.params, agents: t.agents, ownerEditable: t.ownerEditable,
        allowedProviders: t.allowedProviders ?? [],
        canOverrideProvider: t.canOverrideProvider !== false,
        allowedModels: t.allowedModels ?? [],
      })));
      setAssignments(asg.map(a => ({ id: a.id, username: a.username, templateId: a.templateId })));
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { localStorage.setItem("sec.siem",        JSON.stringify(siem)); }, [siem]);
  useEffect(() => { localStorage.setItem("sec.vault",       JSON.stringify(vault)); }, [vault]);
  useEffect(() => { localStorage.setItem("sec.audit",       JSON.stringify(audit)); }, [audit]);
  useEffect(() => { localStorage.setItem("sec.sandbox",     JSON.stringify(sandbox)); }, [sandbox]);
  useEffect(() => { localStorage.setItem("sec.pg",          JSON.stringify(pg)); }, [pg]);

  const pushAudit = (e: Omit<AuditEntry, "id" | "ts">) =>
    setAudit((a) => [{ id: createLocalId(), ts: new Date().toISOString(), ...e }, ...a].slice(0, 500));

  return (
    <Ctx.Provider value={{
      siem, setSiem, vault, setVault, audit, setAudit, pushAudit,
      sandbox, setSandbox, middleware, setMiddleware,
      templates, setTemplates, assignments, setAssignments,
      pg, setPg,
    }}>{children}</Ctx.Provider>
  );
}

export function useSecurity(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSecurity outside SecurityProvider");
  return v;
}
