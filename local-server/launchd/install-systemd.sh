#!/usr/bin/env bash
# ============================================================
#  ELARA — systemd installer (Linux/WSL)
#
#  Tüm ELARA servislerini (Worker, Middleware, Vite, Proxy)
#  systemd unit olarak otomatik kurar ve açılışa bağlar.
# ============================================================
set -euo pipefail

# Path detection
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCAL_SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SYSTEMD_DIR="/etc/systemd/system"

# Check for root privileges
if [[ "$EUID" -ne 0 ]]; then
  echo "[systemd] HATA: Bu script root yetkileri gerektirir (sudo kullanın)." >&2
  exit 1
fi

# Detect actual user when run with sudo
USER_NAME="${SUDO_USER:-$(whoami)}"
if [ "$USER_NAME" = "root" ]; then
    echo "[systemd] UYARI: Servisler root kullanıcısı adına kurulacak!"
fi

# Find binaries
BUN_BIN="$(which bun || echo "/usr/local/bin/bun")"
NODE_BIN="$(which node || echo "/usr/bin/node")"
PYTHON_BIN="$LOCAL_SERVER_DIR/venv/bin/python3"

echo "[systemd] Kurulum başlıyor..."
echo "  Kullanıcı : $USER_NAME"
echo "  Proje Kök : $PROJECT_ROOT"
echo "  Bun Yolu  : $BUN_BIN"
echo "  Node Yolu : $NODE_BIN"
echo "  Python    : $PYTHON_BIN"
echo "-----------------------------------------------------------"

# --- 1. Worker Service File (Port 8082) ---
echo "  [1/4] Creating elara-worker.service..."
cat <<EOF > "$SYSTEMD_DIR/elara-worker.service"
[Unit]
Description=ELARA Vector Worker (bge-m3)
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$LOCAL_SERVER_DIR
ExecStart=$PYTHON_BIN -m uvicorn worker:app --host 127.0.0.1 --port 8082
Restart=always
RestartSec=5
StandardOutput=append:$LOCAL_SERVER_DIR/worker.log
StandardError=append:$LOCAL_SERVER_DIR/worker.err

[Install]
WantedBy=multi-user.target
EOF

# --- 2. Middleware Service File (Port 3005/3006) ---
echo "  [2/4] Creating elara-middleware.service..."
cat <<EOF > "$SYSTEMD_DIR/elara-middleware.service"
[Unit]
Description=ELARA Middleware & Core API
After=network.target elara-worker.service
Requires=elara-worker.service

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$LOCAL_SERVER_DIR
ExecStart=$BUN_BIN run server.mjs
Restart=always
RestartSec=5
StandardOutput=append:$LOCAL_SERVER_DIR/server.log
StandardError=append:$LOCAL_SERVER_DIR/server.err

[Install]
WantedBy=multi-user.target
EOF

# --- 3. Vite Frontend Service File (Port 8080) ---
echo "  [3/4] Creating elara-vite.service..."
cat <<EOF > "$SYSTEMD_DIR/elara-vite.service"
[Unit]
Description=ELARA Vite Frontend Development Server
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$PROJECT_ROOT
ExecStart=$BUN_BIN run dev
Restart=always
RestartSec=5
StandardOutput=append:$LOCAL_SERVER_DIR/vite.log
StandardError=append:$LOCAL_SERVER_DIR/vite.err

[Install]
WantedBy=multi-user.target
EOF

# --- 4. TLS Proxy Service File (Port 10443) ---
echo "  [4/4] Creating elara-tls-proxy.service..."
cat <<EOF > "$SYSTEMD_DIR/elara-tls-proxy.service"
[Unit]
Description=ELARA Secure TLS Proxy
After=network.target elara-middleware.service elara-vite.service
Requires=elara-middleware.service elara-vite.service

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$PROJECT_ROOT
ExecStart=$NODE_BIN local-server/dev-tls-proxy.mjs
Restart=always
RestartSec=5
StandardOutput=append:$LOCAL_SERVER_DIR/proxy.log
StandardError=append:$LOCAL_SERVER_DIR/proxy.err

[Install]
WantedBy=multi-user.target
EOF

# --- Daemon Reload and Enable ---
echo "-----------------------------------------------------------"
echo "[systemd] Daemon reload ediliyor..."
systemctl daemon-reload

SERVICES=(elara-worker elara-middleware elara-vite elara-tls-proxy)

echo "[systemd] Tüm servisler başlangıca (boot) ekleniyor..."
for s in "${SERVICES[@]}"; do
  systemctl enable "$s"
  systemctl restart "$s"
  echo "  ✓ $s aktif edildi ve başlatıldı."
done

echo ""
echo "✅ BAŞARILI: Tüm 4 servis sisteme başarıyla kuruldu ve başlatıldı!"
echo "-----------------------------------------------------------"
echo "Sistem artık boot edildiğinde otomatik olarak başlayacak."
echo ""
echo "Durumları kontrol etmek için:"
echo "  systemctl status elara-worker"
echo "  systemctl status elara-middleware"
echo "  systemctl status elara-vite"
echo "  systemctl status elara-tls-proxy"
echo ""
echo "Artık şu adreslerden sisteme erişebilirsiniz:"
echo "  👉 Güvenli Giriş:  https://localhost:10443"
echo "  👉 Standart Giriş: http://localhost:8080"
echo "-----------------------------------------------------------"
