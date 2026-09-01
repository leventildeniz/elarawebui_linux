#!/usr/bin/env python3
# agents/NetSec/packet_hunter.py
# PCAP / TCP-IP analizi, retransmission, latency, payload anomalisi.
# @description: PCAP/TCP-IP analizi; retransmission, latency, payload anomalisi ve oturum sağlığını çıkartır.
# @tools: pcap_summary, dns_lookup
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
