export type Jewel = "sapphire" | "emerald" | "amethyst" | "topaz" | "ruby";

/** Full agent roster shown on /fleet. */
export const fleetAgents = [
  {
    id: "agt_0x91f",
    name: "Atlas Router",
    model: "gpt-5.2",
    tone: "sapphire",
    load: 62,
    p95: "412 ms",
    state: "streaming",
  },
  {
    id: "agt_0x4c2",
    name: "Vault Auditor",
    model: "claude-4.7",
    tone: "emerald",
    load: 34,
    p95: "268 ms",
    state: "idle",
  },
  {
    id: "agt_0x77a",
    name: "Signal Synth",
    model: "llama-4-405b",
    tone: "amethyst",
    load: 81,
    p95: "934 ms",
    state: "saturated",
  },
  {
    id: "agt_0x0de",
    name: "Ledger Guard",
    model: "mistral-lg",
    tone: "topaz",
    load: 19,
    p95: "141 ms",
    state: "idle",
  },
  {
    id: "agt_0xa30",
    name: "Cipher Warden",
    model: "gpt-5.2-mini",
    tone: "ruby",
    load: 7,
    p95: "88 ms",
    state: "standby",
  },
] as const;

export const fleetMeta = "5 agents · 3 regions · autoscale on";

/** Condensed fleet used inside the runtime canvas overlay. */
export const runtimeFleet = [
  { id: "agt_0x91f", name: "Atlas Router", model: "gpt-5.2", tone: "sapphire", load: 62 },
  { id: "agt_0x4c2", name: "Vault Auditor", model: "claude-4.7", tone: "emerald", load: 34 },
  { id: "agt_0x77a", name: "Signal Synth", model: "llama-4-405b", tone: "amethyst", load: 81 },
  { id: "agt_0x0de", name: "Ledger Guard", model: "mistral-lg", tone: "topaz", load: 19 },
] as const;

/** Telemetry rows in the runtime canvas. */
export const runtimeTelemetry: { label: string; value: string; tone?: Jewel }[] = [
  { label: "throughput", value: "12.4k tok/s", tone: "sapphire" },
  { label: "p95 latency", value: "412 ms" },
  { label: "policy blocks", value: "0", tone: "emerald" },
  { label: "spend / hr", value: "$4.18", tone: "topaz" },
];

/** Model registry rows on /models. */
export const models = [
  { id: "gpt-5.2", vendor: "openai", ctx: "400k", cost: "$4.20", share: 46, tone: "sapphire" },
  { id: "claude-4.7", vendor: "anthropic", ctx: "1M", cost: "$6.00", share: 28, tone: "emerald" },
  {
    id: "llama-4-405b",
    vendor: "self-hosted",
    ctx: "256k",
    cost: "$0.90",
    share: 18,
    tone: "amethyst",
  },
  { id: "mistral-lg", vendor: "mistral", ctx: "128k", cost: "$2.10", share: 8, tone: "topaz" },
] as const;

export const modelsMeta = "4 connected · routing by cost + latency";

/** Orchestration pipelines on /flows. */
export const flows = [
  {
    name: "Inbound Triage",
    tone: "sapphire",
    runs: "1,204",
    stages: ["ingest", "classify", "route", "respond"],
    health: "nominal",
  },
  {
    name: "Nightly Ledger Audit",
    tone: "emerald",
    runs: "31",
    stages: ["snapshot", "diff", "verify", "sign"],
    health: "nominal",
  },
  {
    name: "Signal Digest",
    tone: "amethyst",
    runs: "486",
    stages: ["collect", "cluster", "summarize"],
    health: "degraded",
  },
] as const;

export const flowsMeta = "3 pipelines · 1,721 runs / 24h";
