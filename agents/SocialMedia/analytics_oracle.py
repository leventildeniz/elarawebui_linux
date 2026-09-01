#!/usr/bin/env python3
# @priority: 2
# @stop_grace_ms: 4000
# @icon: BarChart3
# @color: #8b5cf6
# @description: Geçen dönemin metriklerini okur, kısa bir retro çıkarır ve sonraki haftaya kanıta dayalı bir deney (hipotez + metrik + süre) önerir.
# @tools: ai_summarize, file_write_safe
"""SocialMedia / analytics_oracle — retro + next experiment.

System prompt is sourced from the agents table (`meta.systemPrompt`) and
injected at spawn via ELARA_AGENT_SYSTEM_PROMPT. Do NOT define a SYSTEM
constant here — UI is the single source of truth.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402


def main(payload: str) -> None:
    stream_chat(payload or "Geçen haftanın metriklerini analiz et.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
