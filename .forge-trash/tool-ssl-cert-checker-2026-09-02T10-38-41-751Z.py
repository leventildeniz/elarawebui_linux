#!/usr/bin/env python3
import socket
import ssl
import json
import sys
from datetime import datetime

# @tool: ssl-cert-checker
def main():
    try:
        input_data = json.load(sys.stdin)
        target = input_data.get("domain", "")
        if not target:
            print(json.dumps({"error": "No domain provided"}))
            return
        
        # Clean URL to hostname
        hostname = target.replace("https://", "").replace("http://", "").split('/')[0].split(':')[0]
        
        context = ssl.create_default_context()
        with socket.create_connection((hostname, 443), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert = ssock.getpeercert()
        
        expiry_str = cert['notAfter']
        expiry_date = datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y %Z')
        remaining = (expiry_date - datetime.utcnow()).days
        
        # Extract issuer Common Name
        issuer_info = dict(x[0] for x in cert['issuer'])
        issuer_cn = issuer_info.get('commonName', 'Unknown Issuer')
        
        print(json.dumps({
            "domain": hostname,
            "expiration_date": expiry_str,
            "issuer": issuer_cn,
            "days_remaining": remaining,
            "status": "success"
        }))
    except Exception as e:
        print(json.dumps({"error": str(e), "status": "failed"}))

if __name__ == "__main__":
    main()