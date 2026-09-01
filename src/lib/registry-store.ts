import { useCallback, useEffect, useState } from "react";
import { readCan } from "@/lib/rbac-store";
import { fetchApi } from "./api";

/**
 * Capability Registry — the dispatcher index.
 *
 * It does not own entities: agents come from the Agent Orchestrator (disk seed
 * roots), tools from the Forge Factory / Tool Panel, skills from the Skills
 * Engine and MCP tools from registered MCP clients. The registry only stores
 * discovery roots, per-row enablement and hard-deleted orphan rows.
 */

export type RegistryKind = "agent" | "skill" | "tool" | "mcp";

export type RegistryRoots = {
  agents: string[];
  tools: string[];
  skills: string[];
};

export type RegistryState = {
  roots: RegistryRoots;
  /** rows hidden from the chat dispatcher, by ref_id */
  disabled: string[];
  /** hard-deleted orphan rows, by ref_id */
  deleted: string[];
  lastScan: Record<string, number>;
};

export const EVT = "sovereign:registry";

let cachedState: RegistryState = {
  roots: { agents: [], tools: [], skills: [] },
  disabled: [],
  deleted: [],
  lastScan: {},
};

let isFetching = false;

export async function syncRegistryBackend() {
  if (isFetching) return;
  isFetching = true;
  try {
    const data = await fetchApi("/api/registry");
    if (data?.ok) {
      cachedState = {
        roots: data.roots || { agents: [], tools: [], skills: [] },
        disabled: data.disabled || [],
        deleted: data.deleted || [],
        lastScan: data.lastScan || {},
      };
    }
  } catch (e) {
    console.error("Failed to sync registry backend", e);
  } finally {
    isFetching = false;
  }
}

export function emitRegistryEvent() {
  window.dispatchEvent(new CustomEvent(EVT));
}

export const kindTone: Record<RegistryKind, string> = {
  agent: "sapphire",
  skill: "emerald",
  tool: "amethyst",
  mcp: "topaz",
};

export const kindPrefix: Record<RegistryKind, string> = {
  agent: "@",
  skill: "!",
  tool: "/",
  mcp: "#",
};

export const slugKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "-");
export const refKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9_]/g, "_");

export function useRegistry() {
  const [state, setState] = useState<RegistryState>(cachedState);

  useEffect(() => {
    const sync = async () => {
      await syncRegistryBackend();
      setState(cachedState);
    };
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);

  const patchState = async (patch: Partial<RegistryState>) => {
    const next = { ...cachedState, ...patch };
    // Optimistic update
    cachedState = next;
    setState(next);
    emitRegistryEvent();

    await fetchApi("/api/registry", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await syncRegistryBackend();
    setState(cachedState);
    emitRegistryEvent();
  };

  const addRoot = useCallback(
    async (kind: keyof RegistryRoots, path: string) => {
      if (!readCan("write")) return;
      const value = path.trim();
      if (!value) return;
      await patchState({
        roots: {
          ...cachedState.roots,
          [kind]: [...new Set([...cachedState.roots[kind], value])],
        },
      });
    },
    [],
  );

  const removeRoot = useCallback(
    async (kind: keyof RegistryRoots, path: string) => {
      if (!readCan("delete")) return;
      await patchState({
        roots: { ...cachedState.roots, [kind]: cachedState.roots[kind].filter((p) => p !== path) },
      });
    },
    [],
  );

  const updateRoot = useCallback(
    async (kind: keyof RegistryRoots, prev: string, next: string) => {
      if (!readCan("write")) return;
      const value = next.trim();
      if (!value) return;
      await patchState({
        roots: {
          ...cachedState.roots,
          [kind]: [...new Set(cachedState.roots[kind].map((p) => (p === prev ? value : p)))],
        },
      });
    },
    [],
  );

  const markScan = useCallback(
    async (kind: string) => {
      await patchState({ lastScan: { ...cachedState.lastScan, [kind]: Date.now() } });
    },
    [],
  );

  const toggleEnabled = useCallback(
    async (refId: string) => {
      const disabled = cachedState.disabled.includes(refId)
        ? cachedState.disabled.filter((r) => r !== refId)
        : [...cachedState.disabled, refId];
      await patchState({ disabled });
    },
    [],
  );

  const hardDelete = useCallback(
    async (refId: string) => {
      if (!readCan("delete")) return;
      await patchState({ deleted: [...new Set([...cachedState.deleted, refId])] });
    },
    [],
  );

  const restoreAll = useCallback(async () => {
    if (!readCan("delete")) return;
    await patchState({ deleted: [] });
  }, []);

  return {
    roots: state.roots,
    disabled: state.disabled,
    deleted: state.deleted,
    lastScan: state.lastScan,
    addRoot,
    removeRoot,
    updateRoot,
    markScan,
    toggleEnabled,
    hardDelete,
    restoreAll,
  };
}