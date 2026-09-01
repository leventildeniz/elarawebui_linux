#!/usr/bin/env python3
# agents/NetSec/merit_indexer.py
# Saf regex — devasa konfig'leri kritik kural bloklarına indirir.
# LLM çağrısı YOK; orchestrator/diğer ajanlar için pre-processor.
# @description: Saf regex pre-processor — devasa konfigleri kritik kural bloklarına süzer; LLM çağrısı yapmaz, diğer ajanlar için bağlam hazırlar.
# @tools: web_fetch, ai_summarize, file_write_safe
import re
import sys


def process_large_config(raw_config: str) -> str:
    lines = raw_config.splitlines()
    prioritized = []
    risk_keywords = ("any", "all", "permit", "accept", "disabled")
    current = ""
    is_risky = False
    for line in lines:
        low = line.lower()
        if "edit" in low and "policy" in low:
            if current and is_risky:
                prioritized.append(current)
            current = line + "\n"
            is_risky = False
        else:
            current += line + "\n"
            if any(w in low for w in risk_keywords):
                is_risky = True
    if current and is_risky:
        prioritized.append(current)
    indexed = "\n".join(prioritized[:100])
    return f"INDEXED_MERIT_DATA:\n{indexed}"


if __name__ == "__main__":
    payload = sys.argv[1] if len(sys.argv) > 1 else ""
    if not payload:
        print("🚀 Merit Indexer: DC Savunma Hattı Hazır. stdin yoluyla config ver.", flush=True)
        sys.exit(0)
    # Eğer payload bir dosya yolu ise oku
    try:
        if len(payload) < 512 and "\n" not in payload:
            from pathlib import Path
            p = Path(payload)
            if p.exists() and p.is_file():
                payload = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        pass
    print(process_large_config(payload), flush=True)
