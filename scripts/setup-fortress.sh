#!/usr/bin/env bash
# ============================================================
#  ELARA — Sovereign Key (setup-fortress.sh)
#  Tek komutla tüm kale: PostgreSQL + pgvector, mkcert TLS,
#  zırhlı bun install (frozen + ignore-scripts), Playwright Chromium
#  ve opsiyonel Python worker (--with-worker).
#
#  Kullanım:
#    bash scripts/setup-fortress.sh                  # standart kurulum
#    bash scripts/setup-fortress.sh --with-worker    # + Python worker
#    bash scripts/setup-fortress.sh --skip-tls       # mkcert atla
# ============================================================
set -euo pipefail

WITH_WORKER=0
SKIP_TLS=0
for arg in "$@"; do
  case "$arg" in
    --with-worker) WITH_WORKER=1 ;;
    --skip-tls)    SKIP_TLS=1 ;;
    *) echo "[setup] bilinmeyen flag: $arg" >&2; exit 2 ;;
  esac
done

C_RST="\033[0m"; C_OK="\033[1;32m"; C_WARN="\033[1;33m"; C_ERR="\033[1;31m"; C_INFO="\033[1;36m"
log()  { printf "${C_INFO}[setup]${C_RST} %s\n" "$*"; }
ok()   { printf "${C_OK}  ✓${C_RST} %s\n" "$*"; }
warn() { printf "${C_WARN}  !${C_RST} %s\n" "$*"; }
die()  { printf "${C_ERR}  ✗${C_RST} %s\n" "$*" >&2; exit 1; }

bun_install_fortified() {
  local target_dir="$1"
  local label="$2"
  local log_file="/tmp/elara-bun-install-${label//[^a-zA-Z0-9]/_}.log"

  if ( cd "$target_dir" && bun install --frozen-lockfile --ignore-scripts ) 2>&1 | tee "$log_file"; then
    return 0
  fi

  if grep -q "lockfile had changes\|lockfile is frozen" "$log_file"; then
    warn "$label lockfile package.json ile uyumsuz — Bun lockfile otomatik yenileniyor"
    ( cd "$target_dir" && bun install --lockfile-only --ignore-scripts )
    ( cd "$target_dir" && bun install --frozen-lockfile --ignore-scripts )
    return 0
  fi

  die "$label bağımlılık kurulumu başarısız — detay: $log_file"
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Sudo guard — mkcert ASLA root altında çalışmamalı (Keychain prompt patlar)
[ "${EUID:-$(id -u)}" -eq 0 ] && die "Bu script sudo ile çalıştırılmamalı. Normal kullanıcı olarak: bash scripts/setup-fortress.sh"

# ------------------------------------------------------------
# 1/7 — Önkoşullar
# ------------------------------------------------------------
log "[1/7] Önkoşul kontrolü"
command -v brew >/dev/null 2>&1 || die "Homebrew gerekli — https://brew.sh"
ok "brew     $(brew --version | head -1)"

if ! command -v bun >/dev/null 2>&1; then
  log "bun bulunamadı, kuruluyor…"
  brew install oven-sh/bun/bun
fi
ok "bun      $(bun --version)"

if ! command -v node >/dev/null 2>&1; then
  log "node bulunamadı, kuruluyor…"
  brew install node@20
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 20 ] || die "node >=20 gerekli (mevcut: $(node -v))"
ok "node     $(node -v)"

command -v psql >/dev/null 2>&1 || { log "postgresql kuruluyor…"; brew install postgresql@16; }
ok "psql     $(psql --version)"

if [ "$SKIP_TLS" -eq 0 ]; then
  command -v mkcert >/dev/null 2>&1 || { log "mkcert kuruluyor…"; brew install mkcert nss; }
  ok "mkcert   $(mkcert -version 2>/dev/null || echo 'kurulu')"
fi

# ------------------------------------------------------------
# 2/7 — PostgreSQL + pgvector
# ------------------------------------------------------------
log "[2/7] PostgreSQL servis + pgvector"
brew services start postgresql@16 >/dev/null 2>&1 || true
# wait for socket
for i in $(seq 1 20); do pg_isready -q && break || sleep 0.5; done
pg_isready -q || die "PostgreSQL ayağa kalkmadı"
ok "postgres çalışıyor"

