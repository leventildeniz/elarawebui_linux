#!/usr/bin/env python3
# @tool: emergency-notifier
# @description: Sends an emergency security alert
# @args: {"message": "string", "severity": "string"}
import sys, json

def main():
    try:
        args = json.loads(sys.argv[1])
        msg = args.get('message', 'Security Alert')
        sev = args.get('severity', 'High')
        print(json.dumps({"status": "sent", "alert": f"[{sev}] {msg}"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == '__main__':
    main()