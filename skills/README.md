# Skills

Skills are **DB-managed**. Their body lives in the `skills` table and is
rendered as an LLM prompt template at runtime — no Python file required.

This folder is reserved for optional per-skill Python pre/post-processors
that the scanner can attach to a skill if you ever need deterministic
helper logic alongside the prompt. Drop `<slug>.py` here with a
`# @skill: <slug>` header and run **Scan skills** in
`/system-engine → Capabilities`.

Create and edit skills from the UI:
- `/system-engine → Skills` — author the prompt template
- `/system-engine → Capabilities` — toggle / rename / re-sync
