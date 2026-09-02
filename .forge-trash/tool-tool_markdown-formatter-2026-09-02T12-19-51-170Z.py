#!/usr/bin/env python3
# @tool: markdown-formatter
# @description: Formats SSL check results into a markdown report.
# @args: {"data": "object"}
import sys, json
data = json.load(sys.stdin)
report = f"# SSL Audit Report\n\n- **Domain:** {data.get('domain')}\n- **Expiry:** {data.get('expiry_date')}\n- **Days Remaining:** {data.get('days_remaining')}"
print(json.dumps({"report": report}))