#!/usr/bin/env python3
# @tool: whois_geo
# @description: IP veya alan adı için WHOIS + ASN + coğrafi konum sorgular.
# @args: {"target":"string","timeout_ms":"number"}
# @category: NetSec
# @icon: MapPin
# @color: #16a34a
"""whois_geo — target → {whois, asn, geo}.

stdin JSON: {target, timeout_ms?}
- target = IPv4/IPv6/domain.
- Private/loopback blocked unless ELARA_NETSEC_ALLOW_PRIVATE=1.
- WHOIS via python-whois (optional). ASN+geo via ip-api.com (anonymous, rate-limited).
- ip-api 429 → reason:"rate_limited".
"""
import ipaddress
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request

IPAPI = "http://ip-api.com/json/{target}?fields=status,message,country,countryCode,city,lat,lon,as,asname,org,query"
DOMAIN_RE = re.compile(r"^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$")


def _read():
    try:
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def _classify(target: str):
    try:
        ip = ipaddress.ip_address(target)
        return "ip", ip
    except ValueError:
        if DOMAIN_RE.match(target):
            return "domain", None
        return None, None


def _ipapi(target: str, timeout: float) -> dict:
    url = IPAPI.format(target=urllib.request.quote(target))
    req = urllib.request.Request(url, headers={"User-Agent": "ELARA-whois-geo/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(256 * 1024)
            return json.loads(body.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            return {"_err": "rate_limited"}
        return {"_err": f"http_{e.code}"}
    except (urllib.error.URLError, ssl.SSLError) as e:
        return {"_err": "network_error", "detail": str(e)[:200]}
    except Exception as e:
        return {"_err": "bad_response", "detail": str(e)[:200]}


def _whois_lookup(target: str) -> dict:
    try:
        import whois  # python-whois
    except ImportError:
        return {"_err": "missing_dependency", "detail": "pip install python-whois"}
    try:
        w = whois.whois(target)
    except Exception as e:
        return {"_err": "whois_failed", "detail": str(e)[:200]}

    def _s(v):
        if isinstance(v, list):
            return [str(x) for x in v[:10]]
        if v is None:
            return None
        return str(v)[:300]

    return {
        "registrar": _s(getattr(w, "registrar", None)),
        "created": _s(getattr(w, "creation_date", None)),
        "expires": _s(getattr(w, "expiration_date", None)),
        "updated": _s(getattr(w, "updated_date", None)),
        "name_servers": _s(getattr(w, "name_servers", None)),
        "status": _s(getattr(w, "status", None)),
        "emails": _s(getattr(w, "emails", None)),
    }


def main() -> None:
    p = _read()
    target = str(p.get("target") or "").strip().lower().rstrip(".")
    if not target:
        print(json.dumps({"ok": False, "reason": "missing_target"})); return

    kind, ip = _classify(target)
    if not kind:
        print(json.dumps({"ok": False, "reason": "invalid_target"})); return

    allow_private = os.environ.get("ELARA_NETSEC_ALLOW_PRIVATE", "0") == "1"
    if kind == "ip" and not allow_private:
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            print(json.dumps({"ok": False, "reason": "private_target_blocked",
                              "hint": "set ELARA_NETSEC_ALLOW_PRIVATE=1 to override"})); return

    timeout = max(2.0, min(30.0, float(p.get("timeout_ms") or 10000) / 1000.0))

    # geo + asn
    geo_data = _ipapi(target, timeout)
    geo = None
    asn = None
    geo_err = None
    if "_err" in geo_data:
        geo_err = geo_data["_err"]
    elif str(geo_data.get("status")) == "success":
        geo = {
            "country": geo_data.get("country"),
            "country_code": geo_data.get("countryCode"),
            "city": geo_data.get("city"),
            "lat": geo_data.get("lat"),
            "lon": geo_data.get("lon"),
        }
        as_str = geo_data.get("as") or ""
        asn_num = None
        m = re.match(r"AS(\d+)", as_str)
        if m:
            asn_num = int(m.group(1))
        asn = {
            "number": asn_num,
            "name": geo_data.get("asname"),
            "org": geo_data.get("org") or as_str,
        }
    else:
        geo_err = geo_data.get("message") or "lookup_failed"

    # whois (domains; also try for IPs — python-whois handles netblocks loosely)
    w = _whois_lookup(target)
    whois_out = None
    whois_err = None
    if "_err" in w:
        whois_err = w["_err"]
    else:
        whois_out = w

    print(json.dumps({
        "ok": True,
        "target": target,
        "kind": kind,
        "whois": whois_out,
        "whois_error": whois_err,
        "asn": asn,
        "geo": geo,
        "geo_error": geo_err,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
