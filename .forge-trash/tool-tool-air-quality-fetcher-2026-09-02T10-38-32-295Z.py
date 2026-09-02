#!/usr/bin/env python3
# @description: Fetches real-time AQI, PM2.5, and PM10 data for a specified location using the WAQI API.
# @tool: tool-air-quality-fetcher
import sys
import json
import urllib.request
import urllib.parse

def main():
    try:
        input_data = json.load(sys.stdin)
        location = input_data.get('location', 'istanbul')
        # Using demo token for public access; in production replace with valid API key
        url = f"https://api.waqi.info/feed/{urllib.parse.quote(location)}/?token=demo"
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
            if data.get('status') == 'ok':
                result = {
                    "location": location,
                    "aqi": data['data'].get('aqi'),
                    "pm25": data['data'].get('iaqi', {}).get('pm25', {}).get('v'),
                    "pm10": data['data'].get('iaqi', {}).get('pm10', {}).get('v')
                }
                print(json.dumps(result))
            else:
                print(json.dumps({"error": "Failed to fetch data", "details": data.get('data')}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == '__main__':
    main()