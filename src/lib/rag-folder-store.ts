import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "./api";

/**
 * Collections ("virtual folders") the end user drops documents into.
 * Purely an organisational layer on top of the knowledge sources — the
 * permission boundary is still the knowledge space, resolved by the system.
 */

export type RagFolder = {
  id: string;
  name: string;
  /** Tags applied automatically to every document ingested here. */
  autoTags: string[];
  builtin: boolean;
  createdAt: number;
  /** Jewel tone the user picked for this collection. */
  color?: string;
  ownerId?: string;
};

/** Jewel tones a collection can be painted with. */
export const FOLDER_TONES = ["sapphire", "emerald", "amethyst", "topaz", "ruby", "platinum"];

export const UPLOADS_FOLDER: RagFolder = {
  id: "uploads",
  name: "Uploads",
  autoTags: [],
  builtin: true,
  createdAt: 0,
  color: "sapphire",
};

const EVT = "sovereign:ragFolders";
let cachedFolders: RagFolder[] = [UPLOADS_FOLDER];

async function syncFoldersBackend() {
  try {
    const data = await fetchApi("/api/rag-folders");
    if (Array.isArray(data)) {
      cachedFolders = data;
      window.dispatchEvent(new CustomEvent(EVT));
    }
  } catch (e) {
    console.error("Failed to sync rag folders:", e);
  }
}

export function useRagFolders() {
  const [folders, setFolders] = useState<RagFolder[]>(cachedFolders);

  useEffect(() => {
    const sync = () => setFolders([...cachedFolders]);
    sync();
    window.addEventListener(EVT, sync);
    syncFoldersBackend();
    return () => window.removeEventListener(EVT, sync);
  }, []);

  const addFolder = useCallback(async (name: string) => {
    const payload = {
      name: name.trim(),
      autoTags: [name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "folder"],
      color: FOLDER_TONES[cachedFolders.length % FOLDER_TONES.length] || "sapphire",
    };
    
    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const next = [...cachedFolders, { ...payload, id: tempId, builtin: false, createdAt: Date.now() }];
    cachedFolders = next;
    setFolders(next);

    try {
      const res = await fetchApi("/api/rag-folders", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      syncFoldersBackend();
      return res.id;
    } catch (e) {
      syncFoldersBackend();
      return tempId;
    }
  }, []);

  const patchFolder = useCallback(async (id: string, p: Partial<RagFolder>) => {
    const next = cachedFolders.map((f) => (f.id === id ? { ...f, ...p, id } : f));
    cachedFolders = next;
    setFolders(next);

    await fetchApi(`/api/rag-folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(p),
    });
    syncFoldersBackend();
  }, []);

  const removeFolder = useCallback(async (id: string) => {
    const next = cachedFolders.filter((f) => f.id !== id || f.builtin);
    cachedFolders = next;
    setFolders(next);

    await fetchApi(`/api/rag-folders/${id}`, { method: "DELETE" });
    syncFoldersBackend();
  }, []);

  return { folders, addFolder, patchFolder, removeFolder };
}
