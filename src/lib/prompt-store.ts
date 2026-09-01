import { useCallback, useEffect, useState } from "react";

/**
 * Advanced System Prompts — every prompt layer the pipeline injects.
 *
 * Schema-driven like the tuning knobs: declare a prompt once here and the UI
 * renders the editor, DEFAULT/OVERRIDE badge and reset for it automatically.
 */

export type PromptGroup = "core" | "hints" | "agent";

export type PromptSpec = {
  id: string;
  label: string;
  group: PromptGroup;
  hint: string;
  rows: number;
  default: string;
};

export const promptGroups: {
  id: PromptGroup;
  title: string;
  meta: string;
  tone: "sapphire" | "topaz" | "amethyst";
}[] = [
  {
    id: "core",
    title: "Core Prompt Layers",
    meta: "chat + orchestrator injected",
    tone: "sapphire",
  },
  { id: "hints", title: "Engine Hints", meta: "template-level directives", tone: "topaz" },
  { id: "agent", title: "Agent Prompt Layers", meta: "python config center", tone: "amethyst" },
];

export const promptSchema: PromptSpec[] = [
  {
    id: "ragInspector",
    label: "RAG Inspector Directive",
    group: "core",
    rows: 14,
    hint: "Sent with every RAG-injected turn (chat-stream + chat-orchestrate). Format rules for the answer. Includes vendor/topic match guard — won't pretend mismatched sources cover the question. Per-model override available on the Models editor.",
    default: `INSTRUCTIONS (answer format):

- Read the source blocks CAREFULLY and answer ONLY from the information in them.
- SAME-VENDOR MATCH RULE: product families of one vendor count as the same vendor — Fortinet: FortiGate/FortiOS/FortiManager/FortiAnalyzer/FortiSwitch/FortiAP/FortiClient; Cisco: ASA/Firepower/IOS/NX-OS/Nexus; Check Point: SmartConsole/Gaia/R8x; Palo Alto: PAN-OS/Panorama; Citrix: NetScaler/ADC. If the question and the sources point to COMPLETELY DIFFERENT vendors, refuse to cite — open with: "I have no matching source in the library for this; answering from my own knowledge:" and then answer plainly.
- For each key point pulled from a source, give a CONCRETE detail — parameter name, command, value, procedure step, number, version; never a generic summary.
- Do not open with a filler paragraph — start at the answer. Keep every sentence load-bearing.
- {BRAND_LOCK}
- Close with a single Sources line (inline, no extra prose); if the answer is source-grounded, always write:
Sources: {SOURCES}`,
  },
  {
    id: "brandLock",
    label: "Inspector Brand-Lock Line",
    group: "core",
    rows: 4,
    hint: "Inserted into {BRAND_LOCK} only when ≥70% of retrieved chunks share one brand. Placeholder: {BRAND}.",
    default: `- Use {BRAND} terminology only; never mix in another vendor's product names.`,
  },
  {
    id: "extractor",
    label: "Extractor System Prompt",
    group: "core",
    rows: 6,
    hint: "Query denoise step (extractTechnicalCore). Strips greetings, fixes vendor typos, returns a one-line technical core. The think-off prefix is prepended automatically when the template supports it.",
    default: `You extract the technical search core from user messages. Output exactly one short line — the technical question only, no greetings, no filler, no names, no thinking, no preface, no tags. Fix obvious vendor name typos (e.g. 'checkpointtt'->'checkpoint', 'fortigatte'->'fortigate', 'paloalto'->'palo alto', 'cisocco'->'cisco'). Preserve version tokens exactly (R81.20, v7.4, FortiOS 7.6).`,
  },
  {
    id: "hyde",
    label: "HyDE System Prompt",
    group: "core",
    rows: 6,
    hint: "Hypothetical Document Embeddings — generates a short synthetic passage that would answer the query (used as the extra dense-vector probe). The think-off prefix is auto-injected when supported, so don't include it here.",
    default: `You write a short hypothetical technical passage that a real document would contain to answer the question. Output the passage only — no preface, no quotes, no list, no thinking, no tags. Fix obvious vendor name typos when echoing them (e.g. 'checkpointtt'->'checkpoint', 'fortigatte'->'fortigate', 'paloalto'->'palo alto').`,
  },
  {
    id: "planner",
    label: "Planner System Prompt",
    group: "core",
    rows: 16,
    hint: "Used by plan-and-execute (Fast & Planner) when the planner model decides which tools to chain. Placeholder: {MAX_TOOLS}.",
    default: `You are a tool planner. Read the user request and decide, in order, which of the available tools must be called.

Rules:
1. Only use tools from the provided list.
2. If no tool is needed, return an empty steps array (RAG or the model's own knowledge is enough).
3. Never plan more than {MAX_TOOLS} steps.
4. Answer with JSON ONLY — no prose, no code fences.
{
  "reasoning": "one or two short sentences",
  "steps": [
    { "tool": "slug", "args": { "key": "value" }, "why": "short reason" }
  ]
}`,
  },
  {
    id: "thinkOff",
    label: "Think-Off Prefix",
    group: "hints",
    rows: 2,
    hint: "Prepended to the extractor + HyDE messages when the model template supports a reasoning switch. Default /no_think. Set empty to disable.",
    default: `/no_think`,
  },
  {
    id: "agentRagHits",
    label: "Agent · RAG Directive (with hits)",
    group: "agent",
    rows: 14,
    hint: "Sent to the agent's Python runtime when RAG snippets are retrieved. Drives the opening line, source-citation rules. Placeholders: {SOURCES} = comma-separated label list.",
    default: `KNOWLEDGE CONTEXT — AUTHORITATIVE SOURCES BELOW. You MUST build your answer on these snippets.
OPENING LINE (mandatory): start your reply with ONE short sentence in the user's language stating that you consulted these sources: {SOURCES}. Do not invent source names; use only the labels listed.
VENDOR/TOPIC MATCH CHECK: same-vendor product families count as the same vendor — Fortinet: FortiGate/FortiOS/FortiManager/FortiAnalyzer/FortiAP/FortiClient; Cisco: ASA/Firepower/IOS/NX-OS/Nexus; Check Point: SmartConsole/Gaia/R8x; Palo Alto: PAN-OS/Panorama; Citrix: NetScaler/ADC. Only when the question and the snippets belong to COMPLETELY DIFFERENT vendors (e.g. question 'Cisco ASA' but snippets only Fortinet/Check Point) refuse to cite — open with: "I have no matching source in the library for this; answering from my own knowledge:" and answer from your own knowledge (no [#N] citations). For different products/versions of the SAME vendor, treat the snippets as relevant and cite normally.
PRIMARY RULE: when the snippets DO cover the question, base every concrete claim on them and cite inline like [#1], [#2]. Do NOT answer from model memory when the snippets cover the topic.
NO PADDING: do NOT add an 'Extra Information' / 'Additional Information' / 'General Knowledge' trailing section. If the snippets answer the question, stop there.
PARTIAL COVERAGE: only when a sub-question is not covered, say so explicitly in one line — do not silently pad around that gap.`,
  },
  {
    id: "agentRagNoHits",
    label: "Agent · RAG Directive (no hits)",
    group: "agent",
    rows: 10,
    hint: "Sent when the library was consulted but returned 0 snippets. Tells the agent to open with the honest no-match line, then answer from its own knowledge.",
    default: `KNOWLEDGE CONTEXT: library was consulted; no matching snippets for this query.
MANDATORY OPENING LINE (in the user's language): start your reply with one short sentence such as "I checked the library and found no matching source for this; answering from my own knowledge:" (or the equivalent in the user's language). Do NOT skip this line.
Then answer FULLY from your own domain knowledge — be concrete with vendor commands, syntax, defaults and procedures. Do NOT refuse, do NOT say only 'I don't know'.
If a technical term in the question looks like a typo of a well-known standard term, answer using the correct standard term — do NOT repeat the misspelling and do NOT invent a meaning/expansion for the misspelled form.`,
  },
  {
    id: "agentToolFrame",
    label: "Agent · Tool Manifest Frame",
    group: "agent",
    rows: 8,
    hint: "Header wrapped around the agent's bound tool list (only when tools exist). Placeholder: {TOOLS} = bulleted list of 'slug — description'. If you omit {TOOLS}, the list is appended at the end.",
    default: `Available tools — call EXACTLY one tool per line using:
  !slug({"key":"value"})
Output the tool call on its own line; do not wrap it in code fences.

{TOOLS}`,
  },
];

