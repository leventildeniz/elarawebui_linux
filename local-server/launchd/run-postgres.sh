#!/usr/bin/env bash
# ============================================================
#  ELARA — postgres foreground runner (launchd wrapper)
#
#  com.elara.postgres.plist bunu çağırır. Doğrudan `postgres` exec
#  etmek yerine wrapper preflight + stale pid temizliği yapar ve
#  sonra `exec postgres` ile foreground'a geçer (launchd KeepAlive
#  doğru çalışsın diye süreç ağacı tek dallı kalır).
#
#  Argüman:
#    $1  POSTGRES_BIN   (örn: /opt/homebrew/opt/postgresql@16/bin/postgres)
#    $2  PGDATA         (örn: /opt/homebrew/var/postgresql@16)
# ============================================================
set -euo pipefail

POSTGRES_BIN="${1:-}"
PGDATA="${2:-}"

ts() { date "+%Y-%m-%dT%H:%M:%S%z"; }
log() { echo "[$(ts)] [run-postgres] $*"; }

[ -n "$POSTGRES_BIN" ] || { log "HATA: POSTGRES_BIN argümanı boş"; exit 64; }
[ -n "$PGDATA" ]       || { log "HATA: PGDATA argümanı boş";       exit 64; }

log "preflight başlıyor"
log "  binary : $POSTGRES_BIN"
log "  pgdata : $PGDATA"
log "  whoami : $(whoami)  uid=$(id -u)  gid=$(id -g)"

if [ ! -x "$POSTGRES_BIN" ]; then
  log "HATA: postgres binary bulunamadı veya çalıştırılamıyor"
  exit 65
fi

if [ ! -d "$PGDATA" ]; then
  log "HATA: PGDATA klasörü yok — 'brew postinstall postgresql@16' ile initdb tetikle"
  exit 66
fi

if [ ! -w "$PGDATA" ]; then
  log "HATA: PGDATA yazılabilir değil. owner=$(stat -f '%Su:%Sg %Sp' "$PGDATA" 2>/dev/null || echo '?')"
  exit 67
fi

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  log "HATA: PG_VERSION yok — PGDATA bozuk veya initdb edilmemiş"
  exit 68
fi
log "  PG_VERSION = $(cat "$PGDATA/PG_VERSION")"

# Stale postmaster.pid temizliği — yalnızca PID gerçekten ölü ise
PID_FILE="$PGDATA/postmaster.pid"
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(head -1 "$PID_FILE" 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    # Yaşıyor — gerçekten postgres mi?
    PROC_NAME="$(ps -p "$OLD_PID" -o comm= 2>/dev/null || true)"
    case "$PROC_NAME" in
      *postgres*)
        log "HATA: postmaster.pid yaşıyor (PID=$OLD_PID, comm=$PROC_NAME). Çift başlılığı önlemek için çıkıyorum."
        log "      Düzeltme: kill $OLD_PID  (gerekirse 'lsof -i :5432' ile doğrula)"
        exit 69
        ;;
      *)
        log "UYARI: postmaster.pid PID=$OLD_PID yaşıyor ama postgres değil ($PROC_NAME) — stale kabul edip kenara alıyorum"
        mv -f "$PID_FILE" "${PID_FILE}.stale.$(date +%s)" || true
        ;;
    esac
  else
    log "stale postmaster.pid bulundu (PID=${OLD_PID:-?} ölü) — kenara alıyorum"
    mv -f "$PID_FILE" "${PID_FILE}.stale.$(date +%s)" || true
  fi
fi

log "postgres foreground'a geçiyor — listen=0.0.0.0:5432  socket=/tmp"
exec "$POSTGRES_BIN" -D "$PGDATA" \
  -c listen_addresses='*' \
  -c port=5432 \
  -c unix_socket_directories=/tmp
