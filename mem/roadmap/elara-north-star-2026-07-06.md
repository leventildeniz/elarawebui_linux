---
name: Elara North Star — Dynamic Compound Agent/Tool/Workflow
description: KUZEY YILDIZI vizyon — kullanıcı doğal dilde iş tarifler, Elara compound plan (tool+skill+agent+pack) önerir, ONAY alır, kendisi forge eder ve çalıştırır. Internet Mac'in native ağı. Kod yazan değil onaycı kullanıcı.
type: feature
---

# Elara Kuzey Yıldızı (2026-07-06 onaylı)

## Vizyon (kullanıcının kelimeleriyle)
> "Bana bir gün 'iPhone fiyatlarını karşılaştır', 'xxx.com'a git güvenlik açığı taraması yap ve raporla', 'şu Firewall'a bağlan konfigürasyonu yap', 'insta'ya bağlan trendleri çıkar' diyeceğim. Model yetkin olsun, AI'ın nimetinden faydalanalım. Ben artık manuel ajan/tool yazmayayım — **KONTROLCÜ ve ONAYCI** olayım. İnternete gitmek için Mac'in native ağı yeter, proxy/API gateway istemiyorum."

## Kullanıcı sözleşmesi (CORE — asla unutma)
1. **Kullanıcı manuel tool/agent/skill YAZMAZ.** İstediğini doğal dilde söyler.
2. **Elara compound plan önerir** (tool + skill + agent + pack bileşimi). Tek capability değil.
3. **Kullanıcı onaycıdır** — `Approve / Modify / Reject`. Onaysız çalıştırma YOK.
4. **Onay sonrası otomatik execute** + sonuç chat'e stream.
5. **Internet = Mac'in native ağı** (requests/curl/playwright direkt). Proxy/gateway/API-key wrapper YOK.
6. **Devamı**: workflow/chain (DAG) üretimi — "bana X için workflow oluştur" dediğinde canvas'ta görsel plan.

## Çalışma stili (bu iş için)
- **Nokta atışı** git, geniş kapsam açma.
- **Küçük mini-turlar** — Faz A bile 3 alt-tura bölünecek.
- **Plan-first her turda** — kod yazmadan önce onay.
- **Teknik bug olacak, kabul** — ama scope disiplini bırakma.
- Kullanıcı "hemen başlamayalım, ikimiz de yorulduk" dedi → **sıradaki chat'te taze başla**, bu memory'i oku.

## Şu an nerdeyiz
- ✅ Meta-Forge forge katmanı (tek capability üretiyor)
- ✅ Approval UI (`/system-engine → Meta-Forge`)
- ❌ Compound proposal (bileşik plan)
- ❌ Auto-execute after approval
- ❌ Internet-native execution helper (`tools/_shared/http.py`)
- ❌ Workflow/Chain builder (DAG, canvas)

## Onaylı 3 fazlı yol haritası

### Faz A — Compound Proposal + Auto-Execute
- **A1**: Meta-Forge planner'a "compound intent" modu + JSON şema (`{needs, missing, reuse}`)
- **A2**: Approval UI'a "**Approve & Run**" butonu — onay + auto-execute + chat'e stream
- **A3**: `tools/_shared/http.py` (requests + playwright fallback, Mac native ağ) + smoke

### Faz B — Workflow/Chain Builder
- "Bana X için workflow oluştur" → DAG üretimi (koşul/retry/paralel)
- `/workflows` sayfası (şu an boş kabuk) → canvas görsel önizleme
- Onay → kaydet → manuel/cron/webhook tetik

### Faz C — Idempotency + dedup bugları (EN SON)
- Compound plan hash'i daha stabil olacak → şu anki intent_hash bug'ı Faz A+B ile büyük ölçüde absorbe olacak
- Kalan artığı temizle

## Referans örnekler (kullanıcının verdiği)
- "LinkedIn'e gir son 5 postu özetle" → `[tool.linkedin_fetch, skill.summarize, agent.social_reporter]`
- "iPhone fiyatlarını karşılaştır" → `[tool.web_search, tool.price_scrape, skill.compare_table]`
- "xxx.com güvenlik taraması" → `[tool.nmap, tool.nikto, tool.sslyze, skill.vuln_report]`
- "FW'a bağlan konfig at" → `[tool.ssh_connect, tool.fw_config_push, agent.fw_operator]`
- "Insta trendleri çıkar" → `[tool.insta_fetch, tool.trend_analyze, skill.report]`

## YASAK (bu iş için)
- Bu yol haritasını atlayıp doğrudan idempotency bug fix'e dönme
- Tek capability forge ile yetinme, compound zorunlu
- Regex/whitelist/static intent map ekleme (dinamik-only kuralı)
- Proxy/gateway/API wrapper önerme (Mac native ağ)
- Kullanıcı onayı olmadan execute
- "Ufak iyileştirme" refleksi — plan-first
