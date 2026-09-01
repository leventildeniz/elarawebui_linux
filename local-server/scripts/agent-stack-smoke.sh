#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# agent-stack-smoke.sh — Faz 19
#
# Agent / Tool / Workflow / Orchestration zincirini tek komutta uçtan uca
# doğrular. "Çalışıyor mu?" sorusuna 30 saniyede yeşil/kırmızı cevap verir.
# Bir şey kırılırsa hangi katmanda kırıldığını net gösterir.
#
# Kullanım:
#   bash local-server/scripts/agent-stack-smoke.sh
#   bash local-server/scripts/agent-stack-smoke.sh --verbose
#   bash local-server/scripts/agent-stack-smoke.sh --only orchestrate
#   bash local-server/scripts/agent-stack-smoke.sh --base https://127.0.0.1:10443 --insecure
#
# Exit code = başarısız adım sayısı (CI / cron için uygun).
# ─────────────────────────────────────────────────────────────────────────────
set -u

# ── argv ─────────────────────────────────────────────────────────────────────
BASE="${BRIDGE_BASE:-http://127.0.0.1:3005}"
INSECURE=0
VERBOSE=0
ONLY=""
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)        BASE="$2"; shift 2 ;;
    --insecure)    INSECURE=1; shift ;;
    --verbose|-v)  VERBOSE=1; shift ;;
    --only)        ONLY="$2"; shift 2 ;;
    --admin-user)  ADMIN_USER="$2"; shift 2 ;;
    --admin-pass)  ADMIN_PASS="$2"; shift 2 ;;
    -h|--help)
      grep -E "^# " "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

LOG="/tmp/elara-agent-smoke.log"
: > "$LOG"

# ── renkler ──────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  G="\033[32m"; R="\033[31m"; Y="\033[33m"; D="\033[90m"; B="\033[1m"; X="\033[0m"
else G=""; R=""; Y=""; D=""; B=""; X=""; fi

PASS=0; FAIL=0; SKIP=0; STEP=0
TOTAL=10
T_START=$(date +%s)

step() {
  STEP=$((STEP+1))
  local name="$1"
  printf "${B}[%d/%d] %-13s${X} " "$STEP" "$TOTAL" "$name"
}
ok()   { PASS=$((PASS+1)); printf "${G}✓${X} %s\n" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf "${R}✗${X} %s\n" "$1"; }
skip() { SKIP=$((SKIP+1)); printf "${Y}⊘${X} %s\n" "$1"; }
note() { printf "${D}%s${X}\n" "$1"; }

curl_opts=(-s --max-time 8)
[[ $INSECURE -eq 1 ]] && curl_opts+=(-k)

# only filtresi: "prech,auth,disp" → match herhangi biri içeriyorsa true
match() {
  [[ -z "$ONLY" ]] && return 0
  local n="$1" tok
  IFS=',' read -ra toks <<< "$ONLY"
  for tok in "${toks[@]}"; do
    [[ "$n" == *"$(echo "$tok" | tr '[:upper:]' '[:lower:]')"* ]] && return 0
  done
  return 1
}

logv() { [[ $VERBOSE -eq 1 ]] && echo "→ $*" | tee -a "$LOG" >/dev/null || echo "→ $*" >> "$LOG"; }

