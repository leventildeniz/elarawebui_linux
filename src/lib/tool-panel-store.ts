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
import { readDesk, writeDesk } from "@/lib/ownership";

export const emptyToolConfig: ToolConfig = {
  enabled: true,
  defaults: {},
  systemPrompt: "",
  adapters: [],
  targets: [],
};

const emptyState: ToolPanelState = { orphans: [], dismissed: [], configs: {} };

function read(): ToolPanelState {
  const parsed = readDesk<ToolPanelState>(KEY, emptyState);
  return {
    orphans: parsed?.orphans ?? [],
    dismissed: parsed?.dismissed ?? [],
    configs: parsed?.configs ?? {},
  };
}

function write(state: ToolPanelState) {
  writeDesk(KEY, state);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

export function unorphanTool(id: string) {
  if (typeof window === "undefined") return;
  const parsed = readDesk<ToolPanelState>(KEY, emptyState);
  if (parsed.orphans?.includes(id) || parsed.dismissed?.includes(id)) {
    parsed.orphans = (parsed.orphans || []).filter(x => x !== id);
    parsed.dismissed = (parsed.dismissed || []).filter(x => x !== id);
    writeDesk(KEY, parsed);
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

export function useToolPanel() {
  const [state, setState] = useState<ToolPanelState>(emptyState);

  useEffect(() => {
    const sync = () => setState(read());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("sovereign:identity", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("sovereign:identity", sync);
    };
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
