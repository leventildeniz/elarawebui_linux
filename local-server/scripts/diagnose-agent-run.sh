#!/usr/bin/env bash
# diagnose-agent-run.sh — Read-only agent dispatch diagnostic.
# Usage: bash local-server/scripts/diagnose-agent-run.sh [AgentName] [query]
# Default: Firewall_Oracle "fortigate nat nasıl yapılır?"
#
# What it does (NO state changes):
#   1. Confirms middleware is up (launchctl + /health).
#   2. Looks up the agent via /api/agents and prints script/path/meta.
#   3. Snapshots /api/agents/runs.
#   4. Records the err.log byte offset.
#   5. POSTs /api/agents/:id/run with the query.
#   6. Tails ONLY the new log lines and greps for the agent/queue markers.
#   7. Writes everything to /tmp/elara-agent-diagnose-<ts>.log + short summary.

set -u

AGENT_NAME="${1:-Firewall_Oracle}"
QUERY="${2:-fortigate nat nasıl yapılır?}"

BRIDGE="http://127.0.0.1:3005"
ERR_LOG="/tmp/elara-middleware.err.log"
OUT_LOG="/tmp/elara-middleware.out.log"
TS="$(date +%Y%m%d-%H%M%S)"
REPORT="/tmp/elara-agent-diagnose-${TS}.log"

# Summary vars
PROC_UP="no"
HEALTH="-"
AGENT_FOUND="no"
AGENT_ID=""
AGENT_STATUS=""
META_SCRIPT=""
AGENT_PATH=""
INTERPRETER=""
HTTP_STATUS=""
ROUTE_HIT="no"
CLASSIC_PATH="no"
SPAWN_PREPARE="no"
QUEUE_ENQ="no"
QUEUE_RUN="no"
AUTH_BLOCK="no"
NEXT_ACTION=""

log() { printf '%s\n' "$*" | tee -a "$REPORT" >/dev/null; }
hdr() { printf '\n===== %s =====\n' "$*" | tee -a "$REPORT" >/dev/null; }

: > "$REPORT"
log "elara agent diagnose · $(date)"
log "agent=$AGENT_NAME"
log "query=$QUERY"
log "bridge=$BRIDGE"
log "err_log=$ERR_LOG"

hdr "1. process check"
if launchctl list 2>/dev/null | grep -q 'com.elara.middleware'; then
  PROC_UP="yes"
  launchctl list 2>/dev/null | grep 'com.elara.middleware' | tee -a "$REPORT" >/dev/null
fi
log "PROC_UP=$PROC_UP"

hdr "2. /health"
HC="$(curl -sS -o /tmp/.elara-diag-health -w '%{http_code}' --max-time 5 "$BRIDGE/health" 2>>"$REPORT" || true)"
HEALTH="$HC"
log "HEALTH_HTTP=$HC"
[ -f /tmp/.elara-diag-health ] && head -c 2000 /tmp/.elara-diag-health | tee -a "$REPORT" >/dev/null

hdr "3. agent lookup via /api/agents"
curl -sS --max-time 15 "$BRIDGE/api/agents" -o /tmp/.elara-diag-agents -w 'HTTP=%{http_code}\n' 2>>"$REPORT" | tee -a "$REPORT" >/dev/null
AGENTS_HTTP_GET="$(awk -F= '/^HTTP=/{print $2}' "$REPORT" | tail -1)"
if [ "$AGENTS_HTTP_GET" = "401" ] || [ "$AGENTS_HTTP_GET" = "403" ]; then
  AUTH_BLOCK="yes"
fi

if [ -s /tmp/.elara-diag-agents ]; then
  python3 - "$AGENT_NAME" /tmp/.elara-diag-agents >>"$REPORT" 2>&1 <<'PY' || true
import json, sys
name = sys.argv[1].lower()
try:
    data = json.load(open(sys.argv[2]))
except Exception as e:
    print(f"AGENT_PARSE_ERR={e}")
    sys.exit(0)
rows = data if isinstance(data, list) else data.get("agents") or data.get("rows") or []
hit = None
for r in rows:
    nm = str(r.get("name") or r.get("agent_name") or "").lower()
    if nm == name or nm == name.replace(".py","") or nm.replace(".py","") == name:
        hit = r; break
