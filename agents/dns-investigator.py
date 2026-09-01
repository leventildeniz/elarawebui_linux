#!/usr/bin/env python3
# @tools: -
# @description: Orchestrates DNS lookups and provides expert security analysis of the results.
from agents._shared.mlx_runner import AgentRunner

class DNSInvestigator(AgentRunner):
    def run(self, domain):
        # Step 1: Perform the lookup
        dns_data = self.call_tool('dns-lookup-plus', {'domain': domain})
        # Step 2: Apply the analysis skill
        analysis = self.apply_skill('dns-analysis-expert', dns_data)
        return analysis

if __name__ == '__main__':
    # Standard MLX runner entry point
    pass