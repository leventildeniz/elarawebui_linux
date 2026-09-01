#!/usr/bin/env python3
# @tool: hashtag_score
# @description: Hashtag'leri skorlar ve sıralar (uzunluk, niş uyumu, generic ceza, platform uyumu). Deterministik.
# @args: {"hashtags":"array","platform":"string","niche_keywords":"array"}
# @category: SocialMedia
# @icon: Hash
# @color: #8b5cf6
"""hashtag_score — rank hashtags by deterministic quality score (0-100).

stdin JSON: {hashtags:[...], platform, niche_keywords?:[...]}
- Generic-penalty list optional at tools/_data/generic_hashtags.txt (one tag per line, with or without #).
- Returns ranked list + suggested_drop (score<35).
"""
import json
import os
import re
import sys

PLATFORM_LEN = {
    "x":         {"ideal": (3, 18), "long_penalty_at": 22},
    "instagram": {"ideal": (4, 24), "long_penalty_at": 30},
    "linkedin":  {"ideal": (4, 22), "long_penalty_at": 28},
    "tiktok":    {"ideal": (3, 20), "long_penalty_at": 28},
}

GENERIC_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_data", "generic_hashtags.txt")


def _read():
    try:
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def _load_generics():
    out = set()
    try:
        if os.path.exists(GENERIC_PATH):
            with open(GENERIC_PATH, "r", encoding="utf-8") as fh:
                for line in fh:
                    t = line.strip().lstrip("#").lower()
                    if t:
                        out.add(t)
    except Exception:
        pass
    return out


def _normalize(tag: str) -> str:
    return re.sub(r"\s+", "", str(tag or "")).lstrip("#")


def _score_tag(tag: str, platform: str, niche: list, generics: set):
    reasons = []
    score = 60.0
    norm = _normalize(tag).lower()
    if not norm:
        return 0, ["empty"]
    if not re.match(r"^[\w\u00C0-\uFFFF][\w\u00C0-\uFFFF\d_]*$", norm):
        return 0, ["invalid_chars"]

    length = len(norm)
    rules = PLATFORM_LEN.get(platform, PLATFORM_LEN["instagram"])
    lo, hi = rules["ideal"]
    if length < lo:
        score -= 18; reasons.append(f"too_short({length})")
    elif length > rules["long_penalty_at"]:
        score -= 22; reasons.append(f"too_long({length})")
    elif lo <= length <= hi:
        score += 12; reasons.append("length_ideal")
    else:
        score += 4; reasons.append("length_ok")

    # Niche match
    matched = []
    for kw in niche or []:
        k = str(kw or "").strip().lower()
        if k and k in norm:
            matched.append(k)
    if matched:
        score += min(20, 8 * len(matched))
        reasons.append("niche_match:" + ",".join(matched[:3]))

    # Generic penalty
    if norm in generics:
        score -= 30; reasons.append("generic")

    # All-digits or noisy
    if re.fullmatch(r"\d+", norm):
        score -= 20; reasons.append("all_digits")

    score = max(0, min(100, int(round(score))))
    return score, reasons


def main() -> None:
    p = _read()
    tags = p.get("hashtags")
    platform = str(p.get("platform") or "instagram").strip().lower()
    niche = p.get("niche_keywords") or []

    if not isinstance(tags, list) or not tags:
        print(json.dumps({"ok": False, "reason": "missing_hashtags"})); return
    if platform not in PLATFORM_LEN:
        print(json.dumps({"ok": False, "reason": "unknown_platform",
                          "allowed": list(PLATFORM_LEN.keys())})); return
    if not isinstance(niche, list):
        print(json.dumps({"ok": False, "reason": "niche_keywords_must_be_list"})); return

    generics = _load_generics()

    ranked = []
    for t in tags:
        s, reasons = _score_tag(t, platform, niche, generics)
        ranked.append({"tag": "#" + _normalize(t), "score": s, "reasons": reasons})

    ranked.sort(key=lambda x: (-x["score"], x["tag"]))
    suggested_drop = [r["tag"] for r in ranked if r["score"] < 35]

    print(json.dumps({
        "ok": True,
        "platform": platform,
        "ranked": ranked,
        "suggested_drop": suggested_drop,
        "generics_loaded": len(generics),
        "generics_source": GENERIC_PATH if generics else None,
    })); return


if __name__ == "__main__":
    main()
