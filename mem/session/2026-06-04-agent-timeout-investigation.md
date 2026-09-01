---
name: Agent timeout investigation 2026-06-04
description: firewall_oracle SIGKILL @180006ms wall (agentExecTimeoutMs). MLX warm/inflight=0, zombi değil. Aynı agent 2 önceki run 76s/96s OK. Kök = uzun-kuyruk run, model/zombi DEĞİL. Karar: knob A(180→300s) / B(no-op) / C(önce tokens_out+context_chars telemetri) — kullanıcı onayı bekliyor.
type: feature
---

## Ölçüm (2026-06-04 ~10:01)

`agent_run_history` son 5:
- firewall_oracle 2026-06-04 09:58:14 → **duration 180006ms, status=error, signal=SIGKILL** (tam wall)
- firewall_oracle 09:29:21 → 76107ms ok
- firewall_oracle 09:27:19 → 96561ms ok
- adc_maestro 2026-06-03 22:45 → 31s ok
- db_guardian 2026-06-03 21:00 → 22s ok

stdout_tail=1200 (cap dolu), stderr_tail=373 — ajan yazıyordu, kesildi.

MLX transport (timeout'tan ~2.5dk sonra ölçüm):
- state=warm, inflight=0, dirty=false, ageMs=155462 → zombi DEĞİL, doğal idle.

## Teşhis

- Cinayet aleti: agent wrapper wall = `RAG_SETTINGS.agentExecTimeoutMs` default **180000ms**. 180006ms tam wall + 6ms ölçüm payı.
- Model değil (aynı model aynı agent 2 önceki turda 76/96s).
- MLX zombi değil (warm + inflight=0).
- Bu run uzun-kuyruk yedi: muhtemelen büyük RAG context veya o turda model token/sn düşüktü.

## Karar matrisi (kullanıcı onayı bekliyor — kod YOK)

A) `agentExecTimeoutMs` 180→300s. RAG paneli UI knob zaten var, persist. Risk: kilitli run 5dk RAM tutar.
B) No-op + agent system prompt'ta "kısa cevap" baskısı. Risk: gerçek uzun-kuyruk run'larda tekrar eder.
C) Önce telemetri: `agent_run_history`'a `tokens_out`+`context_chars` kolon, spawnAgentRun onFinish hook'unda doldur. Sonra A vs C ayrımı verilere göre. 1 turluk schema iş.

Tercih: C → A. Önce bir sonraki gümleme'de "kaç token, kaç char context" görelim, sonra knob çevirelim.

## Diğer açık (bugüne bağlı değil)

- `knowledge_sources.brand` kolonu yok → audit script'inde `has_col` helper hattı (memory'de mevcut karar). Bugünkü timeout'a bağlı değil, ayrı tur.

## Asıl konu hatırlatma (kaçırmayalım)

Onaylı sıra: agent → tools → skills → workflow → orchestrator. Bu turlar ölçüm turu, yeni kod yok. Plan-first kuralı geçerli.
