#!/usr/bin/env python3
# @tool: ssl-cert-inspector
import ssl
import socket
import json
import sys
from datetime import datetime

def get_ssl_details(domain, port=443):
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, port), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                
                # Extract issuer
                issuer = dict(x[0] for x in cert['issuer'])
                common_name = issuer.get('commonName', 'Unknown')
                organization = issuer.get('organizationName', 'Unknown')
                
                return {
                    "domain": domain,
                    "issuer": f"{common_name} ({organization})",
                    "notBefore": cert.get('notBefore'),
                    "notAfter": cert.get('notAfter'),
                    "status": "success"
                }
    except Exception as e:
        return {"domain": domain, "status": "error", "message": str(e)}

if __name__ == "__main__":
    try:
        input_data = json.load(sys.stdin)
        domain = input_data.get('domain')
        port = input_data.get('port', 443)
        if not domain:
            print(json.dumps({"status": "error", "message": "Missing domain parameter"}))
            sys.exit(0)
        result = get_ssl_details(domain, port)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
