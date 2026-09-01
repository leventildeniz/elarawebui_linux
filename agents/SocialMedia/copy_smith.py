#!/usr/bin/env python3
# @priority: 8
# @stop_grace_ms: 6000
# @icon: PenTool
# @color: #a855f7
# @description: Her platform için yerel post kopyası yazar; A/B varyasyon ve net CTA ile (hashtag işi hashtag_alchemist'in).
# @tools: caption_polish, hashtag_score
"""SocialMedia / copy_smith — draft post copy per channel.

System prompt comes from DB (meta.systemPrompt) via ELARA_AGENT_SYSTEM_PROMPT.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402


def main(payload: str) -> None:
    stream_chat(payload or "Verilen konu için post kopyalarını yaz.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
