import { useCallback, useEffect, useState } from "react";
import type { JewelName } from "@/lib/avatar-library";
import { currentAccount, readGroups } from "@/lib/group-store";
import { readOwnerCtx } from "@/lib/ownership";

/**
 * User Model Templates — the provisioning contract bound to a user or group.
 *
 * A template never writes over the allowed model's own configuration unless an
 * operator explicitly flips the override switch for that single parameter.
 * Everything not overridden stays `inherit` and the model card wins.
 */

export type TemplateParamKey =
  | "temperature"
  | "topP"
  | "topK"
  | "repetitionPenalty"
  | "presencePenalty"
  | "frequencyPenalty"
  | "maxTokens"
  | "contextWindow"
  | "seed"
  | "streaming"
  | "thinkEnabled"
  | "thinkStatement"
  | "stopSequences"
  | "chatTemplateId"
  | "systemPrompt"
  | "dailyTokens"
  | "monthlyCostUsd"
  | "requestsPerMin"
  | "concurrency"
  | "memoryCompactAt"
  | "memoryKeepLastTurns"
  | "memoryEpisodicRetentionDays"
  | "memoryAutoPromoteFacts"
  | "memoryDedupe"
  | "memoryRedactSecrets"
  | "memoryEmbedOnWrite";

/** Parameters a bound user may personally override from their Account Settings. */
export type SelfServiceKey =
  | "personaPrompt"
  | "temperature"
  | "topP"
  | "topK"
  | "maxTokens"
  | "thinkEnabled"
  | "streaming"
  | "stopSequences"
  | "memoryCompactAt"
  | "memoryKeepLastTurns";

export const selfServiceMeta: {
  key: SelfServiceKey;
  label: string;
  hint: string;
}[] = [
  {
    key: "personaPrompt",
    label: "Persona prompt",
    hint: "Appended as the last prompt layer — policy layers stay sealed.",
  },
  { key: "temperature", label: "Temperature", hint: "Creativity of sampling." },
  { key: "topP", label: "Top-p", hint: "Nucleus sampling mass." },
  { key: "topK", label: "Top-k", hint: "Candidate token cut-off." },
  { key: "maxTokens", label: "Max tokens", hint: "Answer length ceiling (never above template)." },
  { key: "thinkEnabled", label: "Thinking mode", hint: "Let the user turn reasoning on/off." },
  { key: "streaming", label: "Streaming", hint: "Token streaming preference." },
  { key: "stopSequences", label: "Stop sequences", hint: "Personal stop tokens." },
  {
    key: "memoryCompactAt",
    label: "Compact threshold",
    hint: "Own compaction trigger — may only tighten below the template value.",
  },
  {
    key: "memoryKeepLastTurns",
    label: "Verbatim turns kept",
    hint: "Turns kept raw after a compaction — capped by the template.",
  },
];

export type CustomParam = { id: string; key: string; value: string };

export type GrantKey =
  | "models"
  | "providers"
  | "agents"
  | "tools"
  | "skills"
  | "mcp"
  | "mcpServer"
  | "capabilities"
  | "workflows"
  | "orchestrators"
  | "adapters"
  | "targets"
  | "vision"
  | "knowledge"
  | "ragSpaces"
  | "ragAgents"
  | "ragFolders"
  | "vault"
  | "promptLayers"
  | "planners"
  | "runtimes"
  | "sandboxes"
  | "metaForge"
  | "blueprints"
  | "boards"
  | "reports"
  | "roles";

export type UserTemplate = {
  id: string;
  name: string;
  description: string;
  jewel: JewelName;
  userCanModify: boolean;
  /** Which parameters the bound user may override for themselves. */
  userEditable: Partial<Record<SelfServiceKey, boolean>>;
  sessionCeiling: string;
  assignments: string[];
  /** Only keys present with `true` are pushed onto the allowed model. */
  overrides: Partial<Record<TemplateParamKey, boolean>>;
  params: {
    systemPrompt: string;
    temperature: number;
    topP: number;
    topK: number;
    repetitionPenalty: number;
    presencePenalty: number;
    frequencyPenalty: number;
    maxTokens: number;
    contextWindow: number;
    seed: string;
    streaming: boolean;
    thinkEnabled: boolean;
    thinkStatement: string;
    stopSequences: string;
    chatTemplateId: string;
    dailyTokens: number;
    monthlyCostUsd: number;
    requestsPerMin: number;
    concurrency: number;
    /** Memory subsystem contract pushed onto the runtime when overridden. */
    memoryCompactAt: number;
    memoryKeepLastTurns: number;
    memoryEpisodicRetentionDays: number;
    memoryAutoPromoteFacts: boolean;
    memoryDedupe: boolean;
    memoryRedactSecrets: boolean;
    memoryEmbedOnWrite: boolean;
  };

  custom: CustomParam[];
  grants: Record<GrantKey, string[]>;
  createdAt: number;
};

