#!/usr/bin/env bash
# ============================================================
#  ELARA — systemd installer (Linux / WSL)
#
#  Installs and enables all ELARA enterprise services:
#    - elara-worker.service      (Port 8082 - Vector embeddings)
#    - elara-middleware.service  (Port 3005/3006 - Core API & Orchestrator)
#    - elara-vite.service        (Port 8080 - Vite UI)
#    - elara-tls-proxy.service   (Port 10443 - HTTPS Proxy)
# ============================================================
set -euo pipefail

# Path detection
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCAL_SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SYSTEMD_DIR="/etc/systemd/system"

# Check for root privileges
if [[ "$EUID" -ne 0 ]]; then
  echo "[systemd] ERROR: This script requires root privileges (use sudo)." >&2
  exit 1
fi

# Detect actual user when run with sudo
USER_NAME="${SUDO_USER:-$(whoami)}"
if [ "$USER_NAME" = "root" ]; then
    echo "[systemd] WARNING: Services will be installed on behalf of root user."
fi

# Find binaries
BUN_BIN="$(which bun || echo "/usr/local/bin/bun")"
NODE_BIN="$(which node || echo "/usr/bin/node")"
PYTHON_BIN="$LOCAL_SERVER_DIR/venv/bin/python3"
if [ ! -f "$PYTHON_BIN" ]; then
  PYTHON_BIN="$(which python3 || echo "/usr/bin/python3")"
fi

echo "[systemd] Starting ELARA service installation..."
echo "  User         : $USER_NAME"
echo "  Project Root : $PROJECT_ROOT"
echo "  Bun Binary   : $BUN_BIN"
echo "  Node Binary  : $NODE_BIN"
echo "  Python Binary: $PYTHON_BIN"
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
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$LOCAL_SERVER_DIR
$([ -f "$LOCAL_SERVER_DIR/.env" ] && echo "EnvironmentFile=$LOCAL_SERVER_DIR/.env")
ExecStart=$NODE_BIN server.mjs
Restart=always
RestartSec=5
StandardOutput=append:$LOCAL_SERVER_DIR/middleware.log
StandardError=append:$LOCAL_SERVER_DIR/middleware.err

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
echo "[systemd] Reloading systemd daemon..."
systemctl daemon-reload

SERVICES=(elara-worker elara-middleware elara-vite elara-tls-proxy)

echo "[systemd] Enabling and restarting all 4 services..."
for s in "${SERVICES[@]}"; do
  systemctl enable "$s"
  systemctl restart "$s"
  echo "  ✓ $s enabled & started."
done

echo ""
echo "✅ SUCCESS: All 4 ELARA services are active and running!"
echo "-----------------------------------------------------------"
echo "Services will automatically restart on system boot."
echo ""
echo "Verify status with:"
echo "  systemctl status elara-worker"
echo "  systemctl status elara-middleware"
echo "  systemctl status elara-vite"
echo "  systemctl status elara-tls-proxy"
echo ""
echo "Access endpoints:"
echo "  👉 HTTPS Secure Gateway:  https://localhost:10443"
echo "  👉 HTTP Vite WebUI:       http://localhost:8080"
echo "  👉 Core API Gateway:      http://localhost:3005"
echo "-----------------------------------------------------------"
