#!/usr/bin/env python3
# @description: Calculates usable IP ranges and detects overlaps between CIDR blocks.
# @tool: tool.network_cidr_analyzer
import sys
import json
import ipaddress

def analyze():
    try:
        data = json.load(sys.stdin)
        action = data.get('action')
        cidr1 = data.get('cidr1')
        cidr2 = data.get('cidr2')
        
        if action == 'calculate' and cidr1:
            net = ipaddress.ip_network(cidr1)
            hosts = list(net.hosts())
            if not hosts:
                return {"error": "No usable hosts in this range"}
            return {
                "network": str(net),
                "first_usable": str(hosts[0]),
                "last_usable": str(hosts[-1]),
                "total_usable": len(hosts)
            }
        
        elif action == 'overlap' and cidr1 and cidr2:
            net1 = ipaddress.ip_network(cidr1)
            net2 = ipaddress.ip_network(cidr2)
            overlaps = net1.overlaps(net2)
            relationship = "none"
            if overlaps:
                if net1.subnet_of(net2): relationship = "cidr1 is subnet of cidr2"
                elif net2.subnet_of(net1): relationship = "cidr2 is subnet of cidr1"
                else: relationship = "partial overlap"
            return {"overlaps": overlaps, "relationship": relationship}
            
        return {"error": "Invalid action or missing parameters"}
    except Exception as e:
        return {"error": str(e)}

if __name__ == '__main__':
    print(json.dumps(analyze()))