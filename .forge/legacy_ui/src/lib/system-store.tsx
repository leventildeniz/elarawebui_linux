// Sovereign AI OS — System-wide registry store.
// PostgreSQL owns operational entities; browser state is only the current render snapshot.
import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SystemAPI, KnowledgeAPI, PythonAPI } from "./api-client";
import type { RuntimeSafetyDTO, LoopGuardDTO } from "./api-client";

/* ---------------- Types ---------------- */
export interface ModelEntry {
  id: string; modelName: string; provider: string; base: string; ctx: number;
  status: "loaded" | "ready" | "offline";
  isDefault?: boolean;
  source?: "manual" | "scanned";
  avatarUrl?: string;
  systemPrompt?: string;
  params?: { id: string; name: string; value: string }[];
  ragEnabled?: boolean;
  templateFamily?: string;
  promptPrefix?: string;
  stopSequences?: string[];
  chatTemplateKwargs?: Record<string, unknown>;
  runtimeSafety?: RuntimeSafetyDTO;
  /** 2026-05-30 — operatörün LOCAL /v1/models listesinden bağladığı serving ID. */
  runtimeModelId?: string;
  /** 2026-05-30 — per-model chat loop guard. null = disabled. */
  loopGuard?: LoopGuardDTO | null;
  /** 2026-06-02 — Transport branch: 'local_local' (default) | 'remote_compatible'. */
  transport?: "local_local" | "remote_compatible";
  /** 2026-06-02 — Env variable NAME holding the bearer key (e.g. REMOTE_API_KEY). Value never stored. */
  apiKeyEnv?: string;
  /** 2026-06-03 (Tur 2) — Per-model RAG inspector directive override; empty → global. */
  inspectorDirective?: string;
}

export interface ToolEntry {
  id: string; name: string; perms: string; sandbox: "strict"|"isolated"|"none";
  enabled: boolean; version: string; calls: number; success: number;
}
export interface RuntimeEntry {
  id: string; name: string; python: string; venv: string;
  packages: string[]; status: "running"|"idle"|"stopped";
}
export interface CrawlConfig {
  recursive: boolean;
  preset?: "single" | "standard" | "deep" | "custom";
  maxDepth?: number;        // 1..8
  maxPages?: number;        // 1..10000
  concurrency?: number;     // 1..10
  maxTotalBytes?: number;
  timeBudgetMs?: number;
  respectRobots?: boolean;
  skipNoindex?: boolean;
  includeSubdomains?: boolean;
  includePattern?: string;
}
export interface KnowledgeSource {
  id: string; name: string; type: "file"|"url"|"drive"|"archive";
  chunks: number; progress: number;
  url?: string;
  username?: string;
  password?: string;
  mfaCode?: string;
  mfaEnabled?: boolean;
  cookie?: string;
  token?: string;
  tag?: string;            // e.g. "Web Source"
  preview?: string;        // scraped text preview
  notes?: string;
  crawlConfig?: CrawlConfig | null;
  childCount?: number;
  brand?: string | null;   // dominant brand of underlying chunks (read-only from server)
}
export interface PolicyRule {
  id: string; name: string; cond: string; action: string;
  active: boolean; locked?: boolean; // locked=hard-coded baseline
}
export type TelemetryKind =
  | "system"            // built-in CPU/RAM/GPU etc.
  | "agent"             // python agent runtime status (executing/idle)
  | "db_pulse"          // PostgreSQL apex_db vitals
  | "llm_tokens"        // cumulative provider token usage
  | "llm_speed"         // tokens-per-second from selected model
  | "endpoint";         // user-defined http/tcp/ping/rest_auth probe
