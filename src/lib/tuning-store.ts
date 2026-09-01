import { useCallback, useEffect, useState } from "react";

/**
 * Advanced Tuning — schema-driven retrieval / behaviour knobs.
 *
 * Every knob is declared once in `tuningSchema`; the UI renders itself from it.
 * Adding a new section later = appending one group object here, no UI work.
 * Values persist locally until the retrieval layer gets a backend.
 */

export type Knob =
  | {
      id: string;
      kind: "slider";
      label: string;
      hint: string;
      min: number;
      max: number;
      step: number;
      value: number;
    }
  | { id: string; kind: "toggle"; label: string; hint: string; value: boolean }
  | {
      id: string;
      kind: "select";
      label: string;
      hint: string;
      options: { value: string; label: string }[];
      value: string;
    }
  | { id: string; kind: "note"; label: string; hint: string };

export type TuningGroup = {
  id: string;
  title: string;
  meta: string;
  badge: string;
  tone: "sapphire" | "amethyst" | "emerald" | "topaz";
  knobs: Knob[];
};

export const tuningSchema: TuningGroup[] = [
  {
    id: "tuning",
    title: "Tuning",
    meta: "live · changes apply immediately",
    badge: "live",
    tone: "sapphire",
    knobs: [
      {
        id: "injectThreshold",
        kind: "slider",
        label: "Inject Threshold",
        hint: "Vector probe gate. Top-1 chunk score must reach this for RAG to inject sources. Lower = more aggressive injection, higher = stricter.",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.5,
      },
      {
        id: "strictProbeGate",
        kind: "toggle",
        label: "Strict Probe Gate",
        hint: "If probe top-1 doesn't pass the threshold, skip RAG entirely (reranker doesn't run either). Turn off to open the FTS-only inject path — legacy behavior.",
        value: true,
      },
      {
        id: "explicitBrandFilter",
        kind: "toggle",
        label: "Explicit Brand Filter",
        hint: 'If the query explicitly mentions a library brand (e.g. "nat on checkpoint"), retrieval is locked to that brand. Turn off to let all brands compete — the brand with the most chunks will dominate.',
        value: true,
      },
      {
        id: "similarityThreshold",
        kind: "slider",
        label: "Similarity Threshold",
        hint: "Per-chunk floor. Chunks scoring below this are dropped from the final context.",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.35,
      },
      {
        id: "topK",
        kind: "slider",
        label: "Top-K",
        hint: "How many chunks are injected into the model context per query.",
        min: 1,
        max: 50,
        step: 1,
        value: 12,
      },
      {
        id: "chunkDepth",
        kind: "slider",
        label: "Chunk Depth",
        hint: "HNSW candidate depth (ef_search). Higher = better recall, slower retrieval.",
        min: 8,
        max: 512,
        step: 8,
        value: 32,
      },
      {
        id: "marginGateBase",
        kind: "slider",
        label: "Margin Gate",
        hint: "Required gap between top-1 and top-4 scores. If the gap is too small the result set is treated as noise and skipped. 0 disables the gate.",
        min: 0,
        max: 0.5,
        step: 0.01,
        value: 0.06,
      },
    ],
  },
  {
    id: "reranker",
    title: "Reranker · CrossEncoder",
    meta: "optional quality pass",
    badge: "quality pass",
    tone: "amethyst",
    knobs: [
      {
        id: "rerankEnabled",
        kind: "toggle",
        label: "Enabled",
        hint: "Toggle the cross-encoder rerank pass after hybrid retrieval. Failure → falls back to fused order.",
        value: true,
      },
      {
        id: "rerankTopN",
        kind: "slider",
        label: "Rerank Top-N",
        hint: "Number of fused candidates sent to the reranker. Higher = better recall, more latency.",
        min: 4,
        max: 64,
        step: 1,
        value: 12,
      },
      {
        id: "rerankTimeout",
        kind: "slider",
        label: "Rerank Timeout (ms)",
        hint: "Hard cap for the rerank HTTP call. Timeout → keeps the original fused order.",
        min: 250,
        max: 10000,
        step: 50,
        value: 2500,
      },
      {
        id: "rerankWeight",
        kind: "slider",
        label: "Rerank Weight",
        hint: "Blend weight between rerank score (1.0 = pure rerank) and fused RRF score (0.0 = ignore reranker).",
        min: 0,
        max: 1,
        step: 0.05,
        value: 0.7,
      },
    ],
  },
  {
    id: "diversity",
    title: "Diversity & Confidence",
    meta: "runtime knobs",
    badge: "runtime knobs",
    tone: "emerald",
    knobs: [
      {
        id: "rerankMinScore",
        kind: "slider",
        label: "Rerank Min Score",
        hint: "Cross-encoder top-1 confidence floor. If the rerank top-1 score is below this, RAG skips with no_confident_match. 0 = gate disabled (everything injects). Recommended: 0.10.",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.1,
      },
      {
        id: "marginGate",
        kind: "slider",
        label: "Margin Gate",
        hint: "Minimum score gap between top-1 and top-4 results. Low margin = ambiguous answer (model can't pick a clear winner) → RAG is more conservative. Raise to be stricter; 0 disables the gate. Recommended: 0.06.",
        min: 0,
        max: 0.5,
        step: 0.01,
        value: 0.06,
      },
      {
        id: "minSupportSources",
        kind: "slider",
        label: "Min Support Sources",
        hint: "Force-keep at least N source rows in the model context even if their rerank score is below the floor. Higher = more citations and broader context, but possible noise from lower-quality chunks. 0 disables. Recommended: 3-4.",
        min: 0,
        max: 12,
        step: 1,
        value: 4,
      },
      {
        id: "perFileCap",
        kind: "slider",
        label: "Per-File Cap",
        hint: "Maximum chunks any single file (file_id) can contribute to top-K. Prevents one large PDF from drowning the result set.",
        min: 1,
        max: 20,
        step: 1,
        value: 4,
      },
      {
        id: "perBrandCap",
        kind: "slider",
        label: "Per-Brand Cap",
        hint: "Maximum chunks any single brand can contribute to top-K. Per-file cap alone is not enough — a large brand spans hundreds of file_ids. Lower = more brand diversity.",
        min: 1,
        max: 40,
        step: 1,
        value: 8,
      },
      {
        id: "diversityPool",
        kind: "slider",
        label: "Diversity Pool",
        hint: "HNSW candidate pool size. Per-file and per-brand caps are applied on top of this pool. Larger pool = better small-brand representation, slight latency cost.",
        min: 40,
        max: 1000,
        step: 20,
        value: 240,
      },
      {
        id: "multiVersionSplit",
        kind: "toggle",
        label: "Multi-Version Query Split",
        hint: 'When a query mentions ≥2 distinct major.minor version tokens (e.g. "7.4 vs 7.6", "R81.10 vs R82"), run an extra mini vector fetch per version with the OTHER version tokens stripped, then union into top-K. Forces balanced retrieval across both versions. Adds ~150-400ms per extra version (parallel). OFF = single embedding (current behavior).',
        value: true,
      },
      {
        id: "multiVersionMaxSplits",
        kind: "slider",
        label: "Multi-Version Max Splits",
        hint: "Hard cap on extra embed calls per turn (latency budget). 3 = up to 3 versions split in parallel; queries with more distinct versions skip the split entirely. Only used when Multi-Version Query Split is ON.",
        min: 1,
        max: 6,
        step: 1,
        value: 3,
      },
      {
        id: "multiVersionPerLimit",
        kind: "slider",
        label: "Multi-Version Per-Limit",
        hint: "Rows pulled per version sub-fetch (before downstream caps + RRF). Higher = more candidates from each version, more reranker work. 6 is a balanced default.",
        min: 2,
        max: 20,
        step: 1,
        value: 6,
      },
      {
        id: "multiVersionQuota",
        kind: "toggle",
        label: "Multi-Version Quota",
        hint: "When split detects ≥2 versions, guarantees each version a fair share of the final top-6 (after RRF + reranker). Prevents the dominant-version bias from crowding the other versions out of the citation set. Requires Multi-Version Query Split ON. OFF = sort purely by RRF/rerank score.",
        value: true,
      },
      {
        id: "minChunkChars",
        kind: "slider",
        label: "Min Chunk Chars",
        hint: "Minimum content length (chars) for a chunk to enter the retrieval pool. Filters out tiny page-footer / header fragments that hijack vector top-K via brand-anchored preamble. 0 = filter disabled. 100 is a safe default for PDF-heavy corpora.",
        min: 0,
        max: 600,
        step: 10,
        value: 100,
      },
      {
        id: "useEnrichedContent",
        kind: "toggle",
        label: "Use Enriched Content",
        hint: "Embed worker reads the `content_enriched` column (natural-language preamble prepended to API / JSON / YAML chunks). Turning it off embeds the raw `content`; existing vectors are not affected until re-embed.",
        value: true,
      },
      {
        id: "denoiseLowercase",
        kind: "toggle",
        label: "Denoise Lowercase",
        hint: "Lowercase the denoised query before sending it to the reranker. Cross-encoder is case-sensitive → keep this on for deterministic ranking.",
        value: true,
      },
      {
        id: "productFilter",
        kind: "select",
        label: "Product Filter",
        hint: "Separates products under the same brand (Fortigate→fortios/fortimanager/fortianalyzer; A10→axapi/agalaxy/ddos). off: disabled. boost: adds a small rerank bonus. hard: applies SQL WHERE product=X, so non-matching rows are excluded. Detection uses the DB DISTINCT (brand, product) catalog with a 5-minute cache.",
        options: [
          { value: "off", label: "off" },
          { value: "boost", label: "boost" },
          { value: "hard", label: "hard" },
        ],
        value: "hard",
      },
      {
        id: "productFilterBoost",
        kind: "slider",
        label: "Product Filter Boost",
        hint: "Bonus added to the rerank_mix score for matching product rows in boost mode. Default 0.05 — soft steering only. Not used in hard mode.",
        min: 0,
        max: 0.5,
        step: 0.01,
        value: 0.05,
      },
      {
        id: "productAutoExtract",
        kind: "toggle",
        label: "Product Auto-Extract",
        hint: "Automatically extracts brand+product tokens from the query using the DB catalog. When off, the filter only runs on turns that are pre-tagged by agent binding.",
        value: true,
      },
    ],
  },
  {
    id: "behavior",
    title: "Behavior",
    meta: "live · smalltalk lane + thinking control",
    badge: "migrated from env",
    tone: "topaz",
    knobs: [
      {
        id: "smalltalkFastPath",
        kind: "toggle",
        label: "Smalltalk Fast-Path",
        hint: "When probe top-1 < Smalltalk Probe Threshold OR the semantic router flags a greeting, route to a low-latency lane: tighter token cap, RAG bypass, no tool selection. Off = every turn runs the full RAG + tool pipeline.",
        value: true,
      },
      {
        id: "smalltalkProbeThreshold",
        kind: "slider",
        label: "Smalltalk Probe Threshold",
        hint: "Probe top-1 below this routes to the smalltalk lane (no thinking, low token cap, RAG bypass). Tune up if greetings still hit the query lane; tune down if real questions get downgraded to smalltalk. Default 0.50.",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.65,
      },
      {
        id: "mixedPromoteRatio",
        kind: "slider",
        label: "Mixed-Promote Ratio",
        hint: "Semantic intent router: for hybrid inputs like 'hello Elara, <technical question>', ragSim ≥ smallSim × this → RAG lane. Loosen (0.90) to catch short brand queries (Cloudflare WAF, Citrix NetScaler); tighten (0.95) if pure greetings leak into RAG. Default 0.92.",
        min: 0.5,
        max: 1.2,
        step: 0.01,
        value: 0.92,
      },
      {
        id: "mixedPromoteMinLength",
        kind: "slider",
        label: "Mixed-Promote Min Length",
        hint: "Minimum trimmed char length for mixed-promote to fire. Shorter inputs stay smalltalk even if ragSim wins. Lower (10) catches 'cloudflare waf?' (14ch); raise (20) protects pure greetings. Default 15.",
        min: 0,
        max: 60,
        step: 1,
        value: 15,
      },
      {
        id: "noThinkSmalltalk",
        kind: "toggle",
        label: "Disable Thinking on Smalltalk",
        hint: "Inject the `/no_think` prefix + `chat_template_kwargs.enable_thinking=false` for smalltalk turns. Drops greetings from ~15s of reasoning to a ~1-2s reply. Off = thinking always on (slower).",
        value: true,
      },
      {
        id: "noThinkQuery",
        kind: "toggle",
        label: "Disable Thinking on Query",
        hint: "Inject `/no_think` + `enable_thinking=false` for technical query turns (no RAG inject). Large models can burn ~50-60s of internal reasoning before the answer. On = fast direct answers. Off = deep reasoning (much slower TTFT).",
        value: true,
      },
      {
        id: "noThinkRag",
        kind: "toggle",
        label: "Disable Thinking on RAG",
        hint: "Same `/no_think` + `enable_thinking=false` for RAG-injected turns. Keeps grounded answers fast. Off = model thinks before answering with sources (slower TTFT).",
        value: true,
      },
      {
        id: "intentRouterBypass",
        kind: "toggle",
        label: "Intent Router Bypass",
        hint: "Skip the embedding-anchor intent router (semantic smalltalk detection). On = single decision authority is `injectThreshold`. Off = router runs first, can short-circuit RAG for greetings.",
        value: false,
      },
    ],
  },
  {
    id: "library",
    title: "Library Awareness",
    meta: "cross-brand",
    badge: "scope + dominance",
    tone: "sapphire",
    knobs: [
      {
        id: "requireBrandMention",
        kind: "toggle",
        label: "Require Brand Mention for RAG",
        hint: 'ON (default): RAG runs ONLY when the user\'s question mentions a brand (or alias) that exists in the library. Generic questions ("what is a vlan") or out-of-library vendors (e.g. "cisco switch" when Cisco isn\'t ingested) skip RAG silently and the model answers from its own knowledge — no banner, no probe cost. OFF: every question runs probe + cross-vendor guard (legacy).',
        value: true,
      },
      {
        id: "outOfLibraryFallback",
        kind: "toggle",
        label: "Out-of-Library Fallback",
        hint: 'When the query mentions a vendor that is NOT in the library, inject is canceled and the model answers from its own knowledge with an amber "Out of library scope" chip. Off = no fallback, the turn returns no_confident_match.',
        value: true,
      },
      {
        id: "outOfLibraryTauBoost",
        kind: "slider",
        label: "Out-of-Library Tau Boost",
        hint: "Extra bias added to the probe threshold when the matched brand is out-of-library. Raise to make off-corpus queries fall through to free-answer faster; 0 = no boost. Default 0.00.",
        min: 0,
        max: 0.6,
        step: 0.01,
        value: 0.15,
      },
      {
        id: "crossBrandMinDominance",
        kind: "slider",
        label: "Cross-Brand Min Dominance",
        hint: "Minimum share a single brand must hold in the top-K rows to trigger the dominant-brand lock (system prompt rule #6: use only that vendor's terminology). Lower = stricter lock fires more often. Default 0.50.",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.6,
      },
      {
        id: "crossBrandMinTop1",
        kind: "slider",
        label: "Cross-Brand Min Top1",
        hint: "Minimum top-1 vector score for the cross-brand dominance check to apply. Raise if a weak top-1 is flipping lanes; lower if real hits get cross-brand-blocked. Default 0.55.",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.65,
      },
      {
        id: "libraryBrandCacheTtl",
        kind: "slider",
        label: "Library Brand Cache TTL (ms)",
        hint: "How long the DB-derived library brand list is cached. Increase to reduce DB load; decrease so newly ingested brands show up faster in out-of-library detection. Default 300000 (5 min).",
        min: 0,
        max: 1800000,
        step: 30000,
        value: 300000,
      },
      {
        id: "libraryBrandMinChunks",
        kind: "slider",
        label: "Library Brand Min Chunks",
        hint: "Minimum chunk count a brand must hold in the DB to count as a library brand. Filters legacy auto-tag noise and single-line mentions (e.g. a stray 'cisco' or 'huawei' inside a small PDF) so they don't open the cross-vendor hallucination path. 0 = gate disabled (every brand counts). Default 100.",
        min: 0,
        max: 2000,
        step: 10,
        value: 100,
      },
      {
        id: "stripPriorCitations",
        kind: "toggle",
        label: "Strip Prior Citations on Free-Answer",
        hint: 'When RAG is skipped (RAG off, smalltalk, out-of-library, etc.), strip any trailing "Sources: / References:" footer block from prior assistant messages before the model sees them. Prevents the model from mimicking that format and fabricating fake citations. Default ON.',
        value: true,
      },
    ],
  },
  {
    id: "delegation",
    title: "Agent Delegation",
    meta: "auto-route + fallback",
    badge: "UI = single source",
    tone: "amethyst",
    knobs: [
      {
        id: "autoRouteToAgent",
        kind: "toggle",
        label: "Auto-Route to Agent",
        hint: "When the user query is non-smalltalk and no explicit `@[script.py]` mention is present, the picker selects the best agent by score from agents.meta (rag.brands, rag.keywords, tags, description) and routes through the existing dispatch path. If no agent clears the threshold, Elara answers.",
        value: true,
      },
      {
        id: "skipAutoRouteSmalltalk",
        kind: "toggle",
        label: "Skip Auto-Route on Smalltalk",
        hint: "When the intent classifier marks the user turn as smalltalk (greetings, thanks, self-intro), bypass auto-route so Elara answers instead of a randomly matched agent. Explicit `@[script.py]` mentions still override.",
        value: true,
      },
      {
        id: "autoRouteMinScore",
        kind: "slider",
        label: "Auto-Route Min Score",
        hint: "Minimum score required for the picker to delegate. Brand match +3, keyword +2, tag/desc +1. Higher = stricter. Recommended: 1 for broad NetSec delegation.",
        min: 0,
        max: 10,
        step: 1,
        value: 1,
      },
      {
        id: "agentRagContextBudget",
        kind: "slider",
        label: "Agent RAG Context Budget",
        hint: "Maximum RAG context characters injected into the agent prompt. Higher = more cited chunks visible to the agent, but more latency and prompt load. Recommended: 12000.",
        min: 2000,
        max: 40000,
        step: 500,
        value: 12000,
      },
      {
        id: "agentExecTimeout",
        kind: "slider",
        label: "Agent Exec Timeout (ms)",
        hint: "Hard cap for the local agent process. Higher gives detailed agent+RAG answers time to finish; lower fails faster. Recommended: 180000.",
        min: 10000,
        max: 300000,
        step: 5000,
        value: 300000,
      },
      {
        id: "agentSseKeepAlive",
        kind: "slider",
        label: "Agent SSE Keep-Alive (ms)",
        hint: "Heartbeat interval for the agent's SSE stream while it waits in the inference queue. Without it, browser/proxy may drop idle connections (BodyStreamBuffer aborted). Set 0 to disable. Recommended: 15000.",
        min: 0,
        max: 60000,
        step: 1000,
        value: 15000,
      },
      {
        id: "skipRagAgentSmalltalk",
        kind: "toggle",
        label: "Skip RAG for Agent Smalltalk",
        hint: 'When the user\'s text to the agent classifies as smalltalk (greetings, self-intro like "introduce yourself"), the agent skips the RAG probe entirely and answers from its own system prompt. Mirrors the chat-side smalltalk lane. Default ON.',
        value: true,
      },
      {
        id: "agentRagSlowWarn",
        kind: "slider",
        label: "Agent RAG Slow Warn (ms)",
        hint: "Soft warning threshold for slow agent RAG probes. It does not abort retrieval, so valid library hits are still injected even if they arrive after this point. Recommended: 8000.",
        min: 1000,
        max: 60000,
        step: 500,
        value: 8000,
      },
      {
        id: "insufficientFallback",
        kind: "toggle",
        label: "Insufficient → Elara Fallback",
        hint: "When the agent stream finishes with hits=0, a short answer, or a refusal pattern (don't know / no_confident_match / etc.), Elara steps in within the same turn and replies via free-answer. Default ON.",
        value: true,
      },
      {
        id: "insufficientMinChars",
        kind: "slider",
        label: "Insufficient Min Chars",
        hint: "If the agent reply is shorter than this threshold, it counts as 'short_answer' and triggers the fallback. Default 80.",
        min: 0,
        max: 500,
        step: 10,
        value: 80,
      },
      {
        id: "showFallbackBanner",
        kind: "toggle",
        label: "Show Fallback Banner",
        hint: "When fallback kicks in, the stream gets a visible separator + \"X couldn't answer, replying from my own knowledge:\" line. Turn off to let Elara's answer flow silently under the agent reply. Default ON.",
        value: true,
      },
      {
        id: "agentManifest",
        kind: "select",
        label: "Elara Agent Manifest ({AGENTS} placeholder)",
        hint: 'Replaces {AGENTS} in Elara\'s system prompt with a live agent list (squad → slug → 1-line description) from the agents table. off: always empty (shortest prompt). lazy (default): injected only when the user\'s intent is "meta" (e.g. "list your agents", "who\'s in your team"). always: injected every turn (legacy, costs TTFT).',
        options: [
          { value: "off", label: "off" },
          { value: "lazy", label: "lazy" },
          { value: "always", label: "always" },
        ],
        value: "lazy",
      },
      {
        id: "directAnswerAgentList",
        kind: "toggle",
        label: "Direct answer for agent-list questions",
        hint: "Answer 'list your agents' style questions straight from the registry without a model warm-up.",
        value: false,
      },
    ],
  },
  {
    id: "safety",
    title: "Answer Safety",
    meta: "v16",
    badge: "UI controlled",
    tone: "topaz",
    knobs: [
      {
        id: "agentMultiBrand",
        kind: "toggle",
        label: "Agent Multi-Brand",
        hint: 'ON (default): Agents query the entire library — binding files, meta.rag.keywords / meta.rag.brands, and pack brand_keywords are ignored. Explicit brand mentions in the query (e.g. "checkpoint") and dominant brand lock (Rule 6) still work as-is. OFF: legacy per-agent scope (binding + keywords + pack filters).',
        value: true,
      },
      {
        id: "crossVendorGuard",
        kind: "toggle",
        label: "Cross-Vendor Guard",
        hint: "If the query targets one brand (e.g. A10) but 70%+ of the RAG rows come from another (e.g. Checkpoint), inject is cancelled → free-answer. Prevents cross-vendor leakage.",
        value: true,
      },
      {
        id: "stripThinkBlocks",
        kind: "toggle",
        label: "Strip <think> Blocks",
        hint: "<think>…</think> blocks are stripped server-side from the model stream. Partial tags are buffered across deltas. Off = raw output reaches the UI.",
        value: true,
      },
      {
        id: "showRagDebug",
        kind: "toggle",
        label: "Show RAG Debug Panels (chat)",
        hint: "Shows the AGENT RAG DIAG + RAG DEBUG cards under agent messages in chat. Default OFF — enable only for diagnostic sessions. UI-only knob, persisted in this browser only (localStorage).",
        value: false,
      },
      {
        id: "expertRagAnswers",
        kind: "toggle",
        label: "Expert RAG Answers",
        hint: 'Treats sources as the primary anchor but fills missing pieces STEP BY STEP using engineering knowledge (CLI / example / warning). Off = legacy strict "sources only" auditor tone.',
        value: true,
      },
      {
        id: "conciseRagAnswers",
        kind: "toggle",
        label: "Concise RAG Answers",
        hint: 'Bans "explanation paragraphs / filler sentences / hope this helps" in RAG answers — max 8 sentences + Sources line. Default OFF; with expert mode, depth is preferred.',
        value: false,
      },
      {
        id: "strictNoToolRule",
        kind: "toggle",
        label: "Strict No-Tool Rule",
        hint: "ON = a hard \"DON'T EVEN WRITE agent/skill/tool NAMES\" rule is added to the system prompt (legacy strict trigger ban). OFF (default) = soft mode: the model may list/introduce agent names as plain text (copy_smith, hashtag_alchemist), only avoiding the actual trigger envelopes ('!slug(...)', '@[script.py]', ```tool_call```). Leave OFF if you want introductions when the user says \"list the agents\" in chat.",
        value: false,
      },
      {
        id: "autoDispatchFromOutput",
        kind: "toggle",
        label: "Auto-Dispatch Agents from Model Output",
        hint: "When the model passively mentions script.py / an agent name in its reply, the backend auto-spawns the local Python agent. Default OFF — so passive mentions (agent intros, lists) don't block the stream. When the user writes @[script.py], the frontend already spawns directly; this knob only toggles whether the backend inspects model output for agent triggers.",
        value: false,
      },
      {
        id: "injectToolsManifest",
        kind: "toggle",
        label: "Inject Agent Tools Manifest (backend)",
        hint: 'OFF (default) = the backend does NOT add an ELARA_AGENT_TOOLS block to the agent system prompt. You write the tool list into the operator agent prompt from the UI. ON = legacy behavior: a "# @tools:" header + action_library description is injected automatically ("Suppress on Smalltalk" still applies).',
        value: false,
      },
      {
        id: "suppressManifestSmalltalk",
        kind: "toggle",
        label: "Suppress Tool Manifest on Smalltalk",
        hint: 'ON = greeting/smalltalk turns do not expose tool, skill, or agent protocol hints to the model. Keeps "hi / how are you" replies conversational instead of trying to call researcher/skills. (Only applies when "Inject Agent Tools Manifest" is ON.)',
        value: true,
      },
      {
        id: "parseToolCallsSmalltalk",
        kind: "toggle",
        label: "Parse Tool Calls on Smalltalk",
        hint: "OFF = smalltalk text is never interpreted as `!skill`, `@[agent.py]`, or tool-call protocol. Leave off unless deliberately testing parser behavior.",
        value: false,
      },
    ],
  },
  {
    id: "pipeline",
    title: "Query Pipeline",
    meta: "two-layer",
    badge: "extractor + HyDE",
    tone: "emerald",
    knobs: [
      {
        id: "layer1Extractor",
        kind: "toggle",
        label: "Layer 1 · Query Extractor",
        hint: "Deterministic LLM (temp 0.1, max 60, /no_think) strips greetings, names, polite filler — keeps only the technical core. SHA-256 LRU cached. Output feeds FTS + reranker + probe embedding.",
        value: false,
      },
      {
        id: "layer2Hyde",
        kind: "toggle",
        label: "Layer 2 · HyDE Expansion",
        hint: "Stochastic LLM (temp 0.3, max 120) writes a hypothetical technical passage and concatenates it with cleanQuery for the DENSE embedding only. FTS + reranker still see cleanQuery. Mid-band gated.",
        value: false,
      },
      {
        id: "hydeBandLow",
        kind: "slider",
        label: "HyDE Probe Band — Low",
        hint: "HyDE fires only when probe top-1 ≥ this value. Below this the query is either smalltalk or off-corpus — HyDE wastes compute time.",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.5,
      },
      {
        id: "hydeBandHigh",
        kind: "slider",
        label: "HyDE Probe Band — High",
        hint: "HyDE skipped when probe top-1 > this value (already strong, augmentation only adds noise). Sweet spot is the ambiguous band [Low, High].",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.8,
      },
      {
        id: "extractorCacheTtl",
        kind: "slider",
        label: "Extractor Cache TTL (hours)",
        hint: "LRU cache lifetime for extractor outputs (SHA-256 keyed). HyDE is never cached (stochastic by design).",
        min: 1,
        max: 168,
        step: 1,
        value: 24,
      },
      {
        id: "extractorTimeout",
        kind: "slider",
        label: "Extractor Timeout (ms)",
        hint: "Hard budget for the extractor inference call. A cold accelerator can stall — a short timeout fails fast; the circuit breaker takes over on repeated failures.",
        min: 250,
        max: 8000,
        step: 50,
        value: 2000,
      },
      {
        id: "hydeTimeout",
        kind: "slider",
        label: "HyDE Timeout (ms)",
        hint: "Hard budget for the HyDE passage generation. Caps the worst-case probe latency in the mid-band.",
        min: 250,
        max: 8000,
        step: 50,
        value: 1200,
      },
      {
        id: "breakerFailureThreshold",
        kind: "slider",
        label: "Breaker · Failure Threshold",
        hint: "Consecutive extractor failures before the circuit breaker opens (skip extractor LLM, fall back to raw query).",
        min: 1,
        max: 10,
        step: 1,
        value: 3,
      },
      {
        id: "breakerCooldown",
        kind: "slider",
        label: "Breaker · Cooldown (ms)",
        hint: "How long the breaker stays open after tripping. First successful call after cooldown re-enables the extractor.",
        min: 1000,
        max: 300000,
        step: 1000,
        value: 100000,
      },
      {
        id: "ragProbeDeadline",
        kind: "slider",
        label: "RAG probe deadline (ms)",
        hint: "Total budget for probe + rerank + fetch. Reranker alone needs ~2500ms; sub-3000ms budgets skip real hits as deadline_*.",
        min: 1000,
        max: 20000,
        step: 100,
        value: 4500,
      },
      {
        id: "preRagDeadline",
        kind: "slider",
        label: "Pre-RAG deadline (ms)",
        hint: "Hard cap for the entire pre-inference pipeline (intent + probe + rerank + library lookup + message build). On timeout: rag.skipped(pre_rag_deadline) → free-answer fallback so the user never sees a blank screen.",
        min: 1000,
        max: 20000,
        step: 100,
        value: 4000,
      },
      {
        id: "metaForgeLane",
        kind: "note",
        label: "Meta-Forge Lane",
        hint: 'Semantic gate that routes "create a skill / write a tool / forge an agent" prompts to the Meta-Forge orchestrator instead of RAG. Lower ratios open the lane more aggressively; too low leaks technical questions into forge_master.',
      },
      {
        id: "metaForgeMinSimilarity",
        kind: "slider",
        label: "Meta-Forge · Min similarity",
        hint: "Minimum cosine similarity between the query and the meta_forge anchor. Below this the lane never opens regardless of dominance.",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.5,
      },
      {
        id: "metaForgeDominance",
        kind: "slider",
        label: "Meta-Forge · Dominance ratio (vs smalltalk/meta/manifest)",
        hint: "metaForgeSim must be ≥ ratio × each competing anchor (smalltalk, meta, agent_manifest). 0.85 = strict, 0.70 = permissive.",
        min: 0.3,
        max: 1.2,
        step: 0.01,
        value: 0.85,
      },
      {
        id: "metaForgeSoftRatio",
        kind: "slider",
        label: "Meta-Forge · Soft ratio vs RAG",
        hint: "Softer tie-break against ragSim only. Lower opens the lane for short creation prompts where the RAG anchor still fires high. Default 0.75.",
        min: 0.3,
        max: 1.2,
        step: 0.01,
        value: 0.75,
      },
      {
        id: "metaForgeAutoApply",
        kind: "toggle",
        label: "Meta-Forge · Auto-apply approved plans",
        hint: 'When ON, a validated ForgePlan is applied immediately (skill/tool/agent/pack written, capabilities refreshed) — the chat shows the outcome instead of an approval card. Lint / disk / DB failure falls back to a "failed" plan the admin UI can review + retry. Default ON.',
        value: true,
      },
    ],
  },
];

