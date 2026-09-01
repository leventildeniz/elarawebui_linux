#!/usr/bin/env python3
# @tool: pdf_extract
# @description: PDF dosyasından metin çıkarır (sayfa bazında + metadata).
# @args: {"path":"string","max_pages":"number","start_page":"number"}
# @category: Common
# @icon: FileType
# @color: #e11d48
"""pdf_extract — PDF → {ok, pages:[{n,text}], meta, page_count}.

Reads JSON from stdin: {path, max_pages?, start_page?}.
- Requires pypdf (stdlib does not parse PDF).
- Default max_pages: 50 (hard max 500).
- start_page is 1-based.
- File must exist and be readable. No path whitelist (read-only).
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


def main() -> None:
    p = _read_input()
    path = str(p.get("path") or "").strip()
    if not path:
        print(json.dumps({"ok": False, "reason": "missing_path"})); return
    if not os.path.isfile(path):
        print(json.dumps({"ok": False, "reason": "file_not_found", "path": path})); return

    try:
        from pypdf import PdfReader
    except ImportError:
        print(json.dumps({"ok": False, "reason": "missing_dependency",
                          "detail": "pip install pypdf"})); return

    start = max(1, int(p.get("start_page") or 1))
    max_pages = int(p.get("max_pages") or 50)
    max_pages = max(1, min(500, max_pages))

    try:
        reader = PdfReader(path)
    except Exception as e:
        print(json.dumps({"ok": False, "reason": "pdf_parse_failed",
                          "detail": str(e)[:200]})); return

    page_count = len(reader.pages)
    end = min(page_count, start - 1 + max_pages)
    pages = []
    for i in range(start - 1, end):
        try:
            text = reader.pages[i].extract_text() or ""
        except Exception as e:
            text = f"[extract_error: {str(e)[:120]}]"
        pages.append({"n": i + 1, "text": text[:50_000]})

    meta = {}
    try:
        m = reader.metadata or {}
        for k, v in m.items():
            key = str(k).lstrip("/")
            meta[key] = str(v)[:500]
    except Exception:
        pass

    print(json.dumps({
        "ok": True,
        "page_count": page_count,
        "returned": len(pages),
        "start_page": start,
        "pages": pages,
        "meta": meta,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
