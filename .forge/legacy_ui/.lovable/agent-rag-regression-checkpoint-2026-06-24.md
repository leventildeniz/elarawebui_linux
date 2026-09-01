# Agent RAG Regression Checkpoint — 2026-06-24

## Kısa karar

Bu noktada **kod kurcalama durdu**. Sorun RAG ayarı çevirmekten öteye geçti; artık önce ölçüm, izolasyon ve gerekirse rollback yaklaşımıyla gidilecek.

Kullanıcı gözlemi net:

- RAG konusu sürekli gündeme gelince proje motivasyonu düşüyor.
- Model tarafında RAG zaten kapalı.
- Agent RAG ayrı hattan çalışıyor.
- Bu davranış yaklaşık **5-6 saat önce yoktu**, sonradan bir regresyon gibi başladı.
- Deneme-yanılma değil, nokta atışı teşhis isteniyor.

## Semptomlar

### CLI son ölçüm

Komut:

```bash
bun run local-server/scripts/agent-rag-debug.mjs --agent Firewall_Oracle "fortigate firewallda NAT kuralı örneği"
```

Çıktı özeti:

```text
PHASE  rag_probing
PHASE  rag_slow ms=8000
PHASE  rag_done hits=9 decision=inject
PHASE  spawning
PHASE  running
PHASE  first_chunk t=21523ms

SSE consumed in 104850ms · agent_chunk frames=1352

RAG    enabled=true hits=9 decision=inject top1=1.4 tau=? mode=multi-brand-override
RERANK <absent in rag.meta — backend reranker bilgisi göndermedi>
TELEM  thinkMs=21513 ragMs=9107 totalMs=95725 tokensOut=1086
OK     ok=true latencyMs=95725
```

Okuma:

- RAG probe tarafı yaklaşık **8-9 saniye** yiyor.
- İlk token yaklaşık **21.5 saniye** sonra geliyor.
- Toplam süre yaklaşık **95-105 saniye**.
- Cevap **1086 token** üretmesine rağmen kullanıcı gözünde yarıda kesilmiş gibi.
- Bu sadece “RAG yavaş” değil; agent/model üretim hattında ek baskı, stop/token/timeout veya wrapper davranışı olabilir.

### UI ekran görüntüsü gözlemi

Ekran görüntüsünde iki ayrı agent çağrısı var:

1. `@[Analytics_Oracle.py] kendini tanıt`
   - UI meta: `Think: 1447ms · RAG: 5878ms · Total: 12733ms · 180 tok`
   - RAG debug panelinde `intent=query + smalltalk`, `decision=inject`, fakat sorgu `kendini tanıt`.
   - Self-intro / smalltalk tarzı çağrıya bile RAG bağlamı karışıyor.

2. `@[Adc_Maestro.py] netscaler nitro api nedir?`
   - UI meta: `Think: 73468ms · RAG: 1048ms · Total: 85119ms · 213 tok`
   - 213 token gibi kısa cevap için 85 saniye kabul edilebilir değil.
   - Cevap akışı yarıda kesiliyor gibi duruyor.

## Son birkaç saatte yapılan müdahaleler

Bu dosya, “neye dokunulduğunu unutmayalım” diye yazıldı.

### 1. Agent RAG debug görünürlüğü

Dosyalar:

- `local-server/lib/routes/agent-run.mjs`
- `local-server/scripts/agent-rag-debug.mjs`
- `src/components/rag-control-panel.tsx`

Amaç:

- Agent RAG kararlarını CLI ve UI üzerinden görünür yapmak.
- `rag_done`, `rag_slow`, `first_chunk`, `agent_done.rag`, source listesi ve telemetry okumak.

### 2. Agent RAG deadline ve smalltalk skip denemesi

Dosyalar:

- `local-server/lib/agent-rag.mjs`
- `local-server/lib/routes/agent-run.mjs`
- `agents/_shared/mlx_runner.py`

Amaç:

- Self-intro / smalltalk agent turlarında RAG devreye girmesin.
- Agent RAG probe sonsuza yakın beklemesin, deadline ile düşsün.
- Thinking kapatma sinyali agent subprocess env tarafında da taşınsın.

Sonuç:

- Bazı metrikler iyileşmedi.
- Hatta kullanıcı gözlemine göre cevaplar daha bozuldu / yarım kalmaya başladı.

### 3. Gemma4 template / thinking stub müdahalesi

Dosyalar:

- `agents/_shared/mlx_runner.py`
- `local-server/lib/chat-templates.mjs`

Amaç:

- Gemma4 native protocol içinde thinking disabled iken boş thought-channel stub üretmeyi kaldırmak.

Risk / not:

- Bu müdahale sonrası kullanıcı “daha da sapıttı ve yavaşladı” dedi.
- Bu yüzden Gemma4 template / stop-sequence hattı tekrar şüpheli listesinde.

### 4. Direct agent mention için outer chat bypass denemesi

Dosyalar:

