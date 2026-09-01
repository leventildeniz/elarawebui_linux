---
name: Capability Agent Tur 5 e2e smoke
description: Uçtan uca capability proposal SSE → approve/reject akışını doğrulayan smoke script (Tur 5 kapanış)
type: feature
---
`local-server/scripts/capability-e2e-smoke.sh` (Tur 5): login → compound query stream → `capability_proposed` frame yakala → gap listesinden ilk `skill`'i `/approve` (auto-forge, applied_plan_id beklenir), ilk non-skill'i `/reject` → GET `/api/capabilities/proposals?status=pending` sayısı. SMOKE_USER/SMOKE_PASS env veya prompt. Var olan `capability-gap-smoke.sh` (modül) + `capability-sse-smoke.sh` (SSE-only) yanına E2E katmanı olarak eklendi. Tur 0-4 tamam: gap-detector + hook + policy + proposals CRUD + UI kartı + persist migration; Tur 5'te yeni kod yok, sadece kapanış smoke + memory.
