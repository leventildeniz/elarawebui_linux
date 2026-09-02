#!/usr/bin/env python3
# @tool: tool.ssl-expiry-checker
# @description: Fetches SSL certificate expiration date for a given domain.
# @args: {"domain": "string"}
import sys, json, ssl, socket

def get_expiry(domain):
    context = ssl.create_default_context()
    with socket.create_connection((domain, 443), timeout=5) as sock:
        with context.wrap_socket(sock, server_hostname=domain) as ssock:
            cert = ssock.getpeercert()
            return cert['notAfter']

try:
    input_data = json.load(sys.stdin)
    domain = input_data.get("domain")
    expiry = get_expiry(domain)
    print(json.dumps({"expiry_date": expiry}))
except Exception as e:
    print(json.dumps({"error": str(e)}))