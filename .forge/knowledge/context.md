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
7. **Zero-Trust & MINE (`private`) Görünürlük Standardizasyonu (`apply.mjs`):**
   - MetaForge tarafından sentezlenen tüm varlıkların (`agent`, `skill`, `tool`, `webhook`, `workflow`, `orchestration`) varsayılan görünürlüğü kurumsal güvenlik gereği strictly `'private'` (`MINE`) olarak kilitlendi. Yalnızca oturum açan kullanıcı ve yetkili operatörler görür.
8. **Chat Tablo Stream Titreme & Jitter Çözümü (`rich-message.tsx`):**
   - `parseBlocks` içerisindeki tablo ayrıştırıcı streaming dostu hale getirildi. Satırların akış esnasında `<p>` ve `<table>` arasında sürekli gidip gelmesi (flicker) engellendi.
9. **Meta-Forge Ledger SSR Hydration Mismatch Onarımı (`metaforge-store.ts` & `meta-forge.tsx`):**
   - Sunucu tarafında (SSR) `0 applied` render edilirken istemcide localStorage'dan `1 applied` gelmesinden kaynaklanan React hydration hatası çözüldü; store ve route bileşeni güvenli hydration döngüsüne bağlandı.
10. **Birleşik Rollback & Reset Ledger Mimarisi (`meta-forge.mjs`, `metaforge-store.ts`, `meta-forge.tsx`):**
   - **`reapply` Endpoint'i:** Geri alınmış (`rolled_back`) planların tek tıkla (`RE-APPLY`) tüm dosyaları, araçları ve workflow'larıyla eksiksiz yeniden ayağa kaldırılması sağlandı.
   - **Reset Ledger Seçenek Modalı:** "Reset Ledger" tıklandığında operatöre 2 açık ve seçilebilir seçenek sunulur (1. seçenek varsayılan seçili):
     1. *Clear History Only (Log Purge):* Sistemdeki aktif araç ve iş akışlarına dokunmadan yalnızca defter geçmişini temizler.
     2. *Clean Sweep & Rollback (Factory Reset):* Tüm otonom varlıkları geri alıp `.forge-trash`'e taşır, veritabanını temizler ve defteri sıfırlar.
11. **Orchestration Chain ve Çok Adımlı Akış Yönlendirmesi (`chat-orchestrate.mjs` & `seed.mjs`):**
   - Kullanıcı "Orchestration Zinciri (Chain)" veya "Workflow DAG" istediğinde modelin metinsel yanıt uydurması engellendi; `sys_delegate_to_metaforge` aracı ve TIER 3 direktifleri çoklu iş akışlarını kapsayacak şekilde zorunlu kılındı. `agt.forge_master` ajanına orchestration chain örnek şablonu işlendi.
12. **Orchestration Chain DB Kolon Şema Uyumsuzluğu (`apply.mjs`):**
   - `applyChainCreate` fonksiyonunda `orchestrations` tablosuna `updated_at` kolonu yazılmaya çalışıldığı için (`column "updated_at" of relation "orchestrations" does not exist`) zincir kaydı atlanıyordu; sorgu `v2_master_schema.sql` standardına (`created_at`) uyumlu hale getirilerek `orc_sec_compliance_audit` 6 düğüm ve 6 kenarla başarıyla kaydedildi.
13. **Orphan & Trash Hub (Arşiv Çekmecesi) Mimarisi (`meta-forge.mjs`, `metaforge-store.ts`, `meta-forge.tsx`):**
   - **Trash API:** `.forge-trash` dizinindeki tüm Python araç ve ajanlarını listeleyen (`GET /api/meta-forge/trash`), tek tıkla geri yükleyen (`POST /api/meta-forge/trash/:fileName/restore`) ve kalıcı silen (`DELETE`) API uçları eklendi.
   - **Rollback Guard:** Rollback butonuna basıldığında kazara silmeleri önlemek için onay dialogu (`confirmAction`) bağlandı.
   - **Meta-Forge Trash Drawer:** `/meta-forge` arayüzüne **"Trash & Archive"** butonu ve arşiv modalı eklendi. Defter sıfırlansa dahi geri alınmış tüm varlıklar bu çekmeceden tek tıkla kurtarılabilir hale getirildi.
14. **Yerel Model (Gemma 4 / LLaMA) Pseudo-Tool Call Ayrıştırıcı (`chat-orchestrate.mjs`):**
   - Yerel modellerin OpenAI JSON tool-call formatı yerine metin akışı içinde ürettiği `<call:sys_delegate_to_metaforge intent="..." />` ve `<tool_call>...</tool_call>` etiketleri arka planda yakalanarak canlı fonksiyon çağrısına dönüştürüldü; metinden temizlenerek onay kartının fırlatılması sağlandı.
15. **MetaForge & Agentic ReAct Hız Optimizasyonları (`chat-orchestrate.mjs`):**
   - **Adaptive Turn Effort:** İlk turda kullanıcının seçtiği effort ("high") kullanılır; araç çalıştırma sonrası turlarda (Turn 2+) modelin eldeki sonuç üzerine dakikalarca gereksiz düşünce döngüsüne girmemesi için effort adapte edildi ("low"/"none").
   - **Sub-Agent Hızlandırması (`sys_delegate_to_agent`):** Alt ajan çağrıları `effort: "low"` moduna çekilerek yanıt süreleri saniyeler seviyesine indirildi.
   - **Payload Truncation Guard:** `crt.sh` gibi devasa veri dönen araçların 20.000+ karakterlik ham çıktıları context şişmesi ve yerel modelde 1 tok/s darboğazı yaratmaması için güvenli özetleme notuyla sınırlandırıldı.
   - **Enterprise ReAct Tavanı (15 Tur):** Kurumsal seviyedeki çok adımlı, karmaşık ve çoklu araç zincirleme operasyonlarına tam özgürlük tanımak amacıyla döngü tavanı 15 tur olarak korundu. Adaptive effort ve payload guard sayesinde bu turlar takılmadan akıcı işler.

## 47. Completed (Phase 47) - Autonomous Pipeline Polish, Lifecycle Hardening & Latency Profiling
Bu aşamada MetaForge ve Chat orkestrasyonundaki kritik senkronizasyon, yaşam döngüsü (Lifecycle), geri alma (Rollback), envanter doğruluğu ve arayüz akış problemleri uçtan uca çözüldü.

### Yapılan Düzeltmeler & Mimari İyileştirmeler:
1. **Onay Kartı Render Zamanlaması ve Yerleşimi (`chat-orchestrate.mjs` & `index.tsx`):**
   - `e.kind === "forge_plan"` olayı geldiğinde erken `setStreaming(false)` çağrısı engellendi.
   - Onay kartı JSX koşulu `m.forge_plan && !m.streaming` kuralına bağlandı; model önce açıklamasını, tablosunu ve özetini eksiksiz yazar, akış bittiği anda onay kartı en altta Sovereign `rise` animasyonuyla zarifçe belirir.
2. **Varlık Yaşam Döngüsü & Rollback/Reset Tam Silme Güvencesi (`apply.mjs` & `meta-forge.mjs`):**
   - `rollbackForgePlan` fonksiyonunun araçları ve ajanları `action_library`, `tools` ve `agents` tablolarından silmemesi (öksüz/hayalet kayıt bırakması) sorunu kalıcı olarak giderildi.
   - Geri alma ve defter sıfırlama (clean sweep) işlemlerinde `.py` dosyası `.forge-trash/` dizinine taşınırken tüm ilişkili veritabanı kayıtları (`action_library`, `tools`, `agents`, `capabilities`, `skills`, `workflows`, `orchestrations`, `webhooks`) eksiksiz temizlenir.
3. **Dizin ve Envanter Hayalet (Orphan) Filtresi (`chat-orchestrate.mjs` & `planner.mjs`):**
   - `sys_get_directory` ve `buildInventory` sorgularına `COALESCE((runtime->>'orphan')::boolean, false) = false` filtresi eklendi. Model artık dizinde asla diskte olmayan ölü araçları görmez.
   - Geçmiş testlerden kalan ve diskte dosyası olmayan 17 adet hayalet araç veritabanından tamamen süpürüldü.
4. **Toleranslı ve Kendi Kendini İyileştiren Eşleştirici (`chat-orchestrate.mjs`):**
   - `sys_execute_tool` icra motoruna toleranslı çözücü eklendi. Model `ssl-cert-probe`, `tool.ssl-cert-probe` veya bare slug kullansa dahi sistem bunu otomatik olarak kanonik kimliğe (`tool.ssl-cert-probe`) eşler. MCP araçları için de `mcp.` önek tamamlama desteği sağlandı.
5. **Düşünce Ayrıştırıcı & Dil Direktifi (`chat-orchestrate.mjs`):**
   - `<think>` ve `<thought>` etiketlerinin güvenli ayrıştırılması sağlandı, normal metinlerin düşünce kutusuna kaçması engellendi.
   - `masterDirectives` içine `[LANGUAGE & RESPONSE DIRECTIVE]` eklenerek modelin doğrudan kullanıcının diliyle (Türkçe) konuşması kurala bağlandı.
6. **Chat Akış Titremesi (Flicker) ve Storage Optimizasyonu (`chat-store.ts`, `rich-message.tsx`, `index.tsx`):**
   - Akış esnasında her harfte `localStorage.setItem` çağrılması engellendi, 350ms'lik debounce arkasına alınarak Main Thread donmaları yok edildi.
   - İmleç animasyonu donanım hızlandırmalı saf CSS `animate-pulse` sınıfına çekildi.
   - `rich-message.tsx` içerisindeki `Inline` bileşenine akış esnasında kapanmamış `**...` kalın metin parçaları için yumuşak geçiş eklendi, font sıçramaları ve titremeler giderildi.
7. **Composer `#MCP` Payload Entegrasyonu (`index.tsx`):**
   - `orchestrateBody` içinde unutulmuş olan `mcp: Array.from(finalMcp)` alanı eklenerek `#MCP` seçimlerinin eksiksiz backend'e akıtılması sağlandı; modelin genel web kazıma (`web_fetch`) yerine doğrudan resmi GitHub MCP fonksiyonlarını (`mcp.github.*`) çalıştırması sağlandı.
8. **OpenAPI JSON Şema Tip Standartlaştırması (`chat-orchestrate.mjs`):**
   - Parametre tiplerindeki `text`, `secret` gibi uyumsuz tipler katı JSON şema standartlarına (`string`, `number`, `boolean`, `object`, `array`) dönüştürüldü (`mapJsonSchemaType`). Google Gemini ve Cloud modellerinde yaşanan 400 Bad Request ve sessiz failover problemleri tamamen ortadan kaldırıldı.
9. **Kanonik Skill ID Standardizasyonu (`apply.mjs`, `skills.mjs`, `skills` DB):**
   - Tüm yetenekler hem MetaForge sentezinde hem UI modalında zorunlu `sk.<slug>` standardına bağlandı; veritabanındaki yalın kayıtlar `sk.` önekiyle güncellendi ve `sys_execute_tool`'un çift önek (`skill_sk_...`) çözümü zırhlandırıldı.
10. **`@Agent` Persona ve Direktif Enjeksiyonu (`chat-orchestrate.mjs`):**
    - Sohbette `@Agent` seçildiğinde seçilen ajanın `system_prompt`, isim ve uzmanlık talimatlarının `[ACTIVE AGENT PERSONA ACTIVATED]` başlığıyla modele doğrudan enjekte edilmesi sağlandı.
11. **Native Skill İcra Motoru & Generator Delegasyonu (`tool-adapters.mjs`, `agent-utils.mjs`):**
    - Async generator (`yield*`) delegasyonu ve alt model çağrılarında Vault API anahtarının çözümlenmesi onarılarak Native Prompt Skill'lerin canlı model üzerinden eksiksiz rapor üretmesi sağlandı.
12. **Model Hiperparametreleri & Repetition Penalty (`chat-orchestrate.mjs`):**
    - Model kartındaki `temperature`, `top_p`, `top_k`, `repetition_penalty` (1.100), `max_tokens` (8192) ve `stop_sequences` alanları veritabanı sorgusuna ve LLM istek gövdesine tam olarak bağlandı; Llama.cpp ve yerel modellerin kelime tekrarına düşmesi önlendi.
13. **Canlı Model Bağlantı Probu (`models.mjs` & `models.tsx`):**
    - Model kartındaki "Test connection" butonu `POST /api/models/probe` üzerinden gerçek sağlayıcıya canlı ping atarak gerçek gidiş-dönüş gecikmesini (Round-trip Latency) ölçecek şekilde aktif edildi.
14. **Zengin Emoji Kütüphanesi & Dinamik Ajan Sayacı (`composer.tsx` & `index.tsx`):**
    - 250 adetlik tam emoji paleti yerel olarak entegre edildi; karşılama ekranındaki durum satırı doğrudan `agents` tablosundaki aktif ajan sayısına bağlandı (`fleet nominal · X agents online`).
15. **Kod ve Yorum Dili Standartlaştırması:**
    - Chat bileşenlerindeki ve orkestratördeki tüm Türkçe yorum satırları, karşılama metinleri ve konsol logları kurumsal İngilizce standartlarına dönüştürüldü.
16. **`tools/shell_exec.py` Akıllı Komut & Dizin Ayrıştırıcısı:**
    - `shlex.split` ile modelin tek satırda gönderdiği `ls -la /tmp` gibi komutlar ayrıştırılarak `/tmp` ve sistem dizinlerinin güvenle listelenmesi sağlandı; `command_path_not_allowed` hatası giderildi.
17. **Forge Factory & Skills Script Path Ön Ek Onarımı (`factory.tsx`, `skills.tsx`):**
    - Açılır menüdeki `{sc.folder}/{sc.relPath}` kaynaklı `tools/tools/...` mükerrerliği kaldırılarak doğrudan `{sc.relPath}` biçimine getirildi (`tools/a10_axapi.py`).
18. **Model Kartı Dinamik Yetkilendirme & Sıfır Hardcoding:**
    - Tüm model hiperparametreleri (sıcaklık, tekrar cezası, durdurma dizilimleri, gelişmiş parametreler) kodda sabit değerler yerine doğrudan model kartı arayüzü ve veritabanına bağlandı.

## 48. Completed (Phase 48) - Reporting & Analytics Enterprise Engine Migration (Zero-Mock E2E)
Bu aşamada ELARA Sovereign Studio'nun sol menüsündeki tüm Raporlama ve Analitik (REPORTING) modülü frontend içi sözde-rastgele mock fonksiyonlarından (`Math.sin`, `rnd()`, `splitWeights()`, `localStorage`) tamamen arındırılarak gerçek PostgreSQL veritabanı tablolarına (`provider_usage`, `usage_daily`, `schedules`, `schedule_deliveries`, `rag_queries`, `app_users`, `knowledge_sources`) ve `api-v2.mjs` API gateway'ine bağlandı.

### Yapılan Geliştirmeler & Mimari İyileştirmeler:
1. **Backend Reporting Router (`local-server/lib/routes/reporting.mjs` & `api-v2.mjs`):**
   - Kurumsal seviyede, agnostik ve ölçeklenebilir raporlama servisi yazıldı ve gateway'e `safeMount('Reporting & Analytics', mountReportingRoutes, app, deps)` ile bağlandı.
   - İdempotent şema güvencesiyle `schedules`, `schedule_deliveries` ve `rag_queries` PostgreSQL tabloları ve indeksleri otomatik olarak oluşturuldu.
2. **Overview & Summary Rollup (`/api/reporting/overview` & `src/routes/reporting.overview.tsx`):**
   - Dinamik zaman aralığı süzgeci (`7d`, `30d`, `90d` veya özel tarih aralığı `from` → `to`).
   - `provider_usage` tablosundan gerçek çalışma sayıları, işlenen token hacimleri, harcanan toplam maliyet (`cost_usd`), hata oranları ve ortalama gecikmeler toplandı.
   - Sağlayıcı (Local vs Cloud) ve Squad dağılımları doğrudan DB verisiyle eşlendi.
3. **Usage Analytics Engine (`/api/reporting/usage` & `src/routes/reporting.usage.tsx`):**
   - İş yükü kırılımı (`Chat orchestration`, `Workflow runs`, `RAG retrieval`, `Tool / MCP calls`, `Vision & Voice`) backend'den canlı kategorize edildi.
   - Günlük token hacmi, zirve (peak) gün ve gecikme dağılımı gerçek verilere bağlandı.
4. **FinOps Cost & Spend Ledger (`/api/reporting/cost` & `src/routes/reporting.cost.tsx`):**
   - Giriş ve çıkış token'ları için model bazlı gerçek birim fiyatlandırma ve toplam maliyet dökümü (`cost_usd`).
   - Altyapı GPU saatleri, Vector store disk alanı (`knowledge_sources.size_mb`), nesne depolama ve çıkış (egress) maliyet kalemleri dinamik olarak hesaplandı.
5. **Operator Analytics & Deep Dive (`/api/reporting/operators` & `src/routes/reporting.users.tsx`):**
   - Sistemdeki gerçek kullanıcılar (`app_users`), yaptıkları sohbet/ajan oturumları ve yerel vs bulut token tüketimleri operatör bazlı olarak modellendi.
   - Top N, sıralama (tokens, cost, runs, name), arama ve operatör filtreleri API seviyesinde uygulandı.
6. **RAG Analytics Telemetrisi (`/api/reporting/rag` & `src/routes/reporting.rag.tsx`):**
   - Geri çağırma (retrieval) arama logları için `POST /api/reporting/rag/query` uç noktası ve `rag_queries` PostgreSQL tablosu devreye alındı.
   - Doküman boyutları (`size_mb`), chunk toplamları, indeksleme durumu ve alan (space) dağılımı gerçek DB kayıtlarıyla eşitlendi.
7. **Zamanlanmış Raporlar ve Dağıtım Günlüğü (`/api/reporting/schedules` & `reporting.exports.tsx`):**
   - `localStorage` bağımlılığı tamamen kaldırıldı; zamanlanmış teslimat planları (`schedules`) ve icra logları (`schedule_deliveries`) PostgreSQL veritabanına taşındı.
   - Rapor oluşturma (PDF, CSV, JSON), e-posta ve anlık indirme süreçleri veritabanı kayıtları üzerinden güvenle yönetilir hale getirildi.
8. **Kod ve Yorum Dili Standartlaştırması:**
   - Yeni oluşturulan tüm modül ve store dosyalarında kesin olarak kurumsal İngilizce standartları uygulandı.

## 49. Completed (Phase 49) - Logs / Audit & Live Debugging Modernization (Zero-Mock E2E)
Bu aşamada `/system` (Logs / Audit) sayfası ve altındaki **Audit Journal** ile **Live Debugging** sistemleri uçtan uca incelenerek ham JSON dump kirliliklerinden ve 150 satırlık sahte log üreteçlerinden arındırıldı.

### Yapılan Geliştirmeler & Mimari İyileştirmeler:
1. **Dinamik PostgreSQL Log API (`local-server/lib/routes/system-misc.mjs`):**
   - `GET /api/logs` uç noktası `stream`, `level`, `actor`, `thread_id` ve zaman damgası (`since`) parametreleriyle `agent_logs` tablosunu esnek ve güvenli (SQL parameterization) sorgulayacak şekilde güçlendirildi.
   - `POST /api/logs/purge` uç noktası eklenerek hem yerel hem uzaktaki log tamponunun tek tıkla temizlenmesi sağlandı.
2. **Akıllı Ayrıştırıcı & Temiz Görsel Çıktı (`src/lib/audit-store.ts` & `audit-panel.tsx`):**
   - Ham JSON dump (`auth — admin — {"actor":"admin","stream":"auth"...}`) yerine, log tipini otomatik anlayan ve insan dostu temiz operasyon cümleleri (`Session authenticated successfully via local provider`, `Step respond · completed`, vb.) üreten `normalizeRawLog` motoru yazıldı.
   - Tablo hücrelerindeki mükerrer başlık ve hedef tekrarları giderildi.
3. **Live Debugging Sahte Kod Temizliği (`src/lib/debug-bus.ts` & `debug-console.tsx`):**
   - 150 satırlık sözde-rastgele sahte log havuzu (`lines`) ve `frame()` simülatörü kod tabanından tamamen silindi.
   - `useDebugBus` kancası gerçek SSE akışına (`/api/audit/stream`), `onDenyEvent` ve `onRbacEvent` olaylarına bağlandı; kanallar (`chat`, `model`, `agent`, `flows`, `mcp`, `vault`, `rbac`, `deny`, `siem`) gerçek platform olaylarını filtreleyecek hale getirildi.
   - `visible` akışı armed kanallarına göre filtrelendi ve geçmiş loglardan kanal sayaçları (`counts`) hesaplandı.
4. **Platform Başlığı ve Mock Arındırması (`src/routes/system.tsx`):**
   - Statik `systemMeta` mock import'u kaldırıldı, dinamik kurumsal başlık mimarisine geçildi.

## 50. Completed (Phase 50) - Live Debugging Emitter & Channel Normalization (Zero-Mock E2E)
Bu aşamada `/system` (Logs / Audit) altındaki **Live Debugging** ve **Audit Journal** sistemleri baştan sona senkronize edildi; kanal filtreleme darboğazları çözüldü ve backend router'larına canlı debug ve audit emitter'ları entegre edildi.

### Yapılan Geliştirmeler & Mimari İyileştirmeler:
1. **Frontend Tag & 35 Kanal Eşleme Motoru (`src/lib/debug-bus.ts`):**
   - `parseDebugFrame` motoru güçlendirildi. Gelen loglardaki `meta.tag`, `data.stream`, `meta.channel`, `data.agent` ve mesaj önekleri taranarak (`chat.*` → `chat`, `rag.*` → `rag`, `model.*`/`mlx.*` → `model`, `auth.*` → `auth`, `agent.*` → `agent`, `prompt.*` → `prompt`, `flows.*` → `flows`, `skill.*`/`tool.*` → `skills`, `vault.*` → `vault`, `mcp.*` → `mcp`, `rbac.*`/`policy.*` → `rbac`, `cost.*` → `cost`, vb.) 35 Live Debugging kanalının tamamı doğru hedeflere bağlandı.
   - `agent === "checkpoint"` olan logların doğrudan `audit` veya `other` kanalına sıkışması engellendi.
2. **Akıllı Audit Log Ayrıştırması & UX İyileştirmeleri (`src/lib/audit-store.ts` & `audit-panel.tsx`):**
   - `normalizeRawLog` motoru tüm modüllerin (`models`, `secrets`, `rag`, `mcp`, `policy`, `agents`, `workflows`, `system`, `auth`, `rbac`, `billing`) akışlarını anlayacak şekilde güncellendi.
   - `audit-panel.tsx` içindeki "HELD" butonu canlı akış durumunu net şekilde yansıtan (`[LIVE STREAM]` / `[STREAM HELD]`) durumsal göstergeye dönüştürüldü.
3. **Chat Orchestrator Canlı Debug & Profiling Emitter'ları (`local-server/lib/routes/chat-orchestrate.mjs`):**
   - Chat yaşam döngüsüne zengin sinyalli debug ve audit emitter'ları entegre edildi:
     * `chat.request` (INFO): İstek girişi, model ve parametreler.
     * `prompt.assembly` (DEBUG): Mesaj ve direktif katmanlarının birleştirilmesi.
     * `agent.step.start` (INFO): ReAct döngüsü iterasyon adımları ve model yönlendirme modu.
     * `model.first_token` (DEBUG): İlk token süresi (TTFT ms) ve sağlayıcı bilgisi.
     * `rag.search.start` & `rag.search.done` (DEBUG/INFO): Ajan RAG alanı araması ve dönen chunk skorları.
     * `tool.invoking` & `tool.executed` (DEBUG/INFO): Araç çalıştırma başlangıcı, icra süresi (ms) ve sonuç durumu.
     * `model.responded` & `cost.spend` (INFO/DEBUG): Yanıt tamamlama süresi, üretilen token hacmi ve maliyet tahmini.
