---
name: Meta-Forge Tur 4+5 telemetry GREEN 2026-07-03
description: Cold-classifier telemetry counters + /api/rag/intent-telemetry endpoint + RAG panel telemetry chip; metaForgeIntentRatio UI knob zaten mevcut
type: feature
---

# Meta-Forge Tur 4+5 GREEN (2026-07-03)

Tur 4 (cold-classifier telemetry) + Tur 5 (metaForgeIntentRatio UI knob) tek turda tamam.

## Değişiklikler

### Tur 4 — Telemetry
- `local-server/lib/rag/intent-classifier.mjs`: `_tel` rolling counters (decisions/coldDecisions/warmDecisions/nullDecisions/forgeDecisions/forgeRetryRecovered/forgeRetryNoop/forgeRetryError/lastForgeAt/lastReason). `getIntentClassifierProbe()` now returns `.telemetry`. Yeni export `recordForgeRetry(kind)`.
- `local-server/lib/routes/chat-orchestrate.mjs`: `recordForgeRetry("recovered"|"noop"|"error")` çağrıları meta_forge safety-net retry bloğuna (L297-311).
- `local-server/lib/routes/rag-readops.mjs`: yeni endpoint `GET /api/rag/intent-telemetry` — dynamic import, hiçbir DI değişikliği yok.
- `src/components/rag-control-panel.tsx`: `MetaForgeTelemetryChip` component (5s poll) Meta-Forge Lane bölümünün altına eklendi.

### Tur 5 — UI knob
Zaten mevcut (önceki oturumlarda geldi): `metaForgeIntentThreshold`, `metaForgeIntentRatio`, `metaForgeVsRagRatio` üçü de RAG paneli → Meta-Forge Lane altında canlı sliderlar.

## Test

`launchctl kickstart -k gui/$UID/com.elara.middleware && sleep 8`
- `curl -sb cookie.txt http://127.0.0.1:3005/api/rag/intent-telemetry | jq` → counters, anchor state, last reason.
- RAG paneli → Meta-Forge Lane → chip görsün (decisions/warm/cold/forge/retry).
- Debug script `bash local-server/scripts/meta-forge-debug.sh` sonrası `forgeDecisions ≥ 4`, `forgeRetryRecovered ≥ 0`.

## Açık

`.lovable/plan.md` Tur 3-6 zinciri tamam. Meta-Forge sağlamlaştırma epic'i kapanabilir.
