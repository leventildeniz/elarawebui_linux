---
name: UI-only prompts kapatma + audit guard 2026-06-03
description: Backend chat hattındaki tüm hardcoded prompt metinleri söküldü; UI/DB tek mercii; audit guard script eklendi; 3 internal pipeline prompt'u açık kaldı
type: decision
---

# UI = TEK MERCİİ — chat prompt clean-up (2026-06-03)

Kullanıcı: "Tek gercek prompt UI dan bastıgımız promt olmalı." Kıyıda kalan
arka plan promptlarını söktük; geri ekleme YASAK.

## Söküldü (chat/RAG/warmup hattında gizli prompt yok)

- `server.mjs` `brandDefaultSystemPrompt()` artık `""` döner — `models.system_prompt` boşsa modele system mesajı GİTMEZ.
- `server.mjs` `injectSystemPrompt()` artık `### Instruction:` wrapper basmaz, user mesajına FİZİKSEL ikinci kopya yapıştırmaz, nowPreamble enjekte etmez. Tek `role:"system"` bloğu (UI system_prompt + caller systems).
- `server.mjs` smalltalk guard (`KURALLAR: 1/2/3 …`) + query/RAG `_noThinkGuard` (`Düşünme bloğu ÜRETME …`) SÖKÜLDÜ. `_thinkOff` artık SADECE `chat_template_kwargs.enable_thinking=false` protokol flag'i ile uygulanır (text prompt değil).
- `lib/rag/util.mjs` `buildFreeAnswerMessages()` artık `messages`'ı olduğu gibi geçirir — `[STYLE …]`, `KAYNAK YASAĞI`, `KÜTÜPHANE DURUMU`, `DİL KURALI` bloklarının hiçbiri eklenmiyor.
- `lib/routes/chat-stream.mjs` + `lib/routes/chat-orchestrate.mjs` RAG inject path'inde `[INSPECTOR DENETÇİ KURALLARI]` (Rule 1-6 expert/strict), dominant brand lock (Rule 7), concise (Rule 8), no-tool (Rule 9) + `MÜHÜRLÜ DÖKÜMANLAR:\n…\nSORU:` envelope SÖKÜLDÜ. RAG turunda artık model'e SADECE kaynak blokları + kullanıcı sorusu + UI'daki `system_prompt` gider.
- `lib/routes/chat-stream.mjs` + `chat-orchestrate.mjs` `nowPreamble = null` — `buildNowPreamble` çağrılmıyor.
- `lib/mlx-warmup.mjs` `_warmGuard` ("Kısa bir hazırlık mesajıdır … Düşünme bloğu ÜRETME …") SÖKÜLDÜ. Warmup payload artık sadece UI system_prompt + minimal `user:"hi"`.

## UI knob'ları kaldı, şu an no-op

`RAG_SETTINGS.ragExpertMode`, `ragConciseAnswers`, `ragNoToolRuleStrict`,
`crossVendorGuard`, `disableThinkOnSmalltalk`, `disableThinkOnQuery`,
`disableThinkOnRag` — knob'lar mevcut ama prompt metinleri söküldüğü için
şu an etkisiz. Prompt Registry turunda UI'daki editlenebilir metinlere
bağlanacak. `crossVendorGuard` retrieval-side guard hâlâ aktif (metin
direktifi değil, decision flag).

## Açık kalan (audit FAIL, ayrı tur — onay bekliyor)

Bunlar **user-facing chat değil**, internal pipeline prompt'ları:

1. `server.mjs:2526` — HyDE `_hydePrefix = "/no_think\n"` (RAG query rewrite)
2. `lib/ingest/extract.mjs:243` — Extractor sysMsg ("You extract the technical search core …")
3. `lib/plan-and-execute.mjs:339` — Plan-and-execute envelope ("KURALLAR: …")

Sökülürse RAG denoise/extractor + agent plan-execute pipeline'ı bozulur.
Onay sonrası ya UI registry'ye bağlanır ya tamamen söküp pipeline davranışı
değişir.

## Guardrail

`local-server/scripts/audit-hidden-prompts.sh` — yeni gizli prompt eklendiyse
fail eder. CI'de hat tutulması istenirse pre-commit/pre-push hook'a bağla.
Yorum satırlarını + `lib/skills/seed.mjs` (DB seed, UI editable) + `.md`
dokümantasyonu hariç tutar.

## Ders (kalıcı kural)

- Backend chat/RAG/warmup hattında **`role:"system"` content** olarak
  hardcoded TR/EN metin BASMA. Yeni bir kural eklemek gerekirse:
  ya UI knob ekle (RAG_SETTINGS) ya da gelecek Prompt Registry'ye yaz.
- `### Instruction:` veya user mesajına fiziksel sistem talimatı yapıştırma YASAK.
- Audit script regression'ı yakalar; ona güven.