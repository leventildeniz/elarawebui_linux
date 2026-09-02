import { useCallback, useEffect, useState } from "react";

/**
 * Meta-Forge plans — every proposal the system forged for itself,
 * with its actions (what it would create) and a rollback ledger.
 */

export type ForgeActionKind = "tool" | "skill" | "agent" | "pack" | "model" | "mcp";

export type ForgeAction = {
  kind: ForgeActionKind;
  name: string;
};

export type TrashedArtifact = {
  fileName: string;
  kind: "tool" | "agent" | string;
  slug: string;
  trashedAt: number;
  sizeBytes: number;
  description?: string;
};

export type ForgePlanStatus = "pending" | "applied" | "rejected" | "rolled_back";

export type ForgePlan = {
  id: string;
  prompt: string;
  actor: string;
  createdAt: number;
  status: ForgePlanStatus;
  actions: ForgeAction[];
  /** Set when a plan is rolled back after being applied. */
  rolledBackAt?: number | undefined;
  note?: string;
};

const KEY = "sovereign.forge.plans";
const EVT = "sovereign:forge-plans";

const H = 3600_000;
/** Fixed anchor so SSR and client render identical timestamps. */
const now = Date.UTC(2026, 7, 18, 0, 0, 0);

export const seedForgePlans: ForgePlan[] = [
  {
    id: "mf_0x21",
    prompt:
      "The operator is informing the orchestrator about their custom 'AI OS' and intends to grant broader permissions over time; no specific capability was requested, but the system should prepare for OS-level integration.",
    actor: "admin",
    createdAt: now - 0.4 * H,
    status: "pending",
    actions: [{ kind: "skill", name: "ai-os-integration-awareness" }],
  },
  {
    id: "mf_0x20",
    prompt: "Create capabilities to enable and manage MCP server and client connectivity.",
    actor: "admin",
    createdAt: now - 1.2 * H,
    status: "pending",
    actions: [
      { kind: "tool", name: "mcp-connection-manager" },
      { kind: "skill", name: "mcp-orchestration-logic" },
      { kind: "agent", name: "mcp-bridge-agent" },
      { kind: "pack", name: "mcp-connectivity-pack" },
    ],
  },
  {
    id: "mf_0x1f",
    prompt:
      "Enable the orchestrator to autonomously create and execute its own agents, tools and skills.",
    actor: "admin",
    createdAt: now - 2.1 * H,
    status: "pending",
    actions: [
      { kind: "skill", name: "self-evolution-logic" },
      { kind: "tool", name: "capability-manager" },
      { kind: "agent", name: "meta-architect" },
      { kind: "pack", name: "self-evolution-kit" },
    ],
  },
  {
    id: "mf_0x1e",
    prompt:
      "Create a comprehensive phishing triage capability including IOC extraction, analysis guidelines and an orchestrating agent.",
    actor: "admin",
    createdAt: now - 9 * H,
    status: "applied",
    actions: [
      { kind: "tool", name: "ioc-extractor" },
      { kind: "skill", name: "phishing-analysis-playbook" },
      { kind: "agent", name: "phishing-triage-agent" },
      { kind: "pack", name: "soc-phishing-kit" },
    ],
  },
  {
    id: "mf_0x1d",
    prompt: "Create a triage skill for analyzing and categorizing phishing attempts.",
    actor: "admin",
    createdAt: now - 14 * H,
    status: "applied",
    actions: [{ kind: "skill", name: "phishing-triage" }],
  },
  {
    id: "mf_0x1c",
    prompt:
      "Create a comprehensive DNS lookup tool called dns-lookup-plus for advanced domain analysis.",
    actor: "admin",
    createdAt: now - 26 * H,
    status: "rolled_back",
    rolledBackAt: now - 20 * H,
    actions: [
      { kind: "tool", name: "dns-lookup-plus" },
      { kind: "skill", name: "dns-analysis-expert" },
      { kind: "agent", name: "dns-investigator" },
    ],
  },
  {
    id: "mf_0x1b",
    prompt: "Swap the embedding model for the sovereign in-house encoder.",
    actor: "admin",
    createdAt: now - 40 * H,
    status: "rejected",
    actions: [{ kind: "model", name: "sovereign-encoder-v2" }],
  },
];