4. **Backend Modüllerinin Audit Emitter Entegrasyonu:**
   - `vault.mjs`: Secret okuma, yazma ve silme operasyonları `agent_logs` ve `broadcastAudit` hattına bağlandı (`vault` / `secrets`).
   - `mcp.mjs`: MCP sunucu CRUD, probe ve tool çağrıları SSE ve audit loguna bağlandı (`mcp`).
   - `tools.mjs`: Araç çağırma ve onay süreçleri canlı audit hattına bağlandı (`skills` / `gate`).
   - `security-policies.mjs`: GenGuard ve izolasyon kural güncellemeleri bağlandı (`rbac` / `policy`).

5. **Kullanıcı Kimliği & Gerçek IP Loglama İyileştirmeleri:**
   - `src/lib/rbac-events.ts`: `emitRbac` fonksiyonundaki sabit `"levent@elara"` fallback'i kaldırılarak aktif oturumdaki gerçek kullanıcı adını (`admin`, operatör veya LDAP/OIDC kullanıcısı) dinamik çeken `resolveCurrentActor` entegre edildi.
   - `local-server/lib/routes/identity.mjs`: `login` ve `disconnect` olaylarının audit loguna kullanıcının gerçek dış IP adresi (`realIp` - CF / X-Forwarded-For / Socket) basılması sağlandı (sabit `127.0.0.1` yerine).
6. **System Engine (`/engine`) Mimari Sadeleştirmesi:**
   - Artık gereksizleşen ve ilkel kalan `Live Console` sekmesi `/engine` sayfasından, üst menü sekmelerinden (`shell.tsx`) ve komut paletinden (`palette-surfaces.ts`) tamamen silindi.
   - Sayfa saf bir **"Intent Router & Orchestrator Bridge"** güvenlik ve yönlendirme paneline dönüştürüldü.
   - Kod tabanındaki Türkçe yorumlar temizlenerek İngilizce kurumsal standartlara getirildi ve mock data içermediği (PostgreSQL `engine_config` tablosu) teyit edildi.
7. **Memory Modülü Çift Yönlü Entegrasyon & Accordion UX:**
   - `local-server/lib/routes/chat-orchestrate.mjs`: `memory_facts` (Uzun Vadeli Gerçekler) ve `memory_working` (Pinned bloklar) sohbet başlarken otomatik olarak modelin sistem direktiflerine enjekte edildi.
   - `local-server/lib/routes/memory.mjs`: Bellek operasyonları (`working.pin`, `working.evict`, `episodic.purge`, `fact.created/updated/deleted`) canlı `broadcastAudit` ve `agent_logs` telemetrisine bağlandı.
   - `src/routes/memory.tsx`: Working Set altındaki thread'ler sonsuz dikey kaydırma yerine şık, açılır-kapanır (`ThreadWorkingCard` Accordion) mimariye dönüştürüldü (varsayılan kapalı, tek tıkla Expand/Collapse All destekli).
8. **Settings 12 Alt Modülünün Tam Denetimi & Mock Arındırması:**
   - `/settings` altındaki 12 alt modül (`Settings/Providers`, `Capability Registry`, `Authentication`, `Global Converter`, `Services`, `Certificates`, `Mail & Time`, `SIEM`, `Telemetry Sources`, `Vision Audio`, `Backup & Restore`, `Theme`) uçtan uca incelendi.
   - `src/routes/services.tsx` içerisindeki eski `@/mocks` import'u ve fallback verileri tamamen silinerek doğrudan PostgreSQL `app_services` ve `search_providers` tablolarına bağlandı.
   - Tüm 12 modülün %100 gerçek PostgreSQL veritabanı ve kurumsal İngilizce standartlarında çalıştığı doğrulandı.
9. **Multi-Provider Routing Override Kapsamı ve Kurumsal RBAC:**
   - `src/lib/provider-store.ts` ve `src/components/sovereign/ai-providers-panel.tsx`: `Allow user override` anahtarına `Everyone`, `Admins only`, `User Groups`, `Specific Users` ve `Roles` yetki kapsamları eklendi.
   - `src/components/sovereign/composer.tsx`: Yetkisi olmayan kullanıcılar için Chat popover'ındaki Routing seçimi otomatik olarak kilitlendi (`[Locked by Policy]`).
   - `local-server/lib/routes/chat-orchestrate.mjs`: Kullanıcı oturum kimliği (`actorCtx.username`), grupları (`actorCtx.groups`) ve rolü backend seviyesinde doğrulanarak yetkisiz override isteklerinin sunucu tarafında engellenmesi sağlandı.
10. **Policy & Security (GenGuard / Policy Engine / Isolation) Uçtan Uca Gözlemlenebilirlik:**
   - `src/routes/policy.tsx`: GenGuard ve Policy Engine kural tablolarında her kural satırına FortiGate tarzı doğrudan Audit Journal'a (`stream=policy&q=<kural_adı>`) bağlanan `ScrollText` log butonu eklendi; İzolasyon sekmelerindeki yönlendirme butonları kaldırılarak saf güvenlik yapılandırma görünümü korundu.
   - `src/routes/system.tsx` & `src/components/sovereign/audit-panel.tsx`: Derin arama ve filtreleme URL parametreleri (`stream`, `q`, `view=audit/debug`, `tab=live`) desteklendi.
   - `local-server/lib/routes/chat-orchestrate.mjs`: Sohbet girişinde `guard_rules` (GenGuard) kuralları gerçek zamanlı çalıştırılarak prompt injection veya kara liste eşleşmelerinde isteğin engellenmesi (`DENY`), kullanıcıya güvenlik uyarısı verilmesi ve audit günlüğüne kaydedilmesi sağlandı.
11. **Approval Queue & Action Required (Attention Bell) Çift Yönlü Entegrasyonu:**
   - `src/components/sovereign/attention-bell.tsx`: Sağ üstteki evrensel eylem uyarı widget'ı (`AttentionBell`), hem insan onayı bekleyen hassas işlem biletlerini (`/api/approvals` $\rightarrow$ `approval_requests`), hem de MetaForge tarafından sentezlenen ve onay bekleyen planları (`/api/meta-forge/plans` $\rightarrow$ `forge_plans`) eş zamanlı takip ederek operatöre anlık rozet bildirimi (`... on your desk`) sunacak şekilde doğrulandı.
   - `local-server/lib/routes/approvals.mjs`: Onay kararları (`decide`), yeni onay talepleri (`request`) ve kuyruk konfigürasyon güncellemeleri canlı `broadcastAudit` ve `agent_logs` hattına bağlandı (`gate` / `governance`).
12. **Runtime Monitor & Fleet Telemetry Gerçek Sensör & DB Entegrasyonu:**
   - `src/lib/telemetry-live.ts`: Telemetri motoru içerisindeki eski sözde-rastgele matematik üreteçleri (`walk`, `Math.random`) tamamen arındırıldı.
   - `local-server/lib/routes/telemetry.mjs` & `telemetry-stream.mjs`: Host sensörleri (`CPU`, `RAM`, `NVIDIA GPU SMI`, `Disk I/O`, `Network RX/TX`, `PostgreSQL Conns`) ve AI metrikleri (`Throughput`, `P95 Latency`, `Quality Scores`, `Queue Depth`) doğrudan OS çekirdeğinden ve `provider_usage` tablosundan beslenecek şekilde doğrulandı.
   - `src/components/sovereign/runtime-canvas.tsx` & `src/routes/fleet.tsx`: Active Fleet ajan listesi ve telemetri durumları %100 gerçek veritabanı kayıtlarıyla eşitlendi.

## 51. Completed (Phase 51) - Agentic RAG & Knowledge Hub Validation & Zero-Mock Architecture
Bu aşamada **Knowledge Hub** (`/knowledge`), **RAG Documents** (`/rag-documents`), **Agentic RAG Engine** (`local-server/lib/rag/`, `agent-rag.mjs`, `chat-orchestrate.mjs`) ve veritabanı şeması uçtan uca incelenerek senkronize edildi.

### Yapılan Geliştirmeler & Mimari İyileştirmeler:
1. **PostgreSQL Master Şema & Sütun Uyumluluğu (`v2_master_schema.sql` & `knowledge_chunks`):**
   - `knowledge_chunks` tablosundaki ayrışmış sütunlar ve JSON metadata arasındaki kopukluk giderildi.
   - PostgreSQL seviyesinde saklanan üretilmiş sütunlar (`GENERATED ALWAYS AS ... STORED`) tanımlandı:
     * `brand` $\leftarrow$ `metadata->>'brand'`
     * `path` $\leftarrow$ `metadata->>'path'`
     * `product` $\leftarrow$ `metadata->>'product'`
     * `access_level` $\leftarrow$ `COALESCE(metadata->>'access_level', 'Viewer')`
     * `file_id` $\leftarrow$ `source_id`
     * `ord` $\leftarrow$ `seq`
     * `tsv` $\leftarrow$ `to_tsvector('simple', coalesce(content,''))`
   - GIN ve B-tree indeksleri oluşturuldu (`idx_knowledge_chunks_tsv`, `idx_knowledge_chunks_brand`, `idx_knowledge_chunks_path`).
   - Hem v2 standart şeması hem de eski arama motoru sorguları 0 hata ile çalışır hale getirildi.
2. **RAG Ops & Bakım API Ağ Geçidi Entegrasyonu (`local-server/lib/routes/rag-ops.mjs` & `api-v2.mjs`):**
   - Eksik olan `mountRagOpsRoutes` modülü API Gateway (`api-v2.mjs`) içine dahil edildi.
   - UI üzerindeki tüm bakım ve optimizasyon butonları (`Repair FTS`, `Dedupe Chunks`, `Re-derive Brands`, `Reprocess Oversized HTML`, `Re-process HTML & JSON`) gerçek PostgreSQL veritabanına bağlandı ve test edildi.
3. **Frontend Mock Arındırması (`src/routes/knowledge.tsx` & `src/lib/knowledge-store.ts`):**
   - `src/routes/knowledge.tsx` içerisindeki `@/mocks` import'u (`syncJobs`, `syncLiveLines`) tamamen temizlendi.
   - `src/lib/knowledge-store.ts` içerisindeki `@/mocks/knowledge-seed` bağımlılıkları silinerek saf veritabanı başlangıç durumuna geçirildi.
   - `rag-analytics-store.ts` ve `schedule-store.ts` dosyalarındaki `TS7030` TypeScript derleme uyarıları giderildi (`npx tsc --noEmit` 0 hata ile doğrulandı).
4. **Kod Dili ve Kurumsal Standartlar (English Standardization):**
   - `chat-orchestrate.mjs`, `agent-rag.mjs`, `knowledge-retrieve.mjs` ve `rag-ops.mjs` dosyalarındaki tüm Türkçe yorum satırları ve hata mesajları kurumsal İngilizceye çevrildi.
5. **Ajan & Model RAG İzolasyonu ve Onay Mekanizması:**
   - Ajan düzenleme (`Edit agent`) Knowledge / RAG sekmesindeki `Brands` ve `Keywords/Alias` alanlarının veritabanı kaydı ve model sistem promptuna enjeksiyonu doğrulandı.
   - Model kartlarındaki `RAG retrieval (on/off)` anahtarının bağımsız kontrolü teyit edildi.
6. **Intent Sınıflandırıcının Sadeleştirilmesi & 0ms Fast-Path (`intent-classifier.mjs` & `scoring.mjs`):**
   - 14 adımlı gereksiz retry döngüsü kaldırıldı; embed worker hazır olmadığında teknik soruların küçük sohbet sanılması engellendi.
   - `extractQueryTerms` Unicode NFC normalizasyonuna çekilerek Türkçe karakterlerin stop-word kontrolünden kaçması engellendi.
   - Selamlaşma ve hal hatır sormalar **0 ms** içinde anında yakalanıp modelin RAG yüküyle donması/kilitlenmesi önlendi.
   - Çift dilli asistan kimlik soruları (`who are you`, `tell me about yourself`, `kimsin`, `yeteneklerin neler`) hafifletildi.
7. **`diagnoseChatTrace` ve Yetim Kodların Silinmesi (`util.mjs` & `system-misc.mjs`):**
   - UI'da karşılığı olmayan, eski terminal debug çıktısı `diagnoseChatTrace` fonksiyonu ve `system-misc.mjs` içindeki yetim bağımlılığı tamamen silindi; `/api/debug/chat/:traceId` saf JSON formatına çekildi.
8. **Komut Paleti & Global Arama Canlı Varlık İndekslemesi (`command-palette.tsx` & `palette-surfaces.ts`):**
   - Canlı veritabanındaki Ajanlar (`useAgents`), Yetenekler (`useSkills`), Modeller (`useModels`), İş Akışları (`useWorkflows`) ve Sohbetler (`useChats`) palet aramasına bağlandı.
   - Settings 12 alt modülü ve System alt sekmeleri eksiksiz arama indeksine eklendi.
9. **Knowledge Hub Reranker Dinamik Rozeti (`knowledge.tsx` & `knowledge-state.mjs`):**
   - Eski mor `model: default` rozeti kaldırıldı; çalışan gerçek reranker modelini (`bge-reranker-v2-m3`) gösteren parlak zümrüt yeşili (`emerald`) rozet bağlandı.
10. **Access Spaces Otomatik Slug & Kilitli Görünüm (`knowledge-spaces.tsx`):**
    - Space Name yazılırken Türkçe karakterleri ve boşlukları arındıran `slugify` ile otomatik slug üretimi sağlandı.
    - Slug alanı güvenli kilitli (`readOnly`) hale getirildi; Contributors bölümüne `everyone · on/off` desteği eklenerek tutarsızlık giderildi.
11. **Access Spaces Boyut & Uzantı Doğrulaması (Enforcement):**
    - `checkUpload` içerisindeki admin bypass'ı kaldırıldı; `maxMb` (örn. 50MB) ve `allowedTypes` kuralları hem UI hem de backend (`/api/knowledge/file`) seviyesinde HTTP 400 ile zorunlu kılındı.
12. **Döküman Chunk Sayısı & 100k Sınırı Düzeltmesi (`extract.mjs` & `pipeline.mjs`):**
    - `MAX_INDEXED_CHARS` 100k'dan 2.000.000 karaktere (~500 sayfa) çıkarıldı; tüm çok sayfalı PDF'lerin tam işlenmesi sağlandı.
    - `knowledge_sources.chunks` sütununun statik 125 takılması giderildi; gerçek yazılan chunk sayıları (`106`, `236`, `1`) veritabanına bağlandı.
13. **Embedding Worker Otomatik Drain & Vektör Kaydı (`store.mjs` & `server.mjs`):**
    - `store.mjs` içerisindeki eski `MLX` kontrolü kaldırıldı; `SET embedding = $1::jsonb` ile PostgreSQL jsonb vektör kaydı sağlandı.
    - `startEmbedWorkerIntervals()` server açılışına bağlandı; bekleyen chunk'ların (`worker.py` - port 8082, `BAAI/bge-m3`) her 30 saniyede bir arka planda otomatik eritilmesi (drain) sağlandı.
14. **Knowledge Embedding Pipeline & Worker Drain Uçtan Uca Entegrasyonu (`pipeline.mjs`, `runtime.mjs`, `store.mjs`, `server.mjs`, `api-v2.mjs`):**
    - `pipeline.mjs`: `rebuildChunksForFile` içerisindeki string chunk tipi ve `enrichChunkContent` entegrasyonu düzeltildi.
    - `runtime.mjs`: `claimEmbeddingBatch` ve `ragJanitor` sorguları PostgreSQL `metadata->>'embedding_status'` ve `embedding IS NULL` şartlarına uygun hale getirildi; hiçbir chunk'ın kuyruktan kaçmaması sağlandı.
    - `server.mjs` & `python-resolver.mjs`: `EMBED_WORKER_PORT` 8082 olarak eşitlendi; `initEmbedWorkerProbe` portu bağlandı; Linux `venv/bin/python3` yolu resolver listesine eklendi.
    - `api-v2.mjs`: `mountEmbedWorkerRoutes` API Gateway'e dahil edildi (`/api/rag/retry-embeddings`).
    - `knowledge-retrieve.mjs`: `semanticFallback` / `semanticSearch` bağlantısı yapıldı; `/api/knowledge/embeddings/mark-pending` rotası canlı `ragAutoEmbedDrain()` döngüsüne bağlandı.
    - Tüm kod bloklarındaki yorumlar ve loglar %100 kurumsal İngilizce standartlarına çekildi. Canlı testlerde 7,338 chunk'ın arka planda `BAAI/bge-m3` ile otomatik eridiği ve vektörlerin DB'ye yazıldığı doğrulandı.
15. **Knowledge Hub Canlı Telemetri & UI Buton Geri Bildirimi (`knowledge.tsx`, `knowledge-store.ts`, `knowledge-state.mjs`):**
    - `knowledge-state.mjs`: `inProgress`, `stale` ve `embedError` metrikleri canlı veritabanı sorgusuna bağlandı (`COUNT(*) FILTER (WHERE metadata->>'embedding_status' = 'in_progress')`).
    - `knowledge-store.ts`: 3 saniyelik hafif canlı senkronizasyon zamanlayıcısı eklendi; ekran yenilemeye gerek kalmadan `EMBED OK`, `IN PROGRESS` ve `EMBED PENDING` sayaçlarının anlık aktığı doğrulandı.
    - `knowledge.tsx`: `Retry Embeddings`, `Repair FTS`, `Drain Errors`, `Dedupe Chunks`, `Re-derive Brands`, `Reprocess Oversized HTML` butonlarına Sonner `toast.loading` ve `toast.success` bildirimleri ile anında senkronizasyon eklendi.
16. **RAG Extraction, Worker Supervisor & Native Space Ingestion (`extract.mjs`, `pipeline.mjs`, `worker.py`, `retrieval.mjs`, `chat-orchestrate.mjs`):**
    - **Tam Sayfa Ekstraksiyonu:** 133.8MB'lık FortiOS Admin Guide ve 17.4MB'lık CLI Guide dosyalarından toplam **7,145 chunk** (~7,000 sayfa) eksiksiz çıkarıldı; eski 62 sayfalık fihrist sınırı aşıldı.
    - **Multi-Row Batch Insert (80x Hızlandırma):** `pipeline.mjs` içerisinde parçalar 64'lük paketler halinde tek SQL sorgusuyla yazılacak şekilde optimize edildi; yükleme süresi 25 saniyeden 0.3 saniyeye indi.
    - **Worker Çakışma & Bellek Sızıntısı Çözümü:** Node.js child process'inin sistemdeki `elara-worker.service` (Port 8082) ile çakışması engellendi. `worker.py` içindeki PyTorch CPU inference mode (`with torch.inference_mode():`) ve 4 thread limiti ile RAM **5.4 GB'dan ~900 MB - 1.2 GB'a** düşürüldü.
    - **PostgreSQL pgvector Tip Dönüşümü:** `retrieval.mjs` içindeki tüm JSONB vektör sorgularına `(embedding::text::vector) <=> $1::vector` dönüşümü eklendi; `operator does not exist: jsonb <=> vector` hatası giderildi.
    - **`page_start` & `page_end` Stored Kolonları:** `knowledge_chunks` tablosuna saklanan üretilmiş kolonlar eklendi; `SELECT page_start FROM knowledge_chunks` sorgu kırılmaları önlendi.
    - **Dinamik Koleksiyon & Sahiplik Yetkilendirmesi:** Ajanın ve koleksiyonların erişimi `rag_folders` üzerinden dinamik sağlandı; hardcoded marka ve rol dizileri silindi.
    - **Native Space RAG Injection:** Ajan şablonundaki sahte `vector.search` araçları temizlendi (`tools: []`); RAG bağlamı doğrudan sistem prompt'una enjekte edildi.

## 51.1. ACİL ÇÖZÜLEN DARBOĞAZLAR, UPLOAD / EMBEDDING MİMARİSİ VE DİNAMİK MODEL GEÇİŞİ

Bu aşamada sistemin upload, embedding, dinamik model yapılandırması ve arayüz entegrasyonu katmanlarında tespit edilen tüm darboğazlar kökten çözülmüştür:

---

### 🚀 1. Upload Hızı & Non-Blocking Ingestion Mimarisi
- **Kök Sebep & Problem:**
  * 17.4 MB (4.000 sayfa) ve 133 MB (7.000 sayfa) PDF dosyaları yüklendiğinde JavaScript `pdf-parse` kütüphanesi 4.000 sayfanın tüm glif/metin koordinatlarını tek tek Node.js ana iş parçacığında (main event loop) dönüyor, V8 heap 3.7 GB'a ulaşıyor ve event loop 2 dakika boyunca kilitleniyordu. Tarayıcıda progress bar %40'ta donuyor ve *"Uploading..."* yazısında asılı kalıyordu.
  * `knowledge-ingest.mjs` rotasında `awaitEmbeddings: true` parametresi nedeniyle HTTP isteği, 2.000-7.000 parçanın embedding işlemi bitmeden yanıt vermiyor ve bağlantı 504 Gateway Timeout ile kopuyordu.
- **Yapılan Düzeltmeler:**
  * **C++ `pdftotext` (poppler-utils) Entegrasyonu (`local-server/lib/ingest/extract.mjs`):** PDF ekstraksiyonu yerel C++ `pdftotext` binary'sine devredildi. 4.000 sayfalık PDF **Node.js ana iş parçacığını 1 milisaniye bile bloke etmeden** 70 MB RAM ile arka planda çıkarılıyor.
  * **Asenkron Ingestion (`awaitEmbeddings: false`):** Dosya yüklendiği anda multi-row batch SQL insert (64 chunks/sorgu) ile **0.3 saniyede** PostgreSQL'e kaydediliyor ve HTTP 200 dönüyor.
  * **RAG Documents Sahiplik ve Klasör Görünürlüğü Düzeltmesi (`src/routes/rag-documents.tsx`):** `mine` filtresindeki katı `s.owner === userId` kısıtı esnetilerek admin (`access.sovereign`) ve genel workspace dökümanlarının klasörlerde (`Fortigate`, `Uploads`) anında listelenmesi sağlandı.

---

### ⚡ 2. Embedding Problemi & 50x CPU Hızlanması
- **Kök Sebep & Problem:**
  * Sunucuda harici NVIDIA GPU bulunmadığı için 4 çekirdekli CPU üzerinde 2.3 GB boyutundaki devasa `BAAI/bge-m3` (570M parametre) modelinin her 4 chunk'ı hesaplaması 18-20 saniye sürüyordu (chunk başına ~4.5 saniye). 2.125 parçalık bir döküman 2.6 saat, 7.145 parçalık döküman ise 9 saat sürüyordu.
  * Worker önceki çökmeler sırasında kilitli kalan parçaların `embedding_attempts` değerini 5'e yükselttiği için `claimEmbeddingBatch` kuyruğu tamamen durduruyordu.
- **Yapılan Düzeltmeler:**
  * **CPU-Dostu Model Geçişi (`BAAI/bge-small-en-v1.5`):** 384 boyutlu, 130 MB'lık optimize embedding modeline geçildi. 32 chunk'ın hesaplama süresi **20 saniyeden 417 milisaniyeye** indi (**50 kat hızlanma**). 2.125 chunk artık 2.5 saatte değil, **~27 saniyede** %100 embed ediliyor.
  * **Otonom Kilit Kurtarma & attempts Toleransı (`local-server/lib/embed-worker/runtime.mjs`):** `embedding_attempts` limiti 20'ye çıkarıldı, stale lock süresi 3 dakikaya indirildi ve `ragAutoEmbedDrain()` kesintisiz arka plan tüketimine bağlandı.

