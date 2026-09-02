# ELARA Sovereign Studio — Project Context & State

## 1. Project Architecture
- **Philosophy:** Sovereign, Zero-Trust Enterprise AI OS (Agnostic, No Vendor Lock-in).
- **Stack:** TanStack Start (SSR) + Vite + Tailwind + Zustand | Node.js Express (`api-v2.mjs`) | PostgreSQL 14+ (`elara_db`).
- **Auth:** Stateless HTTP headers (`x-session-id`, URL params for downloads).
- **State:** Zustand strictly fetches from PostgreSQL. `localStorage` is for visual hydration only.

## 2. Completed (Phases 1-4)
- **Settings & Config:** All dummy data (Telemetry, Voice Profiles, AI Providers) replaced with Postgres APIs.
- **Legacy Cleanup:** Removed mock `middleware.tsx`, obsolete runtime panels, and MLX-specific variables.
- **System Engine:** Orchestrator Bridge fetches live data (`/api/agents`, etc.). Backup exports work via browser downloads (URL auth). Sovereign UI dialogs implemented.

## 3. Completed (Phase 5 - Part 1)
- **Live Console:** Fixed SSE stream to `/api/audit/stream`. Added 15s keep-alive heartbeats.
- **Vault (Secret Store):** Removed `localStorage` mock. Created Zustand `useVaultStore` wired to `/api/vault` (PostgreSQL `vault_secrets` AES-256-GCM).
- **Adapters:**
  - Rewrote `/api/adapters` backend to target the actual `adapters` DB table instead of the `tools` table.
  - Rewrote Zustand store to sync dictionaries (Category, Connection, Runner) from PostgreSQL with a static fallback UI render.
  - Implemented dynamic "Vault Name" dropdown selector bound to the selected Vault Scope.
- **Webhooks:** Removed hardcoded `limacm5m.local` references and replaced with dynamic `window.location.origin` bindings.
- **Deployment fix:** Changes now successfully apply by restarting the OS-level `elara-middleware` systemd service instead of background node jobs.

## 4. Completed (Phase 5 - Part 2 & 3 & 4)
- **Planner (Reasoning Engine):**
  - Added `meta` JSONB column to `planners` table in PostgreSQL.
  - Created `planners-crud.mjs` and refactored `usePlanners` to use PostgreSQL.
- **Policy & Security:**
  - Added `kind` to `isolation_profiles` and `action` to `policy_rules`.
  - Created `security-policies.mjs` and wired up all security tabs (GenGuard, Isolation, Signed Workflows, Policy Engine).
- **Python Runtimes (Part 4):**
  - Migrated `useRuntimes` to PostgreSQL via `python-crud.mjs`.
  - Implemented **actual VENV creation** (`python3 -m venv`) and pip package installation when a runtime is set to "running".
  - Made the python path detection OS-agnostic using `command -v python3` instead of hardcoded macOS paths.
  - Refactored the UI's Auto-Detect logic to prioritize the machine's actual Python version while respecting user-entered manual paths, automatically updating the dropdown UI.
  - Fixed partial `PUT` requests (used by the "Stop" button) by strictly checking `!== undefined` to prevent falsy values (like empty strings) from overwriting state.

## 5. Completed (Phase 5 - Part 5)
- **Targets & Endpoints:** `GET /api/targets` endpoint properly queries `target_endpoints` via JOINs. Fixed `target-store.ts` deletion and creation syncing logic. Stable.
- **MCP (Model Context Protocol):**
  - Backend schema fully migrated (`mcp_server_config`, `mcp_exposures`, `mcp_tokens`, `mcp_clients`, `mcp_client_servers`).
  - Fixed UI crashes related to `OwnerChip` mapping in `mcp-store.ts`.
  - Added Token Copy button feedback, missing standard `<select>` classes, and `confirmAction` dialogs to Delete/Revoke buttons.
  - Implemented dynamic OAuth identity provider mapping (OIDC, OAuth2, Entra) including fallback provider support for the server configuration.
  - Implemented `stdio` support for MCP Clients, bypassing the `http/https` requirement check when `stdio` transport is chosen.

## 6. Completed (Phase 6) - Memory Module
- **Backend Complete:** `local-server/lib/routes/memory.mjs` wired to `api-v2.mjs`. All CRUD endpoints (`/api/memory/working`, `/api/memory/episodic`, `/api/memory/facts`, `/api/memory/policy`) fully functional with PostgreSQL.
- **Store Complete:** `src/lib/memory-store.ts` seamlessly syncs from backend and triggers UI updates via custom events.
- **UI Complete:** Fixed `<select>` dropdown styles (appearance-none, correct icons). Implemented graceful empty states for 0 facts. Added `confirmAction` dialogs (matching existing UI patterns with ruby tone) for Semantic Fact deletions to prevent accidental wipes.

## 7. Completed (Phase 7) - Approval Queue
- **Backend Complete:** `local-server/lib/routes/approvals.mjs` implemented and wired into `api-v2.mjs`. Endpoints for fetching the queue (`/api/approvals`), making decisions (`/api/approvals/decide`), requesting approvals (`/api/approvals/request`), and updating configs (`/api/approvals/config`) successfully query the `approval_requests` and `approval_config` tables.
- **Store Complete:** `src/lib/approval-store.ts` rewritten to fetch from PostgreSQL rather than localStorage mocks. Implemented UI/DB mapping for enum inconsistencies (e.g. `rejected` in UI vs `denied` in DB check constraint).
- **Gate System Updated:** `src/lib/approval-gate.ts` `gateAction` and `parkForApproval` mechanisms have been transitioned to `async/await` to properly read database configurations (Queue Armed master switch) and dispatch actions dynamically.

## 8. Completed (Phase 8) - CVE Feed
- **Backend Complete:** `local-server/lib/routes/cve.mjs` implemented for full CRUD management of `cve_sources`, `cve_watchlists`, and `cve_entries`. Wired to `api-v2.mjs`.
- **Legacy Cleanup:** Removed conflicting duplicate `/api/cve` route from `local-server/lib/routes/system-misc.mjs` that was breaking UI rendering.
- **Store Refactored:** `src/lib/cve-store.ts` and `src/lib/cve-sources.ts` completely migrated from mock/localStorage to asynchronous PostgreSQL endpoints via `fetchApi`.
- **UI Bugfixes:** Fixed race conditions where `Add watchlist` tabs would not render, and resolved event-listener detachments.

## 9. Completed (Phase 9) - Models & Group Tabs
- **Backend Complete:** Rewrote `local-server/lib/routes/models.mjs` to properly support full CRUD operations. Implemented dynamic table creation (`model_groups`) on the fly, since it was missing from the master schema.
- **Store Refactored:** `src/lib/model-store.ts` async data loading implemented (`fetchApi`). Replaced legacy vendor lock-ins (e.g. `Lovable` URLs/keys) with Sovereign-native standard defaults (e.g., `http://127.0.0.1:8000/v1`).
- **UI Logic Update:** Modifed `src/components/sovereign/model-group-tabs.tsx` to handle groups securely by ID instead of name. Integrated `confirmAction` dialogs to prevent accidental bulk-deletions of models when deleting groups. Fixed typescript scope leak causing `Cannot access 'active' before initialization` crash.

## 10. Completed (Phase 10) - Capability Registry
- **Backend Complete:** `local-server/lib/routes/registry.mjs` implemented to support dynamic root discovery and fully sync with the `registry_state` PostgreSQL table.
- **Dynamic Portability:** Refactored `registry-store` to rely on `process.cwd()` through the backend, completely eradicating hardcoded environment-specific file paths. Elara now scans correctly, regardless of deployment location.
- **UI Logic Update:** Migrated to asynchronous `fetchApi` updates. Hard-delete action is now protected by a unified `confirmAction` dialog preventing accidental dispatcher hiding.

## 12. Completed (Phase 12) - Sandbox & Run Sync Migrations
- **Sandbox Persistence Fix:** Refactored `local-server/lib/routes/security-policies.mjs` to use `UPSERT` endpoints for `genguard`, `isolation_profiles`, `signed_artifacts`, and `policy_rules`. Solved the partial JSON update bug by enforcing strict type casting (`$3::boolean`, `$8::jsonb`) inside `COALESCE()` logic, meaning isolation toggles now save to Postgres instantly instead of failing with invisible 404s.
- **Run Counter Sync:** Bridged the `skill_runs` database counts back to the UI green tags (`X runs`) by joining data async via `Promise.all`.
- **UX Standardization:** Replaced raw default browser `alert()` windows in the Skills Editor with the `confirmAction` Ruby-toned ELARA standard notification modal for Python execution path errors.
- **Tool Control Panel vs Forge Factory Count Mismatch:** Solved the phantom behavior where tools recreated with old IDs were auto-hidden by stale `tool_panel_state` cache. Added `unorphanTool` to clear local dismissals on new backend creations.

## Strict System Rules & Information
- **Agnostic & Enterprise Grade:** System will be deployed in a Zero-Trust Enterprise agnostic environment (MAC/LINUX/Windows). Every feature (frontend, backend, API, UI) must work reliably and agnostically (no hardcoded absolute paths, use `process.cwd()`).
- **NO Bulk Sed:** Avoid bulk `sed` commands unless absolutely necessary. Use targeted edits.
- **Store Safety:** Be extremely careful with `.ts` store files. Do not cause hydration issues. Always use `(arr || []).length` instead of `arr.length` when mapping DB data to React to avoid Vite crashes on undefined values.
- **NO Unapproved Git Ops:** Do NOT `git commit` or `git restore` without explicit user permission.
- **Zero-Error Builds:** After making changes, a 0-error build check MUST be performed using `npx tsc --noEmit`. Do not proceed if errors exist.
- **Step-by-Step Impact Analysis:** The backend has been refactored and the UI changed. Features have been added or removed. Proceed slowly. Analyze the impact of changes across the entire system. Do not break working systems while fixing bugs.

**Important System Services & DB:**
- `elara-worker.service`
- `elara-middleware.service`
- `elara-vite.service`
- `elara-tls-proxy.service`
- DATABASE_URL: `postgres://sovereign:sovereign@127.0.0.1:5432/elara_db`
- Admin UI pass: `password123`
- Core API: `api-v2.mjs`

