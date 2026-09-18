#!/usr/bin/env python3
# @tool: tool.docker-health-probe
# @description: Connects to local Docker daemon via /var/run/docker.sock to list running containers and their health status.
# @args: {}

import sys
import json

try:
    import docker
except ImportError:
    print(json.dumps({"error": "The 'docker' python library is required. Please install it via pip install docker."}))
    sys.exit(0)

def probe_docker_health():
    try:
        # Connect to local daemon using environment defaults (usually /var/run/docker.sock)
        client = docker.from_env()
        containers = client.containers.list()
        
        probe_results = []
        for container in containers:
            attrs = container.attrs
            state = attrs.get('State', {})
            
            # Extract health status if the container has a HEALTHCHECK defined
            health_info = state.get('Health', {})
            health_status = health_info.get('Status', 'no healthcheck')
            
            probe_results.append({
                "name": container.name,
                "image": attrs.get('Config', {}).get('Image', 'unknown'),
                "status": state.get('Status', 'unknown'),
                "health": health_status
            })
            
        return {"success": True, "containers": probe_results, "count": len(probe_results)}
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    result = probe_docker_health()
    print(json.dumps(result))
