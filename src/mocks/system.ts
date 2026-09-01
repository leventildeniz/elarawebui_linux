import type { Jewel } from "./fleet";

/** /system — identity + capacity rows and the live journal. */
export const systemMeta = "build 2026.08.15 · eu-central · uptime 41d 06h";

export const systemIdentity: { label: string; value: string; tone?: Jewel }[] = [
  { label: "instance", value: "sov-prod-01" },
  { label: "region", value: "eu-central-1", tone: "sapphire" },
  { label: "attestation", value: "verified", tone: "emerald" },
  { label: "key rotation", value: "in 6d", tone: "topaz" },
];

export const systemCapacity: { label: string; value: string; tone?: Jewel }[] = [
  { label: "gpu pool", value: "48 / 64" },
  { label: "queue depth", value: "812" },
  { label: "spend / hr", value: "$4.18", tone: "topaz" },
];

export const systemJournal = [
  { t: "21:04:12", tone: "sapphire", msg: "atlas-router acquired lease on shard eu-3" },
  { t: "20:58:47", tone: "emerald", msg: "ledger audit signed · 31 blocks verified" },
  { t: "20:41:09", tone: "topaz", msg: "signal-synth queue depth 812 · autoscale +2" },
  { t: "20:22:33", tone: "amethyst", msg: "policy pol.redact.pii applied to 1,204 spans" },
  { t: "19:57:02", tone: "sapphire", msg: "model registry refreshed from upstream" },
] as const;

/** /policy — governance switches. */
export const policyRules = [
  { id: "pol.residency.eu", desc: "Pin all inference to EU regions", on: true },
  { id: "pol.redact.pii", desc: "Strip PII before it leaves the boundary", on: true },
  { id: "pol.spend.ceiling", desc: "Halt the fleet above $50 / hour", on: true },
  { id: "pol.tool.exec", desc: "Require human approval for shell tools", on: false },
  { id: "pol.escalate.ruby", desc: "Page an operator on any ruby-level event", on: false },
];

export const policyMeta = "5 rules · last decision 2 min ago · 0 blocks / 24h";
