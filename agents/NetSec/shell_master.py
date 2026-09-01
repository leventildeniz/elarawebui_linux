#!/usr/bin/env python3
# agents/NetSec/shell_master.py
# Linux/sistem çıktısı analizi (Tur-1: sadece analyzer).
# Tur-2: subprocess whitelist + approval gate ile gerçek shell executor.
# @description: Linux/sistem çıktısı analizi; Tur-2'de subprocess whitelist + onay kapısı ile gerçek shell executor olacak.
# @tools: shell_exec, log_analyze, file_write_safe
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
