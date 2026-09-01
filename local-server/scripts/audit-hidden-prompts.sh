#!/usr/bin/env bash
# UI = TEK MERCİİ guardrail (2026-06-02).
#
# Backend kodunda kıyıda kalmış hardcoded prompt metnini tarar. Bu script CI
# refleksi gibi davranır: yeni bir gizli prompt eklendiyse fail eder.
#
# İzin verilen yerler:
#   - lib/chat-templates.mjs / mlx_runner.py  (chat template tokenları — protokol)
#   - lib/chat-prompt.mjs                     (render katmanı — protokol)
#   - lib/skills/seed.mjs                     (DB seed datası — UI'da editleniyor)
#   - scripts/, AUDIT*.md                     (bu script + dev araçları + dokümantasyon)
#   - yorum satırları (// veya #)             (kod davranışı değil, açıklama)
#
# Bulunan her satır UI/DB'ye taşınmalı veya silinmeli.

set -euo pipefail
cd "$(dirname "$0")/.."

EXCLUDES=(
  --glob='!scripts/**'
  --glob='!lib/chat-templates.mjs'
  --glob='!lib/chat-prompt.mjs'
  --glob='!lib/skills/seed.mjs'
  --glob='!lib/system-prompts.mjs'
  --glob='!lib/rag/defaults.mjs'
  --glob='!**/*.md'
  --glob='!**/*.test.*'
  --glob='!**/*.spec.*'
  --glob='!node_modules/**'
)

# Filter out comment-only lines. After "path:line:" the first non-space char
# is one of //, #, * → drop. Use awk for portable handling.
filter_comments() {
  awk -F: '{
    rest = $0
    # strip path:line: prefix (first two colons)
    sub(/^[^:]+:[0-9]+:/, "", rest)
    sub(/^[ \t]+/, "", rest)
    if (rest ~ /^(\/\/|#|\*)/) next
    print
  }'
}

fail=0
report() {
  local label="$1"; shift
  local pattern="$1"; shift
  hits=$(rg -n "${EXCLUDES[@]}" "$pattern" . 2>/dev/null | filter_comments || true)
  if [ -n "$hits" ]; then
    echo "[FAIL] $label"
    echo "$hits" | sed 's/^/    /'
    fail=1
  else
    echo "[ok]   $label"
  fi
}

echo "==> Hidden prompt audit (UI = tek mercii)"
report "### Instruction wrapper"           '### Instruction'
report "/no_think literal"                  '/no_think'
report "KURALLAR: hardcoded TR talimat"    'KURALLAR:'
report "DİL KURALI hardcoded"               'DİL KURALI'
report "KAYNAK YASAĞI hardcoded"            'KAYNAK YASAĞI'
report "INSPECTOR DENETÇİ hardcoded"        'INSPECTOR DENETÇİ'
report "KÜTÜPHANE DURUMU hardcoded"         'KÜTÜPHANE DURUMU'
report "MÜHÜRLÜ DÖKÜMANLAR hardcoded"       'MÜHÜRLÜ DÖKÜMAN'
report 'brandDefault "You are \${name}"'    'You are \$\{.*name'
report 'role:"system" hardcoded content'    'role:[[:space:]]*"system",[[:space:]]*content:[[:space:]]*"[A-ZĞÜŞİÖÇ]'

echo
if [ "$fail" -ne 0 ]; then
  echo "==> AUDIT FAILED — yukarıdaki satırları UI/DB'ye taşı veya sil."
  exit 1
fi
echo "==> AUDIT GREEN — gizli prompt kalıntısı yok."