DB_NAME="${PGDATABASE:-elara_db}"
DB_USER="${PGUSER:-sovereign}"

if ! psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  log "DB '$DB_NAME' yok, oluşturuluyor"
  createdb "$DB_NAME"
fi
ok "db       $DB_NAME"

if ! brew list pgvector >/dev/null 2>&1; then
  log "pgvector kuruluyor…"
  brew install pgvector
fi
psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null
ok "pgvector hazır"

# ------------------------------------------------------------
# 3/7 — Schema migrate (idempotent)
# ------------------------------------------------------------
log "[3/7] Şema göçü (schema.sql)"
if [ -f local-server/schema.sql ]; then
  psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -f local-server/schema.sql >/dev/null
  ok "schema.sql uygulandı"
else
  warn "local-server/schema.sql bulunamadı — atlandı"
fi

# ------------------------------------------------------------
# 4/7 — TLS sertifikası (mkcert)
# ------------------------------------------------------------
if [ "$SKIP_TLS" -eq 1 ]; then
  warn "[4/7] TLS atlandı (--skip-tls)"
  TLS_OK=0
else
  log "[4/7] TLS sertifikası (self-healing)"

  # Klasör mührü — certs/ her durumda hazır
  mkdir -p "$ROOT/local-server/certs"

  # (a) CAROOT sahip onarımı — sudo mkcert kalıntısını otomatik düzelt
  CAROOT_DIR="$HOME/Library/Application Support/mkcert"
  if [ -d "$CAROOT_DIR" ]; then
    OWNER=$(stat -f %u "$CAROOT_DIR" 2>/dev/null || stat -c %u "$CAROOT_DIR" 2>/dev/null || echo 0)
    if [ "$OWNER" = "0" ]; then
      warn "CAROOT root'a ait — sahiplik iade ediliyor (tek seferlik sudo prompt)"
      sudo chown -R "$(whoami):staff" "$CAROOT_DIR" || warn "chown başarısız, devam"
    fi
  fi

  # NOT: Eski "(b) bozuk root CA silme" bloğu KALDIRILDI.
  # Komutan'ın elle System Keychain'e mühürlediği CA'yı yanlışlıkla
  # silmek tarayıcı güven zincirini koparıyordu. mkcert -install zaten
  # idempotent — gerekirse issue-cert.sh kendisi yönetir.

  # (c) TTY kontrolü — Keychain prompt için zorunlu
  if [ ! -t 0 ] && [ ! -t 1 ]; then
    warn "TTY yok — mkcert -install Keychain prompt açamaz."
    warn "Bu script'i doğrudan Terminal'den çalıştır VEYA --skip-tls ile geç."
    TLS_OK=0
  else
    CERT="$ROOT/local-server/certs/elara.pem"

    # (d) Akıllı skip — root CA System Keychain'de güvenilir + sertifika varsa hiç dokunma
    mkcert_trusted() {
      security find-certificate -c "mkcert" -a /Library/Keychains/System.keychain >/dev/null 2>&1 \
        || security find-certificate -c "mkcert" >/dev/null 2>&1
    }

    RENEW=0
    AGE_DAYS=0
    if [ ! -f "$CERT" ]; then
      RENEW=1
    else
      AGE_DAYS=$(( ( $(date +%s) - $(stat -f %m "$CERT" 2>/dev/null || stat -c %Y "$CERT") ) / 86400 ))
      [ "$AGE_DAYS" -gt 60 ] && RENEW=1 && warn "sertifika $AGE_DAYS gün eski, yenileniyor"
    fi

    if [ "$RENEW" -eq 0 ] && mkcert_trusted; then
      TLS_OK=1
      ok "tls      mkcert root CA Keychain'de güvenilir + cert hazır ($AGE_DAYS gün) — install adımı atlandı"
    else
      # (e) issue-cert.sh — başarısızsa graceful fallback (manuel trust)
      run_issue_cert() { bash local-server/scripts/issue-cert.sh; }

      if run_issue_cert; then
        TLS_OK=1
        ok "tls      certs/elara.pem"
      else
        cat <<'EOF'

  ⚠  macOS Keychain onayı terminalsiz geçilemedi.

  Çözüm (manuel, ~30 saniye):
    1) Açılan Finder penceresinde 'rootCA.pem' dosyasına çift tıkla
       → Keychain Access açılacak, 'System' keychain'i seç ve ekle
    2) 'mkcert' sertifikasını bul, çift tıkla
    3) 'Trust' bölümünü genişlet → 'When using this certificate: Always Trust'
    4) Pencereyi kapat (parolanı iste)

  CAROOT klasörü açılıyor:
