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
import { readDesk, writeDesk, readDeskRaw, writeDeskRaw, scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";
import { orchestrationPlans, type OrchestrationPlan } from "@/types/workflow";
import { fetchApi } from "@/lib/api";

const tones: JewelName[] = ["amethyst", "sapphire", "emerald", "topaz", "ruby", "platinum"];

export const seedChains: StudioChain[] = orchestrationPlans.map((p, i) => ({
  ...p,
  jewel: tones[i % tones.length]!,
  createdAt: Date.now() - i * 1000,
}));

function read(): StudioChain[] {
  return readDesk<StudioChain[]>(KEY, seedChains);
}

function write(list: StudioChain[]) {
  writeDesk(KEY, list);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

function readActive(): string {
  const active = readDeskRaw(ACTIVE_KEY);
  return active ?? (seedChains[0]?.id ?? "");
}

export function useChains() {
  const [chains, setChains] = useState<StudioChain[]>(read);
  const [activeId, setActiveIdState] = useState<string>(readActive);

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const sync = async () => {
      try {
        const data = await fetchApi("/api/chains");
        if (data && Array.isArray(data)) {
          const mapped = data.map((c: any) => ({
            id: c.id,
            name: typeof c.name === "string" ? c.name : (typeof c.name === "object" && c.name ? JSON.stringify(c.name) : String(c.id || "Orchestration")),
            status: c.graph?.status || "draft",
            trigger: typeof c.graph?.trigger === "string" ? c.graph.trigger : (typeof c.graph?.trigger === "object" && c.graph?.trigger ? JSON.stringify(c.graph.trigger) : "Manual"),
            runs: Number(c.graph?.runs || 0),
            nodes: (Array.isArray(c.graph?.nodes) ? c.graph.nodes : []).map((n: any) => ({
              id: String(n.id || `n_${Math.random().toString(36).slice(2, 6)}`),
              kind: String(n.kind || "action"),
              label: typeof n.label === "string" ? n.label : (typeof n.name === "string" ? n.name : (typeof n.label === "object" && n.label ? JSON.stringify(n.label) : String(n.id || "stage"))),
              meta: typeof n.meta === "string" ? n.meta : (typeof n.meta === "object" && n.meta ? JSON.stringify(n.meta) : (typeof n.meta === "number" || typeof n.meta === "boolean" ? String(n.meta) : "")),
              x: typeof n.x === "number" ? n.x : 100,
              y: typeof n.y === "number" ? n.y : 100,
              ...(n.data ? { data: n.data } : {}),
              ...(n.config ? { config: n.config } : {}),
              ...(n.params ? { params: n.params } : {}),
              ...(n.bindings ? { bindings: n.bindings } : {}),
              ...(n.actionId ? { actionId: n.actionId } : {}),
            })),
            edges: (Array.isArray(c.graph?.edges) ? c.graph.edges : []).map((e: any, idx: number) => ({
              id: String(e.id || `e_${idx}`),
              from: String(e.from || e.source || ""),
              to: String(e.to || e.target || ""),
              branch: typeof e.branch === "string" ? e.branch : "default",
            })),
            jewel: c.graph?.color || "sapphire",
            ownerId: c.owner_id || c.ownerId,
            ownerName: c.owner_name || c.ownerName,
            visibility: c.visibility || "private",
            sharedWith: typeof c.shared_with === "string" ? JSON.parse(c.shared_with) : (c.shared_with || []),
            createdAt: new Date(c.updated_at).getTime(),
          }));
          if (mapped.length > 0) {
            setChains(mapped);
            writeDesk(KEY, mapped);
            window.dispatchEvent(new CustomEvent(EVT));
            const a = readActive();
            setActiveIdState(mapped.some((m: any) => m.id === a) ? a : (mapped[0]?.id ?? ""));
            setHydrated(true);
            return;
          }
        }
      } catch (err) {
        console.error("Failed to fetch chains from API", err);
      }

      setChains([]);
      setActiveIdState("");
      setHydrated(true);
    };
    sync();

    const onEvt = () => {
      const list = read();
      setChains(list);
      const a = readActive();
      setActiveIdState(list.some((c) => c.id === a) ? a : (list[0]?.id ?? ""));
    };

    window.addEventListener(EVT, onEvt);
    window.addEventListener("sovereign:identity", sync);
    return () => {
      window.removeEventListener(EVT, onEvt);
      window.removeEventListener("sovereign:identity", sync);
    };
  }, []);

  const setActiveId = useCallback((id: string) => {
    writeDeskRaw(ACTIVE_KEY, id);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(EVT));
    }
    setActiveIdState(id);
  }, []);

  const ctx = useOwnerCtx();

  const create = useCallback(
    async (name?: string) => {
      const list = read();
      
      let finalName = name?.trim();
      if (!finalName) {
        let counter = list.length + 1;
        finalName = `Chain ${counter}`;
        while (list.some((w) => w.name.toLowerCase() === finalName!.toLowerCase())) {
          counter++;
          finalName = `Chain ${counter}`;
        }
      } else {
        if (list.some((w) => w.name.toLowerCase() === finalName!.toLowerCase())) {
           return null;
        }
      }

      const id = `orc_${Date.now().toString(36)}`;
      const next: StudioChain = {
        id,
        name: finalName,
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

      try {
        await fetchApi("/api/chains", {
          method: "POST",
          body: JSON.stringify({
            id: next.id,
            name: next.name,
            status: next.status,
            trigger: next.trigger,
            runs: next.runs,
            nodes: next.nodes,
            edges: next.edges,
            color: next.jewel,
            visibility: next.visibility,
            shared_with: next.sharedWith,
            ownerId: next.ownerId,
            ownerName: next.ownerName,
          }),
        });
      } catch (e) {
        console.error("Failed to create orchestration API record", e);
      }

      return id;
    },
    [setActiveId],
  );

  const update = useCallback(async (id: string, patch: Partial<StudioChain>) => {
    const list = read();
    
    if (patch.name) {
      const cleanName = patch.name.trim();
      if (!cleanName) return; // Prevent empty names
      const clash = list.find((c) => c.id !== id && c.name.toLowerCase() === cleanName.toLowerCase());
      if (clash) return; // Name exists
      patch.name = cleanName;
    }

    let nextChain: any = null;
    const next = list.map((c) => {
      if (c.id === id) {
        nextChain = { ...c, ...patch };
        return nextChain as StudioChain;
      }
      return c;
    });
    write(next);
    setChains(next);

    if (nextChain) {
      try {
        await fetchApi("/api/chains", {
          method: "POST",
          body: JSON.stringify({
            id: nextChain.id,
            name: nextChain.name,
            status: nextChain.status,
            trigger: nextChain.trigger,
            runs: nextChain.runs,
            nodes: nextChain.nodes,
            edges: nextChain.edges,
            color: nextChain.jewel,
            visibility: nextChain.visibility,
            shared_with: nextChain.sharedWith,
            ownerId: nextChain.ownerId,
            ownerName: nextChain.ownerName,
          }),
        });
      } catch (e) {
        console.error("Failed to update orchestration API record", e);
      }
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      const next = read().filter((c) => c.id !== id);
      write(next);
      setChains(next);
      if (readActive() === id) setActiveId(next[0]?.id ?? "");

      try {
        await fetchApi(`/api/chains/${id}`, { method: "DELETE" });
      } catch (e) {
        console.error("Failed to delete orchestration API record", e);
      }
    },
    [setActiveId],
  );

  const duplicate = useCallback(
    async (id: string) => {
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

      try {
        await fetchApi("/api/chains", {
          method: "POST",
          body: JSON.stringify({
            id: copy.id,
            name: copy.name,
            status: copy.status,
            trigger: copy.trigger,
            runs: copy.runs,
            nodes: copy.nodes,
            edges: copy.edges,
            color: copy.jewel,
            visibility: copy.visibility,
            shared_with: copy.sharedWith,
            ownerId: copy.ownerId,
            ownerName: copy.ownerName,
          }),
        });
      } catch (e) {
        console.error("Failed to duplicate orchestration API record", e);
      }
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
