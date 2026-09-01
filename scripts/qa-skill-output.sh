#!/usr/bin/env bash
# QA for skill output surfaces.
#   a) Turkish step/label leakage that reaches users (not translation maps).
#   b) Raw JSON.stringify(..., null, 2) injected into chat message *content*
#      (not admin editors, debug panels, or drawer proof <pre>'s).
# Usage: bash scripts/qa-skill-output.sh
set -u
cd "$(dirname "$0")/.."

FAIL=0
say() { printf "\n=== %s ===\n" "$*"; }

say "a) Turkish leakage in user-facing skill surfaces"
TR_TOKENS='Niyet|Köprü|Hasat|Mühürle|Çözüml|Kuruluyor|Ediliyor|Bekleniyor|Tamamland|İptal\b|Kapat\b|Detay|Kanıt'
# Match Turkish tokens INSIDE string/template literals, then drop translation-map keys
# (lines that look like  "Turkish": "English"  — the Turkish is the lookup key).
HITS=$(rg -nP "[\"'\`][^\"'\`]*(${TR_TOKENS})[^\"'\`]*[\"'\`]" \
        src/components/skill-action-drawer.tsx \
        src/routes/_app.chat.tsx \
        src/routes/_app.skills.tsx \
        local-server/server.mjs 2>/dev/null \
       | rg -v ':\s*"[^"]*"\s*,?\s*$' \
       | rg -v '// *tr-map' || true)
if [ -n "$HITS" ]; then
  echo "$HITS"
  echo "FAIL: Turkish tokens reaching users ↑"
  FAIL=1
else
  echo "OK: no Turkish leakage in user-facing surfaces"
fi

say "b) Raw JSON dump injected into chat messages"
# Only flag JSON.stringify(..., null, 2) that is concatenated into a string
# that ends up in setMessages/content — i.e., template literals containing
# ```json blocks. The drawer/proof <pre> blocks and admin editors are OK.
HITS=$(rg -nP '```json[\\\n]*[^`]*\$\{[^}]*JSON\.stringify\([^)]+,\s*null,\s*2\)' \
        src/routes src/components 2>/dev/null || true)
if [ -n "$HITS" ]; then
  echo "$HITS"
  echo "FAIL: raw JSON being injected into chat content ↑"
  FAIL=1
else
  echo "OK: no raw JSON injected into chat messages"
fi

say "c) Skill output → chat injection points (informational)"
rg -n 'injectSkillRunResult|renderReport|setActiveSkillRun' src --no-heading || true

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✅ qa-skill-output: PASS"
  exit 0
else
  echo "❌ qa-skill-output: FAIL"
  exit 1
fi
