import { useCallback, useEffect, useState } from "react";
import type { AvatarStyle, JewelName } from "@/lib/avatar-library";
import { fetchApi } from "./api";

export type AdvancedParam = { id: string; key: string; value: string };

export type StudioModel = {
  id: string;
  name: string;
  modelId: string;
  vendor: string;
  baseUrl: string;
  apiKeyRef: string;
  systemPrompt: string;
  rag: boolean;
  streaming: boolean;
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  thinkEnabled: boolean;
  thinkStatement: string;
  stopSequences: string[];
  advanced: AdvancedParam[];
  chatTemplateId: string;
  chatTemplate: string;
  contextWindow: number;
  maxTokens: number;
  inputCost: number;
  outputCost: number;
  avatar: { seed: string; style: AvatarStyle; jewel: JewelName };
  group: string;
  enabled: boolean;
  createdAt: number;
};

export const paramDefaults = {
  topP: 0.95,
  topK: 40,
  repetitionPenalty: 1.1,
  thinkEnabled: false,
  thinkStatement:
    "Reason privately in structured steps. Verify assumptions before answering. Never expose raw chain-of-thought.",
  stopSequences: [] as string[],
  advanced: [] as AdvancedParam[],
  chatTemplateId: "auto",
  chatTemplate: "",
};

export const emptyModel: Omit<StudioModel, "id" | "createdAt"> = {
  ...paramDefaults,
  name: "",
  modelId: "",
  vendor: "Elara Gateway",
  baseUrl: "",
  apiKeyRef: "",
  systemPrompt: "",
  rag: false,
  streaming: true,
  temperature: 0.7,
  contextWindow: 8192,
  maxTokens: 4096,
  inputCost: 0,
  outputCost: 0,
  avatar: { seed: "new-model", style: "sigil", jewel: "sapphire" },
  group: "local",
  enabled: true,
};

// Removed legacy array-based chat templates. Only custom override string is preserved.

export type ModelGroup = { id: string; name: string; tone: string };

export const modelGroupTones = ["sapphire", "emerald", "amethyst", "topaz", "ruby"] as const;

export const MOD_EVT = "sovereign:models";
export const GRP_EVT = "sovereign:model-groups";

let cachedModels: StudioModel[] = [];
let cachedGroups: ModelGroup[] = [];
let cachedDefaultId = "";
let fetchPromise: Promise<void> | null = null;

export async function syncModelsBackend() {
  if (fetchPromise) return fetchPromise;
  
  fetchPromise = (async () => {
    try {
      const data = await fetchApi("/api/models");
      if (data?.ok) {
        cachedGroups = data.groups || [];
        cachedModels = data.models || [];
        cachedDefaultId = data.defaultId || "";
      }
    } catch (e) {
      console.error("Failed to sync models backend", e);
    } finally {
      fetchPromise = null;
    }
  })();
  
  return fetchPromise;
}

export function emitModelsEvent() {
  window.dispatchEvent(new CustomEvent(MOD_EVT));
  window.dispatchEvent(new CustomEvent(GRP_EVT));
}

export function useModels() {
  const [models, setModels] = useState<StudioModel[]>([]);
  const [defaultId, setDefaultState] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const sync = async () => {
      await syncModelsBackend();
      setModels(cachedModels);
      setDefaultState(cachedDefaultId);
      setHydrated(true);
    };
    sync();
    window.addEventListener(MOD_EVT, sync);
    return () => window.removeEventListener(MOD_EVT, sync);
  }, []);

  const create = useCallback(
    async (draft: Omit<StudioModel, "id" | "createdAt">) => {
      const id = `mod.${Math.random().toString(36).slice(2, 8)}`;
      await fetchApi("/api/models", {
        method: "POST",
        body: JSON.stringify({ ...draft, id }),
      });
      await syncModelsBackend();
      setModels(cachedModels);
      emitModelsEvent();
      return id;
    },
    [],
  );

  const update = useCallback(
    async (id: string, patch: Partial<StudioModel>) => {
      await fetchApi(`/api/models/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await syncModelsBackend();
      setModels(cachedModels);
      emitModelsEvent();
    },
    [],
  );

  const remove = useCallback(
    async (id: string) => {
      await fetchApi(`/api/models/${id}`, { method: "DELETE" });
      await syncModelsBackend();
      setModels(cachedModels);
      emitModelsEvent();
    },
    [],
  );

  const setDefault = useCallback(
    async (id: string) => {
      await fetchApi("/api/models/default", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      await syncModelsBackend();
      setDefaultState(cachedDefaultId);
      emitModelsEvent();
    },
    [],
  );

  return { models, defaultId, hydrated, create, update, remove, setDefault };
}

/* ------------------------------------------------------------------ groups */

const ACTIVE_GROUP_KEY = "sovereign.models.group.active";

function readActiveGroup(): string {
  if (typeof window === "undefined") return "local";
  return window.localStorage.getItem(ACTIVE_GROUP_KEY) ?? "local";
}

export function useModelGroups() {
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [active, setActiveState] = useState<string>("local");

  useEffect(() => {
    const sync = async () => {
      await syncModelsBackend();
      setGroups(cachedGroups);
      
      const savedActive = readActiveGroup();
      if (cachedGroups.length > 0 && !cachedGroups.some(g => g.id === savedActive)) {
        if (cachedGroups && cachedGroups[0]) setActiveState(cachedGroups[0].id);
      } else {
        setActiveState(savedActive);
      }
    };
    sync();
    window.addEventListener(GRP_EVT, sync);
    return () => window.removeEventListener(GRP_EVT, sync);
  }, []);

  const setActive = useCallback((id: string) => {
    try {
      window.localStorage.setItem(ACTIVE_GROUP_KEY, id);
      window.dispatchEvent(new CustomEvent(GRP_EVT));
    } catch {
      /* ignore */
    }
    setActiveState(id);
  }, []);

  const addGroup = useCallback(
    async (name: string) => {
      const clean = name.trim() || "New group";
      const id = `${clean.toLowerCase().replace(/\s+/g, "-")}.${Math.random().toString(36).slice(2, 5)}`;
      await fetchApi("/api/models/groups", {
        method: "POST",
        body: JSON.stringify({
          id,
          name: clean,
          tone: modelGroupTones[cachedGroups.length % modelGroupTones.length] as string,
        }),
      });
      await syncModelsBackend();
      setGroups(cachedGroups);
      emitModelsEvent();
      return id;
    },
    [],
  );

  const renameGroup = useCallback(
    async (id: string, name: string) => {
      await fetchApi(`/api/models/groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await syncModelsBackend();
      setGroups(cachedGroups);
      emitModelsEvent();
    },
    [],
  );

  const removeGroup = useCallback(
    async (id: string) => {
      await fetchApi(`/api/models/groups/${id}`, { method: "DELETE" });
      await syncModelsBackend();
      setGroups(cachedGroups);
      emitModelsEvent();
    },
    [],
  );

  return { groups, active, setActive, addGroup, renameGroup, removeGroup };
}
