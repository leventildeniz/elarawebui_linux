#!/usr/bin/env bash
# =============================================================================
# db-maintenance.sh — ELARA DB sağlık & disk kurtarma operasyonu
#
# Üç görev:
#   1. SCAN          — ölü index'leri ve şişkin tabloları tespit eder (read-only)
#   2. DROP INDEXES  — idx_scan=0 olan index'leri CONCURRENTLY siler (kilitsiz)
#   3. VACUUM FULL   — şişkin tabloyu sıkıştırır (AccessExclusive lock!)
#
# Mevcut db-backup.sh ile aynı kalıp: .env'den DB URL, log ~/elara-maintenance-logs/.
#
# Kullanım:
#   bash db-maintenance.sh --scan                          # read-only tarama
#   bash db-maintenance.sh --drop-dead-indexes             # ölü index sil
#   bash db-maintenance.sh --vacuum-full <table>           # tek tablo
#   bash db-maintenance.sh --full                          # tarama + onay + uygula
#   bash db-maintenance.sh --report                        # JSON özet, değişiklik yok
#
# Flag'ler:
#   -y, --yes           Onay sormadan çalıştır (CI/cron için)
#   -h, --help          Bu yardımı göster
#
# Güvenlik:
#   - DANGER_LIST_INDEXES & DANGER_LIST_TABLES asla dokunulmaz
#   - stats_reset < 7 gün ise idx_scan=0 güvensiz → uyarı
#   - df boş alan < tablo×1.2 ise VACUUM FULL reddedilir
# =============================================================================
set -euo pipefail

# ───────────────────────────────────────────────────────────────────────────
# Yapılandırma (override için ortam değişkenleri)
# ───────────────────────────────────────────────────────────────────────────
DB_NAME="${ELARA_DB_NAME:-elara_db}"
DB_HOST="${ELARA_DB_HOST:-127.0.0.1}"
DB_PORT="${ELARA_DB_PORT:-5432}"
DB_USER="${ELARA_DB_USER:-sovereign}"
DB_PASS="${ELARA_DB_PASS:-sovereign}"
DB_URL="${ELARA_DATABASE_URL:-postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}}"
export PGPASSWORD="$DB_PASS"
# Sistemdeki PG* env'leri (örn. openwebui'ye işaret eden) bizi yanıltmasın
unset DATABASE_URL PGDATABASE PGHOST PGPORT PGUSER PGSERVICE

LOG_DIR="${ELARA_MAINTENANCE_LOG_DIR:-$HOME/elara-maintenance-logs}"
mkdir -p "$LOG_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/maintenance-${TS}.log"

# Kara listeler — SQL IN clause'unda kullanılacak (tek tırnaklı, virgülle)
DANGER_INDEXES=(
  "knowledge_chunks_pkey"
  "idx_kchunks_embedding_hnsw"
  "idx_kchunks_embed_status"
  "idx_kchunks_pending_only"
)
DANGER_TABLES=(
  "vault_audit"
  "audit_chain"
  "siem_outbox"
  "siem_outbox_dead"
  "schema_migrations"
)

# ───────────────────────────────────────────────────────────────────────────
# Renkler & yardımcılar
# ───────────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET='\033[0m'; C_BOLD='\033[1m'; C_DIM='\033[2m'
  C_RED='\033[31m'; C_GREEN='\033[32m'; C_YELLOW='\033[33m'
  C_BLUE='\033[34m'; C_CYAN='\033[36m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''
fi

log()    { printf "%b\n" "$*" | tee -a "$LOG_FILE"; }
info()   { log "${C_DIM}$*${C_RESET}"; }
ok()     { log "${C_GREEN}$*${C_RESET}"; }
warn()   { log "${C_YELLOW}$*${C_RESET}"; }
err()    { log "${C_RED}$*${C_RESET}" >&2; }
hdr()    { log "\n${C_BOLD}${C_CYAN}═══ $* ═══${C_RESET}"; }
section(){ log "\n${C_BOLD}$*${C_RESET}"; }

