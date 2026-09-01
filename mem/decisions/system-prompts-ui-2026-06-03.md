---
name: System prompts UI tek mercii
description: 4 hardcoded LLM system prompt (RAG inspector + brand-lock + extractor + HyDE) RAG paneline taşındı; boş textarea → kodda default, doluysa UI kazanır
type: decision
---

# System prompts UI tek mercii (2026-06-03)

Kullanıcı kuralı (mem://preference/no-hidden-backend-prompts): backend'de gömülü LLM prompt YASAK.

## Yapılan iş — Tur 1 + Tur 2 GREEN

**Backend (`lib/system-prompts.mjs` — yeni 60 satır):**
- `DEFAULT_INSPECTOR_DIRECTIVE` (cevap formatı template, placeholders `{BRAND_LOCK}` + `{SOURCES}`)
- `DEFAULT_INSPECTOR_BRAND_LOCK` (brand-lock line template, placeholder `{BRAND}`)
- `DEFAULT_EXTRACTOR_SYSTEM_PROMPT` (technical-core denoise — /no_think + typo fix)
- `DEFAULT_HYDE_SYSTEM_PROMPT` (HyDE hypothetical passage)
- `resolvePrompt(settings, key, vars)` — boş override → default fallback + `{KEY}` substitution
- `renderInspectorDirective(settings, { dominantBrand, sourceList })` — composite helper

**4 yeni RAG_SETTINGS knob** (`lib/rag/defaults.mjs` buildRagDefaults + applyRagSettingsOverlay):
- `inspectorDirective` (string, default "" → kodda fallback)
- `inspectorBrandLock`
- `extractorSystemPrompt`
- `hydeSystemPrompt`

**Clamp + normalize** (`lib/rag/util.mjs` normalizeRagSettings): max 8000 char.
**POST handler** (`lib/routes/rag-settings.mjs`): for-loop 4 key kabul ediyor.

**Call-site bağlama (4 yer):**
- `lib/routes/chat-stream.mjs:270` — 9 satır array → 5 satır `renderInspectorDirective(...)`
- `lib/routes/chat-orchestrate.mjs:547` — aynı
- `lib/ingest/extract.mjs:243` — sysMsg → `resolvePrompt(RAG_SETTINGS, "extractorSystemPrompt")`
- `server.mjs:2530` (HyDE) — sysMsg → `_hydePrefix + resolveSystemPrompt(RAG_SETTINGS, "hydeSystemPrompt")` (Qwen `/no_think\n` prefix kod tarafında kalır)

**UI** (`src/components/rag-control-panel.tsx`):
- Yeni `<details>` accordion "Advanced · System Prompts" dosya sonuna eklendi (4/4 override badge)
- `PromptRow` component: Textarea + DEFAULT/OVERRIDE badge + Save (dirty iken) + Reset (override iken)
- `patchPrompt(key, value: string)` — string-valued saver (mevcut `patchSetting` numeric'ti)

## Davranış

- UI textarea boş → eski davranış aynen (regression 0)
- UI dolu → hot-swap, restart yok, `.rag-settings.json` persist
- Placeholders: `{BRAND}`, `{BRAND_LOCK}`, `{SOURCES}` — eksikse boş string

## Tur B (sonraki tur, bekliyor)

- `models.inspector_directive TEXT NULL` migration + model kartı override
- Çözünürlük: `model.inspector_directive ?? RAG_SETTINGS.inspectorDirective ?? DEFAULT`
- Kullanıcı isterse Gemma vs Qwen3 için ayrı tonlar yazabilir

## Doğrulama beklemede

Middleware kickstart sonrası RAG turunda directive 2-3 cümle yerine "4-6 cümle" textarea ile yazılırsa Gemma daha detaylı cevap yazmalı. Reset butonu → default geri.

## Yapmadıklarımız (kasten)

- Smalltalk guard (zaten 2026-06-02'de söküldü, mem index outdated)
- Free-answer prompt (zaten `buildFreeAnswerMessages` no-op, UI system_prompt'ı kullanır)
- Cross-vendor demote (brand-lock satırı zaten directive'in içinde)
- Sonuç: gerçek hardcoded = 6 değil 4 idi
