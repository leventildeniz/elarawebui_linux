#!/bin/bash
# OS-Agnostic Utilities for ELARA OS

# Resolve project root dynamically
# Traces directory containing this script to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVED_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# OS Detection
if [[ "$OSTYPE" == "darwin"* ]]; then
  export ELARA_OS="mac"
  export ELARA_ROOT="${ELARA_ROOT:-$RESOLVED_ROOT}"
else
  export ELARA_OS="linux"
  export ELARA_ROOT="${ELARA_ROOT:-$RESOLVED_ROOT}"
fi

# OS-Specific Paths
if [[ "$ELARA_OS" == "mac" ]]; then
  export ELARA_MLX_VENV="${ELARA_MLX_VENV:-${ELARA_ROOT}/local-server/.venv}"
else
  export ELARA_MLX_VENV="${ELARA_MLX_VENV:-${ELARA_ROOT}/local-server/.venv}"
fi

# Helper to resolve paths relative to root
function resolve_path() {
  local relative_path="$1"
  # Safely handle relative paths without stripping all slashes blindly!
  # Strip only a single leading slash if present.
  relative_path="${relative_path#/}"
  echo "${ELARA_ROOT}/${relative_path}"
}
