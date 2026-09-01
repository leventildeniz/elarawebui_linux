// MCP tab — Server + Client cards (Model Context Protocol control panel).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell, PageHeader } from "@/components/page-shell";
import { useRbac } from "@/lib/rbac";
import { Router, ShieldCheck, ShieldOff } from "lucide-react";
import { McpServerCard } from "@/components/mcp-server-card";
import { McpClientCard } from "@/components/mcp-client-card";

export const Route = createFileRoute("/_app/mcp")({ component: McpPage });

function McpPage() {
  const { isAdmin } = useRbac();
  const [tab, setTab] = useState<"server" | "client">("server");

  if (!isAdmin) {
    return (
      <PageShell>
        <PageHeader title="MCP" subtitle="Admin only — Model Context Protocol server & client" />
        <p className="text-xs font-mono text-muted-foreground">
          You don't have permission to view this page.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="MCP"
        subtitle="Model Context Protocol · expose the AI model's agents/tools/skills over MCP or connect to external MCP servers"
        actions={
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <Router className="h-3.5 w-3.5 text-primary" /> Admin
          </span>
        }
      />
      <div className="mb-4 flex gap-2 border-b border-border/40">
        <TabBtn active={tab === "server"} onClick={() => setTab("server")} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
          MCP Server
        </TabBtn>
        <TabBtn active={tab === "client"} onClick={() => setTab("client")} icon={<ShieldOff className="h-3.5 w-3.5" />}>
          MCP Client
        </TabBtn>
      </div>
      {tab === "server" ? <McpServerCard /> : <McpClientCard />}
    </PageShell>
  );
}

function TabBtn({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-wider transition ${
        active
          ? "border-b-2 border-primary text-primary"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
