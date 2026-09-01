#!/usr/bin/env python3
# @tool: web_fetch
# @description: URL'yi çeker; temizlenmiş Markdown ve HTTP metadata döner.
# @args: {"url":"string","timeout_ms":"number","max_bytes":"number"}
# @category: Common
# @icon: Globe
# @color: #0ea5e9
"""web_fetch — URL → {ok, status, title, markdown, headers, final_url, bytes}.

Reads JSON from stdin: {url, timeout_ms?, max_bytes?}.
- Default timeout: 15000ms, hard max 60000ms.
- Default body cap: 5_000_000 bytes (5MB).
- Follows up to 5 redirects (urllib default behaviour).
- HTML → plain text via stdlib HTMLParser; non-HTML → returned as-is text.
"""
import json
import re
import sys
import urllib.request
import urllib.error
from html.parser import HTMLParser


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head"}
    BLOCK = {"p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip_depth = 0
        self.title = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t in self.SKIP:
            self.skip_depth += 1
        if t == "title":
            self.in_title = True
        if t in self.BLOCK:
            self.out.append("\n")
        if t == "li":
            self.out.append("- ")

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in self.SKIP and self.skip_depth > 0:
            self.skip_depth -= 1
        if t == "title":
            self.in_title = False
        if t in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.skip_depth > 0:
            return
        self.out.append(data)


def _read_input():
    try:
        if sys.stdin.isatty():
            return {}
        return json.load(sys.stdin) or {}
    except Exception:
        return {}


def _clean(s: str) -> str:
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def main() -> None:
    p = _read_input()
    url = str(p.get("url") or "").strip()
    if not url:
        print(json.dumps({"ok": False, "reason": "missing_url"})); return
    if not re.match(r"^https?://", url, re.I):
        print(json.dumps({"ok": False, "reason": "scheme_not_allowed"})); return

    timeout_ms = int(p.get("timeout_ms") or 15000)
    timeout_ms = max(1000, min(60000, timeout_ms))
    max_bytes = int(p.get("max_bytes") or 5_000_000)
    max_bytes = max(1024, min(20_000_000, max_bytes))

    req = urllib.request.Request(url, headers={
        "User-Agent": "Elara-WebFetch/1.0",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout_ms / 1000.0) as r:
            raw = r.read(max_bytes + 1)
            truncated = len(raw) > max_bytes
            if truncated:
                raw = raw[:max_bytes]
            status = r.status
            headers = {k: v for k, v in r.headers.items()}
            final_url = r.url
            ctype = (r.headers.get("Content-Type") or "").lower()
    except urllib.error.HTTPError as e:
        print(json.dumps({"ok": False, "reason": "http_error", "status": e.code,
                          "detail": str(e)[:200]})); return
    except urllib.error.URLError as e:
        print(json.dumps({"ok": False, "reason": "transport_error",
                          "detail": str(e)[:200]})); return
    except Exception as e:
        print(json.dumps({"ok": False, "reason": "fetch_failed",
                          "detail": str(e)[:200]})); return

    charset = "utf-8"
    m = re.search(r"charset=([\w-]+)", ctype)
    if m:
        charset = m.group(1)
    try:
        text = raw.decode(charset, errors="replace")
    except LookupError:
        text = raw.decode("utf-8", errors="replace")

    title = ""
    if "html" in ctype or text.lstrip()[:9].lower().startswith("<!doctype") or "<html" in text[:1000].lower():
        ex = _TextExtractor()
        try:
            ex.feed(text)
        except Exception:
            pass
        markdown = _clean("".join(ex.out))
        title = _clean("".join(ex.title))[:300]
    else:
        markdown = _clean(text)
        title = ""

    print(json.dumps({
        "ok": True,
        "status": status,
        "title": title,
        "markdown": markdown[:200_000],
        "headers": {k: headers[k] for k in list(headers)[:20]},
        "final_url": final_url,
        "bytes": len(raw),
        "truncated": truncated,
        "content_type": ctype,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
