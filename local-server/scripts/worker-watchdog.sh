#!/usr/bin/env bash
# worker-watchdog.sh — Dışarıdan embed worker (port 8082) sağlık watchdog'u.
#
# Drain sırasında manuel müdahale beklemeden kendini toparlasın diye.
# Worker /health 2x üst üste (60sn) cevapsız/bozuksa middleware'in
# /api/system/restart-worker endpoint'ini çağırır (port kill + cooldown reset
# + spawn + verifyEmbedAlive). Saatte 4 restart cap — kalıcı bug'da sonsuz
# döngü olmasın.
#
# KULLANIM:
#   chmod +x local-server/scripts/worker-watchdog.sh
#   nohup local-server/scripts/worker-watchdog.sh > /tmp/elara-worker-watchdog.out 2>&1 &
#   echo $! > /tmp/elara-worker-watchdog.pid
#   tail -f /tmp/elara-worker-watchdog.log
#
# Drain biter bitmez:
#   kill $(cat /tmp/elara-worker-watchdog.pid)
#
# launchd kaydı YOK — geçici tedbir, kalıcı çözüm worker.py revert (yapıldı).

set -uo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8082/health}"
RESTART_URL="${RESTART_URL:-http://127.0.0.1:3005/api/system/restart-worker}"
INTERVAL="${INTERVAL:-30}"                        # poll periyodu (sn)
FAIL_THRESHOLD="${FAIL_THRESHOLD:-2}"             # bu kadar üst üste fail → restart
COOLDOWN_AFTER_RESTART="${COOLDOWN_AFTER_RESTART:-180}"  # restart sonrası bekleme (sn)
MAX_RESTARTS_PER_HOUR="${MAX_RESTARTS_PER_HOUR:-4}"
MIN_HEALTHY_UPTIME="${MIN_HEALTHY_UPTIME:-30}"    # uptime<bu ise her zaman sağlıklı say (cold start marjı)
LOG="${LOG:-/tmp/elara-worker-watchdog.log}"
RESTART_LOG="${RESTART_LOG:-/tmp/elara-worker-watchdog.restarts}"

fail_count=0
touch "$LOG" "$RESTART_LOG"

log() {
  local msg="$1"
  echo "$(date '+%Y-%m-%d %H:%M:%S') $msg" | tee -a "$LOG"
}

cleanup() {
  log "[stop] watchdog terminating (signal)"
  exit 0
}
trap cleanup INT TERM

# Restart frekans cap — son 3600sn içindeki restart sayısı.
recent_restart_count() {
  local now cutoff
  now=$(date +%s)
  cutoff=$(( now - 3600 ))
  awk -v c="$cutoff" '$1 >= c' "$RESTART_LOG" | wc -l | tr -d ' '
}

log "[start] watchdog up · interval=${INTERVAL}s · fail_threshold=${FAIL_THRESHOLD} · cooldown=${COOLDOWN_AFTER_RESTART}s · cap=${MAX_RESTARTS_PER_HOUR}/h"

while true; do
  body=$(curl -s --max-time 5 -o - -w "\n%{http_code}" "$HEALTH_URL" 2>/dev/null || true)
  http_code=$(printf '%s\n' "$body" | tail -n1)
  json=$(printf '%s\n' "$body" | sed '$d')

  healthy=0
  uptime="?"
  footprint="?"

  if [[ "$http_code" == "200" ]] && [[ -n "$json" ]]; then
    uptime=$(printf '%s' "$json" | jq -r 'try .uptime_s // empty' 2>/dev/null)
    footprint=$(printf '%s' "$json" | jq -r 'try .footprint_gb // empty' 2>/dev/null)
    if [[ -n "$uptime" ]] && [[ "$uptime" != "null" ]]; then
      healthy=1
    fi
  fi

  if [[ "$healthy" == "1" ]]; then
    if (( fail_count > 0 )); then
      log "[recover] ok footprint=${footprint}GB uptime=${uptime}s (fail_count reset)"
    else
      log "[ok] footprint=${footprint}GB uptime=${uptime}s"
    fi
    fail_count=0
  else
    fail_count=$(( fail_count + 1 ))
    log "[fail ${fail_count}/${FAIL_THRESHOLD}] http=${http_code} body_bytes=${#json}"

    if (( fail_count >= FAIL_THRESHOLD )); then
      recent=$(recent_restart_count)
      if (( recent >= MAX_RESTARTS_PER_HOUR )); then
        log "[panic] ${recent} restarts in last hour ≥ cap ${MAX_RESTARTS_PER_HOUR} — sleeping 30min (no restart)"
        sleep 1800
        fail_count=0
        continue
      fi

      log "[restart] triggering POST ${RESTART_URL} (recent_in_hour=${recent})"
      r=$(curl -s --max-time 30 -X POST -o - -w "\n%{http_code}" "$RESTART_URL" 2>/dev/null || true)
      r_code=$(printf '%s\n' "$r" | tail -n1)
      r_body=$(printf '%s\n' "$r" | sed '$d' | head -c 400)
      echo "$(date +%s) http=${r_code}" >> "$RESTART_LOG"
      log "[restart-result] http=${r_code} body=${r_body}"

      log "[cooldown] sleeping ${COOLDOWN_AFTER_RESTART}s (worker respawn + verifyEmbedAlive marjı)"
      sleep "$COOLDOWN_AFTER_RESTART"
      fail_count=0
      continue
    fi
  fi

  sleep "$INTERVAL"
done
