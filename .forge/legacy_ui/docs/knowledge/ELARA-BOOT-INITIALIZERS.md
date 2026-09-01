# ELARA — `init*` Başlatma Fonksiyonları Envanteri

Tarih: 2026-08-14 · Kaynak: `local-server/` (boot dosyası `server.mjs`, 4945 satır)

**Özet:** Sorulan 13 fonksiyonun **tamamı** `server.mjs` dışına, `local-server/lib/**` altındaki
kendi modüllerine taşınmış durumda. `server.mjs` içinde yalnızca **import + tek satır çağrı
(call-site)** kalmıştır. Hepsi *dependency injection* (DI) desenini kullanır: `pool` ve gerekli
yardımcılar dışarıdan verilir, modül global state tutmaz (ya modül-scope `_pool`, ya closure).

---

## 0. Hızlı Tablo

| # | Fonksiyon | Modül dosyası | server.mjs call-site | İmza | Döndürdüğü |
|---|-----------|---------------|----------------------|------|------------|
| 1 | `initRuntimeRegistry` | `lib/runtime-registry.mjs:9` | `:740` | `({ pool })` | `void` (modül-scope `_pool`) |
| 2 | `initSessionGate` | `lib/session-gate.mjs:21` | `:765` | `(pool)` | `void` |
| 3 | `initToolAdapters` | `lib/tool-adapters.mjs:29` | `:770` | `(pool)` | `void` |
| 4 | `initWorkflowEngine` | `lib/workflow-engine.mjs:30` | `:771` | `(pool)` | `void` |
| 5 | `initIdentitySchema` | `lib/schema-identity.mjs:13` | `:1322` | `({ pool, allTabIds })` | `{ ensureRbacTable, ensureModelIdentitiesTable }` |
| 6 | `initKnowledgeSchema` | `lib/schema-knowledge.mjs:10` | `:2348` | `({ pool, ftsCharLimit })` | `{ ensureKnowledgeFilesTable, ensureKnowledgeChunksTable }` |
| 7 | `initAdaptersSchema` | `lib/schema-adapters.mjs:4` | `:3250` | `({ pool })` | `{ ensureAdapterDictionariesSeed }` |
| 8 | `initAgentsSchema` | `lib/schema-agents.mjs:4` | `:3895` | `({ pool })` | `{ ensureAgentSquadsTable }` |
| 9 | `initProductCache` | `lib/rag/product-cache.mjs:19` | `:3535` | `({ pool, getRagSettings })` | `{ getProductCatalog, detectProductFromQuery }` |
| 10 | `initRagRetrieval` | `lib/rag/retrieval.mjs:165` | `:3536` | `(deps)` — 20 zorunlu dep | `{ ragProbeAndFetch, semanticSearch, _ftsHybridFallback, _buildFtsOrQuery, getLastFtsError, getLastFtsChunkError, getLastFtsSourceError, setLastFtsError }` |
| 11 | `initBrandAliases` | `lib/routes/brand-aliases.mjs:25` | `:3605` | `({ baseDir, pool, getRagSettings, deriveBrandFromKnowledgeSource })` | `void` |
| 12 | `initCockpitAllowlist` | `lib/routes/cockpit-allowlist.mjs:15` | `:1291` | `(deps)` | 9 sembol (aşağıda) |
| 13 | `initWriteQueue` | `lib/write-queue.mjs:17` | `:864` | `({ pool })` | `{ enqueueWrite, getWriteQueueDepths }` |

> Not: satır numaraları 2026-08-14 tarihli ağaç içindir; refactor sonrası kayabilir.
> Sabit olan **dosya yolu**dur.

---

## 1. `initRuntimeRegistry` — `lib/runtime-registry.mjs`

Runtime sağlayıcı (MLX / legacy-Ollama / custom) kaydı. Preset'ler, URL normalizasyonu,
model slug guard'ları ve `app_settings.runtime.provider` hydrate'ı buradadır.

```js
let _pool = null;
export function initRuntimeRegistry({ pool } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("[runtime-registry] initRuntimeRegistry: pool required");
  }
  _pool = pool;
}
```

Call-site (`server.mjs:739-742`) — pool kurulduktan hemen sonra:

