#!/usr/bin/env python3
# @tools: -
# @description: Orchestrates network diagnostics by resolving IPs and fetching BGP/WHOIS data.
import sys
import json
from agents._shared import mlx_runner

def handle(request):
    target = request.get("target")
    tool_res = mlx_runner.run_tool("net-diag-tool", {"target": target})
    skill_res = mlx_runner.run_skill("net-diag-skill", tool_res)
    return skill_res

if __name__ == "__main__":
    input_data = json.loads(sys.stdin.read())
    print(json.dumps(handle(input_data)))