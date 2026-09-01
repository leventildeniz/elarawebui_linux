#!/usr/bin/env python3
# agents/NetSec/red_team_operator.py
# Ofansif güvenlik, pentest, exploit analizi.
# @description: Ofansif güvenlik bakış açısı — pentest senaryosu, exploit zinciri ve saldırı yüzeyi analizi (sadece rapor, exec yok).
# @tools: http_probe, cve_lookup, dns_lookup, paloalto_xmlapi, checkpoint_smc_login
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
