#!/usr/bin/env python3
# @tool: paloalto_xmlapi
# @description: Palo Alto PAN-OS XML API istemcisi (api-key auth, type=op/config/keygen).
# @args: {"host":"string","type":"string","cmd":"string","xpath":"string","element":"string","verify_tls":"boolean","timeout_ms":"number"}
# @category: NetSec
# @icon: ShieldAlert
# @color: #ea580c
"""paloalto_xmlapi — PAN-OS XML API proxy.

Env (vault): PALOALTO_API_KEY

stdin JSON:
  {host, type:"op"|"config"|"keygen", cmd?, xpath?, element?, action?, verify_tls?, timeout_ms?, port?}

Returns parsed XML body verbatim under .body (string).
"""
import os, sys, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from _vendor_common import (
    read_stdin, emit, need_env, host_allowed, http_request,
    parse_common, build_url,
)


def main():
    p = read_stdin()
    miss = need_env(["PALOALTO_API_KEY"])
    if miss: emit(miss); return
    c = parse_common(p)
    api_type = (p.get("type") or "op").lower()
    if api_type not in {"op", "config", "keygen", "report", "export", "log"}:
        emit({"ok": False, "reason": "invalid_type"}); return
    if not c["host"]: emit({"ok": False, "reason": "missing_host"}); return
    if not host_allowed(c["host"]): emit({"ok": False, "reason": "private_target_blocked"}); return


    q = {"type": api_type, "key": os.environ["PALOALTO_API_KEY"]}
    for k in ("cmd", "xpath", "element", "action"):
        v = p.get(k)
        if v is not None: q[k] = str(v)
    qs = urllib.parse.urlencode(q, safe="<>=/")
    url = build_url(c["host"], c["port"] or 443, f"/api/?{qs}")
    r = http_request(url, c["method"] if c["method"] != "GET" else "GET",
                     {"Accept": "application/xml"}, None,
                     c["timeout_ms"]/1000.0, c["verify_tls"])
    emit(r)


if __name__ == "__main__":
    main()