if not hit:
    print(f"AGENT_FOUND=no rows={len(rows)}")
    for r in rows[:20]:
        print("  candidate:", r.get("name") or r.get("agent_name"))
    sys.exit(0)
meta = hit.get("meta") or {}
print("AGENT_FOUND=yes")
print(f"AGENT_ID={hit.get('id','')}")
print(f"AGENT_STATUS={hit.get('status','')}")
print(f"AGENT_PATH={hit.get('agent_path','') or meta.get('agentPath','')}")
print(f"INTERPRETER={hit.get('interpreter_path','') or meta.get('interpreterPath','')}")
print(f"META_SCRIPT={meta.get('script','')}")
print(f"META_SQUAD={meta.get('squad','')}")
print(f"STOP_GRACE_MS={hit.get('stop_grace_ms','')}")
PY

  # Re-extract the summary fields from the python output into shell vars.
  AGENT_FOUND="$(awk -F= '/^AGENT_FOUND=/{print $2; exit}' "$REPORT")"
  AGENT_ID="$(awk -F= '/^AGENT_ID=/{print $2; exit}' "$REPORT")"
  AGENT_STATUS="$(awk -F= '/^AGENT_STATUS=/{print $2; exit}' "$REPORT")"
  AGENT_PATH="$(awk -F= '/^AGENT_PATH=/{print $2; exit}' "$REPORT")"
  INTERPRETER="$(awk -F= '/^INTERPRETER=/{print $2; exit}' "$REPORT")"
  META_SCRIPT="$(awk -F= '/^META_SCRIPT=/{print $2; exit}' "$REPORT")"
fi

hdr "4. /api/agents/runs snapshot"
curl -sS --max-time 5 "$BRIDGE/api/agents/runs" -o /tmp/.elara-diag-runs -w 'HTTP=%{http_code}\n' 2>>"$REPORT" | tee -a "$REPORT" >/dev/null
[ -f /tmp/.elara-diag-runs ] && head -c 4000 /tmp/.elara-diag-runs | tee -a "$REPORT" >/dev/null

hdr "5. log offsets BEFORE dispatch"
ERR_OFFSET=0
if [ -f "$ERR_LOG" ]; then
  ERR_OFFSET=$(wc -c < "$ERR_LOG" | tr -d ' ')
fi
log "ERR_LOG_OFFSET=$ERR_OFFSET"

hdr "6. POST /api/agents/:id/run"
if [ "$AGENT_FOUND" != "yes" ] || [ -z "$AGENT_ID" ]; then
  log "SKIP dispatch — agent not resolved."
  NEXT_ACTION="Agent kaydı bulunamadı. /api/agents listesinde '$AGENT_NAME' var mı kontrol et."
else
  # Build a body the backend accepts both shapes (params + text).
  python3 - "$QUERY" > /tmp/.elara-diag-body <<'PY'
import json, sys
q = sys.argv[1]
print(json.dumps({"params": {"query": q, "input": q, "text": q}, "text": q}))
PY
  log "POST $BRIDGE/api/agents/$AGENT_ID/run"
  HTTP_STATUS="$(curl -sS -o /tmp/.elara-diag-resp -w '%{http_code}' \
    --max-time 130 \
    -H 'Content-Type: application/json' \
    --data-binary @/tmp/.elara-diag-body \
    "$BRIDGE/api/agents/$AGENT_ID/run" 2>>"$REPORT" || echo "000")"
  log "HTTP_STATUS=$HTTP_STATUS"
  if [ "$HTTP_STATUS" = "401" ] || [ "$HTTP_STATUS" = "403" ]; then
    AUTH_BLOCK="yes"
  fi
  log "---- response body (first 4KB) ----"
  head -c 4000 /tmp/.elara-diag-resp 2>/dev/null | tee -a "$REPORT" >/dev/null
  printf '\n' | tee -a "$REPORT" >/dev/null
fi

