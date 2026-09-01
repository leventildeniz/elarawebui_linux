// =============================================================================
// RAG SETTINGS — GET/POST /api/rag/settings
// Pure body→RAG_SETTINGS mutation + bounds/defaults exposure.
// Extracted from server.mjs 2026-05-30 (pre-SHA f2716750fdeb).
// Getter pattern: RAG_SETTINGS / RAG_DEFAULTS / normalizeRagSettings are
// declared in server.mjs AFTER mount call site, so we defer access via fns.
// =============================================================================

export function mountRagSettingsRoutes({
  app,
  getRagSettings,
  setRagSettings,
  getRagDefaults,
  normalizeRagSettings,
  saveRagSettings,
}) {
  app.get("/api/rag/settings", (_req, res) => {
    const normalized = normalizeRagSettings(getRagSettings());
    setRagSettings(normalized);
    res.json({
      ok: true,
      settings: { ...normalized },
      bounds: {
        similarityThreshold: { min: 0.01, max: 1, step: 0.01 },
        topK: { min: 1, max: 20, step: 1 },
        chunkDepth: { min: 5, max: 80, step: 1 },
        injectThreshold: { min: 0.10, max: 0.95, step: 0.01 },
        marginGate:      { min: 0.00, max: 0.50, step: 0.01 },
        rerankTopN:      { min: 5,    max: 24,   step: 1 },
        rerankTimeoutMs: { min: 500,  max: 8000, step: 100 },
        rerankWeight:    { min: 0.00, max: 1.00, step: 0.01 },
        rerankMinScore:  { min: 0.00, max: 1.00, step: 0.01 },
        minSupportSources: { min: 0, max: 6, step: 1 },
        perSourceCap:    { min: 1,    max: 10,   step: 1 },
        perBrandCap:     { min: 1,    max: 24,   step: 1 },
        diversityPool:   { min: 24,   max: 500,  step: 1 },
        minChunkChars:   { min: 0,    max: 500,  step: 25 },
        smalltalkProbeThreshold: { min: 0.20, max: 0.80, step: 0.01 },
        hydeProbeBandLow:  { min: 0.30, max: 0.70, step: 0.01 },
        hydeProbeBandHigh: { min: 0.60, max: 0.95, step: 0.01 },
        extractorCacheTTL: { min: 1,    max: 168,  step: 1 },
        extractorTimeoutMs:         { min: 200,  max: 3000,   step: 50 },
        hydeTimeoutMs:              { min: 300,  max: 5000,   step: 100 },
        extractorBreakerThreshold:  { min: 1,    max: 10,     step: 1 },
        mlxColdFirstTokenMs:        { min: 60000, max: 300000,  step: 5000 },
        localWarmCacheTtlMs:          { min: 60000, max: 3600000, step: 30000 },
        extractorBreakerCooldownMs: { min: 5000, max: 120000, step: 1000 },
        ragProbeDeadlineMs:         { min: 1500, max: 8000,   step: 250 },
        preRagDeadlineMs:           { min: 1500, max: 15000,  step: 250 },
        metaForgeIntentThreshold:   { min: 0.20, max: 1.00,   step: 0.01 },
        metaForgeIntentRatio:       { min: 0.40, max: 1.00,   step: 0.01 },
        metaForgeVsRagRatio:        { min: 0.40, max: 1.00,   step: 0.01 },
        metaForgeIdempotencyWindowMs: { min: 0, max: 86400000, step: 60000 },
        mixedPromoteRatio:          { min: 0.50, max: 1.00,   step: 0.01 },
        mixedPromoteMinLen:         { min: 1,    max: 120,    step: 1 },
        outOfLibraryTauBoost:       { min: 0.00, max: 0.50,   step: 0.01 },
        crossBrandMinDominance:     { min: 0.00, max: 1.00,   step: 0.05 },
        crossBrandMinTop1:          { min: 0.30, max: 0.95,   step: 0.01 },
        libraryBrandCacheTtlMs:     { min: 30000, max: 3600000, step: 30000 },
        libraryBrandMinChunks:      { min: 0,    max: 5000,    step: 10 },
        agentAutoRouteMinScore:     { min: 1, max: 10, step: 1 },
        agentRagContextChars:       { min: 3000, max: 24000, step: 500 },
        agentExecTimeoutMs:         { min: 30000, max: 300000, step: 5000 },
        agentInsufficientMinChars:  { min: 20, max: 2000, step: 10 },
        mlxSmalltalkMaxTokens:      { min: 64,   max: 4000, step: 16 },
        mlxQueryMaxTokens:          { min: 256,  max: 8000, step: 32 },
        mlxRagMaxTokens:            { min: 512,  max: 8000, step: 32 },
        loopGuardLineMinChars:      { min: 10,   max: 200,  step: 5 },
        loopGuardLineRepeat:        { min: 3,    max: 20,   step: 1 },
        loopGuardSubstringWindow:   { min: 20,   max: 200,  step: 5 },
        loopGuardSubstringRepeat:   { min: 3,    max: 20,   step: 1 },
        loopGuardPhraseRepeat:      { min: 3,    max: 20,   step: 1 },
        productFilterBoost:         { min: 0.00, max: 0.50, step: 0.01 },
        productCacheTtlMs:          { min: 30000, max: 3600000, step: 30000 },
      },
      defaults: { ...getRagDefaults() },
    });
  });

  app.post("/api/rag/settings", async (req, res) => {
    const body = req.body || {};
    const RAG_SETTINGS = getRagSettings();
    if (body.similarityThreshold != null) {
      const v = Number(body.similarityThreshold);
      if (Number.isFinite(v)) RAG_SETTINGS.similarityThreshold = Math.min(1, Math.max(0.01, v));
    }
    if (body.topK != null) {
      const v = Math.floor(Number(body.topK));
      if (Number.isFinite(v)) RAG_SETTINGS.topK = Math.min(20, Math.max(1, v));
    }
    if (body.chunkDepth != null) {
      const v = Math.floor(Number(body.chunkDepth));
      if (Number.isFinite(v)) RAG_SETTINGS.chunkDepth = Math.min(80, Math.max(5, v));
    }
    if (body.injectThreshold != null) {
      const v = Number(body.injectThreshold);
      if (Number.isFinite(v)) RAG_SETTINGS.injectThreshold = Math.min(0.95, Math.max(0.10, v));
    }
    if (body.marginGate != null) {
      const v = Number(body.marginGate);
      if (Number.isFinite(v)) RAG_SETTINGS.marginGate = Math.min(0.50, Math.max(0, v));
    }
    if (body.rerankEnabled != null) {
      RAG_SETTINGS.rerankEnabled = !!body.rerankEnabled;
    }
    if (body.rerankTopN != null) {
      const v = Math.floor(Number(body.rerankTopN));
      if (Number.isFinite(v)) RAG_SETTINGS.rerankTopN = Math.min(24, Math.max(5, v));
    }
    if (body.rerankTimeoutMs != null) {
      const v = Math.floor(Number(body.rerankTimeoutMs));
      if (Number.isFinite(v)) RAG_SETTINGS.rerankTimeoutMs = Math.min(8000, Math.max(500, v));
    }
    if (body.rerankWeight != null) {
      const v = Number(body.rerankWeight);
      if (Number.isFinite(v)) RAG_SETTINGS.rerankWeight = Math.min(1, Math.max(0, v));
    }
    if (body.queryExtractorEnabled != null) {
      RAG_SETTINGS.queryExtractorEnabled = !!body.queryExtractorEnabled;
    }
    if (body.queryHydeEnabled != null) {
      RAG_SETTINGS.queryHydeEnabled = !!body.queryHydeEnabled;
    }
    if (body.hydeProbeBandLow != null) {
      const v = Number(body.hydeProbeBandLow);
      if (Number.isFinite(v)) RAG_SETTINGS.hydeProbeBandLow = Math.min(0.95, Math.max(0.10, v));
    }
    if (body.hydeProbeBandHigh != null) {
      const v = Number(body.hydeProbeBandHigh);
      if (Number.isFinite(v)) RAG_SETTINGS.hydeProbeBandHigh = Math.min(0.95, Math.max(0.10, v));
    }
    if (body.extractorCacheTTL != null) {
      const v = Math.floor(Number(body.extractorCacheTTL));
      if (Number.isFinite(v)) RAG_SETTINGS.extractorCacheTTL = Math.min(168, Math.max(1, v));
    }
    if (body.extractorTimeoutMs != null) {
      const v = Math.floor(Number(body.extractorTimeoutMs));
      if (Number.isFinite(v)) RAG_SETTINGS.extractorTimeoutMs = Math.min(3000, Math.max(200, v));
    }
    if (body.hydeTimeoutMs != null) {
      const v = Math.floor(Number(body.hydeTimeoutMs));
      if (Number.isFinite(v)) RAG_SETTINGS.hydeTimeoutMs = Math.min(5000, Math.max(300, v));
    }
    if (body.extractorBreakerThreshold != null) {
      const v = Math.floor(Number(body.extractorBreakerThreshold));
      if (Number.isFinite(v)) RAG_SETTINGS.extractorBreakerThreshold = Math.min(10, Math.max(1, v));
    }
    if (body.extractorBreakerCooldownMs != null) {
      const v = Math.floor(Number(body.extractorBreakerCooldownMs));
      if (Number.isFinite(v)) RAG_SETTINGS.extractorBreakerCooldownMs = Math.min(120000, Math.max(5000, v));
    }
    if (body.strictProbeGate != null) {
      RAG_SETTINGS.strictProbeGate = !!body.strictProbeGate;
    }
    if (body.rerankMinScore != null) {
      const v = Number(body.rerankMinScore);
      if (Number.isFinite(v)) RAG_SETTINGS.rerankMinScore = Math.min(1, Math.max(0, v));
    }
    if (body.minSupportSources != null) {
      const v = Math.floor(Number(body.minSupportSources));
      if (Number.isFinite(v)) RAG_SETTINGS.minSupportSources = Math.min(6, Math.max(0, v));
    }
    if (body.perSourceCap != null) {
      const v = Math.floor(Number(body.perSourceCap));
      if (Number.isFinite(v)) RAG_SETTINGS.perSourceCap = Math.min(10, Math.max(1, v));
    }
    if (body.perBrandCap != null) {
      const v = Math.floor(Number(body.perBrandCap));
      if (Number.isFinite(v)) RAG_SETTINGS.perBrandCap = Math.min(24, Math.max(1, v));
    }
    if (body.diversityPool != null) {
      const v = Math.floor(Number(body.diversityPool));
      if (Number.isFinite(v)) RAG_SETTINGS.diversityPool = Math.min(500, Math.max(24, v));
    }
    if (body.multiVersionSplit != null) {
      RAG_SETTINGS.multiVersionSplit = !!body.multiVersionSplit;
    }
    if (body.multiVersionMaxSplits != null) {
      const v = Math.floor(Number(body.multiVersionMaxSplits));
      if (Number.isFinite(v)) RAG_SETTINGS.multiVersionMaxSplits = Math.min(5, Math.max(2, v));
    }
    if (body.multiVersionPerLimit != null) {
      const v = Math.floor(Number(body.multiVersionPerLimit));
      if (Number.isFinite(v)) RAG_SETTINGS.multiVersionPerLimit = Math.min(12, Math.max(2, v));
    }
    if (body.multiVersionQuota != null) {
      RAG_SETTINGS.multiVersionQuota = !!body.multiVersionQuota;
    }
    if (body.minChunkChars != null) {
      const v = Math.floor(Number(body.minChunkChars));
      if (Number.isFinite(v)) RAG_SETTINGS.minChunkChars = Math.min(500, Math.max(0, v));
    }
    if (body.useEnrichedContent != null) {
      RAG_SETTINGS.useEnrichedContent = !!body.useEnrichedContent;
    }
    if (body.packBrandFilterEnabled != null) {
      RAG_SETTINGS.packBrandFilterEnabled = !!body.packBrandFilterEnabled;
    }
    if (body.explicitBrandFilter != null) {
      RAG_SETTINGS.explicitBrandFilter = !!body.explicitBrandFilter;
    }
    if (body.denoiseLowercase != null) {
      RAG_SETTINGS.denoiseLowercase = !!body.denoiseLowercase;
    }
    if (body.smalltalkFastPath != null) {
      RAG_SETTINGS.smalltalkFastPath = !!body.smalltalkFastPath;
    }
    if (body.disableThinkOnSmalltalk != null) {
      RAG_SETTINGS.disableThinkOnSmalltalk = !!body.disableThinkOnSmalltalk;
    }
    if (body.disableThinkOnQuery != null) {
      RAG_SETTINGS.disableThinkOnQuery = !!body.disableThinkOnQuery;
    }
    if (body.disableThinkOnRag != null) {
      RAG_SETTINGS.disableThinkOnRag = !!body.disableThinkOnRag;
    }
    if (body.intentRouterBypass != null) {
      RAG_SETTINGS.intentRouterBypass = !!body.intentRouterBypass;
    }
    if (body.streamToolParse != null) {
      RAG_SETTINGS.streamToolParse = !!body.streamToolParse;
    }
    if (body.streamToolParseOnSmalltalk != null) {
      RAG_SETTINGS.streamToolParseOnSmalltalk = !!body.streamToolParseOnSmalltalk;
    }
    if (body.includeToolPromptsInAgent != null) {
      RAG_SETTINGS.includeToolPromptsInAgent = !!body.includeToolPromptsInAgent;
    }
    if (body.suppressToolManifestOnSmalltalk != null) {
      RAG_SETTINGS.suppressToolManifestOnSmalltalk = !!body.suppressToolManifestOnSmalltalk;
    }
    if (body.injectAgentToolsManifest != null) {
      RAG_SETTINGS.injectAgentToolsManifest = !!body.injectAgentToolsManifest;
    }
    if (body.warmupIntentBudgetMs != null) {
      const v = Math.floor(Number(body.warmupIntentBudgetMs));
      if (Number.isFinite(v)) RAG_SETTINGS.warmupIntentBudgetMs = Math.min(15000, Math.max(900, v));
    }
    if (body.coldFallbackToSmalltalk != null) {
      RAG_SETTINGS.coldFallbackToSmalltalk = !!body.coldFallbackToSmalltalk;
    }
    if (body.autoDispatchAgentsFromModelOutput != null) {
      RAG_SETTINGS.autoDispatchAgentsFromModelOutput = !!body.autoDispatchAgentsFromModelOutput;
    }
    if (body.streamToolCallTimeoutMs != null) {
      const v = Math.floor(Number(body.streamToolCallTimeoutMs));
      if (Number.isFinite(v)) RAG_SETTINGS.streamToolCallTimeoutMs = Math.min(120000, Math.max(2000, v));
    }
    if (body.smalltalkProbeThreshold != null) {
      const v = Number(body.smalltalkProbeThreshold);
      if (Number.isFinite(v)) RAG_SETTINGS.smalltalkProbeThreshold = Math.min(0.95, Math.max(0.10, v));
    }
    if (body.mlxColdWarmupOnDemand != null) {
      RAG_SETTINGS.mlxColdWarmupOnDemand = !!body.mlxColdWarmupOnDemand;
    }
    if (body.mlxBootWarmup != null) {
      RAG_SETTINGS.mlxBootWarmup = !!body.mlxBootWarmup;
    }
    if (body.runtimeWatchdogEnabled != null) {
      RAG_SETTINGS.runtimeWatchdogEnabled = !!body.runtimeWatchdogEnabled;
    }
    if (body.mlxSelfHealEnabled != null) {
      RAG_SETTINGS.mlxSelfHealEnabled = !!body.mlxSelfHealEnabled;
    }
    // 2026-06-26 — Runtime Safety knobs (UI = System Engine → Runtime Safety).
    if (body.mlxKeepwarmEnabled != null) {
      RAG_SETTINGS.mlxKeepwarmEnabled = !!body.mlxKeepwarmEnabled;
    }
    if (body.mlxKeepwarmIntervalMs != null) {
      const v = Math.floor(Number(body.mlxKeepwarmIntervalMs));
      if (Number.isFinite(v)) RAG_SETTINGS.mlxKeepwarmIntervalMs = Math.min(600_000, Math.max(15_000, v));
    }
    if (body.localQueueConcurrency != null) {
      const v = Math.floor(Number(body.localQueueConcurrency));
      if (Number.isFinite(v)) {
        RAG_SETTINGS.localQueueConcurrency = Math.min(4, Math.max(1, v));
        try {
          const { localQueue } = await import("../mlx-queue.mjs");
          localQueue.setConcurrency(RAG_SETTINGS.localQueueConcurrency);
        } catch { /* tolerate */ }
      }
    }
    if (body.agentQueueBehindChat != null) {
      RAG_SETTINGS.agentQueueBehindChat = !!body.agentQueueBehindChat;
      try {
        const qc = await import("../queue-config.mjs");
        qc.setAgentPriorityOverride(RAG_SETTINGS.agentQueueBehindChat ? qc.QUEUE_PRIORITY.AGENT_LOW : qc.QUEUE_PRIORITY.CHAT_DEFAULT);
      } catch { /* tolerate */ }
    }
    if (body.mlxPreflightResetEnabled != null) {
      RAG_SETTINGS.mlxPreflightResetEnabled = !!body.mlxPreflightResetEnabled;
      try {
        const t = await import("../mlx-transport.mjs");
        t.LOCAL_TRANSPORT.resetEnabled = !!RAG_SETTINGS.mlxPreflightResetEnabled;
      } catch { /* tolerate */ }
    }
    if (body.userAgentMentionDispatch != null) {
      RAG_SETTINGS.userAgentMentionDispatch = !!body.userAgentMentionDispatch;
    }
    if (body.skipOuterLlmOnAgentRewrite != null) {
      RAG_SETTINGS.skipOuterLlmOnAgentRewrite = !!body.skipOuterLlmOnAgentRewrite;
    }
    if (body.streamAgentExec != null) {
      RAG_SETTINGS.streamAgentExec = !!body.streamAgentExec;
    }
    if (body.agentExecTimeoutMs != null) {
      const v = Math.floor(Number(body.agentExecTimeoutMs));
      if (Number.isFinite(v)) RAG_SETTINGS.agentExecTimeoutMs = Math.min(300_000, Math.max(30_000, v));
    }
    if (body.mlxHistoryKeep != null) {
      const v = Math.floor(Number(body.mlxHistoryKeep));
      if (Number.isFinite(v)) RAG_SETTINGS.mlxHistoryKeep = Math.min(40, Math.max(2, v));
    }
    if (body.mlxColdFirstTokenMs != null) {
      const v = Math.floor(Number(body.mlxColdFirstTokenMs));
      if (Number.isFinite(v)) RAG_SETTINGS.mlxColdFirstTokenMs = Math.min(300_000, Math.max(60_000, v));
    }
    if (body.localWarmCacheTtlMs != null) {
      const v = Math.floor(Number(body.localWarmCacheTtlMs));
      if (Number.isFinite(v)) RAG_SETTINGS.localWarmCacheTtlMs = Math.min(3_600_000, Math.max(60_000, v));
    }
    if (body.httpSocketTimeoutMs != null) {
      const v = Math.floor(Number(body.httpSocketTimeoutMs));
      if (Number.isFinite(v)) RAG_SETTINGS.httpSocketTimeoutMs = Math.min(600_000, Math.max(10_000, v));
    }
    if (body.mlxStreamTotalMs != null) {
      const v = Math.floor(Number(body.mlxStreamTotalMs));
      if (Number.isFinite(v)) RAG_SETTINGS.mlxStreamTotalMs = Math.min(600_000, Math.max(10_000, v));
    }
    if (body.localQueueWaitMs != null) {
      const v = Math.floor(Number(body.localQueueWaitMs));
      if (Number.isFinite(v)) RAG_SETTINGS.localQueueWaitMs = Math.min(300_000, Math.max(1_000, v));
    }
    if (body.ragProbeDeadlineMs != null) {
      const v = Math.floor(Number(body.ragProbeDeadlineMs));
      if (Number.isFinite(v)) RAG_SETTINGS.ragProbeDeadlineMs = Math.min(8000, Math.max(1500, v));
    }
    if (body.preRagDeadlineMs != null) {
      const v = Math.floor(Number(body.preRagDeadlineMs));
      if (Number.isFinite(v)) RAG_SETTINGS.preRagDeadlineMs = Math.min(15000, Math.max(1500, v));
    }
    if (body.metaForgeIntentThreshold != null) {
      const v = Number(body.metaForgeIntentThreshold);
      if (Number.isFinite(v)) RAG_SETTINGS.metaForgeIntentThreshold = Math.min(1, Math.max(0.20, v));
    }
    if (body.metaForgeIntentRatio != null) {
      const v = Number(body.metaForgeIntentRatio);
      if (Number.isFinite(v)) RAG_SETTINGS.metaForgeIntentRatio = Math.min(1, Math.max(0.40, v));
    }
    if (body.metaForgeVsRagRatio != null) {
      const v = Number(body.metaForgeVsRagRatio);
      if (Number.isFinite(v)) RAG_SETTINGS.metaForgeVsRagRatio = Math.min(1, Math.max(0.40, v));
    }
    if (typeof body.metaForgeAutoApply === "boolean") {
      RAG_SETTINGS.metaForgeAutoApply = body.metaForgeAutoApply;
    }
    if (body.mixedPromoteRatio != null) {
      const v = Number(body.mixedPromoteRatio);
      if (Number.isFinite(v)) RAG_SETTINGS.mixedPromoteRatio = Math.min(1, Math.max(0.50, v));
    }
    if (body.mixedPromoteMinLen != null) {
      const v = Math.floor(Number(body.mixedPromoteMinLen));
      if (Number.isFinite(v)) RAG_SETTINGS.mixedPromoteMinLen = Math.min(120, Math.max(1, v));
    }
    if (body.outOfLibraryTauBoost != null) {
      const v = Number(body.outOfLibraryTauBoost);
      if (Number.isFinite(v)) RAG_SETTINGS.outOfLibraryTauBoost = Math.min(0.50, Math.max(0, v));
    }
    if (body.crossBrandMinDominance != null) {
      const v = Number(body.crossBrandMinDominance);
      if (Number.isFinite(v)) RAG_SETTINGS.crossBrandMinDominance = Math.min(1, Math.max(0, v));
    }
    if (body.crossBrandMinTop1 != null) {
      const v = Number(body.crossBrandMinTop1);
      if (Number.isFinite(v)) RAG_SETTINGS.crossBrandMinTop1 = Math.min(0.95, Math.max(0.30, v));
    }
    if (body.outOfLibraryFallback != null) {
      RAG_SETTINGS.outOfLibraryFallback = !!body.outOfLibraryFallback;
    }
    if (body.libraryBrandCacheTtlMs != null) {
      const v = Math.floor(Number(body.libraryBrandCacheTtlMs));
      if (Number.isFinite(v)) RAG_SETTINGS.libraryBrandCacheTtlMs = Math.min(3_600_000, Math.max(30_000, v));
    }
    if (body.requireBrandMentionForRag != null) {
      RAG_SETTINGS.requireBrandMentionForRag = !!body.requireBrandMentionForRag;
    }
    if (body.libraryBrandMinChunks != null) {
      const v = Math.floor(Number(body.libraryBrandMinChunks));
      if (Number.isFinite(v)) RAG_SETTINGS.libraryBrandMinChunks = Math.min(100000, Math.max(0, v));
    }
    if (body.autoIngestion != null) {
      RAG_SETTINGS.autoIngestion = !!body.autoIngestion;
    }
    if (body.autoReEnrichOnIngest != null) {
      RAG_SETTINGS.autoReEnrichOnIngest = !!body.autoReEnrichOnIngest;
    }
    // v13 — Output token caps
    for (const key of ["mlxSmalltalkMaxTokens","mlxQueryMaxTokens","mlxRagMaxTokens",
                       "loopGuardLineMinChars","loopGuardLineRepeat","loopGuardSubstringWindow",
                       "loopGuardSubstringRepeat","loopGuardPhraseRepeat"]) {
      if (body[key] != null) {
        const v = Number(body[key]);
        if (Number.isFinite(v)) RAG_SETTINGS[key] = Math.floor(v);
      }
    }
    // v16 — Answer Safety knobs (UI = tek mercii).
    if (body.crossVendorGuard  != null) RAG_SETTINGS.crossVendorGuard  = !!body.crossVendorGuard;
    if (body.stripThinkBlocks  != null) RAG_SETTINGS.stripThinkBlocks  = !!body.stripThinkBlocks;
    if (body.ragConciseAnswers != null) RAG_SETTINGS.ragConciseAnswers = !!body.ragConciseAnswers;
    if (body.ragExpertMode     != null) RAG_SETTINGS.ragExpertMode     = !!body.ragExpertMode;
    if (Array.isArray(body.mlxStopSequences)) {
      RAG_SETTINGS.mlxStopSequences = body.mlxStopSequences
        .map((s) => String(s || ""))
        .filter((s) => s.length > 0 && s.length <= 64)
        .slice(0, 16);
    }
    // sampling knobs (top_p/repetition_penalty/frequency_penalty) RAG_SETTINGS'ten
    // SÖKÜLDÜ — model editörü (models.params) tek mercii. Burada kabul edilmez.

    // System prompt overrides loop moved below (combined with Tur 2 agent knobs).

    // Agent Delegation knobs (auto-route + insufficient → Elara fallback)
    if (body.agentAutoRoute != null) {
      RAG_SETTINGS.agentAutoRoute = !!body.agentAutoRoute;
    }
    if (body.agentAutoRouteMinScore != null) {
      const v = Math.floor(Number(body.agentAutoRouteMinScore));
      if (Number.isFinite(v)) RAG_SETTINGS.agentAutoRouteMinScore = Math.min(10, Math.max(1, v));
    }
    if (body.agentAutoRouteSkipSmalltalk != null) {
      RAG_SETTINGS.agentAutoRouteSkipSmalltalk = !!body.agentAutoRouteSkipSmalltalk;
    }
    if (body.agentMultiBrand != null) {
      RAG_SETTINGS.agentMultiBrand = !!body.agentMultiBrand;
    }
    if (typeof body.elaraAgentManifestMode === "string") {
      const v = body.elaraAgentManifestMode.toLowerCase();
      if (v === "off" || v === "lazy" || v === "always") RAG_SETTINGS.elaraAgentManifestMode = v;
    }
    if (body.elaraAgentManifestDirectAnswer != null) {
      RAG_SETTINGS.elaraAgentManifestDirectAnswer = !!body.elaraAgentManifestDirectAnswer;
    }
    if (body.agentRagContextChars != null) {
      const v = Math.floor(Number(body.agentRagContextChars));
      if (Number.isFinite(v)) RAG_SETTINGS.agentRagContextChars = Math.min(24000, Math.max(3000, v));
    }
    if (body.agentInsufficientFallback != null) {
      RAG_SETTINGS.agentInsufficientFallback = !!body.agentInsufficientFallback;
    }
    if (body.agentInsufficientMinChars != null) {
      const v = Math.floor(Number(body.agentInsufficientMinChars));
      if (Number.isFinite(v)) RAG_SETTINGS.agentInsufficientMinChars = Math.min(2000, Math.max(20, v));
    }
    if (body.agentFallbackBanner != null) {
      RAG_SETTINGS.agentFallbackBanner = !!body.agentFallbackBanner;
    }
    if (body.stripPriorCitationsOnFreeAnswer != null) {
      RAG_SETTINGS.stripPriorCitationsOnFreeAnswer = !!body.stripPriorCitationsOnFreeAnswer;
    }
    // 2026-06-03 (Tur 2) — Prompt overrides + agent layers.
    for (const k of [
      "inspectorDirective","inspectorBrandLock","extractorSystemPrompt","hydeSystemPrompt",
      "plannerSystemPrompt",
      "agentRagWithHitsDirective","agentRagNoHitsDirective","agentToolsManifestFrame",
    ]) {
      if (typeof body[k] === "string") RAG_SETTINGS[k] = body[k].slice(0, 8000);
    }
    if (typeof body.thinkOffPrefix === "string") RAG_SETTINGS.thinkOffPrefix = body.thinkOffPrefix.slice(0, 64);

    // 2026-06-26 — Product-aware retrieval filter (UI tek mercii).
    if (body.productFilter != null) {
      const v = String(body.productFilter || "off").toLowerCase();
      if (v === "off" || v === "boost" || v === "hard") RAG_SETTINGS.productFilter = v;
    }
    if (body.productFilterBoost != null) {
      const v = Number(body.productFilterBoost);
      if (Number.isFinite(v)) RAG_SETTINGS.productFilterBoost = Math.min(0.50, Math.max(0, v));
    }
    if (body.productAutoExtract != null) {
      RAG_SETTINGS.productAutoExtract = !!body.productAutoExtract;
    }
    if (body.productCacheTtlMs != null) {
      const v = Math.floor(Number(body.productCacheTtlMs));
      if (Number.isFinite(v)) RAG_SETTINGS.productCacheTtlMs = Math.min(3_600_000, Math.max(30_000, v));
    }

    saveRagSettings();

    res.json({ ok: true, settings: { ...RAG_SETTINGS } });
  });
}
