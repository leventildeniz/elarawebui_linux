---
name: Meta-Forge Tur 7 streaming plan card GREEN
description: ForgePlan progressive reveal wiring yeşil, 55s→18s algılanan (Gemma4-31B q6), Tur 8 gerekmedi; yarına bulk-delete + mixed-content + vision 401
type: feature
---

# Meta-Forge Tur 7 — Streaming Plan Card GREEN (2026-07-03 gece)

## Ne yapıldı
- `local-server/lib/meta-forge/stream-parser.mjs` (yeni, ~80 satır): forge_master.py stdout'undan `"intent":"..."` + `"create":[{...}]` balanced-brace incremental parser
- `local-server/lib/routes/chat-orchestrate.mjs`: `runLocalAgent` → `streamLocalAgent`, parser onChunk'a bağlı, `forge_plan_partial` SSE frame emit
- `src/lib/api-client.ts:775-803`: `forge_plan_partial` frame parse + `onPhase("forge_plan_partial", …)` dispatch
- `src/routes/_app.chat.tsx`: `ForgePlanPartial` type + `forgePlanPartial` state + phase handler `:1725` + `ForgePlanPartialCard` (pulse "Planning…" + elapsed timer + slide-in per create item) + final ForgePlan geldiğinde replace

## Doğrulama (kullanıcı Mac)
- `meta-forge-debug.sh` orchestrate turn1: **5 partial frame** (1 intent + 4 create item: tool/skill/agent/pack), 54s toplam
- Stream hattı: 0 partial (wiring almadı, chat UI zaten orchestrate'e gidiyor → dokunma)
- Chat UI: "Planning…" ~1-2s içinde açılıyor, ~18s'de tam plan düşüyor (Gemma4-31B q6 warm)
- Network tab: `/api/chat/orchestrate` 48.91s, `[forge_plan] frame` console'da ✓

## Kazanım
- 55s (Qwen 72B tahmini) / 18s (Gemma4-31B q6 gerçek) — algılanan latency ölü ekrandan canlı akışa döndü
- Tur 8 (deferred source) **gerekmedi** — kullanıcı "iyi he, psikolojik olay" onayı verdi

## AÇIK (yarına)
1. **Meta-Forge bulk delete**: UI'da 10+ pending phishing-triage plan birikti; şu an sadece REJECT tek tek (soft, satır DB'de kalır). Öneri: `DELETE /api/meta-forge/plans/:id` (admin) + bulk-delete endpoint + checkbox UI. Şimdilik kullanıcıya SQL önerdim (`DELETE FROM forge_plans WHERE status='pending'`)
2. **Mixed content**: sayfa `https://limacm5m.local:10443` ama api-client `http://limacm5m.local:3005`'e HTTP gidiyor (`api-client.ts:345` base URL). Console'da her poll'da 5-10 warning. TLS proxy üstünden host-relative çağrıya geç
3. **`/api/vision/config` 401**: session header vision route pattern'inden düşüyor, ayrı tur
4. **Stream hattı forge_plan_partial**: `/api/chat/stream` route'una da parser wiring (chat UI kullanmıyor ama simetri için, düşük öncelik)

## Dosyalar
- YENİ: `local-server/lib/meta-forge/stream-parser.mjs`
- EDIT: `local-server/lib/routes/chat-orchestrate.mjs` (streamLocalAgent + onChunk parser)
- EDIT: `src/lib/api-client.ts` (partial frame handler)
- EDIT: `src/routes/_app.chat.tsx` (type + state + card component)

## Kural teyidi
- Deferred source (Tur 8) YAPILMADI — "yeter" noktasına gelindi, gereksiz komplekslik ekleme
- forge_plan final kartı geldiğinde partial kart REPLACE olur (state cleanup temiz)
- Tur 7 hattı UI-transparan: eski davranış `forge_plan_partial` frame ignore edilse bile bozulmaz
