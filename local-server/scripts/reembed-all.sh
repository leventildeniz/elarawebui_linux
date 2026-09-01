#!/usr/bin/env bash
# reembed-all.sh — Tek komutluk drain orkestratörü.
#
# Akış:
#   1) preflight (psql/curl/jq/python check, DB ping, settings dosyası)
#   2) .rag-settings.json → useEnrichedContent=true (gerekirse middleware kickstart)
#   3) baseline pending sayısı
#   4) auth (ELARA_USER/PASS env > .env ADMIN_API_TOKEN > prompt)
#   5) drain loop: POST /api/rag/retry-embeddings + tek satır progress + ETA
#   6) validate: 3 rag-debug sorgusu (top1 ≥ 0.70 hedef)
#   7) summary
#
# Kullanım:
#   ELARA_USER=admin ELARA_PASS='...' ./local-server/scripts/reembed-all.sh
#   ./local-server/scripts/reembed-all.sh                  # .env'de ADMIN_API_TOKEN varsa
#
# Env override:
#   BASE      bridge base URL (default: http://127.0.0.1:3005)
#   DB        psql -d argümanı (default: elara_db)
#   LIMIT     batch boyutu (default: 3000, max 5000)
#   SLEEP_S   turlar arası bekleme (default: 3)
#   ZERO_TRIP üst üste written=0 toleransı (default: 3)
#   SKIP_VALIDATE=1  → drain sonrası rag-debug atla
#   SKIP_KICKSTART=1 → settings değişse bile kickstart atma

set -uo pipefail

# ---- Renkler --------------------------------------------------------------
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'
  C_DIM=$'\033[2m';  C_BLD=$'\033[1m';  C_RST=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YLW=""; C_BLU=""; C_DIM=""; C_BLD=""; C_RST=""
fi

say()  { printf "%s\n" "$*"; }
ok()   { printf "%s✓%s %s\n" "$C_GRN" "$C_RST" "$*"; }
warn() { printf "%s!%s %s\n" "$C_YLW" "$C_RST" "$*"; }
err()  { printf "%s✗%s %s\n" "$C_RED" "$C_RST" "$*" >&2; }
hdr()  { printf "\n%s━━━ %s %s%s\n" "$C_BLD" "$*" "$(printf '━%.0s' $(seq 1 $((60 - ${#1}))))" "$C_RST"; }

# ---- Config ---------------------------------------------------------------
BASE="${BASE:-http://127.0.0.1:3005}"
DB="${DB:-elara_db}"
LIMIT="${LIMIT:-3000}"
SLEEP_S="${SLEEP_S:-3}"
ZERO_TRIP="${ZERO_TRIP:-3}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SETTINGS_FILE="$REPO_DIR/data/rag-settings.json"
LEGACY_SETTINGS_FILE="$REPO_DIR/.rag-settings.json"
ENV_FILE="$REPO_DIR/.env"

# ---- 1) Preflight ---------------------------------------------------------
hdr "1. Preflight"

for bin in psql curl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    err "$bin bulunamadı (PATH'te yok)"; exit 10
  fi
done
HAVE_JQ=0; command -v jq >/dev/null 2>&1 && HAVE_JQ=1
HAVE_PY=0; command -v python3 >/dev/null 2>&1 && HAVE_PY=1
if [ "$HAVE_JQ" = "0" ] && [ "$HAVE_PY" = "0" ]; then
  err "jq veya python3 lazım (JSON editi için). İkisi de yok."; exit 10
fi

if ! psql -d "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  err "psql -d $DB erişilemiyor"; exit 11
fi
ok "psql + $DB erişilebilir"

if [ ! -f "$SETTINGS_FILE" ] && [ -f "$LEGACY_SETTINGS_FILE" ]; then
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  cp "$LEGACY_SETTINGS_FILE" "$SETTINGS_FILE"
fi
if [ ! -f "$SETTINGS_FILE" ]; then
  err "$SETTINGS_FILE bulunamadı"; exit 12
fi
ok "settings dosyası: $SETTINGS_FILE"