```js
// runtime-registry: hydrate fn needs the pool. Wire DI right after pool is built.
initRuntimeRegistry({ pool });
initActorRegistry({ pool });
initBrandRegistry({ pool });
```

Modülün diğer dışa açık sembolleri: `RUNTIME_PROVIDER_PRESETS`, `RUNTIME_PROVIDER_CFG`,
`runtimeBase()`, `runtimeModel()`, `safeRuntimeModel()`, `mlxServingId()`, `runtimeIsMlx()`,
`runtimeUpstreamBase()`, `hydrateRuntimeProviderFromDb()`, `assertModelSlug()`.

---

## 2. `initSessionGate` — `lib/session-gate.mjs`

Bridge auth / oturum kapısı. `x-session-id` başlığını `app_sessions` üzerinden doğrular;
rolü **DB'den** okur (istemci başlığına güvenmez). Loopback + `ADMIN_API_TOKEN` bypass'ı içerir.

```js
let _pool = null;
let _initialized = false;

/** Bir kere çağrılır; bridge DB pool'unu kapıya bağlar. */
export function initSessionGate(pool) {
  _pool = pool;
  _initialized = true;
}
```

Call-site (`server.mjs:762-765`):

```js
// Faz 2 — Session gate'i pool yaratılır yaratılmaz bağla.
initSessionGate(pool);
```

Beraber kullanılan exportlar: `attachSessionContext()` (global `app.use`),
`requireSession({ roles })` (endpoint bazlı kapı), `isAdminFromSession(req)`.

---

## 3. `initToolAdapters` — `lib/tool-adapters.mjs`

Tool çalıştırmayı tek sözleşme altında toplar:
`invokeTool({ toolId, agentId, username, sessionId, runId, params, signal })`.
Adaptörler: `http`, `python`, `mcp`, `forge`, `rbi`, `builtin`.
Politika: DB'den tool okunur → `agent_capabilities` whitelist → `requires_approval` veya
`risk_level ∈ {high, critical}` ise `tool_approvals` satırı açılır → aksi halde adaptör koşar.
Tüm sonuç `tool_invocations`'a yazılır.

```js
let _pool = null;
export function initToolAdapters(pool) { _pool = pool; }
```

Call-site: `server.mjs:770` (`initCapabilityRegistry` / `initDispatcher` ile aynı blok).
Diğer exportlar: `invokeTool`, `decideApproval`, `listPendingApprovals`,
`ApprovalRequired`, `ToolPolicyError`.

---

## 4. `initWorkflowEngine` — `lib/workflow-engine.mjs`

Dayanıklı (durable) DAG orkestratörü. Node tipleri: `skill_call`, `tool_call`, `agent_call`,
`conditional`, `parallel`, `loop`, `human_input`, `transform`, `rbi_isolated`.
Her adım `workflow_steps`'e yazılır; `human_input`/hata run'ı duraklatır, resume token ile devam eder.

```js
import { invokeTool, ApprovalRequired } from "./tool-adapters.mjs";

let _pool = null;
export function initWorkflowEngine(pool) { _pool = pool; }
```

Call-site: `server.mjs:771`.
Diğer exportlar: `startWorkflowRun`, `resumeWorkflowRun`, `cancelWorkflowRun`, `getRunSteps`.

> Sıra kritik: `initToolAdapters(pool)` **önce**, `initWorkflowEngine(pool)` sonra çağrılır.

---

## 5. `initIdentitySchema` — `lib/schema-identity.mjs`

İki idempotent şema bootstrapper + Admin sekme izni self-heal'i.

```js
export function initIdentitySchema({ pool, allTabIds }) {
  if (!pool) throw new Error("initIdentitySchema: pool required");
  if (!Array.isArray(allTabIds) || allTabIds.length === 0) {
    throw new Error("initIdentitySchema: allTabIds (non-empty array) required");
  }
  async function ensureRbacTable() { /* tab_permissions + rol seed'leri */ }
  async function ensureModelIdentitiesTable() { /* model_identities avatar registry */ }
  return { ensureRbacTable, ensureModelIdentitiesTable };
}
```

Tablolar:
- `tab_permissions(scope_type, scope_id, allowed_tabs[])` — rol seed'leri: Admin (= `ALL_TAB_IDS`),
  Engineer, Security, Operator, Viewer.
