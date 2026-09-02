#!/usr/bin/env python3
# @tool: ssl-probe
# @description: Fetches SSL certificate metadata for a given URL
# @args: {"target_url": "string"}
import sys, json, ssl, socket

def get_cert(url):
    host = url.replace("https://", "").split("/")[0]
    context = ssl.create_default_context()
    with socket.create_connection((host, 443)) as sock:
        with context.wrap_socket(sock, server_hostname=host) as ssock:
            return ssock.getpeercert()

input_data = json.load(sys.stdin)
result = get_cert(input_data['target_url'])
print(json.dumps(result))