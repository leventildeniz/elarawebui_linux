import { useEffect } from "react";
import { create } from "zustand";
import { fetchApi } from "./api";
import {
  canEdit,
  readOwnerCtx,
  scopeOwned,
  stampOwner,
  useOwnerCtx,
  type Owned,
} from "@/lib/ownership";

export type DictKind = "category" | "connection" | "runner";

export type DictEntry = {
  id: string;
  key: string;
  label: string;
  seed?: boolean;
};

export type AdapterRisk = "low" | "medium" | "high" | "critical";

export type Adapter = Owned & {
  id: string;
  name: string;
  description: string;
  tags: string[];
  category: string;
  connection: string;
  runner: string;
  vaultScope: string;
  vaultName: string;
  vaultField: string;
  config: string;
  risk: AdapterRisk;
  requiresApproval: boolean;
  enabled: boolean;
  createdAt: number;
  lastTest: { at: number; ok: boolean; ms: number; detail: string } | null;
} & Owned;

export type AdapterState = {
  dict: Record<DictKind, DictEntry[]>;
  adapters: Adapter[];
  loading: boolean;
  error: string | null;
};

export const riskTones: Record<AdapterRisk, "emerald" | "topaz" | "amethyst" | "ruby"> = {
  low: "emerald",
  medium: "topaz",
  high: "amethyst",
  critical: "ruby",
};

export const vaultScopes = ["none", "studio", "workspace", "agent", "user"] as const;

const seed = (key: string, label: string): DictEntry => ({
  id: `d.${key}`,
  key,
  label,
  seed: true,
});

export const defaultDict = {
  category: [
    seed("ai", "AI"),
    seed("cloud", "Cloud"),
    seed("content", "Content"),
    seed("db", "DB"),
    seed("network", "Network"),
    seed("social", "Social"),
  ],
  connection: [
    seed("oauth2", "OAuth 2.0"),
    seed("rest_token", "REST Token"),
    seed("sql", "SQL"),
    seed("ssh", "SSH"),
    seed("webhook", "Webhook"),
  ],
  runner: [
    seed("http", "HTTP"),
    seed("node", "Node"),
    seed("python", "Python"),
    seed("shell", "Shell"),
  ],
};

export const emptyAdapter = (): Adapter => ({
  id: `adp-${Math.floor(1000 + Math.random() * 8999)}`,
  name: "",
  description: "",
  tags: [],
  category: "cloud",
  connection: "rest_token",
  runner: "http",
  vaultScope: "none",
  vaultName: "",
  vaultField: "",
  config: "{\n}",
  risk: "low",
  requiresApproval: false,
  enabled: true,
  createdAt: Date.now(),
  lastTest: null,
  ownerId: "org",
});

interface AdapterStore extends AdapterState {
  fetch: () => Promise<void>;
  saveAdapter: (adapter: Adapter) => Promise<void>;
  removeAdapter: (id: string) => Promise<void>;
  toggleAdapter: (id: string) => Promise<void>;
  testAdapter: (id: string) => Promise<void>;
  upsertDict: (kind: DictKind, entry: DictEntry) => Promise<void>;
  removeDict: (kind: DictKind, id: string) => Promise<void>;
  resetAll: () => Promise<void>;
  usedBy: (kind: DictKind, key: string) => number;
}

const mapDictRow = (row: any): DictEntry => ({
  id: String(row.id),
  key: row.value,
  label: row.label,
  seed: row.builtin,
});

const mapAdapterRow = (row: any): Adapter => {
  const vault = row.vault_binding_spec || {};
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    category: row.category || "cloud",
    connection: row.connection_type || "rest_token",
    runner: row.adapter || "http",
    vaultScope: vault.scope || "none",
    vaultName: vault.name || "",
    vaultField: vault.field || "",
    config: row.config ? JSON.stringify(row.config, null, 2) : "{}",
    risk: (row.risk_level as AdapterRisk) || "low",
    requiresApproval: !!row.requires_approval,
    enabled: !!row.enabled,
    createdAt: new Date(row.updated_at || row.created_at || Date.now()).getTime(),
    lastTest: null,
    ownerId: row.owner || "org",
    visibility: "workspace",
  };
};

