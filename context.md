# Elara Sovereign Studio - Context

## Current Phase: Phase 12 - Primitive Capabilities (Agents, Skills, Tools) & Zero-Trust UI

### Goal
Refactor ELARA Sovereign Studio into a fully agnostic, Zero-Trust Enterprise AI OS. This requires ripping out legacy mock data, `localStorage` state, hardcoded paths (macOS/Lovable specific), Apple MLX dependencies, and unsafe inline-script evaluations. All logic is migrating to async, horizontal-scaling ready PostgreSQL-backed (`elara_db`) REST endpoints mapped to the `v2_master_schema.sql`.

### Recently Completed Milestones (Phases 6 through 12)
1. **Memory, Approval Queue, CVE Feed, Models & Groups:** Fully migrated to async `fetchApi` with PostgreSQL endpoints. Replaced Lovable vendor-lock URLs with `http://127.0.0.1:8000/v1` defaults. UI uses ID-based references instead of names.
2. **Universal Agent Engine (Runner):** Eradicated all `MLX` strings and legacy macOS paths. Agents no longer have a `script_path` or explicit python environment tied to them. They act as "Profiles/Brains" that invoke external tools. 
3. **Agent Inference Settings (UI Refactor):** Stripped the legacy `Runtime & bridge` tab from Agents. Replaced with `Inference Settings`. Dropped `bridgeHost`, `port`, and `healthEndpoint`. Model picker now correctly handles `null` / `system_default` database mappings, displaying a fallback neon-green `✦ Use System Default` UI state.
4. **Skills & Tools v2 Architecture:**
    - Eradicated `script_kind`, `script_body`, `risk_level`, `rollback_body`, and unsafe inline-javascript evaluation from Skills.
    - Implemented a unified `Type` dropdown (`native`, `python`, `workflow`, `mcp`).
    - Hooked `workflowId` to the `useWorkflows` state, and `mcpClientId` to the `useMcp` state, using ID dropdowns instead of raw text inputs.
    - Added `/api/system/local-scripts` backend endpoint to scan `skills/`, `tools/`, and `agents/` directories. UI now presents disk files in a dropdown instead of requiring manual absolute paths.
    - Purged ALL legacy mock data (`seedSkills`, `seedForgeItems`, `toolCatalog` etc.) from stores. Everything is now 100% DB-driven.
5. **Capability Packs Migration:**
    - Eradicated `localStorage` reading/writing for Capability Packs.
    - Rewrote `useCapabilities` in `capability-store.ts` to fetch and sync from `/api/capability-packs`.
    - Removed mock `seedPacks` entirely, defaulting to empty DB arrays.
    - Mapped missing database fields correctly from `action_ids` -> `tools`, `skill_ids` -> `skills` and safely parsed `jsonb` array responses.
6. **Zero-Trust Ownership & Access (RBAC):**
    - Introduced the `workspace` visibility level (mapped to the `Globe` icon) to replace `org` / `organisation` across the UI.
    - Ensured robust rendering of `OwnerChip` to prevent React from crashing on unknown visibility variants.
    - Swapped destructive `Trash2` icons with `confirmAction` dialogs to prevent accidental row deletions.
7. **Backend CRUD Standardization:** Refactored `agents-crud.mjs` and `skills.mjs` `PUT`/`POST` endpoints. Replaced destructive payload maps with `COALESCE` constructs. Re-mapped frontend camelCase arrays to backend `jsonb` snake_case columns. Enforced strict parameter writing ensuring empty arrays (`[]`) are correctly committed to the DB, wiping stale data.
8. **PickerRow Refactoring:** Replaced string-only mappings inside UI pickers (`adapters`, `targets`, `mcp`, `tools`, `skills`) with `{ id, label }` JSON objects. Ensures the UI always displays the user-friendly Name/Label while committing the stable UUID/Slug to the backend.
9. **UI Stability & Bug Squashing (Major Focus):**
    - Fixed critical React rendering crashes ("Element type is invalid", "Cannot read properties of undefined") caused by hydration mismatches and empty DB arrays being joined or measured by `.length`.
    - Resolved the "Double Render" double-creation bug in `skill-store.ts` and `capability-store.ts` by making DB creation (`POST`/`PUT`) strictly `async/await` before firing global `CustomEvent` synchronization events.
    - Removed the "Unassigned" fallback logic in select menus forcing explicit squad placement.
    - Secured `Security & Policy` sandbox toggles by switching from a destructive `PUT` loop to `COALESCE` bounded updates, preserving configuration logic when flipping boolean `enabled` switches.

### Next Steps & Action Items
1. **URGENT BUG - Policy & Security Sandboxes:** The toggle (enable/disable) switches for Tool, Skill, and MCP Isolation Sandboxes on the cards are currently broken. Additionally, opening the card to edit, setting it to 'disabled', and saving fails to persist the change to the database. **Fixing this persistence/update issue (likely in `security-policies.mjs` and `security-store.ts`) is the absolute #1 priority.**
2. **Permanent Resolution of Remaining Edge Cases:** Ensure 100% stability across the newly integrated `Agents`, `Skills`, `Tools`, and `Capability Packs` screens. Any user-reported bug must be permanently resolved before advancing.
3. **MCP & Workflows (Orchestration):** Once the primitive structures are confirmed stable, shift focus to stabilizing the MCP panel and orchestration/workflow runners.
4. **Review Capability Bindings:** Double-check capability bindings to ensure deleted/orphaned items gracefully fall off agent profiles without breaking the UI.

### Rules & Pitfalls
- **Enterprise & Agnostic:** The system will be deployed to production in an Enterprise, OS-agnostic (Mac/Linux/Windows) environment. Every feature must function flawlessly end-to-end (frontend, backend, API, UI). No absolute paths (use `process.cwd()`).
- **Step-by-Step with Impact Analysis:** The backend was refactored by the AI, and the UI was altered by the User (features added/removed). Do not rush. Perform thorough impact analysis before modifying code. Consider how a change affects other modules and DO NOT break working systems.
- **Zero-Error Build Checks:** After making changes, ALWAYS run a build check (e.g., `npx tsc --noEmit`) to ensure zero TypeScript errors before proceeding.
- **Extreme Care with Zustand Stores:** Pay very close attention when editing `store.ts` files to avoid state and hydration crashes.
- **NO Unapproved Git Operations:** ABSOLUTELY NO `git commit` or `git restore` without explicit user permission.
- **No Bulk `sed`:** Avoid blind or bulk `sed` commands. Use targeted edits.
- **Strict Sync/Async Handling:** UI arrays mapping `[].length` must be safeguarded with `(arr || []).length` to prevent React from throwing "Cannot read properties of undefined" `HTTP 500` errors on hydration.
- **Zero-Trust:** Do not execute random code strings. Agents execute pre-defined, disk-bounded `Skills` or `Tools` in secured sandboxes.

### System Information & References
- **Documentation & Schemas:**
  - V2 Master Schema: `.forge/knowledge/v2_master_schema.sql` (Source of truth for DB state).
  - UI Docs: `.forge/knowledge/ELARA-Sovereign-Studio-UI-Technical-Documentation.md`
- **Systemd Services:** `elara-worker.service`, `elara-middleware.service`, `elara-vite.service`, `elara-tls-proxy.service`
- **Database:** `DATABASE_URL=postgres://sovereign:sovereign@127.0.0.1:5432/elara_db`
- **Login Credentials:** UI Admin user is `admin`, password is `password123`
- **API Gateway:** `api-v2.mjs` is the new central API router.