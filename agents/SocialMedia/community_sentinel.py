#!/usr/bin/env python3
# @priority: 3
# @stop_grace_ms: 5000
# @icon: ShieldAlert
# @color: #ef4444
# @description: Mention'ları ve yanıtları izler; sentiment, niyet ve aksiyon önerir, kriz sinyalini erken yakalar.
# @tools: ai_summarize
"""SocialMedia / community_sentinel — sentiment + escalation triage.

System prompt comes from DB (meta.systemPrompt) via ELARA_AGENT_SYSTEM_PROMPT.
Do not hardcode a SYSTEM constant here.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402


def main(payload: str) -> None:
    stream_chat(payload or "Son mention'ları sınıflandır.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