export interface TelemetryWatcher {
  id: string;
  label: string;
  kind?: TelemetryKind;
  metric: "cpu"|"ram"|"gpu"|"LOCAL"|"tps"|"latency"|"queue"|"errors"|"hallucination";
  target: string;       // e.g. "model:qwen-72b" or "system" or "agent:<id>" or "endpoint:<id>"
  // Endpoint-only:
  probeKind?: "http"|"https"|"tcp"|"ping"|"rest_auth";
  url?: string;
  host?: string;
  port?: number;
  authHeader?: string;  // e.g. "Bearer xyz"
  expectStatus?: number;
  expectStatuses?: number[];
}
export interface HardwareConfig {
  cpuCores: number;       // M5 MAX physical CPU cores
  cpuPerformance: number; // P-cores
  cpuEfficiency: number;  // E-cores
  gpuCores: number;       // M5 MAX GPU cores
  totalRamGb: number;     // 128
  cpuAllocPct: number;    // (legacy, retained for API compatibility)
  LOCALRamGb: number;       // capped at 80% of totalRam
}
export interface ReportSchedule {
  id: string; name: string;
  scope: "system"|"users"|"audit";
  cadence: "daily"|"weekly";
  email: string;
  enabled: boolean;
}
export interface AgentTemplate { id: string; name: string; }

/* ---------------- Defaults ---------------- */
const D_MODELS: ModelEntry[] = [];
const D_TOOLS: ToolEntry[] = [];
const D_RUNTIMES: RuntimeEntry[] = [];
const D_SOURCES: KnowledgeSource[] = [];
const D_POLICIES: PolicyRule[] = [];
const D_WATCHERS: TelemetryWatcher[] = [];
// MacBook Pro 16" M5 MAX — 18-core CPU (14 P + 4 E), 40-core GPU, 128GB unified
const D_HARDWARE: HardwareConfig = {
  cpuCores: 18, cpuPerformance: 14, cpuEfficiency: 4, gpuCores: 40,
  totalRamGb: 128, cpuAllocPct: 70, LOCALRamGb: 80,
};
const D_SCHEDULES: ReportSchedule[] = [];
const D_AGENT_TEMPLATES: AgentTemplate[] = [];

/* ---------------- Store ---------------- */
interface SysStore {
  models: ModelEntry[];      setModels: (m: ModelEntry[]) => void;
  tools:  ToolEntry[];       setTools:  (t: ToolEntry[]) => void;
  runtimes: RuntimeEntry[];  setRuntimes: (r: RuntimeEntry[]) => void;
  sources: KnowledgeSource[];setSources:  (s: KnowledgeSource[]) => void;
  policies: PolicyRule[];    setPolicies: (p: PolicyRule[]) => void;
  watchers: TelemetryWatcher[]; setWatchers: (w: TelemetryWatcher[]) => void;
  hardware: HardwareConfig;  setHardware: React.Dispatch<React.SetStateAction<HardwareConfig>>;
  schedules: ReportSchedule[]; setSchedules: (s: ReportSchedule[]) => void;
  agents: AgentTemplate[];   setAgents: (a: AgentTemplate[]) => void;
  // Hydration flags — distinguish "still loading" from "loaded and empty"
  // so consumer pages can render skeletons instead of misleading empty states.
  modelsHydrated: boolean;
  sourcesHydrated: boolean;
  hardwareHydrated: boolean;
}

function load<T>(k: string, fb: T): T {
  if (typeof window === "undefined") return fb;
  try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : fb; } catch { return fb; }
}

const Ctx = createContext<SysStore | null>(null);

