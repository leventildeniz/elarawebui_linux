#!/usr/bin/env bash
# ============================================================
#  ELARA — launchd installer
#
#  Tüm ELARA servislerini macOS LaunchAgent olarak login'e bağlar:
#    com.elara.middleware   → server.mjs (3005 + 3006)
#    com.elara.vite         → vite dev (8080)
#    com.elara.tls-proxy    → dev-tls-proxy.mjs (10443)
#
#  Kullanım:
#    bash local-server/launchd/install-launchd.sh           # kur + yükle
#    bash local-server/launchd/install-launchd.sh --reload  # sıfırla + yeniden yükle
#    bash local-server/launchd/install-launchd.sh --status  # durum
#
#  Kaldırma:
#    bash local-server/launchd/uninstall-launchd.sh
# ============================================================
set -euo pipefail

[ "${EUID:-$(id -u)}" -eq 0 ] && { echo "[launchd] HATA: sudo ile çalıştırma — LaunchAgent kullanıcı oturumuna ait." >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_DIR"

BUN_BIN="$(command -v bun || true)"
[ -z "$BUN_BIN" ] && { echo "[launchd] HATA: bun PATH'te yok. brew install oven-sh/bun/bun" >&2; exit 1; }
NODE_BIN="$(command -v node || true)"
[ -z "$NODE_BIN" ] && { echo "[launchd] HATA: node PATH'te yok." >&2; exit 1; }

# v12 — STT (whisper.cpp) WAV harici format kabul etmiyor; middleware ffmpeg ile çevirir.
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[launchd] UYARI: ffmpeg PATH'te yok — STT (mikrofon) çalışmaz."
  echo "[launchd]   Kurulum: brew install ffmpeg"
fi

# v13 — PostgreSQL@16 launchd birimi için binary + PGDATA tespiti.
PG_PREFIX="$(brew --prefix postgresql@16 2>/dev/null || true)"
POSTGRES_BIN="${PG_PREFIX:+$PG_PREFIX/bin/postgres}"
PGDATA_DIR="$(brew --prefix 2>/dev/null)/var/postgresql@16"
if [ -z "$POSTGRES_BIN" ] || [ ! -x "$POSTGRES_BIN" ]; then
  echo "[launchd] HATA: postgresql@16 bulunamadı." >&2
  echo "[launchd]   Kurulum: brew install postgresql@16" >&2
  exit 1
fi
if [ ! -d "$PGDATA_DIR" ]; then
  echo "[launchd] HATA: PGDATA klasörü yok: $PGDATA_DIR" >&2
  echo "[launchd]   Onarım: brew postinstall postgresql@16   (initdb tetikler)" >&2
  exit 1
fi
if [ ! -w "$PGDATA_DIR" ]; then
  echo "[launchd] HATA: PGDATA yazılabilir değil: $PGDATA_DIR" >&2
  echo "[launchd]   Sahiplik: $(stat -f '%Su:%Sg %Sp' "$PGDATA_DIR" 2>/dev/null || echo '?')" >&2
  exit 1
fi
if [ ! -f "$PGDATA_DIR/PG_VERSION" ]; then
  echo "[launchd] HATA: PG_VERSION yok ($PGDATA_DIR) — PGDATA bozuk veya initdb edilmemiş" >&2
  exit 1
fi

# v13 — Foreground postgres wrapper (preflight + stale pid temizliği).
POSTGRES_RUNNER="$SCRIPT_DIR/run-postgres.sh"
[ -x "$POSTGRES_RUNNER" ] || chmod +x "$POSTGRES_RUNNER" 2>/dev/null || true
[ -x "$POSTGRES_RUNNER" ] || { echo "[launchd] HATA: run-postgres.sh çalıştırılabilir değil" >&2; exit 1; }

# v13 — Çift başlılığı önle: brew services'in postgres'ini sessizce kapat ve
# 5432 boşalmasını bekle (eski postgres süreci sönmeden ELARA'yı yükleme).
if command -v brew >/dev/null 2>&1; then
  brew services stop postgresql@16 >/dev/null 2>&1 || true
  brew services stop postgresql    >/dev/null 2>&1 || true
fi
for i in 1 2 3 4 5 6 7 8 9 10; do
  if ! lsof -nP -i TCP:5432 -sTCP:LISTEN >/dev/null 2>&1; then break; fi
  [ "$i" -eq 1 ] && echo "[launchd] :5432 hâlâ dolu — eski postgres'in kapanması bekleniyor"
  sleep 1
done

# Birim sırası ÖNEMLİ: postgres en başta — middleware uyanmadan 5432 sıcak olsun.
UNITS=(
  "com.elara.postgres"
  "com.elara.middleware"
  "com.elara.vite"
  "com.elara.tls-proxy"
)

case "${1:-install}" in
  --status)
    echo "[launchd] durum:"
    for u in "${UNITS[@]}"; do
      short="${u#com.elara.}"
      printf "  %-24s " "$u"
      if info=$(launchctl list "$u" 2>/dev/null); then
        pid=$(echo "$info" | awk -F'=' '/"PID"/{gsub(/[ ;]/,"",$2); print $2}')
        rc=$(echo "$info"  | awk -F'=' '/"LastExitStatus"/{gsub(/[ ;]/,"",$2); print $2}')
        echo "PID=${pid:-—} RC=${rc:-0}  log=/tmp/elara-${short}.out.log"
      else
        echo "yüklü değil"
      fi
    done
    echo ""
    pg_isready -h 127.0.0.1 -p 5432 -q \
      && echo "  ✓ postgres :5432 hazır" \
      || echo "  ✗ postgres :5432 yanıt vermiyor"
    echo ""
    echo "[launchd] son postgres logları (err/out, son 20 satır):"
    tail -n 20 /tmp/elara-postgres.err.log 2>/dev/null | sed 's/^/  err| /' || true
    tail -n 10 /tmp/elara-postgres.out.log 2>/dev/null | sed 's/^/  out| /' || true
    exit 0
    ;;
  --reload)
    echo "[launchd] reload — mevcut birimler boşaltılıyor"
    for u in "${UNITS[@]}"; do
      launchctl unload "$LAUNCH_DIR/${u}.plist" 2>/dev/null || true
    done
    ;;
  install|"") : ;;
  *) echo "[launchd] bilinmeyen flag: $1" >&2; exit 2 ;;
