#!/usr/bin/env python3
# agents/NetSec/core_architect.py
# OSPF/BGP/STP/VLAN — core network analiz & operasyon.
# @description: OSPF/BGP/STP/VLAN topolojilerini inceler; tasarım hatalarını ve optimizasyon fırsatlarını rapor eder.
# @tools: web_fetch, ai_summarize, cisco_iosxe_restconf, paloalto_xmlapi
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
