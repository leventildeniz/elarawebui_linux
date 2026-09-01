# ELARA OS Audit - OS-Specific Dependencies & Paths

This document tracks all identified OS-specific (macOS/Linux/WSL) paths and service dependencies to facilitate the transition to an OS-Agnostic architecture.

## 1. Hardcoded Paths (macOS)
The following paths are currently hardcoded and must be abstracted.

| File Path | Variable/Context | Hardcoded Value | Priority | Note |
| :--- | :--- | :--- | :--- | :--- |
| `agents/DEPLOY.md` | `ELARA_AGENTS_DIR` | `/Users/levent/ELARA_PROJECT/Elara_WebUi/agents` | Low | Documentation/Guide |
| `local-server/launchd/com.elara.middleware.plist` | `PYTHON_BIN` | `/Users/levent/ELARA_PROJECT/Elara_WebUi/local-server/.venv/bin/python` | **CRITICAL** | Service binary path |
| `local-server/lib/runtime-registry.mjs` | Model Paths | `/Users/levent/models/...` | **CRITICAL** | MLX Model loading |
| `local-server/scripts/checkpoint-dedupe-apply.mjs` | `FS_PATH` | `/Users/levent/ELARA_PROJECT/library/checkpoint_api` | High | File system access |
| `local-server/scripts/mlx-upgrade.sh` | `VENV` | `/Users/levent/ELARA_MLX/.venv` | High | Virtual environment path |

## 2. Service Management (macOS)
The system currently relies on `launchd` for service lifecycle management.

| Service | Plist File | OS Manager | Note |
| :--- | :--- | :--- | :--- |
| Middleware | `com.elara.middleware.plist` | `launchd` | Core server (3005/3006) |
| PostgreSQL | `com.elara.postgres.plist` | `launchd` | Note: Users report Postgres already auto-starts via OS default service |
| TLS Proxy | `com.elara.tls-proxy.plist` | `launchd` | HTTPS (10443) $\rightarrow$ Vite (8080) |
| Vite Frontend | `com.elara.vite.plist` | `launchd` | Frontend dev server (8080) |

## 3. OS-Agnostic Target State
- **Path Resolution:** All paths should be resolved via an abstraction layer (e.g., `os_utils.mjs`) or environment variables (e.g., `ELARA_ROOT`).
- **Service Abstraction:** Implement a service manager interface that maps to `launchctl` on macOS and `systemctl` on Linux/WSL.
- **Config Layer:** OS-specific binary paths and service names should be moved to a configuration file.

---
*Last Updated: 2026-07-24*
