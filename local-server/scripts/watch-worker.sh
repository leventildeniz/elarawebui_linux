#!/usr/bin/env bash
# watch-worker.sh — macOS'ta `watch` yok; bu wrapper /health'i periyodik basar.
# Worker LAZY: 8082 düşükse "down" yazar, panik etme. İlk embed isteğinde kalkar.
# Kullanım: ./local-server/scripts/watch-worker.sh [interval_seconds]
set -u
INT="${1:-5}"
URL="${WORKER_URL:-http://127.0.0.1:8082/health}"
while true; do
  clear
  echo "=== $(date '+%Y-%m-%d %H:%M:%S')  ·  GET $URL  ·  interval=${INT}s ==="
  body=$(curl -s --max-time 2 "$URL" 2>/dev/null || true)
  if [ -z "$body" ]; then
    echo '{ "status": "down (8082 dinlenmiyor — lazy spawn bekliyor)" }'
  else
    echo "$body" | jq '{rss_gb,mps_gb,footprint_gb,soft_cap_gb,max_rss_gb,uptime_s,req_count,backend,model}' 2>/dev/null \
      || echo "$body"
  fi
  sleep "$INT"
done
