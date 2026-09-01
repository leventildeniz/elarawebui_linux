#!/usr/bin/env bash
# chat-fulldebug.sh — Elara chat end-to-end debug capture (v2)
#
# Yenilikler:
#   • Kullanıcı adı / parola desteği (env ya da interaktif prompt).
#   • /api/auth/login üzerinden gerçek session açar, X-Session-Id +
#     X-User header'larını tüm isteklere ekler.
#   • Test öncesi middleware'i zorla reboot eder (middleware-restart.sh).
#
# Kullanım:
#   bash local-server/scripts/chat-fulldebug.sh
#   ELARA_USERNAME=admin ELARA_PASSWORD='***' bash local-server/scripts/chat-fulldebug.sh
#   bash local-server/scripts/chat-fulldebug.sh "selam" "checkpoint nedir"
#
# Reboot atlamak için:  SKIP_REBOOT=1 bash ...

set -u

BASE="${ELARA_BASE:-https://elara.local:10443}"
MODEL="${ELARA_MODEL:-elara-72b-mlx}"
PROVIDER="${ELARA_PROVIDER:-local}"
TS=$(date +%Y%m%d-%H%M%S)
OUT="/tmp/elara-chat-debug-${TS}.txt"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PROMPTS=("$@")
if [ ${#PROMPTS[@]} -eq 0 ]; then
  PROMPTS=(
    "selam"
    "naber nasılsın"
    "checkpoint nedir kısaca anlat"
    "RAG ile fine-tuning arasındaki temel fark nedir"
    "MLX runtime'da KV cache nasıl yönetilir"
  )
fi

log()  { printf '%s\n' "$*" | tee -a "$OUT" >/dev/null; }
hdr()  { printf '\n=== %s ===\n' "$*" | tee -a "$OUT" >/dev/null; }
dump() { printf '%s\n' "$*" >> "$OUT"; }

: > "$OUT"
log "# Elara Chat Full Debug — ${TS}"
log "# base=$BASE  model=$MODEL  prompts=${#PROMPTS[@]}  provider=$PROVIDER"

# --- credentials -----------------------------------------------------------
USERNAME="${ELARA_USERNAME:-}"
PASSWORD="${ELARA_PASSWORD:-}"
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
  log "!! username / password boş — çıkıyorum."
  exit 1
fi

# --- pre-flight: middleware reboot ----------------------------------------
if [ "${SKIP_REBOOT:-0}" != "1" ]; then
  hdr "PRE. Middleware reboot (middleware-restart.sh)"
  if [ -x "$SCRIPT_DIR/middleware-restart.sh" ]; then
    # Reboot çıktısını hem konsola hem log'a yansıt.
    "$SCRIPT_DIR/middleware-restart.sh" 2>&1 | tee -a "$OUT"
    rc=${PIPESTATUS[0]}
    log "# middleware-restart.sh exit=$rc"
    if [ "$rc" -ne 0 ]; then
      log "!! Middleware reboot başarısız — testlere yine de devam ediyorum, sonuçlar şüpheli olabilir."
    fi
  else
    log "!! $SCRIPT_DIR/middleware-restart.sh bulunamadı, reboot atlandı."
  fi
else
  log "# SKIP_REBOOT=1 — middleware restart atlandı."
fi

# Reboot sonrası middleware'in tam ısınması için kısa bekleme.
sleep 2

# --- curl wrapper ----------------------------------------------------------
CURL_BASE=(curl -sk --max-time 180)
auth_curl() {
  # auth_curl <extra args...>
  "${CURL_BASE[@]}" \
    -H "X-Session-Id: ${SESSION_ID:-}" \
    -H "X-User: ${USERNAME}" \
    "$@"
}

# --- 0. Login --------------------------------------------------------------
hdr "0. /api/auth/login (provider=$PROVIDER user=$USERNAME)"
LOGIN_PAYLOAD=$(printf '{"username":%s,"password":%s,"provider":%s,"device":"chat-fulldebug"}' \
  "\"${USERNAME//\"/\\\"}\"" "\"${PASSWORD//\"/\\\"}\"" "\"${PROVIDER//\"/\\\"}\"")
LOGIN_RESP=$("${CURL_BASE[@]}" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$LOGIN_PAYLOAD")
# Parolayı log'a yazmamak için payload'u maskeleyerek dump et.
dump "request: POST /api/auth/login (user=$USERNAME provider=$PROVIDER, password=[REDACTED])"
dump "response: $LOGIN_RESP"
SESSION_ID=$(printf '%s' "$LOGIN_RESP" | sed -n 's/.*"sessionId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$SESSION_ID" ]; then
  log "!! Login başarısız — sessionId alınamadı. Yanıt: $LOGIN_RESP"
  exit 1
fi
log "session_id=$SESSION_ID"

# --- 1. Infrastructure snapshot --------------------------------------------
hdr "1. Daemon / port / health"
dump "$(launchctl print system/com.elara.middleware 2>/dev/null | head -60 || echo 'launchctl: not loaded')"
dump ""
dump "lsof TCP:3005/3006:"
dump "$(sudo -n lsof -nP -iTCP:3005 -iTCP:3006 2>/dev/null | head -30 || lsof -nP -iTCP:3005 -iTCP:3006 2>/dev/null | head -30 || echo 'lsof unavailable')"
dump ""
for ep in /api/health /api/mlx/health /api/mlx/queue/stats; do
  dump ">>> GET $ep"
  dump "$(auth_curl "$BASE$ep" || echo '  (request failed)')"
  dump ""
done

# --- 2. Thread create ------------------------------------------------------
hdr "2. Create thread"
TH_JSON=$(auth_curl -X POST "$BASE/api/threads" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"fulldebug-${TS}\"}")
dump "$TH_JSON"
THREAD_ID=$(printf '%s' "$TH_JSON" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$THREAD_ID" ]; then
  log "!! Thread create failed — aborting."
  exit 1
fi
log "thread_id=$THREAD_ID"

declare -a TRACE_IDS=()

# --- 3. Send each prompt and capture SSE ----------------------------------
for i in "${!PROMPTS[@]}"; do
  PROMPT="${PROMPTS[$i]}"
  TID="dbg-${TS}-$((i+1))"
  TRACE_IDS+=("$TID")
  hdr "3.$((i+1)) Prompt: $PROMPT  (traceId=$TID)"

  BODY=$(cat <<JSON
{"traceId":"$TID","thread_id":"$THREAD_ID","threadId":"$THREAD_ID","model":"$MODEL","mode":"local","locale":"tr","message":"$PROMPT","messages":[{"role":"user","content":"$PROMPT"}]}
JSON
)
  T0=$(date +%s)
  SSE_FILE="/tmp/elara-sse-${TID}.txt"
  auth_curl -N -X POST "$BASE/api/chat/orchestrate" \
    -H 'Content-Type: application/json' \
    -H 'Accept: text/event-stream' \
    -d "$BODY" > "$SSE_FILE" 2>&1
  T1=$(date +%s)
  dump "elapsed=$((T1-T0))s · sse bytes=$(wc -c < "$SSE_FILE" | tr -d ' ')"
  dump "--- SSE frames (first 40 lines) ---"
  dump "$(head -40 "$SSE_FILE")"
  dump "--- SSE frames (last 20 lines) ---"
  dump "$(tail -20 "$SSE_FILE")"
  dump ""

  dump "--- backend trace ($TID) ---"
  dump "$(auth_curl "$BASE/api/debug/chat/${TID}?format=text" || echo '  (trace fetch failed)')"
  dump ""
  sleep 1
done

# --- 4. Recent traces ------------------------------------------------------
hdr "4. /api/debug/chat/recent"
dump "$(auth_curl "$BASE/api/debug/chat/recent?limit=10")"

# --- 5. Agent logs for this thread -----------------------------------------
hdr "5. agent_logs (thread=$THREAD_ID)"
dump "$(auth_curl "$BASE/api/logs?thread_id=${THREAD_ID}&limit=100")"

# --- 6. Daemon log tails ---------------------------------------------------
hdr "6. Launchd log tails"
for f in /var/log/elara-middleware.out.log /var/log/elara-middleware.err.log \
         /tmp/elara-middleware.out.log /tmp/elara-middleware.err.log; do
  if [ -f "$f" ]; then
    dump ">>> tail -200 $f"
    dump "$(tail -200 "$f")"
    dump ""
  fi
done

hdr "DONE"
log "Output: $OUT"
log "Traces: ${TRACE_IDS[*]}"

hdr "7. UI debug overlay (chat freeze yakalama)"
log "Bu script backend'i kanıtlar; UI donmasını yakalamak için chat'e debug overlay'i aç:"
log "  1) Tarayıcıda: ${BASE//10443/3000}/chat?debug=chat"
log "     (veya canlı UI URL'in neyse onun sonuna ?debug=chat ekle)"
log "  2) Alternatif: DevTools Console:"
log "       localStorage.setItem('elara_chat_debug','1');"
log "       localStorage.setItem('chat.trace.verbose','1');"
log "       location.reload();"
log "Sağ üstte siyah kara-kutu açılır: streaming/busyRef/phase/delta/freeze sayaçları."
log "Donma anında DevTools Console → Save as... → bana yolla."

if command -v pbcopy >/dev/null 2>&1; then
  pbcopy < "$OUT" && log "→ copied to clipboard ($(wc -l < "$OUT" | tr -d ' ') lines)"
fi

