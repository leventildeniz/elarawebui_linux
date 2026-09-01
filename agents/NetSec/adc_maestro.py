#!/usr/bin/env python3
# agents/NetSec/adc_maestro.py
# F5 LTM/GTM + Citrix NetScaler analiz & operasyon ajanı.
# System prompt + parametreler middleware tarafından env üzerinden enjekte edilir.
# @description: F5 LTM/GTM ve Citrix NetScaler için sağlık, persistence, SSL-offload analizi ve değişiklik önerisi üretir.
# @tools: http_probe, dns_lookup, f5_nitro, citrix_adc_nitro, a10_axapi
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