esac

echo "[launchd] Kurulum başlıyor"
echo "  proje    : $PROJECT_ROOT"
echo "  bun      : $BUN_BIN"
echo "  node     : $NODE_BIN"
echo "  postgres : $POSTGRES_BIN"
echo "  pgdata   : $PGDATA_DIR"
echo "  hedef    : $LAUNCH_DIR"
echo ""

for u in "${UNITS[@]}"; do
  src="$SCRIPT_DIR/${u}.plist"
  dst="$LAUNCH_DIR/${u}.plist"
  [ -f "$src" ] || { echo "  ✗ $u — şablon bulunamadı: $src" >&2; exit 1; }

  # Placeholder hidrasyonu — sed delim olarak '|' kullan (path'lerde / var)
  sed \
    -e "s|__BUN__|$BUN_BIN|g" \
    -e "s|__NODE__|$NODE_BIN|g" \
    -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|__POSTGRES_BIN__|$POSTGRES_BIN|g" \
    -e "s|__PGDATA__|$PGDATA_DIR|g" \
    -e "s|__POSTGRES_RUNNER__|$POSTGRES_RUNNER|g" \
    "$src" > "$dst"

  # ADMIN_API_TOKEN — sadece middleware unit'ine, .env'den oku ve installed
  # plist'in EnvironmentVariables dict'ine enjekte et. Repo template'i secret
  # tutmaz; tek kaynak local-server/.env'dir.
  if [ "$u" = "com.elara.middleware" ]; then
    ENV_SRC="$PROJECT_ROOT/local-server/.env"
    if [ -f "$ENV_SRC" ]; then
      ADMIN_TOKEN="$(grep -E '^ADMIN_API_TOKEN=' "$ENV_SRC" \
        | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
      if [ -n "${ADMIN_TOKEN:-}" ]; then
        /usr/libexec/PlistBuddy \
          -c "Delete :EnvironmentVariables:ADMIN_API_TOKEN" \
          "$dst" 2>/dev/null || true
        /usr/libexec/PlistBuddy \
          -c "Add :EnvironmentVariables:ADMIN_API_TOKEN string $ADMIN_TOKEN" \
          "$dst"
        echo "  · ADMIN_API_TOKEN .env'den enjekte edildi"
      else
        echo "  · UYARI: $ENV_SRC içinde ADMIN_API_TOKEN yok — admin endpoint'leri 401 dönecek"
        echo "           üret: openssl rand -hex 32 ; sonra ADMIN_API_TOKEN=… olarak .env'e ekle"
      fi
    fi
  fi

  # Mevcut yüklüyse boşalt → tekrar yükle (idempotent)
  launchctl unload "$dst" 2>/dev/null || true
  launchctl load -w "$dst"
  echo "  ✓ $u yüklü"
done

echo ""
echo "[launchd] HAZIR. Servisler şimdi çalışıyor ve login'de otomatik açılacak."
echo ""
echo "Durum kontrol:"
echo "  bash $SCRIPT_DIR/install-launchd.sh --status"
echo ""
echo "Loglar:"
for u in "${UNITS[@]}"; do
  short="${u#com.elara.}"
  echo "  tail -f /tmp/elara-${short}.out.log /tmp/elara-${short}.err.log"
done
echo ""
echo "Sağlık probu (10-15sn sonra):"
echo "  pg_isready -h 127.0.0.1 -p 5432            && echo ✓ postgres"
echo "  curl -sf http://127.0.0.1:3005/api/health  && echo ✓ middleware"
echo "  curl -ksf https://127.0.0.1:3006/api/health && echo ✓ middleware-tls"
echo "  curl -sf http://127.0.0.1:8080             && echo ✓ vite"
echo "  curl -ksf https://127.0.0.1:10443/api/health && echo ✓ tls-proxy /api → 3005"
echo "  curl -ksf https://127.0.0.1:10443             && echo ✓ tls-proxy /    → 8080"
echo ""
echo "Güvenli yeniden başlatma (port temizliği + kickstart + health):"
echo "  bash $PROJECT_ROOT/local-server/scripts/middleware-restart.sh   # 3005 + 3006"
