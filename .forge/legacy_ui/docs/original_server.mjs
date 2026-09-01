// Sovereign AI OS — Local Node.js Middleware (sync touch)
// Bare-metal: Express + node-postgres. No cloud DB. Async persistence.
// Binary uploads (.pcap, .pdf, .docx, ...) go to UPLOAD_DIR with a metadata row.
import { config as loadDotenv } from "dotenv";
import { fileURLToPath as _fu } from "node:url";
import path_boot from "node:path";
import fs_boot from "node:fs";
// System Env (launchd/plist) WINS over .env. .env only fills missing keys.
// Resolve .env relative to this file (absolute path) so launchd/macOS services
// don't get lost when CWD differs from the source directory.
const __bootDir = path_boot.dirname(_fu(import.meta.url));
const _envPath = path_boot.join(__bootDir, ".env");
if (fs_boot.existsSync(_envPath)) loadDotenv({ path: _envPath, override: false });
else loadDotenv({ override: false });

// v15.1 — Pending code/config swap (left by a Full restore right before exit).
// Marker lives at <local-server>/.pending-swap.json and points to a staging
// directory inside BACKUP_DIR. We move staging → real paths BEFORE binding the
// port so a restore that touches server.mjs / src/ takes effect on the next boot.
try {
  const _swapMarker = path_boot.join(__bootDir, ".pending-swap.json");
  if (fs_boot.existsSync(_swapMarker)) {
    const m = JSON.parse(fs_boot.readFileSync(_swapMarker, "utf8"));
    const _projectRoot = path_boot.resolve(__bootDir, "..");
    const _backupPrev = path_boot.join(m.backup_dir, `_pre-swap-${m.stamp}`);
    fs_boot.mkdirSync(_backupPrev, { recursive: true });
    for (const item of m.items || []) {
      const realAbs   = path_boot.resolve(_projectRoot, item.real);
      const stageAbs  = path_boot.resolve(m.staging_dir, item.staged);
      if (!fs_boot.existsSync(stageAbs)) continue;
      const prevAbs   = path_boot.join(_backupPrev, item.real.replace(/[/\\]/g, "__"));
      try {
        if (fs_boot.existsSync(realAbs)) fs_boot.renameSync(realAbs, prevAbs);
        fs_boot.mkdirSync(path_boot.dirname(realAbs), { recursive: true });
        fs_boot.renameSync(stageAbs, realAbs);
        console.log(`[pending-swap] applied ${item.real}`);
      } catch (e) {
        console.error(`[pending-swap] FAIL ${item.real}: ${e.message} — rolling back`);
        try { if (fs_boot.existsSync(prevAbs)) fs_boot.renameSync(prevAbs, realAbs); } catch {}
      }
    }
    try { fs_boot.unlinkSync(_swapMarker); } catch {}
    try { fs_boot.rmSync(m.staging_dir, { recursive: true, force: true }); } catch {}
    console.log(`[pending-swap] complete (prev kept at ${_backupPrev})`);
  }
} catch (e) {
  console.error(`[pending-swap] orchestrator error: ${e.message}`);
}

// Global crash dampers — stream cancel async rejection / yarıda kalan upstream
// hattı yüzünden launchd döngüsüne girmesin. Bir kez logla, process'i öldürme.
process.on("unhandledRejection", (reason) => {
  console.error(`[unhandledRejection] ${reason?.stack || reason?.message || reason}`);
});
process.on("uncaughtException", (err) => {
  console.error(`[uncaughtException] ${err?.stack || err?.message || err}`);
});

// v9 — OFFLINE Mührü: HF Hub'a tek paket bile sızmasın. Env'de yoksa default "1".
// Tüm spawn edilen worker subprocess'leri (worker.py, mlx server) bu env'i miras alır.
process.env.HF_HUB_OFFLINE      = process.env.HF_HUB_OFFLINE      ?? "1";
process.env.TRANSFORMERS_OFFLINE = process.env.TRANSFORMERS_OFFLINE ?? "1";
process.env.HF_DATASETS_OFFLINE  = process.env.HF_DATASETS_OFFLINE  ?? "1";
import express from "express";
import cors from "cors";
import pg from "pg";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createCipheriv, createDecipheriv, scryptSync, randomBytes, timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { execFile, execSync, spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { Agent as UndiciAgent } from "undici";
import { siem, startSiemConfigSync } from "./siem-forwarder.mjs";
import { toCompletionBody, CHAT_TEMPLATE_FAMILY } from "./lib/chat-prompt.mjs";
import {
  isPortOpen,
  pidAlive as _pidAlive,
  waitForPidExit as _waitForPidExit,
  killPortOwner,
  listPortPids,
  listPortSockets,
  summarizeSocketStates,
  killPortOwnerAndWait,
  spawnPg,
  discoverLaunchdLabelForPort,
  findLaunchdLabelByPattern,
  findLaunchdRuntimePlist,
  findSystemdRuntimeUnit,
  readLaunchdPlistRuntimeCommand,
  readSystemdServiceRuntimeCommand,
} from "./lib/port-process.mjs";
// Kırılım 2a (2026-05-30): MLX transport state container artık modül-scope'lu.
// MLX_TRANSPORT objesi import edilir; property mutation'ları (inflight++, dirty=true,
// lastActivityAt=Date.now()) referans üstünden geçer. Kırılım 2b'de fetch hattı da
// taşınacak. Detay: mem://decisions/mlx-transport-modularization-2026-05-30.md
import {
  MLX_TRANSPORT,
  getMlxTransportSnapshot,
  streamMlxCompletion,
  initMlxSelfHeal,
  MLX_TRANSPORT_MODULE_VERSION as __MLX_TRANSPORT_MOD_VER,
} from "./lib/mlx-transport.mjs";
void __MLX_TRANSPORT_MOD_VER;
import {
  probeLdap, probeRadius,
  authenticateLdap, authenticateRadius,
  mapGroupsToRole,
} from "./auth-providers.mjs";
import {
  detectAgentIntent, runLocalAgent, streamLocalAgent, classifyAgentError,
  agentErrorMessage, coerceParams,
  detectExecutionIntent, setAllowedAgents, getAllowedAgents, setAgentsBaseDir, getAgentsBaseDir,
} from "./lib/agent-bridge.mjs";
import {
  spawnAgentRun, cancelAgentRun, cancelAllRunsForAgent, registerSyntheticRun,
  listAgentRuns, liveCountsByAgent,
} from "./lib/agent-runs.mjs";
import { buildAgentEnv, buildAgentEnvForScript, buildFieldBindingEnvForAgent, buildAgentToolsEnv, buildBrainEnv, initAgentEnv } from "./lib/agent-env.mjs";
import { buildAgentRagContext, initAgentRag } from "./lib/agent-rag.mjs";
import { extractToolCalls, runToolCallsForAgent } from "./lib/tool-call-parser.mjs";
import { enrichChunkContent } from "./lib/chunk-enrichment.mjs";
import {
  RAG_STOP as _RAG_STOP,
  RAG_STOP_ASCII as _RAG_STOP_ASCII,
  TR_SUFFIXES as _TR_SUFFIXES,
  stripTurkishSuffix as _stripTurkishSuffix,
  extractQueryTerms as _extractQueryTerms,
  metaTokenSet as _metaTokenSet,
  vendorBoost as _vendorBoost,
  rrfFuse as _rrfFuse,
  computeConfidence as _computeConfidence,
  makeThinkStripper,
} from "./lib/rag/scoring.mjs";
import { createRagUtil } from "./lib/rag/util.mjs";
import { buildRagDefaults, loadRagSettingsFromDisk } from "./lib/rag/defaults.mjs";
import { resolvePrompt as resolveSystemPrompt } from "./lib/system-prompts.mjs";
import {
 initRagRetrieval,
 ragProbeAndFetch,
 semanticSearch,
 _ftsHybridFallback,
 _buildFtsOrQuery,
 getLastFtsError,
 getLastFtsChunkError,
 getLastFtsSourceError,
} from "./lib/rag/retrieval.mjs";
import { initProductCache } from "./lib/rag/product-cache.mjs";
import {
  initBrandCache,
  getLibraryBrands,
  getActivePackBrandFilter,
  invalidatePackFilterCache,
  getAgentRagBrands,
  invalidateAgentBrandCache,
  _brandDisplay,
  detectLibraryMatch,
} from "./lib/rag/brand-cache.mjs";
import {
  initEntityExtractor,
  extractEntities,
  linkEntitiesForChunk,
} from "./lib/rag/entity-extractor.mjs";
import {
  initGeminiWeb,
  streamFromGemini,
  runWebSearch,
} from "./lib/providers/gemini-web.mjs";
import {
  initProviderPolicyCache,
  providerPolicyCacheClear,
  providerPolicyCacheDeleteUser,
  getProviderPolicyCachedSync,
  getEffectiveProviderPolicyForUser,
  warmProviderPolicyCache,
} from "./lib/providers/policy-cache.mjs";
import {
  initWatchers,
  scheduleRootReindex,
  startWatchingRoot,
  stopWatchingRoot,
  stopAllWatchers,
  bootstrapWatchers,
} from "./lib/knowledge/watchers.mjs";
import {
  getSecretsForScope, vaultAuditRuntime,
  putSecretV2, listSecretFieldNames, getSecretAllFields, VAULT_KIND_FIELDS,
} from "./lib/vault.mjs";
import {
  initSessionGate,
  attachSessionContext,
  requireSession,
  isAdminFromSession,
} from "./lib/session-gate.mjs";
import { bootstrapDatabase, waitForDatabaseReady, attachPoolErrorHandler } from "./lib/db.mjs";
import { runMigration } from "./lib/migrate.mjs";
import {
  initCapabilityRegistry,
  syncCapabilitiesFromSources,
  listCapabilities,
} from "./lib/capability-registry.mjs";
import { scanToolsDir, defaultToolsRoots } from "./lib/tools-scan.mjs";
import { scanSkillsDir, defaultSkillsRoots } from "./lib/skills-scan.mjs";
import { scanAgentsDir, defaultAgentsRoots } from "./lib/agents-scan.mjs";
import { mountCapabilityRoutes } from "./lib/routes/capabilities.mjs";
import { mountSkillRoutes } from "./lib/routes/skills.mjs";
import { mountToolRoutes } from "./lib/routes/tools.mjs";
import { mountAgentsCrudRoutes } from "./lib/routes/agents-crud.mjs";
import { mountAgentBindingsRoutes } from "./lib/routes/agent-bindings.mjs";
import { mountRagSettingsRoutes } from "./lib/routes/rag-settings.mjs";
import {
  initRagReadOps, mountRagReadOpsRoutes,
  getRagHealth, ragSelfAudit, resolveJoinExpr, verifySourceReachability,
} from "./lib/routes/rag-readops.mjs";
import {
  initRagDiagnostics, mountRagDiagnosticsRoutes,
} from "./lib/routes/rag-diagnostics.mjs";
import {
  initBrandAliases, mountBrandAliasesRoutes,
  spawnBrandReenrich, maybeAutoReenrich, triggerSyncAutoReenrich, _coerceBool,
} from "./lib/routes/brand-aliases.mjs";
import { initVisionService, mountVisionServiceRoutes } from "./lib/routes/vision-service.mjs";
import { initVoiceProfiles, mountVoiceProfilesRoutes } from "./lib/routes/voice-profiles.mjs";
import { initAdapterDictionaries, mountAdapterDictionariesRoutes } from "./lib/routes/adapter-dictionaries.mjs";
import { initTemplateAssignments, mountTemplateAssignmentsRoutes } from "./lib/routes/template-assignments.mjs";
import { mountPlannerRoutes } from "./lib/routes/planner.mjs";
import { mountProvidersRoutes } from "./lib/routes/providers.mjs";
import { mountAgentsExtraRoutes } from "./lib/routes/agents-extra.mjs";
import { mountAgentRunRoute } from "./lib/routes/agent-run.mjs";
import { mountMcpRoutes } from "./lib/routes/mcp.mjs";
import { mountKnowledgeMaintenanceRoutes } from "./lib/routes/knowledge-maintenance.mjs";
import { mountKnowledgeSyncRoutes } from "./lib/routes/knowledge-sync.mjs";
import { mountKnowledgeRetrieveRoutes, invalidateSourcesCache } from "./lib/routes/knowledge-retrieve.mjs";
import { mountKnowledgeAuditRoutes } from "./lib/routes/knowledge-audit.mjs";
import { mountKnowledgeIngestRoutes } from "./lib/routes/knowledge-ingest.mjs";
import {
  createIngestExtract,
  isTableLine, isListLine, packAtomic,
  CHUNK_SIZE, CHUNK_OVERLAP, ATOMIC_MAX, MIN_CHUNK_CHARS,
} from "./lib/ingest/extract.mjs";
import { createIngestPipeline } from "./lib/ingest/pipeline.mjs";
// Ingest cluster bindings — initialized later from factory deps (see ~line 5740).
let htmlToText, jsonToSearchableText, extractTechnicalCore, mlxVisionCaption, extractFileContent, chunkText;
let ingestSource, rebuildChunksForFile, ingestMediaUrl, recrawlUrlSource, withCrawlMutex, deriveChildSourceId;
import { createKnowledgeMaintenance } from "./lib/knowledge/maintenance.mjs";
import { SYSTEM_ACTIONS, SYS_DISK_TOOLS } from "./lib/registry/system-actions.mjs";
import { mountTelemetryRoutes } from "./lib/routes/telemetry.mjs";
import { mountRagOpsRoutes } from "./lib/routes/rag-ops.mjs";
import { mountSystemMiscRoutes } from "./lib/routes/system-misc.mjs";
import { mountCapabilitiesRunsRoutes } from "./lib/routes/capabilities-runs.mjs";
import { mountAgentsTemplatesRoutes } from "./lib/routes/agents-templates.mjs";
import { createSendRagStatus, mountRagStatusRoute } from "./lib/routes/rag-status.mjs";
import { createWatchdogPersistence } from "./lib/watchdog.mjs";
let cleanupKnowledgeGhosts, syncCanonicalLibraryPaths, seedForgeLibrary;
import { createAgentRuntime } from "./lib/agents/runtime.mjs";
let execNodeWithAction, normalizeAgentRow, syncAgentCapabilityPacks, seedIdentity, runSkill;
import { initAdaptersSchema } from "./lib/schema-adapters.mjs";
let ensureAdapterDictionariesSeed;
import { initReindexer } from "./lib/knowledge/reindexer.mjs";
import { mountChatOrchestrateRoutes } from "./lib/routes/chat-orchestrate.mjs";
import { mountChatStreamRoutes } from "./lib/routes/chat-stream.mjs";

import { mountWebhookRoutes } from "./lib/routes/webhooks.mjs";
import { mountAdaptersRoutes } from "./lib/routes/adapters.mjs";
import { mountPythonRoutes } from "./lib/routes/python.mjs";
import { mountGraphRoutes } from "./lib/routes/graph.mjs";
import { mountMessagesRoutes } from "./lib/routes/messages.mjs";
import { mountRbacRoutes } from "./lib/routes/rbac.mjs";
import { mountEngineRoutes } from "./lib/routes/engine.mjs";
import { mountThreadRoutes } from "./lib/routes/threads.mjs";
import { mountWorkflowRoutes } from "./lib/routes/workflows.mjs";
import { mountForgeRoutes } from "./lib/routes/forge.mjs";
import { mountMetaForgeRoutes } from "./lib/routes/meta-forge.mjs";

import { mountIdentityRoutes } from "./lib/routes/identity.mjs";
import { mountModelsRoutes } from "./lib/routes/models.mjs";
import { mountChatTemplatesRoute } from "./lib/routes/chat-templates.mjs";
import { streamCloudCompletion } from "./lib/cloud-transport.mjs";
import { mountVaultRoutes } from "./lib/routes/vault.mjs";
import { mountBackupRoutes } from "./lib/routes/backup.mjs";
import { mountSystemMlxRoutes } from "./lib/routes/system-mlx.mjs";
import { installMetrics } from "./lib/metrics.mjs";
import { installLiveCall } from "./lib/live-call.mjs";
import { initPgVersion } from "./lib/pg-version.mjs";
import { mountMutationGuard } from "./lib/mutation-guard.mjs";
import { runDiskScript } from "./lib/disk-runner.mjs";
import {
  initDispatcher,
  dispatchUserTurn,
  finishRun,
} from "./lib/dispatch.mjs";
import { mlxQueue } from "./lib/mlx-queue.mjs";
import { TIMEOUT_BUDGETS, assertTimeoutHierarchy } from "./lib/queue-config.mjs";
import {
  initToolAdapters,
  invokeTool,
  decideApproval,
  listPendingApprovals,
  ApprovalRequired,
  ToolPolicyError,
} from "./lib/tool-adapters.mjs";
import { getAgentManifest, reloadManifests, isLoopback } from "./lib/agent-manifest.mjs";
import {
  RUNTIME_PROVIDER_PRESETS,
  RUNTIME_PROVIDER_CFG,
  defaultRuntimeProviderConfig,
  runtimeFetchError,
  normalizeRuntimeBaseUrl,
  joinRuntimePath,
  fallbackModelName,
  runtimeBase,
  runtimeModel,
  runtimeIsMlx,
  runtimeUpstreamBase,
  hydrateRuntimeProviderFromDb,
  initRuntimeRegistry,
  sanitizeModels as _sanitizeModels,
  resolveProvider as _resolveProvider,
  isPathLikeModelId as _isPathLikeModelId,
  assertModelSlug as _assertModelSlug,
  safeRuntimeModel as _safeRuntimeModel,
  mlxServingId as _mlxServingId,
} from "./lib/runtime-registry.mjs";
import { corsHeadersFor, flushSse, sseWrite, sseBegin } from "./lib/sse.mjs";
import {
  initMlxEmbedRerank,
  mlxEmbed,
  mlxRerank,
  getLastEmbedError,
  getLastRerankError,
  getLastRerankMs,
  getLastRerankAt,
} from "./lib/rag/mlx-embed-rerank.mjs";
import {
  RUNTIME_INTENT_CFG,
  DEFAULT_CLASSIFIER_PROMPT,
  INTENT_ANCHORS,
  classifyIntent,
  refineIntentSemantically,
  semanticIntentGate,
  llmIntentClassify,
  scoreTechnicalSignal,
  ensureAnchorVecs,
  hydrateIntentConfigFromDb,
  initIntentClassifier,
  scheduleIntentHydrate,
  clampThreshold,
  clampSemanticThreshold,
} from "./lib/rag/intent-classifier.mjs";
import {
  initMlxWarmup,
  startMlxKeepwarmLoop,
  warmLocalChatModel,
  mlxOnDemandPreWarm as _mlxOnDemandPreWarm,
  mlxKeepwarmPing,
  preflightMlxReset,
  mlxIsCold as _mlxIsCold,
  mlxRecordFirstToken as _mlxRecordFirstToken,
  mlxEffectiveFirstTokenMs as _mlxEffectiveFirstTokenMs,
  mlxPressureHigh as _mlxPressureHigh,
  mlxWarmCacheTtlMs as _mlxWarmCacheTtlMs,
  _MLX_WARM_STATE,
} from "./lib/mlx-warmup.mjs";
import {
  initActorRegistry,
  resolveDefaultActor,
  resolveActor,
  resolveActorContext,
  buildVisibility,
  _isLoopbackReq,
  _hasLoopbackAdminToken,
  _isAdminTokenKnowledgePath,
  _isLoopbackAgentRunPath,
  autoLinkLegacyOwnership,
} from "./lib/actor.mjs";
import {
  initBrandRegistry,
  BRAND_DEFAULTS,
  brandFromEnv,
  getBrand,
  brandSync,
  invalidateBrandCache,
  safeSlug,
} from "./lib/brand.mjs";
import {
  initWorkflowEngine,
  startWorkflowRun,
  resumeWorkflowRun,
  cancelWorkflowRun,
  getRunSteps,
} from "./lib/workflow-engine.mjs";
import { redactString, redactDeep, REDACTION_PLACEHOLDER } from "./lib/redaction.mjs";
import { initWriteQueue } from "./lib/write-queue.mjs";
import { initAuditFeed } from "./lib/audit-feed.mjs";
import { ingestOnce as cveIngestOnce, startCveWatcher, ensureCveSchema } from "./lib/cve-watcher.mjs";
import { buildDeepHealth } from "./lib/health-deep.mjs";
import { runRetention, startRetentionScheduler } from "./lib/retention.mjs";
import { ensureMigrationTable, applyMigration, rollbackMigration, listMigrations } from "./lib/migration-manifest.mjs";
import { installAuditChain, verifyAuditChain, rebuildAuditChain } from "./lib/audit-chain.mjs";
import { crawlUrl, presetConfig as crawlPresetConfig } from "./lib/url-crawler.mjs";
import * as Planner from "./lib/plan-and-execute.mjs";
import {
  claimJob as sjClaim,
  heartbeat as sjHeartbeat,
  checkStop as sjCheckStop,
  releaseJob as sjRelease,
  requestStop as sjRequestStop,
  reclaimStale as sjReclaim,
  getActiveJob as sjActive,
  listJobs as sjList,
  ensureSchema as sjEnsureSchema,
  getCurrentHost as sjHost,
  getCurrentPid as sjPid,
  JOB_TYPES as SJ_JOB_TYPES,
} from "./lib/system-jobs.mjs";

// v7 — Persistent MLX HTTP tunnel.
// Tek keep-alive dispatcher; her chat isteğinde yeni TCP/handshake açmıyoruz.
// MLX 8001 ile aramızdaki "damar yolu" — 3005 ↔ 8001 mühürlü tek tünel.
function _buildMlxKeepAliveAgent() {
  return new UndiciAgent({
    keepAliveTimeout: 60_000,        // socket boştayken 60s daha tutulur
    keepAliveMaxTimeout: 600_000,    // server hint olsa bile 10dk üst sınır
    connections: 8,                  // host başına paralel socket havuzu
    pipelining: 1,                   // streaming completion için güvenli
    bodyTimeout: 0,                  // gövde timeout'unu watchdog yönetir
    headersTimeout: 0,               // header timeout'unu watchdog yönetir
  });
}
// 2026-05-28 — `let` çünkü MLX process kill'inden sonra eski keep-alive socket
// havuzu (CLOSED/ESTABLISHED hayalet socket) yeni 8001 process'ine yanlış
// pipe'lanabiliyor. Restart sırasında agent destroy + recreate ile damar
// yolunu tamamen yeniliyoruz.
let MLX_KEEPALIVE_AGENT = _buildMlxKeepAliveAgent();
async function resetMlxKeepAliveAgent(reason = "restart") {
  const old = MLX_KEEPALIVE_AGENT;
  MLX_KEEPALIVE_AGENT = _buildMlxKeepAliveAgent();
  try { await old?.destroy?.(); } catch {}
  pushLog("server", `[mlx:tunnel] keep-alive agent recreated · reason=${reason}`);
}
// Kırılım 2a (2026-05-30): MLX_TRANSPORT artık `./lib/mlx-transport.mjs`'ten
// import ediliyor (dosya başı). Property mutation'ları (inflight++, dirty=true,
// lastActivityAt=Date.now()) imported referans üzerinden geçer — davranış aynı.
// Eski 35 satırlık in-place declaration buradaydı; rollback için bkz.
// mem://session/2026-05-30-mlx-transport-break-2a.md

// Kırılım 4 (2026-05-30): recordMlxAbort + recordMlxActivity +
// triggerMlxZombieSelfHeal + _runtimeBaseLooksLocal + _mlxSelfHealInFlight
// `local-server/lib/mlx-transport.mjs → initMlxSelfHeal({...})` içine taşındı.
// Buradaki üç wrapper, init sonrası kurulan `_selfHealApi`'ye forward eder.
// Init PORT/queue/diag helper'ları hazır olunca (≈ line 1110) yapılır.
// Davranış aynı; call-site'lar (recordMlxAbort, recordMlxActivity,
// triggerMlxZombieSelfHeal) tek satır bile değişmez.
// Anchor: mem://session/2026-05-30-mlx-transport-break-4.md
let _selfHealApi = null;
function _selfHealNotReady(fnName) {
  // Boot-sıralaması ihlali; üretimde tetiklenmemeli. Sessiz kalmak yerine
  // sade bir uyarı bırak; çağıran tarafta no-op gibi davran.
  try { console.warn(`[mlx:self-heal] ${fnName} called before initMlxSelfHeal()`); } catch {}
}
function recordMlxAbort(reason) {
  if (!_selfHealApi) return _selfHealNotReady("recordMlxAbort");
  return _selfHealApi.recordMlxAbort(reason);
}
function recordMlxActivity() {
  if (!_selfHealApi) return _selfHealNotReady("recordMlxActivity");
  return _selfHealApi.recordMlxActivity();
}
async function triggerMlxZombieSelfHeal(reason, traceFn) {
  if (!_selfHealApi) { _selfHealNotReady("triggerMlxZombieSelfHeal"); return { ok: false, skipped: true, reason: "not_initialized" }; }
  // 2026-06-02 — Settings → Runtime knob gate. Default OFF, manuel "Restart
  // Runtime" butonu hala çalışır; otomatik zombi süpürmesi kapalı.
  try {
    if (typeof RAG_SETTINGS !== "undefined" && RAG_SETTINGS?.mlxSelfHealEnabled !== true) {
      try { traceFn?.("mlx.self_heal.gated", { reason: "knob_off" }); } catch {}
      return { ok: false, skipped: true, reason: "knob_off" };
    }
  } catch { /* RAG_SETTINGS henüz hazır değilse: aşağıdaki çağrı çalışsın */ }
  return _selfHealApi.triggerMlxZombieSelfHeal(reason, traceFn);
}

// ---------------------------------------------------------------------------
// v11.2 — Cold-MLX first-token hardening + FAZ 24 keep-warm ping.
// Tüm warmup hattı (helpers + warmLocalChatModel + mlxOnDemandPreWarm +
// mlxKeepwarmPing + preflightMlxReset + keep-warm interval IIFE)
// lib/mlx-warmup.mjs'e taşındı (2026-05-30, Tur A). DI init aşağıda,
// `pushLog` + `mlxQueue` tanımlarından SONRA çağrılır (TDZ-safe).
// ---------------------------------------------------------------------------
// FAZ 25 — keep-warm IIFE, SYS_LOG_RING + pushLog tanımından SONRA başlatılır (TDZ fix).

// --- System Engine: log ring + worker auto-spawn ----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SYS_LOG_RING = [];
const SYS_LOG_MAX  = 800;
const SYS_LOG_SUBS = new Set();
function pushLog(source, line) {
  const text = String(line || "").replace(/\r/g, "");
  for (const raw of text.split("\n")) {
    const clean = raw.trimEnd();
    if (!clean) continue;
    const evt = { ts: Date.now(), source, line: clean };
    SYS_LOG_RING.push(evt);
    if (SYS_LOG_RING.length > SYS_LOG_MAX) SYS_LOG_RING.shift();
    for (const sub of SYS_LOG_SUBS) { try { sub(evt); } catch {} }
  }
}

// FAZ 25 — keep-warm interval lib/mlx-warmup.mjs → startMlxKeepwarmLoop().
// initMlxWarmup({deps}) + startMlxKeepwarmLoop() çağrıları pushLog + mlxQueue
// tanımlandıktan SONRA, _currentModelRender vb. de tanımlandıktan sonra
// (boot wiring noktasında) yapılır. Bu satırın altında IIFE kalmadı.

const CHAT_TRACE_RING = [];
const CHAT_TRACE_MAX = 500;
function chatTrace(traceId, stage, detail = {}, level = "info") {
  const id = String(traceId || "trace-missing");
  const evt = { traceId: id, stage: String(stage || "unknown"), detail, level, ts: Date.now() };
  CHAT_TRACE_RING.push(evt);
  if (CHAT_TRACE_RING.length > CHAT_TRACE_MAX) CHAT_TRACE_RING.shift();
  pushLog("chat-trace", `[${id}] ${evt.stage} ${JSON.stringify(detail || {})}`);
  return evt;
}
function chatTraceList(traceId = null) {
  const id = traceId ? String(traceId) : null;
  return id ? CHAT_TRACE_RING.filter((e) => e.traceId === id) : CHAT_TRACE_RING.slice(-100);
}
// Mirror console.log/warn/error into the ring so the cockpit sees server logs too.
for (const lvl of ["log", "warn", "error"]) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...args) => {
    try { pushLog("server", args.map((a) => typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(" ")); } catch {}
    orig(...args);
  };
}

const EMBED_WORKER_PORT = Number(process.env.EMBED_WORKER_PORT || 8082);
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 8002);
const EMBED_WORKER_HOST = "127.0.0.1";
const DEFAULT_EMBED_MODEL = "BAAI/bge-m3";
if (!process.env.MLX_EMBED_MODEL) process.env.MLX_EMBED_MODEL = DEFAULT_EMBED_MODEL;
// Force the worker URL so mlxEmbed() hits our auto-spawned worker instead of
// the legacy default 8001. Operator can still override via env.
if (!process.env.MLX_EMBED_BASE_URL && !process.env.MLX_BASE_URL) {
  process.env.MLX_EMBED_BASE_URL = `http://${EMBED_WORKER_HOST}:${EMBED_WORKER_PORT}`;
}
let workerProc = null;
let workerStatus = "down"; // down | starting | online-auto | online-external
let workerStartedAt = 0;
let workerLastError = null;
let gatewayProc = null;
let gatewayStatus = "down"; // down | starting | online-auto | online-external
let gatewayStartedAt = 0;
let gatewayLastError = null;

// isPortOpen → lib/port-process.mjs (Block C Tur 1)

// probeWorkerHealth / verifyEmbedAlive / warmEmbedWorker → lib/embed-worker-probe.mjs (Block C Tur 2)
// resolvePythonCandidates → lib/python-resolver.mjs (Block C Tur 2)
const WORKER_HEALTH_TIMEOUT_MS = Math.max(500, Number(process.env.WORKER_HEALTH_TIMEOUT_MS) || 3000);
import { initEmbedWorkerProbe } from "./lib/embed-worker-probe.mjs";
import { createPythonResolver } from "./lib/python-resolver.mjs";
const { probeWorkerHealth, verifyEmbedAlive, warmEmbedWorker } = initEmbedWorkerProbe({
  host: EMBED_WORKER_HOST,
  port: EMBED_WORKER_PORT,
  defaultModel: DEFAULT_EMBED_MODEL,
  healthTimeoutMs: WORKER_HEALTH_TIMEOUT_MS,
  pushLog: (src, line) => pushLog(src, line),
});
const resolvePythonCandidates = createPythonResolver({ serverDir: __dirname });

// _ensureInflight / lastHealMs / respawnTimestamps / workerLocked
// → lib/embed-worker/runtime.mjs (Tur 3b, module-private).
// SELF_HEAL_COOLDOWN_MS + RESPAWN_MAX_IN_WINDOW server.mjs'te `let` kalır
// (Runtime Watchdog cockpit canlı mutate ediyor); modül getter ile okur.
let SELF_HEAL_COOLDOWN_MS = Number(process.env.WORKER_SELF_HEAL_COOLDOWN_MS ?? 120_000);
let RESPAWN_MAX_IN_WINDOW = Number(process.env.WORKER_RESPAWN_MAX ?? 3);

// ensureWorker / kickWorkerStart / killWorker / _trackRespawn / _ensureWorkerImpl
// → lib/embed-worker/runtime.mjs (Tur 3b). State callbacks workerProc/Status/
// LastError/StartedAt setter/getter ile bağlanır; SELF_HEAL_COOLDOWN_MS ve
// RESPAWN_MAX_IN_WINDOW server.mjs'te kalır (cockpit watchdog mutate ediyor).
// initEmbedWorkerRuntime() çağrısı initEmbedWorkerStore() bloğunun hemen
// ardında — embedAndStoreChunks dep'i hazır olduğu anda.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { killWorker(); killGateway(); process.exit(0); });
}
process.on("exit", () => { killWorker(); killGateway(); });

