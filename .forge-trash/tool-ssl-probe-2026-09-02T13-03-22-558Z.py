#!/usr/bin/env python3
# @tool: ssl-probe
# @description: Performs SSL handshake and extracts expiration date
# @args: {"target_url": "string"}
import sys, json, ssl, socket

def get_ssl_expiry(hostname):
    context = ssl.create_default_context()
    with socket.create_connection((hostname, 443), timeout=5) as sock:
        with context.wrap_socket(sock, server_hostname=hostname) as ssock:
            cert = ssock.getpeercert()
            return cert['notAfter']

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        url = input_data.get("target_url")
        expiry = get_ssl_expiry(url)
        print(json.dumps({"expiry_date": expiry, "status": "success"}))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))