export const grantMeta: {
  key: GrantKey;
  label: string;
  hint: string;
  tone: JewelName;
}[] = [
  {
    key: "roles",
    label: "Bound RBAC Roles",
    hint: "The baseline RBAC role provisioned to users bound to this template.",
    tone: "ruby",
  },
  {
    key: "models",
    label: "Allowed AI Models",
    hint: "AI models available to this template. Empty = all tenant models.",
    tone: "sapphire",
  },
  {
    key: "providers",
    label: "LLM Providers",
    hint: "Allowed upstream LLM providers. Empty = global routing across all active providers.",
    tone: "sapphire",
  },
  {
    key: "ragSpaces",
    label: "Allowed Knowledge Spaces",
    hint: "RAG spaces bound users may query and ingest into. Empty = resolved from group membership.",
    tone: "emerald",
  },
  {
    key: "mcpServer",
    label: "MCP Server Gateway",
    hint: "Grant permission to host studio tools over MCP, issue tokens and manage exposures.",
    tone: "amethyst",
  },
];

export const emptyGrants = (): Record<GrantKey, string[]> => ({
  roles: [],
  models: [],
  providers: [],
  ragSpaces: [],
  mcpServer: [],
  agents: [],
  tools: [],
  skills: [],
  mcp: [],
  capabilities: [],
  workflows: [],
  orchestrators: [],
  adapters: [],
  targets: [],
  vision: [],
  knowledge: [],
  ragAgents: [],
  ragFolders: [],
  vault: [],
  promptLayers: [],
  planners: [],
  runtimes: [],
  sandboxes: [],
  metaForge: [],
  blueprints: [],
  boards: [],
  reports: [],
});

export const defaultParams: UserTemplate["params"] = {
  systemPrompt: "",
  temperature: 0.4,
  topP: 0.9,
  topK: 40,
  repetitionPenalty: 1.1,
  presencePenalty: 0,
  frequencyPenalty: 0,
  maxTokens: 4096,
  contextWindow: 128000,
  seed: "",
  streaming: true,
  thinkEnabled: false,
  thinkStatement:
    "Reason privately in structured steps. Verify assumptions before answering. Never expose raw chain-of-thought.",
  stopSequences: "",
  chatTemplateId: "auto",
  dailyTokens: 1000000,
  monthlyCostUsd: 250,
  requestsPerMin: 60,
  concurrency: 4,
  memoryCompactAt: 72,
  memoryKeepLastTurns: 8,
  memoryEpisodicRetentionDays: 90,
  memoryAutoPromoteFacts: true,
  memoryDedupe: true,
  memoryRedactSecrets: true,
  memoryEmbedOnWrite: true,
};

