#!/usr/bin/env python3
# @description: Calculates the Shannon entropy of a given string to assess randomness.
# @tool: calculate-shannon-entropy
import sys, json, math
from collections import Counter

def shannon_entropy(data):
    if not data: return 0.0
    counts = Counter(data)
    n = len(data)
    probs = [c / n for c in counts.values()]
    return -sum(p * math.log2(p) for p in probs)

try:
    input_data = json.load(sys.stdin)
    text = input_data.get("text", "")
    print(json.dumps({"entropy": shannon_entropy(text)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))