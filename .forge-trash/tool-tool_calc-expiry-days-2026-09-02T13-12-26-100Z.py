#!/usr/bin/env python3
# @tool: calc-expiry-days
# @description: Calculates days remaining until SSL expiry
# @args: {"expiry_date": "string"}
import sys, json, datetime

input_data = json.load(sys.stdin)
expiry = datetime.datetime.strptime(input_data['expiry_date'], '%b %d %H:%M:%S %Y %Z')
now = datetime.datetime.now()
delta = (expiry - now).days
print(json.dumps({"days_remaining": delta}))