#!/usr/bin/env python3
# @tool: ssl-expiry-checker
# @description: Checks SSL certificate expiration for a given URL.
# @args: {"target_url": "string"}
import ssl, socket, datetime, json, sys

def check_ssl(url):
    try:
        hostname = url.replace('https://', '').replace('http://', '').split('/')[0]
        context = ssl.create_default_context()
        with socket.create_connection((hostname, 443)) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert = ssock.getpeercert()
                expiry_date = datetime.datetime.strptime(cert['notAfter'], '%b %d %H:%M:%S %Y %Z')
                days_remaining = (expiry_date - datetime.datetime.now()).days
                return {"status": "success", "days_remaining": days_remaining, "expiry_date": str(expiry_date)}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == '__main__':
    input_data = json.load(sys.stdin)
    print(json.dumps(check_ssl(input_data['target_url'])))
