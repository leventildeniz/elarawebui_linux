import { seedNow } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import {
  canEdit,
  readOwnerCtx,
  scopeOwned,
  stampOwner,
  useOwnerCtx,
  type Owned,
} from "@/lib/ownership";
export const defaultMcpState: McpState = {
  servers: [],
  exposures: [],
  logs: [],
  loading: false,
  error: null,
};

/**
 * MCP workspace state (server + client), persisted in localStorage.
 *
 * Server  — exposes studio agents / skills / tools over MCP to external hosts.
 * Client  — connects the studio to external MCP servers.
 */

export type McpAuthMode = "loopback" | "bearer" | "oauth2" | "oidc" | "entra";

export type McpToken = {
  id: string;
  label: string;
  prefix: string;
  createdAt: number;
  lastUsed: number | null;
  rawToken?: string;
};

export type McpServerConfig = {
  enabled: boolean;
  auth: McpAuthMode;
  namespace: string;
  rateLimit: number;
  authSourceKey?: string | null;
  authFallbackKey?: string | null;
  /** exposed entity ids, keyed by group */
  exposed: { agents: string[]; skills: string[]; tools: string[] };
};

export type McpClientServer = {
  id: string;
  slug?: string;
  name: string;
  transport: "http" | "sse" | "stdio";
  url: string;
  token: string;
  autoInject: boolean;
  enabled: boolean;
  status: "ready" | "idle" | "error";
  tools: number;
  createdAt: number;
} & Owned;

export type McpAuditEntry = {
  id: string;
  at: number;
  actor: string;
  action: string;
  detail: string;
  tone: "sapphire" | "emerald" | "amethyst" | "topaz" | "ruby";
};

export type McpState = {
  server: McpServerConfig;
  tokens: McpToken[];
  clients: McpClientServer[];
  audit: McpAuditEntry[]; // Kept local for session
};

const KEY = "elara.mcp.v1";
const EVT = "elara:mcp";

export const authModes: { id: McpAuthMode; label: string; hint: string }[] = [
  { id: "loopback", label: "Loopback only", hint: "127.0.0.1 — no token required" },
  { id: "bearer", label: "Bearer token", hint: "Static tokens issued below" },
  { id: "entra", label: "Microsoft Entra ID", hint: "Dynamic client registration via Entra" },
  { id: "oidc", label: "OpenID Connect", hint: "Dynamic client registration via OIDC" },
  { id: "oauth2", label: "OAuth 2.1", hint: "Dynamic client registration via OAuth2" },
];

export { defaultMcpState };

// We keep a local session log of audits
let sessionAudit: McpAuditEntry[] = [];