- `model_identities` — model başına avatar kaydı.

Call-site (`server.mjs:1321-1324`):

```js
const { ensureRbacTable, ensureModelIdentitiesTable } =
  initIdentitySchema({ pool, allTabIds: ALL_TAB_IDS });
ensureRbacTable().catch((e) => console.warn("[rbac:init]", e?.message || e));
```

---

## 6. `initKnowledgeSchema` — `lib/schema-knowledge.mjs`

`knowledge_files` + `knowledge_chunks` boot DDL'i. Her iki `ensure*` **single-flight**
(aynı anda iki çağrı gelse DDL bir kez koşar). `knowledge_chunks` DDL'i dolu tabloda pool'un
varsayılan `statement_timeout`'unu aşabildiği için kendi client'ını açıp tx içinde
`SET LOCAL statement_timeout = 0` yapar.

```js
export function initKnowledgeSchema({ pool, ftsCharLimit }) {
  if (!pool) throw new Error("initKnowledgeSchema: pool required");
  if (!Number.isFinite(ftsCharLimit) || ftsCharLimit <= 0) {
    throw new Error("initKnowledgeSchema: ftsCharLimit (positive int) required");
  }
  const FTS = ftsCharLimit;
  let chunksReady = false, chunksReadyPromise = null;
  let filesReady  = false, filesReadyPromise  = null;
  // ensureKnowledgeChunksTable(): single-flight sarmalayıcı → Impl() → BEGIN;
  //   SET LOCAL statement_timeout=0; CREATE TABLE/INDEX; tsvector generated col.
  return { ensureKnowledgeFilesTable, ensureKnowledgeChunksTable };
}
```

Call-site (`server.mjs:2346-2349`):

```js
const FTS_INPUT_CHAR_LIMIT = 250_000;
const { ensureKnowledgeFilesTable, ensureKnowledgeChunksTable } =
  initKnowledgeSchema({ pool, ftsCharLimit: FTS_INPUT_CHAR_LIMIT });
```

`ftsCharLimit`, `to_tsvector('simple', left(content, …))` generated column'unun
PostgreSQL 1 MB tsvector sınırını patlatmaması için gerekir.

---

## 7. `initAdaptersSchema` — `lib/schema-adapters.mjs`

`adapter_dictionaries` taksonomisi (kind ∈ `category | connection | runner`) + builtin seed +
mevcut `adapters` tablosundan geriye dönük backfill.

```js
export function initAdaptersSchema({ pool }) {
  async function ensureAdapterDictionariesSeed() {
    await pool.query(`CREATE TABLE IF NOT EXISTS adapter_dictionaries (…UNIQUE(kind, value));`);
    await pool.query(`INSERT INTO adapter_dictionaries(kind,value,label,builtin) VALUES
      ('category','cloud','Cloud',true), … ('runner','node','Node',true)
      ON CONFLICT (kind, value) DO NOTHING;`);
    // backfill: adapters.category / connection_type / adapter → dictionary (builtin=false)
  }
  return { ensureAdapterDictionariesSeed };
}
```

Call-site (`server.mjs:3249-3250`):

```js
({ ensureAdapterDictionariesSeed } = initAdaptersSchema({ pool }));
```

---

## 8. `initAgentsSchema` — `lib/schema-agents.mjs`

