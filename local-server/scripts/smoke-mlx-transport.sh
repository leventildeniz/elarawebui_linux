#!/usr/bin/env bash
# MLX transport smoke kapısı — kırılım 5.
# Read-only smoke: /api/engine/transport snapshot + selam (stream) + RAG turu (orchestrate)
# üstünden first-byte ve state machine etiketini doğrular.
#
# Auth: ELARA_USERNAME/PASSWORD env (yoksa interaktif prompt).
# Bypass: SKIP_CHAT=1 → sadece transport snapshot smoke.
#
# Bu script DEĞİŞTİRMEZ, sadece okur ve özet basar.
set -u
BASE="${ELARA_BASE:-https://elara.local:10443}"
OUT_DIR="${OUT_DIR:-/tmp/mlx-transport-smoke}"
mkdir -p "$OUT_DIR"
PASS=0; FAIL=0

step() { printf "▶ %s\n" "$*"; }
ok()   { PASS=$((PASS+1)); printf "  ✓ %s\n" "$*"; }
ko()   { FAIL=$((FAIL+1)); printf "  ✗ %s\n" "$*"; }

# 1) transport snapshot — state ∈ {idle,warm,serving,dirty,restarting}
step "GET /api/engine/transport"
SNAP=$(curl -sk --max-time 5 "$BASE/api/engine/transport" || echo "{}")
echo "$SNAP" > "$OUT_DIR/snapshot.json"
STATE=$(printf '%s' "$SNAP" | jq -r '.state // .transport.state // empty' 2>/dev/null)
INFLIGHT=$(printf '%s' "$SNAP" | jq -r '.inflight // .transport.inflight // 0' 2>/dev/null)
INV_RAW=$(printf '%s' "$SNAP" | jq -r '.invariants // .transport.invariants // "ok"' 2>/dev/null)
# Snapshot: invariants = "ok" (string) veya violation array. Array length=ihlal sayısı.
INV=$(printf '%s' "$SNAP" | jq -r 'if (.invariants // .transport.invariants // "ok") == "ok" then 0 else ((.invariants // .transport.invariants) | length) end' 2>/dev/null)
case "$STATE" in
  idle|warm|serving|dirty|restarting) ok "state=$STATE inflight=$INFLIGHT invariants=$INV" ;;
  *) ko "beklenmedik state='$STATE' (snapshot: $OUT_DIR/snapshot.json)" ;;
esac
if [ "$INV" = "0" ]; then
  ok "invariant violation yok"
else
  ko "invariant violations=$INV → $INV_RAW"
fi

# ms timestamp helper — macOS `date` %3N desteklemiyor (literal "3N" basıyor).
# Önce GNU gdate, sonra python, en sonda saniye×1000 fallback.
_now_ms() {
  if command -v gdate >/dev/null 2>&1; then gdate +%s%3N
  elif command -v python3 >/dev/null 2>&1; then python3 -c 'import time; print(int(time.time()*1000))'
  else echo "$(($(date +%s) * 1000))"
  fi
}

if [ "${SKIP_CHAT:-0}" = "1" ]; then
  echo ""; echo "═ smoke özeti ═ pass=$PASS fail=$FAIL (chat atlandı)"
  [ "$FAIL" = "0" ]
  exit $?
fi

# 2) auth + chat turları (stream + orchestrate)
USERNAME="${ELARA_USERNAME:-}"; PASSWORD="${ELARA_PASSWORD:-}"
if [ -z "$USERNAME" ]; then printf 'username: ' >&2; read -r USERNAME; fi
if [ -z "$PASSWORD" ]; then
  printf 'password: ' >&2; stty -echo 2>/dev/null; read -r PASSWORD; stty echo 2>/dev/null; printf '\n' >&2
fi
LP=$(jq -nc --arg u "$USERNAME" --arg p "$PASSWORD" '{username:$u,password:$p,provider:"local",device:"mlx-transport-smoke"}')
SID=$(curl -sk --max-time 30 -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "$LP" | jq -r '.sessionId // empty')
[ -n "$SID" ] && ok "login ok" || { ko "login fail"; exit 1; }

ac() { curl -sk --max-time 180 -H "X-Session-Id: $SID" -H "X-User: $USERNAME" "$@"; }
TID=$(ac -X POST "$BASE/api/threads" -H 'Content-Type: application/json' -d '{"title":"mlx-transport-smoke"}' | jq -r '.id // empty')
[ -n "$TID" ] && ok "thread $TID" || { ko "thread fail"; exit 1; }

probe() {
  local label="$1" route="$2" q="$3"
  local raw="$OUT_DIR/${label}.sse"
  local hdr="$OUT_DIR/${label}.head"
  local body; body=$(jq -nc --arg tid "$TID" --arg q "$q" '{thread_id:$tid,useRag:true,locale:"tr",userRole:"Admin",messages:[{role:"user",content:$q}]}')
  local t0; t0=$(_now_ms)
  local http; http=$(ac -N -X POST "$BASE$route" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' -D "$hdr" -o "$raw" -w '%{http_code}' -d "$body" 2>/dev/null)
  local total; total=$(( $(_now_ms) - t0 ))
  local frames; frames=$(grep -c '^data: ' "$raw" 2>/dev/null | tr -d '[:space:]'); frames=${frames:-0}
  local chars; chars=$(sed -n 's/^data: //p' "$raw" | grep -v '^\[DONE\]$' | jq -Rrs 'split("\n") | map(select(length>0) | (fromjson? // {}) | (.delta // .chunk // .content // .text // .token // (.choices[0]?.delta?.content?) // "")) | join("") | length' 2>/dev/null || echo 0)
  if [ "$frames" -gt 0 ] && [ "$chars" -gt 0 ]; then
    ok "$label · http=$http · ${total}ms · ${frames} frame · ${chars} char"
  else
    ko "$label · http=$http · frames=$frames chars=$chars (raw: $raw)"
    echo "    ── frame phase histogramı ──"
    sed -n 's/^data: //p' "$raw" | jq -r 'fromjson? | (.phase // (keys|join("+")))' 2>/dev/null | sort | uniq -c | sed 's/^/    /'
    echo "    ── son 3 frame ──"
    grep '^data: ' "$raw" | tail -n 3 | sed 's/^/    /'
  fi
}

probe "selam-stream"     "/api/chat/stream"      "selam"
probe "rag-orchestrate"  "/api/chat/orchestrate" "fortigate ssl vpn nasıl yapılandırılır"

# 3) post-state snapshot
step "GET /api/engine/transport (post)"
SNAP2=$(curl -sk --max-time 5 "$BASE/api/engine/transport" || echo "{}")
echo "$SNAP2" > "$OUT_DIR/snapshot.post.json"
STATE2=$(printf '%s' "$SNAP2" | jq -r '.state // .transport.state // empty' 2>/dev/null)
case "$STATE2" in
  idle|warm|serving) ok "post-state=$STATE2 (healthy)" ;;
  *) ko "post-state=$STATE2 (dirty/restarting?)" ;;
esac

echo ""
echo "═ smoke özeti ═ pass=$PASS fail=$FAIL"
echo "  snapshots: $OUT_DIR/snapshot{.json,.post.json}"
echo "  raw SSE  : $OUT_DIR/*.sse"
[ "$FAIL" = "0" ]
