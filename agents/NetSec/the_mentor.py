#!/usr/bin/env python3
# agents/NetSec/the_mentor.py
# İngilizce sunum koçu — teknik raporu polished English'e çevirir.
# @description: İngilizce sunum koçu — teknik raporu polished English'e çevirir, üst yönetime sunulacak ton ile düzenler.
# @tools: web_fetch, ai_summarize
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
