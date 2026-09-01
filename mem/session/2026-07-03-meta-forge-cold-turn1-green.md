---
name: Meta-Forge cold turn-1 GREEN 2026-07-03
description: Turn-1 forge_plan=true cold-start fix — anchor retry + orchestrate safety-net retry; keyword gate söküldü, semantic tek başına ayakta
type: feature
---

# Meta-Forge cold turn-1 GREEN (2026-07-03)

Debug smoke 4/4 yeşil (orchestrate turn1/2 + stream turn1/2 hepsi `forge_plan=true meta=meta-forge rag=meta_forge_lane/direct-forge`). Turn-1'de cold-anchor / cold-classifier yüzünden `subKind` boş dönme bugu kapandı.

## Fix zinciri (iki katman)

1. **`local-server/lib/rag/intent-classifier.mjs`** — `ensureAnchorVecs()` retry:
   - `_mlxEmbed` cold'da null dönüyordu → `budgetMs` (default 3500 / `INTENT_ROUTER_WARMUP_BUDGET_MS`) içinde 250ms aralıklarla retry.
   - Log: `anchor_init ok=true forge=true attempts=N`.
   - `metaForgeKeywordGate` yorumu düzeltildi ("default OFF, emergency gate").

2. **`local-server/lib/routes/chat-orchestrate.mjs`** (~L282) — safety-net retry:
   - `forgeLaneOn && !intentMeta?.subKind && intentMeta?.mode !== "execution-guard"` iken `intentClassifyReason` cold set'inde (`anchor_embed_failed`, `llm_timeout`, `embed_timeout`, veya `!classifierWarm`) → `refineIntentSemantically` ikinci kez çağrılıyor.
   - Trace: `meta_forge.lane.retry_recovered` / `retry_noop`.

## Sonuç

- Turn-1 dahil hepsi `forge_plan=true`, plan ID üretiliyor (`ca0cfb95…`, `69db7d03…`, `cbe9243b…`, `585fac2f…`).
- Deterministic keyword gate KAPALI kaldı — semantic yol tek başına çalışıyor.
- Debug script: `bash local-server/scripts/meta-forge-debug.sh` (regression kalıcı).

## AÇIK (Tur 3-6)

`.lovable/plan.md`:
- Tur 3: planner tool+agent de önersin (şu an skill-heavy)
- Tur 4: cold-classifier telemetry/ölçüm
- Tur 5: threshold UI knob (`metaForgeIntentRatio` RAG paneli)
- Tur 6: deterministic keyword gate kod-sök (artık dead code)
