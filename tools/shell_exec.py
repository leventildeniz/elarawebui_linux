#!/usr/bin/env python3
# @tool: shell_exec
# @description: İzin listesindeki shell komutunu zaman aşımı ile çalıştırır. Sıkı kısıtlı.
# @args: {"cmd":"string","args":"json","timeout_ms":"number","cwd":"string"}
# @category: Common
# @icon: Terminal
# @color: #f97316
"""shell_exec — allowlisted, timeout-bound command runner.

Reads JSON from stdin: {cmd, args?, timeout_ms?, cwd?}.
- `cmd` MUST be in TOOL_SHELL_ALLOWLIST env (colon-separated). Default allowlist:
    ls, cat, grep, rg, head, tail, wc, file, stat, echo, pwd, date, uname
- No shell interpolation — uses subprocess with shell=False.
- args must be a list of strings.
- Default timeout: 15000ms, hard max 120000ms.
- cwd must exist; defaults to current working directory.
"""
import json
import os
import shlex
import shutil
import subprocess
import sys

_DEFAULT_ALLOW = "ls,cat,grep,rg,head,tail,wc,file,stat,echo,pwd,date,uname"


def _allowlist():
    raw = os.environ.get("TOOL_SHELL_ALLOWLIST", _DEFAULT_ALLOW)
    return {x.strip() for x in raw.replace(":", ",").split(",") if x.strip()}


def _read_input():
    try:
        if sys.stdin.isatty():
            return {}
        return json.load(sys.stdin) or {}
    except Exception:
        return {}


def main() -> None:
    p = _read_input()
    raw_cmd = str(p.get("cmd") or "").strip()
    if not raw_cmd:
        print(json.dumps({"ok": False, "reason": "missing_cmd"})); return

    # Smart command tokenizer: handles "ls -la /tmp" as well as bare "ls"
    try:
        tokens = shlex.split(raw_cmd)
    except Exception:
        tokens = raw_cmd.split()

    if not tokens:
        print(json.dumps({"ok": False, "reason": "missing_cmd"})); return

    # Extract executable (e.g. /bin/ls -> ls)
    cmd = os.path.basename(tokens[0])

    allow = _allowlist()
    if cmd not in allow:
        print(json.dumps({"ok": False, "reason": "command_not_allowed",
                          "cmd": cmd, "allowed": sorted(allow)})); return

    binpath = shutil.which(cmd)
    if not binpath:
        print(json.dumps({"ok": False, "reason": "command_not_found", "cmd": cmd})); return

    # Combine arguments from tokenized cmd and explicit args parameter
    args = tokens[1:]
    explicit_args = p.get("args") or []
    if isinstance(explicit_args, list):
        args.extend([str(a) for a in explicit_args])
    elif isinstance(explicit_args, str):
        try:
            parsed_args = json.loads(explicit_args)
            if isinstance(parsed_args, list):
                args.extend([str(a) for a in parsed_args])
            else:
                args.append(explicit_args)
        except Exception:
            args.append(explicit_args)

    timeout_ms = int(p.get("timeout_ms") or 15000)
    timeout_ms = max(500, min(120000, timeout_ms))

    cwd = p.get("cwd")
    if cwd is not None:
        cwd = str(cwd)
        if not os.path.isdir(cwd):
            print(json.dumps({"ok": False, "reason": "cwd_not_found", "cwd": cwd})); return

    try:
        proc = subprocess.run(
            [binpath, *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout_ms / 1000.0,
            shell=False,
            env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"},
        )
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "reason": "timeout", "timeout_ms": timeout_ms})); return
    except Exception as e:
        print(json.dumps({"ok": False, "reason": "exec_failed",
                          "detail": str(e)[:200]})); return

    print(json.dumps({
        "ok": True,
        "exit_code": proc.returncode,
        "stdout": (proc.stdout or "")[:100_000],
        "stderr": (proc.stderr or "")[:10_000],
        "cmd": cmd,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