EOF
        open "$(mkcert -CAROOT 2>/dev/null)" 2>/dev/null || true
        printf "\n  Hazır olunca ENTER'a bas (TLS olmadan devam için Ctrl+C)... "
        read -r _ || true

        if run_issue_cert; then
          TLS_OK=1
          ok "tls      manuel onayla başarıyla mühürlendi"
        else
          warn "TLS hâlâ başarısız — HTTP-only modda devam ediliyor"
          warn "Sonradan onarmak için: bash local-server/scripts/issue-cert.sh"
          TLS_OK=0
        fi
      fi
    fi
  fi
fi

# ------------------------------------------------------------
# 5/7 — Frontend deps (zırhlı)
# ------------------------------------------------------------
log "[5/7] Frontend deps — bun install --frozen-lockfile --ignore-scripts"
bun_install_fortified "." "frontend"
ok "frontend deps zırhlı"

# ------------------------------------------------------------
# 6/7 — Backend deps (zırhlı)
# ------------------------------------------------------------
log "[6/7] Backend deps — local-server/"
bun_install_fortified "local-server" "backend"
ok "backend deps zırhlı"

# ------------------------------------------------------------
# 7/7 — Playwright Chromium (RBI için zorunlu)
# ------------------------------------------------------------
log "[7/7] Playwright Chromium (RBI binary, ~170MB)"
( cd local-server && bunx playwright install chromium )
ok "chromium hazır"

# ------------------------------------------------------------
# OPT — Python worker
# ------------------------------------------------------------
if [ "$WITH_WORKER" -eq 1 ]; then
  log "[opt] Python worker — venv + --require-hashes"
  command -v python3 >/dev/null 2>&1 || die "python3 gerekli"
  if [ ! -d local-server/.venv ]; then
    python3 -m venv local-server/.venv
  fi
  # shellcheck disable=SC1091
  source local-server/.venv/bin/activate
  python -m pip install --upgrade pip >/dev/null
  if [ -f local-server/requirements-worker.lock.txt ]; then
    python -m pip install --require-hashes -r local-server/requirements-worker.lock.txt
  else
    warn "requirements-worker.lock.txt yok — hashsiz kurulum (üretimde lock dosyası önerilir)"
    python -m pip install -r local-server/requirements-worker.txt
  fi
  ok "python worker hazır"
  deactivate
else
  warn "[opt] Python worker atlandı (--with-worker ile etkinleştir)"
fi

# ------------------------------------------------------------
# Smoke
# ------------------------------------------------------------
echo
ok "Kale ayakta. Durum:"
echo "    TLS         : $([ "${TLS_OK:-0}" = "1" ] && echo 'AKTİF (HTTPS)' || echo 'PASİF (HTTP-only)')"
echo "    Sertifika   : $ROOT/local-server/certs/elara.pem"
echo "    Port mühürü :"
echo "      • Middleware  http://127.0.0.1:3005   https://127.0.0.1:3006"
echo "      • RBI         http://127.0.0.1:3007   https://127.0.0.1:3008"
echo "      • Frontend    http://127.0.0.1:8080   https://127.0.0.1:10443"
echo "    Sonraki adımlar:"
echo "      bun run server                   # middleware (3005/3006)"
echo "      cd local-server && bun run rbi   # browser-isolation (3007/3008)"
echo "      bun run dev                      # frontend (vite, 8080)"
