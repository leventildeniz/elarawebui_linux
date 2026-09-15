import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "./api";
import type { Owned } from "@/lib/ownership";

export type SecretEntry = Owned & {
  id: string;
  scope: string;
  name: string;
  /** credential kind key, e.g. api_key, ssh_key, oauth2_client */
  kind: string;
  /** legacy single-value credential — still used by api_key / bearer kinds */
  secret: string;
  note: string;
  createdAt: number;
  /* kind-specific fields (all optional) */
  headerName?: string;
  baseUrl?: string;
  username?: string;
  password?: string;
  loginUrl?: string;
  host?: string;
  port?: string;
  privateKey?: string;
  passphrase?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  scopes?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  connectionString?: string;
  customFields?: string;
};

/** firewall verdict verbs shared by both policy chains */
export type RuleAction = "allow" | "deny" | "redact" | "route" | "challenge" | "log";

export type GenGuardRule = Owned & {
  id: string;
  name: string;
  enabled: boolean;
  sensitivity: string;
  inputBlacklist: string;
  outputPatterns: string;
  rulesPath: string;
  createdAt: number;
  /** firewall ordering — evaluated ascending, first match wins */
  seq?: number;
  action?: RuleAction;
  engineType?: "native" | "external";
  endpointUrl?: string;
  authMode?: "vault" | "direct" | "none";
  vaultRef?: string;
  apiKey?: string;
  providerFormat?: "llmfort" | "lakera" | "llamaguard" | "generic";
  riskThreshold?: number;
  stage?: "input" | "output" | "both";
  timeoutMs?: number;
  failMode?: "fail_open" | "fail_closed";
};

export type IsolationProfile = Owned & {
  id: string;
  name: string;
  enabled: boolean;
  allowedPaths: string;
  deniedSyscalls: string;
  network: string;
  /** hosts / CIDRs reachable when network = "allowlist" */
  netAllowlist: string;
  /** forge tool ids this sandbox is applied to */
  tools: string[];
  /** applied to every tool that has no explicit profile binding */
  fallback: boolean;
  createdAt: number;
};

/** Normalise a profile coming from older persisted state. */
export function normaliseIsolation(p: IsolationProfile): IsolationProfile {
  return {
    ...p,
    netAllowlist: p.netAllowlist ?? "",
    tools: Array.isArray(p.tools) ? p.tools : [],
    fallback: Boolean(p.fallback),
  };
}

/**
 * Which sandbox actually governs a tool call: an explicit binding always wins,
 * otherwise the fallback profile applies. Disabled profiles never match.
 */
export function resolveSandbox(
  profiles: IsolationProfile[],
  toolId: string,
): IsolationProfile | null {
  const active = profiles.map(normaliseIsolation).filter((p) => p.enabled);
  return active.find((p) => p.tools.includes(toolId)) ?? active.find((p) => p.fallback) ?? null;
}

export type SignedWorkflow = Owned & {
  id: string;
  name: string;
  fingerprint: string;
  algorithm: string;
  enforcement: string;
  createdAt: number;
};
export type PolicyRule = Owned & {
  id: string;
  name: string;
  ifCondition: string;
  thenAction: string;
  priority: string;
  enabled: boolean;
  createdAt: number;
  /** firewall ordering — evaluated ascending, first match wins */
  seq?: number;
  action?: RuleAction;
};

const now = Date.now();

export const policySeed: PolicyRule[] = [
  {
    id: "pol.route.coding",
    name: "Route coding intent",
    ifCondition: "intent = coding",
    thenAction: "route → forge-coder",
    priority: "high",
    seq: 10,
    action: "route",
    enabled: true,
    createdAt: now - 864e5 * 8,
  },
  {
    id: "pol.redact.pii",
    name: "Redact PII",
    ifCondition: "output contains pii",
    thenAction: "redact + audit",
    priority: "critical",
    seq: 20,
    action: "redact",
    enabled: true,
    createdAt: now - 864e5 * 5,
  },
  {
    id: "pol.spend.ceiling",
    name: "Spend ceiling",
    ifCondition: "cost > $50 / hour",
    thenAction: "halt fleet + page operator",
    priority: "high",
    seq: 30,
    action: "deny",
    enabled: false,
    createdAt: now - 864e5 * 3,
  },
];

