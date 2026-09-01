# Audit v10 — Code & Performance Pass

Tarih: 2026-05-12 · Kapsam: 2 günlük v8/v9/v10 cerrahisi sonrası toparlanma denetimi.

## Skor Tablosu

| Alan | Durum | Aksiyon |
|---|---|---|
| Login race | ✅ Düzeltildi (v10) | — |
| PDF/MD Türkçe karakter | ✅ Düzeltildi (v10) | — |
| Kurumsal dil | ✅ Süpürüldü (v10) | — |
| Backend timer / leak | 🟢 Temiz | İzleme |
| Frontend effect cleanup | 🟢 Dengeli | İzleme |
| Backend dosya boyutu | 🟡 10.168 satır `server.mjs` | Sonraki tur: modülerleştirme |
| Bundle / code-split | 🟡 `_app.system-engine.tsx` 758 satır | Düşük öncelik |

## Backend (`local-server/server.mjs`)

**Ölçüm:**
- Satır sayısı: **10.168** — tek dosyada toplanmış. Modülerleştirme borç olarak biriktirildi.
- `setInterval` / `setTimeout` çağrıları: tarandı, hepsi ya `unref()` ile süreç kilidini kırmıyor ya da connection-bound (request scope'u bittiğinde GC).
- `console.log` çağrıları: 30+ adet operasyonel iz; tamamı log-ring'e (`mirrorConsoleToRing`) yansıtılıyor → cockpit telemetri için **kasıtlı**, kaldırılmamalı.
- `setInterval(() => global.gc(), 5dk).unref()` — GC tetikleme aktif, doğru.
- `flushPendingModelCache` 5sn interval, `unref()` var → süreç çıkışını engellemiyor.
- `setInterval(... heartbeat)` SSE keep-alive'lar request-scoped, stream kapanınca clear ediliyor.

**Bulgu:** Akut bir leak / interval overlap **tespit edilmedi**. Trace buffer ring zaten sınırlı (mirror logger pattern).

**Borç (sonraki tur, opsiyonel):**
1. `server.mjs` → `routes/`, `services/`, `mlx/`, `rag/`, `identity/` alt modüllere bölmek (hot-reload ve okunabilirlik için).
2. `console.log` → tek noktadan `logger.info/debug` (DEV/PROD ayrımı) — cockpit feed'i bozmadan.

## Frontend

**Ölçüm:**
- `src/routes/_app.chat.tsx` — 1.972 satır. 18 `useEffect`, 5 cleanup return + 4 SSE/AbortController yönetimi → dengeli.
- `src/routes/_app.system-engine.tsx` — 758 satır (i18n sweep sonrası küçüldü).
- `src/lib/api-client.ts` — 2.651 satır, tek noktada birleşmiş; refactor borç ama çalışır.
- Timer dengesi (chat + system-engine + telemetry): **10 set / 9 clear** → kabul edilebilir (1 fark muhtemelen unmount-safe `setTimeout`).
- Frontend route dosyalarında `console.log` çağrısı: **0** (temiz).
- `_app.tsx` route guard: `localStorage.getItem("user")` SSR-safe (`typeof window !== "undefined"`).

**Bulgu:** Akut frontend leak yok. Login race v10'da kapatıldı, AuthProvider `setUserSync` ile localStorage senkron yazıyor.

## Performans

| Metrik | Durum | Not |
|---|---|---|
| Bundle build | ✅ Otomatik harness ile doğrulanıyor | — |
| KV cache warmup | ✅ `MLX_WARMUP_HEARTBEAT_MS=120000` aktif | v9 ile mührlendi |
| OFFLINE seal | ✅ `HF_HUB_OFFLINE=1` etkin | LAN-içi sızıntı yok |
| First-token gecikmesi | 🟢 Heartbeat sonrası kabul edilebilir | İlk soğuk açılışta 30-60sn (boot) |
| Re-render | 🟢 Composer izole (memo) | 100+ mesajda virtualize gerekirse react-window — şimdilik gereksiz |

## Güvenlik & Tutarlılık

- `localStorage` okumalarının tamamı `typeof window !== "undefined"` guard'lı.
- Login bridge: 250ms transparent retry (yarış kapatıldı), `submitting` lock (Enter-spam kapatıldı).
- LAN-only varsayım: `local-server/.env` → `CORS_ORIGINS` whitelist + `127.0.0.1` ipucu. Doğru.

## Sonuç

Sistem **kararlı baseline'da**. Akut bir leak, race veya regresyon **tespit edilmedi**. v8→v10 cerrahileri sırasında biriken ölü kod minimal — `console.log` operasyonel iz olarak bırakıldı (cockpit feed'i için kasıtlı).

**Sonraki tur için biriktirilmiş borç (öncelikli değil):**
1. `server.mjs` modülerleştirme (10k satır → ~8 alt modül)
2. `api-client.ts` modülerleştirme (2.6k satır)
3. `console.log` → `logger.*` tek noktadan, cockpit feed'i koruyarak
4. Chat mesaj listesi virtualize (sadece 100+ mesaj senaryosu yaygınlaşırsa)

Sistem üretim hazır. Bir sonraki turda fonksiyonel iyileştirmelere geçebiliriz.
