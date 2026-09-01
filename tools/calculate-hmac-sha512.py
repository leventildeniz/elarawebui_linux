#!/usr/bin/env python3
# @description: Calculates the HMAC-SHA512 signature for a given text and secret key.
# @tool: calculate-hmac-sha512
import sys, json, hmac, hashlib

try:
    input_data = json.load(sys.stdin)
    text = input_data.get("text", "")
    key = input_data.get("key", "")
    sig = hmac.new(key.encode(), text.encode(), hashlib.sha512).hexdigest()
    print(json.dumps({"signature": sig}))
except Exception as e:
    print(json.dumps({"error": str(e)}))