import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { BridgeBanner } from "@/components/bridge-banner";
import { AuditTicker } from "@/components/audit-ticker";
import { useAuth } from "@/lib/auth";
import { useRbac } from "@/lib/rbac";

export const Route = createFileRoute("/_app")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && !localStorage.getItem("user")) {
      throw redirect({ to: "/login" });
    }
  },
  component: AppLayout,
});

const PATH_TO_TAB: Record<string, string> = {
  "/chat":"chat","/dashboard":"dashboard","/knowledge":"knowledge","/agents":"agents",
  "/workflows":"workflows","/tools":"tools","/skills":"skills","/models":"models",
  "/templates":"templates","/orchestration":"orchestration","/policies":"policies",
  "/security":"security","/users":"users","/middleware":"middleware",
  "/system-engine":"system-engine","/telemetry":"telemetry","/reports":"reports",
  "/debug":"debug","/settings":"settings","/python":"python","/forge":"forge",
  "/approvals":"approvals","/cve":"cve","/live-call":"live-call","/planner":"planner",
  "/mcp":"mcp",
};

function AppLayout() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const { ready: rbacReady, isAdmin, allowedTabs } = useRbac();
  const path = useRouterState({ select: (r) => r.location.pathname });

  useEffect(() => {
    if (ready && !user) navigate({ to: "/login" });
  }, [ready, user, navigate]);

  // Tab-level RBAC guard — unauthorized routes bounce to /chat.
  useEffect(() => {
    if (!ready || !user || !rbacReady || isAdmin) return;
    const tabId = PATH_TO_TAB[path];
    if (tabId && !allowedTabs.has(tabId)) navigate({ to: "/chat" });
  }, [ready, user, rbacReady, isAdmin, allowedTabs, path, navigate]);

  if (!ready || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-xs font-mono uppercase tracking-widest text-muted-foreground">
          <span className="pulse-dot" /> Verifying session…
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="h-[100dvh] flex w-full overflow-hidden" suppressHydrationWarning={true}>
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <BridgeBanner />
          <AuditTicker />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