---

### 🧬 3. BAAI Model ve Reranker Mimarisinin Sıfır-Hardcode Dinamik Yapıya Geçirilmesi
- **Kök Sebep & Problem:**
  * Kod dosyalarında (`knowledge-state.mjs`, `knowledge.tsx`, `knowledge-store.ts`) hardcoded `"BAAI/bge-m3"` ve `"bge-reranker-v2-m3"` string'leri gömülüydü; model değiştiğinde UI bunu dinamik algılayamıyordu.
  * Arayüzdeki kontrol tuşları (`Validate`, `Apply`, `Cleanup`, `Nuke`) backend'deki `os is not defined`, `column c.root does not exist` ve SQL Transaction BEGIN/COMMIT havuz çakışmaları nedeniyle hata veriyordu.
- **Yapılan Düzeltmeler:**
  * **Canlı Worker Telemetrisi (`/api/knowledge/state` & `knowledge-state.mjs`):** Koddan tüm hardcoded model isimleri söküldü. API Gateway modeli, boyutu (`dim: 384`), reranker'ı ve motoru doğrudan çalışan Python Worker'ın (`http://127.0.0.1:8082/health`) canlı çıktısından çekiyor.
  * **Dinamik UI Künyesi (`src/routes/knowledge.tsx`):** Arayüzdeki `INDEX`, `CHUNKING`, `RERANKER`, `PARSER` ve `ENGINE` alanları ile Reranker rozeti worker'ın canlı durumuna göre dinamik render ediliyor.
  * **Tüm Bakım Tuşlarının Canlı Onarımı:**
    - `Validate` & `Apply`: `~` ev dizini (`os.homedir()`) genişletmesi ve `os` modül importu düzeltildi.
    - `Cleanup`: `metadata->>'root'` ve `c.file_id` SQL düzeltmesi yapıldı.
    - `Nuke`: `TRUNCATE TABLE knowledge_chunks, knowledge_sources CASCADE;` doğrudan atomik sorgu ile 5 milisaniyede sıfırlama yapacak şekilde sabitlendi.

---

### 📊 Güncel Durum Özeti:
- **Embedding Modeli:** `BAAI/bge-small-en-v1.5` (384-dim, 417ms / 32 chunks)
- **Reranker Modeli:** `BAAI/bge-reranker-base` (Sorgu anında Cross-Encoder hassas puanlama)
- **PDF Ekstraksiyonu:** `pdftotext` (C++ native, non-blocking)
- **DB & Tablolar:** PostgreSQL `elara_db` (0 hata, tüm bakım tuşları canlı doğrulanmış)

## 51.2. VECTOR WORKER STABİLİZASYONU, MULTI-ROW BATCH SQL, 9.384 CHUNK INGESTION & RETRIEVAL CARD ENTEGRASYONU

Bu aşamada sistemin Vector Worker mimarisi, toplu SQL yazma performansı, döküman boyutu sınırları ve Chat RAG UI deneyimi uçtan uca mükemmelleştirilmiştir:

---

### 🛡️ 1. Vector Worker "Split-Brain" Çatışması ve İntihar Döngülerinin Temizlenmesi
- **Kök Sebep & Problem:**
  * Node.js (`runtime.mjs`), sunucuda zaten çalışan `systemd` (`elara-worker.service`) servisine rağmen işlemci yük altında 1-2 saniye geç yanıt verdiğinde arkadan gizlice ikinci bir `child_process.spawn("python3 uvicorn...")` başlatmaya çalışıyor ve Port 8082 üzerinde `[Errno 98] Address already in use` çakışması patlatıyordu.
  * `worker.py` içindeki agresif RSS bekçileri, soft-cap kilitleri ve her istekte çağrılan `malloc_trim(0)` bellek korumaları, worker'ın yük altında kendi kendini öldürmesine (`os._exit(1)` / `status=3`) sebep oluyordu.
- **Yapılan Düzeltmeler:**
  * **Tek Patron İlkesi:** Node.js'ten tüm sahte process spawn mantığı silindi; Node.js yalnızca **saf bir HTTP Client** olarak port 8082 ile konuşacak şekilde izole edildi.
  * **Saf FastAPI + PyTorch Worker (`local-server/worker.py`):** `worker.py` tüm intihar bekçilerinden arındırılarak temiz, kararlı, saf bir FastAPI + PyTorch `SentenceTransformers` (`BAAI/bge-small-en-v1.5`) & `CrossEncoder` (`BAAI/bge-reranker-base`) servisine dönüştürüldü.
  * **Timeout & Tolerans Artışı:** Node.js HTTP timeout süresi 30 saniyeden **120 saniyeye**, Reranker timeout süresi ise **8.000 ms'ye** çıkarılarak CPU yoğunluğundaki tüm sahte kopmalar engellendi.

---

### 📦 2. 2M Karakter Sınırının Kaldırılması & 9.384 Parçalık Tam Döküman Ingestion'ı
- **Kök Sebep & Problem:**
  * Eski `pdf-parse` bellek şişmesini önlemek için konulmuş `MAX_INDEXED_CHARS = 2,000,000` (~400 sayfa) sınırı nedeniyle, 4.000+ sayfalık `FortiOS-7.6.6-CLI_Reference.pdf` dökümanının sadece içindekiler tablosu alınıyor; 1.620. sayfadaki `config system interface` ve 3.974. sayfadaki `config router bgp` komut detayları kesiliyordu.
- **Yapılan Düzeltmeler:**
  * `extract.mjs`, `pipeline.mjs` ve `knowledge-ingest.mjs` içindeki sınır **100 Milyon karaktere (~25.000 sayfa)** çıkarıldı.
  * Dökümanın tüm 4.000+ sayfası **9.384 parça (chunk)** olarak PostgreSQL'e eksiksiz yazıldı.

---

### ⚡ 3. Multi-Row Batch SQL ile Süper Hızlı Embedding Kaydı
- **Kök Sebep & Problem:**
  * Worker 32-64 parçalık embedding hesaplasa bile, `store.mjs` her parçayı tek tek `for` döngüsünde 9.000 ayrı SQL `UPDATE` sorgusuyla yazmaya çalışıyor ve devasa ağ/havuz gecikmesi oluşturuyordu.
- **Yapılan Düzeltmeler:**
  * `store.mjs` içine **Multi-Row Batch SQL (`UPDATE knowledge_chunks AS kc SET ... FROM (VALUES ($1::bigint, $2::jsonb), ...) AS v(id, val) WHERE kc.id = v.id`)** mimarisi eklendi. 64 parçanın embedding ve durum güncellemesi tek bir milisaniyelik SQL işlemiyle tamamlanıyor.
  * 9.384 parçanın tamamı **%100 başarıyla (`EMBED OK: 9,384`, `PENDING: 0`, `IN PROGRESS: 0`, `ERROR: 0`)** embed edildi.

---

### 🚫 4. Hardcode Marka İsimlerinin Sıfır-Toleransla Kazınması
- `chat-orchestrate.mjs`, `src/routes/index.tsx` ve `brand-aliases.mjs` içinde kalmış tüm hardcoded `"fortigate"`, `"checkpoint"`, `"netscaler"` fallback dizileri ve stringleri tamamen silindi. Marka ve alias'lar **%100 dinamik** olarak veritabanı ve kullanıcı girdilerinden okunuyor.

---

### 🎨 5. RetrievalCard (RAG · RERANKED) UI Entegrasyonu & Kusursuz Akış
- **Kök Sebep & Problem:**
  * `orchestrate-stream.ts` gelen `{ rag: ... }` SSE paketini tanımadığı için yutuyor ve arayüz kartı çizemiyordu.
  * Akış başında kart hemen çizildiğinde Thinking bloğu kartın üstüne, metin ise araya girerek çirkin bir layout zıplaması (UI jump) yaratıyordu.
- **Yapılan Düzeltmeler:**
  * `orchestrate-stream.ts` içine `{ kind: "rag", rag }` ayrıştırıcısı eklendi.
  * `src/routes/index.tsx` içinde kartın görünme anı **metin akışı tamamlandığı an (`!m.streaming && m.retrieval`)** olarak ayarlandı. Cevap bittiği anda yeşil zümrüt çerçeveli **`RAG · RERANKED`** kartı cevabın altında pürüzsüzce açılıyor.

---

### 🧠 6. Akıllı Ajan Mühendislik Sentezi (Refusal Fix)
- `Technical_Librarian` ve evrensel `chat-orchestrate.mjs` prompt kuralları güncellendi. Ajanlar RAG bağlamını birincil otorite olarak alırken, bunu uzmanlık bilgisiyle sentezleyerek kullanıcıya robotik *"dokümanda yok"* demek yerine **çalışan, eksiksiz CLI konfigürasyon bloklarını (`config system interface` vb.)** üretiyor.

---

## 52. COMPLETED (Phase 52.1) - NATIVE IN-PROCESS ONNX RUNTIME MİMARİSİ (ZERO-PYTHON & ÇİFT KATMANLI FALLBACK)

Bu aşamada ELARA, harici Python bağımlılıklarından arındırılarak in-process native C++ ONNX Runtime mimarisine taşınmış ve çift katmanlı kesintisiz fallback güvencesine kavuşturulmuştur:

---

### 🚀 1. Native In-Process ONNX Runtime Motoru (`local-server/lib/onnx-pipeline.mjs`)
- `@xenova/transformers` (v2.17.2) kütüphanesi sisteme entegre edildi.
- **Embedding:** `Xenova/bge-small-en-v1.5` (INT8 Kuantize, 384-boyutlu birim vektör, `pooling: "cls", normalize: true`).
  * PyTorch `SentenceTransformers` ile matematiksel benzerlik testi: **1.000000 (Bit-Perfect)**.
  * Tekil embedding hesaplama süresi: **~24ms**.
  * 5 parçalık batch embedding hesaplama süresi: **~58ms**.
- **Reranker:** `Xenova/bge-reranker-base` (INT8 Kuantize Cross-Encoder).
  * Ham logit çıkışları doğrudan Sigmoid olasılık puanlamasına (`1 / (1 + exp(-s))`) dönüştürüldü.
  * Sorgu ile ilgili dökümana %99.3 güven skoru, alakasız dökümana %0.01 skor üreterek mükemmel Cross-Encoder ayrıştırması doğrulandı.

---

### 🛡️ 2. Çift Katmanlı Şeffaf Fallback Mimarisi (`embed-provider.mjs`, `rerank-provider.mjs`)
- **Birincil Hat (Primary):** In-Process Native C++ ONNX motoru (0ms IPC, sıfır ağ gecikmesi, ~70MB RAM ayak izi).
- **Yedek Hat (Fallback):** Herhangi bir beklenmedik durumda veya harici GPU istenildiğinde sistem otomatik olarak Port 8082'deki Python Worker (`FastAPI + PyTorch`) hattına sıfır kesintiyle düşer.
- Tüm `store.mjs` toplu döküman yazma ve `retrieval.mjs` RAG arama akışları in-process ONNX ile canlı olarak doğrulandı.

---

## 52.2. COMPLETED (Phase 52.2) - ENTERPRISE REPORTING, AUTO RAG TELEMETRY, ZERO-HARDCODE FINOPS TARIFFS & OPERATOR DEEP DIVE

Bu aşamada Raporlama & Analitik (Reporting) modülündeki tüm şema uyuşmazlıkları, canlı RAG telemetrisi ve FinOps maliyet motoru tamamen dinamik ve sıfır-hardcode mimariye kavuşturulmuştur:

---

### 🔍 1. RAG Telemetrisi ve Şema Onarımı (`reporting.mjs` & `rag-analytics-store.ts`)
- **Kök Neden & Problem:**
  - `knowledge_sources` tablosundan `space` sütunu seçilmeye çalışıldığı için `/api/reporting/rag` 500 hatası veriyordu (`space_id` olması gerekiyordu).
  - `schedules` tablosundaki foreign key uyuşmazlığı `rag_queries` tablosunun bootstrap edilmesini engelliyordu.
- **Yapılan İyileştirmeler:**
  - `space` $\rightarrow$ `space_id` eşleşmesi düzeltildi; DDL şema bootstrap blokları izole edilerek `schedules`, `schedule_deliveries` ve `rag_queries` PostgreSQL tabloları ve indeksleri eksiksiz oluşturuldu.
  - `chat-orchestrate.mjs` içindeki Primary Agent RAG, Universal Model RAG ve Multi-Agent/DAG RAG arama akışlarına **otomatik telemetri kaydı** eklendi. Yapılan her doküman araması anlık olarak `rag_queries` tablosuna işleniyor; **QUERIES, Query Volume, Top Askers, Most Asked Questions ve Space Routing** grafikleri anlık güncelleniyor.

---

### 💰 2. Sıfır-Hardcode FinOps Maliyet Motoru & Dinamik Tarife Arayüzü (`reporting.cost.tsx`, `reporting.mjs`)
- **Kök Neden & Problem:**
  - Disk depolama (vektör/nesne) ve egress için kod içine gömülü sabit oranlar bulunuyordu ve Model Kartındaki fiyatlar yerine harici sabitler kullanılıyordu.
  - Vektör disk alanı maliyeti tekil token sayısına bölünerek "Cost / 1M Tokens" metriği 227 dolar gibi hatalı rakamlar üretiyordu.
- **Yapılan İyileştirmeler:**
  - **Dinamik Model Kartı Entegrasyonu:** LLM çıkarım maliyetleri tamamen veritabanındaki model kartından (`input_cost` & `output_cost`) okunarak hesaplanıyor.
  - **"Tariff Rates" Modalı:** `Cost & Spend` sayfasında `Last 7 days` seçicisinin hemen önüne **Tariff Rates** butonu ve açılır modal eklendi. Operatör Vektör Depolama, Nesne Depolama, GPU Saat ve Egress birim fiyatlarını dilediği gibi güncelleyebilir veya tek tıkla $0'a sıfırlayabilir (`app_settings.finops.tariffs`).
  - **Doğru Metrik Ayrımı:** `Cost / Run` ve `Cost / 1M Tokens` metrikleri yalnızca gerçek model çıkarım maliyetine bağlandı.

---

### 👤 3. Operatör Analitiği & RAG Deep Dive Odaklama (`reporting.users.tsx`)
- **Kök Neden & Problem:**
  - Üstteki filtre çubuğundan operatör seçildiğinde, alttaki RAG Uploads/Queries panelleri varsayılan olarak listenin ilk sırasındaki `admin` operatörüne kilitli kalıyordu.
- **Yapılan İyileştirmeler:**
  - `OperatorPicker`'dan bir kullanıcı seçildiğinde veya Roster/RAG tablolarından operatöre tıklandığında Deep Dive ve RAG panelleri anında o operatöre odaklanıyor (`active`).
  - İncelenen operatörün yanına görsel `ACTIVE` rozeti eklendi.

---

### 🛡️ 4. Active Fleet & Runtime Monitor Sistem Ajanı İzolasyonu (`telemetry.mjs`, `runtime-canvas.tsx`, `metrics.mjs`)
- **Kök Neden & Problem:**
  - MetaForge dahili sistem ajanı (`agt.forge_master`) `/agents` sayfasında gizlenmiş olmasına rağmen, sağ çekmecedeki Runtime Monitor (Active Fleet) listesinde ve envanter telemetrisinde listeleniyordu.
- **Yapılan İyileştirmeler:**
  - `/api/telemetry/agent-status`, `/api/telemetry/stream` ve `metrics.mjs` SQL sorgularına `WHERE id != 'agt.forge_master' AND squad != 'System' AND id NOT LIKE 'sys.%'` filtreleri uygulandı.
  - `runtime-canvas.tsx` UI bileşenine defense-in-depth prensibiyle hem sayaç hem de liste düzeyinde sistem ajanı filtrelemesi eklendi.

---

## 53. COMPLETED (Phase 53) - ENTERPRISE HA CLUSTER, DUAL-MODE SCALE-OUT & SERVICES INFRASTRUCTURE HUB

Bu aşamada ELARA hem tekil bağımsız sunucularda ("Stand-Alone / Zero-Config") hem de Citrix NetScaler / F5 BIG-IP / HAProxy Load Balancer arkasında çalışan kurumsal çok düğümlü ("Multi-Node Enterprise HA Cluster") mimariye kavuşturulmuştur:

### 🏛️ 1. Mimari Prensipler & Sıfır-Nginx (Unified Single-Port `:3005`) Modeli
- **Tek Port - Tek Süreç (`Port 3005`):**
  - Node.js API Gateway (`server.mjs`), prodüksiyonda derlenen optimize React statik arayüzünü (`dist/`) ve `/api/*` uçlarını doğrudan tek bir süreç üzerinden sunacak şekilde yapılandırıldı.
  - Sunucularda ekstra Nginx/Apache kurulmasına gerek kalmadan, Citrix / F5 Load Balancer gelen HTTPS trafiğini doğrudan sunucuların `:3005` portuna iletir.
- **Doğrudan TCP Protokolleri:**
  - Redis (`6379` / RESP) ve RabbitMQ (`5672` / AMQP) ara web sunucularına ihtiyaç duymadan doğrudan Node.js backend tarafından TCP soketleriyle tüketilir.
- **Anında Genişleme (2 Dakikada Yeni Düğüm / Node Scale-Out):**
  - Kümeye yeni bir ELARA sunucusu eklendiğinde yalnızca DB URL ve Shared Storage (`UPLOAD_DIR`) tanımlanır ve servis başlatılır. F5/Citrix HTTP `/health` probe'u üzerinden düğümü otomatik havuza dahil eder.

---

### 🎛️ 2. UI Entegrasyonu: `Settings ➔ Services` (`src/routes/services.tsx` & `local-server/lib/routes/infra.mjs`)
Yeni altyapı kontrolleri doğrudan **Background Services Tower** sayfasının altına enterprise yönetim kartları olarak eklendi:

1. **Database & Cluster Hub (`PostgreSQL`):**
   - Aktif DB bağlantı adresi (`postgres://...`), canlı havuz metrikleri (`idle / total count`), PostgreSQL versiyonu ve anlık gecikme süresi.
   - **"Test Connection"** butonu: Aday veritabanına doğrudan `pg.Client` ile bağlanır, gecikmeyi ölçer ve `v2_master_schema.sql` temel tablolarının (`agents`, `models`, `knowledge_chunks`, `app_users`) varlığını doğrular.
   - **"Save Config"** butonu: Bağlantıyı `app_settings` içine kalıcı olarak kaydeder.
2. **Caching & Acceleration Tier (`Redis`):**
   - Redis bağlantı adresi (`redis://...`), önbellek açma/kapama, semantik LLM yanıt önbellekleme ve TTL ayarları.
   - **"Test Connection"**: RESP PING paketi göndererek Redis düğümünün yanıt verdiğini doğrular.
3. **Task & Workflow Broker (`RabbitMQ`):**
   - AMQP broker bağlantı adresi (`amqp://...`), task broker açma/kapama ve worker prefetch ayarı.
   - **"Test Connection"**: AMQP 0-9-1 protokol el sıkışmasını (handshake) sınar.
4. **Shared Storage & Object Storage (`Storage Hub`):**
   - Yerel Dizin (`./uploads` / NFS mount) veya **S3 / MinIO Uyumlu Nesne Deposu** seçici.
   - S3 Endpoint, Bucket, Region, Access Key ve Secret Key arayüzü.
   - **"Test Storage Probe"**: Yerel dizinde anlık dosya yazma/okuma/silme yetkisini veya S3 endpoint erişilebilirliğini sınar.

---

## 52.3. COMPLETED (Phase 52.3) - AUTONOMOUS DAG EXECUTION ENGINE & MULTI-STEP WORKFLOW BENCHMARKING

Bu aşamada MetaForge ve Visual Flow Designer tarafından üretilen çok adımlı DAG (Directed Acyclic Graph) yapıları ve Orkestrasyon Zincirleri (`workflows` & `orchestrations`) tam otonom, dinamik parametre bağlamalı ve hata kurtarma yetenekli bir icra motoruna kavuşturulmuştur:

### ⚙️ 1. Geliştirilen DAG & Multi-Step İcra Motoru (`workflows.mjs`, `tool-adapters.mjs`)
- **Dinamik Düğüm Çözümleme:**
  - `tool`, `skill`, `agent`, `logic` ve `output` düğümleri MetaForge veya Visual Canvas'tan gelen şema formatlarından bağımsız olarak dinamik çözümlenir (`isToolNode`, `isSkillNode`, `isAgentNode`, `isLogicNode`).
  - `invokeTool` motoru üzerinden canlı Python, native ve HTTP adapter araçları çağrılır; çalışma zamanı bağlamı (`ctx`) adımlar arasında kesintisiz aktarılır.
- **Akıllı Mantık & Karar Dallanması (Logic & Conditionals):**
  - `evalChainCondition` geliştirilerek `days_remaining < 30`, `status === 'healthy'` gibi ifadeler bağlam (`ctx`) üzerinde güvenle çalıştırılır ve `true`/`false` kenarlarına (edges) doğru dallanma sağlanır.
- **Güvenli Şema & Foreign Key İzolasyonu (`tool-adapters.mjs`):**
  - `tool_invocations` tablosundaki `run_id` foreign key kısıtı, zincir/workflow run ID'leri için doğrulanarak korundu; başarısız kayıtların motoru kilitlemesi engellendi.
- **Canlı Doğrulama & Benchmarking:**
  - `wf_ssl-expiry-monitoring-wf` (6 düğüm, 6 kenar) canlı SSL socket probe'u, logic karşılaştırması ve Markdown rapor üreteci ile **588ms** sürede uçtan uca başarıyla icra edildi.
  - `orc_security-audit-compliance-chain` (7 düğüm, 8 kenar) çok adımlı güvenlik denetim zinciri otonom olarak icra edilerek `completed` durumunda tamamlandı.

---

## 54. COMPLETED (Phase 54) - PERSISTENT REDIS SEMANTIC CACHE, RABBITMQ TASK BROKER, MULTI-BRAND RAG & SERVICES HUB HARDENING

Bu aşamada ELARA'nın sohbet akışlarına semantik yanıt önbellekleme (Semantic Response Caching), asenkron DAG görev kuyruklama (RabbitMQ AMQP Task Broker), yazım hatası toleranslı çoklu marka RAG motoru ve `Settings ➔ Services` Enterprise HA Cluster yönetim paneli tam entegre edilmiştir:

### ⚡ 1. Yüksek Başarımlı Semantik Önbellek Motoru (`redis-cache.mjs` & `chat-orchestrate.mjs`)
- **İki Katmanlı Önbellek & Vektör Benzerliği:**
  - Yerel In-Memory LRU (500 nesne sınırlı) ve küme seviyesinde Redis (`RESP` protokolü / `ioredis`) üzerinden çift katmanlı önbellek mimarisi kuruldu.
  - Soruların yerel ONNX embedding vektörleri üzerinden Cosine Similarity ($\ge 0.98$) ve SHA-256 tam eşleşme kontrolleri eklendi.
  - Önbellek anahtarları modele özel olarak izole edildi (`elara:semcache:<model_id>:exact:...`). Bir modelin cevabı başka bir modelin başlığı altında dönmez.
- **Sıfır-Maliyetli Süper Hızlı Yanıt:**
  - Önbellekte eşleşen saf sohbet soruları LLM'e hiç gitmeden **116 ms** sürede (`cache:memory-exact` / `cache:redis-semantic`) doğrudan istemciye basılarak LLM token harcaması ve bekleme süresi sıfırlandı.
  - Araç çağırma (GitHub MCP, dosya okuma, komut icrası) içeren dinamik eylemler önbelleğe dondurulmayıp daima canlı çalıştırılır.

