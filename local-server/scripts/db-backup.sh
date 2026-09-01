#!/usr/bin/env bash
# =============================================================================
# db-backup.sh — Faz 12
# elara_db'nin tutarlı, sıkıştırılmış pg_dump snapshot'ı + SHA-256 manifest.
#
# Çıktı: $BACKUP_DIR/elara_db-YYYYmmdd-HHMMSS.dump  (custom format, -Fc)
#        $BACKUP_DIR/elara_db-YYYYmmdd-HHMMSS.sha256
#
# Varsayılan BACKUP_DIR=$HOME/elara-backups. Retention: en yeni N dosya tutulur
# (BACKUP_KEEP, default 14).
#
# Restore drill için: db-restore-drill.sh aynı dump'ı geçici DB'ye yükleyip
# satır sayılarını doğrular.
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/elara-backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
# DİKKAT: Sistemdeki DATABASE_URL (örn. openwebui'ye işaret eden) backup'ı
# yanlış DB'ye yöneltmesin diye explicit elara parametreleri kullanılır.
# Override gerekirse ELARA_DATABASE_URL set et.
DB_NAME="${ELARA_DB_NAME:-elara_db}"
DB_HOST="${ELARA_DB_HOST:-127.0.0.1}"
DB_PORT="${ELARA_DB_PORT:-5432}"
DB_USER="${ELARA_DB_USER:-sovereign}"
DB_PASS="${ELARA_DB_PASS:-sovereign}"
DB_URL="${ELARA_DATABASE_URL:-postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}}"
export PGPASSWORD="$DB_PASS"

# Sistem env'lerini bilinçli olarak NUKE'le — pg_dump default'ları
# (PGDATABASE=openwebui vb.) tüketmesin.
unset DATABASE_URL PGDATABASE PGHOST PGPORT PGUSER PGSERVICE

mkdir -p "$BACKUP_DIR"
TS="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}-${TS}.dump"
SUM="$BACKUP_DIR/${DB_NAME}-${TS}.sha256"

echo "[backup] $DB_NAME @ ${DB_HOST}:${DB_PORT} → $OUT"
# -Fc: custom format (pg_restore ile selective restore mümkün), sıkıştırma 9
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  --file="$OUT"

# pg_dump fail olduysa boş/kısa dosya kalmasın
if [ ! -s "$OUT" ]; then
  echo "[backup] HATA: dump boş veya yok ($OUT) — siliniyor" >&2
  rm -f "$OUT"
  exit 1
fi

# Manifest
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$BACKUP_DIR" && sha256sum "$(basename "$OUT")" > "$SUM" )
else
  ( cd "$BACKUP_DIR" && shasum -a 256 "$(basename "$OUT")" > "$SUM" )
fi

SIZE=$(du -h "$OUT" | awk '{print $1}')
echo "[backup] done — size=$SIZE  sha256=$(cat "$SUM" | awk '{print $1}')"

# Retention
echo "[backup] retention: keep newest $BACKUP_KEEP"
ls -1t "$BACKUP_DIR"/${DB_NAME}-*.dump 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | while read -r old; do
  echo "  prune $old"
  rm -f "$old" "${old%.dump}.sha256"
done

echo "[backup] OK"