function read(): ForgePlan[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ForgePlan[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

import { fetchApi } from "./api";

export function useForgePlans() {
  const [plans, setPlans] = useState<ForgePlan[]>([]);
  const [trash, setTrash] = useState<TrashedArtifact[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const fetchTrash = useCallback(async () => {
    try {
      const res = await fetchApi("/api/meta-forge/trash");
      if (res && Array.isArray(res.items)) {
        setTrash(res.items);
      }
    } catch (err) {
      console.error("Failed to fetch trash artifacts", err);
    }
  }, []);

  const restoreTrash = useCallback(
    async (fileName: string) => {
      try {
        await fetchApi(`/api/meta-forge/trash/${encodeURIComponent(fileName)}/restore`, { method: "POST" });
        await fetchTrash();
        window.dispatchEvent(new CustomEvent(EVT));
      } catch (err) {
        console.error("Failed to restore trash artifact", err);
      }
    },
    [fetchTrash],
  );

  const purgeTrash = useCallback(
    async (fileName: string) => {
      try {
        await fetchApi(`/api/meta-forge/trash/${encodeURIComponent(fileName)}`, { method: "DELETE" });
        await fetchTrash();
      } catch (err) {
        console.error("Failed to purge trash artifact", err);
      }
    },
    [fetchTrash],
  );

  const emptyTrash = useCallback(async () => {
    try {
      await fetchApi(`/api/meta-forge/trash`, { method: "DELETE" });
      setTrash([]);
    } catch (err) {
      console.error("Failed to empty trash", err);
    }
  }, []);

  useEffect(() => {
    setHydrated(true);
    const cached = read();
    if (cached.length > 0) {
      setPlans(cached);
    }

    const sync = async () => {
      try {
        const data = await fetchApi("/api/meta-forge/plans");
        if (data && Array.isArray(data.plans)) {
          const mapped = data.plans.map((p: any) => ({
            id: p.id,
            prompt: p.intent,
            actor: p.requested_by,
            createdAt: new Date(p.created_at).getTime(),
            status: p.status === "undone" ? "rolled_back" : p.status,
            actions: p.plan_json?.create?.map((c: any) => ({
              kind: c.kind,
              name: c.name || c.slug,
            })) || [],
            rolledBackAt: p.status === "undone" ? new Date(p.updated_at).getTime() : undefined,
            note: p.error || undefined,
          }));
          setPlans(mapped);
          window.localStorage.setItem(KEY, JSON.stringify(mapped));
          return;
        }
      } catch (err) {
        console.error("Failed to fetch meta-forge plans", err);
      }
      setPlans([]);
    };
    
    sync();
    fetchTrash();

    const onEvt = () => {
      sync();
      fetchTrash();
    };
    window.addEventListener(EVT, onEvt);
    return () => window.removeEventListener(EVT, onEvt);
  }, []);

  const apply = useCallback(async (id: string, action: "apply" | "reject" | "rollback" | "undo" | "reapply") => {
    try {
      await fetchApi(`/api/meta-forge/plans/${id}/${action}`, { method: "POST" });
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error(`Failed to ${action} meta-forge plan`, err);
    }
  }, []);

  const approve = useCallback((id: string) => apply(id, "apply"), [apply]);
  const reject = useCallback((id: string) => apply(id, "reject"), [apply]);
  const rollback = useCallback((id: string) => apply(id, "rollback"), [apply]);
  const reapply = useCallback((id: string) => apply(id, "reapply"), [apply]);

  /** Clears the ledger with mode: 'logs_only' (history only) or 'clean_sweep' (rollback all artifacts). */
  const reset = useCallback(async (mode: "logs_only" | "clean_sweep" = "logs_only") => {
    try {
      await fetchApi(`/api/meta-forge/plans?mode=${mode}`, { method: "DELETE" });
      setPlans([]);
      window.localStorage.removeItem(KEY);
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error("Failed to reset meta-forge plans", err);
    }
  }, []);

  /** Restores the original demo ledger. (Mocked for UI reset logic only) */
  const restore = useCallback(() => {
    // window.localStorage.setItem(KEY, JSON.stringify(seedForgePlans));
    // window.dispatchEvent(new CustomEvent(EVT));
  }, []);

  return { plans, trash, hydrated, approve, reject, rollback, reapply, reset, restore, fetchTrash, restoreTrash, purgeTrash, emptyTrash };
}
