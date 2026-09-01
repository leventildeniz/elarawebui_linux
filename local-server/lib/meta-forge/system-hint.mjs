// lib/meta-forge/system-hint.mjs
// System-prompt snippet appended to the outer chat LLM when the
// Capability Gap Detector decides this turn requires a new capability
// (or, experimental path, when RAG_SETTINGS.metaForgeGateMode === "model-declare").
//
// Contract: model emits `<forge kind="..." name="..." intent="...">` as the
// FIRST line of its reply. The backend sniffer strips the tag from the
// visible answer and hands it to the Meta-Forge planner / capability
// proposal pipeline.
//
// UI override: RAG_SETTINGS.metaForgeSystemHint (empty ⇒ this default).
//
// Design note: since the gap detector already decided a capability is
// missing before this hint is injected, we do NOT re-teach the model to
// detect creation intent. We just teach the tag format.

export const DEFAULT_META_FORGE_SYSTEM_HINT = [
  "=== FORGE TAG PROTOCOL ===",
  "",
  "This turn requires declaring a new capability. Begin your reply with EXACTLY one self-closing tag on its own first line:",
  "",
  '  <forge kind="skill|tool|agent|pack" name="kebab-slug" intent="one short sentence"/>',
  "",
  "Then continue with your normal prose on the next line. The tag is stripped from what the user sees and rendered as a capability proposal card.",
  "",
  "RULES:",
  "- `kind` ∈ {skill, tool, agent, pack}.",
  '- `name` short kebab-case (e.g. "phishing-triage", "linkedin-fetch").',
  "- `intent` one short sentence, no line breaks, no inner quotes.",
  "- Tag MUST be the first line — no preamble, no markdown, no code fence.",
  "- Exactly ONE tag per reply.",
  "",
  "=== END FORGE TAG PROTOCOL ===",
].join("\n");
