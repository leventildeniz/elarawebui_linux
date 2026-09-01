#!/usr/bin/env python3
# agents/Meta/forge_master.py
# Meta-Forge orchestrator — user talks in natural language, this agent
# proposes a ForgePlan {reuse, create} (skills / tools / agents / packs).
# Plans are written to forge_plans (pending) — user approves/rejects/rolls back
# via /system-engine → Meta-Forge. Disk writes go through meta-forge/apply.mjs
# (lint-guarded). This agent NEVER writes to disk directly.
#
# System prompt + parameters are injected by the middleware via env
# (ELARA_AGENT_SYSTEM_PROMPT). This file is a thin runner — the actual planning
# behavior is defined by the operator-editable system prompt in the DB.
#
# @description: Meta-Forge orchestrator — proposes new skills/tools/agents/packs as approvable ForgePlan JSON. User approves/rolls back via UI.
# @tools: -
import sys
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from _shared.mlx_runner import run_agent

if __name__ == "__main__":
    run_agent(sys.argv[1] if len(sys.argv) > 1 else "")
