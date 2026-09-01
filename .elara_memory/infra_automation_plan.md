# ELARA System Infrastructure & SSL/TLS Automation Plan

## Goal
Implement automated SSL/TLS certificate generation and a centralized system infrastructure management panel in the UI to simplify local deployment and connectivity (especially for WSL/Linux and macOS).

## Tasks

### 1. Backend SSL/TLS Automation
- [x] Create `/api/system/certs/generate` endpoint in `local-server/server.mjs`.
- [x] Implement logic to create the `certs` directory if missing.
- [x] execute `openssl` to generate self-signed `elara.pem` and `elara-key.pem` in the correct location for `dev-tls-proxy.mjs`.

### 2. API Client Update
- [x] Add `certsGenerate()` method to `SystemEngineAPI` in `src/lib/api-client.ts`.

### 3. UI Infrastructure Management Card
- [x] Create `SystemInfrastructureCard` component in `src/routes/_app.settings.tsx`.
- [x] Integrate `SystemEngineAPI.serviceAction` for starting/stopping/restarting essential system services.
- [x] Integrate `SystemEngineAPI.certsGenerate` to trigger SSL generation.
- [x] Add a "Connection Guide" section with instructions for:
    - WSL Mirrored Networking.
    - `avahi-daemon` for `.local` hostname resolution.
    - Dynamic display of current HTTP/HTTPS URLs.
- [x] Place the card within the `services` tab of the Settings page.

## Progress Log
- 2026-07-25: Plan initialized.
- 2026-07-25: Full implementation completed, including UI integration and connectivity guide.
