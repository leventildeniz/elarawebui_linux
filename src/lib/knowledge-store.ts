import { toast } from "sonner";
import { seedNow } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { builtinWebhooks } from "@/mocks/knowledge-seed";
import { defaultKnowledge } from "@/mocks/knowledge-seed";
import { fetchApi } from "@/lib/api";
import { currentAccount } from "@/lib/group-store";

let cachedState = defaultKnowledge;

async function syncBackend() {
  try {
    const res = await fetchApi("/api/knowledge/state");
    cachedState = { ...defaultKnowledge, ...res };
    window.dispatchEvent(new CustomEvent(EVT));
  } catch (e) {
    console.warn("Failed to sync knowledge state:", e);
  }
}

/**
 * Knowledge Hub (RAG) state — ingestion control, sources, webhook adapters,
 * graph statistics. Persisted locally until the retrieval layer gets a backend.
 */

export type SourceKind = "file" | "directory" | "url" | "text";

export type KnowledgeSource = {
  id: string;
  name: string;
  kind: SourceKind;
  brand: string;
  chunks: number;
  status: "indexed" | "pending" | "stale" | "error";
  addedAt: number;
  /** Knowledge space this source belongs to — the permission boundary. */
  space?: string;
  /** Account id of the principal who ingested it. */
  owner?: string;
  /** Display handle of the uploader, kept for the audit line. */
  ownerName?: string;
  /** Upload size in MB, when known. */
  sizeMb?: number;
  /** Collection (virtual folder) this document was dropped into. */
  folder?: string;
  /** Tags derived automatically at ingest time — never typed by the user. */
  tags?: string[];
  /** Moment the document entered the ingest queue. */
  queuedAt?: number;
  /** Moment the index finished writing. */
  indexedAt?: number;
  /** Human-readable stage while the document is still pending. */
  stage?: string;
};

export type WebhookAdapter = {
  id: string;
  label: string;
  slug: string;
  enabled: boolean;
  secret: string;
  urlOverride: string;
  builtin: boolean;
  /** when true, payloads from this adapter are ingested into the RAG layer */
  ingestToRag: boolean;
};

export type KnowledgeHealth = {
  chunks: number;
  ftsNull: number;
  embedOk: number;
  embedPending: number;
  inProgress: number;
  stale: number;
  embedError: number;
  parseOk: number;
  parseLow: number;
};

export type KnowledgeState = {
  autoIngestion: boolean;
  autoReEnrich: boolean;
  batchSize: 500 | 1000 | 2500;
  embedModel: string;
  health: KnowledgeHealth;
  sources: KnowledgeSource[];
  webhooks: WebhookAdapter[];
  brandAliases: {
    id: string;
    brand: string;
    aliases: string;
    chunks?: number;
    enrichedDaysAgo?: number;
  }[];
};

export { builtinWebhooks };

export function webhookUrl(w: WebhookAdapter) {
  if (w.urlOverride) return w.urlOverride;
  const host = typeof window !== "undefined" ? window.location.origin : "";
  return `${host}/api/webhooks/${w.slug}`;
}

export const topEntities: { name: string; kind: string; degree: number }[] = [];

export { defaultKnowledge };

const KEY = "sovereign.knowledge";
const EVT = "sovereign:knowledge";

function read(): KnowledgeState {
  return cachedState;
}

function write(next: KnowledgeState) {
  cachedState = next;
  window.dispatchEvent(new CustomEvent(EVT));
}

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

