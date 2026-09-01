# Session — 2026-07-04 · Capability Proposal Approval Chain

**Durum:** Yarım / mola. Onay sonrası model hâlâ "ajan yok" diyor.

## Bağlam
- Sorgu: `linkedin profilime giriş yap ve son 5 gönderimi özetleyip bana rapor çıkar`
- Beklenen: capability-proposal card çıksın → onayla → sonraki turda LLM "bu araç onaylandı ama henüz canlı registry'de yok" desin.
- Gerçek: Onay sonrası aynı sorguda LLM hâlâ "linkedin-fetcher önerildi ama sisteme tanımlanmadı" diyor.

## Bu oturumda yapılan değişiklikler

### 1. UI: onay/red butonları + açıklamalar İngilizce
- `src/components/capability-proposal-card.tsx` — buton metinleri, tooltip'ler, toaster mesajları TR→EN.

### 2. Cooldown resurface (persist=0 → SSE frame boş kalmasın)
- `local-server/lib/capability/policy.mjs` — `checkCooldown` artık `intent/reason/risk/confidence/autoTier` de döner.
- `local-server/lib/capability/hook.mjs` — cooldown blocked + `lastStatus==="pending"` → mevcut proposal resurface edilip `persisted[]`'e konur (`resurfaced:true`). Yalnız resolved statüler (approved/rejected/applied/deferred) sessizce reddedilir.

### 3. Approval state → LLM promptuna enjeksiyon
- `local-server/lib/capability/proposals.mjs` — YENİ `addCapabilityProposalStateContext()`: DB'den ilgili (pending/approved/applied/failed/deferred) proposal'ları çeker, query token'larıyla skorlar, `meta.kind="capability_state"` işaretli system message enjekte eder. `_proposalTokens()` + `_insertBeforeLastUser()` helper'ları.
- `local-server/lib/routes/chat-stream.mjs` — MLX'e göndermeden önce `addCapabilityProposalStateContext` çağrısı + trace.
- `local-server/lib/routes/chat-orchestrate.mjs` — ragMessages pipeline'ında aynı çağrı + `capability.state.injected` trace.
- `local-server/server.mjs` — `keepInSmalltalk` filtresine `capability_state` eklendi.

## Bilinen açık noktalar (mola dönüşü ilk iş)

1. **Onay sonrası tutarsızlık DEVAM EDİYOR.** Kullanıcı onayladıktan sonra aynı sorguyu tekrar sordu, model hâlâ "sistemde tanımlı ajan yok, önermiştim ama aktif değil" diyor (screenshot: Thinking·4, 117 tok out). Yani `addCapabilityProposalStateContext` ya:
   - a) enjekte edilmiyor (trace kontrol edilmedi — middleware log'u lazım),
   - b) enjekte ediliyor ama `keepInSmalltalk` filtresi çalışmıyor,
   - c) enjekte ediliyor ama LLM system mesajını okumuyor/önemsemiyor (prompt weight sorunu),
   - d) DB'deki proposal status'u `approved` yerine hâlâ `pending` (approval endpoint yazmıyor olabilir).

2. **Doğrulama SIRASI (mola dönüşü):**
   - `psql "$DATABASE_URL" -c "SELECT name,status,updated_at FROM capability_proposals WHERE name='linkedin-post-fetcher';"` — status gerçekten `approved` mı?
   - Middleware log'da `capability.state.injected` trace görünüyor mu?
   - System message payload'ı MLX'e gidiyor mu (chat-orchestrate breadcrumb)?
   - `keepInSmalltalk` bu turda smalltalk mı sanıyor? (smalltalk ise capability_state gerçekten geçiyor mu)

3. **Muhtemel ek fix:** proposal state mesajını **user turn'ünden hemen önce** değil, mevcut system message'a **append** etmek daha güçlü sinyal verebilir. Ya da meta.kind priority arttır.

## Değişen dosyalar özeti
- `src/components/capability-proposal-card.tsx`
- `local-server/lib/capability/policy.mjs`
- `local-server/lib/capability/hook.mjs`
- `local-server/lib/capability/proposals.mjs`
- `local-server/lib/routes/chat-stream.mjs`
- `local-server/lib/routes/chat-orchestrate.mjs`
- `local-server/server.mjs`

## Rollback anchor
Mola dönüşü gerekirse: değişiklikler 3 katmanda — UI (1 dosya), cooldown-resurface (2 dosya), state-injection (4 dosya). State-injection en riskli/deneysel katman; sorun çıkarsa önce onu geri al.
