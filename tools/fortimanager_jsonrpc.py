#!/usr/bin/env python3
# @tool: fortimanager_jsonrpc
# @description: FortiManager JSON-RPC istemcisi (login → session → çağrı → logout).
# @args: {"host":"string","method":"string","url":"string","data":"object","verify_tls":"boolean","timeout_ms":"number"}
# @category: NetSec
# @icon: ShieldCheck
# @color: #b91c1c
"""fortimanager_jsonrpc — FortiManager JSON-RPC proxy.

Env (vault): FORTIMANAGER_USER, FORTIMANAGER_PASSWORD

stdin JSON:
  {host, method:"get"|"set"|"add"|"update"|"delete"|"exec",
   url:"/dvmdb/adom/...", data?:object|array, verify_tls?, timeout_ms?, port?}
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from _vendor_common import (
    read_stdin, emit, need_env, host_allowed, http_request,
    parse_common, build_url,
)


def _rpc(host, port, payload, verify, timeout):
    url = build_url(host, port, "/jsonrpc")
    body = json.dumps(payload).encode()
    return http_request(url, "POST",
        {"Content-Type": "application/json", "Accept": "application/json"},
        body, timeout, verify)


def main():
    p = read_stdin()
    miss = need_env(["FORTIMANAGER_USER", "FORTIMANAGER_PASSWORD"])
    if miss: emit(miss); return
    c = parse_common(p)
    fm_url = p.get("url")
    if not fm_url: emit({"ok": False, "reason": "missing_url"}); return
    fm_method = (p.get("method") or "get").lower()
    if not c["host"]: emit({"ok": False, "reason": "missing_host"}); return
    if not host_allowed(c["host"]): emit({"ok": False, "reason": "private_target_blocked"}); return


    port = c["port"] or 443
    timeout = c["timeout_ms"]/1000.0

    # 1) login
    login = _rpc(c["host"], port, {
        "id": 1, "method": "exec",
        "params": [{"url": "/sys/login/user",
                    "data": {"user": os.environ["FORTIMANAGER_USER"],
                             "passwd": os.environ["FORTIMANAGER_PASSWORD"]}}]
    }, c["verify_tls"], timeout)
    if not login.get("ok"):
        emit({"ok": False, "reason": "login_failed", "login": login}); return
    session = (login.get("json") or {}).get("session")
    if not session:
        emit({"ok": False, "reason": "no_session", "login_body": login.get("body", "")[:500]}); return

    # 2) call
    params = {"url": fm_url}
    if p.get("data") is not None: params["data"] = p["data"]
    call = _rpc(c["host"], port, {
        "id": 2, "method": fm_method, "params": [params], "session": session,
    }, c["verify_tls"], timeout)

    # 3) logout (best-effort)
    try:
        _rpc(c["host"], port, {
            "id": 3, "method": "exec",
            "params": [{"url": "/sys/logout"}], "session": session,
        }, c["verify_tls"], 5.0)
    except Exception:
        pass

    emit(call)


if __name__ == "__main__":
    main()
