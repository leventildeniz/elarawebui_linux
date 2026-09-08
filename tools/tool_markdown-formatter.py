#!/usr/bin/env python3
# @tool: tool.markdown-formatter
# @description: Formats SSL expiry data into a markdown report.
# @args: {"domain": "string", "expiry_date": "string", "days_remaining": "number"}
import sys, json

try:
    input_data = json.load(sys.stdin)
    domain = input_data.get('domain', 'Unknown')
    expiry = input_data.get('expiry_date', input_data.get('days_to_expiry', 'Unknown'))
    days = input_data.get('days_remaining', input_data.get('days_to_expiry', 'Unknown'))
    status = input_data.get('status', 'OK')

    msg = f"# SSL Alert\nDomain: {domain}\nExpiry: {expiry}\nDays Remaining: {days}\nStatus: {status}"
    print(json.dumps({"markdown": msg, "markdown_report": msg, "ok": True}))
except Exception as e:
    print(json.dumps({"error": str(e), "ok": False}))