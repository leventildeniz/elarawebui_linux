import { request } from "../core/client";

export interface ThreadDTO {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  [key: string]: any;
}

export const ThreadAPI = {
  list: () => request<ThreadDTO[]>(`/api/threads`),
  get: (id: string) => request<ThreadDTO>(`/api/threads/${id}`),
  create: (data: any) => request<ThreadDTO>(`/api/threads`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) => request<ThreadDTO>(`/api/threads/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ success: boolean }>(`/api/threads/${id}`, { method: "DELETE" }),
};
