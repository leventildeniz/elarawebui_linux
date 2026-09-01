# Checkpoint — 2026-06-29 (Agent Manifest + Warming-up + MCP intent)

## Bugün ne yaptık

### 1. Warming-up / “Model warming up · cold start” yanıltıcı etiketi
- **Kök sebep**: `chat-orchestrate.mjs` içinde 2sn kuyruk bekleme dahi UI’a “cold start” olarak yansıyordu. Aslında gerçek bir warmup yoktu (boot/cold/keepwarm zaten OFF).
- **Düzeltme**: `src/routes/_app.chat.tsx` etiketleri yumuşatıldı → “Waiting for runtime slot” / “Runtime preparing first token” (⏳).
- **Sonuç**: Kullanıcı testinde warming-up etiketi artık görünmüyor. Bir süre daha gözlemde.

### 2. Gemma 4 think-off gate fix
- **Kök sebep**: `server.mjs::_familyAcceptsThinkOff` sadece `qwen` ailesini kabul ediyordu. Gemma 4 her turda `<|think|>` üretip 30–50s gecikme yaratıyordu.
- **Düzeltme**: Gate `gemma4` ailesini de kabul edecek şekilde genişletildi (chat-templates.mjs `_renderGemma4` zaten `chat_template_kwargs.enable_thinking=false` destekliyor).
- **Sonuç**: Smalltalk / meta turlarında ilk token süresi belirgin düştü.

### 3. Ajan manifesti tanıtım problemi (yarına devam)
- **Yapılanlar (özet)**:
  - `local-server/lib/agents-manifest.mjs` — DB + disk merge, `_discoverDiskAgentRows`, `_headerDescription` ile `# @description:` çıkarımı.
  - `formatAgentsManifestAnswer` — LLM bypass eden deterministic cevap üretici.
  - `chat-stream.mjs` + `chat-orchestrate.mjs` — `_metaManifestLaneActive` flag, bridge bypass, `agent_manifest` etiketli system bloğu smalltalk filter muafiyeti.
  - `intent-classifier.mjs` — TR/EN meta anchors.
  - `rag-control-panel.tsx` — “Elara Agent Manifest” modu + “Direct answer for agent-list questions” switch.
- **Açık problem (görsel 1 — “ajanlarını detaylı şekilde tanıtabilir misin”)**:
  - RAG: skipped ✅, warming up YOK ✅
  - ama cevap hâlâ **squad seviyesinde özet** (113 tok, LLM’e düşmüş).
  - Yani direct-answer hattı bu sorgu kalıbında tetiklenmemiş.
- **Görsel 2 — “kendini tanıtır mısın”**: davranış doğru, sadece self-intro (manifest değil).

## Yarın için nokta atışı plan
1. `isAgentManifestQuestion` regex’ine **“detayli sekilde tanit / ajanlarini ... tanit / anlat / acikla / sirala”** kalıp varyasyonlarını net ekle.
2. `/api/system/rag-settings` GET ile `elaraAgentManifestDirectAnswer` ve `elaraAgentManifestMode` knob’larının **gerçekten ON** kaldığını doğrulayacak ufak bir boot log + UI badge ekle (knob UI’dan kapanıp kapanmadığını net görelim).
3. Direct-answer hattı tetiklendiğinde SSE meta’ya `manifest_direct=true` flag bas → UI’da küçük bir “Direct manifest” chip göster (teşhis için).

## Dokunulmayacaklar
- RAG pipeline (yeşil).
- Worker / reranker (yeşil — checkpoint 2026-06-25).
- Runtime Safety knob default’ları (warmup OFF kalsın).
- `server.mjs` monolit avı — modüler yapıyı bozma.

---

## Yeni konu (yarın konuşulacak) — MCP Server + Client niyeti

Kullanıcı niyeti: Elara’ya **hem MCP server (Elara’nın araçlarını dışarı açma) hem MCP client (dış MCP server’lara bağlanma)** yetisi eklemek.

### Konuşulacak başlıklar (henüz karar YOK, plan-first)
1. **Mimari yer**:
   - MCP server: local-server üstünde ayrı bir route mu (`/mcp`), yoksa TanStack Start tarafında mı (`src/routes/api/mcp.ts`)?
   - MCP client: agent dispatch hattına mı entegre (`agents/_shared/dispatch.py`), yoksa Node tarafında `@ai-sdk/mcp` üzerinden mi?
2. **Transport seçimi**: Streamable HTTP (default) / SSE / stdio (sadece lokal). Bizim ekosistem için muhtemelen **HTTP + opsiyonel stdio**.
3. **Auth**:
   - Server tarafı: bizim mevcut session/JWT mi, ayrı `MCP_SECRET` mı, OAuth mu?
   - Client tarafı: per-user OAuth (AI SDK MCP `authProvider`) gerekecek mi, yoksa servis hesabı yeterli mi?
4. **Tool surface**:
   - Hangi mevcut Elara araçları (tools/, skills/, agents/) MCP olarak dışarı açılacak? Allowlist gerek.
   - Dışarıdan gelen MCP tool’ları ajan manifest’ine nasıl bağlanacak? (`@tools` header + capability registry ile uyum).
5. **UI**:
   - `/system-engine` altına “MCP” sekmesi: connected MCP servers listesi, allowlist, OAuth durumu.
   - Connection registry için DB tablosu (`mcp_connections`: id, user_id, name, url, transport, state, auth, tokens).
6. **Güvenlik**:
   - URL allowlist (sadece https, lokal istisna).
   - Token encryption at rest.
   - Loopback-only mod (geliştirme için).
7. **Yol haritası (taslak)**:
   - Faz 0: Karar matrisi + DB şema taslağı.
   - Faz 1: MCP **client** (dış server’a bağlan, tool listele, ajan dispatch’ine enjekte).
   - Faz 2: MCP **server** (Elara tool/skill subset’ini dış dünyaya aç).
   - Faz 3: UI + OAuth + connection registry.
   - Faz 4: Audit + telemetry.

### Yarına soru listesi (kullanıcı yanıtlayacak)
- Öncelik: önce **client** mi (Elara dışarıdaki MCP server’ları kullansın) yoksa **server** mi (Elara’yı dışarıya aç)?
- Hangi dış MCP server’lara bağlanma niyeti var? (Notion / Linear / GitHub / kendi yazdığın bir MCP?)
- Server tarafında public mi olacak yoksa sadece LAN/loopback mi?
- Auth modeli: tek kullanıcı (sen) mı, multi-user mı?

---

İyi dinlenmeler komutan 🫡 yarın taze kafayla MCP planına oturalım.
