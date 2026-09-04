import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { config } from './lib/deps.mjs';
import { bootstrapDatabase, waitForDatabaseReady, attachPoolErrorHandler } from './lib/db.mjs';
import { mountApiRoutes } from './lib/routes/api-v2.mjs';
import { initActorRegistry, autoLinkLegacyOwnership, resolveActorContext, resolveActor, resolveDefaultActor, buildVisibility } from './lib/actor.mjs';
import { isUuid, dummyFlushCache } from './lib/utils.mjs';
import { tableHasColumn, inspectDirectoryAccess, normalizeDirRoot, getDefaultLibraryRoot } from './lib/rag-utils.mjs';
import { createKnowledgeMaintenance } from './lib/knowledge/maintenance.mjs';
import { SYSTEM_ACTIONS, SYS_DISK_TOOLS } from './lib/registry/system-actions.mjs';
import * as authUtils from './lib/auth-utils.mjs';
import * as vault from './lib/vault.mjs';
// import { providerPolicyCacheDeleteUser } from './lib/providers/policy-cache.mjs';
import { requireSession } from './lib/session-gate.mjs';
import { spawnPg, isPortOpen, killPortOwnerAndWait, waitForPidExit } from './lib/port-process.mjs';
import { initPgVersion } from './lib/pg-version.mjs';
import { brandSync, safeSlug, initBrandRegistry } from './lib/brand.mjs';
import { initAgentsSchema } from './lib/schema-agents.mjs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
import {
  coerceParams,
  classifyAgentError,
  agentErrorMessage,
  setAgentBridgePool
} from './lib/agent-bridge.mjs';
import {
  spawnAgentRun,
  cancelAgentRun,
  recordAgentRunFinish,
  AGENT_RUN_TIMEOUT_MS,
  listAgentRuns,
  liveCountsByAgent,
  cancelAllRunsForAgent
} from './lib/agent-runs.mjs';
import { 
  buildAgentEnv,
  buildBrainEnv,
  buildAgentToolsEnv,
  buildFieldBindingEnvForAgent
} from './lib/agent-env.mjs';
import { buildAgentRagContext } from './lib/agent-rag.mjs';
import { getRagSettings } from './lib/rag-settings.mjs';
import * as ragUtils from './lib/rag-utils.mjs';
import * as agentUtils from './lib/agent-utils.mjs';
import * as systemUtils from './lib/system-utils.mjs';
import { initIntentClassifier } from './lib/rag/intent-classifier.mjs';
import { initEmbedProvider, embed, getLastEmbedError } from './lib/embed-provider.mjs';
import { initPlanner } from './lib/plan-and-execute.mjs';

