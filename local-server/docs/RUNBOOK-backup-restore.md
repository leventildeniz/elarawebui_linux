# Runbook — Backup & Restore Drill (Faz 12)

İki script + bir disiplin:

1. **`scripts/db-backup.sh`** — `pg_dump -Fc` snapshot + SHA-256 manifest +
   retention (default 14 dosya). Cron/launchd ile günlük çalışmalı.
2. **`scripts/db-restore-drill.sh`** — en son dump'ı geçici bir DB'ye restore
   eder, kritik tablo satır sayılarını üretimle kıyaslar, vault_audit
   hash-chain'ini drill DB'de doğrular, sonunda drill DB'yi DROP eder.
   Haftada bir tetiklenmeli.

> Disiplin: **Restore edilmemiş backup, backup değildir.** Drill geçmeden
> hiçbir snapshot'a "kullanılabilir" demeyiz.

---

## 1) Günlük backup

### Manuel deneme

```bash
bash local-server/scripts/db-backup.sh
ls -1t ~/elara-backups | head
```

Beklenen çıktı:

```
[backup] elara_db → /Users/<you>/elara-backups/elara_db-20260516-120000.dump
[backup] done — size=12M  sha256=...
[backup] retention: keep newest 14
[backup] OK
```

### Cron (önerilen — günlük 03:15 UTC)

```cron
15 3 * * * /bin/bash /path/to/local-server/scripts/db-backup.sh \
  >> /tmp/elara-backup.log 2>&1
```

### launchd (Mac, önerilen)

`~/Library/LaunchAgents/com.elara.backup.plist` oluştur, `StartCalendarInterval`
ile günlük 03:15. `BACKUP_DIR` ve `DATABASE_URL`'i `EnvironmentVariables`
altına koy. Mevcut `com.elara.middleware.plist` deseniyle birebir.

---

## 2) Haftalık restore drill

### Manuel

```bash
bash local-server/scripts/db-restore-drill.sh
```

Beklenen son satır: `[drill] PASS — dump kurtarılabilir, kritik tablolar tutarlı`.

### Belirli bir dump'ı dene

```bash
bash local-server/scripts/db-restore-drill.sh ~/elara-backups/elara_db-20260516-031500.dump
```

### Cron (haftalık Pazar 04:00 UTC)

```cron
0 4 * * 0 /bin/bash /path/to/local-server/scripts/db-restore-drill.sh \
  >> /tmp/elara-restore-drill.log 2>&1
```

---

## 3) Felaket kurtarma (gerçek restore)

> Üretim DB'sini bir backup'tan **yerine** geri yüklüyorsan:

```bash
# 1) Middleware durdur (yeni yazım gelmesin)
launchctl bootout gui/$(id -u)/com.elara.middleware

# 2) Mevcut elara_db'yi yeniden adlandır (zarar yedek)
psql -h 127.0.0.1 -U sovereign -d postgres \
  -c "ALTER DATABASE elara_db RENAME TO elara_db_pre_restore_$(date +%s);"

# 3) Yeni elara_db oluştur ve dump'ı restore et
psql -h 127.0.0.1 -U sovereign -d postgres -c "CREATE DATABASE elara_db;"
pg_restore --no-owner --no-privileges -j 4 \
  -h 127.0.0.1 -U sovereign -d elara_db \
  ~/elara-backups/elara_db-<TS>.dump

# 4) Middleware'i tekrar başlat
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.elara.middleware.plist
bash local-server/scripts/middleware-restart.sh

# 5) Smoke + audit zinciri
bun run smoke -- --base http://127.0.0.1:3005 --admin-login admin <pw>
curl -sS -b cookies.txt 'http://127.0.0.1:3005/api/vault-audit/verify?limit=5000' | jq
```

Eğer audit zinciri "broken_at_id" raporlarsa:

```bash
curl -sS -b cookies.txt -X POST http://127.0.0.1:3005/api/vault-audit/rebuild | jq
```

`elara_db_pre_restore_*` yedeği 7 gün tut, sonra DROP et.

---

## 4) Hangi tabloları drill kontrol ediyor?

`app_sessions`, `vault_secrets`, `vault_audit`, `users`, `user_roles`,
`capabilities`, `tools`, `workflows`. Liste `db-restore-drill.sh:TABLES`
içinde — yeni kritik tablo eklersen buraya da ekle.

Kural: **drill, prod ≥ drill bekler** (snapshot anından sonra prod büyümüş
olabilir). Drill > prod imkânsızdır → FAIL.

---

## 5) Sıkı kurallar

- Backup'lar **şifreli volume**'da tutulsun (FileVault yeterli; offsite kopya
  için age/gpg ile şifrele). Dump içinde `vault_secrets.ciphertext` var ama
  zaten AES-256-GCM, anahtar dump'ta değil — gene de katmanla.
- `BACKUP_DIR`'i git'e koyma (`.gitignore`'da zaten ev dizini dışı).
- Drill script'i üretim DB'ye **yazmaz**, sadece okur ve geçici `*_restore_drill_*`
  DB'sini DROP eder. Cron'dan emin olmadan elle bir kez koş.
- 30 günden eski dump'lar otomatik silinmez — `BACKUP_KEEP` sayısına güven.
  Yıllık snapshot saklamak için ayrı bir dizine `cp` planla.