export function useKnowledge() {
  const [state, setState] = useState<KnowledgeState>(cachedState);

  useEffect(() => {
    const sync = () => setState(read());
    sync();
    window.addEventListener(EVT, sync);
    syncBackend();
          return () => window.removeEventListener(EVT, sync);
  }, []);

  const patch = useCallback((p: Partial<KnowledgeState>) => {
    const next = { ...read(), ...p };
    write(next);
    setState(next);
    
    const body: Record<string, any> = {};
    if ('autoIngestion' in p) body["autoIngestion"] = p.autoIngestion;
    if ('autoReEnrich' in p) body["autoReEnrich"] = p.autoReEnrich;
    if ('batchSize' in p) body["batchSize"] = p.batchSize;
    if ('embedModel' in p) body["embedModel"] = p.embedModel;

    if (Object.keys(body).length > 0) {
      fetchApi("/api/knowledge/config", {
        method: "PATCH",
        body: JSON.stringify(body)
      }).catch(console.error);
    }
  }, []);

  const addSource = useCallback(
    async (src: {
      name: string;
      kind: SourceKind;
      brand: string;
      space?: string;
      owner?: string;
      ownerName?: string;
      sizeMb?: number;
      folder?: string;
      tags?: string[];
      file?: File | null;
      content?: string;
    }) => {
      const entry: KnowledgeSource = {
        id: uid("src"),
        name: src.name,
        kind: src.kind,
        brand: src.brand || "auto-detect",
        space: src.space ?? "",
        owner: src.owner ?? "",
        ownerName: src.ownerName ?? "",
        sizeMb: src.sizeMb ?? 0,
        folder: src.folder ?? "",
        tags: src.tags ?? [],
        chunks: 0,
        status: "pending",
        addedAt: Date.now(),
        queuedAt: Date.now(),
        stage: "queued",
      };

      const current = read();
      const next = {
        ...current,
        sources: [entry, ...current.sources],
        health: { ...current.health, embedPending: current.health.embedPending + 1 },
      };
      write(next);
      setState(next);

      try {
        let res;
        if (src.kind === "file" && src.file) {
          const fd = new FormData();
          fd.append("file", src.file);
          if (src.brand) fd.append("brand", src.brand);
          if (src.space) fd.append("spaceId", src.space);
          if (src.owner) fd.append("ownerId", src.owner);
          if (src.ownerName) fd.append("ownerName", src.ownerName);
          if (src.folder) fd.append("folderId", src.folder);
          if (src.tags && src.tags.length > 0) fd.append("tags", JSON.stringify(src.tags));
          fd.append("tag", ""); // Prevent backend from injecting "Uploaded File"
          
          const headers = new Headers();
          const sessionId = localStorage.getItem("sovereign.sessionId");
          if (sessionId) headers.set("x-session-id", sessionId);

          res = await fetch("/api/knowledge/file", {
            method: "POST",
            body: fd,
            headers
          }).then(async r => {
            const data = await r.json();
            if (!r.ok || data.ok === false) throw new Error(data.error || `HTTP ${r.status}`);
            return data;
          });
        } else if (src.kind === "url") {
          res = await fetchApi("/api/knowledge/fetch", {
            method: "POST",
            body: JSON.stringify({
              url: src.content,
              brand: src.brand,
              spaceId: src.space,
              ownerId: src.owner,
              ownerName: src.ownerName
            })
          });
        } else if (src.kind === "text") {
          res = await fetchApi("/api/knowledge/text", {
            method: "POST",
            body: JSON.stringify({
              content: src.content,
              name: src.name,
              brand: src.brand,
              spaceId: src.space,
              ownerId: src.owner,
              ownerName: src.ownerName
            })
          });
        } else if (src.kind === "directory") {
          res = await fetchApi("/api/knowledge/index-directory", {
            method: "POST",
            body: JSON.stringify({
              path: src.content,
              recursive: true,
              spaceId: src.space,
              ownerId: src.owner,
              ownerName: src.ownerName
            })
          });
        }
        
        console.log("Ingest response:", res);
      } catch (e: any) {
        console.error("Ingest POST failed:", e);
        
        // Optimistic rollback
        const rollback = {
          ...current,
          sources: current.sources,
          health: current.health,
        };
        write(rollback);
        setState(rollback);

        throw new Error(e.message || "Failed to ingest source");
      }
      
      // Refresh to get real DB status
      await syncBackend();
      return entry.id;
    },
    [],
  );

  const removeSource = useCallback(async (id: string) => {
    // Optimistic
    const current = read();
    const next = { ...current, sources: current.sources.filter((s) => s.id !== id) };
    write(next);
    setState(next);

    try {
      await fetchApi("/api/knowledge/purge", {
        method: "POST",
        body: JSON.stringify({ id: id })
      });
      syncBackend();
    } catch (e) {
      console.error("removeSource failed:", e);
      toast.error("Delete failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  const patchSource = useCallback((id: string, p: Partial<KnowledgeSource>) => {
    const current = read();
    const next = {
      ...current,
      sources: current.sources.map((s) => (s.id === id ? { ...s, ...p } : s)),
    };
    write(next);
    setState(next);

    fetchApi(`/api/knowledge/source/${id}`, {
      method: "PATCH",
      body: JSON.stringify(p)
    }).catch(console.error);

    if (p.brand !== undefined) {
      fetchApi(`/api/knowledge/source/${id}/brand`, {
        method: "PATCH",
        body: JSON.stringify({ brand: p.brand })
      }).catch(console.error);
    }
  }, []);

  const patchWebhook = useCallback((id: string, p: Partial<WebhookAdapter>) => {
    const current = read();
    const next = {
      ...current,
      webhooks: current.webhooks.map((w) => (w.id === id ? { ...w, ...p } : w)),
    };
    write(next);
    setState(next);
  }, []);

  const addWebhook = useCallback((label: string, slug: string) => {
    const current = read();
    const next = {
      ...current,
      webhooks: [
        ...current.webhooks,
        {
          id: uid("wh"),
          label,
          slug: slug || label.toLowerCase().replace(/\s+/g, "-"),
          enabled: false,
          secret: "",
          urlOverride: "",
          builtin: false,
          ingestToRag: true,
        },
      ],
    };
    write(next);
    setState(next);
  }, []);

  const removeWebhook = useCallback((id: string) => {
    const current = read();
    const next = { ...current, webhooks: current.webhooks.filter((w) => w.id !== id) };
    write(next);
    setState(next);
  }, []);

  const upsertAlias = useCallback((entry: { id?: string; brand: string; aliases: string }) => {
    const current = read();
    const id = entry.id ?? uid("ba");
    const exists = current.brandAliases.some((a) => a.id === id);
    const next = {
      ...current,
      brandAliases: exists
        ? current.brandAliases.map((a) => (a.id === id ? { ...a, ...entry, id } : a))
        : [...current.brandAliases, { id, brand: entry.brand, aliases: entry.aliases }],
    };
    write(next);
    setState(next);
  }, []);

  const removeAlias = useCallback((id: string) => {
    const current = read();
    const next = { ...current, brandAliases: current.brandAliases.filter((a) => a.id !== id) };
    write(next);
    setState(next);
  }, []);

  const nuke = useCallback(() => {
    const current = read();
    const next: KnowledgeState = {
      ...current,
      sources: [],
      health: {
        chunks: 0,
        ftsNull: 0,
        embedOk: 0,
        embedPending: 0,
        inProgress: 0,
        stale: 0,
        embedError: 0,
        parseOk: 0,
        parseLow: 0,
      },
    };
    write(next);
    setState(next);
  }, []);

  return {
    ...state,
    syncBackend,
    patch,
    addSource,
    removeSource,
    patchSource,
    patchWebhook,
    addWebhook,
    removeWebhook,
    upsertAlias,
    removeAlias,
    nuke,
  };
}
