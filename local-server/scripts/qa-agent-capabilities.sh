#!/usr/bin/env bash
# Tur-3.11 #7 — Smoke test the agent Resolved Capabilities endpoint.
#   Picks the first agent with both a skill binding and a tool binding,
#   calls GET /api/agents/:id/resolved-capabilities, and verifies the
#   returned union is non-empty.

set -u
PSQL="psql -d elara_db -tA"
API="${API:-http://127.0.0.1:3005}"

# Session-gated endpoint — interactive login (or ELARA_USER/ELARA_PASS env).
ELARA_USER="${ELARA_USER:-}"
ELARA_PASS="${ELARA_PASS:-}"
ELARA_PROVIDER="${ELARA_PROVIDER:-local}"
if [ -z "$ELARA_USER" ]; then
  printf "[qa-caps] username: " >&2; read -r ELARA_USER </dev/tty
fi
if [ -z "$ELARA_PASS" ]; then
  printf "[qa-caps] password: " >&2
  stty -echo 2>/dev/null; read -r ELARA_PASS </dev/tty; stty echo 2>/dev/null
  printf '\n' >&2
fi
login_resp=$(curl -s -X POST "${API}/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(printf '{"username":"%s","password":"%s","provider":"%s","device":"probe-cli"}' \
        "$ELARA_USER" "$ELARA_PASS" "$ELARA_PROVIDER")")
SID=$(printf '%s' "$login_resp" \
  | sed -nE 's/.*"sessionId"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')
if [ -z "$SID" ]; then
  echo "[qa-caps] ✗ login failed: $login_resp" >&2
  exit 3
fi
SESS_HDR=(-H "x-session-id: ${SID}")
echo "[qa-caps] logged in as ${ELARA_USER}"

AGENT_ID=$($PSQL -c "
  SELECT a.id FROM agents a
  WHERE EXISTS (SELECT 1 FROM agent_capabilities c WHERE c.agent_id=a.id AND c.kind='skill')
    AND EXISTS (SELECT 1 FROM agent_capabilities c WHERE c.agent_id=a.id AND c.kind='tool')
  LIMIT 1
" 2>/dev/null | head -n1)

PARTIAL=0
if [ -z "$AGENT_ID" ]; then
  AGENT_ID=$($PSQL -c "
    SELECT a.id FROM agents a
    WHERE EXISTS (SELECT 1 FROM agent_capabilities c WHERE c.agent_id=a.id)
    LIMIT 1
  " 2>/dev/null | head -n1)
  if [ -n "$AGENT_ID" ]; then
    PARTIAL=1
    echo "[qa-caps] no fully-bound (skill+tool) agent; using partially-bound ${AGENT_ID}"
  fi
fi

if [ -z "$AGENT_ID" ]; then
  AGENT_ID=$($PSQL -c "SELECT id FROM agents LIMIT 1" 2>/dev/null | head -n1)
  if [ -z "$AGENT_ID" ]; then
    echo "[qa-caps] SKIP: no agents in DB"
    exit 0
  fi
  PARTIAL=2
  echo "[qa-caps] WARN: no agent has any capability sealed; falling back to ${AGENT_ID}"
  echo "[qa-caps]       → Agents ekranından bu agent'a skill/tool bağla, sonra tekrar koş."
fi

CAP_SKILLS=$($PSQL -c "SELECT count(*) FROM agent_capabilities WHERE agent_id='${AGENT_ID}' AND kind='skill'" 2>/dev/null | head -n1)
CAP_TOOLS=$($PSQL  -c "SELECT count(*) FROM agent_capabilities WHERE agent_id='${AGENT_ID}' AND kind='tool'"  2>/dev/null | head -n1)
echo "[qa-caps] selected agent: ${AGENT_ID} (capabilities: skills=${CAP_SKILLS:-0} tools=${CAP_TOOLS:-0})"

echo "[qa-caps] GET /api/agents/${AGENT_ID}/resolved-capabilities"
resp=$(curl -s -w '\n__HTTP__%{http_code}' \
  "${SESS_HDR[@]}" \
  "${API}/api/agents/${AGENT_ID}/resolved-capabilities")
code=$(printf '%s' "$resp" | awk -F'__HTTP__' 'END{print $2}')
body=$(printf '%s' "$resp" | sed -E 's/__HTTP__[0-9]+$//')
echo "  HTTP $code"

if [ "$code" != "200" ]; then
  echo "  body: $body" | head -c 600; echo
  exit 2
fi

# Light schema check
for k in skills tools effective_adapters effective_targets; do
  if ! echo "$body" | grep -q "\"${k}\""; then
    echo "[qa-caps] ✗ missing key: ${k}"
    echo "  body: $body" | head -c 600; echo
    exit 2
  fi
done

# Hard content check: tools[] or skills[] must be non-empty when capabilities exist.
has_content=0
echo "$body" | grep -Eq '"tools"[[:space:]]*:[[:space:]]*\[[[:space:]]*\{'  && has_content=1
echo "$body" | grep -Eq '"skills"[[:space:]]*:[[:space:]]*\[[[:space:]]*\{' && has_content=1

if [ "$PARTIAL" = "2" ]; then
  echo "[qa-caps] ⚠ shape OK but no capabilities sealed for this agent — not a green pass."
  echo "  $(echo "$body" | head -c 400)…"
  exit 0
fi

if [ "$has_content" != "1" ]; then
  echo "[qa-caps] ✗ resolved-capabilities returned empty tools[]/skills[] despite DB having ${CAP_SKILLS:-0} skills + ${CAP_TOOLS:-0} tools."
  echo "  body: $body" | head -c 600; echo
  exit 2
fi

echo "[qa-caps] ✓ resolved-capabilities non-empty OK"
echo "  $(echo "$body" | head -c 400)…"
exit 0
