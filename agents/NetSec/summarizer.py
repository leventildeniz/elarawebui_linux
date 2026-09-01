#!/usr/bin/env python3
# agents/NetSec/summarizer.py
# Teknik raporları executive summary'ye süzer.
# @description: Teknik raporları yönetici özetine süzer; ham sayfaları 3-7 madde + kritik bulgu + öneri olarak verir.
# @tools: ai_summarize, file_write_safe
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
