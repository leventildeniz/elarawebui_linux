#!/usr/bin/env python3
# @priority: 1
# @stop_grace_ms: 10000
# @icon: ScrollText
# @color: #facc15
# @description: Yayın öncesi son denetim — hukuki risk, marka, platform politikası ve doğrulanmamış iddia kontrolü; APPROVE/REVISE/BLOCK kararı verir.
# @tools: ai_summarize, web_fetch
"""SocialMedia / compliance_warden — last line before publish.

System prompt comes from DB (meta.systemPrompt) via ELARA_AGENT_SYSTEM_PROMPT.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import stream_chat  # noqa: E402


def main(payload: str) -> None:
    stream_chat(payload or "Yayın öncesi son denetimi yap.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