## 13. Completed (Phase 13) - Workflow & Orchestration Migrations
- **Database Alignment:** Migrated `workflows` and `orchestrations` logic entirely to PostgreSQL `v2_master_schema.sql` standard, dropping legacy mock records and local JSON parsing schemas.
- **Visuals & Layout Bug Fixes:** Relocated `TriggerScheduleCard` and `OutputBindingCard` from the main canvas overlay to the left-side `Node Library` (as per design specs).
- **Pointer/Click Conflicts:** Solved deep React internal "Phantom Duplicate Key" bugs where dragging and dropping nodes crashed the UI or clicking trash (Delete) cloned elements instead of opening the confirmation dialog by fixing `.stopPropagation` traps in the Canvas Pointer events.
- **Trigger Scheduler:** Brought the `trigger_scheduler_schema.sql` online and wired the `trigger-sync.mjs` endpoint, ensuring that workflow triggers are not just saved to nodes, but simultaneously pushed to the actual SQL worker queue to be scheduled and run.
- **Logo Overhaul:** Finally purged the leftover "Lovable" logos completely from the UI, replaced with a strict, minimalistic Sovereign "E" SVG.

## 14. Completed (Phase 14) - Canvas Stability & Audit Feed Rewire
- **Canvas Ghosting & ID Generation:** Replaced sequential ID generator (`n101`) in `flows.tsx` and `orchestration.tsx` with a timestamp + random hash approach to prevent duplicate key crashes during optimistic updates. Fixed `onPointerUp` propagation bugs in `WorkflowCanvas` that were hijacking click events.
- **Hydration Flash Fix:** Initialized UI states (`useWorkflows`, `useChains`) synchronously from `localStorage` instead of starting with an empty array to prevent the "create workflow" button from flashing before the DB load completes.
- **DAG Execution Ordering:** Normalized backend payload parsing (`source`/`target` vs `from`/`to`) in `workflows.mjs` to ensure the Execution Engine properly runs nodes via Topological Sort rather than creation order. Fixed the frontend run simulation (visual blinking) to use the exact same DAG topological sort logic so the UI perfectly mimics the backend flow.
- **Meta-Forge API Integration:** Completely removed mock localStorage seeds from `metaforge-store.ts`. Rewired it to use `fetchApi` connecting to `POST /api/meta-forge/plans/:id/apply` etc. Updated `meta-forge.mjs` SQL queries to align with the V2 Master Schema (`actor` instead of `requested_by`, removing `applied_at`).
- **Logs & Audit SSE Rewire:** Dropped the 900-line static mock data from `audit-store.ts`. Both "Audit Journal" and "Live Debugging" are now directly bound to the backend's `/api/audit/stream` Server-Sent Events (SSE).
- **Actor and Local Time Fixes:** Updated backend endpoints to require session `req.session?.username` so that triggers are logged with actual actor names instead of `system`. Fixed GMT+3 UTC formatting bugs in the frontend by replacing `toISOString()` with local-aware datetime logic.

## 15. Completed (Phase 15) - Execution Engine Logging & Foreign Key Fix
- **Live Debugging Orchestration Feed:** The Execution Engine's core `while(queue.length)` DAG walk loop in `workflows.mjs` was fully refactored to emit step-by-step logs into the `agent_logs` table via `enqueueWrite` and simultaneously stream them to the UI via `broadcastAudit`. Previously, only the start of the workflow/chain was logged.
- **Node Label Parsing:** Fixed the `audit-store.ts` string splitting logic that was improperly discarding human-readable node names during SSE parsing. Real node names (e.g. `Manual Trigger`) now correctly appear instead of cryptic IDs (`n101`).
- **Chain Run Foreign Key Crash:** Removed a stale `FOREIGN KEY` constraint (`chain_runs_chain_id_fkey` on `workflow_chains`) that was blocking new `orchestrations` from running and causing silent API crashes when attempting to log `chain_runs`. Chains are now executing flawlessly.

## 16. Completed (Phase 16) - Knowledge Hub & RAG Migration
- **Backend Lock-In Removal:** Removed all hardcoded vendor locks (e.g. "fortigate", "checkpoint", "netscaler", "a10") and MLX hardware assumptions from backend files (`product-extract.mjs`, `intent-classifier.mjs`, `extract.mjs`). Made product and version parsing strictly regex/filename based (Agnostic). Removed `expandHome` Mac OS path hardcoding in favor of `process.cwd()`.
- **Database Wiring:** RAG Settings (82 Tuning Knobs), Knowledge Spaces, Brand Aliases, Sources, and Webhook records were successfully mapped to actual Postgres DB tables (`v2_master_schema.sql`) replacing all `localStorage` mock caches.
- **Ingestion & Upload Fixes:** "Add Source" dialog (URL, Text, File, Directory) was overhauled to use genuine async backend endpoints via `fetchApi` (using `FormData` for multipart file uploads and passing the required `x-session-id` auth header). Added proper error handling to surface scraping/bot-protection failures rather than silently crashing.
- **Maintenance Operations:** Wired all maintenance buttons (Repair FTS, Retry Embeddings, Drain Errors, Cleanup, Apply Path, etc.) to backend RPC routes (`POST /api/rag/repair-fts` etc.) with correct loading spinners/states, ensuring metrics immediately reflect success.
- **Mock UI Removal:** Stripped out "Graph RAG" and "Cross-Reference" tabs that had no functional backend logic yet (disabled/WIP). Replaced static hardcoded backend telemetry (3.89 GB, 74% hit rate) with genuine `POST /api/rag/db-stats` querying active Postgres `pg_stat_database` / `pg_stat_user_tables` metrics.
- **Agent RAG Binding:** Fixed the Agent Settings panel to read real RAG brands from the DB instead of a local static array, and successfully tested RAG "On/Off" bindings to Postgres.

## 17. Completed (Phase 17) - Webhooks UI Migration (Adapters Page)
- **Adapters | Webhooks UI Migration:** The "Adapters" page was successfully refactored. The Webhooks UI was integrated into a matching dual-tab (pill-tab) design placed inside the main page `action` bar (matching the MCP page layout).
- **Backend / DB Parity:** The frontend `webhook-store.ts` was fully wired to the backend `webhooks-crud.mjs` API endpoints (`POST`, `PATCH`, `DELETE`). The backend endpoints interact directly and correctly with the PostgreSQL `webhooks` table. No mock data remains in Webhooks or Adapters.
- **UI Dialogs:** "Restore Defaults", "New Adapter", and "New Webhook" actions properly trigger the standard `confirmAction` and standard creation dialogs.

## 18. Completed (Phase 18) - RAG Documents & File Ingestion Backend
- **RAG Folders Backend:** Wrote `rag-folders.mjs` API and wired `rag-folder-store.ts` to PostgreSQL (bypassing the old `localStorage` logic). Added `owner_id` to `rag_folders` for proper isolation.
- **Upload Pipeline & Graph Cleanup:** Re-connected missing ingestion dependencies (`sanitizeContent`, `chunkText`, `enrichChunkContent`, `linkEntitiesForChunk`). Updated the core `knowledge-sync.mjs` (deletion CASCADE pipeline) to properly reference the new V2 `source_id` instead of the old V1 `file_id`.
- **Knowledge Sources Metadata:** Added `metadata` JSONB column to `knowledge_sources` table in `v2_master_schema.sql` and ensured pipeline uses it.
- **Bug Fixes (UI & Backend):**
  - Fixed React event bubbling in RAG UI so confirmAction dialogs dispatch DB calls properly.
  - Cleared noisy tags in file-kind.ts.
  - Fixed PostgreSQL transaction rollback in knowledge-sync.mjs (purgeGraphOrphans) resolving ghost DB document errors.
  - Fixed rag-folders.mjs syntax error ensuring collection creation works.

## 19. IN PROGRESS (Phase 19) - Fleet Telemetry Integration
- **Goal:** Connect src/routes/fleet.tsx and telemetry-live.ts to real OS metrics and PostgreSQL data.
- **Completed DB & AI Hookups:** Successfully stripped all mock telemetry wave-generators for the PostgreSQL database, Operator Ledgers, Agent/Workflow Queues, and AI Quality streams.
- **Backend Refactor:** Updated local-server/lib/routes/telemetry.mjs to perform comprehensive JOIN queries across agent_runs, skill_runs, workflows, tool_invocations, and provider_usage, ensuring real-time accurate UI representation.
- **Zero-Error Architecture:** Re-implemented the data binding without destructing the React Dashboard hooks or Vite SSR rules. The UI design constraints have been perfectly maintained.
- **Persistent Boards:** Refactored telemetry-board-store.ts to save user-defined telemetry boards directly to PostgreSQL instead of localStorage.
- **Remaining Task (Hardware OS/Sensors):** While AI and DB logic is fully mapped, hardware logic (GPU, Network, Disk I/O) and Replica Lag are still returning simulated visual waves since node.js natively lacks these OS sensors. Needs Prometheus or DCGM agent hookup.


## 20. Completed (Phase 20) - Replica Lag Zeroing & Enterprise AI Quality Schema
- **Hardware Telemetry Patch:** Hardcoded `Replica Lag` to exactly 0 ms natively on the frontend telemetry sampler to correctly reflect the current single-primary Sovereign database structure (stripping out the mock random walk).
- **PostgreSQL Schema Alteration:** Expanded the `provider_usage` and `v2_master_schema.sql` tables with Enterprise AI Evaluation columns (`hallucination_score`, `groundedness_score`, `refusal_rate`, `cache_hits`, `cost_usd`).
- **Telemetry Query Rewire:** Updated the `/api/telemetry/ai-metrics` PostgreSQL queries in `telemetry.mjs` to pull `AVG()` and `SUM()` from these new LLM quality columns instead of passing hardcoded zeroes.
- **Node.js Execution Engine Prep:** Updated `recordUsage` in `agent-utils.mjs` to insert these metrics when provided by the future observability layer, completing the half-automated, half-manual roadmap. The frontend will now automatically light up when these metrics hit the DB.

