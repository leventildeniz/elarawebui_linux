/**
 * Secondary surfaces (header tabs / views) exposed to the command palette so
 * operators can jump straight to a panel such as "Access Spaces" instead of
 * only reaching the parent module.
 */
export type PaletteSurface = {
  label: string;
  to: string;
  group: string;
  search: Record<string, string>;
};

const views = (
  to: string,
  group: string,
  key: string,
  items: ReadonlyArray<[string, string]>,
): PaletteSurface[] => items.map(([id, label]) => ({ to, group, label, search: { [key]: id } }));

export const paletteSurfaces: PaletteSurface[] = [
  ...views("/knowledge", "Knowledge Hub", "view", [
    ["control", "RAG Control & Health"],
    ["spaces", "Access Spaces"],
    ["aliases", "Brand Aliases"],
    ["tuning", "Advanced Tuning"],
  ]),
  ...views("/settings", "Settings", "tab", [
    ["providers", "AI Providers & Routing"],
    ["registry", "Capability Registry"],
    ["auth", "Authentication & Directories"],
    ["converter", "Global Converter"],
    ["services", "Services & Search Providers"],
    ["certs", "Certificates & TLS"],
    ["mail", "Mail & Time Servers"],
    ["siem", "SIEM & Logging"],
    ["telemetry", "Telemetry Sources"],
    ["vision", "Vision & Audio Services"],
    ["backup", "Backup & Restore"],
    ["theme", "Theme & Styling"],
  ]),
  ...views("/system", "Logs / Audit", "tab", [
    ["live", "Live Debugging Stream"],
    ["audit", "Audit Journal"],
    ["siem", "SIEM Event Collector"],
    ["compliance", "Compliance & Certification"],
    ["cve", "CVE & Security Advisory"],
  ]),
  ...views("/users", "Users & Groups", "view", [
    ["users", "Users"],
    ["groups", "Groups"],
    ["templates", "Templates"],
    ["compliance", "RBAC Compliance"],
  ]),
  ...views("/memory", "Memory", "view", [
    ["working", "Working Set"],
    ["episodic", "Episodic Memory"],
    ["semantic", "Semantic Facts"],
    ["policy", "Policy Memory"],
  ]),
  ...views("/approvals", "Approval Queue", "view", [
    ["pending", "Pending Approvals"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
    ["expired", "Expired"],
  ]),
  ...views("/policy", "Policy & Security", "view", [
    ["vault", "Secret Vault"],
    ["genguard", "GenGuard Rules"],
    ["isolation", "Tool Isolation"],
    ["skill-isolation", "Skill Isolation"],
    ["mcp-isolation", "MCP Isolation"],
    ["signed", "Signed Workflows"],
    ["engine", "Policy Engine"],
  ]),
  ...views("/mcp", "MCP Hub", "view", [
    ["server", "MCP Server"],
    ["client", "MCP Client"],
  ]),
  ...views("/engine", "System Engine", "view", [
    ["intent", "Intent Router"],
    ["bridge", "Orchestrator Bridge"],
  ]),
  ...views("/planner", "Planner", "plane", [
    ["tool", "Tool Planner"],
    ["skill", "Skill Planner"],
    ["mcp", "MCP Planner"],
  ]),
];
