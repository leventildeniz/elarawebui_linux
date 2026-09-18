#!/usr/bin/env python3

# --- [Self-Healing v2 Optimization: Bounded Timeouts & Resilient Backoff] ---
import time
import os
TIMEOUT_DEFAULT_S = float(os.environ.get("ELARA_TOOL_TIMEOUT_S", 5.0))
# -----------------------------------------------------------------------------
# @tool: tool.docker-hub-tag-fetcher
# @description: Fetches latest tags, supported architectures, and release dates for a Docker image from Docker Hub public API.
# @args: {"image_name": "string", "results": "number"}
import sys
import json
import urllib.request
import urllib.error

def fetch_docker_tags(image_name, limit=5):
    clean = str(image_name or "redis").strip().strip("/")
    if not clean:
        clean = "redis"

    if "/" in clean:
        repo_path = clean
    else:
        repo_path = f"library/{clean}"

    page_size = max(1, min(25, int(limit or 5)))
    base_url = f"https://hub.docker.com/v2/repositories/{repo_path}/tags?page_size={page_size}&ordering=last_updated"

    try:
        req = urllib.request.Request(base_url, headers={"User-Agent": "Elara/2.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_DEFAULT_S) as response:
            data = json.loads(response.read().decode())
            results = []
            for tag in data.get("results", []):
                images = tag.get("images", [])
                archs = [img.get("architecture") for img in images if img.get("architecture")]
                results.append({
                    "tag": tag.get("name"),
                    "last_updated": tag.get("last_updated"),
                    "architectures": sorted(list(set(archs)))
                })
            return {"ok": True, "image": clean, "repo": repo_path, "tags": results}
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.reason}", "image": clean, "repo": repo_path}
    except Exception as e:
        return {"ok": False, "error": str(e), "image": clean, "repo": repo_path}

if __name__ == "__main__":
    input_data = {}
    try:
        raw = sys.stdin.read().strip() if not sys.stdin.isatty() else "{}"
        if not raw and len(sys.argv) > 1:
            raw = sys.argv[1]
        input_data = json.loads(raw) if raw else {}
    except Exception:
        input_data = {}

    image = input_data.get("image_name") or input_data.get("image") or "redis"
    limit = input_data.get("results") or input_data.get("limit") or 5
    print(json.dumps(fetch_docker_tags(image, limit), indent=2))
