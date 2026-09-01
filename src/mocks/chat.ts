import type { Proposal } from "@/components/sovereign/proposal-card";

/** Greeting block on the empty chat surface. */
export const chatGreeting = {
  title: "Good evening, Levent.",
  status: "fleet nominal · 6 agents online · policy enforced",
};

export const chatSuggestions = [
  "Route this workload across the fleet",
  "Audit last night's policy decisions",
  "Summarize spend by model",
];

/** Canned agent reply used until the backend is wired up. */
export const agentReplyText = `Two forge paths resolve for this. Both hold policy; they differ on spend and latency tail.

## Router patch

\`\`\`rust
// route long-context spans to Signal Synth
let target = match req.tokens {
    n if n > 32_000 => Runtime::SignalSynth,
    _ => Runtime::Atlas,
};
dispatch(target, req).await?;
\`\`\`

## Summary

| Path | Spend | p95 latency | Risk |
| --- | --- | --- | --- |
| \`shard\` across Atlas + Signal Synth | ~$0.84 / 1k | 380 ms | low |
| \`consolidate\` with speculative decode | ~$0.51 / 1k | 610 ms | medium |
| \`hold\` current routing | ~$0.77 / 1k | 540 ms | none |

- Both paths keep redaction policy enforced.
- Rollback is instant on either branch.`;

export const proposalSeed: Proposal[] = [
  {
    id: "mf_0x2a91",
    title: "Shard the workload across Atlas + Signal Synth",
    summary:
      "Split inference by token budget, route long-context spans to Signal Synth and keep interactive turns on Atlas. Preserves p95 under 400 ms.",
    model: "gpt-5.2 · llama-4-405b",
    cost: "~$0.84 / 1k req",
    confidence: 92,
    tone: "sapphire",
  },
  {
    id: "mf_0x2a92",
    title: "Single-node consolidation with speculative decode",
    summary:
      "Keep the fleet on one runtime and absorb the burst with speculative decoding. Lower spend, slightly wider latency tail.",
    model: "claude-4.7",
    cost: "~$0.51 / 1k req",
    confidence: 74,
    tone: "amethyst",
  },
];

/** MetaForge approval card seed rendered inside the chat stream. */
export const metaForgeApprovalSeed = {
  id: "mf.cap.0x4d",
  title: "New capability: adaptive fleet router",
  description:
    "MetaForge synthesized a new capability that reads fleet telemetry and routes requests by token budget. Approving adds it to the skill catalog and wires it into the orchestration layer; rejecting archives the draft.",
  facts: [
    { label: "scope", value: "orchestration" },
    { label: "risk", value: "low" },
    { label: "rollback", value: "instant" },
    { label: "author", value: "metaforge" },
  ],
};

/** Recent thread list in the sidebar. */
export const chatThreads = [
  "Fleet rebalance · atlas",
  "Spend audit — august",
  "Redaction policy draft",
  "Signal Synth latency tail",
];

/** Reasoning trace streamed above the answer while the model works. */
export const agentThinkingText = `Reading fleet telemetry for the last 15 minutes.
Two runtimes are within policy budget; Atlas is closest to its p95 ceiling.
Weighing a shard across Atlas + Signal Synth against speculative decoding on one node.
Checking redaction policy holds on both branches — it does.
Drafting the router patch and the spend/latency comparison.`;