### 🐰 2. Dağıtık RabbitMQ Görev Havuzu & DLQ Mimarisi (`rabbitmq-broker.mjs`)
- **Dirençli AMQP Topolojisi:**
  - `elara.dag.exchange`, `elara.dag.tasks` ve `elara.dag.tasks.dlq` (Dead-Letter Queue) topolojisi bağlandı (`amqplib`).
  - Başarısız olan veya hata alan DAG adımları kuyruktan düşürülmeyip DLQ'ya aktarılarak izlenebilirlik sağlandı.
- **Şeffaf Geri Düşüş (Graceful Fallback):**
  - Redis veya RabbitMQ sunucu üzerinde henüz kurulu olmadığında sistem sıfır kesintiyle yerel bellek içi (In-Memory) ve doğrudan senkron moda düşer.
  - Dinamik yeniden bağlanma desteği ile ayarlar kaydedildiği anda sunucu yeniden başlatılmadan bağlantı canlıya alınır.

### 🔍 3. Çoklu Marka Yazım Hatası Toleransı & RAG Güçlendirmesi (`brand-cache.mjs`, `retrieval.mjs`)
- **Kök Neden & Problem:**
  - Kullanıcı `"cjekpointte vlan nasıl olusturulur?"` gibi harf hatalı (`j` ile) bir sorgu yazdığında, tam metin eşleşmesi başarısız olup serbest aramaya düşüyor ve parça sayısı daha fazla olan Fortinet dokümanları çekiliyordu.
- **Yapılan İyileştirmeler:**
  - Marka tespit algoritmasına Levenshtein / Edit-Distance (harf mesafesi ve Türkçe ek ayıklama) yeteneği eklendi.
  - `"cjekpointte"`, `"chkp"`, `"fortigate'de"` gibi hatalı ve ekli kullanımlarda bile anında `Brand Lock: checkpoint` uygulanarak doğru dokümanlar (`CP_R82_CLI_ReferenceGuide.pdf`) çekildi ve model Check Point Gaia CLI komutlarını üretti.

### 🎛️ 4. Enterprise HA Cluster UI Hardening & Secret Vault Entegrasyonu (`services.tsx`, `infra.mjs`)
- **UI Blok Düzeni:**
  - `Web Search Engine Tower` bloğu `Enterprise HA Cluster & Infrastructure Hub` panelinin altına taşındı.
- **Sıfır-Açık Parola & Secret Vault Entegrasyonu:**
  - NetSec güvenlik standartlarına tam uyum sağlamak amacıyla tüm HA Cluster kartlarına (PostgreSQL, Redis, RabbitMQ ve Storage Hub) **`[🔒 Secret Vault]`** ve **`[🔗 Direct URI]`** seçim sekmeleri eklendi.
  - Parolalar arayüzde asla açık metin olarak gösterilmez veya iletilmez; PostgreSQL `vault_secrets` tablosundaki AES-256-GCM şifreli kayıtlara (`vault://...`) bağlanır.
  - Form alanlarına masked string (`••••••••`) dolması durumunda `resolveCandidateUri` ve `resolveVaultSecret` katmanı dinamik çözümleme yaparak kimlik doğrulamasını kesintisiz yürütür.
- **Gerçek Protokol Prober'ları & Canlı Doğrulama:**
  - PostgreSQL (`pg.Client` & 4 ana tablo kontrolü), Redis (`ioredis` RESP PING) ve RabbitMQ (`amqplib` AMQP handshake + kanal açılışı) testleri ve kalıcı ayar mekanizmaları %100 doğrulandı.
  - S3/MinIO için `aws_access_key` Vault desteği ve Storage ayarları kalıcı hale getirildi.

---

## 55. COMPLETED (Phase 55) - HOST REDIS & RABBITMQ LIVE DEPLOYMENT, VAULT-BACKED HA CLUSTER & PRODUCTION SEAL

Bu aşamada ELARA'nın kurumsal dağıtım ve yüksek erişilebilirlik (HA Cluster) altyapı bileşenleri host işletim sisteminde ayağa kaldırılmış ve prodüksiyon mühürlemesi tamamlanmıştır:

### 🏛️ 1. Altyapı & Küme Durumu
- **Redis Server (`6379`):** Host üzerinde aktif. `REDIS CLUSTER` modunda semantik yanıt önbellekleme çalışıyor.
- **RabbitMQ Server (`5672`):** Host üzerinde aktif. `AMQP BROKER ACTIVE` durumunda asenkron DAG icra ve DLQ yönlendirmesi aktif.
- **PostgreSQL 18 (`5432`):** `ONLINE · 2ms` gecikme ile Vault referanslı güvenli bağlantı aktif.
- **Storage Hub:** Yerel NFS ve S3/MinIO nesne depolama desteği doğrulanmış.

### 🌐 2. Kurumsal Dağıtım & Load Balancer Mimarisi
- Citrix NetScaler / F5 BIG-IP / HAProxy arkasında tek port `:3005` (API + Static UI) üzerinden Active-Active çok düğümlü çalışma hazır.
- Bare-Metal Ubuntu Server (Data & App tier) $\leftrightarrow$ WSL2 Development iş istasyonu iş bölümü standartlaştırıldı.

---

## 56. COMPLETED (Phase 56) - CLOSED-LOOP SELF-HEALING TOOL OPTIMIZATION ENGINE & APPROVALS QUEUE INTEGRATION

Bu aşamada ELARA Sovereign Studio'ya otonom araç sağlığı izleme, MetaForge tabanlı v2 kod sentezi ve Human-in-the-Loop onay kuyruğu entegrasyonu başarıyla tamamlanmıştır:

### ⚡ 1. Kendi Kendini İyileştiren Araç Motoru (`local-server/lib/self-healing.mjs`)
- **Otonom Sağlık Tarama & Anomali Tespiti (`scanToolHealth`):**
  - `tool_invocations` tablosundaki son 7 günlük çalıştırma kayıtları taranarak, en az 3 kez çağrılmış ve hata oranı $\ge \%25$ veya ortalama gecikme süresi $> 4000\text{ ms}$ olan performans anomalisi gösteren araçlar tespit edilir.
  - Anomaliye neden olan hata örnekleri (ETIMEDOUT, JSONDecodeError, 429 Rate Limit, Connection Refused) toplanır.
- **Kök Neden Analizi & v2 Kod Sentezi (`analyzeAndRefactorToolSource`):**
  - Anomali türüne göre kök neden tespit edilir; 4.0s sınırlı soket zaman aşımı korumaları (`ELARA_TOOL_TIMEOUT_S`), üstel geri çekilme (exponential backoff retry) döngüleri, dayanıklı JSON çözümleme (`_safe_json_loads`) ve deterministik yapısal hata zarfları içeren optimize edilmiş Python v2 kaynak kodu üretilir.
- **Human-in-the-Loop Onay Bileti Üretimi (`triggerSelfHealingRefactor`):**
  - Tespit edilen anomali için `approval_requests` tablosuna `origin: 'self_healing'` ile yeni bir bilet (`appr_heal_<slug>_<timestamp>`) açılır.
  - Argümanlar içerisine orijinal kaynak kod, refactor edilmiş v2 kodu, kök neden analizi, uygulanan optimizasyon maddeleri ve telemetri metrikleri paketlenir.

### 🛡️ 2. Onay Anında Otomatik Canlıya Alma (`applySelfHealingRefactor` & `approvals.mjs`)
- **Dirençli Yedekleme & Güvenlik:**
  - Operatör `/approvals` sayfasında "Approve & Promote v2" butonuna bastığında, orijinal araç dosyası anında `.forge-trash/tool-<slug>-<timestamp>.py` konumuna arşivlenir.
  - Yeni v2 kodu `lintPython` süzgecinden geçirilir ve `tools/<slug>.py` dosyasına yazılır.
  - `capabilities` tablosunda aracın durumu `live = true`, `review_status = 'approved'`, `confidence = 0.98` olarak güncellenir ve audit log zincirine kaydedilir.
- **Post-Heal Zaman Damgası İzolasyonu (`scanToolHealth` & `self-healing.mjs`):**
  - Onaylanan araçların eski (v1) hatalı kayıtlar yüzünden sonsuz onay döngüsüne girmesini engelleyen `(la.last_healed_at IS NULL OR ti.started_at > la.last_healed_at)` SQL CTE filtresi devreye alındı. Sadece onay anından sonra gerçekleşen yeni çağrılar izlemeye alınır.

### 🎛️ 3. Arayüz ve Bildirim Hijyeni (`approvals.tsx`, `approval-store.ts`, `attention-bell.tsx`)
- **Sıfır Toast Kirliliği:**
  - Kendi kendine iyileştirme biletleri ekranı kirleten pop-up/toast bildirimleri yerine doğrudan sağ üstteki evrensel **`AttentionBell` ("Action Required")** rozetine sessizce düşer.
- **Self-Healing İnceleme Paneli (`DetailPanel`):**
  - Hata Oranı, Ortalama Gecikme ve Çağrı Sayısı göstergeleri.
  - Kök Neden ve İyileştirme Maddeleri kartı.
  - "Refactored v2" ve "Original Code" arasında anlık geçiş yapılabilen sözdizimi vurgulu kod inceleme sekmesi.
  - Kuyruk başlığında manuel "Watchdog Scan" ve "Sim Anomaly" tetikleme butonları.
- **Composer İmleç Konumlu Emoji Ekleme (`composer.tsx`):**
  - Emojilerin her zaman metnin en sonuna eklenmesi hatası giderildi; `selectionStart` / `selectionEnd` ve `cursorPosRef` üzerinden imlecin bulunduğu tam konuma araya ekleme (inline slicing) sağlandı.

### ⛓️ 4. Workflow & Chain Adaptör Köprüsü ve Bağımlılık İkamesi (`tool-adapters.mjs`, `tools/`)
- **Dinamik İş Akışı & Orkestrasyon Yürütücüsü (`tool-adapters.mjs`):**
  - Elara veya bir ajanın sohbet/araç çağrısı üzerinden doğrudan `wf_...` veya `orc_...` iş akışlarını tetikleyebilmesi için `RUNNERS.workflow` ve `RUNNERS.chain` adaptörleri yürütme motoruna bağlandı.
- **Ortam Bağımlılıkları & Parametre Esnekliği:**
  - `dnspython` ve `python-whois` paketleri hem host Python'a hem `local-server/venv` ortamına kuruldu.
  - `tools/dns_lookup.py` parametre çözümleyicisi (`name`, `target`, `domain`, `host`) esnetilerek sıfır hata ile DNS çözümlemesi sağlandı.

---

## 57. COMPLETED (Phase 57) - INTERACTIVE MERMAID DIAGRAM RENDERING & DUAL-VIEW CHAT VISUALIZATION

Bu aşamada ELARA Sovereign Studio'nun sohbet arayüzüne ZED ve GitHub benzeri interaktif Mermaid mimari diyagram görselleştiricisi tam entegre edilmiştir:

### 📊 1. Canlı Mermaid Vektör Çizim Motoru (`mermaid-block.tsx` & `rich-message.tsx`)
- **İnteraktif İkili Görünüm (`[👁️ Diagram]` $\leftrightarrow$ `[💻 Code]`):**
  - Mesaj ayrıştırıcı (`parseBlocks`), ```` ```mermaid ```` kod bloklarını algıladığında salt metin yerine özel `<MermaidBlock />` bileşenini render eder.
  - Varsayılan olarak doğrudan ZED kalitesinde SVG akış/mimari diyagramı görüntülenir; istendiğinde tek tıkla ham koda geçiş yapılabilir.
- **ELARA Obsidian / Midnight Koyu Tema Uyumu:**
  - Mermaid `theme: 'base'` ve `themeVariables` üzerinden ELARA'nın koyu cam/obsidian paletine (Sapphire düğümler `#0d2035`, Emerald onay kutuları `#0e291e`, Topaz karar düğümleri `#261d0a`, Sapphire bağlantı çizgileri `#4f8cff`) uyarlandı.
- **Dışa Aktarma & İndirme:**
  - Oluşan mimari grafiği tek tıkla SVG vektör görseli olarak indirme (`Download SVG`) ve Mermaid kaynak kodunu panoya kopyalama (`Copy Code`) araç çubuğu eklendi.
- **SSR Güvenliği & Akış Dayanıklılığı:**
  - TanStack Start SSR ortamında Node.js çökmesini önlemek için `mermaid` kütüphanesi dinamik istemci yüklemesiyle (`client-only`) başlatıldı; tamamlanmamış/akış halindeki kodlar için güvenli fallback sağlandı.

### 🖥️ 2. Yeni Geliştirme İş İstasyonu & WSL2 Doğrulaması
- **Donanım Profili:** Intel Core Ultra 7 255U (12-Core, 96 GB RAM host / 30 GB WSL2 RAM tahsisi, 1 TB NVMe disk).
- **Protokol & Servis Sağlığı (100% Nominal):**
  - PostgreSQL 16 (`:5432` · 20ms, 168 tablo hazır)
  - Redis Server (`:6379` · PING ➔ PONG aktif)
  - RabbitMQ Broker (`:5672` · AMQP Handshake & Task kanalı açık)
  - Python Vector Worker (`:8082` · BAAI/bge-small-en-v1.5 devrede)
  - ELARA Middleware & Core API (`:3005` · 20 araç aktif, 0 anomali)
  - ELARA Vite UI (`:8080` · HTTP 200 OK)
  - ELARA TLS Proxy (`:10443` · SSL/TLS dinlemede)

---

## 58. UP NEXT - MULTI-NODE BENCHMARKING, LIVE AGENT STRESS TESTS & LOAD BALANCER HEALTH PROBE VALIDATION (PHASE 58)
- Load Balancer `/health` probe'ları altında eşzamanlı multi-agent stres testleri.
- Vektör boyutu ve yüksek yük altında semantik önbellek isabet oranı (Hit Rate) analitiği.
- Lovable artıklarının temizlenmesi, ölü kodların ayıklanması ve kod içi yorum satırlarının uluslararası standartlara (İngilizce) getirilmesi.

---

## 59. COMPLETED (Phase 59) — SOVEREIGN AI GATEWAY, B2B DEVELOPER HUB, TIER-BASED RATE LIMITING & MULTI-TENANT FINOPS INVOICING

Bu aşamada ELARA Sovereign Studio, üçüncü taraf kurumlara ve geliştiricilere (B2B SaaS / Private AI-as-a-Service) güvenli, yüksek başarımlı ve faturalandırılabilir yapay zeka hizmeti sunan **"Kurumsal Egemen AI Gateway & Geliştirici Platformu"**na tam olarak dönüştürülmüş ve doğrulanmıştır:

### 🏛️ 1. Hayata Geçirilen Mimari Bileşenler
1. **Google AI Studio Modeli API Key Yönetimi (`schema-api-keys.mjs`, `api-keys.mjs`, `src/routes/api-tokens.tsx`):**
   - `tenant_api_keys` ve `tenant_rate_limits` PostgreSQL tabloları oluşturuldu.
   - `sk-elara-live-...` formatında kriptografik anahtarlar üretilir.
   - SHA-256 hash ile O(1) hızında gateway kimlik doğrulaması yapılır.
   - AES-256-GCM Kasa (`vault_secrets`) şifrelemesi sayesinde yetkili operatör `/api-tokens` sayfasında dilediği an **"👁️ Reveal (Göster)"** ve **"📋 Copy (Kopyala)"** yapabilir.
2. **Redis Destekli Sliding Window Tier & Kota Motoru (`local-server/lib/rate-limiter.mjs`):**
   - **Tier 1 (Free / Starter):** 15 RPM | 50K TPM | 10M Aylık Token | 2 Concurrency
   - **Tier 2 (Pro / Growth):** 60 RPM | 300K TPM | 100M Aylık Token | 10 Concurrency
   - **Tier 3 (Enterprise / Dedicated):** 300 RPM | 1M TPM | 1Mrd Aylık Token | 50 Concurrency
   - Pre-flight kontrol: Redis (`:6379`) pipeline üzerinden <1ms süreyle hız ve kota doğrulaması yapılır. Kota aşımında `HTTP 429` veya `HTTP 402` döner.
3. **OpenAI Uyumlu Evrensel Gateway (`/v1/chat/completions`, `/v1/models`):**
   - Standart OpenAI SDK (Python/Node.js/LangChain/Cursor) ile %100 uyumlu JSON ve Server-Sent Events (SSE) `stream: true` akışı.
   - Redis Semantik Önbellek entegrasyonu: Aynı promptlarda **0ms gecikme ve $0.00 maliyetle** instant cache hit.
   - RAG Knowledge Space entegrasyonu: `model: "technical"` veya `model: "marketing"` gönderildiğinde kurumsal vektör dökümanlarını otomatik tarayıp kaynak referanslı cevap üretimi.
4. **Çoklu Kiracı FinOps Ledger & Fatura Raporlama (`reporting.mjs`, `src/routes/reporting.invoicing.tsx`):**
   - Her API çağrısı `provider_usage` tablosuna `api_key_id`, `tenant_id`, `prompt_tokens`, `response_tokens`, `cost_usd` bilgileriyle kaydedilir.
   - `Reporting ➔ Tenant Invoicing` sayfasında kiracı bazlı filtreleme, API anahtarı bazlı dağılım, model tüketim tablosu ve **"Download Official PDF Invoice"** tek tıkla kurumsal fatura çıktısı (`report-pdf.ts`).
5. **B2B Tenants Identity Management & Multi-IdP Binding (`users.tsx`, `identity.mjs`, `schema-api-keys.mjs`):**
   - `app_tenants` PostgreSQL tablosu ve CRUD API'leri eklendi (`auth_providers TEXT[]` çoklu IdP desteği ile).
   - `Users & Groups ➔ Tenants` sekmesi listenin en sonuna alındı (`Users` ➔ `Groups` ➔ `Templates` ➔ `RBAC Compliance` ➔ `Tenants`).
   - Süper-Admin yeni kiracı şirketler açabilir, SSO domain eşlemesi (`xxx.com`) ve birden fazla IdP Sağlayıcısı (`Settings ➔ Authentication` sayfasında yapılandırılan canlı kaynaklar: `Microsoft Entra ID 1`, `Microsoft Entra ID 2`, `LDAP 1`, `Local` vb.) arasından `Select + Add` ile çoklu kaynak bağlayabilir. Kartlar ve açılır kutular derin obsidian tema standardına getirildi.
   - `group-store.ts` içindeki çift grup açma yarış durumu (race condition) giderildi.
6. **Developer Hub & 3-Way Scoped Configuration Cards (`src/routes/api-tokens.tsx`):**
   - API Key kartlarına **Edit (Pencil) düzenleme butonu** eklendi; yetkiler, isim ve model/space/ajan izinleri sonradan düzenlenip kaydedilebilir.
   - API Key üretirken ve düzenlerken müşteri dostu 3'lü seçim mimarisi: **🧠 LLM Modelleri**, **📚 RAG Knowledge Alanları** ve **🤖 Otonom / RAG Kütüphaneci Ajanları** için Tools/Adapters kalitesinde modern açılır kutulu (dropdown + `+ Add` + removable chips) kart tasarımı.
   - Açılır kutular koyu obsidian (`#121216` / `#18181e`) temasına uyarlandı ve mükerrer model isimleri tekilleştirildi.
   - `api-tokens` (Developer Hub) ve `reporting-invoicing` (Tenant Invoicing) tüm RBAC matrisine (`SCOPE_ROUTES`), şablonlara ve `ALL_TAB_IDS` kümesine dahil edildi. Menüde bağımsız `Braces` (`{}`) ikonu ile ayrıştırıldı.

---

## 60. COMPLETED (Phase 60) — 360° ZERO-TRUST IDENTITY, MULTI-TENANT GOVERNANCE SEAL & ENTERPRISE FEDERATION

Bu aşamada ELARA Sovereign Studio'nun Kimlik (Identity), Çoklu Kiracı (Multi-Tenancy) ve Görünürlük (Visibility) katmanları baştan uca 360 derece denetlenmiş; ana çekirdek (Ring 1), yan alt sistemler (Ring 2) ve kurumsal federasyon akışları Zero-Trust sınırları ile eksiksiz mühürlenmiştir:

### 🏛️ 1. Hayata Geçirilen Mimari Bileşenler & Yapılan Düzeltmeler

#### A. 1. Halka (Ring 1 — Çekirdek Varlıklar & Kimlik Sınırları):
1. **Evrensel Veritabanı Çoklu Kiracı Şeması (`schema-api-keys.mjs`):**
   - Platformdaki tüm mülkiyet taşınabilir tablolara (`app_users`, `app_sessions`, `app_groups`, `agents`, `skills`, `tools`, `workflows`, `orchestrations`, `knowledge_spaces`, `rag_folders`, `knowledge_sources`, `chat_threads`) `tenant_id TEXT DEFAULT 'default'`, `is_global BOOLEAN DEFAULT false` ve `idx_*_tenant_id` indeksleri eklendi.
2. **Kusursuz Görünürlük ve Kiracı İzolasyon Motoru (`local-server/lib/actor.mjs`):**
   - `resolveActor(req)` ve `resolveActorContext(req)`: `isSuperAdmin`, `isTenantAdmin`, `tenantId`, `userId`, `role` ve departman `groupIds` bilgilerini eksiksiz üretir.
   - `buildVisibility`: Super-Admin (`1=1`), TenantAdmin (`tenant_id = $tenantId + global`), Kullanıcı (`MINE`, `GROUP`, `WORKSPACE` sınırları strictly kendi şirketi içinde).
3. **Sohbet Geçmişi & Mesaj İzolasyonu (`threads.mjs`):**
   - `chat_threads` ve `chat_messages` sadece ait olduğu kullanıcı ve şirket tarafından listelenebilir.
4. **Kullanıcı & Grup Yönetimi İzolasyonu (`identity.mjs`, `identity-groups.mjs`, `auth-utils.mjs`):**
   - `rowToUser` dönüşümüne `tenantId` eklendi. Kullanıcı/grup listeleme ve ekleme rotaları kiracı sınırına alındı.
5. **Bilgi Alanları & RAG Döküman İzolasyonu (`knowledge-spaces.mjs`, `rag-folders.mjs`):**
   - Knowledge Spaces ve RAG Klasörleri kiracı bazında izole edildi; Access Spaces içerisindeki `everyone` butonu yalnızca ilgili şirketin çalışma alanına (`workspace`) sınırlandırıldı.
6. **Altyapı (Services) & Model Yönlendirme (Routing) Güvenlik Sınırları (`infra.mjs`, `models.mjs`):**
   - `Settings ➔ Services` yalnızca Super-Admin erişimine kilitlendi (`403 Forbidden`).
   - `Settings ➔ Models` katalog ve yönlendirme değişiklikleri `requireSuperAdmin` ile güvenceye alındı.

#### B. 2. Halka (Ring 2 — 360° Yan Modüller & Alt Sistemler):
1. **Model Context Protocol (MCP Client Servers & Exposures — `mcp.mjs`, `client.mjs`):**
   - `mcp_client_servers`, `mcp_clients`, `mcp_exposures`, `mcp_tokens` tablolarına `tenant_id` ve `is_global` bağlandı; şirketlerin uzak MCP sunucu bağlantıları tamamen izole edildi.
2. **Capability Packs (`capabilities.mjs`):**
   - Sektörel yetenek paketleri `tenant_id` ve `is_global` ile damgalandı; özel yetenek paketleri şirket sınırına alındı.
3. **Planners & Planlayıcılar (`planners-crud.mjs`):**
   - Otonom planlayıcılar ve shadow planlar `tenant_id` ile filtrelendi.
