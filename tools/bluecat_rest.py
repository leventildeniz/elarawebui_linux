#!/usr/bin/env python3
# @tool: bluecat_rest
# @description: BlueCat Address Manager REST istemcisi (login → token → çağrı).
# @args: {"host":"string","path":"string","method":"string","payload":"object","verify_tls":"boolean","timeout_ms":"number"}
# @category: NetSec
# @icon: Globe
# @color: #0369a1
"""bluecat_rest — BlueCat Address Manager REST proxy.

Env (vault): BLUECAT_USER, BLUECAT_PASSWORD

stdin JSON: {host, path:"/Services/REST/v1/...", method, payload?, verify_tls?, timeout_ms?, port?}
"""
import os, sys, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from _vendor_common import (
    read_stdin, emit, need_env, host_allowed, http_request,
    parse_common, build_url, encode_body,
)


def main():
    p = read_stdin()
    miss = need_env(["BLUECAT_USER", "BLUECAT_PASSWORD"])
    if miss: emit(miss); return
    c = parse_common(p)
    if not c["host"]: emit({"ok": False, "reason": "missing_host"}); return
    if not host_allowed(c["host"]): emit({"ok": False, "reason": "private_target_blocked"}); return

    port = c["port"] or 443
    timeout = c["timeout_ms"]/1000.0
    qs = urllib.parse.urlencode({
        "username": os.environ["BLUECAT_USER"],
        "password": os.environ["BLUECAT_PASSWORD"],
    })
    login = http_request(build_url(c["host"], port, f"/Services/REST/v1/login?{qs}"),
        "GET", {"Accept": "application/json"}, None, timeout, c["verify_tls"])
    if not login.get("ok"):
        emit({"ok": False, "reason": "login_failed", "login": login}); return
    token = login.get("json") or login.get("body", "")
    if isinstance(token, str):
        # Body like: 'Session Token-> BAMAuthToken: xxxx <- for User : ...'
        if "BAMAuthToken" in token:
            try:
                token = token.split("BAMAuthToken:", 1)[1].split("<-")[0].strip().strip('"')
            except Exception:
                pass
    if not token or not isinstance(token, str):
        emit({"ok": False, "reason": "no_token", "login_body": login.get("body", "")[:500]}); return

    body, _ = encode_body(c["payload"])
    headers = {
        "Authorization": f"BAMAuthToken: {token}",
        "Accept": "application/json",
    }
    if body: headers["Content-Type"] = "application/json"
    url = build_url(c["host"], port, c["path"])
    r = http_request(url, c["method"], headers, body, timeout, c["verify_tls"])
    try:
        http_request(build_url(c["host"], port, "/Services/REST/v1/logout"),
            "GET", {"Authorization": f"BAMAuthToken: {token}"}, None, 5.0, c["verify_tls"])
    except Exception:
        pass
    emit(r)


if __name__ == "__main__":
    main()