psql_q() {
  # sessiz, tek değer/satır psql sorgusu
  psql "$DB_URL" -tAX -v ON_ERROR_STOP=1 -c "$1" 2>>"$LOG_FILE"
}

confirm() {
  # $1 = soru, $2 = "destructive" ise kırmızı
  local q="$1" tone="${2:-}"
  if [ "$ASSUME_YES" = "1" ]; then
    info "(--yes ile geçildi: $q)"
    return 0
  fi
  local prompt
  if [ "$tone" = "destructive" ]; then
    prompt=$(printf "%b%b%s%b [y/N] " "$C_BOLD" "$C_RED" "$q" "$C_RESET")
  else
    prompt=$(printf "%b%s%b [y/N] " "$C_BOLD" "$q" "$C_RESET")
  fi
  read -r -p "$prompt" reply
  case "${reply:-N}" in
    y|Y|yes|YES) return 0 ;;
    *) info "iptal."; return 1 ;;
  esac
}

# IN clause builder: ('a','b','c')
in_clause() {
  local arr=("$@") out="" first=1
  for x in "${arr[@]}"; do
    if [ "$first" = "1" ]; then out="'$x'"; first=0
    else out="$out,'$x'"; fi
  done
  echo "$out"
}

# ───────────────────────────────────────────────────────────────────────────
# Argüman parser
# ───────────────────────────────────────────────────────────────────────────
ASSUME_YES=0
MODE=""
VACUUM_TARGET=""

show_help() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --scan)               MODE="scan"; shift ;;
    --drop-dead-indexes)  MODE="drop"; shift ;;
    --vacuum-full)        MODE="vacuum"; VACUUM_TARGET="${2:-}"; shift 2 ;;
    --full)               MODE="full"; shift ;;
    --report)             MODE="report"; shift ;;
    -y|--yes)             ASSUME_YES=1; shift ;;
    -h|--help)            show_help; exit 0 ;;
    *) err "Bilinmeyen flag: $1"; show_help; exit 64 ;;
  esac
done

if [ -z "$MODE" ]; then
  err "Mode gerekli. --scan / --drop-dead-indexes / --vacuum-full <table> / --full / --report"
  exit 64
fi

# ───────────────────────────────────────────────────────────────────────────
# Preflight: DB'ye bağlanabiliyor muyuz?
# ───────────────────────────────────────────────────────────────────────────
if ! psql_q "SELECT 1" >/dev/null 2>&1; then
  err "DB'ye bağlanılamıyor: $DB_URL"
  err "Postgres çalışıyor mu? (lsof -i :$DB_PORT)"
  exit 70
fi

