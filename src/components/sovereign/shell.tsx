import { AnimatePresence, motion } from "motion/react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useAccess, exitPreview } from "@/lib/rbac-store";
import { emitRbac } from "@/lib/rbac-events";
import {
  Activity,
  BarChart3,
  Blocks,
  Bot,
  Cable,
  Boxes,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronsUpDown,
  Code2,
  Cpu,
  Crosshair,
  Factory,
  FileDown,
  FileStack,
  GitBranch,
  Hammer,
  KeyRound,
  Layers,
  Library,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  PanelLeft,
  PanelRight,
  Paperclip,
  PieChart,
  Plug,
  Puzzle,
  Radar,
  Receipt,
  ScrollText,
  Search,
  Settings2,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Users,
  Wrench,
  ArrowLeft,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePendingApprovals, useQueueSwitch } from "@/lib/approval-store";
import { useForgePlans } from "@/lib/metaforge-store";
import { AttentionBell } from "@/components/sovereign/attention-bell";
import { cn } from "@/lib/utils";
import { ModelGroupTabs } from "./model-group-tabs";
import { SquadTabs } from "./squad-tabs";
import { TelemetryCardTabs } from "./telemetry-card-tabs";
import { SkillSquadTabs } from "./skill-squad-tabs";
import { WorkflowTabs } from "./workflow-tabs";
import { OrchestrationTabs } from "./orchestration-tabs";
import { RoleTabs } from "./role-tabs";
import { CapabilitySquadTabs } from "./capability-squad-tabs";
import { CveWatchlistTabs } from "./cve-watchlist-tabs";
import { ForgeKindTabs } from "./forge-kind-tabs";
import { RuntimeMonitor } from "./runtime-canvas";
import { ChatList } from "./chat-list";
import { FilesCanvas } from "./files-in-chat";
import { ChatMenuPanel } from "./chat-menu-panel";
import { useChats, type ChatColor } from "@/lib/chat-store";
import { CommandPalette } from "./command-palette";
import { useSpaceAccess } from "@/lib/knowledge-space-store";

import { EntityAvatar } from "./identity";
import { defaultProfile, readProfile, type OperatorProfile } from "./operator-card";

