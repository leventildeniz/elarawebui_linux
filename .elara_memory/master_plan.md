# ELARA Master Plan - WSL Migration & Evolution

## 1. Vision
Transform ELARA from a Mac-centric prototype to a robust, local-first AI OS running on WSL (Dell Latitude), while maintaining the strategic "brain" on Apple M5 Max.

## 2. Immediate Goals (Cross-Platform Adaptation & Support)
- [ ] **Environment Audit**: Identify all hardcoded Mac paths, `launchd` configurations, and Apple-specific service calls.
- [ ] **OS-Agnostic Service Layer**: Implement a unified abstraction layer for process management (e.g., supporting both `systemd` for Linux/WSL and `launchd` for macOS) to ensure the system remains portable.
- [ ] **DB Verification**: Ensure PostgreSQL/pgvector is running and the restored backup is accessible.
- [ ] **Network Alignment**: Verify that the Bun middleware and Python agents can communicate correctly in the WSL network stack.
- [ ] **Cross-Platform Abstraction**: Implement a configuration layer that automatically detects the OS (Linux vs macOS) and applies the correct paths and service managers.

## 3. Mid-Term Goals (The "North Star")
- [ ] **Compound Proposals**: Implement the ability to plan and forge multiple capabilities at once.
- [ ] **Auto-Execute**: Enable "Approve & Run" functionality.
- [ ] **Workflow Canvas**: Build the DAG-based workflow builder.

## 4. Memory & Context Management
- All strategic decisions, architectural changes, and progress logs will be stored in `.elara_memory/`.
- This ensures that context is preserved across sessions and model updates.

---
*Last Updated: 2026-07-23*
