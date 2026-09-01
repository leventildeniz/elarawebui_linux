#!/usr/bin/env bash
# ELARA RAG → Chat smoke test (auth'lu, v2)
# /api/auth/login → sessionId → X-Session-Id + X-User ile /api/chat/stream
# çağırır. Probe'da inject geçen sarı vakaların + 1 yeşil baseline'ın cevap
# kalitesini ölçer. Kod değişikliği YOK, sadece okuma.
#
# Usage:
#   ELARA_USERNAME=admin ELARA_PASSWORD='***' bash local-server/scripts/rag-chat-smoke.sh
#   bash local-server/scripts/rag-chat-smoke.sh        # interaktif prompt
#
# Env:
#   ELARA_BASE     (default https://elara.local:10443)
#   ELARA_PROVIDER (default local)
#   OUT_DIR        (default /tmp/rag-chat-out)
set -u
BASE="${ELARA_BASE:-https://elara.local:10443}"
PROVIDER="${ELARA_PROVIDER:-local}"
OUT_DIR="${OUT_DIR:-/tmp/rag-chat-out}"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/summary.txt"
: > "$SUMMARY"

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
  echo "!! username/password boş" >&2
  exit 1
fi

# --- login -----------------------------------------------------------------
echo "▶ login: $BASE/api/auth/login (user=$USERNAME provider=$PROVIDER)"
LOGIN_PAYLOAD=$(jq -nc --arg u "$USERNAME" --arg p "$PASSWORD" --arg pr "$PROVIDER" \
  '{username:$u, password:$p, provider:$pr, device:"rag-chat-smoke"}')
LOGIN_RESP=$(curl -sk --max-time 30 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d "$LOGIN_PAYLOAD")
SESSION_ID=$(printf '%s' "$LOGIN_RESP" | jq -r '.sessionId // empty' 2>/dev/null)
if [ -z "$SESSION_ID" ]; then
  echo "!! login fail. response:" >&2
  echo "$LOGIN_RESP" >&2
  exit 1
fi
echo "  session_id=$SESSION_ID"

auth_curl() {
  curl -sk --max-time 180 \
    -H "X-Session-Id: $SESSION_ID" \
    -H "X-User: $USERNAME" \
    "$@"
}

# --- thread create ---------------------------------------------------------
echo "▶ create thread"
TH_JSON=$(auth_curl -X POST "$BASE/api/threads" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"rag-smoke-$(date +%s)\"}")
THREAD_ID=$(printf '%s' "$TH_JSON" | jq -r '.id // empty' 2>/dev/null)
if [ -z "$THREAD_ID" ]; then
  echo "!! thread create fail: $TH_JSON" >&2
  exit 1
fi
echo "  thread_id=$THREAD_ID"

# --- chat probes -----------------------------------------------------------
ask() {
  local label="$1" q="$2"
  local slug; slug=$(echo "$label" | tr -c 'A-Za-z0-9' '_' | tr -s '_' | sed 's/^_//;s/_$//')
  local raw="$OUT_DIR/$slug.sse"

  echo "═══════════════════════════════════════════════════════════"
  echo "▶ $label"
  echo "  q: $q"
  echo "───────────────────────────────────────────────────────────"

  local body
  body=$(jq -nc --arg tid "$THREAD_ID" --arg q "$q" '{
    thread_id:$tid, useRag:true, locale:"tr", userRole:"Admin",
    messages:[{role:"user", content:$q}]
  }')

  local t0; t0=$(date +%s)
  auth_curl -N -X POST "$BASE/api/chat/stream" \
    -H 'Content-Type: application/json' \
    -H 'Accept: text/event-stream' \
    -d "$body" > "$raw" 2>/dev/null
  local total=$(( $(date +%s) - t0 ))

  # Parse SSE: extract `data: {...}` payloads, tolerate non-JSON lines
  local frames_file="${raw}.ndjson"
  sed -n 's/^data: //p' "$raw" | grep -E '^\{' > "$frames_file" || true
  local frame_count
  frame_count=$(wc -l < "$frames_file" | tr -d ' ')

  # Single jq pass: emit TSV with all metrics + answer
  local parsed
  parsed=$(jq -R -s '
    [ split("\n")[] | select(length > 0) | (fromjson? // empty) ] as $f
    | ($f | map(select(.delta != null) | .delta) | join("")) as $answer
    | ($f | map(select(.rag != null)) | .[0] // null) as $ragEvt
    | ($f | map(select(.rag.debug != null)) | .[0].rag.debug // null) as $dbg
    | ($f | map(select(.rag.sources != null)) | .[0].rag.sources // []) as $srcs
    | {
        answer: $answer,
        rag_inject: (
          if $ragEvt == null then "no_rag_event"
          elif $ragEvt.rag.skipped == true then "SKIPPED(reason=\($ragEvt.rag.reason // "?"))"
          else "INJECTED(used=\($ragEvt.rag.used), top1=\($ragEvt.rag.top1)%, rerank=\($ragEvt.rag.reranker.used // false))"
          end
        ),
        brand: ($dbg.brandLock // "none"),
        probe_top1: ($dbg.probe.top1 // 0),
        rerank_top1: (($dbg.finalRows // [])[0].rerank_score // "n/a"),
        sources: ($srcs[:3] | map("  - [\(.score)%] \(.name)") | join("\n"))
      }
  ' < "$frames_file" 2>/dev/null)

  local answer rag_inject rag_brand rag_top1 rerank_score sources
  answer=$(printf '%s' "$parsed"      | jq -r '.answer // ""' 2>/dev/null)
  rag_inject=$(printf '%s' "$parsed"  | jq -r '.rag_inject // "parse_fail"' 2>/dev/null)
  rag_brand=$(printf '%s' "$parsed"   | jq -r '.brand // "none"' 2>/dev/null)
  rag_top1=$(printf '%s' "$parsed"    | jq -r '.probe_top1 // 0' 2>/dev/null)
  rerank_score=$(printf '%s' "$parsed"| jq -r '.rerank_top1 // "n/a"' 2>/dev/null)
  sources=$(printf '%s' "$parsed"     | jq -r '.sources // ""' 2>/dev/null)


  local ans_len=${#answer}
  local ans_head ans_tail
  ans_head=$(printf '%s' "$answer" | head -c 500)
  ans_tail=$(printf '%s' "$answer" | tail -c 250)

  {
    echo "═══ $label ═══"
    echo "q             : $q"
    echo "total_s       : $total"
    echo "frames        : $frame_count"
    echo "answer_chars  : $ans_len"
    echo "rag           : $rag_inject"
    echo "probe.top1    : $rag_top1"
    echo "rerank.top1   : $rerank_score"
    echo "brandLock     : $rag_brand"
    echo "top3 sources  :"
    echo "$sources"
    echo "─ ANSWER HEAD (500c) ─"
    echo "$ans_head"
    echo "─ ANSWER TAIL (250c) ─"
    echo "$ans_tail"
    echo ""
  } | tee -a "$SUMMARY"
}

ask "Q1_FortiGate_SSL_VPN"   "fortigate ssl vpn portal yapılandırması"
ask "Q2_Firewall_Policy_TR"  "firewall policy nasıl yazılır"
ask "Q3_Checkpoint_BASELINE" "checkpoint smartconsole policy install"

echo ""
echo "FULL SUMMARY: $SUMMARY"
echo "RAW SSE     : $OUT_DIR/*.sse"