export type TuningValues = Record<string, number | boolean | string>;

export const defaultTuning: TuningValues = Object.fromEntries(
  tuningSchema.flatMap((g) =>
    g.knobs
      .filter((k) => k.kind !== "note")
      .map((k) => [k.id, (k as { value: number | boolean | string }).value]),
  ),
);

const KEY = "sovereign.tuning";
const EVT = "sovereign:tuning";

function read(): TuningValues {
  if (typeof window === "undefined") return defaultTuning;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultTuning;
    return { ...defaultTuning, ...(JSON.parse(raw) as TuningValues) };
  } catch {
    return defaultTuning;
  }
}

export function useTuning() {
  const [values, setValues] = useState<TuningValues>(defaultTuning);

  useEffect(() => {
    const sync = () => setValues(read());
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);

  const set = useCallback((id: string, value: number | boolean | string) => {
    const next = { ...read(), [id]: value };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(EVT));
    } catch {
      /* ignore */
    }
    setValues(next);
  }, []);

  const resetGroup = useCallback((groupId: string) => {
    const group = tuningSchema.find((g) => g.id === groupId);
    if (!group) return;
    const patch = Object.fromEntries(
      group.knobs
        .filter((k) => k.kind !== "note")
        .map((k) => [k.id, (k as { value: number | boolean | string }).value]),
    );
    const next = { ...read(), ...patch };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(EVT));
    } catch {
      /* ignore */
    }
    setValues(next);
  }, []);

  return { values, set, resetGroup };
}
