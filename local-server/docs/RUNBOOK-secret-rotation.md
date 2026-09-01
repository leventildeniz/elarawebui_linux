# Runbook — Secret Rotation (Faz 11.2)

Bu runbook iki tür rotasyonu kapsar:

1. **Vault master key rotation** — `VAULT_PASSPHRASE` değişimi. Tüm
   `vault_secrets` satırları eski key ile deşifre edilip yeni key ile
   yeniden şifrelenir. Plaintext disk veya log'a düşmez.
2. **Stored secret rotation** — tek bir secret'ın (örn. third-party API
   anahtarı) değerini değiştirme. Vault key aynı kalır.

---

## 1) Vault master key rotation

### Ne zaman?

- Yıllık planlı rotasyon (önerilen)
- `VAULT_PASSPHRASE` sızdığında veya operasyon ekibi değişiminde
- DR drill sırasında

### Ön koşullar

- Eski passphrase elinizde (`OLD_VAULT_PASSPHRASE`)
- Yeni passphrase üretilmiş, güvenli kanalla saklanıyor (örn. 1Password)
- DB erişimi (`DATABASE_URL`) ve `vault_secrets` üzerinde write hakkı
- Mac middleware `com.elara.middleware` kapatılabilir durumda

### Prosedür

```bash
# 1) Önce dry-run — kaç satır etkilenecek, hata var mı bak
OLD_VAULT_PASSPHRASE='eski_değer' \
NEW_VAULT_PASSPHRASE='yeni_değer' \
DATABASE_URL='postgres://...' \
node local-server/tools/vault-rotate.mjs --dry-run

# 2) Middleware'i durdur (vault üzerinde concurrent write olmasın)
launchctl bootout gui/$(id -u)/com.elara.middleware

# 3) Gerçek rotasyon (tek transaction, fail olursa ROLLBACK)
OLD_VAULT_PASSPHRASE='eski_değer' \
NEW_VAULT_PASSPHRASE='yeni_değer' \
DATABASE_URL='postgres://...' \
node local-server/tools/vault-rotate.mjs

# 4) launchd plist'inde VAULT_PASSPHRASE'i güncelle
#    ~/Library/LaunchAgents/com.elara.middleware.plist
#    içindeki EnvironmentVariables.VAULT_PASSPHRASE değerini yenisi ile değiştir
plutil -replace EnvironmentVariables.VAULT_PASSPHRASE \
  -string 'yeni_değer' \
  ~/Library/LaunchAgents/com.elara.middleware.plist

# 5) Middleware'i tekrar yükle
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.elara.middleware.plist
bash local-server/scripts/middleware-restart.sh

# 6) Smoke ile doğrula
bun run smoke -- --base http://127.0.0.1:3005 --admin-login admin <pw>

# 7) Vault'tan bilinen bir secret oku — yeni key ile decrypt çalışmalı
curl -sS -b cookies.txt http://127.0.0.1:3005/api/vault/<scope>/<name> | jq

# 8) Audit zinciri doğrula
curl -sS -b cookies.txt 'http://127.0.0.1:3005/api/vault-audit/verify?limit=5000' | jq
# beklenen: { ok: true, scanned: N }
```

### Idempotent rerun

Araç idempotenttir: bir satır eski key ile decrypt edilemez ama yeni key
ile decrypt edilebilirse `skipped` olarak sayılır (önceki rotasyon yarıda
kalmışsa güvenli şekilde devam eder). Her iki key de işe yaramazsa
`failed` sayılır ve TRANSACTION ROLLBACK olur — kısmi yazım olmaz.

### Acil rollback

Rotasyon TEK transaction olduğu için crash anında otomatik rollback olur.
Manuel rollback gerekirse: launchd plist'i eski `VAULT_PASSPHRASE`'e geri
al, middleware'i yeniden başlat. Tabloda hiçbir satır değişmemiş olur
(commit olmamış transaction).

### Audit kanıtı

Rotasyon `vault_secrets.ciphertext`'i değiştirir, audit log'a `read`/`write`
satırı düşmez (doğrudan SQL UPDATE). Zincir bütünlüğü `prev_hash`/`row_hash`
ile korunur — verify endpoint'i hâlâ `ok:true` döner.

---

## 2) Tek bir stored secret'ı değiştirme

API üzerinden, vault key'e dokunmadan:

```bash
# Önceki değeri sil (audit: action=delete)
curl -sS -b cookies.txt -X DELETE \
  http://127.0.0.1:3005/api/vault/<scope>/<name>

# Yeni değeri yaz (audit: action=write)
curl -sS -b cookies.txt -X POST \
  -H 'Content-Type: application/json' \
  -d '{"scope":"<scope>","name":"<name>","value":"<yeni_değer>"}' \
  http://127.0.0.1:3005/api/vault

# Audit'te iki yeni satır olduğunu doğrula
curl -sS -b cookies.txt 'http://127.0.0.1:3005/api/vault-audit?scope=<scope>&limit=10' | jq
```

---

## 3) Audit zincirini yeniden inşa etme (kurtarma)

Eski/buggy bir install kalıntısı veya manuel SQL müdahalesi sonrası zincir
bozulursa:

```bash
curl -sS -b cookies.txt -X POST \
  http://127.0.0.1:3005/api/vault-audit/rebuild | jq
# beklenen: { ok: true, rebuilt: true, scanned: N }
```

Rebuild deterministiktir: aynı row → aynı `row_hash`. Üçüncü taraf bir
sistem zinciri snapshot'tan doğruladıysa, rebuild sonrası snapshot da
geçerli kalır.

---

## Sıkı kurallar

- `OLD_VAULT_PASSPHRASE` / `NEW_VAULT_PASSPHRASE` değerleri **shell
  history'sine düşmemeli** → komutu `read -s` ile interaktif girin veya
  geçici env file kullanın ve sonrasında `shred -u` ile silin.
- Plaintext secret değerleri stdout/stderr/log'da **asla** görünmemeli.
  `vault-rotate.mjs` ve bridge bunları print etmez; yamalardan sonra
  doğrulayın.
- Rotasyon sonrası eski passphrase'i **30 gün** içinde imha edin (DR
  pencerelerinde tekrar gerekebilir).
