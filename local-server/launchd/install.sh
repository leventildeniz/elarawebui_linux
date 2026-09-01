#!/usr/bin/env bash
# ============================================================
#  ELARA — Unified Service Installer
#
#  İşletim sistemini tespit eder ve uygun kurulum aracını çalıştırır.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "[Installer] macOS tespit edildi. launchd kurulumuna geçiliyor..."
  bash "$SCRIPT_DIR/install-launchd.sh" "\$@"
elif [[ "$OSTYPE" == "linux"* ]]; then
  echo "[Installer] Linux/WSL tespit edildi. systemd kurulumuna geçiliyor..."
  sudo bash "$SCRIPT_DIR/install-systemd.sh" "\$@"
else
  echo "[Installer] HATA: Desteklenmeyen işletim sistemi: $OSTYPE" >&2
  exit 1
fi
