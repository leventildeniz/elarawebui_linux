#!/usr/bin/env python3
# @priority: 9
# @stop_grace_ms: 6000
# @icon: TrendingUp
# @color: #06b6d4
# @description: Markanın binebileceği güncel trend, haber ve meme'leri tarar; platform uyumu ve sönme riskiyle birlikte sunar.
# @tools: web_fetch, ai_summarize
"""SocialMedia / trend_radar — what is moving right now.

System prompt comes from DB (meta.systemPrompt) via ELARA_AGENT_SYSTEM_PROMPT.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402


def main(payload: str) -> None:
    stream_chat(payload or "Bu hafta için trend tarayışı yap.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
