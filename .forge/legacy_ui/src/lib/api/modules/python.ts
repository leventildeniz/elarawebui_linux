import { request } from "../core/client";

/* ---------------- DTOs ---------------- */

export interface PythonPrimary {
  path: string;
  version: string;
  sealedAt?: string;
}

export interface PythonRuntime {
  id: string;
  name: string;
  python: string;
  venv: string;
  packages: string[];
}

/* ---------------- PythonAPI ---------------- */

export const PythonAPI = {
  // 1.1 Verify interpreter
  detect: (path: string) => 
    request<{ ok: boolean; path: string; version: string }>(
      "/api/python/detect", 
      {
        method: "POST",
        body: JSON.stringify({ path }),
      }
    ),

  // 1.2 Get sealed main interpreter
  getPrimary: () => request<PythonPrimary>(`/api/python/primary`),

  // 1.3 Seal or remove main interpreter
  setPrimary: (data: { path: string | null }) => 
    request<{ ok: boolean; primary: PythonPrimary | null }>(
      "/api/python/primary", 
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    ),

  // 1.4 List all runtimes (The critical method used by system-store.tsx)
  listRuntimes: () => request<PythonRuntime[]>(`/api/python/runtimes`),

  // 1.5 Replace the entire runtime list (replace semantics)
  updateRuntimes: (runtimes: PythonRuntime[]) => 
    request<{ ok: boolean }>(
      "/api/python/runtimes", 
      {
        method: "PUT",
        body: JSON.stringify({ runtimes }),
      }
    ),
};
