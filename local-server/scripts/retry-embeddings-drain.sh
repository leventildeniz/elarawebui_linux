#!/usr/bin/env bash
# retry-embeddings-drain.sh
# RAG: knowledge_chunks NULL/error/pending embedding'lerini batch'ler halinde
# yeniden gömer.
#
# Auth stratejisi (sırayla denenir):
#   1) ELARA_USER + ELARA_PASS varsa /api/auth/login → x-session-id
#   2) .env içindeki ADMIN_API_TOKEN → x-admin-token (loopback)
#   3) Hiçbiri yoksa interaktif soru: kullanıcı adı + parola
#
# Env override'lar:
#   BASE     — bridge base URL (default: http://127.0.0.1:3005)
#   LIMIT    — her batch'te işlenecek chunk sayısı (default: 3000, max 5000)
#   ROUNDS   — kaç batch denenecek (default: 9)
#   SLEEP_S  — turlar arası bekleme (default: 3)
#   ELARA_USER / ELARA_PASS — login için
#   NO_LOGIN_PROMPT=1 — prompt'u kapatır, sadece token / env kullanır
#
# Kullanım:
#   ELARA_USER=admin ELARA_PASS='...' ./local-server/scripts/retry-embeddings-drain.sh
#   LIMIT=5000 ROUNDS=6 ./local-server/scripts/retry-embeddings-drain.sh

set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3005}"
LIMIT="${LIMIT:-3000}"
ROUNDS="${ROUNDS:-9}"
SLEEP_S="${SLEEP_S:-3}"
WORKER="${WORKER:-http://127.0.0.1:8082}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"

ADMIN_TOKEN=""
if [ -f "$ENV_FILE" ]; then
  ADMIN_TOKEN="$(grep -E '^ADMIN_API_TOKEN=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi

have_jq=0
if command -v jq >/dev/null 2>&1; then have_jq=1; fi

pp() {
  if [ "$have_jq" = "1" ]; then jq -c "$@"; else cat; fi
}

# ---- Auth ------------------------------------------------------------------
SID=""

try_login() {
  local user="$1" pass="$2"
  [ -z "$user" ] || [ -z "$pass" ] && return 1
  local resp
  resp="$(curl -sk -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$(printf '{"username":%s,"password":%s,"provider":"local","device":"retry-drain"}' \
          "$(printf '%s' "$user" | jq -Rs . 2>/dev/null || echo "\"$user\"")" \
          "$(printf '%s' "$pass" | jq -Rs . 2>/dev/null || echo "\"$pass\"")" )" \
    || echo '{"ok":false}')"
  if [ "$have_jq" = "1" ]; then
    SID="$(echo "$resp" | jq -r '.sessionId // empty')"
    local ok; ok="$(echo "$resp" | jq -r '.ok // false')"
    local role; role="$(echo "$resp" | jq -r '.user.role // "?"')"
    if [ "$ok" = "true" ] && [ -n "$SID" ]; then
      echo "[auth] login ok user=$user role=$role sid=${SID:0:10}…"
      return 0
    fi
    echo "[auth] login fail: $(echo "$resp" | jq -c '{ok,error}')"
  else
    SID="$(echo "$resp" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')"
    [ -n "$SID" ] && { echo "[auth] login ok user=$user sid=${SID:0:10}…"; return 0; }
    echo "[auth] login fail (raw): $resp"
  fi
  SID=""
  return 1
}

USER_IN="${ELARA_USER:-}"
PASS_IN="${ELARA_PASS:-}"

if [ -n "$USER_IN" ] && [ -n "$PASS_IN" ]; then
  try_login "$USER_IN" "$PASS_IN" || true
fi

# Eğer login olmadıysa ve admin token varsa, onu deneyeceğiz (header bazında).
# SID boş → x-admin-token fallback
auth_header=()
if [ -n "$SID" ]; then
  auth_header=(-H "x-session-id: $SID")
elif [ -n "$ADMIN_TOKEN" ]; then
  auth_header=(-H "x-admin-token: $ADMIN_TOKEN")
  echo "[auth] no sid → x-admin-token fallback (len=${#ADMIN_TOKEN})"
else
  if [ "${NO_LOGIN_PROMPT:-0}" = "1" ]; then
    echo "[auth] no credentials and NO_LOGIN_PROMPT=1 — aborting." >&2
    exit 10
  fi
  echo "[auth] credentials gerekli."
  read -r -p "Username: " USER_IN
  read -r -s -p "Password: " PASS_IN; echo
  try_login "$USER_IN" "$PASS_IN" || { echo "[auth] login başarısız."; exit 11; }
  auth_header=(-H "x-session-id: $SID")
fi

# ---- Helpers ---------------------------------------------------------------
health_summary() {
  curl -sk "${auth_header[@]}" "$BASE/api/rag/health" \
    | pp '.chunks | {ok:.embedding_ok, pend:.embedding_pending, err:.embedding_error, miss:.embedding_missing}'
}

echo
echo "=== Config ==="
echo "BASE=$BASE  LIMIT=$LIMIT  ROUNDS=$ROUNDS  SLEEP=${SLEEP_S}s"
echo "Auth: $( [ -n "$SID" ] && echo "sid (login)" || echo "x-admin-token" )"
echo
echo "=== Başlangıç sağlığı ==="
health_summary
echo

zero_streak=0
for i in $(seq 1 "$ROUNDS"); do
  echo "=== Batch $i / $ROUNDS ==="
  RESP="$(curl -sk -X POST "$BASE/api/rag/retry-embeddings?limit=$LIMIT" \
    "${auth_header[@]}" \
    -H 'Content-Type: application/json' \
    -d '{}' || echo '{"ok":false,"error":"curl_failed"}')"

  echo "$RESP" | pp '{ok, scanned, written, remaining, error}'
  health_summary

  if [ "$have_jq" = "1" ]; then
    W="$(echo "$RESP" | jq -r '.written // 0')"
    OK_FLAG="$(echo "$RESP" | jq -r '.ok // false')"
  else
    W="$(echo "$RESP" | sed -n 's/.*"written":\([0-9]*\).*/\1/p')"
    OK_FLAG="$(echo "$RESP" | sed -n 's/.*"ok":\(true\|false\).*/\1/p')"
    W="${W:-0}"; OK_FLAG="${OK_FLAG:-false}"
  fi

  if [ "$OK_FLAG" != "true" ]; then
    echo "!! API ok=false — duruyorum."
    curl -s "$WORKER/health" | pp '{ok, model, backend, rss_gb, uptime_s, reranker:.reranker.loaded}'
    exit 2
  fi

  if [ "${W:-0}" = "0" ]; then
    zero_streak=$((zero_streak + 1))
    echo "!! written=0 (streak=$zero_streak)"
    if [ "$zero_streak" -ge 2 ]; then
      curl -s "$WORKER/health" | pp '{ok, model, backend, rss_gb, uptime_s, reranker:.reranker.loaded}'
      echo "İki tur üst üste written=0 — duruyorum."
      exit 3
    fi
  else
    zero_streak=0
  fi

  sleep "$SLEEP_S"
done

echo
echo "=== Bitti — son sağlık ==="
health_summary
