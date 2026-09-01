// Active sessions store — sovereign. Persisted to local PostgreSQL via bridge.
// localStorage is only an offline mirror; the bridge owns the truth.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useChatStreamingFlag, useVisiblePoll } from "./use-visible-poll";
import { useAuth, type Role } from "./auth";
import { SessionsAPI, type SessionDTO } from "./api-client";

export interface ActiveSession {
  id: string;
  username: string;
  role: Role;
  provider: string;
  ip: string;
  device: string;
  connectedAt: string;
  lastSeen: string;
}

interface Store {
  sessions: ActiveSession[];
  disconnect: (id: string) => Promise<void>;
  add: (s: ActiveSession) => void;
  refresh: () => Promise<void>;
}

function load<T>(k: string, fb: T): T {
  if (typeof window === "undefined") return fb;
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; }
}
function fromDto(s: SessionDTO): ActiveSession {
  return { ...s, role: (s.role as Role) ?? "Viewer" };
}

const Ctx = createContext<Store | null>(null);

export function SessionsProvider({ children }: { children: ReactNode }) {
  // SSR-safe: start empty, hydrate from localStorage post-mount to avoid
  // React #418 hydration mismatches that flash the auth splash.
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = load<ActiveSession[]>("sessions.active", []);
    if (cached.length) setSessions(cached);
  }, []);
  const sessionsRef = useRef<ActiveSession[]>(sessions);
  const chatStreaming = useChatStreamingFlag();
  const { user } = useAuth();
  const userKey = user?.sessionId ?? user?.username ?? null;
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const refresh = async () => {
    try {
      const list = await SessionsAPI.list();
      setSessions(list.map(fromDto));
    } catch { /* keep cache */ }
  };

  // Refresh on mount AND whenever the logged-in user changes (login/logout)
  // so the admin sees their own row immediately after authenticating.
  useEffect(() => { void refresh(); }, [userKey]);

  // Light periodic refresh (30s, visible tab only) so admins see new logins
  // and disconnects across machines without manual reload.
  useVisiblePoll(() => { void refresh(); }, 30_000, !chatStreaming);

  // Heartbeat seyrek (60sn) ve sadece görünür sekmede.
  useVisiblePoll(() => {
    sessionsRef.current.forEach(s => { void SessionsAPI.heartbeat(s.id); });
  }, 60_000, !chatStreaming);

  useEffect(() => { localStorage.setItem("sessions.active", JSON.stringify(sessions)); }, [sessions]);

  const disconnect = async (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    try { await SessionsAPI.disconnect(id); } catch (e) { console.warn("[disconnect]", e); }
  };

  const add = (s: ActiveSession) => setSessions(prev => [s, ...prev.filter(x => x.id !== s.id)]);

  return (
    <Ctx.Provider value={{ sessions, disconnect, add, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSessions(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSessions outside SessionsProvider");
  return v;
}
