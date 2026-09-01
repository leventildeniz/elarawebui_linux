---
name: 2026-06-03 EOD — Tur 2 UI tek mercii tamam + revert anchor
description: Bugün (2026-06-03) tamamlanan iki büyük blok ve gün sonu checkpoint; post-state SHA + rollback komutu
type: session
---

# 2026-06-03 — Gün Sonu

## Bugün ne yapıldı (sırayla)

### Blok 1 — Brand mention gate (Tur 1 devamı, sabah)
- `cisco/huawei` tipi karşılaştırma sorularında firewall_oracle agent'a düşmüyordu → cross-vendor brand mention algılama eklendi
- Dosyalar: `local-server/lib/routes/chat-stream.mjs`, `chat-orchestrate.mjs`, `agents/NetSec/firewall_oracle.py`
- Kullanıcı doğruladı: "tamam komutan olmuş super"
- Detay: `mem://decisions/brand-mention-gate-2026-06-03.md`

### Blok 2 — Tur 2: UI = Tek Mercii (akşam, 2 sub-tur tek seferde)
**Tur 2A (audit kapanışı + tool manifest frame):**
1. **HyDE `/no_think` literal söküldü** → `RAG_SETTINGS.thinkOffPrefix` knob (default `/no_think\n`, empty → no-op). 2 call-site: `server.mjs` HyDE + `lib/ingest/extract.mjs` extractor.
2. **Planner prompt UI'ya** → `DEFAULT_PLANNER_SYSTEM_PROMPT` `lib/system-prompts.mjs`'e, `{MAX_TOOLS}` placeholder, knob `plannerSystemPrompt` (clamp 8000), RAG paneline 6. PromptRow. `lib/plan-and-execute.mjs` resolvePrompt kullanıyor.
3. **Tool Manifest Frame template** → `DEFAULT_TOOLS_MANIFEST_FRAME` `system-prompts.mjs`'e, `{TOOL_LIST}` + `{CALL_SYNTAX}` placeholder. Knob `toolsManifestFrame` (clamp 8000). `injectAgentToolsManifest` knob ON iken UI text, OFF iken default.
4. **Audit script exclude list güncellendi** → `system-prompts.mjs` + `defaults.mjs` exclude. Script GREEN (exit 0).

**Tur 2B (per-model inspector + agents/README):**
5. **`models.inspector_directive` migration** → schema self-heal (boot DDL), model card UI Textarea + OVERRIDE/DEFAULT badge, POST /api/models clamp 8000. Per-call shallow overlay `chat-stream.mjs` + `chat-orchestrate.mjs`.
6. **`agents/README.md` onaylı** → Tool Manifest UI + Per-model Inspector Override bölümleri eklendi.

**Doğrulama:**
- `audit-hidden-prompts.sh` exit=0 (GREEN)
- 8+ backend dosya `node --check` ✓
- Empty knob → default davranış (backward compat)

**Detaylar:** `mem://decisions/ui-tek-mercii-tur2-2026-06-03.md`

## Post-state (revert anchor)

- **SHA**: `7750848a69b5`
- **Rollback komutu** (gerekirse):
  ```bash
  git -C /dev-server checkout 7750848a69b5 -- .
  # ya da spesifik dosya geri sarma için aynı SHA'dan checkout
  ```

## Değişen dosyalar (özet, bugün toplam)

**Backend:**
- `local-server/server.mjs` (HyDE prefix)
- `local-server/lib/system-prompts.mjs` (4 yeni default + resolvePrompt)
- `local-server/lib/rag/defaults.mjs` (4 yeni knob)
- `local-server/lib/routes/rag-settings.mjs` (clamp + sanitize)
- `local-server/lib/routes/chat-stream.mjs` (brand gate + inspector overlay)
- `local-server/lib/routes/chat-orchestrate.mjs` (brand gate + inspector overlay)
- `local-server/lib/routes/models.mjs` (inspector_directive POST/PATCH)
- `local-server/lib/routes/knowledge-retrieve.mjs` (brand cache)
- `local-server/lib/rag/brand-cache.mjs`
- `local-server/lib/ingest/extract.mjs` (thinkOffPrefix)
- `local-server/lib/plan-and-execute.mjs` (planner resolvePrompt)
- `local-server/schema.sql` (inspector_directive kolon)
- `local-server/scripts/audit-hidden-prompts.sh` (exclude list)

**Frontend:**
- `src/components/rag-control-panel.tsx` (4 yeni PromptRow + 1 knob)
- `src/lib/api-client.ts` (Model tipinde inspector_directive)
- `src/lib/system-store.tsx`
- `src/routes/_app.models.tsx` (Inspector Directive Textarea + badge)
- `agents/NetSec/firewall_oracle.py`

**Docs/memo:**
- `agents/README.md`
- `mem/decisions/brand-mention-gate-2026-06-03.md`
- `mem/decisions/ui-tek-mercii-tur2-2026-06-03.md`
- `.lovable/plan.md`

## Açık konular (yarın)
- **UI makyaj turu** — kullanıcı bunu istedi: "UI zayıf kalıyor" itirazı; sakin kafayla beraber konuşulacak
- Test edilecek: model editöründe Inspector Directive override → chat'te OVERRIDE banner görünüyor mu
- Test edilecek: RAG panelinden `thinkOffPrefix` boş bırakılınca HyDE `/no_think` olmadan koşuyor mu
- Test edilecek: `injectAgentToolsManifest=true` + `toolsManifestFrame` özelleştirilince agent prompt'una yansıyor mu
- `tools_manifest` knob + `system-prompts.mjs` default'larının operatör reçetesi-versiyonu `agents/README.md`'de var, doğrulama yarın

## Yarın için kural
**UI YOK ÇALIŞMAYA BAŞLAMA** — kullanıcı sabah UI konusunu beraber konuşmak istiyor. Plan-first.
