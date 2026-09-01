#!/usr/bin/env bash
# W-2 smoke (revised, 2026-06-01): trigger system WORKFLOWS (not chains)
# end-to-end via POST /api/workflows/:id/trigger.
#
# Server hydrates nodes/edges from the workflows table when the body omits
# them, so smoke just sends a context payload.
set -euo pipefail

BASE="${ELARA_BASE:-http://127.0.0.1:3005}"
PASS=0; FAIL=0

echo "=== W-2 smoke (system workflows end-to-end) ==="

run_workflow() {
  local id="$1"; local label="$2"; local input="$3"
  local body
  body=$(curl -s -m 120 -X POST "$BASE/api/workflows/${id}/trigger" \
    -H "Content-Type: application/json" \
    -d "{\"context\":{\"input\":$(printf '%s' "$input" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}}" \
    || echo '{"ok":false,"error":"curl_failed"}')
  local ok skill_steps
  ok=$(printf '%s' "$body" | python3 -c 'import json,sys;d=json.loads(sys.stdin.read() or "{}");print("1" if d.get("ok") else "0")' 2>/dev/null || echo 0)
  skill_steps=$(printf '%s' "$body" | python3 -c 'import json,sys;d=json.loads(sys.stdin.read() or "{}");t=d.get("trace") or [];print(sum(1 for s in t if isinstance(s,dict) and s.get("kind")=="skill"))' 2>/dev/null || echo 0)
  if [ "$ok" = "1" ] && [ "${skill_steps:-0}" -ge 1 ]; then
    echo "  PASS · ${label} (skill_steps=${skill_steps})"
    PASS=$((PASS+1))
  else
    echo "  FAIL · ${label}"
    echo "    body: $(printf '%s' "$body" | head -c 400)"
    FAIL=$((FAIL+1))
  fi
}

run_workflow "sys.netsec.incident-to-report" "NetSec incident→report" \
  "Suspicious east-west scan from 10.1.4.22 hitting RDP across DC subnet between 03:14-03:21 UTC."

run_workflow "sys.social.content-launch" "Social hook→caption→hashtags" \
  "New product launch: cold-brew tea, sustainable packaging, target 25-35 wellness segment."

echo "==="
echo "PASS=${PASS}  FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
