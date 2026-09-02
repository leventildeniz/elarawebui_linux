#!/usr/bin/env python3
# @tool: tool.file-writer
# @description: Saves text content to a local file.
# @args: {"filename": "string", "content": "string"}
import sys, json

def main():
    try:
        args = json.loads(sys.argv[1])
        with open(args['filename'], 'w') as f:
            f.write(args['content'])
        print(json.dumps({"status": "saved", "path": args['filename']}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
if __name__ == '__main__': main()