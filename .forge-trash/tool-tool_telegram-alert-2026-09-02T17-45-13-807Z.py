#!/usr/bin/env python3
# @tool: tool.telegram-alert
# @description: Sends a critical warning message to a Telegram chat.
# @args: {"message": "string", "chat_id": "string", "token": "string"}
import sys, json, urllib.request

def main():
    try:
        args = json.loads(sys.argv[1])
        url = f"https://api.telegram.org/bot{args['token']}/sendMessage"
        data = json.dumps({"chat_id": args['chat_id'], "text": args['message']}).encode()
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req)
        print(json.dumps({"status": "sent"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
if __name__ == '__main__': main()