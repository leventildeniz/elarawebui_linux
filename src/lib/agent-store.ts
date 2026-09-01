import { seedNow } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import type { AvatarStyle, JewelName } from "@/lib/avatar-library";
import { scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";
import { knowledgeBrands } from "@/mocks/agents";
import { seedAgents } from "@/mocks/agents";

/** Elara Sovereign Studio — Agent Orchestrator registry (local bridge, per-agent identity). */

export type CustomParam = { id: string; key: string; value: string };

export type KnowledgeBrand = { id: string; label: string; files: number; chunks: number };

export type AgentRun = {
  id: string;
  agentId: string;
  agent: string;
  source: string;
  user: string;
  adapter: string;
  status: "ok" | "error" | "running";
  startedAt: number;
  durationMs: number;
};

export type StudioAgent = Owned & {
  id: string;
  name: string;
  squad: string;
  role: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  provider: string;
  runtimePath: string;
  scriptPath: string;
  bridgeHost: string;
  port: string;
  healthEndpoint: string;
  thinking: boolean;
  enabled: boolean;
  live: boolean;
  priority: number;
  stopGraceMs: number;
  temperature: number;
  topP: number;
  repetitionPenalty: number;
  maxTokens: number;
  contextWindow: number;
  stopSequences: string[];
  customParams: CustomParam[];
  skills: string[];
  tools: string[];
  adapters: string[];
  targets: string[];
  /** granted MCP client servers (from the MCP workspace), by id */
  mcpServers?: string[];
  packs?: string[];
  rag: boolean;
  /** Hard binding to a knowledge space — retrieval may never leave it. */
  ragSpaceId?: string;
  ragBrands: string[];
  ragKeywords: string;
  icon: string;
  avatar: { seed: string; style: AvatarStyle; jewel: JewelName };
  stats: { calls: number; success: number; latencyMs: number };
  createdAt: number;
};

export { knowledgeBrands };

import { fetchApi } from "@/lib/api";

const KEY = "sovereign.agents";
const RUNS_KEY = "sovereign.agents.runs";
const EVT = "sovereign:agents";


export { seedAgents };

const runAgents = seedAgents.filter((a) => a.stats.calls > 0);

export const seedRuns: AgentRun[] = Array.from({ length: 40 }, (_, i) => {
  const a = runAgents[i % runAgents.length]!;
  const status: AgentRun["status"] = i % 11 === 3 ? "error" : "ok";
  return {
    id: `run.${i}`,
    agentId: a.id,
    agent: a.name.toLowerCase(),
    source: "agent-history",
    user: "admin",
    adapter: "spawn",
    status,
    startedAt: seedNow() - i * 5400000,
    durationMs: status === "error" ? 15 + (i % 5) : 8000 + ((i * 3137) % 32000),
  };
});

export const emptyAgent: Omit<StudioAgent, "id" | "createdAt"> = {
  name: "",
  squad: "NetSec",
  role: "Operator",
  description: "",
  systemPrompt: "",
  modelId: "system_default",
  provider: "System Default",
  runtimePath: "/opt/elara/local-server/.venv/bin/python · Python 3.12.13",
  scriptPath: "",
  bridgeHost: "http://localhost",
  port: "3005",
  healthEndpoint: "/api/health",
  thinking: false,
  enabled: true,
  live: false,
  priority: 5,
  stopGraceMs: 5000,
  temperature: 0.2,
  topP: 0.85,
  repetitionPenalty: 1.25,
  maxTokens: 4096,
  contextWindow: 8192,
  stopSequences: [],
  customParams: [],
  skills: [],
  tools: [],
  adapters: [],
  targets: [],
  mcpServers: [],
  packs: [],
  rag: false,
  ragBrands: [],
  ragKeywords: "",
  icon: "Bot",
  avatar: { seed: "atlas", style: "prism", jewel: "sapphire" },
  stats: { calls: 0, success: 100, latencyMs: 0 },
};

function read(): StudioAgent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StudioAgent[];
    if (!Array.isArray(parsed) || !parsed.length) return [];
    return parsed.map((a) => ({ ...emptyAgent, ...a }));
  } catch {
    return [];
  }
}

function write(list: StudioAgent[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

function readRuns(): AgentRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentRun[];
    return Array.isArray(parsed) && parsed.length ? parsed : [];
  } catch {
    return [];
  }
}

