#!/usr/bin/env python3
# @tool: engagement_window
# @description: Platform/zaman dilimi/güne göre optimal paylaşım pencerelerini önerir. Deterministik tablo.
# @args: {"platform":"string","timezone":"string","day_of_week":"number","audience_region":"string"}
# @category: SocialMedia
# @icon: Clock
# @color: #10b981
"""engagement_window — recommended posting time windows.

stdin JSON: {platform, timezone, day_of_week?, audience_region?}
- platform: instagram | linkedin | x | tiktok
- timezone: IANA name (e.g. Europe/Istanbul, America/New_York)
- day_of_week: 0=Mon … 6=Sun; omit → return whole week
- audience_region: tr | us | eu (optional shift hint, currently informational)
"""
import json
import sys
from datetime import datetime
try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:
    ZoneInfo = None
    ZoneInfoNotFoundError = Exception

# Platform × day-of-week windows.
# Source: industry benchmarks (Hootsuite/Sprout/Buffer 2023-2024 aggregates).
# Tuple: (start_hour, end_hour, score, reason)
MATRIX = {
    "instagram": {
        0: [(11, 13, 0.90, "weekday lunch"), (19, 21, 0.95, "weekday evening peak")],
        1: [(11, 13, 0.92, "weekday lunch"), (19, 21, 0.96, "weekday evening peak")],
        2: [(11, 13, 0.93, "midweek lunch"), (19, 21, 0.97, "midweek evening peak")],
        3: [(11, 13, 0.91, "weekday lunch"), (19, 21, 0.94, "weekday evening peak")],
        4: [(11, 13, 0.88, "friday lunch"),  (17, 19, 0.90, "friday wind-down")],
        5: [(10, 12, 0.85, "saturday morning"), (20, 22, 0.92, "saturday late evening")],
        6: [(10, 12, 0.86, "sunday morning"),   (19, 21, 0.93, "sunday evening peak")],
    },
    "linkedin": {
        0: [(8, 10, 0.92, "monday morning commute"), (12, 13, 0.85, "lunch break")],
        1: [(8, 10, 0.95, "tuesday morning peak"),   (17, 18, 0.88, "end of day")],
        2: [(8, 10, 0.96, "wednesday morning peak"), (12, 13, 0.87, "lunch break")],
        3: [(8, 10, 0.93, "thursday morning"),       (17, 18, 0.86, "end of day")],
        4: [(9, 11, 0.80, "friday morning")],
        5: [(10, 11, 0.55, "saturday low engagement")],
        6: [(18, 20, 0.65, "sunday pre-week planning")],
    },
    "x": {
        0: [(8, 10, 0.88, "morning commute"), (13, 14, 0.85, "lunch"), (18, 20, 0.90, "evening")],
        1: [(8, 10, 0.90, "morning commute"), (13, 14, 0.86, "lunch"), (18, 20, 0.92, "evening")],
        2: [(8, 10, 0.91, "morning commute"), (13, 14, 0.87, "lunch"), (18, 20, 0.93, "evening peak")],
        3: [(8, 10, 0.89, "morning commute"), (13, 14, 0.85, "lunch"), (18, 20, 0.90, "evening")],
        4: [(9, 11, 0.84, "friday morning"),  (17, 19, 0.86, "friday evening")],
        5: [(10, 12, 0.78, "saturday morning"), (20, 22, 0.83, "saturday night")],
        6: [(11, 13, 0.80, "sunday brunch"),    (19, 21, 0.85, "sunday evening")],
    },
    "tiktok": {
        0: [(6, 9, 0.85, "morning scroll"),   (19, 22, 0.95, "evening primetime")],
        1: [(6, 9, 0.86, "morning scroll"),   (19, 22, 0.96, "evening primetime")],
        2: [(6, 9, 0.85, "morning scroll"),   (19, 22, 0.97, "evening primetime")],
        3: [(6, 9, 0.84, "morning scroll"),   (19, 22, 0.95, "evening primetime")],
        4: [(7, 9, 0.82, "friday morning"),   (19, 23, 0.94, "friday night")],
        5: [(9, 12, 0.88, "saturday morning"),(20, 23, 0.96, "saturday primetime")],
        6: [(9, 12, 0.89, "sunday morning"),  (19, 22, 0.93, "sunday evening")],
    },
}

DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
REGION_HINT = {"tr": "Europe/Istanbul", "us": "America/New_York", "eu": "Europe/Berlin"}


def _read():
    try:
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def _windows_for(platform: str, dow: int):
    out = []
    for (sh, eh, score, reason) in MATRIX[platform].get(dow, []):
        out.append({
            "start": f"{sh:02d}:00",
            "end":   f"{eh:02d}:00",
            "score": score,
            "reason": reason,
        })
    return out


def main() -> None:
    p = _read()
    platform = str(p.get("platform") or "").strip().lower()
    tz_name = str(p.get("timezone") or "").strip()
    dow = p.get("day_of_week")
    region = str(p.get("audience_region") or "").strip().lower() or None

    if platform not in MATRIX:
        print(json.dumps({"ok": False, "reason": "unknown_platform",
                          "allowed": list(MATRIX.keys())})); return
    if not tz_name:
        print(json.dumps({"ok": False, "reason": "missing_timezone"})); return
    if ZoneInfo is None:
        print(json.dumps({"ok": False, "reason": "missing_dependency",
                          "detail": "Python 3.9+ required for zoneinfo"})); return
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        print(json.dumps({"ok": False, "reason": "invalid_timezone", "value": tz_name})); return
    except Exception as e:
        print(json.dumps({"ok": False, "reason": "invalid_timezone", "detail": str(e)[:120]})); return

    now_local = datetime.now(tz)
    if dow is None:
        weekly = {}
        for d in range(7):
            weekly[DAY_NAMES[d]] = _windows_for(platform, d)
        out = {
            "ok": True,
            "platform": platform,
            "timezone": tz_name,
            "weekly": weekly,
            "audience_region": region,
            "region_hint_tz": REGION_HINT.get(region),
            "generated_at": now_local.isoformat(),
        }
    else:
        try:
            dow_i = int(dow)
        except Exception:
            print(json.dumps({"ok": False, "reason": "invalid_day_of_week"})); return
        if dow_i < 0 or dow_i > 6:
            print(json.dumps({"ok": False, "reason": "day_of_week_out_of_range"})); return
        out = {
            "ok": True,
            "platform": platform,
            "timezone": tz_name,
            "day_of_week": dow_i,
            "day_name": DAY_NAMES[dow_i],
            "windows": _windows_for(platform, dow_i),
            "audience_region": region,
            "region_hint_tz": REGION_HINT.get(region),
            "generated_at": now_local.isoformat(),
        }

    print(json.dumps(out)); return


if __name__ == "__main__":
    main()
