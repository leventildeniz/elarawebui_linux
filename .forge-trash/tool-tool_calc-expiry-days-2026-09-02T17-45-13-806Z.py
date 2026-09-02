#!/usr/bin/env python3
# @tool: tool.calc-expiry-days
# @description: Calculates the number of days remaining until a specific expiration date.
# @args: {"expiry_date": "string"}
import sys, json
from datetime import datetime

def main():
    try:
        args = json.loads(sys.argv[1])
        date_str = args.get('expiry_date')
        # Format usually: 'Feb 12 12:00:00 2025 GMT'
        expiry = datetime.strptime(date_str, '%b %d %H:%M:%S %Y %Z')
        delta = expiry - datetime.utcnow()
        print(json.dumps({"days_remaining": delta.days}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
if __name__ == '__main__': main()