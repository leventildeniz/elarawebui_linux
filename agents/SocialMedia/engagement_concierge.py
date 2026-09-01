#!/usr/bin/env python3
# @priority: 4
# @stop_grace_ms: 4000
# @icon: MessageCircle
# @color: #22c55e
# @description: Yorum, DM ve quote-post'lara marka tonunda hızlı yanıt taslakları çıkarır; gerektiğinde compliance/sentinel'e eskale eder.
# @tools: caption_polish
"""SocialMedia / engagement_concierge — first responder voice.

System prompt comes from DB (meta.systemPrompt) via ELARA_AGENT_SYSTEM_PROMPT.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402


def main(payload: str) -> None:
    stream_chat(payload or "Gelen yorum/DM için yanıt taslağı çıkar.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