Tek tablo: `agent_squads` (UI'daki ajan filo gruplaması). `ready` flag'i ile tek sefer koşar.

```js
export function initAgentsSchema({ pool }) {
  let ready = false;
  async function ensureAgentSquadsTable() {
    if (ready) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_squads (
        name text PRIMARY KEY,
        icon text DEFAULT 'Shield',
        color text,
        sort_order int DEFAULT 100,
        created_at timestamptz DEFAULT now()
      )`);
    ready = true;
  }
  return { ensureAgentSquadsTable };
}
```

Call-site (`server.mjs:3894-3895`); disk'ten keşfedilen squad'lar `DISK_SQUAD_SORT = 10`,
operatörün elle açtıkları `sort_order = 100` ile gelir.

---

## 9. `initProductCache` — `lib/rag/product-cache.mjs`

DB kaynaklı `{brand → Set<product>}` kataloğu. Regex/whitelist **yok** — katalog
`knowledge_chunks` üzerinden `DISTINCT (brand, product)` ile türetilir. TTL knob:
`RAG_SETTINGS.productCacheTtlMs` (min 30s, default 5 dk).

```js
export function initProductCache({ pool, getRagSettings }) {
  async function getProductCatalog() { /* TTL cache + GROUP BY brand,product */ }
  async function detectProductFromQuery(q, brandLock = null) { /* token eşleşmesi */ }
  return { getProductCatalog, detectProductFromQuery };
}
```

Call-site: `server.mjs:3535`, hemen `initRagRetrieval`'dan önce — çünkü
`detectProductFromQuery` ona **opsiyonel dep** olarak geçilir.

---

## 10. `initRagRetrieval` — `lib/rag/retrieval.mjs`

RAG çekirdeği (probe + hybrid vector/FTS + rerank). Tüm bağımlılıklar DI ile gelir ve
**fail-loud** doğrulanır.

```js
let DEPS = null;
export function initRagRetrieval(deps) {
  const required = [
    "pool", "getRagSettings", "ROLE_RANK",
    "getActivePackBrandFilter", "getAgentRagBrands",
    "extractTechnicalCore", "isExtBreakerOpen",
    "getLibraryBrands", "detectLibraryMatch",
    "generateHydePassage",
    "qembGet", "qembSet",
    "mlxEmbed", "mlxRerank",
    "getLastRerankError", "getLastEmbedError",
    "expandQueryTerms", "cosine",
    "DEFAULT_RAG_TRGM_THRESHOLD", "DEFAULT_RAG_TRGM_MIN_SCORE",
  ];
  for (const k of required) {
    if (deps[k] === undefined) throw new Error(`initRagRetrieval: missing dep '${k}'`);
  }
  // detectProductFromQuery OPSİYONEL — yoksa productFilter knob'u no-op.
  DEPS = deps;
  return { ragProbeAndFetch, semanticSearch, _ftsHybridFallback,
           _buildFtsOrQuery, getLastFtsError, getLastFtsChunkError,
           getLastFtsSourceError, setLastFtsError };
}
```

Call-site (`server.mjs:3536-3559`) tüm 20 zorunlu dep'i + `detectProductFromQuery`'yi geçer.
Ayrıca `local-server/scripts/agent-rag-doctor.mjs:21` aynı modülü CLI teşhisi için init eder.

---

## 11. `initBrandAliases` — `lib/routes/brand-aliases.mjs`

UI'dan yönetilen marka alias verisi (`GET/POST /api/rag/brand-aliases`, `…/reenrich`).
Depolama artık **HOME altında**: `~/.elara/state/brand-aliases.json` (Lovable code-sync
`local-server/data/`'yı eziyordu). Init anında eski konumdan tek seferlik migration yapılır.

```js
export function initBrandAliases(d) {
  _deps = d;
  const legacy = path.join(d.baseDir, "data", "brand-aliases.json");
  const mig = migrateBrandAliasesIfNeeded(legacy);
  BRAND_ALIASES_PATH = getBrandAliasesPath();
  if (mig.migrated) {
    console.log(`[brand-aliases:migrate] copied ${mig.brandCount} brand(s) from ${mig.from} → ${mig.to}`);
  }
  ENRICH_SCRIPT_PATH = path.join(d.baseDir, "scripts", "enrich-structured-chunks.mjs");
}
```

Call-site (`server.mjs:3605-3611`):

```js
initBrandAliases({
  baseDir: __dirname,
  pool,
  getRagSettings: () => RAG_SETTINGS,
  deriveBrandFromKnowledgeSource,
});
mountBrandAliasesRoutes({ app });
```

Yardımcı exportlar: `spawnBrandReenrich`, `maybeAutoReenrich`, `triggerSyncAutoReenrich`.
Alias runtime sözlüğü **değildir**; yalnız enrichment preamble'ına gömülür.

---

## 12. `initCockpitAllowlist` — `lib/routes/cockpit-allowlist.mjs`

Cockpit allowlist + intent-guard + bridge telemetri endpoint'leri.

```js
export function initCockpitAllowlist(deps) {
  const { pool, getAllowedAgents, setAllowedAgents,
          setAgentsBaseDir, detectExecutionIntent } = deps;
  const INTENT_GUARD = { mode: "auto" }; // "auto" | "force-on" | "force-off"
  async function hydrateIntentGuardFromDb()   { /* app_settings['intent.guard'] */ }
  async function hydrateAllowedAgentsFromDb() { /* disk armed .py ∪ app_settings['agents.allowed'] */ }
  return { INTENT_GUARD, broadcastBridge, hydrateIntentGuardFromDb,
           hydrateAllowedAgentsFromDb, applyExecutionGuard,
           getAllowedToolsList, getDeniedToolsList, isToolAllowed,
           mountCockpitRoutes };
}
```

Call-site (`server.mjs:1281-1299`):

```js
const { INTENT_GUARD, broadcastBridge, hydrateIntentGuardFromDb,
        hydrateAllowedAgentsFromDb, applyExecutionGuard, getAllowedToolsList,
        getDeniedToolsList, isToolAllowed, mountCockpitRoutes } =
  initCockpitAllowlist({ pool, getAllowedAgents, setAllowedAgents,
                         setAgentsBaseDir, detectExecutionIntent });
