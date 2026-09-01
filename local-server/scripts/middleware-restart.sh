#!/usr/bin/env bash
# Middleware'i zorla yeniden başlat: önce port kilidini kır, sonra launchd'yi
# kickstart et. Reboot ihtiyacını ortadan kaldırır. RBI restart'ın ikizidir.
#
# v2: embed worker port'unu da temizler ve worker /health geçene kadar bekler.
# Eski sürüm middleware'i öldürünce Python embed worker'ı orphan kalıyor, yeni
# middleware onu "online-external" sanıyor ve respawn etmiyordu — sonuç: zombi
# worker, sessiz embed_miss. Bu sürüm orphan bırakmaz.
set -u

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
EMBED_PORT="${EMBED_WORKER_PORT:-}"
if [ -z "$EMBED_PORT" ] && [ -f "$ENV_FILE" ]; then
  EMBED_PORT=$(grep -E '^EMBED_WORKER_PORT=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs)
fi
EMBED_PORT="${EMBED_PORT:-8082}"

PORTS=(3005 3006 "$EMBED_PORT")
LABEL="com.elara.middleware"

echo "[mw-restart] port temizliği: ${PORTS[*]}  (embed worker port = $EMBED_PORT)"
for p in "${PORTS[@]}"; do
  pids=$(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[mw-restart] :$p tutan PID'ler: $pids — SIGKILL"
    kill -9 $pids 2>/dev/null || true
  else
    echo "[mw-restart] :$p boş"
  fi
done

# Embed worker'ı Python process adıyla da temizle — port socket FD parent'tan
# miras kalmış olabilir, sadece port kapatmak yetmez.
PY_PIDS=$(pgrep -f "worker\.py.*--port.*${EMBED_PORT}" 2>/dev/null || true)
if [ -n "$PY_PIDS" ]; then
  echo "[mw-restart] orphan worker.py PID'leri: $PY_PIDS — SIGKILL"
  kill -9 $PY_PIDS 2>/dev/null || true
fi

UID_NUM=$(id -u)
echo "[mw-restart] launchctl kickstart -k gui/${UID_NUM}/${LABEL}"
launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" || {
  echo "[mw-restart] kickstart başarısız — bootstrap deniyorum"
  PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
  if [ -f "$PLIST" ]; then
    launchctl bootstrap "gui/${UID_NUM}" "$PLIST" 2>/dev/null || true
    launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" || true
  else
    echo "[mw-restart] HATA: $PLIST yok. Önce: bash local-server/launchd/install-launchd.sh"
  fi
}

WAIT_MAX="${MW_RESTART_WAIT:-30}"
echo "[mw-restart] middleware portları en fazla ${WAIT_MAX}sn bekliyorum (1sn poll):"
ok=0
for i in $(seq 1 "$WAIT_MAX"); do
  up=1
  for p in 3005 3006; do
    lsof -tiTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || up=0
  done
  if [ "$up" -eq 1 ]; then ok=1; echo "  ✓ portlar ${i}sn içinde açıldı"; break; fi
  sleep 1
done
for p in 3005 3006; do
  if lsof -tiTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  :$p  LISTEN ✓"
  else
    echo "  :$p  KAPALI ✗"
    ok=0
  fi
done

if [ "$ok" -ne 1 ]; then
  echo ""
  echo "[mw-restart] son middleware logları (err, 60 satır):"
  tail -n 60 /tmp/elara-middleware.err.log 2>/dev/null | sed 's/^/  err| /' || true
  echo "[mw-restart] son middleware logları (out, 40 satır):"
  tail -n 40 /tmp/elara-middleware.out.log 2>/dev/null | sed 's/^/  out| /' || true
  exit 1
fi

curl -sf  http://127.0.0.1:3005/api/health   >/dev/null && echo "  /api/health  (HTTP 3005)  ✓" || echo "  /api/health  (HTTP 3005)  ✗"
curl -ksf https://127.0.0.1:3006/api/health  >/dev/null && echo "  /api/health  (HTTPS 3006) ✓" || echo "  /api/health  (HTTPS 3006) ✗"

# ---- Worker boot + health poll ---------------------------------------------
# v10: Worker start/stop/status uçları artık loopback'ten auth'suz çalışıyor.
# Token sadece bilgi amaçlı; mismatch olsa bile restart akışı durmaz.
ADMIN_TOKEN=""
if [ -f "$ENV_FILE" ]; then
  ADMIN_TOKEN=$(grep -E '^[[:space:]]*(export[[:space:]]+)?ADMIN_API_TOKEN=' "$ENV_FILE" \
    | tail -n1 \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?ADMIN_API_TOKEN=//' \
    | tr -d '"' | tr -d "'" | xargs)
fi

# Bilgi amaçlı token mutabakat raporu (artık fatal değil).
if [ -n "$ADMIN_TOKEN" ]; then
  diag_json=$(curl -sf http://127.0.0.1:3005/api/system/diag/admin-token || true)
  if [ -n "$diag_json" ]; then
    MW_LEN=$(echo "$diag_json"    | sed -nE 's/.*"len":([0-9]+).*/\1/p')
    MW_PREFIX=$(echo "$diag_json" | sed -nE 's/.*"prefix":"([^"]*)".*/\1/p')
    MW_SUFFIX=$(echo "$diag_json" | sed -nE 's/.*"suffix":"([^"]*)".*/\1/p')
    LOCAL_LEN=${#ADMIN_TOKEN}
    LOCAL_PREFIX=${ADMIN_TOKEN:0:4}
    LOCAL_SUFFIX=${ADMIN_TOKEN: -4}
    if [ "$MW_LEN" = "$LOCAL_LEN" ] && [ "$MW_PREFIX" = "$LOCAL_PREFIX" ] && [ "$MW_SUFFIX" = "$LOCAL_SUFFIX" ]; then
      echo "[mw-restart] token mutabakat ✓ (len=$MW_LEN)"
    else
      echo "[mw-restart] uyarı: launchd ADMIN_API_TOKEN ≠ .env (mw len=$MW_LEN, env len=$LOCAL_LEN) — loopback bypass açık, akış devam ediyor"
    fi
  fi
fi

echo "[mw-restart] worker spawn istiyor → POST /api/system/worker/start (loopback)"
start_resp=$(curl -s -w $'\n__HTTP__%{http_code}' -X POST \
  http://127.0.0.1:3005/api/system/worker/start \
  ${ADMIN_TOKEN:+-H "x-admin-token: $ADMIN_TOKEN"} || true)
start_code=$(printf '%s' "$start_resp" | awk -F'__HTTP__' 'END{print $2}')
start_body=$(printf '%s' "$start_resp" | sed -E 's/__HTTP__[0-9]+$//')
echo "  HTTP $start_code"
echo "  body: $start_body"

WORKER_WAIT="${WORKER_WAIT:-60}"
echo "[mw-restart] worker /health en fazla ${WORKER_WAIT}sn bekliyorum:"
worker_ok=0
last_status=""
for i in $(seq 1 "$WORKER_WAIT"); do
  status_json=$(curl -sf ${ADMIN_TOKEN:+-H "x-admin-token: $ADMIN_TOKEN"} \
    http://127.0.0.1:3005/api/system/worker/status 2>/dev/null || true)
  if [ -n "$status_json" ]; then
    last_status="$status_json"
    if echo "$status_json" | grep -q '"healthy":true'; then
      worker_ok=1
      echo "  ✓ worker ${i}sn içinde hazır"
      break
    fi
    if echo "$status_json" | grep -q '"locked":true'; then
      echo "  ✗ worker circuit-breaker locked"
      break
    fi
  fi
  sleep 1
done

if [ "$worker_ok" -eq 1 ]; then
  echo "[mw-restart] WORKER READY ✓"
else
  echo "[mw-restart] WORKER FAILED ✗"
  echo "  son status: $last_status"
  echo "  start body: $start_body"
  echo ""
  echo "[mw-restart] son worker log satırları (err, 60 satır, worker ile ilgili):"
  tail -n 200 /tmp/elara-middleware.err.log 2>/dev/null \
    | grep -Ei 'worker|uvicorn|embed|python|spawn|traceback|error|exit' \
    | tail -n 60 | sed 's/^/  err| /' || true
  echo ""
  echo "  → RAG sorguları embed_miss dönecek. Tam log:"
  echo "    tail -n 200 /tmp/elara-middleware.err.log"
  exit 2
fi

