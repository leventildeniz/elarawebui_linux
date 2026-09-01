#!/usr/bin/env python3
# @tool: ssl-expiry-extractor
import sys
import json
import ssl
import socket

def get_ssl_expiry(domain):
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                return {
                    "domain": domain,
                    "expiration_date": cert.get('notAfter'),
                    "status": "success"
                }
    except Exception as e:
        return {
            "domain": domain,
            "error": str(e),
            "status": "failed"
        }

if __name__ == "__main__":
    try:
        input_data = json.load(sys.stdin)
        domain = input_data.get("domain")
        if not domain:
            print(json.dumps({"error": "No domain provided"}))
        else:
            print(json.dumps(get_ssl_expiry(domain)))
    except Exception as e:
        print(json.dumps({"error": str(e)}))