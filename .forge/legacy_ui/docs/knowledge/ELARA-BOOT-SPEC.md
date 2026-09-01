# ELARA — Middleware Boot & Initialization Specification

**Kaynak:** `local-server/server.mjs` (4945 satır, tek boot dosyası) + `local-server/lib/**`
**Tarih:** 2026-08-14 · **Runtime:** Bun (ESM, top-level `await`) · **Port:** `3005` HTTP / `3006` HTTPS

> Kritik kural: `server.mjs` bir **modül gövdesidir**, `main()` fonksiyonu yoktur.
> Tüm boot adımları dosya sırasına göre yukarıdan aşağı, senkron/`await` olarak çalışır.
> Satır sırası = çalışma sırası. Bir `init*` çağrısını yukarı/aşağı taşımak TDZ
> (`Cannot access 'x' before initialization`) veya `deps` eksikliği üretir.

---

## 1. Mimari Sözleşme: `init*` + `mount*` ikilisi

Her route modülü iki fonksiyon dışa açar:

```js
// lib/routes/<domain>.mjs
let _deps = null;
export function initX(deps) { _deps = deps; }          // dependency injection
export function mountXRoutes({ app }) {                 // express route binding
  if (!_deps) throw new Error("initX must be called before mountXRoutes");
  const { pool, ... } = _deps;
  app.get("/api/...", handler);
}
```

Kurallar:

| Kural | Açıklama |
|---|---|
| `init*` önce, `mount*` sonra | `mount*` içinde `if (!_deps) throw` guard'ı vardır; sıra bozulursa boot ölür. |
| `_deps` modül-scope singleton | Her modül tek örnek; ikinci `init*` çağrısı öncekini ezer. |
| Runtime-mutable değerler getter ile | `getRagSettings: () => RAG_SETTINGS` — snapshot değil, canlı okuma (UI knob'ları restart'sız etkili olsun diye). |
| Geç-bind fonksiyonlar wrapper ile | `cleanupKnowledgeGhosts: (...a) => cleanupKnowledgeGhosts(...a)` — tanımı boot'ta daha aşağıda olan sembolleri hoisting'e bağlamadan geçirir. |
| Bazı modüller API döndürür | `initPgVersion(...) → { ensurePgVersionsCompatible }`, `initAdaptersSchema(...) → { ensureAdapterDictionariesSeed }`, `initMlxSelfHeal(...) → _selfHealApi`. |

---

## 2. Başlatma Akış Şeması (uçtan uca)

