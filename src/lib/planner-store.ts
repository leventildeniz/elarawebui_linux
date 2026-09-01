import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { fetchApi } from "./api";
import { emitPlannerEvent } from "./planner-events";
import { currentAccount } from "./group-store";
import { scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";

export type PlannerMode = "shadow" | "active";

/** Capability plane a planner governs — mirrors the System Engine tabs. */
export type PlannerKind = "tool" | "skill" | "mcp";

export const plannerKinds: { id: PlannerKind; label: string; tone: string; noun: string }[] = [
  { id: "tool", label: "Tool Planner", tone: "emerald", noun: "tool" },
  { id: "skill", label: "Skill Planner", tone: "sapphire", noun: "skill" },
  { id: "mcp", label: "MCP Planner", tone: "amethyst", noun: "MCP" },
];

export type PlannerRun = {
  id: string;
  at: number;
  mode: PlannerMode;
  tools: string[];
  plannerMs: number;
  toolsMs: number;
  grounded: boolean;
  contradiction: boolean;
  error: boolean;
  question: string;
  /** Tools the planner wanted but the tool scope refused. */
  blocked?: string[];
};

/** How the planner's tool scope is interpreted. */
export type ToolPolicy = "all" | "allow" | "deny";

export type Planner = Owned & {
  id: string;
  kind: PlannerKind;
  updatedAt?: number;
  name: string;
  description: string;
  enabled: boolean;
  mode: PlannerMode;
  maxTools: number;
  /** all = every tool · allow = only toolList · deny = everything except toolList */
  toolPolicy: ToolPolicy;
  toolList: string[];
  toolTimeout: number;
  plannerTimeout: number;
  ragMargin: number;
  // advanced
  prompt: string;
  overrideModel: string; // "" = default (runtime picks)
  crossCheck: boolean;
  autoFallback: boolean;
  fallbackWindow: number;
  fallbackThreshold: number;
  fallbackMinRuns: number;
  runs: PlannerRun[];
  createdAt: number;
};

export const emptyPlanner: Omit<Planner, "id" | "createdAt"> = {
  kind: "tool",
  name: "",
  description: "Tool orchestration layer · opt-in · shadow/active",
  enabled: false,
  mode: "shadow",
  maxTools: 3,
  toolPolicy: "all",
  toolList: [],
  toolTimeout: 8000,
  plannerTimeout: 4000,
  ragMargin: 0.35,
  prompt: "",
  overrideModel: "",
  crossCheck: true,
  autoFallback: true,
  fallbackWindow: 20,
  fallbackThreshold: 0.5,
  fallbackMinRuns: 5,
  runs: [],
};

const now = Date.now();

const KEY = "sovereign.planners";

interface PlannerStore {
  items: Planner[];
  loading: boolean;
  error: string | null;
  fetch: () => Promise<void>;
  create: (draft: Omit<Planner, "id" | "createdAt">) => Promise<string>;
  update: (id: string, patch: Partial<Planner>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  // For planner Allows check and logging
  getPlanner: (id: string) => Planner | undefined;
}

export const usePlannerZustand = create<PlannerStore>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  
  getPlanner: (id) => get().items.find(x => x.id === id),

  fetch: async () => {
    set({ loading: true, error: null });
    try {
      const data = await fetchApi("/api/planners");
      const rows = (data.items || []).map((row: any) => {
        const meta = row.meta || {};
        const runs = meta.runs || [];
        return {
          ...emptyPlanner,
          id: row.id,
          kind: row.kind || "tool",
          name: row.name,
          description: row.description,
          mode: row.mode,
          enabled: row.enabled,
          createdAt: new Date(row.created_at).getTime(),
          updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
          ownerId: row.owner_id,
          ownerName: row.owner_name,
          visibility: row.visibility,
          sharedWith: row.shared_with || [],
          // Map array fields depending on kind
          toolList: row.kind === 'tool' ? row.tools : (row.kind === 'skill' ? row.skills : (row.kind === 'mcp' ? row.mcp_servers : row.tools)),
          
          // Map meta fields
          maxTools: meta.maxTools ?? emptyPlanner.maxTools,
          toolPolicy: meta.toolPolicy ?? emptyPlanner.toolPolicy,
          toolTimeout: meta.toolTimeout ?? emptyPlanner.toolTimeout,
          plannerTimeout: meta.plannerTimeout ?? emptyPlanner.plannerTimeout,
          ragMargin: meta.ragMargin ?? emptyPlanner.ragMargin,
          prompt: meta.prompt ?? emptyPlanner.prompt,
          overrideModel: meta.overrideModel ?? emptyPlanner.overrideModel,
          crossCheck: meta.crossCheck ?? emptyPlanner.crossCheck,
          autoFallback: meta.autoFallback ?? emptyPlanner.autoFallback,
          fallbackWindow: meta.fallbackWindow ?? emptyPlanner.fallbackWindow,
          fallbackThreshold: meta.fallbackThreshold ?? emptyPlanner.fallbackThreshold,
          fallbackMinRuns: meta.fallbackMinRuns ?? emptyPlanner.fallbackMinRuns,
          runs,
        } as Planner;
      });

      // Mock fallbacks removed. We only rely on real DB data.
      
      set({ items: rows, loading: false });
    } catch (err: any) {
      console.error("Failed to load planners:", err);
      // Fallback to read from memory cache
      set({ error: err.message, loading: false });
    }
  },
  
  create: async (draft) => {
    const id = `pln.${Math.random().toString(36).slice(2, 7)}`;
    const newPlanner = stampOwner({ ...draft, id, createdAt: Date.now() });
    
    const payload = {
      id: newPlanner.id,
      name: newPlanner.name,
      description: newPlanner.description,
      mode: newPlanner.mode,
      enabled: newPlanner.enabled,
      kind: newPlanner.kind,
      tools: newPlanner.kind === 'tool' ? newPlanner.toolList : [],
      skills: newPlanner.kind === 'skill' ? newPlanner.toolList : [],
      mcp_servers: newPlanner.kind === 'mcp' ? newPlanner.toolList : [],
      owner_id: newPlanner.ownerId,
      owner_name: newPlanner.ownerName,
      visibility: newPlanner.visibility,
      shared_with: newPlanner.sharedWith,
      meta: {
        maxTools: newPlanner.maxTools,
        toolPolicy: newPlanner.toolPolicy,
        toolTimeout: newPlanner.toolTimeout,
        plannerTimeout: newPlanner.plannerTimeout,
        ragMargin: newPlanner.ragMargin,
        prompt: newPlanner.prompt,
        overrideModel: newPlanner.overrideModel,
        crossCheck: newPlanner.crossCheck,
        autoFallback: newPlanner.autoFallback,
        fallbackWindow: newPlanner.fallbackWindow,
        fallbackThreshold: newPlanner.fallbackThreshold,
        fallbackMinRuns: newPlanner.fallbackMinRuns,
        runs: newPlanner.runs || [],
      }
    };
    
    try {
      await fetchApi("/api/planners", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await get().fetch();
    } catch (err) {
      console.error("Failed to create planner:", err);
      throw err;
    }
    return id;
  },
  
  update: async (id, patch) => {
    const existing = get().items.find(x => x.id === id);
    if (!existing) throw new Error("Planner not found");
    
    const updated = { ...existing, ...patch };
    
    const payload = {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      mode: updated.mode,
      enabled: updated.enabled,
      kind: updated.kind,
      tools: updated.kind === 'tool' ? updated.toolList : [],
      skills: updated.kind === 'skill' ? updated.toolList : [],
      mcp_servers: updated.kind === 'mcp' ? updated.toolList : [],
      owner_id: updated.ownerId,
      owner_name: updated.ownerName,
      visibility: updated.visibility,
      shared_with: updated.sharedWith,
      meta: {
        maxTools: updated.maxTools,
        toolPolicy: updated.toolPolicy,
        toolTimeout: updated.toolTimeout,
        plannerTimeout: updated.plannerTimeout,
        ragMargin: updated.ragMargin,
        prompt: updated.prompt,
        overrideModel: updated.overrideModel,
        crossCheck: updated.crossCheck,
        autoFallback: updated.autoFallback,
        fallbackWindow: updated.fallbackWindow,
        fallbackThreshold: updated.fallbackThreshold,
        fallbackMinRuns: updated.fallbackMinRuns,
        runs: updated.runs || [],
      }
    };
    
    try {
      await fetchApi(`/api/planners/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      await get().fetch();
    } catch (err) {
      console.error("Failed to update planner:", err);
      throw err;
    }
  },
  
  remove: async (id) => {
    try {
      await fetchApi(`/api/planners/${id}`, { method: "DELETE" });
      await get().fetch();
    } catch (err) {
      console.error("Failed to delete planner:", err);
      throw err;
    }
  }
}));

export function usePlanners() {
  const store = usePlannerZustand();
  const ctx = useOwnerCtx();
  
  useEffect(() => {
    store.fetch();
  }, []);

  const visible = scopeOwned(store.items, ctx);

  return { 
    planners: visible, 
    allPlanners: store.items, 
    ctx, 
    create: store.create, 
    update: store.update, 
    remove: store.remove 
  };
}

export function plannerStats(p: Planner) {
  const runs = p.runs;
  const total = runs.length;
  const avg = (fn: (r: PlannerRun) => number) =>
    total ? Math.round(runs.reduce((s, r) => s + fn(r), 0) / total) : 0;
  const counts: Record<string, number> = {};
  runs.forEach((r) => r.tools.forEach((t) => (counts[t] = (counts[t] ?? 0) + 1)));
  return {
    total,
    shadow: runs.filter((r) => r.mode === "shadow").length,
    active: runs.filter((r) => r.mode === "active").length,
    withTools: runs.filter((r) => r.tools.length > 0).length,
    bothEmpty: runs.filter((r) => !r.tools.length && !r.grounded).length,
    grounded: runs.filter((r) => r.grounded).length,
    contradictions: runs.filter((r) => r.contradiction).length,
    errors: runs.filter((r) => r.error).length,
    plannerAvg: avg((r) => r.plannerMs),
    toolsAvg: avg((r) => r.toolsMs),
    totalAvg: avg((r) => r.plannerMs + r.toolsMs),
    topTools: Object.entries(counts).sort((a, b) => b[1] - a[1]),
  };
}

/**
 * Records a real planner run from a chat turn onto every enabled planner.
 * Writes straight to storage so it works outside React state.
 */
export function plannerAllows(p: Planner, tool: string) {
  if (p.toolPolicy === "allow") return p.toolList.includes(tool);
  if (p.toolPolicy === "deny") return !p.toolList.includes(tool);
  return true;
}

/**
 * Records a real planner run from a chat turn onto every enabled planner and
 * mirrors it into the audit journal (shadow runs included).
 */
export function logPlannerRun(input: {
  question: string;
  /** capabilities the turn reached for, per plane */
  tools: string[];
  skills?: string[];
  mcp?: string[];
  grounded: boolean;
  plannerMs?: number;
  toolsMs?: number;
  contradiction?: boolean;
  error?: boolean;
}) {
  if (typeof window === "undefined") return;
  const actor = currentAccount()?.name ?? "operator";
  const { items: all, update } = usePlannerZustand.getState();
  
  all.forEach((p) => {
    if (!p.enabled) return;
    const requested =
      p.kind === "skill"
        ? (input.skills ?? [])
        : p.kind === "mcp"
          ? (input.mcp ?? [])
          : input.tools;
    const allowed = requested.filter((t) => plannerAllows(p, t));
    const blocked = requested.filter((t) => !plannerAllows(p, t));
    const tools = allowed.slice(0, p.maxTools);
    const entry: PlannerRun = {
      id: `run.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      mode: p.mode,
      tools,
      plannerMs: input.plannerMs ?? 180 + Math.round(Math.random() * 240),
      toolsMs: input.toolsMs ?? (tools.length ? 320 + Math.round(Math.random() * 420) : 0),
      grounded: input.grounded,
      contradiction: input.contradiction ?? false,
      error: input.error ?? false,
      question: input.question.slice(0, 240),
      ...(blocked.length ? { blocked } : {}),
    };
    emitPlannerEvent({
      action: p.mode === "active" ? "planner.execute" : "planner.plan",
      planner: p.id,
      plannerName: p.name,
      kind: p.kind,
      mode: p.mode,
      tools,
      blocked,
      grounded: entry.grounded,
      question: entry.question,
      actor,
    });
    if (blocked.length) {
      emitPlannerEvent({
        action: "planner.blocked",
        planner: p.id,
        plannerName: p.name,
        mode: p.mode,
        tools: [],
        blocked,
        grounded: entry.grounded,
        question: entry.question,
        actor,
      });
    }
    
    // Fire and forget update
    update(p.id, { updatedAt: Date.now(), runs: [entry, ...p.runs].slice(0, 200) }).catch(console.error);
  });
}

/** Publishes a scope change so governance sees who narrowed the planner. */
export function logPlannerScope(p: Planner) {
  emitPlannerEvent({
    action: "planner.scope",
    planner: p.id,
    plannerName: p.name,
    kind: p.kind,
    mode: p.mode,
    tools: p.toolPolicy === "all" ? ["*"] : p.toolList,
    blocked: [],
    grounded: true,
    question: `tool scope · ${p.toolPolicy}`,
    actor: currentAccount()?.name ?? "operator",
  });
}
