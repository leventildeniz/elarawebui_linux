#!/usr/bin/env python3
# @tool: dns-health-probe
# @description: Probes DNS resolution and measures latency for a given domain
# @args: {"domain": "string"}
import sys, json, socket, time

def main():
    try:
        input_data = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
        args = json.loads(input_data)
        domain = args.get("domain")
        if not domain:
            print(json.dumps({"error": "Missing domain argument"}))
            return
        
        start = time.time()
        ip = socket.gethostbyname(domain)
        latency = (time.time() - start) * 1000
        
        print(json.dumps({
            "status": "success",
            "domain": domain,
            "ip": ip,
            "latency_ms": round(latency, 2)
        }))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))

if __name__ == "__main__":
    main()