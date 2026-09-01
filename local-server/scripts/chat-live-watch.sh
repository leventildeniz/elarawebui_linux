#!/usr/bin/env bash
# chat-live-watch.sh — Elara chat CANLI izleyici (read-only)
#
# Sen UI'da normal sohbet ederken, ayrı bir terminalde çalışır ve arkada
# ne olduğunu gerçek zamanlı gösterir. İki kaynağı birleştirir:
#   1) /api/debug/chat/recent trace ring → her traceId için aşama zaman çizelgesi
#   2) /tmp/elara-middleware.{out,err}.log → [mlx*, [SMALLTALK-LANE, [TIMING ...
#
# Tıkanmanın YERİNİ kanıtla saptar:
#   • mlx.queue.enqueued geldi ama mlx.slot.acquired GELMEDİYSE → KUYRUK TIKANDI
#     (istek başka bir slot/zombi arkasında bekledi)
#   • mlx.slot.acquired geldi ama mlx.first_token.received GELMEDİYSE → MLX SESSİZ
#     (slot alındı, 8001 token üretmedi → model takılı/cold)
#
# Kullanım:
#   ELARA_USERNAME=admin ELARA_PASSWORD='***' bash local-server/scripts/chat-live-watch.sh
#   # sonra UI'da soru sor → buraya canlı timeline akar.  Ctrl-C ile çık.
#
# Sadece OKUR — hiçbir restart/mutation çağırmaz.

set -u

BASE="${ELARA_BASE:-https://elara.local:10443}"
POLL_MS="${POLL_MS:-1500}"
OUT_LOG="${ELARA_OUT_LOG:-/tmp/elara-middleware.out.log}"
ERR_LOG="${ELARA_ERR_LOG:-/tmp/elara-middleware.err.log}"

# --- renkler -----------------------------------------------------------------
if [ -t 1 ]; then
  C_RST=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'
  C_YEL=$'\033[33m'; C_BLU=$'\033[34m'; C_MAG=$'\033[35m'; C_CYN=$'\033[36m'
else
  C_RST=""; C_DIM=""; C_RED=""; C_GRN=""; C_YEL=""; C_BLU=""; C_MAG=""; C_CYN=""
fi

# --- credentials -------------------------------------------------------------
USERNAME="${ELARA_USERNAME:-}"
PASSWORD="${ELARA_PASSWORD:-}"
PROVIDER="${ELARA_PROVIDER:-local}"
if [ -z "$USERNAME" ]; then printf 'Elara kullanıcı adı: ' >&2; read -r USERNAME; fi
if [ -z "$PASSWORD" ]; then
  printf 'Elara parola (%s): ' "$USERNAME" >&2
  stty -echo 2>/dev/null; read -r PASSWORD; stty echo 2>/dev/null; printf '\n' >&2
fi
if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
  echo "!! username / password boş — çıkıyorum." >&2; exit 1
fi

CURL=(curl -sk --max-time 20)

# --- login -------------------------------------------------------------------
LOGIN_PAYLOAD=$(printf '{"username":"%s","password":"%s","provider":"%s","device":"chat-live-watch"}' \
  "${USERNAME//\"/\\\"}" "${PASSWORD//\"/\\\"}" "${PROVIDER//\"/\\\"}")
