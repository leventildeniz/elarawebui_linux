#!/usr/bin/env python3
# agents/NetSec/orchestrator.py
# Squad orkestratörü — diğer NetSec ajanlarını koordine eder.
# Tur-1: sadece LLM-üzerinden plan/koordinasyon (audit DB yazımı middleware audit-chain'ine bırakıldı).
# Tur-2: adapter + approval gate ile fiziksel icraat.
# @tools: -
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent  # noqa: E402

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