async function probeGatewayHealth() {
  try {
    const r = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`, { signal: AbortSignal.timeout(900) });
    if (!r.ok) return null;
    return await r.json().catch(() => ({ ok: true }));
  } catch { return null; }
}

let _gatewayEnsureInflight = null;
async function ensureGateway() {
  if (_gatewayEnsureInflight) return _gatewayEnsureInflight;
  _gatewayEnsureInflight = (async () => {
    try { return await _ensureGatewayImpl(); }
    finally { _gatewayEnsureInflight = null; }
  })();
  return _gatewayEnsureInflight;
}
async function _ensureGatewayImpl() {
  const health = await probeGatewayHealth();
  if (health?.ok) { gatewayStatus = gatewayProc ? "online-auto" : "online-external"; return { spawned: false, status: gatewayStatus }; }
  if (await isPortOpen(GATEWAY_PORT)) { gatewayStatus = "online-external"; return { spawned: false, status: gatewayStatus }; }
  gatewayStatus = "starting";
  const command = String(process.env.GATEWAY_CMD || "").trim();
  const child = command
    ? { file: command, args: [], opts: { shell: true } }
    : { file: process.execPath, args: [path.join(__dirname, "gateway.mjs")], opts: {} };
  pushLog("server", `[gateway:spawn] ${command || `${child.file} ${child.args.join(" ")}`} port=${GATEWAY_PORT}`);
  try {
    gatewayProc = spawn(child.file, child.args, {
      cwd: __dirname,
      env: { ...process.env, GATEWAY_PORT: String(GATEWAY_PORT), PORT: String(GATEWAY_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
      ...child.opts,
    });
  } catch (e) {
    gatewayStatus = "down"; gatewayLastError = String(e?.message || e);
    pushLog("server", `[gateway:spawn-error] ${gatewayLastError}`);
    return { spawned: false, status: gatewayStatus, error: gatewayLastError };
  }
  gatewayStartedAt = Date.now();
  gatewayProc.stdout.on("data", (b) => pushLog("server", `[gateway] ${b.toString()}`));
  gatewayProc.stderr.on("data", (b) => { gatewayLastError = b.toString().slice(-1500); pushLog("server", `[gateway] ${b.toString()}`); });
  gatewayProc.on("exit", (code) => { pushLog("server", `[gateway:exit] code=${code}`); gatewayProc = null; gatewayStatus = "down"; });
  const deadline = Date.now() + Number(process.env.GATEWAY_BOOT_TIMEOUT_MS || 30_000);
  while (Date.now() < deadline) {
    const h = await probeGatewayHealth();
    if (h?.ok) { gatewayStatus = "online-auto"; return { spawned: true, status: gatewayStatus }; }
    await new Promise((r) => setTimeout(r, 500));
  }
  gatewayStatus = "down";
  gatewayLastError = gatewayLastError || "gateway did not respond within boot window";
  return { spawned: false, status: gatewayStatus, error: gatewayLastError };
}

function killGateway() {
  if (gatewayProc) {
    try { gatewayProc.kill("SIGTERM"); } catch {}
    gatewayProc = null;
  }
  gatewayStatus = "down";
}

function startServiceWatchdog() {
  // Faz F (2026-05): 10sn → 30sn. Sorgu kendisi 10sn üstüne çıkınca önceki
  // bitmeden yenisi açılıyor, postgres pool tıkanıp RAM şişiyordu.
  const interval = Math.max(15000, Number(process.env.SERVICE_WATCHDOG_MS || 30000));
  let consecutiveFails = 0;
  let sleepingUntil = 0;
  setInterval(async () => {
    if (Date.now() < sleepingUntil) return;
    const gw = await probeGatewayHealth();
    if (!gw?.ok) ensureGateway().catch((e) => pushLog("server", `[gateway:watchdog-error] ${e?.message || e}`));
    try {
      const pending = await countPendingEmbeddings();
      consecutiveFails = 0;
      if (pending > 0 || workerStatus === "online-auto") {
        const wh = await probeWorkerHealth();
        if (!wh?.ok && workerStatus !== "starting")
          ensureWorker().catch((e) => pushLog("worker", `[watchdog-error] ${e?.message || e}`));
      }
    } catch (e) {
      consecutiveFails++;
      pushLog("server", `[watchdog] countPendingEmbeddings failed (${consecutiveFails}): ${e?.message || e}`);
      if (consecutiveFails >= 3) {
        pushLog("server", `[watchdog] 3 ardışık hata — watchdog 2 dk donduruldu`);
        sleepingUntil = Date.now() + 120_000;
        consecutiveFails = 0;
      }
    }
  }, interval).unref?.();
}

// countPendingEmbeddings → lib/embed-worker/runtime.mjs (Tur 3b)

// --- Liyakat (Role) Hierarchy --------------------------------------------------
// Higher rank = more privilege. A user with rank >= file rank can read it.
const ROLE_RANK = { Viewer: 1, Security: 2, Operator: 3, Admin: 4 };
const VALID_ACCESS_LEVELS = new Set(Object.keys(ROLE_RANK));
function normalizeAccessLevel(level) {
  const v = String(level ?? "Viewer").trim();
  return VALID_ACCESS_LEVELS.has(v) ? v : "Viewer";
}
function userCanRead(userRole, fileLevel) {
  const u = ROLE_RANK[normalizeAccessLevel(userRole)] ?? 0;
  const f = ROLE_RANK[normalizeAccessLevel(fileLevel)] ?? 99;
  return u >= f;
}

// Pool destructure lib/db.mjs'e taşındı (Block E.2 Tur 1). pg import kalır
// (başka modüller pg.types vs. ihtiyacı doğarsa diye).
const PORT = Number(process.env.PORT ?? 3005);
const HOST = "0.0.0.0";

// Kırılım 4 (2026-05-30): MLX self-heal API'sini şimdi enjekte et. PORT
// hazır; mlxQueue (line 131 import), pushLog (line 513), listPortPids/
// Sockets/summarizeSocketStates (line 742+) zaten tanımlı. runtimeUpstreamBase
// ve _activeRuntimePort fonksiyonları daha SONRA tanımlı — getter'lar lazy
// resolve eder. Çağrı zinciri: recordMlxAbort/triggerMlxZombieSelfHeal
// forwarder'ları `_selfHealApi`'ye delege eder.
_selfHealApi = initMlxSelfHeal({
  port: PORT,
  pushLog: (source, line) => pushLog(source, line),
  getMlxQueue: () => mlxQueue,
  getRuntimeBase: () => (typeof runtimeUpstreamBase === "function" ? runtimeUpstreamBase() : (process.env.MLX_BASE_URL || "http://127.0.0.1:8001")),
  getActiveRuntimePort: () => (typeof _activeRuntimePort === "function" ? _activeRuntimePort() : Number(process.env.MLX_RUNTIME_PORT || 8001)),
  listPortPids: (p) => listPortPids(p),
  listPortSockets: (p) => listPortSockets(p),
  summarizeSocketStates: (s) => summarizeSocketStates(s),
});
// System Env first (launchd/plist), .env fallback. Re-read late so dotenv had its chance.
let DATABASE_URL = process.env.DATABASE_URL;
const _uploadRaw = process.env.UPLOAD_DIR ?? "./uploads";
const UPLOAD_DIR = path.isAbsolute(_uploadRaw) ? _uploadRaw : path.resolve(__dirname, _uploadRaw);
const BACKUP_DIR = path.join(UPLOAD_DIR, "backups");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// 2026-05-30 Block E.2 Tur 1: bootstrap (waitForDatabaseUrl + sovereign
// normalize + Pool kurulumu) lib/db.mjs'e taşındı. waitForDatabaseReady ve
// pool.on("error") init* çağrılarından SONRA, aşağıda tetikleniyor.
const {
  pool,
  databaseUrl: NORMALIZED_DATABASE_URL,
  dbName: ELARA_DB_NAME,
} = await bootstrapDatabase({ initialUrl: DATABASE_URL });
DATABASE_URL = NORMALIZED_DATABASE_URL;

// runtime-registry: hydrate fn needs the pool. Wire DI right after pool is built.
initRuntimeRegistry({ pool });
initActorRegistry({ pool });
initBrandRegistry({ pool });

// 2026-05-30 Tur A: MLX warmup hattı lib/mlx-warmup.mjs'e taşındı. Init burada
// (pool hazır, fn-decl deps hoisted). Keep-warm interval startMlxKeepwarmLoop()
// içinden; MLX_KEEPWARM_ENABLED=0 ise no-op döner.
initMlxWarmup({
  pool,
  migrateReady: Promise.resolve(),
  mlxQueue,
  pushLog: (source, line) => pushLog(source, line),
  getWatchdogCfg,
  getRagSettings: () => RAG_SETTINGS,
  injectSystemPrompt,
  currentModelRender: _currentModelRender,
  normaliseRender: _normaliseRender,
  getMlxKeepAliveAgent: () => MLX_KEEPALIVE_AGENT,
  resolveRuntimeSafety,
});
startMlxKeepwarmLoop();

// Faz 2 — Session gate'i pool yaratılır yaratılmaz bağla. Middleware (üstte
// app.use) artık DB'den oturumu doğrulayabilir; gate'i istenen endpoint'lerde
// `requireSession()` ile aç.
initSessionGate(pool);
// Faz 3 — Unified capability registry + dispatcher. Pool'a bağlanır; gerçek
// sync schema bootstrap'tan sonra (waitForDatabaseReady akabinde) tetiklenir.
initCapabilityRegistry(pool);
initDispatcher(pool);
initToolAdapters(pool);
initWorkflowEngine(pool);

// Faz 6 — Planner v0 (opt-in). Tool çağrı kararlarını ayrı bir LLM step'inde
// verir, sonuçları RAG'a EK olarak chat akışına iliştirir. Settings file-backed,
// WebUI'dan toggle/mode/limits ayarlanabilir. Disabled iken tamamen no-op.
Planner.initPlanner(pool, {
  listCapabilities: (opts) => listCapabilities(opts),
  getRagSettings: () => RAG_SETTINGS,
  executeCapability: async (cap, args, ctx) => {
    if (cap.kind === "tool") {
      const toolId = cap.ref_id || cap.id;
      return invokeTool({
        toolId,
        username: ctx?.username || null,
        sessionId: ctx?.sessionId || null,
        params: args || {},
      });
    }
    // v0: skill/workflow/agent planner'dan otomatik tetiklenmez (frontend lane sahipleri).
    return { ok: false, error: `planner_v0_does_not_run_${cap.kind}` };
  },
  llmChat: async ({ messages, maxTokens = 600, temperature = 0, timeoutMs = 4000, model: overrideModel, jsonMode = false }) => {
    let row = null;
    try {
      const r = overrideModel
        ? await pool.query("SELECT * FROM models WHERE id=$1", [overrideModel])
        : await pool.query("SELECT * FROM models WHERE is_default=true ORDER BY updated_at DESC LIMIT 1");
      row = r.rows[0] ?? null;
    } catch { /* legacy fallback below */ }
    const provider = String(row?.provider ?? RUNTIME_PROVIDER_CFG.provider ?? "");
    const base = normalizeRuntimeBaseUrl(row?.base_url || runtimeBase() || "");
    const mdl  = overrideModel ? _assertModelSlug(String(overrideModel).trim(), "planner.llmChat") : _mlxServingId(row, { ctx: "planner.llmChat" });
    if (!base || !mdl) throw new Error("runtime_not_ready");
    const isMlx = runtimeIsMlx(base, provider);
    const upstream = runtimeUpstreamBase(base, provider);
    // Yol C: MLX → /v1/completions (engine-agnostic; chat-prompt render katmanı)
    const target = isMlx ? joinRuntimePath(upstream, "/v1/completions") : joinRuntimePath(upstream, "/api/generate");
    const chatBody = { model: mdl, messages, stream: false, max_tokens: maxTokens, temperature, ...(jsonMode ? { response_format: { type: "json_object" } } : {}) };
    const render = await _currentModelRender();
    const body = isMlx
      ? toCompletionBody(chatBody, render)
      : { model: mdl, prompt: messages.map((m) => `[${m.role}] ${m.content}`).join("\n\n"), stream: false, options: { temperature, num_predict: maxTokens }, format: jsonMode ? "json" : undefined };
    const r = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`llm_${r.status}`);
    const j = await r.json().catch(() => null);
    return String(isMlx ? (j?.choices?.[0]?.text || j?.choices?.[0]?.message?.content || "") : (j?.response || "")).trim();
  },
  logger: (...a) => pushLog("server", `[planner] ${a.join(" ")}`),
});

await waitForDatabaseReady(pool, { dbName: ELARA_DB_NAME });
attachPoolErrorHandler(pool);
// Periodic GC nudge after heavy bursts (only if --expose-gc).
if (typeof global.gc === "function") {
  setInterval(() => { try { global.gc(); } catch {} }, 5 * 60_000).unref();
}
const startedAt = Date.now();
const pendingModelCache = new Map();

// ---------------------------------------------------------------------------
// SSE hot-path: disable Nagle + enable TCP keep-alive on every event-stream.
// Helpers extracted to lib/sse.mjs (2026-05-30 Block B).
// Re-export shim removed — call sites import directly.
// ---------------------------------------------------------------------------

// 2026-05-30 Block E.1: brand layer (BRAND_DEFAULTS / brandFromEnv / getBrand /
// brandSync / invalidateBrandCache) ve safeSlug lib/brand.mjs'e taşındı.
// initBrandRegistry pool kurulduktan sonra çağrılıyor (yukarıda).

const createLocalId = () => randomUUID();
const createPrefixedId = (prefix) => `${prefix}${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`;

// 2026-05-30 Block D: resolveDefaultActor / resolveActor / resolveActorContext
// (pool-bound) ve saf buildVisibility lib/actor.mjs'e taşındı. initActorRegistry
// pool kurulduktan sonra çağrılıyor (yukarıda).
// 2026-05-30 R-2: autoLinkLegacyOwnership da lib/actor.mjs'e taşındı; migrateReady
// dep-injection ile geçiyor. Çağrı aşağıda boot wiring satırında.

// --- Runtime Provider Switch (MLX / Legacy HTTP / Custom) ------------------------
// 2026-05-30 Tur 2: state (RUNTIME_PROVIDER_CFG) + readers (runtimeBase/Model/
// IsMlx/UpstreamBase, _safeRuntimeModel, _mlxServingId) + hydrateRuntimeProviderFromDb
// moved to lib/runtime-registry.mjs. CFG is a live binding — Object.assign in the
// /api/engine/runtime save handler mutates it in place; all readers see it.
// initRuntimeRegistry({ pool }) is wired right after the pg pool is constructed.

// --- Async write queue: never blocks the SSE socket -------------------------
// Block F Tur 1 (2026-05-30): impl lib/write-queue.mjs'e taşındı. CRITICAL +
// SIDE lane mantığı, redaksiyon ve drain davranışı aynı. pool DI ile bağlı.
const { enqueueWrite, getWriteQueueDepths } = initWriteQueue({ pool });

// --- Audit feed + checkpoint logger ----------------------------------------
// Block F Tur 2 (2026-05-30): impl lib/audit-feed.mjs'e taşındı. SSE broadcast,
// SIEM forward, redaction ve checkpoint write davranışı aynı; sseWrite + siem
// + enqueueWrite DI ile bağlı.
const { auditClients, broadcastAudit, logCheckpoint } = initAuditFeed({
  sseWrite,
  siem,
  enqueueWrite,
});
// 2026-05-30 Block E.2 Tur 2: migrate() lib/migrate.mjs'e taşındı.
// migrateReady Promise'i call-site'lar (8 yer) tarafından bekleniyor — burada
// kurulup const olarak ihraç ediliyor.
const migrateReady = runMigration({ pool });
// Prime the brand cache once migrations have set up app_settings; ignore
// errors so a fresh DB still boots — env defaults remain in effect.
migrateReady.then(() => getBrand({ fresh: true })).catch(() => {});
migrateReady.then(() => hydrateRuntimeProviderFromDb()).catch(() => {});

// --- App --------------------------------------------------------------------
const app = express();
app.set("trust proxy", true);

// Log every socket hit before CORS/routes so LAN clients prove they reached the bridge.
app.use((req, _res, next) => {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const clientIp = forwarded || req.ip || req.socket.remoteAddress || "unknown";
  console.log(`[INCOMING] Request from: ${clientIp} | ${req.method} ${req.originalUrl}`);
  next();
});

const corsOptions = {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With", "X-User", "x-user", "X-Session-Id", "x-session-id", "X-User-Role", "x-user-role", "Access-Control-Request-Private-Network"],
  exposedHeaders: ["Content-Type", "Content-Length", "Access-Control-Allow-Private-Network"],
  optionsSuccessStatus: 204,
};
app.use((req, res, next) => {
  const headers = corsHeadersFor(req);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
// Faz 14.3 — body limit 8mb → 1mb. RAG/upload/webhook gibi büyük payload'lar
// kendi route'larında `express.raw({ limit: ... })` ile ayrı limit alır
// (örn. /api/webhooks/teams 20mb). 1mb genel API için yeterli; oversize
// payload'lar 413 ile reddedilir, uncaught crash riski yok.
app.use(express.json({ limit: "1mb" }));

// Faz 17.4 — In-memory token-bucket rate limiter. Loopback (127.0.0.1/::1)
// muaf — smoke + local tooling akışlarını boğmasın. Disk persist yok; restart
// sayaçları sıfırlar (kabul edilen trade-off, local-host ölçeğinde yeterli).
const __rl = new Map(); // key -> { tokens, last }
function rateLimit({ capacity, refillPerSec, key }) {
  return (req, res, next) => {
    const ip = String(req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
    if (ip === "127.0.0.1" || ip === "::1" || ip === "") return next();
    const k = `${key}|${ip}|${typeof key === "function" ? key(req) : ""}`;
    const now = Date.now();
    let b = __rl.get(k);
    if (!b) { b = { tokens: capacity, last: now }; __rl.set(k, b); }
    const elapsed = (now - b.last) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.last = now;
    if (b.tokens < 1) {
      const retryAfter = Math.ceil((1 - b.tokens) / refillPerSec);
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-RateLimit-Limit", String(capacity));
      res.setHeader("X-RateLimit-Remaining", "0");
      return res.status(429).json({ ok: false, code: "rate_limited", retryAfter });
    }
    b.tokens -= 1;
    res.setHeader("X-RateLimit-Limit", String(capacity));
    res.setHeader("X-RateLimit-Remaining", String(Math.floor(b.tokens)));
    next();
  };
}
// Periyodik temizlik — eski IP bucket'larını ay; bellek sızıntısı olmasın.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of __rl) if (now - b.last > 10 * 60_000) __rl.delete(k);
}, 60_000).unref?.();
const rlLogin  = rateLimit({ capacity: Number(process.env.RL_LOGIN_CAPACITY  || 30), refillPerSec: Number(process.env.RL_LOGIN_REFILL  || 0.5), key: "login"  });
const rlInvoke = rateLimit({ capacity: Number(process.env.RL_INVOKE_CAPACITY || 60), refillPerSec: Number(process.env.RL_INVOKE_REFILL || 1.0), key: "invoke" });

// --- Sovereign actor resolver ----------------------------------------------
// Frontend sends `x-user: <username>` (lowercased on read). Empty/missing
// = anonymous, sees only globals. Used for capability-scoped queries.
app.use((req, _res, next) => {
  const raw = String(req.headers["x-user"] ?? "").trim();
  req.actor = raw ? raw.toLowerCase() : null;
  next();
});

// Faz 2 — Session gate. Pool initialize edildikten sonra `initSessionGate(pool)`
// çağrılıyor (aşağıda). Burada middleware her istekte sid'i DB ile doğrular ve
// `req.session` doldurur. Gate `requireSession(...)` ile endpoint başına uygulanır.
app.use(attachSessionContext());

// Faz 2 — Blanket mutation guard.
// Her POST/PUT/PATCH/DELETE `/api/*` çağrısı oturum ister. İstisnalar dar:
//   - /api/auth/*        → login + provider test (public by design)
//   - /api/sessions/*    → heartbeat + self-disconnect (kendi mantığı denetler)
// Anonim biri LAN'dan dağ taş skill/agent/workflow/knowledge çağıramayacak.
// Admin-only uçlar ayrıca `requireSession({roles:["admin"]})` ile sertleşir.
const FAZ2_PUBLIC_MUTATION_PREFIXES = ["/api/auth/", "/api/sessions/"];
const FAZ2_PUBLIC_MUTATION_PATHS = new Set([]);
const FAZ2_MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// v10 — Worker servis yönetimi: sadece loopback'ten gelirse blanket guard'ı
// atla. LAN'dan birinin worker'ı kapatması/açması engellenir; aynı makinedeki
// restart script auth'a takılmaz. Token mutabakatı artık zorunlu değil.
const FAZ2_LOOPBACK_ONLY_MUTATION_PATHS = new Set([
  "/api/system/worker/start",
  "/api/system/worker/stop",
  "/api/system/restart-worker",
  "/api/system/restart-mlx",
  "/api/system/restart-runtime",
  "/api/rag/brand-backfill",
  "/api/rag/reprocess-oversized-html",
  "/api/rag/dedupe-chunks",
  "/api/rag/probe",
  "/api/rag/retry-embeddings",
  // TUR-6 — Agent→Tool dispatch. Handler kendi içinde isLoopback + X-Agent-Id
  // + manifest gate uyguluyor; blanket session guard buraya kadar gelmemeli,
  // aksi halde loopback'ten gelen agent çağrıları 401'e takılır (smoke 4/5/6).
  "/api/agents/tool-call",
  // 2026-05-29 — operator probe endpoint. Read-only MLX probe; loopback CLI
  // (smoke/diag) ve UI Test Connection auth gate'ine takılmasın. Handler hiç
  // yazma yapmaz; sadece runtime ping atar.
  "/api/models/test",
]);
const FAZ2_ADMIN_TOKEN_MUTATION_PATHS = new Set([
  "/api/knowledge/fetch",
  "/api/knowledge/sync-source",
]);
// 2026-05-30 Block D: _isLoopbackReq / _hasLoopbackAdminToken /
// _isAdminTokenKnowledgePath / _isLoopbackAgentRunPath lib/actor.mjs'e taşındı.
// _isAdminTokenKnowledgePath ikinci arg olarak path set'i ister; aşağıda
// FAZ2_ADMIN_TOKEN_MUTATION_PATHS geçiyoruz.
// 2026-05-30 R-3: FAZ2 blanket mutation guard → lib/mutation-guard.mjs.
// Path-set konfigürasyonu yukarıda kalır (tek mercii); middleware wiring
// modüle taşındı. Davranış AYNI; env BRIDGE_BLANKET_GUARD=0 ile devre dışı.
const FAZ2_BLANKET_GUARD = String(process.env.BRIDGE_BLANKET_GUARD ?? "1") !== "0";
mountMutationGuard(app, {
  enabled: FAZ2_BLANKET_GUARD,
  sessionGate: requireSession(),
  methods: FAZ2_MUTATION_METHODS,
  publicPaths: FAZ2_PUBLIC_MUTATION_PATHS,
  publicPrefixes: FAZ2_PUBLIC_MUTATION_PREFIXES,
  loopbackOnlyPaths: FAZ2_LOOPBACK_ONLY_MUTATION_PATHS,
  // Dynamic-id mutation endpoints (e.g. /api/workflows/:id/trigger) that should be
  // session-required from LAN but exempt for loopback (smoke + local cron).
  loopbackOnlyPrefixes: ["/api/workflows/", "/api/chains/", "/api/workflow-chains/", "/api/meta-forge/"],
  adminTokenPaths: FAZ2_ADMIN_TOKEN_MUTATION_PATHS,
  deps: {
    isLoopbackReq: _isLoopbackReq,
    hasLoopbackAdminToken: _hasLoopbackAdminToken,
    isAdminTokenKnowledgePath: _isAdminTokenKnowledgePath,
    isLoopbackAgentRunPath: _isLoopbackAgentRunPath,
  },
});

// --- Request logger + simple breaker ---------------------------------------
app.use((req, _res, next) => {
  const t0 = Date.now();
  _res.on("finish", () => {
    console.log(`[PROXY] -> Method: ${req.method} | Target: ${PORT}${req.path} | Status: ${_res.statusCode} | ${Date.now() - t0}ms`);
  });
  next();
});

// Chat attachments: accept ALL file types. Size limit only.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}_${createLocalId()}${ext}`);
  },
});
const upload = multer({
  storage,
  // Allow up to 2 GiB per file (forensic images, memory dumps, large pcaps).
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  // No fileFilter -> all extensions allowed.
});

// ---------------------------------------------------------------------------
// Brand identity API — single source of truth for all UI / persona / archive
// labelling. Every consumer (frontend brand store, system prompt builder,
// backup filename generator) reads from here.
// ---------------------------------------------------------------------------
app.get("/api/brand", async (_req, res) => {
  try { res.json(await getBrand({ fresh: true })); }
  catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.put("/api/brand", async (req, res) => {
  try {
    const allowed = ["app_name", "short_name", "persona_name", "owner_title", "default_locale", "tagline", "support_email", "library_root"];
    const incoming = req.body && typeof req.body === "object" ? req.body : {};
    const patch = {};
    for (const k of allowed) {
      if (incoming[k] !== undefined && incoming[k] !== null) patch[k] = String(incoming[k]).trim();
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no recognised brand keys in body" });
    const current = await getBrand({ fresh: true });
    const merged = { ...current, ...patch };
    await pool.query(
      `INSERT INTO app_settings(key, value, updated_at) VALUES ('brand', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
      [JSON.stringify(merged)]
    );
    invalidateBrandCache();
    res.json(await getBrand({ fresh: true }));
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});

// LAN IPv4 discovery — lets the frontend pivot from `.local` to a numeric IP
// when mDNS / Bonjour resolution flakes (Windows/Edge in particular). The
// browser hits this once, caches the winner, and stops depending on DNS for
// every subsequent API call.
function lanIpv4Candidates() {
  const out = [];
  try {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const it of ifs[name] || []) {
        if (!it || it.internal) continue;
        if (String(it.family) !== "IPv4" && it.family !== 4) continue;
        if (!it.address) continue;
        out.push(it.address);
      }
    }
  } catch {}
  return [...new Set(out)];
}
app.get("/api/discovery", (_req, res) => {
  const ips = lanIpv4Candidates();
  res.json({
    ok: true,
    host: os.hostname(),
    port: PORT,
    candidates: ips.map((ip) => `http://${ip}:${PORT}`),
    ips,
  });
});

// Health — includes PostgreSQL handshake so the Web UI can prove :3005 can reach the DB.
async function buildHealthResponse() {
  const t0 = Date.now();
  try {
    const db = await pool.query("SELECT current_database() AS database, now() AS ts");
    return { ok: true, status: "ok", host: os.hostname(), bind_host: HOST, port: PORT, pid: process.pid, started_at: new Date(startedAt).toISOString(), uptime_s: Math.round((Date.now() - startedAt) / 1000), db: { ok: true, database: db.rows[0]?.database, latencyMs: Date.now() - t0 } };
  } catch (e) {
    return { ok: false, status: "degraded", host: os.hostname(), bind_host: HOST, port: PORT, pid: process.pid, started_at: new Date(startedAt).toISOString(), db: { ok: false, error: String(e.message || e), latencyMs: Date.now() - t0 } };
  }
}
app.get("/api/health", async (_req, res) => {
  const h = await buildHealthResponse();
  res.status(h.ok ? 200 : 503).json(h);
});
// /health alias — TLS proxy ve dış sağlık probları için aynı cevabı sade JSON olarak döner.
app.get("/health", async (_req, res) => {
  const h = await buildHealthResponse();
  res.status(h.ok ? 200 : 503).json(h);
});
// Faz 9 — deep health: per-subsystem probe (db, mlx, mlx_queue, rbi, auth, cve,
// redaction, schema). Bounded probes, never throws. Use for ops dashboards
// and contract/smoke tests.
async function deepHealthHandler(_req, res) {
  try {
    const h = await buildDeepHealth({
      pool,
      mlxQueue,
      rbiTarget: null,
      mlxBase: runtimeUpstreamBase() || process.env.MLX_BASE_URL || "http://127.0.0.1:8001",
});
    res.status(h.ok ? 200 : 503).json(h);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
app.get("/health/deep", deepHealthHandler);
app.get("/api/health/deep", deepHealthHandler);

// --- Planner v0 (Faz 6) -----------------------------------------------------
// Extracted 2026-05-30 → lib/routes/planner.mjs.
mountPlannerRoutes({ app, Planner });

// --- Dynamic RAG settings (Dashboard sliders) -------------------------------
// Extracted 2026-05-30 → lib/routes/rag-settings.mjs (Tur A1).
// Getter pattern: RAG_SETTINGS / normalizeRagSettings / saveRagSettings /
// RAG_DEFAULTS are declared later in this file (TDZ-safe via deferred fns).
mountRagSettingsRoutes({
  app,
  getRagSettings: () => RAG_SETTINGS,
  setRagSettings: (next) => { RAG_SETTINGS = next; },
  getRagDefaults: () => RAG_DEFAULTS,
  normalizeRagSettings: (src) => normalizeRagSettings(src),
  saveRagSettings: () => saveRagSettings(),
});

// /api/rag/health + getRagHealth extracted 2026-05-30 → lib/routes/rag-readops.mjs (Tur A3).

// Brand Aliases (+ spawnBrandReenrich/maybeAutoReenrich/triggerSyncAutoReenrich
// /_coerceBool) extracted 2026-05-30 → lib/routes/brand-aliases.mjs. Init+mount
// happens below once pool/deriveBrandFromKnowledgeSource/RAG_SETTINGS are defined.

// Diagnostic: tek istek halinde ragProbeAndFetch koş, reranker durumunu döndür.
// Loopback-only (oturum/cookie gerekmez); LAN'dan reddedilir.
// /api/rag/probe + self-audit + diagnose-join + ragSelfAudit + verifySourceReachability
// + probeJoinHypotheses + _listColumns + resolveJoinExpr + _joinExprCache extracted
// 2026-05-30 → lib/routes/rag-readops.mjs (Tur A4).
//
// /api/rag/verify-source + diagnose-html/corpus/query + diagnoseHtml + diagnoseCorpus
// + diagnoseQuery extracted 2026-05-30 → lib/routes/rag-diagnostics.mjs (Tur A5).
// Init + mount happens after all upstream symbols are defined (see initRagDiagnostics
// block alongside initRagReadOps).

// Boot-time health log (tek seferlik, çok kısa) — operatör log'da net görsün.
setTimeout(() => {
  getRagHealth().then(h => {
    if (!h.ok) { console.warn("[rag:health] error:", h.error); return; }
    const c = h.chunks || {};
    const s = h.sources || {};
    console.log(`[rag:health] chunks=${c.chunks} fts_null=${c.chunks_tsv_null} emb_ok=${c.embedding_ok} emb_pending=${c.embedding_pending} emb_error=${c.embedding_error} sources=${s.sources} parse_ok=${s.sources_ok} parse_low=${s.sources_low}`);
    if (h.warnings?.length) h.warnings.forEach(w => console.warn(`[rag:health] ⚠ ${w}`));
  }).catch(() => {});
}, 5000).unref?.();

setTimeout(() => {
  ragSelfAudit().then(a => {
    if (a.ok) { console.log("[rag:self-audit] OK"); return; }
    console.warn("[rag:self-audit] FAILED");
    for (const c of a.checks || []) if (!c.ok) console.warn(`[rag:self-audit] ✗ ${c.name}: ${c.info}`);
  }).catch(e => console.warn("[rag:self-audit] error:", e?.message || e));
}, 7000).unref?.();

// ─── Embedding queue + auto-drain → lib/embed-worker/runtime.mjs (Tur 3b) ─
// claimEmbeddingBatch + ragJanitor + ragAutoEmbedDrain + 60sn janitor +
// 30sn drain interval'leri startEmbedWorkerIntervals() ile bağlanır.
// Mimari notu (önceki): SKIP LOCKED claim, lease janitor, auto-drain her üç
// çağırıcı için tek hat; aynı satır iki worker'a verilmez.

// POST /api/rag/repair-fts — legacy compatibility endpoint. knowledge_chunks.tsv
// is now a generated DB column; no UPDATE/backfill is allowed or needed.
// Tur 1 (2026-05-30): 6 RAG bakım endpoint → lib/routes/rag-ops.mjs
// (/api/rag/repair-fts, brand-backfill, dedupe-chunks,
//  reprocess-oversized-html, nuke-reindex, reprocess-extensions).
// POST /api/rag/retry-embeddings → lib/embed-worker/runtime.mjs (Tur 3b)
// mountEmbedWorkerRoutes(app) ile bağlanır.

// deriveBrandFromUrl — vendor-agnostic SLD extractor. No vendor list, no
// regex. Returns the second-level label of the registrable domain. Multi-part
// public suffixes (.co.uk, .com.tr, .com.au, …) are handled by a small,
// extendable label set so "docs.example.co.uk" → "example".
const _PUBLIC_SUFFIX_2 = new Set([
  "co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go",
]);
function deriveBrandFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const parts = host.split(".").filter(Boolean);
    if (parts.length < 2) return parts[0] || null;
    const last = parts[parts.length - 1];
    const second = parts[parts.length - 2];
    // ccTLD with 2-letter country code AND 2nd-level public suffix
    // (example.co.uk, example.com.tr) → return parts[-3] if present.
    if (last.length === 2 && _PUBLIC_SUFFIX_2.has(second) && parts.length >= 3) {
      return parts[parts.length - 3];
    }
    return second;
  } catch { return null; }
}

function deriveBrandFromKnowledgeSource(source = {}) {
  const type = String(source.type || "").toLowerCase();
  if (type === "url" && source.url) return deriveBrandFromUrl(source.url);
  const explicit = String(source.tag || "").trim();
  if (explicit && !/^(uploaded file|inline text|web source|local directory)$/i.test(explicit)) return explicit.slice(0, 64);
  const rawName = String(source.name || "").trim();
  if (!rawName) return null;
  const clean = rawName.replace(/\.[a-z0-9]{1,8}$/i, "").trim();
  return clean ? clean.slice(0, 64) : null;
}

// /api/rag/brand-backfill + dedupe-chunks + reprocess-oversized-html
// → lib/routes/rag-ops.mjs (Tur 1, 2026-05-30).

// hydrateIntentConfigFromDb → lib/rag/intent-classifier.mjs (Tur B, 2026-05-30).
// initIntentClassifier + scheduleIntentHydrate wired after cosine def.

// --- Intent Guard Override + Agents Allowlist (cockpit-controlled) ---------
// Komutan'ın "Execution Intent Guard Immunity" anahtarı. Auto (default):
// length-heuristic/semantic-bypass kararı, execution-intent tespit edilirse
// askıya alınır. Force-on: her zaman kontrol et. Force-off: eski yönlendirici
// davranışını geri yükler (guard tamamen devre dışı).
// Tur 2: Cockpit allowlist + intent-guard + bridge telemetry → lib/routes/cockpit-allowlist.mjs
import { initCockpitAllowlist } from "./lib/routes/cockpit-allowlist.mjs";
import { initEmbedWorkerStore, embedAndStoreChunks, getEmbeddingHealth } from "./lib/embed-worker/store.mjs";
import {
  initEmbedWorkerRuntime,
  ensureWorker,
  kickWorkerStart,
  killWorker,
  countPendingEmbeddings,
  claimEmbeddingBatch,
  ragJanitor,
  ragAutoEmbedDrain,
  startEmbedWorkerIntervals,
  mountEmbedWorkerRoutes,
  getRuntimeDiag as _getEmbedWorkerDiag,
} from "./lib/embed-worker/runtime.mjs";
const {
  INTENT_GUARD,
  broadcastBridge,
  hydrateIntentGuardFromDb,
  hydrateAllowedAgentsFromDb,
  applyExecutionGuard,
  getAllowedToolsList,
  getDeniedToolsList,
  isToolAllowed,
  mountCockpitRoutes,
} = initCockpitAllowlist({
  pool,
  getAllowedAgents,
  setAllowedAgents,
  setAgentsBaseDir,
  detectExecutionIntent,
});
mountCockpitRoutes(app);
setTimeout(() => {
  void hydrateIntentGuardFromDb();
  void migrateReady.then(() => hydrateAllowedAgentsFromDb()).catch(() => hydrateAllowedAgentsFromDb()).catch(() => {});
}, 600);

// --- Runtime Provider Switch endpoints (MLX / Legacy HTTP / Custom) -------------
// /api/engine/runtime — moved to lib/routes/engine.mjs (mountEngineRoutes)

// --- Tab-level RBAC (Architect ne görür, kim ne göremez) --------------------
const ALL_TAB_IDS = [
  "chat","dashboard","knowledge","agents","workflows","tools","skills","models",
  "templates","orchestration","policies","security","users","middleware",
  "system-engine","telemetry","reports","debug","settings","python","forge",
  // Faz 18–20 operational surfaces — Approvals queue, CVE feed, Live Call console.
  "approvals","cve","live-call",
  // Faz 6 — Planner v0 control surface.
  "planner",
  // MCP — Model Context Protocol server/client control panel.
  "mcp",
];
// ensureRbacTable + ensureModelIdentitiesTable → lib/schema-identity.mjs (Block E.2 Tur 5).
import { initIdentitySchema } from "./lib/schema-identity.mjs";
const { ensureRbacTable, ensureModelIdentitiesTable } =
  initIdentitySchema({ pool, allTabIds: ALL_TAB_IDS });
ensureRbacTable().catch((e) => console.warn("[rbac:init]", e?.message || e));

// CVE GET/refresh → lib/routes/system-misc.mjs (Tur 2, 2026-05-30).
migrateReady.then(() => ensureCveSchema(pool))
  .then(() => startCveWatcher(pool))
  .then((s) => console.log("[cve-watcher]", JSON.stringify(s)))
  .catch((e) => console.warn("[cve-watcher init]", e?.message || e));

// Faz 10 — Retention (admin-only run/dry-run + boot scheduler).
// retention/run + system/host + system/jobs (3) → lib/routes/system-misc.mjs (Tur 2).

// Faz 10 — Migration manifest endpoints (admin-only).
//  - POST /api/migrations/apply   { id, description?, up, down, checksum?, backupRef? }
//  - POST /api/migrations/rollback/:id
//  - GET  /api/migrations
migrateReady.then(() => ensureMigrationTable(pool)).catch((e) => console.warn("[migration-manifest init]", e?.message || e));

// ─── agent_run_history (UI = single source of truth, persistent run log) ───
// Spawn-based agent runs disappear from /api/agents/runs after exit. We
// persist a compact row per run so the Run History tab can show past runs
// across server restarts. Boot DDL self-heal (no manual migration needed).
migrateReady.then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS agent_run_history (
    run_id        text PRIMARY KEY,
    agent_id      text,
    script        text,
    source        text DEFAULT 'spawn',
    status        text NOT NULL,                 -- ok | error | cancelled
    exit_code     int,
    signal        text,
    started_at    timestamptz NOT NULL,
    finished_at   timestamptz NOT NULL DEFAULT now(),
    duration_ms   int,
    stdout_tail   text,
    stderr_tail   text,
    rag_meta      jsonb,
    inference     jsonb
  );
  ALTER TABLE agent_run_history ADD COLUMN IF NOT EXISTS username text;
  CREATE INDEX IF NOT EXISTS idx_agent_run_history_started ON agent_run_history(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_agent_run_history_agent ON agent_run_history(agent_id, started_at DESC);
`)).catch((e) => console.warn("[agent_run_history init]", e?.message || e));

async function recordAgentRunFinish(info) {
  try {
    const status = info.cancelled ? "cancelled" : (info.ok ? "ok" : "error");
    await pool.query(
      `INSERT INTO agent_run_history
         (run_id, agent_id, script, source, status, exit_code, signal,
          started_at, duration_ms, stdout_tail, stderr_tail, rag_meta, inference, username)
       VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8/1000.0), $9, $10, $11, $12::jsonb, $13::jsonb, $14)
       ON CONFLICT (run_id) DO NOTHING`,
      [
        info.runId, info.agentId || null, info.script || null, info.source || "spawn",
        status, info.code ?? null, info.signal ?? null,
        info.startedAt, info.durationMs ?? null,
        String(info.stdout || "").slice(-1200),
        String(info.stderr || "").slice(-1200),
        info.ragMeta ? JSON.stringify(info.ragMeta) : null,
        info.inference ? JSON.stringify(info.inference) : null,
        info.username || null,
      ],
    );
  } catch (e) {
    console.warn("[agent_run_history insert]", e?.message || e);
  }
}

// migrations (GET + apply + rollback/:id) → lib/routes/system-misc.mjs (Tur 2).

// 2026-05-30 R-1: /api/rbac/* (tabs GET/PUT + me GET) → lib/routes/rbac.mjs
mountRbacRoutes(app, { pool, allTabIds: ALL_TAB_IDS });

// Tur 2 (2026-05-30): mountSystemMiscRoutes moved below initReindexer
// (depends on ragJobs/cancelSyncJob which are initialized ~line 4040).

// --- KV Cache Flush helper (MLX kontekstini sıfırlar) -----------------------
// MLX cache flush — mlx_lm.server'da endpoint sürümden sürüme farklı. Üç adayı
// dener, hepsi 404 ise tek seferlik uyarı bas (her chat sonunda spam etmesin).
let _flushUnsupportedLogged = false;
let _flushSupportedUrl = null;
async function flushModelKvCache(threadId) {
  const base = (runtimeUpstreamBase() || process.env.MLX_BASE_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
  const targets = _flushSupportedUrl
    ? [_flushSupportedUrl]
    : [`${base}/v1/cache/reset`, `${base}/cache/reset`, `${base}/reset`];
  let saw404 = false;
  for (const url of targets) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: threadId ?? null }),
        signal: AbortSignal.timeout(2500),
      });
      if (r.ok) { _flushSupportedUrl = url; return { ok: true, url }; }
      if (r.status === 404) saw404 = true;
    } catch { /* try next */ }
  }
  if (saw404 && !_flushUnsupportedLogged) {
    _flushUnsupportedLogged = true;
    pushLog("mlx", `[cache-flush] mlx_lm.server bu sürümde /cache/reset desteklemiyor (404). Cache şişmesi sürebilir — model restart gerekebilir.`);
  }
  return { ok: false, unsupported: saw404 };
}

