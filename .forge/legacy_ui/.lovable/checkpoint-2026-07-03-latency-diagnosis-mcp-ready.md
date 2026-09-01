# Checkpoint — 2026-07-03 · Latency Diagnosis + MCP Ready for Testing

## 1. Chat Telemetry UI (deployed)
`src/routes/_app.chat.tsx` chip artık şunları gösteriyor:
- `TTFT` · `Gen` · `RAG` · `Total`
- `prompt≈X tok` · `out=X tok` · `X tok/s` (emerald>20, amber<20)
- `⚠ think-leak` (thinking tag sızarsa)

Backend telemetri: `local-server/lib/routes/chat-orchestrate.mjs`
- `_tokensOut` (approxTokens), `_mlxGenMs`, `_tokPerSec`, `_thinkLeak`, `promptTokens`

## 2. Latency Diagnosis (KAPALI — root cause identified)

### Ölçüm
- **UI:** TTFT 2554ms · Gen 85574ms · Total 88128ms · prompt≈9668 tok · out=1137 tok · **13.3 tok/s**
- **GPU:** `sudo powermetrics --samplers gpu_power` — **%99 aktif**, 1620 MHz clock, 40-46W güç, 15 saniye boyunca sabit

### Karar
Sistem **memory-bandwidth limited**, kod tarafında bug/blok/queue leak YOK.
- Gemma 31B q6 ≈ 25GB weights
- M5 Max unified memory: ~546 GB/s → teorik tavan ~22 tok/s
- Gerçek 13.3 tok/s → tavanın %60'ı (MLX verimliliği normal)

### Kullanıcı Kararı
**Model DEĞİŞMEYECEK.** Q4'e geçmek 2× hızlanma verirdi ama kaliteyi feda etmeye değmez. 13 tok/s kabul edildi. **Bu konu bir daha açılmayacak** — snapshot'lar yanıltıcı olabilir, GPU %99 kanıtı yeterli.

### Prompt bloat (also normal)
9668 tok'un ~6500'ü `{AGENTS}` manifest full descriptions. Meta soru için tasarım gereği — model ajanları detaylı listeledi (1137 tok çıktı, kaliteli).

## 3. Runtime Safety Toggles (already deployed)
`/system-engine → Runtime Safety` tab — tüm performans kısıtları OFF-by-default. Model'i "prangalayan" kod artık yok:
- `mlxColdWarmupOnDemand`
- `mlxKeepwarmEnabled`
- `disableThinkOnSmalltalk/Query/Rag`
- `agentAutoRouteSkipSmalltalk`
- `injectAgentToolsManifest` (default OFF, opt-in)

## 4. Agent Manifest (fully dynamic)
`local-server/lib/agents-manifest.mjs` — semantic intent classification
- Trigger: `intent.subKind === "agent_manifest"` (INTENT_ANCHORS)
- Real-time disk+DB scan, header scraping for descriptions
- Yeni squad/ajan eklenince otomatik tanıtılır — statik liste YOK
- Direct-manifest lane opsiyonel (`/knowledge → RAG` switch)

## 5. MCP Phase 1+2 (KOD BİTTİ — sadece test kaldı)

### Server (Phase 1)
- `local-server/lib/mcp/` core
- Routes: `/mcp` + admin API in `local-server/lib/routes/mcp.mjs`
- UI: `src/routes/_app.mcp.tsx` + sidebar
- Tables: `mcp_settings`, `mcp_exposures`, `mcp_tokens`, `mcp_call_history`
- Auth: bearer / OAuth / loopback (3 mode)

### Client (Phase 2)
- `mcp_client_servers` table + `local-server/lib/mcp/client.mjs` (JSON-RPC 2.0)
- Tool bridge: `mcp:<slug>.<tool>` routed via `/api/agents/tool-call`
- Auto-injection into `ELARA_AGENT_TOOLS` via `agent-env.mjs`
- UI: `src/components/mcp-client-card.tsx` (status, inline test panel)

### Badges
- `src/components/mcp-exposed-badge.tsx` (module-level cache)
- Integrated into Agents / Tools / Skills list views

### Test Plan (yarına)
1. **Server smoke:** expose tool → generate bearer → `curl tools/list` + `tools/call`
2. **Client smoke:** register external MCP → probe → bind to agent → chat call
3. **Badge:** 🌐 rozetlerinin canlı yansıması
4. **Audit:** `mcp_call_history` kayıt akışı

## Açık Konular
- Yok — sistem stabil. Yarın MCP smoke tests + istersen MCP UI polish.

## Rollback Anchors
- Previous checkpoint: `.lovable/checkpoint-2026-07-03-mcp-phase1-2-badges.md`
- Manifest checkpoint: `.lovable/checkpoint-2026-06-29-agent-manifest-and-mcp-intent.md`
