import type { WorkspaceSpec } from "@/components/sovereign/workspace-page";

/** Placeholder workspace surfaces. Swap for API data later. */
export const workspaceSpecs = {
  agents: {
    title: "Agents",
    meta: "fleet roster · 12 agents · 4 supervisors",
    description:
      "Provision, supervise and retire autonomous agents. Every agent carries a signed identity, a scoped toolset and its own escalation path.",
    panels: [
      { id: "agt.atlas.router", label: "Primary routing agent", value: "online", tone: "emerald" },
      {
        id: "agt.vault.auditor",
        label: "Ledger + spend auditor",
        value: "online",
        tone: "emerald",
      },
      { id: "agt.signal.synth", label: "Synthesis worker pool", value: "degraded", tone: "topaz" },
      { id: "agt.ledger.guard", label: "Policy enforcement", value: "idle", tone: "sapphire" },
    ],
  },
  approvals: {
    title: "Approval Queue",
    meta: "3 awaiting review · oldest 12 min",
    description:
      "Human-in-the-loop gate. Any action a policy marks as sensitive waits here until an authorised reviewer signs it off.",
    panels: [
      { id: "apr.0x88", label: "Shell exec on tgt.warehouse", value: "waiting", tone: "topaz" },
      { id: "apr.0x87", label: "Spend ceiling override", value: "waiting", tone: "topaz" },
      { id: "apr.0x86", label: "New MCP server trust", value: "waiting", tone: "topaz" },
      { id: "apr.0x85", label: "Bulk document purge", value: "approved", tone: "emerald" },
    ],
  },
  capabilities: {
    title: "Capabilities & Adapters",
    meta: "11 adapters · 3 vendors",
    description:
      "Connection capabilities and the adapters that translate between the studio and external providers or transports.",
    panels: [
      { id: "adp.openai", label: "Chat + embeddings", value: "healthy", tone: "emerald" },
      { id: "adp.anthropic", label: "Chat + tool use", value: "healthy", tone: "emerald" },
      { id: "adp.vllm", label: "Self-hosted inference", value: "healthy", tone: "emerald" },
      { id: "adp.webhook", label: "Outbound eventing", value: "degraded", tone: "topaz" },
    ],
  },
  engine: {
    title: "System Engine",
    meta: "core · uptime 41d · scheduler nominal",
    description:
      "Core engine management: scheduler, queues, concurrency limits and the failure semantics that govern every run.",
    panels: [
      { id: "eng.scheduler", label: "Fair-share dispatcher", value: "nominal", tone: "emerald" },
      { id: "eng.queue.depth", label: "Pending work items", value: "14", tone: "sapphire" },
      { id: "eng.concurrency", label: "Parallel run ceiling", value: "32", tone: "amethyst" },
      { id: "eng.retry", label: "Backoff policy", value: "exp 5x", tone: "topaz" },
    ],
  },
  knowledge: {
    title: "Knowledge / RAG",
    meta: "6 collections · 84k documents",
    description:
      "Retrieval layer: intent classification, document ingestion pipelines and the vector indexes behind every grounded answer.",
    panels: [
      { id: "kb.contracts", label: "Legal corpus", value: "31k docs", tone: "sapphire" },
      { id: "kb.runbooks", label: "Operational runbooks", value: "9k docs", tone: "emerald" },
      { id: "kb.research", label: "External research feed", value: "38k docs", tone: "amethyst" },
      { id: "intent.classifier", label: "Routing classifier", value: "v4", tone: "topaz" },
    ],
  },
  mcp: {
    title: "MCP",
    meta: "4 servers · 19 exposed tools",
    description:
      "Model Context Protocol servers connected to the studio, with the tools and resources each one exposes to the fleet.",
    panels: [
      {
        id: "mcp.filesystem",
        label: "Scoped workspace access",
        value: "connected",
        tone: "emerald",
      },
      { id: "mcp.github", label: "Repository + issue tools", value: "connected", tone: "emerald" },
      { id: "mcp.postgres", label: "Read-only warehouse", value: "connected", tone: "emerald" },
      { id: "mcp.internal", label: "In-house service bridge", value: "handshake", tone: "topaz" },
    ],
  },
  memory: {
    title: "Memory",
    meta: "4 stores · 1.2M vectors · 38 GB",
    description:
      "System memory and context management: episodic traces, long-term stores and the compaction rules that keep context sharp.",
    panels: [
      { id: "mem.episodic", label: "Per-run conversation traces", value: "842k", tone: "sapphire" },
      { id: "mem.semantic", label: "Distilled long-term facts", value: "291k", tone: "amethyst" },
      { id: "mem.entity", label: "Entity + relation graph", value: "64k", tone: "emerald" },
      { id: "mem.scratch", label: "Ephemeral working memory", value: "flush 1h", tone: "topaz" },
    ],
  },
  meta_forge: {
    title: "Meta-Forge",
    meta: "self-evolving · 3 proposals pending",
    description:
      "The system improving itself: generated proposals for new skills, prompts and routing strategies, each gated behind review.",
    panels: [
      { id: "mf.prop.0x12", label: "Add caching layer to router", value: "pending", tone: "topaz" },
      { id: "mf.prop.0x13", label: "Split synth agent into two", value: "pending", tone: "topaz" },
      { id: "mf.prop.0x11", label: "Tighten redaction prompt", value: "merged", tone: "emerald" },
      { id: "mf.prop.0x0f", label: "Swap embedding model", value: "rejected", tone: "ruby" },
    ],
  },
  middleware: {
    title: "Middleware & Templates",
    meta: "9 middlewares · 14 templates",
    description:
      "Request middlewares and reusable templates applied across runs: rewriting, guarding, logging and shaping every call.",
    panels: [
      { id: "mw.redact", label: "PII redaction", value: "enabled", tone: "emerald" },
      { id: "mw.ratelimit", label: "Per-principal throttling", value: "enabled", tone: "emerald" },
      { id: "mw.trace", label: "Distributed tracing", value: "enabled", tone: "emerald" },
      { id: "tpl.report", label: "Executive report template", value: "v3", tone: "sapphire" },
    ],
  },
  orchestration: {
    title: "Orchestration",
    meta: "command center · 3 live runs · 0 stalled",
    description:
      "The command center for every run in the system: dispatch, supervise, pause and replay orchestrations across the whole fleet.",
    panels: [
      { id: "run.0x41ac", label: "Nightly index rebuild", value: "running", tone: "sapphire" },
      { id: "run.0x41ad", label: "Contract diff sweep", value: "running", tone: "sapphire" },
      { id: "run.0x41ae", label: "Spend reconciliation", value: "queued", tone: "topaz" },
      { id: "run.0x41a9", label: "Redaction pass", value: "done", tone: "emerald" },
    ],
  },
  planner: {
    title: "Planner",
    meta: "7 plans · 24 tasks · 3 blocked",
    description:
      "Decomposition and task distribution. Plans are generated, reviewed and dispatched to the agents best suited for each step.",
    panels: [
      {
        id: "plan.migrate.rag",
        label: "Vector store migration",
        value: "6 tasks",
        tone: "sapphire",
      },
      {
        id: "plan.audit.q3",
        label: "Quarterly security audit",
        value: "9 tasks",
        tone: "amethyst",
      },
      { id: "plan.cost.trim", label: "Routing cost reduction", value: "5 tasks", tone: "emerald" },
      { id: "plan.onboard.mcp", label: "MCP server onboarding", value: "4 tasks", tone: "topaz" },
    ],
  },
  rbac: {
    title: "RBAC",
    meta: "4 roles · 18 principals",
    description:
      "Role-based access control: what each principal may see, run, approve or change inside the studio.",
    panels: [
      { id: "role.owner", label: "Full sovereign control", value: "2", tone: "ruby" },
      { id: "role.operator", label: "Run + supervise fleet", value: "6", tone: "sapphire" },
      { id: "role.reviewer", label: "Approve gated actions", value: "4", tone: "amethyst" },
      { id: "role.viewer", label: "Read-only access", value: "6", tone: "emerald" },
    ],
  },
  reporting_cost: {
    title: "Cost & Spend",
    meta: "reporting · finops",
    description: "Spend attribution across models, fleets and tenants with budget guardrails.",
    panels: [
      { id: "rep.cost.01", label: "Last generated", value: "2 h ago", tone: "sapphire" },
      { id: "rep.cost.02", label: "Coverage window", value: "30 d", tone: "amethyst" },
      { id: "rep.cost.03", label: "Delivery status", value: "healthy", tone: "emerald" },
      { id: "rep.cost.04", label: "Pending refresh", value: "queued", tone: "topaz" },
    ],
  },
  reporting_exports: {
    title: "Scheduled Exports",
    meta: "reporting · delivery",
    description: "Recurring report deliveries to warehouses, object storage and mail groups.",
    panels: [
      { id: "rep.exports.01", label: "Last generated", value: "2 h ago", tone: "sapphire" },
      { id: "rep.exports.02", label: "Coverage window", value: "30 d", tone: "amethyst" },
      { id: "rep.exports.03", label: "Delivery status", value: "healthy", tone: "emerald" },
      { id: "rep.exports.04", label: "Pending refresh", value: "queued", tone: "topaz" },
    ],
  },
  reporting_overview: {
    title: "Reporting Overview",
    meta: "reporting · rollup",
    description: "Cross-workspace rollup of orchestration volume, spend and policy outcomes.",
    panels: [
      { id: "rep.overview.01", label: "Last generated", value: "2 h ago", tone: "sapphire" },
      { id: "rep.overview.02", label: "Coverage window", value: "30 d", tone: "amethyst" },
      { id: "rep.overview.03", label: "Delivery status", value: "healthy", tone: "emerald" },
      { id: "rep.overview.04", label: "Pending refresh", value: "queued", tone: "topaz" },
    ],
  },
  reporting_usage: {
    title: "Usage Analytics",
    meta: "reporting · usage",
    description: "Token, request and agent utilisation broken down by model, team and workload.",
    panels: [
      { id: "rep.usage.01", label: "Last generated", value: "2 h ago", tone: "sapphire" },
      { id: "rep.usage.02", label: "Coverage window", value: "30 d", tone: "amethyst" },
      { id: "rep.usage.03", label: "Delivery status", value: "healthy", tone: "emerald" },
      { id: "rep.usage.04", label: "Pending refresh", value: "queued", tone: "topaz" },
    ],
  },
  runtime: {
    title: "Python Runtime",
    meta: "2 sandboxes · 512 MB each",
    description:
      "Isolated Python workspaces for custom scripts, transforms and one-off analysis, with no outbound network unless granted.",
    panels: [
      { id: "py.sandbox.a", label: "Analysis sandbox", value: "idle", tone: "sapphire" },
      { id: "py.sandbox.b", label: "Transform sandbox", value: "running", tone: "emerald" },
      { id: "py.pkg.index", label: "Pinned package index", value: "412 pkgs", tone: "amethyst" },
      { id: "py.egress", label: "Outbound network", value: "denied", tone: "ruby" },
    ],
  },
  security: {
    title: "CVE Feed / Audit",
    meta: "0 critical · 2 medium · scan 3h ago",
    description:
      "Vulnerability feed and security audit trail across dependencies, adapters and runtime images.",
    panels: [
      { id: "cve.2026-3311", label: "Transitive parser advisory", value: "medium", tone: "topaz" },
      { id: "cve.2026-3208", label: "Sandbox image base layer", value: "medium", tone: "topaz" },
      { id: "audit.deps", label: "Dependency scan", value: "clean", tone: "emerald" },
      { id: "audit.secrets", label: "Secret exposure scan", value: "clean", tone: "emerald" },
    ],
  },
  skills: {
    title: "Skills",
    meta: "28 skills · 6 domains",
    description:
      "Composed capabilities the fleet can invoke: each skill bundles prompts, tool scopes and guardrails into one callable procedure.",
    panels: [
      {
        id: "skill.web.research",
        label: "Multi-source research",
        value: "stable",
        tone: "emerald",
      },
      { id: "skill.sql.analyst", label: "Warehouse querying", value: "stable", tone: "emerald" },
      { id: "skill.shell.exec", label: "Sandboxed shell access", value: "gated", tone: "ruby" },
      { id: "skill.doc.extract", label: "Structured extraction", value: "beta", tone: "topaz" },
    ],
  },
  tools: {
    title: "Tools",
    meta: "41 tool definitions · 12 scopes",
    description:
      "Raw tool contracts exposed to agents: typed input schemas, permission scopes, rate limits and the adapters they bind to.",
    panels: [
      { id: "tool.http.fetch", label: "Outbound HTTP fetch", value: "scoped", tone: "sapphire" },
      { id: "tool.sql.query", label: "Read-only SQL query", value: "stable", tone: "emerald" },
      { id: "tool.fs.write", label: "Sandbox file write", value: "gated", tone: "ruby" },
      { id: "tool.vector.search", label: "Vector index search", value: "stable", tone: "amethyst" },
    ],
  },

  targets: {
    title: "Targets",
    meta: "5 targets · 2 regions",
    description:
      "Destination systems and connection endpoints the fleet is allowed to reach, with their credentials and health.",
    panels: [
      { id: "tgt.warehouse", label: "Analytics warehouse", value: "eu-west", tone: "sapphire" },
      { id: "tgt.objectstore", label: "Artifact storage", value: "eu-west", tone: "sapphire" },
      { id: "tgt.crm", label: "Customer system", value: "us-east", tone: "amethyst" },
      { id: "tgt.pager", label: "Escalation channel", value: "global", tone: "topaz" },
    ],
  },
  users: {
    title: "Users & Groups",
    meta: "18 users · 5 groups",
    description:
      "Identity management: who belongs to the studio, which groups they sit in and how their sessions are governed.",
    panels: [
      { id: "grp.platform", label: "Platform engineering", value: "6", tone: "sapphire" },
      { id: "grp.security", label: "Security + compliance", value: "4", tone: "ruby" },
      { id: "grp.research", label: "Research", value: "5", tone: "amethyst" },
      { id: "grp.observers", label: "External observers", value: "3", tone: "emerald" },
    ],
  },
  factory: {
    title: "Forge Factory",
    meta: "assembly line · 4 pipelines · 2 running",
    description:
      "Where new agents, skills and capabilities are assembled from blueprints, built, tested and shipped into the fleet.",
    panels: [
      { id: "fac.blueprints", label: "Registered blueprints", value: "23", tone: "sapphire" },
      { id: "fac.build.queue", label: "Build queue", value: "2 running", tone: "topaz" },
      { id: "fac.tests", label: "Verification suites", value: "passing", tone: "emerald" },
      { id: "fac.releases", label: "Shipped this week", value: "7", tone: "amethyst" },
    ],
  },
  adapters: {
    title: "Adapters",
    meta: "transport layer · 11 adapters · 1 degraded",
    description:
      "Protocol adapters that bridge MCP servers, vendor APIs and internal transports into a single calling convention for the fleet.",
    panels: [
      { id: "adp.mcp.bridge", label: "MCP transport bridge", value: "healthy", tone: "emerald" },
      { id: "adp.http", label: "HTTP / REST adapter", value: "healthy", tone: "emerald" },
      { id: "adp.grpc", label: "gRPC adapter", value: "healthy", tone: "sapphire" },
      { id: "adp.legacy.soap", label: "Legacy SOAP shim", value: "degraded", tone: "topaz" },
    ],
  },
} satisfies Record<string, WorkspaceSpec>;
