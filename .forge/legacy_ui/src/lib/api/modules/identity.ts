import { request } from "../core/client";

export interface IdentityUserDTO {
  id: string;
  username: string;
  role: string;
  provider?: string;
  groups?: string[];
  status?: string;
}

export interface LoginResponse {
  ok: boolean;
  user: IdentityUserDTO;
  sessionId: string;
}

export const IdentityAPI = {
  login: (credentials: any) => 
    request<LoginResponse>(
      "/api/auth/login", 
      {
        method: "POST",
        body: JSON.stringify(credentials),
      }
    ),
  logout: () => 
    request<{ success: boolean }>(
      "/api/auth/logout", 
      { method: "POST" }
    ),
  me: () => 
    request<IdentityUserDTO>(
      "/api/auth/me", 
      { method: "GET" }
    ),
};

export const AuthAPI = IdentityAPI;
