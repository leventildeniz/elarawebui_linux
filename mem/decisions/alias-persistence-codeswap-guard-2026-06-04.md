---
name: Alias persistence — code-swap guard
description: brand-aliases.json runtime state olmasına rağmen local-server klasörünün altında — FULL restore/pending-swap eski/boş archive'dan ezerse aliaslar silinmiş gibi görünür. Fix: restore staging'ine canlı local-server/data overlay'i + boot-time alias audit log.
type: feature
---

Belirti: Kullanıcı UI'dan alias ekliyor + re-enrich yapıyor; bir süre sonra Aliases (0) görüyor; aynı durum 3 kez tekrar etti. Normal middleware reboot ile silinmiyor (boot kodunda silen hat yok; Save guard'ı boş wipe'ı bloklar; .bak dosyası bırakılır).

Kök şüphe: FULL restore / pending-swap hattı (`local-server/lib/routes/backup.mjs:restoreSnapshot` + `local-server/server.mjs:20-44 pending-swap apply`) `local-server` dizinini bütün olarak staging'den swap'lıyor; arşivde eski/boş `data/brand-aliases.json` varsa canlı dosyayı ezer. `data/` runtime state olmasına rağmen kod dizininin altında.

Fix:
1. `backup.mjs` restore staging adımı (kırılım 1b): staging yazıldıktan sonra `_copyDirRecursive(PROJECT_ROOT/local-server/data → stagingDir/server/local-server/data)`. Swap renameSync ile uygulandığında canlı runtime state korunur. Audit log: `restore.preserve_runtime_state.ok`.
2. `server.mjs` boot-time alias audit: her boot'ta `[boot:brand-aliases] size=… mtime=… sha=… brands=…` — silinme zamanı reboot mu yoksa restore mu olduğunu sonradan ayırt etmek için.

Açık konular:
- Daha temiz mimari: `data/` klasörünü `local-server/` dışına taşımak (örn. `state/`). Şimdilik path değişmedi; sadece swap koruması eklendi.
- `.rag-settings.json` aynı klasörde — overlay tüm `data/` dizinini koruduğu için o da korunur.

Kullanıcı sıradaki adım: fortimanager/fortianalyzer/fortios alias'larını tekrar ekleyip re-enrich, sonra UI'da kalıcı kaldığını doğrula. Boot log artık silinme nedenini deşifre eder.