mountCockpitRoutes(app);
setTimeout(() => { void hydrateIntentGuardFromDb(); … });
```

Allowed-agents semantiği **UNION**: disk'te seal edilmiş `armed` .py dosyaları otomatik
allowed, `app_settings['agents.allowed']` yalnızca operatörün elle eklediği ek listedir.

---

## 13. `initWriteQueue` — `lib/write-queue.mjs`

İki şeritli asenkron yazma kuyruğu — SSE soketini asla bloklamaz.
**CRITICAL**: `chat_messages`, `chat_threads`, `message_feedback` (önce drain edilir).
**SIDE**: `agent_logs`, `provider_usage`, `tool_invocations`, observability vb.
Side drain, her iş arasında critical şeride yol verir. Redaksiyon tabloları
`REDACT_TABLES_RE` ile seçilir (vault hariç — ciphertext bozulmasın).

```js
export function initWriteQueue({ pool }) {
  if (!pool) throw new Error("initWriteQueue: pool is required");
  const criticalWriteQueue = [];
  const sideWriteQueue = [];
  let drainingCritical = false, drainingSide = false;

  function enqueueWrite(sql, params) { /* redact → şerit seç → drain tetikle */ }
  async function drainCritical() { /* FIFO, hata log'lanır, kuyruk durmaz */ }
  async function drainSide()     { /* her turda critical'a yol ver */ }

  return { enqueueWrite, getWriteQueueDepths };
}
```

Call-site (`server.mjs:864`):

```js
const { enqueueWrite, getWriteQueueDepths } = initWriteQueue({ pool });
```

`enqueueWrite` boot'tan sonra `deps` nesnesi üzerinden neredeyse tüm route modüllerine geçirilir.

---

## Boot İçindeki Çağrı Sırası (özet)

```text
bootstrapDatabase()                    ~:735   → pool hazır
  ├─ initRuntimeRegistry({pool})        :740
  ├─ initActorRegistry / initBrandRegistry
  ├─ initSessionGate(pool)              :765
  ├─ initCapabilityRegistry / initDispatcher
  ├─ initToolAdapters(pool)             :770
  └─ initWorkflowEngine(pool)           :771   (tool-adapters'a bağımlı)
initWriteQueue({pool})                  :864
initCockpitAllowlist({...})            :1291 → mountCockpitRoutes(app)
initIdentitySchema({pool, allTabIds})  :1322 → ensureRbacTable()
initKnowledgeSchema({pool, fts})       :2348
initAdaptersSchema({pool})             :3250
initProductCache({pool, ragSettings})  :3535
initRagRetrieval({...20 dep})          :3536
initRagReadOps / initRagDiagnostics
initBrandAliases({...})                :3605 → mountBrandAliasesRoutes(app)
initAgentsSchema({pool})               :3895
```

**Kural:** DI'ya koyduğun her sembol, call-site'ta *tanım < kullanım* sırasında olmalıdır
(aksi halde TDZ `ReferenceError` — daha önce `chat-orchestrate` extraction'ında yaşandı).
