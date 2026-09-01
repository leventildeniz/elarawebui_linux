import { request } from "../core/client";

export interface AgentRow {
  id: string;
  name: string;
  model: string | null;
  status: "idle" | "active" | "error";
  bridge_url: string | null;
  meta?: Record<string, unknown> | null;
  port?: number | null;
  last_active?: string | null;
  agent_path?: string;
  interpreter_path?: string;
  calls: number;
  success: number;
  updated_at: string;
  priority?: number | null;
  stop_grace_ms?: number | null;
  effective_squad?: string;
  capability_pack_id?: string | null;
  capability_pack_ids?: string[];
}

export const AgentAPI = {
  list: () => request<AgentRow[]>(`/api/agents`),
  get: (id: string) => request<AgentRow>(`/api/agents/${id}`),
  create: (data: any) => request<AgentRow>(`/api/agents`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string) => request<AgentRow>(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ success: boolean }>(`/api/agents/${id}`, { method: "DELETE" }),
};