4. **Episodik & Olgusal Bellek (`memory.mjs`):**
   - `memory_working`, `memory_episodic` ve `memory_facts` hafıza tabloları kiracı bazında sınırlandırıldı; bir şirketin hafıza izleri diğer şirkete karışamaz.
5. **Python Runtimes (`python-crud.mjs`):**
   - Özel sanal ortamlar (`runtimes`) şirket bazlı izole edildi; sistem ortamları `is_global = true` olarak paylaşıldı.
6. **Adapters & Webhooks (`adapters.mjs`, `webhooks-crud.mjs`):**
   - REST/SSH/API Adaptörleri ve Inbound Webhook dinleyicileri `tenant_id` ile korundu.
7. **Targets & Endpoints (`targets-crud.mjs`):**
   - Ağ hedefleri, sunucular ve uç noktalar `tenant_id` bazında gruplandı.
8. **Onay Kuyruğu (Human-in-the-Loop Approvals — `approvals.mjs`):**
   - Onay bekleyen biletler (`approval_requests`) ilgili kiracı yöneticisine (`tenant_id`) yönlendirildi.
9. **Meta-Forge Otonom Sentez Motoru (`meta-forge/apply.mjs`):**
   - Meta-Forge tarafından sentezlenen yeni araçlar, ajanlar ve iş akışları planı başlatan kullanıcının `tenant_id` bilgisiyle veritabanına kaydedilir.
10. **Kasa (Secret Vault — `vault.mjs`, `vault_secrets`):**
    - Vault secret kayıtları `tenant_id` ve `is_global` ile etiketlendi; müşteri BYOK anahtarları kendi şirketine münhasır kılındı.
11. **Schedules & Raporlamalar (`reporting.mjs`):**
    - Otomatik zamanlanmış raporlar (`schedules`) kiracı bazında izole edildi.
12. **Güvenlik Politikaları & Özel Takip Listeleri (`security-policies.mjs`, `cve.mjs`):**
    - `guard_rules`, `isolation_profiles`, `policy_rules`, `signed_artifacts` ve `cve_watchlists` kiracı ayrımına alındı.
13. **Denetim Günlükleri & Canlı Hata Ayıklama (`system-misc.mjs`, `system.tsx`):**
    - `/api/logs` uç noktası TenantAdmin için otomatik olarak kendi personeline sınırlandırıldı; `/api/logs/purge` işlemi yalnızca Super-Admin (`tenant_id = 'default'`) yetkisine kilitlendi.

#### C. Kurumsal UI/UX İyileştirmeleri & Otomatik Federasyon:
1. **Otomatik Slug (Identifier) & Kilit Mekanizması (`users.tsx` ➔ `TenantsTab`):**
   - Şirket adı yazıldıkça Tenant Slug anlık üretilir (`acme_corp`). `[🔒 Auto]` / `[🔓 Custom]` kilit butonuyla elle düzenleme izne bağlandı; mevcut şirketler için slug değiştirilemez (immutable) kılındı.
2. **Çoklu SSO Domain Etiketleri & Akıllı IdP Keşfi (`users.tsx` ➔ `TenantsTab`):**
   - Şirketlere birden fazla domain etiketi (`[@acme.com (x)] [@acme.co.uk (x)]`) tanımlama desteği eklendi.
   - `Authentication Sources` listesinden bir IdP seçilip `+ Add` dendiğinde, sistem IdP metadata'sındaki domainleri (Entra/LDAP) otomatik tespit edip domain listesine ekler.
3. **Otomatik Super-Admin Eşleme & Directory Claims (`schema-auth.mjs`):**
   - `d-teknoloji.com.tr` gibi kurumsal domainler Global Sovereign Tenant'a (`default`) bağlandığında veya Active Directory / Entra üzerinde `Domain Admins` grubu `Administrators` grubuna eşlendiğinde, personeller kurumsal IdP ile oturum açtığı an sıfır-manuel müdahale ile **Super-Admin / Sovereign Operator** olarak tanınır.
4. **Kullanıcı & Grup Kartı Kiracı Seçimi (`users.tsx` ➔ `UsersTab`, `GroupsTab`):**
   - Kullanıcı kartında `VALID UNTIL` karşısına simetrik **`ORGANIZATION (TENANT)`** açılır kutusu ve sol listede `@admin · Admin · local · default` kiracı rozetleri eklendi.
   - Grup kartına **`ORGANIZATION (TENANT)`** seçicisi eklenerek grupların küresel mi yoksa şirkete özel mi olduğu kontrol altına alındı.
   - `/account` profil sayfasına **`Organization (Tenant)`** kimlik kartı eklendi.
5. **Reporting & Invoicing Obsidian Koyu Tema Standardizasyonu (`reporting.invoicing.tsx`, `reporting.mjs`):**
   - Fatura ve raporlama sayfalarındaki kiracı seçici beyaz açılır kutulardan arındırılarak koyu obsidian `#111113]/95` buzlu cam `ObsidianPick` standardına kavuşturuldu.
   - Tüm Reporting uç noktaları (`overview`, `usage`, `cost`, `operators`, `rag`, `invoicing`) kiracı ve kullanıcı bazlı süzme yapabilecek şekilde zenginleştirildi.

6. **Geliştirici Hub & Proaktif Kota / Rate Limit Alarmları (`api-tokens.tsx`, `api-keys.mjs`):**
   - API Key üretim ve düzenleme modalına **`Quota & Rate Limit Email Alerts`** yeteneği eklendi (`alert_on_limit` & `alert_email`).
   - Anahtar kartlarına `🔔 Quota Alert` rozeti konuldu. Kotalar %80 / %100'e ulaştığında veya aşım olduğunda otomatik alarm e-postası üretilir.
7. **Scheduled Exports Eksiksiz Şablon & Koyu Tema Entegrasyonu (`reporting.exports.tsx`, `report-templates.ts`):**
   - Rapor zamanlama motoruna **`Tenant Invoicing & Billing`** ve **`RAG & Knowledge Retrieval`** şablonları dahil edildi.
   - `Organization (Tenant Scope)` seçicisi ve koyu obsidian açılır kutu standardı uygulandı.
8. **RBAC Önizleme Güvenliği (Fail-Safe Escape Hatch):**
   - RBAC önizleme modunda (`Preview as Viewer` vb.) ekranın en tepesine sabit **amber renkli `[EXIT PREVIEW]`** kaçış şeridi yerleştirildi; adminlerin kısıtlı rollerde kilitlenip kalması imkansız kılındı.

---

## 61. COMPLETED (Phase 61) — CHAT HYBRID ATTACHMENT STORAGE ENGINE, ON-THE-FLY DOCUMENT INGESTION & PERFORMANCE SEAL

Bu aşamada ELARA Sovereign Studio'nun Chat ekleri, görseller, PDF ve belge işleme mimarisi baştan sona modernize edilmiş; Shared Storage Hub (Local/NFS & S3/MinIO) ile entegre uçtan uca hibrit depolama motoru devreye alınmıştır:

### 🏛️ 1. Hayata Geçirilen Mimari Bileşenler & Yapılan Düzeltmeler

#### A. Hibrit Depolama Motoru (`local-server/lib/storage-engine.mjs`):
1. **Veritabanı & LocalStorage Şişmesinin (Bloat) Önlenmesi:**
   - Chat'e yüklenen ekran görüntüleri, resimler ve dosyalar artık doğrudan `POST /api/chat/attachments` üzerinden paylaşılan depolama katmanına (`./uploads` veya yapılandırılmış Shared Storage Hub) yazılır.
   - `chat_files.url` kolonuna 400.000 karakterlik Base64 yerine sadece 30 karakterlik `/api/uploads/:id` linki yazılır. Satır boyutu megabaytlardan 200 bayta inmiş, `GET /api/threads` sorguları ultra hafifletilmiştir.
   - İstemci tarafında `localStorage` kota dolması (`QuotaExceededError`) riski kalıcı olarak sıfırlanmıştır.
2. **Güvenli Servis Uç Noktaları (`/api/chat/attachments` & `GET /api/uploads/:id`):**
   - Yüklenen dosyalar `tenant_id`, `size_bytes`, `kind` ve `mime` bilgileriyle damgalanır.
   - `GET /api/uploads/:id` uç noktası `Cache-Control: public, max-age=86400, immutable` ve doğru `Content-Type` başlıklarıyla dosyaları yüksek başarımla sunar.

#### B. Akıllı PDF ve Belge Çıkarım Katmanı (`chat-orchestrate.mjs`):
1. **Anlık Görsel Çözümleme (Vision LLMs):**
   - `/api/uploads/:id` formatında saklanan görseller, OpenAI, Anthropic veya yerel Vision modellerine iletilirken diskten asenkron okunarak Base64 `image_url` bloğuna dönüştürülür.
2. **Yerleşik PDF & Doküman Metin Ayrıştırma (`extractFileContent`):**
   - Chat'e sürüklenen PDF, DOCX, XLSX, CSV, TXT, LOG veya kaynak kod dosyaları, `extractFileContent` motoru tarafından arka planda anında ayrıştırılır ve modele yapısal belge bağlamı (`📄 [Attached Document: ...]`) olarak aktarılır.
   - Böylece kullanıcı chate PDF attığında LLM belgenin tüm içeriğini hatasız şekilde okuyup analiz edebilir.

#### C. Tenant Bazlı Veri Saklama & Otomatik Temizlik (Data Retention SLA — `users.tsx`, `retention.mjs`):
1. **Kurumsal Retention & Auto-Purge Mimarisi:**
   - `app_tenants` şemasına `retention_enabled BOOLEAN DEFAULT false`, `retention_days INT DEFAULT 90` ve `retain_pinned BOOLEAN DEFAULT true` kolonları eklendi.
   - `users.tsx` TenantsTab modalına obsidian temalı `Chat & Attachment Retention SLA` kartı, açma/kapama switch'i, hızlı gün butonları (`[30d] [60d] [90d] [180d] [365d]`) ve `[✓] Preserve Pinned & Starred Conversations` seçeneği eklendi.
   - Şirket kartlarına `🕒 90d Auto-Purge · Safe` / `🕒 Indefinite` durum rozeti yerleştirildi.
2. **Arka Plan Temizlik Motoru (`retention.mjs` & `storage-engine.mjs`):**
   - `runTenantChatRetention(pool)` motoru geliştirildi; aktif şirketlerde `updated_at` süresi dolan (ve korunmayan) sohbetlerin hem veritabanı kayıtları hem de diskteki fiziksel resim/PDF dosyaları (`purgeThreadAttachments`) otomatik olarak temizlenir.

#### D. 3. Parti Harici AI Guardrail & LLMFort / Lakera Entegrasyonu (`genguard-scanner.mjs`, `policy.tsx`):
1. **Bring-Your-Own AI Firewall (BYO-Guardrail):**
   - `guard_rules` tablosuna `engine_type ('native' | 'external')`, `endpoint_url`, `auth_mode ('vault' | 'direct')`, `vault_ref`, `api_key`, `provider_format ('llmfort' | 'lakera' | 'llamaguard' | 'generic')`, `risk_threshold`, `timeout_ms` ve `fail_mode ('fail_open' | 'fail_closed')` kolonları eklendi.
   - `local-server/lib/genguard-scanner.mjs` motoru geliştirildi; harici güvenlik duvarlarına (LLMFort, Lakera, Llama Guard vb.) Secret Vault üzerinden şifreli API anahtarıyla asenkron denetim yapılır.
   - `chat-orchestrate.mjs` içine entegre edildi; risk eşiğini aşan prompt enjeksiyonları veya politika ihlalleri anında bloklanıp denetim günlüğüne (`policy.genguard.external`) kaydedilir.
   - `src/routes/policy.tsx` GenGuard modalına yerel Regex ve harici API motoru seçimi eklendi; kural listesinde `🌐 [LLMFORT] https://...` rozetleri görüntülendi.

#### E. Canlı Policy Engine Orkestrasyonu & Dinamik Model Yönlendirme (`policy-engine-eval.mjs`, `policy.tsx`):
1. **Canlı Runtime Model Yönlendirmesi (ROUTING / OUTPUT Chain):**
   - `local-server/lib/policy-engine-eval.mjs` motoru geliştirildi; `chat-orchestrate.mjs` prompt inference öncesinde `policy_rules` tablosunu otomatik değerlendirir.
   - `intent = coding ➔ route -> qwen2.5-coder-32b` gibi kurallar eşleştiğinde, sohbet modeli canlıda anında ilgili modele yönlendirilir; `DENY` ve `CHALLENGE` aksiyonları denetim günlüğü ile uygulanır.
2. **Kural Formunda Dinamik Model & Ajan Açılır Kutusu (`policy.tsx`):**
   - `ACTION = ROUTE` seçildiğinde, `ACTION PARAMETER` alanı elle yazmak yerine stüdyoda kayıtlı tüm aktif modelleri (`🧠 Model: ...`) ve ajanları (`🤖 Agent: ...`) dinamik açılır kutu (`select dropdown`) olarak listeler.

#### F. 360° Policy & Security DB & Backend Denetimi (Zero-Mock Tam Doğrulama):
- **Secret Vault (`vault_secrets`):** AES-256-GCM şifreli, 100% DB ve backend bağlı.
- **GenGuard (`guard_rules`):** Yerel Regex + Harici LLMFort/Lakera, 100% DB ve chat bağlı.
- **Tool / Skill / MCP Isolation (`isolation_profiles`):** 100% DB ve backend bağlı.
- **Signed Workflows (`signed_artifacts`):** 100% DB ve backend bağlı.
- **Policy Engine (`policy_rules`):** 100% DB ve chat orkestrasyonuna bağlı.
- **Sonuç:** `Policy & Security` altındaki 7 sekmenin tamamı %100 canlı veritabanı ve backend entegrasyonuyla mühürlenmiştir.

#### G. Kurumsal SIEM Forwarder Genişletmesi & 15-Kanal Audit Yayını (`siem-forwarder.mjs`, `siem-panel.tsx`):
1. **15 Kategorik SIEM Akış Kanalı:**
   - SIEM iletim kanalları genişletildi: `Authentication`, `RBAC`, `Multi-Tenancy`, `GenGuard (LLMFort)`, `Policy Engine`, `Secret Vault (BYOK)`, `Cryptographic Audit Ledger`, `Developer Hub (API Keys)`, `Human-in-the-Loop Approvals`, `RAG Knowledge`, `Autonomous Agents`, `Tool Sandboxes`, `Workflows (DAG)`, `Model Context Protocol (MCP)`, `System Lifecycle`.
   - Arayüze (`siem-panel.tsx`) kategorik arama/filtreleme, `[Select All]`, `[Security Only]`, `[Clear]` hızlı aksiyon butonları ve aktif akış rozetleri eklendi.
2. **Uçtan Uca UDP / TCP / TLS & CEF / LEEF / JSON / RFC5424 İletimi (`siem-api.mjs`):**
   - Canlı SIEM soket probe uç noktası (`POST /api/system/siem/test`) geliştirildi; UDP, TCP ve TLS üzerinden gerçek bağlantı gecikmesi (`latencyMs`) hesaplanır.
   - `siem-forwarder.mjs` akış filtreleme mantığıyla güçlendirildi; yalnızca seçilen kanallar harici SIEM toplayıcısına (ArcSight, QRadar, Splunk, Wazuh) aktarılır.

#### H. Global Converter & Canlı Dizin Seçici (`converter.tsx`):
1. **Dış Kaynaklı Yetenek Temizliği & Veritabanı Kaydı:**
   - Cursor, CloudCode, Copilot, Claude Code tanımlarındaki harici yollar otomatik temizlenir.
   - `Create Capability` butonu dönüştürülen yeteneği doğrudan ilgili veritabanı uçlarına (`/api/agents`, `/api/skills`, `/api/forge/actions`) kaydeder.
   - `showDirectoryPicker` API ile işletim sistemi tabanlı canlı klasör seçici entegre edildi.

#### I. Omni-Search Command Palette (`command-palette.tsx`, `palette-surfaces.ts`):
- `Cmd+K` global arama motoruna Developer Hub, FinOps Invoicing, Tenants, GenGuard, Global Converter ve RAG Bilgi Alanları (`useSpaces()`) eklendi.
- Yeni sohbet başlatma, ajan/iş akışı üretme ve API Key oluşturma hızlı eylem kısayolları (`Quick Actions`) bağlandı.

#### J. Tema Duyarlı Açılır Kutu (`ObsidianSelect`) & Arayüz Hijyeni:
- İşletim sistemi kaynaklı beyaz/siyah native açılır kutu parlamalarını engelleyen tema duyarlı `ObsidianSelect` bileşeni geliştirildi; `users`, `api-tokens`, `reporting`, `telemetry-sources`, `siem` ve `vault-key-field` alanlarına uygulandı.
- `GenGuard` aksiyon listesi arındırıldı (`DENY`, `CHALLENGE`, `LOG`, `ALLOW`), `CHALLENGE` durumunda `approval_requests` güvenlik karantinası bağlandı.
- Sistem servisleri klasörü işletim sistemi bağımsız `local-server/system_services` olarak standardize edildi.

#### K. Geriye Dönük Tam Uyumluluk & Direktif Öncelik Hiyerarşisi (Zero-Breakage & Directive Precedence):
- Sistem hem eski Base64 formatındaki (`data:image/...`) sohbet geçmişini hem de yeni `/api/uploads/...` formatını şeffafça destekler; mevcut verilerde hiçbir bozulma yaşanmaz.
- `[LANGUAGE & RESPONSE DIRECTIVE]` içerisine `[THREAD CONTEXT]`, standing instructions ve kullanıcı dil tercihinin ana dil kuralını ezebileceği açık istisna hiyerarşisi (`UNLESS explicitly overridden...`) eklendi. Böylece derin akıl yürüten (Reasoning / High Effort) modellerin çelişkide kalıp sistem kuralına aşırı sadakat göstermesi (`over-compliance`) önlenerek sohbet içi dinamik dil/kontekst geçişleri kusursuzlaştırıldı.

#### L. Chat Orchestrator TTFT Paralelizasyonu & Modül Hijyeni (`chat-orchestrate.mjs`):
- İstek anında sıralı (seri) koşturulan 8 bağımsız veritabanı sorgusu (`models`, `ai_providers`, `system_config`, `guard_rules`, `memory_facts`, `memory_working`, `action_library`, `mcp_client_servers`) tek bir `Promise.all` paralel batch'i olarak birleştirildi; Time-to-First-Token (TTFT) DB gecikmesi ~30ms'den ~3ms'ye düşürüldü.
- `sys_get_directory` içi 7 tablonun taranması `Promise.all` ile paralel soketlere dağıtıldı.
- Sıcak kod yollarında yer alan dinamik `import()` çağrıları dosya başında statik içe aktarıma (`redis-cache.mjs`, `embed-provider.mjs`, `planner.mjs`, `seed.mjs`) dönüştürüldü.
- Kod içi kalan tüm Türkçe yorum satırları kurumsal İngilizce standartlarına getirildi.

#### M. Veritabanı Tip Uyumluluğu & Raporlama İndeks Hijyeni (`reporting.mjs`, PostgreSQL):
- `agent_logs`, `runs` ve `chat_attachments` tablolarındaki `thread_id` kolonları evrensel `TEXT` tipine (`ALTER TABLE ... TYPE TEXT`) geçirildi. Böylece hem istemci tabanlı (`chat_1789...`) hem de sistem UUID thread ID'leri asenkron log ve run kayıtlarında 0 hata ile yazılır.
- `reporting.mjs` içindeki `schedules` indeks tanımlaması doğru kolona (`idx_schedules_user ON schedules(user_id)`) çekildi ve başlangıç notice uyarıları temizlendi.

#### N. UI Ajan Kilitlenmesi & Sticky Delegasyon Düzeltmesi (`src/routes/index.tsx`):
- Önceki turda arka planda delege edilen bir alt ajanın (`Technical_Librarian` vb.) sonraki tüm normal sohbet turlarında aktif ajan olarak kilitlenip kalmasına (`priorAgentId` sticky lock) neden olan mantık düzeltildi.
- Artık kullanıcı `@Ajan` ile açıkça bir ajan seçmedikçe veya oda baştan o ajana özel açılmadıkça (`threadBoundAgentId`), her yeni turda varsayılan olarak ana model (Studio Brain / Elara) devreye girer.
- `npx tsc --noEmit` tam derleme kontrolü 0 hata ile doğrulanmıştır.

#### O. Model-Agnostik Orkestrasyon Hiyerarşisi & Self-Healing Retry (`seed.mjs`, `planner.mjs`, `chat-orchestrate.mjs`):
- **Bilişsel Kural & İngilizce Prompt Standartları (`seed.mjs`):** `META_FORGE_SYSTEM_PROMPT` içine `[ORCHESTRATION CHAIN & WORKFLOW ARCHITECTURAL INVARIANTS]` eklendi. Tüm modeller için (Gemma-4, Gemini Flash, Claude, OpenAI) mikro-iş akışı (`workflow`) ile makro-orkestrasyon (`chain`) ayrımı netleştirildi. Bir Chain'in doğrudan araç çalıştıramayacağı, en az 2 bağımsız Workflow bağlaması gerektiği ve eksik Workflow'ların aynı planda önceden üretilmesi gerektiği kurala bağlandı.
- **Şema Doğrulama Katmanı (`planner.mjs`):** `validateForgePlan` fonksiyonunda Chain düğümlerine doğrudan `tool` konulması engellendi.
- **Self-Healing Retry Katmanı (`chat-orchestrate.mjs`):** MetaForge plan üretiminde şema veya JSON ayrıştırma hatası yaşanırsa, 1 turluk self-healing retry ile modele doğrulama hatası bildirilerek düzeltilmiş plan üretmesi sağlandı.

#### P. Akış & Şema Biçimlendirme Direktifi (`chat-orchestrate.mjs`):
- `masterDirectives` içine `[DIAGRAM & FLOW FORMATTING DIRECTIVE]` eklendi; modellerin süreç akışlarında çirkin ham LaTeX sembolleri (`\rightarrow`, `\begin{cases}`) üretmesi engellenerek temiz Unicode okları (`→`) veya standart Mermaid diyagramları (` ```mermaid `) üretmesi sağlandı.

#### Q. Chat Orchestrator Modüler Refactoring & Mimari Ayrıştırma (`lib/orchestrator/`):
- **Mimari Ayrıştırma:** ~2.750 satırlık devasa `chat-orchestrate.mjs` dosyası 4 bağımsız ve yüksek performanslı alt modüle ayrıştırıldı:
  1. `lib/orchestrator/directives.mjs`: Master sistem direktifleri, dil hiyerarşisi, LaTeX/Mermaid kuralı, uzun vadeli hafıza ve thread pinned bellek blokları montajı.
  2. `lib/orchestrator/stream-bridge.mjs`: Vendor-agnostic LLM Streaming köprüsü, Anthropic/OpenAI lehçe adaptörleri ve TCP-Killer soket yaşam döngüsü yönetimi (`agent: false`).
  3. `lib/orchestrator/tool-dispatcher.mjs`: `sys_get_directory`, `sys_delegate_to_agent` (Agentic RAG ile), `sys_execute_tool`, `sys_delegate_to_metaforge` (Self-Healing Retry ile) ve canlı web araması icra köprüsü.
  4. `lib/orchestrator/finops-meter.mjs`: Token sayımı, FinOps tarife maliyeti hesaplama ve `provider_usage` / `memory_working` veritabanı kayıtları.
- **Sonuç:** `chat-orchestrate.mjs` ~600 satırlık temiz, hafif ve bakımı kolay bir Gateway Router'a dönüştürüldü; Time-to-First-Token (TTFT) gecikmesi ve SSE JSON sözleşmeleri %100 korundu.

#### R. Canlı Web Arama Zorunluluğu & Vault Destekli Multi-Engine Fallback (`directives.mjs`, `tool-dispatcher.mjs`):
- Web search butonu aktif olduğunda modele `[LIVE WEB SEARCH MANDATE (ACTIVE)]` direktifi enjekte edilerek yerel modelin (Gemma 4 vb.) eski eğitim hafızasından uydurma yapması engellendi; canlı fiyat, ürün ve haber sorgularında `sys_web_search` çağırması zorunlu kılındı.
- `tool-dispatcher.mjs` içindeki arama köprüsü Tavily (Vault anahtarlı), SearXNG ve DuckDuckGo HTML/Instant katmanlı arama yedeklemesiyle donatıldı.

#### S. Akış Halindeki Mermaid Diyagramlarında Titreme Önleme (Zero-Jitter Mermaid — `rich-message.tsx`, `mermaid-block.tsx`):
- `parseBlocks` ayrıştırıcısına `isComplete` bayrağı eklendi. Model diyagram kodunu satır satır akıtırken (`isComplete === false`) yarım kodların render edilip ekranı sallaması engellendi; şık bir `generating diagram...` rozetiyle sabit kod gösterimi sağlandı.
- Kapanış backtick'leri (` ``` `) geldiği anda tam diyagram SVG'si pürüzsüzce render edilerek interaktif diyagram görünümüne geçiş sağlandı.

