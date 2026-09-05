// lib/rag/defaults.mjs — RAG knob defaults + disk overlay loader.
// Extracted from server.mjs (Tur 1, 2026-05-30) — pure config + clamp.
// server.mjs retains: RAG_SETTINGS_FILE path, one-shot threshold migration,
// createRagUtil DI block (those touch fs/file write + module symbols).

export function buildRagDefaults({ envNumber, TIMEOUT_BUDGETS }) {
  return {
    similarityThreshold: envNumber("RAG_SEMANTIC_MIN_SCORE", 0.30),
    topK: envNumber("RAG_TOP_K", 12),
    chunkDepth: envNumber("RAG_CHUNK_DEPTH", 32),
    injectThreshold: envNumber("RAG_INJECT_THRESHOLD", 0.55),
    marginGate:      envNumber("RAG_MARGIN_GATE",     0.06),
    strictProbeGate: String(process.env.RAG_STRICT_PROBE_GATE ?? "1") === "1",
    rerankEnabled:    String(process.env.RAG_RERANK_ENABLED ?? "1") === "1",
    rerankTopN:       envNumber("RAG_RERANK_TOP_N",       12),
    rerankTimeoutMs:  envNumber("RAG_RERANK_TIMEOUT_MS",  8000),
    rerankWeight:     envNumber("RAG_RERANK_WEIGHT",      0.7),
    rerankMinScore:   envNumber("RAG_RERANK_MIN_SCORE",   0.10),
    minSupportSources: Math.max(0, envNumber("RAG_MIN_SUPPORT_SOURCES", 6)),
    perSourceCap:     Math.max(1, envNumber("RAG_PER_SOURCE_CAP",   4)),
    perBrandCap:      Math.max(1, envNumber("RAG_PER_BRAND_CAP",    8)),
    diversityPool:    Math.max(24, envNumber("RAG_DIVERSITY_POOL", 240)),
    minChunkChars:    Math.max(0, envNumber("RAG_MIN_CHUNK_CHARS", 100)),
    // 2026-06-04 — Multi-version query split. When user query mentions ≥2
    // distinct major.minor version tokens (e.g. "7.4 ile 7.6 farkları"),
    // run an extra mini vector fetch per version with the OTHER version
    // tokens stripped, union into vectorRows before RRF. Diversity caps
    // still apply downstream. Default OFF (additive, safe to flip live).
    // multiVersionMaxSplits: hard cap on per-turn extra embed calls (latency
    // budget). multiVersionPerLimit: rows pulled per version sub-fetch.
    multiVersionSplit:    String(process.env.RAG_MULTI_VERSION_SPLIT ?? "0") === "1",
    multiVersionMaxSplits: Math.max(2, Math.min(5, envNumber("RAG_MULTI_VERSION_MAX_SPLITS", 3))),
    multiVersionPerLimit:  Math.max(2, Math.min(12, envNumber("RAG_MULTI_VERSION_PER_LIMIT", 6))),
    // multiVersionQuota: when split detected ≥2 versions, guarantee per-version
    // quota in the final top-K (fused + reranked) so dominant-version bias
    // can't crowd out other versions. Default ON; depends on multiVersionSplit.
    multiVersionQuota:    String(process.env.RAG_MULTI_VERSION_QUOTA ?? "1") === "1",
    useEnrichedContent: process.env.RAG_USE_ENRICHED_CONTENT === "1",
    packBrandFilterEnabled: String(process.env.RAG_PACK_BRAND_FILTER ?? "1") !== "0",
    explicitBrandFilter: String(process.env.RAG_EXPLICIT_BRAND_FILTER ?? "1") !== "0",
    denoiseLowercase: String(process.env.RAG_DENOISE_LOWERCASE ?? "1") !== "0",
    queryExtractorEnabled: String(process.env.RAG_QUERY_EXTRACTOR ?? "1") !== "0",
    queryHydeEnabled:      String(process.env.RAG_QUERY_HYDE      ?? "1") !== "0",
    hydeProbeBandLow:  envNumber("RAG_HYDE_PROBE_BAND_LOW",  0.50),
    hydeProbeBandHigh: envNumber("RAG_HYDE_PROBE_BAND_HIGH", 0.80),
    extractorCacheTTL: Math.max(1, envNumber("RAG_EXTRACTOR_CACHE_TTL_H", 24)),
    extractorTimeoutMs:         envNumber("RAG_EXTRACTOR_TIMEOUT_MS",          700),
    hydeTimeoutMs:              envNumber("RAG_HYDE_TIMEOUT_MS",              1200),
    extractorBreakerThreshold:  envNumber("RAG_EXTRACTOR_BREAKER_THRESHOLD",     3),
    extractorBreakerCooldownMs: envNumber("RAG_EXTRACTOR_BREAKER_COOLDOWN_MS", 30000),
    smalltalkFastPath:       String(process.env.SMALLTALK_FAST_PATH ?? "1") !== "0",
    disableThinkOnSmalltalk: String(process.env.DISABLE_THINK_SMALLTALK ?? "1") !== "0",
    disableThinkOnQuery:     String(process.env.DISABLE_THINK_QUERY ?? "1") !== "0",
    disableThinkOnRag:       String(process.env.DISABLE_THINK_RAG   ?? "1") !== "0",
    intentRouterBypass:      String(process.env.INTENT_ROUTER_BYPASS ?? "0") === "1",
    streamToolParse:         String(process.env.STREAM_TOOL_PARSE ?? "1") !== "0",
    streamToolParseOnSmalltalk: String(process.env.STREAM_TOOL_PARSE_ON_SMALLTALK ?? "0") === "1",
    streamToolCallTimeoutMs: Math.max(2000, envNumber("STREAM_TOOL_CALL_TIMEOUT_MS", 30000)),
    includeToolPromptsInAgent: String(process.env.INCLUDE_TOOL_PROMPTS_IN_AGENT ?? "1") !== "0",
    suppressToolManifestOnSmalltalk: String(process.env.SUPPRESS_TOOL_MANIFEST_ON_SMALLTALK ?? "1") !== "0",
    // UI is single authority: if system prompt is authored manually,
    // turn OFF backend ELARA_AGENT_TOOLS injection.
    injectAgentToolsManifest: String(process.env.INJECT_AGENT_TOOLS_MANIFEST ?? "0") === "1",
    // Cold/warmup intent classifier hardening:
    // warmupIntentBudgetMs: budget for initial anchor embedding when model starts cold.
    // coldFallbackToSmalltalk: short ambiguous inputs fall back to smalltalk lane.
    warmupIntentBudgetMs: Math.max(900, envNumber("INTENT_ROUTER_WARMUP_BUDGET_MS", 3500)),
    coldFallbackToSmalltalk: String(process.env.INTENT_COLD_FALLBACK_SMALLTALK ?? "1") !== "0",
    // Backend agent auto-dispatch from model output (default OFF)
    autoDispatchAgentsFromModelOutput: String(process.env.AUTO_DISPATCH_AGENTS_FROM_MODEL ?? "0") !== "0",
    // Pre-LLM user mention dispatch
    userAgentMentionDispatch: String(process.env.USER_AGENT_MENTION_DISPATCH ?? "1") !== "0",
    skipOuterLlmOnAgentRewrite: String(process.env.SKIP_OUTER_LLM_ON_AGENT_REWRITE ?? "1") !== "0",
    streamAgentExec: String(process.env.STREAM_AGENT_EXEC ?? "1") !== "0",
    smalltalkProbeThreshold: envNumber("RAG_SMALLTALK_PROBE_THRESHOLD", 0.65),
    // Warmup / Watchdog / Self-heal runtime flags
    coldWarmupOnDemand: String(process.env.COLD_WARMUP_ON_DEMAND ?? "0") !== "0",
    bootWarmup:         String(process.env.LLM_BOOT_WARMUP_ENABLED ?? "0") !== "0",
    runtimeWatchdogEnabled:String(process.env.RUNTIME_WATCHDOG_ENABLED ?? "0") !== "0",
    selfHealEnabled:    String(process.env.SELF_HEAL_ENABLED ?? "0") !== "0",
    // Runtime safety knobs
    keepwarmEnabled:    String(process.env.KEEPWARM_ENABLED ?? "0") === "1",
    keepwarmIntervalMs: Math.max(15_000, envNumber("KEEPWARM_MS", 45_000)),
    localQueueConcurrency:   Math.max(1, Math.min(4, envNumber("QUEUE_CONCURRENCY", 2))),
    agentQueueBehindChat:  String(process.env.AGENT_QUEUE_BEHIND_CHAT ?? "0") === "1",
    preflightResetEnabled: String(process.env.RESET_URL || "").trim().length > 0,
    historyKeep:        Math.max(2, envNumber("HISTORY_KEEP", 4)),
    coldFirstTokenMs:   Math.max(60_000, envNumber("COLD_FIRST_TOKEN_MS", 120_000)),
    localWarmCacheTtlMs:     Math.max(60_000, envNumber("WARM_CACHE_TTL_MS", 600_000)),
    httpSocketTimeoutMs:   Math.max(10_000, envNumber("HTTP_SOCKET_TIMEOUT_MS",  TIMEOUT_BUDGETS.HTTP_SOCKET_MS)),
    streamTotalMs:      Math.max(10_000, envNumber("STREAM_TOTAL_MS",     TIMEOUT_BUDGETS.STREAM_TOTAL_MS)),
    localQueueWaitMs:        Math.max(1_000,  envNumber("QUEUE_MAX_WAIT_MS",   TIMEOUT_BUDGETS.QUEUE_WAIT_MS)),
    ragProbeDeadlineMs:    Math.max(
      1500,
      envNumber("RAG_DEADLINE_MS", envNumber("RAG_PROBE_DEADLINE_MS", 3000)),
    ),
    preRagDeadlineMs:      Math.max(1500, envNumber("PRE_RAG_DEADLINE_MS", 4000)),
    mixedPromoteRatio:  Math.min(1, Math.max(0.50, envNumber("RAG_MIXED_PROMOTE_RATIO", 0.92))),
    mixedPromoteMinLen: Math.max(1, Math.floor(envNumber("RAG_MIXED_PROMOTE_MIN_LEN", 15))),
    libraryAnchorDynamic:    String(process.env.RAG_LIBRARY_ANCHOR_DYNAMIC ?? "1") !== "0",
    outOfLibraryFallback:    String(process.env.RAG_OUT_OF_LIBRARY_FALLBACK ?? "1") !== "0",
    libraryBrandCacheTtlMs:  Math.max(30_000, envNumber("RAG_LIBRARY_BRAND_CACHE_TTL_MS", 300_000)),
    // Brand-mention gate: if no library brand appears in query, skip RAG and answer directly
    requireBrandMentionForRag: String(process.env.RAG_REQUIRE_BRAND_MENTION ?? "1") !== "0",
    // Minimum chunk threshold to consider brand part of the active library
    libraryBrandMinChunks: Math.max(0, envNumber("RAG_LIBRARY_BRAND_MIN_CHUNKS", 100)),
    stripPriorCitationsOnFreeAnswer: String(process.env.RAG_STRIP_PRIOR_CITATIONS ?? "1") !== "0",
    // Auto-route to agent when non-smalltalk and no explicit tag present
    agentAutoRoute:             String(process.env.AGENT_AUTO_ROUTE ?? "0") === "1",
    agentAutoRouteMinScore:     Math.max(1, envNumber("AGENT_AUTO_ROUTE_MIN_SCORE", 2)),
    agentAutoRouteSkipSmalltalk: String(process.env.AGENT_AUTO_ROUTE_SKIP_SMALLTALK ?? "1") !== "0",
    agentMultiBrand:            String(process.env.AGENT_MULTI_BRAND ?? "1") !== "0",
    // 2026-06-29 — Elara agent manifest injection mode.
    //   off    = `{AGENTS}` placeholder hep boş (prompt en kısa).
    //   lazy   = sadece kullanıcı niyeti "meta" (ajan listesi sorusu) ise dolu.
    //   always = her turda dolu (legacy — TTFT'yi yer).
    // System prompt'a `{AGENTS}` yazılırsa devreye girer; yazılmazsa no-op.
    // Default lazy (kullanıcı sorduğunda otomatik gerçek liste, normal sohbette boş).
    elaraAgentManifestMode: (() => {
      const v = String(process.env.ELARA_AGENT_MANIFEST_MODE ?? "lazy").toLowerCase();
      return (v === "off" || v === "always") ? v : "lazy";
    })(),
    // Meta soruları ("ajanlarını detaylı tanıt") LLM'e göndermek yerine
    // manifestten deterministik cevapla. Default ON: warmup/thinking/RAG yok,
    // model squad seviyesinde özetleyip ajanları atlayamaz.
    elaraAgentManifestDirectAnswer: String(process.env.ELARA_AGENT_MANIFEST_DIRECT_ANSWER ?? "1") !== "0",
    // Semantic anchor threshold for `agent_manifest` intent. Higher = stricter
    // ("kadromu tanıt" hattı sadece net eşleşince açılır). No regex/whitelist;
    // classifier compares user query embedding to INTENT_ANCHORS.agent_manifest.
    agentManifestIntentThreshold: Math.min(0.90, Math.max(0.30, Number(process.env.AGENT_MANIFEST_INTENT_THRESHOLD ?? 0.55))),
    // Manifest anchor must dominate other anchors (meta/rag/smalltalk) by this
    // ratio to flip subKind. Keeps generic "sen kimsin" (metaSim high) safe.
    agentManifestIntentRatio: Math.min(1, Math.max(0.50, Number(process.env.AGENT_MANIFEST_INTENT_RATIO ?? 0.95))),
    // Meta-forge lane knobs — semantic anchor + LLM classifier only (no regex).
    // Defaults loosened 2026-07-05 after deterministic keyword pre-gate removal:
    // threshold 0.50→0.35, verb-ratio 0.85→0.65, vs-rag 0.75→0.55.
    metaForgeIntentThreshold: Math.min(1, Math.max(0.20, Number(process.env.META_FORGE_INTENT_THRESHOLD ?? 0.30))),
    metaForgeIntentRatio:     Math.min(1, Math.max(0.40, Number(process.env.META_FORGE_INTENT_RATIO ?? 0.55))),
    metaForgeVsRagRatio:      Math.min(1, Math.max(0.40, Number(process.env.META_FORGE_VS_RAG_RATIO ?? 0.50))),
    // Auto-apply approved plans inline (no admin approval card). Failure
    // (lint/disk/db) falls back to a 'failed' plan row the admin UI can review.
    metaForgeAutoApply:       String(process.env.META_FORGE_AUTO_APPLY ?? "1") !== "0",
    // 2026-07-05/06 — Auto-Creator hattı (Meta-Forge v2).
    //   autoForgeRouting: outer chat LLM'ine `capabilityGapDirective` enjekte
    //     et → model eksik capability sezerse `@[meta-forge-master]` çağırır.
    //   metaForgeMaxItemsPerTurn: applyForgePlan tek turda kaç item yazsın.
    //   metaForgeRequireConfirm: dry-run preview. ON: forge_preview frame + apply
    //     için ikinci turda "onayla". OFF: preview + apply aynı turda.
    //   metaForgeConfirmExecute: apply sonrası agent varsa `forge_run_prompt`
    //     kartı; kullanıcı UI'dan "Çalıştır" deyince spawn.
    // (Eski Capability Agent proposal/gap-detector hattı 2026-07-06'da tamamen
    //  söküldü — hook, gap-detector, proposals CRUD, HTTP route, UI kartı.)
    autoForgeRouting:                 String(process.env.AUTO_FORGE_ROUTING ?? "1") !== "0",
    metaForgeMaxItemsPerTurn:         Math.max(1, Math.min(10, Number(process.env.META_FORGE_MAX_ITEMS_PER_TURN ?? 3))),
    metaForgeIdempotencyWindowMs:     Math.max(0, Number(process.env.META_FORGE_IDEMPOTENCY_WINDOW_MS ?? 86_400_000)),
    metaForgeRequireConfirm:          String(process.env.META_FORGE_REQUIRE_CONFIRM ?? "1") !== "0",
    metaForgeConfirmExecute:          String(process.env.META_FORGE_CONFIRM_EXECUTE ?? "1") !== "0",
    capabilityGapDirective:           "",
    // metaForgeKeywordGate REMOVED (Tur 6B, 2026-07-04) — semantic anchor + LLM
    // adjudication + orchestrate safety-net retry proved stable 4/4.
    //
    // 2026-07-05 rollback note — "model-declare" injected a Forge protocol
    // system hint into every normal chat turn and regressed trivial smalltalk
    // first-token behavior. Default stays on the semantic+LLM adjudicator path;
    // regex/keyword pre-gates STAY REMOVED.
    //   "pre-classify" (default): semantic anchor + LLM adjudicator + cold-retry.
    //   "model-declare": experimental; model emits <forge .../> and backend
    //      sniffs/strips it. Keep opt-in only.
    //   "off": disable Meta-Forge entirely (no lane, no sniffer, no hint).
    metaForgeGateMode: (() => {
      const raw = String(process.env.META_FORGE_GATE_MODE ?? "pre-classify").toLowerCase();
      return (raw === "model-declare" || raw === "off") ? raw : "pre-classify";
    })(),
    // System-prompt snippet appended to the outer chat LLM when gate mode is
    // "model-declare". Empty string ⇒ fall back to the code default in
    // lib/meta-forge/system-hint.mjs.
    metaForgeSystemHint: String(process.env.META_FORGE_SYSTEM_HINT ?? ""),
    // Stream sniffer scan window (raw chars). After this many chars without a
    // '<' seen, sniffer disables itself and streams passthrough. Larger =
    // catches late tags, smaller = zero overhead sooner.
    metaForgeSnifferWindowChars: Math.max(200, Number(process.env.META_FORGE_SNIFFER_WINDOW ?? 1200)),

    agentRagContextChars:       Math.max(3000, envNumber("AGENT_RAG_CONTEXT_CHARS", 12000)),
    agentExecTimeoutMs:         Math.max(30_000, envNumber("AGENT_EXEC_TIMEOUT_MS", 180_000)),
    // When agent returns no hits / refusal, allow main engine fallback
    agentInsufficientFallback:  String(process.env.AGENT_INSUFFICIENT_FALLBACK ?? "1") !== "0",
    agentInsufficientMinChars:  Math.max(20, envNumber("AGENT_INSUFFICIENT_MIN_CHARS", 80)),
    agentFallbackBanner:        String(process.env.AGENT_FALLBACK_BANNER ?? "1") !== "0",
    outOfLibraryTauBoost:    Math.max(0, envNumber("RAG_OUT_OF_LIBRARY_TAU_BOOST", 0.15)),
    crossBrandMinDominance:  Math.min(1, Math.max(0, envNumber("RAG_CROSS_BRAND_MIN_DOMINANCE", 0.60))),
    crossBrandMinTop1:       Math.min(0.95, Math.max(0.30, envNumber("RAG_CROSS_BRAND_MIN_TOP1", 0.65))),
    autoIngestion: String(process.env.RAG_AUTO_INGESTION ?? "0") === "1",
    autoReEnrichOnIngest: String(process.env.RAG_AUTO_REENRICH_ON_INGEST ?? "0") === "1",
    smalltalkMaxTokens: Math.max(64,  envNumber("SMALLTALK_MAX_TOKENS", 220)),
    queryMaxTokens:     Math.max(256, envNumber("QUERY_MAX_TOKENS",    1000)),
    ragMaxTokens:       Math.max(512, envNumber("RAG_MAX_TOKENS",      2000)),
    crossVendorGuard:      String(process.env.RAG_CROSS_VENDOR_GUARD ?? "1") !== "0",
    stripThinkBlocks:      String(process.env.STRIP_THINK_BLOCKS ?? "1") !== "0",
    stopSequences:      [],
    ragConciseAnswers:     String(process.env.RAG_CONCISE_ANSWERS ?? "0") !== "0",
    ragExpertMode:         String(process.env.RAG_EXPERT_MODE ?? "1") !== "0",
    loopGuardLineMinChars:    Math.max(10, envNumber("ELARA_LOOP_GUARD_LINE_MIN_CHARS", 40)),
    loopGuardLineRepeat:      Math.max(3,  envNumber("ELARA_LOOP_GUARD_LINE_REP", 14)),
    loopGuardSubstringWindow: Math.max(20, envNumber("ELARA_LOOP_GUARD_SUBSTR_WIN", 120)),
    loopGuardSubstringRepeat: Math.max(3,  envNumber("ELARA_LOOP_GUARD_SUBSTR_REP", 20)),
    loopGuardPhraseRepeat:    Math.max(3,  envNumber("ELARA_LOOP_GUARD_PHRASE_REP", 12)),
    inspectorDirective:    "",
    inspectorBrandLock:    "",
    extractorSystemPrompt: "",
    hydeSystemPrompt:      "",
    plannerSystemPrompt:   "",
    thinkOffPrefix:        String(process.env.THINK_OFF_PREFIX ?? "/no_think\n"),
    agentRagWithHitsDirective: "",
    agentRagNoHitsDirective:   "",
    agentToolsManifestFrame:   "",
    productFilter:         String(process.env.RAG_PRODUCT_FILTER ?? "off"),
    productFilterBoost:    Math.min(0.50, Math.max(0, envNumber("RAG_PRODUCT_FILTER_BOOST", 0.05))),
    productAutoExtract:    String(process.env.RAG_PRODUCT_AUTO_EXTRACT ?? "1") !== "0",
    productCacheTtlMs:     Math.max(30_000, envNumber("RAG_PRODUCT_CACHE_TTL_MS", 300_000)),
    // 2026-06-05 — Version-aware rerank boost. If the query contains a
    // major.minor token (e.g. "7.6", "R81.20"), rerank rows whose path
    // contains that token get a small additive bonus. Pure path/token
    // matching, no static product/brand dictionary. 0 disables.
    versionPathBoost:      Math.min(0.50, Math.max(0, envNumber("RAG_VERSION_PATH_BOOST", 0.10))),
    // 2026-06-05 — Per-version candidate pull limit (PATH ILIKE %ver%) before rerank.
    versionCandidateLimit: Math.max(2, Math.min(20, Math.floor(envNumber("RAG_VERSION_CANDIDATE_LIMIT", 6)))),
  };
}

