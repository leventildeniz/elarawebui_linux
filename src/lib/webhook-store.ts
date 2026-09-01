import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "./api";
import { canEdit, readOwnerCtx, scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";

export type Webhook = Owned & {
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
  risk: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  enabled: boolean;
  slug: string;
  urlOverride: string;
  ingestToRag: boolean;
  ragSpaceId: string;
  createdAt: number;
};

export const emptyWebhook: Omit<Webhook, "id" | "createdAt"> = {
  name: "",
  description: "",
  tags: [],
  category: "webhook",
  connection: "http_inbound",
  runner: "express",
  vaultScope: "none",
  vaultName: "",
  vaultField: "",
  config: "{\n}",
  risk: "low",
  requiresApproval: false,
  enabled: true,
  slug: "",
  urlOverride: "",
  ingestToRag: false,
  ragSpaceId: "",
  ownerId: "",
  ownerName: "",
  visibility: "workspace",
  sharedWith: [],
};

export function webhookUrl(w: Webhook) {
  if (w.urlOverride) return w.urlOverride;
  const host = typeof window !== "undefined" ? window.location.origin : "";
  return `${host}/api/webhooks/${w.slug}`;
}

const EVT = "sovereign:webhooks";
let cachedWebhooks: Webhook[] = [];

async function syncWebhooksBackend() {
  try {
    const data = await fetchApi("/api/webhooks");
    if (Array.isArray(data)) {
      cachedWebhooks = data;
      window.dispatchEvent(new CustomEvent(EVT));
    }
  } catch (e) {
    console.error("Failed to sync webhooks:", e);
  }
}

export function useWebhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[]>(cachedWebhooks);

  useEffect(() => {
    const onSync = () => setWebhooks([...cachedWebhooks]);
    window.addEventListener(EVT, onSync);
    syncWebhooksBackend();
    return () => window.removeEventListener(EVT, onSync);
  }, []);

  const create = useCallback(
    async (draft: Omit<Webhook, "id" | "createdAt">) => {
      const id = "wh." + Math.random().toString(36).slice(2, 8);
      const stamped = stampOwner({ ...draft, id, createdAt: Date.now() }) as Webhook;
      const payload = { 
        ...stamped, 
        slug: stamped.slug || id, 
        config: stamped.config || "{}" 
      };
      
      cachedWebhooks = [{ ...payload, sharedWith: [] } as Webhook, ...cachedWebhooks];
      setWebhooks(cachedWebhooks);

      await fetchApi("/api/webhooks", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      syncWebhooksBackend();
      return id;
    },
    []
  );

  const update = useCallback(
    async (id: string, patch: Partial<Webhook>) => {
      cachedWebhooks = cachedWebhooks.map(w => w.id === id ? { ...w, ...patch } : w);
      setWebhooks(cachedWebhooks);

      await fetchApi("/api/webhooks/" + id, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      syncWebhooksBackend();
    },
    []
  );

  const remove = useCallback(
    async (id: string) => {
      cachedWebhooks = cachedWebhooks.filter(w => w.id !== id);
      setWebhooks(cachedWebhooks);

      await fetchApi("/api/webhooks/" + id, { method: "DELETE" });
      syncWebhooksBackend();
    },
    []
  );

  const toggle = useCallback(
    (id: string) => {
      const w = cachedWebhooks.find((x) => x.id === id);
      if (w) update(id, { enabled: !w.enabled });
    },
    [update]
  );

  return { webhooks, create, update, remove, toggle };
}
