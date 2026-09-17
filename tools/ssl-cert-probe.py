#!/usr/bin/env python3
# @tool: ssl-cert-probe
# @description: Inspects SSL/TLS certificate validity, issuer, start date, expiration date, and remaining lifetime in days for a target domain or host.
# @args: {"domain": "string"}
import sys
import json
import ssl
import socket
from datetime import datetime, timezone

def _read_input():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            return json.loads(sys.argv[1])
        if not sys.stdin.isatty():
            raw = sys.stdin.read().strip()
            if raw:
                return json.loads(raw)
        return {}
    except Exception:
        return {}

def main():
    try:
        input_data = _read_input()
        domain = input_data.get("domain") or input_data.get("url") or input_data.get("host") or input_data.get("target")
        if not domain:
            print(json.dumps({"ok": False, "error": "Missing domain parameter"}))
            return

        # Sanitize domain from protocols, ports, and subpaths
        if "://" in domain:
            domain = domain.split("://")[-1]
        domain = domain.split("/")[0].split(":")[0].strip()

        if not domain:
            print(json.dumps({"ok": False, "error": "Invalid domain specification"}))
            return

        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=8) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                expiry_str = cert.get("notAfter")
                start_str = cert.get("notBefore")
                issuer = cert.get("issuer")

                # Extract human-readable issuer
                issuer_parts = []
                for rdn in (issuer or []):
                    for k, v in rdn:
                        if k in ("organizationName", "commonName"):
                            issuer_parts.append(v)
                issuer_display = " - ".join(issuer_parts) if issuer_parts else "Unknown Issuer"

                expiry_dt = datetime.strptime(expiry_str, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc) if expiry_str else None
                start_dt = datetime.strptime(start_str, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc) if start_str else None
                now_dt = datetime.now(timezone.utc)

                days_remaining = (expiry_dt - now_dt).days if expiry_dt else 0

                # Standardized NetSec risk classification
                if days_remaining <= 0:
                    status = "expired"
                elif days_remaining <= 14:
                    status = "critical"
                elif days_remaining <= 30:
                    status = "warning"
                else:
                    status = "healthy"

                print(json.dumps({
                    "ok": True,
                    "domain": domain,
                    "status": status,
                    "days_remaining": days_remaining,
                    "expiry_date": expiry_str,
                    "valid_from": start_str,
                    "iso_expiry": expiry_dt.isoformat() if expiry_dt else None,
                    "issuer": issuer_display,
                    "checked_at": now_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
                }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))

if __name__ == "__main__":
    main()