# ───────────────────────────────────────────────────────────────────────────
# SCAN — tüm tarama sorguları (read-only)
# ───────────────────────────────────────────────────────────────────────────
run_scan() {
  hdr "DB MAINTENANCE · SCAN · $(date '+%Y-%m-%d %H:%M:%S')"

  local db_size free_disk
  db_size=$(psql_q "SELECT pg_size_pretty(pg_database_size('$DB_NAME'));")
  free_disk=$(df -h "${PGDATA:-/opt/homebrew/var}" 2>/dev/null | awk 'NR==2 {print $4}' || echo "?")
  log "DB: ${C_BOLD}$DB_NAME${C_RESET} @ ${DB_HOST}:${DB_PORT}  |  Size: ${C_BOLD}$db_size${C_RESET}  |  Free disk: ${C_BOLD}$free_disk${C_RESET}"

  # ─ Stats güvenilirlik bayrağı
  section "[1/4] STATS · idx_scan sayaç güvenilirliği"
  local stats_reset stats_age_days
  stats_reset=$(psql_q "SELECT COALESCE(to_char(stats_reset, 'YYYY-MM-DD HH24:MI:SS'), 'never') FROM pg_stat_database WHERE datname='$DB_NAME';")
  stats_age_days=$(psql_q "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - stats_reset))/86400, 9999)::int FROM pg_stat_database WHERE datname='$DB_NAME';")
  if [ "$stats_reset" = "never" ]; then
    ok "  stats_reset: never  →  idx_scan sayaçları DB ömrü boyunca güvenilir ✓"
    STATS_SAFE=1
  elif [ "$stats_age_days" -lt 7 ]; then
    warn "  stats_reset: $stats_reset ($stats_age_days gün önce)  →  ⚠ idx_scan=0 GÜVENSİZ"
    warn "  Index'leri silmeden önce sayaçların olgunlaşmasını bekle."
    STATS_SAFE=0
  else
    ok "  stats_reset: $stats_reset ($stats_age_days gün önce) ✓"
    STATS_SAFE=1
  fi

  # ─ Ölü index'ler
  section "[2/4] DEAD INDEXES · idx_scan = 0"
  local danger_in
  danger_in=$(in_clause "${DANGER_INDEXES[@]}")
  # pg_constraint join: UNIQUE/PRIMARY KEY backing index'leri hariç tut.
  # idx_scan=0 olsa bile her INSERT'te uniqueness enforce ediyorlar (DROP INDEX reddedilir).
  DEAD_INDEX_QUERY="
    SELECT s.indexrelname,
           pg_size_pretty(pg_relation_size(s.indexrelid)),
           pg_relation_size(s.indexrelid),
           s.idx_scan
      FROM pg_stat_user_indexes s
      JOIN pg_index i ON i.indexrelid = s.indexrelid
     WHERE s.schemaname = 'public'
       AND s.idx_scan = 0
       AND s.indexrelname NOT IN ($danger_in)
       AND s.indexrelname NOT LIKE '%_pkey'
       AND s.indexrelname NOT LIKE '%_embedding_hnsw'
       AND s.indexrelname NOT LIKE 'vault_audit%'
       AND s.indexrelname NOT LIKE 'audit_chain%'
       AND i.indisunique = false
       AND i.indisprimary = false
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conindid = s.indexrelid
            AND c.contype IN ('u','p','x')
       )
     ORDER BY pg_relation_size(s.indexrelid) DESC;
  "
  DEAD_INDEXES_RAW=$(psql "$DB_URL" -tAX -F$'\t' -v ON_ERROR_STOP=1 -c "$DEAD_INDEX_QUERY")
  if [ -z "$DEAD_INDEXES_RAW" ]; then
    ok "  (none — kale temiz)"
    DEAD_INDEX_COUNT=0
    DEAD_INDEX_BYTES=0
  else
    DEAD_INDEX_COUNT=$(printf '%s\n' "$DEAD_INDEXES_RAW" | wc -l | tr -d ' ')
    DEAD_INDEX_BYTES=$(printf '%s\n' "$DEAD_INDEXES_RAW" | awk -F'\t' '{sum+=$3} END {print sum+0}')
    printf '%s\n' "$DEAD_INDEXES_RAW" | awk -F'\t' \
      -v c1="$C_DIM" -v c2="$C_RESET" \
      '{printf "  %-12s  %s\n", $2, $1}' | tee -a "$LOG_FILE"
    local human_bytes
    human_bytes=$(numfmt --to=iec --suffix=B "$DEAD_INDEX_BYTES" 2>/dev/null || echo "$DEAD_INDEX_BYTES bytes")
    log "  ${C_BOLD}${C_GREEN}Reclaimable: $human_bytes${C_RESET}  (${DEAD_INDEX_COUNT} indexes)"
  fi

  # ─ Bloat tahmini (sayfa yoğunluğu)
  section "[3/4] BLOATED TABLES · table_size >> live data"
  local table_danger_in
  table_danger_in=$(in_clause "${DANGER_TABLES[@]}")
  BLOAT_QUERY="
    WITH t AS (
      SELECT c.oid,
             n.nspname || '.' || c.relname AS tbl,
             c.relname,
             pg_relation_size(c.oid)                            AS table_bytes,
             pg_total_relation_size(c.oid)                      AS total_bytes,
             c.reltuples::bigint                                AS est_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r'
         AND n.nspname = 'public'
         AND c.relname NOT IN ($table_danger_in)
    )
    SELECT tbl,
           pg_size_pretty(table_bytes),
           table_bytes,
           est_rows,
           CASE WHEN table_bytes > 0 THEN round(100.0 * est_rows * 200 / table_bytes, 2)
                ELSE 0 END AS approx_density_pct
      FROM t
     WHERE table_bytes > 50 * 1024 * 1024
       AND est_rows > 0
       AND (est_rows * 200.0 / NULLIF(table_bytes, 0)) < 0.05
     ORDER BY table_bytes DESC;
  "
  BLOAT_TABLES_RAW=$(psql "$DB_URL" -tAX -F$'\t' -v ON_ERROR_STOP=1 -c "$BLOAT_QUERY")
  if [ -z "$BLOAT_TABLES_RAW" ]; then
    ok "  (none — tablolar sıkı)"
    BLOAT_TABLE_COUNT=0
  else
    BLOAT_TABLE_COUNT=$(printf '%s\n' "$BLOAT_TABLES_RAW" | wc -l | tr -d ' ')
    printf '%s\n' "$BLOAT_TABLES_RAW" | awk -F'\t' \
      '{printf "  %-12s  %s  (~%s%% dolu, %s satır)\n", $2, $1, $5, $4}' | tee -a "$LOG_FILE"
    warn "  ⚠ Bu tablolar VACUUM FULL ile sıkıştırılabilir (AccessExclusive lock)"
  fi

  # ─ WAL & autovacuum
  section "[4/4] WAL & AUTOVACUUM"
  local wal_size wal_files stale_av
  wal_size=$(psql_q "SELECT pg_size_pretty(sum(size)) FROM pg_ls_waldir();" || echo "?")
  wal_files=$(psql_q "SELECT count(*) FROM pg_ls_waldir();" || echo "?")
  stale_av=$(psql_q "
    SELECT count(*) FROM pg_stat_user_tables
     WHERE n_live_tup > 10000
       AND (last_autovacuum IS NULL OR last_autovacuum < now() - interval '7 days');
  " || echo "?")
  log "  WAL: ${C_BOLD}$wal_size${C_RESET} / ${wal_files} files"
  if [ "$stale_av" = "0" ]; then
    ok "  Autovacuum: tüm tablolar son 7 günde işlendi ✓"
  else
    warn "  ⚠ $stale_av tablo 7+ gündür autovacuum görmemiş"
  fi

  # Özet
  hdr "SUMMARY"
  local total_reclaim_human="0 B"
  if [ "$DEAD_INDEX_BYTES" -gt 0 ]; then
    total_reclaim_human=$(numfmt --to=iec --suffix=B "$DEAD_INDEX_BYTES" 2>/dev/null || echo "$DEAD_INDEX_BYTES bytes")
  fi
  log "  Dead indexes:     ${C_BOLD}${DEAD_INDEX_COUNT}${C_RESET}  (reclaim ~${total_reclaim_human})"
  log "  Bloated tables:   ${C_BOLD}${BLOAT_TABLE_COUNT}${C_RESET}"
  log "  Stats safe:       $([ "$STATS_SAFE" = "1" ] && echo "${C_GREEN}yes${C_RESET}" || echo "${C_YELLOW}no${C_RESET}")"
  log "  Log:              ${C_DIM}$LOG_FILE${C_RESET}"
}

