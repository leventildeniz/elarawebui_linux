#!/usr/bin/env python3
# @tool: f5_nitro
# @description: F5 BIG-IP iControl REST istemcisi (Basic auth, JSON).
# @args: {"host":"string","path":"string","method":"string","payload":"object","verify_tls":"boolean","timeout_ms":"number"}
# @category: NetSec
# @icon: ShieldCheck
# @color: #dc2626
"""f5_nitro — F5 BIG-IP iControl REST proxy.

Env (vault):
  F5_USER, F5_PASSWORD

stdin JSON:
  {host, path:"/mgmt/tm/...", method:"GET"|"POST"|"PATCH"|"PUT"|"DELETE",
   payload?, verify_tls?:bool=true, timeout_ms?:int=20000, port?:int=443}
"""
import base64
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from _vendor_common import (
    read_stdin, emit, need_env, host_allowed, http_request,
    parse_common, build_url, encode_body,
)


def main():
    p = read_stdin()
    miss = need_env(["F5_USER", "F5_PASSWORD"])
    if miss:
        emit(miss); return

    c = parse_common(p)
    if not c["host"]:
        emit({"ok": False, "reason": "missing_host"}); return
    if not host_allowed(c["host"]):
        emit({"ok": False, "reason": "private_target_blocked"}); return

    user = os.environ["F5_USER"]; pwd = os.environ["F5_PASSWORD"]
    auth = base64.b64encode(f"{user}:{pwd}".encode()).decode()
    body, ct = encode_body(c["payload"])
    headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}
    if body and ct: headers["Content-Type"] = ct

    url = build_url(c["host"], c["port"] or 443, c["path"])
    r = http_request(url, c["method"], headers, body, c["timeout_ms"]/1000.0, c["verify_tls"])
    emit(r)


if __name__ == "__main__":
    main()
