#!/usr/bin/env python3
# @tool: jwt-analyzer
# @description: Decodes JWT header and payload, validates structure, and determines token expiration status based on the 'exp' claim.
# @args: {"jwt_token": "string"}

import base64
import json
import time
import sys

def base64url_decode(payload):
    rem = len(payload) % 4
    if rem > 0:
        payload += '=' * (4 - rem)
    return base64.urlsafe_b64decode(payload).decode('utf-8')

def analyze_jwt(token):
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return {"error": "Invalid JWT structure: Token must consist of three parts separated by dots."}

        header_json = base64url_decode(parts[0])
        payload_json = base64url_decode(parts[1])

        header = json.loads(header_json)
        payload = json.loads(payload_json)

        exp = payload.get('exp')
        now = int(time.time())
        status = "Not Present"
        time_diff = None

        if exp:
            if now < exp:
                status = "Valid"
                time_diff = exp - now
            else:
                status = "Expired"
                time_diff = now - exp

        return {
            "header": header,
            "payload": payload,
            "expiration_status": status,
            "seconds_difference": time_diff,
            "current_timestamp": now,
            "exp_timestamp": exp
        }
    except Exception as e:
        return {"error": f"Analysis failed: {str(e)}"}

if __name__ == "__main__":
    try:
        input_data = sys.argv[1] if len(sys.argv) > 1 else ""
        # Handle JSON input if passed via stdin or as a single string argument
        if not input_data and not sys.stdin.isatty():
            import json as j
            raw = sys.stdin.read()
            try:
                data = j.loads(raw)
                input_data = data.get("jwt_token", "")
            except:
                input_data = raw
        
        # If the input looks like a JSON string from an orchestrator, try to parse it first
        if input_data.startswith('{'):
            try:
                import json as j
                parsed = j.loads(input_data)
                token = parsed.get("jwt_token", "")
            except:
                token = input_data
        else:
            token = input_data

        result = analyze_jwt(token)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))