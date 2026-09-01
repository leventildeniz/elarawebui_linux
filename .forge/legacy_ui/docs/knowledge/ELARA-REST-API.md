# ELARA — Frontend ⇄ Middleware REST API Referansı

**Sürüm:** 2026-08-13 · **Kaynak:** `src/lib/api-client.ts` (frontend sözleşmesi) + `local-server/lib/routes/*.mjs` (sunucu implementasyonu)
**Bridge (middleware) taban adresi:** varsayılan `http://<mac-host>:3005` — frontend `getBridgeCandidates()` ile aday listesini dener.

---

## 0. Ortak Kurallar (Transport Contract)

### 0.1 İstek başlıkları (her çağrıda otomatik eklenir)

`actorHeaders()` — `src/lib/api-client.ts:299`

| Header | Kaynak | Açıklama |
|---|---|---|
| `Content-Type: application/json` | sabit | FormData yüklemelerinde gönderilmez (tarayıcı boundary koyar) |
| `x-user` | `localStorage.user.username` | Aktör kimliği (capability scoping) |
| `x-session-id` | `localStorage.user.sessionId` | **Gerçek yetki kaynağı** — session-gate bunu DB'de doğrular |
| `x-user-role` | `localStorage.user.role` | Yalnız UI ipucu; sunucu DB rolünü kullanır |
| `x-user-now` | tarayıcı saati (ISO) | Realtime bağlam ipucu |
| `x-user-tz` | IANA TZ | Realtime bağlam ipucu |
| `x-admin-token` | (opsiyonel, CLI) | Yalnızca **loopback**'ten ve `ADMIN_API_TOKEN` ile eşleşirse admin sayılır |

### 0.2 Yanıt zarfı

Çoğu endpoint şu zarfı kullanır:

```jsonc
{ "ok": true,  ...payload }
{ "ok": false, "error": "insan-okur mesaj" }
```

CRUD uçlarının bir kısmı (identity/users, agents list) doğrudan dizi/nesne döner — tabloda belirtildi.

### 0.3 Hata kodları

| Kod | Anlam |
|---|---|
| 400 | Eksik/geçersiz gövde alanı (`error: "x required"`) |
| 401 | `auth_required` — geçerli `x-session-id` yok / kimlik doğrulama başarısız |
| 403 | `role_required` — oturum geçerli ama rol yetersiz; ya da hesap `locked/disabled/expired` |
| 404 | Kaynak yok (dosya, plan, run) |
| 500 | Sunucu/DB hatası (`error` string) |
| 502 | Alt sistem (Python yorumlayıcı, MLX, worker) yanıt vermedi |
| 503 | Alt sistem hazır değil (`reason: "worker_not_ready"`) |

### 0.4 Client davranışı

- Timeout: varsayılan **60 s** (`opts.timeoutMs`); ajan çalıştırma 120 s, sync SSE 24 s.
- Circuit breaker: başarısız base URL **8 s** ölü işaretlenir; `/health` içeren yollar breaker'ı bypass eder.
- Retry: `opts.retries` (varsayılan 0), exponential backoff `400ms * 2^n`.
- 4xx → anında `Error` fırlatır (bridge "çalışıyor" sayılır); 5xx → bir sonraki aday base denenir.

---

## 1. Python API (`PythonAPI`)

Modül: `local-server/lib/routes/python.mjs` · Client: `src/lib/api-client.ts:1765`

### DTO'lar

```ts
interface PythonPrimary {
  path: string;        // mutlak dosya yolu, ör. /opt/homebrew/bin/python3.12
  version: string;     // "Python 3.12.4" (banner çıktısı)
  sealed_at: string;   // ISO-8601, mühürlenme anı
}

interface PythonRuntime {
  id: string;          // "rt-1717171717171"
  name: string;        // operatör etiketi
  python: string;      // yorumlayıcı yolu
  venv: string;        // venv kök dizini ("" olabilir)
  packages: string[];  // ["httpx","pillow"]
  status: string;      // persist sırasında daima "idle"e normalize edilir
}
```

### 1.1 `POST /api/python/detect` — yorumlayıcı doğrula

**Request**
```json
{ "path": "~/venvs/elara/bin/python" }
```
`~/` otomatik `$HOME` ile genişletilir.

