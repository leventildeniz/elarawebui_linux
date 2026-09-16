#!/usr/bin/env python3
# @tool: tool.coingecko-data-fetcher
# @description: Fetches market data for crypto IDs from CoinGecko API.
# @args: {"ids": "string"}
import sys
import json
import urllib.request

def fetch_data(ids):
    url = f"https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids={ids}"
    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
            return data
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    input_data = json.load(sys.stdin)
    ids = input_data.get("ids", "bitcoin")
    print(json.dumps(fetch_data(ids)))
