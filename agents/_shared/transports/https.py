"""
HTTPS / REST transport — httpx tabanlı.

Default verify=True. Self-signed lab cihazları için `tls_insecure=True` opt-in.

Kullanım:
    from agents._shared.transports.https import request

    r = await request(
        method="GET",
        url="https://10.0.0.1/api/status",
        auth_mode="bearer",     # none|basic|bearer|api-key-header|api-key-query
        auth_token_name="GW_TOKEN",  # vault'tan ELARA_SECRET_GW_TOKEN okunur
        tls_insecure=True,
        timeout=30.0,
    )
    # r = {"status": 200, "headers": {...}, "body_text": "...", "body_json": {...}|None,
    #      "duration_ms": 42, "url": "..."}

Yanıt boyutu 256 KB'ı aşarsa truncate edilir + "truncated": True.
"""

from __future__ import annotations
import time
from typing import Any, Optional

from .creds import get_secret


MAX_BODY_BYTES = 256 * 1024


async def request(
    method: str,
    url: str,
    *,
    headers: Optional[dict] = None,
    json_body: Any = None,
    data: Any = None,
    params: Optional[dict] = None,
    auth_mode: str = "none",        # none | basic | bearer | api-key-header | api-key-query
    auth_user: Optional[str] = None,
    auth_password: Optional[str] = None,
    auth_token: Optional[str] = None,
    auth_token_name: Optional[str] = None,   # vault key adı
    auth_header_name: str = "X-API-Key",     # api-key-header için
    auth_query_param: str = "api_key",       # api-key-query için
    tls_insecure: bool = False,
    timeout: float = 30.0,
    retries: int = 2,
) -> dict:
    try:
        import httpx  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "httpx kurulu değil. `pip install httpx>=0.27` çalıştır."
        ) from e

    hdrs = dict(headers or {})
    qparams = dict(params or {})

    # Auth çözümü — vault'tan name lookup
    if auth_mode == "basic":
        u = get_secret("HTTP_USER", explicit=auth_user)
        p = get_secret("HTTP_PASSWORD", explicit=auth_password)
        auth = (u, p) if (u is not None or p is not None) else None
    else:
        auth = None

    if auth_mode == "bearer":
        tok = auth_token or (get_secret(auth_token_name, default=None) if auth_token_name else None)
        if tok:
            hdrs["Authorization"] = f"Bearer {tok}"
    elif auth_mode == "api-key-header":
        tok = auth_token or (get_secret(auth_token_name, default=None) if auth_token_name else None)
        if tok:
            hdrs[auth_header_name] = tok
    elif auth_mode == "api-key-query":
        tok = auth_token or (get_secret(auth_token_name, default=None) if auth_token_name else None)
        if tok:
            qparams[auth_query_param] = tok

    verify = not bool(tls_insecure)

    t0 = time.monotonic()
    last_exc: Optional[Exception] = None
    for attempt in range(max(1, retries + 1)):
        try:
            async with httpx.AsyncClient(verify=verify, timeout=timeout, follow_redirects=True) as client:
                resp = await client.request(
                    method.upper(), url,
                    headers=hdrs, params=qparams,
                    json=json_body, data=data,
                    auth=auth,
                )
                body_bytes = resp.content or b""
                truncated = False
                if len(body_bytes) > MAX_BODY_BYTES:
                    body_bytes = body_bytes[:MAX_BODY_BYTES]
                    truncated = True
                try:
                    body_text = body_bytes.decode("utf-8", errors="replace")
                except Exception:
                    body_text = ""
                body_json = None
                ctype = resp.headers.get("content-type", "")
                if "application/json" in ctype and body_text and not truncated:
                    try:
                        body_json = resp.json()
                    except Exception:
                        body_json = None
                return {
                    "status": resp.status_code,
                    "headers": dict(resp.headers),
                    "body_text": body_text,
                    "body_json": body_json,
                    "truncated": truncated,
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                    "url": str(resp.url),
                    "tls_insecure": bool(tls_insecure),
                }
        except (httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError) as e:
            last_exc = e
            if attempt < retries:
                # exponential backoff: 0.5, 1.0, 2.0 ...
                import asyncio
                await asyncio.sleep(0.5 * (2 ** attempt))
                continue
            break

    return {
        "status": 0,
        "headers": {},
        "body_text": "",
        "body_json": None,
        "truncated": False,
        "duration_ms": int((time.monotonic() - t0) * 1000),
        "url": url,
        "tls_insecure": bool(tls_insecure),
        "error": str(last_exc) if last_exc else "unknown_error",
    }
