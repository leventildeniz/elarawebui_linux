#!/usr/bin/env python3
import json
import os
import sys

result = {
    "os": os.name,
    "platform": sys.platform,
    "status": "online"
}
print(json.dumps(result))
