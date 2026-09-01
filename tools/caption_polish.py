#!/usr/bin/env python3
# @tool: caption_polish
# @description: Sosyal medya başlığını platform kurallarına göre düzenler (uzunluk, hashtag/emoji yoğunluğu). Deterministik, LLM kullanmaz.
# @args: {"text":"string","platform":"string","tone":"string","max_length":"number","strip_excess":"boolean"}
# @category: SocialMedia
# @icon: Type
# @color: #f59e0b
"""caption_polish — normalize/clip a caption for a target platform.

stdin JSON: {text, platform, tone?, max_length?, strip_excess?}
- platform: instagram | linkedin | x | tiktok
- tone: neutral (default) | playful | pro  (pro strips emojis)
- strip_excess: when true, drop hashtags/emojis above recommended cap
- Hard cap always enforced; soft caps surfaced as warnings.
"""
import json
import re
import sys

RULES = {
    "x":         {"hard": 280,  "rec_len": 240,  "hashtag_max": 2,  "emoji_max": 3},
    "instagram": {"hard": 2200, "rec_len": 150,  "hashtag_max": 30, "emoji_max": 10},
    "linkedin":  {"hard": 3000, "rec_len": 200,  "hashtag_max": 5,  "emoji_max": 2},
    "tiktok":    {"hard": 2200, "rec_len": 100,  "hashtag_max": 5,  "emoji_max": 5},
}

HASHTAG_RE = re.compile(r"(?<!\w)#[\w\u00C0-\uFFFF][\w\u00C0-\uFFFF\d_]{0,138}")

# Emoji ranges (broad — enough for density count, not pixel-perfect).
EMOJI_RE = re.compile(
    "[" 
    "\U0001F300-\U0001F6FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA70-\U0001FAFF"
    "\U00002600-\U000027BF"
    "]",
    flags=re.UNICODE,
)


def _read():
    try:
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def main() -> None:
    p = _read()
    text = p.get("text")
    platform = str(p.get("platform") or "").strip().lower()
    tone = str(p.get("tone") or "neutral").strip().lower()
    strip_excess = bool(p.get("strip_excess"))
    max_length_override = p.get("max_length")

    if not isinstance(text, str) or not text.strip():
        print(json.dumps({"ok": False, "reason": "missing_text"})); return
    if platform not in RULES:
        print(json.dumps({"ok": False, "reason": "unknown_platform",
                          "allowed": list(RULES.keys())})); return

    rules = RULES[platform]
    hard_cap = rules["hard"]
    if isinstance(max_length_override, (int, float)) and 10 <= int(max_length_override) <= hard_cap:
        hard_cap = int(max_length_override)

    original_len = len(text)
    warnings = []
    stripped = {"hashtags": 0, "emojis": 0}

    # Normalize whitespace
    polished = re.sub(r"[ \t]+", " ", text)
    polished = re.sub(r"\n{3,}", "\n\n", polished).strip()

    # Count hashtags/emojis
    hashtags = HASHTAG_RE.findall(polished)
    emojis = EMOJI_RE.findall(polished)

    # Hashtag handling
    if len(hashtags) > rules["hashtag_max"]:
        warnings.append(f"hashtags_over_recommended:{len(hashtags)}>{rules['hashtag_max']}")
        if strip_excess:
            keep = set(hashtags[: rules["hashtag_max"]])
            drop = hashtags[rules["hashtag_max"]:]
            stripped["hashtags"] = len(drop)
            # Remove from end-first occurrences
            for tag in drop:
                # remove last occurrence
                idx = polished.rfind(tag)
                if idx >= 0:
                    polished = (polished[:idx] + polished[idx + len(tag):]).rstrip()
            polished = re.sub(r"[ \t]+", " ", polished).strip()

    # Emoji handling
    emoji_cap = 0 if tone == "pro" else rules["emoji_max"]
    if len(emojis) > emoji_cap:
        warnings.append(f"emojis_over_recommended:{len(emojis)}>{emoji_cap}")
        if strip_excess or tone == "pro":
            if tone == "pro":
                polished = EMOJI_RE.sub("", polished)
                stripped["emojis"] = len(emojis)
            else:
                # Keep first N emojis; strip rest
                count = 0
                def _keep_or_strip(m):
                    nonlocal count
                    count += 1
                    if count <= emoji_cap:
                        return m.group(0)
                    stripped["emojis"] += 1
                    return ""
                polished = EMOJI_RE.sub(_keep_or_strip, polished)
            polished = re.sub(r"[ \t]+", " ", polished).strip()

    # Hard length cap
    if len(polished) > hard_cap:
        warnings.append(f"length_exceeded_hard_cap:{len(polished)}>{hard_cap}")
        cut = polished[: hard_cap - 1].rstrip()
        polished = cut + "…"

    # Recommended length advisory
    if len(polished) > rules["rec_len"]:
        warnings.append(f"length_over_recommended:{len(polished)}>{rules['rec_len']}")

    print(json.dumps({
        "ok": True,
        "platform": platform,
        "tone": tone,
        "original_len": original_len,
        "polished": polished,
        "polished_len": len(polished),
        "hashtag_count": len(HASHTAG_RE.findall(polished)),
        "emoji_count": len(EMOJI_RE.findall(polished)),
        "warnings": warnings,
        "stripped": stripped,
        "hard_cap": hard_cap,
        "recommended_len": rules["rec_len"],
    })); return


if __name__ == "__main__":
    main()
