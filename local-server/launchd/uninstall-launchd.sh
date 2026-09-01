#!/usr/bin/env bash
# ============================================================
#  ELARA — launchd uninstaller
#  Varsayılan: uygulama birimlerini kaldırır, com.elara.postgres'e dokunmaz.
#
#  Kullanım:
#    bash uninstall-launchd.sh           # postgres hariç hepsini kaldır
#    bash uninstall-launchd.sh --all     # postgres dahil HER ŞEYİ kaldır
#    bash uninstall-launchd.sh --postgres  # sadece postgres'i kaldır
#
#  Gerekçe: Postgres birimi kale temelidir; reboot sonrası middleware
#  ona bağlanır. Yanlışlıkla silinirse :3005/:3006 sessizce ölür.
# ============================================================
set -euo pipefail

[ "${EUID:-$(id -u)}" -eq 0 ] && { echo "[launchd] HATA: sudo ile çalıştırma." >&2; exit 1; }

LAUNCH_DIR="$HOME/Library/LaunchAgents"

APP_UNITS=(
  "com.elara.middleware"
  "com.elara.vite"
  "com.elara.tls-proxy"
)
CORE_UNITS=(
  "com.elara.postgres"
)

MODE="${1:-app}"
case "$MODE" in
  ""|app|--app)
    UNITS=("${APP_UNITS[@]}")
    echo "[launchd] kaldırılıyor (uygulama birimleri — postgres KORUNUYOR)"
    echo "[launchd] not: postgres'i de silmek için: $0 --all"
    ;;
  --all)
    UNITS=("${APP_UNITS[@]}" "${CORE_UNITS[@]}")
    echo "[launchd] kaldırılıyor (HEPSİ — postgres dahil)"
    ;;
  --postgres)
    UNITS=("${CORE_UNITS[@]}")
    echo "[launchd] kaldırılıyor (yalnızca postgres)"
    ;;
  -h|--help)
    sed -n '2,15p' "$0"; exit 0 ;;
  *)
    echo "[launchd] bilinmeyen flag: $MODE  (kullanım: --app | --all | --postgres)" >&2
    exit 2 ;;
esac

for u in "${UNITS[@]}"; do
  plist="$LAUNCH_DIR/${u}.plist"
  if [ -f "$plist" ]; then
    launchctl unload "$plist" 2>/dev/null || true
    rm -f "$plist"
    echo "  ✓ $u silindi"
  else
    echo "  · $u yüklü değil"
  fi
done
echo "[launchd] HAZIR. Loglar /tmp/elara-*.log altında kalır (manuel sil: rm /tmp/elara-*.log)"
