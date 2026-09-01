#!/usr/bin/env python3
# @priority: 10
# @stop_grace_ms: 8000
# @icon: Megaphone
# @color: #f59e0b
# @description: Editoryal takvimin sahibi — hedefleri 7 günlük temalı içerik brieflerine çevirir (kanal, ton, KPI).
# @tools: ai_summarize, file_write_safe
"""SocialMedia / content_strategist — top-of-funnel planner.

System prompt comes from DB (meta.systemPrompt) via ELARA_AGENT_SYSTEM_PROMPT.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402


def main(payload: str) -> None:
    stream_chat(payload or "Bu hafta için içerik takvimini öner.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
