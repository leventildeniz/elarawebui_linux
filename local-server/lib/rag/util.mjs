// lib/rag/util.mjs — pure RAG utility extracted from server.mjs (Tur A, 2026-05-30).
// Factory pattern: state RAG_SETTINGS / RAG_SETTINGS_FILE accessed via DI.
// Pre-state SHA: 2b3ce1f1a7a0

// Defensive re-export: RAG_STOP_ASCII canonical home is ./scoring.mjs but
// legacy consumers may import from util.mjs. Forwarding keeps both paths green.
export { RAG_STOP, RAG_STOP_ASCII } from "./scoring.mjs";


export function createRagUtil(deps) {
  const {
    fs,
    RAG_DEFAULTS,
    RAG_SETTINGS_FILE,
    getRagSettings,
    setRagSettings,
    makeThinkStripper,
    brandSync,
    brandDisplay,
    stopAllWatchers,
    bootstrapWatchers,
  } = deps;

  function diagnoseChatTrace(events) {
    if (!events || events.length === 0) return "Trace bulunamadı (id yanlış olabilir).";
    const stages = events.map(e => e.stage);
    const has = (s) => stages.includes(s);
    const ev = (s) => events.find(e => e.stage === s);
    const hasFirstToken = has("mlx.first_token.received") || has("mlx.first_token");
    const slotAcquired = has("local.slot.acquired");
    const enqueued = has("mlx.queue.enqueued");
    const last = events[events.length - 1];

    const abortEv = ev("client.aborted") || ev("mlx.client_abort");
    if (abortEv && !hasFirstToken) {
      const reason = String(abortEv.detail?.reason || abortEv.detail?.error || "client closed").slice(0, 120);
      return `İstemci bağlantıyı kapattı (${reason}) — MLX hâlâ ayakta olabilir, restart gerekmiyor.`;
    }

    const resetEv = ev("mlx.first_token_timeout") || ev("mlx.reset") || ev("error.thrown");
    const diag = resetEv?.detail?.diag || null;
    if (resetEv && diag) {
      if (diag.clientAborted) {
        return `İstemci bağlantıyı kapattı — MLX sağlam, restart gerekmiyor.`;
      }
      if (enqueued && !diag.slotAcquired) {
        return `KUYRUK TIKANDI · istek slot alamadı (queueWaitMs≈${diag.queueWaitMs}ms) — başka bir üretim slotu tutuyor (zombi slot olabilir). Çözüm: Restart MLX.`;
      }
      if (diag.slotAcquired && !diag.firstToken) {
        const budgetMs = resetEv.detail?.budgetMs || 0;
        return `LOCAL SESSİZ · slot alındı (queueWaitMs=${diag.queueWaitMs}ms), fetch=${diag.fetchStarted} ama ${process.env.LOCAL_RUNTIME_PORT || 8001} ${budgetMs ? Math.round(budgetMs/1000) + "sn" : ""} içinde token üretmedi. Doğrudan test edip (curl :${process.env.LOCAL_RUNTIME_PORT || 8001}) LOCAL sağlamsa middleware/abort hattı, değilse Restart Local.`;
      }
    }
    if (has("mlx.headers_timeout")) return `Local header timeout — auto-reset tetiklendi (${process.env.LOCAL_RUNTIME_PORT || 8001} cevap vermedi).`;
    if (has("mlx.first_token_timeout")) return "MLX first-token timeout — model yüklendi ama token üretmedi.";
    if (has("mlx.reset")) return "MLX bağlantısı resetlendi (Model Meşgul).";

    if (hasFirstToken) {
      const ft = ev("mlx.first_token.received");
      const q = ft?.detail?.queueWaitMs, g = ft?.detail?.mlxGenMs;
      if (has("mlx.stream.done")) return `Akış tamamlandı · queueWait=${q ?? "?"}ms mlxGen=${g ?? "?"}ms.`;
      return `Token üretiliyor · queueWait=${q ?? "?"}ms mlxGen=${g ?? "?"}ms.`;
    }
    if (enqueued && !slotAcquired) return `Kuyrukta bekliyor · henüz slot alınmadı (son aşama: ${last?.stage}).`;
    if (slotAcquired) return `Slot alındı, ilk token bekleniyor (son aşama: ${last?.stage}).`;
    if (last?.stage === "sse.closed") return "SSE kapandı, token üretilmedi.";
    return `Devam ediyor · son aşama: ${last?.stage}`;
  }

  function _makeThinkStripper() { return makeThinkStripper(getRagSettings()); }

  function _ragNumber(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function _ragBool(value, fallback) {
    return typeof value === "boolean" ? value : !!fallback;
  }

  function normalizeRagSettings(src = {}) {
    return {
      ...RAG_DEFAULTS,
      similarityThreshold: Math.min(1, Math.max(0.01, _ragNumber(src.similarityThreshold, RAG_DEFAULTS.similarityThreshold))),
      topK: Math.min(20, Math.max(1, Math.floor(_ragNumber(src.topK, RAG_DEFAULTS.topK)))),
      chunkDepth: Math.min(80, Math.max(5, Math.floor(_ragNumber(src.chunkDepth, RAG_DEFAULTS.chunkDepth)))),
      injectThreshold: Math.min(0.95, Math.max(0.10, _ragNumber(src.injectThreshold, RAG_DEFAULTS.injectThreshold))),
      marginGate: Math.min(0.50, Math.max(0, _ragNumber(src.marginGate, RAG_DEFAULTS.marginGate))),
      rerankEnabled: _ragBool(src.rerankEnabled, RAG_DEFAULTS.rerankEnabled),
      rerankTopN: Math.min(24, Math.max(5, Math.floor(_ragNumber(src.rerankTopN, RAG_DEFAULTS.rerankTopN)))),
      rerankTimeoutMs: Math.min(8000, Math.max(500, Math.floor(_ragNumber(src.rerankTimeoutMs, RAG_DEFAULTS.rerankTimeoutMs)))),
      rerankWeight: Math.min(1, Math.max(0, _ragNumber(src.rerankWeight, RAG_DEFAULTS.rerankWeight))),
      rerankMinScore: Math.min(1, Math.max(0, _ragNumber(src.rerankMinScore, RAG_DEFAULTS.rerankMinScore))),
      minSupportSources: Math.min(6, Math.max(0, Math.floor(_ragNumber(src.minSupportSources, RAG_DEFAULTS.minSupportSources)))),
      perSourceCap: Math.min(10, Math.max(1, Math.floor(_ragNumber(src.perSourceCap, RAG_DEFAULTS.perSourceCap)))),
      perBrandCap: Math.min(24, Math.max(1, Math.floor(_ragNumber(src.perBrandCap, RAG_DEFAULTS.perBrandCap)))),
      diversityPool: Math.min(500, Math.max(24, Math.floor(_ragNumber(src.diversityPool, RAG_DEFAULTS.diversityPool)))),
      multiVersionSplit: _ragBool(src.multiVersionSplit, RAG_DEFAULTS.multiVersionSplit),
      multiVersionMaxSplits: Math.min(5, Math.max(2, Math.floor(_ragNumber(src.multiVersionMaxSplits, RAG_DEFAULTS.multiVersionMaxSplits)))),
      multiVersionPerLimit: Math.min(12, Math.max(2, Math.floor(_ragNumber(src.multiVersionPerLimit, RAG_DEFAULTS.multiVersionPerLimit)))),
      multiVersionQuota: _ragBool(src.multiVersionQuota, RAG_DEFAULTS.multiVersionQuota),
      minChunkChars: Math.min(500, Math.max(0, Math.floor(_ragNumber(src.minChunkChars, RAG_DEFAULTS.minChunkChars)))),
      useEnrichedContent: _ragBool(src.useEnrichedContent, RAG_DEFAULTS.useEnrichedContent),
      packBrandFilterEnabled: _ragBool(src.packBrandFilterEnabled, RAG_DEFAULTS.packBrandFilterEnabled),
      explicitBrandFilter: _ragBool(src.explicitBrandFilter, RAG_DEFAULTS.explicitBrandFilter),
      denoiseLowercase: _ragBool(src.denoiseLowercase, RAG_DEFAULTS.denoiseLowercase),
      queryExtractorEnabled: _ragBool(src.queryExtractorEnabled, RAG_DEFAULTS.queryExtractorEnabled),
      queryHydeEnabled:      _ragBool(src.queryHydeEnabled, RAG_DEFAULTS.queryHydeEnabled),
      hydeProbeBandLow:  Math.min(0.95, Math.max(0.10, _ragNumber(src.hydeProbeBandLow,  RAG_DEFAULTS.hydeProbeBandLow))),
      hydeProbeBandHigh: Math.min(0.95, Math.max(0.10, _ragNumber(src.hydeProbeBandHigh, RAG_DEFAULTS.hydeProbeBandHigh))),
      extractorCacheTTL: Math.min(168, Math.max(1, Math.floor(_ragNumber(src.extractorCacheTTL, RAG_DEFAULTS.extractorCacheTTL)))),
      extractorTimeoutMs:         Math.min(3000,   Math.max(200,  Math.floor(_ragNumber(src.extractorTimeoutMs,         RAG_DEFAULTS.extractorTimeoutMs)))),
      hydeTimeoutMs:              Math.min(5000,   Math.max(300,  Math.floor(_ragNumber(src.hydeTimeoutMs,              RAG_DEFAULTS.hydeTimeoutMs)))),
      extractorBreakerThreshold:  Math.min(10,     Math.max(1,    Math.floor(_ragNumber(src.extractorBreakerThreshold,  RAG_DEFAULTS.extractorBreakerThreshold)))),
      extractorBreakerCooldownMs: Math.min(120000, Math.max(5000, Math.floor(_ragNumber(src.extractorBreakerCooldownMs, RAG_DEFAULTS.extractorBreakerCooldownMs)))),
      strictProbeGate: _ragBool(src.strictProbeGate, RAG_DEFAULTS.strictProbeGate),
      smalltalkFastPath:       _ragBool(src.smalltalkFastPath,       RAG_DEFAULTS.smalltalkFastPath),
      disableThinkOnSmalltalk: _ragBool(src.disableThinkOnSmalltalk, RAG_DEFAULTS.disableThinkOnSmalltalk),
      disableThinkOnQuery:     _ragBool(src.disableThinkOnQuery,     RAG_DEFAULTS.disableThinkOnQuery),
      disableThinkOnRag:       _ragBool(src.disableThinkOnRag,       RAG_DEFAULTS.disableThinkOnRag),
      intentRouterBypass:      _ragBool(src.intentRouterBypass,      RAG_DEFAULTS.intentRouterBypass),
      streamToolParse:         _ragBool(src.streamToolParse,         RAG_DEFAULTS.streamToolParse),
      streamToolParseOnSmalltalk: _ragBool(src.streamToolParseOnSmalltalk, RAG_DEFAULTS.streamToolParseOnSmalltalk),
      streamToolCallTimeoutMs: Math.min(120000, Math.max(2000, Math.floor(_ragNumber(src.streamToolCallTimeoutMs, RAG_DEFAULTS.streamToolCallTimeoutMs)))),
      includeToolPromptsInAgent: _ragBool(src.includeToolPromptsInAgent, RAG_DEFAULTS.includeToolPromptsInAgent),
      suppressToolManifestOnSmalltalk: _ragBool(src.suppressToolManifestOnSmalltalk, RAG_DEFAULTS.suppressToolManifestOnSmalltalk),
      injectAgentToolsManifest: _ragBool(src.injectAgentToolsManifest, RAG_DEFAULTS.injectAgentToolsManifest),
      warmupIntentBudgetMs: Math.min(15000, Math.max(900, Math.floor(_ragNumber(src.warmupIntentBudgetMs, RAG_DEFAULTS.warmupIntentBudgetMs)))),
      coldFallbackToSmalltalk: _ragBool(src.coldFallbackToSmalltalk, RAG_DEFAULTS.coldFallbackToSmalltalk),
      autoDispatchAgentsFromModelOutput: _ragBool(src.autoDispatchAgentsFromModelOutput, RAG_DEFAULTS.autoDispatchAgentsFromModelOutput),
      smalltalkProbeThreshold: Math.min(0.95, Math.max(0.10, _ragNumber(src.smalltalkProbeThreshold, RAG_DEFAULTS.smalltalkProbeThreshold))),
      mlxColdWarmupOnDemand: _ragBool(src.mlxColdWarmupOnDemand, RAG_DEFAULTS.mlxColdWarmupOnDemand),
      mlxBootWarmup:         _ragBool(src.mlxBootWarmup,         RAG_DEFAULTS.mlxBootWarmup),
      runtimeWatchdogEnabled:_ragBool(src.runtimeWatchdogEnabled,RAG_DEFAULTS.runtimeWatchdogEnabled),
      mlxSelfHealEnabled:    _ragBool(src.mlxSelfHealEnabled,    RAG_DEFAULTS.mlxSelfHealEnabled),
      mlxKeepwarmEnabled:    _ragBool(src.mlxKeepwarmEnabled,    RAG_DEFAULTS.mlxKeepwarmEnabled),
      mlxKeepwarmIntervalMs: Math.min(600_000, Math.max(15_000, Math.floor(_ragNumber(src.mlxKeepwarmIntervalMs, RAG_DEFAULTS.mlxKeepwarmIntervalMs)))),
      localQueueConcurrency:   Math.min(4, Math.max(1, Math.floor(_ragNumber(src.localQueueConcurrency, RAG_DEFAULTS.localQueueConcurrency)))),
      agentQueueBehindChat:  _ragBool(src.agentQueueBehindChat,  RAG_DEFAULTS.agentQueueBehindChat),
      mlxPreflightResetEnabled: _ragBool(src.mlxPreflightResetEnabled, RAG_DEFAULTS.mlxPreflightResetEnabled),
      skipOuterLlmOnAgentRewrite: _ragBool(src.skipOuterLlmOnAgentRewrite, RAG_DEFAULTS.skipOuterLlmOnAgentRewrite),
      streamAgentExec:       _ragBool(src.streamAgentExec,       RAG_DEFAULTS.streamAgentExec),
      mlxColdFirstTokenMs:   Math.min(300_000,   Math.max(60_000, Math.floor(_ragNumber(src.mlxColdFirstTokenMs, RAG_DEFAULTS.mlxColdFirstTokenMs)))),
      localWarmCacheTtlMs:     Math.min(3_600_000, Math.max(60_000, Math.floor(_ragNumber(src.localWarmCacheTtlMs,   RAG_DEFAULTS.localWarmCacheTtlMs)))),
      httpSocketTimeoutMs:   Math.min(600_000,   Math.max(10_000, Math.floor(_ragNumber(src.httpSocketTimeoutMs, RAG_DEFAULTS.httpSocketTimeoutMs)))),
      mlxStreamTotalMs:      Math.min(600_000,   Math.max(10_000, Math.floor(_ragNumber(src.mlxStreamTotalMs,    RAG_DEFAULTS.mlxStreamTotalMs)))),
      localQueueWaitMs:        Math.min(300_000,   Math.max(1_000,  Math.floor(_ragNumber(src.localQueueWaitMs,      RAG_DEFAULTS.localQueueWaitMs)))),
      ragProbeDeadlineMs:    Math.min(8000,      Math.max(1500,   Math.floor(_ragNumber(src.ragProbeDeadlineMs,  RAG_DEFAULTS.ragProbeDeadlineMs)))),
      preRagDeadlineMs:      Math.min(15000,     Math.max(1500,   Math.floor(_ragNumber(src.preRagDeadlineMs,    RAG_DEFAULTS.preRagDeadlineMs)))),
      mixedPromoteRatio:     Math.min(1,         Math.max(0.50,   _ragNumber(src.mixedPromoteRatio,  RAG_DEFAULTS.mixedPromoteRatio))),
      mixedPromoteMinLen:    Math.min(120,       Math.max(1,      Math.floor(_ragNumber(src.mixedPromoteMinLen, RAG_DEFAULTS.mixedPromoteMinLen)))),
      outOfLibraryTauBoost:  Math.min(0.50,      Math.max(0,      _ragNumber(src.outOfLibraryTauBoost,   RAG_DEFAULTS.outOfLibraryTauBoost))),
      crossBrandMinDominance:Math.min(1,         Math.max(0,      _ragNumber(src.crossBrandMinDominance, RAG_DEFAULTS.crossBrandMinDominance))),
      crossBrandMinTop1:     Math.min(0.95,      Math.max(0.30,   _ragNumber(src.crossBrandMinTop1,      RAG_DEFAULTS.crossBrandMinTop1))),
      metaForgeIntentThreshold: Math.min(1, Math.max(0.20, _ragNumber(src.metaForgeIntentThreshold, RAG_DEFAULTS.metaForgeIntentThreshold ?? 0.30))),
      metaForgeIntentRatio:     Math.min(1, Math.max(0.40, _ragNumber(src.metaForgeIntentRatio,     RAG_DEFAULTS.metaForgeIntentRatio ?? 0.55))),
      metaForgeVsRagRatio:      Math.min(1, Math.max(0.40, _ragNumber(src.metaForgeVsRagRatio,      RAG_DEFAULTS.metaForgeVsRagRatio ?? 0.50))),
      metaForgeAutoApply:       _ragBool(src.metaForgeAutoApply, RAG_DEFAULTS.metaForgeAutoApply ?? true),
      metaForgeIdempotencyWindowMs: Math.min(86_400_000, Math.max(0, Math.floor(_ragNumber(src.metaForgeIdempotencyWindowMs, RAG_DEFAULTS.metaForgeIdempotencyWindowMs ?? 86_400_000)))),
      stripPriorCitationsOnFreeAnswer: _ragBool(src.stripPriorCitationsOnFreeAnswer, RAG_DEFAULTS.stripPriorCitationsOnFreeAnswer),
      agentAutoRoute:             _ragBool(src.agentAutoRoute,            RAG_DEFAULTS.agentAutoRoute),
      agentAutoRouteMinScore:     Math.min(10,   Math.max(1,  Math.floor(_ragNumber(src.agentAutoRouteMinScore,    RAG_DEFAULTS.agentAutoRouteMinScore)))),
      agentAutoRouteSkipSmalltalk: _ragBool(src.agentAutoRouteSkipSmalltalk, RAG_DEFAULTS.agentAutoRouteSkipSmalltalk),
      agentMultiBrand:            _ragBool(src.agentMultiBrand,           RAG_DEFAULTS.agentMultiBrand),
      elaraAgentManifestMode:      ["off", "lazy", "always"].includes(String(src.elaraAgentManifestMode || "").toLowerCase())
        ? String(src.elaraAgentManifestMode).toLowerCase()
        : (RAG_DEFAULTS.elaraAgentManifestMode || "lazy"),
      elaraAgentManifestDirectAnswer: _ragBool(src.elaraAgentManifestDirectAnswer, RAG_DEFAULTS.elaraAgentManifestDirectAnswer),
      agentRagContextChars:       Math.min(24000, Math.max(3000, Math.floor(_ragNumber(src.agentRagContextChars, RAG_DEFAULTS.agentRagContextChars)))),
      agentExecTimeoutMs:         Math.min(300_000, Math.max(30_000, Math.floor(_ragNumber(src.agentExecTimeoutMs, RAG_DEFAULTS.agentExecTimeoutMs)))),
      agentInsufficientFallback:  _ragBool(src.agentInsufficientFallback, RAG_DEFAULTS.agentInsufficientFallback),
      agentInsufficientMinChars:  Math.min(2000, Math.max(20, Math.floor(_ragNumber(src.agentInsufficientMinChars, RAG_DEFAULTS.agentInsufficientMinChars)))),
      agentFallbackBanner:        _ragBool(src.agentFallbackBanner,       RAG_DEFAULTS.agentFallbackBanner),
      autoIngestion:         _ragBool(src.autoIngestion, RAG_DEFAULTS.autoIngestion),
      autoReEnrichOnIngest:  _ragBool(src.autoReEnrichOnIngest, RAG_DEFAULTS.autoReEnrichOnIngest),
      mlxSmalltalkMaxTokens: Math.min(4000, Math.max(64,  Math.floor(_ragNumber(src.mlxSmalltalkMaxTokens, RAG_DEFAULTS.mlxSmalltalkMaxTokens)))),
      mlxQueryMaxTokens:     Math.min(8000, Math.max(256, Math.floor(_ragNumber(src.mlxQueryMaxTokens,     RAG_DEFAULTS.mlxQueryMaxTokens)))),
      mlxRagMaxTokens:       Math.min(8000, Math.max(512, Math.floor(_ragNumber(src.mlxRagMaxTokens,       RAG_DEFAULTS.mlxRagMaxTokens)))),
      crossVendorGuard:      _ragBool(src.crossVendorGuard, RAG_DEFAULTS.crossVendorGuard),
      stripThinkBlocks:      _ragBool(src.stripThinkBlocks, RAG_DEFAULTS.stripThinkBlocks),
      ragConciseAnswers:     _ragBool(src.ragConciseAnswers, RAG_DEFAULTS.ragConciseAnswers),
      ragExpertMode:         _ragBool(src.ragExpertMode,     RAG_DEFAULTS.ragExpertMode),
      mlxStopSequences:      Array.isArray(src.mlxStopSequences)
        ? src.mlxStopSequences.map((s) => String(s || "")).filter((s) => s.length > 0 && s.length <= 64).slice(0, 16)
        : (Array.isArray(RAG_DEFAULTS.mlxStopSequences) ? RAG_DEFAULTS.mlxStopSequences : []),
      loopGuardLineMinChars:    Math.min(200, Math.max(10, Math.floor(_ragNumber(src.loopGuardLineMinChars,    RAG_DEFAULTS.loopGuardLineMinChars)))),
      loopGuardLineRepeat:      Math.min(20,  Math.max(3,  Math.floor(_ragNumber(src.loopGuardLineRepeat,      RAG_DEFAULTS.loopGuardLineRepeat)))),
      loopGuardSubstringWindow: Math.min(200, Math.max(20, Math.floor(_ragNumber(src.loopGuardSubstringWindow, RAG_DEFAULTS.loopGuardSubstringWindow)))),
      loopGuardSubstringRepeat: Math.min(20,  Math.max(3,  Math.floor(_ragNumber(src.loopGuardSubstringRepeat, RAG_DEFAULTS.loopGuardSubstringRepeat)))),
      loopGuardPhraseRepeat:    Math.min(20,  Math.max(3,  Math.floor(_ragNumber(src.loopGuardPhraseRepeat,    RAG_DEFAULTS.loopGuardPhraseRepeat)))),
      productFilter:            ["off", "boost", "hard"].includes(String(src.productFilter || "").toLowerCase())
        ? String(src.productFilter).toLowerCase()
        : (RAG_DEFAULTS.productFilter || "off"),
      productFilterBoost:       Math.min(0.50, Math.max(0, _ragNumber(src.productFilterBoost, RAG_DEFAULTS.productFilterBoost))),
      productAutoExtract:       _ragBool(src.productAutoExtract, RAG_DEFAULTS.productAutoExtract),
      productCacheTtlMs:        Math.min(3_600_000, Math.max(30_000, Math.floor(_ragNumber(src.productCacheTtlMs, RAG_DEFAULTS.productCacheTtlMs)))),
      versionPathBoost:         Math.min(0.50, Math.max(0, _ragNumber(src.versionPathBoost, RAG_DEFAULTS.versionPathBoost))),
      versionCandidateLimit:    Math.max(2, Math.min(20, Math.floor(_ragNumber(src.versionCandidateLimit, RAG_DEFAULTS.versionCandidateLimit)))),
      // 2026-06-03 — UI tek mercii system prompt overrides. Boş string → default fallback.
      inspectorDirective:    (typeof src.inspectorDirective    === "string") ? src.inspectorDirective.slice(0, 8000)    : (RAG_DEFAULTS.inspectorDirective    || ""),
      inspectorBrandLock:    (typeof src.inspectorBrandLock    === "string") ? src.inspectorBrandLock.slice(0, 8000)    : (RAG_DEFAULTS.inspectorBrandLock    || ""),
      extractorSystemPrompt: (typeof src.extractorSystemPrompt === "string") ? src.extractorSystemPrompt.slice(0, 8000) : (RAG_DEFAULTS.extractorSystemPrompt || ""),
      hydeSystemPrompt:      (typeof src.hydeSystemPrompt      === "string") ? src.hydeSystemPrompt.slice(0, 8000)      : (RAG_DEFAULTS.hydeSystemPrompt      || ""),
    };
  }

  function saveRagSettings() {
    const next = normalizeRagSettings(getRagSettings());
    setRagSettings(next);
    try { fs.writeFileSync(RAG_SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8"); }
    catch (e) { console.warn("[rag-settings:save]", e.message); }
    // v12 — reconcile fs.watch state with autoIngestion knob.
    try {
      if (!next.autoIngestion && typeof stopAllWatchers === "function") {
        stopAllWatchers();
      } else if (next.autoIngestion && typeof bootstrapWatchers === "function") {
        bootstrapWatchers().catch(() => {});
      }
    } catch {}
  }

  // UI = TEK MERCİİ (2026-06-02). Backend free-answer turunda kendi promptunu
  // eklemez. Tek istisna: knob `stripPriorCitationsOnFreeAnswer` ON ise (default)
  // önceki assistant mesajlarının sonundaki "Kaynaklar:/Sources:/References:"
  // footer bloğu sökülür — aksi halde model RAG kapalıyken bile bu formatı
  // taklit edip kitap adı uydurabilir (halüsinasyon citation).
  function _stripCitationFooter(text) {
    if (typeof text !== "string" || !text) return text;
    // En sondaki "Kaynaklar:" / "Kaynaklar\n" / "Sources:" / "References:" başlığından itibaren sil.
    const re = /\n{1,3}(?:\*\*\s*)?(?:kaynak(?:ça|lar)?|sources?|references?|citations?)\s*(?:\*\*)?\s*:?\s*\n[\s\S]*$/i;
    const stripped = text.replace(re, "").trimEnd();
    return stripped.length >= 16 ? stripped : text; // çok agresif kesme guard'ı
  }
  function buildFreeAnswerMessages(messages, _reason = "rag_bypass", _ctx = null) {
    if (!Array.isArray(messages)) return [];
    let strip = true;
    try { strip = getRagSettings()?.stripPriorCitationsOnFreeAnswer !== false; } catch { strip = true; }
    if (!strip) return messages;
    return messages.map((m) => {
      if (!m || m.role !== "assistant" || typeof m.content !== "string") return m;
      const next = _stripCitationFooter(m.content);
      return next === m.content ? m : { ...m, content: next };
    });
  }


  return {
    diagnoseChatTrace,
    _makeThinkStripper,
    _ragNumber,
    _ragBool,
    normalizeRagSettings,
    saveRagSettings,
    buildFreeAnswerMessages,
  };
}
