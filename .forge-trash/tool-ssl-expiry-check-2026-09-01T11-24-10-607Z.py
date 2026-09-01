#!/usr/bin/env python3
# @tool: ssl-expiry-check
import socket
import ssl
import json
import sys
from datetime import datetime

def main():
    try:
        input_data = json.load(sys.stdin)
        domain = input_data.get('domain')
        if not domain:
            print(json.dumps({'error': 'Missing domain parameter'}))
            return

        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                expiry_date = cert.get('notAfter')
                
                # Format: 'Feb 15 12:00:00 2025 GMT'
                # Convert to human readable or ISO
                dt = datetime.strptime(expiry_date, '%b %d %H:%M:%S %Y %Z')
                
                print(json.dumps({
                    'domain': domain,
                    'expiry_date': expiry_date,
                    'iso_date': dt.isoformat(),
                    'days_remaining': (dt - datetime.utcnow()).days
                }))
    except Exception as e:
        print(json.dumps({'error': str(e)}))

if __name__ == '__main__':
    main()