// --- Background service status probes ---------------------------------------
// probeUrl/probePostgres inlined in lib/routes/system-misc.mjs (Tur 2).
const serviceRestartLog = new Map(); // key -> timestamp ms when "restart" issued
const RESTART_WINDOW_MS = 15_000;

// ---------- Models routes (system/local-models + /api/models/* + /api/model-identities/* + rename) ----------
// Moved to lib/routes/models.mjs (B-1 / Tur 1.2, 2026-05-30).
// `pendingModelCache` declared at top of file (line ~1043) is passed by ref;
// chat hot-path _normalizeCacheRow still reads the same Map.
mountModelsRoutes({
  app, pool, pendingModelCache,
  resolveActor, resolveActorContext, buildVisibility,
  fallbackModelName, _isPathLikeModelId,
  normalizeRuntimeBaseUrl, runtimeUpstreamBase, joinRuntimePath,
  runtimeFetchError,
  runtimeBase, RUNTIME_PROVIDER_CFG, _resolveProvider,
  hydrateRuntimeProviderFromDb,
  _invalidateModelRenderCache, _invalidateModelRuntimeSafetyCache,
  pushLog,
});

// 2026-06-02 — Chat templates registry endpoint (UI dropdown source of truth).
mountChatTemplatesRoute({ app });



// system/hardware + auth/test/:provider → lib/routes/system-misc.mjs (Tur 2).

// Generic child_process helpers — kept here because extractFileContent
// (pdftotext) and mountPythonRoutes import them; everything else metrics-
// related now lives in lib/metrics.mjs (T-2026-05-30).
function execAsync(cmd, args, timeoutMs = 1500) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve("");
      resolve(String(stdout || ""));
    });
  });
}
function execCapture(cmd, args, timeoutMs = 120_000, maxBuffer = 128 * 1024 * 1024) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
      resolve({ ok: !err, error: err ? String(err.message || err) : null, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

// macOS hardware sampler + /api/metrics/* + /api/system/info + hallucination
// tracker + embed queue cache → lib/metrics.mjs (T-2026-05-30).
const { recordChatSample, HEDGE_PATTERNS, getMetricsFrame, buildMetricsFrame, probeHardwareInfo } =
  installMetrics({ app, pool, sseBegin, execAsync });
void getMetricsFrame; void buildMetricsFrame; void probeHardwareInfo;

// --- Threads / messages -----------------------------------------------------
// UUID guard — kept here because chat-stream + /api/messages also import it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

// Thread routes extracted to lib/routes/threads.mjs (T-2a, 2026-05-30).
mountThreadRoutes(app, { pool, isUuid, flushModelKvCache });

mountMessagesRoutes({ app, pool, isUuid, enqueueWrite });

// --- Logs / debug / uploads / STT → lib/routes/system-misc.mjs (Tur 2) ---
// --- Streaming chat (SSE) → lib/routes/chat-stream.mjs (Block G-2b)

// UI = TEK MERCİİ (2026-06-02). Backend artık kendi kafasına persona/dil/identity
// cümlesi üretmez. models.system_prompt boş ise modele sistem mesajı GİTMEZ.
// Operatör UI'da ne yazdıysa o gider; başka hiçbir metin kıyıda kalmaz.
function brandDefaultSystemPrompt(_brand) { return ""; }

// Legacy param name remap — UI used to expose `repeat_penalty` (llama.cpp
// flavor) but MLX-LM expects `repetition_penalty`. DB rows saved before the
// 2026-05-26 rename keep the old key; map at read time so the operator does
// not have to edit existing model rows. New writes use the canonical name.
const LEGACY_PARAM_RENAMES = Object.freeze({
  repeat_penalty: "repetition_penalty",
});
function _canonicalParamName(name) {
  return LEGACY_PARAM_RENAMES[name] || name;
}
function resolveModelParams(row) {
  const list = Array.isArray(row?.params) ? row.params : [];
  const out = {};
  for (const p of list) {
    const rawName = String(p?.name ?? "").trim();
    if (!rawName) continue;
    const name = _canonicalParamName(rawName);
    const raw = p?.value;
    const num = Number(raw);
    out[name] = raw !== "" && !Number.isNaN(num) ? num : raw;
  }
  if (out.temperature === undefined) out.temperature = 0.7;
  return out;
}

// ---------------------------------------------------------------------------
// Policy resolver — merges a sealed Agent's meta.inference with the active
// Tool/Skill execution_policy. The merged params are physically stamped onto
// the MLX payload so what's drawn in the UI is what hits the model.
// Priority (later wins):  model defaults  <  agent.inference  <  tool/skill (only if enforce_strict)
// ---------------------------------------------------------------------------
function _kvParams(arr) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const p of arr) {
    const rawName = String(p?.name ?? "").trim();
    if (!rawName) continue;
    const k = _canonicalParamName(rawName);
    const raw = p?.value;
    const num = Number(raw);
    out[k] = raw !== "" && !Number.isNaN(num) ? num : raw;
  }
  return out;
}

async function resolvePolicyContext({ agent_id, capability } = {}) {
  if (!agent_id) return null;
  let agentRow = null;
  try {
    const r = await pool.query("SELECT id, name, meta FROM agents WHERE id=$1", [agent_id]);
    agentRow = r.rows[0] || null;
  } catch (e) {
    console.warn(`[policy] agent lookup failed: ${e.message}`);
    return null;
  }
  if (!agentRow) return null;
  const inf = (agentRow.meta && typeof agentRow.meta === "object" && agentRow.meta.inference) || {};
  let cap = null;
  if (capability && capability.kind && capability.id) {
    try {
      const tbl = capability.kind === "skill" ? "skills" : "action_library";
      const r = await pool.query(`SELECT id, name, execution_policy FROM ${tbl} WHERE id=$1`, [capability.id]);
      const row = r.rows[0];
      if (row) cap = { kind: capability.kind, id: row.id, name: row.name, policy: row.execution_policy || {} };
    } catch (e) {
      console.warn(`[policy] capability lookup failed: ${e.message}`);
    }
  }
  return { agent: { id: agentRow.id, name: agentRow.name, inference: inf }, capability: cap };
}
function mergeAndApplyPolicy(payload, ctx) {
  if (!ctx) return { payload, enforced: false, summary: null };
  const inf = ctx.agent.inference || {};
  const out = { ...payload };
  // 1) Agent inference seal
  if (Number.isFinite(Number(inf.temperature))) out.temperature = Number(inf.temperature);
  if (Number.isFinite(Number(inf.top_p))) out.top_p = Number(inf.top_p);
  if (Number.isFinite(Number(inf.max_output_tokens))) out.max_tokens = Number(inf.max_output_tokens);
  if (Array.isArray(inf.stop_sequences) && inf.stop_sequences.length) out.stop = inf.stop_sequences.slice(0, 8);
  Object.assign(out, _kvParams(inf.custom_params));
  // 2) Tool/Skill execution_policy strict overrides
  const pol = ctx.capability?.policy || null;
  let strict = false;
  if (pol && pol.enforce_strict) {
    strict = true;
    if (pol.override_temperature_mode === "force_zero") out.temperature = 0;
    else if (pol.override_temperature_mode === "safe_low") out.temperature = 0.01;
    else if (pol.override_temperature_mode === "custom") {
      const v = Number(pol.override_temperature_value);
      if (Number.isFinite(v)) out.temperature = Math.max(0, Math.min(1, v));
    }
    if (Number.isFinite(Number(pol.override_top_p))) out.top_p = Number(pol.override_top_p);
    Object.assign(out, _kvParams(pol.custom_params));
  }
  // UI = tek mercii. Sampling değerleri agent.meta.inference + (opsiyonel)
  // tool/skill execution_policy enforce_strict overlay'inden gelir. Backend
  // burada sessiz clamp UYGULAMAZ — bk. mem://decisions/ui-params-single-source-all-entities-2026-05-28.md
  // Sadece deterministik tip dönüşümü ve stop dedupe yapılır.
  if (Number.isFinite(Number(out.temperature))) out.temperature = Number(out.temperature);
  if (Number.isFinite(Number(out.top_p))) out.top_p = Number(out.top_p);
  if (Number.isFinite(Number(out.repetition_penalty))) out.repetition_penalty = Number(out.repetition_penalty);
  if (Number.isFinite(Number(out.max_tokens))) out.max_tokens = Number(out.max_tokens);
  const stops = (Array.isArray(out.stop) ? out.stop.map(String) : [])
    .filter((s, i, arr) => s && arr.indexOf(s) === i)
    .slice(0, 8);
  if (stops.length) out.stop = stops; else delete out.stop;

  const summary = {
    agent: ctx.agent.name,
    capability: ctx.capability ? `${ctx.capability.kind}:${ctx.capability.name}` : null,
    enforced: strict,
    temperature: out.temperature,
    top_p: out.top_p,
    max_tokens: out.max_tokens,
    repetition_penalty: out.repetition_penalty,
    stop: out.stop,
  };
  return { payload: out, enforced: strict, summary };
}

// UI = TEK MERCİİ (2026-06-02 revize). Eski davranış:
//   - boş system_prompt'a brand fallback cümlesi basıyordu
//   - `### Instruction: ... ###` wrapper'ını user mesajına FİZİKSEL yapıştırıyordu
//   - nowPreamble'ı kendi kafasına system prompt'a ekliyordu
// Hepsi söküldü. Artık SADECE:
//   - UI'dan gelen model.system_prompt (boşsa hiç system mesajı yok)
//   - Caller'ın eklediği system mesajları (RAG inspector vb.; bunların metni de UI knob'larıyla seçiliyor)
// tek bir role:"system" bloğunda birleştirilir. nowPreamble parametresi kaldı
// ama kullanılmıyor — eski çağrı imzasını kırmamak için. Boş gönderirseniz hiçbir
// "şu an" cümlesi eklenmez. Tarih/saat lazımsa UI'daki system_prompt'a yazılır.
function injectSystemPrompt(messages, systemPrompt, _nowPreamble = null) {
  const list = Array.isArray(messages) ? [...messages] : [];
  const baseSp = String(systemPrompt ?? "").trim();
  const callerSystems = list
    .filter((m) => m?.role === "system" && String(m?.content ?? "").trim().length)
    .map((m) => String(m.content).trim());
  const parts = [];
  if (baseSp) parts.push(baseSp);
  for (const c of callerSystems) parts.push(c);
  const mergedSp = parts.join("\n\n");
  const nonSystem = list.filter((m) => m?.role !== "system");
  if (!mergedSp) return nonSystem;
  return [{ role: "system", content: mergedSp }, ...nonSystem];
}

function withTimeoutSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 300_000));
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  if (signal.aborted) return signal;
  return timeout;
}

async function readNextWithHeartbeat(iterator, sse, timeoutMs) {
  const limit = Math.max(0, Number(timeoutMs) || 0);
  let timer = null;
  let pulse = null;
  try {
    pulse = setInterval(() => sse?.keepAlive?.(), 1000);
    if (limit <= 0) return await iterator.next();
    return await Promise.race([
      iterator.next(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`First token timeout after ${limit}ms — upstream produced no bytes`);
          err.code = "MLX_FIRST_TOKEN_TIMEOUT";
          reject(err);
        }, limit);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (pulse) clearInterval(pulse);
  }
}

function extractChatDelta(payload) {
  if (!payload || payload === "[DONE]") return "";
  try {
    const j = typeof payload === "string" ? JSON.parse(payload) : payload;
    return j.choices?.[0]?.delta?.content
      ?? j.choices?.[0]?.message?.content
      ?? j.choices?.[0]?.text
      ?? j.delta
      ?? j.message?.content
      ?? j.response
      ?? "";
  } catch {
    return "";
  }
}

function drainChatDeltaBuffer(buffer) {
  const pieces = [];
  let rest = String(buffer || "");
  let done = false;
  const findJsonEnd = (s, start) => {
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < s.length; i += 1) {
      const ch = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  };
  while (rest) {
    const doneAt = rest.indexOf("[DONE]");
    const jsonAt = rest.indexOf("{");
    if (doneAt >= 0 && (jsonAt < 0 || doneAt < jsonAt)) { done = true; rest = rest.slice(doneAt + 6); break; }
    if (jsonAt < 0) { rest = rest.slice(-16); break; }
    const end = findJsonEnd(rest, jsonAt);
    if (end < 0) { rest = rest.slice(jsonAt); break; }
    const piece = extractChatDelta(rest.slice(jsonAt, end + 1));
    if (piece) pieces.push(piece);
    rest = rest.slice(end + 1);
  }
  return { pieces, rest, done };
}

// MLX Watchdog Cockpit — runtime override (System Engine üzerinden ayarlanır).

// Env değerleri ilk boot fallback. Cockpit override DB'ye yazılır
// (app_settings.runtime.watchdog) ve restart sonrası geri hydrate edilir —
// UI'da girilen değer artık plist/env'e geri düşmüyor.
const RUNTIME_WATCHDOG_CFG = {
  headersMs: Math.max(90_000, Number(process.env.LLM_HEADERS_TIMEOUT_MS || 120_000)),
  firstTokenMs: Math.max(30_000, Number(process.env.LLM_FIRST_TOKEN_TIMEOUT_MS || 60_000)),
  idleDeltaMs: Math.max(5_000, Number(process.env.LLM_IDLE_DELTA_TIMEOUT_MS || 20_000)),
  warmingNoticeMs: Math.max(1_000, Number(process.env.LLM_WARMING_NOTICE_MS || 3_000)),
  coldFirstTokenMs: Math.max(60_000, Number(process.env.LLM_COLD_FIRST_TOKEN_TIMEOUT_MS || 120_000)),
  streamTimeoutMs: Math.max(60_000, Number(process.env.LLM_STREAM_TIMEOUT_MS || 300_000)),
  warmupTimeoutMs: Math.max(5_000, Number(process.env.LLM_WARMUP_TIMEOUT_MS || 45_000)),
};
function getWatchdogCfg() {
  // Runtime Watchdog switch is a UI/notice control, not a safety-disable switch.
  // Returning 24h caps here hid real first-token freezes and produced
  // `86400s` wait messages while the MLX single slot was already stuck.
  return { ...RUNTIME_WATCHDOG_CFG };
}
function getWorkerSelfHealCfg() {
  return {
    cooldownMs: SELF_HEAL_COOLDOWN_MS,
    respawnMax: RESPAWN_MAX_IN_WINDOW,
  };
}
function setWatchdogCfg(patch = {}) {
  const clamp = (key, floor) => {
    const v = Number(patch[key]);
    if (Number.isFinite(v) && v >= floor) RUNTIME_WATCHDOG_CFG[key] = Math.floor(v);
  };
  clamp("headersMs", 90_000);
  clamp("firstTokenMs", 30_000);
  clamp("idleDeltaMs", 5_000);
  clamp("warmingNoticeMs", 1_000);
  clamp("coldFirstTokenMs", 60_000);
  clamp("streamTimeoutMs", 60_000);
  clamp("warmupTimeoutMs", 5_000);
  return getWatchdogCfg();
}
function setWorkerSelfHealCfg(patch = {}) {
  const cool = Number(patch.cooldownMs);
  if (Number.isFinite(cool) && cool >= 30_000) SELF_HEAL_COOLDOWN_MS = Math.floor(cool);
  const max = Number(patch.respawnMax);
  if (Number.isFinite(max) && max >= 1 && max <= 10) RESPAWN_MAX_IN_WINDOW = Math.floor(max);
  return getWorkerSelfHealCfg();
}
// Watchdog DB hydrate/persist → lib/watchdog.mjs (2026-05-30).
const { hydrateWatchdogFromDb, persistWatchdogToDb } = createWatchdogPersistence({
  pool,
  getWatchdogCfg, setWatchdogCfg,
  getWorkerSelfHealCfg, setWorkerSelfHealCfg,
  getWatchdogSnapshot: () => ({
    headers: RUNTIME_WATCHDOG_CFG.headersMs,
    firstToken: RUNTIME_WATCHDOG_CFG.firstTokenMs,
    idle: RUNTIME_WATCHDOG_CFG.idleDeltaMs,
    cooldown: SELF_HEAL_COOLDOWN_MS,
    respawnMax: RESPAWN_MAX_IN_WINDOW,
  }),
});
// Boot hydrate — pool ready by this point (server.mjs init order).
void hydrateWatchdogFromDb();

// Cockpit endpoints (operatör kontrolü)
// /api/engine/watchdog — moved to lib/routes/engine.mjs (mountEngineRoutes)

// v7 — Transport cockpit. Operatör keep-alive damar yolunu ve preflight reset
// durumunu canlı görür; reset URL'ini cockpit'ten mühürleyip kaldırabilir.
// /api/engine/transport — moved to lib/routes/engine.mjs (mountEngineRoutes)
// NOTE: mount call moved below RUNTIME_INTENT_CFG/DEFAULT_CLASSIFIER_PROMPT
// definition (line ~8938) to avoid TDZ on those const symbols.

