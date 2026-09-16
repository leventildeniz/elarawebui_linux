#!/usr/bin/env python3
# @tool: tool.docker-hub-tag-fetcher
# @description: Fetches latest 5 tags, architectures, and dates for a Docker image
# @args: {"image_name": "string"}
import sys
import json
import urllib.request

def fetch_docker_tags(image_name):
    base_url = f"https://hub.docker.com/v2/repositories/library/{image_name}/tags?page_size=5&ordering=last_updated"
    with urllib.request.urlopen(base_url) as response:
        data = json.loads(response.read().decode())
        results = []
        for tag in data.get('results', []):
            images = tag.get('images', [])
            archs = [img.get('architecture') for img in images]
            results.append({
                "tag": tag.get('name'),
                "last_updated": tag.get('last_updated'),
                "architectures": list(set(archs))
            })
        return results

if __name__ == "__main__":
    input_data = json.load(sys.stdin)
    image = input_data.get("image_name", "redis")
    print(json.dumps(fetch_docker_tags(image)))