# ─────────────────────────────────────────────────────────────────────────────
# 1. PRECHECK
# ─────────────────────────────────────────────────────────────────────────────
if match "precheck"; then
  step "PRECHECK"
  errs=()
  pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && pg="✓ pg" || { pg="✗ pg"; errs+=(postgres); }
  curl "${curl_opts[@]}" -f http://127.0.0.1:3005/api/health -o /dev/null && mw="✓ mw" || { mw="✗ mw"; errs+=(middleware); }
  curl "${curl_opts[@]}" -k -f https://127.0.0.1:3006/api/health -o /dev/null && tls="✓ tls" || { tls="✗ tls"; errs+=(middleware-tls); }
  curl "${curl_opts[@]}" -f http://127.0.0.1:8080 -o /dev/null && vite="✓ vite" || { vite="✗ vite"; errs+=(vite); }
  curl "${curl_opts[@]}" -k -f https://127.0.0.1:10443/api/health -o /dev/null && prx="✓ proxy" || { prx="✗ proxy"; errs+=(tls-proxy); }
  line="$pg $mw $tls $vite $prx"
  if [[ ${#errs[@]} -eq 0 ]]; then ok "$line"; else bad "$line — ölü: ${errs[*]}"; fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. AUTH (admin login → SID)
# ─────────────────────────────────────────────────────────────────────────────
SID=""
ROLE=""
if match "auth"; then
  step "AUTH"
  # ADMIN_API_TOKEN .env'den okunabilirse onunla bearer auth dene; aksi halde
  # username/password login. Kullanıcı --admin-pass vermediyse atlanır.
  if [[ -z "$ADMIN_PASS" && -f .env ]]; then
    ADMIN_PASS_ENV=$(grep -E '^ADMIN_PASS=' .env 2>/dev/null | tail -1 | cut -d= -f2-)
    [[ -n "${ADMIN_PASS_ENV:-}" ]] && ADMIN_PASS="$ADMIN_PASS_ENV"
  fi
  if [[ -z "$ADMIN_PASS" ]]; then
    skip "ADMIN_PASS yok (.env'de ADMIN_PASS= yoksa --admin-pass <pwd> ver)"
  else
    body=$(curl "${curl_opts[@]}" -X POST "$BASE/api/auth/login" \
      -H 'content-type: application/json' \
      -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\",\"provider\":\"local\",\"device\":\"agent-smoke\"}" 2>>"$LOG")
    logv "login → $body"
    SID=$(echo "$body" | sed -nE 's/.*"sessionId":"([^"]+)".*/\1/p')
    ROLE=$(echo "$body" | sed -nE 's/.*"role":"([^"]+)".*/\1/p')
    if [[ -n "$SID" ]]; then
      ok "sid=${SID:0:12}… role=${ROLE:-?}"
    else
      bad "login başarısız (body: $(echo "$body" | head -c 120))"
    fi
  fi
fi

auth_hdr=()
[[ -n "$SID" ]] && auth_hdr=(-H "x-session-id: $SID")

# ─────────────────────────────────────────────────────────────────────────────
# 3. CAPABILITY
# ─────────────────────────────────────────────────────────────────────────────
if match "capability"; then
  step "CAPABILITY"
  if [[ -z "$SID" ]]; then
    skip "no sid"
  else
    body=$(curl "${curl_opts[@]}" "$BASE/api/capabilities" "${auth_hdr[@]}" 2>>"$LOG")
    logv "capabilities → $(echo "$body" | head -c 200)"
    cnt=$(echo "$body" | grep -oE '"id"' | wc -l | tr -d ' ')
    if echo "$body" | grep -q '"capabilities"' && [[ "$cnt" -gt 0 ]]; then
      ok "$cnt capability kayıtlı"
    else
      bad "registry boş veya hatalı (cnt=$cnt)"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. TOOL.LIST  (capabilities içinden tool-kind sayımı)
# ─────────────────────────────────────────────────────────────────────────────
if match "tool"; then
  step "TOOL.LIST"
  if [[ -z "$SID" ]]; then
    skip "no sid"
  else
    body=$(curl "${curl_opts[@]}" "$BASE/api/capabilities?kind=tool" "${auth_hdr[@]}" 2>>"$LOG")
    logv "tools → $(echo "$body" | head -c 200)"
    cnt=$(echo "$body" | grep -oE '"id"' | wc -l | tr -d ' ')
    if [[ "$cnt" -gt 0 ]]; then
      ok "$cnt tool kayıtlı (kind=tool)"
    else
      # tool kind yoksa workflow kind sayalım — registry hiç boş olmamalı
      wf=$(curl "${curl_opts[@]}" "$BASE/api/capabilities?kind=workflow" "${auth_hdr[@]}" 2>>"$LOG" | grep -oE '"id"' | wc -l | tr -d ' ')
      if [[ "$wf" -gt 0 ]]; then
        skip "kind=tool boş ama kind=workflow=$wf var (henüz tool sync edilmemiş olabilir)"
      else
        bad "tool ve workflow registry'leri boş"
      fi
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. DISPATCH (3 prompt)
# ─────────────────────────────────────────────────────────────────────────────
if match "dispatch"; then
  step "DISPATCH"
  if [[ -z "$SID" ]]; then
    skip "no sid"
  else
    dispatch_one() {
      local text="$1" label="$2"
      local body
      body=$(curl "${curl_opts[@]}" -X POST "$BASE/api/dispatch/dry-run" \
        -H 'content-type: application/json' "${auth_hdr[@]}" \
        -d "{\"text\":$(printf '%s' "$text" | sed 's/"/\\"/g; s/.*/"&"/')}" 2>>"$LOG")
      logv "dispatch($label) → $(echo "$body" | head -c 200)"
      local src
      src=$(echo "$body" | sed -nE 's/.*"source":"([^"]+)".*/\1/p' | head -1)
      [[ -n "$src" ]] && echo "${label}=${src}" || echo "${label}=ERR"
    }
    r1=$(dispatch_one "!ping" "explicit")
    r2=$(dispatch_one "merhaba bu serbest sohbet" "fallback")
    r3=$(dispatch_one "checkpoint policy install nasıl yapılır" "vector")
    line="$r1 · $r2 · $r3"
    if [[ "$line" == *"ERR"* ]]; then bad "$line"; else ok "$line"; fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 6. TOOL.INVOKE  (unknown id → not_found beklenir; wiring kanıtı)
# ─────────────────────────────────────────────────────────────────────────────
if match "invoke"; then
  step "TOOL.INVOKE"
  if [[ -z "$SID" ]]; then
    skip "no sid"
  else
    # Smoke-safe: var olmayan ID → 404 + code:not_found = invoke katmanı sağlam.
    # Gerçek bir tool ID kullanmak side-effect riski taşır.
    body=$(curl "${curl_opts[@]}" -w "\nHTTP:%{http_code}" -X POST \
      "$BASE/api/tools/__smoke_probe_$(date +%s)__/invoke" \
      -H 'content-type: application/json' "${auth_hdr[@]}" \
      -d '{"params":{}}' 2>>"$LOG")
    code=$(echo "$body" | tail -1 | cut -d: -f2)
    json=$(echo "$body" | head -n -1)
    logv "invoke → HTTP $code · $(echo "$json" | head -c 160)"
    if [[ "$code" == "404" ]] && echo "$json" | grep -q '"code":"not_found"'; then
      ok "wiring sağlam (404 not_found, ACL/router katmanı çalışıyor)"
    elif [[ "$code" == "403" ]]; then
      ok "ACL gate aktif (403 — beklenen)"
    else
      bad "beklenmeyen yanıt: HTTP $code · $(echo "$json" | head -c 100)"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 7. WORKFLOW (list + path-traversal koruması)
# ─────────────────────────────────────────────────────────────────────────────
if match "workflow"; then
  step "WORKFLOW"
  if [[ -z "$SID" ]]; then
    skip "no sid"
  else
    body=$(curl "${curl_opts[@]}" "$BASE/api/workflows" "${auth_hdr[@]}" 2>>"$LOG")
    logv "workflows → $(echo "$body" | head -c 200)"
    if echo "$body" | grep -qE '\[|"workflows"|"items"'; then
      # nonexistent chain → 404 + code:not_found
      run_body=$(curl "${curl_opts[@]}" -w "\nHTTP:%{http_code}" -X POST \
        "$BASE/api/workflow-chains/__nonexistent__/run" \
        -H 'content-type: application/json' "${auth_hdr[@]}" -d '{}' 2>>"$LOG")
      rcode=$(echo "$run_body" | tail -1 | cut -d: -f2)
      if [[ "$rcode" == "404" ]]; then
        ok "list OK · run-missing → 404 (engine sağlam)"
      else
        bad "list OK ama run-missing beklenmedik kod: HTTP $rcode"
      fi
    else
      bad "workflows list shape beklenmedik"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. ORCHESTRATE  (pozitif contract'ları smoke.mjs üzerinden koşur)
# ─────────────────────────────────────────────────────────────────────────────
if match "orchestrate"; then
  step "ORCHESTRATE"
  if [[ -z "$SID" ]]; then
    skip "no sid"
  else
    extra=()
    [[ $INSECURE -eq 1 ]] && extra+=(--insecure)
    smoke_out=$(bun local-server/tools/smoke.mjs \
      --base "$BASE" --sid "$SID" --admin --only "agent." "${extra[@]}" 2>&1)
    logv "smoke.mjs --only agent. →"
    echo "$smoke_out" >> "$LOG"
    # smoke.mjs çıktısı: "N passed · M failed · K skipped"
    sline=$(echo "$smoke_out" | grep -E "passed.*failed.*skipped" | tail -1)
    fcount=$(echo "$sline" | sed -nE 's/.* ([0-9]+) failed.*/\1/p')
    pcount=$(echo "$sline" | sed -nE 's/^[^0-9]*([0-9]+) passed.*/\1/p')
    if [[ -n "$fcount" && "$fcount" == "0" && -n "$pcount" && "$pcount" -gt 0 ]]; then
      ok "uçtan uca $pcount pozitif kontrol PASS (capabilities → dispatch → workflows → runs)"
    else
      bad "pozitif kontrol akışında sorun (passed=$pcount failed=$fcount) — detay: $LOG"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 9. CLEANUP
# ─────────────────────────────────────────────────────────────────────────────
if match "cleanup"; then
  step "CLEANUP"
  if [[ -n "$SID" ]]; then
    curl "${curl_opts[@]}" -X DELETE "$BASE/api/sessions/$SID" "${auth_hdr[@]}" -o /dev/null
    ok "logout"
  else
    skip "sid yoktu"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 10. SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
STEP=10
T_END=$(date +%s)
DUR=$((T_END - T_START))
echo ""
printf "${B}━━━ SONUÇ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}\n"
if [[ $FAIL -eq 0 ]]; then
  printf "${G}${B}%d PASS${X} · ${D}%d skip${X} · toplam ${B}%ss${X}\n" "$PASS" "$SKIP" "$DUR"
else
  printf "${G}%d PASS${X} · ${R}${B}%d FAIL${X} · ${D}%d skip${X} · toplam %ss\n" "$PASS" "$FAIL" "$SKIP" "$DUR"
  printf "${D}Detaylı log: %s${X}\n" "$LOG"
fi
exit "$FAIL"
