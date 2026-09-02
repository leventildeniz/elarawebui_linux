#!/usr/bin/env python3
# @tool: file-writer
# @description: Writes content to a file.
# @args: {"filename": "string", "content": "string"}
import json, sys

if __name__ == '__main__':
    data = json.load(sys.stdin)
    # Simulating file write
    print(json.dumps({"status": "written", "file": data.get('filename')}))
