import type { KnowledgeSpace } from "@/lib/knowledge-space-store";
import type { StudioAgent } from "@/lib/agent-store";
import type { JewelName } from "@/lib/avatar-library";

/**
 * RAG agents — one librarian per knowledge space.
 *
 * Binding retrieval to an *agent* instead of a model puts the permission
 * boundary inside the identity: a space-bound agent can only ever reach its
 * own space, and the caller's readable spaces still intersect on top. The
 * agent therefore NARROWS access, it can never widen it.
 */

/** Read-only tool floor every RAG agent is sealed with. */
export const RAG_AGENT_TOOLS = ["vector.search", "web.fetch"];
export const RAG_AGENT_SKILLS = ["markdown-report"];

/** Tools a space-bound librarian may never hold — write / exec / secret planes. */
const FORBIDDEN = /^(fs\.|ssh\.|sql\.|vault\.)|write|exec|delete|deploy|patch/i;

export function isDestructiveTool(tool: string) {
  return FORBIDDEN.test(tool);
}

/** Title-case a space name into an agent identity: Technical → Technical_Librarian. */
export function ragAgentName(space: KnowledgeSpace) {
  const base = (space.name || space.slug || "space")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}_Librarian`;
}

const toneToJewel: Record<string, JewelName> = {
  sapphire: "sapphire",
  emerald: "emerald",
  amethyst: "amethyst",
  topaz: "topaz",
  ruby: "ruby",
};

/** System prompt skeleton — space description + the three librarian laws. */
export function ragSystemPrompt(space: KnowledgeSpace) {
  const domain = space.description?.trim() || `the ${space.name} knowledge domain`;
  return [
    `You are ${ragAgentName(space)}, the retrieval librarian of the "${space.name}" knowledge space.`,
    ``,
    `Domain: ${domain}`,
    ``,
    `Laws:`,
    `1. Answer only from documents inside the ${space.name} space. Never speculate beyond retrieved evidence.`,
    `2. Cite every claim with the source file and location. No citation, no claim.`,
    `3. If the space holds no answer, say so plainly and name what document would be needed.`,
    `4. You are read-only. You never write, execute or mutate anything.`,
  ].join("\n");
}

/** Full agent draft derived from a space — no manual configuration required. */
export function deriveRagAgent(space: KnowledgeSpace): Omit<StudioAgent, "id" | "createdAt"> {
  const name = ragAgentName(space);
  const jewel = toneToJewel[space.tone] ?? "sapphire";
  return {
    name,
    squad: "Knowledge",
    role: "Librarian",
    description: `Read-only retrieval agent bound to the ${space.name} knowledge space.`,
    systemPrompt: ragSystemPrompt(space),
    modelId: "gemma4-31b-it-6bit",
    provider: "Local · legacy",
    runtimePath: "/opt/elara/local-server/.venv/bin/python · Python 3.12.13",
    scriptPath: `/opt/elara/agents/knowledge/${space.slug || "space"}.py`,
    bridgeHost: "http://localhost",
    port: "3005",
    healthEndpoint: "/api/health",
    thinking: false,
    enabled: true,
    live: true,
    priority: 5,
    stopGraceMs: 5000,
    temperature: 0.15,
    topP: 0.85,
    repetitionPenalty: 1.2,
    maxTokens: 4096,
    contextWindow: 8192,
    stopSequences: [],
    customParams: [],
    skills: [...RAG_AGENT_SKILLS],
    tools: [...RAG_AGENT_TOOLS],
    adapters: [],
    targets: [],
    mcpServers: [],
    packs: [],
    rag: true,
    ragSpaceId: space.id,
    ragBrands: [],
    ragKeywords: [space.slug, ...space.name.toLowerCase().split(/\s+/)].filter(Boolean).join(", "),
    icon: "Library",
    avatar: { seed: `${space.slug || space.id}-librarian`, style: "sigil", jewel },
    stats: { calls: 0, success: 100, latencyMs: 0 },
  };
}