# ───────────────────────────────────────────────────────────────────────────
# JSON RAPOR — değişiklik yok, sadece machine-readable çıktı
# ───────────────────────────────────────────────────────────────────────────
run_report() {
  local danger_in
  danger_in=$(in_clause "${DANGER_INDEXES[@]}")
  psql "$DB_URL" -tAX -v ON_ERROR_STOP=1 <<SQL
WITH dead AS (
  SELECT s.indexrelname AS name,
         pg_relation_size(s.indexrelid) AS size_bytes,
         s.idx_scan AS scans
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
   WHERE s.schemaname = 'public'
     AND s.idx_scan = 0
     AND s.indexrelname NOT IN ($danger_in)
     AND s.indexrelname NOT LIKE '%_pkey'
     AND s.indexrelname NOT LIKE '%_embedding_hnsw'
     AND s.indexrelname NOT LIKE 'vault_audit%'
     AND s.indexrelname NOT LIKE 'audit_chain%'
     AND i.indisunique = false
     AND i.indisprimary = false
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conindid = s.indexrelid AND c.contype IN ('u','p','x')
     )
)
SELECT json_build_object(
  'db_size_bytes',     pg_database_size('$DB_NAME'),
  'stats_reset',       (SELECT stats_reset FROM pg_stat_database WHERE datname='$DB_NAME'),
  'dead_indexes',      COALESCE((SELECT json_agg(json_build_object('name',name,'size_bytes',size_bytes,'scans',scans)) FROM dead), '[]'::json),
  'reclaimable_bytes', COALESCE((SELECT sum(size_bytes) FROM dead), 0)
);
SQL
}

