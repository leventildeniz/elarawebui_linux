#!/usr/bin/env python3
# @tool: tool.calc-expiry-days
# @description: Calculates integer days remaining until expiry.
# @args: {"expiry_date": "string"}
import sys, json
from datetime import datetime

try:
    input_data = json.load(sys.stdin)
    expiry_str = input_data.get("expiry_date")
    # Format: 'May 10 12:00:00 2024 GMT'
    expiry_dt = datetime.strptime(expiry_str, '%b %d %H:%M:%S %Y %Z')
    days = (expiry_dt - datetime.utcnow()).days
    print(json.dumps({"days_remaining": days}))
except Exception as e:
    print(json.dumps({"error": str(e)}))