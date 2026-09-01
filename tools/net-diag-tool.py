#!/usr/bin/env python3
# @description: Performs DNS resolution and BGP/ASN lookup using standard libraries.
# @tool: net-diag-tool
import json
import sys
import socket
import urllib.request

def run():
    try:
        data = json.load(sys.stdin)
        target = data.get("target")
        result = {"dns": {}, "whois": {}}
        try:
            ip = socket.gethostbyname(target)
            result["dns"] = {"target": target, "ip": ip}
        except Exception as e:
            result["dns"] = {"error": str(e)}
        try:
            if "ip" in result["dns"]:
                url = f"http://ip-api.com/json/{result['dns']['ip']}"
                with urllib.request.urlopen(url, timeout=5) as response:
                    result["whois"] = json.loads(response.read().decode())
        except Exception as e:
            result["whois"] = {"error": str(e)}
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    run()