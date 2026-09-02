#!/usr/bin/env python3
# @description: Fetches raw SSL certificate details from a target URL.
# @tool: ssl-fetcher
import ssl, socket, json, sys

def get_cert(hostname):
    context = ssl.create_default_context()
    with socket.create_connection((hostname, 443), timeout=5) as sock:
        with context.wrap_socket(sock, server_hostname=hostname) as ssock:
            return ssock.getpeercert()

try:
    input_data = json.load(sys.stdin)
    target = input_data.get('target_url')
    cert = get_cert(target)
    print(json.dumps({"status": "success", "data": cert}))
except Exception as e:
    print(json.dumps({"status": "error", "message": str(e)}))