async function* streamFromLocalLLM({ model, messages, signal, onWarming = null, onLoopGuard = null, policyCtx = null, intentHint = "query", nowPreamble = null }) {
  await hydrateRuntimeProviderFromDb({ quiet: true });
  let row = null;
  // Cache satırı camelCase tutar (pendingModelCache). DB satırı snake_case.
  // _mlxServingId ve diğer resolverlar snake_case bekliyor — fallback'te normalize et.
  const _normalizeCacheRow = (c) => c ? {
    id: c.id,
    provider: c.provider,
    base_url: c.base ?? c.base_url ?? "",
    runtime_model_id: c.runtimeModelId ?? c.runtime_model_id ?? "",
    template_family: c.templateFamily ?? c.template_family ?? "",
    prompt_prefix: c.promptPrefix ?? c.prompt_prefix ?? "",
    stop_sequences: c.stopSequences ?? c.stop_sequences ?? [],
    chat_template_kwargs: c.chatTemplateKwargs ?? c.chat_template_kwargs ?? {},
    system_prompt: c.systemPrompt ?? c.system_prompt ?? "",
    params: c.params ?? [],
    transport: c.transport ?? "mlx_local",
    api_key_env: c.apiKeyEnv ?? c.api_key_env ?? "",
  } : null;
  if (model) {
    try {
      const r = await pool.query("SELECT * FROM models WHERE id=$1", [model]);
      row = r.rows[0] ?? _normalizeCacheRow(pendingModelCache.get(model)) ?? null;
    } catch (e) {
      row = _normalizeCacheRow(pendingModelCache.get(model)) ?? null;
      console.error(`[models] runtime lookup used cache: ${String(e.message || e)}`);
    }
  }
  if (!row) {
    try {
      const r = await pool.query("SELECT * FROM models WHERE is_default=true ORDER BY updated_at DESC LIMIT 1");
      row = r.rows[0] ?? null;
    } catch { /* legacy fallback below */ }
  }
  // Models tablosu tek kaynak: chat/runtime önce seçilen veya default model
  // satırının base_url + id değerini kullanır. app_settings.runtime.provider
  // yalnızca eski kurulumlarda satır yoksa fallback'tir.
  const provider = String(row?.provider ?? RUNTIME_PROVIDER_CFG.provider ?? "").toLowerCase();
  const publicBase = normalizeRuntimeBaseUrl(row?.base_url || row?.base || runtimeBase() || "");
  const base = runtimeUpstreamBase(publicBase, provider);
  // 2026-05-30 — Tek mercii: chat'in seçtiği `model` parametresi yalnızca DB satırını
  // bulmak için kullanılır. MLX'e giden gerçek serving ID HER ZAMAN row.runtime_model_id
  // (varsa) → row.id sırasıyla _mlxServingId tarafından çözülür. Aksi halde UI'da
  // bağlanan "MLX Serving ID" by-pass edilir ve MLX 404 döner.
  const _selectedAlias = model ? String(model).trim() : (row?.id || "");
  const mdl = row
    ? _mlxServingId(row, { ctx: "streamFromLocalLLM" })
    : _assertModelSlug(_selectedAlias, "streamFromLocalLLM");
  if (_selectedAlias && mdl && _selectedAlias !== mdl) {
    console.log(`[MLX-ROUTE] alias="${_selectedAlias}" → serving="${mdl}" (bound=${!!String(row?.runtime_model_id ?? "").trim()})`);
  }
  const systemPrompt = row?.system_prompt ?? row?.systemPrompt ?? "";
  const extraParams = resolveModelParams(row);
  const wrappedMessages = injectSystemPrompt(messages, systemPrompt, nowPreamble);
  const _suppressSmalltalkSystems = intentHint === "smalltalk" && RAG_SETTINGS?.suppressToolManifestOnSmalltalk !== false;
  // Preserve agent-manifest system blocks (meta/intro turns) even when
  // smalltalk suppression strips other system messages. Tagged by
  // lib/agents-manifest.mjs (meta.kind === "agent_manifest").
  // 2026-07-05 — Meta-Forge protocol hint MUST also survive smalltalk
  // stripping, otherwise the model never sees the `<forge>` contract on
  // short creation requests like "phishing triage skill yaz" (intent
  // classifier flips those to smalltalk lane).
  const _keepInSmalltalk = (m) => m?.role !== "system"
    || m?.meta?.kind === "agent_manifest"
    || m?.meta?.kind === "meta_forge_hint"
    || m?.meta?.kind === "capability_state";
  const _effectiveMessages = _suppressSmalltalkSystems
    ? injectSystemPrompt((Array.isArray(messages) ? messages : []).filter(_keepInSmalltalk), systemPrompt, nowPreamble)
    : wrappedMessages;


  // 2026-06-02 — Cloud transport branch. transport='openai_compatible' satırları
  // MLX hattına HİÇ girmez: provider kendi /chat/completions endpoint'inde
  // mesajları doğrudan yutar, chat template orada uygulanır. Bizim render
  // katmanımız (chat-templates.mjs) atlanır — bu cloud için doğrudur.
  const _transport = String(row?.transport ?? "mlx_local").toLowerCase();
  if (_transport === "openai_compatible") {
    const _cloudCap = intentHint === "smalltalk" ? 256 : intentHint === "rag" ? 4096 : 2048;
    const _cloudMax = Math.max(64, Number(extraParams.max_tokens || _cloudCap));
    const _cloudTemp = Number.isFinite(Number(extraParams.temperature)) ? Number(extraParams.temperature) : null;
    const _cloudExtra = { ...extraParams };
    delete _cloudExtra.max_tokens; delete _cloudExtra.temperature;
    console.log(`[CLOUD-ROUTE] model="${row.id}" transport=openai_compatible base="${row.base_url}" maxTokens=${_cloudMax}`);
    try {
      yield* streamCloudCompletion({
        row, servingModel: mdl, messages: _effectiveMessages, signal,
        maxTokens: _cloudMax, temperature: _cloudTemp, extraParams: _cloudExtra,
        onWarming, thinkOff: false,
      });
    } catch (e) {
      // Surface API errors as a delta + done so the UI shows them in the
      // assistant bubble rather than a silent abort. Matches existing MLX
      // error-surfacing convention in this file.
      yield { type: "delta", text: `\n\n_Cloud transport hatası:_ ${String(e?.message || e)}` };
      yield { type: "done" };
    }
    return;
  }



  if (base) {
    if (provider.includes("mlx") || /:8001\b/.test(base) || base.endsWith("/v1")) {
      // Yol C: engine-agnostic /v1/completions. Chat template render katmanı
      // toCompletionBody() içinde (lib/chat-prompt.mjs). Engine değişirse env
      // LLM_CHAT_TEMPLATE yeter; bu dosyada değişiklik gerekmez.
      const target = joinRuntimePath(base, "/v1/completions");
      // FAZ 26 — Dil tekrar düzeltmesi: "veyaım", "FortiManagerManager" gibi token
      // tekrar yapışmalarını kırmak için varsayılan repetition_penalty 1.18.
      // MLX-LM hem `repetition_penalty` (legacy) hem `frequency_penalty` (OpenAI) okur;
      // ikisini de gönderirsek hangi MLX sürümü olursa olsun honör eder.
      // Operatör model satırından custom param verirse o kazanır (extraParams sonda).
      // v15 — top_p/repetition_penalty/frequency_penalty SADECE model satırından
      // (extraParams, spread sonda) gelir. RAG paneli artık bunları tutmaz.
      // Buradaki değerler yalnız boot fallback (env) — model param yoksa devreye girer.
      const repPen = Math.max(1.0, Math.min(2.0, Number(process.env.MLX_REPETITION_PENALTY ?? 1.25)));
      const freqPen = Math.max(0, Math.min(2.0, Number(process.env.MLX_FREQUENCY_PENALTY ?? 0.3)));
      // FAZ 27 — Loop hardening: top_p tail-cutoff + stop guard.
      const topP = Math.max(0.1, Math.min(1.0, Number(process.env.MLX_TOP_P ?? 0.9)));

      // Stop sequences: hardcoded 4-newline guard + UI-managed extras
      // (RAG_SETTINGS.mlxStopSequences). UI knob lets operator add multilingual
      // sentinels (e.g. "<|im_end|>", "</s>", "请提供") if the model leaks tokens
      // into unexpected languages. Cap 8 per MLX OpenAI-compat spec.
      const _uiStops = Array.isArray(RAG_SETTINGS?.mlxStopSequences) ? RAG_SETTINGS.mlxStopSequences : [];
      const stopSeqs = ["\n\n\n\n", ..._uiStops].slice(0, 8);
      // Intent-bazlı max_tokens tavanı (RAM/MPS koruması + smalltalk hız kazancı).
      // extraParams.max_tokens (operatör override) HALA kazanır — spread sonda.
      const _smallCap = Math.max(64,  Number(RAG_SETTINGS?.mlxSmalltalkMaxTokens ?? process.env.MLX_SMALLTALK_MAX_TOKENS ?? 220));
      const _queryCap = Math.max(256, Number(RAG_SETTINGS?.mlxQueryMaxTokens     ?? process.env.MLX_QUERY_MAX_TOKENS     ?? 1000));
      const _ragCap   = Math.max(512, Number(RAG_SETTINGS?.mlxRagMaxTokens       ?? process.env.MLX_RAG_MAX_TOKENS       ?? 2000));
      const intentMaxTokens = intentHint === "smalltalk" ? _smallCap : intentHint === "rag" ? _ragCap : _queryCap;
      // Qwen reasoning modeli: smalltalk'ta /no_think — düşünme bloğu kapanır,
      // "Selam Elara" 9sn'lik içsel reasoning'e takılmadan ~1-2sn'de döner.
      // İki katmanlı koruma:
      const _disableThinkSmalltalk = (typeof RAG_SETTINGS?.disableThinkOnSmalltalk === "boolean")
        ? RAG_SETTINGS.disableThinkOnSmalltalk
        : String(process.env.MLX_DISABLE_THINK_SMALLTALK ?? "1") !== "0";
      const _disableThinkQuery = (typeof RAG_SETTINGS?.disableThinkOnQuery === "boolean")
        ? RAG_SETTINGS.disableThinkOnQuery
        : String(process.env.MLX_DISABLE_THINK_QUERY ?? "1") !== "0";
      const _disableThinkRag = (typeof RAG_SETTINGS?.disableThinkOnRag === "boolean")
        ? RAG_SETTINGS.disableThinkOnRag
        : String(process.env.MLX_DISABLE_THINK_RAG ?? "1") !== "0";
      // Thinking-off intent başına: smalltalk / query / rag ayrı knob.
      // 72B teknik sorularda ~50-60s içsel reasoning üretiyordu → TTFT patlıyordu.
      const _thinkOffIntent =
        (intentHint === "smalltalk" && _disableThinkSmalltalk) ||
        (intentHint === "query"     && _disableThinkQuery) ||
        (intentHint === "rag"       && _disableThinkRag);
      // /no_think + chat_template_kwargs.enable_thinking=false Qwen-only sentinel'lerdir.
      // Gemma/Llama/Mistral chat template'leri bunları tanımaz; düz metin "/no_think"
      // user'a sızar ve modeli kafalar. Family gate.
      const _renderOpts = _normaliseRender(row) || (await _currentModelRender());
      const _tplFamily = String(_renderOpts?.template ?? "").toLowerCase();
      // 2026-06-29 — Gemma 4 native template ALSO honors enable_thinking via
      // chat_template_kwargs (see lib/chat-templates.mjs:_renderGemma4). Without
      // this, Gemma 4 reasoning models burn 30-50s on internal <|think|> blocks
      // for trivial meta/intro turns even though `disableThinkOnQuery` is true.
      const _familyAcceptsThinkOff = /^qwen/.test(_tplFamily) || _tplFamily === "gemma4";
      const _thinkOff = _thinkOffIntent && _familyAcceptsThinkOff;
      // UI = TEK MERCİİ (2026-06-02). Smalltalk guard + /no_think text guard
      // hardcoded bloklar SÖKÜLDÜ. Eskiden burada modele "kurallar 1/2/3 …" diye
      // backend-yazımı talimat enjekte ediliyordu — UI'da bunun düğmesi yoktu.
      // Artık: think-off davranışı SADECE chat_template_kwargs.enable_thinking=false
      // flag'i (aşağıdaki payload'da) ile uygulanır; bu flag bir prompt metni değil,
      // chat template protokol parametresi. /no_think text prefix isteniyorsa
      // models.prompt_prefix UI alanına yazılır (chat-prompt.mjs render'da uygular).
      let payload = toCompletionBody({ model: mdl, messages: _effectiveMessages, stream: true, max_tokens: intentMaxTokens, repetition_penalty: repPen, frequency_penalty: freqPen, top_p: topP, stop: stopSeqs, ...(_thinkOff ? { chat_template_kwargs: { enable_thinking: false } } : {}), ...extraParams }, _renderOpts);
      // Diagnostic: show effective sampling params + whether each came from UI (extraParams) or env default.
      // Helps trace "UI değiştirdim ama sampling değişmedi" raporlarını tek bakışta.
      const _paramSrc = (name, envVal) => Object.prototype.hasOwnProperty.call(extraParams, name) ? `ui-model=${extraParams[name]}` : `env-default=${envVal}`;
      console.log(`[MLX PARAMS] repetition_penalty=${payload.repetition_penalty}(${_paramSrc("repetition_penalty", repPen)}) top_p=${payload.top_p}(${_paramSrc("top_p", topP)}) frequency_penalty=${payload.frequency_penalty}(${_paramSrc("frequency_penalty", freqPen)}) temperature=${payload.temperature ?? "(unset)"}${Object.prototype.hasOwnProperty.call(extraParams, "temperature") ? "(ui)" : "(mlx-default)"} max_tokens=${payload.max_tokens}${Object.prototype.hasOwnProperty.call(extraParams, "max_tokens") ? "(ui-override)" : "(intent-cap)"}`);
      console.log(`[MLX-THINK] intentHint=${intentHint} thinkOff=${_thinkOff} maxTokens=${intentMaxTokens} prefixNoThink=${_thinkOff}`);

      // Agent + Tool/Skill policy seal — merge inference defaults and strict overrides.
      const merged = mergeAndApplyPolicy(payload, policyCtx);
      payload = merged.payload;
      if (merged.summary) console.log(`[POLICY] ${JSON.stringify(merged.summary)}`);
      // Per-model Runtime Safety (2026-05-29). Resolver: model > global > env.
      // Model değiştiğinde davranış da modelle gelir; server.mjs içinde kapalı kutu kalmaz.
      const _safety = resolveRuntimeSafety(row);
      const timeoutSignal = withTimeoutSignal(signal, _safety.streamTotal.value);
      // Detailed RAG audit log so the operator can verify Inspector + sources
      // are physically embedded in the system role before MLX sees them.
      const sysMsg = _effectiveMessages.find(m => m.role === "system");
      const sysLen = sysMsg ? String(sysMsg.content || "").length : 0;
      const sysPreview = sysMsg ? String(sysMsg.content).slice(0, 600).replace(/\s+/g, " ") : "(no system message)";
      console.log(`[MLX → ${target}] system_role_chars=${sysLen} smalltalkSystemsSuppressed=${_suppressSmalltalkSystems} preview="${sysPreview}…"`);
      console.log(`[MLX PAYLOAD]\n${JSON.stringify(payload, null, 2).slice(0, 4000)}`);
      console.log(`[MLX-SAFETY model=${row?.id || mdl}] ${safetySummary(_safety)}`);
      let r;
      const headersTimeoutMs = _safety.headers.value;
      // v11.2 — Adaptive first-token cap: cold yolda model coldFirstToken / RAG_SETTINGS.mlxColdFirstTokenMs,
      // warm yolda model firstToken / global firstToken. Karar tek noktadan (_safety).
      const _coldNow = _mlxIsCold();
      const firstTokenTimeoutMs = _coldNow
        ? Math.max(_safety.firstToken.value, _safety.coldFirstToken.value)
        : _safety.firstToken.value;
      const idleDeltaTimeoutMs = _safety.idleDelta.value;
      const warmingNoticeMs = _safety.warmingNotice.value;
      // Warmup/notice is UI-controlled. If both cold warmup and runtime watchdog
      // are OFF, do not emit any "warming" frame while the real request waits for
      // first token; that frame was misleading and looked like a hidden warmup.
      const _coldEntry = _mlxIsCold();
      const _warmupOn = RAG_SETTINGS?.mlxColdWarmupOnDemand === true;
      const _runtimeNoticeOn = _warmupOn || RAG_SETTINGS?.runtimeWatchdogEnabled === true;
      if (_coldEntry && _runtimeNoticeOn && typeof onWarming === "function") {
        try { onWarming({ headersTimeoutMs, firstTokenTimeoutMs, cold: true }); } catch {}
      }
      // RAM güvenliği: cold warmup SADECE UI'da açıkça true ise tetiklenir.
      // RAG_SETTINGS yüklenmemişse / boolean değilse güvenli default = KAPALI.
      // Ek olarak transport dirty veya halihazırda inflight bir MLX isteği varsa
      // paralel warmup açma — unified memory katlanır (120GB çakılma kök neden).
      const _mlxBusyNow = MLX_TRANSPORT.dirty || (MLX_TRANSPORT.inflight > 0);
      if (_coldEntry && _warmupOn && !_mlxBusyNow) {
        // fire-and-forget — duplicate guard inflight içinde (_mlxOnDemandPreWarm)
        _mlxOnDemandPreWarm().catch(() => {});
      }

      // Kırılım 2b (2026-05-30): fetch + AbortController + headers/warming/first-token/
      // idle-delta watchdog + clean-vs-dirty cancel + inflight++ / finally inflight--
      // bloğu lib/mlx-transport.mjs → streamMlxCompletion() içinde. Davranış aynı,
      // kod yeri değişti. Pre-warm gate yukarıda kaldı; bu çağrı sadece upstream'i
      // sürer ve token piece'lerini yield eder.
      yield* streamMlxCompletion({
        target,
        payload,
        timeoutSignal,
        headersTimeoutMs,
        firstTokenTimeoutMs,
        idleDeltaTimeoutMs,
        warmingNoticeMs,
        onWarming: _runtimeNoticeOn ? onWarming : null,
        modelLabel: row?.id || mdl,
        intentHint,
        promptSysLen: sysLen,
        publicBase,
        base,
        loopGuard: row?.loop_guard ?? null,
        onLoopGuard,
        pushLog,
        runtimeFetchError,
        recordMlxAbort,
        drainChatDeltaBuffer,
      });
      return;
    }
    const target = joinRuntimePath(base, "/api/chat");
    const legacyPayload = { model: mdl, messages: wrappedMessages, stream: true, options: extraParams };
    console.log(`[PAYLOAD TO LEGACY]: ${JSON.stringify(legacyPayload)}`);
    const _legacySafety = resolveRuntimeSafety(row);
    const timeoutSignal = withTimeoutSignal(signal, _legacySafety.streamTotal.value);
    let r;
    try {
      r = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacyPayload),
        signal: timeoutSignal,
      });
    } catch (e) {
      const detail = runtimeFetchError(e, { provider: "Legacy HTTP", target, publicBase, upstreamBase: base, model: mdl, phase: "stream" });
      console.error(detail); pushLog("server", detail);
      throw new Error(detail);
    }
    if (!r.ok || !r.body) throw new Error(`LLM ${r.status} ${r.statusText}: ${await r.text().catch(() => "")}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const drained = drainChatDeltaBuffer(buf);
      buf = drained.rest;
      for (const piece of drained.pieces) yield piece;
      if (drained.done) return;
    }
    return;
  }

  throw new Error("No registered runtime base_url for this model. Register and test a real MLX/Legacy HTTP endpoint first.");
}

// warmLocalChatModel → lib/mlx-warmup.mjs (2026-05-30, Tur A).
// Import üstte; init wiring boot bloğunda pushLog/mlxQueue/_currentModelRender
// tanımlandıktan sonra yapılır.

let localLlmRestartAt = 0;
// Cache the last-known launchd label owning the runtime port. Port'un ölmesinden
// (kill sonrası) hemen sonra kickstart komutu kurulabilsin diye.
let _cachedMlxLaunchdLabel = null;
let _cachedMlxRuntimePlist = null;
let _cachedMlxSystemdUnit = null;
let _cachedMlxSystemdFile = null;
function _runtimePortFromBase(base, fallback = Number(process.env.MLX_RUNTIME_PORT || 8001)) {
  try {
    const u = new URL(String(base || ""));
    const p = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    if (Number.isFinite(p) && p > 0) return p;
  } catch {}
  return fallback;
}
function _resolveMlxRuntimeTarget({ port, base, model } = {}) {
  // 1) Env override — operatör istediği label'ı sabitleyebilir.
  const envLabel = String(process.env.LLM_LAUNCHD_LABEL || "").trim();
  if (envLabel) { _cachedMlxLaunchdLabel = envLabel; return { kind: "launchd", label: envLabel, source: "env" }; }
  // 2) Aktif port'u tutan PID'den keşif.
  try {
    const live = discoverLaunchdLabelForPort(port || Number(process.env.MLX_RUNTIME_PORT || 8001));
    if (live) { _cachedMlxLaunchdLabel = live; return { kind: "launchd", label: live, source: "port" }; }
  } catch {}
  // 3) Son bilinen cache.
  if (_cachedMlxLaunchdLabel) return { kind: "launchd", label: _cachedMlxLaunchdLabel, plist: _cachedMlxRuntimePlist, source: "cache" };
  // 4) Plist discovery — port boş olsa bile LaunchAgent dosyasından bul.
  try {
    const foundPlist = findLaunchdRuntimePlist({ port, baseUrl: base, model });
    if (foundPlist?.label) {
      _cachedMlxLaunchdLabel = foundPlist.label;
      _cachedMlxRuntimePlist = foundPlist.plist || null;
      return { kind: "launchd", label: foundPlist.label, plist: foundPlist.plist, source: "plist", score: foundPlist.score };
    }
  } catch {}
  // 5) Pattern taraması — com.elara.{qwen|gemma|llama|mistral|mlx|llm}*.
  try {
    const found = findLaunchdLabelByPattern();
    if (found) { _cachedMlxLaunchdLabel = found; return { kind: "launchd", label: found, source: "launchctl-list" }; }
  } catch {}
  // 6) Linux/systemd fallback — unit dosyası command/port/model'den keşfedilir.
  try {
    const unit = findSystemdRuntimeUnit({ port, baseUrl: base, model });
    if (unit?.unit) {
      _cachedMlxSystemdUnit = unit.unit;
      _cachedMlxSystemdFile = unit.file || null;
      return { kind: "systemd", unit: unit.unit, file: unit.file, source: "systemd-unit", score: unit.score };
    }
  } catch {}
  if (_cachedMlxSystemdUnit) return { kind: "systemd", unit: _cachedMlxSystemdUnit, file: _cachedMlxSystemdFile, source: "cache" };
  return null;
}

function _spawnDirectRuntimeFromLaunchdPlist(plistFile, reason) {
  const recipe = readLaunchdPlistRuntimeCommand(plistFile);
  if (!recipe?.file) return null;
  const cwd = recipe.cwd || __dirname;
  const child = spawn(recipe.file, recipe.args || [], {
    cwd,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...(recipe.env || {}) },
  });
  child.unref?.();
  pushLog("server", `[llm:restart] direct plist command dispatched · source=${plistFile} · reason=${reason}`);
  return { ok: true, command: true, source: "direct:launchd-plist", file: recipe.file, args: recipe.args || [], plist: plistFile };
}

function _spawnDirectRuntimeFromSystemdFile(serviceFile, reason) {
  const recipe = readSystemdServiceRuntimeCommand(serviceFile);
  if (!recipe?.command) return null;
  const child = spawn(recipe.command, [], {
    shell: true,
    cwd: recipe.cwd || __dirname,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref?.();
  pushLog("server", `[llm:restart] direct systemd ExecStart dispatched · source=${serviceFile} · reason=${reason}`);
  return { ok: true, command: true, source: "direct:systemd-service", service: serviceFile };
}

function restartLocalLlmRuntime(reason = "first-token-timeout", opts = {}) {
  const now = Date.now();
  if (now - localLlmRestartAt < 30_000) {
    pushLog("server", `[llm:restart:skip] throttled · reason=${reason}`);
    return { ok: false, throttled: true };
  }
  localLlmRestartAt = now;
  const explicitCmd = String(process.env.LLM_RESTART_CMD || "").trim();
  const base = String(opts.base || runtimeBase() || "").trim();
  const port = Number(opts.port || _runtimePortFromBase(base));
  const model = String(opts.model || runtimeModel() || "").trim();
  try {
    if (explicitCmd) {
      const child = spawn(explicitCmd, [], { shell: true, detached: true, stdio: "ignore" });
      child.unref?.();
      pushLog("server", `[llm:restart] LLM_RESTART_CMD dispatched · reason=${reason}`);
      return { ok: true, command: true, source: "env" };
    }
    // Dinamik runtime servis keşfi — servis adı hardcoded değil.
    const target = _resolveMlxRuntimeTarget({ port, base, model });
    if (target?.kind === "launchd" && target.label) {
      const uid = String(process.getuid?.() ?? process.env.UID ?? "");
      const domain = uid ? `gui/${uid}` : "gui/$UID";
      const rawPlist = String(target.plist || _cachedMlxRuntimePlist || "");
      const plist = rawPlist.replace(/'/g, "'\\''");
      const cmd = plist
        ? `launchctl kickstart -k ${domain}/${target.label} || launchctl bootstrap ${domain} '${plist}' || launchctl load -w '${plist}'`
        : `launchctl kickstart -k ${domain}/${target.label}`;
      const child = spawn(cmd, [], { shell: true, detached: true, stdio: "ignore" });
      child.unref?.();
      pushLog("server", `[llm:restart] launchd ${target.label} source=${target.source || "?"} port=${port} · reason=${reason}`);
      if (rawPlist && String(process.env.LLM_DIRECT_FALLBACK_FROM_PLIST ?? "1") !== "0") {
        setTimeout(() => {
          try {
            if (listPortPids(port).length === 0) _spawnDirectRuntimeFromLaunchdPlist(rawPlist, `${reason}:launchd-fallback`);
          } catch (e) { pushLog("server", `[llm:restart:fallback-error] ${e?.message || e}`); }
        }, Math.max(1000, Number(process.env.LLM_DIRECT_FALLBACK_DELAY_MS || 2500))).unref?.();
      }
      return { ok: true, command: true, source: `launchd:${target.source || "discovered"}`, label: target.label, plist: target.plist || null, fallback: rawPlist ? "direct-plist-if-port-empty" : null };
    }
    if (target?.kind === "systemd" && target.unit) {
      const unit = String(target.unit).replace(/'/g, "'\\''");
      const cmd = `systemctl --user restart '${unit}' || systemctl restart '${unit}'`;
      const child = spawn(cmd, [], { shell: true, detached: true, stdio: "ignore" });
      child.unref?.();
      pushLog("server", `[llm:restart] systemd ${target.unit} source=${target.source || "?"} port=${port} · reason=${reason}`);
      if (target.file && String(process.env.LLM_DIRECT_FALLBACK_FROM_SERVICE ?? "1") !== "0") {
        setTimeout(() => {
          try {
            if (listPortPids(port).length === 0) _spawnDirectRuntimeFromSystemdFile(target.file, `${reason}:systemd-fallback`);
          } catch (e) { pushLog("server", `[llm:restart:fallback-error] ${e?.message || e}`); }
        }, Math.max(1000, Number(process.env.LLM_DIRECT_FALLBACK_DELAY_MS || 2500))).unref?.();
      }
      return { ok: true, command: true, source: `systemd:${target.source || "discovered"}`, unit: target.unit, file: target.file || null, fallback: target.file ? "direct-service-if-port-empty" : null };
    }
    if (_cachedMlxRuntimePlist) {
      const direct = _spawnDirectRuntimeFromLaunchdPlist(_cachedMlxRuntimePlist, reason);
      if (direct) return direct;
    }
    if (_cachedMlxSystemdFile) {
      const direct = _spawnDirectRuntimeFromSystemdFile(_cachedMlxSystemdFile, reason);
      if (direct) return direct;
    }
    pushLog("server", `[llm:restart:skip] no restart command/runtime service discovered for ${base || "unknown-runtime"} port=${port} model=${model || "?"} · reason=${reason}`);
    return { ok: false, missingCommand: true };
  } catch (e) {
    pushLog("server", `[llm:restart:error] ${e?.message || e}`);
    return { ok: false, error: String(e?.message || e) };
  }
}

// --- Web scraper for Knowledge (RAG) ---------------------------------------
// Lazy-loaded DOM toolchain. jsdom is heavy (~25MB resident), only paid on
// first HTML ingest. Readability extracts the article body; turndown converts
// remaining DOM → Markdown. Zero regex on raw HTML.
let _htmlPipeline = null;
async function _getHtmlPipeline() {
  if (_htmlPipeline) return _htmlPipeline;
  const [{ JSDOM }, { Readability, isProbablyReaderable }, TurndownMod] = await Promise.all([
    import("jsdom"),
    import("@mozilla/readability"),
    import("turndown"),
  ]);
  const TurndownService = TurndownMod.default || TurndownMod;
  const td = new TurndownService({
    headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-",
    emDelimiter: "_", linkStyle: "inlined",
  });
  _htmlPipeline = { JSDOM, Readability, isProbablyReaderable, td };
  return _htmlPipeline;
}

// Synchronous regex-free fallback — used only if jsdom toolchain throws
// (extremely malformed input). Returns plain text via DOMParser-like split.
function _htmlStripFallback(html) {
  // Use DOMParser via jsdom-lite path is not safe here; instead split on tags
  // using a single-pass scanner (no regex).
  let out = "";
  let depth = 0; // tracks <script>/<style>/<noscript> skip
  let skipUntil = null;
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      // tag start
      const end = html.indexOf(">", i + 1);
      if (end < 0) break;
      const tag = html.slice(i + 1, end).trim().toLowerCase();
      const bareTag = tag.split(/\s/)[0].replace(/^\//, "");
      if (skipUntil) {
        if (tag.startsWith("/") && bareTag === skipUntil) skipUntil = null;
      } else if (bareTag === "script" || bareTag === "style" || bareTag === "noscript") {
        if (!tag.startsWith("/") && !tag.endsWith("/")) skipUntil = bareTag;
      }
      i = end + 1;
      if (!skipUntil) out += " ";
      continue;
    }
    if (!skipUntil) out += ch;
    i++;
  }
  return out.replace(/\s+/g, " ").trim();
}

// htmlToText → lib/ingest/extract.mjs

// Schema-aware walker: arrays, objects, REST collections, OpenAPI/Swagger.
// No regex; pure JSON.parse + recursion. Returns markdown-shaped string.
// Empty string means "could not extract" — callers MUST NOT fall back to raw.
const _JSON_HIGH_WEIGHT_KEYS = new Set([
  "title", "name", "summary", "description", "doc", "documentation",
  "path", "endpoint", "url", "method", "operation", "operationid",
  "parameters", "params", "request", "response", "schema", "example",
  "note", "notes", "details", "body", "headers", "tags", "category",
]);

// jsonToSearchableText → lib/ingest/extract.mjs

// /api/knowledge/fetch, /text, /file → lib/routes/knowledge-ingest.mjs (Block K-4b)
// knowledgeFileUpload (multer) modülün içinde tanımlı.

// --- Local Directory Indexer (incremental, permission-aware) ---------------
// POST /api/knowledge/index-directory { path, recursive?, allowedRoles?, requireRole? }
// Returns: { ok, scanned, indexed, skipped, removed, durationMs }
// Multi-format extractors: text dosyalar utf8, PDF/DOCX/XLSX gerçek parser ile,
// diğerleri (kod, config, log) plain-text olarak indexlenir.
const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".log", ".json", ".yaml", ".yml",
  ".csv", ".html", ".htm", ".xml", ".py", ".js", ".ts", ".tsx", ".jsx",
  ".sql", ".sh", ".bash", ".zsh", ".env", ".ini", ".conf", ".cfg",
  ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".cs", ".php",
  ".swift", ".kt", ".scala", ".lua", ".pl", ".r", ".m", ".vue", ".svelte",
  ".toml", ".dockerfile", ".gitignore", ".tf", ".hcl",
]);
const BINARY_DOC_EXT = new Set([
  ".pdf", ".docx", ".doc", ".xlsx", ".xls",
  ".pptx", ".ppt", ".odt", ".odp", ".ods", ".rtf",
]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".wmv", ".flv", ".m4v", ".mpeg", ".mpg", ".3gp"]);
const AV_EXT = new Set([...AUDIO_EXT, ...VIDEO_EXT]);
const VISIO_EXT = new Set([".vsdx", ".vsdm", ".vstx", ".vstm", ".vsd", ".vss", ".vst"]);
const INDEXABLE_EXT = new Set([...TEXT_EXT, ...BINARY_DOC_EXT, ...IMAGE_EXT, ...AV_EXT, ...VISIO_EXT]);
// 300 MB single-file ceiling (large datasets / log files supported)
const MAX_FILE_BYTES = 500 * 1024 * 1024;
// Cap content stored in PG to keep tsvector + memory sane (~2 MB chars ≈ 500 K tokens)
const MAX_INDEXED_CHARS = 2_000_000;
// PostgreSQL tsvector has a 1MB output cap. Dense API/HTML path lists can
// overflow even when the input is 900k chars, so FTS gets a smaller safe slice.
// Full retrieval still uses per-chunk content; this only bounds FTS material.
const FTS_INPUT_CHAR_LIMIT = 250_000;
// Knowledge schema bootstrap — DI'lı modül (Block E.2 Tur 4).
import { initKnowledgeSchema } from "./lib/schema-knowledge.mjs";
const { ensureKnowledgeFilesTable, ensureKnowledgeChunksTable } =
  initKnowledgeSchema({ pool, ftsCharLimit: FTS_INPUT_CHAR_LIMIT });
// Library root is fully dynamic — operator can repoint it via the Vector Forge UI
// (POST /api/knowledge/embeddings/library-path). The override is persisted to
// local-server/.library-root so it survives restarts.
// Resolution order:
//   1. .library-root file       (UI override, sticky)
//   2. BRAND_LIBRARY_ROOT env   (deploy default)
//   3. brand.library_root in DB (operator-set default)
//   4. ~/Documents/<short>/library (neutral fallback, brand-derived)
const LIBRARY_ROOT_FILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), ".library-root");
// Expand a leading "~" to the user's home directory so operators can paste
// "~/Documents/library/" in the UI without it being resolved relative to cwd
// (which becomes /current/cwd/~/Documents/... and fails the "readable" check).
function expandHome(p) {
  const s = String(p || "").trim();
  if (!s) return s;
  if (s === "~") return os.homedir();
  if (s.startsWith("~/") || s.startsWith("~\\")) return path.join(os.homedir(), s.slice(2));
  return s;
}
function defaultLibraryRoot() {
  const env = brandSync().library_root || process.env.BRAND_LIBRARY_ROOT;
  if (env) return path.resolve(env);
  const slug = safeSlug(brandSync().short_name || brandSync().app_name || "library");
  return path.resolve(path.join(os.homedir(), "Documents", slug, "library"));
}
function loadPersistedLibraryRoot() {
  try {
    const raw = fs.readFileSync(LIBRARY_ROOT_FILE, "utf8").trim();
    if (raw) return path.resolve(raw);
  } catch { /* no override yet */ }
  return defaultLibraryRoot();
}
let DEFAULT_LIBRARY_ROOT = loadPersistedLibraryRoot();
function persistLibraryRoot(p) {
  try { fs.writeFileSync(LIBRARY_ROOT_FILE, String(p), "utf8"); return true; }
  catch (e) { console.warn("[library:persist]", e.message); return false; }
}
function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}
const DEFAULT_RAG_TRGM_THRESHOLD = envNumber("RAG_TRGM_THRESHOLD", 0.04);
const DEFAULT_RAG_TRGM_MIN_SCORE = envNumber("RAG_TRGM_MIN_SCORE", 0.005);
const DEFAULT_RAG_SEMANTIC_ASSIST_THRESHOLD = envNumber("RAG_SEMANTIC_ASSIST_THRESHOLD", 0.16);
const DEEP_SYNC_TARGET_CHUNKS = envNumber("RAG_DEEP_SYNC_TARGET_CHUNKS", 5000);

// --- Dynamic RAG settings (operator-tunable from Dashboard) -----------------
// Persisted to local-server/data/rag-settings.json so survives restart and code syncs.
// RAG_DEFAULTS + disk overlay loader extracted to lib/rag/defaults.mjs
// (Tur 1, 2026-05-30). One-shot threshold migration + createRagUtil DI kept here.
const RAG_SETTINGS_LEGACY_FILE = path.join(__dirname, ".rag-settings.json");
const RAG_SETTINGS_DATA_FILE = path.join(__dirname, "data", "rag-settings.json");
// HOME-isolated path: brand-aliases ile aynı code-sync izolasyonu.
// Lovable code-pull `local-server/data/*` veya repo içi dotfile'ı ezebiliyor;
// `~/.elara/state/rag-settings.json` runtime tek mercii.
const { getRagSettingsPath, migrateRagSettingsIfNeeded } = await import("./lib/state-paths.mjs");
const RAG_SETTINGS_FILE = getRagSettingsPath();
const _ragSettingsMigration = migrateRagSettingsIfNeeded([RAG_SETTINGS_DATA_FILE, RAG_SETTINGS_LEGACY_FILE]);
const RAG_DEFAULTS = buildRagDefaults({ envNumber, TIMEOUT_BUDGETS });

let diagnoseChatTrace, _makeThinkStripper, _ragNumber, _ragBool, normalizeRagSettings, saveRagSettings, buildFreeAnswerMessages;
let RAG_SETTINGS = { ...RAG_DEFAULTS };
try { fs.mkdirSync(path.dirname(RAG_SETTINGS_FILE), { recursive: true }); } catch {}
loadRagSettingsFromDisk({ fs, file: RAG_SETTINGS_FILE, target: RAG_SETTINGS });
console.log(`[boot:rag-settings] path=${RAG_SETTINGS_FILE} productFilter=${RAG_SETTINGS.productFilter ?? "(default)"} productAutoExtract=${RAG_SETTINGS.productAutoExtract ?? "(default)"} migration=${_ragSettingsMigration.reason}${_ragSettingsMigration.migrated ? ` from=${_ragSettingsMigration.from}` : ""}`);
// One-shot migration: eski 0.62/0.66 default'u modern hibrit RRF için fazla katı.
if (Number(RAG_SETTINGS.injectThreshold) >= 0.60) {
  RAG_SETTINGS.injectThreshold = 0.55;
  try {
    fs.writeFileSync(RAG_SETTINGS_FILE, JSON.stringify(RAG_SETTINGS, null, 2), "utf8");
    console.log("[rag-settings] migrated injectThreshold -> 0.55 (eski default fazla katıydı)");
  } catch (e) { console.warn("[rag-settings:migrate]", e.message); }
}
// _ragNumber/_ragBool/normalizeRagSettings/saveRagSettings moved to lib/rag/util.mjs (Tur A, 2026-05-30).
({
  diagnoseChatTrace,
  _makeThinkStripper,
  _ragNumber,
  _ragBool,
  normalizeRagSettings,
  saveRagSettings,
  buildFreeAnswerMessages,
} = createRagUtil({
  fs,
  RAG_DEFAULTS,
  RAG_SETTINGS_FILE,
  getRagSettings: () => RAG_SETTINGS,
  setRagSettings: (next) => { RAG_SETTINGS = next; },
  makeThinkStripper,
  brandSync,
  brandDisplay: _brandDisplay,
  stopAllWatchers,
  bootstrapWatchers,
}));

// 2026-06-26 — Runtime Safety boot-apply: UI knob'larını canlı modüllere yansıt.
// (mlxQueue concurrency, agent priority, transport reset). Default değerler
// 72B-zamanı koruma katmanlarını KAPALI bırakır; UI ile açılır/kapanır.
try {
  const _norm = normalizeRagSettings(RAG_SETTINGS);
  RAG_SETTINGS = _norm;
  mlxQueue.setConcurrency(Number(_norm.mlxQueueConcurrency) || 2);
  const { setAgentPriorityOverride, QUEUE_PRIORITY } = await import("./lib/queue-config.mjs");
  setAgentPriorityOverride(_norm.agentQueueBehindChat ? QUEUE_PRIORITY.AGENT_LOW : QUEUE_PRIORITY.CHAT_DEFAULT);
  const { MLX_TRANSPORT } = await import("./lib/mlx-transport.mjs");
  MLX_TRANSPORT.resetEnabled = !!_norm.mlxPreflightResetEnabled;
  console.log(`[boot:runtime-safety] queueConcurrency=${_norm.mlxQueueConcurrency} agentBehindChat=${_norm.agentQueueBehindChat} keepwarm=${_norm.mlxKeepwarmEnabled} preflightReset=${_norm.mlxPreflightResetEnabled}`);
} catch (e) {
  console.warn("[boot:runtime-safety] apply failed:", e?.message || e);
}

// _buildFtsOrQuery moved to lib/rag/retrieval.mjs (Tur 1b, 2026-05-30).

// QueryEmbedCache — sha1(q.lower.trim()) → vector. 256 entry LRU.
// "selam" 2. seferde embed çağrısı 0ms — RAG roketi.
const QEMB_CACHE = new Map(); const QEMB_MAX = 256;
function qembKey(q){ return createHash("sha1").update(String(q).toLowerCase().trim()).digest("hex"); }
function qembGet(q){ const k = qembKey(q); const v = QEMB_CACHE.get(k); if (v) { QEMB_CACHE.delete(k); QEMB_CACHE.set(k, v); } return v || null; }
function qembSet(q, vec){ const k = qembKey(q); QEMB_CACHE.set(k, vec); if (QEMB_CACHE.size > QEMB_MAX) QEMB_CACHE.delete(QEMB_CACHE.keys().next().value); }

// ---------------------------------------------------------------------------
// v11 Two-Layer Query Pipeline (Anthropic Contextual Retrieval — query side).
// Layer 1: Extractor → deterministic clean query (LRU cached, SHA-256, TTL).
// Layer 2: HyDE     → hypothetical technical passage for dense embed only.
//
// FTS + reranker ALWAYS see cleanQuery only (HyDE never leaks).
// Smalltalk routing handled by probe gate + extractor empty check (no regex).
// ---------------------------------------------------------------------------

// Extractor LRU cache — SHA-256(rawInput.lower.trim()) → cleanQuery.
// TTL drives expiry; max bounded to avoid leaks. HyDE is NEVER cached
// (stochastic temp=0.3 output).
const EXTRACTOR_CACHE = new Map(); const EXTRACTOR_MAX = 500;
function _extKey(raw) {
  return createHash("sha256").update(String(raw).toLowerCase().trim()).digest("hex");
}
function _extGet(raw) {
  const k = _extKey(raw);
  const entry = EXTRACTOR_CACHE.get(k);
  if (!entry) return null;
  const ttlMs = (Number(RAG_SETTINGS.extractorCacheTTL) || 24) * 3600 * 1000;
  if (Date.now() - entry.at > ttlMs) { EXTRACTOR_CACHE.delete(k); return null; }
  // LRU bump
  EXTRACTOR_CACHE.delete(k); EXTRACTOR_CACHE.set(k, entry);
  return entry.text;
}
function _extSet(raw, text) {
  const k = _extKey(raw);
  EXTRACTOR_CACHE.set(k, { text, at: Date.now() });
  if (EXTRACTOR_CACHE.size > EXTRACTOR_MAX) EXTRACTOR_CACHE.delete(EXTRACTOR_CACHE.keys().next().value);
}

// _RAG_STOP defense-in-depth sterilizer. Extractor LLM may leak greeting tokens
// ("selam", "lütfen") in clean output; this strips them via linguistic stop set
// (NOT vendor whitelist). If <2 tokens survive, return original untouched.
function _sterilizeWithRagStop(text) {
  const parts = String(text || "").split(/\s+/).filter(Boolean);
  const kept = [];
  for (const raw of parts) {
    const t = raw.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}.]+/gu, "");
    if (!t) continue;
    const ascii = t.replace(/ç/g,"c").replace(/ı/g,"i").replace(/ş/g,"s")
                   .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ö/g,"o");
    if (_RAG_STOP.has(t) || _RAG_STOP_ASCII.has(ascii)) continue;
    if (/^\d{1,2}$/.test(t)) continue;
    if (t.length < 2) continue;
    kept.push(raw);
  }
  const sterilized = kept.join(" ").trim();
  if (sterilized && sterilized.split(/\s+/).length >= 2) return sterilized;
  return text;
}

// ---------------------------------------------------------------------------
// Per-model chat-template profile (2026-06-20). UI = tek mercii (models tablo).
// _currentModelRender(row) → renderChatPrompt/toCompletionBody'ye geçen opts
// Boş satır = env LLM_CHAT_TEMPLATE fallback (chat-prompt.mjs DEFAULT_FAMILY).
// Cache 60s; model değişimi POST /api/models tarafında invalidate eder.
let _MODEL_RENDER_CACHE = { at: 0, key: "", value: null };
function _normaliseRender(row) {
  if (!row || typeof row !== "object") return null;
  const family = String(row.template_family ?? row.templateFamily ?? "").trim().toLowerCase();
  const prefix = String(row.prompt_prefix ?? row.promptPrefix ?? "").trim();
  const stopRaw = row.stop_sequences ?? row.stopSequences;
  let extraStop = [];
  try {
    const arr = typeof stopRaw === "string" ? JSON.parse(stopRaw) : stopRaw;
    if (Array.isArray(arr)) extraStop = arr.map((s) => String(s)).filter(Boolean).slice(0, 8);
  } catch { /* malformed JSON → ignore */ }
  const kwargsRaw = row.chat_template_kwargs ?? row.chatTemplateKwargs;
  let kwargs = null;
  try {
    const obj = typeof kwargsRaw === "string" ? JSON.parse(kwargsRaw) : kwargsRaw;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) kwargs = obj;
  } catch { /* malformed JSON → ignore */ }
  const out = {};
  if (family) out.template = family;
  if (prefix) out.prefix = prefix;
  if (extraStop.length) out.extraStop = extraStop;
  if (kwargs) out.kwargs = kwargs;
  return Object.keys(out).length ? out : null;
}
async function _currentModelRender(forcedRow = null) {
  if (forcedRow) return _normaliseRender(forcedRow) || {};
  let row = null;
  try {
    const r = await pool.query("SELECT id, base_url, template_family, prompt_prefix, stop_sequences, chat_template_kwargs FROM models WHERE is_default=true ORDER BY updated_at DESC LIMIT 1");
    row = r.rows[0] || null;
  } catch { /* table missing → empty render = env fallback */ }
  const key = `${row?.base_url || runtimeBase() || ""}|${row?.id || runtimeModel() || ""}`;
  if (_MODEL_RENDER_CACHE.value !== null && _MODEL_RENDER_CACHE.key === key && (Date.now() - _MODEL_RENDER_CACHE.at) < 60_000) {
    return _MODEL_RENDER_CACHE.value;
  }
  const value = _normaliseRender(row) || {};
  _MODEL_RENDER_CACHE = { at: Date.now(), key, value };
  return value;
}
function _invalidateModelRenderCache() { _MODEL_RENDER_CACHE = { at: 0, key: "", value: null }; }

