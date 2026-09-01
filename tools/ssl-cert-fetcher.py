#!/usr/bin/env python3
# @tool: ssl-cert-fetcher
import socket
import ssl
import json
import sys
from datetime import datetime

def get_ssl_expiry(domain):
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                # Date format: 'Oct 15 12:00:00 2025 GMT'
                expiry_str = cert['notAfter']
                expiry_date = datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y %Z')
                return {"status": "success", "domain": domain, "expiry_date": expiry_date.isoformat(), "raw": expiry_str}
    except Exception as e:
        return {"status": "error", "domain": domain, "message": str(e)}

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        domain = input_data.get("domain")
        if not domain:
            print(json.dumps({"status": "error", "message": "No domain provided"}))
        else:
            print(json.dumps(get_ssl_expiry(domain)))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))