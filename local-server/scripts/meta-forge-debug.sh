#!/usr/bin/env bash
# Meta-Forge first/second turn debugger.
#
# Reproduces the exact suspected bug: same creation prompt twice, against both
# chat endpoints, then summarizes SSE frames + backend traces.
#
# Usage:
#   ELARA_USERNAME=admin ELARA_PASSWORD='***' bash local-server/scripts/meta-forge-debug.sh
#   SKIP_STREAM=1 bash local-server/scripts/meta-forge-debug.sh "phishing triage skill yaz"
#
# Output:
#   /tmp/meta-forge-debug-YYYYmmdd-HHMMSS/
set -u

BASE="${ELARA_BASE:-http://127.0.0.1:3005}"
PROVIDER="${ELARA_PROVIDER:-local}"
MODEL="${ELARA_MODEL:-elara-72b-mlx}"
PROMPT="${1:-phishing triage skill yaz}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUT_DIR:-/tmp/meta-forge-debug-${TS}}"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/summary.txt"
: > "$SUMMARY"

log() { printf '%s\n' "$*" | tee -a "$SUMMARY"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1" >&2; exit 2; }; }
need curl
need jq

USERNAME="${ELARA_USERNAME:-${ELARA_USER:-}}"
PASSWORD="${ELARA_PASSWORD:-${ELARA_PASS:-}}"
if [ -z "$USERNAME" ]; then
  printf 'Elara kullanıcı adı: ' >&2
  read -r USERNAME
fi
if [ -z "$PASSWORD" ]; then
  printf 'Elara parola (%s): ' "$USERNAME" >&2
  stty -echo 2>/dev/null
  read -r PASSWORD
  stty echo 2>/dev/null
  printf '\n' >&2
fi
if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
  echo "username/password boş" >&2
  exit 1
fi

# --cold mode: kickstart middleware, wait for :3005, then run debug turns.
if [ "${1:-}" = "--cold" ] || [ "${COLD:-0}" = "1" ]; then
  echo "[cold] launchctl kickstart -k gui/$UID/com.elara.middleware" >&2
  launchctl kickstart -k "gui/$UID/com.elara.middleware" 2>/dev/null || true
  for i in $(seq 1 30); do
    if curl -sk --max-time 2 "$BASE/api/health" >/dev/null 2>&1; then
      echo "[cold] middleware up after ${i}s" >&2
      break
    fi
    sleep 1
  done
  # Shift --cold out so $1 downstream stays clean
  [ "${1:-}" = "--cold" ] && shift || true
  PROMPT="${1:-$PROMPT}"
fi


COOKIE="$OUT_DIR/cookie.txt"
CURL=(curl -sk --max-time 240 -b "$COOKIE" -c "$COOKIE")

auth_curl() {
  "${CURL[@]}" \
    -H "X-Session-Id: ${SESSION_ID:-}" \
    -H "X-User: $USERNAME" \
    "$@"
}

log "# Meta-Forge Debug $TS"
log "base=$BASE"
log "model=$MODEL"
log "prompt=$PROMPT"
log "out=$OUT_DIR"
log ""

LOGIN_PAYLOAD=$(jq -nc --arg u "$USERNAME" --arg p "$PASSWORD" --arg pr "$PROVIDER" \
  '{username:$u,password:$p,provider:$pr,device:"meta-forge-debug"}')
LOGIN_RESP=$("${CURL[@]}" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "$LOGIN_PAYLOAD")
SESSION_ID=$(printf '%s' "$LOGIN_RESP" | jq -r '.sessionId // empty' 2>/dev/null)
ROLE=$(printf '%s' "$LOGIN_RESP" | jq -r '.user.role // .role // empty' 2>/dev/null)
if [ -z "$SESSION_ID" ]; then
  log "LOGIN_FAIL response=$(printf '%s' "$LOGIN_RESP" | head -c 300)"
  exit 1
fi
log "login=ok user=$USERNAME role=${ROLE:-?} session=${SESSION_ID:0:8}…"

THREAD_JSON=$(auth_curl -X POST "$BASE/api/threads" -H 'Content-Type: application/json' \
  -d "{\"title\":\"meta-forge-debug-${TS}\"}")
THREAD_ID=$(printf '%s' "$THREAD_JSON" | jq -r '.id // empty' 2>/dev/null)
if [ -z "$THREAD_ID" ]; then
  log "THREAD_FAIL response=$(printf '%s' "$THREAD_JSON" | head -c 300)"
  exit 1
fi
log "thread=$THREAD_ID"
log ""

parse_sse() {
  local raw="$1" jsonl="$2" parsed="$3"
  sed -n 's/^data: //p' "$raw" | grep -E '^\{' > "$jsonl" || true
  jq -R -s '
    [ split("\n")[] | select(length > 0) | (fromjson? // empty) ] as $f
    | ($f | map(select(.delta != null) | .delta) | join("")) as $answer
    | ($f | map(select(.phase != null)) | map(.phase + (if .stage then ":" + .stage else "" end))) as $phases
    | ($f | map(select(.rag != null)) | .[0].rag // null) as $rag
    | ($f | map(select(.forge_plan != null)) | .[0].forge_plan // null) as $fp
    | ($f | map(select(.meta != null)) | .[0].meta // null) as $meta
    | {
        frames: ($f|length),
        phases: $phases,
        has_forge_plan: ($fp != null),
        plan_id: ($fp.id // null),
        plan_status: ($fp.status // null),
        create_count: (($fp.plan.create // []) | length),
        reuse_count: (($fp.plan.reuse // []) | length),
        rag_reason: ($rag.reason // null),
        rag_mode: ($rag.mode // null),
        meta_source: ($meta.source // null),
        answer_chars: ($answer|length),
        answer_head: ($answer[0:500])
      }
  ' < "$jsonl" > "$parsed" 2>/dev/null || printf '{"parse_error":true}\n' > "$parsed"
}

fetch_trace() {
  local key="$1" out="$2"
  auth_curl "$BASE/api/debug/chat/$key?format=text" > "$out" 2>/dev/null || true
}

run_case() {
  local route="$1"
  local turn="$2"
  local trace_id="mf-${TS}-${route//\//-}-${turn}"
  local raw="$OUT_DIR/${route//\//_}-turn${turn}.sse"
  local jsonl="$raw.ndjson"
  local parsed="$raw.summary.json"
  local trace="$OUT_DIR/${route//\//_}-turn${turn}.trace.txt"
  local body

  if [ "$route" = "orchestrate" ]; then
    body=$(jq -nc --arg tr "$trace_id" --arg tid "$THREAD_ID" --arg q "$PROMPT" --arg m "$MODEL" '{
      traceId:$tr, thread_id:$tid, threadId:$tid, model:$m, mode:"local", locale:"tr",
      messages:[{role:"user", content:$q}]
    }')
  else
    body=$(jq -nc --arg tid "$THREAD_ID" --arg q "$PROMPT" --arg m "$MODEL" '{
      thread_id:$tid, model:$m, useRag:true, locale:"tr", userRole:"Admin",
      messages:[{role:"user", content:$q}]
    }')
  fi

  log "▶ route=$route turn=$turn trace=$trace_id"
  local t0 t1 code
  t0=$(date +%s)
  code=$(auth_curl -N -X POST "$BASE/api/chat/$route" \
    -H 'Content-Type: application/json' \
    -H 'Accept: text/event-stream' \
    -w '\n__HTTP_CODE__:%{http_code}\n' \
    -d "$body" > "$raw" 2>/dev/null; true)
  t1=$(date +%s)
  # curl -w was redirected into raw, not stdout; extract and remove marker.
  local http_code
  http_code=$(grep -a '__HTTP_CODE__:' "$raw" | tail -1 | sed 's/.*__HTTP_CODE__://')
  sed -i.bak '/__HTTP_CODE__:/d' "$raw" 2>/dev/null || true
  parse_sse "$raw" "$jsonl" "$parsed"
  if [ "$route" = "orchestrate" ]; then
    fetch_trace "$trace_id" "$trace"
  else
    fetch_trace "$THREAD_ID" "$trace"
  fi

  local frames has_fp plan_id rag_reason rag_mode meta_source ans phases
  frames=$(jq -r '.frames // 0' "$parsed" 2>/dev/null)
  has_fp=$(jq -r '.has_forge_plan // false' "$parsed" 2>/dev/null)
  plan_id=$(jq -r '.plan_id // "-"' "$parsed" 2>/dev/null)
  rag_reason=$(jq -r '.rag_reason // "-"' "$parsed" 2>/dev/null)
  rag_mode=$(jq -r '.rag_mode // "-"' "$parsed" 2>/dev/null)
  meta_source=$(jq -r '.meta_source // "-"' "$parsed" 2>/dev/null)
  ans=$(jq -r '.answer_chars // 0' "$parsed" 2>/dev/null)
  phases=$(jq -r '.phases | join(",")' "$parsed" 2>/dev/null)

  log "  http=${http_code:-?} elapsed=$((t1-t0))s frames=$frames forge_plan=$has_fp plan=$plan_id meta=$meta_source rag=${rag_reason}/${rag_mode} answer_chars=$ans"
  log "  phases=${phases:-none}"
  log "  files: raw=$raw parsed=$parsed trace=$trace"

  if grep -qE 'router\.classified|rag\.intent\.refined|meta_forge\.lane|rag\.pre|mlx\.fetch' "$trace" 2>/dev/null; then
    log "  trace key lines:"
    grep -E 'router\.classified|rag\.intent\.refined|meta_forge\.lane|rag\.pre|mlx\.fetch' "$trace" | tail -20 | sed 's/^/    /' | tee -a "$SUMMARY" >/dev/null
  else
    log "  trace key lines: (none)"
  fi
  log ""
}

if [ "${SKIP_ORCHESTRATE:-0}" != "1" ]; then
  run_case orchestrate 1
  run_case orchestrate 2
fi

if [ "${SKIP_STREAM:-0}" != "1" ]; then
  run_case stream 1
  run_case stream 2
fi

log "DONE summary=$SUMMARY"
log "If turn1 forge_plan=false and turn2=true, inspect the matching *.trace.txt and *.sse files above."
