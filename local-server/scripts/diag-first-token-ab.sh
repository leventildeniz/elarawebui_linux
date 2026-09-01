#!/usr/bin/env bash
# A/B first-token diagnostic — RAG on vs off × cold vs warm
#
# Usage:
#   1) RAG paneli (model editor) → seçili modelin "RAG Retrieval" switch'ini KAPAT.
#   2) bash local-server/scripts/diag-first-token-ab.sh off
#   3) RAG switch'i AÇ.
#   4) bash local-server/scripts/diag-first-token-ab.sh on
#   5) Tabloları yan yana karşılaştır.
#
# Env: HOST (default http://127.0.0.1:3005), PROMPT, MODEL_ID, COOL_DELAY=8
# Auth: ELARA_USER + ELARA_PASS env var olarak ver (yoksa script soracak).

set -uo pipefail

HOST="${HOST:-http://127.0.0.1:3005}"
PHASE="${1:-off}"  # 'off' or 'on' — purely a label
PROMPT="${PROMPT:-fortigatete nat policy nasil yazilir kisaca anlat}"
MODEL_ID="${MODEL_ID:-}"
COOL_DELAY="${COOL_DELAY:-8}"

say() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*" >&2; }
hr()  { printf -- "----------------------------------------------------------\n" >&2; }

# ---- Login ---------------------------------------------------------------
if [ -z "${ELARA_USER:-}" ]; then
  printf "username: " >&2; read -r ELARA_USER
fi
if [ -z "${ELARA_PASS:-}" ]; then
  printf "password: " >&2; stty -echo; read -r ELARA_PASS; stty echo; printf "\n" >&2
fi
say "Login → ${HOST}/api/auth/login as ${ELARA_USER}"
LOGIN_BODY=$(USR="$ELARA_USER" PWD_="$ELARA_PASS" python3 -c "import json,os; print(json.dumps({'username':os.environ['USR'],'password':os.environ['PWD_'],'device':'diag-script'}))")
LOGIN_RES=$(curl -sS -X POST "${HOST}/api/auth/login" -H "Content-Type: application/json" -d "${LOGIN_BODY}")
SID=$(printf "%s" "$LOGIN_RES" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('sessionId') or '')" 2>/dev/null || true)
if [ -z "$SID" ]; then
  echo "LOGIN FAIL: $LOGIN_RES" >&2
  exit 1
fi
say "session=${SID:0:12}…"

run_chat () {
  local label="$1"
  local trace_id="diag-${PHASE}-${label}-$(date +%s)-$RANDOM"
  local body sse_file http_code
  sse_file="/tmp/diag-${PHASE}-${label}.sse"
  body=$(PROMPT="$PROMPT" TID="$trace_id" MF="$MODEL_ID" \
    python3 -c "import json,os; mf=os.environ.get('MF',''); print(json.dumps({'messages':[{'role':'user','content':os.environ['PROMPT']}],'thread_id':os.environ['TID'],'stream':True,'model': mf if mf else None}))")
  say "[${PHASE}/${label}] firing — trace=${trace_id}"
  http_code=$(curl -sS --max-time 180 -N \
    -H "Content-Type: application/json" \
    -H "x-chat-trace: ${trace_id}" \
    -H "x-session-id: ${SID}" \
    -o "${sse_file}" -w "%{http_code}" \
    -X POST "${HOST}/api/chat/stream" \
    -d "${body}" 2>/dev/null || echo "000")
  local sz; sz=$(wc -c <"${sse_file}" 2>/dev/null | tr -d ' ' || echo 0)
  say "[${PHASE}/${label}] http=${http_code} sse_bytes=${sz}"
  sleep 1
  printf "%s\n" "${trace_id}"
}

fetch_trace () {
  curl -sS "${HOST}/api/debug/chat/$1?format=text" 2>/dev/null || echo "TRACE FETCH FAIL"
}

# Pull a numeric field (e.g. totalMs, queueWaitMs, mlxGenMs) from the
# JSON payload that follows a given event name on the same line.
extract_field () {
  local trace="$1" event="$2" field="$3"
  echo "$trace" | grep -F "$event" | head -1 \
    | grep -oE "\"${field}\":[0-9]+" | head -1 | cut -d: -f2
}

restart_mlx () {
  say "Restart MLX (cold) …"
  { curl -sS -X POST "${HOST}/api/system/restart-mlx" | head -c 400; echo; } >&2
  sleep "${COOL_DELAY}"
}

dump_sse_head () {
  local label="$1" file="/tmp/diag-${PHASE}-${1}.sse"
  if [ -s "$file" ]; then
    echo "### SSE HEAD [${PHASE}/${label}] (first 800 chars of ${file})"
    head -c 800 "$file"; echo
  else
    echo "### SSE [${PHASE}/${label}] EMPTY or missing (${file})"
  fi
}

# ---- Run ---------------------------------------------------------------
say "PHASE=${PHASE}  (UI'da RAG switch'inin bu fazla uyumlu olduğundan emin ol)"
restart_mlx
T_COLD=$(run_chat cold)
T_WARM=$(run_chat warm)

# ---- Pull traces -------------------------------------------------------
TR_COLD=$(fetch_trace "$T_COLD")
TR_WARM=$(fetch_trace "$T_WARM")

hr; echo "### TRACE [${PHASE}/cold]"; echo "${TR_COLD}"
COLD_EVENTS=$(echo "$TR_COLD" | grep -cE '^\[')
if [ "${COLD_EVENTS:-0}" -lt 1 ]; then
  hr; dump_sse_head cold
fi
hr; echo "### TRACE [${PHASE}/warm]"; echo "${TR_WARM}"
WARM_EVENTS=$(echo "$TR_WARM" | grep -cE '^\[')
if [ "${WARM_EVENTS:-0}" -lt 1 ]; then
  hr; dump_sse_head warm
fi

# ---- Summary -----------------------------------------------------------
hr
say "SUMMARY phase=${PHASE} — queueWait / mlxGen / totalMs (ms)"
printf "%-6s %-12s %-12s %-12s %-14s %-14s\n" "stage" "queueWait" "mlxGen" "firstTokTot" "streamDoneTot" "chars"
for k in cold warm; do
  if [ "$k" = "cold" ]; then t="$TR_COLD"; else t="$TR_WARM"; fi
  qw=$(extract_field "$t" "mlx.slot.acquired" "queueWaitMs")
  mg=$(extract_field "$t" "mlx.first_token.received" "mlxGenMs")
  ft=$(extract_field "$t" "mlx.first_token.received" "totalMs")
  sd=$(extract_field "$t" "mlx.stream.done" "totalMs")
  ch=$(extract_field "$t" "mlx.stream.done" "chars")
  printf "%-6s %-12s %-12s %-12s %-14s %-14s\n" "$k" "${qw:-?}" "${mg:-?}" "${ft:-?}" "${sd:-?}" "${ch:-?}"
done

hr
echo "Yorum:"
echo "  RAG overhead ≈ ON.warm.firstTokTot - OFF.warm.firstTokTot"
echo "  Cold cost    ≈ OFF.cold.firstTokTot - OFF.warm.firstTokTot"
echo "  Queue stuck  → queueWait büyükse zombi slot"
echo "  MLX silent   → mlxGen büyükse model takılı (cold start veya thinking)"
echo "  '?' kaldıysa: yukarıdaki SSE HEAD bloklarına bak (http kodu + ilk byte'lar)."

