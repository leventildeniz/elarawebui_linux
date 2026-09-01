#!/usr/bin/env bash
# Localhost admin shortcut. Reads ADMIN_API_TOKEN from local-server/.env and
# attaches x-admin-token header to curl. Only works from loopback (server-side
# check).
#
# Usage:
#   ./admin-curl.sh /api/knowledge/cleanup -X POST | jq
#   ./admin-curl.sh /api/system/worker/status | jq
#   ELARA_API_BASE=https://elara.local:10443 ./admin-curl.sh /api/health
#
# Default BASE = http://127.0.0.1:3005 (HTTP direct → middleware, no TLS noise).
# Pass an absolute URL (http(s)://...) as the first arg to override BASE.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HERE/../.env"
BASE="${ELARA_API_BASE:-http://127.0.0.1:3005}"
if [ ! -f "$ENV_FILE" ]; then
  echo "[admin-curl] missing $ENV_FILE" >&2; exit 1
fi
TOKEN="$(grep -E '^ADMIN_API_TOKEN=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
if [ -z "${TOKEN:-}" ]; then
  echo "[admin-curl] ADMIN_API_TOKEN not set in $ENV_FILE" >&2
  echo "            generate one:  openssl rand -hex 32" >&2
  exit 1
fi

# First positional arg: absolute URL → use as-is; path starting with / → prefix BASE.
ARG1="${1:-}"
if [ -n "$ARG1" ] && [ "${ARG1#/}" != "$ARG1" ]; then
  shift
  exec curl -sk -H "x-admin-token: $TOKEN" "$@" "${BASE}${ARG1}"
fi
exec curl -sk -H "x-admin-token: $TOKEN" "$@"