export type PromptOverrides = Record<string, string>;

import { readDesk, writeDesk } from "@/lib/ownership";

const KEY = "sovereign.prompts";
const EVT = "sovereign:prompts";

function read(): PromptOverrides {
  if (typeof window === "undefined") return {};
  /* Prompt overrides are a per-principal layer over the shipped defaults. */
  return readDesk<PromptOverrides>(KEY, {});
}

function write(next: PromptOverrides) {
  try {
    writeDesk(KEY, next);
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

export function usePrompts() {
  const [overrides, setOverrides] = useState<PromptOverrides>({});

  useEffect(() => {
    const sync = () => setOverrides(read());
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);

  const set = useCallback((id: string, text: string) => {
    const spec = promptSchema.find((p) => p.id === id);
    const current = read();
    const next = { ...current };
    if (!spec || text === spec.default) delete next[id];
    else next[id] = text;
    write(next);
    setOverrides(next);
  }, []);

  const reset = useCallback((id: string) => {
    const next = { ...read() };
    delete next[id];
    write(next);
    setOverrides(next);
  }, []);

  const resetAll = useCallback(() => {
    write({});
    setOverrides({});
  }, []);

  const value = useCallback(
    (id: string) => overrides[id] ?? promptSchema.find((p) => p.id === id)?.default ?? "",
    [overrides],
  );

  return { overrides, set, reset, resetAll, value, count: Object.keys(overrides).length };
}