export const secretSeed: SecretEntry[] = [
  {
    id: "sec.01",
    scope: "global",
    name: "checkpoint-prod",
    kind: "api_key",
    secret: "sk-live-••••••••••••7f21",
    headerName: "Authorization",
    baseUrl: "https://api.openai.com/v1",
    note: "Primary inference gateway credential.",
    createdAt: now - 864e5 * 6,
  },
  {
    id: "sec.02",
    scope: "EMBED_WORKER_",
    name: "vector-store",
    kind: "bearer_token",
    secret: "ey••••••••••••bQ",
    note: "Read/write access to the sovereign vector index.",
    createdAt: now - 864e5 * 2,
  },
  {
    id: "sec.03",
    scope: "NETSEC_",
    name: "bastion-dmz",
    kind: "ssh_key",
    secret: "",
    username: "svc-sovereign",
    host: "bastion.dmz.local",
    port: "22",
    privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\n••••••••\n-----END OPENSSH PRIVATE KEY-----",
    passphrase: "••••••",
    note: "Jump host key used by the recon fleet.",
    createdAt: now - 864e5 * 4,
  },
];

export const guardSeed: GenGuardRule[] = [
  {
    id: "gg.01",
    name: "Baseline injection defence",
    enabled: true,
    seq: 10,
    action: "deny",
    sensitivity: "medium",
    inputBlacklist: "ignore previous, reverse, base64, encode, spell out, decode, system prompt",
    outputPatterns:
      "/etc/passwd, /etc/shadow, \\.env, BEGIN RSA PRIVATE KEY, sk-[A-Za-z0-9]{20,}, AKIA[0-9A-Z]{16}",
    rulesPath: "/Users/admin/genguard/rules.txt",
    createdAt: now - 864e5 * 9,
  },
];

export const isolationSeed: IsolationProfile[] = [
  {
    id: "iso.01",
    name: "Default tool sandbox",
    enabled: true,
    allowedPaths: "/var/lib/sovereign/work\n/tmp/sandbox",
    deniedSyscalls: "fork, exec, ptrace",
    network: "denied",
    netAllowlist: "",
    tools: [],
    fallback: true,
    createdAt: now - 864e5 * 4,
  },
];

export const skillIsolationSeed: IsolationProfile[] = [
  {
    id: "siso.01",
    name: "Default skill sandbox",
    enabled: true,
    allowedPaths: "/var/lib/sovereign/skills\n/tmp/skill-run",
    deniedSyscalls: "fork, exec, ptrace, mount",
    network: "denied",
    netAllowlist: "",
    tools: [],
    fallback: true,
    createdAt: now - 864e5 * 4,
  },
];

export const mcpIsolationSeed: IsolationProfile[] = [
  {
    id: "miso.01",
    name: "Default MCP client sandbox",
    enabled: true,
    allowedPaths: "/var/lib/sovereign/mcp",
    deniedSyscalls: "fork, exec, ptrace",
    network: "allowlist",
    netAllowlist: "",
    tools: [],
    fallback: true,
    createdAt: now - 864e5 * 4,
  },
];

export const signedSeed: SignedWorkflow[] = [
  {
    id: "sig.01",
    name: "Production flows",
    fingerprint: "SHA256:abc1…ef9",
    algorithm: "Ed25519",
    enforcement: "reject unverified",
    createdAt: now - 864e5 * 12,
  },
];

function read<T>(key: string, seed: T[]): T[] {
  if (typeof window === "undefined") return seed;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : seed;
  } catch {
    return seed;
  }
}