export function SystemProvider({ children }: { children: ReactNode }) {
  const [models, setModels]       = useState<ModelEntry[]>(D_MODELS);
  const [tools, setTools]         = useState<ToolEntry[]>(D_TOOLS);
  const [runtimes, setRuntimes]   = useState<RuntimeEntry[]>(D_RUNTIMES);
  const [sources, setSources]     = useState<KnowledgeSource[]>(D_SOURCES);
  const [policies, setPolicies]   = useState<PolicyRule[]>(D_POLICIES);
  const [watchers, setWatchers]   = useState<TelemetryWatcher[]>(() => load("sys.watchers", D_WATCHERS));
  const [hardware, setHardware]   = useState<HardwareConfig>(() => ({ ...D_HARDWARE, ...load("sys.hardware", D_HARDWARE) }));
  const [schedules, setSchedules] = useState<ReportSchedule[]>(() => load("sys.schedules", D_SCHEDULES));
  const [agents, setAgents]       = useState<AgentTemplate[]>(D_AGENT_TEMPLATES);
  const [modelsHydrated, setModelsHydrated]     = useState(false);
  const [sourcesHydrated, setSourcesHydrated]   = useState(false);
  const [hardwareHydrated, setHardwareHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    SystemAPI.listModels()
      .then((rows) => {
        if (cancelled) return;
        setModels(rows.map((m) => ({
          id: m.id, modelName: m.modelName, provider: m.provider, base: m.base, ctx: m.ctx,
          status: m.status, isDefault: m.isDefault, source: m.source,
          systemPrompt: m.systemPrompt, params: m.params,
          ragEnabled: m.ragEnabled,
          templateFamily: m.templateFamily,
          promptPrefix: m.promptPrefix,
          stopSequences: m.stopSequences,
          chatTemplateKwargs: m.chatTemplateKwargs,
          runtimeSafety: m.runtimeSafety,
          runtimeModelId: m.runtimeModelId ?? "",
          loopGuard: m.loopGuard ?? null,
          transport: m.transport ?? "local_local",
          apiKeyEnv: m.apiKeyEnv ?? "",
        })));
      })
      .catch(() => { if (!cancelled) setModels([]); })
      .finally(() => { if (!cancelled) setModelsHydrated(true); });
    return () => { cancelled = true; };
  }, []);

  // Hydrate Knowledge Hub sources from PostgreSQL (Mac Studio) on every boot/refresh.
  useEffect(() => {
    let cancelled = false;
    KnowledgeAPI.list()
      .then((res) => {
        if (cancelled || !res.ok) return;
        setSources(res.sources as KnowledgeSource[]);
      })
      .catch(() => { /* keep empty list */ })
      .finally(() => { if (!cancelled) setSourcesHydrated(true); });
    return () => { cancelled = true; };
  }, []);

  // Hydrate operator-defined Python runtimes from PostgreSQL.
  useEffect(() => {
    let cancelled = false;
    PythonAPI.listRuntimes()
      .then((res) => {
        if (cancelled || !res.ok) return;
        setRuntimes(
          res.runtimes.map((r) => ({
            id: r.id,
            name: r.name,
            python: r.python,
            venv: r.venv,
            packages: r.packages || [],
            status: (r.status as RuntimeEntry["status"]) || "idle",
          })),
        );
      })
      .catch(() => { /* keep empty */ });
    return () => { cancelled = true; };
  }, []);

  // Hydrate real Mac hardware spec from the bridge — no UI default lies.
  useEffect(() => {
    let cancelled = false;
    SystemAPI.info()
      .then((info) => {
        if (cancelled) return;
        setHardware((prev) => ({
          ...prev,
          cpuCores:       info.cpuCores       || prev.cpuCores,
          cpuPerformance: info.cpuPerformance || prev.cpuPerformance,
          cpuEfficiency:  info.cpuEfficiency  || prev.cpuEfficiency,
          gpuCores:       info.gpuCores       || prev.gpuCores,
          totalRamGb:     info.totalRamGb     || prev.totalRamGb,
          LOCALRamGb:       Math.min(prev.LOCALRamGb, ramSafetyCapGb(info.totalRamGb || prev.totalRamGb)),
        }));
      })
      .catch(() => { /* keep last known */ })
      .finally(() => { if (!cancelled) setHardwareHydrated(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { localStorage.setItem("sys.hardware",  JSON.stringify(hardware)); }, [hardware]);
  useEffect(() => { localStorage.setItem("sys.schedules", JSON.stringify(schedules)); }, [schedules]);
  useEffect(() => { localStorage.setItem("sys.watchers", JSON.stringify(watchers)); }, [watchers]);

  return (
    <Ctx.Provider value={{
      models, setModels, tools, setTools, runtimes, setRuntimes,
      sources, setSources, policies, setPolicies, watchers, setWatchers,
      hardware, setHardware, schedules, setSchedules, agents, setAgents,
      modelsHydrated, sourcesHydrated, hardwareHydrated,
    }}>{children}</Ctx.Provider>
  );
}
export function useSystem(): SysStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSystem outside SystemProvider");
  return v;
}

/** RAM safety cap — LOCAL may never exceed 80% of total system RAM. */
export const ramSafetyCapGb = (totalGb: number) => Math.floor(totalGb * 0.8);
