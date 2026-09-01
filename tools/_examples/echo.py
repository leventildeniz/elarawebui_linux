# @tool: echo
# @description: Echo the message payload back as JSON.
# @args: {"msg": "string"}
# @category: Examples
# @icon: MessageSquare
# @color: #06b6d4
"""Reference tool — reads JSON from stdin, returns {echoed: msg}."""

import json
import sys


def main() -> None:
    try:
        payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    except json.JSONDecodeError:
        payload = {}
    msg = payload.get("msg", "")
    print(json.dumps({"ok": True, "echoed": msg}))


if __name__ == "__main__":
    main()
