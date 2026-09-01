import { Link, useRouterState } from "@tanstack/react-router";
import {
  MessageSquare, Bot, Wrench, Workflow, Activity, Cpu, Database,
  Shield, Bug, Settings, ScanEye, TerminalSquare, LayoutDashboard,
  Network, FileBarChart, Users, Share2, Hammer, Sparkles, ServerCog,
  Satellite, Radar, ShieldCheck, AlertTriangle, RadioTower, Brain, Plug, Crosshair, Layers, Router,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { SystemAPI } from "@/lib/api-client";
import { useChatStreamingFlag, useVisiblePoll } from "@/lib/use-visible-poll";
import { useRbac } from "@/lib/rbac";

function BackendHealthPill() {
  const [up, setUp] = useState<boolean | null>(null);
  const chatStreaming = useChatStreamingFlag();
  useVisiblePoll(() => {
    SystemAPI.health().then(() => setUp(true)).catch(() => setUp(false));
  }, 5000, !chatStreaming);
  const color = up === null ? "bg-muted-foreground" : up ? "bg-emerald-500" : "bg-destructive";
  const label = up === null ? "PING…" : up ? "BACKEND :3005" : "OFFLINE :3005";
  return (
    <div className="px-2 pb-1 flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${color} ${up ? "animate-pulse" : ""}`} />
      <span className="truncate">{label}</span>
    </div>
  );
}

export function AppSidebar() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { isAdmin, allowedTabs } = useRbac();
  const allow = (id: string) => isAdmin || allowedTabs.has(id);

  const groups = [
    {
      label: "OPS",
      items: [
        { url: "/dashboard", icon: LayoutDashboard, key: "nav.dashboard" as const, tabId: "dashboard" },
        { url: "/chat", icon: MessageSquare, key: "nav.chat" as const, tabId: "chat" },
        { url: "/agents", icon: Bot, key: "nav.agents" as const, tabId: "agents" },
        { url: "/workflows", icon: Workflow, key: "nav.workflows" as const, tabId: "workflows" },
        { url: "/forge", icon: Hammer, key: "nav.forge" as const, tabId: "forge" },
        { url: "/skills", icon: Sparkles, key: "nav.skills" as const, tabId: "skills" },
        { url: "/orchestration", icon: Share2, key: "nav.orchestration" as const, tabId: "orchestration" },
      ],
    },
    {
      label: "RUNTIME",
      items: [
        { url: "/system-engine", icon: ServerCog, key: "nav.system_engine" as const, tabId: "system-engine" },
        { url: "/models", icon: Cpu, key: "nav.models" as const, tabId: "models" },
        { url: "/tools", icon: Wrench, key: "nav.tools" as const, tabId: "tools" },
        { url: "/capabilities", icon: Layers, key: "nav.capabilities" as const, tabId: "capabilities" },
        { url: "/adapters", icon: Plug, key: "nav.adapters" as const, tabId: "adapters" },
        { url: "/targets", icon: Crosshair, key: "nav.targets" as const, tabId: "targets" },
        { url: "/python", icon: TerminalSquare, key: "nav.python" as const, tabId: "python" },
        { url: "/knowledge", icon: Database, key: "nav.knowledge" as const, tabId: "knowledge" },
        { url: "/mcp", icon: Router, key: "nav.mcp" as const, tabId: "mcp" },
        { url: "/meta-forge", icon: Hammer, key: "nav.meta_forge" as const, tabId: "meta-forge" },
      ],
    },
    {
      label: "CONTROL",
      items: [
        { url: "/telemetry", icon: Activity, key: "nav.telemetry" as const, tabId: "telemetry" },
        { url: "/planner", icon: Brain, key: "nav.planner" as const, tabId: "planner" },
        { url: "/reports", icon: FileBarChart, key: "nav.reports" as const, tabId: "reports" },
        { url: "/policies", icon: ScanEye, key: "nav.policies" as const, tabId: "policies" },
        { url: "/security", icon: Shield, key: "nav.security" as const, tabId: "security" },
        { url: "/approvals", icon: ShieldCheck, key: "nav.approvals" as const, tabId: "approvals" },
        { url: "/cve", icon: AlertTriangle, key: "nav.cve" as const, tabId: "cve" },
        { url: "/live-call", icon: RadioTower, key: "nav.live_call" as const, tabId: "live-call" },
        { url: "/middleware", icon: Network, key: "nav.middleware" as const, tabId: "middleware" },
        { url: "/templates", icon: Users, key: "nav.templates" as const, tabId: "templates" },
        { url: "/users", icon: Users, key: "nav.users" as const, tabId: "users" },
        { url: "/debug", icon: Bug, key: "nav.debug" as const, tabId: "debug" },
        { url: "/settings", icon: Settings, key: "nav.settings" as const, tabId: "settings" },
      ],
    },
  ].map(g => ({ ...g, items: g.items.filter(it => allow(it.tabId)) })).filter(g => g.items.length > 0);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="relative">
            <div className="h-8 w-8 rounded-md bg-gradient-primary glow flex items-center justify-center">
              <ScanEye className="h-4 w-4 text-primary-foreground" />
            </div>
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold tracking-wider text-gradient">{t("app.name")}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">v1.0 · sovereign</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-1">
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground/60">
              {g.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((it) => {
                  const active = path === it.url;
                  return (
                    <SidebarMenuItem key={it.url}>
                      <SidebarMenuButton asChild isActive={active}>
                        <Link
                          to={it.url}
                          preload="intent"
                          className={`flex items-center gap-3 transition-all ${
                            active ? "text-primary" : ""
                          }`}
                        >
                          <it.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span className="text-sm">{t(it.key)}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && <BackendHealthPill />}
        {!collapsed && user && (
          <div className="px-2 py-2 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs font-medium">{user.username}</span>
              <span className="text-[10px] text-muted-foreground font-mono">{user.role}</span>
            </div>
            <Badge variant="outline" className="text-[9px] gap-1 font-mono">
              <span className="pulse-dot !w-1.5 !h-1.5" />
              ON
            </Badge>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