// Apply on-disk JSON overlay onto a mutable settings object with the same
// clamps server.mjs used inline. Returns the mutated object for convenience.
export function applyRagSettingsOverlay(target, j) {
  if (!j || typeof j !== "object") return target;
  if (Number.isFinite(j.similarityThreshold)) target.similarityThreshold = Math.min(1, Math.max(0.01, Number(j.similarityThreshold)));
  if (Number.isFinite(j.topK))               target.topK = Math.min(20, Math.max(1, Math.floor(Number(j.topK))));
  if (Number.isFinite(j.chunkDepth))         target.chunkDepth = Math.min(80, Math.max(5, Math.floor(Number(j.chunkDepth))));
  if (Number.isFinite(j.injectThreshold))    target.injectThreshold = Math.min(0.95, Math.max(0.10, Number(j.injectThreshold)));
  if (Number.isFinite(j.marginGate))         target.marginGate = Math.min(0.50, Math.max(0, Number(j.marginGate)));
  if (typeof j.rerankEnabled === "boolean")  target.rerankEnabled = j.rerankEnabled;
  if (Number.isFinite(j.rerankTopN))         target.rerankTopN = Math.min(24, Math.max(5, Math.floor(Number(j.rerankTopN))));
  if (Number.isFinite(j.rerankTimeoutMs))    target.rerankTimeoutMs = Math.min(8000, Math.max(500, Math.floor(Number(j.rerankTimeoutMs))));
  if (Number.isFinite(j.rerankWeight))       target.rerankWeight = Math.min(1, Math.max(0, Number(j.rerankWeight)));
  if (Number.isFinite(j.rerankMinScore))     target.rerankMinScore = Math.min(1, Math.max(0, Number(j.rerankMinScore)));
  if (Number.isFinite(j.minSupportSources))  target.minSupportSources = Math.min(6, Math.max(0, Math.floor(Number(j.minSupportSources))));
  if (Number.isFinite(j.perSourceCap))       target.perSourceCap = Math.min(10, Math.max(1, Math.floor(Number(j.perSourceCap))));
  if (Number.isFinite(j.perBrandCap))        target.perBrandCap = Math.min(24, Math.max(1, Math.floor(Number(j.perBrandCap))));
  if (Number.isFinite(j.diversityPool))      target.diversityPool = Math.min(500, Math.max(24, Math.floor(Number(j.diversityPool))));
  if (typeof j.multiVersionSplit === "boolean") target.multiVersionSplit = j.multiVersionSplit;
  if (Number.isFinite(j.multiVersionMaxSplits)) target.multiVersionMaxSplits = Math.min(5, Math.max(2, Math.floor(Number(j.multiVersionMaxSplits))));
  if (Number.isFinite(j.multiVersionPerLimit))  target.multiVersionPerLimit  = Math.min(12, Math.max(2, Math.floor(Number(j.multiVersionPerLimit))));
  if (typeof j.multiVersionQuota === "boolean") target.multiVersionQuota = j.multiVersionQuota;
  if (Number.isFinite(j.minChunkChars))      target.minChunkChars = Math.min(500, Math.max(0, Math.floor(Number(j.minChunkChars))));
  if (typeof j.useEnrichedContent === "boolean") target.useEnrichedContent = j.useEnrichedContent;
  if (typeof j.denoiseLowercase === "boolean")   target.denoiseLowercase = j.denoiseLowercase;
  if (typeof j.queryExtractorEnabled === "boolean") target.queryExtractorEnabled = j.queryExtractorEnabled;
  if (typeof j.queryHydeEnabled === "boolean")      target.queryHydeEnabled = j.queryHydeEnabled;
  if (Number.isFinite(j.hydeProbeBandLow))          target.hydeProbeBandLow  = Math.min(0.95, Math.max(0.10, Number(j.hydeProbeBandLow)));
  if (Number.isFinite(j.hydeProbeBandHigh))         target.hydeProbeBandHigh = Math.min(0.95, Math.max(0.10, Number(j.hydeProbeBandHigh)));
  if (Number.isFinite(j.extractorCacheTTL))         target.extractorCacheTTL = Math.min(168, Math.max(1, Math.floor(Number(j.extractorCacheTTL))));
  if (Number.isFinite(j.extractorTimeoutMs))         target.extractorTimeoutMs = Math.min(3000, Math.max(200, Math.floor(Number(j.extractorTimeoutMs))));
  if (Number.isFinite(j.hydeTimeoutMs))              target.hydeTimeoutMs = Math.min(5000, Math.max(300, Math.floor(Number(j.hydeTimeoutMs))));
  if (Number.isFinite(j.extractorBreakerThreshold))  target.extractorBreakerThreshold = Math.min(10, Math.max(1, Math.floor(Number(j.extractorBreakerThreshold))));
  if (Number.isFinite(j.extractorBreakerCooldownMs)) target.extractorBreakerCooldownMs = Math.min(120000, Math.max(5000, Math.floor(Number(j.extractorBreakerCooldownMs))));
  if (typeof j.strictProbeGate === "boolean") target.strictProbeGate = j.strictProbeGate;
  if (typeof j.smalltalkFastPath === "boolean")       target.smalltalkFastPath = j.smalltalkFastPath;
  if (typeof j.disableThinkOnSmalltalk === "boolean") target.disableThinkOnSmalltalk = j.disableThinkOnSmalltalk;
  if (typeof j.disableThinkOnQuery === "boolean")     target.disableThinkOnQuery = j.disableThinkOnQuery;
  if (typeof j.disableThinkOnRag === "boolean")       target.disableThinkOnRag = j.disableThinkOnRag;
  if (typeof j.intentRouterBypass === "boolean")      target.intentRouterBypass = j.intentRouterBypass;
  if (typeof j.streamToolParse === "boolean")         target.streamToolParse = j.streamToolParse;
  if (typeof j.streamToolParseOnSmalltalk === "boolean") target.streamToolParseOnSmalltalk = j.streamToolParseOnSmalltalk;
  if (typeof j.includeToolPromptsInAgent === "boolean") target.includeToolPromptsInAgent = j.includeToolPromptsInAgent;
  if (typeof j.suppressToolManifestOnSmalltalk === "boolean") target.suppressToolManifestOnSmalltalk = j.suppressToolManifestOnSmalltalk;
  if (typeof j.injectAgentToolsManifest === "boolean") target.injectAgentToolsManifest = j.injectAgentToolsManifest;
  if (Number.isFinite(j.warmupIntentBudgetMs)) target.warmupIntentBudgetMs = Math.min(15000, Math.max(900, Math.floor(Number(j.warmupIntentBudgetMs))));
  if (typeof j.coldFallbackToSmalltalk === "boolean") target.coldFallbackToSmalltalk = j.coldFallbackToSmalltalk;
  if (typeof j.userAgentMentionDispatch === "boolean")  target.userAgentMentionDispatch = j.userAgentMentionDispatch;
  if (Number.isFinite(j.smalltalkProbeThreshold))     target.smalltalkProbeThreshold = Math.min(0.95, Math.max(0.10, Number(j.smalltalkProbeThreshold)));
  if (typeof j.coldWarmupOnDemand === "boolean")   target.coldWarmupOnDemand = j.coldWarmupOnDemand;
  if (typeof j.bootWarmup === "boolean")           target.bootWarmup         = j.bootWarmup;
  if (typeof j.runtimeWatchdogEnabled === "boolean")  target.runtimeWatchdogEnabled = j.runtimeWatchdogEnabled;
  if (typeof j.selfHealEnabled === "boolean")      target.selfHealEnabled    = j.selfHealEnabled;
  if (typeof j.keepwarmEnabled === "boolean")      target.keepwarmEnabled    = j.keepwarmEnabled;
  if (Number.isFinite(j.keepwarmIntervalMs))       target.keepwarmIntervalMs = Math.min(600_000, Math.max(15_000, Math.floor(Number(j.keepwarmIntervalMs))));
  if (Number.isFinite(j.localQueueConcurrency))         target.localQueueConcurrency   = Math.min(4, Math.max(1, Math.floor(Number(j.localQueueConcurrency))));
  if (typeof j.agentQueueBehindChat === "boolean")    target.agentQueueBehindChat  = j.agentQueueBehindChat;
  if (typeof j.preflightResetEnabled === "boolean") target.preflightResetEnabled = j.preflightResetEnabled;
  if (Number.isFinite(j.historyKeep))              target.historyKeep = Math.min(40, Math.max(2, Math.floor(Number(j.historyKeep))));
  if (Number.isFinite(j.coldFirstTokenMs))         target.coldFirstTokenMs = Math.min(300_000, Math.max(60_000, Math.floor(Number(j.coldFirstTokenMs))));
  if (Number.isFinite(j.localWarmCacheTtlMs))           target.localWarmCacheTtlMs = Math.min(3_600_000, Math.max(60_000, Math.floor(Number(j.localWarmCacheTtlMs))));
  if (Number.isFinite(j.httpSocketTimeoutMs))         target.httpSocketTimeoutMs = Math.min(600_000, Math.max(10_000, Math.floor(Number(j.httpSocketTimeoutMs))));
  if (Number.isFinite(j.streamTotalMs))            target.streamTotalMs    = Math.min(600_000, Math.max(10_000, Math.floor(Number(j.streamTotalMs))));
  if (Number.isFinite(j.localQueueWaitMs))              target.localQueueWaitMs      = Math.min(300_000, Math.max(1_000,  Math.floor(Number(j.localQueueWaitMs))));
  if (Number.isFinite(j.ragProbeDeadlineMs))          target.ragProbeDeadlineMs = Math.min(8000, Math.max(1500, Math.floor(Number(j.ragProbeDeadlineMs))));
  if (Number.isFinite(j.preRagDeadlineMs))            target.preRagDeadlineMs   = Math.min(15000, Math.max(1500, Math.floor(Number(j.preRagDeadlineMs))));
  if (Number.isFinite(j.mixedPromoteRatio))           target.mixedPromoteRatio  = Math.min(1, Math.max(0.50, Number(j.mixedPromoteRatio)));
  if (Number.isFinite(j.mixedPromoteMinLen))          target.mixedPromoteMinLen = Math.min(120, Math.max(1, Math.floor(Number(j.mixedPromoteMinLen))));
  if (typeof j.libraryAnchorDynamic === "boolean")    target.libraryAnchorDynamic = j.libraryAnchorDynamic;
  if (typeof j.outOfLibraryFallback === "boolean")    target.outOfLibraryFallback = j.outOfLibraryFallback;
  if (Number.isFinite(j.libraryBrandCacheTtlMs))      target.libraryBrandCacheTtlMs = Math.min(3_600_000, Math.max(30_000, Math.floor(Number(j.libraryBrandCacheTtlMs))));
  if (Number.isFinite(j.libraryBrandMinChunks))       target.libraryBrandMinChunks = Math.min(100000, Math.max(0, Math.floor(Number(j.libraryBrandMinChunks))));
  if (typeof j.requireBrandMentionForRag === "boolean") target.requireBrandMentionForRag = j.requireBrandMentionForRag;
  if (typeof j.stripPriorCitationsOnFreeAnswer === "boolean") target.stripPriorCitationsOnFreeAnswer = j.stripPriorCitationsOnFreeAnswer;
  if (typeof j.agentAutoRoute === "boolean")          target.agentAutoRoute = j.agentAutoRoute;
  if (Number.isFinite(j.agentAutoRouteMinScore))      target.agentAutoRouteMinScore = Math.min(10, Math.max(1, Math.floor(Number(j.agentAutoRouteMinScore))));
  if (typeof j.agentMultiBrand === "boolean")         target.agentMultiBrand = j.agentMultiBrand;
  if (typeof j.elaraAgentManifestMode === "string") {
    const v = j.elaraAgentManifestMode.toLowerCase();
    if (v === "off" || v === "lazy" || v === "always") target.elaraAgentManifestMode = v;
  }
  if (typeof j.elaraAgentManifestDirectAnswer === "boolean") target.elaraAgentManifestDirectAnswer = j.elaraAgentManifestDirectAnswer;
  if (Number.isFinite(Number(j.agentManifestIntentThreshold))) {
    target.agentManifestIntentThreshold = Math.min(0.90, Math.max(0.30, Number(j.agentManifestIntentThreshold)));
  }
  if (Number.isFinite(Number(j.agentManifestIntentRatio))) {
    target.agentManifestIntentRatio = Math.min(1, Math.max(0.50, Number(j.agentManifestIntentRatio)));
  }
  if (Number.isFinite(Number(j.metaForgeIntentThreshold))) target.metaForgeIntentThreshold = Math.min(1, Math.max(0.20, Number(j.metaForgeIntentThreshold)));
  if (Number.isFinite(Number(j.metaForgeIntentRatio)))     target.metaForgeIntentRatio     = Math.min(1, Math.max(0.40, Number(j.metaForgeIntentRatio)));
  if (Number.isFinite(Number(j.metaForgeVsRagRatio)))      target.metaForgeVsRagRatio      = Math.min(1, Math.max(0.40, Number(j.metaForgeVsRagRatio)));
  if (typeof j.metaForgeAutoApply === "boolean")           target.metaForgeAutoApply       = j.metaForgeAutoApply;
  if (typeof j.metaForgeGateMode === "string") {
    const v = j.metaForgeGateMode.toLowerCase();
    if (v === "model-declare" || v === "pre-classify" || v === "off") target.metaForgeGateMode = v;
  }
  if (typeof j.metaForgeSystemHint === "string") target.metaForgeSystemHint = j.metaForgeSystemHint.slice(0, 4000);
  if (Number.isFinite(Number(j.metaForgeSnifferWindowChars))) {
    target.metaForgeSnifferWindowChars = Math.min(8000, Math.max(200, Math.floor(Number(j.metaForgeSnifferWindowChars))));
  }
  // metaForgeKeywordGate reader REMOVED (Tur 6B, 2026-07-04) — stale UI JSON
  // that still carries the key is silently ignored.

  if (Number.isFinite(j.agentRagContextChars))        target.agentRagContextChars = Math.min(24000, Math.max(3000, Math.floor(Number(j.agentRagContextChars))));
  if (Number.isFinite(j.agentExecTimeoutMs))           target.agentExecTimeoutMs = Math.min(300_000, Math.max(30_000, Math.floor(Number(j.agentExecTimeoutMs))));
  if (typeof j.agentInsufficientFallback === "boolean") target.agentInsufficientFallback = j.agentInsufficientFallback;
  if (Number.isFinite(j.agentInsufficientMinChars))   target.agentInsufficientMinChars = Math.min(2000, Math.max(20, Math.floor(Number(j.agentInsufficientMinChars))));
  if (typeof j.agentFallbackBanner === "boolean")     target.agentFallbackBanner = j.agentFallbackBanner;
  if (Number.isFinite(j.outOfLibraryTauBoost))        target.outOfLibraryTauBoost = Math.min(0.50, Math.max(0, Number(j.outOfLibraryTauBoost)));
  if (Number.isFinite(j.crossBrandMinDominance))      target.crossBrandMinDominance = Math.min(1, Math.max(0, Number(j.crossBrandMinDominance)));
  if (Number.isFinite(j.crossBrandMinTop1))           target.crossBrandMinTop1 = Math.min(0.95, Math.max(0.30, Number(j.crossBrandMinTop1)));
  if (typeof j.autoIngestion === "boolean")           target.autoIngestion = j.autoIngestion;
  if (typeof j.autoReEnrichOnIngest === "boolean")    target.autoReEnrichOnIngest = j.autoReEnrichOnIngest;
  if (typeof j.packBrandFilterEnabled === "boolean")  target.packBrandFilterEnabled = j.packBrandFilterEnabled;
  if (typeof j.explicitBrandFilter === "boolean")     target.explicitBrandFilter = j.explicitBrandFilter;
  if (Number.isFinite(j.smalltalkMaxTokens)) target.smalltalkMaxTokens = Math.min(4000, Math.max(64,  Math.floor(Number(j.smalltalkMaxTokens))));
  if (Number.isFinite(j.queryMaxTokens))     target.queryMaxTokens     = Math.min(8000, Math.max(256, Math.floor(Number(j.queryMaxTokens))));
  if (Number.isFinite(j.ragMaxTokens))       target.ragMaxTokens       = Math.min(8000, Math.max(512, Math.floor(Number(j.ragMaxTokens))));
  if (typeof j.crossVendorGuard === "boolean")  target.crossVendorGuard      = j.crossVendorGuard;
  if (typeof j.stripThinkBlocks === "boolean")  target.stripThinkBlocks      = j.stripThinkBlocks;
  if (typeof j.ragConciseAnswers === "boolean") target.ragConciseAnswers     = j.ragConciseAnswers;
  if (typeof j.ragExpertMode === "boolean")     target.ragExpertMode         = j.ragExpertMode;
  if (Array.isArray(j.stopSequences))        target.stopSequences      = j.stopSequences.map((s) => String(s || "")).filter((s) => s.length > 0 && s.length <= 64).slice(0, 16);
  if (Number.isFinite(j.loopGuardLineMinChars))    target.loopGuardLineMinChars    = Math.min(200, Math.max(10, Math.floor(Number(j.loopGuardLineMinChars))));
  if (Number.isFinite(j.loopGuardLineRepeat))      target.loopGuardLineRepeat      = Math.min(20,  Math.max(3,  Math.floor(Number(j.loopGuardLineRepeat))));
  if (Number.isFinite(j.loopGuardSubstringWindow)) target.loopGuardSubstringWindow = Math.min(200, Math.max(20, Math.floor(Number(j.loopGuardSubstringWindow))));
  if (Number.isFinite(j.loopGuardSubstringRepeat)) target.loopGuardSubstringRepeat = Math.min(20,  Math.max(3,  Math.floor(Number(j.loopGuardSubstringRepeat))));
  if (Number.isFinite(j.loopGuardPhraseRepeat))    target.loopGuardPhraseRepeat    = Math.min(20,  Math.max(3,  Math.floor(Number(j.loopGuardPhraseRepeat))));
  if (typeof j.productFilter === "string") {
    const v = j.productFilter.toLowerCase();
    if (v === "off" || v === "boost" || v === "hard") target.productFilter = v;
  }
  if (Number.isFinite(j.productFilterBoost)) target.productFilterBoost = Math.min(0.50, Math.max(0, Number(j.productFilterBoost)));
  if (typeof j.productAutoExtract === "boolean") target.productAutoExtract = j.productAutoExtract;
  if (Number.isFinite(j.productCacheTtlMs)) target.productCacheTtlMs = Math.min(3_600_000, Math.max(30_000, Math.floor(Number(j.productCacheTtlMs))));
  // 2026-06-03 UI tek mercii prompt overrides. String knobs, opsiyonel.
  // Boş string ("") → kodda default'a düş (lib/system-prompts.mjs).
  for (const k of [
    "inspectorDirective","inspectorBrandLock","extractorSystemPrompt","hydeSystemPrompt",
    "plannerSystemPrompt",
    "agentRagWithHitsDirective","agentRagNoHitsDirective","agentToolsManifestFrame",
  ]) {
    if (typeof j[k] === "string") target[k] = j[k].slice(0, 8000);
  }
  // 2026-06-03 (Tur 2) — `/no_think` prefix knob (kısa, max 64 char).
  if (typeof j.thinkOffPrefix === "string") target.thinkOffPrefix = j.thinkOffPrefix.slice(0, 64);
  return target;
}

// Load disk JSON (if any) and apply overlay to target. Silent on read/parse error.
export function loadRagSettingsFromDisk({ fs, file, target }) {
  try {
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      applyRagSettingsOverlay(target, j);
    }
  } catch (e) { console.warn("[rag-settings:load]", e.message); }
  return target;
}
