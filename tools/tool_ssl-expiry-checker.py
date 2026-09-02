#!/usr/bin/env python3
# @tool: tool.ssl-expiry-checker
# @description: Retrieves the SSL certificate expiration date for a given domain.
# @args: {"domain": "string"}
import sys, json, ssl, socket
from datetime import datetime

def main():
    try:
        args = json.loads(sys.argv[1])
        domain = args.get('domain')
        ctx = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=10) as sock:
            with ctx.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                expiry_date = cert['notAfter']
        print(json.dumps({"domain": domain, "expiry_date": expiry_date}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
if __name__ == '__main__': main()