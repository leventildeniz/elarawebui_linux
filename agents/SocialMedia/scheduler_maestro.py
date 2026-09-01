#!/usr/bin/env python3
# @priority: 5
# @stop_grace_ms: 4000
# @icon: CalendarClock
# @color: #3b82f6
# @description: Onaylanan postları kanal başına ideal yayın saatine yerleştirir; aynı kanalda 2 saatten yakın çakışmayı engeller.
# @tools: engagement_window
"""SocialMedia / scheduler_maestro — when does each post go live.

System prompt comes from DB (meta.systemPrompt) via ELARA_AGENT_SYSTEM_PROMPT.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402


def main(payload: str) -> None:
    stream_chat(payload or "Onaylanmış postlar için yayın takvimini kur.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
