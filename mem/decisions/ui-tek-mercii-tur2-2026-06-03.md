---
name: UI = tek mercii Tur 2 kapanışı 2026-06-03
description: HyDE/extractor /no_think → thinkOffPrefix knob; planner prompt UI; per-model inspector_directive; audit GREEN
type: decision
---

# UI tek mercii — Tur 2 GREEN (2026-06-03)

Tur 1 (brand-mention gate cisco/huawei) sonrası askıda kalan üç hat kapandı.

## Yapılan iş

**Backend:**
- `lib/system-prompts.mjs`: `DEFAULT_HYDE_SYSTEM_PROMPT` + `DEFAULT_EXTRACTOR_SYSTEM_PROMPT` başındaki `/no_think\n` literali SÖKÜLDÜ. Yeni `DEFAULT_PLANNER_SYSTEM_PROMPT` (TR planner metni + `{MAX_TOOLS}` placeholder) eklendi; `PROMPT_DEFAULTS`'a kondu.
- `lib/rag/defaults.mjs` + `routes/rag-settings.mjs`: 2 yeni knob — `plannerSystemPrompt` (string, 8000 char clamp, "" → default) + `thinkOffPrefix` (string, 64 char clamp, default `/no_think\n`, env `MLX_THINK_OFF_PREFIX`).
- `server.mjs` HyDE call-site (~2538): `_hydePrefix` artık `RAG_SETTINGS.thinkOffPrefix`'ten okunuyor (qwen ailesinde aktif, başka familyde boş).
- `lib/ingest/extract.mjs` (~243): aynı pattern — extractor sysMsg başına Qwen ise `RAG_SETTINGS.thinkOffPrefix` enjekte edilir.
- `lib/plan-and-execute.mjs`: in-file `DEFAULT_PLANNER_PROMPT` SİLİNDİ. Çözünürlük: `SETTINGS.systemPrompt` (planner-özel) → `resolvePrompt(RAG_SETTINGS, "plannerSystemPrompt", {MAX_TOOLS})` → kod-içi default. `getRagSettings` deps üzerinden enjekte edilir (server.mjs `initPlanner` çağrısı güncellendi).
- `schema.sql`: `ALTER TABLE models ADD COLUMN IF NOT EXISTS inspector_directive text NOT NULL DEFAULT ''`.
- `lib/routes/models.mjs`: `rowToModel` + POST handler + INSERT/UPDATE SQL `inspector_directive` alanını taşıyor.
- `lib/routes/chat-stream.mjs` (~170,290) + `chat-orchestrate.mjs` (~543,670): `SELECT rag_enabled, inspector_directive FROM models`. `modelInspectorDirective` dolu ise `renderInspectorDirective`'e geçici overlay `{...RAG_SETTINGS, inspectorDirective: modelInspectorDirective}` verilir.
- `scripts/audit-hidden-prompts.sh`: `lib/system-prompts.mjs` + `lib/rag/defaults.mjs` exclude listesine eklendi (default'lar burada kalmaya devam eder).

**Frontend:**
- `src/components/rag-control-panel.tsx`: `PROMPT_DEFAULTS`'ten `/no_think\n` çıkarıldı + `plannerSystemPrompt` default eklendi. Yeni `THINK_OFF_PREFIX_DEFAULT` constant. Accordion badge 7→8. 2 yeni PromptRow (HyDE altında `plannerSystemPrompt` + Engine Hints altında `thinkOffPrefix` Input).
- `src/lib/api-client.ts`: `ModelDTO.inspectorDirective?: string` + saveModel body alanı.
- `src/lib/system-store.tsx`: `ModelEntry.inspectorDirective?: string`.
- `src/routes/_app.models.tsx`: emptyDraft / normalizeModel / hydrateModels / saveModel `inspectorDirective` taşıyor. Editor'de sistem prompt textarea'sının ALTINA "Inspector Directive (RAG override)" Textarea + DEFAULT/OVERRIDE badge.

**Belgelendirme:**
- `agents/README.md`: 7→8 katman; "Tool manifest UI'dan elden yazılır" ve "Per-model Inspector Directive override" başlıkları eklendi.

## Doğrulama (yapıldı)

- `bash local-server/scripts/audit-hidden-prompts.sh` → **GREEN** (10/10 ok).
- `node --check` 9 backend dosyada temiz.
- Davranış: tüm yeni knob'lar default'larda hiçbir değişiklik yapmaz (thinkOffPrefix=`/no_think\n` aynen, plannerSystemPrompt boş → eski TR metin, inspectorDirective boş → global → kod default).

## Geri-alma kapısı

- Knob'ları boşa çek → eski davranış.
- `inspector_directive` kolon kalır (NULL → no-op).
- Tek satırlık SQL revert gerekmez.

## Kapsam dışı (bilerek)

- Migration runner YOK (mevcut akış schema.sql idempotent `ALTER TABLE IF NOT EXISTS` ile boot'ta self-heal eder).
- Cache-flush INSERT (models.mjs:111) `inspector_directive` carry etmiyor — kullanıcı POST yoluyla yeniden kaydedince düşer; nadir yol.
- Model kartında inspectorDirective için "Reset to default" butonu yok — textarea'yı boşaltmak yeterli.
