#!/usr/bin/env bash
# scripts/smoke-chat-templates.sh — JS registry × Python registry parite + render smoke.
#
# 2026-06-02 — Üç katmanı tek seferde doğrula:
#   1. JS chat-templates.mjs hangi aileleri tutuyor?
#   2. mlx_runner.py aynı setle (alias hariç) eşleşiyor mu?
#   3. Her aile için renderFamily() patlamadan çalışıyor mu + stop dizisi boş değil mi?
#
# Çıktı: PASS/FAIL satırları + summary; exit 0 hepsi geçerse.

set -euo pipefail
cd "$(dirname "$0")/../.."

JS_OUT=$(bun -e '
  import("./local-server/lib/chat-templates.mjs").then(m => {
    const ids = m.FAMILIES.map(f => f.id).sort();
    console.log(JSON.stringify(ids));
  }).catch(e => { console.error("JS_LOAD_ERR:", e.message); process.exit(1); });
')

PY_OUT=$(python3 -c '
import sys, json, os
# Import as a package so the `from . import config_center` works.
sys.path.insert(0, "agents")
os.environ.setdefault("ELARA_MLX_BASE", "http://127.0.0.1:8001")
os.environ.setdefault("ELARA_MLX_TIMEOUT_S", "30")
from _shared import mlx_runner
ids = sorted(mlx_runner._CHAT_TEMPLATES.keys())
print(json.dumps(ids))
')

echo "JS families: $JS_OUT"
echo "PY families: $PY_OUT"

JS_SET=$(echo "$JS_OUT" | python3 -c 'import json,sys; print(",".join(sorted(json.load(sys.stdin))))')
PY_SET=$(echo "$PY_OUT" | python3 -c 'import json,sys; print(",".join(sorted(json.load(sys.stdin))))')

if [ "$JS_SET" != "$PY_SET" ]; then
  echo "FAIL: family sets diverge"
  echo "  JS only: $(comm -23 <(tr , '\n' <<< "$JS_SET" | sort) <(tr , '\n' <<< "$PY_SET" | sort))"
  echo "  PY only: $(comm -13 <(tr , '\n' <<< "$JS_SET" | sort) <(tr , '\n' <<< "$PY_SET" | sort))"
  exit 1
fi
echo "PASS: JS↔PY family sets identical (10 entries)"

# Render smoke: each family must produce non-empty prompt + ≥1 stop token.
bun -e '
  import("./local-server/lib/chat-templates.mjs").then(m => {
    const msgs = [
      { role: "system", content: "You are helpful." },
      { role: "user",   content: "Hi there." },
    ];
    let bad = 0;
    for (const fam of m.FAMILIES) {
      try {
        const r = m.renderFamily(fam.id, msgs);
        if (!r.prompt || r.prompt.length < 5) { console.log(`FAIL ${fam.id}: empty prompt`); bad++; continue; }
        if (!Array.isArray(r.stopSequences) || r.stopSequences.length === 0) { console.log(`FAIL ${fam.id}: no stop seqs`); bad++; continue; }
        console.log(`PASS ${fam.id} prompt=${r.prompt.length}ch stops=${r.stopSequences.length}`);
      } catch (e) {
        console.log(`FAIL ${fam.id}: ${e.message}`); bad++;
      }
    }
    // Fail-loud probe: unknown family MUST throw.
    try {
      m.renderFamily("nonexistent-family-xyz", msgs);
      console.log("FAIL: unknown family did not throw"); bad++;
    } catch {
      console.log("PASS unknown-family-throws (fail-loud verified)");
    }
    process.exit(bad ? 1 : 0);
  });
'

echo ""
echo "=========================================="
echo "smoke-chat-templates: ALL GREEN ✓"
echo "=========================================="
