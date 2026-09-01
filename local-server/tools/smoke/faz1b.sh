#!/usr/bin/env bash
# Faz 1B smoke — NetSec 5 tools direct stdin/stdout.
# Usage: PYTHON=local-server/.venv/bin/python bash local-server/tools/smoke/faz1b.sh
set -uo pipefail

PY="${PYTHON:-python3}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
TOOLS="$REPO/tools"
WORKDIR="$TOOLS/_workdir"
mkdir -p "$WORKDIR"

pass=0
fail=0
log() { printf '%s\n' "$*"; }
ok()  { pass=$((pass+1)); log "  PASS · $1"; }
ko()  { fail=$((fail+1)); log "  FAIL · $1 :: $2"; }

run() { echo "$2" | "$PY" "$TOOLS/$1"; }

# Robust JSON key reader: assert_key <json> <dotted-path> <expected>
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

log "=== Faz 1B smoke (NetSec) ==="
log "interpreter: $($PY -c 'import sys;print(sys.executable)')"

# ---------- 1) dns_lookup happy ----------
log "[1] dns_lookup example.com A"
out=$(run dns_lookup.py '{"name":"example.com","types":["A"],"timeout_ms":8000}')
if assert_key "$out" "ok" "True"; then
  alen=$(printf '%s' "$out" | "$PY" -c "import json,sys;o=json.load(sys.stdin);print(len((o.get('records') or {}).get('A') or []))")
  [[ "$alen" -ge 1 ]] && ok "dns_lookup A record(s)=$alen" || ko "dns_lookup no A records" "$out"
elif printf '%s' "$out" | grep -q '"missing_dependency"'; then
  ok "dns_lookup → missing_dependency (dnspython not installed; accepted)"
else
  ko "dns_lookup A query" "$out"
fi

# ---------- 2) dns_lookup resolver guard ----------
out=$(run dns_lookup.py '{"name":"example.com","resolver":"10.0.0.1"}')
assert_key "$out" "reason" "resolver_not_allowed" && ok "dns_lookup resolver guard" \
  || ko "dns_lookup resolver guard" "$out"

# ---------- 3) http_probe happy ----------
log "[3] http_probe https://example.com"
out=$(run http_probe.py '{"url":"https://example.com","method":"HEAD","timeout_ms":15000}')
if assert_key "$out" "ok" "True"; then
  st=$(json_get "$out" "status")
  if [[ "$st" -ge 200 && "$st" -lt 400 ]]; then
    issuer=$(json_get "$out" "tls.issuer")
    [[ -n "$issuer" ]] && ok "http_probe status=$st tls.issuer=${issuer:0:40}…" \
      || ko "http_probe no tls.issuer" "$out"
  else
    ko "http_probe unexpected status=$st" "$out"
  fi
else
  ko "http_probe happy" "$out"
fi

# ---------- 4) http_probe scheme guard ----------
out=$(run http_probe.py '{"url":"file:///etc/passwd"}')
assert_key "$out" "reason" "scheme_not_allowed" && ok "http_probe scheme guard" \
  || ko "http_probe scheme guard" "$out"

# ---------- 5) cve_lookup happy (Log4Shell) ----------
log "[5] cve_lookup CVE-2021-44228"
out=$(run cve_lookup.py '{"cve_id":"CVE-2021-44228"}')
if assert_key "$out" "ok" "True"; then
  cvss=$(json_get "$out" "items.0.cvss")
  if [[ -n "$cvss" ]]; then
    is_high=$("$PY" -c "import sys; v=float(sys.argv[1] or 0); print(1 if v >= 9 else 0)" "$cvss" 2>/dev/null)
    [[ "$is_high" == "1" ]] && ok "cve_lookup CVSS=$cvss (critical)" \
      || ko "cve_lookup CVSS too low" "cvss=$cvss"
  else
    # CIRCL sometimes omits cvss; accept if id matches
    cid=$(json_get "$out" "items.0.id")
    [[ "$cid" == "CVE-2021-44228" ]] && ok "cve_lookup id matched (cvss missing — acceptable)" \
      || ko "cve_lookup id mismatch" "$out"
  fi
else
  ko "cve_lookup happy" "$out"
fi

# ---------- 6) cve_lookup keyword too short ----------
out=$(run cve_lookup.py '{"keyword":"a"}')
assert_key "$out" "reason" "keyword_too_short" && ok "cve_lookup keyword guard" \
  || ko "cve_lookup keyword guard" "$out"

# ---------- 7) whois_geo happy (8.8.8.8) ----------
log "[7] whois_geo 8.8.8.8"
out=$(run whois_geo.py '{"target":"8.8.8.8","timeout_ms":12000}')
if assert_key "$out" "ok" "True"; then
  cc=$(json_get "$out" "geo.country_code")
  org=$(json_get "$out" "asn.org")
  if [[ "$cc" == "US" ]]; then
    ok "whois_geo geo.country_code=US asn.org=${org:0:40}…"
  else
    ko "whois_geo country_code unexpected=$cc" "$out"
  fi
else
  ko "whois_geo 8.8.8.8" "$out"
fi

# ---------- 8) whois_geo private blocked ----------
out=$(run whois_geo.py '{"target":"127.0.0.1"}')
assert_key "$out" "reason" "private_target_blocked" && ok "whois_geo loopback blocked" \
  || ko "whois_geo loopback guard" "$out"

# ---------- 9) pcap_summary path guard ----------
log "[9] pcap_summary path guard"
out=$(run pcap_summary.py '{"path":"/etc/passwd"}')
assert_key "$out" "reason" "path_not_allowed" && ok "pcap_summary /etc guard" \
  || ko "pcap_summary path guard" "$out"

# ---------- 10) pcap_summary happy (synthetic 5-packet pcap) ----------
log "[10] pcap_summary synthetic 5 packets"
sample="$WORKDIR/_faz1b_sample.pcap"
rm -f "$sample"
"$PY" - <<PYEOF 2>/dev/null
try:
    from scapy.all import wrpcap, Ether, IP, TCP
    pkts = [Ether()/IP(src=f"10.0.0.{i}", dst="10.0.0.99")/TCP(sport=1000+i, dport=80) for i in range(1, 6)]
    wrpcap("$sample", pkts)
    print("WROTE")
except ImportError:
    print("NO_SCAPY")
PYEOF
gen_status=$?
if [[ -f "$sample" ]]; then
  out=$(run pcap_summary.py "$(printf '{"path":"%s"}' "$sample")")
  if assert_key "$out" "ok" "True"; then
    n=$(json_get "$out" "packet_count")
    [[ "$n" == "5" ]] && ok "pcap_summary packet_count=5" \
      || ko "pcap_summary count mismatch" "got=$n"
  else
    ko "pcap_summary happy" "$out"
  fi
  rm -f "$sample"
else
  # scapy not installed → test missing_dependency branch with any existing pcap-like in workdir
  echo "fake" > "$WORKDIR/_faz1b_fake.pcap"
  out=$(run pcap_summary.py "$(printf '{"path":"%s"}' "$WORKDIR/_faz1b_fake.pcap")")
  if printf '%s' "$out" | grep -q '"missing_dependency"'; then
    ok "pcap_summary → missing_dependency (scapy not installed; accepted)"
  elif printf '%s' "$out" | grep -q '"pcap_parse_failed"'; then
    ok "pcap_summary → pcap_parse_failed (scapy present, fake bytes; accepted)"
  else
    ko "pcap_summary unexpected" "$out"
  fi
  rm -f "$WORKDIR/_faz1b_fake.pcap"
fi

log "==="
log "PASS=$pass  FAIL=$fail"
exit "$fail"
