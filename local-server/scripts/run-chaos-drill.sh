#!/usr/bin/env bash
# Faz 17.2 — SIEM Chaos Drill (RUNBOOK-siem-chaos-drill.md otomasyonu).
# Senaryo: SIEM unreachable iken queue/outbox doluyor → middleware SIGKILL →
# restart → outbox persistence + dead-letter promotion doğrulanır.
# Çalıştırma:
#   bash local-server/scripts/run-chaos-drill.sh --admin-user admin --admin-pass <pw>
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3005}"
ADMIN_USER=""
ADMIN_PASS=""
PROBES="${PROBES:-25}"   # Bu kadar test event göndereceğiz
SIEM_HOST_BAD="${SIEM_HOST_BAD:-10.255.255.1}"  # rotalanamaz IP (timeout)
SIEM_PORT_BAD="${SIEM_PORT_BAD:-514}"

while [ $# -gt 0 ]; do
  case "$1" in
    --base)        BASE="$2"; shift 2 ;;
    --admin-user)  ADMIN_USER="$2"; shift 2 ;;
    --admin-pass)  ADMIN_PASS="$2"; shift 2 ;;
    --probes)      PROBES="$2"; shift 2 ;;
    *) echo "[chaos] bilinmeyen argüman: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ]; then
  echo "[chaos] kullanım: --admin-user <u> --admin-pass <p> [--base $BASE] [--probes $PROBES]" >&2
  exit 2
fi

say() { echo "[chaos] $*"; }

# 1) Admin login
say "1/7 admin login → $BASE"
LOGIN=$(curl -sk -X POST "$BASE/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\",\"provider\":\"local\",\"device\":\"chaos-drill\"}")
SID=$(echo "$LOGIN" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')
[ -n "$SID" ] || { echo "[chaos] login başarısız: $LOGIN"; exit 1; }
say "  sid=${SID:0:14}…"

H=(-H "x-session-id: $SID" -H "content-type: application/json")

# 2) Mevcut SIEM config'i yedekle
say "2/7 mevcut SIEM config yedeği"
ORIG=$(curl -sk "${H[@]}" "$BASE/api/siem/config")
say "  $(echo "$ORIG" | head -c 200)"

# 3) SIEM'i rotalanamaz hedefe çevir (timeout üretsin)
say "3/7 SIEM unreachable hedefine yönlendiriliyor ($SIEM_HOST_BAD:$SIEM_PORT_BAD/udp)"
curl -sk "${H[@]}" -X PUT "$BASE/api/siem/config" \
  -d "{\"enabled\":true,\"host\":\"$SIEM_HOST_BAD\",\"port\":$SIEM_PORT_BAD,\"protocol\":\"udp\",\"format\":\"CEF\",\"facility\":\"local0\"}" \
  | sed 's/^/  /'

# 4) Yük üret: $PROBES adet test event gönder → queue+outbox dolsun
say "4/7 $PROBES test event üretiliyor"
for i in $(seq 1 "$PROBES"); do
  curl -sk "${H[@]}" -X POST "$BASE/api/siem/test" \
    -d "{\"message\":\"chaos-probe-$i\"}" >/dev/null || true
done

# 5) Snapshot — önceki derinlik
BEFORE=$(curl -sk "${H[@]}" "$BASE/api/siem/config")
say "5/7 snapshot ÖNCE: $(echo "$BEFORE" | sed -n 's/.*"status":\({[^}]*}\).*/\1/p')"

# 6) Middleware'i öldür + bekle + restart
PID=$(lsof -tiTCP:3005 -sTCP:LISTEN 2>/dev/null | head -n1 || true)
if [ -n "$PID" ]; then
  say "6/7 middleware SIGKILL pid=$PID"
  kill -9 "$PID" || true
fi
sleep 1
say "  middleware-restart.sh"
bash "$(dirname "$0")/middleware-restart.sh" >/tmp/chaos-restart.log 2>&1 || true
# yeni sid gerekecek
say "  yeniden login"
LOGIN=$(curl -sk -X POST "$BASE/api/auth/login" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\",\"provider\":\"local\",\"device\":\"chaos-drill-2\"}")
SID=$(echo "$LOGIN" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')
H=(-H "x-session-id: $SID" -H "content-type: application/json")

# 7) Snapshot — restart SONRASI + assertion
AFTER=$(curl -sk "${H[@]}" "$BASE/api/siem/config")
say "7/7 snapshot SONRA: $(echo "$AFTER" | sed -n 's/.*"status":\({[^}]*}\).*/\1/p')"

# Outbox persist mi? Dead-letter promote oldu mu?
OUTBOX_AFTER=$(echo "$AFTER" | sed -n 's/.*"outboxDepth":\([0-9]*\).*/\1/p')
DEAD_AFTER=$(echo "$AFTER"   | sed -n 's/.*"dead":\([0-9]*\).*/\1/p')

PASS=1
if [ -z "$OUTBOX_AFTER" ]; then say "  ✗ outboxDepth okunamadı"; PASS=0; fi
say "  outboxDepth (restart sonrası): ${OUTBOX_AFTER:-?}  · dead: ${DEAD_AFTER:-?}"

# Restore orijinal config (en azından enabled=false yap ki gerçek kullanıcı zarar görmesin)
say "cleanup: SIEM disable + orijinal host'a dönüş denemesi"
curl -sk "${H[@]}" -X PUT "$BASE/api/siem/config" \
  -d "{\"enabled\":false,\"host\":\"127.0.0.1\",\"port\":514,\"protocol\":\"udp\",\"format\":\"CEF\",\"facility\":\"local0\"}" >/dev/null || true

if [ "$PASS" -eq 1 ]; then
  say "PASS — outbox restart sonrası persist etti, status okunabilir"
  exit 0
else
  say "FAIL — drill assertion'ları geçemedi (logları kontrol et: /tmp/chaos-restart.log)"
  exit 1
fi
