#!/usr/bin/env python3
# @tool: calc-expiry-days
# @description: Calculate days remaining until expiration from expiry date string
# @args: {"expiry_date": "string"}
import sys, json
from datetime import datetime

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        expiry_str = input_data.get("expiry_date")
        # Format: 'May 20 20:00:00 2024 GMT'
        dt = datetime.strptime(expiry_str, "%b %d %H:%M:%S %Y %Z")
        days = (dt - datetime.now()).days
        print(json.dumps({"days_remaining": days}))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))