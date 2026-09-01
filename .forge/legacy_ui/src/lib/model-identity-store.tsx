// Model identity store — PostgreSQL is the source of truth for model→avatar mapping.
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { ModelIdentityAPI } from "./api-client";
import { defaultModelAvatar } from "./avatars";

interface Store {
  map: Record<string, string>;      // lowercased name -> avatar url
  resolve: (name: string | undefined | null, override?: string | null) => string;
  save: (name: string, avatarUrl: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function ModelIdentityProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const rows = await ModelIdentityAPI.list();
      const next: Record<string, string> = {};
      for (const r of rows) next[r.name.toLowerCase()] = r.avatarUrl;
      setMap(next);
    } catch { /* offline ok */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const resolve = useCallback((name: string | undefined | null, override?: string | null) => {
    if (override) return override;
    const key = (name ?? "").toLowerCase();
    if (key && map[key]) return map[key];
    // Try short-name fallback (e.g. "qwen2.5:72b" → "qwen2.5")
    const short = key.split(/[:/\\]/)[0];
    if (short && map[short]) return map[short];
    return defaultModelAvatar(name ?? "");
  }, [map]);

  const save = useCallback(async (name: string, avatarUrl: string) => {
    await ModelIdentityAPI.save(name, avatarUrl);
    setMap(m => ({ ...m, [name.toLowerCase()]: avatarUrl }));
  }, []);

  const remove = useCallback(async (name: string) => {
    await ModelIdentityAPI.remove(name);
    setMap(m => { const n = { ...m }; delete n[name.toLowerCase()]; return n; });
  }, []);

  return <Ctx.Provider value={{ map, resolve, save, remove, refresh }}>{children}</Ctx.Provider>;
}

export function useModelIdentity(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useModelIdentity outside ModelIdentityProvider");
  return v;
}
