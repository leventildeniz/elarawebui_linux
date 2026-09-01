#!/usr/bin/env python3
# agents/NetSec/remote_access_sentry.py
# Ivanti Pulse, SSL-VPN, ZTNA — uzak erişim log analizi.
# @description: Ivanti Pulse, SSL-VPN, ZTNA log analizi; MFA, split-tunnel, idle-timeout ve posture-check kontrolleri.
# @tools: dns_lookup, http_probe, log_analyze, paloalto_xmlapi, fortimanager_jsonrpc
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
