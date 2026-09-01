# Checkpoint — 2026-07-03 · MCP Phase 1+2 + Exposure Badges

## Bugünkü hat
1. **Agent manifest — semantic intent lane (GREEN)**
   - `INTENT_ANCHORS.agent_manifest` üzerinden cosine-similarity ile sınıflandırma.
   - `intent.subKind === "agent_manifest"` → deterministic meta lane, LLM bypass.
   - Manifest gerçek zamanlı disk+DB tarama, squad grouping, `.py` header'dan description scrape.
   - Yeni squad/ajan ekleyince otomatik tanıtılır (dinamik).

2. **MCP Phase 1 — Server (expose)**
   - Backend: `local-server/lib/mcp/` → `registry.mjs`, `catalog.mjs`, `dispatch.mjs`, `protocol.mjs` (JSON-RPC 2.0, loopback).
   - Route: `local-server/lib/routes/mcp.mjs` (`/mcp` + admin API).
   - Şema: `mcp_settings`, `mcp_exposures`, `mcp_tokens`, `mcp_call_history`.
   - UI: yeni **MCP** tab (`src/routes/_app.mcp.tsx`), Server + Client kartları.
   - Auth: Bearer / OAuth loopback / no-auth.
   - Copy agnostik: "the AI model" (Elara referansı çıkarıldı).

3. **MCP Phase 2 — Client (consume)**
   - Şema: `mcp_client_servers` (URL, transport, auth_type/config, auto_inject, tools_cache, last_status).
   - Backend: `lib/mcp/client.mjs` → `probeServer` / `callRemoteTool` (JSON-RPC + SSE fallback, 15s timeout, `redirect:"error"`).
   - CRUD + probe + call endpoint'leri `routes/mcp.mjs`'de.
   - Tool bridge: `/api/agents/tool-call` `mcp:<slug>.<tool>` prefix'ini remote'a yönlendiriyor.
   - Manifest bridge: `agent-env.mjs` `auto_inject=true` server tool'larını `ELARA_AGENT_TOOLS`'a `mcp:` prefix'iyle enjekte ediyor.
   - UI: `mcp-client-card.tsx` → AddServerForm + ServerRow (status/enabled/auto-inject/probe/delete) + expandable tool listesi + inline test (JSON args → run → JSON result).

4. **Exposure badges (read-only) — GREEN**
   - `src/components/mcp-exposed-badge.tsx` — modül-seviye tek cache (`/api/mcp/exposures` bir kez), tüm kartlar aynı setten okuyor.
   - Enjeksiyon: `_app.agents.tsx`, `_app.tools.tsx`, `_app.skills.tsx` — expose edilmişse `🌐 MCP` chip, tıklama `/mcp`'ye deep-link.
   - Yönetim tek yer: `/mcp`. Kartlarda düzenleme yok.

## Modülerlik notu
- `server.mjs`'e MCP için yeni satır YOK (mount noktası Phase 1'de bağlıydı).
- Tüm iş `lib/mcp/*` + `lib/routes/mcp.mjs` + `src/routes/_app.mcp.tsx` + `src/components/mcp-*.tsx` altında.

## Açık başlıklar (yarına)
- OAuth authorization code flow (şu an sadece loopback token doğrulama iskeleti).
- MCP audit log UI (`mcp_call_history` tablosu var, UI panel yok).
- Remote tool probe için background refresh schedule (şu an sadece create sonrası + manuel).
- Chat performansı observation (warm-up / queue) — kullanıcı bir sonraki turda bakmak istedi.
- WSL/Linux port testi (kullanıcı ~1 ay sonra DELL üzerinde deneyecek).

## Anchor
- Ön-durum: MCP Phase 2 tamam, badges green.
- Rollback: `git log` üzerinden bu checkpoint öncesi commit'e dönülebilir.
