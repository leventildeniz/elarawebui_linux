#!/usr/bin/env python3
# @priority: 7
# @stop_grace_ms: 6000
# @icon: Image
# @color: #ec4899
# @description: Tasarımcı veya görsel modeli için sanat yönetimi brief'i üretir (konu, kompozisyon, palet, tipografi, en-boy oranı).
# @tools: image_compose, ai_summarize
"""SocialMedia / visual_brief — describe the visual, not generate it.

System prompt comes from DB (meta.systemPrompt) via ELARA_AGENT_SYSTEM_PROMPT.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402


def main(payload: str) -> None:
    stream_chat(payload or "Verilen postlar için görsel brief üret.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
