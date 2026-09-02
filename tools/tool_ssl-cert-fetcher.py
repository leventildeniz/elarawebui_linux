#!/usr/bin/env python3
# @tool: tool.ssl-cert-fetcher
# @description: Fetches SSL certificate expiration date for a target URL
# @args: {"target_url": "string"}
import sys, json, ssl, socket, datetime

def get_ssl_expiry(hostname):
    context = ssl.create_default_context()
    with socket.create_connection((hostname, 443), timeout=5) as sock:
        with context.wrap_socket(sock, server_hostname=hostname) as ssock:
            cert = ssock.getpeercert()
            return cert['notAfter']

if __name__ == '__main__':
    input_data = json.load(sys.stdin)
    url = input_data.get('target_url')
    try:
        expiry_str = get_ssl_expiry(url)
        print(json.dumps({"expiry_date": expiry_str}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))