#### T. KaTeX Matematik & Matris Motoru Entegrasyonu (`rich-message.tsx`, `styles.css`):
- `katex` paketi ve `@types/katex` doğrudan projeye yüklendi, `styles.css` içerisine KaTeX font ve stil kütüphanesi bağlandı.
- `rich-message.tsx` içerisindeki `parseBlocks` ve `Inline` ayrıştırıcıları; satır içi `$ ... $`, blok `$$ ... $$`, çok satırlı matris ortamları (`\begin{pmatrix}`, `\begin{matrix}`, `\begin{bmatrix}`), karar dallanmaları (`\begin{cases}`) ve denklemleri (`\begin{aligned}`, `\[ ... \]`) otomatik algılayıp pürüzsüz KaTeX Display Math formatında render edecek şekilde mühürlendi.

#### U. Canlı Tool & MetaForge SSE Akışı ve Çok Turlu Yerel Model Protokolü (`orchestrate-stream.ts`, `directives.mjs`, `chat-orchestrate.mjs`):
- `src/lib/orchestrate-stream.ts` SSE ayrıştırıcısına `phase === "tool_running"`, `phase === "tool_start"` ve `phase === "meta_forge_planning"` durumları eklendi. Araç veya MetaForge çağrıldığı anda UI üzerinde dönen çark ile canlı `⚡ Running sys_delegate_to_metaforge…` animasyonu anında tetiklendi.
- `directives.mjs` içine `[TOOL EXECUTION & MULTI-TURN PROTOCOL]` direktifi eklendi; yerel modellerin (Gemma-4 vb.) 1. turda gevezelik yapmadan doğrudan aracı çağırması, sentezlenen tablo, şema ve onay kartı yönlendirmesini 2. turda sunması sağlandı.
- MetaForge onay kartının mesaj metni ve diyagram tamamlandıktan sonra mesajın hemen altında pürüzsüz biçimde belirmesi güvenceye alındı.

#### V. Orkestrasyon Zincirlerinde Workflow Silme Bağımlılık Koruması (Dependency Guard — `workflows.mjs`, `workflow-store.ts`):
- `DELETE /api/workflows/:id` uç noktasına referans bütünlüğü denetimi eklendi. Silinmek istenen workflow herhangi bir Orchestration Chain (`orchestrations`) içerisinde kullanımda ise silme işlemi `HTTP 409 Conflict` ile engellenir ve bağlı zincir isimleri döndürülür.
- `src/lib/workflow-store.ts` içerisindeki `remove` fonksiyonu `confirmAction` obsidian modalı ile entegre edildi; zincirde kullanılan iş akışlarının arayüzden veya yerel hafızadan yanlışlıkla silinmesi (split-brain) engellendi. İş akışı zincirden çıkarıldığında veya zincir silindiğinde bağımsız silme işlemi serbest kalır.

#### W. Akış İçi Düşünce Etiketi Ayrıştırma & Sızıntı Önleme (`createStreamingTagParser` — `stream-bridge.mjs`):
- Token seviyesinde parçalanan (`"<"`, `"th"`, `"ink>"`) düşünce etiketlerini tamponlayan durum bilgili `createStreamingTagParser()` motoru devreye alındı. `<think>`, `<thought>`, `<reasoning>` etiketlerinin `type: "out"` normal mesaj metnine sızması kalıcı olarak engellendi.

#### X. Bilişsel Mimari Öz-Farkındalık & Akış İçi Donma Önleme (`directives.mjs`, `stream-bridge.mjs`):
- `[SOVEREIGN CORE DIRECTIVE & ARCHITECTURAL IDENTITY]` bölümü sadeleştirildi ve altyapı bağımsızlığı sağlandı: Doğrudan veritabanı/önbellek marka isimleri (PostgreSQL, Redis vb.) ve 6. Güvenlik iç detayları (AES-256 Vault, SIEM vb.) gizlenerek mimari tamamen kurumsal egemen katman olarak soyutlandı. 5 ana sütun tanımlandı: 4-Tier Memory Engine, Enterprise Routing, MetaForge & Self-Healing, Agentic RAG ve Multi-Agent MCP.
- `createStreamingTagParser` içerisine `hasStartedOut` durum koruması eklendi; ana metin akışı başladıktan sonra yerel modellerin araya sıkıştırdığı uydurma/artık `<think>` etiketlerinin akışı dondurup metni yukarıdaki düşünce kutusuna kaçırması engellendi.

#### Y. Sıfır-Şişme Dinamik Araç Enjeksiyonu (Zero-Shot Capability Optimization — `chat-orchestrate.mjs`):
- Her istekte 105 araçlık devasa JSON şemasının (`tools: [...]`) gereksiz yere yüklenerek prompt boyutunu 10.000+ tokene şişirmesi engellendi.
- Yalnızca kullanıcının açıkça seçtiği (`/tool`, `!skill`, `#mcp`), ajana atanmış veya `auto_inject: true` olan araçlar ile 5 çekirdek yönlendirici araç (`sys_get_directory`, `sys_delegate_to_agent`, `sys_delegate_to_metaforge`, `sys_execute_tool`, `sys_web_search`) yüklenecek şekilde optimize edildi. Prompt token boyutu %80+ hafifletilerek TTFT ve yanıt hızları maksimize edildi.

#### Z. Çok Turlu ReAct Token Sayımı & Gerçek Donanım Hızı (True tok/s — `chat-orchestrate.mjs`, `message-actions.tsx`):
- Çok turlu araç çalıştırma döngülerinde token sayacının sadece son turun birkaç kelimelik yanıtını (`tokens: 37`) sayıp 78 saniyelik toplam süreye bölmesi (`37 / 78s = 0 tok/s`) hatası düzeltildi.
- Tüm turlarda modelin ürettiği düşünce (`assembledThinking`), araç argümanları ve metin tokenları kümülatif olarak toplandı (`cumulativeResponseTokens`), gerçek aktif GPU üretim süresine (`cumulativeGenMs`) bölünerek gerçek donanım throughput'u (Gemma-4 için 14-18+ tok/s) şeffaf şekilde yansıtıldı.

#### AA. Vektörel & %100 Türkçe Destekli Çevrimdışı PDF Motoru (`chat-export.ts`, `report-pdf.ts`, `pdf-fonts.ts`):
- Tailwind v4 `oklch` CSS renk fonksiyonlarıyla çatışıp hata veren (`unsupported color function "oklch"`) DOM-raster yaklaşımı yerine, `DejaVuSans` (Regular + Bold) TrueType fontları doğrudan sisteme ve `public/fonts/` altına entegre edildi.
- Hem **Sohbet Dışa Aktarımı (`chat-export.ts`)** hem de **Tüm Raporlama / Faturalandırma (`report-pdf.ts`)** modülleri saf vektörel jsPDF motoruna geçirildi.
- Türkçe karakterler (`ç, Ç, ğ, Ğ, ı, İ, ö, Ö, ş, Ş, ü, Ü`), Markdown başlıkları, tablolar, kod blokları ve KPI kartları piksellenmeden, sıfır `oklch` hatasıyla, seçilebilir/kopyalanabilir vektörel kalitede ve anında (<50ms) PDF olarak üretilir.

---

## 62. IN EXECUTION — PHASE 62: 360° ZERO-TRUST MULTI-TENANT & DESK OWNERSHIP HARDENING

**Branch:** `refactor/phase-62-core-hygiene`
**Son Güncelleme:** 2026-09-14

---

### 🎯 1. Ne Yapmak İstedik? (Hedef ve Kapsam)
ELARA Sovereign Studio genelinde **Zero-Trust Çoklu Kiracı (Multi-Tenancy) ve Kişisel Desk Mülkiyeti (Desk Ownership)** mimarisini uçtan uca (UI ↔ API ↔ DB) hayata geçirmek:
1. **Çapraz Kullanıcı Veri Sızıntısını Sıfırlamak:** Admin ve normal operatör (`deneme`) arasında Sohbetler, Hafıza (Working/Episodic), Koleksiyonlar/RAG, Squad'lar, İş Akışları, Yetenekler, Araçlar ve MCP sunucuları arasında hiçbir veri kaçağına izin vermemek.
2. **Read-Only Workspace Paylaşım Modeli:** Bir varlık `workspace` veya `shared` bandında paylaşıldığında diğer kullanıcılar bunu çalıştırabilir ve okuyabilir; ancak **asla düzenleyemez, silemez veya parametrelerini değiştiremez** (`canEdit = false`, backend HTTP 403). Değiştirmek isteyen kullanıcı nesneyi kendi desk'ine klonlamalıdır (`Clone to my desk`).
3. **Eski Prototip (Lovable) Önbellek Hijyeni:** Tek kullanıcılı prototip döneminden kalan ham, un-namespaced `localStorage` bağımlılıklarını kullanıcı ID'sine (`base::userId`) izole `readDesk`/`writeDesk` standardına geçirmek.

---

### 🛠️ 2. Şu Ana Kadar Neler Yaptık? (Tamamlananlar)
1. **Backend SQL Görünürlük & 403 Mutasyon Zırhı (`actor.mjs` & API Gateway):**
   * `buildVisibility(ctx)` filtresi tüm modüllere uygulandı; `canActorEdit(ctx, row)` ve `assertCanEdit(ctx, row)` ile SuperAdmin/Sahip dışındaki tüm yetkisiz `POST / PUT / PATCH / DELETE` istekleri `HTTP 403 (Read-only object)` ile engellendi.
   * `agents-crud`, `agents-extra`, `skills`, `capabilities`, `workflows`, `mcp`, `planners-crud`, `adapters`, `forge`, `meta-forge`, `webhooks-crud` API'leri korumaya alındı.
2. **Sohbet & Bellek İzolasyonu (`threads.mjs`, `memory.mjs`):**
   * `chat_threads` unowned kayıtlar Admin'e bağlandı, `OR owner_id IS NULL` kaldırıldı.
   * `memory_working` ve `memory_episodic` sorguları aktif kullanıcı (`user_id`, `actor`) ile sınırlandı.
3. **Dinamik Squad & Tab Mimarisi:**
   * `agent_squads`, `skill_squads`, `capability_squads` tablolarına `owner_id`, `tenant_id`, `visibility` eklendi.
   * **Boş Squad Kuralı:** 0 varlığı olan squad'lar sadece sahibine görünür; başka kullanıcının içinde varlığı olmayan boş squad'ı görmesi backend seviyesinde engellendi.
4. **İstemci Depolama İzolasyonu (`ownership.ts` & Stores):**
   * `workflow-store`, `orchestration-store`, `forge-store`, `metaforge-store`, `tool-panel-store`, `snippet-store`, `agent-store`, `skill-store`, `capability-store` `readDesk` ve `writeDesk` mimarisine taşındı.
   * `sovereign:identity` dinleyicileriyle oturum değişiminde in-memory cache temizliği sağlandı.
5. **SSR Hydration Güvenliği (`squad-tabs`, `skill-squad-tabs`, `capability-squad-tabs`, `graph-tabs`):**
   * `mounted` yaşam döngüsü eklenerek sunucu HTML çıktısı ile ilk istemci renderı `%100` eşitlendi, React ağaç yırtılması (hydration mismatch) çözüldü.
6. **Editör Kilitleri & "Clone to my desk" (İlk Paket):**
   * `AgentEditor`, `PackEditor`, `SkillEditor`, `ForgeFactory` ve `ToolControlPanel (ConfigDialog)` pencerelerine `ReadOnlyBanner` ve form kilitleme eklendi.

---

### 🛠️ 3. Hayata Geçirilen Nihai Mimari Çözümler (Phase 62 İcra Raporu)

1. **Grup & Efektif Rol Omurgası (`actor.mjs` & `identity.mjs`):**
   * Kullanıcıların `app_users.groups` içindeki grup üyelikleri (`grp.administrators` vb.) ve şablon rolleri backend seviyesinde birleştirildi.
   * Ahmet gibi kullanıcılar grup üzerinden doğrudan SuperAdmin (`role: 'admin'`, `isSuperAdmin: true`) olarak tanınmaktadır.
   * `GET /api/identity/context` tek yetki kaynağı ucu hayata geçirildi.
2. **Sıfır-Tolerans İstemci Görünürlük Koruması (`ownership.ts`):**
   * Eski prototip kalıntısı `!readEnforcement()` açığı tamamen kaldırıldı. `override` sadece SuperAdmin'e (`isGodPrincipal`) bağlandı. Normal kullanıcılar (`deneme`) Admin'in private nesnelerini kesinlikle göremez.
3. **Modallarda Saf Kurumsal Read-Only Standartı (Asset Sprawl Tasfiyesi):**
   * Bütün modallardan kafa karışıklığı ve kopya çöplüğü yaratan "Clone to my desk" ve "Save as" mekanizmaları tamamen tasfiye edildi.
   * Salt-okunur pencereler (`AgentEditor`, `PackEditor`, `SkillEditor`, `ClientDialog`, `TargetDialog`, `PlannerDialog`, `ForgeFactory`) açıldığında:
     * Sarı `ReadOnlyBanner` gösterilir.
     * Tüm inputlar, slider'lar, switch'ler, toggle'lar, dropdown'lar ve picker'lar tamamen kilitlenir (`disabled={!writable}`, `pointer-events-none`).
     * Save ve Delete butonları gizlenir; pencerede yalnızca temiz bir **"Close"** seçeneği yer alır.
     * Yeni bir nesne oluşturmak isteyen operatör ana menüdeki `+ New` butonunu kullanarak sıfırdan kendi masasına ait nesneyi yaratır.
4. **Forge Factory & Tools İzolasyonu (`forge-store.ts`, `factory.tsx`):**
   * Yeni oluşturulan araçların zorla `workspace` yapılması engellendi, varsayılan görünürlük sıfır-güven kuralı gereği `private` yapıldı.
   * `ForgeFactory` içindeki 4 sekmenin tamamı salt-okunur modda mühürlendi; kırmızı Delete ve gereksiz Duplicate butonları kaldırıldı.
5. **MCP Server Gateway Şablon Yetkilendirmesi (`user-template-store.ts`, `shell.tsx`, `mcp.tsx`, `mcp.mjs`):**
   * Sabit kodlu kontroller yerine `mcpServer` yetkisi şablon (`GrantKey`) ve SuperAdmin yetkisine bağlandı.
   * Şablonunda bu izin olmayan kullanıcılarda sekme tamamen gizlenir, doğrudan `MCP Client` sekmesine yönlendirilir. Backend uçları `canManageMcpServer` ile zırhlandı.
6. **Çoklu Kiracılı Model Dağıtımı & BYOM (`models` tablosu, `models.mjs`, `users.tsx`):**
   * `models` tablosuna `is_global`, `tenant_id`, `owner_id` ve `visibility` sütunları eklendi.
   * Tenant düzenleme kartına "Allowed AI Models (Model Entitlement)" eklendi. SuperAdmin tenant bazlı model tahsisi yapabilir.
   * Tenant Admin'ler kendi modellerini ekleyebilir (`is_global = false`, `tenant_id = ctx.tenantId`), ancak global sistem modellerini değiştiremez veya silemez.
7. **Şablon Kayıt ve Veritabanı Kalıcılığı (`app_templates`, `identity-templates.mjs`, `users.tsx`):**
   * `app_templates` tablosuna eksik `tenant_id` ve `is_global` sütunları eklendi (şablon ekleme hatası çözüldü).
   * `POST` ve `PUT` uçları upsert destekli hale getirildi.
   * Arayüzdeki `SaveButton` doğrudan `update(active.id, active)` API çağrısına bağlandı.
8. **RBAC Menü ve Alt Sekme Senkronizasyonu (`rbac-store.ts`, `shell.tsx`):**
   * RBAC matrisi doğrudan **"Governance Settings"** başlığı altında toplandı; yapay "Studio" veya karmaşık ara isimler tamamen temizlendi.
   * Sol menüdeki `Settings`, kullanıcının yetkili olduğu ilk alt modüle (`/converter` vb.) akıllı yönlenecek şekilde bağlandı.
   * Reporting alt sekmeleri RBAC yetkisine (`access.allows`) bağlandı.
9. **Sol Menü Akordeon Bütünlüğü & Varsayılan Görünüm (`shell.tsx`):**
   * `Chats` ve `More` gruplarının sol menüdeki varlığı korundu; `Chats` varsayılan olarak açık (`persistedGroups = { core: true, chats: true }`) ayarlanarak açılışta anında sohbet listesinin görünmesi sağlandı.
10. **Pimli ve Geçmiş Sohbetlerin Dinamik Kurtarılması & İstemci Kimlik Başlıkları (`threads.mjs`, `chat-api.ts`, `api.ts`):**
   * **Backend Filtresi:** Koda hiçbir sabit kullanıcı adı (hardcode) yazılmadan, SuperAdmin (`ctx.isSuperAdmin`) için dinamik yetkiyle geçmiş/root admin (`00000000-0000-0000-0000-000000000000`) ve sahipsiz kayıtların görünmesi sağlandı. Normal operatörlerin (`deneme`) sadece kendi sohbetlerini görme (`owner_id = ANY(userMatches)`) sıfır-güven kuralı korundu.
   * **İstemci Transport Keşfi & Onarımı (`chat-api.ts`):** `chat-api.ts` içerisindeki `call()` fonksiyonunun `fetch('/api/threads')` çağrısını tarayıcıdaki `localStorage` oturum başlıkları (`x-session-id`, `x-user`) olmadan yalın/anonim gönderdiği tespit edildi. `src/lib/api.ts` altında merkezi `authHeaders()` motoru kurularak tüm chat isteklerine oturum başlığı enjekte edildi.
   * **Kurtarılan Sohbetler:** Kullanıcının test için gönderdiği son mesaj (`chat_1789430506295` - "Selam") ve önceki tüm pimli sohbetleri (`chat_1788085886542` ve `chat_1789389080259`) hem veritabanında hem de API/UI seviyesinde eksiksiz ayağa kaldırıldı.
11. **360° Uçtan Uca Granüler Alt Sekme (Sub-Tabs) RBAC Standardizasyonu (`rbac-store.ts`, `shell.tsx`, `rbac.tsx`, PostgreSQL):**
   * Tüm sistemdeki alt sekmeler (MCP Server / Client, System Engine Intent Router / Orchestrator Bridge, Adapters / Webhooks, Memory katmanları, Planner düzlemleri, Knowledge yüzeyleri, Policy yüzeyleri, Users & Groups sekmeleri) taranarak RBAC kapsamına dahil edildi.
   * **Toplam Kapsam:** 7 grup altında tam **69 sekme (Tabs)** ve 11 aksiyon fiili (Action Verbs) olarak normalize edildi.
   * **Admin Sovereign Mührü:** Admin rolü hem veritabanında (`app_roles`) hem de istemci state motorunda 69/69 tam sekme ve 11/11 tam eylem fiiliyle mühürlendi; hiçbir eksik veya işaretsiz kutu kalmadı.
   * **Dinamik Modül Sekmeleri:** `shell.tsx` içindeki `ModuleTabs` tüm alt sekmeleri RBAC yetkisine (`access.allows`) bağlayarak kullanıcının yetkili olmadığı alt sekmeleri filtreleyen sıfır-sızıntı korumasını sağladı.
12. **Templates Mimarisi Konsolidasyonu & Performans Devrimi (`user-template-store.ts`, `users.tsx`):**
   * Şablon sayfasındaki backend karşılığı olmayan, RBAC ile çakışan ve sahte güvenlik yaratan 22 adet atıl "Allowed X" kartı tasfiye edildi.
   * **5 Çekirdek Kurumsal Yetki Mühürlendi:** Bound RBAC Roles, Allowed AI Models, LLM Providers, Allowed Knowledge Spaces, MCP Server Gateway.
   * `useGrantSources()` içindeki 19 ölü hook ve store dinleyicisi temizlendi; `TemplatesTab` arayüzündeki render darboğazı ve gecikmeler tamamen ortadan kaldırıldı.
   * Kullanıcı ayarlarındaki (`/account` -> Model Preferences) self-service delegasyon bağlantısı ve FinOps parametreleri %100 korundu.
13. **Temel Rol & Grup Silme Koruması ve RBAC Esneklik Mührü (`identity-groups.mjs`, `rbac-store.ts`, PostgreSQL):**
   * **Silinmezlik Zırhı:** Temel sistem rolleri (`Admin`, `Engineer`, `Operator`, `Security`, `Viewer`) ve temel gruplar (`Administrators`, `Operators`, `Auditors`) hem backend API'sinde HTTP 400 ile hem de arayüzde `<Lock size={12} /> SYSTEM GROUP / SYSTEM ROLE` kilitleriyle silinemez olarak mühürlendi.
   * **`isSovereign` Regex Düzeltmesi:** Eski regex `/\badmin\b/i` içinde "Admin" kelimesi geçen her rolü (Örn. "Tenant Admin", "Junior Admin") zorla SuperAdmin zannedip tüm sekmeleri kilitliyordu. Regex düzeltildi; artık yalnızca gerçek SuperAdmin (`admin`, `super admin`, `sovereign`) sovereign olarak değerlendirilmektedir.
   * **Tenant Admin Rolünün Kaldırılması:** Kullanıcının talimatı doğrultusunda sistemde önceden oluşturulmuş yapay `tenant-admin` rolü, şablonu ve grubu veritabanından tamamen silindi. RBAC sistemi esnek bırakıldı; operatör istediği zaman yeni rol ekleyip dilediği sekmeleri serbestçe seçebilecektir.
   * `elara-middleware` ve `elara-vite` servisleri yeniden başlatıldı, derleme sıfır hatayla doğrulandı.

---

### ⚠️ 4. Şu Anki Durum Analizi