// ---------------------------------------------------------------------------
// Per-model Runtime Safety resolver (2026-05-29). UI = tek mercii.
// Karar sırası:
//   1) models.<col>            (per-model UI değeri — null değilse kazanır)
//   2) RUNTIME_WATCHDOG_CFG    (System Engine global cockpit)
//   3) env / boot fallback     (LLM_*_TIMEOUT_MS ailesi)
// Sadece streamFromLocalLLM ve warm/cold/stream timeout hesabı bunu çağırır.
function _normaliseRuntimeSafety(row) {
  if (!row || typeof row !== "object") return {};
  const _int = (v) => {
    if (v == null || v === "") return null;
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? n : null;
  };
  return {
    headersMs:         _int(row.watchdog_headers_ms          ?? row.runtimeSafety?.headersMs),
    firstTokenMs:      _int(row.watchdog_first_token_ms      ?? row.runtimeSafety?.firstTokenMs),
    idleDeltaMs:       _int(row.watchdog_idle_delta_ms       ?? row.runtimeSafety?.idleDeltaMs),
    warmingNoticeMs:   _int(row.watchdog_warming_notice_ms   ?? row.runtimeSafety?.warmingNoticeMs),
    coldFirstTokenMs:  _int(row.watchdog_cold_first_token_ms ?? row.runtimeSafety?.coldFirstTokenMs),
    streamTimeoutMs:   _int(row.stream_timeout_ms            ?? row.runtimeSafety?.streamTimeoutMs),
    warmupTimeoutMs:   _int(row.warmup_timeout_ms            ?? row.runtimeSafety?.warmupTimeoutMs),
  };
}
function resolveRuntimeSafety(row) {
  const m = _normaliseRuntimeSafety(row);
  const g = getWatchdogCfg();
  const envInt = (k, fb) => {
    const v = Math.floor(Number(process.env[k] ?? fb));
    return Number.isFinite(v) ? v : fb;
  };
  const pick = (modelVal, globalVal, envVal, label) => {
    if (modelVal != null) return { value: modelVal, source: "model", label };
    if (globalVal != null) return { value: globalVal, source: "global", label };
    return { value: envVal, source: "env", label };
  };
  return {
    headers:        pick(m.headersMs,        g.headersMs,        envInt("LLM_HEADERS_TIMEOUT_MS",       120_000), "headersMs"),
    firstToken:     pick(m.firstTokenMs,     g.firstTokenMs,     envInt("LLM_FIRST_TOKEN_TIMEOUT_MS",    60_000), "firstTokenMs"),
    idleDelta:      pick(m.idleDeltaMs,      g.idleDeltaMs,      envInt("LLM_IDLE_DELTA_TIMEOUT_MS",     20_000), "idleDeltaMs"),
    warmingNotice:  pick(m.warmingNoticeMs,  g.warmingNoticeMs,  envInt("LLM_WARMING_NOTICE_MS",          3_000), "warmingNoticeMs"),
    coldFirstToken: pick(m.coldFirstTokenMs, g.coldFirstTokenMs, Math.max(60_000, Number(RAG_SETTINGS?.mlxColdFirstTokenMs) || envInt("LLM_COLD_FIRST_TOKEN_TIMEOUT_MS", 120_000)), "coldFirstTokenMs"),
    streamTotal:    pick(m.streamTimeoutMs,  g.streamTimeoutMs,  Math.max(10_000, Number(RAG_SETTINGS?.mlxStreamTotalMs) || envInt("LLM_STREAM_TIMEOUT_MS", TIMEOUT_BUDGETS.MLX_STREAM_TOTAL_MS)), "streamTimeoutMs"),
    warmup:         pick(m.warmupTimeoutMs,  g.warmupTimeoutMs,  envInt("LLM_WARMUP_TIMEOUT_MS",         45_000), "warmupTimeoutMs"),
  };
}
function safetySummary(s) {
  return [
    `headers=${s.headers.value}(${s.headers.source})`,
    `firstToken=${s.firstToken.value}(${s.firstToken.source})`,
    `idleDelta=${s.idleDelta.value}(${s.idleDelta.source})`,
    `warm=${s.warmingNotice.value}(${s.warmingNotice.source})`,
    `cold=${s.coldFirstToken.value}(${s.coldFirstToken.source})`,
    `stream=${s.streamTotal.value}(${s.streamTotal.source})`,
    `warmup=${s.warmup.value}(${s.warmup.source})`,
  ].join(" ");
}
// Cache invalidation hook for POST /api/models.
function _invalidateModelRuntimeSafetyCache() { /* resolver stateless; placeholder for future cache */ }

// Resolve MLX endpoint + model — used by both extractor and HyDE.
// Cached for 10s so extractor + HyDE back-to-back don't re-probe runtime.
let _MLX_EP_CACHE = { at: 0, value: null };
async function _resolveMlxEndpoint() {
  if (Date.now() - _MLX_EP_CACHE.at < 10_000 && _MLX_EP_CACHE.value) return _MLX_EP_CACHE.value;
  await hydrateRuntimeProviderFromDb({ quiet: true });
  let row = null;
  try {
    const r = await pool.query("SELECT * FROM models WHERE is_default=true ORDER BY updated_at DESC LIMIT 1");
    row = r.rows[0] ?? null;
  } catch { /* legacy fallback below */ }
  const provider = String(row?.provider ?? RUNTIME_PROVIDER_CFG.provider ?? "");
  const base = normalizeRuntimeBaseUrl(row?.base_url || row?.base || runtimeBase() || process.env.ELARA_MLX_BASE_URL || process.env.MLX_BASE_URL || "");
  const mdl  = _mlxServingId(row, { assert: false });
  const bound = !!String(row?.runtime_model_id ?? "").trim();
  if (!mdl || (!bound && _isPathLikeModelId(mdl))) { _MLX_EP_CACHE = { at: Date.now(), value: null }; return null; }
  if (!base || !mdl) { _MLX_EP_CACHE = { at: Date.now(), value: null }; return null; }
  const isMlx = runtimeIsMlx(base, provider);
  const upstream = runtimeUpstreamBase(base, provider);
  // Yol C: MLX → /v1/completions (engine-agnostic; classifier+denoise paylaşır)
  const target = isMlx ? joinRuntimePath(upstream, "/v1/completions") : joinRuntimePath(upstream, "/api/generate");
  const render = await _currentModelRender();
  const value = { target, mdl, isMlx, render };
  _MLX_EP_CACHE = { at: Date.now(), value };
  return value;
}

// Circuit breaker for extractor MLX calls. Cold MPS can stall first call for
// many seconds; without a breaker every subsequent query also blocks. After
// N consecutive failures, breaker opens for cooldownMs — extractor returns
// instantly with raw input as fallback. First success closes the breaker.
const _EXT_BREAKER = { fails: 0, openedAt: 0 };
function _extBreakerIsOpen() {
  const cd = Number(RAG_SETTINGS.extractorBreakerCooldownMs) || 30000;
  if (_EXT_BREAKER.openedAt && (Date.now() - _EXT_BREAKER.openedAt) < cd) return true;
  if (_EXT_BREAKER.openedAt) { _EXT_BREAKER.openedAt = 0; _EXT_BREAKER.fails = 0; } // cooldown expired
  return false;
}
function _extBreakerRecordFailure() {
  _EXT_BREAKER.fails += 1;
  const th = Math.max(1, Number(RAG_SETTINGS.extractorBreakerThreshold) || 3);
  if (_EXT_BREAKER.fails >= th && !_EXT_BREAKER.openedAt) {
    _EXT_BREAKER.openedAt = Date.now();
    console.warn(`[QUERY-EXTRACT] breaker OPEN (${_EXT_BREAKER.fails} consecutive failures) cooldown=${RAG_SETTINGS.extractorBreakerCooldownMs}ms`);
  }
}
function _extBreakerRecordSuccess() {
  if (_EXT_BREAKER.fails || _EXT_BREAKER.openedAt) {
    console.log("[QUERY-EXTRACT] breaker CLOSED (success)");
  }
  _EXT_BREAKER.fails = 0; _EXT_BREAKER.openedAt = 0;
}

// Layer 1 — Extractor. Vendor-agnostic, deterministic, cache-backed.
// Returns { text: cleanQuery, cacheHit: bool, ms: number, reject?: string }.
// Fallback: raw input on any failure (pipeline never breaks).
// extractTechnicalCore → lib/ingest/extract.mjs

// Layer 2 — HyDE. Generates a hypothetical technical passage from cleanQuery.
// Output is concatenated with cleanQuery for dense embed ONLY.
// 2026-05-28: temperature=0 → DETERMINISTIC. Aynı sorgu → aynı pasaj → aynı
// embedding → stabil probe top1. Bu, eşik bıçak-sırtında (tau~0.50) gözlenen
// inject/skip salınımını (top1 0.498 ↔ 0.55) bitirir. RAG retrieval/rerank
// mantığı DEĞİŞMEDİ. Returns { text, ms, reject? }. Fallback: "" (no HyDE).
async function generateHydePassage(cleanQuery) {
  const q = String(cleanQuery || "").trim();
  if (!q) return { text: "", ms: 0, reject: "empty_input" };
  if (!RAG_SETTINGS.queryHydeEnabled) return { text: "", ms: 0, reject: "disabled" };

  const t0 = Date.now();
  try {
    const ep = await _resolveMlxEndpoint();
    if (!ep) return { text: "", ms: 0, reject: "no_runtime" };
    const _hydeFamily = String(ep.render?.template ?? "").toLowerCase();
    const _hydeThinkOff = /^qwen/.test(_hydeFamily);
    // 2026-06-03 (Tur 2) — UI knob `thinkOffPrefix` (default "/no_think\n"; "" → no prefix)
    const _hydePrefix = _hydeThinkOff ? String(RAG_SETTINGS?.thinkOffPrefix ?? "") : "";
    const sysMsg = _hydePrefix + resolveSystemPrompt(RAG_SETTINGS, "hydeSystemPrompt");
    const prompt = `Write a single short (2-4 sentences) hypothetical technical paragraph that would appear in a real product or vendor document and would answer this question. Use precise technical terminology, command names, and parameter names that would naturally appear. Fix obvious typos in vendor names. Do not invent specific version numbers you are not sure about. Preserve language.\n\nQuestion: ${q}\nHypothetical passage:`;
    const body = ep.isMlx
      ? toCompletionBody({ model: ep.mdl, messages: [{ role: "system", content: sysMsg }, { role: "user", content: prompt }], stream: false, max_tokens: 120, temperature: 0, ...(_hydeThinkOff ? { chat_template_kwargs: { enable_thinking: false } } : {}) }, ep.render)
      : { model: ep.mdl, prompt: `${sysMsg}\n\n${prompt}`, stream: false, options: { temperature: 0, num_predict: 120 } };
    const r = await fetch(ep.target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(300, Math.min(5000, Number(RAG_SETTINGS.hydeTimeoutMs) || 1200))),
    }).catch((e) => ({ __err: String(e?.name || e) }));
    if (!r || r.__err || !r.ok) return { text: "", ms: Date.now() - t0, reject: r?.__err ? `fetch:${r.__err}` : `http_${r?.status || "x"}` };
    const j = await r.json().catch(() => null);
    let out = String(ep.isMlx ? (j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || "") : (j?.response || ""));
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
    out = out.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!out) return { text: "", ms: Date.now() - t0, reject: "empty_output" };
    return { text: out.slice(0, 800), ms: Date.now() - t0 };
  } catch (e) {
    return { text: "", ms: Date.now() - t0, reject: `exception:${String(e?.message || e).slice(0, 80)}` };
  }
}

// Citation confidence — pure math, no extra LLM call. Combines top-1 score,
// top-1/top-4 gap, and source diversity into a 0-100 label.
// _computeConfidence moved to lib/rag/scoring.mjs (Tur 1a).

// ragProbeAndFetch moved to lib/rag/retrieval.mjs (Tur 1b, 2026-05-30).
// _srcNonEmptyCache + _sourcesNonEmpty + FTS error state + _ftsHybridFallback
// moved to lib/rag/retrieval.mjs (Tur 1b, 2026-05-30).

// _RAG_STOP, _RAG_STOP_ASCII, _TR_SUFFIXES, _stripTurkishSuffix, _extractQueryTerms,
// _metaTokenSet, _vendorBoost, _rrfFuse moved to lib/rag/scoring.mjs (Tur 1a).

function normalizeDirRoot(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "/") return "";
  return path.resolve(raw.replace(/^dir:/, "")).replace(/\/+$/, "");
}

