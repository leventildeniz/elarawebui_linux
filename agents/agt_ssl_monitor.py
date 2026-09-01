#!/usr/bin/env python3
# @tools: -
# @description: SSL Certificate Monitor
import json
from agents._shared.mlx_runner import MLXRunner

class SSLMonitorAgent(MLXRunner):
    def __init__(self):
        super().__init__()
        self.system_prompt = "You are the SSL Certificate Monitor. Your goal is to ensure domain security by tracking certificate lifecycles. Use the ssl-expiry-workflow skill to process all requests. Always be precise about dates and urgency levels."

if __name__ == "__main__":
    agent = SSLMonitorAgent()
    agent.run()