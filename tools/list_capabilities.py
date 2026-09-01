#!/usr/bin/env python3
# @tool: list_capabilities
# @description: Elara'nın mevcut envanterini (agent/tool/skill/pack/MCP) döndürür — meta-forge planlaması için read-only tarama.
# @args: {"kinds":"array","include_mcp":"boolean"}
# @category: Meta
# @icon: Library
# @color: #a855f7
"""list_capabilities — read-only inventory for meta-forge planning.

stdin JSON: {kinds?: ["agent","tool","skill","pack"], include_mcp?: true}
stdout JSON: {ok, inventory:{agents,tools,skills,packs,mcp_exposed,counts}}
"""
import json
import os
import sys

try:
    import httpx
except ImportError:
    print(json.dumps({"ok": False, "reason": "missing_dependency", "dep": "httpx"}))
    sys.exit(0)


def _read():
    try:
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def main():
    args = _read()
    kinds = set(args.get("kinds") or ["agent", "tool", "skill", "pack"])
    include_mcp = bool(args.get("include_mcp", True))
    base = os.getenv("ELARA_API_BASE", "http://127.0.0.1:3005").rstrip("/")
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=2.0, read=10.0)) as c:
            r = c.get(f"{base}/api/meta-forge/inventory")
            if r.status_code != 200:
                print(json.dumps({"ok": False, "reason": "http", "status": r.status_code}))
                return
            data = r.json().get("inventory") or {}
    except Exception as e:
        print(json.dumps({"ok": False, "reason": "transport", "error": str(e)}))
        return

    out = {"counts": data.get("counts", {})}
    if "agent" in kinds: out["agents"] = data.get("agents", [])
    if "tool"  in kinds: out["tools"] = data.get("tools", [])
    if "skill" in kinds: out["skills"] = data.get("skills", [])
    if "pack"  in kinds: out["packs"] = data.get("packs", [])
    if include_mcp:       out["mcp_exposed"] = data.get("mcp_exposed", [])
    print(json.dumps({"ok": True, "inventory": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
