#!/usr/bin/env bash
# Faz 1C smoke — SocialMedia 4 tools direct stdin/stdout.
# Usage: PYTHON=local-server/.venv/bin/python bash local-server/tools/smoke/faz1c.sh
set -uo pipefail

PY="${PYTHON:-python3}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
TOOLS="$REPO/tools"
WORKDIR="$TOOLS/_workdir"
mkdir -p "$WORKDIR"
# image_compose._safe_path() allowlist'i CWD-relative ("tools/_workdir") çözüyor.
# Smoke nerden çağrılırsa çağrılsın repo root'tan çalıştığımızdan emin olalım,
# yoksa abspath mismatch → output_path_not_allowed.
cd "$REPO"

pass=0
fail=0
log() { printf '%s\n' "$*"; }
ok()  { pass=$((pass+1)); log "  PASS · $1"; }
ko()  { fail=$((fail+1)); log "  FAIL · $1 :: $2"; }

run() { echo "$2" | "$PY" "$TOOLS/$1"; }

assert_key() {
  local got
  got=$(printf '%s' "$1" | "$PY" -c "
import json, sys
try: o = json.load(sys.stdin)
except Exception: print('__PARSE_ERROR__'); sys.exit(0)
path = sys.argv[1].split('.')
v = o
for p in path:
    if isinstance(v, dict): v = v.get(p)
    elif isinstance(v, list):
        try: v = v[int(p)]
        except Exception: v = None
    else: v = None
    if v is None: break
print('' if v is None else v)
" "$2" 2>/dev/null)
  [[ "$got" == "$3" ]]
}

json_get() {
  printf '%s' "$1" | "$PY" -c "
import json, sys
o = json.load(sys.stdin)
path = sys.argv[1].split('.')
v = o
for p in path:
    if isinstance(v, dict): v = v.get(p)
    elif isinstance(v, list):
        try: v = v[int(p)]
        except Exception: v = None
    else: v = None
    if v is None: break
print('' if v is None else v)
" "$2" 2>/dev/null
}

log "=== Faz 1C smoke (SocialMedia) ==="
log "interpreter: $($PY -c 'import sys;print(sys.executable)')"

# ---------- 1) image_compose happy ----------
log "[1] image_compose square_text"
out_img="$WORKDIR/_faz1c_post.png"
rm -f "$out_img"
out=$(run image_compose.py "$(printf '{"template":"square_text","title":"Hello World","subtitle":"Faz 1C smoke","brand_color":"#ec4899","output_path":"%s"}' "$out_img")")
if assert_key "$out" "ok" "True"; then
  w=$(json_get "$out" "width"); h=$(json_get "$out" "height")
  sz=$(json_get "$out" "size_bytes")
  if [[ -f "$out_img" && "$w" == "1080" && "$h" == "1080" && "$sz" -gt 1000 ]]; then
    ok "image_compose ${w}x${h} bytes=$sz"
  else
    ko "image_compose dims/size mismatch" "$out"
  fi
elif printf '%s' "$out" | grep -q '"missing_dependency"'; then
  ok "image_compose → missing_dependency (Pillow not installed; accepted)"
else
  ko "image_compose happy" "$out"
fi
rm -f "$out_img"

# ---------- 2) image_compose output path guard ----------
out=$(run image_compose.py '{"template":"square_text","title":"X","output_path":"/etc/x.png"}')
assert_key "$out" "reason" "output_path_not_allowed" && ok "image_compose path guard" \
  || ko "image_compose path guard" "$out"

# ---------- 3) caption_polish x platform 400 char ----------
log "[3] caption_polish x clip"
LONG=$("$PY" -c "print('hello world. ' * 40)")
out=$(run caption_polish.py "$(printf '{"text":%s,"platform":"x"}' "$("$PY" -c "import json,sys;print(json.dumps(sys.argv[1]))" "$LONG")")")
if assert_key "$out" "ok" "True"; then
  plen=$(json_get "$out" "polished_len")
  if [[ "$plen" -le 280 && "$plen" -gt 0 ]]; then
    ok "caption_polish x polished_len=$plen ≤ 280"
  else
    ko "caption_polish x length not clipped" "$out"
  fi
else
  ko "caption_polish x" "$out"
fi

# ---------- 4) caption_polish instagram 50 hashtags strip ----------
log "[4] caption_polish instagram strip_excess"
TAGS=$("$PY" -c "print('caption ' + ' '.join(['#tag'+str(i) for i in range(50)]))")
INPUT=$("$PY" -c "import json,sys;print(json.dumps({'text':sys.argv[1],'platform':'instagram','strip_excess':True}))" "$TAGS")
out=$(printf '%s' "$INPUT" | "$PY" "$TOOLS/caption_polish.py")
if assert_key "$out" "ok" "True"; then
  hc=$(json_get "$out" "hashtag_count")
  if [[ "$hc" -le 30 ]]; then
    ok "caption_polish ig hashtag_count=$hc ≤ 30"
  else
    ko "caption_polish ig hashtag strip failed" "hc=$hc"
  fi
else
  ko "caption_polish ig" "$out"
fi

# ---------- 5) hashtag_score niche match ----------
log "[5] hashtag_score niche match"
out=$(run hashtag_score.py '{"hashtags":["#cybersecurity","#cats","#x"],"platform":"linkedin","niche_keywords":["cyber","security"]}')
if assert_key "$out" "ok" "True"; then
  top_tag=$(json_get "$out" "ranked.0.tag")
  top_score=$(json_get "$out" "ranked.0.score")
  if [[ "$top_tag" == "#cybersecurity" && "$top_score" -ge 70 ]]; then
    ok "hashtag_score top=$top_tag score=$top_score"
  else
    ko "hashtag_score niche ranking" "top=$top_tag score=$top_score"
  fi
else
  ko "hashtag_score happy" "$out"
fi

# ---------- 6) hashtag_score graceful without generics file ----------
out=$(run hashtag_score.py '{"hashtags":["#love","#nicelongtag"],"platform":"instagram"}')
if assert_key "$out" "ok" "True"; then
  loaded=$(json_get "$out" "generics_loaded")
  ok "hashtag_score generics_loaded=$loaded (graceful)"
else
  ko "hashtag_score no-generics" "$out"
fi

# ---------- 7) engagement_window instagram Europe/Istanbul (day specified) ----------
log "[7] engagement_window IG Europe/Istanbul Wed"
out=$(run engagement_window.py '{"platform":"instagram","timezone":"Europe/Istanbul","day_of_week":2}')
if assert_key "$out" "ok" "True"; then
  wcount=$(printf '%s' "$out" | "$PY" -c "import json,sys;print(len(json.load(sys.stdin).get('windows') or []))")
  if [[ "$wcount" -ge 2 ]]; then
    ok "engagement_window windows=$wcount"
  else
    ko "engagement_window window count low" "$out"
  fi
else
  ko "engagement_window happy" "$out"
fi

# ---------- 8) engagement_window invalid tz ----------
out=$(run engagement_window.py '{"platform":"instagram","timezone":"Mars/Olympus_Mons"}')
assert_key "$out" "reason" "invalid_timezone" && ok "engagement_window invalid_timezone guard" \
  || ko "engagement_window tz guard" "$out"

# ---------- 9) engagement_window whole week ----------
log "[9] engagement_window full week"
out=$(run engagement_window.py '{"platform":"tiktok","timezone":"Europe/Istanbul"}')
if assert_key "$out" "ok" "True"; then
  days=$(printf '%s' "$out" | "$PY" -c "import json,sys;print(len((json.load(sys.stdin).get('weekly') or {}).keys()))")
  [[ "$days" == "7" ]] && ok "engagement_window weekly days=7" \
    || ko "engagement_window weekly count" "days=$days"
else
  ko "engagement_window weekly" "$out"
fi

# ---------- 10) caption_polish linkedin tone=pro strips emojis ----------
log "[10] caption_polish linkedin tone=pro"
INPUT=$("$PY" -c "import json;print(json.dumps({'text':'Big news today 🎉🚀✨ launching soon!','platform':'linkedin','tone':'pro'}))")
out=$(printf '%s' "$INPUT" | "$PY" "$TOOLS/caption_polish.py")
if assert_key "$out" "ok" "True"; then
  ec=$(json_get "$out" "emoji_count")
  [[ "$ec" == "0" ]] && ok "caption_polish pro emoji_count=0" \
    || ko "caption_polish pro emoji not stripped" "ec=$ec"
else
  ko "caption_polish pro" "$out"
fi

log "==="
log "PASS=$pass  FAIL=$fail"
exit "$fail"