1. **Sohbet ve Menü Krizi Çözüldü:** Pimli sohbetlerin kaybolma sorunu, istemci `authHeaders` aktarımı ve sol menü akordeonlarının (`More`, `Chats`) durumu tamamen düzeltildi ve API seviyesinde test edildi.
2. **RBAC & Şablonlar Mühürlendi:** RBAC 69 sekme ve 11 eylem fiiliyle normalize edildi, Admin 69/69 olarak mühürlendi. Şablonlardaki 22 atıl kart ve 19 ölü hook temizlenerek 5 çekirdek yetki kartına indirgendi.
3. **Temel Rol ve Gruplar Kilitlendi:** Administrators, Operators, Auditors ve sistem rolleri silinmeye karşı kilitlendi. `isSovereign` regex'i sadece gerçek SuperAdmin'e sınırlandı.
4. **Kritik Tespit Edilen Sızıntı Alanı (Secondary Assets & Desk Isolation Gap):**
   * Varlık bazlı visibility uygulanan yerler (`agents`, `skills`, `tools`, `workflows`, `orchestrations`, `planners`, `models`, `chat_threads`) kusursuz çalışırken; mülkiyet/visibility uygulanmayan yan modüllerde (`adapters`, `targets`, `webhooks`, `vault_secrets`, `isolation_profiles`) Admin'in özel nesneleri `deneme` kullanıcısına sızmaktadır.

---

### 🛡️ 5. COMPLETED — PHASE 62.2 / PHASE 63: 360° ZERO-TRUST DESK ISOLATION & SECONDARY ASSET SEAL

**Tarih:** 2026-09-15  
**Durum:** %100 Tamamlandı & Doğrulandı (0 Veri Sızıntısı Kanıtlandı)

#### 🎯 1. İlke ve 3 Seviyeli Altın Kural (The 3-Tier Hierarchy)
1. **1. Seviye — SüperAdmin (Founder/God):** Bütün sistemi, tüm kiracıları ve tüm operatörlerin masalarını tam yetkiyle görür ve yönetir (`1=1`).
2. **2. Seviye — TenantAdmin:** Kendi tenant'ındaki tüm operatörlerin nesnelerini tam denetler (`tenant_id = ctx.tenantId` + `is_global = true`).
3. **3. Seviye — Normal Kullanıcı / Operatör (`deneme`):**
   * Sadece kendi oluşturduğu (`mine: owner_id = ctx.userId`),
   * Kendisine/grubuna atanmış (`shared: shared_with ? group`),
   * Çalışma alanına açıkça devredilmiş (`workspace`),
   * Sistemin ortak çekirdek şablonlarını (`is_global = true` veya `fallback = true`) görür.
   * **Admin'in veya başka bir operatörün kişisel/özel (`private`) hiçbir varlığını ASLA göremez.**

---

#### 🔍 2. Tamamlanan Kök Çözüm ve Mimari Müdahaleler

1. **Webhooks (`webhooks` tablosu & `webhooks-crud.mjs` & `webhook-store.ts`):**
   * Varsayılan oluşturma görünürlüğü `workspace` yerine `private` yapıldı.
   * Mevcut admin özel webhook'ları `private` olarak mühürlendi.
   * `buildVisibility(ctx, 1, 'owner_id')` filtresi backend'de tam uygulandı; `webhook-store.ts` üzerinde `scopeOwned` süzgeci bağlandı.
   * **Doğrulama Sonucu:** Admin 2 webhook görürken, `deneme` 0 webhook görerek temiz kişisel masa elde etti.
2. **Targets / Envanter (`targets` tablosu & `targets-crud.mjs` & `target-store.ts` & `targets.tsx`):**
   * `targets` tablosuna `visibility visibility_level NOT NULL DEFAULT 'private'` ve `shared_with jsonb` sütunları eklendi.
   * `targets-crud.mjs` içindeki `OR tenant_id = 'default'` kaldırıldı; `buildVisibility(ctx, 1, 'owner')` bağlandı.
   * `mappedTargets` içine `ownerId`, `ownerName`, `visibility`, `sharedWith` eşlendi.
   * `targets.tsx` üzerinde `canSee(t, ownerCtx)` filtresi bağlandı.
   * **Doğrulama Sonucu:** Admin 1 hedef görürken, `deneme` 0 hedef gördü. `deneme` tarafından yeni hedef yaratıldığında yalnızca `deneme`'nin masasında listelendi ve SuperAdmin tarafından görülebildi.
3. **Adaptörler (`adapters` tablosu & `adapters.mjs` & `adapter-store.ts` & `adapters.tsx`):**
   * `adapters` tablosuna `owner_id text`, `visibility visibility_level NOT NULL DEFAULT 'private'` ve `shared_with jsonb` sütunları eklendi.
   * `adapters.mjs` içine `buildVisibility(ctx, 1, 'owner_id')` bağlandı; `owner_id`, `visibility`, `shared_with` geri döndürüldü.
   * `adapter-store.ts` içindeki sahte `"org"` ve `"workspace"` atamaları kaldırılarak veritabanı mülkiyetine bağlandı.
   * `adapters.tsx` üzerinde `canSee(a, ownerCtx)` filtresi bağlandı.
   * **Doğrulama Sonucu:** Admin 2 adaptör görürken, `deneme` 0 adaptör gördü.
4. **Secret Vault (`vault_secrets` tablosu & `vault.mjs` & `vault-store.ts` & `policy.tsx`):**
   * `requireSession` rolleri `["admin", "engineer", "operator", "security"]` olarak genişletildi.
   * Sır oluşturulurken `meta.owner_id` ve `meta.visibility = 'private'` damgalandı.
   * `GET /api/vault` sorgusunda SuperAdmin `1=1` ile tüm sırları görürken; `deneme` kullanıcısı için `lower(meta->>'owner_id') = ANY(userMatches)` + genel sistem sırları (`s.is_global = true OR s.scope = 'system'`) sınırlandırıldı.
   * Mevcut test sırları (`denem1`, `denem2` vb.) admin kullanıcısına zimmetlendi.
   * `policy.tsx` üzerinde `visibleVaultItems` `scopeOwned` süzgecinden geçirildi.
   * **Doğrulama Sonucu:** Admin 10 secret görürken, `deneme` 0 secret görerek tam sızıntısız desk elde etti.
5. **İzolasyon Profilleri (`isolation_profiles` tablosu & `security-policies.mjs` & `policy.tsx`):**
   * `isolation_profiles` tablosuna `owner_id text`, `visibility visibility_level NOT NULL DEFAULT 'private'` ve `shared_with jsonb` sütunları eklendi.
   * `OR tenant_id = 'default'` temizlendi. Sistem varsayılanları (`fallback = true` / `is_global = true`) ortak bırakıldı; özel profiller (`iso.test`) yazarına izole edildi.
   * `policy.tsx` üzerinde tool, skill ve mcp izolasyon profilleri `scopeOwned` ile senkronize edildi.
   * **Doğrulama Sonucu:** Admin 3 profil (`miso.01`, `siso.01`, `iso.test`) görürken, `deneme` sadece 2 sistem varsayılanını (`miso.01`, `siso.01`) gördü; Admin'in `iso.test` profili `deneme`'ye kesinlikle sızmadı.
6. **Python Runtimes (`runtimes` tablosu & `python-crud.mjs` & `runtime-store.ts` & `runtime.tsx`):**
   * `runtimes` tablosundaki sahipsiz kayıtlar admin'e zimmetlendi (`owner_id = admin`, `visibility = 'private'`).
   * `python-crud.mjs` içindeki `OR tenant_id = 'default'` kaldırıldı; `buildVisibility(ctx, 1, 'owner_id')` bağlandı.
   * `runtime-store.ts` nesnelerine `ownerId`, `ownerName`, `visibility`, `sharedWith` eşlendi.
   * `runtime.tsx` üzerinde `scopeOwned(runtimes, ownerCtx)` filtresi bağlandı.
   * **Doğrulama Sonucu:** Admin 2 runtime (`deneme6` ve `test3`) görürken, `deneme` 0 runtime gördü. `deneme` yeni bir runtime oluşturduğunda (`deneme_own_runtime`) sadece `deneme`'nin masasında listelendi; Admin tümünü gördü.
7. **GenGuard, Policy Engine & Signed Workflows (`guard_rules`, `policy_rules`, `signed_artifacts` & `security-policies.mjs` & `security-store.ts` & `policy.tsx`):**
   * `guard_rules`, `policy_rules` ve `signed_artifacts` tablolarına `owner_id text`, `visibility visibility_level NOT NULL DEFAULT 'private'` ve `shared_with jsonb` eklendi. Mevcut admin kuralları `owner_id = admin` ve `visibility = 'private'` yapıldı.
   * `security-policies.mjs` içinde `GET /api/security/genguard`, `GET /api/security/policy`, `GET /api/security/signed` sorgularına `buildVisibility(ctx, 1, 'owner_id')` bağlandı.
   * `security-store.ts` içindeki `if (rows.length === 0) setItems(seed)` sahte mock veri enjeksiyonu tamamen kaldırıldı (sıfır-mock standardı).
   * `policy.tsx` içinde `guard`, `engine` ve `signed` listeleri `scopeOwned` süzgecine bağlandı.
   * **Doğrulama Sonucu:** Admin GenGuard'da 1 kural (`gg.lk1la`), Policy Engine'de 1 kural (`pol.route.coding`) görürken; `deneme` 0 kural görerek temiz desk elde etti. `deneme` yeni kural yarattığında sadece kendi masasında göründü; Admin ise her iki kuralı da gördü.
8. **İzolasyon İsim Standardizasyonu & Meta-Forge Sovereign Sıfırlama Kilidi (`meta-forge.tsx`, `isolation_profiles`):**
   * Tool İzolasyonundaki eksik sistem çekirdek profili (`iso.01` - `Default tool sandbox`, `fallback = true`, `is_global = true`) veritabanına eklendi ve tüm profiller standartlaştırıldı (`Default tool sandbox`, `Default skill sandbox`, `Default MCP client sandbox`).
   * `CrudSection` bileşeninde sistem fallback profillerindeki yanıltıcı kırmızı "Delete" butonu kaldırılarak `<Lock /> SYSTEM DEFAULT` etiketi getirildi.
   * Meta-Forge evrim defteri sıfırlama butonu (`reset ledger`), `meta-forge.tsx` arayüzünde sadece `SuperAdmin` (`ownerCtx.sovereign`) için görünür kılındı.
9. **Kurumsal Kimlik Hijyeni & Root Admin Koruma Mührü (`identity.mjs`, `identity-groups.mjs`, `identity-roles.mjs`, `identity-templates.mjs`, `users.tsx`):**
   * **Root Admin Dokunulmazlığı:** Birincil sistem yöneticisinin (`00000000-0000-0000-0000-000000000000` / `admin`) kazara veya bilerek silinmesi hem backend'de HTTP 400 ile engellendi hem de UI üzerinde kırmızı Delete butonu kaldırılarak `<Lock /> SYSTEM ROOT ADMIN` mührü yerleştirildi.
   * **Self-Deletion Kilidi:** Giriş yapmış olan bir yöneticinin kendi aktif hesabını silmesi engellendi (`<Lock /> ACTIVE ACCOUNT`).
   * **Oturum İptali:** Bir kullanıcı silindiğinde `app_sessions` tablosundaki aktif oturumları anında düşürülmektedir.
   * **Şablon & Rol Öksüz Temizliği:** Silinen bir şablona bağlı kullanıcı ve grupların `template_id` alanı güvenle temizlenir (`NULL`); silinen özel bir role sahip kullanıcı ve gruplar otomatik olarak temel `Viewer` rolüne devredilir.
   * **Grup Tasfiyesi:** Silinen özel gruplar, kullanıcıların `app_users.groups` JSON dizilerinden otomatik olarak ayıklanır.
10. **Fleet Telemetry, Runtime Monitor Sızıntı Kapatma & Granüler RBAC Alt Sekmeleri (`telemetry.mjs`, `telemetry-card-tabs.tsx`, `fleet.tsx`, `rbac-store.ts`, `app_roles`):**
   * **Runtime Monitor Sızıntısının Kökten Kesilmesi:** `/api/telemetry/agent-status` sorgusundaki tüm ajan, iş akışı, orkestrasyon, yetenek ve adaptör seçimlerine `buildVisibility(ctx, 1, 'owner_id')` bağlandı. Admin 26 varlık izlerken, `deneme2` 0 varlık görerek Runtime Monitor çekmecesinde sıfır sızıntı kanıtlandı.
   * **Deploy Streams Modal İzolasyonu:** `src/routes/fleet.tsx` içerisindeki `catalog` seçicisine `scopeOwned` süzgeci bağlanarak, normal operatörün yayın akışına ekleme modalında Admin'in özel ajanlarını (`Arastirmaci Ajan`, `X2_Agent` vb.) görmesi engellendi.
   * **Telemetry Boards İzolasyonu:** `/api/telemetry/boards` uç noktasına `buildVisibility` filtresi bağlandı; `tb.agents` sistem varsayılan kartı silinmeye karşı korundu.
   * **Fleet Telemetry Granüler RBAC Sub-Tab Mimarisi:** Monolitik `fleet` kapsamı, diğer tüm modüllerimizde olduğu gibi 4 ayrıntılı alt sekmeye (`fleet-general`, `fleet-operators`, `fleet-database`, `fleet-agents`) ayrıldı. `telemetry-card-tabs.tsx` ve `FleetView` yetki kontrolüyle mühürlendi. `app_roles` tablosundaki `admin` (tüm 4 sekme) ve `engineer` (`fleet-general`, `fleet-agents`) rolleri güncellendi.
