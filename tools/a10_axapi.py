#!/usr/bin/env python3
# @tool: a10_axapi
# @description: A10 Thunder/AX aXAPI v3 istemcisi (login → token → çağrı akışı).
# @args: {"host":"string","path":"string","method":"string","payload":"object","verify_tls":"boolean","timeout_ms":"number"}
# @category: NetSec
# @icon: Server
# @color: #b91c1c
"""a10_axapi — A10 aXAPI v3 (login → token → call).

Env (vault): A10_USER, A10_PASSWORD

stdin JSON: {host, path:"/axapi/v3/...", method, payload?, verify_tls?, timeout_ms?, port?}
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from _vendor_common import (
    read_stdin, emit, need_env, host_allowed, http_request,
    parse_common, build_url, encode_body,
)


def main():
    p = read_stdin()
    miss = need_env(["A10_USER", "A10_PASSWORD"])
    if miss: emit(miss); return
    c = parse_common(p)
    if not c["host"]: emit({"ok": False, "reason": "missing_host"}); return
    if not host_allowed(c["host"]): emit({"ok": False, "reason": "private_target_blocked"}); return

    port = c["port"] or 443
    login_url = build_url(c["host"], port, "/axapi/v3/auth")
    login_body = json.dumps({"credentials": {
        "username": os.environ["A10_USER"], "password": os.environ["A10_PASSWORD"]
    }}).encode()
    login = http_request(login_url, "POST",
        {"Content-Type": "application/json", "Accept": "application/json"},
        login_body, c["timeout_ms"]/1000.0, c["verify_tls"])
    if not login.get("ok"):
        emit({"ok": False, "reason": "login_failed", "login": login}); return
    sig = ((login.get("json") or {}).get("authresponse") or {}).get("signature")
    if not sig:
        emit({"ok": False, "reason": "no_signature", "login_body": login.get("body", "")[:500]}); return

    body, _ = encode_body(c["payload"])
    headers = {"Authorization": f"A10 {sig}", "Accept": "application/json"}
    if body: headers["Content-Type"] = "application/json"
    url = build_url(c["host"], port, c["path"])
    r = http_request(url, c["method"], headers, body, c["timeout_ms"]/1000.0, c["verify_tls"])
    # best-effort logoff
    try:
        http_request(build_url(c["host"], port, "/axapi/v3/logoff"), "POST",
            {"Authorization": f"A10 {sig}"}, None, 5.0, c["verify_tls"])
    except Exception:
        pass
    emit(r)


if __name__ == "__main__":
    main()
