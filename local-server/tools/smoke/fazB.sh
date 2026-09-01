#!/usr/bin/env bash
# Faz B smoke — 9 vendor connector tools (guard rails only).
# Real vendor calls require live hosts + vault secrets; smoke verifies
# missing_secret / missing_host / private_target_blocked / invalid_type / etc.
# Usage: PYTHON=local-server/.venv/bin/python bash local-server/tools/smoke/fazB.sh
set -uo pipefail

PY="${PYTHON:-python3}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
TOOLS="$REPO/tools"

pass=0; fail=0
log(){ printf '%s\n' "$*"; }
ok(){ pass=$((pass+1)); log "  PASS · $1"; }
ko(){ fail=$((fail+1)); log "  FAIL · $1 :: $2"; }

# Strip every vendor secret so missing_secret branch is deterministic
for v in F5_USER F5_PASSWORD CITRIX_ADC_USER CITRIX_ADC_PASSWORD A10_USER A10_PASSWORD \
         PALOALTO_API_KEY CISCO_USER CISCO_PASSWORD FORTIMANAGER_USER FORTIMANAGER_PASSWORD \
         CHECKPOINT_USER CHECKPOINT_PASSWORD INFOBLOX_USER INFOBLOX_PASSWORD \
         BLUECAT_USER BLUECAT_PASSWORD; do unset "$v"; done

run(){ echo "$2" | "$PY" "$TOOLS/$1"; }

assert_reason(){
  # assert_reason <json> <expected_reason>
  local got
  got=$("$PY" -c "import json,sys;
try: o=json.loads(sys.argv[1])
except Exception: print('__parse__'); sys.exit(0)
print(o.get('reason',''))" "$1" 2>/dev/null)
  [[ "$got" == "$2" ]]
}
assert_key_value(){
  # assert_key_value <json> <key> <value>
  local got
  got=$("$PY" -c "import json,sys;
try: o=json.loads(sys.argv[1])
except Exception: print('__parse__'); sys.exit(0)
print(o.get(sys.argv[2],''))" "$1" "$2" 2>/dev/null)
  [[ "$got" == "$3" ]]
}

log "=== Faz B smoke (vendor connectors guard rails) ==="
log "interpreter: $($PY -c 'import sys;print(sys.executable)')"

# ===== Group 1: missing_secret with empty env (no creds set) =====
# NOTE: macOS default bash 3.2 has no associative arrays → use parallel arrays.
TOOLS_LIST=(
  "f5_nitro"
  "citrix_adc_nitro"
  "a10_axapi"
  "paloalto_xmlapi"
  "cisco_iosxe_restconf"
  "fortimanager_jsonrpc"
  "checkpoint_smc_login"
  "infoblox_wapi"
  "bluecat_rest"
)
INPUT_LIST=(
  '{"host":"203.0.113.10","path":"/mgmt/tm/sys/version"}'
  '{"host":"203.0.113.11","path":"/nitro/v1/config/nsversion"}'
  '{"host":"203.0.113.12","path":"/axapi/v3/version/oper"}'
  '{"host":"203.0.113.13","type":"op","cmd":"<show><system><info/></system></show>"}'
  '{"host":"203.0.113.14","path":"/restconf/data/ietf-interfaces:interfaces"}'
  '{"host":"203.0.113.15","method":"get","url":"/sys/status"}'
  '{"host":"203.0.113.16","command":"show-hosts","payload":{"limit":1}}'
  '{"host":"203.0.113.17","path":"/wapi/v2.12/grid"}'
  '{"host":"203.0.113.18","path":"/Services/REST/v1/getSystemInfo"}'
)

for i in "${!TOOLS_LIST[@]}"; do
  tool="${TOOLS_LIST[$i]}"
  payload="${INPUT_LIST[$i]}"
  out=$(run "${tool}.py" "$payload")
  if assert_reason "$out" "missing_secret"; then
    ok "${tool} → missing_secret"
  else
    ko "${tool} missing_secret expected" "$out"
  fi
done

# ===== Group 2: missing_host with creds present =====
export F5_USER=u F5_PASSWORD=p
out=$(run f5_nitro.py '{"path":"/x"}')
assert_reason "$out" "missing_host" && ok "f5_nitro missing_host" || ko "f5_nitro missing_host" "$out"

export PALOALTO_API_KEY=k
out=$(run paloalto_xmlapi.py '{"type":"op","cmd":"x"}')
assert_reason "$out" "missing_host" && ok "paloalto_xmlapi missing_host" || ko "paloalto_xmlapi missing_host" "$out"

export FORTIMANAGER_USER=u FORTIMANAGER_PASSWORD=p
out=$(run fortimanager_jsonrpc.py '{"method":"get","url":"/sys/status"}')
assert_reason "$out" "missing_host" && ok "fortimanager_jsonrpc missing_host" || ko "fm missing_host" "$out"

export CHECKPOINT_USER=u CHECKPOINT_PASSWORD=p
out=$(run checkpoint_smc_login.py '{"command":"show-hosts"}')
assert_reason "$out" "missing_host" && ok "checkpoint_smc_login missing_host" || ko "cp missing_host" "$out"

# ===== Group 3: private_target_blocked =====
out=$(run f5_nitro.py '{"host":"127.0.0.1","path":"/x"}')
assert_reason "$out" "private_target_blocked" && ok "f5_nitro loopback blocked" || ko "f5 loopback" "$out"

out=$(run paloalto_xmlapi.py '{"host":"10.0.0.1","type":"op","cmd":"x"}')
assert_reason "$out" "private_target_blocked" && ok "paloalto_xmlapi private blocked" || ko "pa private" "$out"

out=$(run checkpoint_smc_login.py '{"host":"192.168.1.1","command":"show-hosts"}')
assert_reason "$out" "private_target_blocked" && ok "checkpoint_smc_login private blocked" || ko "cp private" "$out"

# ===== Group 4: vendor-specific input guards =====
out=$(run paloalto_xmlapi.py '{"host":"203.0.113.13","type":"badtype"}')
assert_reason "$out" "invalid_type" && ok "paloalto_xmlapi invalid_type" || ko "pa invalid_type" "$out"

out=$(run fortimanager_jsonrpc.py '{"host":"203.0.113.15","method":"get"}')
assert_reason "$out" "missing_url" && ok "fortimanager_jsonrpc missing_url" || ko "fm missing_url" "$out"

out=$(run checkpoint_smc_login.py '{"host":"203.0.113.16"}')
assert_reason "$out" "missing_command" && ok "checkpoint_smc_login missing_command" || ko "cp missing_command" "$out"

log "==="
log "PASS=$pass  FAIL=$fail"
exit "$fail"
