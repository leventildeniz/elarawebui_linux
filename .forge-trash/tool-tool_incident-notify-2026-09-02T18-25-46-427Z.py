#!/usr/bin/env python3
# @tool: tool.incident-notify
# @description: Triggers emergency response alerting.
# @args: {"message": "string"}
import sys, json

def notify(message):
    return {"status": "Sent", "message": message}

if __name__ == "__main__":
    args = json.loads(sys.stdin.read())
    print(json.dumps(notify(args.get("message"))))