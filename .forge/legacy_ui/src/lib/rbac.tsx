// Tab-level RBAC client — Architect (Admin) sees everything; non-admins are
// gated to the tab id list returned by the bridge (PostgreSQL tab_permissions).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RbacAPI } from "./api-client";
import { useAuth } from "./auth";

interface RbacState {
  ready: boolean;
  isAdmin: boolean;
  allowedTabs: Set<string>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<RbacState | null>(null);

export function RbacProvider({ children }: { children: ReactNode }) {
  const { user, ready: authReady } = useAuth();
  const [allowedTabs, setAllowedTabs] = useState<Set<string>>(new Set(["chat"]));
  const [ready, setReady] = useState(false);

  const refresh = async () => {
    if (!user) { setAllowedTabs(new Set(["chat"])); setReady(true); return; }
    try {
      const r = await RbacAPI.me({ role: user.role, templateId: user.templateId ?? null });
      setAllowedTabs(new Set(r.allowedTabs));
    } catch {
      // bridge offline → fall back: admins keep everything, others get chat only
      setAllowedTabs(new Set(user.role === "Admin" ? ["chat","dashboard","knowledge","agents","workflows","tools","skills","models","templates","orchestration","policies","security","users","middleware","system-engine","telemetry","reports","debug","settings","python","forge","approvals","cve","live-call","planner"] : ["chat"]));
    } finally { setReady(true); }
  };

  useEffect(() => { if (authReady) void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [authReady, user?.username, user?.role, user?.templateId]);

  const value = useMemo<RbacState>(() => ({
    ready,
    isAdmin: user?.role === "Admin",
    allowedTabs,
    refresh,
  }), [ready, user?.role, allowedTabs]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRbac(): RbacState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRbac outside RbacProvider");
  return v;
}

export function useAllowedTab(tabId: string): boolean {
  const { isAdmin, allowedTabs } = useRbac();
  return isAdmin || allowedTabs.has(tabId);
}
