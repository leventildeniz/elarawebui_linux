---
name: Agent smalltalk gate + RAG deadline anchor 2026-06-05
description: Agent hattı (/api/agents/:id/run) #1 "kendini tanıt" gibi self-intro'larda da koşulsuz RAG probe çalıştırıyor + #2 ragProbeAndFetch deadline'sız 149s+ donuyordu. Fix: intent-classifier smalltalk gate + Promise.race deadline. UI tek mercii (2 knob).
type: feature
---

## Belirtiler (2026-06-05)

1. `@[adc_maestro.py] kendini tanıt` → UI "SEARCHING SEALED LIBRARY · 149s" — chat hattında smalltalk lane var, agent hattında YOK.
2. `@[adc_maestro.py] netscaler nitro api nedir?` → first-token bile gelmiyor, 149s donma. `ragProbeAndFetch` deadline'sız çağrılıyordu.

## Fix (3 dosya + 1 UI)

- `local-server/lib/agent-rag.mjs:402-428` → `ragProbeAndFetch` çağrısı `Promise.race([..., setTimeout reject _agentRagDeadlineMs])` ile sarıldı. Mevcut `catch` zaten `reason:"rag_probe_error"` ile skip dönüyor → agent yine spawn olur. Knob: `RAG_SETTINGS.agentRagDeadlineMs` (default 8000, clamp 2000-60000).
- `local-server/lib/routes/agent-run.mjs:126-164` → `buildAgentRagContext` çağrısından ÖNCE dynamic-import ile `intent-classifier.mjs`'ten `classifyIntent` + `refineIntentSemantically` çağrı. `kind==="smalltalk"` ise rag objesi `{enabled:false, decision:"skip", reason:"smalltalk_intent"}` ile mock'lanır, RAG probe atlanır. SSE event `phase:"rag_skipped_smalltalk"`. Knob: `RAG_SETTINGS.agentSmalltalkSkipRag` (default true). Classifier fail → silent fallback to RAG (eski davranış).
- `local-server/.rag-settings.json` → 2 default seed.
- `src/components/rag-control-panel.tsx:856-877` → "Agent SSE Keep-Alive" altına 1 Switch (`agentSmalltalkSkipRag`) + 1 TuneRow (`agentRagDeadlineMs`).

## Pre-state SHA

`fa26642e550b` — rollback:
```
git checkout fa26642e550b -- local-server/lib/agent-rag.mjs local-server/lib/routes/agent-run.mjs local-server/.rag-settings.json src/components/rag-control-panel.tsx
launchctl kickstart -k gui/$UID/com.elara.middleware
```

## Doğrulama (kullanıcı turunda)

1. Kickstart middleware.
2. `@[adc_maestro.py] kendini tanıt` → tail log `[SMALLTALK-LANE/agent] agent=adc_maestro intent=smalltalk rag.skipped`, UI'da SEARCHING SEALED LIBRARY notice'ı yok, ~3-6s cevap.
3. `@[adc_maestro.py] netscaler nitro api nedir?` → ya `[AGENT-RAG/INJECT] support_rows=N` (8s içinde dönerse) ya da `[agent-rag] ragProbeAndFetch.error=agent_rag_deadline_8000ms` + agent yine spawn olur, kendi bilgisiyle cevap akar. 149s donma yok.

## Kapsam dışı

- VERSION-SUPPORT-FILTER (dün 2026-06-05 yeşildi) dokunulmadı.
- Chat hattı, RAG retrieval/scoring, MLX transport dokunulmadı.
- Agent exec timeout 180s dokunulmadı (sorun probe takılması, exec değildi).
