"""Shared helpers for vendor connector tools.

All connectors follow the same shape:
  stdin JSON  → {host, path, method, payload?, verify_tls?, timeout_ms?, ...}
  stdout JSON → {ok, status?, data?, reason?, ...}

Credentials come from environment variables (agent credentials vault).
Missing creds → {ok:false, reason:"missing_secret", keys:[...]}.
"""
import ipaddress
import json
import os
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def read_stdin() -> dict:
    try:
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")


def need_env(keys: list[str]) -> dict | None:
    """Return None if all present; else missing_secret payload."""
    missing = [k for k in keys if not (os.environ.get(k) or "").strip()]
    if missing:
        return {"ok": False, "reason": "missing_secret", "keys": missing}
    return None


def host_allowed(host: str) -> bool:
    """Block private/loopback unless ELARA_NETSEC_ALLOW_PRIVATE=1."""
    if (os.environ.get("ELARA_NETSEC_ALLOW_PRIVATE", "0") or "0").strip() == "1":
        return True
    try:
        ip = ipaddress.ip_address(host)
        return not (ip.is_private or ip.is_loopback or ip.is_link_local)
    except ValueError:
        try:
            for fam, *_r, sa in socket.getaddrinfo(host, None):
                ip = ipaddress.ip_address(sa[0])
                if ip.is_private or ip.is_loopback or ip.is_link_local:
                    return False
        except Exception:
            return False
        return True


def make_ssl_ctx(verify: bool) -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if not verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def http_request(
    url: str,
    method: str = "GET",
    headers: dict | None = None,
    body: bytes | None = None,
    timeout_s: float = 20.0,
    verify_tls: bool = True,
) -> dict:
    """Single HTTP call; returns {ok, status, headers, body, json?, reason?}."""
    req = urllib.request.Request(url, data=body, method=method.upper())
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        ctx = make_ssl_ctx(verify_tls) if url.startswith("https") else None
        with urllib.request.urlopen(req, timeout=timeout_s, context=ctx) as r:
            raw = r.read()
            status = r.status
            resp_headers = dict(r.headers.items())
    except urllib.error.HTTPError as e:
        raw = e.read() if e.fp else b""
        status = e.code
        resp_headers = dict(e.headers.items()) if e.headers else {}
    except urllib.error.URLError as e:
        return {"ok": False, "reason": "network_error", "detail": str(e.reason)}
    except socket.timeout:
        return {"ok": False, "reason": "timeout"}
    except Exception as e:
        return {"ok": False, "reason": "request_failed", "detail": str(e)[:300]}

    text = ""
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        text = ""
    parsed: Any = None
    ct = (resp_headers.get("Content-Type") or resp_headers.get("content-type") or "").lower()
    if "json" in ct or (text and text.lstrip()[:1] in "{["):
        try:
            parsed = json.loads(text)
        except Exception:
            parsed = None
    out = {
        "ok": 200 <= status < 400,
        "status": status,
        "headers": resp_headers,
        "body": text[:8000],
    }
    if parsed is not None:
        out["json"] = parsed
    return out


def parse_common(p: dict) -> dict:
    """Extract shared fields with sane defaults."""
    return {
        "host": str(p.get("host") or "").strip(),
        "path": str(p.get("path") or "/").strip() or "/",
        "method": (str(p.get("method") or "GET").upper()),
        "payload": p.get("payload"),
        "verify_tls": bool(p.get("verify_tls", True)),
        "timeout_ms": int(p.get("timeout_ms") or 20000),
        "port": p.get("port"),
    }


def build_url(host: str, port: int | None, path: str, scheme: str = "https") -> str:
    if not path.startswith("/"):
        path = "/" + path
    auth_host = f"{host}:{port}" if port else host
    return f"{scheme}://{auth_host}{path}"


def encode_body(payload: Any) -> tuple[bytes | None, str]:
    if payload is None:
        return None, ""
    if isinstance(payload, (bytes, bytearray)):
        return bytes(payload), "application/octet-stream"
    if isinstance(payload, str):
        return payload.encode("utf-8"), "text/plain"
    return json.dumps(payload).encode("utf-8"), "application/json"
