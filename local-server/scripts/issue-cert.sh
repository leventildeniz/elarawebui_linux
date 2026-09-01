#!/usr/bin/env bash
# Sovereign AI OS — Universal TLS Certificate Issuer (System Agnostic)
# Supports macOS and Linux. Focuses on hostnames rather than dynamic IPs.
#
# Requirement: mkcert must be installed.
#   - macOS: brew install mkcert nss
#   - Linux: Download binary from GitHub or use package manager.

set -euo pipefail

# --- Configuration ---
# Relative path to certs directory from the script location
# Script is in local-server/scripts, certs are in local-server/certs
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/certs"

# --- Dependency Check ---
if ! command -v mkcert >/dev/null 2>&1; then
    echo "[issue-cert] HATA: 'mkcert' bulunamadı." >&2
    echo "Lütfen önce mkcert'i kurun:"
    echo "  macOS: brew install mkcert nss"
    echo "  Linux: https://github.com/FiloSottile/mkcert#installation adresini ziyaret edin"
    exit 1
fi

# --- OS Detection & Hostname Gathering ---
OS="$(uname)"
# Base hosts that should always be present
HOSTS=("localhost" "127.0.0.1" "::1")

if [ "$OS" = "Darwin" ]; then
    # macOS logic
    LHN="$(scutil --get LocalHostName 2>/dev/null || true)"
    if [ -n "$LHN" ]; then
        HOSTS+=("$LHN" "$LHN.local")
    fi
elif [ "$OS" = "Linux" ]; then
    # Linux logic
    GHN="$(hostname 2>/dev/null || true)"
    if [ -n "$GHN" ]; then
        HOSTS+=("$GHN")
    fi
else
    echo "[issue-cert] Bilinmeyen işletim sistemi: $OS. Sadece macOS ve Linux desteklenir." >&2
    exit 1
fi

# Remove duplicates
UNIQ=()
for h in "${HOSTS[@]}"; do
    skip=0
    for u in "${UNIQ[@]}"; do [ "$u" = "$h" ] && skip=1 && break; done
    [ $skip -eq 0 ] && UNIQ+=("$h")
done

# --- Execution ---
# Ensure cert directory exists
mkdir -p "$CERT_DIR"

# Attempt to install root CA (might prompt for password)
# We check if it's already trusted to avoid unnecessary prompts
# On macOS we check keychain, on Linux we check if root CA exists in system store
# For simplicity, we call -install; mkcert handles "already installed" gracefully.
echo "[issue-cert] Root CA kontrol ediliyor/kuruluyor..."
mkcert -install

echo "[issue-cert] Sertifikalar üretiliyor için Hostname'ler: ${UNIQ[*]}"

# Generate the certificates
# Filenames: elara.pem (cert) and elara-key.pem (key)
# Correct syntax: mkcert -cert-file cert.pem -key-file key.pem host1 host2 ...
if mkcert -cert-file "$CERT_DIR/elara.pem" -key-file "$CERT_DIR/elara-key.pem" "${UNIQ[@]}"; then
    echo ""
    echo "✅ BAŞARILI: Sertifikalar oluşturuldu."
    echo "  Sertifika: $CERT_DIR/elara.pem"
    echo "  Anahtar:   $CERT_DIR/elara-key.pem"
    echo ""
    echo "Sistemi yeniden başlatmayı unutmayın: bash scripts/middleware-restart.sh"
else
    echo "[issue-cert] HATA: Sertifika üretimi başarısız oldu." >&2
    exit 1
fi