# ───────────────────────────────────────────────────────────────────────────
# DROP DEAD INDEXES — CONCURRENTLY, ayrı transaction
# ───────────────────────────────────────────────────────────────────────────
run_drop_indexes() {
  run_scan
  if [ "${DEAD_INDEX_COUNT:-0}" = "0" ]; then
    ok "\nSilinecek ölü index yok."
    return 0
  fi
  if [ "${STATS_SAFE:-0}" != "1" ]; then
    err "\nSTATS GÜVENSİZ — sayaçlar yakın zamanda sıfırlanmış."
    err "Devam etmek için -y ile zorla, ama riski sen alırsın."
    if [ "$ASSUME_YES" != "1" ]; then exit 75; fi
  fi

  local human_bytes
  human_bytes=$(numfmt --to=iec --suffix=B "$DEAD_INDEX_BYTES" 2>/dev/null || echo "$DEAD_INDEX_BYTES bytes")
  if ! confirm "DROP INDEX CONCURRENTLY · $DEAD_INDEX_COUNT index · ~$human_bytes geri kazanılacak. Onay?"; then
    return 1
  fi

  hdr "DROP INDEXES · CONCURRENTLY"
  local before_size after_size
  before_size=$(psql_q "SELECT pg_database_size('$DB_NAME');")

  local idx_name failed=0 done=0
  while IFS=$'\t' read -r idx_name _rest; do
    [ -z "$idx_name" ] && continue
    printf "  → dropping %s ... " "$idx_name" | tee -a "$LOG_FILE"
    if psql "$DB_URL" -v ON_ERROR_STOP=1 \
         -c "DROP INDEX CONCURRENTLY IF EXISTS public.\"$idx_name\";" \
         >>"$LOG_FILE" 2>&1; then
      printf "%bOK%b\n" "$C_GREEN" "$C_RESET" | tee -a "$LOG_FILE"
      done=$((done+1))
    else
      printf "%bFAIL%b\n" "$C_RED" "$C_RESET" | tee -a "$LOG_FILE"
      failed=$((failed+1))
    fi
  done <<< "$DEAD_INDEXES_RAW"

  after_size=$(psql_q "SELECT pg_database_size('$DB_NAME');")
  local saved=$((before_size - after_size))
  local saved_human
  saved_human=$(numfmt --to=iec --suffix=B "$saved" 2>/dev/null || echo "$saved bytes")
  log ""
  ok "  Dropped: $done index"
  if [ "$failed" -gt 0 ]; then warn "  Failed:  $failed index"; fi
  log "  Disk reclaimed: ${C_BOLD}$saved_human${C_RESET}"
  log "  DB now: $(psql_q "SELECT pg_size_pretty(pg_database_size('$DB_NAME'));")"
}

