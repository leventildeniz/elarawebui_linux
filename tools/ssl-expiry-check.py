#!/usr/bin/env python3
# @tool: ssl-expiry-check
# @description: Checks SSL certificate expiration and validity for a given domain.
# @args: {"domain":"string"}
import socket
import ssl
import json
import sys
from datetime import datetime

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
        domain = input_data.get('domain') or input_data.get('url') or input_data.get('host')
        if domain and ("://" in domain or "/" in domain):
            domain = domain.split("://")[-1].split("/")[0].split(":")[0]
        if not domain:
            print(json.dumps({'ok': False, 'error': 'Missing domain parameter'}))
            return

        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                expiry_date = cert.get('notAfter')
                start_date = cert.get('notBefore')
                issuer = cert.get('issuer')
                
                # Format issuer
                issuer_str = ", ".join([f"{k}={v}" for rdn in (issuer or []) for k, v in rdn]) if issuer else ""
                
                # Format: 'Feb 15 12:00:00 2025 GMT'
                dt = datetime.strptime(expiry_date, '%b %d %H:%M:%S %Y %Z') if expiry_date else None
                days_left = (dt - datetime.utcnow()).days if dt else None
                
                print(json.dumps({
                    'ok': True,
                    'domain': domain,
                    'issuer': issuer_str,
                    'valid_from': start_date,
                    'expiry_date': expiry_date,
                    'iso_date': dt.isoformat() if dt else None,
                    'days_remaining': days_left,
                    'status': 'valid' if (days_left is not None and days_left > 0) else 'expired'
                }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))

if __name__ == '__main__':
    main()