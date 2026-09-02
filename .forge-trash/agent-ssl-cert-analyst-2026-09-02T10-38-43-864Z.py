#!/usr/bin/env python3
# @tools: -
# @description: SSL Certificate Analyst. Orchestrates the process of fetching a certificate's expiration date using ssl-expiry-fetcher and interpreting it via ssl-expiry-analysis.
import json
from agents._shared.mlx_runner import AgentRunner

class SSLCertAnalyst(AgentRunner):
    async def run(self, domain: str):
        # 1. Fetch the date
        fetch_result = await self.call_tool('ssl-expiry-fetcher', {'domain': domain})
        if 'error' in fetch_result:
            return f'Error fetching certificate: {fetch_result["error"]}'
        
        # 2. Analyze the date using the existing skill
        analysis = await self.apply_skill('ssl-expiry-analysis', fetch_result)
        
        return {
            'domain': domain,
            'expiry': fetch_result['expiry_date'],
            'analysis': analysis
        }

if __name__ == '__main__':
    # Runner boilerplate
    pass