# Runtime UI-Bypass Audit — 2026-05-29

Read-only inventory of `server.mjs` defaults that are not surfaced as
operator-editable UI controls today. **No behaviour changed.** Each row needs
explicit user approval before being migrated to UI/DB.

Format: `[server.mjs:line]` current default · UI counterpart · risk · recommendation

## A. Hardcoded runtime ports

| Loc | Current | UI | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `server.mjs:1404` | MLX preset `http://127.0.0.1:8001/v1` + `mlx-community/Qwen2.5-72B-Instruct-4bit` | partial (Runtime Provider card) | medium | preset object is bootable fallback; reachable through UI Reset-to-preset. Keep, document as boot fallback. |
| `server.mjs:1405` | Legacy preset `http://127.0.0.1:11434` + `qwen2.5:72b` | partial | medium | same — boot fallback only. |
| `server.mjs:1487` `:1493` | `runtimeUpstreamBase()` force-rewrites MLX→8001, Legacy→11434 | none | **high** | breaks user-set custom base/port for `mlx`/`legacy` provider. Should respect user `baseUrl` when it carries an explicit port. |
| `server.mjs:1455` `:6807` `:7119` | `runtimeIsMlx()` heuristic uses `/:8001\b/` and `endsWith("/v1")` | none | medium | provider field is authoritative; heuristic should be a tiebreaker, not the primary signal. |
| `server.mjs:23625` | `MLX_RUNTIME_PORT = env.MLX_RUNTIME_PORT || 8001` | none | medium | restart endpoint port should come from active runtime base, not env-only fallback. |
| `server.mjs:407` `:460` `:4853` `:1988` `:10740` | `MLX_BASE_URL || http://127.0.0.1:8001` literals scattered | none | medium | should resolve through `runtimeUpstreamBase()` so a custom runtime base is honoured. |

## B. Hardcoded model/provider literals

| Loc | Current | UI | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `server.mjs:412` | keepwarm path uses `process.env.LLM_MODEL \|\| "elara-72b-mlx"` | none | medium | should read from active runtime model slug, not env literal. |
| `server.mjs:1404` | MLX preset model `mlx-community/Qwen2.5-72B-Instruct-4bit` | partial | low | boot fallback; UI lets operator override and persists in DB. |
| `server.mjs:1648` | `provider = /11434/.test(seedBase) ? "Legacy HTTP" : "MLX"` literal | none | low | provider should come from `RUNTIME_PROVIDER_CFG.provider`, not URL sniffing. |
| `launchd/com.elara.middleware.plist:49` | VLM model `mlx-community/Qwen2-VL-7B-Instruct-4bit` | UI Vision card | low | Vision runtime is a separate service; keep but isolate from main Models tab copy. |

## C. Hardcoded timeouts / clamps (Watchdog/Transport)

| Loc | Current | UI | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `server.mjs:6691-6697` | watchdog defaults 120s/60s/20s/3s/120s/300s/45s | full (`/api/engine/watchdog`) | low | UI editable; floors keep operator from setting unsafe values. |
| `server.mjs:6705-6711` | watchdog `clamp(... floor)` (90k/30k/5k/1k/60k/60k/5k) | none | medium | floors are intentional safety net but never displayed; surface them in `floors` payload (already returned but not shown). |
| `lib/queue-config.mjs` | `TIMEOUT_BUDGETS` HTTP/MLX/queue defaults | partial (`/knowledge` RAG panel Timeout Budgets) | low | already covered. |
| `server.mjs:206` | `MLX_TRANSPORT.heartbeatMs = env.MLX_WARMUP_HEARTBEAT_MS \|\| 45_000` | full (Transport KV Cache Heartbeat) | low | UI editable. |
| `server.mjs:208` | `MLX_TRANSPORT.heartbeatEnabled = env … "0"` | full (Transport heartbeat enable) | low | UI editable. |
| `server.mjs:398-404` | `MLX_KEEPWARM_*` env-only (default OFF) | none | medium | opt-in plist env; expose under Runtime Transport if you ever want to flip without restart. |
| `server.mjs:870` `:953` | worker/gateway boot timeouts (360s/30s) env-only | none | low | rarely tuned; keep boot-only. |
| `server.mjs:638-640` | worker self-heal cooldown 120s + respawn max 3 | none | medium | currently env-only; could move to Runtime Watchdog if needed. |
| `server.mjs:553` | `WORKER_HEALTH_TIMEOUT_MS` floor 500 default 3000 | none | low | tight inner-loop; keep env-only. |

## D. Sampling clamps / token caps

| Loc | Current | UI | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| smalltalk/query/rag intent caps | smalltalk=220, query=1000, rag=2000 (memory note) | none | medium | bake these into `RAG_SETTINGS` so the operator can tune per-intent without code edits. |
| model max_tokens server ceiling 4000 | (memory note: agent max_tokens UI unlock 2026-05-28) | partial | low | already surfaced via agent editor; per-model ceiling note stays in audit until reviewed. |

## E. Restart / process lifecycle locks

| Loc | Current | UI | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `server.mjs:23625-23740` | `/api/system/restart-mlx` hardcoded port 8001 | UI button (Restart MLX) | **high** | rename to Restart Runtime, port from active runtime base. **This audit's first migration target.** |
| `server.mjs:1808-1809` | loopback allowlist hardcodes restart-mlx + restart-worker | none | low | add new `/api/system/restart-runtime` alias to allowlist when added. |

## F. Default intent classifier prompt

| Loc | Current | UI | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `server.mjs:10536-10540` | English default | full (System Engine Intent Router → reset) | low | default is English; persisted Turkish values come from previous operator save or `INTENT_CLASSIFIER_PROMPT` env. Operator hits "reset" to restore English. |

## G. Brand/runtime sniffing helpers

| Loc | Current | UI | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `server.mjs:1450-1456` | `runtimeIsMlx()` URL heuristic | none | medium | UI provider field should win; heuristic only as fallback. |

## H. Model ID immutability (display vs runtime ID)

| Loc | Current | UI | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `models.id` PK | not renameable | none until this turn | **high** | new `POST /api/models/:id/rename` endpoint added in same turn; updates `models.id` + cascading FK references (`app_settings.runtime.provider`). Agents resolve via slug at call time so rename takes effect after manifest reload. |

---

**Rule:** every entry tagged `medium` or `high` is a candidate for the next
"move to UI" turn. No silent migration; each one needs explicit user approval
per the project's UI = single source of truth contract.
