import { useCallback, useEffect, useState } from "react";
import {
  canEdit,
  readOwnerCtx,
  scopeOwned,
  stampOwner,
  useOwnerCtx,
  type Owned,
} from "@/lib/ownership";
import { unorphanTool } from "@/lib/tool-panel-store";
import type { JewelName } from "@/lib/avatar-library";

/**
 * Elara Sovereign Studio — Forge Factory registry.
 * Every entry is a definition the fleet can call: a trigger, an action,
 * a logic gate or an output sink. The header tab you author it in decides
 * its kind automatically.
 */

export type ForgeKind = "trigger" | "action" | "logic" | "output";
export type ForgeHandler = "builtin" | "http" | "python" | "noop";
export type ForgeTempOverride = "off" | "zero" | "safe-low" | "custom";
export type ForgeOutputFormat = "raw" | "markdown" | "json" | "csv";

import type { Visibility } from "@/lib/ownership";

export type ForgeParam = {
  id: string;
  key: string;
  label: string;
  type: string;
  value: string;
};

export type ForgeOutput = { id: string; key: string; label: string };
export type ForgeCustomParam = { id: string; key: string; value: string };

export type ForgeItem = {
  id: string;
  kind: ForgeKind;
  name: string;
  category: string;
  provider: string;
  icon: string;
  jewel: JewelName;
  priority: number;
  description: string;
  system: boolean;
  visibility: Visibility;
  sharedWith: string[];
  params: ForgeParam[];
  outputs: ForgeOutput[];
  brainModelId: string;
  interpreterId: string;
  handler: ForgeHandler;
  scriptPath: string;
  adapters: string[];
  targets: string[];
  enforceStrict: boolean;
  tempOverride: ForgeTempOverride;
  tempCustom: number;
  topPOverride: boolean;
  topP: number;
  retryCount: number;
  timeoutMs: number;
  outputFormat: ForgeOutputFormat;
  customParams: ForgeCustomParam[];
  createdAt: number;
} & Owned;

export const forgeKinds: { id: ForgeKind; label: string; tone: string }[] = [
  { id: "trigger", label: "Trigger", tone: "emerald" },
  { id: "action", label: "Action", tone: "sapphire" },
  { id: "logic", label: "Logic", tone: "amethyst" },
  { id: "output", label: "Output", tone: "topaz" },
];

export const forgeHandlers: { id: ForgeHandler; label: string }[] = [
  { id: "builtin", label: "builtin (server op)" },
  { id: "http", label: "http (external)" },
  { id: "python", label: "python (local script)" },
  { id: "noop", label: "noop (test)" },
];

export const forgeParamTypes = ["string", "number", "boolean", "json", "ctxRef", "secret"];

export const forgeOutputFormats: { id: ForgeOutputFormat; label: string }[] = [
  { id: "raw", label: "Raw (no enforcement)" },
  { id: "markdown", label: "Markdown table" },
  { id: "json", label: "JSON (structured-output)" },
  { id: "csv", label: "CSV" },
];

export const forgeAdapterCatalog: string[] = [];
export const forgeTargetCatalog: string[] = [];

export const emptyForgeItem: Omit<ForgeItem, "id" | "createdAt"> = {
  kind: "action",
  name: "",
  category: "Common",
  provider: "",
  icon: "Sparkles",
  jewel: "sapphire",
  priority: 5,
  description: "",
  system: false,
  visibility: "workspace",
  sharedWith: [],
  params: [],
  outputs: [],
  brainModelId: "",
  interpreterId: "",
  handler: "builtin",
  scriptPath: "",
  adapters: [],
  targets: [],
  enforceStrict: true,
  tempOverride: "zero",
  tempCustom: 0.2,
  topPOverride: false,
  topP: 0.9,
  retryCount: 2,
  timeoutMs: 30000,
  outputFormat: "raw",
  customParams: [],
};

function item(partial: Partial<ForgeItem> & Pick<ForgeItem, "id" | "name">): ForgeItem {
  return { ...emptyForgeItem, createdAt: Date.now(), ...partial } as ForgeItem;
}

export const seedForgeItems: ForgeItem[] = [];

import { fetchApi } from "@/lib/api";

const KEY = "sovereign.forge";
const EVT = "sovereign:forge";
const KIND_KEY = "sovereign.forge.kind";

function read(): ForgeItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ForgeItem[];
    if (!Array.isArray(parsed) || !parsed.length) return [];
    return parsed.map((i) => ({ ...emptyForgeItem, ...i }));
  } catch {
    return [];
  }
}

