#!/usr/bin/env python3
# agents/NetSec/researcher.py
# Gemini + Google Search — canlı istihbarat damarı.
# API key SADECE env'den (GEMINI_API_KEY).
# @description: Gemini + Google Search ile canlı istihbarat damarı — CVE bülteni, vendor advisory, son 24 saat haber.
# @tools: web_fetch, ai_summarize, cve_lookup
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.gemini_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
