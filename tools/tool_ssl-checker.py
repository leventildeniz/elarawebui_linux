#!/usr/bin/env python3
# @tool: ssl-checker
import sys, json, ssl, socket
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
                issuer_list = cert.get('issuer', [])
                issuer_name = next((x[0] for x in issuer_list if x[0]), 'Unknown')
                
                print(json.dumps({
                    'domain': domain,
                    'issuer': issuer_name,
                    'notBefore': cert.get('notBefore'),
                    'notAfter': cert.get('notAfter'),
                    'version': cert.get('version'),
                    'subject': cert.get('subject')
                }))
    except Exception as e:
        print(json.dumps({'error': str(e)}))

if __name__ == '__main__':
    main()