import { request } from "../core/client";

export interface SessionDTO {
  id: string;
  username: string;
  role: string;
  provider?: string;
  ip?: string;
  device?: string;
  connectedAt?: string;
  lastSeen?: string;
}

export const SessionAPI = {
  get: (id: string) => request<SessionDTO>(`/api/sessions/${id}`),
  create: (data: any) => request<SessionDTO>(`/api/sessions`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) => request<SessionDTO>(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ success: boolean }>(`/api/sessions/${id}`, { method: "DELETE" }),
};
