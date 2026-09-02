#!/usr/bin/env python3
# @tool: tool.markdown-formatter
# @description: Generates a Markdown report for SSL status.
# @args: {"domain": "string", "expiry_date": "string", "days_remaining": "number", "alert_status": "string"}
import sys, json

def main():
    try:
        args = json.loads(sys.argv[1])
        report = f"# SSL Expiry Report\n\n- **Domain**: {args['domain']}\n- **Expiry Date**: {args['expiry_date']}\n- **Days Remaining**: {args['days_remaining']}\n- **Status**: {args['alert_status']}"
        print(json.dumps({"markdown": report}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
if __name__ == '__main__': main()