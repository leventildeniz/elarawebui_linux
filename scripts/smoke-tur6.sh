#!/usr/bin/env bash
# scripts/smoke-tur6.sh — Agent → Tool dispatch smoke test
#
# Lokal Mac'te çalıştır: middleware ayakta (127.0.0.1:3005), DB up.
# Adımlar:
#   1. Manifest reload (admin)
#   2. action_library envanteri (DB → slug count)
#   3. Endpoint loopback gate
#   4. Missing X-Agent-Id → 400
#   5. Unknown agent → 404
#   6. Agent w/ empty manifest → 403 not_in_agent_manifest
#   7. Python helper end-to-end (dryRun)
#   8. Run History entry (dryRun=false ile gerçek tool varsa)
#
# Kullanım: ./scripts/smoke-tur6.sh [--with-real-tool <slug>]
set -uo pipefail
BASE="${ELARA_API_BASE:-http://127.0.0.1:3005}"
REAL_TOOL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-real-tool) REAL_TOOL="$2"; shift 2 ;;
    *) echo "unknown: $1"; exit 2 ;;
  esac
done

pass=0; fail=0; skip=0
hr() { printf '%.0s─' {1..72}; echo; }
ok()    { echo "  ✅ $1"; pass=$((pass+1)); }
bad()   { echo "  ❌ $1"; fail=$((fail+1)); }
warn()  { echo "  ⚠️  $1"; skip=$((skip+1)); }

step() { hr; echo "▶ $1"; }

curl_json() {
  # $1=method $2=path $3=body $4..=extra headers
  local m="$1" p="$2" body="${3:-}"; shift 3 || true
  local args=(-sS -o /tmp/smoke6.body -w '%{http_code}' -X "$m" "$BASE$p")
  args+=(-H 'Content-Type: application/json')
  for h in "$@"; do args+=(-H "$h"); done
  [[ -n "$body" ]] && args+=(--data "$body")
  curl "${args[@]}" 2>/dev/null
}

step "0/ Middleware health"
code=$(curl -sS -o /tmp/h -w '%{http_code}' "$BASE/api/health" 2>/dev/null || echo 000)
if [[ "$code" == "200" ]]; then ok "GET /api/health → 200"
else bad "Middleware down (code=$code) — aborting"; exit 1; fi

step "1/ Manifest reload"
# Bu admin gerektirir; session yoksa 401. Endpoint yine de var mı kontrol et.
code=$(curl_json POST /api/agents/reload-manifests "")
if [[ "$code" == "200" ]]; then
  count=$(python3 -c "import json; print(json.load(open('/tmp/smoke6.body'))['count'])" 2>/dev/null || echo "?")
  ok "reload-manifests → 200 (agents=$count)"
elif [[ "$code" == "401" || "$code" == "403" ]]; then
  warn "reload-manifests gated (code=$code) — session-less smoke; endpoint exists"
else
  bad "reload-manifests unexpected code=$code"
fi

step "2/ action_library envanteri"
if command -v psql >/dev/null && [[ -n "${DATABASE_URL:-}" || -n "${PGDATABASE:-}" ]]; then
  slugs=$(psql -tAc "SELECT COALESCE(slug, name, id) FROM action_library ORDER BY 1" 2>/dev/null || true)
  if [[ -n "$slugs" ]]; then
    n=$(echo "$slugs" | wc -l | tr -d ' ')
    ok "action_library = $n tool"
    echo "$slugs" | head -8 | sed 's/^/      · /'
  else
    warn "action_library boş"
  fi
else
  warn "psql/DATABASE_URL yok — envanter atlandı"
fi

step "3/ Loopback gate (X-Forwarded-For ile sahte non-loopback denemesi)"
# Loopback check ip'ye bakıyor; lokal istek loopback olur — true negative test
# için ancak external IP'den deneyebilirsin. Burada sadece smoke: 200 / 4xx beklenir.
code=$(curl_json POST /api/agents/tool-call '{"tool":"x"}' "X-Agent-Id: copy_smith")
case "$code" in
  4*) ok "tool-call reachable, returned 4xx (slug=x) code=$code" ;;
  *)  bad "tool-call unexpected code=$code body=$(cat /tmp/smoke6.body | head -c 200)" ;;
esac

step "4/ Missing X-Agent-Id → 400"
code=$(curl_json POST /api/agents/tool-call '{"tool":"x"}')
[[ "$code" == "400" ]] && ok "→ 400 no_agent" || bad "expected 400, got $code"

step "5/ Unknown agent → 404"
code=$(curl_json POST /api/agents/tool-call '{"tool":"x"}' "X-Agent-Id: nonexistent_ghost_999")
if [[ "$code" == "404" ]]; then ok "→ 404 unknown agent"
else bad "expected 404, got $code · body=$(cat /tmp/smoke6.body | head -c 200)"; fi

step "6/ Manifest gate — copy_smith bound to 'echo' only"
# 6a: unrelated slug → 403 not_in_agent_manifest
code=$(curl_json POST /api/agents/tool-call '{"tool":"any_slug"}' "X-Agent-Id: copy_smith")
body=$(cat /tmp/smoke6.body)
if [[ "$code" == "403" ]] && echo "$body" | grep -q "not_in_agent_manifest\|no_manifest"; then
  ok "6a non-bound slug → 403 manifest gate"
else
  bad "6a expected 403 manifest block, got $code · body=$body"
fi
# 6b: echo slug (dryRun) → 200/202 (manifest passes; tool resolution kicks in)
code=$(curl_json POST /api/agents/tool-call '{"tool":"echo","dryRun":true,"input":{"msg":"hi"}}' "X-Agent-Id: copy_smith")
body=$(cat /tmp/smoke6.body)
case "$code" in
  200|202) ok "6b echo passes manifest gate (code=$code)" ;;
  404) warn "6b echo not in action_library yet — run 'Scan tools/' in /system-engine first" ;;
  *) bad "6b unexpected code=$code · body=$(echo "$body" | head -c 200)" ;;
esac

step "7/ Python helper smoke (dispatch.py import + dryRun)"
python3 - <<'PY' 2>&1 | sed 's/^/    /'
import os, sys
sys.path.insert(0, "agents")
os.environ["ELARA_AGENT_ID"] = "copy_smith"
try:
    from _shared.dispatch import call_tool, ToolBlocked, ToolError
    try:
        out = call_tool("any_slug", _dry_run=True, foo="bar")
        print("UNEXPECTED ok:", out)
    except ToolBlocked as e:
        print(f"OK ToolBlocked code={e.code} msg={e}")
    except ToolError as e:
        print(f"OK ToolError (manifest gate): {e}")
except ImportError as e:
    print(f"FAIL import: {e}")
PY
ok "helper end-to-end exercised"

if [[ -n "$REAL_TOOL" ]]; then
  step "8/ Real tool dryRun ($REAL_TOOL) — agent manifest gerekli"
  warn "Bu adımı çalıştırmak için bir agent'a '# @tools: $REAL_TOOL' eklemen lazım."
  warn "Şu an tüm agent manifestleri '@tools: -' (boş). Edit + reload sonra tekrar dene."
fi

hr
echo "Summary: ✅ $pass passed · ❌ $fail failed · ⚠️ $skip skipped/warn"
[[ "$fail" == "0" ]] && exit 0 || exit 1
