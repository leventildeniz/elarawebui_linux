#!/usr/bin/env bash
# =============================================================================
# db-restore-drill.sh — Faz 12
# Üretim elara_db'sine dokunmadan, en son (veya verilen) dump'ı geçici bir
# database'e restore eder ve smoke seviyesinde tablo/satır karşılaştırması
# yapar. CI/cron'dan haftada bir tetiklenmek üzere tasarlandı.
#
# Kullanım:
#   bash db-restore-drill.sh                       # en yeni dump
#   bash db-restore-drill.sh /path/to/file.dump    # belirli dump
#
# Üretim DB: $DATABASE_URL  (default sovereign@127.0.0.1/elara_db)
# Drill DB:  ${DB_NAME}_restore_drill_<unix_ts>  (sonunda DROP edilir)
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/elara-backups}"
# Sistem PG* env'leri (openwebui vb.) drill'i yanlış DB'ye yönlendirmesin.
DB_NAME="${ELARA_DB_NAME:-elara_db}"
DB_HOST="${ELARA_DB_HOST:-127.0.0.1}"
DB_PORT="${ELARA_DB_PORT:-5432}"
DB_USER="${ELARA_DB_USER:-sovereign}"
DB_PASS="${ELARA_DB_PASS:-sovereign}"
export PGPASSWORD="$DB_PASS"
unset DATABASE_URL PGDATABASE PGHOST PGPORT PGUSER PGSERVICE

DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  DUMP=$(ls -1t "$BACKUP_DIR"/${DB_NAME}-*.dump 2>/dev/null | head -1 || true)
fi
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "[drill] dump bulunamadı (BACKUP_DIR=$BACKUP_DIR). Önce db-backup.sh çalıştır." >&2
  exit 2
fi

SUM="${DUMP%.dump}.sha256"
if [ -f "$SUM" ]; then
  echo "[drill] sha256 doğrulama: $(basename "$SUM")"
  ( cd "$(dirname "$DUMP")" && (sha256sum -c "$(basename "$SUM")" 2>/dev/null || shasum -a 256 -c "$(basename "$SUM")") )
else
  echo "[drill] uyarı: sha256 dosyası yok ($SUM)"
fi

TS=$(date +%s)
DRILL_DB="${DB_NAME}_restore_drill_${TS}"
PSQL_ADMIN="psql -v ON_ERROR_STOP=1 -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres"

cleanup() {
  echo "[drill] cleanup: DROP DATABASE $DRILL_DB"
  $PSQL_ADMIN -c "DROP DATABASE IF EXISTS \"$DRILL_DB\" WITH (FORCE);" >/dev/null 2>&1 || \
    $PSQL_ADMIN -c "DROP DATABASE IF EXISTS \"$DRILL_DB\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[drill] CREATE DATABASE $DRILL_DB"
$PSQL_ADMIN -c "CREATE DATABASE \"$DRILL_DB\";"

echo "[drill] pg_restore $(basename "$DUMP") → $DRILL_DB"
# --no-owner: drill DB sahipliği fark etmez. -j 4: paralel.
pg_restore --no-owner --no-privileges -j 4 \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DRILL_DB" "$DUMP" 2> >(grep -v 'warning:' >&2) || {
    echo "[drill] pg_restore HATA" >&2
    exit 1
  }

# Karşılaştırma: kritik tablolarda satır sayıları
TABLES=(app_sessions vault_secrets vault_audit users user_roles capabilities tools workflows)
echo "[drill] satır karşılaştırması (üretim vs drill):"
fail=0
# psql nonzero exit (ör. SQL hatası) `set -e` ile script'i öldürmesin — `|| echo -1`
# fallback ile her tablo izole edilir. Loop boyunca errexit'i geçici kapatıyoruz.
set +e
count_rows() {
  local db="$1" tbl="$2" out
  out=$(psql -tA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$db" \
    -c "SELECT CASE WHEN to_regclass('public.\"$tbl\"') IS NULL THEN -1 ELSE (SELECT count(*) FROM public.\"$tbl\") END;" 2>/dev/null | tr -d '[:space:]')
  if [ -z "$out" ]; then out="-1"; fi
  echo "$out"
}
for t in "${TABLES[@]}"; do
  prod=$(count_rows "$DB_NAME"  "$t")
  drill=$(count_rows "$DRILL_DB" "$t")
  if [ "$prod" = "-1" ] && [ "$drill" = "-1" ]; then
    printf "  %-20s  yok (ikisinde de)  —\n" "$t"
    continue
  fi
  if [ "$drill" = "-1" ]; then
    printf "  %-20s  prod=%s drill=YOK  ✗\n" "$t" "$prod"
    fail=1
  elif [ "$prod" = "-1" ]; then
    printf "  %-20s  prod=YOK drill=%s  (yeni tablo silinmiş?) ✗\n" "$t" "$drill"
    fail=1
  elif [ "$drill" -gt "$prod" ] 2>/dev/null; then
    printf "  %-20s  prod=%s drill=%s  (drill > prod, imkânsız) ✗\n" "$t" "$prod" "$drill"
    fail=1
  else
    printf "  %-20s  prod=%s drill=%s  ✓\n" "$t" "$prod" "$drill"
  fi
done
set -e

# vault_audit zinciri drill DB'de de doğrulanmalı (trigger + verify formülü deterministik)
echo "[drill] vault_audit hash-chain doğrulaması (drill DB)"
chain_ok=$(psql -tA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DRILL_DB" -c "
  WITH ordered AS (
    SELECT id, prev_hash, row_hash,
           LAG(row_hash) OVER (ORDER BY id) AS expected_prev
      FROM vault_audit ORDER BY id
  )
  SELECT count(*) FILTER (WHERE prev_hash IS DISTINCT FROM expected_prev) = 0
    FROM ordered;
" 2>/dev/null | tr -d '[:space:]')
if [ "$chain_ok" = "t" ]; then
  echo "  zincir prev_hash sürekli  ✓"
else
  echo "  zincir prev_hash KOPUK  ✗"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "[drill] PASS — dump kurtarılabilir, kritik tablolar tutarlı"
  exit 0
else
  echo "[drill] FAIL — yukarıdaki satırları incele"
  exit 1
fi