function write(list: ForgeItem[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

/** Registry of forge definitions. */
export function useForge() {
  const ctx = useOwnerCtx();
  const [items, setItems] = useState<ForgeItem[]>(seedForgeItems);

  const [hydrated, setHydrated] = useState(false);

  const sync = useCallback(async () => {
    try {
      const data = await fetchApi("/api/forge/actions");
      if (Array.isArray(data)) {
        // Map backend snake_case to frontend camelCase
        const mapped = data.map((i: any) => ({
          ...emptyForgeItem,
          id: i.id,
          kind: i.kind,
          name: i.name,
          category: i.category || "Common",
          provider: i.provider || "",
          icon: i.icon || "Sparkles",
          jewel: i.jewel || "sapphire",
          priority: i.priority || 5,
          description: i.description || "",
          system: !!i.system,
          params: typeof i.params === 'string' ? JSON.parse(i.params) : (i.params || []),
          outputs: typeof i.outputs === 'string' ? JSON.parse(i.outputs) : (i.outputs || []),
          brainModelId: i.brain_model_id || "",
          interpreterId: i.interpreter_id || "",
          handler: i.handler || "builtin",
          scriptPath: i.script_path || "",
          adapters: typeof i.adapters === 'string' ? JSON.parse(i.adapters) : (i.adapters || []),
          targets: typeof i.targets === 'string' ? JSON.parse(i.targets) : (i.targets || []),
          enforceStrict: !!i.enforce_strict,
          tempOverride: i.temp_override || "off",
          tempCustom: i.temp_custom,
          topPOverride: !!i.top_p_override,
          topP: i.top_p,
          retryCount: i.retry_count || 0,
          timeoutMs: i.timeout_ms || 30000,
          outputFormat: i.output_format || "raw",
          customParams: typeof i.custom_params === 'string' ? JSON.parse(i.custom_params) : (i.custom_params || []),
          visibility: i.visibility || "workspace",
          sharedWith: typeof i.shared_with === 'string' ? JSON.parse(i.shared_with) : (i.shared_with || []),
          createdAt: new Date(i.created_at || Date.now()).getTime(),
          ownerId: i.owner_id
        }));
        setItems(mapped);
      } else {
        setItems([]);
      }
    } catch (e) {
      console.error("Failed to load forge items", e);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [sync]);

  const create = useCallback(async (draft: ForgeItem | Omit<ForgeItem, "id" | "createdAt">) => {
    // If draft already has a valid ID from the UI (like 'tool.denemetool'), keep it. Otherwise, generate a random one.
    const hasValidId = 'id' in draft && typeof draft.id === 'string' && draft.id.trim() !== "";
    const id = hasValidId ? draft.id : `forge.${Math.random().toString(36).slice(2, 8)}`;

    const newItem = stampOwner({ ...draft, id, createdAt: Date.now() }, "workspace");
    try {
      await fetchApi("/api/forge/actions", {
        method: "POST",
        body: JSON.stringify({
          ...newItem,
          brain_model_id: newItem.brainModelId,
          interpreter_id: newItem.interpreterId,
          script_path: newItem.scriptPath,
          enforce_strict: newItem.enforceStrict,
          temp_override: newItem.tempOverride,
          temp_custom: newItem.tempCustom,
          top_p_override: newItem.topPOverride,
          top_p: newItem.topP,
          retry_count: newItem.retryCount,
          timeout_ms: newItem.timeoutMs,
          output_format: newItem.outputFormat,
          custom_params: newItem.customParams,
          visibility: newItem.visibility,
          shared_with: newItem.sharedWith
        })
      });
      unorphanTool(id);
      setItems((prev) => [...prev, newItem]);
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error("Failed to create forge item", err);
    }
    return id;
  }, []);

  const update = useCallback(async (id: string, patch: Partial<ForgeItem>) => {
    try {
      // In this version, we assume PUT /api/forge/actions/:id exists or we just re-POST
      const patched = { ...patch };
      // Map frontend camelCase to backend snake_case
      if ('brainModelId' in patched) (patched as any).brain_model_id = patched.brainModelId;
      if ('interpreterId' in patched) (patched as any).interpreter_id = patched.interpreterId;
      if ('scriptPath' in patched) (patched as any).script_path = patched.scriptPath;
      if ('enforceStrict' in patched) (patched as any).enforce_strict = patched.enforceStrict;
      if ('tempOverride' in patched) (patched as any).temp_override = patched.tempOverride;
      if ('tempCustom' in patched) (patched as any).temp_custom = patched.tempCustom;
      if ('topPOverride' in patched) (patched as any).top_p_override = patched.topPOverride;
      if ('topP' in patched) (patched as any).top_p = patched.topP;
      if ('retryCount' in patched) (patched as any).retry_count = patched.retryCount;
      if ('timeoutMs' in patched) (patched as any).timeout_ms = patched.timeoutMs;
      if ('outputFormat' in patched) (patched as any).output_format = patched.outputFormat;
      if ('customParams' in patched) (patched as any).custom_params = patched.customParams;
      if ('sharedWith' in patched) (patched as any).shared_with = patched.sharedWith;

      await fetchApi(`/api/forge/actions`, {
        method: "POST", // The backend uses UPSERT on POST
        body: JSON.stringify({ ...patched, id })
      });
      unorphanTool(id);
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error("Failed to update forge item", err);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await fetchApi(`/api/forge/actions/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((s) => s.id !== id));
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error("Failed to remove forge item", err);
    }
  }, []);

  /* Desk scope: your forge blocks + org/system blocks. */
  const visible = scopeOwned(items, ctx);
  return { items: visible, allItems: items, ctx, create, update, remove };
}

/** Active kind tab — shared between the header tabs and the workspace. */
export function useForgeKind() {
  const [kind, setKindState] = useState<ForgeKind | "all">("all");

  useEffect(() => {
    const sync = () => {
      const raw = window.localStorage.getItem(KIND_KEY) as ForgeKind | "all" | null;
      setKindState(raw ?? "all");
    };
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);

  const setKind = useCallback((next: ForgeKind | "all") => {
    try {
      window.localStorage.setItem(KIND_KEY, next);
      window.dispatchEvent(new CustomEvent(EVT));
    } catch {
      /* ignore */
    }
    setKindState(next);
  }, []);

  return { kind, setKind };
}
