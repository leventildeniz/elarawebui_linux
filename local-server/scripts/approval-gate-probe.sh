#!/usr/bin/env bash
# Tur-3.11 #5 — Verify Target.requires_approval gate end-to-end.
#
# 1. Create a tool + target (requires_approval=true) + binding
# 2. Invoke the tool against the target as an agent
# 3. Expect HTTP 202 "approval required" and a pending row in tool_approvals
# 4. Cleanup
#
# Exits 0 on green, non-zero with a diagnostic on red.

set -u
PSQL="psql -d elara_db -tA"
API="${API:-http://127.0.0.1:3005}"

# --- Login flow ---
# /api/tools/:id/invoke is session-gated. Probe logs in with the operator's
# own credentials (interactive prompt) and reuses the returned sessionId
# via the x-session-id header.
ELARA_USER="${ELARA_USER:-}"
ELARA_PASS="${ELARA_PASS:-}"
ELARA_PROVIDER="${ELARA_PROVIDER:-local}"
if [ -z "$ELARA_USER" ]; then
  printf "[approval-probe] username: " >&2
  read -r ELARA_USER </dev/tty
fi
if [ -z "$ELARA_PASS" ]; then
  printf "[approval-probe] password: " >&2
  stty -echo 2>/dev/null
  read -r ELARA_PASS </dev/tty
  stty echo 2>/dev/null
  printf '\n' >&2
fi
login_resp=$(curl -s -X POST "${API}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(printf '{"username":"%s","password":"%s","provider":"%s","device":"probe-cli"}' \
        "$ELARA_USER" "$ELARA_PASS" "$ELARA_PROVIDER")")
SID=$(printf '%s' "$login_resp" \
  | sed -nE 's/.*"sessionId"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')
if [ -z "$SID" ]; then
  echo "[approval-probe] ✗ login failed: $login_resp" >&2
  exit 3
fi
SESS_HDR=(-H "x-session-id: ${SID}")
echo "[approval-probe] logged in as ${ELARA_USER} (sid prefix=${SID:0:8}…)"

stamp=$(date +%s)
TOOL_ID="probe-tool-${stamp}"
TARGET_ID="probe-tgt-${stamp}"
AGENT_ID="probe-agent-${stamp}"

cleanup() {
  $PSQL -c "DELETE FROM tool_approvals WHERE invocation_id IN (SELECT id FROM tool_invocations WHERE tool_id='${TOOL_ID}')" >/dev/null 2>&1 || true
  $PSQL -c "DELETE FROM tool_invocations WHERE tool_id='${TOOL_ID}'" >/dev/null 2>&1 || true
  $PSQL -c "DELETE FROM tools   WHERE id='${TOOL_ID}'"   >/dev/null 2>&1 || true
  $PSQL -c "DELETE FROM targets WHERE id='${TARGET_ID}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[approval-probe] seeding test rows…"
# `tools` table real columns: id, name, adapter (CHECK http|python|mcp|forge),
# config jsonb, enabled, + 20260521 migration: risk_level, requires_approval.
# No `params` column here — that one belongs to action_library.
$PSQL <<SQL >/dev/null
INSERT INTO tools(id, name, adapter, risk_level, requires_approval, enabled)
VALUES ('${TOOL_ID}', 'probe tool', 'http', 'low', false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO targets(id, name, host, ip, port, risk_level, requires_approval)
VALUES ('${TARGET_ID}', 'probe target', '127.0.0.1', '127.0.0.1', 9, 'low', true)
ON CONFLICT (id) DO NOTHING;
SQL

echo "[approval-probe] invoking tool with target_id=${TARGET_ID} …"
resp=$(curl -s -w '\n__HTTP__%{http_code}' -X POST "${API}/api/tools/${TOOL_ID}/invoke" \
  "${SESS_HDR[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"target_id\":\"${TARGET_ID}\",\"params\":{}}" || true)
code=$(printf '%s' "$resp" | awk -F'__HTTP__' 'END{print $2}')
body=$(printf '%s' "$resp" | sed -E 's/__HTTP__[0-9]+$//')
echo "  HTTP $code"
echo "  body: $body" | head -c 400; echo

# Approval gate either returns 202 (preferred) or 200 with status=pending,
# OR a server may surface ApprovalRequired as an error envelope. All three
# are accepted as long as tool_approvals has a row.
pending=$($PSQL -c "SELECT count(*) FROM tool_approvals ta
                     JOIN tool_invocations i ON i.id=ta.invocation_id
                    WHERE i.tool_id='${TOOL_ID}' AND ta.decision IS NULL")
echo "[approval-probe] pending approvals for ${TOOL_ID}: ${pending}"

if [ "${pending:-0}" -ge 1 ]; then
  echo "[approval-probe] ✓ Target.requires_approval enforced"
  exit 0
fi

echo "[approval-probe] ✗ No pending tool_approvals row was created."
echo "  → Check local-server/lib/tool-adapters.mjs (~line 187) — target check is there."
echo "  → Verify /api/tools/:id/invoke route actually calls dispatchTool with target_id."
exit 2