- `local-server/lib/routes/chat-stream.mjs`
- `local-server/lib/routes/chat-orchestrate.mjs`
- `local-server/lib/agent-bridge.mjs`
- `local-server/.rag-settings.json`

Amaç:

- `@[agent.py]` ile gelen doğrudan agent çağrılarında outer chat RAG/LLM katmanını bypass etmek.
- Agent adını temizleyip gerçek kullanıcı sorusunu agent’a vermek.

Sonuç:

- Kullanıcı gözlemine göre sorun devam ediyor.
- CLI doğrudan `/api/agents/:id/run` hattından gittiği için chat UI bypass tek başına ana sebep değil.

## Şu anki ana hipotezler

### H1 — Agent wrapper token/stop/timeout prangası

Belirti:

- 1000+ token üretiyor ama cevap yarım gibi.
- 213 tokenluk cevap bile 85 sn sürebiliyor.
- `tokensOut`, `max_tokens`, stop sequence, subprocess timeout ve stream parser birlikte incelenmeli.

Öncelik: **çok yüksek**.

### H2 — Gemma4 native template / stop sequence regresyonu

Belirti:

- Thinking kapatma ve thought-channel müdahaleleri sonrası davranış daha kötüleşti.
- Stop listesi veya prompt render modeli erken kesiyor ya da tersine modeli gereksiz düşünmeye zorluyor olabilir.

Öncelik: **çok yüksek**.

### H3 — Agent RAG context ağır veya yanlış bağlam veriyor

Belirti:

- RAG 8-9 sn yiyor.
- Fortigate NAT sorusunda kaynaklar SD-WAN / farklı version dokümanlarına kayabiliyor.
- Self-intro tarzı çağrılarda bile RAG injection görüldü.

Not:

- RAG yavaşlatıyor ama tek başına 95 sn açıklamıyor.

Öncelik: **orta-yüksek**.

### H4 — Son 5-6 saatteki değişikliklerden biri regresyon yarattı

Belirti:

- Kullanıcı açıkça “5-6 saat önce yoktu” dedi.
- Bu yüzden git/history üzerinden son değişiklik bloğu incelenmeli.

Öncelik: **çok yüksek**.

## Sonraki turda yapılacaklar — kod yazmadan önce

### A. Çıplak model testi

Amaç: MLX/Gemma4 aynı promptta RAG ve agent wrapper olmadan kaç saniyede cevap veriyor?

Beklenen ayrım:

- Çıplak model de yavaşsa sorun model/template/runtime.
- Çıplak model hızlıysa sorun agent wrapper/RAG/chat katmanı.

### B. Agent no-RAG testi

Amaç: Aynı `Firewall_Oracle` çağrısını `ELARA_AGENT_RAG_ENABLED=0` ile ölçmek.

Bakılacak metrikler:

- first_chunk
- totalMs
- tokensOut
- cevap yarıda kesiliyor mu?

### C. Agent RAG açık/kapalı A-B testi

Aynı soru:

```text
fortigate firewallda NAT kuralı örneği
```

Karşılaştırılacak:

- RAG açık CLI
- RAG kapalı CLI
- Direct model / MLX
- UI direct agent

### D. Stop/max token/finish reason kanıtı

Amaç: “yarıda kesiyor” gerçekten token limiti mi, stop sequence mi, subprocess kill mi?

Gereken kanıt:

- agent subprocess stdout/stderr tail
- runner tarafında finish/stop nedeni varsa log
- `ELARA_AGENT_MAX_TOKENS`
- model row `params.max_tokens` / agent row max token / wrapper clamp
- Gemma4 stop sequences

### E. Son 5-6 saatlik değişiklikleri izole et

Öncelikli dosyalar:

- `agents/_shared/mlx_runner.py`
- `local-server/lib/chat-templates.mjs`
- `local-server/lib/agent-rag.mjs`
- `local-server/lib/routes/agent-run.mjs`
- `local-server/lib/routes/chat-stream.mjs`
- `local-server/lib/routes/chat-orchestrate.mjs`
- `local-server/lib/agent-bridge.mjs`
- `local-server/.rag-settings.json`

Yaklaşım:

- Önce diff oku.
- Sonra tek tek rollback adayı belirle.
- Blind patch yok.

## Şimdilik yapılmayacaklar

- Yeni RAG knob eklenmeyecek.
- Retrieval scoring tekrar kurcalanmayacak.
- Yeni prompt guard yazılmayacak.
- “Ufak fix” adı altında agent/chat hattına yeni katman eklenmeyecek.
- Kullanıcı onayı olmadan rollback veya kod değişikliği yapılmayacak.

## Net not

Bu regresyonun ana konusu artık “RAG kalitesi” değil.

Asıl soru:

> Agent çağrısı neden 5-6 saat öncesine göre birden 80-105 saniyeye çıktı ve neden cevaplar token/stop yemiş gibi yarım kalıyor?

Bir sonraki çalışma bu soruya kanıtla cevap verecek.
