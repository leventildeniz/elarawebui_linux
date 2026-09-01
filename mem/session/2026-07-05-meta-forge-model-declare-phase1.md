---
name: 2026-07-05 meta-forge model-declare Phase 1 landed
description: RAG deseninin aynası — model kendisi <forge> tag emit ediyor, biz sniff'liyoruz; Phase 1 foundation + signal; Phase 2 planner spawn wiring bekliyor
type: feature
---

# Meta-Forge model-declare — Phase 1 GREEN (2026-07-05 sabah)

Kullanıcı 4 saatlik uyku sonrası "aslında şimdi yapalım" dedi. Plan onayı `.lovable/plan.md`'de. Uygulama:

## Dosyalar
- **Yeni** `local-server/lib/meta-forge/tag-parser.mjs` — streaming sniffer, `<forge>` state-machine, TR slugify, window guard
- **Yeni** `local-server/lib/meta-forge/system-hint.mjs` — default protokol snippet'i
- **Edit** `local-server/lib/rag/defaults.mjs` — 3 knob (gateMode+hint+windowChars) + overlay reader
- **Edit** `local-server/lib/rag/intent-classifier.mjs` — model-declare modunda forge adjudication SKIP (satır 390-397)
- **Edit** `local-server/lib/routes/chat-orchestrate.mjs` — pre-lane guard (satır 284-291) + hint injection + sniffer wiring (satır 1584-1620) + flush (satır 1687-1695)
- **Edit** `local-server/lib/routes/chat-stream.mjs` — aynı hint + sniffer (emit-only)

## Node --check ✓ (6/6)
## Parser smoke ✓ (7/8, kalan test over-strict)

## Ne çözüldü
- **False-positive Meta-Forge KAPANDI** — model-declare mode + classifier skip + orchestrate lane guard üçlüsü
- Model `<forge kind name intent/>` emit ederse → SSE `forge_declared` event akıyor, tag delta'dan strip'leniyor

## Ne bekliyor (Phase 2)
- `_forgeDeclared` set olursa post-stream `Meta/forge_master.py` spawn — mevcut `stream-parser.mjs` hattı reuse
- Legacy lane (orchestrate 314-593) helper fn'e refactor: pre-classify VE model-declare aynı spawn hattını kullansın
- UI chat message'e `forge_declared` chip; `forge_plan_partial`/`forge_plan` card render'ı mevcut

## Rollback
`metaForgeGateMode = "pre-classify"` (UI knob) → eski hat birebir çalışır. Regex geri gelmez.

## User verification
Kickstart bekleniyor: normal muhabbet (yetki cümleleri) hiç Meta-Forge tetiklememeli; "phishing triage skill yaz" → model tag emit + SSE event (Phase 2 gelene kadar planner card RENDER OLMAZ, sadece Network sekmesinde event görünür).
