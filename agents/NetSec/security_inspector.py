#!/usr/bin/env python3
# agents/NetSec/security_inspector.py
# Saf Python — içerik validasyonu (404, malware, vb. forbidden token).
# LLM çağrısı YOK; pre-flight güvenlik mührü.
# @description: Saf Python pre-flight güvenlik mührü — 404, malware, forbidden token tespiti; LLM çağrısı yapmaz.
# @tools: log_analyze, cve_lookup, pcap_summary, paloalto_xmlapi, fortimanager_jsonrpc, checkpoint_smc_login
import sys


FORBIDDEN = ("404", "not found", "access denied", "forbidden", "malware")


def validate_content(raw: str) -> tuple[bool, str]:
    if not raw or len(raw.strip()) < 20:
        return False, "İçerik çok yetersiz, liyakatli bir analiz yapılamıyor."
    low = raw.lower()
    if any(w in low for w in FORBIDDEN):
        return False, "⚠️ Güvenlik uyarısı: İçerikte şüpheli veya kısıtlanmış öğeler tespit edildi."
    return True, raw


if __name__ == "__main__":
    payload = sys.argv[1] if len(sys.argv) > 1 else ""
    ok, msg = validate_content(payload)
    status = "OK" if ok else "BLOCKED"
    print(f"[security_inspector] {status}", flush=True)
    if not ok:
        print(msg, flush=True)
        sys.exit(1)
    print("İçerik liyakatli — sonraki ajana devredilebilir.", flush=True)
