import { useCallback, useEffect, useState } from "react";
import type { JewelName } from "@/lib/avatar-library";

/**
 * Workflow registry — each workflow is a top tab in the Workflow Designer.
 * Creating a workflow creates its tab; tabs can be renamed, recoloured and deleted.
 */

export type GraphView = { x: number; y: number; zoom: number };

export type StudioWorkflow = WorkflowDraft &
  Owned & {
    jewel: JewelName;
    createdAt: number;
    view?: GraphView;
  };

const KEY = "sovereign.workflows";
const ACTIVE_KEY = "sovereign.workflows.active";
const EVT = "sovereign:workflows";
import { readDesk, writeDesk, readDeskRaw, writeDeskRaw, scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";
import { workflowDrafts, type WorkflowDraft } from "@/mocks/workflows";
import { fetchApi } from "@/lib/api";
import { confirmAction } from "@/components/sovereign/confirm-dialog";

const seedTones: JewelName[] = ["sapphire", "emerald", "amethyst", "topaz", "ruby", "platinum"];

export const seedWorkflows: StudioWorkflow[] = workflowDrafts.map((d, i) => ({
  ...d,
  jewel: seedTones[i % seedTones.length]!,
  createdAt: Date.now() - i * 1000,
}));

function read(): StudioWorkflow[] {
  return readDesk<StudioWorkflow[]>(KEY, seedWorkflows);
}

function write(list: StudioWorkflow[]) {
  writeDesk(KEY, list);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

function readActive(): string {
  const active = readDeskRaw(ACTIVE_KEY);
  return active ?? (seedWorkflows[0]?.id ?? "");
}

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<StudioWorkflow[]>(read);
  const [activeId, setActiveIdState] = useState<string>(readActive);

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let activeWfs = seedWorkflows;
    const sync = async () => {
      try {
        const data = await fetchApi("/api/workflows");
        if (data && Array.isArray(data)) {
          const mapped = data.map((w: any) => ({
            id: w.id,
            name: typeof w.name === "string" ? w.name : (typeof w.name === "object" && w.name ? JSON.stringify(w.name) : String(w.id || "Workflow")),
            status: w.graph?.status || "draft",
            trigger: typeof w.graph?.trigger === "string" ? w.graph.trigger : (typeof w.graph?.trigger === "object" && w.graph?.trigger ? JSON.stringify(w.graph.trigger) : "Manual"),
            runs: Number(w.graph?.runs || 0),
            nodes: (Array.isArray(w.graph?.nodes) ? w.graph.nodes : []).map((n: any) => ({
              id: String(n.id || `n_${Math.random().toString(36).slice(2, 6)}`),
              kind: String(n.kind || "action"),
              label: typeof n.label === "string" ? n.label : (typeof n.name === "string" ? n.name : (typeof n.label === "object" && n.label ? JSON.stringify(n.label) : String(n.id || "node"))),
              meta: typeof n.meta === "string" ? n.meta : (typeof n.meta === "object" && n.meta ? JSON.stringify(n.meta) : (typeof n.meta === "number" || typeof n.meta === "boolean" ? String(n.meta) : "")),
              x: typeof n.x === "number" ? n.x : 100,
              y: typeof n.y === "number" ? n.y : 100,
              ...(n.data ? { data: n.data } : {}),
              ...(n.config ? { config: n.config } : {}),
              ...(n.params ? { params: n.params } : {}),
              ...(n.bindings ? { bindings: n.bindings } : {}),
              ...(n.actionId ? { actionId: n.actionId } : {}),
            })),
            edges: (Array.isArray(w.graph?.edges) ? w.graph.edges : []).map((e: any, idx: number) => ({
              id: String(e.id || `e_${idx}`),
              from: String(e.from || e.source || ""),
              to: String(e.to || e.target || ""),
              branch: typeof e.branch === "string" ? e.branch : "default",
            })),
            jewel: w.graph?.color || "sapphire",
            ownerId: w.owner_id || w.ownerId,
            ownerName: w.owner_name || w.ownerName,
            visibility: w.visibility || "private",
            sharedWith: typeof w.shared_with === "string" ? JSON.parse(w.shared_with) : (w.shared_with || []),
            createdAt: new Date(w.updated_at).getTime(),
          }));
          if (mapped.length > 0) {
            setWorkflows(mapped);
            writeDesk(KEY, mapped);
            window.dispatchEvent(new CustomEvent(EVT));
            activeWfs = mapped;
            const a = readActive();
            setActiveIdState(mapped.some((m: any) => m.id === a) ? a : (mapped[0]?.id ?? ""));
            setHydrated(true);
            return;
          }
        }
      } catch (err) {
        console.error("Failed to fetch workflows from API", err);
      }

      setWorkflows([]);
      setActiveIdState("");
      setHydrated(true);
    };
    sync();
    
    const onEvt = () => {
      const list = read();
      setWorkflows(list);
      const a = readActive();
      setActiveIdState(list.some((w) => w.id === a) ? a : (list[0]?.id ?? ""));
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
        finalName = `Workflow ${counter}`;
        while (list.some((w) => w.name.toLowerCase() === finalName!.toLowerCase())) {
          counter++;
          finalName = `Workflow ${counter}`;
        }
      } else {
        if (list.some((w) => w.name.toLowerCase() === finalName!.toLowerCase())) {
           // Prevent duplicate manual names (return null to signal failure)
           return null;
        }
      }

      const id = `wf_${Date.now().toString(36)}`;
      const next: StudioWorkflow = {
        id,
        name: finalName,
        status: "draft",
        trigger: "Manual",
        runs: 0,
        nodes: [],
        edges: [],
        jewel: seedTones[list.length % seedTones.length]!,
        createdAt: Date.now(),
      };
      
      const all = [...list, stampOwner(next)];
      write(all);
      setWorkflows(all);
      setActiveId(id);

      try {
        await fetchApi("/api/workflows", {
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
        console.error("Failed to create workflow API record", e);
      }

      return id;
    },
    [setActiveId],
  );

  const update = useCallback(async (id: string, patch: Partial<StudioWorkflow>) => {
    const list = read();
    
    if (patch.name) {
      const cleanName = patch.name.trim();
      if (!cleanName) return; // Prevent empty names
      const clash = list.find((w) => w.id !== id && w.name.toLowerCase() === cleanName.toLowerCase());
      if (clash) {
        // Name already exists, reject update
        return;
      }
      patch.name = cleanName;
    }

    let nextWf: any = null;
    const next = list.map((w) => {
      if (w.id === id) {
        nextWf = { ...w, ...patch };
        return nextWf as StudioWorkflow;
      }
      return w;
    });
    write(next);
    setWorkflows(next);

    if (nextWf) {
      try {
        await fetchApi("/api/workflows", {
          method: "POST",
          body: JSON.stringify({
            id: nextWf.id,
            name: nextWf.name,
            status: nextWf.status,
            trigger: nextWf.trigger,
            runs: nextWf.runs,
            nodes: nextWf.nodes,
            edges: nextWf.edges,
            color: nextWf.jewel,
            visibility: nextWf.visibility,
            shared_with: nextWf.sharedWith,
            ownerId: nextWf.ownerId,
            ownerName: nextWf.ownerName,
          }),
        });
      } catch (e) {
        console.error("Failed to update workflow API record", e);
      }
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      try {
        await fetchApi(`/api/workflows/${id}`, { method: "DELETE" });
        const next = read().filter((w) => w.id !== id);
        write(next);
        setWorkflows(next);
        if (readActive() === id) setActiveId(next[0]?.id ?? "");
        return true;
      } catch (e: any) {
        console.error("Failed to delete workflow API record", e);
        const errMsg = e?.data?.error || e?.message || "Failed to delete workflow.";
        await confirmAction({
          title: "Workflow In Use — Cannot Delete",
          body: errMsg,
          confirmLabel: "Understood",
          cancelLabel: "Close",
          tone: "ruby",
        });
        return false;
      }
    },
    [setActiveId],
  );

  const duplicate = useCallback(
    async (id: string) => {
      const src = read().find((w) => w.id === id);
      if (!src) return;
      const copy: StudioWorkflow = {
        ...src,
        id: `wf_${Date.now().toString(36)}`,
        name: `${src.name} (copy)`,
        status: "draft",
        runs: 0,
        createdAt: Date.now(),
      };
      const next = [...read(), copy];
      write(next);
      setWorkflows(next);
      setActiveId(copy.id);

      try {
        await fetchApi("/api/workflows", {
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
        console.error("Failed to duplicate workflow API record", e);
      }
    },
    [setActiveId],
  );

  const visible = scopeOwned(workflows, ctx);

  return {
    workflows: visible,
    allWorkflows: workflows,
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
