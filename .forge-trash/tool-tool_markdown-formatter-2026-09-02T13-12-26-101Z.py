#!/usr/bin/env python3
# @tool: markdown-formatter
# @description: Formats input data into a markdown report
# @args: {"data": "object"}
import sys, json

input_data = json.load(sys.stdin)
data = input_data['data']
report = f"# SSL Report\n\nDays remaining: {data['days_remaining']}"
print(json.dumps({"report": report}))