const groups = [
  {
    id: "core",
    label: "Core",
    items: [
      { icon: MessageSquare, label: "Chat", to: "/" },
      { icon: Bot, label: "Agents", to: "/agents" },
      { icon: Brain, label: "Memory", to: "/memory" },
      { icon: FileStack, label: "RAG Documents", to: "/rag-documents" },
      { icon: ListChecks, label: "Planner", to: "/planner" },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    items: [
      { icon: Radar, label: "Orchestration", to: "/orchestration" },
      { icon: GitBranch, label: "Workflows", to: "/flows" },
    ],
  },
  {
    id: "forge",
    label: "Forge",
    items: [
      { icon: Wrench, label: "Skills", to: "/skills" },
      { icon: Puzzle, label: "Tools", to: "/tools" },
      { icon: Layers, label: "Capabilities", to: "/capabilities" },
      { icon: Factory, label: "Forge Factory", to: "/factory" },
      { icon: Hammer, label: "Meta-Forge", to: "/meta-forge" },
      { icon: Plug, label: "MCP", to: "/mcp" },
      { icon: Cable, label: "Adapters", to: "/adapters" },
    ],
  },

  {
    id: "runtime",
    label: "Runtime",
    items: [
      { icon: Cpu, label: "System Engine", to: "/engine" },
      { icon: Boxes, label: "Models", to: "/models" },
      { icon: Activity, label: "Fleet Telemetry", to: "/fleet" },
      { icon: Code2, label: "Python Runtime", to: "/runtime" },
      { icon: Crosshair, label: "Targets", to: "/targets" },
      { icon: ScrollText, label: "Logs / Audit", to: "/system" },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    items: [
      { icon: Library, label: "Knowledge / RAG", to: "/knowledge" },
      { icon: KeyRound, label: "RBAC", to: "/rbac" },
      { icon: ShieldCheck, label: "Policies & Security", to: "/policy" },
      { icon: CheckCircle2, label: "Approval Queue", to: "/approvals" },
      { icon: ShieldAlert, label: "CVE Feed / Audit", to: "/security" },
      { icon: Users, label: "Users & Groups", to: "/users" },
      { icon: Settings2, label: "Settings", to: "/settings" },
    ],
  },
  {
    id: "reporting",
    label: "Reporting",
    items: [
      { icon: PieChart, label: "Overview", to: "/reporting/overview" },
      { icon: BarChart3, label: "Usage Analytics", to: "/reporting/usage" },
      { icon: Receipt, label: "Cost & Spend", to: "/reporting/cost" },
      { icon: Users, label: "Operator Analytics", to: "/reporting/users" },
      { icon: Library, label: "RAG Analytics", to: "/reporting/rag" },
      { icon: FileDown, label: "Scheduled Exports", to: "/reporting/exports" },
    ],
  },
  {
    id: "more",
    label: "More",
    items: [],
  },
  {
    id: "chats",
    label: "Chats",
    items: [],
  },
];

const allItems = groups.flatMap((g) => g.items);

let persistedGroups: Record<string, boolean> = {};
let persistedSidebar = true;

const iconHover = {
  scale: 1.05,
  transition: { duration: 0.16, ease: "easeInOut" as const },
};
const iconActive = {
  scale: 1.05,
  transition: { duration: 0.16, ease: "easeInOut" as const },
};

function shouldStartClosed() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem("sovereign.sidebar.closed") === "1";
}

export function Shell({ children, crumb }: { children: ReactNode; crumb?: string | undefined }) {
  const [canvas, setCanvas] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const { active: activeChat, newChat } = useChats();
  const chatFiles = activeChat?.files ?? [];
  const [open, setOpenState] = useState(() => (shouldStartClosed() ? false : persistedSidebar));
  const setOpen = (v: boolean) => {
    persistedSidebar = v;
    setOpenState(v);
  };
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const active = allItems.find((t) => t.to === pathname);
  const access = useAccess();
  const spaceAccess = useSpaceAccess();
  const scopeAllowed = access.allows(pathname);
  const knowledgeOk = spaceAccess.enabled;
  const visibleGroups = (
    access.enforced
      ? groups
          .map((g) => ({ ...g, items: g.items.filter((i) => access.allows(i.to)) }))
          .filter((g) => g.items.length > 0 || g.items.length === 0)
      : groups
  ).map((g) =>
    knowledgeOk ? g : { ...g, items: g.items.filter((i) => i.to !== "/rag-documents") },
  );

  // Studio settings children live behind the /settings tab row. When a role is
  // granted one of them without /settings itself, surface it directly in
  // Governance so the scope is actually reachable.
  const STUDIO_CHILDREN = [
    { icon: Layers, label: "Capability Registry", to: "/registry" },
    { icon: KeyRound, label: "Authentication", to: "/authentication" },
    { icon: FileStack, label: "Global Converter", to: "/converter" },
    { icon: Blocks, label: "Services", to: "/services" },
    { icon: ShieldCheck, label: "Certificates", to: "/certificates" },
    { icon: Settings, label: "Mail & Time", to: "/mail" },
    { icon: Radar, label: "SIEM", to: "/siem" },
    { icon: Activity, label: "Telemetry Sources", to: "/telemetry-sources" },
    { icon: Boxes, label: "Vision Audio", to: "/vision-audio" },
    { icon: FileDown, label: "Backup & Restore", to: "/backup" },
    { icon: Settings2, label: "Theme", to: "/theme" },
  ];
  const orphanStudio =
    access.enforced && !access.allows("/settings")
      ? STUDIO_CHILDREN.filter((i) => access.allows(i.to))
      : [];
  const navGroups = orphanStudio.length
    ? visibleGroups.map((g) =>
        g.id === "governance" ? { ...g, items: [...g.items, ...orphanStudio] } : g,
      )
    : visibleGroups;

  useEffect(() => {
    if (scopeAllowed) return;
    emitRbac({
      action: "rbac.denied",
      role: access.role?.name ?? "unknown",
      target: pathname,
      detail: `surface "${pathname}" refused — scope not granted to role ${access.role?.name ?? "unknown"}`,
    });
  }, [scopeAllowed, pathname, access.role?.name]);
  const approvalQueue = useQueueSwitch();
  const pendingCount = usePendingApprovals().length;
  const pendingApprovals = approvalQueue.enabled ? pendingCount : 0;
  const pendingForge = useForgePlans().plans.filter((p) => p.status === "pending").length;
  const [openGroups, setOpenGroupsState] = useState<Record<string, boolean>>(persistedGroups);
  const setOpenGroups = (fn: (s: Record<string, boolean>) => Record<string, boolean>) => {
    persistedGroups = fn(persistedGroups);
    setOpenGroupsState(persistedGroups);
  };
  const allExpanded = groups.every((g) => openGroups[g.id]);
  const toggleAllGroups = () =>
    setOpenGroups(() => (allExpanded ? {} : Object.fromEntries(groups.map((g) => [g.id, true]))));
  const [palette, setPalette] = useState(false);
  const [operatorMenu, setOperatorMenu] = useState<boolean>(false);
  const [profile, setProfile] = useState<OperatorProfile>(defaultProfile);
  const title = crumb ?? active?.label ?? "New chat";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("sovereign.sidebar.closed") === "1") {
      sessionStorage.removeItem("sovereign.sidebar.closed");
      persistedSidebar = false;
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "/") {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if (mod && e.key === "k") {
        e.preventDefault();
        newChat();
        navigate({ to: "/" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat, navigate]);

  useEffect(() => {
    const sync = () => setProfile(readProfile());
    sync();
    window.addEventListener("sovereign:profile", sync);
    return () => window.removeEventListener("sovereign:profile", sync);
  }, []);

  return (
    <div className="relative flex h-screen overflow-hidden bg-[var(--canvas-deep)]">
      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        targets={navGroups.flatMap((g) =>
          g.items.map((it) => ({ icon: it.icon, label: it.label, to: it.to, group: g.label })),
        )}
      />
      {/* sidebar — collapsible, Kimi-style menu stack */}
      <motion.aside
        initial={{ width: open ? 272 : 0 }}
        animate={{ width: open ? 272 : 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        className="studio-rail relative z-20 hidden shrink-0 overflow-hidden bg-[var(--canvas-deep)] md:block"
      >
        <div className="flex h-full w-[272px] flex-col px-2.5 py-3">
          <div className="flex items-center justify-between px-1.5 pb-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-raised font-mono text-[11px] font-bold tracking-[0.02em] text-foreground/85">
                E
              </span>
              <span className="flex min-w-0 flex-col leading-none">
                <span className="font-display text-[13px] font-semibold tracking-[0.16em] text-foreground/90">
                  ELARA
                </span>
                <span className="mt-[3px] font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted-foreground/50">
                  sovereign studio
                </span>
              </span>
            </span>

            <button
              aria-label={allExpanded ? "Collapse all menus" : "Expand all menus"}
              title={allExpanded ? "Collapse all" : "Expand all"}
              onClick={toggleAllGroups}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-raised/60 hover:text-foreground"
            >
              <ChevronsUpDown className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>

            <button
              aria-label="Collapse sidebar"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-raised/60 hover:text-foreground"
              title="Collapse sidebar"
            >
              <motion.span
                whileHover={{ x: -2 }}
                transition={{ type: "spring" as const, stiffness: 400, damping: 20 }}
              >
                <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </motion.span>
            </button>
          </div>

          <QuickAction
            icon={MessageSquarePlus}
            label="New chat"
            to="/"
            hint="⌘K"
            onClick={() => newChat()}
          />
          <QuickAction icon={Search} label="Search" onClick={() => setPalette(true)} hint="⌘/" />
          <QuickAction icon={Terminal} label="Console" to="/fleet" />

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
            {navGroups.map((group) => {
              const expanded = openGroups[group.id] ?? false;
              return (
                <div key={group.id} className="mb-1">
                  <GroupHeader
                    label={group.label}
                    expanded={expanded}
                    showDots={false}
                    onToggle={() =>
                      setOpenGroups((s) => ({ ...s, [group.id]: !(s[group.id] ?? false) }))
                    }
                  />

                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                          height: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
                          opacity: { duration: 0.11, ease: "easeOut" },
                        }}
                        style={{ willChange: "height, opacity" }}
                        className="overflow-hidden"
                      >
                        {group.id === "chats" ? (
                          <ChatList hideHeader />
                        ) : (
                          group.items.map(({ icon: Icon, label, to }) => {
                            const on = to === pathname;
                            return (
                              <Link
                                key={label}
                                to={to}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenGroups((s) => ({ ...s, [group.id]: true }));
                                }}
                                className={cn(
                                  "group relative flex items-center gap-2.5 px-2.5 py-2 text-[14px] font-medium transition-colors",
                                  on
                                    ? "text-foreground"
                                    : "text-foreground/85 hover:text-foreground",
                                )}
                              >
                                <motion.span
                                  initial={{ scaleY: 0, opacity: 0 }}
                                  animate={
                                    on ? { scaleY: 1, opacity: 1 } : { scaleY: 0, opacity: 0 }
                                  }
                                  transition={{ duration: 0.16, ease: "easeInOut" }}
                                  className="absolute left-[7px] top-1/2 h-4 w-[1.5px] origin-center -translate-y-1/2 rounded-full bg-sapphire"
                                />
                                <motion.span
                                  whileHover={iconHover}
                                  animate={on ? iconActive : {}}
                                  className="inline-flex"
                                >
                                  <Icon
                                    className={cn(
                                      "h-[18px] w-[18px]",
                                      on
                                        ? "text-sapphire"
                                        : "text-muted-foreground/70 group-hover:text-sapphire",
                                    )}
                                    strokeWidth={1.5}
                                  />
                                </motion.span>
                                {label}
                                {to === "/meta-forge" && pendingForge > 0 && (
                                  <span
                                    className="ml-auto rounded-full border border-sapphire/40 bg-sapphire/[0.12] px-1.5 py-[1px] font-mono text-[10.5px] leading-none text-sapphire"
                                    style={{ boxShadow: "0 0 10px -3px var(--sapphire)" }}
                                  >
                                    {pendingForge}
                                  </span>
                                )}
                                {to === "/approvals" && pendingApprovals > 0 && (
                                  <span
                                    className="ml-auto rounded-full border border-topaz/40 bg-topaz/[0.12] px-1.5 py-[1px] font-mono text-[10.5px] leading-none text-topaz"
                                    style={{ boxShadow: "0 0 10px -3px var(--topaz)" }}
                                  >
                                    {pendingApprovals}
                                  </span>
                                )}
                              </Link>
                            );
                          })
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          <div className="relative mt-2 flex items-center justify-between px-1.5 pt-2">
            <AnimatePresence>
              {operatorMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOperatorMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.98 }}
                    transition={{ duration: 0.14, ease: "easeInOut" }}
                    className="absolute bottom-[calc(100%+8px)] left-1 z-50 w-[236px] overflow-hidden rounded-[12px] border border-white/[0.08] bg-canvas p-1 shadow-[0_24px_60px_-24px_oklch(0_0_0/0.9)]"
                  >
                    <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5">
                      <EntityAvatar
                        seed={profile.name || "operator"}
                        label={profile.name}
                        style={profile.style}
                        jewel={profile.jewel}
                        size={32}
                        className="rounded-full"
                      />
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate text-[14px] font-medium text-foreground">
                          {profile.name}
                        </span>
                        <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/50">
                          {profile.role}
                        </span>
                      </span>
                    </div>

                    <div className="my-1 h-px bg-white/[0.06]" />

                    <button
                      onClick={() => {
                        setOperatorMenu(false);
                        navigate({ to: "/account" });
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-foreground/90 transition-colors hover:bg-raised/60 hover:text-foreground"
                    >
                      <Settings className="h-4 w-4 text-muted-foreground/70" strokeWidth={1.5} />
                      Settings
                    </button>

                    <div className="my-1 h-px bg-white/[0.06]" />

                    <Link
                      to="/login"
                      onClick={() => {
                        setOperatorMenu(false);
                        try {
                          sessionStorage.removeItem("sovereign.operator");
                          localStorage.removeItem("sovereign.sessionId");
                          localStorage.removeItem("sovereign.user");
                        } catch {
                          /* ignore */
                        }
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-ruby/90 transition-colors hover:bg-ruby/10 hover:text-ruby"
                    >
                      <KeyRound className="h-4 w-4" strokeWidth={1.5} />
                      Log off
                    </Link>
                  </motion.div>
                </>
              )}
            </AnimatePresence>

            <button
              onClick={() => setOperatorMenu((v) => !v)}
              title="Operator"
              className="group flex min-w-0 items-center gap-2 rounded-lg px-1 py-1"
            >
              <EntityAvatar
                seed={profile.name || "operator"}
                label={profile.name}
                style={profile.style}
                jewel={profile.jewel}
                size={24}
                className="rounded-full"
              />
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="truncate text-[14px] font-medium text-foreground">
                  {profile.name}
                </span>
                <span className="truncate font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/50">
                  {profile.role}
                </span>
              </span>
            </button>
          </div>
        </div>
      </motion.aside>

      <div className="studio-stage relative z-10 my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-white/[0.06] bg-canvas shadow-[0_8px_30px_-18px_oklch(0_0_0/0.8)]">
        {/* top bar: collapse toggle + conversation title */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {!open && (
              <button
                aria-label="Expand sidebar"
                onClick={() => setOpen(true)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-raised/60 hover:text-foreground"
                title="Expand sidebar"
              >
                <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </button>
            )}
            {pathname === "/" ? (
              <ChatTitleMenu title={title} />
            ) : (
              <span className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[15.5px] font-medium text-foreground">
                {title}
              </span>
            )}

            <ModuleTabs />
          </div>
          <div className="flex items-center gap-1">
            <AttentionBell />
            {pathname === "/" && (
              <button
                aria-label="Files in chat"
                title="Files in chat"
                onClick={() => setFilesOpen(true)}
                className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-raised/60 hover:text-foreground"
              >
                <Paperclip className="h-[17px] w-[17px]" strokeWidth={1.5} />
                {chatFiles.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-sapphire px-[3px] font-mono text-[9.5px] font-bold leading-none text-canvas shadow-[0_0_10px_-1px_var(--sapphire)]">
                    {chatFiles.length}
                  </span>
                )}
              </button>
            )}
            <button
              aria-label="Runtime monitor"
              title="Runtime monitor"
              onClick={() => setCanvas(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-raised/60 hover:text-foreground"
            >
              <PanelRight className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
          </div>
        </header>
        {access.previewing ? (
          <div className="relative z-10 flex items-center justify-between gap-3 border-b border-topaz/25 bg-[color-mix(in_oklab,var(--topaz)_9%,transparent)] px-5 py-[7px] backdrop-blur-xl">
            <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-topaz">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--topaz)", boxShadow: "0 0 10px -1px var(--topaz)" }}
              />
              Preview · rendering as {access.previewRole?.name ?? access.role?.name}
              <span className="ml-1 normal-case tracking-normal text-muted-foreground/65">
                your own grants are untouched
              </span>
            </span>
            <button
              onClick={() => exitPreview()}
              className="rounded-lg border border-topaz/40 bg-topaz/10 px-2.5 py-[3px] font-mono text-[10.5px] tracking-[0.14em] text-topaz transition-colors hover:bg-topaz/20"
            >
              EXIT PREVIEW
            </button>
          </div>
        ) : null}
        <main className="relative z-10 min-h-0 min-w-0 flex-1">
          {scopeAllowed ? children : <ScopeDenied path={pathname} role={access.role?.name} />}
        </main>
      </div>

      <RuntimeMonitor open={canvas} onClose={() => setCanvas(false)} />
      <FilesCanvas
        open={filesOpen && pathname === "/"}
        files={chatFiles}
        onClose={() => setFilesOpen(false)}
      />
    </div>
  );
}

/** Chat-only title dropdown, synced with the sidebar chat actions. */
function ChatTitleMenu({ title }: { title: string }) {
  const { active, rename, togglePin, setColor, remove } = useChats();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chat = active;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[15.5px] font-medium text-foreground transition-colors hover:bg-raised/40"
      >
        {chat?.title ?? title}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground/50 transition-transform",
            open && "rotate-180",
          )}
          strokeWidth={1.5}
        />
      </button>
      <AnimatePresence>
        {open && chat && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="glass absolute left-0 top-[calc(100%+6px)] z-[120] w-[240px] rounded-xl p-1.5"
          >
            <ChatMenuPanel
              chat={chat}
              onRename={() => {
                const next = window.prompt("Rename chat", chat.title);
                if (next) rename(chat.id, next);
              }}
              onTogglePin={() => togglePin(chat.id)}
              onSetColor={(c: ChatColor) => setColor(chat.id, c)}
              onDelete={() => remove(chat.id)}
              onClose={() => setOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const TAB_TONES = ["sapphire", "emerald", "amethyst", "topaz"] as const;

/** Four template module cards sitting next to the workspace title. */
function ModuleTabs() {
  const access = useAccess();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search }) as { view?: string };
  if (pathname === "/" || pathname === "/login" || pathname === "/account") return null;

  // Agents is squad-scoped: the header tabs are the squads themselves.
  if (pathname === "/agents") return <SquadTabs />;

  // Skills follow the same squad-scoped pattern.
  if (pathname === "/skills") return <SkillSquadTabs />;

  // Workflows: one header tab per workflow.
  if (pathname === "/flows") return <WorkflowTabs />;

  // Orchestration: one header tab per chain.
  if (pathname === "/orchestration") return <OrchestrationTabs />;

  // RBAC: one header tab per role.
  if (pathname === "/rbac") return <RoleTabs />;

  // Capabilities is squad-scoped too.
  if (pathname === "/capabilities") return <CapabilitySquadTabs />;

  // CVE feed: one header tab per watchlist.
  if (pathname === "/security") return <CveWatchlistTabs />;

  // Approval queue: status-scoped header tabs.
  if (pathname === "/approvals") {
    const av = search?.view;
    const view = av === "approved" || av === "rejected" || av === "expired" ? av : "pending";
    return (
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        {(
          [
            { id: "pending", label: "Pending", tone: "topaz" },
            { id: "approved", label: "Approved", tone: "emerald" },
            { id: "rejected", label: "Rejected", tone: "ruby" },
            { id: "expired", label: "Expired", tone: "amethyst" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            to="/approvals"
            search={{ view: t.id }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
              view === t.id
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
            />
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  // Forge Factory is kind-scoped: trigger / action / logic / output.
  if (pathname === "/factory" || pathname === "/tools") return <ForgeKindTabs />;

  // Logs / Audit is a single-surface workspace — no template tabs.
  if (pathname === "/system") return null;

  // Meta-Forge is a single ledger surface — no template tabs.
  if (pathname === "/meta-forge") return null;

  // Fleet Telemetry: cockpit views + user-made telemetry cards.
  if (pathname === "/fleet") {
    const fv = search?.view;
    const view = fv === "agents" || fv === "operators" || fv === "database" ? fv : "system";
    return <TelemetryCardTabs view={view} />;
  }

  // Memory: context layers.
  if (pathname === "/memory") {
    const mv = search?.view;
    const view = mv === "episodic" || mv === "semantic" || mv === "policy" ? mv : "working";
    return (
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        {(
          [
            { id: "working", label: "Working Set", tone: "sapphire" },
            { id: "episodic", label: "Episodic", tone: "amethyst" },
            { id: "semantic", label: "Semantic", tone: "emerald" },
            { id: "policy", label: "Policy", tone: "topaz" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            to="/memory"
            search={{ view: t.id }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
              view === t.id
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
            />
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  // Users & Groups: identity surfaces.
  if (pathname === "/users") {
    const uv = search?.view;
    const view = uv === "groups" || uv === "templates" || uv === "compliance" ? uv : "users";
    return (
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        {(
          [
            { id: "users", label: "Users", tone: "sapphire" },
            { id: "groups", label: "Groups", tone: "emerald" },
            { id: "templates", label: "Templates", tone: "amethyst" },
            { id: "compliance", label: "RBAC Compliance", tone: "topaz" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            to="/users"
            search={{ view: t.id }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
              view === t.id
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
            />
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  // Knowledge Hub surfaces: control (health + sources + retrieval + webhooks), aliases, vector forge.
  if (pathname === "/knowledge") {
    const kv = search?.view;
    const view =
      kv === "spaces" || kv === "aliases" || kv === "vector" || kv === "tuning" || kv === "prompts"
        ? kv
        : "control";
    return (
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        {(
          [
            { id: "control", label: "RAG Control", tone: "sapphire" },
            { id: "spaces", label: "Access Spaces", tone: "sapphire" },
            { id: "aliases", label: "Brand Aliases", tone: "amethyst" },
            { id: "tuning", label: "Advanced Tuning", tone: "topaz" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            to="/knowledge"
            search={{ view: t.id }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
              view === t.id
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
            />
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  // Single-surface registries — no template cards.
  if (pathname === "/runtime" || pathname === "/targets" || pathname === "/rag-documents")
    return null;

  // Models registry: model groups + Vision.
  if (pathname === "/models" || pathname === "/vision") return <ModelGroupTabs />;

  // Policy & Security surfaces, driven from the header.
  if (pathname === "/policy") {
    const pv = search?.view;
    const view =
      pv === "genguard" ||
      pv === "isolation" ||
      pv === "skill-isolation" ||
      pv === "mcp-isolation" ||
      pv === "signed" ||
      pv === "engine"
        ? pv
        : "vault";
    return (
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        {(
          [
            { id: "vault", label: "Secret Vault", tone: "sapphire" },
            { id: "genguard", label: "GenGuard", tone: "amethyst" },
            { id: "isolation", label: "Tool Isolation", tone: "emerald" },
            { id: "skill-isolation", label: "Skill Isolation", tone: "topaz" },
            { id: "mcp-isolation", label: "MCP Isolation", tone: "sapphire" },
            { id: "signed", label: "Signed Workflows", tone: "topaz" },
            { id: "engine", label: "Policy Engine", tone: "ruby" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            to="/policy"
            search={{ view: t.id }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
              view === t.id
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
            />
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  // MCP: server + client surfaces.
  if (pathname === "/mcp") {
    const view = search?.view === "client" ? "client" : "server";
    return (
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        {(
          [
            { id: "server", label: "MCP Server", tone: "sapphire" },
            { id: "client", label: "MCP Client", tone: "emerald" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            to="/mcp"
            search={{ view: t.id }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
              view === t.id
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
            />
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  // Adapters: adapters + webhooks surfaces.
  if (pathname === "/adapters") {
    const view = search?.view === "webhooks" ? "webhooks" : "adapters";
    return (
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        {(
          [
            { id: "adapters", label: "Adapters", tone: "sapphire" },
            { id: "webhooks", label: "Webhooks", tone: "topaz" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            to="/adapters"
            search={{ view: t.id }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
              view === t.id
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
            />
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  // Planner planes: tool · skill · mcp orchestration.
  if (pathname === "/planner") {
    const plane =
      (search as { plane?: string } | undefined)?.plane === "skill" ||
      (search as { plane?: string } | undefined)?.plane === "mcp"
        ? ((search as { plane?: string }).plane as string)
        : "tool";
    return (
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        {(
          [
            { id: "tool", label: "Tool Planner", tone: "emerald" },
            { id: "skill", label: "Skill Planner", tone: "sapphire" },
            { id: "mcp", label: "MCP Planner", tone: "amethyst" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            to="/planner"
            search={{ plane: t.id }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
              plane === t.id
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
            />
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  // System Engine surfaces: intent router + orchestrator bridge.
  if (pathname === "/engine") {
    const view = search?.view === "bridge" ? "bridge" : "intent";

    return (
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        {(
          [
            { id: "intent", label: "Intent Router", tone: "sapphire" },
            { id: "bridge", label: "Orchestrator Bridge", tone: "amethyst" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            to="/engine"
            search={{ view: t.id }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
              view === t.id
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
            />
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  // The library keeps the settings tab row and adds its own view toggle below.

  // Reporting: analytics surfaces.
  if (pathname.startsWith("/reporting")) {
    const reportTabs = [
      { to: "/reporting/overview", label: "Overview", tone: "sapphire" },
      { to: "/reporting/usage", label: "Usage Analytics", tone: "emerald" },
      { to: "/reporting/cost", label: "Cost & Spend", tone: "amethyst" },
      { to: "/reporting/users", label: "Operator Analytics", tone: "ruby" },
      { to: "/reporting/rag", label: "RAG Analytics", tone: "emerald" },
      { to: "/reporting/exports", label: "Scheduled Exports", tone: "topaz" },
    ] as const;
    return (
      <div className="ml-2 hidden items-center gap-1.5 md:flex">
        {reportTabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className={`flex items-center gap-2 rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
              pathname === t.to
                ? "border-white/20 bg-raised/60 text-foreground"
                : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
            }`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `var(--${t.tone})`, boxShadow: `0 0 8px -1px var(--${t.tone})` }}
            />
            {t.label}
          </Link>
        ))}
      </div>
    );
  }

  const clean = pathname.replace(/^\/+|\/+$/g, "");
  const SETTINGS_ROUTES = [
    "registry",
    "authentication",
    "converter",
    "services",
    "certificates",
    "mail",
    "siem",
    "telemetry-sources",
    "vision-audio",
    "backup",
    "theme",
  ];
  const section = clean.startsWith("w/")
    ? clean.split("/")[1]!
    : clean === "vision"
      ? "models"
      : SETTINGS_ROUTES.includes(clean)
        ? "settings"
        : clean.replace(/\//g, "-");
  const label =
    allItems.find((i) => i.to === "/" + section.replace(/-/g, "/"))?.label ??
    section.charAt(0).toUpperCase() + section.slice(1);
  if (!section) return null;

  const isCard = clean.startsWith("w/") || clean === "vision";

  const settingsTabs = [
    { to: "/settings", label: "Settings", tone: "platinum" },
    { to: "/registry", label: "Capability Registry", tone: "sapphire" },
    { to: "/authentication", label: "Authentication", tone: "emerald" },
    { to: "/converter", label: "Global Converter", tone: "amethyst" },
    { to: "/services", label: "Services", tone: "topaz" },
    { to: "/certificates", label: "Certificates", tone: "emerald" },
    { to: "/mail", label: "Mail & Time", tone: "sapphire" },
    { to: "/siem", label: "SIEM", tone: "amethyst" },
    { to: "/telemetry-sources", label: "Telemetry Sources", tone: "sapphire" },
    { to: "/vision-audio", label: "Vision Audio", tone: "topaz" },
    { to: "/backup", label: "Backup & Restore", tone: "ruby" },
    { to: "/theme", label: "Theme", tone: "emerald" },
  ] as const;

  const tabCls = (active: boolean) =>
    `group flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-[5px] text-[13px] font-medium transition-all duration-150 ease-in-out ${
      active
        ? "border-white/20 bg-raised/60 text-foreground"
        : "border-white/[0.06] bg-raised/25 text-muted-foreground/80 hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
    }`;

  return (
    <div className="no-scrollbar ml-2 hidden min-w-0 flex-1 items-center gap-1.5 overflow-x-auto md:flex">
      {isCard && (
        <Link
          to={"/" + section.replace(/-/g, "/")}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-raised/25 px-2.5 py-[5px] text-[13px] font-medium text-muted-foreground/80 transition-all duration-150 ease-in-out hover:border-sapphire/40 hover:bg-raised/50 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.6} />
          {label}
        </Link>
      )}
      {section === "settings"
        ? settingsTabs
            .filter((t) => access.allows(t.to))
            .map((t) => (
              <Link key={t.to} to={t.to} className={tabCls(clean === t.to.slice(1))}>
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: `var(--${t.tone})`,
                    boxShadow: `0 0 8px -1px var(--${t.tone})`,
                  }}
                />
                {t.label}
              </Link>
            ))
        : section === "planner"
          ? null
          : TAB_TONES.map((tone, i) => {
              const vision = section === "models" && i === 0;
              const active = vision && clean === "vision";
              return (
                <Link
                  key={i}
                  {...(vision
                    ? ({ to: "/vision" } as const)
                    : ({
                        to: "/w/$section/$card",
                        params: { section, card: `${section}-${i + 1}` },
                      } as const))}
                  className={tabCls(active)}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: `var(--${tone})`,
                      boxShadow: `0 0 8px -1px var(--${tone})`,
                    }}
                  />
                  {vision ? "Vision" : `${label} ${i + 1}`}
                </Link>
              );
            })}
    </div>
  );
}

/** Collapsible sidebar group header: per-header dot wave + letter-by-letter shimmer. */
function GroupHeader({
  label,
  expanded,
  showDots = true,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  showDots?: boolean;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <button
      onClick={() => onToggle()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-expanded={expanded}
      className="relative mt-3 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[16px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/65 transition-colors hover:text-foreground/90"
    >
      {showDots && (
        <span className="relative flex items-center gap-[3px]">
          {[0, 1].map((d) => (
            <motion.span
              key={d}
              className="h-[3px] w-[3px] rounded-full bg-current"
              initial={false}
              animate={
                hover
                  ? {
                      y: [0, -3.5, 0],
                      scale: [1, 1.15, 1],
                      opacity: [0.6, 1, 0.75],
                      color: "var(--sapphire)",
                    }
                  : { y: 0, scale: 1, opacity: 0.6, color: "#94a3b8" }
              }
              transition={
                hover
                  ? {
                      duration: 0.9,
                      ease: "easeInOut",
                      repeat: Infinity,
                      repeatDelay: 0.1,
                      delay: d * 0.11,
                    }
                  : { duration: 0.16, ease: "easeInOut" }
              }
            />
          ))}
        </span>
      )}

      <ShimmerLabel label={label} hover={hover} />

      <motion.span
        animate={{ rotate: expanded ? 0 : -90 }}
        transition={{ duration: 0.16, ease: "easeInOut" }}
        className="relative inline-flex"
      >
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
      </motion.span>
    </button>
  );
}

/** Letter-by-letter sapphire shimmer, shared by group headers and quick actions. */
function ShimmerLabel({ label, hover }: { label: string; hover: boolean }) {
  return (
    <span className="relative inline-flex items-center">
      {label.split("").map((char, i) => (
        <motion.span
          key={i}
          aria-hidden={char === " "}
          initial={false}
          animate={
            hover
              ? {
                  y: [0, -2.5, 0],
                  scale: [1, 1.12, 1],
                  color: ["#94a3b8", "#dbeafe", "#94a3b8"],
                  textShadow: [
                    "0 0 0px rgba(59,130,246,0)",
                    "0 0 12px rgba(96,165,250,0.95), 0 0 26px rgba(59,130,246,0.55)",
                    "0 0 0px rgba(59,130,246,0)",
                  ],
                }
              : {
                  y: 0,
                  scale: 1,
                  color: "#94a3b8",
                  textShadow: "0 0 0px rgba(59,130,246,0)",
                }
          }
          transition={
            hover
              ? {
                  duration: 0.75,
                  ease: "easeInOut",
                  repeat: Infinity,
                  repeatDelay: label.length * 0.055,
                  delay: i * 0.055,
                }
              : { duration: 0.16, ease: "easeInOut" }
          }
          className={cn("inline-block", char === " " && "w-[0.3em]")}
        >
          {char === " " ? "\u00A0" : char}
        </motion.span>
      ))}
    </span>
  );
}

/** New chat / Search / Console rows with the same animated identity as group headers. */
function QuickAction({
  icon: Icon,
  label,
  to,
  onClick,
  hint,
}: {
  icon: typeof Search;
  label: string;
  to?: string;
  onClick?: () => void;
  hint?: string;
}) {
  const [hover, setHover] = useState(false);
  const inner = (
    <>
      <span className="flex items-center gap-2.5">
        <motion.span
          whileHover={iconHover}
          animate={hover ? iconHover : {}}
          className="inline-flex"
        >
          <Icon
            className={cn(
              "h-[18px] w-[18px] transition-colors duration-150",
              hover ? "text-sapphire" : "text-muted-foreground/70",
            )}
            strokeWidth={1.5}
          />
        </motion.span>
        <ShimmerLabel label={label} hover={hover} />
      </span>
      {hint && (
        <span className="font-mono text-[11.5px] font-medium text-muted-foreground/55">{hint}</span>
      )}
    </>
  );
  const cls =
    "group flex w-full items-center justify-between px-2.5 py-2 text-[15.5px] font-medium text-foreground transition-colors";

  return to ? (
    <Link
      to={to}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cls}
    >
      {inner}
    </Link>
  ) : (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cls}
    >
      {inner}
    </button>
  );
}

/** Rendered instead of a route body when the active role lacks its scope. */
function ScopeDenied({ path, role }: { path: string; role?: string | undefined }) {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="max-w-[460px] rounded-2xl border border-ruby/25 bg-ruby/[0.04] p-8 text-center shadow-[0_0_60px_-40px_var(--ruby)]">
        <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl border border-ruby/35">
          <ShieldAlert className="h-5 w-5 text-ruby" strokeWidth={1.6} />
        </div>
        <h2 className="font-mono text-[13px] uppercase tracking-[0.16em] text-ruby">
          Scope denied
        </h2>
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground/75">
          The active role{role ? ` "${role}"` : ""} does not hold the scope for{" "}
          <span className="font-mono text-foreground/85">{path}</span>. The refusal was written to
          the audit journal and the live debug console.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-raised/40 px-4 py-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-foreground/85 transition-colors hover:border-sapphire/45 hover:text-sapphire"
        >
          Back to chat
        </Link>
      </div>
    </div>
  );
}