// --- Sovereign Boot Imports ---
import { initRuntimeRegistry } from './lib/runtime-registry.mjs';
import { initCapabilityRegistry } from './lib/capability-registry.mjs';
import { initDispatcher } from './lib/dispatch.mjs';
import { initSessionGate, attachSessionContext } from './lib/session-gate.mjs';
import { initBrandCache, getActivePackBrandFilter, getAgentRagBrands, getLibraryBrands, detectLibraryMatch } from './lib/rag/brand-cache.mjs';
import { initAgentRag } from './lib/agent-rag.mjs';
import { initAgentEnv } from './lib/agent-env.mjs';
import { initRerankProvider, rerank, getLastRerankError } from './lib/rerank-provider.mjs';
import { initEntityExtractor, purgeGraphOrphans } from './lib/rag/entity-extractor.mjs';
import { initWatchers } from './lib/knowledge/watchers.mjs';
import { initLlmProvider, stream as llmStream, webSearch as llmWebSearch } from './lib/llm-provider.mjs';
// import { initProviderPolicyCache } from './lib/providers/policy-cache.mjs';
import { initAuditFeed } from './lib/audit-feed.mjs';
import { initEmbedWorkerStore, embedAndStoreChunks } from './lib/embed-worker/store.mjs';
import { initEmbedWorkerRuntime, startEmbedWorkerIntervals, ensureWorker, kickWorkerStart, killWorker, ragAutoEmbedDrain } from './lib/embed-worker/runtime.mjs';
import { initRagRetrieval, semanticSearch } from './lib/rag/retrieval.mjs';
import { initToolAdapters, invokeTool, listPendingApprovals, decideApproval, ApprovalRequired, ToolPolicyError } from './lib/tool-adapters.mjs';
import { initWorkflowEngine } from './lib/workflow-engine.mjs';
import { initIdentitySchema } from './lib/schema-identity.mjs';
import { initKnowledgeSchema } from './lib/schema-knowledge.mjs';
import { initAdaptersSchema } from './lib/schema-adapters.mjs';
import { normalizeAgentRow } from './lib/agents/runtime.mjs';
import { initProductCache } from './lib/rag/product-cache.mjs';
import { initBrandAliases } from './lib/routes/brand-aliases.mjs';
import { initCockpitAllowlist } from './lib/routes/cockpit-allowlist.mjs';
import { initWriteQueue } from './lib/write-queue.mjs';
import { initEmbedWorkerProbe } from './lib/embed-worker-probe.mjs';
import { initVisionService } from './lib/routes/vision-service.mjs';
import { initVoiceProfiles } from './lib/routes/voice-profiles.mjs';
import { initAdapterDictionaries } from './lib/routes/adapter-dictionaries.mjs';
import { initTemplateAssignments } from './lib/routes/template-assignments.mjs';
import { createPythonResolver } from './lib/python-resolver.mjs';
import { createIngestExtract } from './lib/ingest/extract.mjs';
import { createIngestPipeline } from './lib/ingest/pipeline.mjs';
import { enrichChunkContent } from './lib/chunk-enrichment.mjs';
import { linkEntitiesForChunk } from './lib/rag/entity-extractor.mjs';
import { _coerceBool, maybeAutoReenrich } from './lib/routes/brand-aliases.mjs';
import { sseBegin, sseWrite } from './lib/sse.mjs';

let _cockpit = null;

