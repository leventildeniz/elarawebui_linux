#!/usr/bin/env python3
# @tool: file_write_safe
# @description: Yalnız izin verilen dizinlere dosya yazar (sandbox).
# @args: {"path":"string","content":"string","mode":"string","encoding":"string"}
# @category: Common
# @icon: FileText
# @color: #22c55e
"""file_write_safe — path-restricted writer.

Reads JSON from stdin: {path, content, mode?, encoding?}.
- Allowed roots (default): /mnt/documents, <repo>/tools/_workdir
  Override with FILE_WRITE_SAFE_ROOTS (colon-separated absolute paths).
- Symlinks are resolved before checking; the resolved path MUST live under
  an allowed root.
- mode: "write" (default) or "append".
- Max size: 10MB (override FILE_WRITE_SAFE_MAX_BYTES).
"""
import json
import os
import sys


def _read_input():
    try:
        if sys.stdin.isatty():
            return {}
        return json.load(sys.stdin) or {}
    except Exception:
        return {}


def _default_roots():
    here = os.path.dirname(os.path.abspath(__file__))           # tools/
    repo = os.path.abspath(os.path.join(here, ".."))            # repo root
    workdir = os.path.join(repo, "tools", "_workdir")
    return ["/mnt/documents", workdir]


def _roots():
    raw = os.environ.get("FILE_WRITE_SAFE_ROOTS")
    if raw:
        return [os.path.abspath(x) for x in raw.split(":") if x.strip()]
    return [os.path.abspath(x) for x in _default_roots()]


def _under_any(path: str, roots: list[str]) -> bool:
    p = os.path.abspath(path) + os.sep
    return any(p.startswith(os.path.abspath(r).rstrip(os.sep) + os.sep) for r in roots)


def main() -> None:
    p = _read_input()
    raw_path = str(p.get("path") or "").strip()
    if not raw_path:
        print(json.dumps({"ok": False, "reason": "missing_path"})); return
    content = p.get("content")
    if content is None:
        print(json.dumps({"ok": False, "reason": "missing_content"})); return
    if not isinstance(content, str):
        try:
            content = json.dumps(content, ensure_ascii=False)
        except Exception:
            print(json.dumps({"ok": False, "reason": "bad_content"})); return

    mode = (p.get("mode") or "write").lower()
    if mode not in ("write", "append"):
        print(json.dumps({"ok": False, "reason": "bad_mode"})); return
    encoding = str(p.get("encoding") or "utf-8")

    max_bytes = int(os.environ.get("FILE_WRITE_SAFE_MAX_BYTES") or 10 * 1024 * 1024)
    payload = content.encode(encoding, errors="replace")
    if len(payload) > max_bytes:
        print(json.dumps({"ok": False, "reason": "too_large",
                          "bytes": len(payload), "max_bytes": max_bytes})); return

    roots = _roots()
    abs_path = os.path.abspath(raw_path)
    # Resolve symlinks for the parent (file may not exist yet).
    parent = os.path.dirname(abs_path) or "/"
    try:
        real_parent = os.path.realpath(parent)
    except Exception:
        real_parent = parent
    resolved = os.path.join(real_parent, os.path.basename(abs_path))

    if not _under_any(resolved, roots):
        print(json.dumps({"ok": False, "reason": "path_not_allowed",
                          "resolved": resolved, "allowed_roots": roots})); return

    try:
        os.makedirs(real_parent, exist_ok=True)
        flag = "ab" if mode == "append" else "wb"
        with open(resolved, flag) as f:
            f.write(payload)
        size = os.path.getsize(resolved)
    except Exception as e:
        print(json.dumps({"ok": False, "reason": "write_failed",
                          "detail": str(e)[:200]})); return

    print(json.dumps({"ok": True, "path": resolved, "bytes": size, "mode": mode},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