hdr "7. new log lines (post-dispatch)"
if [ -f "$ERR_LOG" ]; then
  NEW_BYTES=$(( $(wc -c < "$ERR_LOG" | tr -d ' ') - ERR_OFFSET ))
  log "NEW_ERR_BYTES=$NEW_BYTES"
  if [ "$NEW_BYTES" -gt 0 ]; then
    tail -c "$NEW_BYTES" "$ERR_LOG" > /tmp/.elara-diag-newlog
    log "---- markers in new log ----"
    grep -E '\[agent-run\]|\[agent-spawn\]|\[agent-bridge\]|\[mlx\.queue\]' /tmp/.elara-diag-newlog | tee -a "$REPORT" >/dev/null || log "(no markers)"
    log "---- full new log (last 200 lines) ----"
    tail -n 200 /tmp/.elara-diag-newlog | tee -a "$REPORT" >/dev/null

    grep -q '\[agent-run\] request'         /tmp/.elara-diag-newlog && ROUTE_HIT="yes"
    grep -q '\[agent-run\] classic-execfile' /tmp/.elara-diag-newlog && CLASSIC_PATH="yes"
    grep -q '\[agent-run\] spawn.prepare'    /tmp/.elara-diag-newlog && SPAWN_PREPARE="yes"
    grep -qE '\[agent-spawn\] enqueue|\[mlx\.queue\] queued'  /tmp/.elara-diag-newlog && QUEUE_ENQ="yes"
    grep -qE '\[agent-spawn\] running|\[mlx\.queue\] running' /tmp/.elara-diag-newlog && QUEUE_RUN="yes"
  fi
else
  log "ERR_LOG not found: $ERR_LOG"
fi

# Decide NEXT_ACTION
if [ -z "$NEXT_ACTION" ]; then
  if [ "$AUTH_BLOCK" = "yes" ]; then
    NEXT_ACTION="Loopback /api/agents auth-gated. Ayrı turda /api/agents için loopback bypass veya token akışı planlanmalı."
  elif [ "$ROUTE_HIT" = "no" ]; then
    NEXT_ACTION="HTTP yanıt geldi ama '[agent-run] request' yok — log prefix kontrolü veya route alternatif (status==error early return) bak."
  elif [ "$CLASSIC_PATH" = "yes" ] && [ "$SPAWN_PREPARE" = "no" ]; then
    NEXT_ACTION="Klasik execFile yoluna düştü → meta.script boş veya .py değil. Agent kaydında meta.script='${AGENT_NAME}.py' set edilmeli."
  elif [ "$SPAWN_PREPARE" = "yes" ] && [ "$QUEUE_ENQ" = "no" ]; then
    NEXT_ACTION="spawn.prepare var ama enqueue yok → spawnAgentRun içinde fırlatılan exception. agent-bridge allowlist veya path_escape muhtemel."
  elif [ "$QUEUE_ENQ" = "yes" ] && [ "$QUEUE_RUN" = "no" ]; then
    NEXT_ACTION="Kuyrukta sıkıştı (slot dolu/breaker). MLX queue snapshot bak."
  elif [ "$QUEUE_RUN" = "yes" ]; then
    NEXT_ACTION="Child koştu — kalite/loop sorunu. Agent prompt + stop_sequences turuna geç."
  else
    NEXT_ACTION="Belirsiz; rapor dosyasını paylaş."
  fi
fi

hdr "SUMMARY"
{
  printf 'PROC_UP=%s\n'      "$PROC_UP"
  printf 'HEALTH=%s\n'       "$HEALTH"
  printf 'AGENT_FOUND=%s\n'  "$AGENT_FOUND"
  printf 'AGENT_ID=%s\n'     "$AGENT_ID"
  printf 'AGENT_STATUS=%s\n' "$AGENT_STATUS"
  printf 'META_SCRIPT=%s\n'  "$META_SCRIPT"
  printf 'AGENT_PATH=%s\n'   "$AGENT_PATH"
  printf 'INTERPRETER=%s\n'  "$INTERPRETER"
  printf 'HTTP_STATUS=%s\n'  "$HTTP_STATUS"
  printf 'ROUTE_HIT=%s\n'    "$ROUTE_HIT"
  printf 'CLASSIC_PATH=%s\n' "$CLASSIC_PATH"
  printf 'SPAWN_PREPARE=%s\n' "$SPAWN_PREPARE"
  printf 'QUEUE_ENQ=%s\n'    "$QUEUE_ENQ"
  printf 'QUEUE_RUN=%s\n'    "$QUEUE_RUN"
  printf 'AUTH_BLOCK=%s\n'   "$AUTH_BLOCK"
  printf 'NEXT_ACTION=%s\n'  "$NEXT_ACTION"
  printf 'REPORT=%s\n'       "$REPORT"
} | tee -a "$REPORT"