async function startServer() {
  console.log(`[boot] Starting ELARA Middleware (Sovereign Mode)...`);
  try {
    // =============================================================================
    // PHASE A: Pre-Pool Initialization
    // =============================================================================
    console.log(`[boot] Phase A: Pre-Pool Init...`);
    const probeUtils = initEmbedWorkerProbe({
      port: Number(process.env.EMBED_WORKER_PORT || config.embedWorkerPort || 8082),
      pushLog: (src, msg) => console.log(`[${src}] ${msg}`),
    });
		
    // Database Bootstrap
    const { pool, databaseUrl, dbName } = await bootstrapDatabase({ dbName: 'elara_db' });
    await waitForDatabaseReady(pool, { dbName });
    attachPoolErrorHandler(pool);
    console.log(`[boot] ✅ Database ready.`);

    setAgentBridgePool(pool);

    // =============================================================================
    // PHASE B: Post-Pool Registry & Dispatcher
    // =============================================================================
    console.log(`[boot] Phase B: Post-Pool Registry Init...`);
    
    initRuntimeRegistry({ pool });
    initActorRegistry({ pool });
    initBrandRegistry({ pool });
    initSessionGate(pool);
    initCapabilityRegistry(pool);
    initDispatcher(pool);
    initToolAdapters(pool);
    initWorkflowEngine(pool);

    // Planner initialization
    initPlanner(pool, {
      getRagSettings,
      logger: (src, msg) => console.log(`[${src}] ${msg}`),
    });

    await autoLinkLegacyOwnership({ migrateReady: Promise.resolve() });

    // Paths & Env Setup
    const __bootDir = path.dirname(fileURLToPath(import.meta.url));
    const _uploadRaw = process.env.UPLOAD_DIR ?? './uploads';
    const UPLOAD_DIR = path.isAbsolute(_uploadRaw) ? _uploadRaw : path.resolve(__bootDir, _uploadRaw);
    const BACKUP_DIR = path.join(UPLOAD_DIR, 'backups');
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const startedAt = Date.now();

    // Multer Config
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}_${authUtils.createLocalId()}${ext}`);
      },
    });
    const upload = multer({
      storage,
      limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GiB
    });

    // Agent Allowlist State
    let _allowedAgents = [];
    const getAllowedAgents = () => _allowedAgents;
    const setAllowedAgents = (list) => { _allowedAgents = list; };
    let _agentsBaseDir = null;
    const getAgentsBaseDir = () => _agentsBaseDir;
    const setAgentsBaseDir = (dir) => { _agentsBaseDir = dir; };

    // --- Worker Process State ---
    let _workerProc = null;
    let _workerStatus = 'stopped';
    let _workerLastError = null;
    let _workerLastEmbedError = null;
    let _workerStartedAt = null;

    const getProc = () => _workerProc;
    const setProc = (p) => { _workerProc = p; };
    const getStatus = () => _workerStatus;
    const setStatus = (s) => { _workerStatus = s; };
    const getLastError = () => _workerLastError;
    const setLastError = (e) => { _workerLastError = e; };
    const getLastEmbedError = () => _workerLastEmbedError;
    const setLastEmbedError = (e) => { _workerLastEmbedError = e; };
    const setStartedAt = (t) => { _workerStartedAt = t; };
    const getStartedAt = () => _workerStartedAt;
    
    const ALL_TAB_IDS = [
      "chat", "dashboard", "knowledge", "agents", "workflows", "tools", "skills", "models", 
      "templates", "python", "forge", "telemetry", "reports", "policies", "security", "middleware", "debug"
    ];
    const EMBED_DIM_TARGET = Math.max(64, Math.min(4096, Number(process.env.EMBED_DIM) || 1024));

    // =============================================================================
    // PHASE C: Schema Bootstrap
    // =============================================================================
    console.log(`[boot] Phase C: Schema Bootstrap...`);
    initIdentitySchema({ pool, allTabIds: ALL_TAB_IDS });
    const { ensureKnowledgeFilesTable, ensureKnowledgeChunksTable } = initKnowledgeSchema({ pool, ftsCharLimit: 900000 });
    initAdaptersSchema({ pool });
    const { ensureAgentSquadsTable } = initAgentsSchema({ pool });
    initPgVersion({ pool, spawnPg });

    // Initialize Maintenance API
    const { cleanupKnowledgeGhosts } = createKnowledgeMaintenance({
      pool,
      migrateReady: Promise.resolve(),
      ensureKnowledgeFilesTable,
      ensureKnowledgeChunksTable,
      normalizeDirRoot,
      tableHasColumn,
      getDefaultLibraryRoot,
      SYSTEM_ACTIONS,
      SYS_DISK_TOOLS,
      serverDirname: __bootDir,
    });

    const resolvePythonCandidates = createPythonResolver({ serverDir: __bootDir });
    
    // =============================================================================
    // PHASE D: RAG & Engine Layer
    // =============================================================================

    // =============================================================================
    // PHASE D: RAG & Engine Layer
    // =============================================================================
    // --- RAG Local Helpers & Constants ---
    const ROLE_RANK = { Viewer: 1, Security: 2, Operator: 3, Admin: 4 };
    const DEFAULT_RAG_TRGM_THRESHOLD = 0.04;
    const DEFAULT_RAG_TRGM_MIN_SCORE = 0.005;

    const QEMB_CACHE = new Map();
    const QEMB_MAX = 256;
    const qembKey = (q) => crypto.createHash("sha1").update(String(q).toLowerCase().trim()).digest("hex");
    const qembGet = (q) => {
      const k = qembKey(q);
      const v = QEMB_CACHE.get(k);
      if (v) { QEMB_CACHE.delete(k); QEMB_CACHE.set(k, v); }
      return v || null;
    };
    const qembSet = (q, vec) => {
      const k = qembKey(q);
      QEMB_CACHE.set(k, vec);
      if (QEMB_CACHE.size > QEMB_MAX) QEMB_CACHE.delete(QEMB_CACHE.keys().next().value);
    };

    const expandQueryTerms = (q) => {
      const raw = String(q || "").toLowerCase().replace(/[^\p{L}\p{N}\s\-_.]/gu, " ").split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2);
      return raw.filter(t => /[\d_.\-]/.test(t) || t.length >= 8);
    };

    const generateHydePassage = async (cleanQuery) => {
      return { text: "", ms: 0, reject: "hyde_stub" };
    };

    const extractResult = createIngestExtract({ getRagSettings });
    console.log('[boot] IngestExtract result keys:', Object.keys(extractResult));
    const { extractTechnicalCore, isExtBreakerOpen } = extractResult;

    const { enqueueWrite, getWriteQueueDepths } = initWriteQueue({ pool });
    let deps = {
      pool,
      config,
      isUuid,
      flushModelKvCache: dummyFlushCache,
      pendingModelCache: new Map(),
      requireSession,
      sanitizeContent: (t) => String(t || ""),
      enrichChunkContent,
      linkEntitiesForChunk,
      purgeGraphOrphans,
      _coerceBool,
      maybeAutoReenrich,
      ...authUtils,
      ...vault,
      ...extractResult,
      // providerPolicyCacheDeleteUser,
      spawnPg,
      initPgVersion,
      upload,
      UPLOAD_DIR,
      BACKUP_DIR,
      DATABASE_URL: process.env.DATABASE_URL || config.dbUrl,
      __bootDir,
      baseDir: __bootDir,
      startedAt,
      brandSync,
      safeSlug,
      ...agentUtils,
      ...systemUtils,
      resolveActorContext,
      resolveActor,
      resolveDefaultActor,
      buildVisibility,
      getAllowedAgents,
      setAllowedAgents,
      getAgentsBaseDir,
      setAgentsBaseDir,
      normalizeAgentRow: (r) => normalizeAgentRow(r, config.port),
      coerceParams,
      classifyAgentError,
      agentErrorMessage,
      spawnAgentRun,
      cancelAgentRun,
      listAgentRuns,
      liveCountsByAgent,
      cancelAllRunsForAgent,
      recordAgentRunFinish,
      AGENT_RUN_TIMEOUT_MS,
      buildAgentEnv,
      buildBrainEnv,
      buildAgentToolsEnv,
      buildFieldBindingEnvForAgent,
      buildAgentRagContext,
      getRagSettings,
      ...ragUtils,
      ROLE_RANK,
      ensureAgentSquadsTable,
      execAsync,
      DISK_SQUAD_SORT: 10,
      AGENT_DISCOVERY_ROOTS: process.env.AGENT_DISCOVERY_ROOTS ? process.env.AGENT_DISCOVERY_ROOTS.split(',') : [path.join(process.cwd(), "agents")],
      _repoAgentsDir: path.join(process.cwd(), "agents"),
      AGENT_INTERPRETER_HINTS: process.env.AGENT_INTERPRETERS ? process.env.AGENT_INTERPRETERS.split(',') : ["python3", "python", "node"],
      _brandSlug: config.brandSlug || "elara",
      getActivePackBrandFilter,
      getAgentRagBrands,
      extractTechnicalCore,
      isExtBreakerOpen,
      getLibraryBrands,
      detectLibraryMatch,
      generateHydePassage,
      qembGet,
      qembSet,
      rerank,
      getLastRerankError,
      getLastEmbedError,
      expandQueryTerms,
      DEFAULT_RAG_TRGM_THRESHOLD,
      DEFAULT_RAG_TRGM_MIN_SCORE,
      tableHasColumn,
      ensureKnowledgeChunksTable,
      cleanupKnowledgeGhosts,
      inspectDirectoryAccess,
      EMBED_DIM_TARGET,
      embed,
      semanticSearch,
      semanticFallback: semanticSearch,
      getLibraryRoot: ragUtils.getDefaultLibraryRoot,
      setLibraryRoot: ragUtils.setDefaultLibraryRoot,
      hydrateAllowedAgentsFromDb: () => _cockpit?.hydrateAllowedAgentsFromDb(),
      enqueueWrite,
      getWriteQueueDepths,
      ensureWorker,
      kickWorkerStart,
      killWorker,
      spawn,
      isPortOpen,
      killPortOwnerAndWait,
      waitForPidExit,
      resolvePythonCandidates,
      embedAndStoreChunks,
      ...probeUtils,
      getProc,
      setProc,
      getStatus,
      setStatus,
      getLastError,
      setLastError,
      getLastEmbedError,
      setLastEmbedError,
      setStartedAt,
      getStartedAt,
      getSelfHealCooldownMs: () => Number(process.env.EMBED_SELF_HEAL_COOLDOWN || config.embedSelfHealCooldown || 30000),
      getRespawnMax: () => Number(process.env.EMBED_RESPAWN_MAX || config.embedRespawnMax || 5),
      llmProvider: { stream: llmStream, webSearch: llmWebSearch },
      serverDir: __bootDir,
      EMBED_WORKER_HOST: config.embedWorkerHost || '127.0.0.1',
      EMBED_WORKER_PORT: Number(process.env.EMBED_WORKER_PORT || config.embedWorkerPort || 8082),
      DEFAULT_EMBED_MODEL: process.env.MLX_EMBED_MODEL || 'BAAI/bge-m3',
      ragAutoEmbedDrain,
      pushLog: (source, msg) => console.log(`[${source}] ${msg}`),
      chatTrace: (id, event, data) => console.log(`[TRACE][${id}] ${event}`, data || ''),
      migrateReady: Promise.resolve(),
      invokeTool,
      listPendingApprovals,
      decideApproval,
      ApprovalRequired,
      ToolPolicyError
    };

    console.log(`[boot] Phase D: RAG & Engine Layer...`);
    
    initBrandCache({ pool, getRagSettings });
    initAgentRag({ getRagSettings });
    initAgentEnv({ getRagSettings });
    initEmbedProvider(deps);
    initRerankProvider(deps);
    initIntentClassifier(deps);
    initEntityExtractor({ pool });
    initEmbedWorkerStore(deps);
    initEmbedWorkerRuntime(deps);
    startEmbedWorkerIntervals();
    initProductCache({ pool, getRagSettings });
    initRagRetrieval(deps);
    initBrandAliases(deps);
    initWatchers(deps);
    initLlmProvider(deps);
    // initProviderPolicyCache({ pool });
    _cockpit = initCockpitAllowlist(deps);
    const auditObj = initAuditFeed({
      sseWrite,
      siem: { enqueue: () => {} },
      enqueueWrite
    });
    
    // Wire up ingest pipeline
    const pipelineFns = createIngestPipeline(deps);
    
    Object.assign(deps, auditObj, pipelineFns, { sseBegin });

    // =============================================================================
    // PHASE E: Route-Local Initializers
    // =============================================================================
    console.log(`[boot] Phase E: Route-Local Init...`);
    initVisionService(deps);
    initVoiceProfiles(deps);
    initAdapterDictionaries(deps);
    initTemplateAssignments(deps);

    const app = express();
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));
    app.use(attachSessionContext());
    app.use((req, res, next) => {
      console.log("[Request] " + req.method + " " + req.url);
      next();
    });
    
    await mountApiRoutes(app, deps);

    app.get('/health', (req, res) => res.json({ status: 'ok' }));

    app.listen(config.port, '0.0.0.0', () => {
      console.log(`🚀 Middleware running on port ${config.port}`);
    });
  } catch (error) {
    console.error('❌ FATAL ERROR:', error);
    process.exit(1);
  }
}

startServer();