# ---- 2) Settings fix ------------------------------------------------------
hdr "2. Settings fix (useEnrichedContent → true)"

CUR_VAL=""
if [ "$HAVE_JQ" = "1" ]; then
  CUR_VAL="$(jq -r '.useEnrichedContent // false' "$SETTINGS_FILE")"
else
  CUR_VAL="$(python3 -c "import json;print(json.load(open('$SETTINGS_FILE')).get('useEnrichedContent', False))" | tr '[:upper:]' '[:lower:]')"
fi
say "  şu anki değer: $CUR_VAL"

SETTINGS_CHANGED=0
if [ "$CUR_VAL" != "true" ]; then
  TMP="$(mktemp)"
  if [ "$HAVE_JQ" = "1" ]; then
    jq '.useEnrichedContent = true' "$SETTINGS_FILE" > "$TMP" && mv "$TMP" "$SETTINGS_FILE"
  else
    python3 -c "
import json, sys
p = '$SETTINGS_FILE'
d = json.load(open(p))
d['useEnrichedContent'] = True
json.dump(d, open(p,'w'), indent=2)
print('done')
"
  fi
  ok "useEnrichedContent → true yazıldı"
  SETTINGS_CHANGED=1
else
  ok "zaten true, dokunulmadı"
fi

if [ "$SETTINGS_CHANGED" = "1" ] && [ "${SKIP_KICKSTART:-0}" != "1" ]; then
  say "  middleware kickstart..."
  if launchctl kickstart -k "gui/$UID/com.elara.middleware" 2>/dev/null; then
    ok "kickstart ok — 8sn warmup"
    sleep 8
  else
    warn "kickstart başarısız (servis yüklü değil?). Middleware'i elle restart edebilirsin."
  fi
fi

# ---- 3) Baseline ----------------------------------------------------------
hdr "3. Baseline"

read_pending() {
  psql -d "$DB" -tAc "SELECT COUNT(*) FROM knowledge_chunks WHERE embedding_status='pending' OR embedding IS NULL" 2>/dev/null | tr -d ' '
}
read_status_breakdown() {
  psql -d "$DB" -tAc "SELECT COALESCE(embedding_status,'<null>'), COUNT(*) FROM knowledge_chunks GROUP BY 1 ORDER BY 1" 2>/dev/null
}

PENDING_START="$(read_pending)"
PENDING_START="${PENDING_START:-0}"
say "  dağılım:"
read_status_breakdown | sed 's/^/    /'
ok "başlangıç pending: $PENDING_START"

if [ "$PENDING_START" = "0" ]; then
  ok "drain edilecek chunk yok, doğrudan validate'e geç"
  goto_validate=1
else
  goto_validate=0
fi

# ---- 4) Auth --------------------------------------------------------------
SID=""
AUTH_MODE=""

if [ "$goto_validate" = "0" ]; then
  hdr "4. Auth"

  try_login() {
    local user="$1" pass="$2"
    [ -z "$user" ] || [ -z "$pass" ] && return 1
    local body
    body=$(printf '{"username":"%s","password":"%s","provider":"local","device":"reembed-all"}' "$user" "$pass")
    local resp
    resp="$(curl -sk -X POST "$BASE/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d "$body" 2>/dev/null || echo '{"ok":false}')"
    if [ "$HAVE_JQ" = "1" ]; then
      SID="$(echo "$resp" | jq -r '.sessionId // empty')"
    else
      SID="$(echo "$resp" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')"
    fi
    [ -n "$SID" ]
  }

  if [ -n "${ELARA_USER:-}" ] && [ -n "${ELARA_PASS:-}" ]; then
    if try_login "$ELARA_USER" "$ELARA_PASS"; then
      ok "login ok (env) — sid=${SID:0:10}…"
      AUTH_MODE="sid"
    else
      warn "ELARA_USER/PASS ile login fail, fallback'lere bakıyorum"
    fi
  fi

  if [ -z "$SID" ] && [ -f "$ENV_FILE" ]; then
    ADMIN_TOKEN="$(grep -E '^ADMIN_API_TOKEN=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
    if [ -n "$ADMIN_TOKEN" ]; then
      ok "ADMIN_API_TOKEN bulundu — x-admin-token fallback (len=${#ADMIN_TOKEN})"
      AUTH_MODE="token"
    fi
  fi

  if [ -z "$SID" ] && [ -z "${ADMIN_TOKEN:-}" ]; then
    if [ "${NO_PROMPT:-0}" = "1" ]; then
      err "auth yok ve NO_PROMPT=1"; exit 20
    fi
    say "  ELARA_USER/PASS gir:"
    read -r -p "  username: " U
    read -r -s -p "  password: " P; echo
    if try_login "$U" "$P"; then
      ok "login ok — sid=${SID:0:10}…"
      AUTH_MODE="sid"
    else
      err "login başarısız"; exit 21
    fi
  fi
