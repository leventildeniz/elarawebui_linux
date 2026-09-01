#!/usr/bin/env python3
# agents/NetSec/ddos_warlord.py
# A10 TPS/aGalaxy, Arbor — DDoS savunma & saldırı tipi sınıflandırma.
# @description: A10 TPS/aGalaxy ve Arbor sinyallerini okuyup DDoS saldırı tipini sınıflandırır; L3/L4/L7 mitigasyon adımları önerir.
# @tools: http_probe, dns_lookup, log_analyze, f5_nitro, citrix_adc_nitro, paloalto_xmlapi
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