## 21. Completed (Phase 21) - Agnostic AI Quality & True Studio Inventory
- **Agnostic Model Pricing:** Eliminated hardcoded provider pricing. Added `input_cost` and `output_cost` directly into the `models` schema and UI configuration panel. The execution engine now dynamically calculates true USD cost based on the active model's DB parameters.
- **Heuristic Quality Engine:** Created a native `calculateAIQuality` function inside the backend agent utilities to auto-evaluate refusal rates and token-ratio-based hallucination/groundedness metrics during every LLM interaction, automatically inserting them into `provider_usage`.
- **True Studio Inventory:** Refactored the `telemetry-stream.mjs` SSE feed to directly perform `COUNT(*)` and `COUNT(active)` aggregates on PostgreSQL tables (Agents, Workflows, Tools, Skills, Packs, Users). Stripped out the fake React-side array length mock counters.
- **Hardware OS Sensors:** Added native Node.js OS polling for Network (Rx/Tx via `/proc/net/dev`), Disk I/O (`/proc/diskstats`), and GPU (`nvidia-smi`) to replace random-wave mocks on the System General tab.
- **Maintenance Signals (Dead Tuples):** Replaced simulated DB bloat percentages with genuine `n_dead_tup` / `n_live_tup` calculations from `pg_stat_user_tables`. Relaxed UI warning thresholds (30%-80%) to prevent visual fatigue in dev environments with deferred autovacuums.

## 22. Completed (Phase 22) - Runtime Canvas Active Fleet & System Limits
- **Orchestrator Inclusion:** Expanded the backend agent-status UNION ALL query to correctly include orchestrations in the runtime monitoring payloads alongside agents and workflows.
- **Dynamic System Capacity:** Dropped hardcoded 20k/s throughput ceiling. Replaced it with a live capacity boundary derived directly from the 'engine_policy' active_model_id and its associated maxTokens in the DB.
- **Active Fleet Component Fix:** Restored the native CSS/HTML layout for Active Fleet which was inadvertently overwritten, applying native `[&>option]:bg-raised` CSS fixes for cross-browser native select thematic consistency.
- **Persistent Widget Selection:** Fixed a bug in `telemetry-board-store.ts` and `runtime-canvas.tsx` where a blank initial localStorage read would wipe all customized pinned widgets on refresh.

## 23. Completed (Phase 23) - UI Polish & Zero-Mock Finalization
- **No-Flash Hardware Init:** Emptied `initialHost` CPU cores and hardware metrics to prevent 12-core UI flashes and false data spikes during the first seconds of the React mount lifecycle.
- **Adaptive Select UI:** Implemented `[&>option]:bg-raised` utility class to fix the native HTML `<select>` dropdown backgrounds in `runtime-canvas.tsx` to perfectly match the Sovereign theme architecture.
- **Complete Mock Eradication:** Detached the `telemetry-live.ts` store from `src/mocks/telemetry.ts` entirely. The system now solely relies on API/SSE hydration for its visual states, completing the transition from mockup to production UI.

## 24. Completed (Phase 24) - Agnostic LLM Orchestration & Agentic Chat Engine
- **Mock Motorun Sökülmesi:** `src/routes/index.tsx` içerisindeki `setInterval` ile çalışan 40ms'lik sahte LLM akışı tamamen silindi. Yerine `TextDecoderStream` ve `buffer` destekli, bölünmüş JSON (chunk) hatalarına karşı dirençli (%100 bulletproof) gerçek bir SSE (Server-Sent Events) parser'ı yazıldı.
- **Backend Spagetti Temizliği:** `local-server/lib/routes/chat-orchestrate.mjs` dosyası 2200 satırdan 150 satıra düşürüldü. Mac/MLX donanımına sabitlenmiş `isMlxBusy` kontrolleri, sahte `setInterval` heartbeat'leri ve timeout/race condition'lara sebep olan tüm `Promise.race` kalıntıları temizlendi.
- **Evrensel OpenAI Uyumluluğu:** Yeni Agnostik Streamer; `Ollama`, `vLLM` ve `Llama.cpp` gibi Local modellerle kusursuz çalışır hale getirildi. Llama.cpp modellerindeki (Örn: Gemma 4) düşünme balonları (`reasoning_content`) başarıyla ayrıştırılıp arayüze (UI) yansıtıldı.
- **Google Gemini & Anthropic (Claude) Adaptörleri:** Sisteme hiçbir NPM paketi (Vercel SDK vb.) eklemeden, tamamen Agnostik kalmasını sağlamak için özel adaptörler (Şive çevirmenleri) eklendi. Google API'leri için URL sonuna otomatik `/openai` eklenmesi ve `x-goog-api-key` header transferi sağlandı. Claude için `fetchAnthropicStream` adaptörü yazılıp uç nokta `/messages` yapısına uygun hale getirildi.
- **Zırhlı Vault (AES) ve Manual API Key Çözümü:** Arayüzden gelen `manual:` önekleri (prefix) veritabanı kayıtlarından temizlendi (`models` tablosu güncellendi). String içinde nokta (`.`) geçen gerçek şifrelerin Vault referansı sanılıp çöpe gitmesini önleyen, önce Vault DB'sine sorup `Not Found` alınca orjinal şifreyi koruyan "Fallback" mekanizması geliştirildi.
- **Composer Yetenekleri (Tools/Skills) DB'ye Bağlandı:** `src/components/sovereign/composer.tsx` içindeki sahte `composerTools` listesi iptal edilip, `useToolUniverse` ve `useSkills` üzerinden doğrudan PostgreSQL tablosuna (gerçek verilere) bağlandı.
- **Agentic Loop (Tool Calling) İskeleti Kuruldu:** Arayüzden yazılan `/tool_adi` komutları backend'e aktarıldı. `chat-orchestrate.mjs` içerisine LLM'den dönen `tool_calls` stream'lerini yakalayıp lokalde aracı çalıştırma ve sonucu tekrar LLM'e gönderme döngüsünün (Multi-turn ReAct Loop) temeli atıldı.

