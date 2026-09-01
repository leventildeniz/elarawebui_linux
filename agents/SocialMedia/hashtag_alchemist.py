#!/usr/bin/env python3
# @priority: 6
# @stop_grace_ms: 4000
# @icon: Hash
# @color: #14b8a6
# @description: Platforma göre erişim ve niş etkileşim arasında dengelenmiş hashtag setleri kurar; doygun ve yasaklı etiketleri eler.
# @tools: hashtag_score, ai_summarize
"""SocialMedia / hashtag_alchemist — channel-aware hashtag selection.

System prompt comes from DB (meta.systemPrompt) via ELARA_AGENT_SYSTEM_PROMPT.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402


def main(payload: str) -> None:
    stream_chat(payload or "Verilen konular için hashtag setlerini öner.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
