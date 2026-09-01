# AUDIT — MLX cold/warm + agent vs chat first-token (2026-06-03)

**Tetikleyici:** Kullanıcı: "ajan roket gibi cevap veriyor, 1sn altında". Chat
"selam" ise 34–38 saniye. Önce prompt boyutu (Plan B) sıkıntı sanılmıştı;
ölçüm bunu reddetti. Bu doküman gerçek bottleneck'i belgeliyor.

---

## 1. Ajan ve chat'in MLX hedefi

| Eksen | Chat hattı | Agent hattı |
|---|---|---|
| Endpoint | `http://127.0.0.1:8001/v1/completions` | `http://127.0.0.1:8001/v1/completions` |
| Model | DB → `runtime-registry` → `streamMlxCompletion` | env `ELARA_MLX_MODEL` (genelde DB ile aynı slug) |
| Template | `lib/chat-prompt.mjs` → qwen2.5 + smalltalk için `prompt_prefix=/no_think` + `chat_template_kwargs.enable_thinking=false` | `agents/_shared/mlx_runner.py` → `renderPromptForModel` (aynı template registry'nin Python aynası) |
| Transport sarmalı | `mlxQueue.enqueueStream` + `streamFromLocalLLM` + `streamMlxCompletion` (state machine + warmup + abort + self-heal + invariants) | OpenAI Python SDK `client.completions.create(..., stream=True)` — kuyruk YOK, watchdog YOK, dirty-flag YOK |
| Stop / sampling | `models.stop_sequences` + RAG paneli + intent-bazlı `max_tokens` cap (smalltalk 220 / query 1000 / rag 2000) | `agents.params` (UI'dan, geniş aralık, sessiz cap YOK) |
| Smalltalk-only ekler | `/no_think` prefix + `enable_thinking=false` template kwarg + system guard ("skill/agent tetikleme") | YOK — ajan kendi system prompt'unu kullanır, smalltalk modifikasyonu yapılmaz |

**Sonuç:** Aynı port, aynı binary (`mlx_lm.server`), aynı model, aynı endpoint.
Fark wrapper'da DEĞİL — fark **request payload'ında** (smalltalk lane'in
template kwarg + prefix değişikliği).

---

## 2. Ölçüm — `chatdebug-9.log` + `elara-chat-debug-20260603-010526.txt`

| Turn | intent | input | prompt size (char/≈tok) | first-token | cold-flag | idleMs |
|---|---|---|---|---|---|---|
| T1 | smalltalk | "selam" | 572 / 143 | **34286 ms** | true | epoch (lastActivityAt=0) |
| T2 | smalltalk | "naber nasılsın" | (size dump yok) | **37963 ms** | **false** | 6337 |
| T3 (fulldebug) | rag | gerçek soru | 4448 / 1112 | **7620 ms** | false | 6295 |

Üç gerçek:

1. **T2 cold=false, idleMs=6337ms** → `recordMlxActivity()` doğru tetiklendi,
   MLX sıcak. Buna rağmen first-token 38 sn. **Cold-start TEK BAŞINA suçlu değil.**
2. **T2 warm (~38s) > T1 cold (~34s)** — warm-up beklenen hızlandırmayı
   getirmedi; gürültü payı içinde aynı. Cold/warm sinyali first-token süresine
   bağlanmıyor.
3. **T3 RAG turu warm, 1112 token prefill, 7.6 sn first-token.** Aynı sıcak
   MLX, 8× büyük prompt, 5× HIZLI cevap. → Smalltalk turunda **prompt
   boyutuyla orantısız spesifik bir overhead** var.

`approxTokens` smalltalk için 143; eğer prefill MLX'in sınırlayıcısı olsaydı
T3 (1112 token) T1'den ~8× yavaş olurdu. Ters gerçekleşti.

---

## 3. Hipotez — smalltalk-spesifik template kwarg cache invalidation

Smalltalk lane'in T1/T2'de MLX'e gönderdiği request, RAG turundaki request'ten
**iki noktada** farklı:

- `chat_template_kwargs: { enable_thinking: false }` (RAG turunda YOK)
- prompt başında `/no_think` prefix satırı (RAG turunda YOK)

`mlx_lm.server` 0.31.3 her chat template kwarg değişikliğinde tokenizer
template'i yeniden render eder; bazı durumlarda KV cache'i de invalide eder
(Hugging Face transformers `apply_chat_template` cache key'i kwargs'ı hash
eder). Mevcut konfigürasyonda:

- T1 (smalltalk): kwarg X gönderildi → MLX template recompile + KV reset
- T2 (smalltalk): aynı kwarg X → ama T1'den sonra system prompt'taki
  timestamp/preamble değişmişse hash farklı → yine recompile
- T3 (rag): kwargs YOK → MLX default path, KV cache stabil → 7.6 sn

Bu hipotez **ölçülebilir**: smalltalk lane'in template kwarg'ını kapatıp aynı
"selam" turunu tekrarlamak. first-token RAG turuna yaklaşırsa (5–10 sn)
hipotez doğru; aynı kalırsa (35 sn) başka bir şey suçlu (büyük olasılıkla
prompt prefix / stop set).

Ajan hattının <1 sn cevabı bu hipotezle uyumlu: ajan template kwarg
göndermez, `/no_think` eklemez → MLX cache stabil, ilk istek dışında prefill
1–2 sn, çıktı 1–3 sn. (Ama bunu da yan yana ölçmeden iddia olarak satmıyoruz —
adım 5'e bk.)

---

## 4. İkincil bulgu — `idleMs=1780438114284` (T1)

Bu sayı `Date.now() - 0`. `MLX_TRANSPORT.lastActivityAt` middleware restart
sonrası **ilk** turda hâlâ 0. `recordMlxActivity()` first-token'da çağrılıyor
(`chat-orchestrate.mjs:966`, `chat-stream.mjs:472`), ama o anda first-token
henüz gelmediği için lastActivityAt henüz set DEĞİL. Yani T1 için `cold=true`
hesabı doğru. T2'de `idleMs=6337` ile cold=false → mantık çalışıyor.

**Aksiyon yok** — mantık doğru, sadece UI'da/log'da gözüken devasa idleMs
sayısı kafa karıştırıyor. İleride istersek `lastActivityAt=0` durumunda
`idleMs="never"` basabiliriz (kozmetik).

---

## 5. Önerilen sıradaki ölçüm (fix DEĞİL)

Tek değişkeni izole eden 3 turluk probe — chat üstünden, kullanıcının
makinesinde, KOD DOKUNMADAN:

1. **Baseline (mevcut):** "selam" → first-token ölç. Beklenti: ~35 sn.
2. **`/no_think` prefix'i kapat** — RAG paneli → `disableThinkOnSmalltalk = false`
   (canlı toggle, restart gerekmez). Aynı "selam" → first-token ölç.
3. **Hem prefix hem template kwarg kapalı** — `disableThinkOnSmalltalk = false`
   + modeli `chat_template_kwargs={}` yapacak şekilde model editör'den
   `chat_template_kwargs` JSON'unu boşalt. Aynı "selam".

Beklenen tablo:

| Konfig | first-token (hipotez) |
|---|---|
| Baseline | ~35 sn |
| Prefix off | ~30 sn (prefix tek başına azınlık etken) |
| Prefix + kwargs off | ~5–8 sn (RAG turuna yaklaşır) |

**Eğer adım 3'te hâlâ ~35 sn ise** hipotez yanlış — sıradaki şüpheli
mlx_lm.server'ın stop_sequences listesini her turda yeniden hash'lemesi veya
metal compute kernel cache miss (Apple Silicon GPU pipeline rebuild). O
durumda mlx-lm 0.31.3 → 0.32 / 0.33 upgrade veya `--prompt-cache` flag testi
(yeni mlx-lm sürümünde varsa) gündeme gelir.

Ajan tarafında karşılaştırma: aynı kullanıcı `@[copy_smith.py] selam`
gönderir → ajan stdout ilk byte'a kadar süreyi ölçer. Eğer ajan da 30+ sn
ise, "ajan hızlı" gözlemi yanılgıdır (önceki ajan turları MLX henüz cache'i
stabil iken yapılmıştı). Eğer ajan gerçekten <2 sn ise hipotez 5× güçlenir.

---

## 6. Bu raporun bağlamı

- **Yapılan:** prompt boyutu breadcrumb'ı yerli yerinde, çürüten ölçüm alındı,
  ajan-vs-chat endpoint farkı netleşti, cold-flag mantığı doğrulandı, asıl
  şüpheli (smalltalk template kwarg) somutlandı.
- **Yapılmayan:** hiçbir knob değişmedi, kod tutulmadı, MLX restart olmadı.
- **Sonraki tur için kapı:** Kullanıcı "git §5'i ölç" derse `RAG_SETTINGS`
  toggle + chatdebug-live-watch ile 3 koşullu probe; rapor güncellenir,
  fix ondan sonra ayrı plan.
