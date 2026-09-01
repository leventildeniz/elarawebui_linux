#!/usr/bin/env python3
# @description: Queries crt.sh for subdomains of a given domain with retry logic for 502 errors and deduplication.
# @tool: crtsh-enumerator
import sys
import json
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

def get_subdomains(domain):
    url = f"https://crt.sh/?q=%.{domain}&output=json"
    session = requests.Session()
    # Configure retries for 502, 503, 504 errors
    retries = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=[502, 503, 504],
        allowed_methods=["GET"]
    )
    session.mount("https://", HTTPAdapter(max_retries=retries))
    
    try:
        response = session.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        subdomains = set()
        for entry in data:
            # crt.sh returns name_value which can contain multiple domains separated by \n
            names = entry.get('name_value', '').split('\n')
            for name in names:
                name = name.strip().lower()
                if name.endswith(domain.lower()):
                    subdomains.add(name)
        
        return sorted(list(subdomains))
    except Exception as e:
        return [f"Error: {str(e)}"]

if __name__ == "__main__":
    try:
        input_data = json.load(sys.stdin)
        domain = input_data.get('domain')
        if not domain:
            print(json.dumps({"error": "Missing domain parameter"}))
            sys.exit(0)
        
        results = get_subdomains(domain)
        print(json.dumps({"domain": domain, "subdomains": results}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
