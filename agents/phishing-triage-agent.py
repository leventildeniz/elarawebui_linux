#!/usr/bin/env python3
# @tools: -
# @description: Orchestrates phishing triage by extracting IOCs and applying the analysis playbook.
import sys, json
from agents._shared.mlx_runner import MLXRunner

# This agent wires the ioc-extractor tool and phishing-analysis-playbook skill
# to process raw email logs and output a structured security report.