## 25. Completed (Phase 25) - Agentic Loop, Vault Standardization & Chat Persistence
- **Enterprise Vault URI Standardı:** Vault tabanlı ve manuel girilen şifreleri ayırt eden ilkel `manual:` prefix hilesi, yerini tamamen `vault://` ve `raw://` şemasına bıraktı. Tüm bileşenlerde şifre/kasa mantığı (Mail, API, Tools vb.) `vault.mjs` içindeki `resolveCredential` adlı tek bir merkezi (Single Source of Truth) metoda bağlandı.
- **Gerçek Multi-Turn ReAct Döngüsü:** `chat-orchestrate.mjs` içerisine 5 iterasyonluk bir State Machine kuruldu. LLM'in tool (araç) çalıştırma kararları (tool_calls) anında yakalanıp `invokeTool` üzerinden gerçek Execution Motoruna bağlandı. Elde edilen JSON sonucu, `messages` döngüsüne tekrar eklenip LLM'e sunularak gerçek ajan (ReAct) mantığı devreye alındı.
- **SSE (Server-Sent Events) UI Animasyon Entegrasyonu:** Arayüzün şık yapısını (Glassmorphism) destekleyecek şekilde Backend'e `phase: "tool_execution"`, `phase: "agent_loop"`, `type: "tool_status"` ve `approval_required` (İnsan Onayı) eventleri eklendi.
- **Lovable (UI) Hand-off Başarısı:** UI tarafında Lovable'ın ilettiği Kutu A (Sıfır risk), Kutu B (Cerrahi) ve Kutu C (Backend) yapıları eksiksiz uygulandı. Yeni arayüz doğrudan SSE verisini okuyabilen bir `streamOrchestrate` yapısına bağlandı. 
- **Veritabanı Kalıcılığı (Chat Persistence):** Tarayıcıda (LocalStorage'da) asılı kalan sohbetler tamamen PostgreSQL'e (`/api/chat/threads`) bağlandı. Frontend'in hatalı (400, 413, 500) istekleri (Örn: olmayan UUID okuma, Foreign Key kısıtlaması, Express 100KB payload sınırı) onarıldı. Chat geçmişi artık kalıcı.
- **Multimodal (Vision) Desteği:** 8 MB olan dosya limitini 20 MB'a çıkardık ve Express'teki JSON/URL payload sınırını `50mb`'a yükselttik. Gönderilen resimler (`attachment`), LLM'e OpenAI Vision standartlarında (Array içerisinde `image_url` tipinde Base64 olarak) gitmeye başladı.
- **Edge-Cases Fixes (Stop, Regenerate & Overflow):** 
  - Stop (Abort) sinyalinde UI'da çıkan `BodyStreamBuffer aborted` kırmızısı kaldırıldı, yerine `_Stopped by operator_` mesajı konuldu. 
  - `retry` ve `submitEdit` tıklandığında Promise eşleşmezliği (Frontend kilitlenmesi) düzeltilip `async` formata alındı.
  - Uzun kelimelerde (ve uzun base64 image URL'lerinde) ortaya çıkan yatay taşmaları (Overflow) engellemek adına arayüze `break-words` CSS sınıfları dahil edildi.
  - Yeni girişlerde ve `F5` işlemlerinde sistemin "Sürekli yeni chat" oluşturma (Orphan Thread) döngüsü `chat-store.ts` içerisindeki `pull()` mantığı ile engellendi, artık sistem kaldığı son sohbeti öncelikli olarak açıyor.

## 26. Completed (Phase 26) - Agentic QA, Vision Fix & Abort Synchronization
- **DB Darboğazı (Fix):** Backend tarafında `threads.mjs` içerisinde devasa bir darboğaz tespit edildi; `DELETE + INSERT` yerine `ON CONFLICT` ve sıra numarasına (`seq`) dayalı akıllı bir `UPDATE/INSERT` (Upsert) mantığına geçilerek 500+ kullanıcılı LB ortamına uygun hale getirildi.
- **Vision (Görsel Okuma) Çözümü:** `chat-orchestrate.mjs` içerisinde modellerin `base64` veri algılaması ve Array formatında gelen resim DTO'larının dizilimi Anthropic standartlarına uyacak şekilde başarıyla entegre edildi.
- **TCP-KILLER (Explicit Cancel API):** Standart Node.js `fetch/undici` socket keep-alive yapısının Llama.cpp ve Load Balancer arkasındaki "Stop/Regenerate" donmalarına yol açması kesin olarak çözüldü. Arayüzden Stop'a basıldığında tetiklenen `POST /api/chat/cancel` endpointi yazıldı. `http.request.destroy()` (TCP RST) ile Llama.cpp'ye zorla bağlantı koparma (Broken Pipe) emri gönderilerek token üretiminin anında durması (0ms) sağlandı. Donma ve kilitlenme yok edildi.
- **Zombie Chats (Split Brain) Fix:** Arayüzden silinmesine rağmen F5 atınca tekrar geri gelen hayalet (Zombie) chatler engellendi. `chat-store.ts` içerisindeki `pull()` fonksiyonu, sadece `Date.now() - createdAt < 5 min` (son 5 dakikada) açılmış taze sohbetleri offline-sync yapacak şekilde daraltıldı.
- **SSE "Done" & "Out" Schema Alignment:** Backend'den (Orchestrator) arayüze (UI) dönen SSE mesajları, UI'ın `orchestrate-stream.ts` içerisindeki katı parser formatına uyduruldu. `send({ type: "out", delta: "...", text: "..." })` çift-dil formatı ve işlem bitiminde `send({ type: "done" })` sinyali eklendi. Bu sayede normal "runAgent" sohbetleri ve "Orchestration" cam kutu animasyonları havada asılı kalmaktan kurtarıldı.
- **UI Auto-Kill Guard:** Arayüzün sayfa renderlanırken (veya "Send now" tuşu ile) kendi kendine `stop()` gönderip Backend'i yanlışlıkla öldürmesini engelleyen `isManual` kilidi `index.tsx` içine yerleştirildi.

## 27. Completed (Phase 27) - Orchestrator "Spinner/Pending" Lockup & Local LLM TTFT Integration
- **Sorun 1 (Spinner Lockup & SSE Payload):** UI tarafındaki tool animasyonları kapanmıyordu. Nedeninin backend'den dönen isimlerin (örn: `tool_xyz` ile `mcp.xyz` uyuşmazlığı) UI state'iyle eşleşmemesi olduğu tespit edildi. `chat-orchestrate.mjs` içerisindeki SSE payload'u (`type: "tool_status"`) `ms` ve hata durumunda `detail` dönecek şekilde tamamen `MULTI-TURN-ORCHESTRATION-WIRING.md` standartlarına uyduruldu.
- **Sorun 2 (Görünmez Socket Hang Up & Model Payload):** Tool çalışırken "Connection to LLM failed: socket hang up" hatası fırlıyordu. Yeni UI Composer'ı `runOrchestration` fonksiyonundan backend'e `model` bilgisini göndermeyi unutuyordu. Backend `model` null geldiği için "Fallback" senaryosuna düşüp, sistemdeki varsayılan proxy'si olmayan `127.0.0.1:8000` (CurlTest) gibi ölü bir porta gidiyor ve doğrudan "socket hang up" yiyordu. `src/routes/index.tsx` içerisine `model` ve `agent_id` payload'ları eklendi.
- **Sorun 3 (Llama.cpp Strict HTTP Parsing):** Native HTTP Request ile LLM'e post atan `TCP-KILLER` mekanizmasında `Content-Length` başlığı (header) yoktu. Llama.cpp ve VLLM gibi strict yerel C++ sunucular payload'da boyutu göremediğinde anında `RST` çakıp bağlantıyı düşürüyordu. `Content-Length` hesaplanıp `User-Agent` ile beraber zorunlu header olarak eklendi.
- **Sorun 4 (TTFT Timeout - 120s):** LLM'lerin (özellikle local ortamda çalışanların) devasa tool şemalarını (JSON Schema) anlayıp ilk token'ı üretmesi (Time To First Token) çok uzun sürebiliyordu. Hardcoded 15 saniyelik timeout, tool devreye girdiğinde yetersiz kalıyordu. Timeout süresi 120 saniyeye çıkarıldı ve aradaki Load Balancer / Nginx drop atmasın diye stream boyunca 15 saniyede bir `:\n\n` (SSE heartbeat comment) atılması sağlandı.
- **Sorun 5 (Tool Database Synchronization):** Eski şemadan kalma Türkçe/kirli kayıtlar sistemde tool halüsinasyonlarına yol açıyordu. `action_library` ve `tools` tabloları tamamen `TRUNCATE` edildi ve 6 adet standart native/forge araç (Weather, Web Scraper, PDF Extract, Sysinfo, Date Time, Web Fetch) İngilizce formatlı, güncel şemaya birebir uyumlu şekilde veri tabanına seed edildi.

## 28. Completed (Phase 28) - Multi-Turn ReAct Stability, ACL Sync & Vault V2 Integration
- **Sorun 1 (Tool Animasyonunda İsim Görünmemesi) Çözüldü:** Arayüz (`tool-universe.ts`), veritabanı ID'leri yerine görsel isimlerden (label) ID üretiyor (Örn: `current.date.and.time`) ve backend'e yolluyordu. Backend bu aracı bulamadığı için UI'a `tool_execution` dönmüyor, animasyon asılı kalıyordu. UI'ın tool şemaları ve seçim listeleri DB'deki orijinal ID'leri (`log.date_time` vb.) kullanacak şekilde refactor edildi. SSE stream içinde fuzzy-match destekli bir `toolMap` eşleşmesiyle animasyonların arayüzde doğru isimlerle ve sürelerle (ms) çalışması sağlandı.
- **Sorun 2 (Agent Capability ACL Block) Çözüldü:** Arayüzde bir ajanın yetkileri düzenlendiğinde (`agents-crud.mjs`), güncel tool'ların güvenlik (ACL) tablosu olan `agent_capabilities` tablosuna yazılması unutuluyordu. Ajanların tool çağrıları `invokeTool` motoru tarafından FAILED (0.0s) olarak engelleniyordu. Güncelleme (PUT) metoduna `agent_capabilities` sync (DELETE & INSERT) mekanizması eklendi.
- **Sorun 3 (Vault V2 URI Şeması) Çözüldü:** Arayüz (`vault-key-field.tsx`), şifre seçildiğinde değeri backend'e `vault://vault://...` şeklinde çift prefixli yolluyordu. Bu UI bug'ı silindi. Ayrıca backend'deki merkezi credential çözücü (`vault.mjs: resolveCredential`), eski formattaki tyrolarını ve çoklu slash fazlalıklarını otomatik parse edecek şekilde regex/loop korumalı hale getirildi. Artık LLM'ler ve Tool'lar kasa şifrelerini hatasız çekiyor.
- **Sorun 4 (Model Halüsinasyonları & Context Contamination) Çözüldü:** LLM'e (Agentic Loop'ta) tool yanıtlarını geri beslerken içerik (`content`) boş diye "assistant" tool-çağrı mesajlarını (intent) silen filtre devre dışı bırakıldı. LLM'lerin sadece aracı değil, asistanın hangi amaçla çağırdığını da tarihçede görmesi sağlandı. Ayrıca araçların `params` array'i boş olunca LLM'in aracı "gereksiz" bulup halüsinasyona düşmesi problemi keşfedildi ve DB'de araçlara (Örn: `timezone`) boş da olsa opsiyonel parametre eklendi.
- **Dinamik Adapterler (Sıfır Node.js Editi):** Araçların test için `builtin` modunda MJS'e gömülü olması bırakıldı. `tool.weather` ve `log.date_time` araçları `http` ve `python` adapterlerine bağlanarak dinamik çalışacak şekilde (`wttr.in`, `timeapi.io` veya lokal `.py` dosyaları üzerinden) DB'den güncellendi. Elara'nın "Agnostic" dışa bağımlı Tool Engine'inin sınırları test edildi.
- **Sorun 5 (UI Model Resolution & Provider Arg):** Arayüzün model `undefined` gönderme sorunu `agent?.modelId ?? activeModel?.id` ile çözüldü. Backend'de Advanced model ayarlarına (Parallel tool calling vb.) erişimi engelleyen `fetchOpenAIStream` unassigned provider hatası onarıldı.

## 29. Completed (Phase 29) - Parallel Tool Calling & "Socket Hang Up" Deep Fix
- **Sorun 1 (Local LLM Socket Hang Up / Concatenation Bug):** Gemma 4 31B gibi bazı yerel modeller `tool_call_delta` stream ederken `index` ve `id` göndermeyi atlıyordu. Backend orkestratörü `chat-orchestrate.mjs` bu eksikliği yönetemediği için, ardışık gelen iki aracı birbirine string olarak yapıştırıyor (`tool_log_date_timetool_weather`) ve parse edemeyip çöküyordu. `delta.function.name` mantığı üzerinden akıllı bir izole etme ve anında sahte ID (`call_xxyz`) atama algoritması yazılarak stream'in temiz kalması (ayrı kalması) sağlandı. Artık yerel LLM'ler paralel çağrılarda asla çökmüyor.
- **Sorun 2 (Gemini "Thought Signature" API Bug):** Gemini Flash Lite modelleri Google API'sine paralel 2 araç çağrısı dönerken, Google sadece ilk araca `thought_signature` ekliyordu. Yanıtları toplarken eksik imzalı araçlar Google'dan "400 INVALID_ARGUMENT" hatası alıyordu. Eski "isGoogle" ve sahte "[System Update]" bypass'ları tamamen silindi. API standardına %100 uyan, gelen ilk imzayı diğer tüm paralel araç objelerine sessizce kopyalayan `sharedThoughtSignature` çözümü koda eklendi.

## 30. Completed (Phase 30) - Zero-Shot Capability, Meta-Forge Discovery & Sovereign RBAC
- **Sovereign RBAC & Identity (Görünürlük Altyapısı):** Tool (Action Library) konfigürasyonundan ziyade, aracın özlük hakkını barındıran `ForgeItem` yapısına ve DB'ye (`action_library` tablosu) `visibility` (private/workspace) ve `sharedWith` alanları eklendi. "Forge Factory" UI içerisine "ACCESS" (ShareControl) bloğu dahil edildi. Böylece araçların güvenli RBAC erişim zeminleri kuruldu.
- **Zero-Shot "System Tools" (Otonom Keşif ve Paslama):** Modelin `openAiTools` dizisine (kullanıcı seçmese bile) `sys_get_directory`, `sys_execute_tool` ve `sys_delegate_to_agent` adında üç adet sistem/Meta-Forge aracı eklendi. Bu sayede model, ihtiyaç duyduğunda sistemdeki tüm uzman ajanların (askerlerin) ve araçların listesini (kendi RBAC yetkisi dahilinde) tarayabilir ve ilgili görevi onlara "Sıfır-Hardcode" prensibiyle doğrudan paslayabilir veya bir aracı otonom çalıştırabilir.
- **UI Tools Sayfası (Badge Display):** Control Panel altındaki Tool kartlarına (aynen ajanlarda olduğu gibi) Private/Workspace yetkisini gösteren `OwnerChip` rozetleri eklendi.

## 31. Completed (Phase 31) - Agnostic Web Search, Fallback Engine & Semantic Orchestration
- **Semantic Routing (Akıllı Tool Eşiği):** LLM'in her sohbette veya selamlaşmada gereksiz yere orchestration'a (araç kullanmaya) girmesini engellemek adına, `chat-orchestrate.mjs`'ye *Smart Threshold Directive* eklendi. Model artık "Teşekkürler" gibi muhabbetlere doğrudan cevap verirken, sadece gerçek dünya verisi (fiyat, hava durumu, haber) arandığında zorunlu arama moduna giriyor.
- **Agnostic Web Search & Fallback Engine (Services Tower):** İnternet araması için `duckduckgo` kazıyıcısı yerine kurumsal `Tavily`, `SearXNG` ve `Brave` API entegrasyonu sağlandı. `Services` menüsü altına "WEB SEARCH PROVIDERS TOWER" eklendi. Önceliğe (Priority) göre arama API'lerinin hatasız şekilde fallback (biri çökerse diğerine geçme) yapması backend'e kodlandı. Vault desteğiyle API anahtarları koruma altına alındı.
- **Composer "Live Call" ve "Web Search" UI Optimizasyonu:** Kullanışsız olan "Live Call" butonu tamamen temizlendi. Web Search ikonuna basıldıktan sonra, düğmenin asenkron "race condition" sebebiyle kapanıp backend'e `false` yollaması (Arama yapmama) sorunu çözüldü.
- **Ghost Orchestration UI Fix:** "Web Search" açıkken araç tetiklenmezse UI'ın ortasında beliren boş `ORCHESTRATION` accordion'u engellendi. Sadece araç çalıştırılırsa accordion açılacak şekilde `activity.runs.length > 0` şartı getirildi.
- **Thinking Block SSE Fix:** Lokal modellerin ürettiği `<think>` ve reasoning token'larının UI'a gelmemesi sorunu, `orchestrate-stream.ts` dosyasında `type === "think"` ayrıştırması yapılarak çözüldü. Artık araç kullanılmasa dahi LLM'in düşünce süreci (Thought for Xs) ekrana yansıtılıyor.
- **Chat Purge/Race Condition Fix:** Chat'i temizlemek için kullanılan süpürge (Purge) ikonunun, abort (iptal) sürecindeki mesajları geri döndürme (hortlama) sorunu `setTimeout` (50ms) asenkron çözümüyle engellendi. Artık temizlenen sohbet tamamen veritabanından siliniyor.
- **Universal Orchestration (Meta-Forge Hibrit Zeka):** Eskiden "Web Search" kapalı olduğunda sistem sadece düz (araçsız) sohbet edebilen `runAgent` rotasını kullanıyordu. Bu ayrım kaldırılarak tüm sistem istekleri istisnasız olarak `runOrchestration` (Akıllı Motor) üzerine bağlandı. Artık model (Web Search kapalı olsa bile) cebindeki `sys_execute_tool` aracı sayesinde inisiyatif alıp kendi araçlarını çağırabiliyor; basit işleri kendisi halledip, karmaşık araştırma gerektiren işleri `sys_delegate_to_agent` ile uzmanlara paslayan tam bir Hibrit Zeka (CEO) moduna geçti.

## 32. Completed (Phase 32) - Enterprise Routing, Reasoning Effort & UI Sync
- **Context Window Scaling Fix:** `Composer` bileşenine `activeModelId` parametresi geçirilerek UI'daki "Context Gauge" barının sabit 131k yerine seçili modelin gerçek bağlam sınırına (Örn: 8K, 128K) göre dinamik ölçeklenmesi sağlandı.
- **Live Camera & Speech-to-Text Integration:** Masaüstü tarayıcılarda `capture="environment"` (File explorer açılma) sorunu, `MediaDevices` API ile geliştirilen tam teşekküllü bir **Live Camera Modal** ile değiştirildi. Ayrıca çalışmayan "Record voice" butonu, anlık sesten metne çeviri yapan (Web Speech API) bir Dikte (Dictation) motoruna bağlandı.
- **Token/Telemetry Accuracy:** Llama.cpp ve R1 gibi modellerin `<think>` evresinde ürettiği token'lar faturaya/hıza yansımıyordu. `chat-orchestrate.mjs` içerisinde `assembledThinking` buffer'ı oluşturuldu ve `approxTokens` ile toplanarak gerçek performans (tok/s) UI'a şeffafça yansıtıldı.
- **True Enterprise Failover (Birleşik Yedekleme Hattı):** Sadece `models` tablosuna bağımlı kalan (Local Llama vb. provider'ı olmayan modellerde çöken) Router mantığı baştan yazıldı. Sistem artık hem kendi `models` kayıtlarını hem de Settings -> Providers ekranına eklenen yedek sağlayıcıları (`ai_providers` tablosu) *havada (UNION mantığıyla)* birleştirerek kesintisiz ve hatasız bir Failover Zinciri (Provider Chain) oluşturuyor. Öncelik (Priority) kuralları ASC (Düşük numara = Yüksek öncelik) standartına uygun şekilde bağlandı.
- **Agnostic Reasoning Effort (Düşünme Çabası):** UI'dan gelen `High, Medium, Low, None` Effort seviyeleri doğrudan backend'e ulaştırıldı. "None" seçildiğinde modelin düşünmesi `[THINKING EFFORT: NONE]` strict system promptu ile tamamen yasaklandı. Ayrıca o1, o3 veya gemini modellerine native olarak JSON payload'unda `reasoning_effort` veya `thinking_config` parametreleri aktarıldı. Gemini'nin Native Thinking bütçesi tetiklenerek pseudo-thinking tag'leri (veya `type: "think"`) üretmesi sağlandı.
- **Thread Context & Branch Fix:** UI'daki "Pin (Sohbeti Sabitle)", "Edit (Kalemle Düzenle)" ve "Branch (Forkla)" butonlarının kör bağlantıları düzeltildi. Düzenleme işlemleri eski `runAgent` motorundan sökülüp `runOrchestration` (Akıllı Motor) üzerine alındı. Pinned Context, her sohbette modele `[THREAD CONTEXT]` system şırıngası olarak başarıyla enjekte edildi.

## 33. Completed (Phase 33) - Native Context Compaction & Episodic Memory
- **Local LLM Compaction:** "Context Compact" işlemi sırasında verileri üçüncü parti bir cloud API'ye (Lovable Gateway) gönderen mock (taslak) kod tamamen silindi. Bunun yerine işlem doğrudan `fetchApi` ile kendi Node.js backend'imize (`/api/memory/compact`) bağlandı ve aktif model (Local/Sovereign) ile özetlenmesi sağlandı.
- **Database Persistence (Episodic Traces):** Sıkıştırılan sohbet özetleri sadece ekranda kalmıyor, aynı zamanda `memory_episodic` tablosuna (Zaman damgası hatası `to_timestamp` ile giderilerek) `INSERT` ediliyor. Böylece "Memory" sayfasındaki sayaçlar ve hatıra modülü hayata geçirildi.
- **Working Set Memory (Live Blocks):** Sohbet sırasında oluşturulan her cevabın faturası (Prompt + Response Token), `memory_working` (Kısa Vadeli Hafıza) tablosuna gerçek zamanlı olarak yazılmaya başlandı. "Memory" ekranındaki aşırı şişmiş token hesaplama (reduce/sum) mantık hatası giderilip sadece aktif working block okutularak 0-to-131K barının gerçeği yansıtması sağlandı.
- **Zero-Chat Ghost Bug Fix:** Kullanıcı tüm sohbetleri (veya son sohbetini) silip (Purge) yeni bir "Ask anything..." ekranına düştüğünde, aktif bir `thread_id` olmadığı için atılan ilk mesajın sessizce yok olması (Silent Fail) engellendi. `chat-store.ts` içindeki `commit` fonksiyonuna "Sıfır chat kalırsa arka planda sessizce `blankChat()` yarat" kuralı eklendi.
- **Unicode / Emoji Database Crashing Fix:** Modelin veya kullanıcının gönderdiği mesajlarda yarım kalan emojilerin (Isolated Surrogates) PostgreSQL `jsonb` parser'ını çökertmesi ve sohbeti kaydetmemesi (500 Error) sorunu, `threads.mjs` API'sine eklenen regex tabanlı bir Unicode Sanitizer ile tamamen çözüldü. Mükerrer (Duplicate) araç ekleme UI hatası giderildi.

## 34. Completed (Phase 34) - Overconfidence Prevention & Unified Tool Failure States
- **Honesty Directive (Sycophancy Fix):** Modellerin (Local veya Cloud) bir araç veya alt-ajan çağırdığında (Örn: Web Scraper) sonucun boş dönmesi durumunda eski eğitim verilerine dayanarak uydurma (Halüsinasyon) yapması engellendi. Boş/hatalı dönen tool sonuçlarına backend seviyesinde `[SYSTEM_WARNING: TOOL_FAILED_OR_EMPTY]` şırıngası eklenerek modelin kullanıcıya dürüstçe "Araç başarısız oldu" demesi zorunlu kılındı.
- **Unified Failure UI Status:** Ajan delegasyonu veya araç kullanımı boş bir JSON/Array döndüğünde, teknik olarak başarılı görünse de mantıken başarısız olduğu için `toolStatus = "failed"` kuralı eklendi. Böylece tüm agnostik modellerin başarısız araç çağrıları UI üzerinde tutarlı olarak Kırmızı (Failed) akordeon ile çizdirildi.

## 35. Completed (Phase 35) - Unified Execution Engine & Advanced Meta-Forge Orchestration
- **Switch/Case (Prefix Routing) Mimarisinin Kurulması:** LLM orkestrasyon motorunun kalbi olan `tool-adapters.mjs`, MCP (`mcp.`) ve Skill (`sk.`) araçlarını sistemde hatasız bulup çalıştırabilecek şekilde akıllandırıldı. Model, Directory aracılığıyla keşfettiği her yeteneği on-the-fly (havada) çalıştırabilir hale getirildi ve %100 Otonomi (Meta-Forge) sağlandı.
- **MCP STDIO & Cache Sync:** MCP Client mimarisine yerel süreçler başlatıp iletişim kurabilen (spawn+stdin/stdout JSON-RPC) gerçek `STDIO` desteği eklendi. UI tarafında Command/Argument kutuları ve "Probe" (manuel araç senkronizasyonu) butonları oluşturuldu. Yeni eklenen sunucuların kaydedildiği an otonom olarak (probe) araçlarını cache'e çekmesi garantilendi.
- **Güvenlik Kapısı & Zarf Düzenlemesi:** `chat-orchestrate.mjs` içindeki `sys_execute_tool` güvenlik kontrolü `action_library` dışına çıkarılarak MCP ve Skiller için yetki doğrulayacak şekilde genişletildi. Arayüzün `capabilities` zarfına eksik olan `mcp` dizisi eklendi. Web Search açıldığında, otonom ajanın bunu `sys_get_directory` içinde keşfedebilmesi için geçici meta-tool enjeksiyonu yapıldı. Ajan iterasyon limiti 5'ten 8'e çıkarıldı.
- **Google Gemini Native "Thinking" Çözümü:** Google API'sinin OpenAI uyumluluk katmanına (proxy) uyumsuz olan `thinking_config` argümanının sebep olduğu 400 Bad Request çökme/Failover sorunu tespit edildi. Vault key resolver'ı genişletildi (`:` desteği). Doğru `extra_body.google.thinking_config` şeması kullanılarak modelin kendi native reasoning yeteneği açıldı.
- **Stop, Supercede & UI Animasyon Fixi:** Google'ın content içinde yolladığı native `<thought>` tagleri stream sırasında parçalanıp yakalanarak UI baloncuğuna yönlendirildi. Mesajlar iptal edildiğinde (Send Now ezmesi veya kırmızı Stop butonu), ActiveRunId sıfırlanıp "done" fazı aktarılarak animasyonların ve mavi imlecin (orphan animation) havada donup kalması sorunu kusursuz bir event-loop ile çözüldü.
- **Chat Persistence & Memory Layout Fix:** `New chat` isimli boş chatlerin veritabanında F5 atıldıkça yığılması sorunu çözüldü. "Memory" sayfasındaki Working Set (Kısa Vadeli Hafıza) düz bir liste olmak yerine, veritabanından çekilen `thread_id` verisi kullanılarak ait oldukları "Sohbetlere" (Thread) göre mantıksal bloklar halinde gruplandı. Pinned (Sabitleme) işlemindeki görsel kayma (jump) bug'ı silindi.
- **Orchestrator Bridge Deny-List UX:** System Engine sayfasındaki "Denied MCP Clients" kara liste menüsü, veritabanından doğru sunucu ID'lerini (`mcp.slug`) ve okunaklı isimleri (`server.name`) çekecek şekilde Typescript tip dönüşümleriyle birlikte yeniden bağlandı.

## 36. Completed (Phase 36) - Agentic RAG Architecture & Legacy UI Cleanup
Bu faz, eski monolitik RAG sisteminin kalıntılarını temizlemeyi ve Enterprise seviyesinde, RBAC (Role-Based Access Control) destekli "Otonom RAG" mimarisini kurmayı hedefler. İşlemler context kaybını önlemek için kesin sınırlarla adım adım yapılmıştır.

### 1. Advanced Tuning & Legacy UI Temizliği (Ne Yaptık?)
- **Durum (TAMAMLANDI):** `src/routes/knowledge.tsx` dosyasından kullanılmayan `AdvancedTuningTab` (82 adet ayar barındıran KnobRow, TuningGroup) bileşenleri cerrahi bir şekilde silindi.
- **Durum (TAMAMLANDI):** Aynı sayfadaki `Database Ops` telemetri (Cache Hit Rate, Reads/Writes) verileri ve klasör okuma (Library Path Status) işlemleri doğrudan veritabanına ve backend'e (`pathStats` objesi ile) bağlandı. Hardcoded olan `HNSW pending` statik yazısı `k.health` telemetrisine (`HNSW ready`, `HNSW pending (x)`, `HNSW error (x)`) dinamik olarak bağlandı. `BrandAliasesTab` sayfasındaki Refresh butonu arkasında `syncBackend()` çağrısı yapılarak onarıldı. (Sıfır TypeScript hatası).

### 2. Yeni "Agentic RAG" Motoru Mimari Detayları
- **Durum (TAMAMLANDI):** Explicit Agentic RAG mimarisi başarıyla entegre edildi. Ana modele RAG kullanması yönünde ("[ENTERPRISE RAG DIRECTIVE]") sistem promptu basıldı.
- **Güvenlik / Space İzolasyonu (TAMAMLANDI):** Alt ajanın `rag_space_id` bilgisi üzerinden doğrudan klasör/dosya kısıtlaması (`bindingFileIds`) kurularak Departmanlar arası (Technical, Marketing, Shared vb.) yetkisiz bilgi sızması (split-brain veya yetki aşımı) engellendi. Ayrıca virgülle ayrılan "Keywords" listesi ayrıştırılarak (parse) sisteme eklendi.
- **UI Reranker Card (TAMAMLANDI):** `ragProbeAndFetch`'ten dönen kaynaklar UI'ın `RetrievalCard` kompanentinin tam beklediği objeye (index, name, score, reranker vb.) dönüştürüldü ve SSE üzerinden `send({ rag: ... })` ile fırlatıldı.
- **Not:** RAG altyapısının testleri ve derin debug işlemleri, sürecin çok karmaşık olması ve context havuzunu şişirmemesi adına daha sonraki bir faza ertelendi. Şimdilik sistemin backend logic'i hazır bırakıldı.

## 38. Completed (Phase 38) - Ownership (RBAC) Hardening, Run History & UI Mock Cleanups
Bu fazda, yetkilendirme (Role-Based Access Control) ve mülkiyet (Ownership) omurgasındaki ciddi güvenlik zafiyetleri ve veri kopuklukları onarılmıştır. Önceki fazlardan sarkan statik mock veri kullanımları (özellikle UI boş liste tepkilerinde) tamamen temizlenmiştir.

### 1. RBAC (Görünürlük) Sisteminin Onarılması
- Ortak gösterim bileşeni `OwnerChip`'in etiketleri `MINE`, `GROUP`, `WORKSPACE` olarak standartlaştırıldı ve CSS zorlamaları kaldırıldı.
- `local-server/lib/actor.mjs` içindeki `buildVisibility` fonksiyonu, kullanıcının hem UUID (`owner_id`) hem de üyesi olduğu tüm grupları (`groupIds`) çapraz sorgulayacak şekilde yeniden yazıldı.
- Sadece `private`/`workspace` bakan hatalı `chat-orchestrate.mjs` sorguları silinerek, Execution Motoru yetkilendirmesi de `buildVisibility` filtresine bağlandı.

### 2. Ajan, Skill ve Tool Mülkiyet (Owner) Kopuklukları
- **Skills & Capabilities:** Oluşturma/Kopyalama API'lerindeki `owner_id` ve `owner_name` kayıp verileri DB insert payloadlarına eklendi. Null kalan kayıtlar Admin ID'si ile mühürlendi.
- **MCP Clients:** Yeni bağlantı yaratılırken `ownerName` ve `ownerId` aktarılmaması (ve backend'in `resolveActorContext` süzgecinden geçirmemesi) sorunu çözülerek mülkiyet ataması hatasız hale getirildi.
- **Workflows & Planners:** API payloadlarına mülkiyet verileri dahil edilip Backend tarafına UUID mühürlemesi uygulandı. İsim çakışma koruması eklendi.

### 3. Agent Run History ve State Senkronizasyonu
- Backend (`agent-run.mjs`) tarafında Prompt-Only (Script'siz) ajanların çalıştırılması sırasındaki "bad request" çökmesi ve DB `stats` güncelleme (eski calls sütunu hatası) sorunu çözüldü.
- `src/lib/agent-store.ts` içerisine `run-history` endpointinden geçmiş logları çekme komutu eklendi. Dispatch butonu "mock" oluşturmaktan çıkartılıp bizzat gerçek API'ye bağlandı.
- Agent Top-P değerinin `.toFixed` kaynaklı `NaN` düşmesi sorunu sayı kontrolleriyle aşıldı.

### 4. UI Fallback (Mock) Verilerinin Silinmesi
- Forge Factory (`forge-store.ts`), Meta-Forge (`metaforge-store.ts`) ve Skills (`skill-store.ts`) depolarında, DB'den `[]` dönmesi halinde eski UI önbelleğine ve sahte verilere dönen fallback'ler ( `setItems(read())` ) iptal edildi. Temiz ve gerçek DB verisine geçildi.
- Meta-Forge "Reset Ledger" fonksiyonu gerçek backend silme (`DELETE`) api endpointine bağlandı.

### 5. Final Mock Purge and End-to-End Governance
- **Memory:** Temizlendi. İlk yüklemede sahte "Working Set" bloklarını ekrana basan mekanizma (`src/mocks/memory.ts`) silinerek gerçek DB tablolarına (`memory_working`, `memory_episodic`) bağlandı.
- **Webhooks:** Mülkiyet (owner_id ve owner_name) atamaları `create` API'sinde eksikti, tamamlandı. UI, backend tablosundan ("webhooks") beslenecek şekilde onarıldı, legacy `knowledge-store` kancalarından temizlendi.
- **Planners:** Arayüz boş kalmasın diye oluşturulan sahte `plannerSeed` fallback mekanizması tamamen çöpe atıldı. Güncelleme (PUT) API'sindeki owner verilerini sıfırlayan açık `COALESCE` sql kurgusu ile mühürlendi.
- **System Engine:** Ayarların backend'e kocaman bir JSON string (blob) olarak kaydedilmesi (`app_system_config` tablosunda) yerine, v2 şeması olan tiplendirilmiş `engine_config` tablosu devrede olacak şekilde `/api/engine-config` API'si yazıldı ve bağlandı.
- **Python Runtimes:** Sahte veriler (`seedRuntimes`) silindi. `resolveActorContext` çağrısı unutulduğu için `owner_name` sızdıran backend api uçları düzeltildi.
- **Targets:** `target-store.ts` E2E hale getirildi. Backend API'de owner boş bırakıldığında `req.session?.username`'den veya `ctx.actor`'den mülkiyet atanarak yetim kayıt engellendi.
- **Users & Groups:** Sahte `defaultAccounts` ve `defaultGroups` dizileri silindi, UI doğrudan DB tablolarına (`app_users`, `app_groups`) oturtuldu.
- **User Templates:** `seedTemplates` mock verisi tamamen arındırıldı.
- **RBAC:** Fallback mekanizması (`defaultRoles`) temizlendi. Sistemin mülkiyet atamayan (global) "Roller" mantığının DB (app_roles) yapısıyla uyumlu olduğu teyit edildi.
- **Knowledge Spaces / Vault / Security:** Mock veri kalıntıları, gereksiz importlar (`directoryGroupMail`) temizlendi, DB yapılarının (%100) uyuştuğu doğrulandı.

## 39. Completed (Phase 39) - MetaForge JSON Parser, AST Extraction & Orchestration Loop
- **Sorun Çözüldü (JSON Parser):** LLM'in (Gemini/Gemma vs.) MetaForge ajanındayken ürettiği Plan objesini JSON parse ederken, körlemesine çalışan `.replace()` regex komutları nedeniyle iç içe geçmiş markdown bloklarının sökülüp `JSON.parse()` fonksiyonunun çökmesi engellendi. `extractForgeJson` fonksiyonuna Regex yerine "dıştan içe AST tarama" mantığı eklendi.
- **Onay Süreci Uyanışı (Approval Loop):** UI'da "Approve" (veya Reject) butonuna basıldığında modelin (LLM) donup kalması sorunu aşıldı. Onay veya red anında `[SYSTEM_NOTE]` mesajı otonom olarak chat akışına `dispatch` edilerek ana modelin uyanıp yeteneği kullanmaya devam etmesi sağlandı.
- **SQL Şema Uyumsuzluğu (UUID & Slug):** MetaForge apply (uygulama) motoru (`apply.mjs`) içindeki V1 SQL kalıntıları temizlendi. `skills` ve `capability_packs` tablolarına insert edilirken olmayan `slug` gibi kolonların hata verdirmesi sorunu V2'ye (`v2_master_schema.sql`) uygun kolon eşleşmesiyle onarıldı. `forge_artifacts` tablosunun `plan_id` UUID tür uyuşmazlığı, `text` türüne alter edilerek giderildi.
- **Re-Apply (Conflict 409):** `rolled_back` statüsündeki MetaForge planlarının yeniden uygulanmasına izin verilmesi için backend kontrol mantığı esnetildi.
- **Halüsinasyon (Honesty Prompt) Önlemi:** Araçlar hata döndüğünde modelin sahte veri üretip sohbeti sonlandırması ihtimaline karşı System Prompt'a kesin bir `[HONESTY DIRECTIVE]` enjekte edildi ve iterasyon (ajan deneme) limiti israf olmasın diye 15'e çıkarıldı.

## 40. Completed (Phase 40) - MetaForge Approval Flow Final Polish & Failover Fixes
- **Approve Çökme Sorunu Çözüldü:** React içerisindeki `setMessages(msgs => [...msgs])` closure kaynaklı "messages.reduce is not a function" (dizi referansı kaybolma) hatası, fonksiyonel array map `setMessages(updatedMsgs)` ile güvenli hale getirildi. Onay veya Ret verildiğinde sohbet ekranının çökmesi engellendi.
- **Failover / Routing Sorunu Çözüldü:** Ana sohbette (örneğin Gemini 3.1) seçili olmasına rağmen MetaForge (`agt.forge_master`) tetiklendiğinde `pickProviderForRequest` fonksiyonunun inatla önceliği düşük olan `Gemma Local` modelini çağırması problemi onarıldı. Artık MetaForge otonom ajanları, ana sohbeti başlatan asıl model (`finalProviderUsed`) neyse onu kullanmaya zorlanmaktadır.

## 41. Completed (Phase 41) - Agent/Tool Execution Bridge & MetaForge Synthesis Standard
- **`disk-runner.mjs` stdin & argv[1] Köprüsü:** Python scriptlerinin parametreleri hem `sys.stdin` (örn: `json.load(sys.stdin)`) hem de `sys.argv[1]` üzerinden çift yönlü alabilmesi sağlandı. Script çıkışında stdout doluysa hatalı çıkış durumlarında dahi JSON çıktısının yakalanması garantiye alındı.
- **MetaForge Sentez Standartı (`seed.mjs` & `apply.mjs`):** MetaForge master ajanına üretilen Python scriptlerine `# @args: {"param": "type"}` ve `# @description:` başlıklarını ekleme zorunluluğu getirildi. `apply.mjs` dosyasında ise başlık eksikse plan meta verilerinden otomatik `# @description:` enjekte eden koruma eklendi.
- **`tools-scan.mjs` Akıllı Parametre Çıkarımı:** Python scriptinde `# @args` başlığı unutulsa dahi kod içerisindeki `.get('param')` çağrılarından otomatik parametre şeması çıkaran fallback eklendi. Böylece `sys_get_directory` içinde `params: []` boş kalma sorunu ortadan kaldırıldı.
- **`tool-adapters.mjs` Adapter Yönlendirme Güvencesi:** `action_library` ve `tools` tabloları arasında güvenli fallback kuruldu; python scripti içeren araçların sahte `builtin` echo bloğuna düşmesi engellendi.
- **Canlı SSL Tool İyileştirmesi:** `ssl-expiry-check.py` ve `http_probe.py` scriptleri hem domain/url ayrıştırma hem de çift yönlü girdi okuma yapacak şekilde güncellendi.
- **Birleşik Master System Direktifi (`chat-orchestrate.mjs`):** Farklı yerlere dağılmış ve birbiriyle çelişen prompt parçaları temizlendi. Modelin (özellikle yerel Gemma 31B'nin) araç hatasında tahmin uydurmasını engelleyen ve eksik araçlarda derhal MetaForge'a başvurmasını emreden tek, bütüncül ve çelişkisiz `[SOVEREIGN CORE DIRECTIVE]`, `[UNIVERSAL AUTONOMY & METAFORGE MANDATE]` ve `[HONESTY & ANTI-HALLUCINATION MANDATE]` bloğu sistem promptunun en başına yerleştirildi.

## 42. Completed (Phase 42) - MetaForge Approval Card UX & Clean Chat Stream Restoration
- **Kullanıcı Adı (Author) Onarımı (`chat-orchestrate.mjs`):** MetaForge planlarında `author` alanına ham UUID (`00000000-0000-...`) yerine oturum açan kullanıcının gerçek kullanıcı adı (`req.session?.username` / `actorCtx.username` / `admin`) yazılması sağlandı. Hem onay kartında hem `/meta-forge` ledger sayfasında insan dostu isimler görünür kılındı.
- **Sessiz Uyanış & `[SYSTEM_NOTE]` Balonu Gizleme (`src/routes/index.tsx`):** Kullanıcı onay veya ret verdiğinde ekranda çirkin `YOU: [SYSTEM_NOTE]...` mesaj baloncuğu oluşması engellendi. Bu bildirim modele arka planda `hidden: true` bayrağıyla sessizce iletildi; UI orijinal Lovable tasarımındaki gibi tertemiz bırakıldı.
- **Onay/Ret Sonrası Kart Kapanışı:** Onay veya Ret tıklandığında kart ekranda donup kalmak yerine zarifçe kapanır (`forge_plan: undefined`); onaylanan planlar doğrudan `/meta-forge` ledger ekranında listelenir ve rollback imkanı sunar.
- **Takılı Kalan Animasyonlar (Thinking Cursor & Bar Donması):** `forge_plan` olayı geldiğinde `act.phase = "done"`, `setStreaming(false)` ve `paint(false)` tetiklenerek önceki mesajın thinking imlecinin (`|`) ve orkestrasyon barının sonsuz animasyonda kalması engellendi; tamamlanmış statik duruma çekildi.

## 43. Completed (Phase 43) - Thought Tag Streaming Parser, Frozen Bar State & Computation Tool Rule
- **Thought Tag `<think>` & `<thought>` Ayrıştırma (`chat-orchestrate.mjs`):** Stream token parçalanması (boundary split) durumlarında `<think>` veya `</think>` etiketlerinin metin içine sızması engellendi. Hem Gemini hem yerel (Gemma) modeller için düşünce blokları eksiksiz yakalanarak UI `ThinkingBlock` içine katlandı.
- **Orkestrasyon Bar Başlığı & Donma Durumu (`tool-activity.tsx` & `index.tsx`):** `activity.phase === "loop"` durumunda stream tamamlandığında başlığın sonsuz "Agent reviewing results..." kalması engellendi; `live = false` anında doğrudan `X/X capabilities executed` statik tamamlanma moduna geçmesi sağlandı.
- **Hesaplama/Matematik İçin Zorunlu Python Tool Kuralı (`seed.mjs`):** MetaForge'un IP/CIDR, matematik, kriptografi veya veri ayrıştırma gerektiren görevlerde prompt yeteneği (`skill`) yerine **kesinlikle Python çalıştırma aracı (`tool`)** üretmesi kurala bağlandı.
- **3 Kademeli Akıllı Karar Hiyerarşisi (`chat-orchestrate.mjs`):** "Over-orchestration" (aşırı araç bağımlılığı) engellendi. Subnet/CIDR hesabı, algoritma ve matematik gibi saf mantıksal işlemler TIER 1 (Native `<think>`) ile 0.5 saniyede çözülecek; güncel internet aramaları TIER 2 (`sys_web_search` - Tavily/SearXNG/DDG) ile yapılacak; yalnızca gerçek harici altyapı/API entegrasyonu eksikse TIER 3 (`sys_delegate_to_metaforge`) devreye girecek şekilde direktif hiyerarşisi kuruldu.
- **React Duplicate Key Onarımı (`tool-activity.tsx`):** Tek bir turda birden fazla `sys_execute_tool` çağrıldığında oluşan `Encountered two children with the same key` uyarısı `key={`${run.name}-${i}`}` ile kalıcı olarak giderildi.

## 44. Completed (Phase 44) - Core System Agent (MetaForge) Protection & UI Isolation
- **Ajan Listesi İzolasyonu (`agents-crud.mjs`):** `agt.forge_master` ajanı `/agents` arayüz listesinden filtrelenerek gizlendi. Kullanıcılar yalnızca kendi oluşturdukları iş ve operasyon ajanlarını görür.
- **Backend Silme & Düzenleme Koruması (Immutability Gate):** `DELETE /api/agents/:id` ve `PUT /api/agents/:id` endpointlerine güvenlik kilidi eklendi. `agt.forge_master` ve `sys.*` sistem çekirdek ajanlarının doğrudan silinmesi veya bozulması HTTP 403 ile engellendi.
- **Dahili Kod Düzeyi Motor Güvencesi:** MetaForge master motoru (`seed.mjs` ve `planner.mjs`) doğrudan backend sürecinde yerleşik (built-in) olarak korunarak, DB'de kayıt olmasa dahi kendi kendini iyileştiren (self-healing) bir altyapı servisi haline getirildi.

## 45. Completed (Phase 45) - MetaForge Autonomous Workflow, Webhook & DAG Synthesis Engine
- **Workflow DB & Canvas Görsel Eşleşmesi (`apply.mjs` & `workflows.mjs`):** `applyWorkflowCreate` motoru, `nodes` ve `edges` dizilerini `workflows` tablosuna `visibility = 'private'` (`MINE` - Zero-Trust Kurumsal Güvenlik) ve `owner_id = forgedBy` ile kaydeder. Plan içinde düğümler eksikse dahi otomatik olarak Trigger $\rightarrow$ Tool $\rightarrow$ Condition $\rightarrow$ Output düğümlerini sentezleyip `/workflows` Canvas arayüzünde canlı çizilmesini sağlar.
- **Görünürlük Rozeti Standartlaştırması (`OwnerChip` / `ownership-controls.tsx`):** `OwnerChip` bileşenindeki isim karmaşası giderildi. Rozet üzerinde ham kullanıcı adı yerine her zaman yetki seviyesi etiketleri (`MINE`, `GROUP`, `WORKSPACE`, `SYSTEM`) standart olarak basılır.
- **Orchestration Zincirleri Doğrulaması (`/api/chains` & `orchestrations`):** Çoklu iş akışı zincirleri `buildVisibility` ve `owner_id/owner_name` eşleşmesiyle test edilip doğrulandı. Canvas ve veritabanı uçtan uca uyumlu hale getirildi.
- **Thinking Taşması Nihai Koruması (`rich-message.tsx`):** `parseBlocks` fonksiyonuna regex temizleyici eklenerek ekranda render edilmeden önce olası tüm `<think>` ve `<thought>` blokları metinden arındırıldı.
- **Plan Doğrulama Genişletmesi (`planner.mjs`):** MetaForge plan doğrulayıcısına `workflow`, `chain`, `orchestration` ve `webhook` tipleri eklendi. Envanter tarayıcısına (`buildInventory`) mevcut `workflows` ve `orchestrations` tabloları dahil edildi.
- **Workflow & Chain İcra ve Kayıt Motoru (`apply.mjs`):**
  - `applyWorkflowCreate`: MetaForge tarafından önerilen Trigger $\rightarrow$ Tool/Agent/Skill $\rightarrow$ Logic/Condition $\rightarrow$ Output düğümlerini doğrudan `workflows` tablosuna kaydeder.
  - `applyChainCreate`: Çoklu iş akışlarını birbirine bağlayan orkestrasyon zincirlerini `orchestrations` tablosuna işler.
  - `rollbackForgePlan`: Onaylanan workflow, chain veya webhook'ları tek tıkla geri alma desteği sağlandı.

## 46. Completed (Phase 46) - Autonomous Workflow & Orchestration Synthesis Fixes
MetaForge tarafından sentezlenen çok adımlı Workflow (DAG) ve Orchestration zincirlerinin arayüzde görünmeme, kaydedilmeme ve isim halüsinasyonu sorunları uçtan uca çözüldü.

### Tespit Edilen Kök Sebepler & Yapılan Düzeltmeler:
1. **Budget Cap (3 Turn) Budama Sorunu (`apply.mjs`):**
   - **Kök Sebep:** `DEFAULT_MAX_ITEMS_PER_TURN = 3` olarak sınırlandığı için, modelin 3 Python aracı + 1 Workflow DAG içeren 4 elemanlı planlarında son sıradaki `workflow` nesnesi `deferred` listesine atılıp veritabanına yazılmadan sessizce budanıyordu.
   - **Çözüm:** Limit karmaşık iş akışları ve orkestrasyon zincirlerini kapsayacak şekilde `25`'e yükseltildi. Artık tüm DAG akışları eksiksiz kaydediliyor.
2. **Slug / ID Prefix Standardizasyonu (`apply.mjs`):**
   - **Kök Sebep:** Model `slug: "wf.my-pipeline"` veya `slug: "orc.my-chain"` ürettiğinde `wf_wf.my-pipeline` gibi çift önekli veya noktalı ID'ler oluşabiliyordu.
   - **Çözüm:** `cleanSlug` ile `wf.`, `workflow.`, `orc.`, `chain.` önekleri temizlenip standart `wf_<slug>` ve `orc_<slug>` ID üretimi sağlandı.
3. **DAG Düğüm & Kenar Normalizasyonu (`apply.mjs`):**
   - Modelden gelen `source.nodes`, `source.edges` ve `config` nesneleri temizlenerek Canvas arayüzünün doğrudan anlayacağı `from`/`to` ve koordinat formatına (`x`, `y`) normalize edildi. Canvas üzerinde "SSL Monitor Workflow" düğümleriyle (Trigger -> Tool -> Logic -> Tool/Output) hatasız çizildi.
4. **İsim Uyuşmazlığı ve Dizin Farkındalığı (`chat-orchestrate.mjs` & `index.tsx`):**
   - **Kök Sebep:** Model plandaki teknik slug (`ssl-monitor-workflow`) ile insanın gördüğü başlık adını (`SSL Expiry Monitor Workflow`) karıştırıyor, tabloda isim yerine slug yazıyordu.
   - **Çözüm:** `chat-orchestrate.mjs` prompt direktiflerine İsim ve Slug ayrımı (`| Tür | İsim | ID / Slug | Açıklama |`) eklendi. Modelin sohbette ve tablolarda insan dostu başlık adını (`SSL Expiry Monitor Workflow`) esas alması sağlandı.
5. **Onay Kartı Hover Titreme / Titreşim Sorunu (`index.tsx` & `metaforge-approval-card.tsx`):**
   - **Kök Sebep:** `src/routes/index.tsx` içerisindeki `requestAnimationFrame` scroll takip efekti bağımlılık dizisi olmadan (`[]` eksik) her render'da tetikleniyordu. Kartın üzerine gelindiğinde oluşan hover state'i scroll tetikliyor, bu da sonsuz bir layout/hover titreme döngüsüne (jitter) yol açıyordu.
   - **Çözüm:** Scroll efekti yalnızca `[messages, streaming]` değiştiğinde çalışacak şekilde sınırlandı. `metaforge-approval-card.tsx` içindeki buton ve ikon hover transformasyonları reflow oluşturmayan pürüzsüz CSS geçişlerine (`transition-all`) dönüştürüldü.
6. **Plan Onaylama 409 (Conflict) ve Çift Tıklama Koruması (`meta-forge.mjs` & `metaforge-approval-card.tsx`):**
   - **Kök Sebep:** Kullanıcı "APPROVE" butonuna bastığında network gecikmesi veya çift tıklama durumunda ilk istek planı `applied` durumuna alıyor, milisaniye sonra giden ikinci istek ise `plan status is applied` diyerek HTTP 409 dönüyordu.
   - **Çözüm:** `/api/meta-forge/plans/:id/apply` endpoint'i idempotent hale getirildi (`status === "applied"` ise 200 OK döner). Kart butonlarına `submitting` durumu eklenerek mükerrer tıklamalar kilitlendi.

## 47. IN FOCUS / DEVİR PLANI (Phase 47) - Autonomous Workflow & Orchestration Pipeline Hardening
- **Frontend Canvas & Tab Otomatik Odaklanma:** Onaylanan yeni `wf_...` veya `orc_...` akışının `/flows` ve `/orchestration` Canvas'ında otomatik seçilmesi.
- **DAG İcra Doğrulaması (`workflow-engine.mjs` & `workflows.mjs`):** Sentezlenen düğümlerin "Run Workflow" ile adım adım yürütülmesi.
- **Template Literal Backtick Koruması (`chat-orchestrate.mjs`):** Direktif metinleri içindeki ters tırnaklar temizlendi; JS template literal evaluation hatası (`flows is not defined`) giderildi.

## 48. UP NEXT (Phase 48) - Agentic RAG & Knowledge Hub Validation
- Dondurulan RAG entegrasyonu, departman bazlı space izolasyonu (`rag_space_id`), dosya indeksleme ve reranker testleri devreye alınacak.