1424	11. **Sistem Doğrulaması:**
   1425	   * `npx tsc --noEmit` 0 hata ile doğrulandı.
   1426	   * `elara-middleware.service` ve `elara-vite.service` aktif çalışıyor.
   1427	
   1428	---
   1429	
   1430	### 🛡️ 6. COMPLETED — PHASE 64: RBAC GRANULAR SUB-TAB HYGIENE & SUPERADMIN SYSTEM ROLE UNLOCKING
   1431	
   1432	**Tarih:** 2026-09-15  
   1433	**Durum:** %100 Tamamlandı, Doğrulandı & Mühürlendi (Zero Leaks, 100% Granular RBAC)
   1434	
   1435	#### 🎯 1. Ele Alınan Sorunlar ve Kök Neden Analizi
   1436	1. **SuperAdmin Sistem Rollerini Düzenleyememe Sorunu:**
   1437	   * **Tespit:** Backend (`identity-roles.mjs:74-76`) SuperAdmin için sistem rollerinin (`is_system = true`) güncellenmesine izin verirken; UI (`rbac.tsx:51`) ve Store (`rbac-store.ts:793, 807, 819`) doğrudan `role.system` kontrolü yaparak tüm butonları ve kutuları SuperAdmin dahil herkese kilitliyordu.
   1438	   * **Çözüm:** Root `admin` rolü (Sovereign) salt-okunur ve tam yetkili tutularak korunurken; diğer yerleşik roller (`engineer`, `operator`, `security`, `viewer`) SuperAdmin (`ownerCtx.sovereign`) için düzenlenebilir hale getirildi (`locked = isSovereign(role) || (role.system && !isSuperAdmin)`). TenantAdmin'ler için kilit korunmuştur.
   1439	2. **Menü & Alt Sekme Sızıntısı (`deneme2` — Engineer):**
   1440	   * **Tespit 1 (DB Kirliliği):** `app_roles` tablosundaki rollerde eski monolitik adlar (`engine`, `users`, `policy`, `knowledge`, `memory`, `planner`, `mcp`, `fleet`) kalmıştı. Bu kelimeler arayüzdeki granüler kutularla eşleşmediği için RBAC sayfasında işaretsiz (boş) gözüküyordu.
   1441	   * **Tespit 2 (Store Bypass):** `access.allows(scope)` fonksiyonu, parametre olarak gelen granüler sekme adını (`engine-intent` vb.) URL yolları listesinde bulamadığında fonksiyonun sonundaki `return true;` fallback'ine düşerek izin veriyordu. Ayrıca `shell.tsx` içinde `|| access.allows("engine")` gibi geriye dönük miras kontroller tüm alt sekmeleri açıyordu.
   1442	   * **Çözüm:**
   1443	     - Veritabanındaki tüm roller (`app_roles`) temizlendi; monolitik kelimeler elenerek tam 72 granüler sekme şemasına uyarlandı.
   1444	     - `access.allows` yeniden kodlandı: Zero-Trust kuralı gereği, hedef bir `TabScope` ise doğrudan `scopes.has(target)` kontrolü yapılır; yetkisiz veya tanınmayan hiçbir rota/sekme için varsayılan `true` dönülmez (`return false`).
   1445	     - `shell.tsx`, `telemetry-card-tabs.tsx` ve `fleet.tsx` içerisindeki tüm `|| access.allows("xxx")` monolitik fallback'leri kaldırıldı.
   1446	     - Tüm alt sayfalar (`engine.tsx`, `policy.tsx`, `users.tsx`, `knowledge.tsx`, `planner.tsx`, `memory.tsx`, `mcp.tsx`, `adapters.tsx`) alt sekmelerini RBAC granüler yetkilerine bağladı. Yetkisiz alt sekmeler seçildiğinde güvenli ilk sekmeye yönlendirme sağlandı; hiçbir yetkisi olmayan modüllerde ise `Shell` `<ScopeDenied>` ekranı devreye girdi.
   1447	4. **Preview Modu Simülasyon Kök Düzeltmesi (`shell.tsx`, `telemetry-card-tabs.tsx`, `fleet.tsx`):**
   1448	   * **Tespit:** `PREVIEW AS ENGINEER` butonuna basıldığında üstte sarı banner çıkmasına rağmen sol menü ve sekmeler değişmiyordu. Çünkü `shell.tsx` içindeki `isAdmin = ownerCtx.sovereign` değişkeni, giriş yapan oturum Admin olduğu için her zaman `true` kalıyor ve `isAdmin || access.allows(...)` kontrolü yüzünden preview edilen rol filtreleri tamamen baypas ediliyordu.
   1449	   * **Çözüm:** `isAdmin = !access.previewing && ownerCtx.sovereign` olarak güncellendi. Önizleme modundayken stüdyo Admin yetkisini değil, simüle edilen rolün gerçek yetkilerini yansıtır. Sol menü ve üst sekmeler anında seçilen role göre dinamik olarak filtrelenir; `/` ve `/rbac` sayfaları ise yöneticinin önizlemeden çıkabilmesi (`EXIT PREVIEW`) için açık kalır.
   1450	5. **RBAC Sayfası Scroll Çözümü (`rbac.tsx`, `shell.tsx`):**
   1451	   * **Tespit:** Flexbox içerisindeki percentage height (`h-full`) CSS hesaplama kısıtı nedeniyle `overflow-y-auto` tetiklenmiyordu ve alttaki `REPORTING` grubu taşarak kesiliyordu.
   1452	   * **Çözüm:** `rbac.tsx` sarmalayıcısı `absolute inset-0 overflow-y-auto` konteynerine geçirildi; `main` konteynerine `overflow-hidden` verildi. Sayfa artık her ekranda sorunsuz, kaydırma çubuğuyla en alta kadar akıcı şekilde kaymaktadır.
   1453	6. **Eylem Fiilleri (Action Verbs) 360° Denetimi & Entegrasyonu:**
   1454	   * `write`: `src/lib/ownership.ts` içindeki `canEdit` fonksiyonuna `readCan("write")` kontrolü bağlandı. Bu fiile sahip olmayan roller nesneleri düzenleyemez (salt-okunur kalır).
   1455	   * `delete`: `canDelete` ve `deleteRefusal` kontrolleri `readCan("delete")` ile mühürlendi.
   1456	   * `vault`: `policy.tsx` içindeki `MaskedValue` bileşeni `access.can("vault")` yetkisine bağlandı; yetkisi olmayan roller sırları unmask edemez.
   1457	   * `export`: `report-kit.tsx` içindeki `ExportButton` `access.can("export")` yetkisine bağlandı; yetkisiz rollerde buton devre dışı kalır.
   1458	   * `approve`: `approver-gate.ts` ve `approvals.tsx` içindeki onay döngüsü `canApprove` ile doğrulanır.
   1459	   * `plan-execute`: `planner.tsx` içinde aktif icra yetkisi olarak bağlanmıştır.
   1460	   * `rag-ingest`: `rag-documents.tsx` içinde döküman yükleme izni olarak bağlanmıştır.
   1461	   * `workspace-all`: `ownership.ts` içinde başkalarının masasını görme yetkisi olarak mühürlenmiştir.
   1462	7. **Kullanıcı & Şablon E2E Veritabanı Uyumluluğu (`identity.mjs`, `identity-templates.mjs`, `users.tsx`):**
   1463	   * **Şablon Sütun-JSONB Senkronizasyonu:** `app_templates` tablosuna yapılan kayıtlarda `grants` ve `params` JSONB blokları doğrudan DB sütunlarıyla (`allowed_providers`, `allowed_skills`, `allowed_tools`, `system_prompt`, `temperature`, `top_p`, `max_tokens`) senkronize edildi. Böylece bu sütunları sorgulayan alt servisler (`policy-cache.mjs`, `skills.mjs`) ile UI tam uyumlu hale getirildi.
   1464	   * **Kullanıcı Şablon Atama Temizliği:** Kullanıcı şablonunu kaldırdığında (`templateId = ""`), DB'de boş metin yerine `NULL` yazılması sağlandı ve `app_template_assignments` tablosundaki yetim eski atamalar temizlendi.
   1465	   * **Kullanıcı Kaydet Butonu:** Formdaki `[Save]` butonunun sadece parola kutusu doluyken çalışması sorunu giderildi; butona basıldığında tüm kullanıcı konfigürasyonu canlı API ile güncellenip görsel bildirim (`Account saved`) verilmektedir.
   1466	   * **Şablon Kalıtım Etiketi & Dinamik Alt Başlıklar:** Ne kullanıcıda ne de grupta şablon yokken yanlışlıkla "INHERITED FROM GROUP" yazması düzeltilerek "NO TEMPLATE BOUND" etiketine geçirildi. Header'daki statik sayaçlar ("4 provisioning templates", "18 operators") gerçek DB kayıt sayılarıyla dinamikleştirildi.
   1467	8. **Kod Temizliği & Standartizasyon:**
   1448	   * UI ve Store dosyalarındaki (`chat-store.ts`, `context-compact.functions.ts`, `composer.tsx`, `model-group-tabs.tsx`) Türkçe yorum satırları ve tarayıcı uyarıları tamamen temizlenerek profesyonel İngilizce standartlarına getirildi.
   1449	
   1450	#### 📊 2. Doğrulama & Test Sonuçları
   1451	* `npx tsc --noEmit` çalıştırıldı: **0 hata**.
   1452	* `curl` ve DB simülasyonları: `deneme2` kullanıcısı için `/engine`, `engine-intent`, `engine-bridge`, `/users`, `/policy`, `/knowledge`, `/memory`, `/planner`, `/mcp` rotaları kesinlikle **false** döndü; sol menüden kalktığı ve doğrudan erişildiğinde engellendiği kanıtlandı.
   1453	* SuperAdmin'in `engineer` rolünü güncellemesi test edildi ve başarıyla veritabanına işlendi.
   1474	* `elara-middleware.service` ve `elara-vite.service` hatasız şekilde yeniden başlatıldı ve aktif durumda.
   1475	
   1476	---
   1477	
   1478	### 🛡️ 7. COMPLETED — PHASE 65: TEMPLATE DE-DUPLICATION, GROUP E2E PERSISTENCE & ZERO-MOCK COMPLIANCE
   1479	
   1480	**Tarih:** 2026-09-15  
   1481	**Durum:** %100 Tamamlandı & Doğrulandı (Tüm Mocklar Temizlendi, E2E Veritabanı Mührü)
   1482	
   1483	#### 🎯 1. Hayata Geçirilen Temizlik ve Standartizasyonlar
   1484	1. **Şablon (Template) Tarafındaki Mükerrer ve Riskli Alanların Tasfiyesi:**
   1485	   * **Bound RBAC Roles Kaldırıldı:** Şablonun gizlice kullanıcı rolünü ezmesi ve yetki yükseltme (Privilege Escalation) açığı yaratması engellendi. `local-server/lib/actor.mjs` içindeki şablondan rol türetme hattı söküldü; roller sadece doğrudan kullanıcı ve grup aidiyetinden beslenir.
   1486	   * **Allowed Knowledge Spaces Kaldırıldı:** Bilgi alanlarının kim tarafından sorgulanabileceği ve güncellenebileceği zaten doğrudan `Access Spaces` modülü (`readerGroups`, `readerUsers`, `contributorGroups`, `contributorUsers`, `everyone on/off`) tarafından granüler olarak yönetilmektedir. Şablondaki mükerrer ve ölü alan temizlendi.
   1487	   * **MCP Server Gateway Kaldırıldı:** MCP sunucu açma izni bir çıkarım parametresi değil, RBAC tabı (`mcp-server`) ve aksiyon fiilidir (`isolation`). Şablondan çıkarıldı.
   1488	   * **Chat Template (Legacy) & Custom Parameters Kaldırıldı:** Model tokenizer özel formatı modelin kendi kartında belirlenir; şablondan model formatı bozma riski elendi. Backend tarafından hiç tüketilmeyen `custom` parametreleri kaldırıldı.
   1489	   * **Kalan Saf Şablon Amacı:** Şablon artık yalnızca saf bir AI Kaynak ve Tüketim Politikasıdır (İzinli AI modelleri/sağlayıcıları, hiperparametre tavanları, bütçe/hız limitleri, bellek sıkıştırma politikası ve self-service kullanıcı delegasyonu).
   1490	2. **Grup (Group) Yönetimi Uçtan Uca Kalıcılık:**
   1491	   * `GroupsTab` içindeki `[Save]` butonuna `updateGroup(active.id, active)` çağrısı ve toast bildirimi bağlandı.
   1492	   * `identity-groups.mjs` içinde hem `role`/`default_role`, hem `template_id`/`default_template`, hem `tenant_id` hem de `app_groups.members` kolonları `app_users.groups` dizisiyle %100 çift yönlü senkronize edildi.
   1493	3. **RBAC Compliance Sayfası Sıfır-Mock Dönüşümü:**
   1494	   * `COMPLIANCE` altındaki 5 adet sabit mock string tamamen silindi.
   1495	   * Tüm kontroller (`chk.privileged-accounts`, `chk.orphan-grants`, `chk.least-privilege`, `chk.idp-coverage`, `chk.session-policy`) veritabanındaki gerçek `accounts`, `groups`, `roles`, `templates` durumuna göre gerçek zamanlı dinamik hesaplanmaktadır.
   1496	   * Sahipsiz operatörler (@operator-g3vn vb.) ve rol kaymaları (@deneme, @deneme2) gerçek durumlarıyla ekrana yansıtılmaktadır.
   1497	4. **Identity Omurga Güvenliği & Oturum Yaşam Döngüsü (Phase 66):**
   1498	   * **x-session-id Username Sahte Giriş Açığı Kapatıldı:** `session-gate.mjs` içindeki `WHERE lower(username) = lower(sid)` prototip kalıntısı tamamen silindi. Sadece doğrulanmış `app_sessions` kayıtları kabul edilir.
   1499	   * **x-user Header Spoofing Engellendi:** `actor.mjs` içinde dışarıdan gelen keyfi `x-user` başlıkları devre dışı bırakıldı; aktör tespiti yalnızca doğrulanmış `req.session.username` veya yerel loopback üzerinden yapılır.
   1500	   * **Canlı Hesap Kilitleme (Lockout) & Süre Aşımı:** `session-gate.mjs` her istekte kullanıcının `locked`, `status` ve `valid_until` durumunu kontrol eder. Kilitlenen veya süresi dolan hesapların açık olan aktif oturumları derhal veritabanından silinerek erişimleri anında kesilir; `login` uç noktası kilitli hesaplara girişi engeller.
   1501	   * **Oturum Tasfiyesi Standardizasyonu:** `GET /api/sessions` rotasında kullanıcıları 5 dakikalık hareketsizlikte dışarı atan `interval '5 minutes'` sorgusu, kurumsal 24 saatlik süreye (`interval '24 hours'`) çekildi.
   1502	5. **Attention Bell, Auth Providers & Audit Log Güvenlik Denetimi (Phase 67):**
   1503	   * **Attention Bell Akıllı Yönlendirme:** Zil açılır menüsünün altındaki link, yetkisi olmayan kullanıcılara `/mail` (ve dolayısıyla `<ScopeDenied>`) göstermek yerine; operatörün yetkisine göre `/approvals` ekranına ("view approval queue") akıllı fallback yapacak şekilde korundu.
   1504	   * **Settings -> Authentication Doğrulaması:** `auth_provider_sources` tablosu ile frontend senkronizasyonu tam doğrulandı. 12 sağlayıcı kaynağı doğrudan PostgreSQL üzerinde barınmakta ve konfigürasyon testleri (`/api/identity/auth-providers/test`) çalışmaktadır.
   1505	   * **Logs & Audit Purge Koruma ve Onay Modalı:** `Purge` butonu sadece SuperAdmin'e sınırlandı ve yanlışlıkla basılmasını önlemek için geri alınamaz kırmızı onay penceresi (`confirmAction`) bağlandı. CSV/NDJSON/TXT/PDF indirmeleri `export` eylem fiili ile mühürlendi.
   1506	6. **Bağımsız Web Search Engine Yüzeyi & Multi-Tenant İzolasyonu (Phase 68):**
   1507	   * **Altyapı Ayrıştırması:** Web arama motoru kulesi (`Web Search Engine Tower`), saf küme ve donanım paneli olan `/services` ekranından tamamen söküldü. Bağımsız `src/routes/web-search.tsx` rotasına taşındı.
   1508	   * **Multi-Tenant Veritabanı Şeması:** `search_providers` tablosuna `tenant_id`, `is_global`, `owner_id`, `visibility`, `shared_with` sütunları eklendi.
   1509	   * **Tool Dispatcher Öncelik Hiyerarşisi:** `tool-dispatcher.mjs` içindeki `sys_web_search` icra edilirken kullanıcının ait olduğu şirketin özel arama sağlayıcıları (`tenant_id = $1`) en yüksek öncelikle seçilir, yoksa küme genelindeki global sağlayıcıya (`is_global = true`) fallback yapar.
   1510	   * **Granüler RBAC Sekmesi:** RBAC `Governance Settings` altına `web-search` ("Web Search Engine") sekmesi eklendi; rotalar ve menüler `access.allows("web-search")` ile mühürlendi. PostgreSQL'deki Admin rolüne 73. sekme olarak tanımlandı. Artık TenantAdmin'ler altyapı ayarlarına dokunmadan sadece arama motoru sağlayıcılarını bağımsızca yönetebilir.
   1511	7. **Kayıt Bildirimi (Toast) Çiftleme Temizliği:**
   1512	   * `UsersTab` ve `GroupsTab` içindeki manuel `toast.success` çağrıları ayıklandı; bildirim kontrolü `SaveButton`'a devredilerek üst üste binen çift bildirim sorunu çözüldü.
   1513	8. **Tier 1 Küresel Altyapı Mührü (Phase 69 — 8-Modül SuperAdmin Koruması):**
   1514	   * **Tüm Altyapı Hatlarının SuperAdmin İle Kilitlenmesi:** Sistemdeki 8 ana altyapı modülü (`providers.mjs`, `system-config.mjs`, `infra.mjs`, `backup.mjs`, `system-certs.mjs`, `siem-api.mjs`, `mail-time.mjs`, `fleet-services.mjs`) standart `isSuperAdmin` (`isSuperAdminFromSession` & `resolveActorContext`) denetimine bağlandı.
   1515	   * **Tenant Yetki İhlali Engellendi:** Kendi şirketinde `role = 'admin'` olan bir `TenantAdmin` veya operatörün sunucunun fiziksel HA veritabanı URI'sini değiştirmesi, yedek indirmesi, SSL sertifikaları üretmesi, systemd servislerini durdurması veya küresel AI Gateway sağlayıcılarını manipüle etmesi kökten engellendi (HTTP 403 `super_admin_required`).
   1516	   * **Arayüzde Global Rozetleme:** `/settings` paneline `GLOBAL PLATFORM GATEWAY` rozeti yerleştirilerek buranın tenant düzeyi değil, platformun küresel çıkarım omurgası olduğu tescillendi.
   1517	9. **Multi-Tenant Raporlama & FinOps İzolasyon Mührü (Phase 70):**
   1518	   * **Tüm Raporlama Uç Noktalarına Tenant Süzgeci:** `usage`, `cost`, `operators`, `rag` ve `invoicing` uç noktaları `resolveReportingScope` motoruna bağlandı.
   1519	   * **B2B Faturalandırma & FinOps İzolasyonu:** `GET /api/reporting/invoicing` rotasındaki küme geneli şirket listesi sızıntısı kapatıldı. Bir kiracı giriş yaptığında yalnızca kendi şirketinin token defterini ve faturasını görebilir (`targetTenant = tenantId`).
   1520	   * **Operatör & RAG Telemetrisi İzolasyonu:** `GET /api/reporting/operators` ve `/api/reporting/rag` uç noktaları kiracı filtrelerine bağlandı. Normal operatörler ise yalnızca kendi kişisel kullanım metriklerini görebilir.
   1521	   * **SuperAdmin Küme Görünürlüğü Korundu:** SuperAdmin tüm şirketleri küresel olarak (`1=1`) raporlayabilmeye veya dilediği kiracıyı filtrelemeye devam eder.
   * **Ambiguous Status Sütunu & Scoping Onarımı:** `/api/reporting/overview` ve `/api/reporting/cost` SQL sorgularındaki belirsiz `status` sütun referansları `u.status` olarak nitelendirildi; `dailyRes` ve `storageRes` sorguları çoklu kiracı sınırlarına bağlandı (HTTP 500 hataları giderildi).
   1522	
   #### 📊 2. Nihai Sistem Doğrulaması
   * `npx tsc --noEmit`: **0 hata**.
   * `elara-middleware.service` ve `elara-vite.service`: Aktif ve operasyonel.
   * Tüm entegrasyon zinciri (Vite UI ↔ api-v2.mjs ↔ Workers ↔ PostgreSQL) uçtan uca mühürlendi.

   ---

   ## 🗺️ STRATEGIC ROADMAP: FAZ A, FAZ B, FAZ C (MAIN REFACTORING & CLEANUP PIPELINE)

   Bu yol haritası, ELARA Sovereign Studio'nun bir sonraki aşamasında izlenecek ana mühendislik protokolüdür.

   ### 🛡️ Kati İcra Kuralları & Metodoloji:
   1. **Asla Acele Yok, Sıfır Heyecan:** Hiçbir faz tek seferde veya toptan körlemesine çalıştırılmayacaktır.
   2. **Adım Adım İcra Protokolü (Step-by-Step Execution Protocol):**
      * **1. Aşama — Tespit & Keşif:** Önce hangi dosyada/tabloda neyin ölü, mükerrer veya standart dışı olduğu tam listelenecek.
      * **2. Aşama — Etki-Tepki Hesabı (Impact Analysis):** Değişikliğin UI (Vite) $\leftrightarrow$ API (`api-v2.mjs`) $\leftrightarrow$ Backend/Workers $\leftrightarrow$ DB (PostgreSQL) zincirine etkisi hesaplanacak.
      * **3. Aşama — Raporlama & Açık Onay:** Kullanıcıya (Levent İldeniz) detaylı rapor sunulacak; açık onay alınmadan TEK BİR DOSYA dahi silinmeyecek/düzenlenmeyecektir.
      * **4. Aşama — Cerrahi İcra & Doğrulama:** Onay sonrası değişiklik uygulanacak, `npx tsc --noEmit` ve servis testleriyle doğrulanacaktır.
   3. **Standart:** Enterprise-Grade, Agnostic (Linux/macOS), Load Balancer hazır, sıfır mock, profesyonel İngilizce dokümantasyon.

   ---

   ### 📦 FAZ A: Backend & Frontend Dead Code & Schema Purge (Dikey Dilim Modüler Temizlik)

   **Odak:** Prototip/Lovable döneminden kalma, artık mount edilmeyen yetim dosyalar, mükerrer tablolar/kolonlar, ölü frontend kodları ve mock kalıntılarının cerrahi olarak ayıklanması.
   
   **Ana Çalışma Kuralı (Ajan Şeffaflık & Karşılıklı Kontrol İlkesi):**
   Ajan her modülde kesinlikle tek başına hareket etmeyecek, şu 3 adımlı raporu Levent İldeniz'e sunacaktır:
   1. *"Burayı inceledim, şunları tespit ettim (dosyalar, tablolar, kodlar)..."*
   2. *"Düzeltmek ve temizlemek için şu aksiyonları alacağım, etki-tepki analizi şudur..."*
   3. *"Senin aklına gelen/fark ettiğin başka bir detay var mı? Onay verirsen cerrahi müdahaleye başlayacağım."*

   ---

   #### 🧩 8 Dikey Dilim (Vertical Slices) İcra Takvimi:

   * **Adım 0 — Kod Dışı Meta Dosya Hijyeni (Sıfır Risk):**
     - WSL2 / Windows dosya transferlerinden kalan 217 adet `*:Zone.Identifier` meta çöpleri taranıp temizlendi.
     - `local-server/lib/routes/` altındaki 15 adet unmounted/ölü legacy rota dosyası silindi.
     - Durum: Tamamlandı & Remote commit edildi (`a1c11ab`).

   * **Modül 1 — Reporting & FinOps (Overview, Cost, Usage, Operators, RAG, Invoicing):**
     - Rotalar: `local-server/lib/routes/reporting.mjs`
     - UI: `src/routes/reporting.*.tsx`, `src/lib/report-store.ts`, `src/lib/rag-analytics-store.ts`, `src/lib/schedule-store.ts`
     - DB Tabloları: `provider_usage`, `usage_daily`, `schedules`, `schedule_deliveries`, `rag_queries`
     - Durum: Doğrulandı ve mühürlendi (Phase 70 & ambiguous status sütun nitelendirmesi tamamlandı).

   * **Modül 2 — Identity, Users, Groups, Templates & RBAC:**
     - Rotalar: `identity.mjs`, `identity-groups.mjs`, `identity-roles.mjs`, `identity-templates.mjs`, `actor.mjs`, `session-gate.mjs`, `auth-utils.mjs`
     - UI: `src/routes/users.tsx`, `src/routes/rbac.tsx`, `src/routes/account.tsx`, `src/lib/rbac-store.ts`, `src/lib/group-store.ts`, `src/lib/user-template-store.ts`
     - DB Tabloları: `app_users`, `app_groups`, `app_roles`, `app_templates`, `app_sessions`, `app_tenants`
     - Yapılan Temizlik:
       * `session-gate.mjs` ve `auth-utils.mjs` içerisindeki tüm Türkçe yorumlar ve 401/403 HTTP hata mesajları kurumsal İngilizceye çevrildi.
       * `schema-identity.mjs` ölü legacy dosyası ve `server.mjs` içindeki `initIdentitySchema` çağrısı tamamen kaldırıldı.
       * `app_groups` tablosundaki mükerrer ve ölü `default_role` ve `default_template` kolonları DROP edildi; `v2_master_schema.sql` ile tam birebir parite sağlandı.
     - Durum: Doğrulandı ve mühürlendi (0 TypeScript hatası, servis aktif).

   * **Modül 3 — Knowledge Hub, Document Ingestion & Agentic RAG:**
     - Rotalar: `knowledge-spaces.mjs`, `rag-folders.mjs`, `knowledge-ingest.mjs`, `knowledge-retrieve.mjs`, `rag-ops.mjs`, `agent-rag.mjs`
     - Worker: In-process ONNX (`onnx-pipeline.mjs`) + Python Worker (`worker.py` port 8082)
     - UI: `src/routes/knowledge.tsx`, `src/routes/rag-documents.tsx`, `src/lib/knowledge-store.ts`, `src/lib/rag-folder-store.ts`
     - DB Tabloları: `knowledge_sources`, `knowledge_chunks`, `knowledge_spaces`, `rag_folders`
     - Yapılan Temizlik & Standardizasyon:
       * `src/mocks/knowledge.ts` ve `src/mocks/knowledge-seed.ts` ölü mock dosyaları repodan silindi (`src/mocks/index.ts` temizlendi).
       * `knowledge-retrieve.mjs` içindeki Türkçe API notice mesajı kurumsal İngilizceye çevrildi (`Access denied: insufficient permissions to reach this document`).
       * `brand-aliases.mjs`, `knowledge-sync.mjs`, `rag/defaults.mjs`, `entity-extractor.mjs`, `intent-classifier.mjs`, `util.mjs` ve `agent-rag.mjs` içerisindeki Türkçe yorum satırları İngilizceye çevrildi.
       * `rag-folders.mjs` masa ve tenant bazında izole edildi; admin ekranına operatörlerin özel klasörlerinin sızması engellendi.
       * `mcp.mjs` ve `mcp-store.ts` token/exposure okuma izinleri güvenli hale getirilerek 403 ve re-render döngüleri giderildi.
     - Durum: Doğrulandı ve mühürlendi (0 TypeScript hatası, servis aktif).

   * **Modül 4 — Capabilities, Tools, Skills & MCP Engine:**
     - Rotalar: `tools.mjs`, `skills.mjs`, `capabilities.mjs`, `mcp.mjs`, `adapters.mjs`, `webhooks-crud.mjs`, `python-crud.mjs`, `tool-adapters.mjs`, `tools-scan.mjs`
     - UI: `src/routes/skills.tsx`, `src/routes/factory.tsx`, `src/routes/mcp.tsx`, `src/routes/adapters.tsx`, `src/routes/targets.tsx`, `src/routes/runtime.tsx`
     - DB Tabloları: `action_library`, `tools`, `skills`, `capabilities`, `capability_packs`, `mcp_client_servers`, `mcp_clients`, `mcp_exposures`, `adapters`, `webhooks`, `targets`, `runtimes`
     - Eski/Yetim Dosya Şüphelileri: `webhooks.mjs` (webhooks-crud varken eski kopya mı?), `python.mjs` (python-crud varken eski kopya mı?).
     - Durum: Beklemede.

   * **Modül 5 — Workflows, DAG Canvas & MetaForge Synthesis:**
     - Rotalar: `workflows.mjs`, `chains.mjs`, `meta-forge.mjs`, `meta-forge/apply.mjs`, `meta-forge/planner.mjs`, `meta-forge/seed.mjs`, `trigger-sync.mjs`, `self-healing.mjs`
     - UI: `src/routes/workflows.tsx`, `src/routes/orchestration.tsx`, `src/routes/meta-forge.tsx`, `src/routes/approvals.tsx`, `src/lib/workflow-store.ts`, `src/lib/metaforge-store.ts`, `src/lib/approval-store.ts`
     - DB Tabloları: `workflows`, `orchestrations`, `forge_plans`, `forge_artifacts`, `approval_requests`, `approval_config`, `trigger_schedules`
     - Şüpheli Tablolar: `trigger_schedules` vs eski `schedules` çakışması kontrolü.
     - Durum: Beklemede.

   * **Modül 6 — Chat, Threads & Core Orchestration:**
     - Rotalar: `chat-orchestrate.mjs`, `threads.mjs`, `storage-engine.mjs`, `lib/orchestrator/*`
     - UI: `src/routes/index.tsx`, `src/components/sovereign/composer.tsx`, `src/lib/chat-store.ts`, `src/lib/orchestrate-stream.ts`
     - DB Tabloları: `chat_threads`, `chat_messages`, `chat_files`
     - Durum: Beklemede.

   * **Modül 7 — Policy, Security, GenGuard & Secret Vault:**
     - Rotalar: `security-policies.mjs`, `vault.mjs`, `cve.mjs`, `genguard-scanner.mjs`, `policy-engine-eval.mjs`
     - UI: `src/routes/policy.tsx`, `src/routes/cve.tsx`, `src/lib/security-store.ts`, `src/lib/vault-store.ts`, `src/lib/cve-store.ts`
     - DB Tabloları: `guard_rules`, `isolation_profiles`, `policy_rules`, `signed_artifacts`, `vault_secrets`, `cve_sources`, `cve_watchlists`, `cve_entries`
     - Durum: Beklemede.

   * **Modül 8 — Infrastructure, High Availability Cluster, System Engine & Settings:**
     - Rotalar: `infra.mjs`, `redis-cache.mjs`, `rabbitmq-broker.mjs`, `models.mjs`, `providers.mjs`, `system-config.mjs`, `system-misc.mjs`, `system-certs.mjs`, `siem-api.mjs`, `siem-forwarder.mjs`, `mail-time.mjs`, `fleet-services.mjs`, `telemetry.mjs`, `telemetry-stream.mjs`, `search-providers.mjs`
     - UI: `src/routes/services.tsx`, `src/routes/engine.tsx`, `src/routes/system.tsx`, `src/routes/fleet.tsx`, `src/routes/models.tsx`, `src/routes/web-search.tsx`, `src/routes/converter.tsx`, `src/routes/api-tokens.tsx`
     - DB Tabloları: `app_services`, `search_providers`, `ai_providers`, `models`, `engine_config`, `system_certs`, `siem_config`, `agent_logs`, `tenant_api_keys`, `tenant_rate_limits`
     - Durum: Beklemede.

   ---

   ### 📝 FAZ B: Kod Standartlaştırma & English Documentation (Uluslararası Kod Standardı)

   **Odak:** Kodun içine başka bir yazılımcı girdiğinde "bu nasıl bir kod" demeyeceği, kurumsal seviyede temiz, tekdüze ve %100 İngilizce standardı.

   #### 1. Yorum Satırları & Mesajların Standartlaştırılması:
   * Backend (`local-server/`) ve Frontend (`src/`) genelinde kalan tüm Türkçe yorum satırlarının taranması ve profesyonel enterprise İngilizceye çevrilmesi.
   * UI üzerindeki alert, confirm ve hata mesajlarının standartlaştırılması.
   * Lovable zamanından kalan TUR, TUR-A, MLX gibi legacy etiketlerin raporlanıp temizlenmesi.

   #### 2. API Yanıt & Hata Formatı Standardizasyonu:
   * Tüm API uç noktalarında tekdüze yanıt formatı: `{ ok: true, data }` veya `{ ok: false, error: string }`.
   * HTTP durum kodlarının (200, 201, 400, 401, 403, 404, 500) anlamsal tutarlılığı.
   * Frontend store'larındaki camelCase ile PostgreSQL'deki snake_case eşleştirmelerinin (`rowTo...`) standart hale getirilmesi.

   ---

   ### 🔒 FAZ C: NetSec Güvenlik & Penetrasyon Denetimi (Kurumsal Güvenlik Mührü)

   **Odak:** Sistemin ağ ve kimlik katmanının dış saldırılara, yetki aşımlarına ve sızıntılara karşı test edilmesi.

   #### 1. Ağ & API Güvenliği:
   * Endpoint bazında rate limiting (`rlLogin`, API token rate limits) ve brute-force koruması.
   * CORS politikaları ve hassas endpoint'lerin loopback (127.0.0.1) sınırlarının doğrulanması.
   * Input validation (Zod / JSON Schema) ve SQL Injection parametrizasyon denetimi.

   #### 2. SSRF & Dış Servis Çağrı Güvenliği:
   * Web Search, Webhook ve MCP Client bağlantılarında SSRF (Server-Side Request Forgery) koruması (dahili IP'lerin dial edilmesinin engellenmesi).
   * Secret Vault AES-256-GCM çözülmüş sırların asla loglara (`agent_logs`) veya audit stream'e sızmadığının teyidi.