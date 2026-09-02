#!/usr/bin/env python3
# @tool: ssl-expiry-fetcher
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
            print(json.dumps({'error': 'No domain provided'}))
            return

        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                expiry_str = cert.get('notAfter')
                # Format: 'Oct 24 12:00:00 2025 GMT'
                dt = datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y %Z')
                print(json.dumps({
                    'domain': domain,
                    'expiry_date': dt.strftime('%Y-%m-%d %H:%M:%S'),
                    'raw_expiry': expiry_str,
                    'status': 'success'
                }))
    except Exception as e:
        print(json.dumps({'error': str(e), 'status': 'failed'}))

if __name__ == '__main__':
    main()