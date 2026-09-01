#!/usr/bin/env python3
# @tool: cisco_iosxe_restconf
# @description: Cisco IOS-XE RESTCONF istemcisi (Basic auth, yang-data+json).
# @args: {"host":"string","path":"string","method":"string","payload":"object","verify_tls":"boolean","timeout_ms":"number"}
# @category: NetSec
# @icon: Router
# @color: #1e40af
"""cisco_iosxe_restconf — RESTCONF proxy.

Env (vault): CISCO_USER, CISCO_PASSWORD

stdin JSON: {host, path:"/restconf/data/...", method, payload?, verify_tls?, timeout_ms?, port?}
"""
import base64, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from _vendor_common import (
    read_stdin, emit, need_env, host_allowed, http_request,
    parse_common, build_url, encode_body,
)


def main():
    p = read_stdin()
    miss = need_env(["CISCO_USER", "CISCO_PASSWORD"])
    if miss: emit(miss); return
    c = parse_common(p)
    if not c["host"]: emit({"ok": False, "reason": "missing_host"}); return
    if not host_allowed(c["host"]): emit({"ok": False, "reason": "private_target_blocked"}); return

    auth = base64.b64encode(f"{os.environ['CISCO_USER']}:{os.environ['CISCO_PASSWORD']}".encode()).decode()
    body, _ = encode_body(c["payload"])
    headers = {
        "Authorization": f"Basic {auth}",
        "Accept": "application/yang-data+json",
    }
    if body: headers["Content-Type"] = "application/yang-data+json"
    url = build_url(c["host"], c["port"] or 443, c["path"])
    r = http_request(url, c["method"], headers, body, c["timeout_ms"]/1000.0, c["verify_tls"])
    emit(r)


if __name__ == "__main__":
    main()
