---
name: Meta-Forge semantic-only mola 2026-07-04
description: Regex/keyword gate REDDEDİLDİ; semantic classifier neden by-pass ediliyor sorusuna yarın devam. Ölçüm listesi kayıtlı.
type: constraint
---

# Meta-Forge — semantic yeter, regex YOK (mola)

**Kullanıcı kararı (2026-07-04 akşam):** Deterministic keyword gate (TR/EN "yeni tool yap" regex'i) **reddedildi**. "Regex ile baş edilmez, model anlıyor, iş routing/pipe'da." Semantic classifier PRIMARY kalacak; failsafe olarak bile regex gate eklenmeyecek.

## Kanıt (bu turdaki log)
- `[ROUTER] intent=... t=0ms mode=execution-guard subKind=-` — semantic classifier **hiç çağrılmadı**.
- `forge_plans` son 3 satırında bugünün Turkish "yeni tool yap" istekleri YOK → lane açılmadı → kart yok.
- 19:15'teki `applied` plan çalışan tek örnek; onun akışı log'da `meta_forge.lane.start` içeriyor.

## Kök soru (yarın)
Semantic yetersiz DEĞİL, **sıra gelmiyor**. İki hipotez:

1. **`execution-guard` kısa-devresi** — chat-orchestrate.mjs / intent-classifier.mjs'de `t=0ms` ile classify atlanıyor. Muhtemelen "aynı thread'de önceki turda intent belirlendi → cache" veya "guard subKind üretmeden erken return". Meta-forge intent bu guard'ın ÖNCESİNDE değerlendirilmeli, ya da guard `subKind=null` hallerinde classifier'a düşmeli.

2. **Anchor cache cold/zayıf** — `INTENT_ANCHORS.meta_forge` embedding'leri boot'ta hazır değil ya da "elara yeni bir tool yap" cümlesine yakın değil. Timeout'ta "unknown" dönmek yerine **await + retry** veya **LLM adjudicator** devreye girmeli.

## Yarın ilk iş — ÖLÇÜM (kod yok, plan yok, öneri yok)
1. `rg "execution-guard" local-server/lib/` — hangi koşulda tetikleniyor, kod yerini bul.
2. Anchor cache init timing: `[intent] anchors ready in Xms` log satırı ekle (veya varsa oku), cold vs warm classifier latency histogramı.
3. `INTENT_ANCHORS.meta_forge` içeriğini oku — "elara yeni bir tool yap / ajan üret / skill oluştur" cümlelerine cosine similarity ölç (script: `local-server/scripts/anchor-probe.mjs` yaz veya varolan `meta-forge-debug.sh` genişlet).

## Yasaklar (kullanıcı talimatı)
- Regex/keyword gate YASAK (bu turda önerildi ve reddedildi).
- Threshold oynaması YASAK (ölçüm olmadan semptom tedavisi).
- "Ufak iyileştirme" refleksi YASAK — plan-first.

## Pre-state
- Kod değişmedi bu turda.
- server.mjs / intent-classifier.mjs / chat-orchestrate.mjs Tur 6B sonrası halinde.
- Semantic classifier + `metaForgeIntentRatio` mevcut, `metaForgeGateMode` default "pre-classify" (rag.settings satırı yok, fallback aktif).
