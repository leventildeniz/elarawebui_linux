#!/usr/bin/env python3
# @description: Connects to a domain via SSL/TLS to extract the certificate expiration date and calculate days remaining.
# @tool: ssl-expiry-checker
import socket
import ssl
import json
import sys
from datetime import datetime

def get_ssl_expiry(hostname):
    try:
        context = ssl.create_default_context()
        with socket.create_connection((hostname, 443), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert = ssock.getpeercert()
                # Date format: 'Feb 14 12:00:00 2025 GMT'
                expiry_str = cert['notAfter']
                expiry_date = datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y %Z')
                now = datetime.utcnow()
                delta = expiry_date - now
                return {
                    "status": "success",
                    "hostname": hostname,
                    "expiry_date": expiry_date.strftime('%Y-%m-%d %H:%M:%S UTC'),
                    "days_remaining": delta.days,
                    "raw_date": expiry_str
                }
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    try:
        input_data = json.load(sys.stdin)
        target = input_data.get("url") or input_data.get("domain") or input_data.get("hostname")
        if not target:
            print(json.dumps({"status": "error", "message": "No domain/url provided"}))
        else:
            # Strip protocol if present
            clean_target = target.replace('https://', '').replace('http://', '').split('/')[0].split(':')[0]
            print(json.dumps(get_ssl_expiry(clean_target)))
    except Exception as e:
        print(json.dumps({"status": "error", "message": f"Runtime error: {str(e)}"}))