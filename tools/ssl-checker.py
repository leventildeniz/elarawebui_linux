#!/usr/bin/env python3
# @tool: ssl-checker
import socket
import ssl
import json
import sys

def main():
    try:
        input_data = json.load(sys.stdin)
        domain = input_data.get('domain')
        if not domain:
            print(json.dumps({'error': 'Missing domain parameter'}))
            return

        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                
                # Extract issuer Common Name
                issuer_list = cert.get('issuer', [])
                issuer_cn = 'Unknown'
                for rdn in issuer_list:
                    for entry in rdn:
                        if entry[0] == 'commonName':
                            issuer_cn = entry[1]
                
                print(json.dumps({
                    'domain': domain,
                    'issuer': issuer_cn,
                    'notBefore': cert.get('notBefore'),
                    'notAfter': cert.get('notAfter'),
                    'status': 'success'
                }))
    except Exception as e:
        print(json.dumps({'error': str(e), 'status': 'failed'}))

if __name__ == '__main__':
    main()