**Response 200**
```json
{ "ok": true, "path": "/Users/levent/venvs/elara/bin/python", "version": "Python 3.12.4" }
```
**Hatalar:** `400 not a file` · `404 <fs error>` · `502 no version banner` (2500 ms `--version` timeout)

Client `.catch()` ile hatayı da `{ ok:false, path, version:"", error }` şekline indirger — UI hiçbir zaman throw görmez.

### 1.2 `GET /api/python/primary` — mühürlü ana yorumlayıcı

**Response 200** — `{ "ok": true, "primary": PythonPrimary | null }`
`app_settings` tablosunda `key='python.primary'` satırından okunur. Forge action, Library script ve `interpreter_path` verilmemiş ajan koşumları bu yola düşer.

### 1.3 `POST /api/python/primary` — ana yorumlayıcıyı mühürle / kaldır

**Request** — `{ "path": "/usr/bin/python3" }` · boş string ⇒ mühür **silinir**.

**Response 200**
```json
{ "ok": true, "primary": { "path": "/usr/bin/python3", "version": "Python 3.11.6", "sealed_at": "2026-08-13T17:00:00.000Z" } }
```
Kaydetmeden önce `statSync` + `--version` doğrulaması yapılır (400/502).

### 1.4 `GET /api/python/runtimes` — `listRuntimes`

**Request:** parametre yok.
**Response 200** — `{ "ok": true, "runtimes": PythonRuntime[] }`
Kaynak: `app_settings.key='python.runtimes'` (JSON dizi). Satır yoksa `[]` döner (hata değil).
Client hata halinde `{ ok:false, runtimes: [] }` döndürür — UI listesi asla undefined olmaz.

### 1.5 `PUT /api/python/runtimes` — tüm listeyi değiştir (replace semantiği)

**Request**
```json
{ "runtimes": [
  { "id":"rt-1", "name":"netsec", "python":"/opt/homebrew/bin/python3.12",
    "venv":"~/venvs/netsec", "packages":["httpx","scapy"] }
] }
```
Alanlar sunucuda normalize edilir: `id` yoksa `rt-<epoch>`, `packages` dizi değilse `[]`, `status` daima `"idle"`.

**Response 200** — `{ "ok": true, "count": 1 }` · **400** `runtimes[] required`

> Not: PATCH/DELETE yoktur — liste bütün olarak yazılır (idempotent replace).

---

## 2. Agent API (`AgentsAPI`)

Modüller: `agents-crud.mjs`, `agent-run.mjs`, `agents-extra.mjs`, `agent-bindings.mjs`

### 2.1 Temel DTO

```ts
interface AgentRow {
  id: string; name: string; model: string | null;
  status: "idle" | "active" | "error";
  bridge_url: string | null; meta?: Record<string, unknown> | null;
  port?: number | null; last_active?: string | null;
  agent_path?: string;          // diskteki .py
  interpreter_path?: string;    // boşsa python.primary
  calls: number; success: number; updated_at: string;
  priority?: number | null;     // 1..10 orkestratör önceliği
  stop_grace_ms?: number | null;// SIGTERM→SIGKILL penceresi (0..600000)
  effective_squad?: string;     // override ?? disk meta.squad ?? "Unassigned"
  capability_pack_id?: string | null;
  capability_pack_ids?: string[];
}
```

