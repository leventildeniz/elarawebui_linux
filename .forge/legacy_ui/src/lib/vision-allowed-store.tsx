// İzinli Vizyon Profilleri — kullanıcı ve şablonlara atanan profil listesi.
// Bridge schema'sını kirletmemek için sidecar olarak localStorage'da tutulur
// (allowedModels deseniyle aynı pragmatik yaklaşım). Boş dizi = kısıt yok.
import { useCallback, useEffect, useState } from "react";

const USERS_KEY = "elara.vision.allowed.users.v1";
const TEMPLATES_KEY = "elara.vision.allowed.templates.v1";

type Map = Record<string, string[]>;

function read(key: string): Map {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}
function write(key: string, value: Map) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function useAllowedVisionProfiles(scope: "users" | "templates", id: string | undefined) {
  const key = scope === "users" ? USERS_KEY : TEMPLATES_KEY;
  const [map, setMap] = useState<Map>(() => read(key));

  useEffect(() => { setMap(read(key)); }, [key]);

  const value = id ? (map[id] ?? []) : [];
  const set = useCallback((next: string[]) => {
    if (!id) return;
    const updated = { ...read(key), [id]: next };
    write(key, updated);
    setMap(updated);
  }, [id, key]);

  return [value, set] as const;
}
