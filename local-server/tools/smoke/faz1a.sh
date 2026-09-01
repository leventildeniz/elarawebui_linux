#!/usr/bin/env bash
# Faz 1A smoke — direct stdin/stdout invocation of the 4 common tools.
# Not routed through middleware on purpose: this validates the tool contract
# in isolation. Run middleware-level smoke via scripts/smoke-tur6.sh.
#
# Usage:  bash local-server/tools/smoke/faz1a.sh
# Env:    PYTHON (default: python3)
set -uo pipefail

PY="${PYTHON:-python3}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
TOOLS="$REPO/tools"
WORKDIR="$TOOLS/_workdir"
mkdir -p "$WORKDIR"

pass=0
fail=0
log()  { printf '%s\n' "$*"; }
ok()   { pass=$((pass+1)); log "  PASS · $1"; }
ko()   { fail=$((fail+1)); log "  FAIL · $1 :: $2"; }

run() {  # run <tool.py> <json>  → echoes JSON output
  echo "$2" | "$PY" "$TOOLS/$1"
}

assert_key() {  # assert_key <json> <jq-path> <expected>
  local got
  got=$(printf '%s' "$1" | "$PY" -c "import json,sys; o=json.load(sys.stdin); k=sys.argv[1].split('.'); v=o
for p in k:
    v=v[p] if isinstance(v,dict) else v[int(p)]
print(v)" "$2" 2>/dev/null)
  [[ "$got" == "$3" ]]
}

# -------------------------------------------------------------------------
log "=== Faz 1A smoke ==="

# 1) web_fetch — happy path
log "[1] web_fetch https://example.com"
out=$(run web_fetch.py '{"url":"https://example.com","timeout_ms":15000}')
if assert_key "$out" "ok" "True" && assert_key "$out" "status" "200"; then
  title=$(printf '%s' "$out" | "$PY" -c "import json,sys;print(json.load(sys.stdin).get('title',''))")
  [[ "$title" == *"Example Domain"* ]] && ok "web_fetch returned title='$title'" \
    || ko "web_fetch title mismatch" "$title"
else
  ko "web_fetch happy path" "$out"
fi

# 1b) web_fetch — scheme guard
out=$(run web_fetch.py '{"url":"file:///etc/passwd"}')
assert_key "$out" "reason" "scheme_not_allowed" && ok "web_fetch scheme guard" \
  || ko "web_fetch scheme guard" "$out"

# 2) shell_exec — allowed echo
log "[2] shell_exec echo hi"
out=$(run shell_exec.py '{"cmd":"echo","args":["hi"]}')
if assert_key "$out" "ok" "True" && assert_key "$out" "exit_code" "0"; then
  stdout=$(printf '%s' "$out" | "$PY" -c "import json,sys;print(json.load(sys.stdin)['stdout'].strip())")
  [[ "$stdout" == "hi" ]] && ok "shell_exec echo → 'hi'" || ko "shell_exec stdout" "$stdout"
else
  ko "shell_exec echo" "$out"
fi

# 2b) shell_exec — denied (rm not in allowlist)
out=$(run shell_exec.py '{"cmd":"rm","args":["-rf","/"]}')
assert_key "$out" "reason" "command_not_allowed" && ok "shell_exec rm denied" \
  || ko "shell_exec rm should be denied" "$out"

# 2c) shell_exec — path traversal denied
out=$(run shell_exec.py '{"cmd":"/bin/sh"}')
assert_key "$out" "reason" "command_path_not_allowed" && ok "shell_exec path denied" \
  || ko "shell_exec path traversal" "$out"

# 3) file_write_safe — allowed write to _workdir
log "[3] file_write_safe → _workdir/_faz1a.txt"
target="$WORKDIR/_faz1a.txt"
rm -f "$target"
payload=$(printf '{"path":"%s","content":"faz1a-ok"}' "$target")
out=$(run file_write_safe.py "$payload")
if assert_key "$out" "ok" "True" && [[ "$(cat "$target" 2>/dev/null)" == "faz1a-ok" ]]; then
  ok "file_write_safe wrote $target"
  rm -f "$target"
else
  ko "file_write_safe write failed" "$out"
fi

# 3b) file_write_safe — denied path
out=$(run file_write_safe.py '{"path":"/etc/passwd","content":"x"}')
assert_key "$out" "reason" "path_not_allowed" && ok "file_write_safe /etc denied" \
  || ko "file_write_safe should deny /etc/passwd" "$out"

# 4) pdf_extract — if pypdf present, generate + extract; else expect missing_dependency
log "[4] pdf_extract"
sample="$WORKDIR/_faz1a_sample.pdf"
if "$PY" -c "import pypdf" 2>/dev/null; then
  "$PY" - <<PYEOF
from pypdf import PdfWriter
from pypdf.generic import RectangleObject
w = PdfWriter()
w.add_blank_page(width=200, height=200)
with open("$sample","wb") as f: w.write(f)
PYEOF
  out=$(run pdf_extract.py "$(printf '{"path":"%s"}' "$sample")")
  pages=$(printf '%s' "$out" | "$PY" -c "import json,sys;print(json.load(sys.stdin).get('page_count',0))")
  if assert_key "$out" "ok" "True" && [[ "$pages" -ge 1 ]]; then
    ok "pdf_extract page_count=$pages"
  else
    ko "pdf_extract failed" "$out"
  fi
  rm -f "$sample"
else
  out=$(run pdf_extract.py '{"path":"/nonexistent.pdf"}')
  assert_key "$out" "reason" "file_not_found" && ok "pdf_extract reports file_not_found" \
    || ko "pdf_extract missing-file branch" "$out"
  log "  NOTE · pypdf not installed; happy-path test skipped. Install with: pip install pypdf"
fi

log "==="
log "PASS=$pass  FAIL=$fail"
exit "$fail"
