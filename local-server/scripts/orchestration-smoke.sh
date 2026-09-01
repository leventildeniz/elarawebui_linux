#!/usr/bin/env bash
# ELARA Orchestration / Workflow / Tools smoke
# Read-only probe — destructive olmaz. Auth: $ELARA_USER / $ELARA_PASS env.
# Çıkış: 0 = tüm probe'lar PASS, 1 = en az bir FAIL.
set -uo pipefail

BASE="${ELARA_BASE:-http://127.0.0.1:3005}"
USER_="${ELARA_USER:-admin}"
PASS_="${ELARA_PASS:-}"
PASS=0; FAIL=0

if [[ -z "$PASS_" ]]; then
  echo "[!] ELARA_PASS env yok — login atılamaz, sadece public endpoint'ler test edilir." >&2
fi

COOKIE=$(mktemp)
SID=""
ROLE=""
IS_ADMIN=0
trap 'rm -f "$COOKIE"' EXIT

if [[ -n "$PASS_" ]]; then
  LOGIN_BODY=$(curl -fsS -c "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER_\",\"password\":\"$PASS_\"}" \
    "$BASE/api/auth/login" 2>/dev/null) \
    || { echo "[x] login FAIL"; exit 2; }
  SID=$(echo "$LOGIN_BODY" | jq -r '.sessionId // empty')
  ROLE=$(echo "$LOGIN_BODY" | jq -r '.user.role // empty' | tr '[:upper:]' '[:lower:]')
  [[ "$ROLE" == "admin" ]] && IS_ADMIN=1
  if [[ -z "$SID" ]]; then
    echo "[x] login OK ama sessionId yok — gated endpoint'ler skip edilir"
  else
    echo "[+] login ok (sid=${SID:0:8}… role=$ROLE)"
  fi
fi

probe() {
  local name="$1" method="$2" path="$3" jq_check="${4:-.}"
  local body code hdr=()
  [[ -n "$SID" ]] && hdr=(-H "X-Session-Id: $SID")
  body=$(curl -fsS -b "$COOKIE" "${hdr[@]}" -X "$method" "$BASE$path" 2>/dev/null) ; code=$?
  if [[ $code -ne 0 ]]; then
    local tmp=/tmp/smoke_body.$$
    local diag
    diag=$(curl -sS -o "$tmp" -w 'http=%{http_code}' -b "$COOKIE" "${hdr[@]}" -X "$method" "$BASE$path" 2>/dev/null)
    local snippet
    snippet=$(head -c 160 "$tmp" 2>/dev/null); rm -f "$tmp"
    echo "[x] $name  FAIL (curl exit $code, $diag)  $method $path  body=$snippet"
    FAIL=$((FAIL+1)); return
  fi
  if ! echo "$body" | jq -e "$jq_check" >/dev/null 2>&1; then
    echo "[x] $name  FAIL (jq check '$jq_check')  body=$(echo "$body" | head -c 200)"
    FAIL=$((FAIL+1)); return
  fi
  echo "[+] $name  PASS"
  PASS=$((PASS+1))
}

