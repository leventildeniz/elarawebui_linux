#!/usr/bin/env python3
# @tools: -
import sys
import json
from agents._shared.mlx_runner import AgentRunner

# @description: SSL Expiry Monitor Agent. Extracts SSL expiration dates and analyzes them for renewal urgency.

def run():
    runner = AgentRunner(
        agent_id='agt.ssl-expiry-monitor',
        tools=['ssl-expiry-extractor'],
        skills=['ssl-expiry-analysis', 'ssl-audit-policy']
    )
    # Process the request from stdin
    user_input = sys.stdin.read()
    runner.handle_request(user_input)

if __name__ == '__main__':
    run()