```text
[0] dotenv yükle (server.mjs:4)  ─ .env yalnız fallback; launchd plist env ÖNCELİKLİ
     │
[1] Statik import grafiği çözülür (satır 64-404, ~120 modül)
     │   pg, express, cors, multer + lib/* (db, migrate, sse, mlx-*, rag/*, routes/*)
     │
[2] Sabitler & yardımcılar                     PORT=3005, HOST=0.0.0.0
     │   UPLOAD_DIR / BACKUP_DIR mkdir -p
     │
[3] initEmbedWorkerProbe({...})                → probeWorkerHealth, verifyEmbedAlive, warmEmbedWorker
     │
[4] initMlxSelfHeal({ port, pushLog, mlxQueue, ... })   (server.mjs:711)
     │   MLX 8001 zombi-slot kurtarma API'si; lazy getter'larla runtime base çözer
     │
[5] await bootstrapDatabase({ initialUrl: DATABASE_URL })       ← lib/db.mjs
     │   ├─ waitForDatabaseUrl()      60 deneme × 5 sn
     │   ├─ normalizeDatabaseUrl()    "sovereign mühür": db adı elara_db'ye zorlanır,
     │   │                            openwebui/ollama/anythingllm gibi adlar reddedilir
     │   └─ createDbPool()            pg.Pool (max 8, statement_timeout 60s, keepAlive)
     │   ⇒ { pool, databaseUrl, dbName }
     │
[6] Pool-bağımlı çekirdek kayıtçılar (server.mjs:740-771)
     │   initRuntimeRegistry({pool}) → initActorRegistry({pool}) → initBrandRegistry({pool})
     │   initMlxWarmup({...}) + startMlxKeepwarmLoop()
     │   initSessionGate(pool)
     │   initCapabilityRegistry(pool) → initDispatcher(pool) → initToolAdapters(pool)
     │   initWorkflowEngine(pool)
     │   Planner.initPlanner(pool, { listCapabilities, executeCapability, llmChat, ... })
     │
[7] await waitForDatabaseReady(pool, { dbName })   ← gerçek SELECT probe, 60×5sn
     attachPoolErrorHandler(pool)
     │
[8] initWriteQueue({pool})  → enqueueWrite, getWriteQueueDepths
     initAuditFeed({...})   → auditClients, broadcastAudit, logCheckpoint
     │
[9] const migrateReady = runMigration({ pool })     ← lib/migrate.mjs (AWAIT EDİLMEZ!)
     │   schema.sql + embed_dim + capability sync + default-model seed + audit chain
     │   Handler'lar ihtiyaç duyarsa `await migrateReady` ile bekler (non-blocking boot).
     │
[10] express app + global middleware
     │   cors(CORS_ORIGINS) → json/urlencoded → actor resolve → mountMutationGuard(app, {...})
     │
[11] Şema bootstrap DDL'leri (domain bazlı)
     │   initIdentitySchema({pool, allTabIds}) · initKnowledgeSchema({pool, ftsCharLimit})
     │   initAdaptersSchema({pool}) · initAgentsSchema({pool})
     │
[12] RAG / motor katmanı init'leri (server.mjs:3186-3276)
     │   initBrandCache · initAgentRag · initAgentEnv · initMlxEmbedRerank
     │   initIntentClassifier + scheduleIntentHydrate(500)
     │   initEntityExtractor · initEmbedWorkerStore · initEmbedWorkerRuntime
     │   initProductCache · initRagRetrieval · initRagReadOps · initRagDiagnostics
     │   initBrandAliases · initWatchers · initReindexer · initSkillsRuntime
     │   initGeminiWeb · initProviderPolicyCache · initCockpitAllowlist
     │
[13] mount* route bağlamaları (~70 modül) — bölüm 4'teki sıra
     │
[14] await installLiveCall({ app, pool, port, __bootDir })
     │   WebSocket /ws/live-call + http.Server + (TLS varsa) https.Server oluşturur
     │   ⇒ { httpServer, httpsServer, HTTPS_ENABLED, HTTPS_PORT, TLS_CERT_FILE }
     │
[15] mountBackupRoutes(...) → ensurePgVersionsCompatible  (initPgVersion içeriden)
     mountSkillRoutes · mountSystemMlxRoutes · mountAgentsTemplatesRoutes · mountWorkflowRoutes
     │
[16] Socket timeout profilleri (TIMEOUT_BUDGETS)
     │   httpServer.timeout / requestTimeout / headersTimeout / keepAliveTimeout
     │
[17] httpServer.listen(3005, 0.0.0.0)
     └─ callback içinde httpsServer.listen(3006) → "[boot] db=elara_db · port 3005 …"
```

---

## 3. `init*` Fonksiyonları — tam envanter ve sıra

### 3.1 Faz A — Pool'dan önce

| # | Fonksiyon | Modül | Dönüş | Görev |
|---|---|---|---|---|
| 1 | `initEmbedWorkerProbe({...})` | `lib/embed-worker-probe.mjs` | `{probeWorkerHealth, verifyEmbedAlive, warmEmbedWorker}` | Python embed worker (`:3007`) sağlık probu; zombi worker'a CLAIM atılmasını engeller. |
| 2 | `initMlxSelfHeal({...})` | `lib/mlx-transport.mjs` | `_selfHealApi` | MLX `:8001` tek-slot kilitlenmesinde port kill + launchd respawn + kuyruk drain. |

### 3.2 Faz B — Pool kurulduktan hemen sonra (`server.mjs:740-776`)

