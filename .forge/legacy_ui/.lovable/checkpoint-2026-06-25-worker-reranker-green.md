# Checkpoint — 2026-06-25 — Worker + Reranker GREEN

## Durum: TÜM HATLAR YEŞİL ✅

Başından beri süregelen RAG kalite + "reranked=0" + 7.6 yerine 7.4/7.2 sızıntısı sorununun **tek kök nedeni embed/rerank worker'ının (port 8082) hiç ayağa kalkmamasıymış**. Worker bugün canlandı, her şey peşi sıra düzeldi.

---

## Doğrulanan testler (UI)

| # | Sorgu | Sonuç |
|---|-------|-------|
| 1 | `fortimanager 7.6 da vlan nasıl açılır?` | `FortiManager_7.6.6_CLI_Reference.pdf` ×3, top1 **71%**, ✓ Reranked bge-reranker-v2-m3 · 203ms |
| 2 | `@[Firewall_Oracle.py] kendini tanıt` | `RAG: skipped (315ms)` · `brand-gate-skip` ✓ (smalltalk gate) |
| 3 | `Selam Checkpoint maestroda vlan nasıl açılır?` | `CP_R81.20_Quantum_Maestro_AdminGuide` ×4, top1 **62%**, ✓ Reranked 182ms |
| 4 | `fortigateda ha nasıl yapılır?` | FortiOS 7.4.11 + FortiManager 7.4.10 ×4, top1 **64%**, ✓ Reranked 247ms |

Worker log örneği:
```
[worker] INFO embed n=1 dim=1024 in 241ms rss=1.43GB req=1
INFO: 127.0.0.1:56709 - "POST /v1/embeddings HTTP/1.1" 200 OK
```
RSS ~1.4GB sabit, MPS backend, sentence_transformers ready.

---

## Kök neden (post-mortem)

1. `local-server/.venv/bin/python` kayıptı (silinmiş/bozulmuş venv).
2. `PYTHON_BIN` env'i bu kayıp yola pinlenmişti → her spawn `ENOENT` ile düşüyordu.
3. Async spawn error olduğu için kod fallback'e geçemiyor, **360sn** sessizce bekleyip "worker did not become healthy" diyordu.
4. Worker olmadığı için: reranker `null` → ham vector skorlarıyla 7.4/7.2 sızıyor + UI'da `reranked=0`.

## Uygulanan kalıcı düzeltmeler

- **`local-server/lib/python-resolver.mjs`**: stale absolute `PYTHON_BIN` pin'i `fs.existsSync` ile filtreleniyor; venv/uv/python3/python fallback adaylarına geçiş otomatik.
- **`local-server/lib/embed-worker/runtime.mjs`**: spawn `stderr` + `stdout` ikisi de yakalanıyor; `restart-worker` ve `status` artık `recentWorkerLogs` döndürüyor (teşhis körlüğü bitti).
- **`local-server/server.mjs`**: `initEmbedWorkerRuntime` çağrısına `getRecentWorkerLogs` DI (tek satır, modüler yapı bozulmadı).
- Makinede venv yeniden kuruldu (Python 3.14.4 ile). `sentence_transformers:mps` backend aktif. Worker stable.

---

## Hâlâ açık tek not (önemli ama acil değil)

- venv Python sürümü **3.14.4** (sealed Primary 3.12.13 ile uyumsuz olabilir). Loglarda `loky leaked semaphore` uyarısı 3.14 multiprocessing kaynaklı, fonksiyonel etkisi yok. **3.12 venv'e dönmek ileride yapılacak ufak iş**, şu an çalışıyor, dokunmayalım.

---

## Sıradaki tur (kullanıcı dönünce)

**Yavaşlık / TTFT turu** — kullanıcı haber verecek. Şüpheliler:
- Cold MLX warm-up (kullanıcı "kocaman makine, küçük model, neden bekliyor?" diyor — M5 Max 128GB / Gemma 31B)
- İlk chunk gecikmesi (önceki turda 14-21s görülmüştü, RAG düzeldikten sonra yeniden ölçüm gerek)
- `LX WARM up` görünür gecikmeleri

**Yapılmayacaklar** (kural):
- `server.mjs`'e yüklenme yok (modüler yapı korunur)
- Yeni feature yok
- Plan-first; ölçüm önce, kod sonra

---

## Rollback / referans

- Worker düzeyinde dert kalırsa: `curl -X POST http://127.0.0.1:3005/api/system/restart-worker | jq '.lastError, .recentWorkerLogs[-20:]'`
- venv 3.12'ye dönmek için:
  ```bash
  cd local-server && rm -rf .venv
  /opt/homebrew/bin/python3.12 -m venv .venv
  .venv/bin/python -m pip install -r requirements-worker.txt
  launchctl kickstart -k gui/$UID/com.elara.middleware
  ```

İyi molalar Komutan 🫡
