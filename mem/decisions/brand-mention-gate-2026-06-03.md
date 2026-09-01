---
name: Brand-Mention Gate (UI knob default ON)
description: RAG probe'dan ÖNCE DB library brand mention kontrolü; eşleşme yoksa sessizce free-answer; statik vendor sözlüğü YOK
type: feature
---

# Brand-Mention Gate — 2026-06-03

Kullanıcı kuralı: "Soruda kütüphanede bulunan brand geçmiyorsa RAG hiç çalışmasın, model kendi bilgisiyle cevaplasın, uyarıya bile gerek yok."

## Knob
`RAG_SETTINGS.requireBrandMentionForRag` (boolean, default **true**). UI: rag-control-panel → "Library Match" bloğunda Switch. Env fallback `RAG_REQUIRE_BRAND_MENTION=0` ile devre dışı.

## Hatlar
1. **chat-stream.mjs** (line ~207): `else if (ragGloballyEnabled && q)` branch'inin başında `getLibraryBrands() + detectLibraryMatch(q)` — eşleşme yoksa `probeRes={decision:"skip", reason:"no_library_brand_in_query"}` set, `return` ile probe atlanır. SSE breadcrumb: `rag.brand_gate_skip`.
2. **chat-orchestrate.mjs** (line ~548): `} else {` bloğunda probe çağrısından önce aynı kontrol. Eşleşme yoksa `ragMessages = buildFreeAnswerMessages(messages, "no_library_brand_in_query")` + `send({rag: {skipped:true, reason:"no_library_brand_in_query", notice:null}})` (banner YOK). Nested else için ekstra `}` eklendi.
3. **agent-rag.mjs** `buildAgentRagContext` (line ~185): `_getRagSettings().requireBrandMentionForRag !== false` ise `getLibraryBrands` + `detectLibraryMatch` — eşleşme yoksa `meta:{hits:0, mode:"brand-gate-skip", reason:"no_library_brand_in_query"}` döner. Agent path'inde mevcut `agentRagNoHitsDirective` (UI knob) devreye girer ("Kütüphaneme baktım, eşleşen kaynak yok…").
4. **agent auto-route** (2026-06-03 fix): chat-stream + chat-orchestrate auto-route da aynı gate'e bağlandı. Soruda library brand yoksa Elara hiçbir ajan spawn etmez; normal free-answer hattı devam eder. Kök bug: `firewall_oracle.py` auto-route ile seçiliyor ve kendi prompt'unda "Kütüphanedeki dokümanlara baktım" cümlesini zorunlu yazdırıyordu.
5. **firewall_oracle.py**: hardcoded "HER ZAMAN kütüphaneye baktım de" kuralı kaldırıldı. Artık yalnız `KNOWLEDGE CONTEXT` içinde gerçek `[#1]` snippet varsa kaynak/kütüphane cümlesi kurabilir; snippet yoksa doğrudan kendi uzmanlığıyla cevaplar.

## Statik liste YOK
- `getLibraryBrands()` DB'den çeker (`knowledge_sources.brand` + `data/brand-aliases.json`), 5dk cache (`libraryBrandCacheTtlMs`).
- `detectLibraryMatch(q, brands)` kelime sınırı regex'i + alias try.
- Cisco/HP gibi library'de olmayan brand'ler için ekstra liste GEREKMEZ — eşleşme zaten null döner, gate tetiklenir.

## Cross-vendor guard ne oldu?
**Korundu** — savunma derinliği. Brand gate kapalıyken (operatör OFF yaparsa) hâlâ row dominance check devrede (`chat-stream.mjs:231`, `chat-orchestrate.mjs:576`).

## Davranış matrisi
| Soru | libBrand match | Davranış |
|------|----------------|----------|
| "cisco switch'te vlan" | yok (Cisco library'de değil) | RAG skip, free-answer (sessiz) |
| "vlan nedir" | yok | RAG skip, generic cevap |
| "fortigate vlan" | fortinet/fortigate var | RAG inject (eski) |
| "checkpoint nat" | checkpoint var | RAG inject (eski) |

## Dosyalar
- `local-server/lib/rag/defaults.mjs` (whitelist + envNumber)
- `local-server/lib/routes/rag-settings.mjs` (POST handler)
- `local-server/lib/routes/chat-stream.mjs` (gate)
- `local-server/lib/routes/chat-orchestrate.mjs` (gate + nested else)
- `local-server/lib/agent-rag.mjs` (agent gate)
- `src/components/rag-control-panel.tsx` (UI Switch, outOfLibraryFallback yanı)
- `local-server/.rag-settings.json` (default true)

## Doğrulama
- `node --check` 5 dosya ✓ + JSON parse ✓
- Smoke (middleware kickstart sonrası): "cisco switch'te vlan" → SSE'de `rag.brand_gate_skip`, UI'da kaynak chip yok, model "kendi bilgimle…" diye yanıtlar.

## İptal edilen plan
2026-06-03 önceki "knownExternalVendors" textarea knob fikri — statik liste gerektirdiği için kullanıcı reddetti, bu plan onun yerine geçti.
