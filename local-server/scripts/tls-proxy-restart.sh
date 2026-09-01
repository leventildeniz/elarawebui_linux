#!/usr/bin/env bash
# dev-tls-proxy'yi zorla yeniden başlat: port kilidini kır + launchd kickstart.
# middleware-restart.sh ile birebir simetri. RBI'a değil; sadece 10443 nizamiyesine.
set -u

PORTS=(10443)
LABEL="com.elara.tls-proxy"
STATS_PORT="${TLS_PROXY_STATS_PORT:-10444}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
TEMPLATE="$PROJECT_ROOT/local-server/launchd/${LABEL}.plist"
NODE_BIN="$(command -v node || true)"

if [ -n "$NODE_BIN" ] && [ -f "$TEMPLATE" ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  sed \
    -e "s|__NODE__|$NODE_BIN|g" \
    -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__HOME__|$HOME|g" \
    "$TEMPLATE" > "$PLIST"
  echo "[tls-restart] plist self-heal: runtime=$NODE_BIN"
else
  echo "[tls-restart] UYARI: node/template bulunamadı; mevcut plist kullanılacak"
fi

echo "[tls-restart] port temizliği: ${PORTS[*]} (+ stats:$STATS_PORT)"
for p in "${PORTS[@]}" "$STATS_PORT"; do
  pids=$(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[tls-restart] :$p tutan PID'ler: $pids — SIGKILL"
    kill -9 $pids 2>/dev/null || true
  else
    echo "[tls-restart] :$p boş"
  fi
done

# Manuel nohup ile başlatılmış olabilir → onları da süpür.
pkill -f "dev-tls-proxy.mjs" 2>/dev/null || true

UID_NUM=$(id -u)
echo "[tls-restart] launchctl reload gui/${UID_NUM}/${LABEL}"
if [ -f "$PLIST" ]; then
  launchctl bootout "gui/${UID_NUM}" "$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/${UID_NUM}" "$PLIST" 2>/dev/null || true
  launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" || true
else
  echo "[tls-restart] HATA: $PLIST yok. Önce: bash local-server/launchd/install-launchd.sh"
fi

WAIT_MAX="${TLS_RESTART_WAIT:-30}"
echo "[tls-restart] portları en fazla ${WAIT_MAX}sn bekliyorum (1sn poll):"
ok=0
for i in $(seq 1 "$WAIT_MAX"); do
  up=1
  for p in "${PORTS[@]}"; do
    lsof -tiTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || up=0
  done
  if [ "$up" -eq 1 ]; then ok=1; echo "  ✓ portlar ${i}sn içinde açıldı"; break; fi
  sleep 1
done
for p in "${PORTS[@]}"; do
  if lsof -tiTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  :$p  LISTEN ✓"
  else
    echo "  :$p  KAPALI ✗"
    ok=0
  fi
done

if [ "$ok" -eq 1 ]; then
  curl -ksf https://127.0.0.1:10443/api/health >/dev/null && echo "  /api/health (via 10443) ✓" || echo "  /api/health (via 10443) ✗"
  curl -sf  http://127.0.0.1:"$STATS_PORT"/stats >/dev/null && echo "  /stats (ops :$STATS_PORT)  ✓"  || echo "  /stats (ops :$STATS_PORT)  ✗ (proxy stats endpoint yok olabilir)"
else
  echo ""
  echo "[tls-restart] son tls-proxy logları (err, 40 satır):"
  tail -n 40 /tmp/elara-tls-proxy.err.log 2>/dev/null | sed 's/^/  err| /' || true
  echo "[tls-restart] son tls-proxy logları (out, 20 satır):"
  tail -n 20 /tmp/elara-tls-proxy.out.log 2>/dev/null | sed 's/^/  out| /' || true
fi
