import { useCallback, useEffect, useState } from "react";

/**
 * Tool Control Panel state.
 *
 * The panel is a *view* over the Forge Factory registry: every definition in
 * the Forge shows up here as a callable tool. Nothing is ever deleted from the
 * registry through this panel — removing a tool only orphans it (hides it from
 * the panel). Permanent deletion stays in the Forge Factory.
 */

export type ToolConfig = {
  enabled: boolean;
  /** default value per parameter key, injected into runtime templates */
  defaults: Record<string, string>;
  systemPrompt: string;
  adapters: string[];
  targets: string[];
};

export type ToolPanelState = {
  orphans: string[];
  /** hidden from the orphan list — not a permanent delete, the Forge keeps the definition */
  dismissed: string[];
  configs: Record<string, Partial<ToolConfig>>;
};

const KEY = "elara.tool.panel.v1";
const EVT = "elara:tool-panel";

export const emptyToolConfig: ToolConfig = {
  enabled: true,
  defaults: {},
  systemPrompt: "",
  adapters: [],
  targets: [],
};

const emptyState: ToolPanelState = { orphans: [], dismissed: [], configs: {} };

function read(): ToolPanelState {
  if (typeof window === "undefined") return emptyState;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as ToolPanelState;
    return {
      orphans: parsed.orphans ?? [],
      dismissed: parsed.dismissed ?? [],
      configs: parsed.configs ?? {},
    };
  } catch {
    return emptyState;
  }
}

function write(state: ToolPanelState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

export function unorphanTool(id: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as ToolPanelState;
    if (parsed.orphans?.includes(id) || parsed.dismissed?.includes(id)) {
      parsed.orphans = (parsed.orphans || []).filter(x => x !== id);
      parsed.dismissed = (parsed.dismissed || []).filter(x => x !== id);
      window.localStorage.setItem(KEY, JSON.stringify(parsed));
      window.dispatchEvent(new CustomEvent(EVT));
    }
  } catch {
    /* ignore */
  }
}

export function useToolPanel() {
  const [state, setState] = useState<ToolPanelState>(emptyState);

  useEffect(() => {
    const sync = () => setState(read());
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);

  const mutate = useCallback((fn: (prev: ToolPanelState) => ToolPanelState) => {
    setState((prev) => {
      const next = fn(prev);
      write(next);
      return next;
    });
  }, []);

  /** Hide a tool from the panel — the Forge definition survives. */
  const orphan = useCallback(
    (id: string) => mutate((prev) => ({ ...prev, orphans: [...new Set([...prev.orphans, id])] })),
    [mutate],
  );

  const restore = useCallback(
    (id: string) =>
      mutate((prev) => ({
        ...prev,
        orphans: prev.orphans.filter((o) => o !== id),
        dismissed: prev.dismissed.filter((d) => d !== id),
      })),
    [mutate],
  );

  const restoreAll = useCallback(
    () => mutate((prev) => ({ ...prev, orphans: [], dismissed: [] })),
    [mutate],
  );

  /** Remove from the orphan list without touching the Forge definition. */
  const dismissOrphan = useCallback(
    (id: string) =>
      mutate((prev) => ({ ...prev, dismissed: [...new Set([...prev.dismissed, id])] })),
    [mutate],
  );

  const setConfig = useCallback(
    (id: string, patch: Partial<ToolConfig>) =>
      mutate((prev) => ({
        ...prev,
        configs: { ...prev.configs, [id]: { ...(prev.configs[id] ?? {}), ...patch } },
      })),
    [mutate],
  );

  const configOf = useCallback(
    (id: string): ToolConfig => ({ ...emptyToolConfig, ...(state.configs[id] ?? {}) }),
    [state.configs],
  );

  return {
    orphans: state.orphans,
    dismissed: state.dismissed,
    configOf,
    orphan,
    restore,
    restoreAll,
    dismissOrphan,
    setConfig,
  };
}
