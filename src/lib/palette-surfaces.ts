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
    ["control", "RAG Control"],
    ["spaces", "Access Spaces"],
    ["aliases", "Brand Aliases"],
    ["vector", "Vector Forge (RAG)"],
    ["tuning", "Advanced Tuning"],
    ["prompts", "Advanced System Prompt"],
  ]),
  ...views("/users", "Users & Groups", "view", [
    ["users", "Users"],
    ["groups", "Groups"],
    ["templates", "Templates"],
    ["compliance", "RBAC Compliance"],
  ]),
  ...views("/memory", "Memory", "view", [
    ["working", "Working Set"],
    ["episodic", "Episodic"],
    ["semantic", "Semantic"],
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
    ["genguard", "GenGuard"],
    ["isolation", "Tool Isolation"],
    ["skill-isolation", "Skill Isolation"],
    ["mcp-isolation", "MCP Isolation"],
    ["signed", "Signed Workflows"],
    ["engine", "Policy Engine"],
  ]),
  ...views("/mcp", "MCP", "view", [
    ["server", "MCP Server"],
    ["client", "MCP Client"],
  ]),
  ...views("/engine", "System Engine", "view", [
    ["runtime", "Runtime"],
    ["intent", "Intent Router"],
    ["bridge", "Orchestrator Bridge"],
    ["console", "Live Console"],
  ]),
  ...views("/planner", "Planner", "plane", [
    ["tool", "Tool Planner"],
    ["skill", "Skill Planner"],
    ["mcp", "MCP Planner"],
  ]),
];
