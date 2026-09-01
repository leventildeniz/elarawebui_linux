# ELARA Handover Note - 2026-07-25 (Updated)

## Context for Next Session
The project is undergoing an **OS-Agnostic Migration** (macOS <-> Linux/WSL). The latest focus was on resolving the Worker memory limit and implementing a system-agnostic SSL certificate generation & service auto-start mechanism on Linux (systemd).

## What has been achieved:
1. **Worker Memory Optimization**:
   - Updated `MAX_RSS_GB` in `local-server/worker.py` to `8.0` (8.0GB) to prevent OOM/suicide on CPU-only/Linux environments.
   - Updated the docstring in `worker.py` to match the implementation.
   - Verified that the worker runs successfully on CPU/Linux (Port 8082).
2. **System-Agnostic SSL Certificate Generation**:
   - Completely rewrote `local-server/scripts/issue-cert.sh` to be system-agnostic (supports macOS and Linux).
   - The script auto-detects the OS, collects relevant hostnames (including local system hostname like `5400-LI`), and generates certs into `local-server/certs/` using `mkcert`.
   - Successfully ran the script on the user's Linux machine, resulting in valid `elara.pem` and `elara-key.pem` files.
3. **Linux Service Automation (Systemd)**:
   - Created `local-server/scripts/install-services.sh` to automatically install and enable systemd services for Linux.
   - Installed `elara-worker.service` and `elara-middleware.service` under the user `levent` to automatically start on boot and restart on failure.
4. **Bug Discovery (Show-stoppers Identified)**:
   - **CATASTROPHIC PROXY BUG (MCP BLOCKED)**: Discovered that `dev-tls-proxy.mjs` was routing all public `/mcp` and `/mcp/*` endpoints directly to Vite (8080) instead of the Express API (3005). Fixed the `pickUpstream` function inside `local-server/dev-tls-proxy.mjs`. Dış MCP istemcileri (Page Assist vb.) artık sorunsuzca bağlanabilir.
   - **Gemma 4 Python Runner Parity Missing**: Found that while Node.js side has `gemma4` template, `agents/_shared/mlx_runner.py` is missing correct integration of specific prompt configurations, falling back to `qwen2.5` which loops Gemma.

## Critical Performance Diagnosis (The "6-Minute Latency" Mystery):
Levent highlighted a major issue: "Selam" in ELARA can take 6 minutes, whereas Page Assist with the same model is instant. We identified the root causes:
1. **Prompt Bloating (Sistem Prompt Şişmesi)**: ELARA injects ALL registered capabilities, tools, and agents' manifests into the system prompt for every single message. This balloons input size to 15k-20k+ tokens, destroying local pre-fill speeds.
2. **Aggressive Autoreset Watchdog (Panik Atak Watchdog)**: If the first token is delayed due to processing the bloated prompt, the backend watchdog assumes a lockup and triggers `restartLocalLlmRuntime`. This kills the MLX server, forcing a full reload of the massive 31B/72B model into RAM, which takes 3-6 minutes.
3. **Single-concurrency Queue Lockups**: Stale or zombie requests lock the `mlxQueue` and prevent new lightweight inputs ("selam") from being processed immediately.

## Immediate Next Steps (For Levent's WSL login tomorrow):
1. **Run the Unified Installer**:
   - Run `sudo bash local-server/launchd/install.sh` on WSL to spin up all 4 services (Vite, Proxy, Middleware, Worker).
2. **Test Port Accessibility**:
   - Access `https://localhost:10443` and test the UI.
3. **Perform Gemma 4 Prompt & Injection Optimizations**:
   - Optimize the system prompt injection mechanism so it doesn't send the entire world's manifest on simple greeting turns.
   - Fix the Watchdog logic to prevent false-positive model reloads.