function isSameOrUnderRoot(parent, candidate) {
  const p = normalizeDirRoot(parent);
  const c = normalizeDirRoot(candidate);
  if (!p || !c) return false;
  if (p === c) return true;
  const rel = path.relative(p, c);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function canonicalizeKnowledgeRoot(value) {
  const requested = normalizeDirRoot(value || DEFAULT_LIBRARY_ROOT);
  const defaultRoot = normalizeDirRoot(DEFAULT_LIBRARY_ROOT);
  if (requested && defaultRoot && requested !== defaultRoot && isSameOrUnderRoot(defaultRoot, requested)) {
    return { root: defaultRoot, requested, nested: true };
  }
  return { root: requested, requested, nested: false };
}

function pathUnderRootExpr(column = "path") {
  return `(${column} = $1 OR ${column} LIKE $1 || '/%')`;
}

function rootOrPathUnderRootExpr(rootColumn = "root", pathColumn = "path") {
  return `((${rootColumn} = $1 OR ${rootColumn} LIKE $1 || '/%') OR ${pathUnderRootExpr(pathColumn)})`;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function legacyPathDelete(client, tableName, target, { dryRun = false } = {}) {
  const hasPath = await tableHasColumn(tableName, "path").catch(() => false);
  if (!hasPath) return { table: tableName, exists: false, removed: 0 };
  const hasRoot = await tableHasColumn(tableName, "root").catch(() => false);
  const t = quoteIdent(tableName);
  const where = hasRoot ? rootOrPathUnderRootExpr("root", "path") : pathUnderRootExpr("path");
  const r = await client.query(`${dryRun ? "SELECT COUNT(*)::int AS n FROM" : "DELETE FROM"} ${t} WHERE ${where}`, [target]);
  if (dryRun) return { table: tableName, exists: true, removed: 0, candidates: Number(r.rows?.[0]?.n || 0) };
  return { table: tableName, exists: true, removed: r.rowCount || 0 };
}

async function tableColumnSet(db, tableName) {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  ).catch(() => ({ rows: [] }));
  return new Set(rows.map((r) => String(r.column_name)));
}

async function legacyDocumentIdsUnderRoot(client, target) {
  const cols = await tableColumnSet(client, "documents");
  if (!cols.has("id") || !cols.has("path")) return [];
  const where = cols.has("root") ? rootOrPathUnderRootExpr("root", "path") : pathUnderRootExpr("path");
  const r = await client.query(`SELECT id::text AS id FROM documents WHERE ${where}`, [target]).catch(() => ({ rows: [] }));
  return r.rows.map((row) => String(row.id)).filter(Boolean);
}

async function legacyEmbeddingDelete(client, target, documentIds, { dryRun = false } = {}) {
  const cols = await tableColumnSet(client, "embeddings");
  if (!cols.size) return { table: "embeddings", exists: false, removed: 0 };
  const where = [];
  const params = [target];
  if (cols.has("path")) where.push(cols.has("root") ? rootOrPathUnderRootExpr("root", "path") : pathUnderRootExpr("path"));
  const linkCols = ["document_id", "doc_id", "file_id", "source_id", "knowledge_file_id"].filter((c) => cols.has(c));
  if (documentIds.length && linkCols.length) {
    params.push(documentIds);
    where.push(`(${linkCols.map((c) => `${quoteIdent(c)}::text = ANY($2::text[])`).join(" OR ")})`);
  }
  if (!where.length) return { table: "embeddings", exists: true, removed: 0 };
  const sql = `${dryRun ? "SELECT COUNT(*)::int AS n FROM" : "DELETE FROM"} ${quoteIdent("embeddings")} WHERE ${where.join(" OR ")}`;
  const r = await client.query(sql, params);
  if (dryRun) return { table: "embeddings", exists: true, removed: 0, candidates: Number(r.rows?.[0]?.n || 0) };
  return { table: "embeddings", exists: true, removed: r.rowCount || 0 };
}

async function purgeLegacyKnowledgeTables(client, target, opts = {}) {
  const documentIds = await legacyDocumentIdsUnderRoot(client, target);
  const embeddings = await legacyEmbeddingDelete(client, target, documentIds, opts);
  const documents = await legacyPathDelete(client, "documents", target, opts);
  return { documents, embeddings };
}

async function legacyDocumentIdsMatchingNeedles(client, needles) {
  const cols = await tableColumnSet(client, "documents");
  if (!cols.has("id")) return [];
  const textCols = ["path", "root", "url", "name", "title", "source", "source_path"].filter((c) => cols.has(c));
  if (!textCols.length) return [];
  const patterns = needles.map((n) => `%${n}%`);
  const where = textCols.map((c) => `${quoteIdent(c)}::text ILIKE ANY($1::text[])`).join(" OR ");
  const r = await client.query(`SELECT id::text AS id FROM documents WHERE ${where}`, [patterns]).catch(() => ({ rows: [] }));
  return r.rows.map((row) => String(row.id)).filter(Boolean);
}

async function deleteLegacyRowsMatchingNeedles(client, tableName, needles, { dryRun = false, documentIds = [] } = {}) {
  const cols = await tableColumnSet(client, tableName);
  if (!cols.size) return { table: tableName, exists: false, removed: 0 };
  const textCols = ["path", "root", "url", "name", "title", "source", "source_path", "file_path"].filter((c) => cols.has(c));
  const patterns = needles.map((n) => `%${n}%`);
  const where = textCols.map((c) => `${quoteIdent(c)}::text ILIKE ANY($1::text[])`);
  const params = [patterns];
  const linkCols = ["document_id", "doc_id", "file_id", "source_id", "knowledge_file_id"].filter((c) => cols.has(c));
  if (documentIds.length && linkCols.length) {
    params.push(documentIds);
    where.push(`(${linkCols.map((c) => `${quoteIdent(c)}::text = ANY($2::text[])`).join(" OR ")})`);
  }
  if (!where.length) return { table: tableName, exists: true, removed: 0 };
  const sql = `${dryRun ? "SELECT COUNT(*)::int AS n FROM" : "DELETE FROM"} ${quoteIdent(tableName)} WHERE ${where.join(" OR ")}`;
  const r = await client.query(sql, params);
  if (dryRun) return { table: tableName, exists: true, removed: 0, candidates: Number(r.rows?.[0]?.n || 0) };
  return { table: tableName, exists: true, removed: r.rowCount || 0 };
}

async function purgeLegacyGhostNeedles(client, needles, opts = {}) {
  const documentIds = await legacyDocumentIdsMatchingNeedles(client, needles);
  const embeddings = await deleteLegacyRowsMatchingNeedles(client, "embeddings", needles, { ...opts, documentIds });
  const documents = await deleteLegacyRowsMatchingNeedles(client, "documents", needles, opts);
  return { documents, embeddings };
}

async function purgeKnowledgeRoot(root, { dryRun = false } = {}) {
  const target = normalizeDirRoot(root);
  if (!target) return { root: target, removedFiles: 0, removedChunks: 0, removedSources: 0, affectedRoots: [] };
  await ensureKnowledgeFilesTable();
  await ensureKnowledgeChunksTable();
  const client = await pool.connect();
  try {
    if (dryRun) {
      // NOTE: parallel queries must go through the pool (each gets its own client).
      // Running Promise.all on the same pooled client triggers the
      // "client.query() while the client is already executing a query" deprecation.
      const [f, c] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS n FROM knowledge_files WHERE ${rootOrPathUnderRootExpr("root", "path")}`, [target]),
        pool.query(`SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE ${rootOrPathUnderRootExpr("root", "path")}`, [target]),
      ]);
      const legacy = await purgeLegacyKnowledgeTables(client, target, { dryRun: true });
      return { root: target, dryRun: true, candidates: { files: Number(f.rows[0]?.n || 0), chunks: Number(c.rows[0]?.n || 0), documents: legacy.documents.candidates || 0, embeddings: legacy.embeddings.candidates || 0 }, legacy, affectedRoots: [target] };
    }
    await client.query("BEGIN");
    const c = await client.query(`DELETE FROM knowledge_chunks WHERE ${rootOrPathUnderRootExpr("root", "path")}`, [target]);
    const f = await client.query(`DELETE FROM knowledge_files WHERE ${rootOrPathUnderRootExpr("root", "path")}`, [target]);
    const s = await client.query(
      `DELETE FROM knowledge_sources
        WHERE id::text=$1 OR name=$1 OR url=$1 OR name LIKE $1 || '/%' OR url LIKE $1 || '/%'`,
      [target]
    );
    const graph = await purgeGraphOrphans(client).catch(() => ({ removedEdges: 0, removedEntities: 0 }));
    const legacy = await purgeLegacyKnowledgeTables(client, target);
    await client.query("COMMIT");
    // v12 — purged root must release its fs.watch handle so nothing re-ingests.
    try { stopWatchingRoot(target); } catch {}
    console.log(`[knowledge:purge] target=${target} files=${f.rowCount || 0} chunks=${c.rowCount || 0} sources=${s.rowCount || 0} graphEdges=${graph.removedEdges} graphEntities=${graph.removedEntities} documents=${legacy.documents.removed || 0} embeddings=${legacy.embeddings.removed || 0}`);
    return { root: target, removedFiles: f.rowCount || 0, removedChunks: c.rowCount || 0, removedSources: s.rowCount || 0, removedGraphEdges: graph.removedEdges, removedGraphEntities: graph.removedEntities, removedDocuments: legacy.documents.removed || 0, removedEmbeddings: legacy.embeddings.removed || 0, legacy, affectedRoots: [target] };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function purgeGraphOrphans(client) {
  const edges = await client.query(
    `DELETE FROM knowledge_edges ed
     WHERE ed.source_chunk_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM knowledge_chunks kc WHERE kc.id=ed.source_chunk_id)`
  );
  const entities = await client.query(
    `DELETE FROM knowledge_entities e
     WHERE NOT EXISTS (
       SELECT 1 FROM knowledge_edges ed WHERE ed.src_id=e.id OR ed.dst_id=e.id
     )`
  );
  return { removedEdges: edges.rowCount || 0, removedEntities: entities.rowCount || 0 };
}

// Provenance-based cleanup (v8 — 2026-05-19).
// Eski needle/suffix mantığı (KNOWLEDGE_GHOST_SUFFIXES, isim eşleştirme) tamamen
// kaldırıldı; bu mantık Citrix/NetScaler gibi diskte var olan klasörleri yanlışlıkla
// silebiliyordu. Yeni kural çok basit:
//   - knowledge_files.root için fs.existsSync(root) === false → root'a ait
//     dosyaları + chunk'ları sil (kaynak gerçekten kaybolmuş).
//   - opsiyonel: deepFileCheck=true ise her dosya için (root + path) var mı bak,
//     yoksa sadece o dosyayı sil.
//   - knowledge_sources için otomatik silme YOK (URL HEAD probu ayrı endpoint'te).
//   - Orphan knowledge_chunks (eşi olmayan file_id) her zaman temizlenir.
// Hiçbir koşulda isim/string eşleşmesine bakılmaz — koruma listesine de gerek yoktur.
// moved → lib/knowledge/maintenance.mjs (Tur B)

// --- HTML / CSS / control-junk sanitizer ------------------------------------
// Cleans content BEFORE it lands in PostgreSQL so vector + FTS work on signal,
// not on <span style="..."> noise. Idempotent: safe to call on already-clean text.
function sanitizeContent(input) {
  if (input == null) return "";
  let s = String(input);
  // Strip script/style/noscript/template blocks entirely
  s = s.replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ");
  // CSS declarations commonly survive bad PDF/HTML extraction without tags.
  s = s.replace(/\b(?:font-family|font-size|font-weight|line-height|letter-spacing|color|background(?:-color)?|margin|padding|border|display|position|top|left|right|bottom|width|height)\s*:\s*[^;\n{}]{0,240};?/gi, " ");
  // HTML comments
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Remaining tags
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  // Common HTML entities
  s = s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
       .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
       .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCharCode(Number(d)); } catch { return " "; } });
  // Inline CSS leftovers like  style="..."  or  font-family:...;
  s = s.replace(/\bstyle\s*=\s*"(?:[^"\\]|\\.)*"/gi, " ")
       .replace(/\bclass\s*=\s*"(?:[^"\\]|\\.)*"/gi, " ");
  // Drop control chars except \t \n \r
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
  // Collapse whitespace
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return s.trim();
}
function resolveLibraryRoot(value) {
  const raw = String(value ?? "").trim();
  return path.resolve(raw || DEFAULT_LIBRARY_ROOT);
}
function isLikelyBinaryBuffer(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  if (!sample.length) return false;
  let zero = 0, control = 0;
  for (const b of sample) {
    if (b === 0) zero++;
    else if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return zero > 0 || control / sample.length > 0.12;
}
function printableBinarySummary(filePath, ext, buf) {
  const strings = buf.toString("latin1").match(/[\x20-\x7E]{4,}/g) || [];
  return `# Binary File: ${path.basename(filePath)}\nExtension: ${ext || "(none)"}\nSize: ${buf.length} bytes\n\n# Printable Strings\n${strings.slice(0, 20000).join("\n")}`;
}

// ---- Smart media URL ingestor (yt-dlp + whisper) -------------------------
// Detects YouTube/Vimeo/Insta/TikTok/Udemy/direct .mp4/.mp3 links, downloads
// the audio track, transcribes with whisper.cpp (if WHISPER_BIN/MODEL set),
// and ingests as a video source. Returns { ok, id, url, title, chunks, ... }.
// ingestMediaUrl → lib/ingest/pipeline.mjs

// MLX Vision caption — uses local MLX VLM server (Apple Silicon native, OpenAI-compatible API)
// Default endpoint: http://127.0.0.1:8011/v1/chat/completions  (override via MLX_VISION_BASE_URL)
// Default model: mlx-community/Qwen2-VL-7B-Instruct-4bit         (override via MLX_VISION_MODEL)
// NOT: 8001 text-completion engine'i VLM değil — fallback MLX_BASE_URL'ye DÜŞMEZ.
// Vision disable iken (MLX_VISION_DISABLED=1) tamamen no-op.
// mlxVisionCaption → lib/ingest/extract.mjs

// extractFileContent → lib/ingest/extract.mjs

// Chunking constants + isTableLine/isListLine/packAtomic → lib/ingest/extract.mjs

// chunkText → lib/ingest/extract.mjs

function chunkTextDetailed(text) {
  const chunks = chunkText(text);
  let activePage = null;
  return chunks.map((content) => {
    const matches = [...String(content).matchAll(/\[PDF_PAGE\s+(\d+)\]/gi)];
    if (matches.length) activePage = Number(matches[matches.length - 1][1]);
    return { content, page: Number.isFinite(activePage) ? activePage : null };
  });
}

// Diagnostic endpoint: inspect a file's chunk shape from the terminal:
//   curl ":3005/api/knowledge/chunk-preview?id=<file_id>"
//   curl ":3005/api/knowledge/chunk-preview?path=<absolute_path>"
// Returns chunk count, sizes, and whether tables/lists were preserved intact.
// /api/knowledge/chunk-preview, /brand-audit, /chunk-report → lib/routes/knowledge-audit.mjs (Block K-4a)

// ensureKnowledgeChunksTable → lib/schema-knowledge.mjs (Block E.2 Tur 4).

// NOT: ensureKnowledgeChunksTable() boot listen callback'te (Promise.all içinde)
// tek noktadan çağrılıyor — burada migrateReady.then ile ikinci kez tetiklemek
// DDL yarışı yaratıp restart'ta RAM/CPU şişiriyordu.

// brand = first sub-folder under root (e.g. /library/Checkpoint/x.pdf → "Checkpoint")
function deriveBrand(root, filePath) {
  if (!filePath || !filePath.startsWith(root)) return null;
  const rel = filePath.slice(root.length).replace(/^[\/\\]+/, "");
  const seg = rel.split(/[\/\\]/);
  return seg.length > 1 ? seg[0] : null;
}

// Marka tespiti — DB'den gelen `knownBrands` (knowledge_chunks.brand DISTINCT)
// üstünde case-insensitive substring + TR bitişik-ek toleranslı eşleşme.
// Statik BRAND_ALIASES sözlüğü/whitelist'i YASAK (memory kuralı). Alias
// ihtiyacı UI'daki brand-aliases.json → enrichment preamble hattıyla karşılanır;
// burada runtime sözlük yok.
function aliasMatchedBrands(q, knownBrands) {
  const ql = String(q || "").toLowerCase();
  const hits = new Set();
  for (const b of knownBrands || []) {
    if (!b) continue;
    // Türkçe bitişik ek toleransı: "fortigatede", "checkpointtaki" eşleşsin.
    const re = new RegExp(`\\b${String(b).replace(/[.*+?^${}()|[\\]\\\\]/g,"\\$&")}(?:[a-zçğıöşü]{1,6})?\\b`, "i");
    if (re.test(ql)) hits.add(b);
  }
  return Array.from(hits);
}

function aliasMatchedBrand(q, knownBrands) {
  const ql = String(q || "").toLowerCase();
  // En uzun eşleşmeyi tercih et (örn. "Check Point" varsa "Check" değil "Check Point").
  const sorted = [...(knownBrands || [])].filter(Boolean).sort((a,b) => String(b).length - String(a).length);
  for (const b of sorted) {
    const re = new RegExp(`\\b${String(b).replace(/[.*+?^${}()|[\\]\\\\]/g,"\\$&")}(?:[a-zçğıöşü]{1,6})?\\b`, "i");
    if (re.test(ql)) return b;
  }
  return null;
}

// ---- Query expansion: split + light TR/EN synonym map -----------------------
// Used to broaden FTS so "öncelik sırası" also matches "priority", "hierarchy"…
const SYNONYMS = {
  "öncelik": ["priority","precedence","hierarchy"],
  "sıra":    ["order","sequence","priority"],
  "kural":   ["rule","policy"],
  "kurallar":["rules","policies"],
  "politika":["policy","rule"],
  "politikalar":["policies","rules"],
  "güvenlik":["security"],
  "ağ":      ["network"],
  "yönlendirme":["routing","route"],
  "arayüz": ["interface"],
  "sürüm":  ["version","release"],
  "yükseltme":["upgrade","update"],
  "yedek":  ["backup","snapshot"],
  "kullanıcı":["user","admin"],
  "yetki":  ["permission","privilege","role"],
  "lisans": ["license","licence"],
};
// Stopwords — generic filler words that add noise to RAG search.
// Technical tokens (CVE-, R80, FortiGate vb.) zaten regex'le korunur:
// stopword filtresi sadece UZUNLUĞU >=2 olan saf alfabetik kelimeleri eler.
const STOPWORDS = new Set([
  // TR
  "ve","veya","ya","ile","de","da","ki","mi","mı","mu","mü","ne","ama","fakat","ancak",
  "için","gibi","kadar","göre","sonra","önce","şu","bu","o","şey","bir","biraz","çok","az",
  "her","hep","hiç","ben","sen","biz","siz","onlar","bana","sana","bize","size","onu","onun",
  "var","yok","olan","olur","oldu","olmak","yapmak","etmek","mı","midir","değil","evet","hayır",
  "lütfen","tamam","peki","acaba","sanki","yani","ise","eğer","çünkü","zaten","tabii",
  // EN
  "the","a","an","and","or","but","if","then","of","in","on","at","to","for","with","by",
  "is","are","was","were","be","been","being","do","does","did","have","has","had",
  "i","you","he","she","it","we","they","me","him","her","us","them","my","your","our",
  "this","that","these","those","there","here","what","which","who","whom","why","how","when","where",
  "not","no","yes","please","ok","okay","just","only","very","much","many","some","any","all"
]);
function expandQueryTerms(q) {
  const raw = String(q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_.]/gu, " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2);
  // Stopword cleaner — saf alfabetik & stopword'leri at, teknik token'lara dokunma.
  const cleaned = raw.filter(t => {
    if (/[\d_.\-]/.test(t)) return true;        // contains digit/punct → technical
    if (t.length >= 8) return true;             // long words rarely stopwords
    return !STOPWORDS.has(t);
  });
  const base = cleaned.length ? cleaned : raw;  // hepsi stopword'se ham listeye dön
  const out = new Set(base);
  for (const t of base) {
    const syns = SYNONYMS[t];
    if (syns) syns.forEach(s => out.add(s.toLowerCase()));
  }
  return Array.from(out).slice(0, 20);
}
function buildOrTsQuery(terms) {
  // Build a `ts_query` string: term1 | term2 | term3
  const lexemes = [];
  for (const term of terms) {
    const parts = String(term || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(p => p.length >= 2);
    for (const p of parts) lexemes.push(p.replace(/'/g, ""));
  }
  return Array.from(new Set(lexemes)).join(" | ");
}
function isTechnicalQuery(q, terms = []) {
  const raw = String(q || "");
  const text = `${raw} ${(terms || []).join(" ")}`;
  return /\b(?:r\d{2,3}(?:\.\d+)?|maestro|forti\w+|gaia|smartconsole|cpuse|jhf|hotfix|take|pan-os|ios-xe|big-ip|cve-\d{4}-\d+)\b/i.test(text)
    || /\b[A-Z]{2,}[A-Z0-9._-]*\d+[A-Z0-9._-]*\b/.test(raw)
    || /\b[a-z]+\d{2,}[a-z0-9._-]*\b/i.test(raw);
}

// ---- Intent Classifier — SAF SEMANTIC (regex yasak) ------------------------
// Niyet/sınıf/dil tespiti %100 embedding + cosine similarity üzerinden.
// SMALLTALK_PATTERNS ve QUESTION_HINTS regex'leri terminalsiz söküldü.

// Operator-tunable runtime config — controls how aggressive the intent
// classifier is. forceRagMode lets the Architect override the router entirely.
//   "auto"   → score-based gate (default)
//   "always" → every query (even "selam") goes to RAG
//   "never"  → RAG is disabled, model answers from memory
// Semantic Intent Router — ELARA-native pipeline.
// No phrase dictionary. Routing decisions come from:
//   1) embedding cosine similarity between the query and two anchor concepts
//      (technical/library vs casual/social), gated by `semanticThreshold`.
//   2) optional LLM zero-shot classification via `classifierPrompt` (used when
//      embeddings are unavailable or `classifierMode === "llm"`).
// DEFAULT_CLASSIFIER_PROMPT + RUNTIME_INTENT_CFG + clampThreshold + clampSemanticThreshold
// → lib/rag/intent-classifier.mjs (Tur B, 2026-05-30). Imported at top.

// Engine routes mount — RUNTIME_INTENT_CFG ve DEFAULT_CLASSIFIER_PROMPT tanımı
// burada hazır olduğu için mount call'ı bu noktaya alındı (TDZ fix, 2026-05-30).
mountEngineRoutes(app, {
  pool,
  RUNTIME_INTENT_CFG, DEFAULT_CLASSIFIER_PROMPT,
  RUNTIME_PROVIDER_CFG, RUNTIME_PROVIDER_PRESETS,
  hydrateRuntimeProviderFromDb,
  resolveProvider: _resolveProvider,
  sanitizeModels: _sanitizeModels,
  runtimeBase, runtimeUpstreamBase, runtimeModel, runtimeIsMlx,
  getWatchdogCfg, setWatchdogCfg,
  getWorkerSelfHealCfg, setWorkerSelfHealCfg,
  persistWatchdogToDb,
  getSelfHealCooldownMs: () => SELF_HEAL_COOLDOWN_MS,
  getRespawnMaxInWindow: () => RESPAWN_MAX_IN_WINDOW,
  getMlxTransportSnapshot,
  mlxWarmCacheTtlMs: _mlxWarmCacheTtlMs,
  MLX_TRANSPORT,
});

// Intent classifier (INTENT_ANCHORS, ensureAnchorVecs, semanticIntentGate,
// llmIntentClassify, refineIntentSemantically, scoreTechnicalSignal, classifyIntent)
// → lib/rag/intent-classifier.mjs (Tur B, 2026-05-30). initIntentClassifier wired after cosine def.

// mlxEmbed + mlxRerank + error rings → lib/rag/mlx-embed-rerank.mjs (Tur C, 2026-05-30).
// initMlxEmbedRerank wired after worker constants + ensureWorker defs (search for init below).

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
// semanticSearch moved to lib/rag/retrieval.mjs (Tur 1b, 2026-05-30).
const semanticFallback = semanticSearch;

// ----- Dynamic library brand cache → lib/rag/brand-cache.mjs (Batch A, 2026-05-30)
// Exports: getLibraryBrands, getActivePackBrandFilter, invalidatePackFilterCache,
//          getAgentRagBrands, invalidateAgentBrandCache, _brandDisplay, detectLibraryMatch.
// DI: pool + getRagSettings (RAG_SETTINGS reader, runtime-mutated by Dashboard).
initBrandCache({ pool, getRagSettings: () => RAG_SETTINGS });
initAgentRag({ getRagSettings: () => RAG_SETTINGS });
initAgentEnv({ getRagSettings: () => RAG_SETTINGS });


// mlxEmbed + mlxRerank transport wiring (Tur C, 2026-05-30).
initMlxEmbedRerank({
  pushLog,
  getWorkerStatus: () => workerStatus,
  kickWorkerStart,
  ensureWorker,
  getRagSettings: () => RAG_SETTINGS,
  embedWorkerPort: EMBED_WORKER_PORT,
  embedWorkerHost: EMBED_WORKER_HOST,
});

// Intent classifier wiring (Tur B, 2026-05-30) — after cosine + mlxEmbed defs.
initIntentClassifier({
  pool,
  pushLog,
  mlxEmbed,
  currentModelRender: _currentModelRender,
  cosine,
  getRagSettings: () => RAG_SETTINGS,
});
scheduleIntentHydrate(500);

// buildFreeAnswerMessages moved to lib/rag/util.mjs (Tur A, 2026-05-30).

// ============================================================================
// v4 İNFAZ: instantSmalltalkReply, TEMPLATES, isInstantSmalltalk,
// SMALLTALK_SUBCLASS_ANCHORS, LOCALE_ANCHORS, pickSmalltalkSubclass,
// pickLocale, burstText, streamSmalltalkFromEnvLLM — TERMİNALSİZ SİLİNDİ.
// Şablon havuzu yasak. Tüm trafik streamFromLocalLLM → MLX 8001 hattından akar.
// Geri eklemek için Komutan onayı + System Engine "BYPASS YASAK" rozetinin kaldırılması şart.
// ============================================================================

// ---- Entity extractor → lib/rag/entity-extractor.mjs (Batch A, 2026-05-30)
// Exports: extractEntities, upsertEntity, linkEntitiesForChunk. DI: pool.
initEntityExtractor({ pool });

// rebuildChunksForFile → lib/ingest/pipeline.mjs

// Embedding'leri batch'leyip pgvector kolonuna yaz. MLX yoksa sessizce çık.
// Boyut env EMBED_DIM (default 1024) ile mühürlüdür; MLX modeli farklı boyut
// dönerse satır 'error' damgası alır ve atlanır (sonsuz döngü yok).
const EMBED_DIM_TARGET = Math.max(64, Math.min(4096, Number(process.env.EMBED_DIM) || 1024));
// embedAndStoreChunks + getEmbeddingHealth → lib/embed-worker/store.mjs (Tur 3a)
initEmbedWorkerStore({
  pool, mlxEmbed, ensureWorker, pushLog,
  tableHasColumn, ensureKnowledgeChunksTable,
  // cleanupKnowledgeGhosts factory init'i ~line 5424'te (SYSTEM_ACTIONS sonrası).
  // Wrapper geçiyoruz — dep-check truthy görür, gerçek çağrı geç-bind.
  cleanupKnowledgeGhosts: (...a) => cleanupKnowledgeGhosts(...a),
  inspectDirectoryAccess,
  getLibraryRoot: () => DEFAULT_LIBRARY_ROOT,
  getRagSettings: () => RAG_SETTINGS,
  EMBED_DIM_TARGET,
});

// initAdaptersSchema → lib/schema-adapters.mjs (boot DDL seed).
({ ensureAdapterDictionariesSeed } = initAdaptersSchema({ pool }));

// initEmbedWorkerRuntime → lib/embed-worker/runtime.mjs (Tur 3b)
// State callbacks: workerProc/Status/LastError/StartedAt server.mjs `let`
// kalıyor (40+ reader); SELF_HEAL_COOLDOWN_MS + RESPAWN_MAX_IN_WINDOW
// cockpit watchdog mutate ettiği için getter ile okunur.
initEmbedWorkerRuntime({
  pool,
  spawn, isPortOpen, killPortOwnerAndWait, waitForPidExit: _waitForPidExit,
  probeWorkerHealth, verifyEmbedAlive, warmEmbedWorker,
  resolvePythonCandidates,
  pushLog,
  getRecentWorkerLogs: (limit = 60) => SYS_LOG_RING.filter((evt) => evt?.source === "worker").slice(-Math.max(1, Math.min(200, Number(limit) || 60))),
  ensureKnowledgeChunksTable,
  embedAndStoreChunks,
  getRagSettings: () => RAG_SETTINGS,
  getLastEmbedError,
  EMBED_WORKER_HOST, EMBED_WORKER_PORT, DEFAULT_EMBED_MODEL,
  serverDir: __dirname,
  getProc: () => workerProc, setProc: (v) => { workerProc = v; },
  getStatus: () => workerStatus, setStatus: (v) => { workerStatus = v; },
  getLastError: () => workerLastError, setLastError: (v) => { workerLastError = v; },
  setStartedAt: (v) => { workerStartedAt = v; },
  getSelfHealCooldownMs: () => SELF_HEAL_COOLDOWN_MS,
  getRespawnMax: () => RESPAWN_MAX_IN_WINDOW,
});
mountEmbedWorkerRoutes(app);
startEmbedWorkerIntervals();

// ---- Universal Ingestion (URL · Text · File · Directory · Messaging hepsi buradan akar)
// ingestSource → lib/ingest/pipeline.mjs

// ============================================================================
// Recursive URL crawl helper — used by both global sync and per-source sync.
// When a knowledge_sources row of type='url' has crawl_config.recursive=true,
// this fans out to all same-origin pages (sitemap-first, BFS fallback) and
// writes each page as a child knowledge_sources row (parent_id -> root id).
// On re-sync we wipe old children first so the index reflects the live site.
//
// Returns: { visited, errors, bytes, durationMs, stoppedReason, written }
// ============================================================================
// __crawlMutex/withCrawlMutex/deriveChildSourceId → lib/ingest/pipeline.mjs

// ============================================================================
// Ingest cluster init — extract + pipeline. Factories return functions that we
// bind to the `let` declarations near the top of this file. Extract MUST init
// FIRST because pipeline deps reference htmlToText.
// ============================================================================
({
  htmlToText,
  jsonToSearchableText,
  extractTechnicalCore,
  mlxVisionCaption,
  extractFileContent,
  chunkText,
} = createIngestExtract({
  _getHtmlPipeline,
  _htmlStripFallback,
  _JSON_HIGH_WEIGHT_KEYS,
  _extGet, _extSet,
  _extBreakerIsOpen, _extBreakerRecordFailure, _extBreakerRecordSuccess,
  _resolveMlxEndpoint,
  toCompletionBody,
  _sterilizeWithRagStop,
  execCapture,
  isLikelyBinaryBuffer,
  printableBinarySummary,
  sanitizeContent,
  MAX_INDEXED_CHARS,
  TEXT_EXT, IMAGE_EXT, AV_EXT, VISIO_EXT,
  getRagSettings: () => RAG_SETTINGS,
}));

({
  rebuildChunksForFile,
  ingestSource,
  ingestMediaUrl,
  recrawlUrlSource,
  withCrawlMutex,
  deriveChildSourceId,
} = createIngestPipeline({
  pool,
  getRagSettings: () => RAG_SETTINGS,
  ensureKnowledgeChunksTable,
  tableHasColumn,
  sanitizeContent,
  chunkTextDetailed,
  enrichChunkContent,
  linkEntitiesForChunk,
  embedAndStoreChunks,
  deriveBrand,
  deriveBrandFromUrl,
  htmlToText,
  createLocalId,
  MAX_INDEXED_CHARS,
  crawlUrl,
  crawlPresetConfig,
}));

// ensureKnowledgeFilesTable → lib/schema-knowledge.mjs (Block E.2 Tur 4).

async function tableHasColumn(tableName, columnName) {
  const { rows } = await pool.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists,
            EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name=$2 AND column_name=$3
            ) AS has_column`,
    [`public.${tableName}`, tableName, columnName]
  );
  return !!rows[0]?.exists && !!rows[0]?.has_column;
}

function isTsVectorOverflowError(error) {
  return /string is too long for tsvector/i.test(String(error?.message || error));
}

// moved → lib/knowledge/maintenance.mjs (Tur B)

void migrateReady.then(async () => {
  await ensureKnowledgeFilesTable();
  await syncCanonicalLibraryPaths().catch((e) => console.warn("[library:path-sync]", e.message));
});
// scanDirectory — incremental, liyakatli (Senior RAG)
// Per-folder access_level can be passed via req.body.folderAccessLevels
// (e.g. { "/Users/levent/secret": "Admin", "/Users/levent/public": "Viewer" }).
// Default access_level for the whole root: req.body.accessLevel ('Viewer' if omitted).
async function inspectDirectoryAccess(root, opts = {}) {
  const recursive = opts.recursive !== false;
  const sampleLimit = Math.max(1, Math.min(100, Number(opts.sampleLimit) || 20));
  const audit = { root, recursive, exists: false, isDirectory: false, readable: false, executable: false, visitedDirs: 0, filesSeen: 0, indexableSeen: 0, permissionErrors: [], errors: [], sampleFiles: [] };
  try { const st = await fs.promises.stat(root); audit.exists = true; audit.isDirectory = st.isDirectory(); }
  catch (e) { audit.errors.push({ path: root, code: e.code || "STAT", message: String(e.message || e) }); return audit; }
  try { await fs.promises.access(root, fs.constants.R_OK); audit.readable = true; }
  catch (e) { audit.permissionErrors.push({ path: root, code: e.code || "R_OK", message: String(e.message || e) }); }
  try { await fs.promises.access(root, fs.constants.X_OK); audit.executable = true; }
  catch (e) { audit.permissionErrors.push({ path: root, code: e.code || "X_OK", message: String(e.message || e) }); }
  if (!audit.isDirectory || !audit.readable) return audit;
  for await (const file of walkDir(root, recursive, audit)) {
    if (INDEXABLE_EXT.has(path.extname(file).toLowerCase())) audit.indexableSeen += 1;
    if (audit.sampleFiles.length < sampleLimit) audit.sampleFiles.push(file);
  }
  return audit;
}

async function* walkDir(root, recursive, audit = null) {
  const stack = [root];
  const skipRoots = []; // v8: needle/suffix kaldırıldı; tarama esnasında klasör atlanmaz
  while (stack.length) {
    const dir = stack.pop();
    if (audit) audit.visitedDirs = (audit.visitedDirs || 0) + 1;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (e) {
      const item = { path: dir, code: e.code || "READDIR", message: String(e.message || e) };
      if (audit) {
        audit.errors?.push(item);
        if (e.code === "EACCES" || e.code === "EPERM") audit.permissionErrors?.push(item);
      }
      console.warn(`[rag:walk] skip ${dir}: ${item.code} ${item.message}`);
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skipRoots.some((r) => isSameOrUnderRoot(r, full))) {
          if (audit) audit.errors?.push({ path: full, code: "EXCLUDED_SUBROOT", message: "nested ghost root excluded from recursive index" });
          continue;
        }
        if (recursive) stack.push(full);
        continue;
      }
      if (e.isFile()) { if (audit) audit.filesSeen = (audit.filesSeen || 0) + 1; yield full; }
    }
  }
}

function resolveFileAccessLevel(filePath, defaultLevel, folderMap) {
  // Pick the longest matching folder prefix → most specific wins
  if (folderMap && typeof folderMap === "object") {
    let best = null;
    for (const folder of Object.keys(folderMap)) {
      if (filePath.startsWith(folder) && (!best || folder.length > best.length)) best = folder;
    }
    if (best) return normalizeAccessLevel(folderMap[best]);
  }
  return normalizeAccessLevel(defaultLevel);
}

// /api/knowledge/index-directory → lib/routes/knowledge-ingest.mjs (Block K-4b)

// ---- Reindexer + Sync Jobs → lib/knowledge/reindexer.mjs (2026-05-30) -----
const {
  reindexRoot,
  ragJobs,
  createSyncOptions,
  deriveStartedBy,
  startSyncJob,
  cancelSyncJob,
  runSyncJob,        // exported for parity (was top-level in monolith)
  runSourceSyncJob,  // exported for parity
  hardResetRagDatabase,
  getLastSyncJobId,
} = initReindexer({
  pool,
  canonicalizeKnowledgeRoot, purgeKnowledgeRoot, inspectDirectoryAccess,
  walkDir, normalizeAccessLevel,
  ensureKnowledgeFilesTable, ensureKnowledgeChunksTable,
  INDEXABLE_EXT, MAX_FILE_BYTES, FTS_INPUT_CHAR_LIMIT,
  getDefaultLibraryRoot: () => DEFAULT_LIBRARY_ROOT,
  DEEP_SYNC_TARGET_CHUNKS,
  extractFileContent, sanitizeContent, chunkTextDetailed,
  isTsVectorOverflowError, rebuildChunksForFile,
  htmlToText, deriveBrandFromUrl, ingestSource,
  recrawlUrlSource, withCrawlMutex,
  startWatchingRoot: (root) => startWatchingRoot(root),
  enqueueWrite, triggerSyncAutoReenrich,
});

// GET/POST /api/knowledge/sync — schedules async job, returns 202 + jobId immediately.
mountKnowledgeSyncRoutes(app, {
  pool, sseBegin,
  ragJobs, getLastSyncJobId,
  createSyncOptions, deriveStartedBy, startSyncJob, cancelSyncJob,
  purgeKnowledgeRoot, purgeGraphOrphans,
  invalidateSourcesCache,
});

// POST /api/knowledge/url-purge-all — 2026-05-26 (replaced url-rechunk-all).
// Restore stratejisi iptal: tüm type='url' source'ları + chunk'ları siler.
// Refetch kullanıcıya bırakılır (UI). PDF/file/JSON/MD ETKİLENMEZ.
// Body: { dryRun?: boolean }
mountKnowledgeMaintenanceRoutes(app, { pool, purgeGraphOrphans, cleanupKnowledgeGhosts: (...a) => cleanupKnowledgeGhosts(...a) });

// Tur 2 (2026-05-30): system-misc routes — mounted here (after initReindexer
// exposes ragJobs/cancelSyncJob) to avoid TDZ.
mountSystemMiscRoutes(app, {
  pool, requireSession,
  sjClaim, sjRelease, sjHost, sjPid, sjList, sjActive, sjRequestStop, SJ_JOB_TYPES,
  cveIngestOnce, runRetention,
  ragJobs, cancelSyncJob,
  listMigrations, applyMigration, rollbackMigration,
  GATEWAY_PORT, EMBED_WORKER_PORT,
  probeWorkerHealth, ensureGateway, ensureWorker, killGateway, killWorker,
  getGatewayStatus: () => gatewayStatus,
  getWorkerStatus: () => workerStatus,
  getWorkerLastError: () => workerLastError,
  serviceRestartLog, RESTART_WINDOW_MS,
  authenticateLdap, probeLdap, authenticateRadius, probeRadius,
  pushLog,
  enqueueWrite, broadcastAudit, getWriteQueueDepths,
  sseBegin, auditClients,
  chatTraceList, diagnoseChatTrace,
  upload, createLocalId, UPLOAD_DIR,
});

async function countGhostNeedles(needles = []) {
  // v8: needle/suffix mantığı kaldırıldı. Bu fonksiyon yalnızca legacy
  // diagnostic için duruyor — default boş needles ile total=0 döner.
  if (!Array.isArray(needles) || needles.length === 0) return { total: 0, byTable: {}, needles: [] };
  const patterns = needles.map((n) => `%${n}%`);
  const client = await pool.connect();
  try {
    const tables = ["knowledge_chunks", "knowledge_files", "knowledge_sources", "documents", "embeddings"];
    let total = 0; const byTable = {};
    for (const table of tables) {
      const cols = await tableColumnSet(client, table);
      const textCols = ["path", "root", "url", "name", "title", "source", "source_path", "file_path"].filter((c) => cols.has(c));
      if (!textCols.length) { byTable[table] = 0; continue; }
      const where = textCols.map((c) => `${quoteIdent(c)}::text ILIKE ANY($1::text[])`).join(" OR ");
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${quoteIdent(table)} WHERE ${where}`, [patterns]).catch(() => ({ rows: [{ n: 0 }] }));
      byTable[table] = Number(r.rows[0]?.n || 0); total += byTable[table];
    }
    return { total, byTable, needles };
  } finally { client.release(); }
}

// sendRagStatus + GET /rag/status → lib/routes/rag-status.mjs (2026-05-30).
const sendRagStatus = createSendRagStatus({ pool, getEmbeddingHealth, sjActive, sjHost });
mountRagStatusRoute(app, sendRagStatus);
// Tur 1b (2026-05-30): RAG retrieval core (ragProbeAndFetch+semanticSearch+
// _ftsHybridFallback+_buildFtsOrQuery) lives in lib/rag/retrieval.mjs.
// Init here — all deps (pool, RAG_SETTINGS, mlx*, brand helpers, breaker) are
// defined upstream by this point.
const _productCacheApi = initProductCache({ pool, getRagSettings: () => RAG_SETTINGS });
initRagRetrieval({
  pool,
  getRagSettings: () => RAG_SETTINGS,
  ROLE_RANK,
  getActivePackBrandFilter,
  getAgentRagBrands,
  extractTechnicalCore,
  isExtBreakerOpen: _extBreakerIsOpen,
  getLibraryBrands,
  detectLibraryMatch,
  generateHydePassage,
  qembGet,
  qembSet,
  mlxEmbed,
  mlxRerank,
  getLastRerankError,
  getLastEmbedError,
  expandQueryTerms,
  cosine,
  DEFAULT_RAG_TRGM_THRESHOLD,
  DEFAULT_RAG_TRGM_MIN_SCORE,
  detectProductFromQuery: _productCacheApi.detectProductFromQuery,
});

// /api/rag/health/status/debug/probe/self-audit/diagnose-join extracted 2026-05-30
// → lib/routes/rag-readops.mjs (Tur A2+A3+A4). Init+mount here so all DI symbols
// (pool/ROLE_RANK/intent/probe/fts helpers/sendRagStatus/last-error getters) are
// already defined upstream.
initRagReadOps({
  pool,
  env: process.env,
  path,
  getRagSettings: () => RAG_SETTINGS,
  ROLE_RANK,
  normalizeAccessLevel,
  classifyIntent,
  refineIntentSemantically,
  ragProbeAndFetch,
  _isLoopbackReq,
  _ftsHybridFallback,
  _buildFtsOrQuery,
  sendRagStatus,
  getLastEmbedError,
  getLastFtsError,
  getLastFtsChunkError,
  getLastFtsSourceError,
  getLastRerankError,
  getLastRerankMs: () => _lastRerankMs,
  getLastRerankAt: () => _lastRerankAt,
  getWorkerStatus: () => (typeof workerStatus !== "undefined" ? workerStatus : "unknown"),
});
mountRagReadOpsRoutes({ app });

// rag-diagnostics: verify-source + diagnose-html/corpus/query (Tur A5, 2026-05-30).
initRagDiagnostics({
  pool,
  ROLE_RANK,
  getRagSettings: () => RAG_SETTINGS,
  _extractQueryTerms,
  _buildFtsOrQuery,
  _ftsHybridFallback,
  _rrfFuse,
  mlxEmbed,
  mlxRerank,
  getLastRerankError,
});
mountRagDiagnosticsRoutes({ app });

// brand-aliases: GET/POST /api/rag/brand-aliases + reenrich (2026-05-30).
initBrandAliases({
  baseDir: __dirname,
  pool,
  getRagSettings: () => RAG_SETTINGS,
  deriveBrandFromKnowledgeSource,
});
mountBrandAliasesRoutes({ app });
// Boot-time alias audit — kullanıcı "aliasları silinmiş" derken normal reboot
// mı yoksa code-swap restore mı olduğunu ayırt etmek için her boot'ta
// brand-aliases.json'un boyut/mtime/sha kısa özetini logla.
// 2026-06-04: dosya artık HOME altında (~/.elara/state) — code-sync ezmez.
try {
  const { getBrandAliasesPath } = await import("./lib/state-paths.mjs");
  const _aliasPath = getBrandAliasesPath();
  if (fs.existsSync(_aliasPath)) {
    const _buf = fs.readFileSync(_aliasPath);
    const _st = fs.statSync(_aliasPath);
    const _sha = createHash("sha256").update(_buf).digest("hex").slice(0, 12);
    let _brands = 0;
    try { _brands = Object.keys(JSON.parse(_buf.toString("utf8") || "{}")).length; } catch {}
    console.log(`[boot:brand-aliases] path=${_aliasPath} size=${_st.size} mtime=${_st.mtime.toISOString()} sha=${_sha} brands=${_brands}`);
  } else {
    console.log(`[boot:brand-aliases] MISSING ${_aliasPath}`);
  }
} catch (e) { console.warn(`[boot:brand-aliases] audit failed: ${e.message}`); }

// /api/rag/nuke-reindex + reprocess-extensions → lib/routes/rag-ops.mjs
// (Tur 1, 2026-05-30). Mount aşağıda, deps hazır olduktan sonra çağrılır.
mountRagOpsRoutes(app, {
  pool,
  ragSelfAudit,
  resolveJoinExpr,
  deriveBrandFromUrl,
  startSyncJob,
  hardResetRagDatabase,
  countGhostNeedles,
  getEmbeddingHealth,
  getDefaultLibraryRoot: () => DEFAULT_LIBRARY_ROOT,
});

// ---- fs.watch ingestion pipeline (live mühürleme) -----------------------
// Extracted 2026-05-30 → lib/knowledge/watchers.mjs
initWatchers({
  pool,
  getRagSettings: () => RAG_SETTINGS,
  reindexRoot: (root) => reindexRoot(root),
  enqueueWrite: (...a) => enqueueWrite(...a),
  ensureKnowledgeFilesTable: () => ensureKnowledgeFilesTable(),
  migrateReady,
});

// Hybrid search: full-text + role hierarchy filter (Liyakat-Aware)
// User with rank R sees only files with access_level rank <= R.
// Returns granted + denied counts so the UI can flag silent gates.
function buildRoleSql(role) {
  // Build "access_level IN (...)" of levels the role can read.
  const userRank = ROLE_RANK[normalizeAccessLevel(role)] ?? 0;
  const allowed = Object.entries(ROLE_RANK)
    .filter(([, rank]) => rank <= userRank)
    .map(([name]) => name);
  if (!allowed.length) return { sql: "AND access_level = '__none__'", params: [] };
  const placeholders = allowed.map((_, i) => `$${i + 100}`); // unique numbering
  return { allowed, levels: allowed };
}

// Block K-3 → lib/routes/knowledge-retrieve.mjs (10 endpoints: search,
// sources, source/:id/brand, library-brands, embeddings/{health,
// library-path/validate, library-path, mark-pending, backfill}, retrieve).
// __sourcesCache + invalidateSourcesCache live inside the module; the same
// exported reference is reused by knowledge-sync mount above.
mountKnowledgeRetrieveRoutes(app, {
  pool, sseBegin,
  ROLE_RANK, normalizeAccessLevel,
  semanticSearch, semanticFallback,
  ensureKnowledgeFilesTable, ensureKnowledgeChunksTable,
  getLibraryBrands, getEmbeddingHealth,
  expandHome, inspectDirectoryAccess,
  getLibraryRoot: () => DEFAULT_LIBRARY_ROOT,
  setLibraryRoot: (p) => { DEFAULT_LIBRARY_ROOT = p; },
  persistLibraryRoot,
  syncCanonicalLibraryPaths,
  ensureWorker, pushLog, reindexRoot,
  sjClaim, sjRelease, sjHeartbeat, sjCheckStop, sjHost, sjPid,
  EMBED_WORKER_PORT, EMBED_DIM_TARGET,
  ragSettings: () => RAG_SETTINGS,
  embedAndStoreChunks,
  expandQueryTerms, aliasMatchedBrand, buildOrTsQuery,
  semanticAssistThreshold: () => DEFAULT_RAG_SEMANTIC_ASSIST_THRESHOLD,
  isTechnicalQuery,
});

mountKnowledgeAuditRoutes(app, {
  pool,
  chunkTextDetailed, isTableLine, isListLine,
  CHUNK_SIZE, CHUNK_OVERLAP,
  aliasMatchedBrand,
  ensureKnowledgeChunksTable, ensureKnowledgeFilesTable,
  resolveLibraryRoot, inspectDirectoryAccess,
  getDefaultLibraryRoot: () => DEFAULT_LIBRARY_ROOT,
  resolveJoinExpr,
});

mountKnowledgeIngestRoutes(app, {
  pool,
  ingestSource, ingestMediaUrl, maybeAutoReenrich, _coerceBool,
  deriveBrandFromUrl,
  extractFileContent, htmlToText, sanitizeContent,
  UPLOAD_DIR, MAX_INDEXED_CHARS, MAX_FILE_BYTES,
  TEXT_EXT, BINARY_DOC_EXT, IMAGE_EXT, AV_EXT, VIDEO_EXT, VISIO_EXT,
  INDEXABLE_EXT, FTS_INPUT_CHAR_LIMIT,
  resolveLibraryRoot, canonicalizeKnowledgeRoot, purgeKnowledgeRoot,
  ensureKnowledgeFilesTable, walkDir, normalizeAccessLevel,
  resolveFileAccessLevel, isTsVectorOverflowError, rebuildChunksForFile,
  enqueueWrite, startWatchingRoot,
});

// --- Model Identities (avatar mühürleme) -----------------------------------
// ensureModelIdentitiesTable → lib/schema-identity.mjs (Block E.2 Tur 5).
void migrateReady.then(ensureModelIdentitiesTable).catch(() => {});

// /api/model-identities/* moved to lib/routes/models.mjs (B-1 / Tur 1.2).
// The migrateReady→ensureModelIdentitiesTable hook above stays here because
// `ensureModelIdentitiesTable` is declared in this file.

// --- Database Ops · live PG inventory + load metrics -----------------------
// Sources: pg_stat_user_tables (row counts), pg_total_relation_size (disk),
// pg_stat_activity (active connections), pg_stat_database (xact + cache).
// /api/database/stats → lib/routes/capabilities-runs.mjs (Tur 3, 2026-05-30)

// --- Workflow persistence (live JSON graph) --------------------------------
// Workflows CRUD extracted to lib/routes/workflows.mjs (T-2b, 2026-05-30).
// Forge action library (helpers + endpoints) extracted to lib/routes/forge.mjs (T-2c, 2026-05-30).
mountForgeRoutes(app, { pool, resolveActorContext });
mountMetaForgeRoutes(app, { pool, resolveActorContext, hydrateAllowedAgentsFromDb });


// SYSTEM_ACTIONS + SYS_DISK_TOOLS extracted to lib/registry/system-actions.mjs
// (Tur 2, 2026-05-30). Pure const data; consumed by createKnowledgeMaintenance below.

// cleanupKnowledgeGhosts + syncCanonicalLibraryPaths + seedForgeLibrary →
// lib/knowledge/maintenance.mjs (Tur B, 2026-05-30). Init AFTER SYSTEM_ACTIONS
// + SYS_DISK_TOOLS const block so factory deps resolve.
({
  cleanupKnowledgeGhosts,
  syncCanonicalLibraryPaths,
  seedForgeLibrary,
} = createKnowledgeMaintenance({
  pool,
  migrateReady,
  ensureKnowledgeFilesTable,
  ensureKnowledgeChunksTable,
  normalizeDirRoot,
  rootOrPathUnderRootExpr,
  purgeLegacyKnowledgeTables,
  purgeGraphOrphans,
  tableHasColumn,
  getDefaultLibraryRoot: () => DEFAULT_LIBRARY_ROOT,
  SYSTEM_ACTIONS,
  SYS_DISK_TOOLS,
  serverDirname: __dirname,
}));
seedForgeLibrary();

// Forge endpoints mounted above via mountForgeRoutes (T-2c, 2026-05-30).

// ============================================================
// Capability Packs — sectoral templates (Cyber, Healthcare, etc.)
// ============================================================
// Tur-7.1 — packs may carry default model + python interpreter; agents
// binding a pack inherit those when their own fields are blank.
// SYSTEM_PACKS + seedCapabilityPacks → lib/capabilities/packs-seed.mjs (Tur P-1, 2026-05-30)
import { seedCapabilityPacks } from "./lib/capabilities/packs-seed.mjs";
seedCapabilityPacks({ pool, migrateReady, projectRoot: __dirname });

mountCapabilityRoutes(app, {
  pool,
  requireSession,
  resolveActorContext,
  listCapabilities,
  syncCapabilitiesFromSources,
  invalidatePackFilterCache,
  scanToolsDir, defaultToolsRoots,
  scanSkillsDir, defaultSkillsRoots,
  scanAgentsDir, defaultAgentsRoots,
  repoRoot: path.resolve(__dirname, ".."),
});

// /api/dispatch/dry-run + /api/runs + /api/mlx-queue/* + /api/capability-packs
// + /api/user-capabilities/* → lib/routes/capabilities-runs.mjs (Tur 3, 2026-05-30)
mountCapabilitiesRunsRoutes(app, {
  pool, requireSession, dispatchUserTurn, finishRun,
  mlxQueue, MLX_TRANSPORT,
  getMlxWarmState: () => _MLX_WARM_STATE,
  getRagSettings: () => RAG_SETTINGS,
  enqueueWrite,
});

// =============================================================================
// Faz 5 — Tool Adapter / Policy endpoints
// =============================================================================
mountToolRoutes(app, {
  pool,
  requireSession,
  rlInvoke,
  invokeTool,
  listPendingApprovals,
  decideApproval,
  ApprovalRequired,
  ToolPolicyError,
  isLoopback,
  getAgentManifest,
  reloadManifests,
});

// Workflow DAG run + workflow-runs endpoints extracted to lib/routes/workflows.mjs (T-2b, 2026-05-30).

// /api/capability-packs + /api/user-capabilities/* mounted above via mountCapabilitiesRunsRoutes (Tur 3, 2026-05-30)

// Mustache-lite template: {{ctx.foo}} / {{params.bar}}
function tmpl(str, scope) {
  if (typeof str !== "string") return str;
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const parts = path.split(".");
    let v = scope;
    for (const p of parts) { v = v?.[p]; if (v == null) return ""; }
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

// execNodeWithAction → lib/agents/runtime.mjs (Tur C)

// Workflow trigger extracted to lib/routes/workflows.mjs (T-2b, 2026-05-30).

// Workflow chains (orchestration layer) extracted to lib/routes/workflows.mjs (T-2b, 2026-05-30).

// --- Encrypted secrets vault (AES-256-GCM) ---------------------------------
const VAULT_KEY = scryptSync(process.env.VAULT_PASSPHRASE ?? "sovereign-default-passphrase", "sovereign-salt", 32);
function encryptSecret(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", VAULT_KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return { ciphertext: enc.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64") };
}
function decryptSecret(ct, iv, tag) {
  const d = createDecipheriv("aes-256-gcm", VAULT_KEY, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}
// Vault routes (POST/GET/DELETE /api/vault*, /api/vault-audit*) → lib/routes/vault.mjs (Tur 1.3).
// vaultAudit helper geri döner — diğer modüller (varsa) kullanabilsin diye.
const { vaultAudit } = mountVaultRoutes(app, {
  pool, enqueueWrite, requireSession, redactDeep,
  putSecretV2, getSecretAllFields, listSecretFieldNames, VAULT_KIND_FIELDS,
  verifyAuditChain, rebuildAuditChain,
});
void vaultAudit;

// --- Agents (Command Center) -----------------------------------------------
const AGENT_BRIDGE_TIMEOUT_MS = Number(process.env.AGENT_BRIDGE_TIMEOUT_MS || 2000);
const AGENT_RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS || 60_000);
// Agent discovery: brand-derived defaults + repo agents/ dir; AGENT_DISCOVERY_ROOTS env wins.
const _brandSlug = safeSlug(brandSync().short_name || brandSync().app_name || "ai");
// Repo'daki agents/ kökü (NetSec, SocialMedia vb. squad'ları barındırır).
// __dirname = local-server/, bir üst dizine çık.
const _repoAgentsDir = path.resolve(__dirname, "..", "agents");
const AGENT_DISCOVERY_ROOTS = (process.env.AGENT_DISCOVERY_ROOTS || [
  _repoAgentsDir,
  `${os.homedir()}/Documents/${_brandSlug}/Agents`,
  `${os.homedir()}/Agents`,
  `${os.homedir()}/Documents/Agents`,
].join(":")).split(":").filter(Boolean);
const AGENT_INTERPRETER_HINTS = (process.env.AGENT_INTERPRETERS || [
  `${os.homedir()}/Documents/${_brandSlug}/.venv/bin/python`,
  `${os.homedir()}/.venvs/vllm/bin/python`,
  `${os.homedir()}/miniconda3/bin/python`,
  `${os.homedir()}/anaconda3/bin/python`,
  "/opt/homebrew/bin/python3",
  "/usr/local/bin/python3",
  "/usr/bin/python3",
  "/usr/bin/python",
].join(":")).split(":").filter(Boolean);

