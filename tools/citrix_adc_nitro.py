#!/usr/bin/env python3
# @tool: citrix_adc_nitro
# @description: Citrix ADC (NetScaler) NITRO REST istemcisi, X-NITRO-USER/PASS header'ları ile.
# @args: {"host":"string","path":"string","method":"string","payload":"object","verify_tls":"boolean","timeout_ms":"number"}
# @category: NetSec
# @icon: Network
# @color: #0ea5e9
"""citrix_adc_nitro — Citrix ADC NITRO REST proxy.

Env (vault): CITRIX_ADC_USER, CITRIX_ADC_PASSWORD

stdin JSON:
  {host, path:"/nitro/v1/config/...", method, payload?, verify_tls?, timeout_ms?, port?}
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from _vendor_common import (
    read_stdin, emit, need_env, host_allowed, http_request,
    parse_common, build_url, encode_body,
)


def main():
    p = read_stdin()
    miss = need_env(["CITRIX_ADC_USER", "CITRIX_ADC_PASSWORD"])
    if miss: emit(miss); return
    c = parse_common(p)
    if not c["host"]: emit({"ok": False, "reason": "missing_host"}); return
    if not host_allowed(c["host"]): emit({"ok": False, "reason": "private_target_blocked"}); return

    body, _ = encode_body(c["payload"])
    headers = {
        "X-NITRO-USER": os.environ["CITRIX_ADC_USER"],
        "X-NITRO-PASS": os.environ["CITRIX_ADC_PASSWORD"],
        "Accept": "application/json",
    }
    if body: headers["Content-Type"] = "application/json"
    url = build_url(c["host"], c["port"] or 443, c["path"])
    r = http_request(url, c["method"], headers, body, c["timeout_ms"]/1000.0, c["verify_tls"])
    emit(r)


if __name__ == "__main__":
    main()
