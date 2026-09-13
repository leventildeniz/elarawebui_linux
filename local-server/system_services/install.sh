#!/usr/bin/env bash
# ============================================================
#  ELARA — Unified System Service Installer (OS-Agnostic)
#
#  Detects operating system and invokes appropriate service installer:
#    - Linux / WSL  → systemd (elara-*.service)
#    - macOS        → launchd (com.elara.*.plist)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "[Installer] macOS detected. Launching launchd installer..."
  bash "$SCRIPT_DIR/install-launchd.sh" "$@"
elif [[ "$OSTYPE" == "linux"* ]]; then
  echo "[Installer] Linux/WSL detected. Launching systemd installer..."
  sudo bash "$SCRIPT_DIR/install-systemd.sh" "$@"
else
  echo "[Installer] ERROR: Unsupported operating system: $OSTYPE" >&2
  exit 1
fi