export function useMcp() {
  const ctx = useOwnerCtx();
  const [state, setState] = useState<McpState>(defaultMcpState);

  const sync = useCallback(async () => {
    try {
      const [settingsRes, exposuresRes, tokensRes, clientsRes] = await Promise.all([
        fetchApi("/api/mcp/settings").catch(() => null),
        fetchApi("/api/mcp/exposures").catch(() => null),
        fetchApi("/api/mcp/tokens").catch(() => null),
        fetchApi("/api/mcp/client/servers").catch(() => null)
      ]);

      const settings = settingsRes?.settings || {};
      const exposures = exposuresRes?.exposures || [];

      const exposed = { agents: [] as string[], skills: [] as string[], tools: [] as string[] };
      for (const ex of exposures) {
        if (ex.enabled) {
          if (ex.kind === "agent") exposed.agents.push(ex.slug);
          if (ex.kind === "skill") exposed.skills.push(ex.slug);
          if (ex.kind === "tool") exposed.tools.push(ex.slug);
        }
      }

      const server: McpServerConfig = {
        enabled: !!settings.enabled,
        auth: (settings.auth_mode as McpAuthMode) || "bearer",
        namespace: settings.namespace || "elara",
        rateLimit: settings.rate_limit_per_min ?? 60,
        authSourceKey: settings.auth_source_key || null,
        authFallbackKey: settings.auth_fallback_key || null,
        exposed
      };

      const clients: McpClientServer[] = (clientsRes?.servers || clientsRes?.items || []).map((s: any) => ({
        id: s.id,
        slug: s.slug || s.id,
        name: s.name,
        transport: s.transport,
        url: s.url,
        token: (s.auth_config || {}).token || "",
        autoInject: !!s.auto_inject,
        enabled: !!s.enabled,
        status: s.last_status === "up" || s.last_status === "ready" || s.last_status === "connected" ? "ready" : (s.last_status === "error" || s.last_status === "down" ? "error" : "idle"),
        tools: Array.isArray(s.tools_cache) ? s.tools_cache.length : 0,
        createdAt: new Date(s.created_at).getTime(),
        ownerId: s.created_by || "", // Owned
        ownerName: s.created_by || "",
        visibility: s.visibility || "workspace",
        sharedWith: s.shared_with || [],
        toolCatalog: s.tools_cache || [] // Katalog datası için
      }));

      setState(prev => {
        const mappedTokens: McpToken[] = (tokensRes?.tokens || []).filter((t: any) => !t.revoked_at).map((t: any) => {
          const existing = prev.tokens?.find(existing => existing.id === t.id);
          return {
            id: t.id,
            label: t.label,
            prefix: t.token_prefix,
            createdAt: new Date(t.created_at).getTime(),
            lastUsed: t.last_used_at ? new Date(t.last_used_at).getTime() : null,
            rawToken: existing?.rawToken
          };
        });

        return {
          server,
          tokens: mappedTokens,
          clients,
          audit: sessionAudit // carry over local audit
        };
      });
    } catch (e) {
      console.error("Failed to sync MCP state", e);
    }
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [sync]);

  /** Append an MCP audit entry (surfaced on Logs / Audit). */
  const logAudit = useCallback(
    (entry: Omit<McpAuditEntry, "id" | "at">) => {
      const next: McpAuditEntry = {
        ...entry,
        id: `aud.${Math.random().toString(36).slice(2, 9)}`,
        at: Date.now(),
      };
      sessionAudit = [next, ...sessionAudit].slice(0, 200);
      setState(prev => ({ ...prev, audit: sessionAudit }));
    },
    []
  );

  const patchServer = useCallback(
    async (patch: Partial<McpServerConfig>) => {
      const body: any = {};
      if (patch.enabled !== undefined) body.enabled = patch.enabled;
      if (patch.auth !== undefined) body.auth_mode = patch.auth;
      if (patch.namespace !== undefined) body.namespace = patch.namespace;
      if (patch.rateLimit !== undefined) body.rate_limit_per_min = patch.rateLimit;
      if (patch.authSourceKey !== undefined) body.auth_source_key = patch.authSourceKey;
      if (patch.authFallbackKey !== undefined) body.auth_fallback_key = patch.authFallbackKey;

      if (Object.keys(body).length > 0) {
        await fetchApi("/api/mcp/settings", { method: "PATCH", body: JSON.stringify(body) });
      }

      const detail = Object.entries(patch)
            .filter(([k]) => k !== "exposed")
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(" · ") || "exposures updated";

      logAudit({ actor: "operator", action: "server/config", detail, tone: "amethyst" });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [logAudit]
  );

  const toggleExposure = useCallback(
    async (group: keyof McpServerConfig["exposed"], id: string) => {
      const isEnabled = state.server.exposed[group].includes(id);
      const kindMap: Record<string, string> = { agents: "agent", skills: "skill", tools: "tool" };

      await fetchApi("/api/mcp/exposures/toggle", {
        method: "PATCH",
        body: JSON.stringify({ kind: kindMap[group] || "tool", slug: id, enabled: !isEnabled })
      });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [state.server.exposed]
  );

  const setExposureGroup = useCallback(
    async (group: keyof McpServerConfig["exposed"], ids: string[]) => {
      const res = await fetchApi("/api/mcp/exposures");
      const kindMap: Record<string, string> = { agents: "agent", skills: "skill", tools: "tool" };
      const kind = kindMap[group] || "tool";

      const currentOfKind = (res?.exposures || []).filter((e: any) => e.kind === kind);

      for (const ex of currentOfKind) {
        if (ex.enabled && !ids.includes(ex.slug)) {
          await fetchApi("/api/mcp/exposures/toggle", {
            method: "PATCH", body: JSON.stringify({ kind, slug: ex.slug, enabled: false })
          });
        }
      }

      for (const id of ids) {
        await fetchApi("/api/mcp/exposures/toggle", {
          method: "PATCH", body: JSON.stringify({ kind, slug: id, enabled: true })
        });
      }

      window.dispatchEvent(new CustomEvent(EVT));
    },
    []
  );

  const createToken = useCallback(
    async (label: string) => {
      const created = await fetchApi("/api/mcp/tokens", {
        method: "POST",
        body: JSON.stringify({ label: label.trim() || "unnamed" })
      });

      logAudit({ actor: "operator", action: "token/issue", detail: `${created.label} · ${created.token_prefix}…`, tone: "topaz" });

      const newToken: McpToken = {
        id: created.id,
        label: created.label,
        prefix: created.token_prefix,
        createdAt: new Date(created.created_at || Date.now()).getTime(),
        lastUsed: null,
        rawToken: created.token
      };

      setState(prev => ({
        ...prev,
        tokens: [newToken, ...prev.tokens]
      }));

      window.dispatchEvent(new CustomEvent(EVT));
      return newToken;
    },
    [logAudit]
  );

  const removeToken = useCallback(
    async (id: string) => {
      const revoked = state.tokens.find((t) => t.id === id);
      await fetchApi(`/api/mcp/tokens/${id}`, { method: "DELETE" });

      logAudit({ actor: "operator", action: "token/revoke", detail: revoked ? `${revoked.label} · ${revoked.prefix}…` : id, tone: "ruby" });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [logAudit, state.tokens]
  );

  const saveClient = useCallback(
    async (draft: Omit<McpClientServer, "createdAt"> & { createdAt?: number }) => {
      const exists = state.clients.some((c) => c.id === draft.id);

      const payload = {
        name: draft.name,
        url: draft.url,
        transport: draft.transport,
        auth_type: draft.token ? "bearer" : "none",
        auth_config: draft.token ? { token: draft.token } : {},
        auto_inject: draft.autoInject,
        visibility: draft.visibility || "workspace",
        shared_with: draft.sharedWith || [],
        ownerId: draft.ownerId,
        ownerName: draft.ownerName
      };

      if (exists) {
        await fetchApi(`/api/mcp/client/servers/${draft.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        // Eski kaydi editlediysen (belki komut degisti) onu da probe et
        await fetchApi(`/api/mcp/client/servers/${draft.id}/probe`, { method: "POST" });
      } else {
        const createRes = await fetchApi("/api/mcp/client/servers", { method: "POST", body: JSON.stringify(payload) });
        if (createRes?.server?.id) {
           // Yeni sunucu yaratildiginda otomatik Probe yap ki icindeki toollar cache'e insin
           await fetchApi(`/api/mcp/client/servers/${createRes.server.id}/probe`, { method: "POST" });
        }
      }

      logAudit({ actor: "operator", action: exists ? "client/update" : "client/connect", detail: `${draft.name || draft.id} · ${draft.transport}`, tone: "sapphire" });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [logAudit, state.clients]
  );

  const probeClient = useCallback(
    async (id: string) => {
      await fetchApi(`/api/mcp/client/servers/${id}/probe`, { method: "POST" });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    []
  );

  const removeClient = useCallback(
    async (id: string) => {
      const gone = state.clients.find((c) => c.id === id);
      await fetchApi(`/api/mcp/client/servers/${id}`, { method: "DELETE" });

      logAudit({ actor: "operator", action: "client/disconnect", detail: gone?.name ?? id, tone: "ruby" });
      window.dispatchEvent(new CustomEvent(EVT));
    },
    [logAudit, state.clients]
  );

  return {
    ...state,
    /* Client connections are personal — your endpoint, your token, your desk. */
    clients: scopeOwned(state.clients, ctx),
    allClients: state.clients,
    ctx,
    logAudit,
    patchServer,
    toggleExposure,
    setExposureGroup,
    createToken,
    removeToken,
    saveClient,
    removeClient,
    probeClient,
  };
}

export const emptyClient: Omit<McpClientServer, "id" | "createdAt"> = {
  name: "",
  transport: "http",
  url: "",
  token: "",
  autoInject: true,
  enabled: true,
  status: "idle",
  tools: 0,
};
