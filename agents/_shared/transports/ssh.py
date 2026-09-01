"""
SSH transport — asyncssh tabanlı, TOFU (Trust On First Use) host key cache.

Kullanım:
    from agents._shared.transports.ssh import ssh_run

    res = await ssh_run(
        host="10.0.0.5", user="admin", cmd="show version",
        password=None,   # None → vault'tan SSH_PASSWORD (veya ELARA_SECRET_SSH_PASSWORD)
        key=None,        # None → vault'tan SSH_KEY (PEM string)
        port=22,
        timeout=20,
    )
    # res = {"stdout": ..., "stderr": ..., "exit_code": 0, "duration_ms": 123, "host": "..."}

Host key politikası:
  ~/.elara/known_hosts dosyası kullanılır.
  - İlk bağlantı (host yok): otomatik kabul + dosyaya yaz (TOFU).
  - Sonraki bağlantı (host var + key match): geçer.
  - Sonraki bağlantı (host var + key MISMATCH): KeyMismatchError fırlatır
    → çağıran katman bunu requires_approval=True olarak chat'e iletir,
    kullanıcı onaylarsa update_known_host() çağrılır.

Bu modül asyncssh import'unu lazy yapar — adapter çağrılana kadar dependency yüklenmez.
"""

from __future__ import annotations
import asyncio
import os
import time
from pathlib import Path
from typing import Optional

from .creds import get_secret


KNOWN_HOSTS_PATH = Path(os.environ.get("ELARA_KNOWN_HOSTS") or Path.home() / ".elara" / "known_hosts")


class KeyMismatchError(Exception):
    """Bilinen host key ile yeni key eşleşmedi → user approval gerek."""
    def __init__(self, host: str, expected: str, actual: str):
        super().__init__(f"SSH host key mismatch for {host}")
        self.host = host
        self.expected = expected
        self.actual = actual


def _ensure_known_hosts_dir():
    KNOWN_HOSTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not KNOWN_HOSTS_PATH.exists():
        KNOWN_HOSTS_PATH.touch(mode=0o600)


def update_known_host(host: str, key_line: str) -> None:
    """Kullanıcı onayı sonrası known_hosts'a yazar (veya günceller)."""
    _ensure_known_hosts_dir()
    existing = KNOWN_HOSTS_PATH.read_text(encoding="utf-8").splitlines() if KNOWN_HOSTS_PATH.exists() else []
    filtered = [ln for ln in existing if not ln.startswith(host + " ")]
    filtered.append(f"{host} {key_line.strip()}")
    KNOWN_HOSTS_PATH.write_text("\n".join(filtered) + "\n", encoding="utf-8")


async def ssh_run(
    host: str,
    user: str,
    cmd: str,
    *,
    password: Optional[str] = None,
    key: Optional[str] = None,
    port: int = 22,
    timeout: int = 20,
    allow_unknown: bool = True,
) -> dict:
    """
    SSH üzerinden tek komut çalıştır.
    allow_unknown=False ise known_hosts'ta olmayan host için bağlantı reddedilir
    (chat onayı için requires_approval payload'u döner).
    """
    try:
        import asyncssh  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "asyncssh kurulu değil. `pip install asyncssh>=2.14` çalıştır."
        ) from e

    pwd = get_secret("SSH_PASSWORD", explicit=password)
    pkey = get_secret("SSH_PRIVATE_KEY", explicit=key)

    _ensure_known_hosts_dir()

    # asyncssh known_hosts kullanımı: dosya yolu verebiliriz.
    # İlk bağlantıda dosyada host yoksa → known_hosts=None ile bypass (TOFU).
    known_hosts_text = KNOWN_HOSTS_PATH.read_text(encoding="utf-8") if KNOWN_HOSTS_PATH.exists() else ""
    host_known = any(ln.startswith(f"{host} ") or ln.startswith(f"[{host}]:") for ln in known_hosts_text.splitlines())

    if not host_known and not allow_unknown:
        return {
            "stdout": "",
            "stderr": "",
            "exit_code": -1,
            "duration_ms": 0,
            "host": host,
            "requires_approval": True,
            "approval_reason": f"unknown SSH host {host} (TOFU)",
        }

    connect_kwargs = {
        "username": user,
        "port": port,
        "known_hosts": str(KNOWN_HOSTS_PATH) if host_known else None,
    }
    if pkey:
        connect_kwargs["client_keys"] = [asyncssh.import_private_key(pkey)]
    if pwd:
        connect_kwargs["password"] = pwd

    t0 = time.monotonic()
    try:
        async with asyncio.timeout(timeout):
            async with asyncssh.connect(host, **connect_kwargs) as conn:  # type: ignore
                # TOFU: ilk bağlantı başarılı olduysa server key'i known_hosts'a yaz.
                if not host_known:
                    try:
                        server_key = conn.get_server_host_key()
                        if server_key is not None:
                            update_known_host(host, server_key.export_public_key().decode("ascii").strip())
                    except Exception:
                        pass
                result = await conn.run(cmd, check=False)
        return {
            "stdout": str(result.stdout or ""),
            "stderr": str(result.stderr or ""),
            "exit_code": int(result.exit_status or 0),
            "duration_ms": int((time.monotonic() - t0) * 1000),
            "host": host,
        }
    except asyncssh.HostKeyNotVerifiable as e:  # type: ignore[attr-defined]
        raise KeyMismatchError(host=host, expected="(known)", actual=str(e)) from e
    except asyncio.TimeoutError:
        return {
            "stdout": "", "stderr": f"timeout after {timeout}s", "exit_code": -1,
            "duration_ms": int((time.monotonic() - t0) * 1000), "host": host,
        }