### 2.2 CRUD & yaşam döngüsü

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/agents` | – | `AgentRow[]` (çıplak dizi) |
| POST | `/api/agents` | `Partial<AgentRow> & { name, credentials?: {name,value}[] }` | `{ ok, agent }` |
| PUT | `/api/agents/:id` | `Partial<AgentRow> & { credentials? }` | `{ ok, agent }` |
| DELETE | `/api/agents/:id` | – | `204` |
| POST | `/api/agents/:id/toggle` | `{ enabled?: boolean }` | `AgentToggleResult` |
| POST | `/api/agents/:id/activate` | – | `AgentToggleResult` |
| POST | `/api/agents/:id/deactivate` | – | `AgentToggleResult` |
| POST | `/api/agents/:id/squad` | `{ squad: string \| null }` | `{ ok, agent? , error? }` |

```ts
interface AgentToggleResult {
  ok: boolean; status: "idle"|"active"|"error";
  bridge: { ok: boolean; message: string; skipped?: boolean };
  signal?: boolean;
}
```

### 2.3 Keşif / doğrulama

| Method | Path | Response |
|---|---|---|
| GET | `/api/agents/discover` | `{ roots: string[], scripts: DiscoveredScript[] }` |
| GET | `/api/agents/discovery-roots` / PUT aynı yol | kök dizin listesi |
| GET | `/api/agents/browse?path=` | `{ ok, path, parent, home, shortcuts[], dirs[], files[] }` |
| GET | `/api/agents/interpreters` | `{ interpreters: { path, version, kind:"venv"\|"conda"\|"system" }[] }` |
| POST | `/api/agents/validate` | body `{ agent_path, interpreter_path }` → `{ ok, scriptOk, interpreterOk, interpreterVersion, issues[] }` |
| POST | `/api/agents/scan` · `/api/agents/seed-from-disk` | diskten DB'ye senkron; `{ ok, root, squads[], created[], updated[], skipped[] }` |
| POST | `/api/agents/reload-manifests` | `@tools` manifest yeniden okuma |
| GET | `/api/agents/manifest-preview` | ajanın system prompt'una enjekte edilecek manifest önizlemesi |

### 2.4 Çalıştırma — `POST /api/agents/:id/run`

**Request (JSON, senkron mod)**
```jsonc
{
  "params": { "target": "1.1.1.1" },   // ajana stdin JSON olarak gider
  "text":   "fortigate NAT nasıl?",    // serbest metin (alternatif: "query")
  "locale": "en",
  "ephemeralCredentials": { "API_KEY": "…" },  // opsiyonel, tek koşumluk env
  "debugDumpPrompt": false
}
```

**Response 200 — `AgentRunResult`**
```ts
{
  ok: boolean; latencyMs: number;
  stdout: string; stderr: string;
  parsed: unknown;                 // stdout JSON parse edilebildiyse
  error: string | null;
  agent_error?: { code: string; text: string };
  bridge?: "local-agent" | string;
  runId?: string;
  rag?: AgentRagMeta;              // retrieval telemetrisi (bkz. 2.5)
}
```

**Streaming mod** — aynı endpoint, body'ye `"stream": true` eklenir veya `Accept: text/event-stream` gönderilir. Ek alanlar: `thread_id`, `user_message_id`, `assistant_message_id`, `user_content`, `model`.

SSE çerçeveleri (`data: {...}\n\n`):

| `type` | Payload |
|---|---|
| `agent_thinking` | `{ runId, pid, phase, hits?, decision? }` |
| `agent_chunk` | `{ delta: string }` |
| `agent_done` | `{ ok, cancelled, latencyMs, runId, error, agent_error, rag, telemetry:{thinkMs,ragMs,totalMs,tokensOut}, stderr }` |
| `agent_error` | `{ code, text, error }` |

Client timeout 120 s (`AgentsAPI.run`), stream modunda yok.

### 2.5 RAG telemetrisi (`AgentRagMeta` — özet)

```ts
{
  enabled: boolean; mode?: string; hits: number;
  decision?: "inject" | "skip" | "empty";
  reason?: string | null; top1?: number; tau?: number;
  confidence?: { score, label:"high"|"mid"|"low", signals:{topScore,topGap,sourceCount} };
  queryRewritten?: string | null; reranked?: boolean;
  rerankInfo?: { used, ms?, model?, reason? };
  fallback?: { kind:"in_library_miss"|"out_of_library", brand?, brands? };
  sources?: { index, name, path, brand, ord, page?, pageEnd?, accessLevel?, score }[];
  diag?: { qForRetrieval, ftsRows, ftsTop, topCoverage, vectorRowsByBrand, rejectedTop, … };
}
```

### 2.6 İzleme & iptal

| Method | Path | Response |
|---|---|---|
| GET | `/api/agents/runs` | `{ ok, runs: LiveAgentRun[], counts: Record<string,number>, ts }` |
| GET | `/api/agents/run-history?limit=&agentId=&packId=` | `{ ok, items: AgentRunHistoryRow[] }` |
| POST | `/api/agents/:id/cancel?runId=` | body `{ runId?, graceMs? }` → `{ ok, cancelled?, reason? }` |
| GET | `/api/telemetry/agent-status` | ajan runtime durum tablosu |

```ts
interface LiveAgentRun { runId; agentId; script; pid; startedAt; ageMs; cancelRequested; stopGraceMs }
interface AgentRunHistoryRow {
  run_id; agent_id; tool_id?; script; source; username;
  status: "ok"|"error"|"cancelled"; exit_code; signal;
  started_at; finished_at; duration_ms; stdout_tail; stderr_tail;
}
```

### 2.7 Yetenek & bağlama (bindings)

| Method | Path | Gövde / Yanıt |
|---|---|---|
| GET/PUT | `/api/agents/:id/capabilities` | `{ ok, skill_ids: string[], tool_ids: string[] }` |
| GET | `/api/agents/:id/resolved-capabilities` | pack'lerden miras alınan birleşik küme |
| GET/PUT | `/api/agents/:id/adapter-bindings` | `{ ok, ids: string[] }` |
| GET/PUT | `/api/agents/:id/target-bindings` | hedef/grup bağlamaları |
| GET/PUT | `/api/agents/:id/rag-bindings` | `{ ok, file_ids: string[] }` — retrieval kapsamı |
| GET/PUT | `/api/agents/:id/vault-bindings` | secret referansları (değer dönmez) |
| POST | `/api/agents/tool-call` | ajanın loopback tool dispatch'i (manifest kapılı) |
| GET | `/api/agents/squads` · POST · PATCH `/:name` · DELETE `/:name` | squad CRUD |

---

## 3. System API (`SystemAPI`, `SystemEngineAPI`, `EngineRuntimeAPI`)

### 3.1 Sağlık & envanter

| Method | Path | Response |
|---|---|---|
| GET | `/api/health` · `/health` | `HealthDTO` |
| GET | `/api/health/deep` | alt sistem derin probe |
| GET | `/api/system/info` | `SystemHardwareInfo` (CPU/RAM/GPU/disk) |
| GET | `/api/system/host` | `{ ok, host, pid }` |
| GET | `/api/system/engine` | `EngineSnapshot` (server/llm/embed/database/worker) |
| GET | `/api/system/local-models` | `{ id, modelName?, provider, base, ctx }[]` |
| GET | `/api/system/chat-templates` | `{ families: ChatTemplateFamilyDTO[] }` |
| GET | `/api/system/transports` | `{ transports: TransportOptionDTO[] }` — `mlx_local` \| `openai_compatible` |
| GET | `/api/system/mlx-sockets` | MLX port sahibi PID/soket durumu |

```ts
interface EngineSnapshot {
  ok: boolean;
  server:   { port; host; uptime_s; uploadDir; cors: string[]; pid; node };
  llm:      { baseUrl: string|null; model: string|null; provider?: "mlx"|"legacy"|"custom" };
  embed:    { model; baseUrl; configured: boolean; dim: number };
  database: { url: string|null; pool: { max; idle; total; waiting } };
  worker:   { port; status; pid; uptime_s; backend; model; lastError };
}
```

### 3.2 Worker & runtime kontrolü

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/system/worker/status` | – | `WorkerStatus` |
| POST | `/api/system/worker/start` | – | `{ ok, status, port, error? }` |
| POST | `/api/system/worker/stop` | – | `{ ok, status }` |
| POST | `/api/system/restart-worker` | – | port kill + cooldown/breaker reset + spawn |
| POST | `/api/system/restart-mlx` | – | `{ ok, killed, beforePids, afterPids, realRestart }` |
| POST | `/api/system/restart-runtime` | – | aktif runtime sağlayıcıyı yeniden başlatır |
| POST | `/api/system/hardware` | `{ cpuAllocPct, mlxRamGb }` | `{ ok }` |