export function newTemplate(name = "New Template"): UserTemplate {
  return {
    id: `tpl.${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: "",
    jewel: "sapphire",
    userCanModify: true,
    userEditable: { personaPrompt: true, temperature: true, thinkEnabled: true },
    sessionCeiling: "12 h · MFA required",
    assignments: [],
    overrides: {},
    params: { ...defaultParams },
    custom: [],
    grants: emptyGrants(),
    createdAt: Date.now(),
  };
}

export const seedTemplates: UserTemplate[] = [];

import { fetchApi } from "@/lib/api";

const KEY = "elara.userTemplates.v1";
const EVT = "elara:userTemplates";

function read(): UserTemplate[] {
  if (typeof window === "undefined") return seedTemplates;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return seedTemplates;
    const parsed = JSON.parse(raw) as UserTemplate[];
    if (!Array.isArray(parsed) || !parsed.length) return seedTemplates;
    return parsed.map((t) => ({
      ...t,
      params: { ...defaultParams, ...t.params },
      grants: { ...emptyGrants(), ...t.grants },
      overrides: t.overrides ?? {},
      userEditable: t.userEditable ?? {},
      custom: t.custom ?? [],
    }));
  } catch {
    return seedTemplates;
  }
}

function write(list: UserTemplate[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

/** Non-hook read of the persisted template roster (SSR safe). */
export function readTemplates(): UserTemplate[] {
  if (typeof window === "undefined") return seedTemplates;
  return read();
}

export function canManageMcpServer(): boolean {
  if (typeof window === "undefined") return false;
  const ownerCtx = readOwnerCtx();
  if (ownerCtx.sovereign) return true;
  const me = currentAccount();
  if (!me) return false;
  const groups = readGroups();
  const group = groups.find((g) => g.members.includes(me.id));
  const templateId = me.template || group?.defaultTemplate || "";
  if (!templateId) return false;
  const tpls = readTemplates();
  const tpl = tpls.find((t) => t.id === templateId);
  if (!tpl || !tpl.grants) return false;
  const g = tpl.grants;
  if (g.mcpServer && g.mcpServer.length > 0) return true;
  if (g.mcp && (g.mcp.includes("server") || g.mcp.includes("gateway") || g.mcp.includes("*"))) return true;
  return false;
}

export function useUserTemplates() {
  const [templates, setTemplates] = useState<UserTemplate[]>(seedTemplates);

  useEffect(() => {
    const sync = async () => {
      try {
        const data = await fetchApi("/api/identity/templates");
        if (Array.isArray(data) && data.length > 0) {
          const mapped = data.map((t: any) => ({
            ...t,
            params: { ...defaultParams, ...t.params },
            grants: { ...emptyGrants(), ...t.grants },
            overrides: t.overrides ?? {},
            userEditable: t.userEditable ?? {},
            custom: t.custom ?? [],
            assignments: t.assignments ?? [],
          })) as UserTemplate[];
          setTemplates(mapped);
          if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(mapped));
        } else {
          setTemplates([]); // fallback to local/seed
          if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify([]));
        }
      } catch (err) {
        console.error("Failed to load templates:", err);
      }
    };
    sync();

    const syncLocal = () => {
      setTemplates(read());
    };
    window.addEventListener(EVT, syncLocal);
    window.addEventListener("storage", syncLocal);
    return () => {
      window.removeEventListener(EVT, syncLocal);
      window.removeEventListener("storage", syncLocal);
    };
  }, []);

  const create = useCallback(async () => {
    const draft = newTemplate();
    const payload = {
      id: draft.id,
      name: draft.name,
      description: draft.description,
      jewel: draft.jewel,
      userCanModify: draft.userCanModify,
      sessionCeiling: draft.sessionCeiling,
      userEditable: draft.userEditable,
      overrides: draft.overrides,
      custom: draft.custom,
      grants: draft.grants,
      params: draft.params
    };
    setTemplates((prev) => {
      const next = [...prev, draft];
      if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
    try {
      await fetchApi("/api/identity/templates", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch (e) { console.error("Failed to create template", e); }
    return draft.id;
  }, []);

  const update = useCallback(async (id: string, patch: Partial<UserTemplate>) => {
    // Optimistic update
    setTemplates((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
      if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
    try {
      await fetchApi(`/api/identity/templates/${id}`, {
        method: "PUT",
        body: JSON.stringify(patch)
      });
    } catch (e) { console.error("Failed to update template", e); }
  }, []);

  const remove = useCallback(async (id: string) => {
    setTemplates((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
    try {
      await fetchApi(`/api/identity/templates/${id}`, { method: "DELETE" });
    } catch (e) { console.error("Failed to delete template", e); }
  }, []);

  const duplicate = useCallback(async (id: string) => {
    const src = templates.find((t) => t.id === id);
    if (!src) return;
    const newId = `${src.id}.${Math.random().toString(36).slice(2, 6)}`;
    const cloned = {
      ...src,
      id: newId,
      name: `${src.name} copy`,
      createdAt: Date.now(),
    };
    
    setTemplates((prev) => {
      const next = [...prev, cloned];
      if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });

    try {
      await fetchApi("/api/identity/templates", {
        method: "POST",
        body: JSON.stringify({
          ...cloned,
          userCanModify: cloned.userCanModify
        })
      });
    } catch (e) { console.error("Failed to clone template", e); }
  }, [templates]);

  return { templates, create, update, remove, duplicate };
}
