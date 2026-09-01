#!/usr/bin/env python3
# @tool: log_analyze
# @description: Log metnini ayrıştırır; severity sınıflandırması, histogram ve en sık hataları döner.
"""SYS tool · log.analyze — parse log text + classify severity.

Contract:
  argv[1] = JSON { "source": str?, "input": str? } OR raw log text.
  If `input` is absent and `source` is a readable file path, reads that file.

Output: JSON {
  ok, source, lines, severity (max), histogram, top_errors:[{count,line}], sample
}
"""
import os, sys, json, re, collections

SEV_RANK = {"debug": 0, "info": 1, "notice": 2, "warning": 3, "warn": 3,
            "error": 4, "err": 4, "critical": 5, "crit": 5, "alert": 6, "emergency": 7, "emerg": 7}
SEV_RE = re.compile(r"\b(emerg(?:ency)?|alert|crit(?:ical)?|err(?:or)?|warn(?:ing)?|notice|info|debug)\b", re.I)

def parse_args():
    if len(sys.argv) < 2: return {}
    raw = sys.argv[1]
    if raw and raw.lstrip().startswith("{"):
        try: return json.loads(raw)
        except Exception: pass
    return {"input": raw}

def main():
    p = parse_args()
    text = str(p.get("input") or "").strip()
    src  = str(p.get("source") or "").strip()
    if not text and src and os.path.isfile(src):
        try:
            with open(src, "r", encoding="utf-8", errors="replace") as f: text = f.read()
        except Exception as e:
            print(json.dumps({"ok": False, "error": "read_failed", "detail": str(e)})); return
    if not text:
        print(json.dumps({"ok": False, "error": "empty_input",
                          "hint": "Pass log text via params.input or a readable file path via params.source."}))
        return

    lines = text.splitlines()
    hist = collections.Counter()
    max_sev = "info"; max_rank = 1
    err_counter = collections.Counter()
    for ln in lines:
        m = SEV_RE.search(ln)
        sev = (m.group(1).lower() if m else "info")
        canon = {"warn": "warning", "err": "error", "crit": "critical", "emerg": "emergency"}.get(sev, sev)
        hist[canon] += 1
        r = SEV_RANK.get(canon, 1)
        if r > max_rank: max_rank, max_sev = r, canon
        if r >= 4:
            err_counter[ln.strip()[:240]] += 1

    top = [{"count": c, "line": l} for l, c in err_counter.most_common(5)]
    print(json.dumps({
        "ok": True,
        "source": src or "inline",
        "lines": len(lines),
        "severity": max_sev,
        "histogram": dict(hist),
        "top_errors": top,
        "sample": lines[:3],
    }))

if __name__ == "__main__":
    main()
