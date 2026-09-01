import { request } from "../core/client";

export interface TemplateAssignment {
  id: string;
  name: string;
  template: string;
  assignment: string;
  [key: string]: any;
}

export const TemplatesAPI = {
  list: () => request<TemplateAssignment[]>(`/api/template-assignments`),
  update: (data: any) => 
    request<{ success: boolean }>(`/api/template-assignments`, { 
      method: "PUT", 
      body: JSON.stringify(data) 
    }),
};
