import { useCallback, useEffect, useState } from "react";
import type { JewelName } from "@/lib/avatar-library";

/**
 * Orchestration chains — graphs whose stages are whole workflows.
 * Each chain is a header tab in the Orchestration designer.
 */

export type StudioChain = OrchestrationPlan &
  Owned & {
    jewel: JewelName;
    createdAt: number;
    view?: { x: number; y: number; zoom: number };
  };

const KEY = "sovereign.chains";
const ACTIVE_KEY = "sovereign.chains.active";
const EVT = "sovereign:chains";
import { scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";
import { orchestrationPlans, type OrchestrationPlan } from "@/mocks/orchestrations";

const tones: JewelName[] = ["amethyst", "sapphire", "emerald", "topaz", "ruby", "platinum"];

export const seedChains: StudioChain[] = orchestrationPlans.map((p, i) => ({
  ...p,
  jewel: tones[i % tones.length]!,
  createdAt: Date.now() - i * 1000,
}));

function read(): StudioChain[] {
  if (typeof window === "undefined") return seedChains;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return seedChains;
    const parsed = JSON.parse(raw) as StudioChain[];
    return Array.isArray(parsed) && parsed.length ? parsed : seedChains;
  } catch {
    return seedChains;
  }
}

function write(list: StudioChain[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

function readActive(): string {
  if (typeof window === "undefined") return seedChains[0]!.id;
  return window.localStorage.getItem(ACTIVE_KEY) ?? seedChains[0]!.id;
}

export function useChains() {
  const [chains, setChains] = useState<StudioChain[]>(seedChains);
  const [activeId, setActiveIdState] = useState<string>(seedChains[0]!.id);

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const sync = () => {
      const list = read();
      setChains(list);
      const a = readActive();
      setActiveIdState(list.some((c) => c.id === a) ? a : (list[0]?.id ?? ""));
      setHydrated(true);
    };
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);

  const setActiveId = useCallback((id: string) => {
    try {
      window.localStorage.setItem(ACTIVE_KEY, id);
      window.dispatchEvent(new CustomEvent(EVT));
    } catch {
      /* ignore */
    }
    setActiveIdState(id);
  }, []);

  const ctx = useOwnerCtx();

  const create = useCallback(
    (name?: string) => {
      const list = read();
      const id = `orc_${Date.now().toString(36)}`;
      const next: StudioChain = {
        id,
        name: name?.trim() || `Chain ${list.length + 1}`,
        status: "draft",
        trigger: "Manual",
        runs: 0,
        nodes: [],
        edges: [],
        jewel: tones[list.length % tones.length]!,
        createdAt: Date.now(),
      };
      const all = [...list, stampOwner(next)];
      write(all);
      setChains(all);
      setActiveId(id);
      return id;
    },
    [setActiveId],
  );

  const update = useCallback((id: string, patch: Partial<StudioChain>) => {
    const next = read().map((c) => (c.id === id ? { ...c, ...patch } : c));
    write(next);
    setChains(next);
  }, []);

  const remove = useCallback(
    (id: string) => {
      const next = read().filter((c) => c.id !== id);
      write(next);
      setChains(next);
      if (readActive() === id) setActiveId(next[0]?.id ?? "");
    },
    [setActiveId],
  );

  const duplicate = useCallback(
    (id: string) => {
      const src = read().find((c) => c.id === id);
      if (!src) return;
      const copy: StudioChain = {
        ...src,
        id: `orc_${Date.now().toString(36)}`,
        name: `${src.name} (copy)`,
        status: "draft",
        runs: 0,
        createdAt: Date.now(),
      };
      const next = [...read(), copy];
      write(next);
      setChains(next);
      setActiveId(copy.id);
    },
    [setActiveId],
  );

  const visible = scopeOwned(chains, ctx);

  return {
    chains: visible,
    allChains: chains,
    ctx,
    hydrated,
    activeId,
    setActiveId,
    create,
    update,
    remove,
    duplicate,
  };
}
