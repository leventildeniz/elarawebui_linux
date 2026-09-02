#!/usr/bin/env python3
# @tool: executive-digest-aggregator
# @description: Aggregates DNS and HTTP probe results into a Markdown report.
# @args: {"dns_results": "string", "http_results": "string"}
import sys, json

def main():
    input_data = json.load(sys.stdin)
    dns = json.loads(input_data.get("dns_results", "{}"))
    http = json.loads(input_data.get("http_results", "{}"))
    md = "# Executive System Health Digest\n\n## DNS Records\n"
    for k, v in dns.items(): md += f"- {k}: {v}\n"
    md += "\n## HTTP Health\n"
    for k, v in http.items(): md += f"- {k}: {v}\n"
    print(json.dumps({"report": md}))

if __name__ == '__main__':
    main()