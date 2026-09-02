#!/usr/bin/env python3
# @description: Uses socket and ssl libraries to retrieve the notAfter date of a remote server's SSL certificate.
# @tool: ssl-fetch-tool
import sys, json, socket, ssl, datetime

def get_cert_date(hostname):
    context = ssl.create_default_context()
    with socket.create_connection((hostname, 443), timeout=5) as sock:
        with context.wrap_socket(sock, server_hostname=hostname) as ssock:
            cert = ssock.getpeercert()
            return cert['notAfter']

try:
    input_data = json.load(sys.stdin)
    hostname = input_data.get('url')
    if not hostname: raise ValueError('Missing URL')
    date_str = get_cert_date(hostname)
    print(json.dumps({"status": "success", "notAfter": date_str}))
except Exception as e:
    print(json.dumps({"status": "error", "message": str(e)}))