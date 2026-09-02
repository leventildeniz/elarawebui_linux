#!/usr/bin/env python3
# @tool: tool.markdown-formatter
# @description: Formats SSL expiry data into a markdown report.
# @args: {"domain": "string", "expiry_date": "string", "days_remaining": "number"}
import sys, json

input_data = json.load(sys.stdin)
msg = f"# SSL Alert\nDomain: {input_data['domain']}\nExpiry: {input_data['expiry_date']}\nDays Remaining: {input_data['days_remaining']}"
print(json.dumps({"markdown": msg}))