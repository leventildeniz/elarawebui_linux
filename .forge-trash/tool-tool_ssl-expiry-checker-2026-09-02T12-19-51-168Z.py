#!/usr/bin/env python3
# @tool: ssl-expiry-checker
# @description: Checks SSL certificate expiry for a domain.
# @args: {"domain": "string"}
import sys, json, ssl, socket, datetime
def get_expiry(domain):
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                expiry_str = cert['notAfter']
                expiry_date = datetime.datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y %Z')
                days_remaining = (expiry_date - datetime.datetime.now()).days
                return {"domain": domain, "expiry_date": expiry_str, "days_remaining": days_remaining}
    except Exception as e:
        return {"error": str(e)}
input_data = json.load(sys.stdin)
print(json.dumps(get_expiry(input_data.get('domain', ''))))