| # | Fonksiyon | deps | Görev |
|---|---|---|---|
| 3 | `initRuntimeRegistry` | `{pool}` | `models` / `runtime.provider` satırlarını hydrate eder; aktif motor kaydı. |
| 4 | `initActorRegistry` | `{pool}` | `resolveActorContext`, `buildVisibility` — RBAC aktör çözümü. |
| 5 | `initBrandRegistry` | `{pool}` | `app_settings.brand` + env fallback; `getBrand`, `brandSync`. |
| 6 | `initMlxWarmup` | `{pool, migrateReady, mlxQueue, pushLog, getWatchdogCfg, getRagSettings, injectSystemPrompt, currentModelRender, normaliseRender, getMlxKeepAliveAgent, resolveRuntimeSafety}` | Cold-start ısıtma + keep-warm döngüsü (`MLX_KEEPWARM_ENABLED=0` → no-op). |
| 7 | `initSessionGate(pool)` | pool (pozisyonel) | `x-session-id` → DB oturum doğrulama; `requireSession()` üretir. |
| 8 | `initCapabilityRegistry(pool)` | pool | tool/skill/agent/workflow birleşik yetenek kaydı. |
| 9 | `initDispatcher(pool)` | pool | Capability çağrı yönlendirici (`invokeTool`). |
| 10 | `initToolAdapters(pool)` | pool | Adapter (REST/SSH/SQL) runner katmanı. |
| 11 | `initWorkflowEngine(pool)` | pool | DAG çalıştırıcı. |
| 12 | `Planner.initPlanner(pool, {...})` | `{listCapabilities, getRagSettings, executeCapability, llmChat, logger}` | Opt-in plan-and-execute; kapalıyken tam no-op. |

### 3.3 Faz C — Şema bootstrap

