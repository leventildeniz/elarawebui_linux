// Isolated mock/demo data. UI + stores read from here; no placeholder data lives in components.
import type { Snippet } from "@/lib/snippet-store";

export const seedSnippets: Snippet[] = [
  {
    id: "snip_brief",
    name: "brief",
    body: "Summarise the current thread as an executive brief: objective, decisions taken, open risks, next action.",
    tone: "sapphire",
  },
  {
    id: "snip_audit",
    name: "audit",
    body: "Audit the last answer for factual gaps, unstated assumptions and missing citations. Be blunt.",
    tone: "topaz",
  },
  {
    id: "snip_spec",
    name: "spec",
    body: "Turn this into a technical spec: scope, interfaces, data contracts, failure modes, rollout steps.",
    tone: "emerald",
  },
  {
    id: "snip_ground",
    name: "ground",
    body: "Answer strictly from the retrieved documents. If the corpus does not cover it, say so explicitly.",
    tone: "amethyst",
  },
];
