#!/usr/bin/env python3
# agents/NetSec/db_guardian.py
# PostgreSQL/MySQL/MariaDB/Oracle/MS-SQL — DBA analiz & operasyon.
# @description: PostgreSQL/MySQL/MariaDB/Oracle/MS-SQL için DBA analizi; rol, grant, injection yüzeyi ve audit kontrol listesi.
# @tools: log_analyze, cve_lookup, http_probe
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
