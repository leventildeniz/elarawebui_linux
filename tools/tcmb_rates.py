#!/usr/bin/env python3
# @tool: tool.tcmb_rates
# @description: Fetches and parses USD/EUR buying/selling rates from TCMB XML feed.
# @args: {}
import urllib.request
import xml.etree.ElementTree as ET
import json
import sys

def fetch_rates():
    url = 'https://www.tcmb.gov.tr/kurlar/today.xml'
    try:
        with urllib.request.urlopen(url) as response:
            data = response.read()
            root = ET.fromstring(data)
            results = {}
            for currency in root.findall('Currency'):
                code = currency.get('CurrencyCode')
                if code in ['USD', 'EUR']:
                    results[code] = {
                        'buying': currency.find('ForexBuying').text,
                        'selling': currency.find('ForexSelling').text
                    }
            print(json.dumps(results))
    except Exception as e:
        print(json.dumps({'error': str(e)}))

if __name__ == '__main__':
    fetch_rates()