function writeRuns(list: AgentRun[]) {
  try {
    window.localStorage.setItem(RUNS_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

export function useAgents() {
  const [agents, setAgents] = useState<StudioAgent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const ctx = useOwnerCtx();

  useEffect(() => {
    const sync = async () => {
      try {
        const [agentsData, runsData, historyData] = await Promise.all([
          fetchApi("/api/agents").catch(() => null),
          fetchApi("/api/agents/runs").catch(() => null),
          fetchApi("/api/agents/run-history").catch(() => null)
        ]);
        
        if (Array.isArray(agentsData)) {
          setAgents(agentsData);

          // Dynamically extract missing squads from DB and save them so they never disappear
          const existingSquads = readSquads();
          const existingNames = new Set(existingSquads.map((sq) => sq.name));
          let addedSquads = false;
          const newSquads = [...existingSquads];
          agentsData.forEach((a: any) => {
            if (a.squad && a.squad !== "Unassigned" && !existingNames.has(a.squad)) {
              newSquads.push({
                id: a.squad.toLowerCase().replace(/\s+/g, "-"),
                name: a.squad,
                tone: squadTones[newSquads.length % squadTones.length]!
              });
              existingNames.add(a.squad);
              addedSquads = true;
            }
          });
          if (addedSquads) {
            window.localStorage.setItem(SQUADS_KEY, JSON.stringify(newSquads));
            window.dispatchEvent(new CustomEvent(SQ_EVT));
          }

        } else {
          setAgents(read()); // Read from localStorage
        }

        let nextRuns: AgentRun[] = [];

        if (runsData && Array.isArray(runsData.runs)) {
          const live = runsData.runs.map((r: any) => ({
            id: r.runId || `run.${Math.random().toString(36).slice(2)}`,
            agentId: r.agentId,
            agent: (Array.isArray(agentsData) ? agentsData : read()).find((a: any) => a.id === r.agentId)?.name?.toLowerCase() || r.agentId,
            source: r.source || "console",
            user: "admin",
            adapter: "spawn",
            status: "running" as const,
            startedAt: r.startedAt || Date.now(),
            durationMs: r.ageMs || 0
          }));
          nextRuns.push(...live);
        }

        if (historyData && Array.isArray(historyData.items)) {
          const history = historyData.items.map((r: any) => ({
            id: r.run_id,
            agentId: r.agent_id,
            agent: (Array.isArray(agentsData) ? agentsData : read()).find((a: any) => a.id === r.agent_id)?.name?.toLowerCase() || r.agent_id,
            source: r.source || "console",
            user: r.username || "admin",
            adapter: "spawn",
            status: (r.status === "error" || r.status === "failed") ? "error" as const : "ok" as const,
            startedAt: r.started_at ? new Date(r.started_at).getTime() : Date.now(),
            durationMs: r.duration_ms || 0
          }));
          nextRuns.push(...history);
        }

        if (nextRuns.length > 0) {
          nextRuns.sort((a, b) => b.startedAt - a.startedAt);
          setRuns(nextRuns);
          window.localStorage.setItem(RUNS_KEY, JSON.stringify(nextRuns));
        } else {
          setRuns(readRuns());
        }

      } catch (err) {
        console.error("Failed to load agents/runs from API", err);
        setAgents(read());
        setRuns(readRuns());
      }
    };
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);

  const create = useCallback(async (draft: Omit<StudioAgent, "id" | "createdAt">) => {
    const id = `agt.${Math.random().toString(36).slice(2, 8)}`;
    const newAgent = stampOwner({ ...draft, id, createdAt: Date.now() });
    try {
      await fetchApi("/api/agents", {
        method: "POST",
        body: JSON.stringify(newAgent)
      });
      setAgents((prev) => [...prev, newAgent]);
      return id;
    } catch (err) {
      console.error("Failed to create agent", err);
      throw err;
    }
  }, []);

  const update = useCallback(async (id: string, patch: Partial<StudioAgent>) => {
    try {
      await fetchApi(`/api/agents/${id}`, {
        method: "PUT",
        body: JSON.stringify(patch)
      });
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    } catch (err) {
      console.error("Failed to update agent", err);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await fetchApi(`/api/agents/${id}`, { method: "DELETE" });
      setAgents((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to remove agent", err);
    }
  }, []);

  const dispatch = useCallback(async (a: StudioAgent) => {
    // Optimistic mock to show it instantly in the UI
    const run: AgentRun = {
      id: `run.${Math.random().toString(36).slice(2, 8)}`,
      agentId: a.id,
      agent: a.name.toLowerCase(),
      source: "console",
      user: "admin",
      adapter: "spawn",
      status: "running",
      startedAt: Date.now(),
      durationMs: 0,
    };
    setRuns((prev) => {
      const next = [run, ...prev].slice(0, 200);
      writeRuns(next);
      return next;
    });

    try {
      // Actually trigger the real backend API
      await fetchApi(`/api/agents/${a.id}/run`, { method: "POST" });
      // Refresh to grab the real run details
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error("Failed to run agent", err);
      // Remove optimistic run on failure
      setRuns((prev) => {
        const next = prev.filter(r => r.id !== run.id);
        writeRuns(next);
        return next;
      });
      throw err;
    }
    
    return run;
  }, []);

  /* The roster is the caller's desk: own agents, shared ones, system seeds. */
  const visible = scopeOwned(agents, ctx);

  return { agents: visible, allAgents: agents, ctx, runs, create, update, remove, dispatch };
}

/* ------------------------------------------------------------------ squads */

export type Squad = { id: string; name: string; tone: string };

export const squadTones = ["sapphire", "emerald", "amethyst", "topaz", "ruby"] as const;

const SQUADS_KEY = "sovereign.squads";
const ACTIVE_SQUAD_KEY = "sovereign.squads.active";
const SQ_EVT = "sovereign:squads";

export const seedSquads: Squad[] = [...new Set(seedAgents.map((a) => a.squad))]
  .sort((a, b) => a.localeCompare(b))
  .map((name, i) => ({
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    tone: squadTones[i % squadTones.length]!,
  }));

function readSquads(): Squad[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SQUADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Squad[];
    return Array.isArray(parsed) && parsed.length ? parsed : [];
  } catch {
    return [];
  }
}

function writeSquads(list: Squad[]) {
  try {
    window.localStorage.setItem(SQUADS_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(SQ_EVT));
  } catch {
    /* ignore */
  }
}

function readActiveSquad(): string {
  if (typeof window === "undefined") return "all";
  return window.localStorage.getItem(ACTIVE_SQUAD_KEY) ?? "all";
}

/** Squad registry — drives the header tabs and the roster scope. */
export function useSquads() {
  const [squads, setSquads] = useState<Squad[]>([]);
  const [active, setActiveState] = useState<string>("all");

  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      setSquads(readSquads());
      setActiveState(readActiveSquad());
      
      try {
        const payload = await fetchApi("/api/agents/squads");
        const data = payload?.items || payload;
        if (mounted && Array.isArray(data)) {
          const mapped = data.map((d: any) => ({
            id: d.name.toLowerCase().replace(/\s+/g, "-"),
            name: d.name,
            tone: d.color || d.tone || "sapphire"
          }));
          
          const current = readSquads();
          const currentNames = new Set(current.map((sq) => sq.name));
          let changed = false;
          const merged = [...current];

          for (const m of mapped) {
            if (!currentNames.has(m.name)) {
              merged.push(m);
              changed = true;
            } else {
              const idx = merged.findIndex((s) => s.name === m.name);
              const target = merged[idx];
              if (target && target.tone !== m.tone) {
                target.tone = m.tone;
                changed = true;
              }
            }
          }

          if (changed || mapped.length > 0) {
            setSquads(merged);
            window.localStorage.setItem(SQUADS_KEY, JSON.stringify(merged));
            window.dispatchEvent(new CustomEvent(SQ_EVT));
          }
        }
      } catch (e) {
        console.error("Failed to load agent squads", e);
      }
    };
    sync();
    
    const onEvt = () => {
      setSquads(readSquads());
      setActiveState(readActiveSquad());
    };
    window.addEventListener(SQ_EVT, onEvt);
    return () => {
      mounted = false;
      window.removeEventListener(SQ_EVT, onEvt);
    };
  }, []);

  const setActive = useCallback((id: string) => {
    try {
      window.localStorage.setItem(ACTIVE_SQUAD_KEY, id);
      window.dispatchEvent(new CustomEvent(SQ_EVT));
    } catch {
      /* ignore */
    }
    setActiveState(id);
  }, []);

  const addSquad = useCallback((name: string) => {
    const clean = name.trim() || "New Squad";
    const list = readSquads();
    const id = `${clean.toLowerCase().replace(/\s+/g, "-")}.${Math.random().toString(36).slice(2, 5)}`;
    const tone = squadTones[list.length % squadTones.length]!;
    const next = [...list, { id, name: clean, tone }];
    writeSquads(next);
    setSquads(next);
    fetchApi("/api/agents/squads", {
      method: "POST",
      body: JSON.stringify({ name: clean, color: tone })
    }).catch(e => console.error("Failed to persist agent squad:", e));
    return id;
  }, []);

  const renameSquad = useCallback((id: string, name: string) => {
    const list = readSquads();
    const oldSquad = list.find(s => s.id === id);
    const clean = name.trim() || (oldSquad ? oldSquad.name : "");
    if (!oldSquad || !clean) return;

    const next = list.map((s) => (s.id === id ? { ...s, name: clean } : s));
    writeSquads(next);
    setSquads(next);
    
    fetchApi(`/api/agents/squads/${encodeURIComponent(oldSquad.name)}`, {
      method: "PATCH",
      body: JSON.stringify({ newName: clean })
    }).catch(e => console.error("Failed to rename agent squad:", e));
  }, []);

  const removeSquad = useCallback((id: string) => {
    const list = readSquads();
    const oldSquad = list.find(s => s.id === id);
    const next = list.filter((s) => s.id !== id);
    writeSquads(next);
    setSquads(next);
    
    if (oldSquad) {
      fetchApi(`/api/agents/squads/${encodeURIComponent(oldSquad.name)}`, {
        method: "DELETE"
      }).catch(e => console.error("Failed to remove agent squad:", e));
    }
  }, []);

  return { squads, active, setActive, addSquad, renameSquad, removeSquad };
}
