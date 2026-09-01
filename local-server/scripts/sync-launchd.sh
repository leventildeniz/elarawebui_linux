#!/usr/bin/env bash
# sync-launchd.sh — Repo'daki temiz plist'i ~/Library/LaunchAgents'e kopyalar,
# bootout + bootstrap ile yeniden yükler. ELARA_AGENTS_* gibi env override'larını
# (manuel eklenmiş) bu sayede temizleriz; sürekli "neden plist .env'i eziyor"
# kafa karışıklığı bitsin.
#
# Kullanım: bash local-server/scripts/sync-launchd.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST_SRC="$REPO_ROOT/local-server/launchd/com.elara.middleware.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.elara.middleware.plist"
LABEL="com.elara.middleware"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

if [[ ! -f "$PLIST_SRC" ]]; then
  echo "✗ source plist missing: $PLIST_SRC" >&2; exit 1
fi

# Placeholder hydration — install-launchd.sh ile aynı sözleşme.
BUN_BIN="$(command -v bun || echo /opt/homebrew/bin/bun)"
TMP="$(mktemp -t elara-middleware.plist.XXXXXX)"
sed -e "s|__BUN__|$BUN_BIN|g" \
    -e "s|__PROJECT_ROOT__|$REPO_ROOT|g" \
    -e "s|__HOME__|$HOME|g" \
    "$PLIST_SRC" > "$TMP"

mkdir -p "$HOME/Library/LaunchAgents"
mv "$TMP" "$PLIST_DST"
echo "✓ wrote $PLIST_DST"

# Bootout → bootstrap. kickstart yetmiyor (env değişimini yakalamıyor).
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "$DOMAIN" "$PLIST_DST"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo "✓ middleware reloaded"
echo "  Verify with: launchctl print $DOMAIN/$LABEL | grep -E 'ELARA_AGENTS|state'"
