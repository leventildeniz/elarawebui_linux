#!/usr/bin/env python3
# @tool: file-writer
# @description: Writes data to a log file.
# @args: {"content": "string", "filename": "string"}
import sys, json
data = json.load(sys.stdin)
with open(data.get('filename', 'ssl_log.txt'), 'a') as f:
    f.write(data.get('content') + '\n')
print(json.dumps({"status": "written"}))