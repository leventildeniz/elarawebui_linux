#!/usr/bin/env python3
# @tool: checkpoint_smc_login
# @description: Check Point Security Management API (login → sid → çağrı → logout).
# @args: {"host":"string","command":"string","payload":"object","verify_tls":"boolean","timeout_ms":"number"}
# @category: NetSec
# @icon: ShieldCheck
# @color: #16a34a
"""checkpoint_smc_login — Check Point SMC REST proxy.

Env (vault): CHECKPOINT_USER, CHECKPOINT_PASSWORD
(optional CHECKPOINT_DOMAIN)

stdin JSON:
  {host, command:"show-hosts"|..., payload?:object, verify_tls?, timeout_ms?, port?}
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from _vendor_common import (
    read_stdin, emit, need_env, host_allowed, http_request,
    parse_common, build_url,
)


def _call(host, port, cmd, body, sid, verify, timeout):
    url = build_url(host, port, f"/web_api/{cmd}")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if sid: headers["X-chkp-sid"] = sid
    return http_request(url, "POST", headers,
        json.dumps(body or {}).encode(), timeout, verify)


def main():
    p = read_stdin()
    miss = need_env(["CHECKPOINT_USER", "CHECKPOINT_PASSWORD"])
    if miss: emit(miss); return
    c = parse_common(p)
    cmd = p.get("command")
    if not cmd: emit({"ok": False, "reason": "missing_command"}); return
    if not c["host"]: emit({"ok": False, "reason": "missing_host"}); return
    if not host_allowed(c["host"]): emit({"ok": False, "reason": "private_target_blocked"}); return


    port = c["port"] or 443
    timeout = c["timeout_ms"]/1000.0
    login_body = {
        "user": os.environ["CHECKPOINT_USER"],
        "password": os.environ["CHECKPOINT_PASSWORD"],
    }
    dom = (os.environ.get("CHECKPOINT_DOMAIN") or "").strip()
    if dom: login_body["domain"] = dom

    login = _call(c["host"], port, "login", login_body, None, c["verify_tls"], timeout)
    if not login.get("ok"):
        emit({"ok": False, "reason": "login_failed", "login": login}); return
    sid = (login.get("json") or {}).get("sid")
    if not sid:
        emit({"ok": False, "reason": "no_sid", "login_body": login.get("body", "")[:500]}); return

    call = _call(c["host"], port, cmd, p.get("payload") or {}, sid, c["verify_tls"], timeout)
    try:
        _call(c["host"], port, "logout", {}, sid, c["verify_tls"], 5.0)
    except Exception:
        pass
    emit(call)


if __name__ == "__main__":
    main()
