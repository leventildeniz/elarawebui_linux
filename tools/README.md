# Tools — disk-defined registry source

This folder is scanned by the middleware to populate `action_library` (and
`capabilities` via re-sync). Each Python file under `tools/` becomes one
callable tool registered with `runtime.handler="python"` and
`runtime.script=<absolute path>`.

Scan trigger: **System Engine → Capabilities → "Scan tools/"** (admin only).
The endpoint is `POST /api/tools/scan`.

## File header contract

Add these comments at the top of the file. All are optional — missing
fields are inferred (slug = basename without `.py`, description = first
docstring line, args schema = empty).

```python
# @tool: echo                              # slug (lowercase, [a-z0-9_-])
# @description: Echo the message back.     # one line, plain text
# @args: {"msg": "string"}                 # JSON schema (object of key→type)
# @category: Examples                      # optional, default "Tools"
# @icon: MessageSquare                     # optional, lucide icon name
# @color: #06b6d4                          # optional, hex

"""Optional module docstring — used as description fallback."""

import sys, json
payload = json.load(sys.stdin)
print(json.dumps({"echoed": payload.get("msg")}))
```

## Lifecycle

- **New file** → next scan upserts a new `action_library` row.
- **Edited file** → header changes (description, args, icon) are picked up
  on next scan. Slug rename = new row; old row becomes orphan.
- **Deleted file** → row is marked `runtime.orphan=true` on next scan
  (not auto-deleted). Hard-delete from Capabilities tab.

## Subdirectories

Subfolders are walked recursively. `__pycache__`, `.*`, and `node_modules`
are skipped. Files prefixed with `_` (e.g. `_helpers.py`) are skipped
unless their parent dir is named `_examples/`.