// normalizeAgentRow → lib/agents/runtime.mjs (Tur C)

// Tur-3b — Agent squads table (operator-managed groups, lazy-created on first
// touch). Disk-derived squads (NetSec, SocialMedia, ...) are upserted by the
// seeder with sort_order=DISK_SQUAD_SORT and are protected from deletion;
// operator-created squads default to sort_order=100.
const DISK_SQUAD_SORT = 10;
import { initAgentsSchema } from "./lib/schema-agents.mjs";
const { ensureAgentSquadsTable } = initAgentsSchema({ pool });

// Agent discovery/seed/squads/browse/interpreters/validate/runs/run-history/cancel
// routes are mounted from lib/routes/agents-extra.mjs (Tur 2C-α, 2026-05-30).
mountAgentsExtraRoutes(app, {
  pool,
  AGENT_DISCOVERY_ROOTS,
  _repoAgentsDir,
  resolveActor,
  hydrateAllowedAgentsFromDb,
  ensureAgentSquadsTable,
  DISK_SQUAD_SORT,
  normalizeAgentRow,
  execAsync,
  AGENT_INTERPRETER_HINTS,
  brandSync,
  _brandSlug,
  listAgentRuns,
  liveCountsByAgent,
  cancelAgentRun,
  cancelAllRunsForAgent,
});

// Seed agents tablosunu repo `agents/` ağacından doldur.
// Her squad alt klasörü (NetSec/, SocialMedia/, ...) bir squad sayılır;
// içindeki her .py dosyası bir ajan satırı olarak upsert edilir.
// Idempotent: mevcut satırların meta.systemPrompt'u, inference, model gibi
// operatör tarafından düzenlenen alanları KORUNUR — sadece agent_path,
// meta.script, meta.squad, meta.agentPath yenilenir.
// İskelet ajanları (_shared, __init__, bridge_service vs.) atlanır.

// ============= Tur-3b — Agent squad CRUD (operator-managed groups) =============
// List effective squads = union(agent_squads table, distinct effective squads on agents).

// Browse a real filesystem directory on the host. Returns directory entries
// with separated folders / scripts so the UI can render a Finder-like picker.
// Defaults to the user's home directory; supports ~ expansion.

// List candidate Python interpreters on the host (legacy hints + primary).

// Probe a manually-entered Python executable path. Returns version banner.
mountPythonRoutes({ app, pool, execAsync });

// Validate that a script (and optionally its interpreter) exists and is runnable.

// ---------------------------------------------------------------------------
// Telemetry probes — universal connector for HTTP/HTTPS/TCP/PING/REST-AUTH
// ---------------------------------------------------------------------------
// Loopback HTTPS probe'ları için: dev-tls-proxy self-signed cert kullanıyor.
// Tarayıcı reddediyordu, server-side probe da Node fetch ile reddediyordu →
// Health/Health Deep/MLX Queue gibi pinler "down" görünüyordu. Loopback'te
// rejectUnauthorized:false güvenli (127.0.0.1 / localhost yalnız).
const INSECURE_LOOPBACK_AGENT = new UndiciAgent({
  connect: { rejectUnauthorized: false },
});
// 2026-05-20 — `lima.local` / `*.local` (mDNS) ve makinenin kendi LAN IP'lerini
// de loopback say. Tarayıcı `https://lima.local:10443` üzerinden açıldığında
// server-side probe self-signed cert reddini bypass etmeli.
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);
try {
  const h = os.hostname().toLowerCase();
  LOCAL_HOSTNAMES.add(h);
  if (!h.endsWith(".local")) LOCAL_HOSTNAMES.add(`${h}.local`);
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces || {})) {
    for (const i of list || []) {
      if (i?.address) LOCAL_HOSTNAMES.add(String(i.address).toLowerCase());
    }
  }
} catch { /* best-effort */ }
function isLoopbackHttps(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (LOCAL_HOSTNAMES.has(host)) return true;
    // mDNS — herhangi bir *.local adı loopback kabul edilir (LAN cert reddi yok).
    if (host.endsWith(".local")) return true;
    return false;
  } catch { return false; }
}
// /api/telemetry/* + probeHttp/Tcp/Ping extracted to lib/routes/telemetry.mjs
// (Tur 3, 2026-05-30). isLoopbackHttps lives inside the module (sole caller).
mountTelemetryRoutes(app, {
  pool, resolveActorContext, buildVisibility,
  INSECURE_LOOPBACK_AGENT,
});

// -------------------------------------------------------------------------
// Live agent run registry — UI uses this to show Stop buttons + sync state
// with Command Center. Spawn-based runs register in agent-runs.mjs; this
// pair (list + cancel) is the only public surface needed.
// -------------------------------------------------------------------------

// Persistent agent run history (post-exit). Merged with /api/agents/runs in UI.
// Pack scope returns BOTH the agent runs bound to the pack AND the tool-call
// invocations for the pack's tools (capability_packs.action_ids) — so a pack's
// Run History reflects every activity its capabilities produced, not just
// agents explicitly bound to it via the N-N table.

// /api/agents/:id/run mounted from lib/routes/agent-run.mjs (Tur 2C-β, 2026-05-30).
mountAgentRunRoute(app, {
  pool,
  coerceParams,
  getSecretsForScope,
  vaultAuditRuntime,
  buildFieldBindingEnvForAgent,
  buildAgentRagContext,
  spawnAgentRun,
  recordAgentRunFinish,
  buildAgentEnv,
  buildBrainEnv,
  buildAgentToolsEnv,
  cancelAgentRun,
  classifyAgentError,
  agentErrorMessage,
  getRagSettings: () => RAG_SETTINGS,
  isUuid,
  enqueueWrite,
  hydrateAllowedAgentsFromDb,
  AGENT_RUN_TIMEOUT_MS,
});

async function probeAgentHealth(baseUrl, healthPath) {
  const clean = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!clean) return { ok: true, skipped: true, message: "no bridge configured · local registry only" };
  const hp = `/${String(healthPath || "/health").replace(/^\/+/, "")}`;
  const url = `${clean}${hp}`;
  try {
    const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(AGENT_BRIDGE_TIMEOUT_MS) });
    if (!r.ok) return { ok: false, message: `health ${r.status} ${r.statusText} @ ${url}` };
    return { ok: true, message: `health ${r.status} @ ${hp}` };
  } catch (e) {
    return { ok: false, message: `unreachable @ ${url} · ${String(e.message || e)}` };
  }
}

async function setAgentArmedState(id, targetActive) {
  const { rows } = await pool.query("SELECT status, bridge_url, meta FROM agents WHERE id=$1", [id]);
  if (!rows.length) return { httpStatus: 404, body: { ok: false, error: `agent ${id} not found` } };
  if (targetActive) {
    const meta = rows[0]?.meta && typeof rows[0].meta === "object" ? rows[0].meta : {};
    const bridge = await probeAgentHealth(rows[0]?.bridge_url, meta.healthPath);
    // If a bridge URL is configured but health failed → DO NOT flip to active.
    if (!bridge.ok && !bridge.skipped) {
      await pool.query("UPDATE agents SET status='error', updated_at=now() WHERE id=$1", [id]);
      return { httpStatus: 200, body: { ok: false, id, status: "error", bridge, signal: false } };
    }
    const hasLiveSignal = bridge.ok && !bridge.skipped;
    await pool.query(
      "UPDATE agents SET status='active', last_active=CASE WHEN $2::boolean THEN now() ELSE last_active END, updated_at=now() WHERE id=$1",
      [id, hasLiveSignal]
    );
    // Arm contract: refresh runtime allow-list so the Orchestrator Bridge
    // surfaces this agent without waiting for the next boot hydrate.
    try { await hydrateAllowedAgentsFromDb(); } catch { /* ignore */ }
    return { httpStatus: 200, body: { ok: true, id, status: "active", bridge, signal: hasLiveSignal, allowedListSize: getAllowedAgents().length } };
  }
  await pool.query("UPDATE agents SET status='idle', updated_at=now() WHERE id=$1", [id]);
  // Disarm contract: kill in-flight runs + drop from runtime allow-list so the
  // System Engine / Orchestrator Bridge stops surfacing this agent until armed.
  try { cancelAllRunsForAgent(id); } catch { /* ignore */ }
  try { await hydrateAllowedAgentsFromDb(); } catch { /* ignore */ }
  return { httpStatus: 200, body: { ok: true, id, status: "idle", bridge: { ok: true, skipped: true, message: "local registry deactivated" }, signal: false, allowedListSize: getAllowedAgents().length } };
}

// Tur-5 (revize) helpers — multi-pack binding read/write.
async function readAgentCapabilityPacks(agentId) {
  try {
    const { rows } = await pool.query(
      `SELECT pack_id FROM agent_capability_packs WHERE agent_id=$1 ORDER BY pack_id`,
      [agentId],
    );
    return rows.map((r) => String(r.pack_id));
  } catch { return []; }
}
// syncAgentCapabilityPacks → lib/agents/runtime.mjs (Tur C)

mountAgentsCrudRoutes(app, {
  pool,
  resolveActorContext,
  resolveActor,
  buildVisibility,
  normalizeAgentRow: (r) => normalizeAgentRow(r),
  createPrefixedId,
  encryptSecret,
  setAgentArmedState,
  syncAgentCapabilityPacks: (...a) => syncAgentCapabilityPacks(...a),
  readAgentCapabilityPacks,
  invalidateAgentBrandCache,
});

mountMcpRoutes(app, { pool, requireSession, port: PORT });

// ============================================================
// Tur-2 — Adapter Registry CRUD (/api/adapters)
// `tools` tablosu üstünde dönen, connection_type'a göre dinamik UI
// için zenginleştirilmiş kayıt CRUD'u. Plaintext credential ASLA
// burada tutulmaz — credential'lar Vault'tan field-aware bind edilir
// (vault_binding_spec sadece "hangi field hangi env alias'a gider"
// şablonunu tutar, değer tutmaz).
// ============================================================
const ADAPTER_CATEGORIES   = new Set(["cloud","network","social","content","ai","db","shell","custom"]);
const CONNECTION_TYPES     = new Set([
  "ssh","http_basic","rest_token","rest_apikey","checkpoint_smc","soap",
  "shell","webhook","graphql","rss","smtp","oauth2","custom",
]);
const RUNNER_ADAPTERS      = new Set(["http","python","mcp","forge","shell","builtin"]);
const RISK_LEVELS          = new Set(["low","medium","high","critical"]);

function sanitizeAdapterBody(body = {}) {
  const name = String(body.name || "").trim().slice(0, 200);
  if (!name) throw new Error("name required");
  const adapter = RUNNER_ADAPTERS.has(body.adapter) ? body.adapter : "http";
  const category = ADAPTER_CATEGORIES.has(body.category) ? body.category : "custom";
  const connection_type = CONNECTION_TYPES.has(body.connection_type) ? body.connection_type : "custom";
  const risk_level = RISK_LEVELS.has(body.risk_level) ? body.risk_level : "low";
  const requires_approval = !!body.requires_approval || risk_level === "high" || risk_level === "critical";
  const config = (body.config && typeof body.config === "object") ? body.config : {};
  const vault_binding_spec = Array.isArray(body.vault_binding_spec) ? body.vault_binding_spec : [];
  const tags = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [];
  const description = String(body.description || "").slice(0, 1000);
  const enabled = body.enabled === false ? false : true;
  return { name, adapter, category, connection_type, risk_level,
           requires_approval, config, vault_binding_spec, tags, description, enabled };
}

// --- Adapter dictionaries (category/connection/runner) CRUD ---------------
// /api/adapter-dictionaries → lib/routes/adapter-dictionaries.mjs
initAdapterDictionaries({ pool });
mountAdapterDictionariesRoutes({ app });

mountAdaptersRoutes({ app, pool, sanitizeAdapterBody });

// ============================================================
// Tur-2 — Agent bindings (RAG + Vault field-aware credentials)
// ============================================================
mountAgentBindingsRoutes(app, { pool });

// --- Backend health for circuit breaker (3001 = python agent host) ---------
// /api/bridge/health → lib/routes/agents-templates.mjs (Tur 4, 2026-05-30)

// ============================================================
// Sovereign identity — local users / groups / RBAC / sessions
// All credentials live in PostgreSQL on the Mac Studio. Never cloud.
// ============================================================
function hashPassword(plain, salt) {
  const s = salt ?? randomBytes(16).toString("hex");
  const h = scryptSync(String(plain ?? ""), s, 64).toString("hex");
  return { hash: h, salt: s };
}
function verifyPassword(plain, hashHex, salt) {
  if (!hashHex || !salt) return false;
  const calc = scryptSync(String(plain ?? ""), salt, 64);
  const stored = Buffer.from(hashHex, "hex");
  return calc.length === stored.length && timingSafeEqual(calc, stored);
}
function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, email: r.email, phone: r.phone,
    provider: r.provider, role: r.role, groups: r.groups ?? [],
    templateId: r.template_id ?? undefined,
    status: r.status,
    validUntil: r.valid_until ? new Date(r.valid_until).toISOString() : undefined,
    mustChangePassword: r.must_change_password,
    avatarUrl: r.avatar_url ?? undefined,
    allowedProviders: Array.isArray(r.allowed_providers) ? r.allowed_providers : (r.allowed_providers ? JSON.parse(r.allowed_providers) : []),
    canOverrideProvider: r.can_override_provider !== false,
     allowedAgents: Array.isArray(r.allowed_agents) ? r.allowed_agents : (r.allowed_agents ? JSON.parse(r.allowed_agents) : []),
    allowedTools: Array.isArray(r.allowed_tools) ? r.allowed_tools : (r.allowed_tools ? JSON.parse(r.allowed_tools) : []),
    allowedSkills: Array.isArray(r.allowed_skills) ? r.allowed_skills : (r.allowed_skills ? JSON.parse(r.allowed_skills) : []),
    createdAt: new Date(r.created_at).toISOString(),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : undefined,
  };
}

// Seed bootstrap admin/groups on every boot so PostgreSQL identity never drifts empty.
// 5 agents/skills fonksiyonu → lib/agents/runtime.mjs (Tur C, 2026-05-30).
// Init burada (hashPassword decl'inden sonra, seedIdentity çağrı satırından önce).
// liveRuns const TDZ olduğu için getter ile geçilir; runSkill çağrısı 8195'te.
({
  execNodeWithAction,
  normalizeAgentRow,
  syncAgentCapabilityPacks,
  seedIdentity,
  runSkill,
} = createAgentRuntime({
  pool,
  getRagSettings: () => RAG_SETTINGS,
  PORT,
  coerceParams,
  registerSyntheticRun,
  buildAgentEnvForScript,
  runDiskScript,
  classifyAgentError,
  agentErrorMessage,
  tmpl,
  enqueueWrite,
  evalChainCondition: typeof evalChainCondition === 'function' ? evalChainCondition : undefined,
  invalidatePackFilterCache,
  hashPassword,
  getLiveRuns: () => liveRuns,
  runEvent,
  startMetricsLoop,
  stopMetricsLoop,
  executeSkillScript,
  broadcastAudit,
}));
void migrateReady.then(seedIdentity).then(() => autoLinkLegacyOwnership({ migrateReady }));
void migrateReady.then(() => startSiemConfigSync(pool));

// ---------- Identity (users/groups/rbac/auth-providers/login/sessions) ----------
// Moved to lib/routes/identity.mjs (B-1 / Tur 1.1, 2026-05-30).
mountIdentityRoutes({
  app, pool,
  hashPassword, verifyPassword, randomBytes,
  createPrefixedId, createLocalId,
  rowToUser, providerPolicyCacheDeleteUser,
  isAdminCaller, rlLogin, enqueueWrite,
  encryptSecret, decryptSecret,
  authenticateLdap, authenticateRadius,
});

// ---------- Admin helper — Faz 2: tek gerçeklik = req.session.role ----------
// `x-user-role` başlığı artık güven kaynağı değil. attachSessionContext()
// session'ı zaten DB ile doğrulayıp rolü `app_users`'tan getiriyor; burada
// sadece okuyup karar veriyoruz. Header'a güvenen eski yollar kapandı.
async function isAdminCaller(req) {
  return isAdminFromSession(req);
}

// ---------- SIEM (real syslog forwarder) ----------
// /api/siem/* → lib/routes/agents-templates.mjs (Tur 4, 2026-05-30)

// Resolves the actor (req.actor → app_users.id). Returns null for anon.
async function resolveActorId(req) {
  if (!req.actor) return null;
  try {
    const r = await pool.query("SELECT id FROM app_users WHERE lower(username)=lower($1) LIMIT 1", [req.actor]);
    return r.rows[0]?.id ?? null;
  } catch { return null; }
}

// /api/me/prefs → lib/routes/agents-templates.mjs (Tur 4, 2026-05-30)

