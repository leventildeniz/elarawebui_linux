#!/usr/bin/env python3
# @tool: http-health-probe
# @description: Checks HTTP service availability and response time
# @args: {"url": "string"}
import sys, json, urllib.request, time

def main():
    try:
        input_data = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
        args = json.loads(input_data)
        url = args.get("url")
        if not url:
            print(json.dumps({"error": "Missing url argument"}))
            return
        
        start = time.time()
        with urllib.request.urlopen(url, timeout=10) as response:
            code = response.getcode()
        latency = (time.time() - start) * 1000
        
        print(json.dumps({
            "status": "success",
            "url": url,
            "http_code": code,
            "latency_ms": round(latency, 2)
        }))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))

if __name__ == "__main__":
    main()