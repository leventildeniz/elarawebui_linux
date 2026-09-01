---
name: MLX zombi kronikleşti + Meta-Forge iki yönlü sapma (2026-07-04 akşam)
description: Chat pratikte ölüyor — MLX zombi self-heal işe yaramıyor, kullanıcı günlük restart-MLX rutinine girdi. Aynı gün meta-forge lane smalltalk'a da tetikleniyor (dün: hiç açılmıyor / bugün: her şeye açılıyor). İkisi ayrı semptom, ikisi de yarın ölçülecek. Kod yok.
type: feature
---

# Durum (2026-07-04 akşam, mola devam)

Chat UI kanıtı (screenshot): normal muhabbette bile
- "WAITING FOR RUNTIME SLOT · 59s"
- "Model ilk tokeni 60s içinde üretmedi; otomatik zombi slot temizliği denendi. Self-heal:
   idle (no detail). Transport: dirty=true inflight=1 · last reset: skipped."
- Kullanıcı: "sürekli MLX servisini reboot ediyorum çünkü başka türlü ayağa kalkmıyor sistem"

Aynı oturumda meta-forge lane smalltalk'a da tetikleniyor (dün tam tersi: `t=0ms
mode=execution-guard subKind=-`, hiç açılmıyordu). Yani semantic classifier bir gün
NULL'a bir gün META_FORGE'a düşüyor — kararsız.

# Bildiğimiz kesinler

1. Self-heal ZATEN kurulu ve `mlxSelfHealEnabled=true` (RAG_SETTINGS'te).
   `triggerMlxZombieSelfHeal`, `recordMlxAbort`, `resetMlxKeepAliveAgent`
   mlx-transport.mjs'te. Ama pratikte "last reset: skipped" diyor →
   **self-heal tetikleniyor ama iş yapmıyor** ya da tetik koşulu tutmuyor.
2. `dirty=true inflight=1` → önceki turun slotu asla release edilmemiş.
   Break-4 GREEN (2026-05-30) sonrası ilk kez bu kadar kronik.
3. Meta-forge iki yönlü sapma = semantic classifier'ın kendisi kararsız
   (anchor cache init timing, LLM adjudicator timeout, execution-guard
   short-circuit — üçünden en az biri hasta).

# Yarın için ölçüm sırası (KOD YOK, sadece ölçüm)

**P0 — MLX zombi kroniği (chat ölüyse gerisi anlamsız):**
- `[mlx:selfheal]` log satırlarını topla — kaç kez tetiklendi, kaç kez
  gerçekten kill+respawn yaptı, kaç kez "skipped" dedi ve NEDEN skipped?
- `getMlxTransportSnapshot()` state histogramı: `dirty=true inflight=1`
  ne kadar sürüyor, hangi state'ten hangi state'e geçiyor?
- launchd respawn: `launchctl print gui/$UID/com.elara.mlx-server` — restart
  count artıyor mu, yoksa self-heal launchd'yi hiç tetiklemiyor mu?
- `killPortOwnerAndWait` gerçekten port 8001'i boşaltıyor mu, yoksa
  CLOSE_WAIT'te kalan bağlantılar mı zombi slot yaratıyor?

**P1 — Meta-forge iki yönlü sapma:**
- `[SEMANTIC-CLASSIFIER]` log: aynı cümle için 5 arka arkaya çağrıda
  kararlar tutarlı mı, yoksa flap ediyor mu?
- `execution-guard` short-circuit koşulu (dün ölçüm listesindeydi, hâlâ açık).
- `INTENT_ANCHORS.meta_forge` × smalltalk cümleleri cosine similarity —
  anchor'lar smalltalk'a da yakın mı (false-positive kaynağı)?

**P2 — Chat latency baseline** (P0/P1 çözülmeden ölçüm bile yapılamaz).

# KURALLAR (dünkü mola kararı hâlâ geçerli)

- Regex / keyword gate / threshold oynaması YASAK.
- "Küçük iyileştirme" refleksi YASAK.
- Self-heal koduna panik-fix YASAK — önce NEDEN skipped diyor, onu bul.
- MLX servisi restart etmek ARIZAYI ÖRTÜYOR, kök nedeni gizliyor.
  Yarın ilk oturum: bir sonraki zombi olduğunda restart etmeden önce
  `launchctl print` + `lsof :8001` + `[mlx:selfheal]` tail al.

# Kullanıcı notu

"Takıntı haline getirip şimdi çözmeye kalkmayalım. En azından şu an için
sorunu ve kaynağını biliyoruz." → mola disiplini korunuyor, bugün kod yok.
