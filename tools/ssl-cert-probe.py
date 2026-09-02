#!/usr/bin/env python3
# @tool: ssl-cert-probe
# @description: Fetches SSL certificate expiry date and calculates days remaining
# @args: {"domain": "string"}
import sys, json, ssl, socket, datetime

def main():
    try:
        input_data = json.loads(sys.stdin.read())
        domain = input_data.get('domain')
        if not domain: raise ValueError('Missing domain parameter')
        
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                expiry_str = cert['notAfter']
                # Format: 'Feb 15 12:00:00 2025 GMT'
                expiry_date = datetime.datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y %Z')
                days_remaining = (expiry_date - datetime.datetime.utcnow()).days
                
                print(json.dumps({
                    "domain": domain,
                    "expiry_date": expiry_str,
                    "days_remaining": days_remaining,
                    "status": "critical" if days_remaining < 30 else "healthy"
                }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == '__main__':
    main()