echo "=== Health ==="
WORKER_BODY=$(curl -fsS http://127.0.0.1:8082/health 2>/dev/null || true)
if echo "$WORKER_BODY" | jq -e '.ok==true' >/dev/null 2>&1; then
  echo "[+] worker-footprint $(echo "$WORKER_BODY" | jq -c '{rss_gb,mps_gb,footprint_gb,max_rss_gb,req_count}')"
  PASS=$((PASS+1))
else
  echo "[x] worker-health FAIL"
  FAIL=$((FAIL+1))
fi

# jq guard pattern: önce type kontrolü; raw array'de `.ok` okumak
# "Cannot index array with string" hatası verir.
ARR_OR_OK='(type=="array") or (type=="object" and (.ok==true))'

echo "=== Agents ==="
probe "agents-list"          GET  "/api/agents"              "$ARR_OR_OK or (type==\"object\" and (.agents|type==\"array\"))"
probe "agents-discover"      GET  "/api/agents/discover"     "$ARR_OR_OK or (type==\"object\" and ((.agents|type==\"array\") or (.scripts|type==\"array\") or (.roots|type==\"array\")))"
probe "agents-interpreters"  GET  "/api/agents/interpreters" "$ARR_OR_OK or (type==\"object\" and (.interpreters|type==\"array\"))"
probe "agents-browse"        GET  "/api/agents/browse"       "$ARR_OR_OK or (type==\"object\" and ((.entries|type==\"array\") or (.items|type==\"array\")))"

echo "=== Tools / Forge ==="
probe "capabilities-list"    GET  "/api/capabilities"        "$ARR_OR_OK or (type==\"object\" and (.capabilities|type==\"array\"))"
probe "forge-actions"        GET  "/api/forge/actions"       "$ARR_OR_OK or (type==\"object\" and (.actions|type==\"array\"))"
if [[ -n "$SID" ]]; then
  probe "tool-invocations"   GET  "/api/tool-invocations"    "$ARR_OR_OK or (type==\"object\" and (.invocations|type==\"array\"))"
  if [[ "$IS_ADMIN" == "1" ]]; then
    probe "tool-approvals"   GET  "/api/tool-approvals/pending" "$ARR_OR_OK or (type==\"object\" and (.pending|type==\"array\"))"
  else
    echo "[~] tool-approvals  SKIP (admin role gerekli, role=$ROLE)"
  fi
else
  echo "[~] tool-invocations  SKIP (login yok)"
  echo "[~] tool-approvals    SKIP (login yok)"
fi

echo "=== Skills ==="
probe "skills-list"          GET  "/api/skills"              "$ARR_OR_OK or (type==\"object\" and (.skills|type==\"array\"))"
probe "skills-runs"          GET  "/api/skills/runs"         "$ARR_OR_OK or (type==\"object\" and (.runs|type==\"array\"))"

echo "=== Workflows ==="
probe "workflows-list"       GET  "/api/workflows"           "$ARR_OR_OK or (type==\"object\" and (.workflows|type==\"array\"))"
# Dinamik detay probe'u: ilk workflow id'sini çek, varsa /api/workflows/:id
WF_HDR=()
[[ -n "$SID" ]] && WF_HDR=(-H "X-Session-Id: $SID")
WF_ID=$(curl -fsS -b "$COOKIE" "${WF_HDR[@]}" "$BASE/api/workflows" 2>/dev/null \
  | jq -r 'if type=="array" then .[0].id elif .workflows then .workflows[0].id else empty end' 2>/dev/null)
if [[ -n "$WF_ID" && "$WF_ID" != "null" ]]; then
  probe "workflow-detail"    GET  "/api/workflows/$WF_ID"    '(type=="object") and ((.ok==true) or (.id|type=="string"))'
fi

echo "=== Orchestration (probe-only, no chat) ==="
probe "orchestrate-probe"    GET  "/api/chat/orchestrate"    '(.ok==true)'

echo "=== RAG ==="
probe "rag-health"           GET  "/api/rag/health"          '(.ok==true) or (.chunks!=null)'
probe "rag-settings"         GET  "/api/rag/settings"        '(.ok==true)'

echo "=== Capability Converter (round-trip) ==="
# Browse — read-only; çoklu path picker'ın temeli.
probe "converter-browse"     GET  "/api/agents/browse"       "$ARR_OR_OK or (type==\"object\" and (.dirs|type==\"array\"))"

if [[ -n "$SID" ]]; then
  rt_hdr=(-H "Content-Type: application/json" -H "X-Session-Id: $SID")
  TS=$(date +%s)

  # --- Skill round-trip -----------------------------------------------------
  SK_SLUG="smk-conv-${TS}"
  SK_ID="skill.${SK_SLUG}"
  SK_BODY=$(curl -fsS -b "$COOKIE" "${rt_hdr[@]}" -X POST "$BASE/api/skills" \
    -d "{\"slug\":\"$SK_SLUG\",\"name\":\"smoke conv\",\"description\":\"smoke\",\"instructions\":\"x\",\"risk_level\":\"read\",\"requires_approval\":false,\"script_kind\":\"js\",\"script_body\":\"return {ok:true};\",\"param_schema\":{\"type\":\"object\",\"properties\":{}}}" 2>/dev/null)
  if echo "$SK_BODY" | jq -e '.ok==true' >/dev/null 2>&1; then
    echo "[+] converter-skill-create  PASS"; PASS=$((PASS+1))
  else
    echo "[x] converter-skill-create  FAIL body=$(echo "$SK_BODY" | head -c 200)"; FAIL=$((FAIL+1))
  fi
  curl -fsS -b "$COOKIE" "${rt_hdr[@]}" -X DELETE "$BASE/api/skills/$SK_ID" >/dev/null 2>&1 \
    && echo "[+] converter-skill-delete  PASS" && PASS=$((PASS+1)) \
    || { echo "[x] converter-skill-delete  FAIL"; FAIL=$((FAIL+1)); }

  # --- Tool (Forge action) round-trip --------------------------------------
  TL_ID="tool_smk_${TS}"
  TL_BODY=$(curl -fsS -b "$COOKIE" "${rt_hdr[@]}" -X POST "$BASE/api/forge/actions" \
    -d "{\"id\":\"$TL_ID\",\"kind\":\"action\",\"name\":\"smoke tool\",\"category\":\"imported\",\"provider\":\"import\",\"icon\":\"Wrench\",\"color\":\"#06b6d4\",\"description\":\"smoke\",\"params\":[],\"outputs\":[{\"key\":\"result\"}],\"runtime\":{\"handler\":\"noop\"}}" 2>/dev/null)
  if echo "$TL_BODY" | jq -e '.ok==true' >/dev/null 2>&1; then
    echo "[+] converter-tool-create   PASS"; PASS=$((PASS+1))
  else
    echo "[x] converter-tool-create   FAIL body=$(echo "$TL_BODY" | head -c 200)"; FAIL=$((FAIL+1))
  fi
  curl -fsS -b "$COOKIE" "${rt_hdr[@]}" -X DELETE "$BASE/api/forge/actions/$TL_ID" >/dev/null 2>&1 \
    && echo "[+] converter-tool-delete   PASS" && PASS=$((PASS+1)) \
    || { echo "[x] converter-tool-delete   FAIL"; FAIL=$((FAIL+1)); }

  # --- Agent round-trip ----------------------------------------------------
  AG_ID="ag_smk_${TS}"
  AG_BODY=$(curl -fsS -b "$COOKIE" "${rt_hdr[@]}" -X POST "$BASE/api/agents" \
    -d "{\"id\":\"$AG_ID\",\"name\":\"smoke agent\",\"agent_path\":\"/tmp/agent.py\",\"interpreter_path\":\"/usr/bin/python3\",\"status\":\"idle\",\"meta\":{\"importedBy\":\"capability-converter\"}}" 2>/dev/null)
  if echo "$AG_BODY" | jq -e '.ok==true' >/dev/null 2>&1; then
    echo "[+] converter-agent-create  PASS"; PASS=$((PASS+1))
  else
    echo "[x] converter-agent-create  FAIL body=$(echo "$AG_BODY" | head -c 200)"; FAIL=$((FAIL+1))
  fi
  curl -fsS -b "$COOKIE" "${rt_hdr[@]}" -X DELETE "$BASE/api/agents/$AG_ID" >/dev/null 2>&1 \
    && echo "[+] converter-agent-delete  PASS" && PASS=$((PASS+1)) \
    || { echo "[x] converter-agent-delete  FAIL"; FAIL=$((FAIL+1)); }
else
  echo "[~] converter round-trip  SKIP (login yok)"
fi

echo "=== System Object Override (admin only) ==="
if [[ -n "$SID" && "$IS_ADMIN" == "1" ]]; then
  ovh=(-H "Content-Type: application/json" -H "X-Session-Id: $SID")

  # system-action-edit: pick a system action, edit description, verify, revert.
  SYS_ACT=$(curl -fsS -b "$COOKIE" "${ovh[@]}" "$BASE/api/forge/actions" 2>/dev/null \
    | jq -r 'map(select(.is_system==true))[0] // empty')
  if [[ -n "$SYS_ACT" ]]; then
    SYS_ID=$(echo "$SYS_ACT" | jq -r '.id')
    ORIG_DESC=$(echo "$SYS_ACT" | jq -r '.description // ""')
    NEW_DESC="${ORIG_DESC} [smoke-edit-${TS:-$(date +%s)}]"
    EDIT_BODY=$(echo "$SYS_ACT" | jq --arg d "$NEW_DESC" '. + {description:$d}')
    # No -f: capture status + body for diagnostics
    POST_OUT=$(curl -sS -b "$COOKIE" "${ovh[@]}" -X POST "$BASE/api/forge/actions" \
      -d "$EDIT_BODY" -w $'\n%{http_code}' 2>&1)
    POST_CODE=$(echo "$POST_OUT" | tail -n1)
    POST_BODY=$(echo "$POST_OUT" | sed '$d' | head -c 200)
    GET_OUT=$(curl -sS -b "$COOKIE" "${ovh[@]}" "$BASE/api/forge/actions/$SYS_ID" -w $'\n%{http_code}' 2>&1)
    GET_CODE=$(echo "$GET_OUT" | tail -n1)
    GET_BODY=$(echo "$GET_OUT" | sed '$d')
    GOT=$(echo "$GET_BODY" | jq -r '.description // ""' 2>/dev/null)
    GOT_SYS=$(echo "$GET_BODY" | jq -r '.is_system // false' 2>/dev/null)
    GOT_UPD=$(echo "$GET_BODY" | jq -r '.updated_at // ""' 2>/dev/null)
    # Cross-check via list endpoint (bypasses :id routing)
    LIST_DESC=$(curl -fsS -b "$COOKIE" "${ovh[@]}" "$BASE/api/forge/actions" 2>/dev/null \
      | jq -r --arg id "$SYS_ID" 'map(select(.id==$id))[0].description // ""')
    if [[ "$GOT" == "$NEW_DESC" ]]; then
      echo "[+] system-action-edit  PASS"; PASS=$((PASS+1))
    else
      echo "[x] system-action-edit  FAIL id='$SYS_ID' post=$POST_CODE get=$GET_CODE is_system=$GOT_SYS upd=$GOT_UPD"
      echo "    single_desc='$(echo "$GOT" | head -c 80)'"
      echo "    list_desc  ='$(echo "$LIST_DESC" | head -c 80)'"
      echo "    expected   ='$(echo "$NEW_DESC" | head -c 80)'"
      echo "    get_body   ='$(echo "$GET_BODY" | head -c 200)'"
      FAIL=$((FAIL+1))
    fi

    # Revert
    REVERT_BODY=$(echo "$SYS_ACT" | jq --arg d "$ORIG_DESC" '. + {description:$d}')
    curl -fsS -b "$COOKIE" "${ovh[@]}" -X POST "$BASE/api/forge/actions" -d "$REVERT_BODY" >/dev/null 2>&1
  else
    echo "[~] system-action-edit  SKIP (no system action found)"
  fi

  # system-skill-edit: pick a system skill, edit description, verify, revert.
  SYS_SK=$(curl -fsS -b "$COOKIE" "${ovh[@]}" "$BASE/api/skills" 2>/dev/null \
    | jq -r 'if type=="array" then . else .skills end | map(select(.is_system==true))[0] // empty')
  if [[ -n "$SYS_SK" ]]; then
    SK_ID=$(echo "$SYS_SK" | jq -r '.id')
    ORIG_SDESC=$(echo "$SYS_SK" | jq -r '.description // ""')
    NEW_SDESC="${ORIG_SDESC} [smoke-edit-${TS:-$(date +%s)}]"
    EDIT_SK=$(echo "$SYS_SK" | jq --arg d "$NEW_SDESC" '. + {description:$d}')
    curl -fsS -b "$COOKIE" "${ovh[@]}" -X POST "$BASE/api/skills" -d "$EDIT_SK" >/dev/null 2>&1
    GOT2=$(curl -fsS -b "$COOKIE" "${ovh[@]}" "$BASE/api/skills" 2>/dev/null \
      | jq -r --arg id "$SK_ID" 'if type=="array" then . else .skills end | map(select(.id==$id))[0].description // ""')
    if [[ "$GOT2" == "$NEW_SDESC" ]]; then
      echo "[+] system-skill-edit   PASS"; PASS=$((PASS+1))
    else
      echo "[x] system-skill-edit   FAIL got='$(echo "$GOT2" | head -c 80)'"; FAIL=$((FAIL+1))
    fi
    REVERT_SK=$(echo "$SYS_SK" | jq --arg d "$ORIG_SDESC" '. + {description:$d}')
    curl -fsS -b "$COOKIE" "${ovh[@]}" -X POST "$BASE/api/skills" -d "$REVERT_SK" >/dev/null 2>&1
  else
    echo "[~] system-skill-edit   SKIP (no system skill found)"
  fi
else
  echo "[~] system-action-edit  SKIP (admin gerekli)"
  echo "[~] system-skill-edit   SKIP (admin gerekli)"
fi



echo
echo "=== Sonuç ==="
echo "PASS=$PASS  FAIL=$FAIL"

if [ "$FAIL" -gt 0 ] && [ -f local-server/scripts/worker-postmortem.mjs ]; then
  echo
  echo "=== Worker postmortem (son 5 ölüm) ==="
  node local-server/scripts/worker-postmortem.mjs --last 5 2>/dev/null | head -30 || true
fi

[[ $FAIL -eq 0 ]]