| # | Fonksiyon | deps | Görev |
|---|---|---|---|
| 13 | `initIdentitySchema` | `{pool, allTabIds}` | `app_users`, `app_sessions`, RBAC tabları. |
| 14 | `initKnowledgeSchema` | `{pool, ftsCharLimit}` | `knowledge_sources/chunks`, `tsv` generated column self-heal (900k char limit). |
| 15 | `initAdaptersSchema` | `{pool}` → `{ensureAdapterDictionariesSeed}` | `adapter_dictionaries` DDL + builtin seed (category/connection/runner). |
| 16 | `initAgentsSchema` | `{pool}` → `{ensureAgentSquadsTable}` | `agent_squads` tablosu (lazy, `ready` flag'li). |
| 17 | `initPgVersion` | `{pool, spawnPg}` → `{getPgClientMajor, getPgServerMajor, ensurePgVersionsCompatible}` | `pg_dump` < server sürümü ise backup'ı reddeder. |

### 3.4 Faz D — RAG / motor katmanı

| # | Fonksiyon | deps (özet) |
|---|---|---|
| 18 | `initBrandCache` | `{pool, getRagSettings}` |
| 19 | `initAgentRag` | `{getRagSettings}` |
| 20 | `initAgentEnv` | `{getRagSettings}` |
| 21 | `initMlxEmbedRerank` | `{pushLog, getWorkerStatus, kickWorkerStart, ensureWorker, getRagSettings, embedWorkerPort, embedWorkerHost}` |
| 22 | `initIntentClassifier` | `{pool, pushLog, mlxEmbed, currentModelRender, cosine, getRagSettings}` + `scheduleIntentHydrate(500)` |
| 23 | `initEntityExtractor` | `{pool}` |
| 24 | `initEmbedWorkerStore` | `{pool, mlxEmbed, ensureWorker, pushLog, tableHasColumn, ensureKnowledgeChunksTable, cleanupKnowledgeGhosts, inspectDirectoryAccess, getLibraryRoot, getRagSettings, EMBED_DIM_TARGET}` |
| 25 | `initEmbedWorkerRuntime` | `{pool, spawn, isPortOpen, killPortOwnerAndWait, waitForPidExit, probeWorkerHealth, verifyEmbedAlive, warmEmbedWorker, resolvePythonCandidates, pushLog, getRecentWorkerLogs, ensureKnowledgeChunksTable, embedAndStoreChunks, getRagSettings, getLastEmbedError, EMBED_WORKER_HOST/PORT, DEFAULT_EMBED_MODEL, serverDir, getProc/setProc, getStatus/setStatus, getLastError/setLastError, setStartedAt, getSelfHealCooldownMs, getRespawnMax}` |
| 26 | `initProductCache` | `{pool, getRagSettings}` |
| 27 | `initRagRetrieval` / `initRagReadOps` / `initRagDiagnostics` | `{pool, getRagSettings, mlxEmbed, mlxRerank, pushLog, …}` |
| 28 | `initBrandAliases` | `{pool, statePath, reEnrich…}` — alias dosyası `~/.elara/state/brand-aliases.json` |
| 29 | `initWatchers` / `initReindexer` / `initSkillsRuntime` | `{pool, ingestSource, pushLog, …}` |
| 30 | `initGeminiWeb` | `{pool, getActiveProvider}` |
| 31 | `initProviderPolicyCache` | `{pool}` → `providerPolicyCacheClear` |
| 32 | `initCockpitAllowlist` | `{pool, …}` |
| 33 | `initWriteQueue` / `initAuditFeed` | `{pool}` / `{pool, enqueueWrite, …}` |

### 3.5 Faz E — Route-yerel init'ler (özellikle istenenler)

#### `initVisionService({ pool, enqueueWrite, decField })` — `lib/routes/vision-service.mjs:13`

```js
let _deps = null;
export function initVisionService(deps) { _deps = deps; }   // { pool, enqueueWrite, decField }
```

- **Ne yapar:** MLX-VLM görüntü motorunun (ayrı süreç, port **8011**) UI'dan elle
  açılıp kapatılabilmesi için gereken bağımlılıkları saklar. **Autostart yok, launchd
  girdisi yok** — operatör Models → Vision ekranından başlatır.
- **Modül yan etkileri (import anında):** `logs/` klasörü `mkdirSync`, log dosyası
  `logs/vision-8011.log`.
- **Yardımcılar:** `visionBindHost()` (`MLX_VISION_BIND`, default `0.0.0.0`),
  `visionPort()` (`MLX_VISION_PORT`, default `8011`),
  `visionDefaultModel()` (runtime cache → `MLX_VISION_MODEL` → `Qwen2-VL-7B-Instruct-4bit`),
  `visionPortReachable()` (1.5 sn TCP probe).
- **deps kullanımı:** `pool` → vision config'in `app_settings`'e yazılması;
  `enqueueWrite` → analiz kayıtlarının bloklamayan persist'i;
  `decField` → şifreli alan (ör. `OPENAI_API_KEY` fallback sağlayıcısı) çözümü.
- **Endpoint'ler:** `GET /api/vision/status`, `POST /api/vision/start|stop`,
  `GET /api/vision/logs`, `POST /api/vision/analyze`, `GET|POST /api/vision/config`.

#### `initVoiceProfiles({ pool, createPrefixedId })` — `lib/routes/voice-profiles.mjs:6`

- **Ne yapar:** Dil başına (TR/EN/DE) TTS kimliği CRUD'u için pool ve id üreteci enjekte eder.
- **Şema:** `voice_profiles(id, lang, label, engine, voice_uri, rate, pitch, premium_provider, is_default, updated_at)`.
- **DTO map:** `rowToVoiceProfile()` snake_case → camelCase (`voiceUri`, `premiumProvider`, `isDefault`, ISO `updatedAt`).
- **`createPrefixedId("vp_")`** yeni profil id'si üretir; upsert `ON CONFLICT (id) DO UPDATE`.
- **Endpoint'ler:** `GET/POST/DELETE /api/voice-profiles`.

#### `initAdapterDictionaries({ pool })` — `lib/routes/adapter-dictionaries.mjs:8`

- **Ne yapar:** Konektör taksonomisi (`kind ∈ {category, connection, runner}`) CRUD'u.
- **Doğrulama:** `ADAPTER_DICT_KINDS` set kontrolü; `value` lowercase + `[^a-z0-9_-] → _`, max 64 char; `label` max 80 char.
- **Ön koşul:** `initAdaptersSchema().ensureAdapterDictionariesSeed()` tabloyu ve builtin satırları
  oluşturmuş olmalı (`builtin=true` satırlar korunur, kullanıcı satırları `builtin=false`).
- **Endpoint'ler:** `GET/POST /api/adapter-dictionaries`, `PATCH|DELETE /api/adapter-dictionaries/:id`.

#### `initTemplateAssignments({ pool, migrateReady, providerPolicyCacheClear })` — `lib/routes/template-assignments.mjs:6`

- **Ne yapar:** `username → template_id` eşlemesi; `app_template_assignments` tablosu **ve**
  `app_users.template_id` kolonu senkron tutulur.
- **`migrateReady` neden gerekli:** Bu iki handler `await migrateReady` ile şema hazır olana
  kadar bekler — boot'ta migration await edilmediği için tek koruma budur.
- **`providerPolicyCacheClear`:** Toplu atama her kullanıcının sağlayıcı politikasını
  değiştirdiği için PUT sonunda cache invalidate edilir.
- **İşlem:** `PUT` tek transaction — `BEGIN → DELETE ALL → INSERT … ON CONFLICT DO NOTHING →
  UPDATE app_users SET template_id=NULL → per-user UPDATE → COMMIT`; hata → `ROLLBACK`.

---

## 4. `mount*` Sırası (bağlanma düzeni)

```text
mountMutationGuard → mountPlannerRoutes → mountRagSettingsRoutes → mountCockpitRoutes
→ mountRbacRoutes → mountModelsRoutes → mountChatTemplatesRoute → mountThreadRoutes
→ mountMessagesRoutes → mountEngineRoutes → mountEmbedWorkerRoutes → mountKnowledgeSyncRoutes
→ mountKnowledgeMaintenanceRoutes → mountSystemMiscRoutes → mountRagStatusRoute
→ mountRagReadOpsRoutes → mountRagDiagnosticsRoutes → mountBrandAliasesRoutes → mountRagOpsRoutes
→ mountKnowledgeRetrieveRoutes → mountKnowledgeAuditRoutes → mountKnowledgeIngestRoutes
→ mountForgeRoutes → mountMetaForgeRoutes → mountCapabilityRoutes → mountCapabilitiesRunsRoutes
→ mountToolRoutes → mountAgentsExtraRoutes → mountPythonRoutes → mountTelemetryRoutes
→ mountAgentRunRoute → mountAgentsCrudRoutes → mountMcpRoutes
→ mountAdapterDictionariesRoutes → mountAdaptersRoutes → mountAgentBindingsRoutes
→ mountIdentityRoutes → mountProvidersRoutes → mountWebhookRoutes → mountGraphRoutes
→ mountChatOrchestrateRoutes → mountChatStreamRoutes
→ mountVisionServiceRoutes → mountVoiceProfilesRoutes → mountTemplateAssignmentsRoutes
→ [installLiveCall — server nesneleri burada doğar]
→ mountBackupRoutes → mountSkillRoutes → mountSystemMlxRoutes → mountAgentsTemplatesRoutes
→ mountWorkflowRoutes → listen()
```

`mountMutationGuard` **ilk** olmalı: tüm yazma (`POST/PUT/PATCH/DELETE`) path'lerine
blanket RBAC guard uygular. Sonradan bağlanan bir route guard'ın dışında kalmaz çünkü
guard path-set üzerinden `app.use` seviyesinde çalışır.

---

## 5. `deps` Nesnesi — tip envanteri

### 5.1 Çekirdek (neredeyse her modülde)

| Özellik | Tip | Kaynak |
|---|---|---|
| `pool` | `pg.Pool` | `bootstrapDatabase()` → `lib/db.mjs` |
| `app` | `express.Application` | `express()` |
| `migrateReady` | `Promise<void>` | `runMigration({pool})` |
| `enqueueWrite` | `(fn: () => Promise<any>) => void` | `initWriteQueue({pool})` |
| `getWriteQueueDepths` | `() => Record<string, number>` | aynı |
| `pushLog` | `(source: string, line: string) => void` | `server.mjs` (SYS_LOG_RING) |
| `broadcastAudit` / `logCheckpoint` | `(evt) => void` | `initAuditFeed()` |
| `chatTrace` | `(traceId, event, data?) => void` | `server.mjs` breadcrumb |
| `RAG_SETTINGS` | `object` (mutable) | `.rag-settings.json` + `buildRagDefaults()` |
| `getRagSettings` | `() => RagSettings` | **canlı getter** — snapshot yasak |
| `TIMEOUT_BUDGETS` | `const object` | `lib/queue-config.mjs` |
| `PORT` / `MLX_RUNTIME_PORT` | `number` | env |
| `isUuid` | `(s: string) => boolean` | util |
| `createPrefixedId` | `(prefix: string) => string` | util |
| `resolveActorContext` | `(req) => Promise<ActorCtx>` | `lib/actor.mjs` |
| `requireSession` | `express.RequestHandler` | `initSessionGate(pool)` |
| `ROLE_RANK` / `normalizeAccessLevel` | `Record<string,number>` / `(x)=>string` | RBAC |

### 5.2 Model / motor katmanı

| Özellik | Tip | Kaynak |
|---|---|---|
| `mlxQueue` | `Queue` (single-flight slot) | `lib/mlx-queue.mjs` |
| `MLX_TRANSPORT` | mutable state objesi | `lib/mlx-transport.mjs` |
| `streamFromLocalLLM` | `async function*` | `server.mjs` → `streamMlxCompletion` |
| `streamFromProvider` | `async function*` | cloud transport |
| `runtimeBase` / `runtimeModel` | `() => string` | runtime-registry |
| `recordMlxActivity` / `triggerMlxZombieSelfHeal` | `fn` | `initMlxSelfHeal` forwarder |
| `_mlxIsCold`, `_mlxRecordFirstToken`, `_mlxEffectiveFirstTokenMs` | `fn` | cold-start telemetri |
| `mlxEmbed` / `mlxRerank` | `async fn` | `initMlxEmbedRerank` |
| `currentModelRender` / `normaliseRender` | `async fn` | `lib/chat-templates.mjs` |

### 5.3 RAG katmanı

`ragProbeAndFetch`, `classifyIntent`, `refineIntentSemantically`, `detectLibraryMatch`,
`getLibraryBrands`, `buildFreeAnswerMessages`, `cosine`, `_brandDisplay`,
`_makeThinkStripper`, `extractEntities`, `embedAndStoreChunks`, `ensureKnowledgeChunksTable`,
`cleanupKnowledgeGhosts`, `invalidateSourcesCache` — hepsi `fn`, kaynağı `lib/rag/*` ve
`lib/knowledge/*`.

### 5.4 Agent / capability katmanı

`runLocalAgent`, `streamLocalAgent`, `finishRun`, `dispatchUserTurn`, `detectAgentIntent`,
`classifyAgentError`, `agentErrorMessage`, `buildAgentEnv`, `buildAgentEnvForScript`,
`buildAgentToolsEnv`, `buildBrainEnv`, `extractToolCalls`, `runToolCallsForAgent`,
`getAllowedAgents`, `hydrateAllowedAgentsFromDb`, `getAgentsBaseDir`, `Planner`.

### 5.5 Politika / sağlayıcı

`getProviderById`, `pickProviderForRequest`, `getProviderPolicyCachedSync`,
`providerPolicyCacheClear`, `resolvePolicyContext`, `applyExecutionGuard`, `recordUsage`,
`decField` (şifreli alan çözücü), `getWatchdogCfg`.

### 5.6 Sistem / süreç

`spawn`, `execAsync`, `spawnPg`, `isPortOpen`, `killPortOwnerAndWait`, `listPortPids`,
`listPortSockets`, `upload` (`multer.Multer`), `UPLOAD_DIR`, `BACKUP_DIR`,
`DATABASE_URL`, `__bootDir`, `startedAt`, `sseBegin`/`sseWrite`/`flushSse`.

---

## 6. Ortam Değişkenleri ve Ön Koşullar

### 6.1 Boot için zorunlu

| Env | Default | Kim kullanır |
|---|---|---|
| `DATABASE_URL` | — (yoksa 60×5 sn bekler, sonra ölür) | `bootstrapDatabase` |
| `PORT` | `3005` | listen + self-heal |
| `UPLOAD_DIR` | `./uploads` | mkdir + backup dizini |
| `CORS_ORIGINS` | — | cors middleware |

### 6.2 Şartlı / servis bağımlı

| Env | Default | Etki |
|---|---|---|
| `HTTPS_ENABLED` / `HTTPS_PORT` / `TLS_CERT_FILE` / `TLS_KEY_FILE` | `1` / `3006` / `./certs/*` | Sertifika yoksa HTTPS **sessizce** devre dışı, HTTP çalışmaya devam eder. |
| `MLX_BASE_URL` / `MLX_RUNTIME_PORT` / `LLM_MODEL` | `http://127.0.0.1:8001` | Chat motoru; kapalıysa boot geçer, chat 503 döner. |
| `MLX_VISION_*` (`BIND`, `PORT`, `MODEL`, `BASE_URL`, `TIMEOUT_MS`, `VLM_BIN`) | `0.0.0.0` / `8011` / Qwen2-VL-7B-4bit | `initVisionService`; ayrı süreç, elle başlatılır. |
| `MLX_EMBED_MODEL` / `MLX_EMBED_BASE_URL` / `EMBED_DIM` / `EMBED_WORKER_PORT` | `BAAI/bge-m3` / `1024` / `3007` | Embed worker; RAG ingest için zorunlu, boot için değil. |
| `MLX_KEEPWARM_ENABLED` / `_MS` / `_PROMPT` / `_TOKENS` | `0` | `initMlxWarmup` keep-warm döngüsü; `0` → no-op. |
| `LLM_BOOT_WARMUP_ENABLED` / `MLX_VISION_WARMUP_ENABLED` | `0` | RAM güvenliği için boot ısıtması kapalı. |
| `ELARA_AGENTS_DIR` / `ELARA_AGENTS_PYTHON` / `ELARA_AGENTS_TIMEOUT_MS` / `AGENT_DISCOVERY_ROOTS` / `AGENT_INTERPRETERS` | boş / `python3` / `60000` | Agent bridge; boşsa DB `agent_path`'lerinden klasör türetilir. |
| `VAULT_PASSPHRASE` | — | `decField` şifre çözümü; yoksa şifreli alanlar `null` döner. |
| `HF_HUB_OFFLINE` / `TRANSFORMERS_OFFLINE` / `HF_DATASETS_OFFLINE` | `1` | Egemenlik mührü: HF Hub'a çıkış yasak. |
| `EMBED_WORKER_MAX_RSS_GB` / `MAX_REQUESTS` / `RSS_CHECK_SEC` / `RERANKER_MAX_RSS_GB` | `4.0` / `3000` / `30` / `2.5` | Worker RAM tavanı (graceful suicide → respawn). |
| `WORKER_SELF_HEAL_COOLDOWN_MS` / `WORKER_RESPAWN_MAX` / `WORKER_BOOT_TIMEOUT_MS` | — | `initEmbedWorkerRuntime` self-heal. |
| `PG_POOL_MAX/MIN`, `PG_STATEMENT_TIMEOUT_MS`, `PG_QUERY_TIMEOUT_MS`, `PG_IDLE_IN_TX_TIMEOUT_MS`, `PG_ALLOW_EXIT_ON_IDLE` | `8/0`, `60000`, `90000`, `30000`, `1` | `createDbPool` |
| `DB_BOOT_MAX_ATTEMPTS` / `DB_BOOT_RETRY_MS` | `60` / `5000` | URL bekleme + hazır olma probu |
| `RL_LOGIN_CAPACITY/REFILL`, `RL_INVOKE_CAPACITY/REFILL` | — | rate limit kovaları |
| `RAG_DEADLINE_MS` | `4500` | RAG probe bütçesi (UI knob'u önceliklidir) |
| `ADMIN_API_TOKEN` | — | Yalnız loopback'ten admin sayılır |

### 6.3 Ön koşul servisler

| Servis | Zorunlu mu? | Sonucu |
|---|---|---|
| PostgreSQL (`elara_db`, pgvector) | **Evet** | Yoksa boot 5 dk bekler, sonra request bazlı yeniden dener. |
| MLX chat server `:8001` | Hayır | Boot geçer; chat 503/timeout. |
| Embed worker `:3007` (Python) | Hayır | Boot geçer; ingest/embedding durur (`verifyEmbedAlive` CLAIM'i bloklar). |
| MLX-VLM `:8011` | Hayır | Vision endpoint'leri `stopped` raporlar. |
| launchd `com.elara.middleware` | Üretimde evet | Restart: `launchctl kickstart -k gui/$UID/com.elara.middleware`. |

---

## 7. Boot Hata Modları (teşhis tablosu)

| Belirti | Kök neden | Çözüm |
|---|---|---|
| `initX must be called before mountXRoutes` | `mount*` `init*`'ten önce çağrılmış | Çağrı sırasını düzelt. |
| `Cannot access 'X' before initialization` (TDZ) | `deps`'e geçilen sembol boot'ta daha aşağıda tanımlı | Wrapper getter kullan: `x: (...a) => x(...a)`. |
| `column "..." does not exist` | Handler `migrateReady`'yi beklemiyor | Handler başına `await migrateReady` ekle. |
| EX_CONFIG(78) launchd crash loop | plist `__BUN__`/`__PROJECT_ROOT__` placeholder'ları hydrate edilmemiş | `install-launchd.sh` ile kur. |
| `[boot] UYARI — beklenen db='elara_db' ama bağlanılan='...'` | `PGDATABASE`/URL çakışması | `DATABASE_URL` path'ini düzelt. |
| HTTPS sessizce yok | Sertifika dosyaları eksik | `bash local-server/scripts/issue-cert.sh`. |

---

*Bu spesifikasyon `server.mjs` satır sırasından üretildi; dosya yeniden düzenlenirse
bölüm 2 ve 3'teki sıralar tekrar doğrulanmalıdır.*
