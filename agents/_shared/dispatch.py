# agents/_shared/dispatch.py — TUR-6
# Agent → Middleware tool dispatch helper.
# Senkron HTTP POST /api/agents/tool-call (loopback-only endpoint).
#
# Kullanım:
#   from _shared.dispatch import call_tool, ToolError, ApprovalPending, ToolBlocked
#   result = call_tool("dns_lookup", domain="example.com")
#
# Env:
#   ELARA_API_BASE   (default: http://127.0.0.1:3005)
#   ELARA_AGENT_ID   (required — spawn tarafı set eder; yoksa dosya adı fallback)
import os
import sys
import json
import pathlib


class ToolError(Exception):
    """Generic tool dispatch error."""


class ApprovalPending(ToolError):
    def __init__(self, invocation_id: str, msg: str = "approval required"):
        super().__init__(msg)
        self.invocation_id = invocation_id


class ToolBlocked(ToolError):
    def __init__(self, code: str, msg: str):
        super().__init__(msg)
        self.code = code


def _agent_id() -> str:
    v = os.getenv("ELARA_AGENT_ID", "").strip()
    if v:
        return v
    # Fallback: caller script basename (e.g. firewall_oracle.py → firewall_oracle)
    try:
        main = sys.modules.get("__main__")
        f = getattr(main, "__file__", None)
        if f:
            return pathlib.Path(f).stem
    except Exception:
        pass
    return ""


def call_tool(slug: str, _dry_run: bool = False, **kwargs):
    """Invoke an action_library tool through the middleware.

    Returns the tool output dict on success. Raises ApprovalPending /
    ToolBlocked / ToolError on policy or transport failures.
    """
    if not slug:
        raise ToolError("tool slug required")
    try:
        import httpx  # lazy
    except ImportError:
        raise ToolError("httpx not installed")

    base = os.getenv("ELARA_API_BASE", "http://127.0.0.1:3005").rstrip("/")
    agent = _agent_id()
    if not agent:
        raise ToolError("ELARA_AGENT_ID env not set")

    url = f"{base}/api/agents/tool-call"
    body = {"tool": slug, "input": kwargs, "dryRun": bool(_dry_run)}
    headers = {"X-Agent-Id": agent, "Content-Type": "application/json"}

    try:
        with httpx.Client(timeout=httpx.Timeout(connect=2.0, read=120.0, write=10.0, pool=5.0)) as c:
            r = c.post(url, headers=headers, content=json.dumps(body))
    except httpx.HTTPError as e:
        raise ToolError(f"transport: {e}") from e

    try:
        data = r.json()
    except Exception:
        raise ToolError(f"non-json response (status={r.status_code}): {r.text[:200]}")

    if r.status_code == 202 and data.get("approvalRequired"):
        raise ApprovalPending(data.get("invocationId", ""), data.get("message", "approval required"))
    if r.status_code == 403:
        raise ToolBlocked(data.get("code", "forbidden"), data.get("error", "forbidden"))
    if r.status_code == 404:
        raise ToolBlocked("not_found", data.get("error", "tool not found"))
    if r.status_code >= 400 or not data.get("ok", False):
        raise ToolError(data.get("error", f"http {r.status_code}"))

    return data.get("output", data)


__all__ = ["call_tool", "ToolError", "ApprovalPending", "ToolBlocked"]
