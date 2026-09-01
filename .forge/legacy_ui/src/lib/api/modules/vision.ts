import { request } from "../core/client";

export interface VisionConfig {
  enabled: boolean;
  model: string;
  resolution: string;
  max_tokens: number;
  [key: string]: any;
}

export const VisionAPI = {
  getConfig: () => request<VisionConfig>(`/api/vision/config`),
  updateConfig: (data: Partial<VisionConfig>) => 
    request<VisionConfig>(`/api/vision/config`, { 
      method: "POST", 
      body: JSON.stringify(data) 
    }),
};
