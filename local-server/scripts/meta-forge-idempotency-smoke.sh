#!/usr/bin/env bash
# Meta-Forge idempotency smoke — aynı prompt'u 2 kez atar, 2. turda
# `forge_deduped` frame gelmezse FAIL basar. Samanlıkta iğne aramayı bitirir.
#
# Kullanım:
#   ELARA_USERNAME=admin ELARA_PASSWORD='***' \
#     bash local-server/scripts/meta-forge-idempotency-smoke.sh \
#     "Elara, yeni bir tool yap: adı youtube-transcript-fetcher.py..."
#
# Env:
#   ELARA_BASE      (default http://127.0.0.1:3005)
#   ELARA_MODEL     (default elara-72b-mlx)
#   PROMPT (arg 1)  — zorunlu değil, default aşağıda
#   OUT_DIR         (default /tmp/mf-idem-<ts>)
set -u

BASE="${ELARA_BASE:-http://127.0.0.1:3005}"
MODEL="${ELARA_MODEL:-elara-72b-mlx}"
DEFAULT_PROMPT="Elara, yeni bir tool yap: adi youtube-transcript-fetcher.py. YouTube URL girdisinden baslik ve transkript ceksin, JSON donsun, hata durumunda {ok:false,reason} versin. tools/ altina yaz, capability olarak register et."
PROMPT="${1:-$DEFAULT_PROMPT}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUT_DIR:-/tmp/mf-idem-${TS}}"
mkdir -p "$OUT_DIR"

command -v jq >/dev/null || { echo "missing jq" >&2; exit 2; }
command -v curl >/dev/null || { echo "missing curl" >&2; exit 2; }

USERNAME="${ELARA_USERNAME:-${ELARA_USER:-}}"
PASSWORD="${ELARA_PASSWORD:-${ELARA_PASS:-}}"
if [ -z "$USERNAME" ]; then printf 'Elara username: ' >&2; read -r USERNAME; fi
if [ -z "$PASSWORD" ]; then
  printf 'Elara password (%s): ' "$USERNAME" >&2
  stty -echo 2>/dev/null; read -r PASSWORD; stty echo 2>/dev/null; printf '\n' >&2
fi

COOKIE="$OUT_DIR/cookie.txt"
CURL=(curl -sk --max-time 240 -b "$COOKIE" -c "$COOKIE")

LOGIN_BODY=$(jq -nc --arg u "$USERNAME" --arg p "$PASSWORD" '{username:$u,password:$p,provider:"local",device:"mf-idem"}')
LOGIN=$("${CURL[@]}" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "$LOGIN_BODY")
SID=$(printf '%s' "$LOGIN" | jq -r '.sessionId // empty')
[ -z "$SID" ] && { echo "LOGIN FAIL: $(printf '%s' "$LOGIN" | head -c 200)"; exit 1; }

auth() { "${CURL[@]}" -H "X-Session-Id: $SID" -H "X-User: $USERNAME" "$@"; }

THREAD=$(auth -X POST "$BASE/api/threads" -H 'Content-Type: application/json' \
  -d "{\"title\":\"mf-idem-${TS}\"}" | jq -r '.id // empty')
[ -z "$THREAD" ] && { echo "THREAD FAIL"; exit 1; }

echo "== idempotency smoke =="
echo "base=$BASE model=$MODEL thread=$THREAD"
echo "out=$OUT_DIR"
echo "prompt=$(printf '%s' "$PROMPT" | head -c 100)…"
echo

run_turn() {
  local turn="$1"
  local out="$OUT_DIR/turn${turn}.sse"
  local body
  body=$(jq -nc --arg tid "$THREAD" --arg q "$PROMPT" --arg m "$MODEL" \
    --arg tr "mf-idem-${TS}-${turn}" '{
      traceId:$tr, thread_id:$tid, threadId:$tid, model:$m, mode:"local", locale:"tr",
      messages:[{role:"user", content:$q}]
    }')
  auth -N -X POST "$BASE/api/chat/orchestrate" \
    -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
    -d "$body" > "$out" 2>/dev/null

  # extract frames of interest
  sed -n 's/^data: //p' "$out" | grep -E '^\{' | jq -c '
    select(.forge_plan or .forge_deduped or .forge_deferred or .forge_preview)
    | {
        plan:      (.forge_plan.id // null),
        plan_kind: ([.forge_plan.plan.create[]?.kind] // []),
        plan_slug: ([.forge_plan.plan.create[]?.slug] // []),
        deduped:   (.forge_deduped.items // null),
        deferred:  (.forge_deferred.items // null),
        preview:   (.forge_preview.id // null)
      }
  ' > "$out.frames.jsonl" 2>/dev/null || true

  local plan dedup
  plan=$(jq -s '[.[] | select(.plan)] | length' "$out.frames.jsonl" 2>/dev/null)
  dedup=$(jq -s '[.[] | select(.deduped)] | length' "$out.frames.jsonl" 2>/dev/null)
  echo "  turn${turn}: forge_plan=${plan} forge_deduped=${dedup}"
  jq -s '.' "$out.frames.jsonl" 2>/dev/null | head -40 | sed 's/^/    /'
}

echo "turn 1 (should FORGE)"
run_turn 1
echo
echo "turn 2 (should DEDUPE)"
run_turn 2
echo

T1_PLAN=$(jq -s '[.[] | select(.plan)] | length' "$OUT_DIR/turn1.sse.frames.jsonl")
T2_PLAN=$(jq -s '[.[] | select(.plan)] | length' "$OUT_DIR/turn2.sse.frames.jsonl")
T2_DEDUP=$(jq -s '[.[] | select(.deduped)] | length' "$OUT_DIR/turn2.sse.frames.jsonl")

echo "== VERDICT =="
if [ "$T1_PLAN" -ge 1 ] && [ "$T2_DEDUP" -ge 1 ]; then
  echo "PASS  turn1 forge=$T1_PLAN, turn2 deduped=$T2_DEDUP"
  exit 0
else
  echo "FAIL  turn1_plan=$T1_PLAN turn2_plan=$T2_PLAN turn2_deduped=$T2_DEDUP"
  echo "        aynı intent 2 kez forge edildi — idempotency tutmadı."
  echo "        detay: $OUT_DIR/turn*.sse"
  exit 1
fi
