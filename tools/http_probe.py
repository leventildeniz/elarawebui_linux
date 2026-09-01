#!/usr/bin/env python3
# @tool: http_probe
# @description: TLS sertifika metadata'sı ve yönlendirme zinciri ile HTTP HEAD/GET probe.
# @args: {"url":"string","method":"string","timeout_ms":"number","max_redirects":"number"}
# @category: NetSec
# @icon: Radar
# @color: #f97316
"""http_probe — url → {status, final_url, headers, tls:{…}, redirects:[…]}.

stdin JSON: {url, method?:"HEAD"|"GET", timeout_ms?, max_redirects?}
- Only http/https. Private/loopback target only if knob allows
  (env ELARA_NETSEC_ALLOW_PRIVATE=1, default 0 = blocked).
- Body NOT read (HEAD by default). GET also discards body.
- TLS metadata via ssl.SSLSocket.getpeercert().
- No external deps; stdlib only.
"""
import ipaddress
import json
import os
import socket
import ssl
import sys
from http.client import HTTPConnection, HTTPSConnection
from urllib.parse import urlsplit, urlunsplit


def _read():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            return json.loads(sys.argv[1])
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def _is_private(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        try:
            addrs = socket.getaddrinfo(host, None)
            for fam, *_rest, sa in addrs:
                ip = ipaddress.ip_address(sa[0])
                if ip.is_private or ip.is_loopback or ip.is_link_local:
                    return True
        except Exception:
            return False
        return False


def _fmt_dn(seq) -> str:
    out = []
    try:
        for rdn in seq or []:
            for k, v in rdn:
                out.append(f"{k}={v}")
    except Exception:
        return ""
    return ", ".join(out)


def _probe_once(url: str, method: str, timeout: float) -> dict:
    sp = urlsplit(url)
    if sp.scheme not in ("http", "https"):
        return {"_err": "scheme_not_allowed"}
    host = sp.hostname or ""
    port = sp.port or (443 if sp.scheme == "https" else 80)
    path = sp.path or "/"
    if sp.query:
        path += "?" + sp.query

    tls_info = None
    conn = None
    try:
        if sp.scheme == "https":
            ctx = ssl.create_default_context()
            conn = HTTPSConnection(host, port, timeout=timeout, context=ctx)
            conn.connect()
            sock = conn.sock
            cert = sock.getpeercert() if isinstance(sock, ssl.SSLSocket) else {}
            san = []
            for k, v in (cert.get("subjectAltName") or []):
                san.append(f"{k}:{v}")
            tls_info = {
                "issuer": _fmt_dn(cert.get("issuer")),
                "subject": _fmt_dn(cert.get("subject")),
                "expires": cert.get("notAfter"),
                "san": san,
            }
        else:
            conn = HTTPConnection(host, port, timeout=timeout)
            conn.connect()

        conn.request(method, path, headers={
            "User-Agent": "ELARA-http-probe/1.0",
            "Accept": "*/*",
            "Connection": "close",
        })
        resp = conn.getresponse()
        headers = {k.lower(): v for k, v in resp.getheaders()}
        # Drain at most 64KB to free the socket then close.
        try:
            resp.read(65536)
        except Exception:
            pass
        return {
            "status": resp.status,
            "reason": resp.reason,
            "headers": headers,
            "tls": tls_info,
            "location": headers.get("location"),
        }
    except ssl.SSLError as e:
        return {"_err": "tls_error", "detail": str(e)[:200]}
    except socket.timeout:
        return {"_err": "timeout"}
    except OSError as e:
        return {"_err": "connect_error", "detail": str(e)[:200]}
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


def main() -> None:
    p = _read()
    url = str(p.get("url") or "").strip()
    if not url:
        print(json.dumps({"ok": False, "reason": "missing_url"})); return

    method = str(p.get("method") or "HEAD").upper()
    if method not in ("HEAD", "GET"):
        print(json.dumps({"ok": False, "reason": "method_not_allowed"})); return

    sp = urlsplit(url)
    if sp.scheme not in ("http", "https"):
        print(json.dumps({"ok": False, "reason": "scheme_not_allowed"})); return
    if not sp.hostname:
        print(json.dumps({"ok": False, "reason": "missing_host"})); return

    allow_private = os.environ.get("ELARA_NETSEC_ALLOW_PRIVATE", "0") == "1"
    if not allow_private and _is_private(sp.hostname):
        print(json.dumps({"ok": False, "reason": "private_target_blocked",
                          "hint": "set ELARA_NETSEC_ALLOW_PRIVATE=1 to override"})); return

    timeout = max(1.0, min(60.0, float(p.get("timeout_ms") or 15000) / 1000.0))
    max_redirects = max(0, min(10, int(p.get("max_redirects") or 5)))

    redirects = []
    cur = url
    final = None
    last = None
    for hop in range(max_redirects + 1):
        last = _probe_once(cur, method, timeout)
        if "_err" in last:
            print(json.dumps({"ok": False, "reason": last["_err"],
                              "detail": last.get("detail"),
                              "redirects": redirects, "hops": hop})); return
        final = last
        loc = last.get("location")
        if last["status"] in (301, 302, 303, 307, 308) and loc and hop < max_redirects:
            # absolute or relative
            if loc.startswith("//"):
                loc = f"{urlsplit(cur).scheme}:{loc}"
            elif loc.startswith("/"):
                sp2 = urlsplit(cur)
                loc = urlunsplit((sp2.scheme, sp2.netloc, loc, "", ""))
            elif not loc.startswith(("http://", "https://")):
                # crude relative resolution
                sp2 = urlsplit(cur)
                base = sp2.path.rsplit("/", 1)[0] + "/"
                loc = urlunsplit((sp2.scheme, sp2.netloc, base + loc, "", ""))
            redirects.append({"from": cur, "to": loc, "status": last["status"]})
            cur = loc
            continue
        break

    print(json.dumps({
        "ok": True,
        "status": final["status"],
        "reason": final.get("reason"),
        "final_url": cur,
        "headers": final["headers"],
        "tls": final.get("tls"),
        "redirects": redirects,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
