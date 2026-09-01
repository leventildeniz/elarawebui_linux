#!/usr/bin/env python3
# agents/NetSec/edge_dns_guardian.py
# Bluecat, Infoblox, Cloudflare (WAF/MagicTransit/DNS/DDoS).
# @description: Bluecat, Infoblox, Cloudflare (WAF/MagicTransit/DNS/DDoS) için DNSSEC, rate-limit, RPZ ve recursion sertleştirme önerir.
# @tools: dns_lookup, whois_geo, infoblox_wapi, bluecat_rest
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
