#!/usr/bin/env python3
# @tool: cve_lookup
# @description: CIRCL public CVE API üzerinden ID veya anahtar kelime ile CVE sorgular.
# @args: {"cve_id":"string","keyword":"string","limit":"number"}
# @category: NetSec
# @icon: ShieldAlert
# @color: #dc2626
"""cve_lookup — CVE-ID or keyword → CIRCL CVE summary list.

stdin JSON: {cve_id?, keyword?, limit?}
- Exactly one of cve_id / keyword required.
- cve_id: CVE-YYYY-NNNN[…] pattern.
- keyword: 2-100 char, ASCII printable.
- limit: default 20, max 100.
- Stdlib only (urllib). Endpoint: https://cve.circl.lu
"""
import json
import re
import ssl
import sys
import urllib.error
import urllib.request

CIRCL_BASE = "https://cve.circl.lu/api"
CVE_ID_RE = re.compile(r"^CVE-\d{4}-\d{4,12}$", re.I)


def _read():
    try:
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def _fetch(url: str, timeout: float = 10.0):
    req = urllib.request.Request(url, headers={
        "User-Agent": "ELARA-cve-lookup/1.0",
        "Accept": "application/json",
    })
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        body = r.read(8 * 1024 * 1024)
        return json.loads(body.decode("utf-8", errors="replace"))


def _pick_cvss(metrics: list):
    """Walk a metrics list and return the highest baseScore + severity found."""
    best = None
    for m in metrics or []:
        if not isinstance(m, dict):
            continue
        for key in ("cvssV4_0", "cvssV3_1", "cvssV3_0", "cvssV2_0"):
            blk = m.get(key)
            if isinstance(blk, dict):
                try:
                    score = float(blk.get("baseScore"))
                except (TypeError, ValueError):
                    continue
                sev = blk.get("baseSeverity") or ""
                if best is None or score > best[0]:
                    best = (score, sev.lower() or None)
    return best


def _normalize(item: dict) -> dict:
    """Handle both CIRCL legacy and CVE 5.x JSON Record format."""
    if not isinstance(item, dict):
        return {}

    # CVE 5.x shape
    if item.get("dataType") == "CVE_RECORD" or "cveMetadata" in item:
        meta = item.get("cveMetadata") or {}
        containers = item.get("containers") or {}
        cna = containers.get("cna") or {}
        adps = containers.get("adp") or []
        if not isinstance(adps, list):
            adps = []

        # Description: prefer English from CNA
        summary = ""
        for d in cna.get("descriptions") or []:
            if isinstance(d, dict) and d.get("lang", "en").lower().startswith("en"):
                summary = str(d.get("value") or "")[:1000]
                break

        # CVSS: try CNA first, then any ADP (CISA-ADP usually has full V3.1)
        best = _pick_cvss(cna.get("metrics") or [])
        for adp in adps:
            if isinstance(adp, dict):
                b = _pick_cvss(adp.get("metrics") or [])
                if b and (best is None or b[0] > best[0]):
                    best = b

        score, sev = (best if best else (None, None))
        if score is not None and not sev:
            if score >= 9.0: sev = "critical"
            elif score >= 7.0: sev = "high"
            elif score >= 4.0: sev = "medium"
            else: sev = "low"

        # References: merge CNA + ADP urls
        refs = []
        for r in (cna.get("references") or []):
            if isinstance(r, dict) and r.get("url"): refs.append(r["url"])
        for adp in adps:
            for r in (adp.get("references") or []) if isinstance(adp, dict) else []:
                if isinstance(r, dict) and r.get("url"): refs.append(r["url"])

        return {
            "id": meta.get("cveId"),
            "cvss": score,
            "severity": sev,
            "summary": summary,
            "published": meta.get("datePublished"),
            "modified": meta.get("dateUpdated"),
            "refs": refs[:20],
        }

    # Legacy CIRCL shape (kept for backward compatibility)
    cvss = item.get("cvss") or item.get("cvss3") or item.get("cvss2")
    try:
        cvss = float(cvss) if cvss is not None else None
    except Exception:
        cvss = None
    sev = None
    if isinstance(cvss, (int, float)):
        if cvss >= 9.0: sev = "critical"
        elif cvss >= 7.0: sev = "high"
        elif cvss >= 4.0: sev = "medium"
        else: sev = "low"
    refs = item.get("references") or item.get("refs") or []
    if not isinstance(refs, list):
        refs = []
    return {
        "id": item.get("id") or item.get("cveId"),
        "cvss": cvss,
        "severity": sev,
        "summary": (item.get("summary") or item.get("description") or "")[:1000],
        "published": item.get("Published") or item.get("published"),
        "modified": item.get("Modified") or item.get("modified"),
        "refs": refs[:20],
    }


def main() -> None:
    p = _read()
    cve_id = str(p.get("cve_id") or "").strip().upper()
    keyword = str(p.get("keyword") or "").strip()
    limit = max(1, min(100, int(p.get("limit") or 20)))

    if not cve_id and not keyword:
        print(json.dumps({"ok": False, "reason": "missing_query",
                          "hint": "provide cve_id or keyword"})); return
    if cve_id and not CVE_ID_RE.match(cve_id):
        print(json.dumps({"ok": False, "reason": "invalid_cve_id"})); return
    if keyword and len(keyword) < 2:
        print(json.dumps({"ok": False, "reason": "keyword_too_short"})); return
    if keyword and len(keyword) > 100:
        print(json.dumps({"ok": False, "reason": "keyword_too_long"})); return
    if keyword and not all(0x20 <= ord(c) < 0x7f for c in keyword):
        print(json.dumps({"ok": False, "reason": "keyword_not_ascii"})); return

    try:
        if cve_id:
            data = _fetch(f"{CIRCL_BASE}/cve/{cve_id}")
            items = [_normalize(data)] if data else []
        else:
            # CIRCL switched to /api/search/text/<kw> for keyword search.
            data = _fetch(f"{CIRCL_BASE}/search/text/{urllib.request.quote(keyword)}")
            if isinstance(data, dict):
                raw = data.get("results") or data.get("hits") or data.get("data") or []
            elif isinstance(data, list):
                raw = data
            else:
                raw = []
            items = [_normalize(x) for x in raw[:limit]]
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(json.dumps({"ok": True, "items": []})); return
        print(json.dumps({"ok": False, "reason": "http_error",
                          "status": e.code, "detail": str(e)[:200]})); return
    except urllib.error.URLError as e:
        print(json.dumps({"ok": False, "reason": "network_error",
                          "detail": str(e)[:200]})); return
    except (ValueError, json.JSONDecodeError) as e:
        print(json.dumps({"ok": False, "reason": "bad_response",
                          "detail": str(e)[:200]})); return

    items = [x for x in items if x.get("id")]
    print(json.dumps({"ok": True, "items": items, "count": len(items)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
