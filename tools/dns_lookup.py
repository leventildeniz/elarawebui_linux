#!/usr/bin/env python3
# @tool: dns_lookup
# @description: Bir alan adı için DNS kayıtlarını çözer (A/AAAA/MX/TXT/NS/CNAME/SOA/PTR).
# @args: {"name":"string","types":"array","resolver":"string","timeout_ms":"number"}
# @category: NetSec
# @icon: Globe
# @color: #0ea5e9
"""dns_lookup — name → {records:{A:[],MX:[…],…}, resolver}.

stdin JSON: {name, types?:[…], resolver?, timeout_ms?}
- name: max 253 char, IDN tolerated.
- types default: ["A","AAAA","MX","TXT","NS","CNAME","SOA"]
- resolver: allow public list (8.8.8.8 / 1.1.1.1 / 9.9.9.9) or system (omit).
- Requires dnspython; falls back to {ok:false, reason:"missing_dependency"}.
"""
import json
import sys

ALLOWED_RESOLVERS = {"8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1", "9.9.9.9", "149.112.112.112"}
DEFAULT_TYPES = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA"]
SUPPORTED = {"A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "PTR", "SRV", "CAA"}


def _read():
    try:
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def main() -> None:
    p = _read()
    name = str(p.get("name") or "").strip().rstrip(".")
    if not name:
        print(json.dumps({"ok": False, "reason": "missing_name"})); return
    if len(name) > 253:
        print(json.dumps({"ok": False, "reason": "name_too_long"})); return

    resolver_ip = str(p.get("resolver") or "").strip()
    if resolver_ip and resolver_ip not in ALLOWED_RESOLVERS:
        print(json.dumps({"ok": False, "reason": "resolver_not_allowed",
                          "allowed": sorted(ALLOWED_RESOLVERS)})); return

    types_in = p.get("types") or DEFAULT_TYPES
    if not isinstance(types_in, list):
        print(json.dumps({"ok": False, "reason": "types_must_be_list"})); return
    types = [str(t).upper() for t in types_in if str(t).upper() in SUPPORTED]
    if not types:
        types = DEFAULT_TYPES

    timeout = max(1.0, min(30.0, float(p.get("timeout_ms") or 5000) / 1000.0))

    try:
        import dns.resolver
        import dns.exception
    except ImportError:
        print(json.dumps({"ok": False, "reason": "missing_dependency",
                          "detail": "pip install dnspython"})); return

    r = dns.resolver.Resolver()
    r.lifetime = timeout
    r.timeout = timeout
    if resolver_ip:
        r.nameservers = [resolver_ip]

    records: dict = {}
    errors: dict = {}
    for t in types:
        try:
            ans = r.resolve(name, t, raise_on_no_answer=False)
            vals = []
            for rr in ans:
                try:
                    vals.append(rr.to_text())
                except Exception:
                    vals.append(str(rr))
            records[t] = vals
        except dns.resolver.NXDOMAIN:
            errors[t] = "nxdomain"
            break
        except dns.resolver.NoAnswer:
            records[t] = []
        except dns.exception.DNSException as e:
            errors[t] = type(e).__name__

    print(json.dumps({
        "ok": True,
        "name": name,
        "resolver": resolver_ip or "system",
        "records": records,
        "errors": errors,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