LOGIN_RESP=$("${CURL[@]}" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "$LOGIN_PAYLOAD")
SESSION_ID=$(printf '%s' "$LOGIN_RESP" | sed -n 's/.*"sessionId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$SESSION_ID" ]; then
  echo "${C_RED}!! Login başarısız — sessionId alınamadı.${C_RST}" >&2
  echo "   yanıt: $LOGIN_RESP" >&2; exit 1
fi
echo "${C_GRN}✓ login ok${C_RST} · base=$BASE · session=${SESSION_ID:0:8}… · poll=${POLL_MS}ms"

auth_get() { "${CURL[@]}" -H "X-Session-Id: $SESSION_ID" -H "X-User: $USERNAME" "$@"; }

# --- log tail (arka plan) ----------------------------------------------------
TAIL_PIDS=()
tail_log() {
  local f="$1" tag="$2"
  [ -f "$f" ] || return 0
  ( tail -n0 -F "$f" 2>/dev/null | grep --line-buffered -E '\[mlx|\[SMALLTALK-LANE|\[TIMING|\[MLX-FIRSTTOKEN|\[mlx:diag|\[mlx:restart|MLX Connection Error' \
      | while IFS= read -r line; do printf '%s  %s%s%s  %s\n' "$(date +%H:%M:%S)" "$C_DIM" "$tag" "$C_RST" "$line"; done ) &
  TAIL_PIDS+=("$!")
}
cleanup() { for p in "${TAIL_PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; echo; echo "${C_DIM}bye.${C_RST}"; }
trap cleanup EXIT INT TERM

echo "${C_DIM}— log tail: $OUT_LOG / $ERR_LOG —${C_RST}"
tail_log "$OUT_LOG" "out"
tail_log "$ERR_LOG" "err"

# --- trace polling -----------------------------------------------------------
# Python ile JSON parse + per-trace timeline + delta + kök-neden etiketi.
PY=$(cat <<'PYEOF'
import sys, json, time

C = {
  "rst":"\033[0m","dim":"\033[2m","red":"\033[31m","grn":"\033[32m",
  "yel":"\033[33m","blu":"\033[34m","mag":"\033[35m","cyn":"\033[36m",
}
def c(k,s):
    return C.get(k,"")+s+C["rst"]

# seen: traceId -> set(stage indices already printed)
seen = {}
header_shown = set()

def stage_color(stage):
    if stage in ("mlx.reset","error.thrown","rag.error","planner.error","agent.bridge.error","body.invalid","client.aborted"):
        return "red"
    if stage in ("mlx.first_token.received","mlx.stream.done","rag.injected"):
        return "grn"
    if stage in ("mlx.slot.acquired","mlx.fetch.start","mlx.warming"):
        return "cyn"
    if stage in ("mlx.queue.enqueued","mlx.first_token.budget"):
        return "yel"
    return "blu"

def fmt_detail(stage, d):
    if not isinstance(d, dict):
        return ""
    keys = []
    for k in ("queueWaitMs","mlxGenMs","totalMs","top1","tau","hits","reason","cold","effectiveMs","priority","chars","budgetMs"):
        if k in d and d[k] is not None:
            keys.append(f"{k}={d[k]}")
    if stage in ("mlx.queue.enqueued","mlx.slot.acquired") and isinstance(d.get("stats"),dict):
        st=d["stats"]
        keys.append("q{w=%s,r=%s}" % (st.get("waiting","?"), st.get("running","?")))
    if stage in ("mlx.reset","error.thrown") and isinstance(d.get("diag"),dict):
        dg=d["diag"]
        keys.append("slotAcq=%s fetch=%s ft=%s qWait=%sms" % (dg.get("slotAcquired"),dg.get("fetchStarted"),dg.get("firstToken"),dg.get("queueWaitMs")))
    return "  ".join(keys)

def root_cause(events):
    stages=[e["stage"] for e in events]
    reset=next((e for e in events if e["stage"] in ("mlx.reset","error.thrown")),None)
    if reset and isinstance(reset.get("detail"),dict) and isinstance(reset["detail"].get("diag"),dict):
        dg=reset["detail"]["diag"]
        if "mlx.queue.enqueued" in stages and not dg.get("slotAcquired"):
            return c("red","◆ KUYRUK TIKANDI — slot alınamadı (qWait≈%sms). Restart MLX." % dg.get("queueWaitMs"))
        if dg.get("slotAcquired") and not dg.get("firstToken"):
            return c("red","◆ MLX SESSİZ — slot alındı, token gelmedi. Restart MLX.")
    return None

for raw in sys.stdin:
    raw=raw.strip()
    if not raw: continue
    try: payload=json.loads(raw)
    except Exception: continue
    traces=payload.get("traces") or []
    # group by traceId
    groups={}
    for e in traces:
        tid=e.get("traceId","?")
        groups.setdefault(tid,[]).append(e)
    for tid,events in groups.items():
        events.sort(key=lambda x:x.get("ts",0))
        new_idx=[i for i in range(len(events)) if i not in seen.get(tid,set())]
        if not new_idx: continue
        if tid not in header_shown:
            # ilk user mesajını bul (request.entered detail içinde olmayabilir)
            head=""
            for e in events:
                d=e.get("detail") or {}
                for k in ("preview","q","message","prompt"):
                    if isinstance(d.get(k),str) and d[k].strip():
                        head=d[k][:60]; break
                if head: break
            print(c("mag","\n▶ trace %s%s" % (tid, ("  «%s…»"%head) if head else "")))
            header_shown.add(tid)
        t0=events[0].get("ts",0)
        for i in new_idx:
            e=events[i]
            stage=e.get("stage","?")
            dms=e.get("ts",0)-t0
            det=fmt_detail(stage,e.get("detail"))
            print("   %s+%-7s %s %s" % (C["dim"], str(dms)+"ms"+C["rst"], c(stage_color(stage), stage.ljust(24)), det))
        seen.setdefault(tid,set()).update(new_idx)
        rc=root_cause(events)
        if rc and (tid,"rc") not in header_shown:
            print("   "+rc); header_shown.add((tid,"rc"))
    sys.stdout.flush()
PYEOF
)

PY_BIN="$(command -v python3 || command -v python)"
if [ -z "$PY_BIN" ]; then
  echo "${C_RED}!! python3 bulunamadı — trace timeline kapalı, sadece log tail çalışır.${C_RST}" >&2
  wait
fi

echo "${C_DIM}— trace polling açık · UI'da soru sor —${C_RST}"
SLEEP_S=$(awk "BEGIN{print ${POLL_MS}/1000}")
while true; do
  auth_get "$BASE/api/debug/chat/recent?limit=60"
  echo
  sleep "$SLEEP_S"
done | "$PY_BIN" -u -c "$PY"
