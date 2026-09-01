#!/usr/bin/env python3
# @tools: -
# @description: SSL/TLS Certificate Auditor. Retrieves certificate data using tool.ssl-checker and analyzes it using skill.ssl-analysis.
from agents/_shared.mlx_runner import AgentRunner
import json

class SSLAuditor(AgentRunner):
    async def run(self, domain: str):
        # 1. Fetch certificate data
        cert_data = await self.call_tool('tool.ssl-checker', {'domain': domain})
        if 'error' in cert_data:
            return f"Error retrieving certificate: {cert_data['error']}"
        
        # 2. Analyze data using the analysis skill
        analysis = await self.apply_skill('skill.ssl-analysis', cert_data)
        return analysis

if __name__ == '__main__':
    # Runner entry point for MLX
    pass