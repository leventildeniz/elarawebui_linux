#!/usr/bin/env python3
# @tool: infoblox_wapi
# @description: Infoblox WAPI istemcisi (Basic auth, JSON).
# @args: {"host":"string","path":"string","method":"string","payload":"object","verify_tls":"boolean","timeout_ms":"number"}
# @category: NetSec
# @icon: Globe
# @color: #0d9488
"""infoblox_wapi — Infoblox WAPI proxy.

Env (vault): INFOBLOX_USER, INFOBLOX_PASSWORD

stdin JSON: {host, path:"/wapi/v2.12/record:host", method, payload?, verify_tls?, timeout_ms?, port?}
"""
import base64, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from _vendor_common import (
    read_stdin, emit, need_env, host_allowed, http_request,
    parse_common, build_url, encode_body,
)


def main():
    p = read_stdin()
    miss = need_env(["INFOBLOX_USER", "INFOBLOX_PASSWORD"])
    if miss: emit(miss); return
    c = parse_common(p)
    if not c["host"]: emit({"ok": False, "reason": "missing_host"}); return
    if not host_allowed(c["host"]): emit({"ok": False, "reason": "private_target_blocked"}); return

    auth = base64.b64encode(f"{os.environ['INFOBLOX_USER']}:{os.environ['INFOBLOX_PASSWORD']}".encode()).decode()
    body, _ = encode_body(c["payload"])
    headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}
    if body: headers["Content-Type"] = "application/json"
    url = build_url(c["host"], c["port"] or 443, c["path"])
    r = http_request(url, c["method"], headers, body, c["timeout_ms"]/1000.0, c["verify_tls"])
    emit(r)


if __name__ == "__main__":
    main()