export function useCollection<T extends { id: string; createdAt: number }>(
  key: string,
  seed: T[],
  prefix: string,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);

  // Map prefix to API endpoint
  const getEndpoint = () => {
    switch (prefix) {
      case "gg": return "/api/security/genguard";
      case "iso": return "/api/security/isolation?kind=tool";
      case "siso": return "/api/security/isolation?kind=skill";
      case "miso": return "/api/security/isolation?kind=mcp";
      case "sig": return "/api/security/signed";
      case "pol": return "/api/security/policy";
      default: return null;
    }
  };

  const getCollectionEndpoint = (id?: string) => {
    const base = getEndpoint()?.split('?')[0]; // Remove query params for detail routes
    return base && id ? `${base}/${id}` : base;
  };

  const mapFromServer = (row: any): T => {
    // Map snake_case to camelCase depending on prefix
    if (prefix === "gg") {
      return {
        ...row,
        inputBlacklist: row.input_blacklist || "",
        outputPatterns: row.output_patterns || "",
        rulesPath: row.rules_path || "",
        engineType: row.engine_type || "native",
        endpointUrl: row.endpoint_url || "",
        authMode: row.auth_mode || "vault",
        vaultRef: row.vault_ref || "",
        apiKey: row.api_key || "",
        providerFormat: row.provider_format || "generic",
        riskThreshold: row.risk_threshold !== null && row.risk_threshold !== undefined ? Number(row.risk_threshold) : 0.70,
        stage: row.stage || "input",
        timeoutMs: row.timeout_ms || 1500,
        failMode: row.fail_mode || "fail_open",
        ownerId: row.owner_id || "",
        ownerName: row.owner_name || "",
        visibility: row.visibility || "private",
        sharedWith: row.shared_with || [],
        createdAt: new Date(row.created_at).getTime()
      } as unknown as T;
    }
    if (["iso", "siso", "miso"].includes(prefix)) {
      return {
        ...row,
        allowedPaths: row.allowed_paths,
        deniedSyscalls: row.denied_syscalls,
        netAllowlist: row.net_allowlist,
        ownerId: row.owner_id || "",
        ownerName: row.owner_name || "",
        visibility: row.visibility || (row.fallback ? "workspace" : "private"),
        sharedWith: row.shared_with || [],
        createdAt: new Date(row.created_at).getTime()
      } as unknown as T;
    }
    if (prefix === "sig") {
      return {
        ...row,
        ownerId: row.owner_id || "",
        ownerName: row.owner_name || "",
        visibility: row.visibility || "private",
        sharedWith: row.shared_with || [],
        createdAt: new Date(row.created_at).getTime()
      } as unknown as T;
    }
    if (prefix === "pol") {
      return {
        ...row,
        ifCondition: row.if_condition,
        thenAction: row.then_action,
        ownerId: row.owner_id || "",
        ownerName: row.owner_name || "",
        visibility: row.visibility || "private",
        sharedWith: row.shared_with || [],
        createdAt: new Date(row.created_at).getTime()
      } as unknown as T;
    }
    return row;
  };

  const fetchItems = useCallback(async () => {
    const endpoint = getEndpoint();
    if (!endpoint) {
      // Fallback to local storage
      setItems(read(key, seed));
      return;
    }

    setLoading(true);
    try {
      const data = await fetchApi(endpoint);
      const rows = (data.items || []).map(mapFromServer);
      setItems(rows);
    } catch (err) {
      console.error(`Failed to load ${prefix} collection:`, err);
      // Fallback to local storage on error
      setItems(read(key, seed));
    } finally {
      setLoading(false);
    }
  }, [key, seed, prefix]);

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const persist = useCallback(
    (next: T[]) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    },
    [key],
  );

  const create = useCallback(
    async (draft: Omit<T, "id" | "createdAt">) => {
      const endpoint = getEndpoint();
      const id = `${prefix}.${Math.random().toString(36).slice(2, 7)}`;
      
      if (!endpoint) {
        setItems((prev) => persist([...prev, { ...(draft as object), id, createdAt: Date.now() } as T]));
        return;
      }

      try {
        // We inject the ID to maintain consistency with the old logic if needed by UI
        let payload = { ...draft, id };
        
        // Add kind for isolation profiles
        if (prefix === "siso") (payload as any).kind = "skill";
        if (prefix === "miso") (payload as any).kind = "mcp";
        if (prefix === "iso") (payload as any).kind = "tool";

        await fetchApi(endpoint, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        await fetchItems();
      } catch (err) {
        console.error(`Failed to create ${prefix} item:`, err);
        throw err;
      }
    },
    [persist, prefix, fetchItems],
  );

  const update = useCallback(
    async (id: string, patch: Partial<T>) => {
      const endpoint = getCollectionEndpoint(id);

      // Optimistic update for instant UI feedback (zero-delay toggle response)
      setItems((prev) => {
        const next = prev.map((x) => (x.id === id ? { ...x, ...patch } : x));
        persist(next);
        return next;
      });
      
      if (!endpoint) return;

      try {
        const existing = items.find(x => x.id === id);
        let payload = { ...(existing || {}), ...patch, id };
        
        // Ensure kind is preserved for isolation profiles
        if (prefix === "siso") (payload as any).kind = "skill";
        if (prefix === "miso") (payload as any).kind = "mcp";
        if (prefix === "iso") (payload as any).kind = "tool";

        await fetchApi(endpoint, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        await fetchItems();
      } catch (err) {
        console.error(`Failed to update ${prefix} item:`, err);
        await fetchItems();
        throw err;
      }
    },
    [persist, items, prefix, fetchItems, getCollectionEndpoint],
  );

  const remove = useCallback(
    async (id: string) => {
      const endpoint = getCollectionEndpoint(id);
      
      if (!endpoint) {
        setItems((prev) => persist(prev.filter((x) => x.id !== id)));
        return;
      }

      try {
        await fetchApi(endpoint, { method: "DELETE" });
        await fetchItems();
      } catch (err) {
        console.error(`Failed to delete ${prefix} item:`, err);
        throw err;
      }
    },
    [persist, fetchItems],
  );

  return { items, create, update, remove, loading };
}
