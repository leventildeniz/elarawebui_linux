import { request } from "../core/client";

/* ---------------- DTOs ---------------- */

export interface EngineSnapshot {
  cpuCores: number;
  cpuPerformance: number;
  cpuEfficiency: number;
  gpuCores: number;
  totalRamGb: number;
  LOCALRamGb: number;
  uptime: string;
  status: string;
  // any other metadata from the engine
  [key: string]: any;
}

export interface WorkerStatus {
  id: string;
  status: "running" | "idle" | "stopped" | "error";
  cpu: number;
  ram: number;
  last_active: string;
  error?: string;
}

export interface IntentConfigDTO {
  pattern: string;
  action: string;
  priority: number;
  enabled: boolean;
}

/* ---------------- SystemAPI ---------------- */

export const SystemAPI = {
  // 3.1 Health & Inventory
  info: () => request<EngineSnapshot>(`/api/system/inventory`),
  health: () => request<WorkerStatus>(`/api/system/health`),
  
  // 3.2 Worker & Runtime Control
  listJobs: () => request<any[]>(`/api/system/jobs`),
  listServices: () => request<any[]>(`/api/system/services`),
  updateAllowlist: (agents: string[]) => request<{ ok: boolean }>(`/api/system/allowlist`, { 
    method: "POST", 
    body: JSON.stringify({ agents }) 
  }),
  
  // 3.3 Engine Settings (/api/engine/*)
  engineConfig: {
    get: () => request<any>(`/api/engine/config`),
    set: (config: any) => request<any>(`/api/engine/config`, { 
      method: "POST", 
      body: JSON.stringify(config) 
    }),
    getIntent: (id: string) => request<IntentConfigDTO>(`/api/engine/intent/${id}`),
    updateIntent: (id: string, config: IntentConfigDTO) => request<any>(`/api/engine/intent/${id}`, { 
      method: "POST", 
      body: JSON.stringify(config) 
    }),
  },
};