# ───────────────────────────────────────────────────────────────────────────
# VACUUM FULL — preflight: kara liste + disk + aktif sorgu
# ───────────────────────────────────────────────────────────────────────────
run_vacuum_full() {
  local tbl="$1"
  if [ -z "$tbl" ]; then
    err "Tablo adı gerekli: --vacuum-full <table>"
    exit 64
  fi

  # Whitelist regex
  if ! [[ "$tbl" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
    err "Geçersiz tablo adı: $tbl"
    exit 64
  fi

  # Kara liste
  for danger in "${DANGER_TABLES[@]}"; do
    if [ "$tbl" = "$danger" ]; then
      err "$tbl kara listede (audit/SIEM/migration tabloları). Manuel müdahale gerekli."
      exit 76
    fi
  done

  # Tablo var mı?
  local exists
  exists=$(psql_q "SELECT to_regclass('public.\"$tbl\"') IS NOT NULL;")
  if [ "$exists" != "t" ]; then
    err "Tablo bulunamadı: public.$tbl"
    exit 77
  fi

  local tbl_size_bytes tbl_size_human
  tbl_size_bytes=$(psql_q "SELECT pg_total_relation_size('public.\"$tbl\"');")
  tbl_size_human=$(psql_q "SELECT pg_size_pretty(pg_total_relation_size('public.\"$tbl\"'));")

  # Disk preflight (yeni kopya için ek alan lazım)
  local free_kb need_kb
  free_kb=$(df -k "${PGDATA:-/opt/homebrew/var}" 2>/dev/null | awk 'NR==2 {print $4}')
  need_kb=$(( (tbl_size_bytes / 1024) * 12 / 10 ))   # × 1.2 safety
  if [ -n "$free_kb" ] && [ "$free_kb" -lt "$need_kb" ]; then
    err "Disk yetersiz. Free: ${free_kb}KB, gerekli: ${need_kb}KB (tablo×1.2)"
    exit 78
  fi

  # Aktif sorgu kontrolü
  local active
  active=$(psql_q "
    SELECT count(*) FROM pg_stat_activity
     WHERE state='active' AND query ILIKE '%$tbl%' AND pid <> pg_backend_pid();
  ")
  if [ "$active" -gt 0 ]; then
    warn "⚠ $active aktif sorgu '$tbl' üstünde çalışıyor — VACUUM FULL onları bekletecek."
  fi

  hdr "VACUUM FULL · public.$tbl"
  log "  Mevcut boyut: ${C_BOLD}$tbl_size_human${C_RESET}"
  warn "  ⚠ AccessExclusive lock — bu tablo işlem boyunca okunamaz/yazılamaz."
  warn "  ⚠ Yeni kopya yazılır; geçici olarak ~$tbl_size_human ek disk kullanılır."

  if ! confirm "VACUUM FULL public.$tbl çalıştırılsın mı?" destructive; then
    return 1
  fi

  # Tablo-seviye delta ölç — DB seviyesi WAL büyümesiyle yanlış sinyal verir.
  local before_tbl after_tbl before_db after_db start end
  before_tbl=$(psql_q "SELECT pg_total_relation_size('public.\"$tbl\"');")
  before_db=$(psql_q "SELECT pg_database_size('$DB_NAME');")
  start=$(date +%s)
  log "  Başlıyor... ($(date '+%H:%M:%S'))"
  if psql "$DB_URL" -v ON_ERROR_STOP=1 \
       -c "VACUUM (FULL, ANALYZE, VERBOSE) public.\"$tbl\";" \
       2>&1 | tee -a "$LOG_FILE" | grep -E "^(INFO|NOTICE|WARNING)" | tail -20; then
    end=$(date +%s)
    after_tbl=$(psql_q "SELECT pg_total_relation_size('public.\"$tbl\"');")
    after_db=$(psql_q "SELECT pg_database_size('$DB_NAME');")
    local saved_tbl=$((before_tbl - after_tbl))
    local saved_db=$((before_db - after_db))
    local saved_tbl_human saved_db_human
    if [ "$saved_tbl" -ge 0 ]; then
      saved_tbl_human=$(numfmt --to=iec --suffix=B "$saved_tbl" 2>/dev/null || echo "$saved_tbl bytes")
    else
      saved_tbl_human="0 B (zaten sıkıştırılmıştı)"
    fi
    saved_db_human=$(numfmt --to=iec --suffix=B "$saved_db" 2>/dev/null || echo "$saved_db bytes")
    log ""
    ok "  VACUUM FULL tamamlandı · $((end - start))s"
    log "  Tablo: $(psql_q "SELECT pg_size_pretty(pg_total_relation_size('public.\"$tbl\"'));") (table reclaimed: ${C_BOLD}$saved_tbl_human${C_RESET})"
    log "  DB now: $(psql_q "SELECT pg_size_pretty(pg_database_size('$DB_NAME'));") (db delta: $saved_db_human · WAL büyümesi normaldir)"

  else
    err "VACUUM FULL başarısız oldu. Log: $LOG_FILE"
    exit 79
  fi
}

# ───────────────────────────────────────────────────────────────────────────
# FULL — tarama → ölü index sil → şişkin tablo varsa onayla → VACUUM
# ───────────────────────────────────────────────────────────────────────────
run_full() {
  run_scan
  if [ "${DEAD_INDEX_COUNT:-0}" -gt 0 ]; then
    if confirm "[full] Ölü index'leri sileyim mi?"; then
      run_drop_indexes_post_scan
    fi
  fi
  if [ "${BLOAT_TABLE_COUNT:-0}" -gt 0 ]; then
    log ""
    warn "Şişkin tablo(lar) var. Her birini ayrıca onaylayacaksın."
    while IFS=$'\t' read -r tbl _size _bytes _rows _density; do
      [ -z "$tbl" ] && continue
      local short_tbl="${tbl#public.}"
      if confirm "[full] VACUUM FULL public.$short_tbl?" destructive; then
        run_vacuum_full "$short_tbl"
      fi
    done <<< "$BLOAT_TABLES_RAW"
  fi
  hdr "FULL CYCLE COMPLETE"
}

# Scan'i tekrar koşmadan drop yapmak için (FULL içinden çağrılır)
run_drop_indexes_post_scan() {
  if [ "${DEAD_INDEX_COUNT:-0}" = "0" ]; then return 0; fi
  if [ "${STATS_SAFE:-0}" != "1" ] && [ "$ASSUME_YES" != "1" ]; then
    warn "Stats güvensiz, atlanıyor."
    return 1
  fi
  hdr "DROP INDEXES · CONCURRENTLY"
  local before_size after_size done=0 failed=0
  before_size=$(psql_q "SELECT pg_database_size('$DB_NAME');")
  local idx_name
  while IFS=$'\t' read -r idx_name _rest; do
    [ -z "$idx_name" ] && continue
    printf "  → dropping %s ... " "$idx_name" | tee -a "$LOG_FILE"
    if psql "$DB_URL" -v ON_ERROR_STOP=1 \
         -c "DROP INDEX CONCURRENTLY IF EXISTS public.\"$idx_name\";" \
         >>"$LOG_FILE" 2>&1; then
      printf "%bOK%b\n" "$C_GREEN" "$C_RESET" | tee -a "$LOG_FILE"
      done=$((done+1))
    else
      printf "%bFAIL%b\n" "$C_RED" "$C_RESET" | tee -a "$LOG_FILE"
      failed=$((failed+1))
    fi
  done <<< "$DEAD_INDEXES_RAW"
  after_size=$(psql_q "SELECT pg_database_size('$DB_NAME');")
  local saved=$((before_size - after_size))
  local saved_human
  saved_human=$(numfmt --to=iec --suffix=B "$saved" 2>/dev/null || echo "$saved bytes")
  ok "  Dropped: $done · Failed: $failed · Reclaimed: $saved_human"
}

# ───────────────────────────────────────────────────────────────────────────
# Dispatch
# ───────────────────────────────────────────────────────────────────────────
case "$MODE" in
  scan)   run_scan ;;
  report) run_report ;;
  drop)   run_drop_indexes ;;
  vacuum) run_vacuum_full "$VACUUM_TARGET" ;;
  full)   run_full ;;
esac

log "\n${C_DIM}Log: $LOG_FILE${C_RESET}"