```ts
interface WorkerStatus {
  status: "down"|"starting"|"online-auto"|"online-external";
  port; pid: number|null; uptime_s; backend: string|null;
  model: string|null; dim: number|null; healthy: boolean; lastError: string|null;
}
```

### 3.3 İşler (jobs), servisler, allowlist

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/system/jobs?recent=20` | – | `{ ok, host, active: SystemJobRow[], recent: SystemJobRow[] }` |
| GET | `/api/system/jobs/:type` | `type ∈ backfill\|nuke\|reprocess\|sync\|cve_refresh\|retention` | `{ ok, host, job }` |
| POST | `/api/system/jobs/:type/stop` | – | `{ ok, owner }` |
| POST | `/api/services/probe` | `{ services: [{ key, name, url?, kind?:"http"\|"postgres" }] }` | `{ ts, services:[{ key,name,state,latency,detail? }] }` |
| POST | `/api/services/:key/:action` | `action ∈ start\|stop\|restart` | `{ ok, message }` |
| GET/POST | `/api/system/agents-allowlist` · `/api/system/tools-allowlist` · `/api/system/tools-denylist` | liste gövdesi | `{ ok, items }` |
| GET/POST | `/api/system/intent-guard` | `{ mode: "auto"\|"force-on"\|"force-off" }` | `{ ok, mode }` |

### 3.4 Motor ayarları (`/api/engine/*` — `engine.mjs`)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/engine/intent-config` | – | `{ ok, config: IntentConfigDTO, bounds, modes, classifierModes, defaultClassifierPrompt }` |
| POST | `/api/engine/intent-config` | `Partial<IntentConfigDTO>` | `{ ok, config }` — `app_settings.intent.config`'e persist |
| GET | `/api/engine/runtime` | – | `{ ok, config:{provider,baseUrl,model,models}, resolved:{…,isMlx,hydrated,updatedAt}, presets, providers }` |
| POST | `/api/engine/runtime` | `{ provider?: "mlx"\|"legacy"\|"custom", baseUrl?, model?, models? }` | aynı zarf; DB'ye mühürlenir (500 = persist hatası) |
| GET | `/api/engine/watchdog` | – | `{ ok, config, floors, workerSelfHeal, workerSelfHealFloors, persisted }` |
| POST | `/api/engine/watchdog` | `{ headersMs, firstTokenMs, idleDeltaMs, …, workerSelfHeal?:{cooldownMs,respawnMax} }` | `{ ok, config, workerSelfHeal, persisted }` |
| GET/POST | `/api/engine/transport` | `{ resetUrl?, resetEnabled?, heartbeatEnabled?, heartbeatMs? }` | MLX transport snapshot (`state ∈ idle\|warm\|serving\|dirty\|restarting`, `invariants`) |

```ts
interface IntentConfigDTO {
  technicalThreshold: number;              // 0..1
  forceRagMode: "auto"|"always"|"never";
  semanticThreshold: number;               // 0.05..1
  classifierMode: "embedding"|"llm"|"hybrid";
  classifierPrompt: string;                // ≤4000 karakter
}
```
Watchdog tabanları (altına inilemez): `headersMs 90000, firstTokenMs 30000, idleDeltaMs 5000, warmingNoticeMs 1000, coldFirstTokenMs 60000, streamTimeoutMs 60000, warmupTimeoutMs 5000`.

### 3.5 Akışlar (SSE)

| Path | Olay gövdesi |
|---|---|
| `GET /api/system/logs/stream` | `{ ts, source: "server"\|"worker", line }` |
| `GET /api/audit/stream` | audit olayları + 15 s keep-alive heartbeat |
| `GET /api/metrics/stream` | `MetricsFrame` |
| `GET /api/system/bridge-stream` | bridge durum olayları |

---

## 4. Knowledge API (`KnowledgeAPI`)

Modüller: `knowledge-ingest.mjs`, `knowledge-retrieve.mjs`, `knowledge-sync.mjs`, `knowledge-audit.mjs`, `knowledge-maintenance.mjs`

### 4.1 Okuma / listeleme

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/api/knowledge/sources` | – | `{ ok, sources: [{ id, name, type:"file"\|"url"\|"drive"\|"archive", chunks, progress, url?, tag?, notes? }] }` |
| GET | `/api/knowledge/collections` | – | `{ ok, items: [{ id, chunks }] }` |
| GET | `/api/knowledge/brands` | – | `{ ok, items: [{ brand, files, chunks }] }` |
| GET | `/api/knowledge/library-brands` | – | RAG free-answer için marka listesi (5 dk cache) |
| GET | `/api/knowledge/search` | `q`, `role?` | `{ ok, results: [{ id,name,path,ext,size_bytes,rank }] }` |
| GET | `/api/knowledge/chunk-preview` · `/chunk-report` · `/brand-audit` | çeşitli | denetim çıktıları |
| GET | `/api/knowledge/embeddings/health` | – | `EmbeddingHealthDTO` (pending/ok/error sayaçları) |

### 4.2 İçe alma (ingest)

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/knowledge/file` | **multipart/form-data**: `file`, `tag?`, `brand?` | `{ ok, id, name, chunks, error? }` |
| POST | `/api/knowledge/text` | `{ name?, content, tag?, brand? }` | `{ ok, id, chunks, error? }` |
| POST | `/api/knowledge/fetch` | `{ url, tag?, brand? }` | URL çekip chunk'lar |
| POST | `/api/knowledge/url-probe` | `{ url }` | erişilebilirlik/mime önizleme |
| POST | `/api/knowledge/index-directory` | `{ path, recursive?, allowedRoles?, requireRole? }` | `{ ok, scanned, indexed, skipped, removed, durationMs, error? }` (client timeout 120 s) |
| PATCH | `/api/knowledge/source/:id/brand` | `{ brand: string \| null }` | `{ ok, updated }` |
| POST | `/api/knowledge/source/:id/crawl-config` | crawl derinlik/kural gövdesi | `{ ok }` |

Yükleme `XMLHttpRequest` ile yapılır (`upload.onprogress` → yüzde çubuğu), timeout 600 s.

### 4.3 Senkronizasyon (job + SSE)

1. `POST /api/knowledge/sync` — body `{ root? }` → `{ ok, jobId, status }` (client timeout 15 s)
2. `GET /api/knowledge/sync/:jobId/events` — SSE:
   - `event: progress` → `{ progress, total, status, stage?, scanned?, indexed?, skipped?, currentFile? }`
   - `event: done` → `{ status:"completed"|"failed", results:{ results[], sourcesRefreshed, urlsRefetched }, durationMs, error? }`
3. SSE düşerse **polling fallback**: `GET /api/knowledge/sync/:jobId` (1.5 s aralık, visibility-aware; sekme gizliyken `visibilitychange` ile uyandırılır)
4. `GET /api/knowledge/sync/:jobId/log` — ham log · `POST /api/knowledge/sync/:jobId/cancel` — iptal
5. `GET /api/knowledge/sync-jobs` — geçmiş işler · `POST /api/knowledge/sync-source` — tek kaynak yenile

### 4.4 Retrieval

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/knowledge/retrieve` | `{ query, topK?, brands?, fileIds?, collections? }` | `{ ok, rows:[{ content, path, brand, ord, score, rerank_score }], meta }` |
| POST | `/api/rag/probe` | `{ query }` | `{ ok, top1, rows }` — hafif vektör probu |
| GET | `/api/rag/settings` · POST aynı yol | RAG knob nesnesi (tek mercii UI) | `{ ok, settings }` |
| GET | `/api/rag/status` · `/api/rag/health` | – | pipeline durum özeti |
| GET | `/api/rag/intent-telemetry` | – | intent sınıflandırıcı istatistikleri |

### 4.5 Bakım / onarım (admin)

| Method | Path | Etki |
|---|---|---|
| POST | `/api/knowledge/embeddings/backfill` | eksik embedding'leri kuyruğa alır (SSE `EmbeddingBackfillEvent`) |
| POST | `/api/knowledge/embeddings/mark-pending` | seçili chunk'ları yeniden kuyruğa yazar |
| POST | `/api/knowledge/embeddings/library-path` · `/validate` | kütüphane kök yolu mühürle/doğrula (`LibraryPathValidation`) |
| POST | `/api/knowledge/cleanup` · `/purge` | hayalet kayıt temizliği / tam silme (iki-guard'lı) |
| POST | `/api/knowledge/url-purge-all` · `/url-rechunk-all` · `/checkpoint-url-purge` | URL kaynak bakımları |
| POST | `/api/rag/retry-embeddings` | başarısız embedding'leri tekrar dener (worker preflight'lı; worker kapalıysa **503** `worker_not_ready`) |
| POST | `/api/rag/repair-fts` · `/dedupe-chunks` · `/brand-backfill` · `/nuke-reindex` | indeks onarımları |
| GET | `/api/rag/diagnose-corpus` · `/diagnose-query` · `/diagnose-html` · `/diagnose-join` · `/self-audit` | teşhis raporları |
| GET/POST | `/api/rag/brand-aliases` (+ `/reenrich`) | marka alias yönetimi (UI: `/knowledge/aliases`) |

---

## 5. Identity / Auth / Session Akışı

Modüller: `local-server/lib/routes/identity.mjs`, `local-server/lib/session-gate.mjs`, `local-server/lib/schema-auth.mjs`

### 5.1 Uçtan uca akış

```text
1) UI  →  POST /api/auth/login { username, password, provider, device }
2) MW  →  provider="local"   : app_users satırı + scrypt/hash doğrulaması
          provider="ldap"    : authenticateLdap(cfg,…)  → ensureFederatedUser()
          provider="radius"  : authenticateRadius(cfg,…)→ ensureFederatedUser()
3) MW  →  aynı (username, ip, device) için eski app_sessions satırını siler
4) MW  →  sid = "s_<random>" üretir, app_sessions'a INSERT eder
5) MW  →  agent_logs'a login kaydı yazar (enqueueWrite)
6) UI  →  localStorage.user = { username, role, sessionId }
7) UI  →  sonraki her istekte x-session-id / x-user / x-user-role başlıkları
8) MW  →  attachSessionContext(): sid'i DB'de doğrular, req.session'ı DB rolüyle doldurur
9) UI  →  POST /api/sessions/:id/heartbeat (keepalive) ile last_seen tazelenir
10) UI →  DELETE /api/sessions/:id ile oturumu kapatır (logout)
```

### 5.2 `POST /api/auth/login`

Rate limit: `rlLogin` middleware.

**Request**
```json
{ "username": "admin", "password": "•••", "provider": "local", "device": "Chrome/macOS", "ip": "" }
```
`provider ∈ local | ldap | radius | saml | oidc | oauth2` (varsayılan `local`).
Gerçek IP sunucuda şu sırayla çözülür: `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for` (loopback olmayan ilk) → soket IP → body `ip`; hiçbiri yoksa `127.0.0.1`.

**Response 200**
```json
{ "ok": true, "user": { "id":"u_…","username":"admin","role":"Admin","provider":"local","groups":[], "status":"active", "…": "IdentityUserDTO" }, "sessionId": "s_9f2c…" }
```

**Hatalar**
| Kod | Gövde | Sebep |
|---|---|---|
| 400 | `username and password required` | eksik alan |
| 400 | `<provider> provider disabled` | federated sağlayıcı kapalı |
| 401 | `invalid credentials` / sağlayıcı mesajı | hatalı parola / bind başarısız |
| 403 | `account locked` \| `account disabled` \| `account expired` | `status ≠ active` veya `valid_until` geçmiş |
| 500 | DB/istisna mesajı | – |

### 5.3 Session gate (yetkilendirme motoru)

`attachSessionContext()` her istekte çalışır ve **asla hata fırlatmaz**:

- `x-admin-token` gönderilmişse: `ADMIN_API_TOKEN` set **ve** eşleşiyor **ve** istek loopback ise → `req.session = { id:"admin-token", username:"admin-cli", role:"admin", provider:"admin-token" }`. Aksi halde tek satır log + reddedilir (token değeri asla loglanmaz).
- `x-session-id` varsa `app_sessions` + `app_users` join edilir; **rol önceliği: DB rolü > session rolü > "user"**.
- 24 saatten eski `last_seen` → oturum yok sayılır; geçerliyse `last_seen` arka planda güncellenir.

`requireSession({ roles })` kapısı:
- oturum yok → **401** `{ ok:false, error:"auth_required", message }`
- rol yetersiz → **403** `{ ok:false, error:"role_required", required:[…], actual }`

`isAdminFromSession(req)` — header değil, doğrulanmış sid üzerinden admin kontrolü.
`/api/auth/*` ve `/api/sessions/*` mutasyon kapısından muaftır (`FAZ2_PUBLIC_MUTATION_PREFIXES`).

### 5.4 Session endpoint'leri

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/sessions` | – | `SessionDTO[]` — çağrı anında 5 dk'dan eski satırlar silinir, çağıranın `last_seen`'i tazelenir |
| POST | `/api/sessions/:id/heartbeat` | – (keepalive fetch) | `{ ok }` |
| DELETE | `/api/sessions/:id` | – | `204` (logout / uzaktan düşürme) |

```ts
interface SessionDTO { id; username; role; provider; ip; device; connectedAt; lastSeen }
```

### 5.5 Kullanıcı / grup / RBAC yönetimi

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/identity/users` | – | `IdentityUserDTO[]` |
| POST | `/api/identity/users` | `Partial<IdentityUserDTO>` (+`password`) | `IdentityUserDTO` · 400 `username required` |
| PUT | `/api/identity/users/:id` | `Partial<IdentityUserDTO>` | `IdentityUserDTO` |
| DELETE | `/api/identity/users/:id` | – | `204` |
| GET | `/api/identity/groups` | – | `IdentityGroupDTO[]` |
| POST | `/api/identity/groups` | `Partial<IdentityGroupDTO>` | `{ ok, id }` |
| DELETE | `/api/identity/groups/:id` | – | `204` |
| GET | `/api/identity/rbac` | – | `IdentityRbacRuleDTO[]` |
| PUT | `/api/identity/rbac` | `IdentityRbacRuleDTO[]` | `{ ok, count }` |
| GET/PUT | `/api/identity/auth-providers` | `{ providers: AuthProviderRow[] }` | `{ ok, providers }` / `{ ok, count }` — secret alanlar (`bindPassword`, `secret`, `clientSecret`) sunucuda şifrelenir, GET'te çözülür |
| POST | `/api/auth/test/:provider` | sağlayıcı konfig gövdesi | `{ ok, message, latencyMs }` — gerçek LDAP bind / RADIUS UDP probe |

```ts
interface IdentityUserDTO {
  id; username; email; phone; password?;            // password yalnız yazma
  provider; role; groups: string[]; templateId?;
  status: "active"|"locked"|"disabled"; validUntil?;
  mustChangePassword: boolean; avatarUrl?;
  allowedProviders?: string[]; canOverrideProvider?: boolean;
  allowedModels?: string[];    canOverrideModel?: boolean;
  allowedAgents?: string[]; allowedTools?: string[]; allowedSkills?: string[];
  createdAt; lastLoginAt?;
}
interface IdentityGroupDTO { id; name; description; role; provider; templateId?; members: string[] }
interface IdentityRbacRuleDTO { id; match; provider; role }
interface AuthProviderRow { id:"local"|"ldap"|"radius"|"saml"|"oidc"|"oauth2"; enabled: boolean; config: Record<string,unknown> }
```

### 5.6 Sekme bazlı yetki (`/api/rbac/*`)

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/rbac/tabs` | – | `{ ok, allTabs: string[], entries: [{ scope_type, scope_id, allowed_tabs, updated_at }] }` |
| PUT | `/api/rbac/tabs` | `{ scopeType:"role"\|"template"\|"user", scopeId, allowedTabs: string[] }` | `{ ok }` · 400 geçersiz scope |
| GET | `/api/rbac/me?role=&templateId=&userId=` | – | `{ ok, allowedTabs, role, admin }` — `role="Admin"` ⇒ tüm sekmeler; hiç eşleşme yoksa `["chat"]` |

### 5.7 Kullanıcı tercihleri

`GET /api/me/prefs` · `PUT /api/me/prefs` → `{ ok, prefs: Record<string,unknown>, updatedAt }` (tema, font, locale, chat sırası…). Hata halinde client `{ ok:false, prefs:{} }` döndürür.

---

## Ek A — Diğer endpoint aileleri (referans)

`/api/chat/stream`, `/api/chat/orchestrate` (SSE) · `/api/threads`, `/api/messages` · `/api/models`, `/api/providers`, `/api/model-identities` · `/api/skills`, `/api/tools`, `/api/forge/actions`, `/api/capabilities`, `/api/capability-packs`, `/api/user-capabilities` · `/api/meta-forge/plans` (+`/apply`,`/reject`,`/rollback`,`/undo`) · `/api/workflows`, `/api/chains`, `/api/workflow-runs` · `/api/mcp/*` (server+client+exposures+tokens) · `/api/vault`, `/api/vault-audit` · `/api/targets`, `/api/target-groups`, `/api/adapters` · `/api/telemetry/*`, `/api/metrics/*`, `/api/logs`, `/api/audit/stream` · `/api/backup/*`, `/api/migrations`, `/api/database/stats` · `/api/vision/*`, `/api/tts`, `/api/stt`, `/api/voice-profiles` · `/api/webhooks/*` (telegram, whatsapp, teams, signal, generic).

Toplam kayıtlı HTTP handler: **~400** (`rg "app\.(get|post|put|patch|delete)\(" local-server`).