// ============================================================
// Hybrid AI providers (Gemini, Tavily, OpenAI, Serper, …)
// ============================================================
function encField(v) {
  if (!v) return { ct: "", iv: "", tag: "" };
  const e = encryptSecret(v);
  return { ct: e.ciphertext, iv: e.iv, tag: e.tag };
}
function decField(ct, iv, tag) {
  if (!ct) return "";
  try { return decryptSecret(ct, iv, tag); } catch { return ""; }
}
function maskKey(s) {
  if (!s) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return s.slice(0, 4) + "•".repeat(Math.max(4, s.length - 8)) + s.slice(-4);
}
function rowToProvider(r, { reveal = false } = {}) {
  const key = decField(r.api_key_ct, r.api_key_iv, r.api_key_tag);
  return {
    id: r.id, providerName: r.provider_name, kind: r.kind,
    apiKey: reveal ? key : maskKey(key),
    hasKey: !!key,
    baseUrl: r.base_url, model: r.model,
    isActive: r.is_active, priority: r.priority,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

// /api/providers/* CRUD + usage aggregates + connectivity ping extracted
// 2026-05-30 → lib/routes/providers.mjs. Helpers (encField/decField/
// maskKey/rowToProvider) kept in server.mjs because vision/agent-bridge
// callers reference decField/recordUsage directly.
mountProvidersRoutes({
  app,
  pool,
  createPrefixedId,
  encField,
  decField,
  rowToProvider,
});

// ---- Usage ledger / aggregates ------------------------------------
function approxTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.round(String(text).length / 4));
}
function recordUsage({ providerId, providerName, kind, model, threadId, promptTokens, responseTokens, latencyMs, status }) {
  enqueueWrite(
    `INSERT INTO provider_usage(provider_id, provider_name, kind, model, thread_id,
       prompt_tokens, response_tokens, total_tokens, latency_ms, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [providerId ?? null, providerName, kind, model ?? "", threadId ?? null,
     promptTokens|0, responseTokens|0, (promptTokens|0)+(responseTokens|0),
     latencyMs|0, status ?? "ok"]
  );
}

async function getActiveProvider(kind) {
  const { rows } = await pool.query(
    "SELECT * FROM ai_providers WHERE kind=$1 AND is_active=true ORDER BY priority ASC LIMIT 1",
    [kind]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return { ...r, apiKey: decField(r.api_key_ct, r.api_key_iv, r.api_key_tag) };
}
async function getActiveProviders(kind) {
  const { rows } = await pool.query(
    "SELECT * FROM ai_providers WHERE kind=$1 AND is_active=true ORDER BY priority ASC, provider_name ASC",
    [kind]
  );
  return rows.map(r => ({ ...r, apiKey: decField(r.api_key_ct, r.api_key_iv, r.api_key_tag) }));
}
async function getProviderById(id) {
  const { rows } = await pool.query("SELECT * FROM ai_providers WHERE id=$1", [id]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { ...r, apiKey: decField(r.api_key_ct, r.api_key_iv, r.api_key_tag) };
}
function detectProviderFamily(name = "", baseUrl = "") {
  const n = `${name} ${baseUrl}`.toLowerCase();
  if (/anthropic|claude/.test(n)) return "anthropic";
  if (/gemini|googleapis|generativelanguage/.test(n)) return "gemini";
  // OpenAI-compatible: openai, groq, mistral, deepseek, perplexity, openrouter, cohere(v1/chat), together, etc.
  return "openai";
}
async function* streamFromOpenAICompat({ apiKey, model, baseUrl, messages, signal }) {
  const url = `${(baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model || "gpt-4o-mini", messages, stream: true }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`provider ${r.status} ${await r.text().catch(()=> "")}`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n"); buf = frames.pop() ?? "";
    for (const f of frames) {
      const line = f.trim(); if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim(); if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const piece = j.choices?.[0]?.delta?.content || "";
        if (piece) yield piece;
      } catch {}
    }
  }
}
async function* streamFromAnthropic({ apiKey, model, baseUrl, messages, signal }) {
  const url = `${(baseUrl || "https://api.anthropic.com").replace(/\/+$/, "")}/v1/messages`;
  const sys = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
  const msgs = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "assistant" : "user", content: m.content,
  }));
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: model || "claude-3-5-sonnet-latest", max_tokens: 4096, system: sys || undefined, messages: msgs, stream: true }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`anthropic ${r.status} ${await r.text().catch(()=> "")}`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n"); buf = frames.pop() ?? "";
    for (const f of frames) {
      const line = f.trim(); if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        const piece = j.delta?.text || j.content_block?.text || "";
        if (piece) yield piece;
      } catch {}
    }
  }
}
async function streamFromProvider({ provider, messages, signal }) {
  const fam = detectProviderFamily(provider.provider_name, provider.base_url);
  if (fam === "gemini") return streamFromGemini({ apiKey: provider.apiKey, model: provider.model, baseUrl: provider.base_url, messages, signal });
  if (fam === "anthropic") return streamFromAnthropic({ apiKey: provider.apiKey, model: provider.model, baseUrl: provider.base_url, messages, signal });
  return streamFromOpenAICompat({ apiKey: provider.apiKey, model: provider.model, baseUrl: provider.base_url, messages, signal });
}

// ----- Routing policy stored in app_settings -------------------------------
async function getRoutingPolicy() {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='ai.routing'").catch(()=>({rows:[]}));
  const v = rows[0]?.value || {};
  return { mode: v.mode || "failover", rules: Array.isArray(v.rules) ? v.rules : [] };
}
function pickByRouter(providers, lastUserText, rules) {
  const text = String(lastUserText || "").toLowerCase();
  for (const r of rules) {
    if (!r?.match || !r?.providerId) continue;
    try { if (new RegExp(r.match, "i").test(text)) {
      const hit = providers.find(p => p.id === r.providerId); if (hit) return hit;
    } } catch {}
  }
  return providers[0] || null;
}
async function pickProviderForRequest({ providerId, lastUserText, allowedIds = null }) {
  if (providerId) return await getProviderById(providerId);
  let list = await getActiveProviders("llm");
  if (allowedIds && allowedIds.length) list = list.filter(p => allowedIds.includes(p.id));
  if (!list.length) return null;
  const pol = await getRoutingPolicy();
  if (pol.mode === "router") return pickByRouter(list, lastUserText, pol.rules);
  return list[0]; // failover/manual default = highest priority
}

// Generic app_settings KV
// /api/app-settings/:key → lib/routes/agents-templates.mjs (Tur 4, 2026-05-30)

// ============================================================
// Smart orchestrator — DeepDive (Gemini) / WebSearch / Local
// Extracted 2026-05-30 → lib/providers/gemini-web.mjs
// ============================================================
initGeminiWeb({ pool, getActiveProvider: (kind) => getActiveProvider(kind) });

// Provider policy cache — kills the 500ms `prep.provider_policy.timeout`
// on hot path. TTL 5dk, invalidated by user/template write paths.
// Extracted 2026-05-30 → lib/providers/policy-cache.mjs
initProviderPolicyCache({ pool });

// =============================================================================
// MESSAGING WEBHOOKS → lib/routes/webhooks.mjs (extracted 2026-05-30)
// =============================================================================
mountWebhookRoutes({ app, express, pool, extractFileContent, ingestMediaUrl, ingestSource });

// =============================================================================
// CROSS-REFERENCE ENGINE — per-source-type retrieval + side-by-side comparison
// =============================================================================
// /api/chat/cross-reference → lib/routes/agents-templates.mjs (Tur 4, 2026-05-30)

// =============================================================================
// GRAPH RAG — entity neighborhood lookup (used by orchestrator + UI)
// =============================================================================
mountGraphRoutes({ app, pool, purgeGraphOrphans, extractEntities });

// Replace original streamFromLocalLLM dispatcher: accept mode hints.
// Note: original /api/chat/stream still works for plain local; orchestrator route below.
// 2026-07-06 — Eski Capability Gap Detector hattı komple söküldü.
// Yaratma sorumluluğu Meta-Forge auto-routing'e devredildi
// (autoForgeRouting + forge_preview + forge_run_prompt akışı).


mountChatOrchestrateRoutes(app, {
  PORT, MLX_RUNTIME_PORT: Number(process.env.MLX_RUNTIME_PORT || 8001), RAG_SETTINGS, ROLE_RANK, MLX_TRANSPORT,
  getRagSettings: () => RAG_SETTINGS,

  TIMEOUT_BUDGETS,
  _brandDisplay, _makeThinkStripper, _mlxEffectiveFirstTokenMs, _mlxIsCold, _mlxRecordFirstToken,
  applyExecutionGuard, approxTokens, broadcastBridge, buildFreeAnswerMessages, chatTrace,
  classifyIntent, cosine, detectLibraryMatch, getLibraryBrands, getProviderById,
  getProviderPolicyCachedSync, getWatchdogCfg, getAgentsBaseDir, isUuid, normalizeAccessLevel, pickProviderForRequest,
  preflightMlxReset, ragProbeAndFetch, readNextWithHeartbeat, recordMlxActivity, recordUsage,
  refineIntentSemantically, resolvePolicyContext, runWebSearch, streamFromProvider, streamFromLocalLLM,
  triggerMlxZombieSelfHeal,
  sseBegin, extractToolCalls, runToolCallsForAgent, buildBrainEnv,
  buildAgentEnv, buildAgentEnvForScript, buildAgentToolsEnv,
  detectAgentIntent, classifyAgentError, agentErrorMessage,
  Planner, runLocalAgent, streamLocalAgent, finishRun, dispatchUserTurn,
  enqueueWrite, mlxQueue, pool, runtimeModel, brandSync,
  getAllowedAgents, hydrateAllowedAgentsFromDb,
});


mountChatStreamRoutes(app, {
  PORT, MLX_RUNTIME_PORT: Number(process.env.MLX_RUNTIME_PORT || 8001), RAG_SETTINGS, ROLE_RANK, MLX_TRANSPORT,
  getRagSettings: () => RAG_SETTINGS,
  TIMEOUT_BUDGETS, HEDGE_PATTERNS,
  _brandDisplay, _mlxEffectiveFirstTokenMs: _mlxEffectiveFirstTokenMs, _makeThinkStripper, _mlxRecordFirstToken,
  agentErrorMessage, applyExecutionGuard, brandSync, broadcastAudit, broadcastBridge,
  buildAgentEnvForScript, buildFreeAnswerMessages, chatTrace, classifyAgentError, classifyIntent,
  detectAgentIntent, detectLibraryMatch, enqueueWrite, extractToolCalls, flushModelKvCache,
  getLibraryBrands, logCheckpoint, mlxQueue, normalizeAccessLevel, pool, pushLog,
  ragProbeAndFetch, recordChatSample, recordMlxActivity, refineIntentSemantically,
  registerSyntheticRun, runLocalAgent, streamLocalAgent, runToolCallsForAgent, runtimeBase, runtimeModel,
  sseBegin, streamFromLocalLLM, triggerMlxZombieSelfHeal, getAllowedAgents, hydrateAllowedAgentsFromDb,
});


// ============================================================
// Agent Factory — local Python/CLI agents
// ============================================================
function rowToAppAgent(r) {
  return {
    id: r.id, agentName: r.agent_name, scriptPath: r.script_path,
    bridgeUrl: r.bridge_url, role: r.role, status: r.status,
    description: r.description,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
// /api/app-agents/* → lib/routes/agents-templates.mjs (Tur 4, 2026-05-30)

// ============================================================
// Vision Service control → lib/routes/vision-service.mjs
// (helpers + status/start/stop/logs/analyze/config endpoints)
// ============================================================
initVisionService({ pool, enqueueWrite, decField });
mountVisionServiceRoutes({ app });

// ============================================================
// Voice profiles → lib/routes/voice-profiles.mjs
// ============================================================
initVoiceProfiles({ pool, createPrefixedId });
mountVoiceProfilesRoutes({ app });

// vision/analyze + vision/config → lib/routes/vision-service.mjs (mountVisionServiceRoutes)

// ============================================================
// Premium TTS bridge — OpenAI / Google Cloud / fallback
// Returns audio/mpeg or audio/ogg buffer; client plays via <audio>.
// ============================================================
// /api/tts → lib/routes/agents-templates.mjs (Tur 4, 2026-05-30)

// ============================================================
// User Model Templates — sovereign PostgreSQL CRUD
// ============================================================
function rowToTemplate(r) {
  return {
    id: r.id, name: r.name,
    systemPrompt: r.system_prompt ?? "",
    temperature: Number(r.temperature ?? 0.4),
    topP: Number(r.top_p ?? 0.9),
    maxTokens: Number(r.max_tokens ?? 4096),
    params: Array.isArray(r.params) ? r.params : (r.params ? JSON.parse(r.params) : []),
    agents: Array.isArray(r.agents) ? r.agents : (r.agents ? JSON.parse(r.agents) : []),
    ownerEditable: !!r.owner_editable,
    allowedProviders: Array.isArray(r.allowed_providers) ? r.allowed_providers : (r.allowed_providers ? JSON.parse(r.allowed_providers) : []),
    canOverrideProvider: r.can_override_provider !== false,
    allowedTools: Array.isArray(r.allowed_tools) ? r.allowed_tools : (r.allowed_tools ? JSON.parse(r.allowed_tools) : []),
    allowedSkills: Array.isArray(r.allowed_skills) ? r.allowed_skills : (r.allowed_skills ? JSON.parse(r.allowed_skills) : []),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// /api/templates/* → lib/routes/agents-templates.mjs (Tur 4, 2026-05-30)

// /api/template-assignments → lib/routes/template-assignments.mjs
initTemplateAssignments({ pool, migrateReady, providerPolicyCacheClear });
mountTemplateAssignmentsRoutes({ app });

// ============================================================
// WebSocket /ws/live-call + HTTP/HTTPS server creation + TLS bootstrap
// → lib/live-call.mjs (T-2026-05-30).
const { httpServer, httpsServer, HTTPS_ENABLED, HTTPS_PORT, TLS_CERT_FILE } =
  await installLiveCall({ app, pool, port: PORT, __bootDir });

// Backup subsystem (FULL snapshots, pg cluster dump, restore orchestrator,
// supervisor detection, file catalog) → lib/routes/backup.mjs (Tur 1.4).
const { ensurePgVersionsCompatible, getPgClientMajor, getPgServerMajor } = mountBackupRoutes(app, {
  pool, enqueueWrite, spawnPg, initPgVersion, upload,
  UPLOAD_DIR, BACKUP_DIR, DATABASE_URL, __bootDir, startedAt,
  brandSync, safeSlug,
});
void ensurePgVersionsCompatible; void getPgClientMajor; void getPgServerMajor;

// ============================================================
// Skills Engine — sealed procedures (! triggers)
// SYSTEM_SKILLS + seedSkills → lib/skills/seed.mjs (Tur S-1)
// ============================================================
import { seedSkills } from "./lib/skills/seed.mjs";
import {
  initSkillsRuntime,
  liveRuns,
  ROLE_LEVEL,
  RISK_LEVEL,
  runEvent,
  validateAgainstSchema,
  getActorRole,
  readSkillSecrets,
  writeSkillSecrets,
  executeSkillScript,
  startMetricsLoop,
  stopMetricsLoop,
} from "./lib/skills/runtime.mjs";
initSkillsRuntime({
  pool,
  sseWrite,
  runDiskScript,
  secretsPath: path.join(__dirname, ".env.secrets"),
});
seedSkills({ pool, migrateReady });

// System Workflows seed → lib/workflows/seed.mjs (W-2 revised, 2026-06-01)
// Seeds workflows table (NOT workflow_chains); also one-time cleans up
// yesterday's mis-seeded sys.* rows from workflow_chains.
import { seedSystemWorkflows } from "./lib/workflows/seed.mjs";
seedSystemWorkflows({ pool, migrateReady });

// runSkill → lib/agents/runtime.mjs (Tur C)

// --- REST endpoints ---------------------------------------------------------
mountSkillRoutes(app, {
  pool,
  resolveActorContext,
  getActorRole,
  ROLE_LEVEL,
  RISK_LEVEL,
  readSkillSecrets,
  writeSkillSecrets,
  broadcastAudit,
  coerceParams,
  validateAgainstSchema,
  createPrefixedId,
  liveRuns,
  runSkill,
  runEvent,
  sseBegin,
});

// =============================================================================
// System Engine — Master Control cockpit endpoints
// =============================================================================
function maskUrl(u) {
  if (!u) return null;
  try { return String(u).replace(/(:\/\/)([^:]+):([^@]+)@/, "$1$2:***@"); } catch { return u; }
}
app.get("/api/system/engine", async (_req, res) => {
  const workerHealth = await probeWorkerHealth();
  res.json({
    ok: true,
    server: {
      port: PORT,
      host: HOST,
      uptime_s: Math.floor((Date.now() - startedAt) / 1000),
      uploadDir: UPLOAD_DIR,
      cors: (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
      pid: process.pid,
      node: process.version,
    },
    llm: {
      provider: RUNTIME_PROVIDER_CFG.provider,
      baseUrl: runtimeBase() || null,
      model: runtimeModel() || null,
    },
    embed: {
      model: process.env.MLX_EMBED_MODEL || null,
      baseUrl: process.env.MLX_EMBED_BASE_URL || process.env.MLX_BASE_URL || null,
      configured: !!process.env.MLX_EMBED_MODEL,
      dim: workerHealth?.dim ?? 1024,
    },
    database: {
      url: maskUrl(DATABASE_URL),
      pool: { max: pool.options?.max ?? 20, idle: pool.idleCount, total: pool.totalCount, waiting: pool.waitingCount },
    },
    worker: {
      port: EMBED_WORKER_PORT,
      status: workerStatus,
      pid: workerProc?.pid ?? null,
      uptime_s: workerProc ? Math.floor((Date.now() - workerStartedAt) / 1000) : 0,
      backend: workerHealth?.backend || null,
      model: workerHealth?.model || null,
      lastError: workerLastError,
    },
  });
});

app.get("/api/system/worker/status", async (_req, res) => {
  const workerHealth = await probeWorkerHealth();
  // /health geri dönüyorsa worker yaşıyor: status'u biz spawn etmedik bile
  // olsa "online-external" olarak senkronla — UI'da gereksiz "down" flicker
  // olmasın.
  if (workerHealth && workerStatus !== "online-auto" && workerStatus !== "online-external") {
    workerStatus = "online-external";
    workerLastError = null;
  }
  let pythonCandidates = [];
  try {
    pythonCandidates = resolvePythonCandidates().map(c => `${c.file}${c.args.length ? " " + c.args.join(" ") : ""}`);
  } catch {}
  res.json({
    status: workerStatus,
    port: EMBED_WORKER_PORT,
    pid: workerProc?.pid ?? null,
    uptime_s: workerProc ? Math.floor((Date.now() - workerStartedAt) / 1000) : 0,
    backend: workerHealth?.backend || null,
    model: workerHealth?.model || null,
    dim: workerHealth?.dim ?? null,
    healthy: !!workerHealth,
    rss_gb: workerHealth?.rss_gb ?? null,
    req_count: workerHealth?.req_count ?? null,
    max_rss_gb: workerHealth?.max_rss_gb ?? null,
    max_requests: workerHealth?.max_requests ?? null,
    respawns_in_window: _getEmbedWorkerDiag().respawnsInWindow,
    respawn_window_ms: _getEmbedWorkerDiag().respawnWindowMs,
    locked: _getEmbedWorkerDiag().locked,
    lastError: workerLastError,
    lastEmbedError: getLastEmbedError(),
    recentWorkerLogs: SYS_LOG_RING.filter((evt) => evt?.source === "worker").slice(-40),
    diag: {
      embedModel: process.env.MLX_EMBED_MODEL || null,
      baseUrl: process.env.MLX_EMBED_BASE_URL || process.env.MLX_BASE_URL || null,
      bootTimeoutSec: Math.round(Number(process.env.WORKER_BOOT_TIMEOUT_MS || 360_000) / 1000),
      healthTimeoutMs: WORKER_HEALTH_TIMEOUT_MS,
      selfHealCooldownSec: Math.round(SELF_HEAL_COOLDOWN_MS / 1000),
      lastHealAgoSec: _getEmbedWorkerDiag().lastHealAgoSec,
      pythonCandidates,
      cwd: __dirname,
      offline: { HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE, TRANSFORMERS_OFFLINE: process.env.TRANSFORMERS_OFFLINE },
    },
  });
});

// v9 — Admin-token mutabakat tanısı (token DEĞERİNİ sızdırmaz; sadece
// var/yok + uzunluk + ilk/son 4 karakter). Restart script bunu .env'den
// okuduğu değerle karşılaştırıp launchd<->.env env-drift'i ifşa ediyor.
// /api/system/diag/admin-token → lib/routes/agents-templates.mjs (Tur 4, 2026-05-30)

// /api/system/worker/start, /stop, /api/system/restart-worker
// → lib/embed-worker/runtime.mjs (Tur 3b); mountEmbedWorkerRoutes(app).

// ---------------------------------------------------------------------------
// MLX 72B chat runtime self-heal — gerçek restart (zombi slot reçetesi).
// mlx_lm.server'ın TEK generation slot'u var; client abort edince (reader.cancel)
// TCP kapanır ama server o turun üretimini max_tokens bitene kadar sürdürür →
// sonraki "selam" stuck slot'un arkasında bekler, first-token timeout (120s) yer.
// `/reset` URL'i mlx_lm.server'da gerçek bir route DEĞİL (404 döner, slot'u
// temizlemez). Tek kesin çözüm process restart: port 8001 sahibini öldür,
// launchd (com.elara.qwen72b · KeepAlive) yeniden başlatır. Opsiyonel
// MLX_RESTART_CMD verilirse o da çalıştırılır. Embed worker reçetesinin
// (`/api/system/restart-worker`) MLX karşılığı.
// ---------------------------------------------------------------------------
const MLX_RUNTIME_PORT = Number(process.env.MLX_RUNTIME_PORT || 8001);
// Resolve the *active* runtime port from the UI-managed runtime base on every
// call. Falls back to env-derived MLX_RUNTIME_PORT only when the URL has no
// explicit port. This makes "Restart Runtime" honour the operator's custom
// base set in Models → Runtime Provider.
function _activeRuntimePort() {
  try {
    const base = (typeof runtimeUpstreamBase === "function") ? runtimeUpstreamBase() : "";
    if (base) {
      const u = new URL(base);
      const p = Number(u.port || (u.protocol === "https:" ? 443 : 80));
      if (Number.isFinite(p) && p > 0) return p;
    }
  } catch {}
  return MLX_RUNTIME_PORT;
}
// /api/system/restart-mlx + /restart-runtime + /mlx-sockets moved to
// lib/routes/system-mlx.mjs (Tur 2.2). Mount happens below near other route modules.
mountSystemMlxRoutes(app, {
  listPortPids,
  listPortSockets,
  summarizeSocketStates,
  killPortOwnerAndWait,
  mlxQueue,
  resetMlxKeepAliveAgent,
  restartLocalLlmRuntime,
  MLX_TRANSPORT,
  runtimeUpstreamBase,
  runtimeModel,
  pushLog,
});

// /api/system/logs/stream + all Tur 4 routes → lib/routes/agents-templates.mjs (2026-05-30)
mountAgentsTemplatesRoutes(app, {
  pool, migrateReady,
  hydrateRuntimeProviderFromDb, runtimeUpstreamBase, runtimeBase, runtimeIsMlx, joinRuntimePath,
  isAdminCaller, siem, enqueueWrite,
  resolveActorId,
  _buildFtsOrQuery,
  resolveActorContext, buildVisibility, createPrefixedId, resolveActor, rowToAppAgent,
  rowToTemplate, providerPolicyCacheClear,
  sseBegin, SYS_LOG_RING, SYS_LOG_SUBS,
});

// Port self-heal — lib/port-util.mjs'e taşındı (Block E.2 Tur 3).
import { ensurePortFree } from "./lib/port-util.mjs";
ensurePortFree(PORT);
if (HTTPS_ENABLED) ensurePortFree(HTTPS_PORT);

// 2026-05-29 — Config-driven timeout hiyerarşisi (queue-config.mjs TIMEOUT_BUDGETS).
// RAG_SETTINGS.httpSocketTimeoutMs UI canlı override eder; boş → TIMEOUT_BUDGETS fallback.
const _httpSocketMs = Math.max(10_000, Number(RAG_SETTINGS?.httpSocketTimeoutMs) || TIMEOUT_BUDGETS.HTTP_SOCKET_MS);
httpServer.timeout        = _httpSocketMs;
httpServer.requestTimeout = TIMEOUT_BUDGETS.HTTP_REQUEST_MS;
httpServer.headersTimeout = TIMEOUT_BUDGETS.HTTP_HEADERS_MS;
httpServer.keepAliveTimeout = TIMEOUT_BUDGETS.HTTP_KEEPALIVE_MS;
if (httpsServer) {
  httpsServer.timeout        = _httpSocketMs;
  httpsServer.requestTimeout = TIMEOUT_BUDGETS.HTTP_REQUEST_MS;
  httpsServer.headersTimeout = TIMEOUT_BUDGETS.HTTP_HEADERS_MS;
  httpsServer.keepAliveTimeout = TIMEOUT_BUDGETS.HTTP_KEEPALIVE_MS;
}

// Mount workflow routes (T-2b, 2026-05-30). Deferred to after all deps defined.
mountWorkflowRoutes(app, {
  pool,
  requireSession,
  enqueueWrite,
  execNodeWithAction,
  startWorkflowRun,
  resumeWorkflowRun,
  cancelWorkflowRun,
  getRunSteps,
  createPrefixedId,
  liveRuns,
  executeSkillScript,
  coerceParams,
  validateAgainstSchema,
});
assertTimeoutHierarchy({
  httpSocketTimeoutMs: RAG_SETTINGS?.httpSocketTimeoutMs,
  mlxStreamTotalMs:    RAG_SETTINGS?.mlxStreamTotalMs,
  mlxQueueWaitMs:      RAG_SETTINGS?.mlxQueueWaitMs,
});

httpServer.listen({ port: PORT, host: HOST }, () => {
  console.log(`[middleware] listening on ${HOST}:${PORT} — uploads at ${UPLOAD_DIR}`);
  console.log(`[middleware] loopback: http://127.0.0.1:${PORT}`);
  console.log(`[middleware] WebSocket: ws://127.0.0.1:${PORT}/ws/live-call`);
  if (httpsServer) {
    httpsServer.listen({ port: HTTPS_PORT, host: HOST }, () => {
      console.log(`[middleware] HTTPS    : https://127.0.0.1:${HTTPS_PORT} (cert: ${TLS_CERT_FILE})`);
      console.log(`[middleware] WSS      : wss://127.0.0.1:${HTTPS_PORT}/ws/live-call`);
    });
  }
  console.log(`[boot] db=elara_db · port ${PORT} (HTTP) · port ${HTTPS_PORT} (HTTPS ${httpsServer ? "aktif" : "pasif"}) · TLS=${path.basename(TLS_CERT_FILE)}`);
  // FAZ 25 — Agent Bridge boot self-check (tek seferlik log)
  try {
    const dir = process.env.ELARA_AGENTS_DIR || "";
    if (!dir) {
      pushLog("agent-bridge", `disabled · ELARA_AGENTS_DIR unset`);
    } else if (!fs.existsSync(dir)) {
      pushLog("agent-bridge", `disabled · dir not found · ${dir}`);
    } else {
      const allowed = getAllowedAgents();
      pushLog("agent-bridge", `ready · dir=${dir} · allowed=${allowed.length} · python=${process.env.ELARA_AGENTS_PYTHON || "python3"}`);
    }
  } catch (e) { pushLog("agent-bridge", `selfcheck-error · ${String(e?.message || e).slice(0, 200)}`); }
  // Knowledge tabloları DDL'ini boot'ta ısıt (eski davranış).
  Promise.all([
    ensureKnowledgeFilesTable().catch((e) => console.warn("[boot] ensureKnowledgeFilesTable:", e?.message || e)),
    ensureKnowledgeChunksTable().catch((e) => console.warn("[boot] ensureKnowledgeChunksTable:", e?.message || e)),
    ensureAdapterDictionariesSeed().catch((e) => console.warn("[boot] ensureAdapterDictionariesSeed:", e?.message || e)),
  ]).then(() => console.log("[boot] knowledge + adapter-dict schema ready"));

  startServiceWatchdog();
  // Embedding worker artık boot'ta uyandırılmıyor — sadece RAG path'i veya
  // knowledge ingest gerçekten istediğinde lazy-spawn ediliyor (mlxEmbed →
  // ensureWorker). MLX chat runtime warmup'ı da bypass'ı geciktirmesin diye
  // boot'ta çağrılmıyor; ilk gerçek istek modeli zaten ısıtır.
  // v17: Boot warmup default KAPALI. 72B modeli middleware testinde otomatik
  // uyanıp unified memory'i 95GB'a vurdurmasın. İstenirse LLM_BOOT_WARMUP_ENABLED=1.
  // 2026-06-02: UI knob (RAG_SETTINGS.mlxBootWarmup) explicit false ise env'i
  // ezer — operatör UI'dan kapatınca restart'ta tekrar açılmasın.
  let _bootWarmupEnabled = String(process.env.LLM_BOOT_WARMUP_ENABLED ?? "0") === "1";
  try {
    if (typeof RAG_SETTINGS !== "undefined" && RAG_SETTINGS?.mlxBootWarmup === false) {
      _bootWarmupEnabled = false;
    } else if (typeof RAG_SETTINGS !== "undefined" && RAG_SETTINGS?.mlxBootWarmup === true) {
      _bootWarmupEnabled = true;
    }
  } catch { /* RAG_SETTINGS hazır değilse env'e güven */ }
  if (_bootWarmupEnabled) {
    setTimeout(() => { warmLocalChatModel("boot").catch(() => {}); }, 1500).unref?.();
  } else {
    console.log("[boot] LLM boot warmup disabled (UI knob / env)");
  }
  // Embed worker warm-up: ilk knowledge sorgusu cold-start (8-260s) yememeli.
  // ensureAnchorVecs() idempotent + singleton; tek mlxEmbed çağrısı worker
  // spawn + bge-m3 yükleme tetikler. EMBED_WORKER_WARMUP=0 ile kapatılabilir.
   if (process.env.EMBED_WORKER_WARMUP !== "0") {
    setTimeout(() => {
      const t0 = Date.now();
      ensureAnchorVecs()
        .then((v) => console.log(`[boot] embed worker warmup → ${v ? "ok" : "skipped"} (${Date.now() - t0}ms)`))
        .catch((e) => console.warn(`[boot] embed worker warmup failed: ${String(e?.message || e).slice(0, 200)}`));
    }, 5000);
  }
  // Provider policy cache pre-warm: ilk istekte cache miss + 500ms timeout yememeli.
  // 8sn delay: DB cold pool + ensureWorker'ın yerleşmesini bekle, paralel lookup ile <1sn'de doldur.
  setTimeout(() => {
    const t0 = Date.now();
    warmProviderPolicyCache()
      .then((n) => console.log(`[boot] provider_policy cache warmed: ${n} users (${Date.now() - t0}ms)`))
      .catch((e) => console.warn(`[boot] provider_policy warmup failed: ${String(e?.message || e).slice(0, 200)}`));
  }, 8000);
  // Periyodik tazeleme — TTL 5dk, refresh 4dk: cache hiç soğumasın.
  setInterval(() => { warmProviderPolicyCache().catch(()=>{}); }, 240_000).unref?.();
  // v17: Vision warmup da default KAPALI; 7B vision modeli sadece Live Call'da uyansın.
  if (String(process.env.MLX_VISION_WARMUP_ENABLED ?? "0") === "1") setTimeout(async () => {
    try {
      const mlxBase = (process.env.MLX_VISION_BASE_URL || "http://127.0.0.1:8011").replace(/\/$/, "");
      const mlxModel = process.env.MLX_VISION_MODEL || "mlx-community/Qwen2-VL-7B-Instruct-4bit";
      // 1×1 saydam PNG
      const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      const t0 = Date.now();
      const r = await fetch(`${mlxBase}/v1/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: mlxModel, stream: false, max_tokens: 4,
          messages: [{ role: "user", content: [
            { type: "text", text: "ok" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${tinyPng}` } },
          ]}],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      console.log(`[boot] MLX vision warmup → ${r.status} (${Date.now()-t0}ms) · ${mlxBase}`);
    } catch (e) {
      // Vision modeli opsiyonel — yokken her boot'ta warning basma; sadece DEBUG ile göster.
      if (process.env.DEBUG_MLX_WARMUP === "1") {
        console.warn(`[boot] MLX vision warmup failed (model çalışmıyor olabilir): ${String(e?.message || e).slice(0, 200)}`);
      }
    }
  }, 2500).unref?.();
  console.log(`[boot] embed worker uykuda · LLM/vision/keepwarm default kapalı · cold-start ilk gerçek istekte olabilir.`);
  console.log(`[boot] OFFLINE seal · HF_HUB_OFFLINE=${process.env.HF_HUB_OFFLINE} TRANSFORMERS_OFFLINE=${process.env.TRANSFORMERS_OFFLINE} HF_DATASETS_OFFLINE=${process.env.HF_DATASETS_OFFLINE}`);
  // v9 — KV cache heartbeat. Her N saniyede bir mini ısıtıcı (max_tokens=1).
  // Skip kuralı: son N*0.75 saniye içinde gerçek aktivite olduysa atla.
  setInterval(async () => {
    if (!MLX_TRANSPORT.heartbeatEnabled) {
      MLX_TRANSPORT.lastHeartbeatStatus = "skipped";
      MLX_TRANSPORT.lastHeartbeatDetail = "disabled";
      return;
    }
    const sinceActivity = Date.now() - (MLX_TRANSPORT.lastActivityAt || 0);
    const skipWindow = Math.floor(MLX_TRANSPORT.heartbeatMs * 0.75);
    if (MLX_TRANSPORT.lastActivityAt && sinceActivity < skipWindow) {
      MLX_TRANSPORT.lastHeartbeatAt = Date.now();
      MLX_TRANSPORT.lastHeartbeatStatus = "skipped";
      MLX_TRANSPORT.lastHeartbeatDetail = `recent activity ${Math.floor(sinceActivity/1000)}s ago`;
      return;
    }
    if (MLX_TRANSPORT.inflight > 0) {
      MLX_TRANSPORT.lastHeartbeatStatus = "skipped";
      MLX_TRANSPORT.lastHeartbeatDetail = `inflight=${MLX_TRANSPORT.inflight}`;
      return;
    }
    const ok = await warmLocalChatModel("heartbeat").catch(() => false);
    MLX_TRANSPORT.lastHeartbeatAt = Date.now();
    MLX_TRANSPORT.lastHeartbeatStatus = ok ? "ok" : "failed";
    MLX_TRANSPORT.lastHeartbeatDetail = ok ? "kv cache refreshed" : "warm call failed";
  }, Math.max(15_000, MLX_TRANSPORT.heartbeatMs)).unref?.();
});