export const useAdapterStore = create<AdapterStore>((set, get) => ({
  dict: defaultDict,
  adapters: [],
  loading: false,
  error: null,

  fetch: async () => {
    set({ loading: true, error: null });
    try {
      const [dictRes, adaptRes] = await Promise.all([
        fetchApi("/api/adapter-dictionaries"),
        fetchApi("/api/adapters"),
      ]);

      const dictMap: Record<DictKind, DictEntry[]> = {
        category: [...defaultDict.category],
        connection: [...defaultDict.connection],
        runner: [...defaultDict.runner],
      };

      if (dictRes.ok && Array.isArray(dictRes.items)) {
        dictRes.items.forEach((item: any) => {
          if (item.kind === "category" || item.kind === "connection" || item.kind === "runner") {
            const kind = item.kind as DictKind;
            const mapped = mapDictRow(item);
            const existingIdx = dictMap[kind].findIndex((d: DictEntry) => d.key === mapped.key);
            if (existingIdx >= 0) {
              dictMap[kind][existingIdx] = mapped; // Overwrite default if DB has it
            } else {
              dictMap[kind].push(mapped);
            }
          }
        });
      }

      let adapters: Adapter[] = [];
      if (adaptRes.ok && Array.isArray(adaptRes.items)) {
        adapters = adaptRes.items.map(mapAdapterRow);
      }

      set({ dict: dictMap, adapters, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  saveAdapter: async (adapter) => {
    try {
      let parsedConfig = {};
      try {
        parsedConfig = JSON.parse(adapter.config);
      } catch (e) {
        /* invalid json, store empty */
      }

      const payload = {
        id: adapter.id,
        name: adapter.name,
        adapter: adapter.runner,
        category: adapter.category,
        connection_type: adapter.connection,
        risk_level: adapter.risk,
        requires_approval: adapter.requiresApproval,
        config: parsedConfig,
        vault_binding_spec: {
          scope: adapter.vaultScope,
          name: adapter.vaultName,
          field: adapter.vaultField,
        },
        tags: adapter.tags,
        description: adapter.description,
        enabled: adapter.enabled,
      };

      // Check if exists in local state to decide POST vs PATCH
      const existing = get().adapters.find(a => a.id === adapter.id);
      const method = existing ? "PATCH" : "POST";
      const url = existing ? `/api/adapters/${adapter.id}` : "/api/adapters";

      await fetchApi(url, {
        method,
        body: JSON.stringify(payload),
      });

      await get().fetch();
    } catch (err: any) {
      console.error("saveAdapter error:", err);
      throw err;
    }
  },

  removeAdapter: async (id) => {
    try {
      await fetchApi(`/api/adapters/${id}`, { method: "DELETE" });
      await get().fetch();
    } catch (err: any) {
      console.error("removeAdapter error:", err);
      throw err;
    }
  },

  toggleAdapter: async (id) => {
    try {
      const adapter = get().adapters.find(a => a.id === id);
      if (!adapter) return;
      
      const patch = { enabled: !adapter.enabled };
      await fetchApi(`/api/adapters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await get().fetch();
    } catch (err: any) {
      console.error("toggleAdapter error:", err);
      throw err;
    }
  },

  testAdapter: async (id) => {
    try {
      const adapter = get().adapters.find(a => a.id === id);
      if (!adapter) return;
      
      const start = Date.now();
      const res = await fetchApi(`/api/adapters/${id}/test`, { method: "POST" });
      const ms = Date.now() - start;

      const ok = res.ok && res.checks && res.checks.reachable !== false;
      const detailParts: string[] = [];
      if (res.checks) {
        if (res.checks.http_status) detailParts.push(`${res.checks.http_status}`);
        if (res.checks.has_base_url) detailParts.push("base URL present");
        if (res.checks.error) detailParts.push(`err: ${res.checks.error}`);
        if (res.checks.has_host) detailParts.push("host config present");
      }

      set((prev) => ({
        adapters: prev.adapters.map(a => {
          if (a.id !== id) return a;
          return {
            ...a,
            lastTest: {
              at: Date.now(),
              ok,
              ms,
              detail: ok ? (detailParts.length ? detailParts.join(" · ") : `${a.runner} · test ok`) : (res.error || detailParts.join(" · ") || "Test failed")
            }
          };
        })
      }));
    } catch (err: any) {
      set((prev) => ({
        adapters: prev.adapters.map(a => {
          if (a.id !== id) return a;
          return { ...a, lastTest: { at: Date.now(), ok: false, ms: 0, detail: err.message } };
        })
      }));
    }
  },

  upsertDict: async (kind, entry) => {
    try {
      const isNew = String(entry.id).startsWith("d.");
      
      const payload = {
        kind,
        value: entry.key,
        label: entry.label,
      };

      if (isNew) {
        await fetchApi("/api/adapter-dictionaries", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        await fetchApi(`/api/adapter-dictionaries/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }

      await get().fetch();
    } catch (err: any) {
      console.error("upsertDict error:", err);
      throw err;
    }
  },

  removeDict: async (kind, id) => {
    try {
      await fetchApi(`/api/adapter-dictionaries/${id}`, { method: "DELETE" });
      await get().fetch();
    } catch (err: any) {
      console.error("removeDict error:", err);
      throw err;
    }
  },

  resetAll: async () => {
    try {
      await fetchApi("/api/adapter-dictionaries/reset", { method: "POST" });
      await get().fetch();
    } catch (err: any) {
      console.error("resetAll error:", err);
      throw err;
    }
  },

  usedBy: (kind, key) => {
    return get().adapters.filter((a) => a[kind] === key).length;
  },
}));

export function useAdapters() {
  const store = useAdapterStore();
  const ctx = useOwnerCtx();

  useEffect(() => {
    store.fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    dict: store.dict,
    adapters: scopeOwned(store.adapters, ctx),
    allAdapters: store.adapters,
    ctx,
    saveAdapter: store.saveAdapter,
    removeAdapter: store.removeAdapter,
    toggleAdapter: store.toggleAdapter,
    testAdapter: store.testAdapter,
    upsertDict: store.upsertDict,
    removeDict: store.removeDict,
    resetAll: store.resetAll,
    usedBy: store.usedBy,
  };
}
