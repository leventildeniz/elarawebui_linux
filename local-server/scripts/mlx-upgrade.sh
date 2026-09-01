#!/usr/bin/env bash
# mlx-upgrade.sh — controlled mlx-lm / transformers / tokenizers upgrade
# Plan: .lovable/plan.md (2026-05-29). Reason: macOS 26.5 + mlx-lm 0.18.2
# /v1/chat/completions BatchEncoding crash. Snapshot → upgrade → restart → probe.
# Usage:
#   bash local-server/scripts/mlx-upgrade.sh           # snapshot + upgrade + restart + probe
#   bash local-server/scripts/mlx-upgrade.sh --probe   # just probe (no install)
#   bash local-server/scripts/mlx-upgrade.sh --rollback /path/to/pip-freeze-before-mlx-upgrade.txt
set -u
source "$(dirname "$0")/../lib/os_utils.sh"

VENV="${ELARA_MLX_VENV:-$(resolve_path 'ELARA_MLX/.venv')}"
PY="$VENV/bin/python"
MODEL_ID="${ELARA_MLX_MODEL_ID:-}"
PORT="${ELARA_MLX_PORT:-8001}"
SNAPSHOT="${ELARA_MLX_SNAPSHOT_DIR:-${VENV%/.venv}}/pip-freeze-before-mlx-upgrade-$(date +%Y%m%d-%H%M%S).txt"
LAUNCHD_LABEL="${ELARA_MLX_LAUNCHD_LABEL:-}"

bold(){ printf "\033[1m%s\033[0m\n" "$*"; }
dim(){  printf "\033[2m%s\033[0m\n" "$*"; }
fail(){ printf "\033[31m[FAIL]\033[0m %s\n" "$*"; }
ok(){   printf "\033[32m[ OK ]\033[0m %s\n" "$*"; }

[ -x "$PY" ] || { fail "venv python bulunamadı: $PY  (ELARA_MLX_VENV ile override et)"; exit 1; }

probe() {
  bold "=== 1) /v1/models ==="
  curl -s --max-time 5 "http://127.0.0.1:${PORT}/v1/models" | head -c 400; echo
  bold "=== 2) /v1/chat/completions (BatchEncoding bug testi) ==="
  curl -sS --max-time 60 -X POST "http://127.0.0.1:${PORT}/v1/chat/completions" \
    -H 'content-type: application/json' \
    -d "{\"model\":\"${MODEL_ID}\",\"messages\":[{\"role\":\"user\",\"content\":\"selam\"}],\"max_tokens\":32}" \
    | head -c 800; echo
  bold "=== 3) /v1/completions (Yol C regression testi) ==="
  curl -sS --max-time 60 -X POST "http://127.0.0.1:${PORT}/v1/completions" \
    -H 'content-type: application/json' \
    -d "{\"model\":\"${MODEL_ID}\",\"prompt\":\"<|im_start|>user\nselam<|im_end|>\n<|im_start|>assistant\n\",\"max_tokens\":32}" \
    | head -c 800; echo
}

if [ "${1:-}" = "--probe" ]; then probe; exit 0; fi

if [ "${1:-}" = "--rollback" ]; then
  ROLLBACK_FILE="${2:-}"
  [ -f "$ROLLBACK_FILE" ] || { fail "rollback dosyası yok: $ROLLBACK_FILE"; exit 1; }
  bold "Rollback: $ROLLBACK_FILE"
  "$PY" -m pip install --force-reinstall -r "$ROLLBACK_FILE"
  exit $?
fi

bold "ELARA MLX upgrade · venv=$VENV"

bold "1) Snapshot → $SNAPSHOT"
"$PY" -m pip freeze > "$SNAPSHOT" && ok "snapshot yazıldı" || { fail "pip freeze"; exit 1; }
"$PY" -m pip show mlx-lm transformers tokenizers mlx mlx-metal 2>/dev/null \
  | rg -i '^(Name|Version):' | paste - - | sed 's/Name: //; s/\tVersion: / = /'

bold "2) Upgrade mlx-lm + transformers + tokenizers"
"$PY" -m pip install --upgrade mlx-lm transformers tokenizers || { fail "pip install"; exit 1; }
ok "upgrade tamam"

bold "3) Restart MLX launchd"
if [ -z "$LAUNCHD_LABEL" ]; then
  LAUNCHD_LABEL="$(launchctl list 2>/dev/null | rg -i 'mlx|elara' | rg -v middleware | awk '{print $3}' | head -1)"
fi
if [ -n "$LAUNCHD_LABEL" ]; then
  dim "label=$LAUNCHD_LABEL"
  launchctl kickstart -k "gui/$UID/$LAUNCHD_LABEL" && ok "kickstart" || fail "kickstart başarısız"
else
  fail "MLX launchd label bulunamadı — ELARA_MLX_LAUNCHD_LABEL ile elden ver"
  dim "Manuel: lsof -nP -iTCP:${PORT} -sTCP:LISTEN  →  kill PID  →  launchd respawn etmeli"
fi

bold "4) MLX boot için 10sn bekle (model yüklenmesi)"
for i in $(seq 1 20); do
  curl -sf --max-time 1 "http://127.0.0.1:${PORT}/v1/models" >/dev/null && { ok "MLX :$PORT ayakta (${i}s)"; break; }
  sleep 1
done

probe

bold "=== Sonuç ==="
echo "Rollback gerekirse:"
echo "  bash $0 --rollback $SNAPSHOT"
