#!/usr/bin/env python3
# @description: Performs a secure HTTP GET request to a URL and returns the raw JSON response content.
# @tool: tool.api_json_fetcher
import sys
import json
import requests

def run():
    try:
        input_data = json.load(sys.stdin)
        url = input_data.get('url')
        if not url:
            print(json.dumps({'error': 'Missing url parameter'}))
            return
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        print(json.dumps({'data': response.json()}))
    except Exception as e:
        print(json.dumps({'error': str(e)}))

if __name__ == '__main__':
    run()