fi

auth_curl() {
  if [ "$AUTH_MODE" = "sid" ]; then
    curl -sk -H "x-session-id: $SID" "$@"
  else
    curl -sk -H "x-admin-token: $ADMIN_TOKEN" "$@"
  fi
}

# ---- 5) Drain loop --------------------------------------------------------
if [ "$goto_validate" = "0" ]; then
  hdr "5. Drain loop (batch=$LIMIT, sleep=${SLEEP_S}s)"
  say "  ilk batch worker'ı spawn eder (~15-30sn cold start)."
  say "  bge-m3 MPS throughput ~50-100 chunk/s → ~30-60dk tahmini."
  echo

  t_start=$(date +%s)
  prev_pending="$PENDING_START"
  zero_streak=0
  round=0
  total_written=0

  while :; do
    round=$((round + 1))
    t_batch=$(date +%s)
    resp="$(auth_curl -X POST "$BASE/api/rag/retry-embeddings?limit=$LIMIT" \
      -H 'Content-Type: application/json' -d '{}' 2>/dev/null || echo '{"ok":false,"error":"curl_failed"}')"

    if [ "$HAVE_JQ" = "1" ]; then
      ok_flag="$(echo "$resp" | jq -r '.ok // false')"
      written="$(echo "$resp" | jq -r '.written // 0')"
      api_err="$(echo "$resp" | jq -r '.error // empty')"
    else
      ok_flag="$(echo "$resp" | sed -n 's/.*"ok":\(true\|false\).*/\1/p')"
      written="$(echo "$resp" | sed -n 's/.*"written":\([0-9]*\).*/\1/p')"
      api_err="$(echo "$resp" | sed -n 's/.*"error":"\([^"]*\)".*/\1/p')"
      ok_flag="${ok_flag:-false}"; written="${written:-0}"
    fi

    if [ "$ok_flag" != "true" ]; then
      echo
      err "API ok=false (round=$round) error='${api_err:-bilinmiyor}'"
      err "raw: $resp"
      err "worker /health:"
      curl -s --max-time 2 http://127.0.0.1:8082/health 2>&1 | head -20 || true
      exit 30
    fi

    total_written=$((total_written + written))
    cur_pending="$(read_pending)"
    cur_pending="${cur_pending:-0}"
    delta=$((prev_pending - cur_pending))
    elapsed=$(( $(date +%s) - t_start ))
    elapsed_min=$(( elapsed / 60 ))
    if [ "$elapsed" -gt 0 ] && [ "$total_written" -gt 0 ]; then
      rate=$(( total_written / (elapsed > 0 ? elapsed : 1) ))
      if [ "$rate" -gt 0 ] && [ "$cur_pending" -gt 0 ]; then
        eta_s=$(( cur_pending / rate ))
        eta_str="ETA ~$(( eta_s / 60 ))dk @ ${rate}/s"
      else
        eta_str="ETA ?"
      fi
    else
      rate=0; eta_str="ETA ?"
    fi

    ts="$(date '+%H:%M:%S')"
    printf "  [%s] round=%2d  written=%5d  pending=%6d (-%5d)  total=%6d  %s\n" \
      "$ts" "$round" "$written" "$cur_pending" "$delta" "$total_written" "$eta_str"

    if [ "$cur_pending" = "0" ]; then
      ok "drain tamamlandı."
      break
    fi

    if [ "$written" = "0" ]; then
      zero_streak=$((zero_streak + 1))
      warn "written=0 (streak=$zero_streak/$ZERO_TRIP)"
      if [ "$zero_streak" -ge "$ZERO_TRIP" ]; then
        echo
        err "$ZERO_TRIP tur üst üste written=0. Worker stuck olabilir. Health:"
        curl -s --max-time 2 http://127.0.0.1:8082/health 2>&1 | head -20 || true
        echo
        err "Kalan pending: $cur_pending — tekrar çalıştırarak devam edebilirsin."
        exit 31
      fi
    else
      zero_streak=0
    fi

    prev_pending="$cur_pending"
    sleep "$SLEEP_S"
  done

  t_end=$(date +%s)
  total_s=$((t_end - t_start))
  avg_rate=$(( total_written / (total_s > 0 ? total_s : 1) ))
  ok "drain özeti: ${total_written} chunk in $((total_s/60))dk $((total_s%60))sn (~${avg_rate}/s)"
fi

# ---- 6) Validate ----------------------------------------------------------
if [ "${SKIP_VALIDATE:-0}" = "1" ]; then
  warn "SKIP_VALIDATE=1 — rag-debug atlandı"
  exit 0
fi

hdr "6. Validate (rag-debug, MLX tetiklenmez)"

QUERIES=(
  "Checkpoint NAT troubleshooting"
  "Cloudflare WAF rule configuration"
  "A10 vThunder license activation"
)

PASS=0; FAIL=0
for q in "${QUERIES[@]}"; do
  echo
  say "  ▸ '$q'"
  out="$(cd "$REPO_DIR/.." 2>/dev/null && bun run "$SCRIPT_DIR/rag-debug.mjs" "$q" 2>&1 || true)"
  echo "$out" | grep -E '^"' | head -1 | sed 's/^/    /' || true
  # rag-debug satır formatı: "<query>" <kind> <top1> <top2> <top3> <thr> <reason>
  # Quoted sorgu değişken kelime sayısı içerdiği için awk $3 sabit değil.
  # Bunun yerine: "query"/"prompt"/"rerank" keyword'ünden sonraki ilk float'u al.
  top1="$(echo "$out" | grep -E '^"' | head -1 \
    | sed -E 's/.*(query|prompt|rerank|probe)[[:space:]]+([0-9]+\.[0-9]+).*/\2/')"
  if [ -z "$top1" ] || ! echo "$top1" | grep -qE '^[0-9]+\.[0-9]+$'; then
    err "  top1 parse edilemedi (raw: $(echo "$out" | grep -E '^"' | head -1 | head -c 100))"
    FAIL=$((FAIL+1)); continue
  fi
  # bash float compare: awk
  if awk "BEGIN{exit !($top1 >= 0.70)}"; then
    ok "  top1=$top1 ≥ 0.70 PASS"
    PASS=$((PASS+1))
  else
    warn "  top1=$top1 < 0.70 — beklenenin altında"
    FAIL=$((FAIL+1))
  fi
done

# ---- 7) Summary -----------------------------------------------------------
hdr "7. Summary"
say "  pending başlangıç:  $PENDING_START"
say "  pending bitiş:      $(read_pending)"
say "  validate:           ${C_GRN}${PASS} PASS${C_RST} / ${C_RED}${FAIL} FAIL${C_RST}"
echo
if [ "$FAIL" -eq 0 ]; then
  ok "Hepsi yeşil. Chat üzerinden ağır soru deneyebilirsin."
  exit 0
else
  warn "Bazı sorgular eşik altında. Drain tamamlandı ama RAG kalitesi beklenenin altında."
  warn "Sebep olabilir: enrichment eksik chunk'lar, brand'e özgü düşük örneklem, ya da reranker miss."
  exit 2
fi
