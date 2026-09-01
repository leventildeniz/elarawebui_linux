"""
Checkpoint Smart Management adapter (CPM REST API).

Login → sid token (in-memory, vault'a YAZILMAZ) → her isteğe X-chkp-sid header'ı
→ invocation sonunda otomatik logout.

Default mod: read-only, discard-on-exit. Write op için açıkça
publish=True veya install_policy çağırılmalı.

Kullanım:
    async with SmcSession("10.0.0.1", user_name="admin",
                          password_name="SMC_PASSWORD",
                          tls_insecure=True) as smc:
        rules = await smc.call("show-access-rulebase", {"name": "Network", "limit": 50})
        # write ops:
        # await smc.call("add-access-rule", {...}); await smc.publish()

Tüm `call` çağrıları redaction-safe dict döner.
"""

from __future__ import annotations
from typing import Any, Optional

from .https import request as https_request
from .creds import get_secret


READ_ONLY_PREFIXES = ("show-", "get-", "list-", "check-")
DESTRUCTIVE_VERBS = ("install-policy", "publish", "discard", "delete-", "set-", "add-")


def is_destructive(command: str) -> bool:
    c = command.lower()
    if c.startswith(READ_ONLY_PREFIXES):
        return False
    return any(c.startswith(v) for v in DESTRUCTIVE_VERBS)


class SmcSession:
    def __init__(
        self,
        host: str,
        *,
        user_name: Optional[str] = None,   # vault key adı (örn "SMC_USER")
        password_name: Optional[str] = None,
        api_key_name: Optional[str] = None,
        user: Optional[str] = None,        # explicit override
        password: Optional[str] = None,
        api_key: Optional[str] = None,
        port: int = 443,
        tls_insecure: bool = True,
        domain: Optional[str] = None,
        read_only: bool = True,
    ):
        self.host = host
        self.port = port
        self.tls_insecure = tls_insecure
        self.domain = domain
        self.read_only = read_only
        self._sid: Optional[str] = None
        self._user = user or (get_secret(user_name) if user_name else None)
        self._password = password or (get_secret(password_name) if password_name else None)
        self._api_key = api_key or (get_secret(api_key_name) if api_key_name else None)

    @property
    def base_url(self) -> str:
        return f"https://{self.host}:{self.port}/web_api"

    async def __aenter__(self):
        await self._login()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self._logout()

    async def _login(self):
        body: dict = {"continue-last-session": False, "read-only": self.read_only}
        if self.domain:
            body["domain"] = self.domain
        if self._api_key:
            body["api-key"] = self._api_key
        else:
            body["user"] = self._user or ""
            body["password"] = self._password or ""
        r = await https_request(
            "POST", f"{self.base_url}/login",
            json_body=body, tls_insecure=self.tls_insecure,
            headers={"Content-Type": "application/json"},
        )
        if r["status"] != 200 or not r.get("body_json"):
            raise RuntimeError(f"SMC login failed: status={r['status']} err={r.get('error') or r.get('body_text','')[:200]}")
        self._sid = r["body_json"].get("sid")
        if not self._sid:
            raise RuntimeError("SMC login: sid missing in response")

    async def _logout(self):
        if not self._sid:
            return
        try:
            await https_request(
                "POST", f"{self.base_url}/logout",
                json_body={}, tls_insecure=self.tls_insecure,
                headers={"Content-Type": "application/json", "X-chkp-sid": self._sid},
            )
        finally:
            self._sid = None

    async def call(self, command: str, payload: Optional[dict] = None) -> dict:
        """
        Tek bir SMC API komutu çağır. Destructive komutlar read_only=True
        moddayken {requires_approval: True} ile döner.
        """
        if not self._sid:
            raise RuntimeError("SMC session not logged in")
        if self.read_only and is_destructive(command):
            return {
                "ok": False,
                "command": command,
                "requires_approval": True,
                "approval_reason": f"destructive SMC command '{command}' in read-only session",
            }
        r = await https_request(
            "POST", f"{self.base_url}/{command}",
            json_body=payload or {}, tls_insecure=self.tls_insecure,
            headers={"Content-Type": "application/json", "X-chkp-sid": self._sid},
        )
        ok = (r["status"] == 200)
        return {
            "ok": ok,
            "command": command,
            "status": r["status"],
            "data": r.get("body_json"),
            "raw_text": r.get("body_text", "") if not ok else "",
            "duration_ms": r.get("duration_ms"),
        }

    async def publish(self) -> dict:
        """Pending değişiklikleri publish et. Destructive — approval gerekir."""
        return await self.call("publish", {})

    async def discard(self) -> dict:
        """Pending değişiklikleri at."""
        return await self.call("discard", {})
