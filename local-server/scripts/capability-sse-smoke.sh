#!/usr/bin/env bash
# capability-sse-smoke.sh — Verifies the `capability_proposed` SSE frame
# lands on the live /api/chat/stream wire (Tur 2b integration check).
#
# Usage:
#   bash local-server/scripts/capability-sse-smoke.sh
#   PORT=3005 QUERY="linkedin'e git benim cv'me bak..." bash ...
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Load local .env (optional — SMOKE_USER/SMOKE_PASS may live there).
if [ -f ".env" ]; then set -a; . ".env"; set +a; fi

PORT="${PORT:-3005}"
BASE="http://127.0.0.1:${PORT}"
THREAD_ID="smoke-cap-$(date +%s)-$$"
# NOT: meta_forge lane'i (chat-stream.mjs:231) imperative "yaz/oluştur/yeni agent"
# gibi forge komutlarında runCapabilityGap'ten önce dönüyor. Bu smoke için
# compound multi-tool bir görev cümlesi kullanıyoruz (fetch+summarize+push).
QUERY="${QUERY:-gmail'imdeki son 10 önemli maili özetle ve trello'ya task olarak ekle}"
OUT="/tmp/capability-sse-smoke.$$"

# Credentials — prompt if not in env. Use SMOKE_USER / SMOKE_PASS to skip prompt.
USER_NAME="${SMOKE_USER:-}"
PASSWORD="${SMOKE_PASS:-}"
if [ -z "$USER_NAME" ]; then read -r -p "Username: " USER_NAME; fi
if [ -z "$PASSWORD" ]; then read -r -s -p "Password: " PASSWORD; echo; fi

echo "=============================================================="
echo "Capability SSE Smoke — /api/chat/stream"
echo "=============================================================="
echo "[smoke] base       : $BASE"
echo "[smoke] user       : $USER_NAME"
echo "[smoke] thread_id  : $THREAD_ID"
echo "[smoke] query      : $QUERY"
echo

# --- Step 1: login → sessionId ------------------------------------------------
LOGIN_BODY=$(printf '{"username":"%s","password":"%s","provider":"local","device":"capability-smoke"}' \
  "$USER_NAME" "$PASSWORD")
LOGIN_RESP=$(curl -sS -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  --data-binary "$LOGIN_BODY")
SID=$(printf '%s' "$LOGIN_RESP" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')

if [ -z "$SID" ]; then
  echo "[smoke] ❌ login failed"
  echo "$LOGIN_RESP"
  exit 1
fi
echo "[smoke] ✅ login OK · sid=${SID:0:12}…"
echo

# --- Step 2: stream chat with x-session-id -----------------------------------
PAYLOAD=$(cat <<JSON
{
  "thread_id": "$THREAD_ID",
  "messages": [{"role":"user","content":"$QUERY"}],
  "useRag": true,
  "locale": "tr"
}
JSON
)

set +e
curl -sS -N \
  --max-time 25 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "x-session-id: $SID" \
  -X POST "$BASE/api/chat/stream" \
  --data-binary "$PAYLOAD" > "$OUT" 2>&1 &
CURL_PID=$!



# Poll for the frame or timeout.
DEADLINE=$(( $(date +%s) + 25 ))
FOUND=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if grep -q '"capability_proposed"' "$OUT" 2>/dev/null; then
    FOUND="1"; break
  fi
  sleep 0.4
done
kill "$CURL_PID" 2>/dev/null || true
wait "$CURL_PID" 2>/dev/null || true
set -e

FRAME_COUNT=$(grep -c '^data:' "$OUT" || true)
CAP_LINE=$(grep -m1 'capability_proposed' "$OUT" || true)

echo "[smoke] frames captured : $FRAME_COUNT"
echo "[smoke] output bytes    : $(wc -c < "$OUT" | tr -d ' ')"
echo

if [ -n "$FOUND" ]; then
  echo "[smoke] ✅ capability_proposed frame observed on the wire"
  echo
  echo "----- frame (truncated to 800 chars) -----"
  echo "$CAP_LINE" | cut -c1-800
  echo "------------------------------------------"
  rm -f "$OUT"
  exit 0
else
  echo "[smoke] ❌ capability_proposed NOT observed within 25s"
  echo
  echo "----- first 40 lines of stream -----"
  head -40 "$OUT" || true
  echo "------------------------------------"
  echo "[smoke] full transcript kept at: $OUT"
  exit 1
fi
